        /**
         * =================================================================================================
         * [SEC:JS:CTRL:WS]
         * WorkshopController
         * The Character Workshop's screens. So far only its block in Settings → Model: which model the
         * Workshop uses, saved setups to switch between, and a connection test. The Workshop itself
         * arrives in later steps of the plan.
         * =================================================================================================
         */
        const WorkshopController = {
            RUNTIME: {
                testAbort: null
            },

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

            registerActions() {
                ActionHandler.register('workshop-backend-change', () => this.updateSettingsVisibility());
                ActionHandler.register('workshop-fields-change', () => this.renderSetups());
                ActionHandler.register('workshop-browse-models', () => AppController.openOpenRouterModelBrowser('workshop'));
                ActionHandler.register('workshop-save-setup', () => this.saveSetup());
                ActionHandler.register('workshop-use-setup', (ds) => this.useSetup(ds.name));
                ActionHandler.register('workshop-remove-setup', (ds) => this.removeSetup(ds.name));
                ActionHandler.register('workshop-test', () => this.testConnection());
            }
        };
