        /**
         * =================================================================================================
         * [SEC:JS:CTRL:WS]
         * WorkshopController
         * The Character Workshop: the full-screen place to build a character section by section
         * (#character-workshop, styled by css/workshop.css), and its block in Settings → Model.
         * =================================================================================================
         */
        const WorkshopController = {
            RUNTIME: {
                testAbort: null,
                // The Workshop on screen: { charId, ws, tab, editing, addingPin, editorWasOpen, pushed }.
                view: null
            },

            /** A character made with "New character" waits here across the page reload that opens its story. */
            PENDING_KEY: 'rolecraft-workshop-open',

            /** Fills in the Workshop block. Runs every time the settings fields are filled from storage. */
            renderSettings() {
                this.updateSettingsVisibility();
            },

            /**
             * Local servers need an address. OpenRouter needs a key, and only it takes the thinking
             * level and the model browser.
             */
            updateSettingsVisibility() {
                const select = document.getElementById('workshop-backend');
                if (!select) return;
                // A select whose setting was never chosen is filled with nothing and shows blank. Show the
                // default the Workshop actually uses instead. Done here as well, so a row that was hidden
                // while it happened is right again the moment it shows.
                if (!select.value) select.value = WorkshopAI.DEFAULTS.backend;
                const reasoning = document.getElementById('workshop-reasoning');
                if (reasoning && !reasoning.value) reasoning.value = WorkshopAI.DEFAULTS.reasoning;
                const backend = WorkshopAI.BACKENDS[select.value] ? select.value : WorkshopAI.DEFAULTS.backend;
                const isLocal = backend !== 'openrouter';
                const show = (id, visible) => {
                    const el = document.getElementById(id);
                    if (el) el.classList.toggle('hidden', !visible);
                };
                show('workshop-local-settings', isLocal);
                show('workshop-openrouter-settings', !isLocal);
                show('workshop-reasoning-row', !isLocal);
                show('workshop-browse-btn', !isLocal);

                const url = document.getElementById('workshop-url');
                if (url) url.placeholder = WorkshopAI.BACKENDS[backend].url;
                const model = document.getElementById('workshop-model');
                if (model) {
                    model.placeholder = {
                        openrouter: WorkshopAI.DEFAULTS.model,
                        koboldcpp: 'Uses whatever model is loaded',
                        lmstudio: 'Usually the loaded model',
                        ollama: 'The model name, e.g. llama3.1:8b'
                    }[backend];
                }
                this.renderSetups();
            },

            setups() {
                const list = StateManager.data.globalSettings.workshopSetups;
                return Array.isArray(list) ? list : [];
            },

            /** What the backend, address and model fields hold right now. */
            _fields() {
                const value = id => {
                    const el = document.getElementById(id);
                    return el ? String(el.value || '').trim() : '';
                };
                return { backend: value('workshop-backend') || WorkshopAI.DEFAULTS.backend, url: value('workshop-url'), model: value('workshop-model') };
            },

            saveSetup() {
                const nameField = document.getElementById('workshop-setup-name');
                const name = nameField.value.trim();
                if (!name) {
                    UIManager.showNotification('Give the setup a name first.', 'info');
                    nameField.focus();
                    return;
                }
                const list = this.setups();
                const existing = list.find(s => s.name.toLowerCase() === name.toLowerCase());
                if (existing && !confirm(`Replace the saved setup "${existing.name}"?`)) return;
                StateManager.data.globalSettings.workshopSetups = [...list.filter(s => s !== existing), { name, ...this._fields() }];
                StateManager.saveGlobalSettings();
                nameField.value = '';
                this.renderSetups();
                UIManager.showNotification(existing ? `Replaced "${name}".` : `Saved "${name}".`, 'success');
            },

            /** One tap: the backend, address and model switch to the saved ones. Keys stay as they are. */
            useSetup(name) {
                const setup = this.setups().find(s => s.name === name);
                if (!setup) return;
                const gs = StateManager.data.globalSettings;
                gs.workshopBackend = setup.backend;
                gs.workshopUrl = setup.url || '';
                gs.workshopModel = setup.model || '';
                StateManager.saveGlobalSettings();
                const put = (id, value) => {
                    const el = document.getElementById(id);
                    if (el) el.value = value;
                };
                put('workshop-backend', gs.workshopBackend);
                put('workshop-url', gs.workshopUrl);
                put('workshop-model', gs.workshopModel);
                this.updateSettingsVisibility();
                UIManager.showNotification(`The Workshop now uses "${setup.name}".`, 'success');
            },

            removeSetup(name) {
                if (!confirm(`Remove the saved setup "${name}"?`)) return;
                StateManager.data.globalSettings.workshopSetups = this.setups().filter(s => s.name !== name);
                StateManager.saveGlobalSettings();
                this.renderSetups();
            },

            /** The saved setups as chips. The one matching the fields is outlined, so it reads as in use. */
            renderSetups() {
                const container = document.getElementById('workshop-setups');
                if (!container) return;
                const list = this.setups();
                if (list.length === 0) {
                    container.innerHTML = '<span class="text-xs text-gray-500 italic">No saved setups yet.</span>';
                    return;
                }
                const now = this._fields();
                container.innerHTML = list.map(s => {
                    const inUse = s.backend === now.backend && (s.url || '') === now.url && (s.model || '') === now.model;
                    const detail = `${(WorkshopAI.BACKENDS[s.backend] || {}).name || s.backend}${s.url ? ` at ${s.url}` : ''}, ${s.model || 'default model'}`;
                    return DOM.html`
            <div class="inline-flex items-center bg-black/30 border ${inUse ? 'border-indigo-400' : 'border-gray-600'} rounded-lg overflow-hidden" title="${detail}">
                <button type="button" data-action="workshop-use-setup" data-name="${s.name}" class="px-3 py-2 text-xs ${inUse ? 'text-white' : 'text-gray-300'} hover:text-white hover:bg-white/10 transition-colors truncate max-w-[200px]">${s.name}</button>
                <button type="button" data-action="workshop-remove-setup" data-name="${s.name}" class="px-2 py-2 text-xs text-gray-500 hover:text-red-400 hover:bg-black/20 border-l border-gray-600 transition-colors" title="Remove" aria-label="Remove ${s.name}">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>`;
                }).join('');
            },

            /** Sends one short message with the current settings and shows the reply as it streams in. Tapped again, it stops. */
            async testConnection() {
                if (this.RUNTIME.testAbort) {
                    this.RUNTIME.testAbort.abort();
                    return;
                }
                const button = document.getElementById('workshop-test-btn');
                const status = document.getElementById('workshop-test-status');
                const output = document.getElementById('workshop-test-output');
                const cfg = WorkshopAI.settings();
                const controller = new AbortController();
                this.RUNTIME.testAbort = controller;
                button.textContent = 'Stop';
                output.textContent = '';
                output.classList.add('hidden');
                status.className = 'text-xs text-yellow-400';
                status.textContent = `Asking ${cfg.model || 'the loaded model'}...`;
                const started = Date.now();
                try {
                    const reply = await WorkshopAI.chat({
                        messages: [
                            { role: 'system', content: 'You are checking that a connection works. Answer in one short, friendly sentence.' },
                            { role: 'user', content: 'Say hello.' }
                        ],
                        signal: controller.signal,
                        onDelta: ({ text, thinking }) => {
                            if (text) {
                                output.classList.remove('hidden');
                                output.textContent = text;
                                status.textContent = 'Writing...';
                            } else {
                                status.textContent = `Thinking... ${thinking.length} characters so far`;
                            }
                        }
                    });
                    output.classList.remove('hidden');
                    output.textContent = reply.text;
                    const seconds = ((Date.now() - started) / 1000).toFixed(1);
                    status.className = 'text-xs text-green-400';
                    status.textContent = `Connected${reply.provider ? ` through ${reply.provider}` : ''} in ${seconds} s${reply.thinking ? `, after ${reply.thinking.length} characters of thinking` : ''}.`;
                } catch (err) {
                    status.className = 'text-xs text-red-400';
                    status.textContent = (err && err.name === 'AbortError') ? 'Stopped.' : ((err && err.message) || 'The test failed.');
                } finally {
                    this.RUNTIME.testAbort = null;
                    button.textContent = 'Test connection';
                }
            },

            /** One of the open story's characters. Location characters live in the map and stay out of the Workshop. */
            _character(charId) {
                const state = ReactiveStore.state;
                return (state && Array.isArray(state.characters)) ? (state.characters.find(c => c.id === charId) || null) : null;
            },

            /** A character's Workshop as a plain copy that is safe to change, or null when it has none. */
            workshopOf(charId) {
                const character = this._character(charId);
                return (character && character.workshop) ? JSON.parse(JSON.stringify(character.workshop)) : null;
            },

            /**
             * Puts an accepted change on the character and saves the story at once: the Workshop
             * itself, and the description every reply reads, compiled from the active variant.
             * @returns {Promise<{evolvedPersona: boolean}>} Whether the open chat has an evolved persona
             *          for this character. That replaces the description in that chat, so the change
             *          does not show there until it is reset.
             */
            async applyWorkshop(charId, workshop) {
                const character = this._character(charId);
                if (!character) throw new Error('That character is not in the open story.');
                // A plain copy: the story's state is a Proxy, and a Proxy cannot be stored.
                const plain = JSON.parse(JSON.stringify(workshop));
                character.workshop = plain;
                character.description = WorkshopStore.compile(WorkshopStore.active(plain).state);
                await this._saveNow();
                const evolved = ReactiveStore.state.evolved_characters;
                return { evolvedPersona: !!(evolved && evolved[charId]) };
            },

            /**
             * Saves the story now. forceSave returns at once while another save is running, and that
             * save may have copied the story before this change, so wait for it, then save.
             */
            async _saveNow() {
                for (let waited = 0; ReactiveStore._isSaving && waited < 10000; waited += 100) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                await ReactiveStore.forceSave();
            },

            // ---------------------------------------------------------------------------------------
            // The Workshop screen
            // ---------------------------------------------------------------------------------------

            /** Whether a character can open in the Workshop: one of the story's characters, not you or the narrator. */
            canOpen(charId) {
                const character = this._character(charId);
                return !!(character && !character.is_user && !character.is_narrator);
            },

            /**
             * A Workshop for a character that has none yet, made from its card without any AI. Text
             * under headings the Workshop knows goes to those sections; the rest stays unsorted, so
             * the description keeps every word. Nothing is saved until the first change.
             */
            _fromCard(character) {
                const description = String(character.description || '');
                const state = WorkshopStore.blankState();
                const split = WorkshopStore.splitCard(description);
                state.unsorted = split.unsorted;
                state.sections.forEach(s => { if (split.sections[s.id]) s.text = split.sections[s.id]; });
                return WorkshopStore.create({
                    state,
                    original: { description, scenario: '' },
                    origin: description.trim() ? 'card' : 'you',
                    summary: description.trim() ? 'Taken from the card' : 'Started'
                });
            },

            open(charId) {
                if (!this.canOpen(charId)) {
                    UIManager.showNotification('The Workshop is for the story\'s characters, not for you, the narrator or places.', 'info');
                    return;
                }
                if (this.RUNTIME.view) this.close();
                const editor = document.getElementById('character-detail-modal');
                this.RUNTIME.view = {
                    charId,
                    ws: this.workshopOf(charId) || this._fromCard(this._character(charId)),
                    tab: 'sections',
                    editing: null,
                    addingPin: null,
                    editorWasOpen: !!(editor && editor.style.display === 'flex'),
                    pushed: false
                };
                // Shown before drawing, because a hidden text box measures zero and cannot size itself to its text.
                document.getElementById('character-workshop').classList.remove('hidden');
                this.render();
                // Android's back button closes the Workshop instead of leaving the app.
                history.pushState({ workshop: charId }, '');
                this.RUNTIME.view.pushed = true;
            },

            /** Closes the Workshop, saving a field still being typed in. Android's back button lands here too. */
            close({ fromBack = false } = {}) {
                const view = this.RUNTIME.view;
                if (!view) return;
                const root = document.getElementById('character-workshop');
                if (document.activeElement && root.contains(document.activeElement)) document.activeElement.blur();
                this.RUNTIME.view = null;
                root.classList.add('hidden');
                if (view.pushed && !fromBack) history.back();
                // Reopened, not just shown, so the character editor shows the new description.
                if (view.editorWasOpen) UIManager.openCharacterDetailModal(view.charId);
            },

            /** Opens the character that "New character" made, once its story has loaded. */
            openPending() {
                let charId = null;
                try {
                    charId = sessionStorage.getItem(this.PENDING_KEY);
                    sessionStorage.removeItem(this.PENDING_KEY);
                } catch (e) {
                    return;
                }
                if (!charId || !this.canOpen(charId)) return;
                this.open(charId);
                const concept = document.getElementById('ws-concept');
                if (concept) concept.focus();
            },

            /**
             * "New character" in the library: a story with you and one blank character, opened in the
             * Workshop at the concept. Opening a story reloads the page, so the character waits in
             * session storage until it has.
             */
            async newCharacter() {
                UIManager.showLoadingSpinner('Making a new character...');
                try {
                    const story = await StoryService.createNewStory();
                    const character = {
                        id: UTILITY.uuid(), name: 'New character', description: '', short_description: '', model_instructions: '',
                        is_user: false, is_active: true, image_url: '', extra_portraits: [], tags: []
                    };
                    story.name = 'New character';
                    story.search_index = 'new character';
                    story.characters = [...story.characters.filter(c => c.is_user), character];
                    story.dynamic_entries = [];
                    await DBService.saveStory(story);

                    const library = StateManager.getLibrary();
                    library.stories.push(story);
                    StateManager.saveLibrary();
                    sessionStorage.setItem(this.PENDING_KEY, character.id);
                    await LibraryController.createNarrativeFromScenario(story.id, story.scenarios[0].id);
                } catch (err) {
                    UIManager.hideLoadingSpinner();
                    console.error('Workshop: could not make a new character.', err);
                    UIManager.showNotification(`Could not make a new character: ${err.message}`, 'error');
                }
            },

            /** Renames the character, and its story too when the story was named after it. */
            rename(value) {
                const view = this.RUNTIME.view;
                const character = view && this._character(view.charId);
                const name = String(value || '').trim();
                if (!character || !name || name === character.name) return;
                const library = StateManager.getLibrary();
                const story = library.stories.find(s => s.id === library.active_story_id);
                if (story && (story.name === character.name || story.name === 'New character')) {
                    LibraryController.updateStoryField(story.id, 'name', name);
                }
                character.name = name;
            },

            render() {
                const view = this.RUNTIME.view;
                const character = this._character(view.charId);
                document.getElementById('ws-name').value = character ? character.name : '';
                document.getElementById('ws-variant').textContent = WorkshopStore.active(view.ws).name;
                this.renderNotice();
                this.renderTabs();
                this.renderSections();
                this.renderCard();
            },

            /** On the phone the sections and the card are tabs; on a wide screen they sit side by side. */
            renderTabs() {
                const tab = this.RUNTIME.view.tab;
                document.querySelectorAll('#character-workshop [data-action="workshop-tab"]').forEach(btn => {
                    const on = btn.dataset.tab === tab;
                    btn.classList.toggle('is-active', on);
                    btn.setAttribute('aria-selected', on ? 'true' : 'false');
                });
                document.querySelectorAll('#character-workshop .ws-pane').forEach(pane => pane.classList.toggle('is-active', pane.dataset.pane === tab));
                // A pane that was hidden measured its text boxes at zero.
                this._growAll(document.querySelector(`#character-workshop .ws-pane[data-pane="${tab}"]`));
            },

            /** A chat where this character grew its own persona shows that instead of the description. */
            renderNotice() {
                const view = this.RUNTIME.view;
                const evolved = ReactiveStore.state && ReactiveStore.state.evolved_characters;
                const box = document.getElementById('ws-notice');
                box.innerHTML = (evolved && evolved[view.charId]) ? DOM.html`
                    <div class="ws-notice">
                        <span>In the open chat this character has grown its own persona, which replaces the description. Workshop changes won't show in that chat until you reset it.</span>
                        <button type="button" class="ws-btn" data-action="workshop-reset-persona">Reset it</button>
                    </div>`.toString() : '';
            },

            async resetPersona() {
                const view = this.RUNTIME.view;
                if (!view) return;
                const ok = await UIManager.showConfirmationPromise('This permanently resets the persona this chat grew for the character, back to the description.');
                if (!ok) return;
                NarrativeController.resetEvolvedPersona(view.charId);
                this.renderNotice();
            },

            renderSections() {
                const state = WorkshopStore.active(this.RUNTIME.view.ws).state;
                document.getElementById('ws-sections').innerHTML = [
                    this._conceptCard(state),
                    String(state.unsorted || '').trim() ? this._unsortedCard(state) : '',
                    ...state.sections.map(s => this._sectionCard(s)),
                    this._notesCard(state)
                ].join('');
                this._growAll(document.getElementById('ws-sections'));
            },

            /** Redraws one section card, leaving the others, and any field being typed in, alone. */
            renderSection(id) {
                const card = document.getElementById(`ws-sec-${id}`);
                const section = this._section(WorkshopStore.active(this.RUNTIME.view.ws).state, id);
                if (!card || !section) return;
                card.outerHTML = this._sectionCard(section);
                const fresh = document.getElementById(`ws-sec-${id}`);
                this._growAll(fresh);
                const focus = fresh.querySelector('.ws-section-text, .ws-pin-input');
                if (focus) {
                    focus.focus();
                    if (focus.setSelectionRange) focus.setSelectionRange(focus.value.length, focus.value.length);
                }
            },

            /** The card as replies and an export will see it. */
            renderCard() {
                const state = WorkshopStore.active(this.RUNTIME.view.ws).state;
                const description = WorkshopStore.compile(state);
                const scenario = String((this._section(state, 'scenario') || {}).text || '').trim();
                document.getElementById('ws-card').innerHTML = DOM.html`
                    <div class="ws-card">
                        <h3 class="ws-label">Description</h3>
                        <p class="ws-hint">What every reply reads, built from the sections.</p>
                        <div class="ws-preview">${description || 'Nothing yet. Write a section and it shows up here.'}</div>
                    </div>
                    <div class="ws-card">
                        <h3 class="ws-label">Scenario</h3>
                        <p class="ws-hint">Goes into the card's scenario field when you export it. Replies don't read it.</p>
                        <div class="ws-preview">${scenario || 'Empty.'}</div>
                    </div>`.toString();
            },

            _section(state, id) {
                return state.sections.find(s => s.id === id);
            },

            _conceptCard(state) {
                return DOM.html`
                    <article class="ws-card ws-concept">
                        <label class="ws-label" for="ws-concept">Concept</label>
                        <p class="ws-hint">The idea the whole character grows from. The Workshop's AI reads it before every change.</p>
                        <textarea id="ws-concept" class="ws-field" data-ws-field="concept" rows="2"
                            placeholder="e.g. A night-shift medic who trusts no one, until you.">${state.concept}</textarea>
                    </article>`.toString();
            },

            _unsortedCard(state) {
                return DOM.html`
                    <article class="ws-card ws-unsorted">
                        <label class="ws-label" for="ws-unsorted">From the card, not in a section yet</label>
                        <p class="ws-hint">Replies still read this exactly as written, ahead of the sections. Move lines into sections when you like.</p>
                        <textarea id="ws-unsorted" class="ws-field" data-ws-field="unsorted" rows="4">${state.unsorted}</textarea>
                    </article>`.toString();
            },

            _notesCard(state) {
                return DOM.html`
                    <article class="ws-card ws-notes">
                        <label class="ws-label" for="ws-notes">Story notes</label>
                        <p class="ws-hint">Arcs, stages, open threads. For you and the Workshop's AI; never part of the card.</p>
                        <textarea id="ws-notes" class="ws-field" data-ws-field="notes" rows="3"
                            placeholder="e.g. Starts cold. Warms up after the storm night. Never says I love you first.">${state.notes}</textarea>
                    </article>`.toString();
            },

            _sectionCard(s) {
                const view = this.RUNTIME.view;
                const check = WorkshopStore.checkPins(s);
                const missing = new Set(check.missing);
                const kept = s.pins.filter(p => p.state === 'kept').length;
                const tally = (kept && String(s.text || '').trim())
                    ? DOM.html`<span class="ws-tally${check.missing.length ? ' is-short' : ''}">${check.landed.length} of ${kept} pins in</span>` : '';
                const lengths = ['short', 'medium', 'long'].map(len => DOM.html`
                    <button type="button" class="ws-length-btn${s.length === len ? ' is-on' : ''}" data-action="workshop-length"
                        data-section="${s.id}" data-length="${len}" aria-pressed="${s.length === len ? 'true' : 'false'}" title="${len[0].toUpperCase() + len.slice(1)}">${len[0].toUpperCase()}</button>`);
                const pins = s.pins.map(p => this._pinChip(s.id, p, missing.has(p.id)));
                const adding = view.addingPin === s.id
                    ? DOM.html`<input type="text" class="ws-pin-input" data-section="${s.id}" maxlength="200" placeholder="Something it must keep" aria-label="New pin for ${s.title}">`
                    : DOM.html`<button type="button" class="ws-pin-add" data-action="workshop-pin-add" data-section="${s.id}">+ Pin</button>`;
                const body = view.editing === s.id
                    ? DOM.html`<textarea class="ws-field ws-section-text" data-ws-field="section" data-section="${s.id}" rows="5" aria-label="${s.title}">${s.text}</textarea>`
                    : this._textView(s, check.landed);
                return DOM.html`
                    <article class="ws-card ws-section${s.locked ? ' is-locked' : ''}" id="ws-sec-${s.id}" data-section="${s.id}">
                        <header class="ws-section-head">
                            <h3 class="ws-section-title">${s.title}</h3>
                            ${tally}
                            <div class="ws-length" role="group" aria-label="Length of ${s.title}">${lengths}</div>
                            <button type="button" class="ws-lock${s.locked ? ' is-on' : ''}" data-action="workshop-lock" data-section="${s.id}"
                                aria-pressed="${s.locked ? 'true' : 'false'}" title="${s.locked ? 'Locked: the AI keeps this word for word. Tap to unlock.' : 'Lock it so the AI keeps it word for word'}">
                                ${DOM.unsafe(s.locked ? this.ICONS.locked : this.ICONS.unlocked)}
                            </button>
                        </header>
                        <div class="ws-pins">${pins}${adding}</div>
                        ${body}
                    </article>`.toString();
            },

            _pinChip(sectionId, pin, missing) {
                const look = pin.state === 'suggested' ? 'is-suggested' : (missing ? 'is-missing' : 'is-kept');
                const label = pin.state === 'suggested' ? 'Suggested. Tap ✓ to keep it.' : (missing ? 'Pinned, but not in the text yet' : 'Pinned');
                const keep = pin.state === 'suggested'
                    ? DOM.html`<button type="button" class="ws-pin-btn" data-action="workshop-pin-keep" data-section="${sectionId}" data-pin="${pin.id}" aria-label="Keep this pin">✓</button>` : '';
                return DOM.html`
                    <span class="ws-pin ${look}" title="${label}">${keep}<span class="ws-pin-text">${pin.text}</span><button type="button" class="ws-pin-btn"
                        data-action="workshop-pin-remove" data-section="${sectionId}" data-pin="${pin.id}" aria-label="Remove this pin">×</button></span>`;
            },

            /** A section's text with each pin that made it in highlighted. Tapping it edits it. */
            _textView(s, landed) {
                if (!String(s.text || '').trim()) {
                    return DOM.html`<div class="ws-text is-empty" data-action="workshop-edit" data-section="${s.id}" role="button" tabindex="0">Empty. Tap to write it yourself.</div>`;
                }
                let html = '';
                let at = 0;
                for (const span of landed.slice().sort((a, b) => a.start - b.start)) {
                    if (span.start < at) continue;
                    html += this._esc(s.text.slice(at, span.start)) + `<mark class="ws-mark">${this._esc(s.text.slice(span.start, span.end))}</mark>`;
                    at = span.end;
                }
                html += this._esc(s.text.slice(at));
                return DOM.html`<div class="ws-text" data-action="workshop-edit" data-section="${s.id}" role="button" tabindex="0" aria-label="Edit ${s.title}">${DOM.unsafe(html)}</div>`;
            },

            _esc(text) {
                return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            },

            ICONS: {
                locked: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>',
                unlocked: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"></path></svg>'
            },

            /**
             * Textareas grow with their text instead of scrolling inside the page. Browsers that know
             * `field-sizing: content` (css/workshop.css) do this themselves, even when the screen turns;
             * others are sized here.
             */
            _grow(el) {
                if (this._sizesItself === undefined) {
                    this._sizesItself = typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('field-sizing', 'content');
                }
                if (this._sizesItself) return;
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight + 2}px`;
            },

            _growAll(root) {
                if (root) root.querySelectorAll('textarea.ws-field').forEach(el => this._grow(el));
            },

            /**
             * Applies one change to the variant being worked on as a "you" commit, redraws what it
             * touched and saves it. Nothing changed means no commit and no save.
             */
            async _change(summary, mutate, redraw) {
                const view = this.RUNTIME.view;
                if (!view) return;
                const next = JSON.parse(JSON.stringify(WorkshopStore.active(view.ws).state));
                mutate(next);
                const ws = WorkshopStore.commit(view.ws, next, { origin: 'you', summary });
                const changed = ws !== view.ws;
                view.ws = ws;
                if (redraw) redraw();
                if (!changed) return;
                this.renderCard();
                try {
                    await this.applyWorkshop(view.charId, ws);
                    if (this.RUNTIME.view === view) this.renderNotice();
                } catch (err) {
                    UIManager.showNotification(`The Workshop could not save that change: ${err.message}`, 'error');
                }
            },

            /** A field the Workshop types into lost focus: commit what was typed. */
            _fieldDone(el) {
                const view = this.RUNTIME.view;
                if (!view || !el || !el.dataset) return;
                const field = el.dataset.wsField;
                if (field === 'section') {
                    const id = el.dataset.section;
                    const value = el.value;
                    const title = this._section(WorkshopStore.active(view.ws).state, id).title;
                    view.editing = null;
                    this._change(`Edited ${title}`, next => { this._section(next, id).text = value; }, () => this.renderSection(id));
                } else if (field === 'concept' || field === 'notes' || field === 'unsorted') {
                    const value = el.value;
                    const what = { concept: 'the concept', notes: 'the story notes', unsorted: 'the unsorted card text' }[field];
                    this._change(`Edited ${what}`, next => { next[field] = value; });
                } else if (el.classList.contains('ws-pin-input')) {
                    this.addPin(el.dataset.section, el.value);
                }
            },

            addPin(sectionId, text) {
                const view = this.RUNTIME.view;
                const pin = String(text || '').trim();
                view.addingPin = null;
                if (!pin) {
                    this.renderSection(sectionId);
                    return;
                }
                const title = this._section(WorkshopStore.active(view.ws).state, sectionId).title;
                this._change(`Pinned "${pin}" to ${title}`, next => {
                    this._section(next, sectionId).pins.push({ id: WorkshopStore.newId('p'), text: pin, origin: 'you', state: 'kept', at: Date.now() });
                }, () => this.renderSection(sectionId));
            },

            _pinAction(ds, how) {
                const view = this.RUNTIME.view;
                if (!view) return;
                const section = this._section(WorkshopStore.active(view.ws).state, ds.section);
                const pin = section && section.pins.find(p => p.id === ds.pin);
                if (!pin) return;
                const summary = how === 'keep' ? `Kept the pin "${pin.text}"` : `Removed the pin "${pin.text}"`;
                this._change(summary, next => {
                    const s = this._section(next, ds.section);
                    if (how === 'keep') {
                        s.pins.find(p => p.id === ds.pin).state = 'kept';
                    } else {
                        s.pins = s.pins.filter(p => p.id !== ds.pin);
                        delete s.pinMap[ds.pin];
                    }
                }, () => this.renderSection(ds.section));
            },

            registerActions() {
                ActionHandler.register('open-workshop', (ds) => {
                    const menu = document.getElementById('character-context-menu');
                    if (menu) menu.classList.add('hidden');
                    this.open(ds.id);
                });
                ActionHandler.register('workshop-new-character', () => {
                    const dropdown = document.getElementById('new-story-dropdown');
                    if (dropdown) dropdown.classList.add('hidden');
                    this.newCharacter();
                });
                ActionHandler.register('workshop-close', () => this.close());
                ActionHandler.register('workshop-rename', (ds, val) => this.rename(val));
                ActionHandler.register('workshop-tab', (ds) => {
                    if (!this.RUNTIME.view) return;
                    this.RUNTIME.view.tab = ds.tab;
                    this.renderTabs();
                });
                ActionHandler.register('workshop-reset-persona', () => this.resetPersona());
                ActionHandler.register('workshop-edit', (ds) => {
                    const view = this.RUNTIME.view;
                    if (!view || view.editing === ds.section) return;
                    view.editing = ds.section;
                    this.renderSection(ds.section);
                });
                ActionHandler.register('workshop-pin-add', (ds) => {
                    if (!this.RUNTIME.view) return;
                    this.RUNTIME.view.addingPin = ds.section;
                    this.renderSection(ds.section);
                });
                ActionHandler.register('workshop-pin-keep', (ds) => this._pinAction(ds, 'keep'));
                ActionHandler.register('workshop-pin-remove', (ds) => this._pinAction(ds, 'remove'));
                ActionHandler.register('workshop-lock', (ds) => {
                    if (!this.RUNTIME.view) return;
                    const section = this._section(WorkshopStore.active(this.RUNTIME.view.ws).state, ds.section);
                    this._change(`${section.locked ? 'Unlocked' : 'Locked'} ${section.title}`,
                        next => { this._section(next, ds.section).locked = !section.locked; }, () => this.renderSection(ds.section));
                });
                ActionHandler.register('workshop-length', (ds) => {
                    if (!this.RUNTIME.view) return;
                    const section = this._section(WorkshopStore.active(this.RUNTIME.view.ws).state, ds.section);
                    this._change(`${section.title}: ${ds.length}`,
                        next => { this._section(next, ds.section).length = ds.length; }, () => this.renderSection(ds.section));
                });

                const root = document.getElementById('character-workshop');
                if (root) {
                    root.addEventListener('focusout', (e) => this._fieldDone(e.target));
                    root.addEventListener('input', (e) => { if (e.target.matches('textarea.ws-field')) this._grow(e.target); });
                    root.addEventListener('keydown', (e) => {
                        if (!e.target.classList.contains('ws-pin-input')) return;
                        if (e.key === 'Escape') e.target.value = '';
                        if (e.key === 'Enter' || e.key === 'Escape') {
                            e.preventDefault();
                            e.target.blur();
                        }
                    });
                }
                window.addEventListener('popstate', () => { if (this.RUNTIME.view) this.close({ fromBack: true }); });
                window.addEventListener('resize', debounce(() => {
                    if (this.RUNTIME.view) this._growAll(document.getElementById('character-workshop'));
                }, 150));

                ActionHandler.register('workshop-backend-change', () => this.updateSettingsVisibility());
                ActionHandler.register('workshop-fields-change', () => this.renderSetups());
                ActionHandler.register('workshop-browse-models', () => AppController.openOpenRouterModelBrowser('workshop'));
                ActionHandler.register('workshop-save-setup', () => this.saveSetup());
                ActionHandler.register('workshop-use-setup', (ds) => this.useSetup(ds.name));
                ActionHandler.register('workshop-remove-setup', (ds) => this.removeSetup(ds.name));
                ActionHandler.register('workshop-test', () => this.testConnection());
            }
        };
