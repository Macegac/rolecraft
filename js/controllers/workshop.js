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

            /** A character waits here, from "New character" or the library's Workshop button, across the page reload that opens its story. */
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
                await this._waitForSave();
                await ReactiveStore.forceSave();
            },

            async _waitForSave() {
                for (let waited = 0; ReactiveStore._isSaving && waited < 10000; waited += 100) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            },

            // ---------------------------------------------------------------------------------------
            // The story's openings. They belong to the story, not the character, so the Workshop
            // writes them into the story record itself, and only for the story's lead.
            // ---------------------------------------------------------------------------------------

            /** The open story as the Library keeps it, openings included. */
            _story() {
                if (typeof StateManager === 'undefined' || !StateManager.getLibrary) return null;
                const library = StateManager.getLibrary();
                const stories = (library && Array.isArray(library.stories)) ? library.stories : [];
                return stories.find(s => s.id === library.active_story_id) || null;
            },

            _scenarios() {
                const story = this._story();
                return (story && Array.isArray(story.scenarios)) ? story.scenarios : [];
            },

            _userId() {
                const user = ((ReactiveStore.state && ReactiveStore.state.characters) || []).find(c => c.is_user);
                return user ? user.id : null;
            },

            /** Whether this Workshop holds the story's openings: only the story's lead does. */
            _ownsOpenings(view) {
                const scenarios = this._scenarios();
                if (!view || scenarios.length === 0) return false;
                const story = this._story();
                const characters = (ReactiveStore.state && ReactiveStore.state.characters) || story.characters || [];
                return WorkshopStore.leadOf(characters, scenarios) === view.charId;
            },

            /** The example dialogue as this version of the character has it: its own, or the story's. */
            _examples(view, state) {
                const own = WorkshopStore.examplesIn(state, view.ws.original);
                return own !== null ? own : WorkshopStore.storyExamples(this._scenarios(), view.charId);
            },

            /** What the Workshop's AI reads about the openings, labelled O1, O2…, for the lead only. */
            _extras(view) {
                if (!this._ownsOpenings(view)) return null;
                const state = WorkshopStore.active(view.ws).state;
                return {
                    openings: this._scenarios().map((sc, i) => ({ id: sc.id, label: `O${i + 1}`, ...WorkshopStore.openingIn(state, view.ws.original, sc) })),
                    examples: this._examples(view, state)
                };
            },

            /**
             * Changes the story record, and the Library's copy of it. The open story's own saves read
             * the record fresh and leave its openings alone, so waiting for a running save and holding
             * autosave off while this writes is enough to keep either from undoing the other.
             * @param {Function} mutate - Changes the story it is given; false means nothing to write.
             * @returns {Promise<boolean>} Whether the story was written.
             */
            async _writeStory(mutate) {
                const library = StateManager.getLibrary();
                const storyId = library && library.active_story_id;
                if (!storyId) return false;
                await this._waitForSave();
                const paused = !!ReactiveStore._isSavingPaused;
                if (!paused) ReactiveStore.pauseSaving();
                try {
                    const story = await DBService.getStory(storyId);
                    if (!story || !Array.isArray(story.scenarios) || mutate(story) === false) return false;
                    story.last_modified = new Date().toISOString();
                    await DBService.saveStory(story);
                    const copy = (library.stories || []).find(s => s.id === storyId);
                    if (copy) {
                        copy.scenarios = JSON.parse(JSON.stringify(story.scenarios));
                        copy.last_modified = story.last_modified;
                    }
                    return true;
                } finally {
                    if (!paused) ReactiveStore.resumeSaving();
                }
            },

            /** Who the story's text is about: the lead, by id and name, and you. */
            _cast(view) {
                const character = this._character(view.charId);
                return { leadId: view.charId, leadName: (character && character.name) || '', userId: this._userId() };
            },

            /** Writes the variant in use's openings and examples into the story, when they differ from it. */
            async _syncOpenings(view) {
                if (!this._ownsOpenings(view)) return;
                const cast = this._cast(view);
                if (!WorkshopStore.syncStory(this._scenarios(), view.ws, cast).changed) return;
                const ws = view.ws;
                await this._writeStory(story => {
                    const result = WorkshopStore.syncStory(story.scenarios, ws, cast);
                    if (!result.changed) return false;
                    story.scenarios = result.scenarios;
                    return true;
                });
            },

            // ---------------------------------------------------------------------------------------
            // The Workshop screen
            // ---------------------------------------------------------------------------------------

            /** Whether a character can open in the Workshop: one of the story's characters, not you or the narrator. */
            canOpen(charId) {
                const character = this._character(charId);
                return !!(character && !character.is_user && !character.is_narrator);
            },

            /** A Workshop for a character that has none yet, made from its card. Nothing is saved until the first change. */
            _fromCard(character) {
                return WorkshopStore.fromDescription(character.description);
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
                    // On a wide screen, what the right column shows: the co-writer or the card.
                    side: 'cowriter',
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
                document.getElementById('ws-history').classList.add('hidden');
                document.getElementById('ws-cw-sheet').classList.add('hidden');
                if (view.pushed && !fromBack) history.back();
                // Reopened, not just shown, so the character editor shows the new description.
                if (view.editorWasOpen) UIManager.openCharacterDetailModal(view.charId);
            },

            /**
             * Opens the character waiting from "New character", or from a story's Workshop button in
             * the library, once its story has loaded. Only a new character opens at the concept,
             * ready to type.
             */
            openPending() {
                let pending = null;
                try {
                    pending = sessionStorage.getItem(this.PENDING_KEY);
                    sessionStorage.removeItem(this.PENDING_KEY);
                } catch (e) {
                    return;
                }
                let charId = pending;
                let atConcept = true;
                try {
                    const waiting = JSON.parse(pending);
                    if (waiting && waiting.id) {
                        charId = waiting.id;
                        atConcept = !!waiting.concept;
                    }
                } catch (e) {
                    // A plain id, left waiting by an earlier version: a new character.
                }
                if (!charId || !this.canOpen(charId)) return;
                this.open(charId);
                const concept = atConcept && document.getElementById('ws-concept');
                if (concept) concept.focus();
            },

            /**
             * "Workshop" on a story in the library: its lead opens in the Workshop. The story already
             * open just closes the library. Another one loads its latest chat first, or a new chat
             * from its first opening when it has none, and the lead waits across that reload.
             */
            async openFromLibrary(storyId) {
                const library = StateManager.getLibrary();
                const story = library.stories.find(s => s.id === storyId);
                const leadId = story ? WorkshopStore.leadOf(story.characters, story.scenarios) : null;
                if (!leadId) {
                    UIManager.showNotification('This story has no character to open in the Workshop.', 'info');
                    return;
                }
                if (library.active_story_id === storyId && this.canOpen(leadId)) {
                    AppController.closeModal('story-details-modal');
                    AppController.closeModal('story-library-modal');
                    this.open(leadId);
                    return;
                }
                const latest = (story.narratives || []).slice().sort((a, b) => new Date(b.last_modified) - new Date(a.last_modified))[0];
                const opening = (story.scenarios || [])[0];
                if (!latest && !opening) {
                    UIManager.showNotification('This story has no opening to start a chat from.', 'info');
                    return;
                }
                try {
                    sessionStorage.setItem(this.PENDING_KEY, JSON.stringify({ id: leadId }));
                } catch (e) {
                    // Without session storage the story still opens, just not in the Workshop.
                }
                if (!latest) {
                    await LibraryController.createNarrativeFromScenario(storyId, opening.id);
                    return;
                }
                // Saved first, and autosave held, so nothing of the open story is lost or written into this one.
                if (ReactiveStore.forceSave) await ReactiveStore.forceSave();
                if (ReactiveStore.blockAutoSave) ReactiveStore.blockAutoSave();
                LibraryController.loadNarrative(storyId, latest.id);
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
                    sessionStorage.setItem(this.PENDING_KEY, JSON.stringify({ id: character.id, concept: true }));
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
                this.renderProgress();
                this.renderNotice();
                this.renderTabs();
                this.renderSections();
                this.renderCard();
                this.renderCowriter();
                this.renderCowriterSheet();
            },

            /**
             * On the phone the sections, the co-writer and the card are tabs. On a wide screen the
             * sections stay on the left, and the right column shows the co-writer or the card.
             */
            renderTabs() {
                const view = this.RUNTIME.view;
                const tab = view.tab;
                const side = view.side || 'cowriter';
                document.querySelectorAll('#character-workshop [data-action="workshop-tab"]').forEach(btn => {
                    const on = btn.closest('.ws-side-tabs') ? btn.dataset.tab === side : btn.dataset.tab === tab;
                    btn.classList.toggle('is-active', on);
                    btn.setAttribute('aria-selected', on ? 'true' : 'false');
                });
                document.querySelectorAll('#character-workshop .ws-pane').forEach(pane => {
                    pane.classList.toggle('is-active', pane.dataset.pane === tab);
                    pane.classList.toggle('is-side', pane.dataset.pane === side);
                });
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
                    `<div id="ws-aibar-wrap">${this._aiBar(state)}</div>`,
                    '<div id="ws-sort-wrap"></div>',
                    ...state.sections.map(s => this._sectionCard(s)),
                    `<div id="ws-openings-wrap">${this._openingsCard(state)}</div>`,
                    this._notesCard(state)
                ].join('');
                this.renderSortArea();
                this._growAll(document.getElementById('ws-sections'));
            },

            /** Redraws one section card, leaving the others, and any field being typed in, alone. */
            renderSection(id) {
                const card = document.getElementById(`ws-sec-${id}`);
                const section = this._section(WorkshopStore.active(this.RUNTIME.view.ws).state, id);
                if (!card || !section) return;
                // Never while someone is typing in it: redrawing would throw away what they typed.
                const typing = document.activeElement;
                if (typing && card.contains(typing) && typing.matches('textarea, input')) return;
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
                const view = this.RUNTIME.view;
                const active = WorkshopStore.active(view.ws);
                const state = active.state;
                const description = WorkshopStore.compile(state);
                const scenario = String((this._section(state, 'scenario') || {}).text || '').trim();
                // What a card can show: the character now, the card it started from, or another variant.
                const picks = [{ value: 'current', label: `As it is now (${active.name})` }];
                if (String((view.ws.original || {}).description || '').trim()) picks.push({ value: 'original', label: 'The original card' });
                view.ws.variants.filter(v => !v.deletedAt && v.id !== active.id).forEach(v => picks.push({ value: v.id, label: `Variant: ${v.name}` }));
                const chosen = picks.some(p => p.value === view.exportPick) ? view.exportPick : 'current';
                // The story's lead also shows what its card's greetings and examples will be.
                const extras = this._extras(view);
                const greetings = extras ? DOM.html`
                    <div class="ws-card">
                        <h3 class="ws-label">First message</h3>
                        <p class="ws-hint">The first opening.</p>
                        <div class="ws-preview">${(extras.openings[0] && extras.openings[0].message.trim()) || 'Empty.'}</div>
                    </div>
                    <div class="ws-card">
                        <h3 class="ws-label">Alternate greetings</h3>
                        <p class="ws-hint">The other openings.</p>
                        <div class="ws-preview">${extras.openings.slice(1).map(o => o.message.trim()).filter(Boolean).join('\n\n---\n\n') || 'None.'}</div>
                    </div>
                    <div class="ws-card">
                        <h3 class="ws-label">Example dialogue</h3>
                        <div class="ws-preview">${extras.examples.trim() || 'None.'}</div>
                    </div>` : '';
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
                    </div>
                    ${greetings}
                    <div class="ws-card">
                        <h3 class="ws-label">Export as a card</h3>
                        <p class="ws-hint">A PNG card for SillyTavern and other apps, showing the version you pick. The whole Workshop rides inside it, so importing it into Rolecraft brings everything back.</p>
                        <div class="ws-export-row">
                            <select id="ws-export-pick" class="ws-select" data-action-change="workshop-export-pick" aria-label="Version the card shows">
                                ${picks.map(p => DOM.html`<option value="${p.value}"${p.value === chosen ? DOM.unsafe(' selected') : ''}>${p.label}</option>`)}
                            </select>
                            <button type="button" class="ws-btn is-primary" data-action="workshop-export">Export PNG</button>
                        </div>
                        <p class="ws-hint">For an earlier point, open it in the history (tap the version name at the top).</p>
                    </div>`.toString();
            },

            /** Saves a card showing one version of the character: 'current', 'original', a variant or a step. */
            async exportCard(pick) {
                const view = this.RUNTIME.view;
                if (!view) return;
                await this._saveNow();
                await LibraryController.exportCharacterCard(view.charId, pick, this._exportName(pick));
            },

            /** The card's file name: the character's name, and which version it shows when that isn't the current one. */
            _exportName(pick) {
                const view = this.RUNTIME.view;
                const character = this._character(view.charId);
                const name = (character && character.name) || 'Character';
                if (pick === 'current') return name;
                if (pick === 'original') return `${name} - original`;
                const variant = view.ws.variants.find(v => v.id === pick);
                if (variant) return `${name} - ${variant.name}`;
                const step = view.ws.commits.find(c => c.id === pick);
                return `${name} - ${String((step && step.summary) || 'earlier point').slice(0, 40)}`;
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
                        <p class="ws-hint">Replies still read this exactly as written, ahead of the sections. Move lines into sections yourself, or let the AI sort them without changing a word.</p>
                        <textarea id="ws-unsorted" class="ws-field" data-ws-field="unsorted" rows="4">${state.unsorted}</textarea>
                        <div class="ws-ai-row">
                            <button type="button" class="ws-ai-btn" data-action="workshop-sort" ${this.RUNTIME.view.busy ? 'disabled' : ''}>✦ Sort into sections</button>
                        </div>
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
                const editingPin = view.editingPin && view.editingPin.section === s.id ? view.editingPin.pin : null;
                const pins = s.pins.map(p => (p.id === editingPin
                    ? DOM.html`<textarea class="ws-pin-input" data-section="${s.id}" data-pin="${p.id}" rows="1" maxlength="200" enterkeyhint="done" aria-label="Change this pin">${p.text}</textarea>`
                    : this._pinChip(s.id, p, missing.has(p.id))));
                const adding = view.addingPin === s.id
                    ? DOM.html`<input type="text" class="ws-pin-input" data-section="${s.id}" maxlength="200" placeholder="Something it must keep" aria-label="New pin for ${s.title}">`
                    : DOM.html`<button type="button" class="ws-pin-add" data-action="workshop-pin-add" data-section="${s.id}">+ Pin</button>`;
                const body = view.editing === s.id
                    ? DOM.html`<textarea class="ws-field ws-section-text" data-ws-field="section" data-section="${s.id}" rows="5" aria-label="${s.title}">${s.text}</textarea>`
                    : this._textView(s, check.landed);
                const pending = (view.ws.pending || {})[s.id];
                const proposal = !pending ? '' : (pending.kind === 'takes' ? this._takesBlock(s, pending) : this._proposalBlock(s, pending));
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
                        ${this._aiRow(s)}
                        ${proposal}
                    </article>`.toString();
            },

            _pinChip(sectionId, pin, missing) {
                const look = pin.state === 'suggested' ? 'is-suggested' : (missing ? 'is-missing' : 'is-kept');
                const label = pin.state === 'suggested' ? 'Suggested. Tap ✓ to keep it.' : (missing ? 'Pinned, but not in the text yet' : 'Pinned');
                const keep = pin.state === 'suggested'
                    ? DOM.html`<button type="button" class="ws-pin-btn" data-action="workshop-pin-keep" data-section="${sectionId}" data-pin="${pin.id}" aria-label="Keep this pin">✓</button>` : '';
                return DOM.html`
                    <span class="ws-pin ${look}" title="${label}">${keep}<button type="button" class="ws-pin-text" data-action="workshop-pin-edit"
                        data-section="${sectionId}" data-pin="${pin.id}" title="Change the words">${pin.text}</button><button type="button" class="ws-pin-btn"
                        data-action="workshop-pin-remove" data-section="${sectionId}" data-pin="${pin.id}" aria-label="Remove this pin">×</button></span>`;
            },

            /** A section's text with each pin that made it in highlighted. Tapping it edits it. */
            _textView(s, landed) {
                if (!String(s.text || '').trim()) {
                    return DOM.html`<div class="ws-text is-empty" data-action="workshop-edit" data-section="${s.id}" role="button" tabindex="0">Empty. Tap to write it yourself.</div>`;
                }
                return DOM.html`<div class="ws-text" data-action="workshop-edit" data-section="${s.id}" role="button" tabindex="0" aria-label="Edit ${s.title}">${DOM.unsafe(this._markHtml(s.text, landed))}</div>`;
            },

            _esc(text) {
                return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            },

            ICONS: {
                down: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 9l6 6 6-6"></path></svg>',
                book: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 17a3 3 0 013-3h11"></path></svg>',
                plus: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M5 12h14"></path></svg>',
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
                if (root) root.querySelectorAll('textarea.ws-field, textarea.ws-pin-input').forEach(el => this._grow(el));
            },

            /**
             * Applies one change to the variant being worked on as a "you" commit, redraws what it
             * touched and saves it. Nothing changed means no commit and no save.
             */
            async _change(summary, mutate, redraw, origin = 'you') {
                const view = this.RUNTIME.view;
                if (!view) return;
                const next = JSON.parse(JSON.stringify(WorkshopStore.active(view.ws).state));
                mutate(next);
                await this._commitWs(WorkshopStore.commit(view.ws, next, { origin, summary }), redraw);
            },

            /** Puts a new version of the Workshop on screen and saves it. The same version back means nothing changed. */
            async _commitWs(ws, redraw) {
                const view = this.RUNTIME.view;
                if (!view) return;
                const changed = ws !== view.ws;
                view.ws = ws;
                if (redraw) redraw();
                if (!changed) return;
                this.renderCard();
                this.renderAiBar();
                await this._saveWs(view);
            },

            async _saveWs(view) {
                try {
                    await this.applyWorkshop(view.charId, view.ws);
                    await this._syncOpenings(view);
                    if (this.RUNTIME.view === view) this.renderNotice();
                } catch (err) {
                    UIManager.showNotification(`The Workshop could not save that change: ${err.message}`, 'error');
                }
            },

            // ---------------------------------------------------------------------------------------
            // Writing with the Workshop's AI. Every answer is a proposal; nothing changes until it is used.
            // ---------------------------------------------------------------------------------------

            /** A written or re-woven section waiting to be used (not a batch of takes, not a sorting). */
            _isSectionProposal(p) {
                return !!p && (p.kind === 'write' || p.kind === 'reweave');
            },

            /** The bar under the concept: pins and text for every empty section, and proposals waiting. */
            _aiBar(state) {
                const view = this.RUNTIME.view;
                const busy = view.busy;
                const empty = state.sections.filter(s => !s.locked && !String(s.text || '').trim());
                const waiting = Object.values(view.ws.pending || {}).filter(p => this._isSectionProposal(p));
                const off = (busy || empty.length === 0) ? 'disabled' : '';
                // A card that was split by its headings has text but no pins yet: offer to draft them.
                const unpinned = !String(state.unsorted || '').trim() && !(view.ws.pending || {})._sort
                    && state.sections.some(s => !s.locked && String(s.text || '').trim() && s.pins.length === 0);
                const draft = unpinned ? DOM.html`<button type="button" class="ws-ai-btn" data-action="workshop-sort" ${busy ? 'disabled' : ''}
                    title="Read each section's text and suggest the pins it clearly wants kept">✦ Draft pins from the text</button>` : '';
                const status = (view.errors || {})._all ? DOM.html`<span class="ws-status is-error">${view.errors._all}</span>` : '';
                const waitingBar = waiting.length > 1 ? DOM.html`
                    <div class="ws-waiting">
                        <span>${waiting.length} proposals are waiting.</span>
                        <button type="button" class="ws-btn is-primary" data-action="workshop-accept-all" ${busy ? 'disabled' : ''}>Use all</button>
                        <button type="button" class="ws-btn" data-action="workshop-discard-all" ${busy ? 'disabled' : ''}>Discard all</button>
                    </div>` : '';
                return DOM.html`
                    <div class="ws-aibar">
                        <button type="button" class="ws-ai-btn" data-action="workshop-suggest-pins" ${off}>✦ Suggest pins</button>
                        <button type="button" class="ws-ai-btn" data-action="workshop-write-all" ${off}>✦ Write the empty sections</button>
                        ${draft}
                        ${status}
                    </div>${waitingBar}`.toString();
            },

            /** The card text not in a section yet, or the AI's sorting of it waiting for a yes. */
            renderSortArea() {
                const wrap = document.getElementById('ws-sort-wrap');
                const view = this.RUNTIME.view;
                if (!wrap || !view) return;
                const typing = document.activeElement;
                if (typing && wrap.contains(typing) && typing.matches('textarea, input')) return;
                const state = WorkshopStore.active(view.ws).state;
                const sort = (view.ws.pending || {})._sort;
                wrap.innerHTML = (sort ? this._sortReview(state, sort) : '') + (String(state.unsorted || '').trim() ? this._unsortedCard(state) : '');
                this._growAll(wrap);
            },

            /** What the sorting would move where, what stays unsorted, and the pins drafted from the text. */
            _sortReview(state, p) {
                const moved = state.sections.filter(s => p.sections[s.id]);
                const pinned = state.sections.filter(s => (p.pins[s.id] || []).length);
                const restored = p.restored ? DOM.html`
                    <p class="ws-hint is-warn">${p.restored} sentence${p.restored === 1 ? '' : 's'} the AI changed or left out ${p.restored === 1 ? 'was' : 'were'} put back into the unsorted text, word for word.</p>` : '';
                const stays = p.leftover
                    ? DOM.html`<div class="ws-sort-item"><div class="ws-sort-title">Stays unsorted</div><div class="ws-text is-proposal">${p.leftover}</div></div>`
                    : (String(state.unsorted || '').trim() ? DOM.html`<p class="ws-hint">Nothing stays unsorted.</p>` : '');
                const pinList = pinned.length ? DOM.html`
                    <div class="ws-sort-item">
                        <div class="ws-sort-title">Pins drafted from the text, as suggestions to keep or drop</div>
                        ${pinned.map(s => DOM.html`<p class="ws-sort-pins"><strong>${s.title}:</strong> ${p.pins[s.id].join(' · ')}</p>`)}
                    </div>` : '';
                return DOM.html`
                    <article class="ws-card ws-sort-review">
                        <div class="ws-label">${moved.length ? 'The card, sorted by the AI' : 'Pins drafted by the AI'}</div>
                        <p class="ws-hint">Nothing changes until you use it.${moved.length ? ' Moved text joins the end of each section, in the card\'s own words.' : ''}</p>
                        ${restored}
                        ${moved.map(s => DOM.html`<div class="ws-sort-item"><div class="ws-sort-title">Into ${s.title}</div><div class="ws-text is-proposal">${p.sections[s.id]}</div></div>`)}
                        ${stays}
                        ${pinList}
                        <div class="ws-proposal-actions">
                            <button type="button" class="ws-btn is-primary" data-action="workshop-sort-accept">Use it</button>
                            <button type="button" class="ws-btn" data-action="workshop-sort-discard">Discard</button>
                        </div>
                    </article>`.toString();
            },

            async _sortCard(view, name, onDelta) {
                const ask = WorkshopPrompts.sortCard({ name, state: WorkshopStore.active(view.ws).state, extras: this._extras(view) });
                const sort = ask.read((await this._chat(view, ask, onDelta)).data);
                view.ws = WorkshopStore.setPending(view.ws, '_sort', { kind: 'sort', ...sort, at: Date.now() });
                await this._saveWs(view);
            },

            acceptSort() {
                const view = this.RUNTIME.view;
                const sort = view && (view.ws.pending || {})._sort;
                if (!sort) return;
                const moved = Object.keys(sort.sections).length;
                const summary = moved ? `Sorted the card into ${moved} section${moved === 1 ? '' : 's'}` : 'The AI drafted pins from the text';
                const next = WorkshopStore.applySort(WorkshopStore.active(view.ws).state, sort);
                const ws = WorkshopStore.setPending(WorkshopStore.commit(view.ws, next, { origin: 'ai', summary }), '_sort', null);
                this._commitWs(ws, () => this.renderSections());
            },

            discardSort() {
                const view = this.RUNTIME.view;
                if (!view) return;
                this._commitWs(WorkshopStore.setPending(view.ws, '_sort', null), () => this.renderSortArea());
            },

            renderAiBar() {
                const wrap = document.getElementById('ws-aibar-wrap');
                if (wrap && this.RUNTIME.view) wrap.innerHTML = this._aiBar(WorkshopStore.active(this.RUNTIME.view.ws).state);
            },

            /**
             * What the AI is doing, in a strip under the tabs that stays put while the sections scroll,
             * so it can be seen wherever the screen is. Stop ends it. Gone when the AI is idle.
             */
            renderProgress() {
                const view = this.RUNTIME.view;
                const strip = document.getElementById('ws-progress');
                if (!strip) return;
                const busy = view && view.busy;
                if (busy) strip.classList.remove('hidden');
                else strip.classList.add('hidden');
                strip.innerHTML = !busy ? '' : DOM.html`
                    <div class="ws-progress-text">
                        <span class="ws-progress-what">${this._busyTitle(busy)}</span>
                        <span id="ws-busy-status" class="ws-status">${busy.status}</span>
                    </div>
                    <button type="button" class="ws-btn" data-action="workshop-ai-stop">Stop</button>`.toString();
            },

            _busyTitle(busy) {
                const view = this.RUNTIME.view;
                const state = WorkshopStore.active(view.ws).state;
                const title = busy.sectionId ? this._section(state, busy.sectionId).title : '';
                if (busy.kind === 'sort') return String(state.unsorted || '').trim() ? 'Sorting the card into sections' : 'Drafting pins from the text';
                if (String(busy.kind).startsWith('opening')) {
                    const scenario = this._scenarios().find(s => s.id === busy.target);
                    const name = scenario ? WorkshopStore.openingIn(state, view.ws.original, scenario).name : 'an opening';
                    return { 'opening-write': `Writing the opening "${name}"`, 'opening-reweave': `Re-weaving the opening "${name}"`, 'opening-takes': `3 takes for the opening "${name}"` }[busy.kind];
                }
                if (busy.kind === 'examples-write') return 'Writing the example dialogue';
                if (busy.kind === 'examples-reweave') return 'Re-weaving the example dialogue';
                if (busy.kind === 'cowriter') return view.cardWriting ? "Writing the co-writer's suggestions" : 'The co-writer is answering';
                if (busy.kind === 'card-write') return 'Writing a suggestion';
                return {
                    write: `Writing ${title}`, reweave: `Re-weaving ${title}`, takes: `3 takes for ${title}`,
                    suggest: 'Suggesting pins', 'write-all': 'Writing the empty sections'
                }[busy.kind] || 'The AI is working';
            },

            /** A section's AI buttons, with what the AI is doing for it, or why it failed. Locked, it can still be talked over. */
            _aiRow(s) {
                const view = this.RUNTIME.view;
                const talk = DOM.html`<button type="button" class="ws-btn" data-action="workshop-cw-about" data-about="${s.title}" title="Talk it over with the co-writer">Talk it over</button>`;
                if (s.locked) return DOM.html`<div class="ws-ai-row">${talk}</div>`;
                const busy = view.busy;
                const hasText = !!String(s.text || '').trim();
                const status = (view.errors || {})[s.id] ? DOM.html`<span class="ws-status is-error">${view.errors[s.id]}</span>` : '';
                return DOM.html`
                    <div class="ws-ai-row">
                        <button type="button" class="ws-ai-btn" data-action="workshop-write" data-section="${s.id}" data-mode="${hasText ? 'reweave' : 'write'}"
                            title="${hasText ? 'Rewrite it around its pins, keeping what still fits' : 'Write it from its pins and the rest of the character'}" ${busy ? 'disabled' : ''}>${hasText ? '✦ Re-weave' : '✦ Write'}</button>
                        <button type="button" class="ws-ai-btn" data-action="workshop-takes" data-section="${s.id}"
                            title="Three really different versions to choose from" ${busy ? 'disabled' : ''}>✦ 3 takes</button>
                        ${talk}
                        ${status}
                    </div>`;
            },

            /** Text with the pins that made it in highlighted, as HTML. */
            _markHtml(text, landed) {
                let html = '';
                let at = 0;
                for (const span of landed.slice().sort((a, b) => a.start - b.start)) {
                    if (span.start < at) continue;
                    html += this._esc(text.slice(at, span.start)) + `<mark class="ws-mark">${this._esc(text.slice(span.start, span.end))}</mark>`;
                    at = span.end;
                }
                return html + this._esc(text.slice(at));
            },

            _tally(s, check) {
                const kept = s.pins.filter(p => p.state === 'kept').length;
                return kept ? DOM.html`<span class="ws-tally${check.missing.length ? ' is-short' : ''}">${check.landed.length} of ${kept} pins in</span>` : '';
            },

            /** A written or re-woven section waiting to be used, under the text it would replace. */
            _proposalBlock(s, p) {
                const check = WorkshopStore.checkPins({ ...s, text: p.text, pinMap: p.pinMap });
                const label = p.kind === 'reweave' ? 'Re-woven by the AI' : 'Written by the AI';
                return DOM.html`
                    <div class="ws-proposal">
                        <div class="ws-proposal-head"><span>${label}. Nothing changes until you use it.</span>${this._tally(s, check)}</div>
                        <div class="ws-text is-proposal">${DOM.unsafe(this._markHtml(p.text, check.landed))}</div>
                        <div class="ws-proposal-actions">
                            <button type="button" class="ws-btn is-primary" data-action="workshop-accept" data-section="${s.id}">Use it</button>
                            <button type="button" class="ws-btn" data-action="workshop-discard" data-section="${s.id}">Discard</button>
                        </div>
                    </div>`;
            },

            /** Three takes to choose from, and a dial for how far the next batch may wander. */
            _takesBlock(s, p) {
                const busy = !!this.RUNTIME.view.busy;
                const names = ['Safest', 'Grounded', 'Inventive', 'Bold', 'Wildest'];
                const dial = names.map((name, i) => DOM.html`
                    <button type="button" class="ws-dial-btn${i + 1 === p.creativity ? ' is-on' : ''}" data-action="workshop-takes" data-section="${s.id}"
                        data-creativity="${i + 1}" title="${name}" aria-label="Three new takes, ${name.toLowerCase()}" ${busy ? 'disabled' : ''}>${i + 1}</button>`);
                const takes = p.takes.map((t, i) => {
                    const check = WorkshopStore.checkPins({ ...s, text: t.text, pinMap: t.pinMap });
                    return DOM.html`
                        <div class="ws-take">
                            <div class="ws-proposal-head"><span class="ws-take-angle">${t.angle}</span>${this._tally(s, check)}</div>
                            <div class="ws-text is-proposal">${DOM.unsafe(this._markHtml(t.text, check.landed))}</div>
                            <div class="ws-proposal-actions">
                                <button type="button" class="ws-btn is-primary" data-action="workshop-take-use" data-section="${s.id}" data-index="${i}">Use this</button>
                                <button type="button" class="ws-btn" data-action="workshop-take-reject" data-section="${s.id}" data-index="${i}"
                                    title="Drop it, and steer the next takes away from it">Not this</button>
                            </div>
                        </div>`;
                });
                return DOM.html`
                    <div class="ws-takes">
                        <div class="ws-proposal-head">
                            <span>${p.takes.length === 1 ? 'One take left.' : `${p.takes.length} takes.`} Nothing changes until you use one.</span>
                            <button type="button" class="ws-link" data-action="workshop-discard" data-section="${s.id}">Close</button>
                        </div>
                        ${takes}
                        <div class="ws-dial-row"><span>Three new takes, from safest to wildest:</span><span class="ws-dial" role="group">${dial}</span></div>
                    </div>`;
            },

            /**
             * Runs one AI job: write or re-weave a section, three takes, suggested pins, writing every
             * empty section, or the same for an opening (its id as target) or the example dialogue.
             * One job at a time; Stop ends it.
             */
            async _ask(kind, sectionId = null, creativity = null, target = null) {
                const view = this.RUNTIME.view;
                if (!view || view.busy) return;
                const character = this._character(view.charId);
                const name = character ? character.name : '';
                view.errors = {};
                view.busy = { kind, sectionId, target, controller: new AbortController(), status: 'Asking the Workshop model...', label: '' };
                this._redrawFor(sectionId, kind);
                const onDelta = ({ text, thinking }) => {
                    const el = document.getElementById('ws-busy-status');
                    if (el && view.busy) el.textContent = `${view.busy.label}${text ? `Writing... ${text.length} characters` : `Thinking... ${thinking.length} characters`}`;
                };
                try {
                    if (kind === 'suggest') await this._suggestPins(view, name, onDelta);
                    else if (kind === 'sort') await this._sortCard(view, name, onDelta);
                    else if (kind === 'write-all') await this._writeAll(view, name, onDelta);
                    else if (kind === 'takes') await this._takes(view, name, sectionId, creativity, onDelta);
                    else if (kind === 'opening-write' || kind === 'opening-reweave') await this._writeOpening(view, name, target, kind === 'opening-reweave', onDelta);
                    else if (kind === 'opening-takes') await this._openingTakes(view, name, target, creativity, onDelta);
                    else if (kind === 'examples-write' || kind === 'examples-reweave') await this._writeExamples(view, name, kind === 'examples-reweave', onDelta);
                    else if (kind === 'cowriter') await this._cowriterReply(view, name, target, onDelta);
                    else if (kind === 'card-write') await this._draftCard(view, name, target, onDelta);
                    else await this._write(view, name, sectionId, kind === 'reweave', onDelta);
                } catch (err) {
                    let where = sectionId || (target ? `o:${target}` : (kind.startsWith('examples') ? '_examples' : '_all'));
                    if (kind === 'cowriter') where = '_cowriter';
                    if (!(err && err.name === 'AbortError')) view.errors = { [where]: (err && err.message) || 'The Workshop model did not answer.' };
                } finally {
                    view.busy = null;
                    if (this.RUNTIME.view === view) this._redrawFor(sectionId, kind);
                }
            },

            _redrawFor(sectionId, kind = '') {
                this.renderProgress();
                this.renderAiBar();
                if (/^(opening|examples)/.test(kind)) {
                    this.renderOpenings();
                    return;
                }
                if (kind === 'cowriter' || kind === 'card-write') {
                    this.renderCowriter();
                    return;
                }
                if (sectionId) {
                    this.renderSection(sectionId);
                    return;
                }
                this.renderSortArea();
                WorkshopStore.active(this.RUNTIME.view.ws).state.sections.forEach(s => this.renderSection(s.id));
            },

            _chat(view, ask, onDelta) {
                return WorkshopAI.chat({ messages: ask.messages, json: true, temperature: ask.temperature, signal: view.busy.controller.signal, onDelta });
            },

            async _write(view, name, sectionId, reweave, onDelta) {
                const ask = WorkshopPrompts.writeSection({ name, state: WorkshopStore.active(view.ws).state, sectionId, reweave, extras: this._extras(view) });
                const result = ask.read((await this._chat(view, ask, onDelta)).data);
                view.ws = WorkshopStore.setPending(view.ws, sectionId, { kind: reweave ? 'reweave' : 'write', text: result.text, pinMap: result.pinMap, at: Date.now() });
                await this._saveWs(view);
            },

            async _takes(view, name, sectionId, creativity, onDelta) {
                const previous = (view.ws.pending || {})[sectionId];
                const level = creativity || (previous && previous.creativity) || 3;
                const ask = WorkshopPrompts.takes({
                    name, state: WorkshopStore.active(view.ws).state, sectionId, avoid: (view.ws.avoid || {})[sectionId] || [], creativity: level, extras: this._extras(view)
                });
                const takes = ask.read((await this._chat(view, ask, onDelta)).data);
                view.ws = WorkshopStore.setPending(view.ws, sectionId, { kind: 'takes', takes, creativity: level, at: Date.now() });
                await this._saveWs(view);
            },

            async _suggestPins(view, name, onDelta) {
                const state = WorkshopStore.active(view.ws).state;
                const sectionIds = state.sections.filter(s => !s.locked && !String(s.text || '').trim()).map(s => s.id);
                if (sectionIds.length === 0) return;
                const ask = WorkshopPrompts.suggestPins({ name, state, sectionIds, extras: this._extras(view) });
                const suggestions = ask.read((await this._chat(view, ask, onDelta)).data);
                const count = Object.keys(suggestions).length;
                await this._change(`The AI suggested pins for ${count} section${count === 1 ? '' : 's'}`,
                    next => { next.sections = WorkshopStore.addSuggestions(next, suggestions).sections; }, null, 'ai');
            },

            /** Writes every empty section in turn. Each one reads the ones written before it. */
            async _writeAll(view, name, onDelta) {
                const start = WorkshopStore.active(view.ws).state;
                const targets = start.sections.filter(s => !s.locked && !String(s.text || '').trim() && !(view.ws.pending || {})[s.id]);
                for (const [i, s] of targets.entries()) {
                    view.busy.label = `${s.title} (${i + 1} of ${targets.length}): `;
                    const el = document.getElementById('ws-busy-status');
                    if (el) el.textContent = `${view.busy.label}starting...`;
                    const written = Object.fromEntries(Object.entries(view.ws.pending || {}).filter(([, p]) => this._isSectionProposal(p)));
                    const ask = WorkshopPrompts.writeSection({ name, state: WorkshopStore.active(view.ws).state, sectionId: s.id, pending: written, extras: this._extras(view) });
                    const result = ask.read((await this._chat(view, ask, onDelta)).data);
                    view.ws = WorkshopStore.setPending(view.ws, s.id, { kind: 'write', text: result.text, pinMap: result.pinMap, at: Date.now() });
                    await this._saveWs(view);
                    if (this.RUNTIME.view === view) {
                        this.renderSection(s.id);
                        this.renderAiBar();
                    }
                }
            },

            acceptProposal(sectionId) {
                const view = this.RUNTIME.view;
                const p = view && (view.ws.pending || {})[sectionId];
                if (!p || p.kind === 'takes') return;
                const title = this._section(WorkshopStore.active(view.ws).state, sectionId).title;
                const summary = `${p.kind === 'reweave' ? 'Re-wove' : 'Wrote'} ${title} with the AI`;
                this._commitWs(WorkshopStore.acceptMany(view.ws, { [sectionId]: p }, { origin: 'ai', summary }), () => this.renderSection(sectionId));
            },

            discardProposal(sectionId) {
                const view = this.RUNTIME.view;
                if (!view) return;
                this._commitWs(WorkshopStore.setPending(view.ws, sectionId, null), () => this.renderSection(sectionId));
            },

            acceptAll() {
                const view = this.RUNTIME.view;
                const waiting = Object.fromEntries(Object.entries((view && view.ws.pending) || {}).filter(([, p]) => this._isSectionProposal(p)));
                const count = Object.keys(waiting).length;
                if (count === 0) return;
                this._commitWs(WorkshopStore.acceptMany(view.ws, waiting, { origin: 'ai', summary: `Wrote ${count} sections with the AI` }), () => this.renderSections());
            },

            discardAll() {
                const view = this.RUNTIME.view;
                if (!view) return;
                let ws = view.ws;
                for (const [id, p] of Object.entries(ws.pending || {})) if (this._isSectionProposal(p)) ws = WorkshopStore.setPending(ws, id, null);
                this._commitWs(ws, () => this.renderSections());
            },

            useTake(sectionId, index) {
                const view = this.RUNTIME.view;
                const p = view && (view.ws.pending || {})[sectionId];
                const take = p && p.kind === 'takes' && p.takes[index];
                if (!take) return;
                const title = this._section(WorkshopStore.active(view.ws).state, sectionId).title;
                this._commitWs(WorkshopStore.acceptMany(view.ws, { [sectionId]: take }, { origin: 'ai', summary: `Took "${take.angle}" for ${title}` }),
                    () => this.renderSection(sectionId));
            },

            /** Drops a take and remembers its angle, so the next takes steer clear of it. */
            rejectTake(sectionId, index) {
                const view = this.RUNTIME.view;
                const p = view && (view.ws.pending || {})[sectionId];
                const take = p && p.kind === 'takes' && p.takes[index];
                if (!take) return;
                const rest = p.takes.filter((t, i) => i !== index);
                const ws = WorkshopStore.addAvoid(view.ws, sectionId, take.angle);
                this._commitWs(WorkshopStore.setPending(ws, sectionId, rest.length ? { ...p, takes: rest } : null), () => this.renderSection(sectionId));
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
                } else if (field === 'opening' || field === 'opening-name') {
                    view.editing = null;
                    return this._setOpening(el.dataset.opening, field === 'opening' ? { message: el.value } : { name: String(el.value || '').trim() });
                } else if (field === 'examples') {
                    view.editing = null;
                    return this._setExamples(el.value);
                } else if (el.classList.contains('ws-pin-input')) {
                    if (el.dataset.pin) this.editPin(el.dataset.section, el.dataset.pin, el.value);
                    else this.addPin(el.dataset.section, el.value);
                }
            },

            /**
             * Rewords a pin. The new words are yours, so a suggested pin is kept, and the phrase the AI
             * said carried it is forgotten. Empty or unchanged words change nothing.
             */
            editPin(sectionId, pinId, text) {
                const view = this.RUNTIME.view;
                view.editingPin = null;
                const wording = String(text || '').replace(/\s+/g, ' ').trim();
                const pin = this._section(WorkshopStore.active(view.ws).state, sectionId).pins.find(p => p.id === pinId);
                if (!pin || !wording || wording === pin.text) {
                    this.renderSection(sectionId);
                    return;
                }
                this._change(`Reworded the pin "${wording}"`, next => {
                    const s = this._section(next, sectionId);
                    Object.assign(s.pins.find(p => p.id === pinId), { text: wording, state: 'kept', origin: 'you' });
                    delete s.pinMap[pinId];
                }, () => this.renderSection(sectionId));
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

            // ---------------------------------------------------------------------------------------
            // Openings: how new chats start, and the example dialogue before them.
            // ---------------------------------------------------------------------------------------

            /** Redraws the Openings card, leaving a field being typed in alone. */
            renderOpenings() {
                const wrap = document.getElementById('ws-openings-wrap');
                const view = this.RUNTIME.view;
                if (!wrap || !view) return;
                const typing = document.activeElement;
                if (typing && wrap.contains(typing) && typing.matches('textarea, input')) return;
                wrap.innerHTML = this._openingsCard(WorkshopStore.active(view.ws).state);
                this._growAll(wrap);
                const field = wrap.querySelector('[data-ws-field="opening"], [data-ws-field="opening-name"], [data-ws-field="examples"], #ws-opening-new-name');
                if (field) {
                    field.focus();
                    if (field.setSelectionRange) field.setSelectionRange(field.value.length, field.value.length);
                }
            },

            /** The story's openings and the example dialogue, in the lead's Workshop only. */
            _openingsCard(state) {
                const view = this.RUNTIME.view;
                if (!this._ownsOpenings(view)) return '';
                const busy = !!view.busy;
                const errors = view.errors || {};
                const character = this._character(view.charId);
                const name = (character && character.name) || 'The character';
                const openings = this._scenarios().map((sc, i) => this._openingBlock(sc, i, state, busy, errors));
                const adding = view.editing === 'o:new' ? DOM.html`
                    <div class="ws-opening is-new">
                        <input type="text" id="ws-opening-new-name" class="ws-opening-name-input" maxlength="80" placeholder="Its name, e.g. Storm night" aria-label="Name of the new opening">
                        <textarea id="ws-opening-new-text" class="ws-field" rows="4" placeholder="How this chat starts" aria-label="The new opening"></textarea>
                        <div class="ws-proposal-actions">
                            <button type="button" class="ws-btn is-primary" data-action="workshop-opening-add">Add it</button>
                            <button type="button" class="ws-btn" data-action="workshop-opening-cancel">Cancel</button>
                        </div>
                    </div>` : DOM.html`<button type="button" class="ws-pin-add" data-action="workshop-opening-new">+ Add an opening</button>`;
                return DOM.html`
                    <article class="ws-card ws-openings" id="ws-openings">
                        <h3 class="ws-label">Openings</h3>
                        <p class="ws-hint">How new chats start. A change goes into the story, so the next chat you start uses it; the open chat keeps the first message it already has.</p>
                        ${openings}
                        ${adding}
                        ${this._examplesBlock(state, name, busy, errors)}
                    </article>`.toString();
            },

            _openingBlock(sc, index, state, busy, errors) {
                const view = this.RUNTIME.view;
                const opening = WorkshopStore.openingIn(state, view.ws.original, sc);
                const key = `o:${sc.id}`;
                const label = opening.name || `Opening ${index + 1}`;
                const hasText = !!opening.message.trim();
                const title = view.editing === `${key}:name`
                    ? DOM.html`<input type="text" class="ws-opening-name-input" data-ws-field="opening-name" data-opening="${sc.id}" value="${opening.name}" maxlength="80" aria-label="Name of this opening">`
                    : DOM.html`<button type="button" class="ws-opening-name" data-action="workshop-opening-rename" data-opening="${sc.id}" title="Rename it">${label}</button>`;
                let body;
                if (view.editing === key) {
                    body = DOM.html`<textarea class="ws-field" data-ws-field="opening" data-opening="${sc.id}" rows="5" aria-label="${label}">${opening.message}</textarea>`;
                } else if (hasText) {
                    body = DOM.html`<div class="ws-text" data-action="workshop-opening-edit" data-opening="${sc.id}" role="button" tabindex="0" aria-label="Edit ${label}">${opening.message}</div>`;
                } else {
                    body = DOM.html`<div class="ws-text is-empty" data-action="workshop-opening-edit" data-opening="${sc.id}" role="button" tabindex="0">Empty. Tap to write it yourself.</div>`;
                }
                const pending = (view.ws.pending || {})[key];
                let proposal = '';
                if (pending && pending.kind === 'opening-takes') proposal = this._openingTakesBlock(sc.id, pending, busy);
                else if (pending && pending.kind === 'opening') proposal = this._openingProposalBlock(sc.id, pending);
                const status = errors[key] ? DOM.html`<span class="ws-status is-error">${errors[key]}</span>` : '';
                return DOM.html`
                    <div class="ws-opening" id="ws-opening-${sc.id}">
                        <div class="ws-opening-head">${title}</div>
                        ${body}
                        <div class="ws-ai-row">
                            <button type="button" class="ws-ai-btn" data-action="workshop-opening-write" data-opening="${sc.id}" data-mode="${hasText ? 'reweave' : 'write'}"
                                title="${hasText ? 'Rewrite it to fit the character as it is now' : 'Write it from the character'}" ${busy ? 'disabled' : ''}>${hasText ? '✦ Re-weave' : '✦ Write'}</button>
                            <button type="button" class="ws-ai-btn" data-action="workshop-opening-takes" data-opening="${sc.id}"
                                title="Three really different ways to start" ${busy ? 'disabled' : ''}>✦ 3 takes</button>
                            <button type="button" class="ws-btn" data-action="workshop-cw-about" data-about="${`the opening "${label}"`}" title="Talk it over with the co-writer">Talk it over</button>
                            ${status}
                        </div>
                        ${proposal}
                    </div>`;
            },

            _openingProposalBlock(id, p) {
                return DOM.html`
                    <div class="ws-proposal">
                        <div class="ws-proposal-head"><span>${p.mode === 'reweave' ? 'Re-woven by the AI' : 'Written by the AI'}. Nothing changes until you use it.</span></div>
                        <div class="ws-text is-proposal">${p.text}</div>
                        <div class="ws-proposal-actions">
                            <button type="button" class="ws-btn is-primary" data-action="workshop-opening-accept" data-opening="${id}">Use it</button>
                            <button type="button" class="ws-btn" data-action="workshop-opening-discard" data-opening="${id}">Discard</button>
                        </div>
                    </div>`;
            },

            /** Three openings to choose from: use one here, add one as another opening, or turn one down. */
            _openingTakesBlock(id, p, busy) {
                const names = ['Safest', 'Grounded', 'Inventive', 'Bold', 'Wildest'];
                const dial = names.map((name, i) => DOM.html`
                    <button type="button" class="ws-dial-btn${i + 1 === p.creativity ? ' is-on' : ''}" data-action="workshop-opening-takes" data-opening="${id}"
                        data-creativity="${i + 1}" title="${name}" aria-label="Three new takes, ${name.toLowerCase()}" ${busy ? 'disabled' : ''}>${i + 1}</button>`);
                const takes = p.takes.map((t, i) => DOM.html`
                    <div class="ws-take">
                        <div class="ws-proposal-head"><span class="ws-take-angle">${t.angle}</span></div>
                        <div class="ws-text is-proposal">${t.text}</div>
                        <div class="ws-proposal-actions">
                            <button type="button" class="ws-btn is-primary" data-action="workshop-opening-take-use" data-opening="${id}" data-index="${i}">Use this</button>
                            <button type="button" class="ws-btn" data-action="workshop-opening-take-new" data-opening="${id}" data-index="${i}"
                                title="Keep this opening, and add the take as another way to start">Add as a new opening</button>
                            <button type="button" class="ws-btn" data-action="workshop-opening-take-reject" data-opening="${id}" data-index="${i}"
                                title="Drop it, and steer the next takes away from it">Not this</button>
                        </div>
                    </div>`);
                return DOM.html`
                    <div class="ws-takes">
                        <div class="ws-proposal-head">
                            <span>${p.takes.length === 1 ? 'One take left.' : `${p.takes.length} takes.`} Nothing changes until you use one.</span>
                            <button type="button" class="ws-link" data-action="workshop-opening-discard" data-opening="${id}">Close</button>
                        </div>
                        ${takes}
                        <div class="ws-dial-row"><span>Three new takes, from safest to wildest:</span><span class="ws-dial" role="group">${dial}</span></div>
                    </div>`;
            },

            _examplesBlock(state, name, busy, errors) {
                const view = this.RUNTIME.view;
                const examples = this._examples(view, state);
                const hasText = !!examples.trim();
                let body;
                if (view.editing === '_examples') {
                    body = DOM.html`<textarea class="ws-field" data-ws-field="examples" rows="5" aria-label="Example dialogue">${examples}</textarea>`;
                } else if (hasText) {
                    body = DOM.html`<div class="ws-text" data-action="workshop-examples-edit" role="button" tabindex="0" aria-label="Edit the example dialogue">${examples}</div>`;
                } else {
                    body = DOM.html`<div class="ws-text is-empty" data-action="workshop-examples-edit" role="button" tabindex="0">None yet. Tap to write some yourself.</div>`;
                }
                const character = this._character(view.charId);
                const copy = character && WorkshopStore.hasExampleCopy(character.model_instructions) ? DOM.html`
                    <div class="ws-notice">
                        <span>${name}'s instructions also hold a copy of the example dialogue from when the card was imported, so every reply reads it twice.</span>
                        <button type="button" class="ws-btn" data-action="workshop-examples-uncopy">Remove the copy</button>
                    </div>` : '';
                const chat = ReactiveStore.state && Array.isArray(ReactiveStore.state.chat_history);
                const swapped = view.examplesSwap ? DOM.html`
                    <p class="ws-hint">The open chat reads these examples now. <button type="button" class="ws-link" data-action="workshop-examples-undo">Undo</button></p>` : '';
                const pending = (view.ws.pending || {})._examples;
                const proposal = !pending ? '' : DOM.html`
                    <div class="ws-proposal">
                        <div class="ws-proposal-head"><span>${pending.mode === 'reweave' ? 'Re-woven by the AI' : 'Written by the AI'}. Nothing changes until you use it.</span></div>
                        <div class="ws-text is-proposal">${pending.text}</div>
                        <div class="ws-proposal-actions">
                            <button type="button" class="ws-btn is-primary" data-action="workshop-examples-accept">Use it</button>
                            <button type="button" class="ws-btn" data-action="workshop-examples-discard">Discard</button>
                        </div>
                    </div>`;
                const status = errors._examples ? DOM.html`<span class="ws-status is-error">${errors._examples}</span>` : '';
                return DOM.html`
                    <div class="ws-examples">
                        <h4 class="ws-sub">Example dialogue</h4>
                        <p class="ws-hint">How ${name} talks. Replies read it as examples before the chat. One line per turn, starting {{user}}: or {{char}}:.</p>
                        ${copy}
                        ${body}
                        <div class="ws-ai-row">
                            <button type="button" class="ws-ai-btn" data-action="workshop-examples-write" data-mode="${hasText ? 'reweave' : 'write'}"
                                title="${hasText ? 'Rewrite it to fit the character as it is now' : 'Write some from the character'}" ${busy ? 'disabled' : ''}>${hasText ? '✦ Re-weave' : '✦ Write'}</button>
                            ${chat && hasText ? DOM.html`<button type="button" class="ws-btn" data-action="workshop-examples-to-chat"
                                title="The open chat started with its own copy of the examples. Swap in these.">Use in the open chat</button>` : ''}
                            <button type="button" class="ws-btn" data-action="workshop-cw-about" data-about="the example dialogue" title="Talk it over with the co-writer">Talk it over</button>
                            ${status}
                        </div>
                        ${swapped}
                        ${proposal}
                    </div>`;
            },

            /**
             * Changes an opening's name or message as a step in the history, keeping the story's own
             * text the first time, and the story follows when the step is saved.
             */
            _setOpening(id, patch, { summary, origin = 'you' } = {}) {
                const view = this.RUNTIME.view;
                const scenario = this._scenarios().find(s => s.id === id);
                if (!view || !scenario) return Promise.resolve();
                const current = WorkshopStore.openingIn(WorkshopStore.active(view.ws).state, view.ws.original, scenario);
                const next = {
                    name: patch.name ? patch.name : current.name,
                    message: patch.message !== undefined ? String(patch.message) : current.message
                };
                if (next.name === current.name && next.message === current.message) {
                    this.renderOpenings();
                    return Promise.resolve();
                }
                view.ws = WorkshopStore.keepOriginalOpening(view.ws, scenario);
                const what = summary || (next.name !== current.name ? `Renamed the opening "${current.name}" to "${next.name}"` : `Edited the opening "${current.name}"`);
                return this._change(what, state => { state.openings = { ...(state.openings || {}), [id]: next }; }, () => this.renderOpenings(), origin);
            },

            _setExamples(text, { summary, origin = 'you' } = {}) {
                const view = this.RUNTIME.view;
                if (!view) return Promise.resolve();
                const value = String(text || '');
                if (value === this._examples(view, WorkshopStore.active(view.ws).state)) {
                    this.renderOpenings();
                    return Promise.resolve();
                }
                view.ws = WorkshopStore.keepOriginalExamples(view.ws, WorkshopStore.storyExamples(this._scenarios(), view.charId));
                return this._change(summary || 'Edited the example dialogue', state => { state.examples = value; }, () => this.renderOpenings(), origin);
            },

            /** A new opening in the story, with the first opening's cast and knowledge, then a step that holds its text. */
            async addOpening(name, text, { summary, origin = 'you' } = {}) {
                const view = this.RUNTIME.view;
                const message = String(text || '').trim();
                if (!view) return;
                if (!message) {
                    UIManager.showNotification('Write how the chat starts first.', 'info');
                    return;
                }
                const title = String(name || '').trim() || `Opening ${this._scenarios().length + 1}`;
                const id = await this._addScenario(view, title, message);
                if (!id) {
                    UIManager.showNotification('Could not add the opening to the story.', 'error');
                    return;
                }
                view.editing = null;
                await this._change(summary || `Added the opening "${title}"`, state => { state.openings = { ...(state.openings || {}), [id]: { name: title, message } }; },
                    () => this.renderOpenings(), origin);
            },

            /** A new opening in the story, with the first opening's cast and knowledge. Its id, or null when the story could not take it. */
            async _addScenario(view, title, message) {
                const id = UTILITY.uuid();
                const made = await this._writeStory(story => {
                    const first = story.scenarios[0];
                    const scenario = first ? JSON.parse(JSON.stringify(first)) : { active_character_ids: (story.characters || []).map(c => c.id), example_dialogue: [] };
                    Object.assign(scenario, { id, name: title, message: WorkshopStore.storyText(message, this._cast(view).leadName) });
                    story.scenarios.push(scenario);
                    return true;
                });
                return made ? id : null;
            },

            async _writeOpening(view, name, id, reweave, onDelta) {
                const ask = WorkshopPrompts.writeOpening({ name, state: WorkshopStore.active(view.ws).state, extras: this._extras(view), openingId: id, reweave });
                const result = ask.read((await this._chat(view, ask, onDelta)).data);
                view.ws = WorkshopStore.setPending(view.ws, `o:${id}`, { kind: 'opening', mode: reweave ? 'reweave' : 'write', text: result.text, at: Date.now() });
                await this._saveWs(view);
            },

            async _openingTakes(view, name, id, creativity, onDelta) {
                const key = `o:${id}`;
                const previous = (view.ws.pending || {})[key];
                const level = creativity || (previous && previous.creativity) || 3;
                const ask = WorkshopPrompts.openingTakes({
                    name, state: WorkshopStore.active(view.ws).state, extras: this._extras(view), openingId: id, avoid: (view.ws.avoid || {})[key] || [], creativity: level
                });
                const takes = ask.read((await this._chat(view, ask, onDelta)).data);
                view.ws = WorkshopStore.setPending(view.ws, key, { kind: 'opening-takes', takes, creativity: level, at: Date.now() });
                await this._saveWs(view);
            },

            async _writeExamples(view, name, reweave, onDelta) {
                const ask = WorkshopPrompts.writeExamples({ name, state: WorkshopStore.active(view.ws).state, extras: this._extras(view), reweave });
                const result = ask.read((await this._chat(view, ask, onDelta)).data);
                view.ws = WorkshopStore.setPending(view.ws, '_examples', { kind: 'examples', mode: reweave ? 'reweave' : 'write', text: result.text, at: Date.now() });
                await this._saveWs(view);
            },

            _openingName(view, id) {
                const scenario = this._scenarios().find(s => s.id === id);
                return scenario ? WorkshopStore.openingIn(WorkshopStore.active(view.ws).state, view.ws.original, scenario).name : 'the opening';
            },

            acceptOpening(id) {
                const view = this.RUNTIME.view;
                const key = `o:${id}`;
                const p = view && (view.ws.pending || {})[key];
                if (!p || p.kind !== 'opening') return Promise.resolve();
                return this._useOpeningText(id, key, p.text, `${p.mode === 'reweave' ? 'Re-wove' : 'Wrote'} the opening "${this._openingName(view, id)}" with the AI`);
            },

            /** Puts the AI's text into an opening as one step, and the proposal goes with it. */
            _useOpeningText(id, key, text, summary) {
                const view = this.RUNTIME.view;
                const scenario = this._scenarios().find(s => s.id === id);
                const cleared = WorkshopStore.setPending(view.ws, key, null);
                if (!scenario || WorkshopStore.openingIn(WorkshopStore.active(view.ws).state, view.ws.original, scenario).message === text) {
                    return this._commitWs(cleared, () => this.renderOpenings());
                }
                view.ws = cleared;
                return this._setOpening(id, { message: text }, { summary, origin: 'ai' });
            },

            discardOpening(id) {
                const view = this.RUNTIME.view;
                if (!view) return Promise.resolve();
                return this._commitWs(WorkshopStore.setPending(view.ws, `o:${id}`, null), () => this.renderOpenings());
            },

            useOpeningTake(id, index) {
                const view = this.RUNTIME.view;
                const key = `o:${id}`;
                const p = view && (view.ws.pending || {})[key];
                const take = p && p.kind === 'opening-takes' && p.takes[index];
                if (!take) return Promise.resolve();
                return this._useOpeningText(id, key, take.text, `Took "${take.angle}" for the opening "${this._openingName(view, id)}"`);
            },

            /** Keeps the opening as it is and adds the take as another way to start, named after its angle. */
            newOpeningFromTake(id, index) {
                const view = this.RUNTIME.view;
                const key = `o:${id}`;
                const p = view && (view.ws.pending || {})[key];
                const take = p && p.kind === 'opening-takes' && p.takes[index];
                if (!take) return Promise.resolve();
                const rest = p.takes.filter((t, i) => i !== index);
                view.ws = WorkshopStore.setPending(view.ws, key, rest.length ? { ...p, takes: rest } : null);
                return this.addOpening(take.angle, take.text, { origin: 'ai' });
            },

            rejectOpeningTake(id, index) {
                const view = this.RUNTIME.view;
                const key = `o:${id}`;
                const p = view && (view.ws.pending || {})[key];
                const take = p && p.kind === 'opening-takes' && p.takes[index];
                if (!take) return Promise.resolve();
                const rest = p.takes.filter((t, i) => i !== index);
                const ws = WorkshopStore.addAvoid(view.ws, key, take.angle);
                return this._commitWs(WorkshopStore.setPending(ws, key, rest.length ? { ...p, takes: rest } : null), () => this.renderOpenings());
            },

            acceptExamples() {
                const view = this.RUNTIME.view;
                const p = view && (view.ws.pending || {})._examples;
                if (!p) return Promise.resolve();
                const cleared = WorkshopStore.setPending(view.ws, '_examples', null);
                if (p.text === this._examples(view, WorkshopStore.active(view.ws).state)) return this._commitWs(cleared, () => this.renderOpenings());
                view.ws = cleared;
                return this._setExamples(p.text, { summary: `${p.mode === 'reweave' ? 'Re-wove' : 'Wrote'} the example dialogue with the AI`, origin: 'ai' });
            },

            discardExamples() {
                const view = this.RUNTIME.view;
                if (!view) return Promise.resolve();
                return this._commitWs(WorkshopStore.setPending(view.ws, '_examples', null), () => this.renderOpenings());
            },

            /**
             * The open chat copied its opening's examples when it began. Swaps that copy for the
             * examples as they are now, keeping every message of the chat; Undo swaps it back.
             */
            useExamplesInChat() {
                const view = this.RUNTIME.view;
                const state = ReactiveStore.state;
                if (!view || !state || !Array.isArray(state.chat_history)) return;
                const cast = this._cast(view);
                const turns = WorkshopStore.turnsFromExamples(this._examples(view, WorkshopStore.active(view.ws).state), cast.leadId, cast.userId, Date.now(), cast.leadName);
                const history = JSON.parse(JSON.stringify(state.chat_history));
                const isExample = m => m && m.isHidden && m.type === 'chat';
                view.examplesSwap = history.filter(isExample);
                state.chat_history = [...turns, ...history.filter(m => !isExample(m))];
                this.renderOpenings();
            },

            undoExamplesInChat() {
                const view = this.RUNTIME.view;
                const state = ReactiveStore.state;
                if (!view || !view.examplesSwap || !state) return;
                const history = JSON.parse(JSON.stringify(state.chat_history || []));
                state.chat_history = [...view.examplesSwap, ...history.filter(m => !(m && m.isHidden && m.type === 'chat'))];
                view.examplesSwap = null;
                this.renderOpenings();
            },

            /** Takes out the copy of the example dialogue that card import used to paste into the instructions. */
            removeExampleCopy() {
                const view = this.RUNTIME.view;
                const character = view && this._character(view.charId);
                if (!character || !WorkshopStore.hasExampleCopy(character.model_instructions)) return;
                character.model_instructions = WorkshopStore.withoutExampleCopy(character.model_instructions);
                UIManager.showNotification('Took the copy out of the instructions. Replies read the example dialogue once now.', 'success');
                this.renderOpenings();
            },

            // ---------------------------------------------------------------------------------------
            // The co-writer: a chat about the character, with a notebook of what was decided.
            // ---------------------------------------------------------------------------------------

            /** The chat on screen, or none when no chat has been started. */
            _openChat(view) {
                const cw = WorkshopStore.cowriterOf(view.ws);
                return cw.chats.find(c => c.id === cw.open && !c.hiddenAt) || null;
            },

            /** How many messages anyone can see in the open chat, its opening included. */
            _playCount() {
                const history = (ReactiveStore.state && ReactiveStore.state.chat_history) || [];
                return history.filter(m => m && m.type === 'chat' && !m.isHidden && String(m.content || '').trim()).length;
            },

            /** A phone, or a window as narrow as one, where Enter makes a new line instead of sending. */
            _narrow() {
                return !!(document.body && document.body.classList.contains('layout-vertical'))
                    || !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
            },

            renderCowriter() {
                if (!this.RUNTIME.view) return;
                this.renderCowriterHead();
                this.renderCowriterLog();
                this.renderCowriterMenu();
                this.renderCowriterDot();
            },

            /** The bar: the chat's name, which opens the list of chats, the notebook, and a new chat. */
            renderCowriterHead() {
                const view = this.RUNTIME.view;
                const head = document.getElementById('ws-cw-head');
                if (!head || !view) return;
                const chat = this._openChat(view);
                const decisions = (WorkshopStore.active(view.ws).state.notebook || []).length;
                head.innerHTML = DOM.html`
                    <button type="button" class="ws-cw-title" data-action="workshop-cw-sheet" data-sheet="chats" title="Chats with the co-writer">
                        <span class="ws-cw-title-text">${chat ? chat.title : 'New chat'}</span>${DOM.unsafe(this.ICONS.down)}</button>
                    <button type="button" class="ws-cw-chip" data-action="workshop-cw-sheet" data-sheet="notebook" title="What was decided, and why">${DOM.unsafe(this.ICONS.book)}Notebook · ${decisions}</button>
                    <button type="button" class="ws-icon-btn" data-action="workshop-cw-new" aria-label="New chat" title="New chat">${DOM.unsafe(this.ICONS.plus)}</button>`.toString();
            },

            /** The chat: what the co-writer reads, the messages, a reply arriving, and what went wrong. */
            renderCowriterLog(toEnd = false) {
                const view = this.RUNTIME.view;
                const log = document.getElementById('ws-cw-log');
                if (!log || !view) return;
                // Never while another answer is being typed: redrawing would throw it away.
                const typing = document.activeElement;
                if (typing && log.contains(typing) && typing.matches('input, textarea')) return;
                const near = log.scrollHeight - log.scrollTop - log.clientHeight < 160;
                const chat = this._openChat(view);
                const streaming = (view.cwStreaming && chat && view.cwStreaming.chatId === chat.id) ? view.cwStreaming : null;
                // A reroll streams in where the reply it replaces was.
                const messages = chat ? (streaming && streaming.reroll ? chat.messages.slice(0, -1) : chat.messages) : [];
                const error = (view.errors || {})._cowriter;
                const undo = this._logUndo(view, chat);
                const parts = [this._readsBlock(view)];
                messages.forEach((m, i) => {
                    if (undo && undo.at === i) parts.push(this._logUndoLine(undo));
                    parts.push(this._cwMessage(m, { isLast: i === messages.length - 1 && !streaming, after: messages.length - 1 - i, failed: !!error && !view.busy }));
                });
                if (undo && undo.at >= messages.length) parts.push(this._logUndoLine(undo));
                if (messages.length === 0 && !streaming) parts.push(this._emptyChat(view));
                if (streaming) {
                    parts.push(DOM.html`
                        <div class="ws-cw-msg is-cowriter">
                            <div class="ws-cw-who">Co-writer</div>
                            <div id="ws-cw-stream" class="ws-cw-say is-streaming">${this._shownWhileStreaming(streaming.text)}</div>
                        </div>`.toString());
                }
                if (error && !view.busy) {
                    parts.push(DOM.html`
                        <div class="ws-cw-error"><span>${error}</span><button type="button" class="ws-btn" data-action="workshop-cw-retry">Try again</button></div>`.toString());
                }
                log.innerHTML = parts.join('');
                if (toEnd || near) log.scrollTop = log.scrollHeight;
            },

            /** While a reply streams in, its words; a suggestion or question being written stays out of sight until it's read. */
            _shownWhileStreaming(text) {
                return String(text || '').split(/<(?:suggestion|card|ask)\b/i)[0];
            },

            _streamInto(text) {
                const view = this.RUNTIME.view;
                if (!view || !view.cwStreaming) return;
                view.cwStreaming.text = text;
                const el = document.getElementById('ws-cw-stream');
                if (el) el.textContent = this._shownWhileStreaming(text);
                const log = document.getElementById('ws-cw-log');
                if (log && log.scrollHeight - log.scrollTop - log.clientHeight < 200) log.scrollTop = log.scrollHeight;
            },

            _readsBlock(view) {
                const open = !!view.cwReadsOpen;
                return DOM.html`
                    <div class="ws-cw-reads">
                        <button type="button" class="ws-cw-reads-toggle" data-action="workshop-cw-reads" aria-expanded="${open ? 'true' : 'false'}">What it reads before every reply ${open ? '▴' : '▾'}</button>
                        ${open ? DOM.html`<ul>${this._reads(view).map(item => DOM.html`<li>${item}</li>`)}</ul>` : ''}
                    </div>`.toString();
            },

            /** What the next request will carry, in plain words. */
            _reads(view) {
                const state = WorkshopStore.active(view.ws).state;
                const character = this._character(view.charId);
                const pins = state.sections.reduce((n, s) => n + s.pins.length, 0);
                const decisions = (state.notebook || []).length;
                const steps = WorkshopStore.lineage(view.ws, WorkshopStore.active(view.ws).head).length;
                const items = [`${(character && character.name) || 'The character'}: the concept, the ${state.sections.length} sections and their pins (${pins}), and what's locked`];
                if (this._ownsOpenings(view)) items.push('The openings and the example dialogue');
                items.push(`The story notes, and ${decisions === 1 ? 'the decision' : `the ${decisions} decisions`} in the notebook`);
                items.push(`The last ${Math.min(steps, CowriterPrompts.LIMITS.history)} steps of the history`);
                const play = this._playCount();
                if (play) {
                    const read = play === 1 ? 'its one message' : `its last ${Math.min(play, CowriterPrompts.LIMITS.playMessages)} messages`;
                    items.push(`The open chat: ${read}, the timeline, relationships and World Knowledge`);
                }
                items.push(`This chat, up to its last ${this._turnsRead()} messages`);
                // Only OpenRouter is sent a thinking level; local servers think as their model does.
                const cfg = WorkshopAI.settings();
                const thinking = cfg.backend === 'openrouter' && cfg.reasoning && cfg.reasoning !== 'off' ? `, thinking at ${cfg.reasoning}` : '';
                items.push(`It answers with ${cfg.model || 'the loaded model'}${thinking}.`);
                return items;
            },

            /** How many of a chat's last messages the co-writer reads: more on OpenRouter, fewer for a local model with less room. */
            _turnsRead() {
                return WorkshopAI.settings().backend === 'openrouter' ? CowriterPrompts.LIMITS.turnsOpenRouter : CowriterPrompts.LIMITS.turns;
            },

            /** Ways to start a chat. What happened in play waits until the open chat has more than its opening. */
            _starters(view) {
                const character = this._character(view.charId);
                const name = (character && character.name) || 'this character';
                const list = [
                    { id: 'interview', label: 'Interview me', hint: 'One question at a time, with choices to tap.', say: `Interview me about ${name}, one question at a time, with choices to tap.` },
                    { id: 'pitch', label: 'Pitch ideas', hint: 'Directions for the character and the story, and which one it would pick.', say: `Pitch me some directions for ${name} and the story, and say which one you'd pick.` },
                    { id: 'missing', label: "What's missing?", hint: 'Gaps, thin spots and contradictions, most important first.', say: `What's missing or thin on ${name}'s card, or contradicts itself? Most important first.` }
                ];
                const play = this._playCount();
                if (play >= 2) {
                    list.push({ id: 'play', label: 'What happened in play?', hint: `Reads the open chat (${play} messages) for what the card doesn't have yet.`, say: `What has happened in play that isn't on ${name}'s card yet?` });
                }
                return list;
            },

            _startersHtml(view) {
                return this._starters(view).map(s => DOM.html`
                    <button type="button" class="ws-cw-starter" data-action="workshop-cw-starter" data-starter="${s.id}" ${view.busy ? 'disabled' : ''}><strong>${s.label}</strong><span>${s.hint}</span></button>`);
            },

            _emptyChat(view) {
                const character = this._character(view.charId);
                return DOM.html`
                    <div class="ws-cw-starters">
                        <p class="ws-hint">Ask anything about ${(character && character.name) || 'the character'}, or start with one of these.</p>
                        ${this._startersHtml(view)}
                    </div>`.toString();
            },

            /** The ways to start, behind ✦ beside the box. */
            renderCowriterMenu() {
                const view = this.RUNTIME.view;
                const menu = document.getElementById('ws-cw-starters');
                if (!menu || !view) return;
                if (view.cwMenu) menu.classList.remove('hidden');
                else menu.classList.add('hidden');
                menu.innerHTML = view.cwMenu ? DOM.html`${this._startersHtml(view)}`.toString() : '';
            },

            _cwMessage(m, { isLast = false, after = 0, failed = false } = {}) {
                if (m.role === 'you') {
                    return DOM.html`
                        <div class="ws-cw-you">
                            <div class="ws-cw-msg is-you">${m.text}</div>
                            ${this._cwActions(m, { isLast, after, failed })}
                        </div>`.toString();
                }
                const unread = (m.unreadable || []).map(u => DOM.html`
                    <details class="ws-cw-unread"><summary>Part of this reply couldn't be read. ${u.reason}</summary><pre>${u.raw}</pre></details>`);
                return DOM.html`
                    <div class="ws-cw-msg is-cowriter">
                        <div class="ws-cw-who">Co-writer<span class="ws-cw-model">${String(m.model || '').split('/').pop()}</span></div>
                        ${m.text ? DOM.html`<div class="ws-cw-say">${DOM.unsafe(this._cwFormat(m.text))}</div>` : ''}
                        ${m.stopped ? DOM.html`<p class="ws-hint">Stopped.</p>` : ''}
                        ${m.ask ? this._askBlock(m, isLast) : ''}
                        ${this._cardsBlock(m)}
                        ${unread}
                        ${this._cwActions(m, { isLast, after })}
                    </div>`.toString();
            },

            /**
             * Under a message: Edit on yours, Reroll and its versions on the newest reply, Delete on
             * every one. Your newest message, when nothing answered it, can get a reply.
             */
            _cwActions(m, { isLast, after, failed }) {
                const view = this.RUNTIME.view;
                const off = view.busy ? 'disabled' : '';
                const chat = this._openChat(view);
                if (this._deleting(view, chat) === m.id) {
                    return DOM.html`
                        <div class="ws-cw-actions is-asking" role="group" aria-label="Delete what?">
                            <span>Delete:</span>
                            <button type="button" class="ws-cw-act is-danger" data-action="workshop-cw-delete-one" data-message="${m.id}" ${off}>Just this one</button>
                            <button type="button" class="ws-cw-act is-danger" data-action="workshop-cw-delete-after" data-message="${m.id}" ${off}>This and the ${after === 1 ? 'one' : after} after it</button>
                            <button type="button" class="ws-cw-act" data-action="workshop-cw-delete-cancel">Cancel</button>
                        </div>`;
                }
                const items = [];
                if (m.role === 'you') {
                    items.push(DOM.html`<button type="button" class="ws-cw-act" data-action="workshop-cw-edit" data-message="${m.id}" ${off} title="Take this and everything after it out, and change what you said">Edit</button>`);
                    if (isLast && !failed) items.push(DOM.html`<button type="button" class="ws-cw-act" data-action="workshop-cw-retry" ${off}>Get a reply</button>`);
                } else if (isLast) {
                    const count = Array.isArray(m.versions) ? m.versions.length : 1;
                    const at = m.shown || 0;
                    if (count > 1) {
                        items.push(DOM.html`
                            <span class="ws-cw-versions">
                                <button type="button" class="ws-cw-ver" data-action="workshop-cw-version" data-message="${m.id}" data-step="-1" aria-label="Earlier version" ${off || (at === 0 ? 'disabled' : '')}>‹</button>
                                <span>${at + 1}/${count}</span>
                                <button type="button" class="ws-cw-ver" data-action="workshop-cw-version" data-message="${m.id}" data-step="1" aria-label="Later version" ${off || (at === count - 1 ? 'disabled' : '')}>›</button>
                            </span>`);
                    }
                    items.push(DOM.html`<button type="button" class="ws-cw-act" data-action="workshop-cw-reroll" data-message="${m.id}" ${off} title="Ask again; this reply is kept to flip back to">Reroll</button>`);
                }
                items.push(DOM.html`<button type="button" class="ws-cw-act" data-action="workshop-cw-delete" data-message="${m.id}" ${off}>Delete</button>`);
                return DOM.html`<div class="ws-cw-actions">${items}</div>`;
            },

            /** The message waiting for "just this one, or everything after", while nothing has changed in the chat since. */
            _deleting(view, chat) {
                const d = view.cwDeleting;
                return (d && chat && d.messages === chat.messages) ? d.id : null;
            },

            /** The Undo for messages just taken out, while nothing has changed in that chat since. */
            _logUndo(view, chat) {
                const undo = view.cwLogUndo;
                return (undo && chat && undo.chatId === chat.id && undo.messages === chat.messages) ? undo : null;
            },

            _logUndoLine(undo) {
                return DOM.html`<p class="ws-hint ws-cw-undo">${undo.text} <button type="button" class="ws-link" data-action="workshop-cw-log-undo">Undo</button></p>`.toString();
            },

            /** A question with its choices. Only the newest one can be answered; a choice, once made, stays. */
            _askBlock(m, isLast) {
                const view = this.RUNTIME.view;
                const a = m.ask;
                const answered = a.picked !== null && a.picked !== undefined;
                const off = answered || !isLast || !!view.busy;
                const choices = a.options.map((option, i) => DOM.html`
                    <button type="button" class="ws-cw-choice${a.picked === i ? ' is-picked' : ''}" data-action="workshop-cw-pick" data-message="${m.id}" data-index="${i}" ${off ? 'disabled' : ''}>${option}</button>`);
                let other = '';
                if (answered && a.picked === 'other') other = DOM.html`<p class="ws-hint">You answered in your own words.</p>`;
                else if (!answered && isLast) {
                    other = DOM.html`
                        <div class="ws-cw-other">
                            <input type="text" id="ws-cw-other" class="ws-cw-other-input" placeholder="Something else…" aria-label="Your own answer" ${view.busy ? 'disabled' : ''}>
                            <button type="button" class="ws-btn" data-action="workshop-cw-other" ${view.busy ? 'disabled' : ''}>Send</button>
                        </div>`;
                }
                return DOM.html`
                    <div class="ws-cw-ask" role="group" aria-label="${a.question}">
                        <div class="ws-cw-ask-q">${a.question}</div>
                        ${choices}
                        ${other}
                    </div>`;
            },

            /** A reply as HTML: escaped, with **bold** and *italics* kept. */
            _cwFormat(text) {
                return this._esc(text)
                    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
                    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
            },

            /** Sends what is in the box. Refused, and left in the box, while the AI is busy. */
            sendFromBox() {
                const view = this.RUNTIME.view;
                const box = document.getElementById('ws-cw-input');
                const text = box ? String(box.value || '') : '';
                if (!view || !text.trim()) return Promise.resolve();
                if (view.busy) {
                    UIManager.showNotification('Wait for the AI to finish, or stop it, first.', 'info');
                    return Promise.resolve();
                }
                box.value = '';
                return this.cowriterSend(text);
            },

            /**
             * Adds your message to the chat on screen, starting one if there is none, and asks the
             * co-writer to answer. A question still open is answered by it: the choice tapped, or
             * your own words.
             */
            async cowriterSend(text, { picked, title } = {}) {
                const view = this.RUNTIME.view;
                const words = String(text || '').trim();
                if (!view || !words) return;
                if (view.busy) {
                    UIManager.showNotification('Wait for the AI to finish, or stop it, first.', 'info');
                    return;
                }
                let ws = view.ws;
                let chat = this._openChat(view);
                if (!chat) {
                    ws = WorkshopStore.newChat(ws);
                    chat = WorkshopStore.cowriterOf(ws).chats[0];
                }
                // A chat begun with a starter is named after it, rather than after its long request.
                if (title && chat.messages.length === 0 && chat.title === 'New chat') ws = WorkshopStore.renameChat(ws, chat.id, title);
                const last = chat.messages[chat.messages.length - 1];
                if (last && last.ask && (last.ask.picked === null || last.ask.picked === undefined)) {
                    ws = WorkshopStore.updateMessage(ws, chat.id, last.id, { ask: { ...last.ask, picked: picked === undefined ? 'other' : picked } });
                }
                view.ws = WorkshopStore.addMessage(ws, chat.id, { role: 'you', text: words, variant: ws.active });
                view.cwMenu = false;
                this.renderCowriterHead();
                this.renderCowriterMenu();
                this.renderCowriterLog(true);
                await this._saveWs(view);
                await this._ask('cowriter', null, null, chat.id);
            },

            cowriterPick(messageId, index) {
                const view = this.RUNTIME.view;
                const chat = view && this._openChat(view);
                const last = chat && chat.messages[chat.messages.length - 1];
                if (!last || last.id !== messageId || !last.ask || (last.ask.picked !== null && last.ask.picked !== undefined)) return Promise.resolve();
                const option = last.ask.options[index];
                return option === undefined ? Promise.resolve() : this.cowriterSend(option, { picked: index });
            },

            /**
             * Asks again without a new message: after a failure, or for a reply to your newest
             * message. When the co-writer spoke last, that reply is rerolled.
             */
            cowriterRetry() {
                const view = this.RUNTIME.view;
                const chat = view && this._openChat(view);
                if (!chat || chat.messages.length === 0 || view.busy) return Promise.resolve();
                view.cwDeleting = null;
                return this._ask('cowriter', null, null, chat.id);
            },

            /**
             * One reply: everything the co-writer reads goes with the chat so far, the words appear
             * as they arrive, and the reply is kept with its question. Stop keeps what was said.
             * When the co-writer spoke last, this is a reroll: the same request again without that
             * reply, and the new one is kept beside it as another version.
             */
            async _cowriterReply(view, name, chatId, onDelta) {
                const cw = WorkshopStore.cowriterOf(view.ws);
                const chat = cw.chats.find(c => c.id === chatId);
                if (!chat) return;
                const last = chat.messages[chat.messages.length - 1];
                const again = last && last.role === 'cowriter' ? last : null;
                const keep = reply => {
                    view.ws = again ? WorkshopStore.addVersion(view.ws, chatId, again.id, reply) : WorkshopStore.addMessage(view.ws, chatId, reply);
                };
                const active = WorkshopStore.active(view.ws);
                const characters = (ReactiveStore.state && ReactiveStore.state.characters) || [];
                const { messages, labels } = CowriterPrompts.request({
                    name, state: active.state, extras: this._extras(view),
                    variants: { active: active.name, others: view.ws.variants.filter(v => !v.deletedAt && v.id !== active.id).map(v => v.name) },
                    history: WorkshopStore.lineage(view.ws, active.head).reverse().map(c => ({ at: c.at, origin: c.origin, summary: c.summary })),
                    play: CowriterPrompts.playFrom(ReactiveStore.state, { characters, leadId: view.charId }),
                    chat: again ? { ...chat, messages: chat.messages.slice(0, -1) } : chat, cards: cw.cards, withCards: true,
                    turns: this._turnsRead()
                });
                view.cwStreaming = { chatId, text: '', reroll: !!again };
                if (this.RUNTIME.view === view) this.renderCowriterLog(true);
                let reply;
                try {
                    reply = await WorkshopAI.chat({
                        messages, signal: view.busy.controller.signal,
                        onDelta: delta => {
                            onDelta(delta);
                            if (this.RUNTIME.view === view) this._streamInto(delta.text);
                        }
                    });
                } catch (err) {
                    const said = CowriterPrompts.readReply(view.cwStreaming ? view.cwStreaming.text : '', labels).prose;
                    view.cwStreaming = null;
                    if (err && err.name === 'AbortError' && said) {
                        keep({ role: 'cowriter', text: said, stopped: true, variant: view.ws.active });
                        await this._saveWs(view);
                    }
                    throw err;
                }
                view.cwStreaming = null;
                const read = CowriterPrompts.readReply(reply.text, labels);
                const message = { role: 'cowriter', text: read.prose, variant: view.ws.active, model: WorkshopAI.settings().model || '', provider: reply.provider || '' };
                if (read.ask) message.ask = { ...read.ask, picked: null };
                if (read.unreadable.length) message.unreadable = read.unreadable;
                keep(message);
                // Its cards wait under it, each marked with the variant it was written for.
                const shown = WorkshopStore.cowriterOf(view.ws).chats.find(c => c.id === chatId);
                const messageId = again ? again.id : shown.messages[shown.messages.length - 1].id;
                if (read.cards.length) {
                    view.ws = WorkshopStore.addCards(view.ws, chatId, messageId, read.cards.map(card => this._withBasis(view, card)), { variant: view.ws.active });
                }
                await this._saveWs(view);
                if (read.cards.length) await this._draftCards(view, name, messageId, onDelta);
            },

            /** Reroll: the newest reply asked for again. The new one shows, and the old one is kept to flip back to. */
            cowriterReroll(messageId) {
                const view = this.RUNTIME.view;
                const chat = view && this._openChat(view);
                const last = chat && chat.messages[chat.messages.length - 1];
                if (!last || last.id !== messageId || last.role !== 'cowriter') return Promise.resolve();
                if (view.busy) {
                    UIManager.showNotification('Wait for the AI to finish, or stop it, first.', 'info');
                    return Promise.resolve();
                }
                view.cwDeleting = null;
                return this._ask('cowriter', null, null, chat.id);
            },

            /** Flips the newest reply to an earlier or later version. */
            cowriterVersion(messageId, step) {
                const view = this.RUNTIME.view;
                const chat = view && this._openChat(view);
                const last = chat && chat.messages[chat.messages.length - 1];
                if (!last || last.id !== messageId || !Array.isArray(last.versions) || view.busy) return Promise.resolve();
                const index = Math.min(Math.max((last.shown || 0) + (step < 0 ? -1 : 1), 0), last.versions.length - 1);
                if (index === last.shown) return Promise.resolve();
                view.ws = WorkshopStore.showVersion(view.ws, chat.id, messageId, index);
                this.renderCowriterLog();
                return this._saveWs(view);
            },

            /** Delete: the newest message goes at once; one with messages after it asks first: just it, or it and everything after. */
            cowriterDelete(messageId) {
                const view = this.RUNTIME.view;
                const chat = view && this._openChat(view);
                const at = chat ? chat.messages.findIndex(m => m.id === messageId) : -1;
                if (at === -1) return Promise.resolve();
                if (view.busy) {
                    UIManager.showNotification('Wait for the AI to finish, or stop it, first.', 'info');
                    return Promise.resolve();
                }
                if (at === chat.messages.length - 1) return this._cowriterCut(messageId);
                view.cwDeleting = { id: messageId, messages: chat.messages };
                this.renderCowriterLog();
                return Promise.resolve();
            },

            /**
             * Takes messages out of the open chat, with Undo instead of asking first. Edit takes your
             * message and everything after it, and puts your words back in the box to change.
             */
            _cowriterCut(messageId, { after = false, edit = false } = {}) {
                const view = this.RUNTIME.view;
                const chat = view && this._openChat(view);
                const at = chat ? chat.messages.findIndex(m => m.id === messageId) : -1;
                if (at === -1 || (edit && chat.messages[at].role !== 'you')) return Promise.resolve();
                if (view.busy) {
                    UIManager.showNotification('Wait for the AI to finish, or stop it, first.', 'info');
                    return Promise.resolve();
                }
                const before = chat.messages;
                const words = String(before[at].text || '');
                view.ws = WorkshopStore.removeMessages(view.ws, chat.id, messageId, { after: after || edit });
                const messages = this._openChat(view).messages;
                const gone = before.length - messages.length;
                const box = document.getElementById('ws-cw-input');
                view.cwDeleting = null;
                view.errors = { ...(view.errors || {}), _cowriter: null };
                view.cwLogUndo = {
                    chatId: chat.id, at, messages,
                    text: edit
                        ? `Took out your message${gone > 1 ? ` and the ${gone === 2 ? 'one' : gone - 1} after it` : ''}. Your words are in the box to change.`
                        : `Deleted ${gone === 1 ? 'a message' : `${gone} messages`}.`,
                    run: () => {
                        view.ws = WorkshopStore.putMessages(view.ws, chat.id, before);
                        if (edit && box && box.value === words) box.value = '';
                        this.renderCowriter();
                        return this._saveWs(view);
                    }
                };
                this.renderCowriter();
                if (edit && box) {
                    box.value = words;
                    box.focus();
                    if (box.setSelectionRange) box.setSelectionRange(words.length, words.length);
                }
                return this._saveWs(view);
            },

            // ---------------------------------------------------------------------------------------
            // Suggestions: what the co-writer proposes, under its reply. The code calls them cards;
            // on screen they are suggestions, since to the author a card is the finished character
            // card. Nothing changes until one is used, and each use is one step in the history.
            // ---------------------------------------------------------------------------------------

            /** Cards the Workshop's writer writes from the co-writer's brief: rewrites, openings and the example dialogue. */
            _isWritten(card) {
                return card.type === 'rewrite' || card.type === 'opening' || card.type === 'examples';
            },

            /** A new card with what its part says now, so a later change to that part shows on it. Written cards note theirs when written. */
            _withBasis(view, card) {
                return this._isWritten(card) ? card : { ...card, basis: this._cardPart(view, card) };
            },

            /** What the part a card changes says now: '' when there is nothing to compare, null when the part is gone. */
            _cardPart(view, card) {
                const state = WorkshopStore.active(view.ws).state;
                const section = state.sections.find(s => s.id === card.section);
                switch (card.type) {
                    case 'pin': {
                        if (!section) return null;
                        if (card.action === 'add') return '';
                        const pin = section.pins.find(p => p.id === card.pin);
                        return pin ? pin.text : null;
                    }
                    case 'rewrite':
                        return section ? String(section.text || '') : null;
                    case 'opening': {
                        if (!card.opening) return '';
                        const scenario = this._scenarios().find(s => s.id === card.opening);
                        return scenario ? WorkshopStore.openingIn(state, view.ws.original, scenario).message : null;
                    }
                    case 'examples':
                        return this._examples(view, state);
                    case 'notes':
                    case 'concept':
                        return String(state[card.type] || '');
                    case 'decision': {
                        if (card.action === 'add') return '';
                        const decision = (state.notebook || []).find(d => d.id === card.decision);
                        return decision ? decision.text : null;
                    }
                    default:
                        return '';
                }
            },

            /** Why a waiting card can't be used now, or null: it was written for another variant, its section is locked, or its part is gone. */
            _cardProblem(view, card) {
                if (card.variant && card.variant !== view.ws.active) {
                    const variant = view.ws.variants.find(v => v.id === card.variant);
                    return `Written for ${variant ? variant.name : 'another variant'}. Switch to it to use this.`;
                }
                const section = WorkshopStore.active(view.ws).state.sections.find(s => s.id === card.section);
                if (card.type === 'rewrite' && section && section.locked) return `${section.title} is locked. Unlock it to rewrite it.`;
                if (this._cardPart(view, card) !== null) return null;
                return { pin: 'Its pin is gone.', decision: 'That decision is gone.', opening: 'That opening is gone from the story.' }[card.type] || 'That section is gone.';
            },

            /** Whether the part a card changes was changed since the card was written. */
            _cardChanged(view, card) {
                const basis = this._isWritten(card) ? (card.draft ? card.draft.basis : undefined) : card.basis;
                if (basis === undefined || basis === null) return false;
                const part = this._cardPart(view, card);
                return part !== null && part !== basis;
            },

            /** A card that can be used now. */
            _cardReady(view, card) {
                return card.status === 'waiting' && !this._cardProblem(view, card) && (!this._isWritten(card) || !!card.draft);
            },

            /** The chat and reply a card came with. */
            _cardMessage(view, cardId) {
                for (const chat of WorkshopStore.cowriterOf(view.ws).chats) {
                    const message = chat.messages.find(m => (m.cards || []).includes(cardId));
                    if (message) return { chat, message };
                }
                return null;
            },

            /** Cards waiting to be used on the variant in use, in the replies as they show now. */
            _waitingCards(view) {
                const cw = WorkshopStore.cowriterOf(view.ws);
                let count = 0;
                for (const chat of cw.chats) {
                    if (chat.hiddenAt) continue;
                    for (const m of chat.messages) {
                        for (const id of m.cards || []) {
                            const card = cw.cards[id];
                            if (card && card.status === 'waiting' && card.variant === view.ws.active) count += 1;
                        }
                    }
                }
                return count;
            },

            /** A dot on the Co-writer tab while cards wait. */
            renderCowriterDot() {
                const view = this.RUNTIME.view;
                const waiting = !!view && this._waitingCards(view) > 0;
                document.querySelectorAll('#character-workshop [data-action="workshop-tab"][data-tab="cowriter"]').forEach(btn => btn.classList.toggle('has-dot', waiting));
            },

            /** Right after a reply, the writer drafts each of its rewrite, opening and examples cards, one after another. */
            async _draftCards(view, name, messageId, onDelta) {
                const message = this._findMessage(view, messageId);
                const ids = ((message && message.cards) || []).filter(id => {
                    const card = WorkshopStore.cowriterOf(view.ws).cards[id];
                    return card && this._isWritten(card) && card.status === 'waiting' && !card.draft && !this._cardProblem(view, card);
                });
                for (const [i, id] of ids.entries()) {
                    view.busy.label = `Suggestion ${i + 1} of ${ids.length}: `;
                    await this._draftCard(view, name, id, onDelta);
                }
            },

            /** A reply in any chat, by its id. */
            _findMessage(view, messageId) {
                for (const chat of WorkshopStore.cowriterOf(view.ws).chats) {
                    const message = chat.messages.find(m => m.id === messageId);
                    if (message) return message;
                }
                return null;
            },

            /**
             * The writer drafts one rewrite, opening or examples card from the co-writer's brief, plus
             * your note when you asked for a change, and the draft notes what its part said then, for
             * the changed-since check. Drafts of the same reply's other rewrites are read as if used,
             * so the sections fit together. A failure stays on the card, to show with Write it; Stop
             * ends the job.
             */
            async _draftCard(view, name, cardId, onDelta) {
                const card = WorkshopStore.cowriterOf(view.ws).cards[cardId];
                if (!card || !this._isWritten(card) || card.status !== 'waiting' || this._cardProblem(view, card)) return;
                const state = WorkshopStore.active(view.ws).state;
                const extras = this._extras(view);
                const steer = [card.brief, card.note ? `The author also asked: ${card.note}` : ''].filter(Boolean).join('\n');
                view.cardWriting = cardId;
                if (this.RUNTIME.view === view) {
                    this.renderProgress();
                    this.renderCowriterLog();
                }
                try {
                    let draft;
                    if (card.type === 'rewrite') {
                        const newPins = (card.addPins || []).map(text => ({ id: WorkshopStore.newId('p'), text }));
                        const read = JSON.parse(JSON.stringify(state));
                        const section = read.sections.find(s => s.id === card.section);
                        section.pins = [...section.pins.filter(p => !(card.removePins || []).includes(p.id)), ...newPins.map(p => ({ ...p, state: 'kept', origin: 'cowriter' }))];
                        const ask = WorkshopPrompts.writeSection({ name, state: read, sectionId: card.section, steer, extras, pending: this._cardDrafts(view, cardId) });
                        const result = ask.read((await this._chat(view, ask, onDelta)).data);
                        const kept = section.pins.filter(p => p.state === 'kept').map(p => p.id);
                        draft = { text: result.text, pinMap: result.pinMap, newPins, missing: WorkshopStore.verifyPins(result.text, result.pinMap, kept).missing };
                    } else if (card.type === 'opening') {
                        const scenario = card.opening ? this._scenarios().find(s => s.id === card.opening) : null;
                        const ask = WorkshopPrompts.writeOpening({ name, state, extras, openingId: card.opening, newName: card.opening ? '' : card.name, steer });
                        const result = ask.read((await this._chat(view, ask, onDelta)).data);
                        draft = { text: result.text, name: scenario ? WorkshopStore.openingIn(state, view.ws.original, scenario).name : card.name };
                    } else {
                        const ask = WorkshopPrompts.writeExamples({ name, state, extras, steer });
                        draft = { text: ask.read((await this._chat(view, ask, onDelta)).data).text };
                    }
                    view.ws = WorkshopStore.setCard(view.ws, cardId, { draft: { ...draft, basis: this._cardPart(view, card), at: Date.now() }, error: null });
                } catch (err) {
                    if (err && err.name === 'AbortError') throw err;
                    view.ws = WorkshopStore.setCard(view.ws, cardId, { error: (err && err.message) || 'The writer did not answer.' });
                } finally {
                    view.cardWriting = null;
                }
                await this._saveWs(view);
                if (this.RUNTIME.view === view) this.renderCowriterLog();
            },

            /** Drafts of the same reply's other rewrite cards, by section, for the writer to read in place of the sections. */
            _cardDrafts(view, cardId) {
                const found = this._cardMessage(view, cardId);
                const cards = WorkshopStore.cowriterOf(view.ws).cards;
                const pending = {};
                for (const id of (found ? found.message.cards || [] : [])) {
                    const card = cards[id];
                    if (id !== cardId && card && card.type === 'rewrite' && card.status === 'waiting' && card.draft) pending[card.section] = { text: card.draft.text };
                }
                return pending;
            },

            /** Write it, or Write it again: the writer drafts the card from its brief and your note. */
            writeCard(cardId) {
                const view = this.RUNTIME.view;
                const card = view && WorkshopStore.cowriterOf(view.ws).cards[cardId];
                if (!card || !this._isWritten(card) || card.status !== 'waiting') return Promise.resolve();
                if (view.busy) {
                    UIManager.showNotification('Wait for the AI to finish, or stop it, first.', 'info');
                    return Promise.resolve();
                }
                view.cardEditing = null;
                return this._ask('card-write', null, null, cardId);
            },

            useCard(cardId) {
                const view = this.RUNTIME.view;
                const card = view && WorkshopStore.cowriterOf(view.ws).cards[cardId];
                if (!card) return Promise.resolve();
                return card.type === 'variant' ? this._useVariantCard(card) : this._useCards([card]);
            },

            /** Use all: every card still waiting under a reply, as one step. A new variant is started on its own. */
            useAllCards(messageId) {
                const view = this.RUNTIME.view;
                const message = view && this._findMessage(view, messageId);
                if (!message) return Promise.resolve();
                const cards = WorkshopStore.cowriterOf(view.ws).cards;
                return this._useCards((message.cards || []).map(id => cards[id]).filter(c => c && c.type !== 'variant'));
            },

            /**
             * Puts cards into the character as one step from "cowriter", and marks them used with it.
             * A new opening joins the story first, and an opening or the examples keep the story's own
             * text the first time, as editing them by hand does.
             */
            async _useCards(cards) {
                const view = this.RUNTIME.view;
                if (!view) return;
                if (view.busy) {
                    UIManager.showNotification('Wait for the AI to finish, or stop it, first.', 'info');
                    return;
                }
                const used = [];
                for (const card of cards.filter(c => this._cardReady(view, c))) {
                    if (card.type === 'opening' && !card.opening) {
                        const id = await this._addScenario(view, card.draft.name, card.draft.text);
                        if (!id) {
                            UIManager.showNotification(`Could not add the opening "${card.draft.name}" to the story.`, 'error');
                            continue;
                        }
                        used.push({ ...card, opening: id, added: true });
                        continue;
                    }
                    if (card.type === 'opening') view.ws = WorkshopStore.keepOriginalOpening(view.ws, this._scenarios().find(s => s.id === card.opening));
                    if (card.type === 'examples') view.ws = WorkshopStore.keepOriginalExamples(view.ws, WorkshopStore.storyExamples(this._scenarios(), view.charId));
                    used.push(card);
                }
                if (used.length === 0) return;
                const before = WorkshopStore.active(view.ws).head;
                const next = used.reduce((state, card) => WorkshopStore.cardInto(state, card), WorkshopStore.active(view.ws).state);
                const summary = used.length === 1 ? this._cardSummary(view, used[0]) : `Used ${used.length} suggestions from the co-writer`;
                let ws = WorkshopStore.commit(view.ws, next, { origin: 'cowriter', summary });
                const head = WorkshopStore.active(ws).head;
                for (const card of used) {
                    ws = WorkshopStore.setCard(ws, card.id, { status: 'used', commit: head !== before ? head : null, ...(card.type === 'opening' ? { opening: card.opening } : {}) });
                }
                await this._commitWs(ws, () => this._afterCards());
            },

            _afterCards() {
                this.renderSections();
                this.renderOpenings();
                this.renderCowriter();
            },

            /** The history's line for a card used on its own. */
            _cardSummary(view, card) {
                const title = (WorkshopStore.active(view.ws).state.sections.find(s => s.id === card.section) || {}).title || '';
                switch (card.type) {
                    case 'pin':
                        if (card.action === 'add') return `Pinned "${card.text}" to ${title}`;
                        return card.action === 'remove' ? `Removed the pin "${card.basis || ''}"` : `Reworded the pin "${card.text}"`;
                    case 'rewrite': return `Rewrote ${title} with the co-writer`;
                    case 'opening': return card.added ? `Added the opening "${card.draft.name}"` : `Rewrote the opening "${card.draft.name}" with the co-writer`;
                    case 'examples': return 'Rewrote the example dialogue with the co-writer';
                    case 'notes': return 'New story notes from the co-writer';
                    case 'concept': return 'New concept from the co-writer';
                    case 'decision': return { add: `Added to the notebook: "${card.text}"`, change: `Changed a decision: "${card.text}"` }[card.action] || `Removed from the notebook: "${card.basis || ''}"`;
                    default: return 'A change from the co-writer';
                }
            },

            /** A new variant from the character as it is now. The reply's other cards waiting for the old one go with it. */
            _useVariantCard(card) {
                const view = this.RUNTIME.view;
                if (!view || card.status !== 'waiting' || this._cardProblem(view, card)) return Promise.resolve();
                if (view.busy) {
                    UIManager.showNotification('Wait for the AI to finish, or stop it, first.', 'info');
                    return Promise.resolve();
                }
                const from = view.ws.active;
                const found = this._cardMessage(view, card.id);
                let ws = WorkshopStore.branch(view.ws, WorkshopStore.active(view.ws).head, { name: card.name });
                const made = ws.active;
                for (const id of (found ? found.message.cards || [] : [])) {
                    const sibling = WorkshopStore.cowriterOf(ws).cards[id];
                    if (id !== card.id && sibling && sibling.status === 'waiting' && sibling.variant === from) ws = WorkshopStore.setCard(ws, id, { variant: made });
                }
                return this._variantChange(WorkshopStore.setCard(ws, card.id, { status: 'used', made, from }));
            },

            rejectCard(cardId) {
                const view = this.RUNTIME.view;
                const card = view && WorkshopStore.cowriterOf(view.ws).cards[cardId];
                if (!card || card.status !== 'waiting') return Promise.resolve();
                view.ws = WorkshopStore.setCard(view.ws, cardId, { status: 'turned-down' });
                view.cardEditing = null;
                this.renderCowriter();
                return this._saveWs(view);
            },

            /**
             * Undo on a used card goes back to before its step, and the cards used with it wait again.
             * With a step since, it opens the history instead, to go back from there.
             */
            undoCard(cardId) {
                const view = this.RUNTIME.view;
                const cw = view && WorkshopStore.cowriterOf(view.ws);
                const card = cw && cw.cards[cardId];
                if (!card || card.status !== 'used') return Promise.resolve();
                if (view.busy) {
                    UIManager.showNotification('Wait for the AI to finish, or stop it, first.', 'info');
                    return Promise.resolve();
                }
                if (card.type === 'variant') return this._undoVariantCard(card);
                if (!card.commit) return this._commitWs(WorkshopStore.setCard(view.ws, cardId, { status: 'waiting' }), () => this.renderCowriter());
                const variant = view.ws.variants.find(v => v.id === card.variant);
                const commit = view.ws.commits.find(c => c.id === card.commit);
                if (!commit || !variant || view.ws.active !== variant.id || variant.head !== card.commit) {
                    this.openHistory();
                    return Promise.resolve();
                }
                let ws = WorkshopStore.restore(view.ws, commit.parent);
                for (const c of Object.values(cw.cards)) {
                    if (c.commit === card.commit) ws = WorkshopStore.setCard(ws, c.id, { status: 'waiting', commit: null });
                }
                return this._commitWs(ws, () => this._afterCards());
            },

            /** A variant card's Undo: back to the variant it came from, while the new one has no steps of its own. */
            _undoVariantCard(card) {
                const view = this.RUNTIME.view;
                const made = view.ws.variants.find(v => v.id === card.made);
                const untouched = made && !made.deletedAt && view.ws.active === card.made && !view.ws.commits.some(c => c.variant === card.made);
                if (!untouched) {
                    this.openHistory();
                    return Promise.resolve();
                }
                let ws = WorkshopStore.deleteVariant(WorkshopStore.switchVariant(view.ws, card.from), card.made);
                for (const c of Object.values(WorkshopStore.cowriterOf(ws).cards)) {
                    if (c.variant === card.made && c.status === 'waiting') ws = WorkshopStore.setCard(ws, c.id, { variant: card.from });
                }
                return this._variantChange(WorkshopStore.setCard(ws, card.id, { status: 'waiting' }));
            },

            /** Change it: a written card asks what should change and is written again; any other card has its words edited in place. */
            cardChangeSave(cardId) {
                const view = this.RUNTIME.view;
                const card = view && WorkshopStore.cowriterOf(view.ws).cards[cardId];
                if (!card || card.status !== 'waiting') return Promise.resolve();
                if (view.busy) {
                    UIManager.showNotification('Wait for the AI to finish, or stop it, first.', 'info');
                    return Promise.resolve();
                }
                // The field still has focus, and the log won't redraw over a field being typed in.
                if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
                view.cardEditing = null;
                if (this._isWritten(card)) {
                    const field = document.getElementById('ws-card-note');
                    view.ws = WorkshopStore.setCard(view.ws, cardId, { note: String((field && field.value) || '').trim() });
                    return this._ask('card-write', null, null, cardId);
                }
                const field = document.getElementById('ws-card-text');
                const words = String((field && field.value) || '').trim();
                if (words) view.ws = WorkshopStore.setCard(view.ws, cardId, card.type === 'variant' ? { name: words, edited: true } : { text: words, edited: true });
                this.renderCowriterLog();
                return words ? this._saveWs(view) : Promise.resolve();
            },

            /** A reply's cards, each with what it would change and what can be done with it, and Use all when more than one is ready. */
            _cardsBlock(m) {
                const view = this.RUNTIME.view;
                const cw = WorkshopStore.cowriterOf(view.ws);
                const cards = (m.cards || []).map(id => cw.cards[id]).filter(Boolean);
                if (cards.length === 0) return '';
                const ready = cards.filter(c => c.type !== 'variant' && this._cardReady(view, c));
                const all = ready.length > 1 ? DOM.html`
                    <button type="button" class="ws-btn is-primary ws-cw-use-all" data-action="workshop-card-all" data-message="${m.id}" ${view.busy ? 'disabled' : ''}>Use all ${ready.length} suggestions</button>` : '';
                // A long list on a phone hides the button at its end, so it shows above the list as well.
                const head = ready.length > 1 ? DOM.html`
                    <div class="ws-cw-cards-head">
                        <span>Nothing changes until you use them.</span>
                        ${all}
                    </div>` : '';
                return DOM.html`<div class="ws-cw-cards">${head}${cards.map(c => this._cardHtml(view, c))}${all}</div>`;
            },

            _cardHtml(view, card) {
                const off = view.busy ? 'disabled' : '';
                const why = card.why ? DOM.html`<p class="ws-cw-card-why">Why: ${card.why}</p>` : '';
                let foot;
                if (card.status === 'used') {
                    foot = DOM.html`
                        <div class="ws-cw-card-foot">
                            <span class="ws-cw-card-tag is-used">Used</span>
                            <button type="button" class="ws-cw-act" data-action="workshop-card-undo" data-card="${card.id}" ${off}>Undo</button>
                        </div>`;
                } else if (card.status === 'turned-down') {
                    foot = DOM.html`<div class="ws-cw-card-foot"><span class="ws-cw-card-tag">Turned down</span></div>`;
                } else if (view.cardEditing === card.id) {
                    foot = this._cardEditor(card);
                } else {
                    const problem = this._cardProblem(view, card);
                    const written = this._isWritten(card);
                    const unwritten = written && !card.draft;
                    const changed = !problem && this._cardChanged(view, card);
                    let note = '';
                    if (problem) note = problem;
                    else if (unwritten && view.cardWriting !== card.id) note = card.error || 'Not written yet.';
                    else if (changed) note = written ? 'Changed since it was written.' : 'Changed since the co-writer wrote this.';
                    const buttons = [];
                    if (!problem && !unwritten) buttons.push(DOM.html`<button type="button" class="ws-btn is-primary" data-action="workshop-card-use" data-card="${card.id}" ${off}>Use it</button>`);
                    if (!problem && written && (unwritten || changed)) {
                        buttons.push(DOM.html`<button type="button" class="ws-btn" data-action="workshop-card-write" data-card="${card.id}" ${off}>${unwritten ? 'Write it' : 'Write it again'}</button>`);
                    }
                    // A card that only removes something has no words to change.
                    if (!problem && !unwritten && card.action !== 'remove') buttons.push(DOM.html`<button type="button" class="ws-btn" data-action="workshop-card-change" data-card="${card.id}" ${off}>Change it</button>`);
                    buttons.push(DOM.html`<button type="button" class="ws-cw-act" data-action="workshop-card-reject" data-card="${card.id}" ${off}>Not this</button>`);
                    foot = DOM.html`
                        ${note ? DOM.html`<p class="ws-cw-card-note">${note}</p>` : ''}
                        <div class="ws-cw-card-foot">${buttons}</div>`;
                }
                return DOM.html`
                    <div class="ws-cw-card is-${card.status}">
                        <div class="ws-cw-card-head">${this._cardTitle(view, card)}</div>
                        ${this._cardBody(view, card)}
                        ${why}
                        ${foot}
                    </div>`;
            },

            _cardTitle(view, card) {
                const title = (WorkshopStore.active(view.ws).state.sections.find(s => s.id === card.section) || {}).title || card.section;
                switch (card.type) {
                    case 'pin': return `${{ add: 'New pin', reword: 'Reword a pin', remove: 'Remove a pin' }[card.action]} · ${title}`;
                    case 'rewrite': return `Rewrite · ${title}`;
                    case 'opening': return card.opening ? `Rewrite the opening · ${this._openingName(view, card.opening)}` : `New opening · ${card.name}`;
                    case 'examples': return 'Rewrite the example dialogue';
                    case 'notes': return 'New story notes';
                    case 'concept': return 'New concept';
                    case 'decision': return { add: 'New decision', change: 'Change a decision', remove: 'Remove a decision' }[card.action];
                    case 'variant': return `New variant · ${card.name}`;
                    default: return 'A change';
                }
            },

            /** What a card would change: the words it brings, or, for a written card, its brief, its pin changes and the writer's draft. */
            _cardBody(view, card) {
                const words = text => DOM.html`<div class="ws-cw-card-text">${text}</div>`;
                switch (card.type) {
                    case 'pin':
                        if (card.action === 'add') return words(`"${card.text}"`);
                        return words(card.action === 'remove' ? `"${card.basis || ''}"` : `"${card.basis || ''}" → "${card.text}"`);
                    case 'decision':
                        return words(card.action === 'remove' ? (card.basis || '') : card.text);
                    case 'notes':
                    case 'concept':
                        return words(card.text);
                    case 'variant':
                        return DOM.html`<p class="ws-cw-card-why">Starts a new variant from the character as it is now. This reply's other suggestions go with it.</p>`;
                    default: {
                        const section = WorkshopStore.active(view.ws).state.sections.find(s => s.id === card.section);
                        const pinText = id => ((section && section.pins.find(p => p.id === id)) || ((card.draft && card.draft.newPins) || []).find(p => p.id === id) || {}).text || '';
                        const pins = [
                            ...(card.addPins || []).map(text => DOM.html`<li>+ pin: ${text}</li>`),
                            ...(card.removePins || []).map(id => DOM.html`<li>− pin: ${pinText(id)}</li>`)
                        ];
                        const missing = ((card.draft && card.draft.missing) || []).map(pinText).filter(Boolean);
                        let text = '';
                        if (view.cardWriting === card.id) text = DOM.html`<div class="ws-cw-card-text is-writing">Writing…</div>`;
                        else if (card.draft) text = DOM.html`<div class="ws-cw-card-text">${DOM.unsafe(this._cwFormat(card.draft.text))}</div>`;
                        return DOM.html`
                            <p class="ws-cw-card-brief">${card.brief}</p>
                            ${pins.length ? DOM.html`<ul class="ws-cw-card-pins">${pins}</ul>` : ''}
                            ${text}
                            ${missing.length ? DOM.html`<p class="ws-cw-card-note">Missing ${missing.length === 1 ? 'a pin' : 'pins'}: ${missing.join('; ')}</p>` : ''}`;
                    }
                }
            },

            /** Change it, open on a card. */
            _cardEditor(card) {
                const cancel = DOM.html`<button type="button" class="ws-btn" data-action="workshop-card-change-cancel">Cancel</button>`;
                if (this._isWritten(card)) {
                    return DOM.html`
                        <div class="ws-cw-card-edit">
                            <label class="ws-cw-card-note" for="ws-card-note">What should change?</label>
                            <textarea id="ws-card-note" class="ws-field" rows="2">${card.note || ''}</textarea>
                            <div class="ws-cw-card-foot">
                                <button type="button" class="ws-btn is-primary" data-action="workshop-card-change-save" data-card="${card.id}">Write it again</button>
                                ${cancel}
                            </div>
                        </div>`;
                }
                return DOM.html`
                    <div class="ws-cw-card-edit">
                        <textarea id="ws-card-text" class="ws-field" rows="2" aria-label="The suggestion's words">${card.type === 'variant' ? card.name : card.text}</textarea>
                        <div class="ws-cw-card-foot">
                            <button type="button" class="ws-btn is-primary" data-action="workshop-card-change-save" data-card="${card.id}">Save</button>
                            ${cancel}
                        </div>
                    </div>`;
            },

            /** Talk it over: the co-writer comes into view with "About …: " ready in the box. */
            talkAbout(about) {
                const view = this.RUNTIME.view;
                if (!view) return;
                view.tab = 'cowriter';
                view.side = 'cowriter';
                this.renderTabs();
                const box = document.getElementById('ws-cw-input');
                if (!box) return;
                box.value = `About ${about}: `;
                box.focus();
                if (box.setSelectionRange) box.setSelectionRange(box.value.length, box.value.length);
            },

            /** A new chat, unless the one on screen is still empty. */
            cowriterNewChat() {
                const view = this.RUNTIME.view;
                if (!view) return Promise.resolve();
                if (view.busy) {
                    UIManager.showNotification('Wait for the AI to finish, or stop it, first.', 'info');
                    return Promise.resolve();
                }
                const empty = WorkshopStore.cowriterOf(view.ws).chats.find(c => !c.hiddenAt && c.messages.length === 0);
                view.ws = empty ? WorkshopStore.openChat(view.ws, empty.id) : WorkshopStore.newChat(view.ws);
                view.cwSheet = null;
                view.errors = { ...(view.errors || {}), _cowriter: null };
                this.renderCowriterSheet();
                this.renderCowriter();
                return this._saveWs(view);
            },

            // The chats and the notebook open in a drawer, like the history.

            openCowriterSheet(sheet) {
                const view = this.RUNTIME.view;
                if (!view) return;
                view.cwSheet = sheet;
                view.cwNoteEditing = null;
                view.cwUndo = null;
                this.renderCowriterSheet();
            },

            closeCowriterSheet() {
                const view = this.RUNTIME.view;
                if (view) {
                    view.cwSheet = null;
                    view.cwNoteEditing = null;
                    view.cwUndo = null;
                }
                this.renderCowriterSheet();
            },

            renderCowriterSheet() {
                const view = this.RUNTIME.view;
                const sheet = document.getElementById('ws-cw-sheet');
                if (!sheet) return;
                if (!view || !view.cwSheet) {
                    sheet.classList.add('hidden');
                    return;
                }
                sheet.classList.remove('hidden');
                document.getElementById('ws-cw-sheet-title').textContent = view.cwSheet === 'chats' ? 'Chats with the co-writer' : 'Notebook';
                const body = document.getElementById('ws-cw-sheet-body');
                body.innerHTML = view.cwSheet === 'chats' ? this._chatsSheet(view) : this._notebookSheet(view);
                const field = body.querySelector('#ws-cw-note-text');
                if (field) field.focus();
            },

            _undoLine(view) {
                return view.cwUndo ? DOM.html`<p class="ws-hint">${view.cwUndo.text} <button type="button" class="ws-link" data-action="workshop-cw-undo">Undo</button></p>` : '';
            },

            _chatsSheet(view) {
                const cw = WorkshopStore.cowriterOf(view.ws);
                const rows = cw.chats.filter(c => !c.hiddenAt).map(c => DOM.html`
                    <div class="ws-variant-row${c.id === cw.open ? ' is-active' : ''}">
                        <input type="text" class="ws-variant-name" value="${c.title}" data-chat="${c.id}" data-action-change="workshop-cw-rename" maxlength="80" aria-label="Name of this chat">
                        ${c.id === cw.open
                            ? DOM.html`<span class="ws-variant-tag">Open</span>`
                            : DOM.html`<button type="button" class="ws-btn" data-action="workshop-cw-open" data-chat="${c.id}">Open</button>`}
                        <button type="button" class="ws-link is-danger" data-action="workshop-cw-delete-chat" data-chat="${c.id}">Delete</button>
                        <span class="ws-cw-chat-meta">${this._when(c.updated || c.at)} · ${c.messages.length} message${c.messages.length === 1 ? '' : 's'}</span>
                    </div>`);
                const hidden = cw.chats.filter(c => c.hiddenAt);
                const back = hidden.length ? DOM.html`
                    <p class="ws-hint">Hidden: ${hidden.map(c => DOM.html`<button type="button" class="ws-link" data-action="workshop-cw-unhide" data-chat="${c.id}">bring back ${c.title}</button> `)}</p>` : '';
                return DOM.html`
                    <p class="ws-hint">Start a new chat whenever you like. The notebook carries what matters into every one, and old chats stay here.</p>
                    <button type="button" class="ws-btn is-primary" data-action="workshop-cw-new">New chat</button>
                    ${this._undoLine(view)}
                    ${rows}
                    ${back}`.toString();
            },

            _notebookSheet(view) {
                const notebook = WorkshopStore.active(view.ws).state.notebook || [];
                const character = this._character(view.charId);
                const rows = notebook.map(d => (view.cwNoteEditing === d.id ? DOM.html`
                    <div class="ws-cw-note is-editing">
                        <textarea id="ws-cw-note-text" class="ws-field" rows="2" aria-label="What was decided">${d.text}</textarea>
                        <input type="text" id="ws-cw-note-why" class="ws-opening-name-input" value="${d.why || ''}" placeholder="Why" aria-label="Why">
                        <div class="ws-proposal-actions">
                            <button type="button" class="ws-btn is-primary" data-action="workshop-cw-note-save" data-decision="${d.id}">Save</button>
                            <button type="button" class="ws-btn" data-action="workshop-cw-note-cancel">Cancel</button>
                        </div>
                    </div>` : DOM.html`
                    <div class="ws-cw-note">
                        <button type="button" class="ws-cw-note-main" data-action="workshop-cw-note-edit" data-decision="${d.id}" title="Change it">
                            <span>${d.text}</span>${d.why ? DOM.html`<span class="ws-hint">Why: ${d.why}</span>` : ''}
                        </button>
                        <button type="button" class="ws-pin-btn" data-action="workshop-cw-note-remove" data-decision="${d.id}" aria-label="Remove this decision" title="Remove">×</button>
                    </div>`));
                const add = view.cwNoteEditing === 'new' ? DOM.html`
                    <div class="ws-cw-note is-editing">
                        <textarea id="ws-cw-note-text" class="ws-field" rows="2" placeholder="What was decided" aria-label="What was decided"></textarea>
                        <input type="text" id="ws-cw-note-why" class="ws-opening-name-input" placeholder="Why" aria-label="Why">
                        <div class="ws-proposal-actions">
                            <button type="button" class="ws-btn is-primary" data-action="workshop-cw-note-add">Add it</button>
                            <button type="button" class="ws-btn" data-action="workshop-cw-note-cancel">Cancel</button>
                        </div>
                    </div>` : DOM.html`<button type="button" class="ws-pin-add" data-action="workshop-cw-note-new">+ Add a decision</button>`;
                return DOM.html`
                    <p class="ws-hint">What was decided about ${(character && character.name) || 'the character'}, and why. The co-writer reads it at the start of every chat. Each change here is a step in the history.</p>
                    ${this._undoLine(view)}
                    ${rows.length ? rows : DOM.html`<p class="ws-hint">Nothing decided yet.</p>`}
                    ${add}`.toString();
            },

            _noteFields() {
                const text = document.getElementById('ws-cw-note-text');
                const why = document.getElementById('ws-cw-note-why');
                return { text: String((text && text.value) || '').trim(), why: String((why && why.value) || '').trim() };
            },

            _afterNotebook() {
                this.renderCowriterSheet();
                this.renderCowriterHead();
            },

            addDecisionByHand() {
                const view = this.RUNTIME.view;
                const { text, why } = this._noteFields();
                if (!view || !text) return Promise.resolve();
                view.cwNoteEditing = null;
                return this._change(`Added to the notebook: "${text}"`,
                    next => { next.notebook = WorkshopStore.addDecision(next, { text, why, origin: 'you' }).notebook; }, () => this._afterNotebook());
            },

            saveDecisionByHand(id) {
                const view = this.RUNTIME.view;
                const { text, why } = this._noteFields();
                if (!view) return Promise.resolve();
                view.cwNoteEditing = null;
                if (!text) {
                    this._afterNotebook();
                    return Promise.resolve();
                }
                return this._change(`Changed a decision: "${text}"`,
                    next => { next.notebook = WorkshopStore.changeDecision(next, id, { text, why }).notebook; }, () => this._afterNotebook());
            },

            /** Removes a decision, with Undo instead of asking first. */
            removeDecisionByHand(id) {
                const view = this.RUNTIME.view;
                const notebook = view ? (WorkshopStore.active(view.ws).state.notebook || []) : [];
                const at = notebook.findIndex(d => d.id === id);
                if (at === -1) return Promise.resolve();
                const entry = notebook[at];
                view.cwUndo = {
                    text: `Removed "${entry.text}".`,
                    run: () => this._change(`Brought back a decision: "${entry.text}"`, next => {
                        const list = (next.notebook || []).slice();
                        list.splice(Math.min(at, list.length), 0, JSON.parse(JSON.stringify(entry)));
                        next.notebook = list;
                    }, () => this._afterNotebook())
                };
                return this._change(`Removed from the notebook: "${entry.text}"`,
                    next => { next.notebook = WorkshopStore.removeDecision(next, id).notebook; }, () => this._afterNotebook());
            },

            /** Deletes a chat for good, with Undo while the list stays open instead of asking first. */
            cowriterDeleteChat(chatId) {
                const view = this.RUNTIME.view;
                const cw = view && WorkshopStore.cowriterOf(view.ws);
                const at = cw ? cw.chats.findIndex(c => c.id === chatId) : -1;
                if (at === -1) return Promise.resolve();
                if (view.busy) {
                    UIManager.showNotification('Wait for the AI to finish, or stop it, first.', 'info');
                    return Promise.resolve();
                }
                const chat = cw.chats[at];
                const wasOpen = cw.open === chatId;
                view.ws = WorkshopStore.deleteChat(view.ws, chatId);
                view.cwUndo = {
                    text: `Deleted "${chat.title}".`,
                    run: () => {
                        view.ws = WorkshopStore.restoreChat(view.ws, chat, { at, open: wasOpen });
                        this.renderCowriterSheet();
                        this.renderCowriter();
                        return this._saveWs(view);
                    }
                };
                this.renderCowriterSheet();
                this.renderCowriter();
                return this._saveWs(view);
            },

            /** Changes the chats and saves them: they live with the character, outside its history. */
            _chatsChange(ws) {
                const view = this.RUNTIME.view;
                if (!view || ws === view.ws) return Promise.resolve();
                view.ws = ws;
                this.renderCowriterSheet();
                this.renderCowriter();
                return this._saveWs(view);
            },

            // ---------------------------------------------------------------------------------------
            // History and variants: every accepted change, and other versions of the whole character.
            // ---------------------------------------------------------------------------------------

            openHistory() {
                const view = this.RUNTIME.view;
                if (!view) return;
                view.historyOpen = true;
                view.expanded = null;
                this.renderHistory();
                document.getElementById('ws-history').classList.remove('hidden');
            },

            closeHistory() {
                if (this.RUNTIME.view) this.RUNTIME.view.historyOpen = false;
                document.getElementById('ws-history').classList.add('hidden');
            },

            /** The variants, then the steps that led to the one in use, newest first. */
            renderHistory() {
                const view = this.RUNTIME.view;
                const body = document.getElementById('ws-history-body');
                if (!view || !body || !view.historyOpen) return;
                const ws = view.ws;
                const active = WorkshopStore.active(ws);
                const live = ws.variants.filter(v => !v.deletedAt);
                const hidden = ws.variants.filter(v => v.deletedAt);
                const variants = live.map(v => DOM.html`
                    <div class="ws-variant-row${v.id === ws.active ? ' is-active' : ''}">
                        <input type="text" class="ws-variant-name" value="${v.name}" data-variant="${v.id}" data-action-change="workshop-variant-rename"
                            maxlength="60" aria-label="Name of this variant">
                        ${v.id === ws.active
                            ? DOM.html`<span class="ws-variant-tag">In use</span>`
                            : DOM.html`<button type="button" class="ws-btn" data-action="workshop-variant-switch" data-variant="${v.id}">Use this one</button>`}
                        ${live.length > 1 ? DOM.html`<button type="button" class="ws-link" data-action="workshop-variant-delete" data-variant="${v.id}">Delete</button>` : ''}
                    </div>`);
                const back = hidden.length ? DOM.html`
                    <p class="ws-hint">Deleted: ${hidden.map(v => DOM.html`<button type="button" class="ws-link" data-action="workshop-variant-restore" data-variant="${v.id}">bring back ${v.name}</button> `)}</p>` : '';
                const steps = WorkshopStore.lineage(ws, active.head).reverse().map(c => this._commitRow(c, c.id === active.head));
                body.innerHTML = DOM.html`
                    <section class="ws-history-block">
                        <h3 class="ws-label">Variants</h3>
                        <p class="ws-hint">Whole versions of the character. The one in use is what replies read.</p>
                        ${variants}${back}
                    </section>
                    <section class="ws-history-block">
                        <h3 class="ws-label">History of ${active.name}</h3>
                        <p class="ws-hint">Newest first. Tap a step to see what changed. Going back is a new step, so nothing here is ever lost.</p>
                        ${steps}
                    </section>`.toString();
            },

            _commitRow(c, isHead) {
                const open = this.RUNTIME.view.expanded === c.id;
                const who = { you: 'You', ai: 'AI', card: 'Card', restore: 'Went back', unflatten: 'AI', cowriter: 'Co-writer' }[c.origin] || 'You';
                const changes = c.parent ? c.changes : c.changes.filter(ch => this._hasContent(ch.after));
                const detail = !open ? '' : DOM.html`
                    <div class="ws-commit-detail">
                        ${changes.length ? changes.map(ch => this._changeView(ch)) : DOM.html`<p class="ws-hint">An empty character.</p>`}
                        <div class="ws-proposal-actions">
                            ${isHead
                                ? DOM.html`<span class="ws-hint">This is where the character is now.</span>`
                                : DOM.html`<button type="button" class="ws-btn is-primary" data-action="workshop-restore" data-commit="${c.id}">Go back to here</button>`}
                            <button type="button" class="ws-btn" data-action="workshop-branch" data-commit="${c.id}">New variant from here</button>
                            <button type="button" class="ws-btn" data-action="workshop-export" data-pick="${c.id}">Export this point</button>
                        </div>
                    </div>`;
                return DOM.html`
                    <div class="ws-commit${open ? ' is-open' : ''}">
                        <button type="button" class="ws-commit-head" data-action="workshop-commit-toggle" data-commit="${c.id}" aria-expanded="${open ? 'true' : 'false'}">
                            <span class="ws-commit-who is-${c.origin}">${who}</span>
                            <span class="ws-commit-summary">${c.summary || 'A change'}</span>
                            <span class="ws-commit-when">${this._when(c.at)}</span>
                        </button>
                        ${detail}
                    </div>`;
            },

            _hasContent(value) {
                if (!value) return false;
                if (typeof value === 'string') return !!value.trim();
                // The openings: text by opening, not a section.
                if (!('text' in value) && !('pins' in value)) return Object.keys(value).length > 0;
                return !!String(value.text || '').trim() || (value.pins || []).length > 0;
            },

            /** One part of a step: what its text was and became, and what happened to its pins, lock and length. */
            _changeView(ch) {
                // Before the Workshop's first change to an opening or the examples, they were the story's own.
                const original = (this.RUNTIME.view && this.RUNTIME.view.ws.original) || {};
                const named = { _concept: 'Concept', _notes: 'Story notes', _unsorted: 'Card text not in a section', _examples: 'Example dialogue' }[ch.section];
                if (named) {
                    const before = ch.section === '_examples' && ch.before === null ? (original.examples || '') : (ch.before || '');
                    return DOM.html`<div class="ws-change"><div class="ws-sort-title">${named}</div>${this._beforeAfter(before, ch.after || '')}</div>`;
                }
                if (ch.section === '_notebook') {
                    const was = new Map((ch.before || []).map(d => [d.id, d]));
                    const now = new Map((ch.after || []).map(d => [d.id, d]));
                    const lines = [];
                    for (const [id, d] of now) {
                        const old = was.get(id);
                        if (!old) lines.push(DOM.html`<p class="ws-hint">Decided: ${d.text}${d.why ? ` Why: ${d.why}` : ''}</p>`);
                        else if (old.text !== d.text) lines.push(this._beforeAfter(old.text, d.text));
                        else if (old.why !== d.why) lines.push(DOM.html`<p class="ws-hint">Why: ${d.why}</p>`);
                    }
                    for (const [id, d] of was) if (!now.has(id)) lines.push(DOM.html`<p class="ws-hint">Removed: ${d.text}</p>`);
                    return DOM.html`<div class="ws-change"><div class="ws-sort-title">Notebook</div>${lines}</div>`;
                }
                if (ch.section === '_openings') {
                    const was = ch.before || {};
                    const now = ch.after || {};
                    const ids = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter(id => JSON.stringify(was[id] || null) !== JSON.stringify(now[id] || null));
                    return DOM.html`${ids.map(id => {
                        const a = was[id] || (original.openings || {})[id] || {};
                        const b = now[id] || {};
                        const renamed = a.name && b.name && a.name !== b.name ? DOM.html`<p class="ws-hint">Renamed from "${a.name}"</p>` : '';
                        return DOM.html`
                            <div class="ws-change">
                                <div class="ws-sort-title">Opening: ${b.name || a.name || 'an opening'}</div>
                                ${renamed}
                                ${(a.message || '') !== (b.message || '') ? this._beforeAfter(a.message || '', b.message || '') : ''}
                            </div>`;
                    })}`;
                }
                const a = ch.before || {};
                const b = ch.after || {};
                const notes = [];
                if (ch.before && !!a.locked !== !!b.locked) notes.push(b.locked ? 'Locked' : 'Unlocked');
                if (ch.before && a.length !== b.length) notes.push(`Length: ${a.length} to ${b.length}`);
                const pinsBefore = new Map((a.pins || []).map(p => [p.id, p]));
                const pinsAfter = new Map((b.pins || []).map(p => [p.id, p]));
                for (const [id, p] of pinsAfter) {
                    const old = pinsBefore.get(id);
                    if (!old) {
                        notes.push(`Pin added: ${p.text}${p.state === 'suggested' ? ' (suggested)' : ''}`);
                        continue;
                    }
                    if (old.text !== p.text) notes.push(`Pin reworded from "${old.text}" to "${p.text}"`);
                    if (old.state !== p.state) notes.push(`Pin kept: ${p.text}`);
                }
                for (const [id, p] of pinsBefore) if (!pinsAfter.has(id)) notes.push(`Pin removed: ${p.text}`);
                const textChanged = (a.text || '') !== (b.text || '');
                return DOM.html`
                    <div class="ws-change">
                        <div class="ws-sort-title">${b.title || a.title || ch.section}</div>
                        ${notes.map(n => DOM.html`<p class="ws-hint">${n}</p>`)}
                        ${textChanged ? this._beforeAfter(a.text || '', b.text || '') : ''}
                    </div>`;
            },

            _beforeAfter(before, after) {
                const was = String(before || '').trim();
                return DOM.html`
                    ${was ? DOM.html`<div class="ws-ba"><span class="ws-ba-tag">Before</span><div class="ws-text is-before">${was}</div></div>` : ''}
                    <div class="ws-ba"><span class="ws-ba-tag">${was ? 'After' : 'Now'}</span><div class="ws-text is-proposal">${String(after || '').trim() || '(empty)'}</div></div>`;
            },

            /** A short time: the hour today, the date before that. */
            _when(at) {
                const d = new Date(at);
                if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
            },

            /**
             * Any change to which variant is in use, or its history: redraw everything, the description
             * included. Not while the AI is writing, because its answer lands on the variant in use.
             */
            _variantChange(ws) {
                if (this.RUNTIME.view.busy) {
                    UIManager.showNotification('Wait for the AI to finish, or stop it, first.', 'info');
                    return;
                }
                return this._commitWs(ws, () => {
                    this.render();
                    this.renderHistory();
                });
            },

            registerActions() {
                ActionHandler.register('workshop-export-pick', (ds, value) => {
                    if (this.RUNTIME.view) this.RUNTIME.view.exportPick = value;
                });
                ActionHandler.register('workshop-export', (ds) => this.exportCard(ds.pick || (this.RUNTIME.view && this.RUNTIME.view.exportPick) || 'current'));
                ActionHandler.register('workshop-history-open', () => this.openHistory());
                ActionHandler.register('workshop-history-close', () => this.closeHistory());
                ActionHandler.register('workshop-commit-toggle', (ds) => {
                    const view = this.RUNTIME.view;
                    if (!view) return;
                    view.expanded = view.expanded === ds.commit ? null : ds.commit;
                    this.renderHistory();
                });
                ActionHandler.register('workshop-restore', (ds) => {
                    const view = this.RUNTIME.view;
                    if (view) this._variantChange(WorkshopStore.restore(view.ws, ds.commit));
                });
                ActionHandler.register('workshop-branch', (ds) => {
                    const view = this.RUNTIME.view;
                    if (view) this._variantChange(WorkshopStore.branch(view.ws, ds.commit));
                });
                ActionHandler.register('workshop-variant-switch', (ds) => {
                    const view = this.RUNTIME.view;
                    if (view) this._variantChange(WorkshopStore.switchVariant(view.ws, ds.variant));
                });
                ActionHandler.register('workshop-variant-delete', (ds) => {
                    const view = this.RUNTIME.view;
                    if (view) this._variantChange(WorkshopStore.deleteVariant(view.ws, ds.variant));
                });
                ActionHandler.register('workshop-variant-restore', (ds) => {
                    const view = this.RUNTIME.view;
                    if (view) this._variantChange(WorkshopStore.restoreVariant(view.ws, ds.variant));
                });
                ActionHandler.register('workshop-variant-rename', (ds, val) => {
                    const view = this.RUNTIME.view;
                    if (view) this._commitWs(WorkshopStore.renameVariant(view.ws, ds.variant, val), () => {
                        this.render();
                        this.renderHistory();
                    });
                });
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
                ActionHandler.register('workshop-from-library', (ds) => this.openFromLibrary(ds.id));
                ActionHandler.register('workshop-close', () => this.close());
                ActionHandler.register('workshop-rename', (ds, val) => this.rename(val));
                ActionHandler.register('workshop-tab', (ds) => {
                    const view = this.RUNTIME.view;
                    if (!view) return;
                    view.tab = ds.tab;
                    if (ds.tab !== 'sections') view.side = ds.tab;
                    this.renderTabs();
                    if (ds.tab === 'cowriter') this.renderCowriterLog(true);
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
                ActionHandler.register('workshop-write', (ds) => this._ask(ds.mode === 'reweave' ? 'reweave' : 'write', ds.section));
                ActionHandler.register('workshop-takes', (ds) => this._ask('takes', ds.section, Number(ds.creativity) || null));
                ActionHandler.register('workshop-suggest-pins', () => this._ask('suggest'));
                ActionHandler.register('workshop-write-all', () => this._ask('write-all'));
                ActionHandler.register('workshop-sort', () => this._ask('sort'));
                ActionHandler.register('workshop-sort-accept', () => this.acceptSort());
                ActionHandler.register('workshop-sort-discard', () => this.discardSort());
                ActionHandler.register('workshop-ai-stop', () => {
                    const view = this.RUNTIME.view;
                    if (view && view.busy) view.busy.controller.abort();
                });
                ActionHandler.register('workshop-accept', (ds) => this.acceptProposal(ds.section));
                ActionHandler.register('workshop-discard', (ds) => this.discardProposal(ds.section));
                ActionHandler.register('workshop-accept-all', () => this.acceptAll());
                ActionHandler.register('workshop-discard-all', () => this.discardAll());
                ActionHandler.register('workshop-take-use', (ds) => this.useTake(ds.section, Number(ds.index)));
                ActionHandler.register('workshop-take-reject', (ds) => this.rejectTake(ds.section, Number(ds.index)));
                ActionHandler.register('workshop-pin-edit', (ds) => {
                    if (!this.RUNTIME.view) return;
                    this.RUNTIME.view.editingPin = { section: ds.section, pin: ds.pin };
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

                // The Openings card.
                const editOpening = editing => {
                    if (!this.RUNTIME.view) return;
                    this.RUNTIME.view.editing = editing;
                    this.renderOpenings();
                };
                ActionHandler.register('workshop-opening-edit', (ds) => editOpening(`o:${ds.opening}`));
                ActionHandler.register('workshop-opening-rename', (ds) => editOpening(`o:${ds.opening}:name`));
                ActionHandler.register('workshop-opening-new', () => editOpening('o:new'));
                ActionHandler.register('workshop-opening-cancel', () => editOpening(null));
                ActionHandler.register('workshop-opening-add', () => {
                    const name = document.getElementById('ws-opening-new-name');
                    const text = document.getElementById('ws-opening-new-text');
                    return this.addOpening(name ? name.value : '', text ? text.value : '');
                });
                ActionHandler.register('workshop-opening-write', (ds) => this._ask(ds.mode === 'reweave' ? 'opening-reweave' : 'opening-write', null, null, ds.opening));
                ActionHandler.register('workshop-opening-takes', (ds) => this._ask('opening-takes', null, Number(ds.creativity) || null, ds.opening));
                ActionHandler.register('workshop-opening-accept', (ds) => this.acceptOpening(ds.opening));
                ActionHandler.register('workshop-opening-discard', (ds) => this.discardOpening(ds.opening));
                ActionHandler.register('workshop-opening-take-use', (ds) => this.useOpeningTake(ds.opening, Number(ds.index)));
                ActionHandler.register('workshop-opening-take-new', (ds) => this.newOpeningFromTake(ds.opening, Number(ds.index)));
                ActionHandler.register('workshop-opening-take-reject', (ds) => this.rejectOpeningTake(ds.opening, Number(ds.index)));
                ActionHandler.register('workshop-examples-edit', () => editOpening('_examples'));
                ActionHandler.register('workshop-examples-write', (ds) => this._ask(ds.mode === 'reweave' ? 'examples-reweave' : 'examples-write'));
                ActionHandler.register('workshop-examples-accept', () => this.acceptExamples());
                ActionHandler.register('workshop-examples-discard', () => this.discardExamples());
                ActionHandler.register('workshop-examples-to-chat', () => this.useExamplesInChat());
                ActionHandler.register('workshop-examples-undo', () => this.undoExamplesInChat());
                ActionHandler.register('workshop-examples-uncopy', () => this.removeExampleCopy());

                // The co-writer.
                const withView = fn => (...args) => (this.RUNTIME.view ? fn(this.RUNTIME.view, ...args) : undefined);
                ActionHandler.register('workshop-cw-send', () => this.sendFromBox());
                ActionHandler.register('workshop-cw-other', () => {
                    const field = document.getElementById('ws-cw-other');
                    return this.cowriterSend(field ? field.value : '');
                });
                ActionHandler.register('workshop-cw-pick', (ds) => this.cowriterPick(ds.message, Number(ds.index)));
                ActionHandler.register('workshop-cw-retry', () => this.cowriterRetry());
                ActionHandler.register('workshop-cw-reroll', (ds) => this.cowriterReroll(ds.message));
                ActionHandler.register('workshop-cw-version', (ds) => this.cowriterVersion(ds.message, Number(ds.step)));
                ActionHandler.register('workshop-cw-edit', (ds) => this._cowriterCut(ds.message, { edit: true }));
                ActionHandler.register('workshop-cw-delete', (ds) => this.cowriterDelete(ds.message));
                ActionHandler.register('workshop-cw-delete-one', (ds) => this._cowriterCut(ds.message));
                ActionHandler.register('workshop-cw-delete-after', (ds) => this._cowriterCut(ds.message, { after: true }));
                ActionHandler.register('workshop-cw-delete-cancel', withView(view => {
                    view.cwDeleting = null;
                    this.renderCowriterLog();
                }));
                ActionHandler.register('workshop-card-use', (ds) => this.useCard(ds.card));
                ActionHandler.register('workshop-card-all', (ds) => this.useAllCards(ds.message));
                ActionHandler.register('workshop-card-reject', (ds) => this.rejectCard(ds.card));
                ActionHandler.register('workshop-card-undo', (ds) => this.undoCard(ds.card));
                ActionHandler.register('workshop-card-write', (ds) => this.writeCard(ds.card));
                ActionHandler.register('workshop-card-change', withView((view, ds) => {
                    view.cardEditing = ds.card;
                    this.renderCowriterLog();
                    const field = document.getElementById('ws-card-note') || document.getElementById('ws-card-text');
                    if (field) field.focus();
                }));
                ActionHandler.register('workshop-card-change-save', (ds) => this.cardChangeSave(ds.card));
                ActionHandler.register('workshop-card-change-cancel', withView(view => {
                    view.cardEditing = null;
                    this.renderCowriterLog();
                }));
                ActionHandler.register('workshop-cw-log-undo', withView(view => {
                    const undo = this._logUndo(view, this._openChat(view));
                    view.cwLogUndo = null;
                    return undo ? undo.run() : undefined;
                }));
                ActionHandler.register('workshop-cw-menu', withView(view => {
                    view.cwMenu = !view.cwMenu;
                    this.renderCowriterMenu();
                }));
                ActionHandler.register('workshop-cw-starter', withView((view, ds) => {
                    const starter = this._starters(view).find(s => s.id === ds.starter);
                    view.cwMenu = false;
                    this.renderCowriterMenu();
                    return starter ? this.cowriterSend(starter.say, { title: starter.label }) : undefined;
                }));
                ActionHandler.register('workshop-cw-about', (ds) => this.talkAbout(ds.about));
                ActionHandler.register('workshop-cw-reads', withView(view => {
                    view.cwReadsOpen = !view.cwReadsOpen;
                    this.renderCowriterLog();
                }));
                ActionHandler.register('workshop-cw-new', () => this.cowriterNewChat());
                ActionHandler.register('workshop-cw-sheet', (ds) => this.openCowriterSheet(ds.sheet));
                ActionHandler.register('workshop-cw-sheet-close', () => this.closeCowriterSheet());
                ActionHandler.register('workshop-cw-open', withView((view, ds) => {
                    view.cwSheet = null;
                    return this._chatsChange(WorkshopStore.openChat(view.ws, ds.chat));
                }));
                ActionHandler.register('workshop-cw-rename', withView((view, ds, value) => this._chatsChange(WorkshopStore.renameChat(view.ws, ds.chat, value))));
                ActionHandler.register('workshop-cw-delete-chat', (ds) => this.cowriterDeleteChat(ds.chat));
                ActionHandler.register('workshop-cw-unhide', withView((view, ds) => this._chatsChange(WorkshopStore.unhideChat(view.ws, ds.chat))));
                ActionHandler.register('workshop-cw-undo', withView(view => {
                    const undo = view.cwUndo;
                    view.cwUndo = null;
                    return undo ? undo.run() : undefined;
                }));
                ActionHandler.register('workshop-cw-note-new', withView(view => {
                    view.cwNoteEditing = 'new';
                    this.renderCowriterSheet();
                }));
                ActionHandler.register('workshop-cw-note-edit', withView((view, ds) => {
                    view.cwNoteEditing = ds.decision;
                    this.renderCowriterSheet();
                }));
                ActionHandler.register('workshop-cw-note-cancel', withView(view => {
                    view.cwNoteEditing = null;
                    this.renderCowriterSheet();
                }));
                ActionHandler.register('workshop-cw-note-add', () => this.addDecisionByHand());
                ActionHandler.register('workshop-cw-note-save', (ds) => this.saveDecisionByHand(ds.decision));
                ActionHandler.register('workshop-cw-note-remove', (ds) => this.removeDecisionByHand(ds.decision));

                const root = document.getElementById('character-workshop');
                if (root) {
                    root.addEventListener('focusout', (e) => this._fieldDone(e.target));
                    root.addEventListener('input', (e) => { if (e.target.matches('textarea.ws-field, textarea.ws-pin-input')) this._grow(e.target); });
                    root.addEventListener('keydown', (e) => {
                        // Enter sends to the co-writer; Shift+Enter makes a new line. On a phone,
                        // Enter makes a new line and the send button sends.
                        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && (e.target.id === 'ws-cw-input' || e.target.id === 'ws-cw-other')) {
                            if (e.target.id === 'ws-cw-input' && this._narrow()) return;
                            e.preventDefault();
                            if (e.target.id === 'ws-cw-input') this.sendFromBox();
                            else this.cowriterSend(e.target.value);
                            return;
                        }
                        if ((e.target.classList.contains('ws-variant-name') || e.target.classList.contains('ws-opening-name-input')) && e.key === 'Enter') {
                            e.preventDefault();
                            e.target.blur();
                            return;
                        }
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
