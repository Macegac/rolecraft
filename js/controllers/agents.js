        /**
         * AgentController
         * Runs agents during play and draws the Agents screen.
         *
         * During play:
         *   - buildNoteLayout() is called by PromptBuilder for every character reply. It collects the
         *     note agents that fire this turn, plus the latest notes of helper agents set to feed
         *     forward, and returns where each lands (AgentSchema.layoutNotes).
         *   - runHelpersAfterReply() is called by NarrativeController once a new character reply is
         *     in. Each helper agent that fires makes its own AI request; the answer is stored in
         *     state.agent_notes against the reply it belongs to.
         *
         * On/off is per story (state.agent_switches); the agents themselves live in AgentStore.
         */
        const AgentController = {
            RUNTIME: {
                editing: null,
                editingOnHere: false,
                importReport: null,
                running: new Set(),
                panelOpen: false
            },

            NOTES_PER_AGENT: 20,

            // ─── Built-in agents ────────────────────────────────────────────────

            eventMaster() {
                return (typeof AgentStore !== 'undefined') ? AgentStore.agents.find(a => a.builtin === 'event_master') || null : null;
            },

            /**
             * Fills the library with what every install starts with: the built-in Event Master and
             * the starter agents. The Event Master's chance and default come from the old global
             * "Event Master Chance" default when one was set. Starters are added once each; the keys
             * already added are remembered in global settings, so a starter the user deleted stays
             * deleted and a starter added in a later version still arrives.
             * @returns {Promise<void>}
             */
            async ensureBuiltins() {
                if (typeof AgentStore === 'undefined' || !AgentStore.loaded) return;
                const globals = (StateManager.data && StateManager.data.globalSettings) || {};

                try {
                    if (!this.eventMaster()) {
                        const legacyDefault = parseInt(globals.default_event_master_probability, 10);
                        const agent = AgentSchema.createEventMaster(legacyDefault > 0 ? legacyDefault : 20);
                        agent.defaultOn = legacyDefault > 0;
                        await AgentStore.save(agent);
                    }

                    const seeded = new Set(Array.isArray(globals.agent_starters_seeded) ? globals.agent_starters_seeded : []);
                    const fresh = AgentStarters.list().filter(a => !seeded.has(a.source.id));
                    if (!fresh.length) return;
                    for (const agent of fresh) {
                        await AgentStore.save(agent);
                        seeded.add(agent.source.id);
                    }
                    StateManager.data.globalSettings.agent_starters_seeded = [...seeded];
                    StateManager.saveGlobalSettings();
                } catch (e) {
                    console.warn('AgentController: could not add the default agents.', e);
                }
            },

            /**
             * One-time move of a story's old Event Master settings onto the agent: its chance
             * slider becomes this story's switch, a custom Event Master prompt becomes its own
             * agent, and a twist still waiting from the old system is kept for the next reply.
             * Runs when a story loads; the story remembers it has been done.
             * @returns {Promise<void>}
             */
            async migrateStory() {
                const state = this._state();
                const em = this.eventMaster();
                if (!state || !em) return;
                const done = JSON.parse(JSON.stringify(state.agent_migrations || {}));
                if (done.event_master) return;

                const legacyDefaultText = UTILITY.getDefaultSystemPrompts().event_master_base_prompt;
                const switches = JSON.parse(JSON.stringify(state.agent_switches || {}));
                const legacyOn = AgentSchema.legacyEventMasterSwitch(state.event_master_probability);
                const customPrompt = (state.event_master_base_prompt || '').trim();

                if (legacyOn !== null && typeof switches[em.id] !== 'boolean') {
                    if (customPrompt && customPrompt !== legacyDefaultText) {
                        const copy = AgentSchema.createEventMaster(parseInt(state.event_master_probability, 10) || em.trigger.probability);
                        copy.builtin = '';
                        copy.name = `Event Master (${state.name || 'this story'})`;
                        copy.prompt = customPrompt;
                        const saved = await AgentStore.save(copy);
                        switches[saved.id] = legacyOn;
                        switches[em.id] = false;
                    } else {
                        switches[em.id] = legacyOn;
                    }
                    state.agent_switches = switches;
                }

                const pending = (state.event_master_prompt || '').trim();
                if (pending && pending !== legacyDefaultText) {
                    const notes = JSON.parse(JSON.stringify(state.agent_notes || []));
                    notes.push({ id: UTILITY.uuid(), agentId: em.id, agentName: em.name, display: 'hidden', messageId: '', content: pending, created: Date.now() });
                    state.agent_notes = notes;
                }
                if (state.event_master_prompt) state.event_master_prompt = '';

                done.event_master = true;
                state.agent_migrations = done;
            },

            isEventMasterOn() {
                const em = this.eventMaster();
                return !!(em && this.isOnHere(em));
            },

            /**
             * The "Event Master" speaker choice: plan a surprise right now, reading the user's newest
             * message, so the reply about to be written uses it. Runs even when the agent is switched
             * off for this story, because the user asked for it.
             * @returns {Promise<void>}
             */
            async forceEventMaster() {
                const em = this.eventMaster();
                const state = this._state();
                if (!em || !state) return;
                const latest = [...(state.chat_history || [])].reverse().find(m => m && m.type === 'chat' && !m.isHidden);
                if (!latest) return;
                // A surprise asked for now replaces one still waiting, so the next two replies don't both get one.
                const waiting = new Set(AgentSchema.pickFeedNotes(this.notesFor(em.id, state), { ...em.helper, feedCount: 1000 }).map(n => n.id));
                if (waiting.size) {
                    const all = JSON.parse(JSON.stringify(state.agent_notes || []));
                    all.forEach(n => { if (waiting.has(n.id)) n.usedAt = Date.now(); });
                    state.agent_notes = all;
                }
                UIManager.showLoadingSpinner('The Event Master is plotting...');
                try {
                    await this.runHelper(em, latest, true);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            // ─── Story switches ─────────────────────────────────────────────────

            _state() {
                return (typeof ReactiveStore !== 'undefined' && ReactiveStore.state) || null;
            },

            _switches() {
                const state = this._state();
                return (state && state.agent_switches) || {};
            },

            isOnHere(agent) {
                return AgentSchema.isOn(agent, this._switches());
            },

            setOnHere(id, on) {
                const state = this._state();
                if (!state) return;
                const next = JSON.parse(JSON.stringify(state.agent_switches || {}));
                next[id] = on === true;
                state.agent_switches = next;
            },

            _names(charToAct) {
                const state = StateManager.getState();
                const user = ((state && state.characters) || []).find(c => c.is_user);
                return { char: charToAct ? charToAct.name : '', user: user ? user.name : 'You' };
            },

            _chatTokens(state) {
                return (state.chat_history || [])
                    .filter(m => m && m.type === 'chat' && !m.isHidden)
                    .reduce((sum, m) => sum + AgentSchema.estimateTokens(UTILITY.stripThinking(m.content || '')), 0);
            },

            _recentTexts(state, count = 20) {
                return (state.chat_history || [])
                    .filter(m => m && m.type === 'chat' && !m.isHidden)
                    .slice(-count)
                    .map(m => UTILITY.stripThinking(m.content || ''));
            },

            // ─── Notes kept by helper agents ────────────────────────────────────

            /**
             * A helper agent's stored notes, oldest first, skipping notes whose reply was deleted.
             * @param {string} agentId
             * @param {Object} state
             * @returns {Object[]}
             */
            notesFor(agentId, state = this._state()) {
                if (!state || !Array.isArray(state.agent_notes)) return [];
                const liveIds = new Set((state.chat_history || []).filter(Boolean).map(m => m.id));
                return state.agent_notes.filter(n => n.agentId === agentId && (!n.messageId || liveIds.has(n.messageId)));
            },

            _saveNote(agent, message, content) {
                const state = this._state();
                if (!state) return;
                const all = JSON.parse(JSON.stringify(state.agent_notes || []));
                const note = {
                    id: UTILITY.uuid(),
                    agentId: agent.id,
                    agentName: agent.name,
                    display: agent.helper.display,
                    messageId: message ? message.id : '',
                    content,
                    created: Date.now()
                };
                // One note per agent per reply: a re-run replaces the earlier one.
                const others = all.filter(n => !(n.agentId === agent.id && n.messageId === note.messageId));
                others.push(note);
                const mine = others.filter(n => n.agentId === agent.id);
                const overflow = new Set(mine.slice(0, Math.max(0, mine.length - this.NOTES_PER_AGENT)).map(n => n.id));
                state.agent_notes = others.filter(n => !overflow.has(n.id));
            },

            // ─── Prompt placement ───────────────────────────────────────────────

            /**
             * Everything agents add to one character reply prompt.
             * @param {Object} charToAct - The character about to speak.
             * @param {number} messageCount - Messages that will be shown in the prompt.
             * @returns {Object|null} AgentSchema.layoutNotes result, or null when nothing applies.
             */
            buildNoteLayout(charToAct, messageCount) {
                if (typeof AgentStore === 'undefined' || !AgentStore.loaded) return null;
                const state = StateManager.getState();
                if (!state) return null;

                const names = this._names(charToAct);
                const recentTexts = this._recentTexts(state);
                const chatTokens = this._chatTokens(state);
                const notes = [];
                const usedIds = new Set();

                AgentStore.list().forEach(agent => {
                    if (!this.isOnHere(agent)) return;

                    if (agent.kind === 'note') {
                        if (!agent.prompt.trim()) return;
                        const fires = AgentSchema.shouldFire(agent, {
                            messageCounter: state.messageCounter || 0,
                            recentTexts,
                            chatTokens,
                            roll: Math.random()
                        });
                        if (!fires) return;
                        notes.push({ ...agent.placement, agentId: agent.id, text: AgentSchema.expandMacros(agent.prompt, names).trim() });
                        return;
                    }

                    if (agent.kind === 'helper' && agent.helper.feedForward) {
                        AgentSchema.pickFeedNotes(this.notesFor(agent.id, state), agent.helper).forEach(note => {
                            const header = agent.helper.feedOnce
                                ? `[${agent.name}: make this happen in your response. Show it; never mention these notes.]`
                                : `[${agent.name}]`;
                            notes.push({ ...agent.placement, agentId: agent.id, text: `${header}\n${note.content}` });
                            if (agent.helper.feedOnce) usedIds.add(note.id);
                        });
                    }
                });

                // A feed-once note is spent the moment a reply prompt carries it, rerolls included,
                // the same way the old Event Master instruction was consumed.
                if (usedIds.size) {
                    const all = JSON.parse(JSON.stringify(state.agent_notes || []));
                    all.forEach(n => { if (usedIds.has(n.id)) n.usedAt = Date.now(); });
                    ReactiveStore.state.agent_notes = all;
                }

                return notes.length ? AgentSchema.layoutNotes(notes, messageCount) : null;
            },

            // ─── Helper agents ──────────────────────────────────────────────────

            /**
             * Runs the helper agents that fire after a new character reply. Fire and forget: the
             * reply is already on screen and nothing here blocks the next turn.
             * @param {Object} message - The reply that just landed.
             */
            runHelpersAfterReply(message) {
                if (typeof AgentStore === 'undefined' || !AgentStore.loaded) return;
                const state = this._state();
                if (!state || !message || message.type !== 'chat') return;
                const speaker = ReactiveStore.getCharacter(message.character_id);
                if (!speaker || speaker.is_user) return;

                const recentTexts = this._recentTexts(state);
                const chatTokens = this._chatTokens(state);
                AgentStore.list()
                    .filter(agent => agent.kind === 'helper' && agent.helper.run === 'auto' && agent.prompt.trim() && this.isOnHere(agent))
                    .filter(agent => !(agent.helper.feedOnce && AgentSchema.pickFeedNotes(this.notesFor(agent.id, state), agent.helper).length))
                    .filter(agent => AgentSchema.shouldFire(agent, { messageCounter: state.messageCounter || 0, recentTexts, chatTokens, roll: Math.random() }))
                    .forEach(agent => { this.runHelper(agent, message); });
            },

            /**
             * The latest character reply, which manual runs target.
             * @returns {Object|null}
             */
            _latestReply() {
                const state = this._state();
                if (!state) return null;
                const history = state.chat_history || [];
                for (let i = history.length - 1; i >= 0; i--) {
                    const msg = history[i];
                    if (!msg || msg.type !== 'chat' || msg.isHidden) continue;
                    const speaker = ReactiveStore.getCharacter(msg.character_id);
                    if (speaker && !speaker.is_user) return msg;
                }
                return null;
            },

            /**
             * Builds a helper agent's request: the context it asked for first, then its
             * instructions last, where the model weighs them most.
             * @param {Object} agent
             * @param {Object} message - The reply the agent is reading up to.
             * @returns {string}
             */
            buildHelperPrompt(agent, message) {
                const state = StateManager.getState();
                const speaker = ReactiveStore.getCharacter(message.character_id);
                const names = this._names(speaker);
                const sections = [];

                if (agent.helper.includeCharacters) {
                    const cast = [...(state.characters || []), ...ReactiveStore.getActiveLocationCharacters()]
                        .filter(c => c.is_active && !c.is_narrator)
                        .map(c => {
                            const desc = (state.evolved_characters && state.evolved_characters[c.id]) || c.description || '';
                            return `### ${c.name}${c.is_user ? ' (the user)' : ''}\n${desc}`;
                        });
                    if (cast.length) sections.push('## CHARACTERS\n' + cast.join('\n\n'));
                }

                if (agent.helper.includeLore && (state.static_entries || []).length) {
                    sections.push('## WORLD KNOWLEDGE\n' + state.static_entries.map(e => `### ${e.title}\n${e.content}`).join('\n\n'));
                }

                if (agent.helper.priorNotes > 0) {
                    const prior = this.notesFor(agent.id, state)
                        .filter(n => n.messageId !== message.id)
                        .slice(-agent.helper.priorNotes);
                    if (prior.length) sections.push('## YOUR PREVIOUS NOTES (oldest first)\n' + prior.map(n => n.content).join('\n\n---\n\n'));
                }

                const history = state.chat_history || [];
                const endIndex = history.findIndex(m => m && m.id === message.id);
                const upTo = endIndex === -1 ? history : history.slice(0, endIndex + 1);
                // At least `contextMessages` messages, reaching further back until the agent's minimum
                // token size is covered too.
                const lines = upTo
                    .filter(m => m && m.type === 'chat' && !m.isHidden)
                    .map(m => {
                        const who = ReactiveStore.getCharacter(m.character_id);
                        return `${who ? who.name : 'Unknown'}: ${UTILITY.stripThinking(m.content || '')}`;
                    });
                const transcript = [];
                let tokens = 0;
                for (let i = lines.length - 1; i >= 0; i--) {
                    const enough = transcript.length >= agent.helper.contextMessages && tokens >= agent.trigger.minTokens;
                    if (enough) break;
                    transcript.unshift(lines[i]);
                    tokens += AgentSchema.estimateTokens(lines[i]);
                }
                sections.push('## RECENT CONVERSATION\n' + transcript.join('\n\n'));

                sections.push('## YOUR TASK\n' + AgentSchema.expandMacros(agent.prompt, names).trim()
                    + '\n\nThis task runs alongside a roleplay but is not part of it. Do not continue the story or write as any character. Reply only with what the task asks for.');

                return sections.join('\n\n');
            },

            /**
             * Runs one helper agent against one reply and stores the result.
             * @param {Object} agent
             * @param {Object} message
             * @param {boolean} [manual=false] - Manual runs report failures; automatic ones stay quiet.
             * @returns {Promise<boolean>} whether a note was saved
             */
            async runHelper(agent, message, manual = false) {
                if (!agent || !message) return false;
                const key = `${agent.id}:${message.id}`;
                if (this.RUNTIME.running.has(key)) return false;
                this.RUNTIME.running.add(key);
                this.refreshCards(message.id);

                try {
                    const prompt = this.buildHelperPrompt(agent, message);
                    const text = await APIService.callAI(prompt, false, null, !manual, { model: agent.brain.model });
                    const content = (text || '').trim();
                    if (AgentSchema.isEmptyResult(content)) {
                        if (manual) UIManager.showNotification(`${agent.name} had nothing to report this turn.`, 'info');
                        return false;
                    }
                    this._saveNote(agent, message, content);
                    return true;
                } catch (e) {
                    console.warn(`Agent "${agent.name}" failed:`, e);
                    if (manual && !e.reported) UIManager.showNotification(`${agent.name} failed: ${e.message || e}`, 'error');
                    return false;
                } finally {
                    this.RUNTIME.running.delete(key);
                    this.refreshCards(message.id);
                    this.refreshPanel();
                }
            },

            async runNow(agentId) {
                const agent = AgentStore.get(agentId);
                const message = this._latestReply();
                if (!agent || agent.kind !== 'helper') return;
                if (!message) {
                    UIManager.showNotification('There is no character reply to run this agent on yet.', 'error');
                    return;
                }
                const saved = await this.runHelper(agent, message, true);
                if (saved) UIManager.showNotification(`${agent.name} finished.`, 'success');
            },

            // ─── In-chat display ────────────────────────────────────────────────

            _renderMarkdown(text) {
                const safe = UTILITY.escapeHTML(text || '');
                return (typeof marked !== 'undefined') ? marked.parse(safe) : safe.replace(/\n/g, '<br>');
            },

            /**
             * Note cards under a reply. Always returns the (possibly empty) container for character
             * replies so a helper that finishes later can fill it without redrawing the chat.
             * @param {Object} msg
             * @returns {string} HTML
             */
            cardsHTML(msg) {
                if (!msg || msg.type !== 'chat' || msg.isHidden || !msg.id) return '';
                const speaker = ReactiveStore.getCharacter(msg.character_id);
                if (!speaker || speaker.is_user) return '';
                return `<div class="agent-cards" data-agent-cards-for="${msg.id}">${this._cardsInner(msg.id)}</div>`;
            },

            _cardsInner(messageId) {
                const state = this._state();
                if (!state) return '';
                const cards = (state.agent_notes || [])
                    .filter(n => n.messageId === messageId && n.display === 'card')
                    .map(n => DOM.html`<details class="agent-card"><summary class="agent-card-title">${n.agentName}</summary><div class="agent-card-body">${DOM.unsafe(this._renderMarkdown(n.content))}</div></details>`.toString());
                const running = AgentStore.list()
                    .filter(a => this.RUNTIME.running.has(`${a.id}:${messageId}`))
                    .map(a => DOM.html`<div class="agent-card agent-card-running">${a.name} is working…</div>`.toString());
                return cards.join('') + running.join('');
            },

            refreshCards(messageId) {
                const el = document.querySelector(`[data-agent-cards-for="${messageId}"]`);
                if (el) el.innerHTML = this._cardsInner(messageId);
            },

            /**
             * Latest note of each panel-display helper that is on for this story.
             * @returns {Object[]} [{agent, note}]
             */
            _panelEntries() {
                const state = this._state();
                if (!state || typeof AgentStore === 'undefined') return [];
                return AgentStore.list()
                    .filter(a => a.kind === 'helper' && a.helper.display === 'panel' && this.isOnHere(a))
                    .map(agent => ({ agent, note: this.notesFor(agent.id, state).slice(-1)[0] || null }));
            },

            refreshPanel() {
                const btn = document.getElementById('agents-notes-btn');
                const panel = document.getElementById('agents-notes-panel');
                if (!btn || !panel) return;
                const entries = this._panelEntries();
                btn.classList.toggle('hidden', entries.length === 0);
                if (!entries.length) this.RUNTIME.panelOpen = false;
                panel.classList.toggle('hidden', !this.RUNTIME.panelOpen);
                if (!this.RUNTIME.panelOpen) return;

                const latest = this._latestReply();
                panel.innerHTML = DOM.html`
                    <div class="agents-panel-head">
                        <span class="agents-panel-title">Agent notes</span>
                        <button class="agents-btn" data-action="agents-panel-toggle">Close</button>
                    </div>
                    ${entries.map(({ agent, note }) => {
                        const busy = latest && this.RUNTIME.running.has(`${agent.id}:${latest.id}`);
                        return DOM.html`
                        <section class="agents-panel-entry">
                            <div class="agents-panel-entry-head">
                                <span class="agents-panel-entry-name">${agent.name}</span>
                                <button class="agents-btn" data-action="agents-run-now" data-id="${agent.id}" ${busy ? 'disabled' : ''}>${busy ? 'Working…' : 'Run now'}</button>
                            </div>
                            <div class="agents-panel-entry-body">${note ? DOM.unsafe(this._renderMarkdown(note.content)) : DOM.html`<span class="agents-muted">No notes yet.</span>`}</div>
                        </section>`.toString();
                    })}
                `.toString();
            },

            togglePanel() {
                this.RUNTIME.panelOpen = !this.RUNTIME.panelOpen;
                this.refreshPanel();
            },

            // ─── Agents screen (Settings → Agents) ──────────────────────────────

            _root() {
                return document.getElementById('agents-settings-root');
            },

            renderSettings() {
                const root = this._root();
                if (!root) return;
                if (this.RUNTIME.editing) this._renderEditor(root);
                else this._renderList(root);
            },

            _describePlacement(agent) {
                const p = agent.placement;
                if (p.position === 'before') return 'before everything';
                if (p.position === 'top') return 'after the system prompt';
                return p.depth === 0 ? 'after the last message' : `${p.depth} message${p.depth === 1 ? '' : 's'} back`;
            },

            _describeAgent(agent) {
                const parts = [];
                if (agent.kind === 'note') parts.push(`Placed ${this._describePlacement(agent)}`);
                else parts.push(agent.helper.run === 'manual' ? 'Runs when you press Run now' : 'Runs after each reply');
                if (agent.trigger.everyMessages > 0) parts.push(`every ${agent.trigger.everyMessages} messages`);
                if (agent.trigger.keywords.length) parts.push(`when "${agent.trigger.keywords.slice(0, 3).join('", "')}" comes up`);
                if (agent.trigger.probability < 100) parts.push(`${agent.trigger.probability}% chance`);
                if (agent.trigger.minTokens > 0) parts.push(`once the chat reaches ~${agent.trigger.minTokens.toLocaleString()} tokens`);
                if (agent.brain.model) parts.push(`model ${agent.brain.model}`);
                return parts.join(' · ');
            },

            _renderList(root) {
                const state = this._state();
                const storyName = state ? (state.name || state.story_name || 'this story') : '';
                const agents = AgentStore.list();
                const report = this.RUNTIME.importReport;

                root.innerHTML = DOM.html`
                <div class="agents">
                    <div class="agents-intro">
                        <h3 class="agents-title">Agents</h3>
                        <p class="agents-sub">Saved jobs that work alongside your story. A <strong>note agent</strong> adds its instructions to every reply. A <strong>helper agent</strong> makes its own AI request after a reply and keeps notes.</p>
                        <p class="agents-sub">${state ? DOM.html`Switches apply to <strong>${storyName}</strong>. Other stories keep their own.` : 'Open a story to switch agents on or off for it.'}</p>
                    </div>
                    <div class="agents-toolbar">
                        <button class="agents-btn agents-btn-primary" data-action="agents-new">New agent</button>
                        <button class="agents-btn" data-action="agents-import">Import</button>
                        <button class="agents-btn" data-action="agents-export-all" ${agents.length ? '' : 'disabled'}>Export all</button>
                        <input type="file" id="agents-import-input" class="hidden" accept=".json,application/json" multiple data-action="agents-import-file">
                    </div>
                    ${report ? DOM.html`
                    <div class="agents-report">
                        <div class="agents-report-head">
                            <span>Imported ${report.count} agent${report.count === 1 ? '' : 's'}.</span>
                            <button class="agents-btn" data-action="agents-dismiss-report">OK</button>
                        </div>
                        ${report.notes.length ? DOM.html`<p class="agents-muted">Some parts couldn't come across:</p><ul class="agents-report-list">${report.notes.map(n => DOM.html`<li>${n}</li>`.toString())}</ul>` : ''}
                    </div>` : ''}
                    ${agents.length ? DOM.html`
                    <ul class="agents-list">
                        ${agents.map(agent => DOM.html`
                        <li class="agents-row">
                            <button class="agents-row-main" data-action="agents-edit" data-id="${agent.id}">
                                <span class="agents-row-top">
                                    <span class="agents-row-name">${agent.name}</span>
                                    <span class="agents-kind agents-kind-${agent.kind}">${agent.kind === 'note' ? 'Note' : 'Helper'}</span>
                                    ${agent.builtin ? DOM.html`<span class="agents-kind agents-kind-builtin">Built in</span>` : ''}
                                </span>
                                ${agent.description ? DOM.html`<span class="agents-row-desc">${agent.description}</span>` : ''}
                                <span class="agents-row-meta">${this._describeAgent(agent)}</span>
                            </button>
                            <label class="agents-switch" title="On for this story">
                                <input type="checkbox" data-action="agents-toggle-story" data-id="${agent.id}" ${this.isOnHere(agent) ? 'checked' : ''} ${state ? '' : 'disabled'}>
                                <span class="agents-switch-track"></span>
                            </label>
                        </li>`.toString())}
                    </ul>` : DOM.html`<p class="agents-empty">No agents yet. Make one, or import agent files, including ones exported from SillyBunny.</p>`}
                </div>`.toString();
            },

            _renderEditor(root) {
                const a = this.RUNTIME.editing;
                const isNew = !a.id;
                const state = this._state();
                const sel = (value, options) => options.map(([v, label]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${UTILITY.escapeHTML(label)}</option>`).join('');
                const skipped = a.source && a.source.skipped && a.source.skipped.length ? a.source.skipped : [];

                root.innerHTML = DOM.html`
                <div class="agents agents-editor" data-kind="${a.kind}">
                    <div class="agents-editor-head">
                        <button class="agents-btn" data-action="agents-cancel">Back</button>
                        <h3 class="agents-title">${isNew ? 'New agent' : 'Edit agent'}</h3>
                        ${a.builtin ? DOM.html`<span class="agents-kind agents-kind-builtin">Built in</span>` : ''}
                    </div>

                    ${skipped.length ? DOM.html`<div class="agents-report"><p class="agents-muted">Imported from ${a.source.app === 'sillybunny' ? 'SillyBunny' : 'another app'}. These parts didn't come across:</p><ul class="agents-report-list">${skipped.map(s => DOM.html`<li>${s}</li>`.toString())}</ul></div>` : ''}

                    <label class="agents-field"><span class="agents-label">Name</span>
                        <input type="text" id="agent-f-name" class="agents-input" value="${a.name === 'Untitled agent' && isNew ? '' : a.name}" placeholder="Friction Mode"></label>
                    <label class="agents-field"><span class="agents-label">Description</span>
                        <input type="text" id="agent-f-description" class="agents-input" value="${a.description}" placeholder="What it does, in a line"></label>

                    <label class="agents-field"><span class="agents-label">Kind</span>
                        <select id="agent-f-kind" class="agents-input" data-action="agents-kind-change">${DOM.unsafe(sel(a.kind, [['note', 'Note: adds instructions to each reply'], ['helper', 'Helper: makes its own request and keeps notes']]))}</select></label>

                    <label class="agents-field"><span class="agents-label">Instructions</span>
                        <span class="agents-hint">{{char}} and {{user}} become the character's and your names. {{random::a::b}} picks one option.</span>
                        <textarea id="agent-f-prompt" class="agents-input agents-textarea" rows="10">${a.prompt}</textarea></label>

                    <div class="agents-checks">
                        <label class="agents-check"><input type="checkbox" id="agent-f-on-here" ${this.RUNTIME.editingOnHere ? 'checked' : ''} ${state ? '' : 'disabled'}> On for this story</label>
                        <label class="agents-check"><input type="checkbox" id="agent-f-default-on" ${a.defaultOn ? 'checked' : ''}> On by default in stories that haven't set it</label>
                    </div>

                    <fieldset class="agents-group">
                        <legend class="agents-legend">When it runs</legend>
                        <label class="agents-field agents-inline"><span class="agents-label">Chance (%)</span>
                            <input type="number" id="agent-f-probability" class="agents-input agents-num" min="0" max="100" value="${String(a.trigger.probability)}"></label>
                        <label class="agents-field agents-inline"><span class="agents-label">Only every N messages</span>
                            <input type="number" id="agent-f-every" class="agents-input agents-num" min="0" value="${String(a.trigger.everyMessages)}"><span class="agents-hint">0 means every time.</span></label>
                        <label class="agents-field"><span class="agents-label">Only when these words come up</span>
                            <input type="text" id="agent-f-keywords" class="agents-input" value="${a.trigger.keywords.join(', ')}" placeholder="kiss, fight"><span class="agents-hint">Comma separated. Leave empty to ignore words.</span></label>
                        <label class="agents-field agents-inline"><span class="agents-label">Look for words in the last N messages</span>
                            <input type="number" id="agent-f-keyword-depth" class="agents-input agents-num" min="1" value="${String(a.trigger.keywordDepth)}"></label>
                        <label class="agents-field agents-inline"><span class="agents-label">Wait until the chat is about this many tokens</span>
                            <input type="number" id="agent-f-min-tokens" class="agents-input agents-num" min="0" step="1000" value="${String(a.trigger.minTokens)}"><span class="agents-hint">A token is roughly ¾ of a word. 0 means no wait. Memory-style agents use this so they only start once there's a lot to summarize.</span></label>
                    </fieldset>

                    <fieldset class="agents-group">
                        <legend class="agents-legend agents-note-only">Where the instructions go</legend>
                        <legend class="agents-legend agents-helper-only">Where fed-forward notes go</legend>
                        <label class="agents-field"><span class="agents-label">Position</span>
                            <select id="agent-f-position" class="agents-input">${DOM.unsafe(sel(a.placement.position, [['chat', 'In the conversation'], ['top', 'Right after the system prompt'], ['before', 'Before everything']]))}</select></label>
                        <label class="agents-field agents-inline"><span class="agents-label">Messages back from the newest</span>
                            <input type="number" id="agent-f-depth" class="agents-input agents-num" min="0" value="${String(a.placement.depth)}"><span class="agents-hint">Only for "In the conversation". 0 is the last thing the AI reads; higher numbers sit further back and pull less.</span></label>
                        <label class="agents-field"><span class="agents-label">Labelled as</span>
                            <select id="agent-f-role" class="agents-input">${DOM.unsafe(sel(a.placement.role, [['system', 'System note'], ['user', 'User note'], ['assistant', 'Narrator note']]))}</select></label>
                        <label class="agents-field agents-inline"><span class="agents-label">Order</span>
                            <input type="number" id="agent-f-order" class="agents-input agents-num" value="${String(a.placement.order)}"><span class="agents-hint">Lower goes first when agents share a spot.</span></label>
                    </fieldset>

                    <fieldset class="agents-group agents-helper-only">
                        <legend class="agents-legend">Helper settings</legend>
                        <label class="agents-field"><span class="agents-label">Runs</span>
                            <select id="agent-f-run" class="agents-input">${DOM.unsafe(sel(a.helper.run, [['auto', 'Automatically after replies'], ['manual', 'Only when I press Run now']]))}</select></label>
                        <label class="agents-field agents-inline"><span class="agents-label">Messages it reads</span>
                            <input type="number" id="agent-f-context" class="agents-input agents-num" min="1" value="${String(a.helper.contextMessages)}"></label>
                        <div class="agents-checks">
                            <label class="agents-check"><input type="checkbox" id="agent-f-include-chars" ${a.helper.includeCharacters ? 'checked' : ''}> Also reads the character descriptions</label>
                            <label class="agents-check"><input type="checkbox" id="agent-f-include-lore" ${a.helper.includeLore ? 'checked' : ''}> Also reads world knowledge</label>
                        </div>
                        <label class="agents-field agents-inline"><span class="agents-label">Its own previous notes it rereads</span>
                            <input type="number" id="agent-f-prior" class="agents-input agents-num" min="0" value="${String(a.helper.priorNotes)}"><span class="agents-hint">Lets a tracker update its last result instead of starting over.</span></label>
                        <label class="agents-field"><span class="agents-label">Show notes</span>
                            <select id="agent-f-display" class="agents-input">${DOM.unsafe(sel(a.helper.display, [['card', 'As a card under the reply'], ['panel', 'In the Agent notes panel'], ['hidden', "Don't show them"]]))}</select></label>
                        <label class="agents-check"><input type="checkbox" id="agent-f-feed" ${a.helper.feedForward ? 'checked' : ''}> Feed its latest notes into the next replies</label>
                        <label class="agents-field agents-inline"><span class="agents-label">How many recent notes to feed</span>
                            <input type="number" id="agent-f-feed-count" class="agents-input agents-num" min="1" value="${String(a.helper.feedCount)}"></label>
                        <label class="agents-check"><input type="checkbox" id="agent-f-feed-once" ${a.helper.feedOnce ? 'checked' : ''}> Use each note for one reply only</label>
                        <span class="agents-hint">For surprises and one-off nudges. While a note is waiting to be used, the agent doesn't run again.</span>
                        ${!isNew ? DOM.html`<button class="agents-btn" data-action="agents-run-now" data-id="${a.id}">Run now on the last reply</button>` : ''}
                    </fieldset>

                    <fieldset class="agents-group agents-helper-only">
                        <legend class="agents-legend">Model</legend>
                        <label class="agents-field"><span class="agents-label">Use a different model</span>
                            <input type="text" id="agent-f-model" class="agents-input" value="${a.brain.model}" placeholder="Leave empty to use the chat model"><span class="agents-hint">Same provider as your chat, e.g. an OpenRouter model id. Ignored by KoboldCPP.</span></label>
                    </fieldset>

                    <div class="agents-actions">
                        <button class="agents-btn agents-btn-primary" data-action="agents-save">Save</button>
                        ${!isNew ? DOM.html`<button class="agents-btn" data-action="agents-export-one" data-id="${a.id}">Export</button>` : ''}
                        ${!isNew && !a.builtin ? DOM.html`<button class="agents-btn agents-btn-danger" data-action="agents-delete" data-id="${a.id}">Delete</button>` : ''}
                    </div>
                </div>`.toString();
            },

            _readEditor() {
                const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
                const checked = id => { const el = document.getElementById(id); return !!(el && el.checked); };
                const base = this.RUNTIME.editing;
                return AgentSchema.normalize({
                    ...base,
                    name: val('agent-f-name'),
                    description: val('agent-f-description'),
                    kind: val('agent-f-kind'),
                    prompt: val('agent-f-prompt'),
                    defaultOn: checked('agent-f-default-on'),
                    trigger: {
                        probability: val('agent-f-probability'),
                        everyMessages: val('agent-f-every'),
                        keywords: val('agent-f-keywords'),
                        keywordDepth: val('agent-f-keyword-depth'),
                        minTokens: val('agent-f-min-tokens')
                    },
                    placement: {
                        position: val('agent-f-position'),
                        depth: val('agent-f-depth'),
                        role: val('agent-f-role'),
                        order: val('agent-f-order')
                    },
                    helper: {
                        run: val('agent-f-run'),
                        contextMessages: val('agent-f-context'),
                        includeCharacters: checked('agent-f-include-chars'),
                        includeLore: checked('agent-f-include-lore'),
                        priorNotes: val('agent-f-prior'),
                        display: val('agent-f-display'),
                        feedForward: checked('agent-f-feed'),
                        feedCount: val('agent-f-feed-count'),
                        feedOnce: checked('agent-f-feed-once'),
                        maxTokens: base.helper.maxTokens
                    },
                    brain: { model: val('agent-f-model') }
                });
            },

            _download(filename, text) {
                const blob = new Blob([text], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            },

            _fileSafe(name) {
                return (name || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'agent';
            },

            registerActions() {
                ActionHandler.register('agents-new', () => {
                    this.RUNTIME.editing = AgentSchema.createDefault();
                    this.RUNTIME.editingOnHere = !!this._state();
                    this.renderSettings();
                });

                ActionHandler.register('agents-edit', (ds) => {
                    const agent = AgentStore.get(ds.id);
                    if (!agent) return;
                    this.RUNTIME.editing = JSON.parse(JSON.stringify(agent));
                    this.RUNTIME.editingOnHere = this.isOnHere(agent);
                    this.renderSettings();
                });

                ActionHandler.register('agents-cancel', () => {
                    this.RUNTIME.editing = null;
                    this.renderSettings();
                });

                // Read the select itself: the click that opens it fires this too, before any change.
                ActionHandler.register('agents-kind-change', () => {
                    const editor = document.querySelector('.agents-editor');
                    const select = document.getElementById('agent-f-kind');
                    if (editor && select) editor.dataset.kind = select.value === 'helper' ? 'helper' : 'note';
                });

                ActionHandler.register('agents-save', async () => {
                    const draft = this._readEditor();
                    if (!draft.prompt.trim()) {
                        UIManager.showNotification('Give the agent some instructions first.', 'error');
                        return;
                    }
                    const onHere = !!(document.getElementById('agent-f-on-here') || {}).checked;
                    const saved = await AgentStore.save(draft);
                    if (this._state()) this.setOnHere(saved.id, onHere);
                    this.RUNTIME.editing = null;
                    UIManager.showNotification(`Saved ${saved.name}.`, 'success');
                    this.renderSettings();
                    this.refreshPanel();
                });

                ActionHandler.register('agents-delete', async (ds) => {
                    const agent = AgentStore.get(ds.id);
                    if (!agent || agent.builtin) return;
                    const ok = await UIManager.showConfirmationPromise(`Delete "${agent.name}" from the agent library? Every story loses it. Export it first if you might want it back.`);
                    if (!ok) return;
                    await AgentStore.remove(agent.id);
                    this.RUNTIME.editing = null;
                    this.renderSettings();
                    this.refreshPanel();
                });

                ActionHandler.register('agents-toggle-story', (ds, val, e) => {
                    const on = !!(e && e.target && e.target.checked);
                    this.setOnHere(ds.id, on);
                    this.refreshPanel();
                });

                ActionHandler.register('agents-import', () => {
                    const input = document.getElementById('agents-import-input');
                    if (input) input.click();
                });

                ActionHandler.register('agents-import-file', async (ds, val, e) => {
                    const files = e && e.target && e.target.files ? [...e.target.files] : [];
                    if (!files.length) return;
                    let count = 0;
                    const notes = [];
                    for (const file of files) {
                        try {
                            const result = await AgentStore.importText(await file.text());
                            count += result.imported.length;
                            notes.push(...result.notes);
                        } catch (err) {
                            notes.push(`${file.name}: ${err.message}`);
                        }
                    }
                    e.target.value = '';
                    this.RUNTIME.importReport = { count, notes };
                    this.renderSettings();
                    if (count) UIManager.showNotification(`Imported ${count} agent${count === 1 ? '' : 's'}.`, 'success');
                    else UIManager.showNotification('No agents were imported.', 'error');
                });

                ActionHandler.register('agents-dismiss-report', () => {
                    this.RUNTIME.importReport = null;
                    this.renderSettings();
                });

                ActionHandler.register('agents-export-all', () => {
                    this._download(`rolecraft_agents_${new Date().toISOString().split('T')[0]}.json`, AgentStore.exportText());
                });

                ActionHandler.register('agents-export-one', (ds) => {
                    const agent = AgentStore.get(ds.id);
                    if (!agent) return;
                    this._download(`rolecraft_agent_${this._fileSafe(agent.name)}.json`, AgentStore.exportText([agent.id]));
                });

                ActionHandler.register('agents-run-now', (ds) => { this.runNow(ds.id); });
                ActionHandler.register('agents-panel-toggle', () => this.togglePanel());
            }
        };
