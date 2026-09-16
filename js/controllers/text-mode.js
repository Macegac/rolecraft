        /**
         * =================================================================================================
         * [SEC:JS:CTRL:TXT]
         * TextModeController
         * Private one-to-one "text message" threads with a single character.
         *
         * Threads are stored inline in state.chat_history as messages of type 'dm' carrying an
         * exclusive_to_char_id. The existing prompt-side privacy filter (_getSmartHistorySlice)
         * hides each thread from every character except its participant, while the participant
         * still receives the full main narrative plus their own private thread in chronological
         * order. Threads therefore persist, export and back up with no extra plumbing.
         *
         * Text Mode is a rendering mode over the normal chat window rather than a separate view,
         * so message indices are untouched and every existing message tool keeps working.
         * =================================================================================================
         */
        /* [SEC:JS:CTRL:TXT] */
        const TextModeController = {

            RUNTIME: {
                activeCharId: null,
                isGenerating: false
            },

            /**
             * Whether a private thread is currently open.
             * @returns {boolean}
             */
            isActive() {
                return !!this.RUNTIME.activeCharId;
            },

            /**
             * Returns the private thread for a given character, in chronological order.
             * @param {string} charId
             * @returns {Array}
             */
            getThread(charId) {
                const state = ReactiveStore.state;
                if (!state || !Array.isArray(state.chat_history)) return [];
                return state.chat_history.filter(m => m && m.type === 'dm' && m.exclusive_to_char_id === charId);
            },

            /**
             * Characters eligible for texting: active, not the player.
             * @returns {Array}
             */
            getContacts() {
                const state = ReactiveStore.state;
                if (!state || !Array.isArray(state.characters)) return [];
                return state.characters.filter(c => c && !c.is_user && c.is_active !== false);
            },

            /**
             * Number of messages from a character that arrived after the thread was last opened.
             * Always 0 until characters can text unprompted, but the plumbing belongs here.
             * @param {string} charId
             * @returns {number}
             */
            getUnreadCount(charId) {
                const state = ReactiveStore.state;
                if (!state) return 0;
                const lastRead = (state.dmLastRead || {})[charId];
                const readAt = lastRead ? new Date(lastRead).getTime() : 0;
                return this.getThread(charId).filter(m =>
                    m.character_id === charId && m.timestamp && new Date(m.timestamp).getTime() > readAt
                ).length;
            },

            /**
             * Total unread across every thread, for the toolbar badge.
             * @returns {number}
             */
            getTotalUnread() {
                return this.getContacts().reduce((sum, c) => sum + this.getUnreadCount(c.id), 0);
            },

            /**
             * Marks a thread as read up to now.
             * @param {string} charId
             * @private
             */
            _markRead(charId) {
                const state = ReactiveStore.state;
                if (!state) return;
                if (!state.dmLastRead) state.dmLastRead = {};
                state.dmLastRead[charId] = new Date().toISOString();
            },

            /**
             * Refreshes the unread pill on the toolbar button.
             */
            updateInboxBadge() {
                const badge = document.getElementById('dm-inbox-badge');
                const btn = document.getElementById('dm-inbox-btn');
                if (!badge || !btn) return;

                const state = ReactiveStore.state;
                const enabled = state && state.enableTextMode !== false && this.getContacts().length > 0;
                btn.classList.toggle('hidden', !enabled);

                const total = enabled ? this.getTotalUnread() : 0;
                badge.textContent = total > 99 ? '99+' : String(total);
                badge.classList.toggle('hidden', total === 0);
            },

            /**
             * Opens the inbox. With exactly one contact there is no choice to make,
             * so it goes straight to that thread.
             */
            openInbox() {
                const state = ReactiveStore.state;
                if (!state || state.enableTextMode === false) return;

                const contacts = this.getContacts();
                if (contacts.length === 0) return;
                if (contacts.length === 1) {
                    this.open(contacts[0].id);
                    return;
                }

                this.close();
                const panel = document.getElementById('dm-inbox');
                if (panel) panel.classList.remove('hidden');
                document.body.dataset.dmInbox = 'true';
                this.renderInbox();
            },

            /**
             * Closes the inbox panel.
             */
            closeInbox() {
                const panel = document.getElementById('dm-inbox');
                if (panel) panel.classList.add('hidden');
                delete document.body.dataset.dmInbox;
            },

            /**
             * Renders the contact list: threads with history first, newest activity at the top,
             * then characters never texted.
             */
            renderInbox() {
                const container = document.getElementById('dm-inbox-list');
                if (!container) return;

                const rows = this.getContacts().map(c => {
                    const thread = this.getThread(c.id);
                    const last = thread.length ? thread[thread.length - 1] : null;
                    return {
                        char: c,
                        thread: thread,
                        last: last,
                        unread: this.getUnreadCount(c.id),
                        stamp: last && last.timestamp ? new Date(last.timestamp).getTime() : 0
                    };
                });

                const started = rows.filter(r => r.thread.length > 0).sort((a, b) => b.stamp - a.stamp);
                const fresh = rows.filter(r => r.thread.length === 0);

                let html = '';
                const rowHtml = (r) => {
                    const speaker = r.last ? ReactiveStore.getCharacter(r.last.character_id) : null;
                    const prefix = speaker && speaker.is_user ? 'You: ' : '';
                    const preview = r.last ? prefix + (r.last.content || '') : 'No messages yet';
                    const time = r.stamp ? this._formatInboxTime(new Date(r.stamp)) : '';
                    const src = UIManager.getPortraitSrc(r.char, 'neutral');
                    const avatarStyle = src ? `background-image: url('${src}')` : '';

                    return DOM.html`
                        <button class="dm-inbox-row ${r.unread > 0 ? 'is-unread' : ''}" data-action="open-dm-thread" data-id="${r.char.id}">
                            <div class="dm-inbox-avatar" style="${DOM.unsafe(avatarStyle)}"></div>
                            <div class="min-w-0 flex-grow">
                                <div class="flex items-center gap-2">
                                    <span class="dm-inbox-name truncate">${r.char.name || 'Unknown'}</span>
                                    ${r.thread.length === 0 ? DOM.unsafe('<span class="dm-new-tag">New</span>') : ''}
                                </div>
                                <div class="dm-inbox-preview">${preview}</div>
                            </div>
                            <div class="flex items-center gap-2 flex-shrink-0">
                                <span class="dm-inbox-time">${time}</span>
                                ${r.unread > 0 ? DOM.unsafe(`<span class="dm-unread-pill">${r.unread > 99 ? '99+' : r.unread}</span>`) : ''}
                            </div>
                        </button>`.toString();
                };

                started.forEach(r => { html += rowHtml(r); });
                if (fresh.length > 0) {
                    if (started.length > 0) html += `<div class="dm-inbox-section">Not yet messaged</div>`;
                    fresh.forEach(r => { html += rowHtml(r); });
                }

                container.innerHTML = html;
            },

            /**
             * Compact relative time for an inbox row.
             * @param {Date} date
             * @returns {string}
             * @private
             */
            _formatInboxTime(date) {
                const now = new Date();
                if (date.toDateString() === now.toDateString()) {
                    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                }
                const yesterday = new Date(now);
                yesterday.setDate(now.getDate() - 1);
                if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
                return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
            },

            /**
             * Opens the text thread for a character.
             * @param {string} charId
             */
            open(charId) {
                const state = ReactiveStore.state;
                if (!state) return;
                if (state.enableTextMode === false) return;

                const char = ReactiveStore.getCharacter(charId);
                if (!char || char.is_user) return;

                this.RUNTIME.activeCharId = charId;
                document.body.dataset.dmMode = 'true';
                this.closeInbox();
                this._markRead(charId);
                this.updateInboxBadge();

                const nameEl = document.getElementById('dm-bar-name');
                const avatarEl = document.getElementById('dm-bar-avatar');
                if (nameEl) nameEl.textContent = char.name || 'Unknown';
                if (avatarEl) {
                    const src = UIManager.getPortraitSrc(char, 'neutral');
                    if (src) UTILITY.safeBackgroundSet(avatarEl, src);
                    else avatarEl.style.backgroundImage = '';
                }

                this._setInputPlaceholder(('Message ' + (char.name || '')).trim());
                UIManager.renderChat();
            },

            /**
             * Closes the thread and returns to the main narrative.
             */
            close() {
                const wasActive = this.RUNTIME.activeCharId;
                if (wasActive) this._markRead(wasActive);

                this.RUNTIME.activeCharId = null;
                delete document.body.dataset.dmMode;
                this._setInputPlaceholder(null);
                this.hideOptions();
                this.updateInboxBadge();
                UIManager.renderChat();
            },

            /**
             * Shows or hides the thread options menu, syncing the toggles from state first.
             */
            toggleOptions() {
                const menu = document.getElementById('dm-options-menu');
                if (!menu) return;

                if (!menu.classList.contains('hidden')) {
                    this.hideOptions();
                    return;
                }

                const state = ReactiveStore.state || {};
                const emoji = document.getElementById('dm-opt-emoji');
                const stamp = document.getElementById('dm-opt-timestamp');
                const typing = document.getElementById('dm-opt-typing');
                if (emoji) emoji.checked = state.dmAllowEmoji === true;
                if (stamp) stamp.checked = state.dmTimestampAwareness !== false;
                if (typing) typing.checked = state.dmTypingIndicator !== false;
                const unprompted = document.getElementById('dm-opt-unprompted');
                if (unprompted) unprompted.checked = state.dmUnpromptedTexts !== false;

                menu.classList.remove('hidden');
            },

            /**
             * Hides the thread options menu.
             */
            hideOptions() {
                const menu = document.getElementById('dm-options-menu');
                if (menu) menu.classList.add('hidden');
            },

            /**
             * Swaps the main chat input placeholder while a thread is open.
             * @param {string|null} text - Placeholder text, or null to restore the default.
             * @private
             */
            _setInputPlaceholder(text) {
                const input = document.getElementById('chat-input');
                if (!input) return;
                if (text) {
                    if (this._originalPlaceholder === undefined) this._originalPlaceholder = input.placeholder;
                    input.placeholder = text;
                } else if (this._originalPlaceholder !== undefined) {
                    input.placeholder = this._originalPlaceholder;
                }
            },

            /**
             * Inserts "Today 4:12 PM" style dividers between messages separated by a real gap.
             * Called by renderChat once the bubbles are in the DOM.
             */
            decorateThread() {
                if (!this.isActive()) return;
                const state = ReactiveStore.state;
                if (!state || state.dmTimestampAwareness === false) return;

                const chatWindow = document.getElementById('chat-window');
                if (!chatWindow) return;

                let lastStamp = null;
                Array.from(chatWindow.querySelectorAll('.chat-bubble-container[data-message-index]')).forEach(el => {
                    const idx = parseInt(el.dataset.messageIndex, 10);
                    const msg = state.chat_history[idx];
                    if (!msg || !msg.timestamp) return;

                    const stamp = new Date(msg.timestamp);
                    if (!lastStamp || (stamp - lastStamp) > 3600000) {
                        const divider = document.createElement('div');
                        divider.className = 'dm-time-divider';
                        divider.textContent = this._formatDivider(stamp);
                        el.parentNode.insertBefore(divider, el);
                    }
                    lastStamp = stamp;
                });
            },

            /**
             * Formats a timestamp for a thread divider (e.g. "Today 4:12 PM").
             * @param {Date} date
             * @returns {string}
             * @private
             */
            _formatDivider(date) {
                const now = new Date();
                const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                if (date.toDateString() === now.toDateString()) return 'Today ' + time;

                const yesterday = new Date(now);
                yesterday.setDate(now.getDate() - 1);
                if (date.toDateString() === yesterday.toDateString()) return 'Yesterday ' + time;

                return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
            },

            /**
             * Appends a private message to the shared history.
             * @param {string} speakerId - Character sending the message.
             * @param {string} charId - The thread owner (the character being texted).
             * @param {string} content
             * @returns {Object} The created message.
             * @private
             */
            _addDM(speakerId, charId, content) {
                const msg = {
                    id: UTILITY.uuid(),
                    character_id: speakerId,
                    content: content,
                    type: 'dm',
                    emotion: 'neutral',
                    exclusive_to_char_id: charId,
                    timestamp: new Date().toISOString(),
                    isNew: true,
                    images: []
                };
                ReactiveStore.state.chat_history.push(msg);

                // Anything arriving in the thread you are currently reading is already read.
                // Without this the character's own reply raises an unread badge mid-conversation.
                if (charId === this.RUNTIME.activeCharId) this._markRead(charId);

                return msg;
            },

            /**
             * Handles a send from the main chat input while a thread is open.
             * Called by NarrativeController.sendMessage.
             * @param {string} content - The user's message text.
             */
            async sendInThread(content) {
                if (this.RUNTIME.isGenerating) return;

                const charId = this.RUNTIME.activeCharId;
                if (!charId || !content) return;

                const state = ReactiveStore.state;
                const userChar = (state.characters || []).find(c => c.is_user);
                if (!userChar) {
                    alert("No character is set as the 'User'.");
                    return;
                }

                // Capture the thread BEFORE appending so elapsed time measures the real gap.
                const priorThread = this.getThread(charId);

                this._addDM(userChar.id, charId, content);
                UIManager.renderChat();

                await this._generateReply(charId, priorThread);
            },

            /**
             * Commits private texts that characters chose to send during Director Mode's
             * deliberation. The decision is made inside the existing scratchpad call, so this
             * only delivers the result.
             * @param {Array} agentResults - [{ char, result }] from SwarmOrchestrator.runTurn.
             */
            deliverUnprompted(agentResults) {
                const state = ReactiveStore.state;
                if (!state || state.enableTextMode === false || state.dmUnpromptedTexts === false) return;
                if (!Array.isArray(agentResults)) return;

                let delivered = 0;
                agentResults.forEach(entry => {
                    const char = entry && entry.char;
                    const text = entry && entry.result && entry.result.text_message;
                    if (!char || !text || char.is_user) return;

                    this._addDM(char.id, char.id, this._sanitize(text, char));
                    delivered++;
                });

                if (delivered > 0) {
                    this.updateInboxBadge();
                    if (this.isActive()) UIManager.renderChat();
                    if (typeof ReactiveStore.forceSave === 'function') ReactiveStore.forceSave();
                }
            },

            /**
             * Generates another text from the character without the player saying anything.
             * This is what the send button does in a thread when the input is empty, mirroring
             * the main chat's "empty input passes the turn" behaviour.
             */
            async generateFollowUp() {
                const charId = this.RUNTIME.activeCharId;
                if (!charId || this.RUNTIME.isGenerating) return;
                await this._generateReply(charId, this.getThread(charId));
            },

            /**
             * Drops the character's most recent text in this thread and generates a new one.
             * Does nothing if the last message in the thread is the player's.
             */
            async regenerateLast() {
                const charId = this.RUNTIME.activeCharId;
                if (!charId || this.RUNTIME.isGenerating) return;

                const state = ReactiveStore.state;
                for (let i = state.chat_history.length - 1; i >= 0; i--) {
                    const m = state.chat_history[i];
                    if (!m || m.type !== 'dm' || m.exclusive_to_char_id !== charId) continue;
                    // Only the trailing message matters; if it is the player's there is
                    // nothing of the character's to redo.
                    if (m.character_id === charId) state.chat_history.splice(i, 1);
                    break;
                }

                UIManager.renderChat();
                await this._generateReply(charId, this.getThread(charId));
            },

            /**
             * Shared generation path for the thread.
             * @param {string} charId - The character replying.
             * @param {Array} priorThread - Thread state used for elapsed-time awareness.
             * @private
             */
            async _generateReply(charId, priorThread = []) {
                if (this.RUNTIME.isGenerating) return;

                const state = ReactiveStore.state;
                this.RUNTIME.isGenerating = true;
                if (state.dmTypingIndicator !== false) {
                    UIManager.showTypingIndicator(charId, 'is typing...');
                }

                try {
                    const instruction = PromptBuilder.buildDirectMessageInstruction(charId, priorThread);
                    // No history override: the character legitimately sees the main narrative plus
                    // their own private thread. The privacy filter excludes everyone else's threads.
                    const prompt = PromptBuilder.buildPrompt(charId, false, null, instruction, true);
                    const raw = await APIService.callAI(prompt, false);

                    if (raw && raw.trim()) {
                        this._addDM(charId, charId, this._sanitize(raw.trim()));
                    } else {
                        this._addDM(charId, charId, '(no reply)');
                    }
                } catch (err) {
                    console.error('TextMode generation failed:', err);
                    this._addDM(charId, charId, '(failed to send - ' + ((err && err.message) ? err.message : 'unknown error') + ')');
                } finally {
                    this.RUNTIME.isGenerating = false;
                    UIManager.hideTypingIndicator();
                    UIManager.renderChat();
                    if (typeof ReactiveStore.forceSave === 'function') ReactiveStore.forceSave();
                }
            },

            /**
             * Strips roleplay artifacts the model may emit despite the texting instruction.
             * @param {string} text
             * @returns {string}
             * @private
             */
            _sanitize(text, charOverride = null) {
                const state = ReactiveStore.state;
                let out = text;

                // Drop a leading "Name:" speaker tag and any "[via text]" history marker.
                // charOverride covers unprompted texts, whose sender is not the open thread.
                const char = charOverride || ReactiveStore.getCharacter(this.RUNTIME.activeCharId);
                if (char && char.name) {
                    const safeName = char.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    out = out.replace(new RegExp('^\\s*' + safeName + '\\s*:\\s*', 'i'), '');
                }
                out = out.replace(/^\s*\[via text\]\s*/i, '');

                // Remove *action* and _action_ segments that leaked through.
                out = out.replace(/\*[^*\n]+\*/g, '');
                out = out.replace(/^\s*_[^_\n]+_\s*$/gm, '');

                // Strip emoji when the toggle is off.
                if (!state || !state.dmAllowEmoji) {
                    out = out.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu, '');
                }

                return out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
            }
        };
