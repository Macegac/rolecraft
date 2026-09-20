        /**
         * Diagnostics
         * Fills the problem-report diary (DiagLog) and offers "Copy problem report".
         *
         * Everything is recorded from here, by wrapping existing functions when the app starts, so the
         * features themselves stay free of logging code. The wrappers only watch: each one calls the
         * original with the same arguments and returns its result untouched, errors included.
         *
         * Crashes nobody caught (an error thrown outside any try, a promise that failed with nobody
         * listening) also go to the red error dot, so they stop failing silently.
         */
        const Diagnostics = {
            installed: false,

            _wrap(owner, name, around) {
                if (!owner || typeof owner[name] !== 'function' || owner[name].__diagWrapped) return;
                const original = owner[name];
                const wrapped = function (...args) {
                    return around.call(this, original, args);
                };
                wrapped.__diagWrapped = true;
                owner[name] = wrapped;
            },

            _secrets() {
                const globals = (typeof StateManager !== 'undefined' && StateManager.data && StateManager.data.globalSettings) || {};
                const values = Object.entries(globals)
                    .filter(([k, v]) => typeof v === 'string' && /key|token|secret|password/i.test(k))
                    .map(([, v]) => v);
                DiagLog.setSecrets(values);
            },

            _state() {
                return (typeof StateManager !== 'undefined' && StateManager.getState && StateManager.getState()) || {};
            },

            _model(state, override) {
                if (override) return override;
                switch (state.apiProvider) {
                    case 'openrouter': return state.openRouterModel || '(none)';
                    case 'gemini': return state.geminiModel || '(default)';
                    case 'nanogpt': return state.nanoGPTModel || '(none)';
                    case 'lmstudio': return state.lmStudioModel || 'local-model';
                    case 'webllm': return state.webllmModel || '(none)';
                    case 'koboldcpp': return '(loaded in KoboldCPP)';
                    default: return '(unknown)';
                }
            },

            _speaker(id) {
                const c = (typeof ReactiveStore !== 'undefined') ? ReactiveStore.getCharacter(id) : null;
                return c ? `${c.name}${c.is_user ? ' (you)' : ''}` : 'unknown speaker';
            },

            _promptText(prompt) {
                return typeof prompt === 'string' ? prompt : (prompt && prompt.text) || '';
            },

            /** Starts recording. Called first thing at startup. */
            install() {
                if (this.installed) return;
                this.installed = true;
                const self = this;
                this._secrets();
                DiagLog.add('info', `App started. ${typeof APP_BUILD_TIMESTAMP !== 'undefined' ? APP_BUILD_TIMESTAMP : ''}`);

                // Crashes nobody caught.
                window.addEventListener('error', (e) => {
                    if (!e.error && !e.message) return; // a missing image or script, not a code crash
                    const where = e.filename ? ` (${String(e.filename).split('/').pop().split('?')[0]}:${e.lineno})` : '';
                    const text = `${e.message || e.error}${where}`;
                    DiagLog.add('crash', text);
                    if (typeof UIManager !== 'undefined' && UIManager.logError) UIManager.logError(`Unexpected error: ${e.message || e.error}`);
                });
                window.addEventListener('unhandledrejection', (e) => {
                    const reason = e.reason && (e.reason.message || String(e.reason));
                    if (e.reason && e.reason.name === 'AbortError') return; // a request the user stopped
                    DiagLog.add('crash', `Unhandled failure: ${reason}`);
                    if (typeof UIManager !== 'undefined' && UIManager.logError) UIManager.logError(`Unexpected error: ${reason}`);
                });

                // Warnings and errors the app writes to the hidden browser console.
                ['warn', 'error'].forEach(level => {
                    const original = console[level].bind(console);
                    console[level] = (...args) => {
                        try {
                            const text = args.map(a => (a instanceof Error) ? `${a.name}: ${a.message}` : (typeof a === 'string' ? a : DiagLog.redact(a))).join(' ');
                            DiagLog.add(level, text);
                        } catch (err) { /* never let logging break the app */ }
                        original(...args);
                    };
                });

                // Taps on anything the app treats as a control. Names only, never what was typed.
                document.addEventListener('click', (e) => {
                    const el = e.target && e.target.closest && e.target.closest('[data-action], button, [onclick]');
                    if (!el) return;
                    const label = el.dataset.action || el.id || el.getAttribute('title') || (el.textContent || '').trim().slice(0, 30);
                    if (label) DiagLog.add('tap', label);
                }, true);

                // Network requests to other sites (AI providers, image and music services).
                if (window.fetch && !window.fetch.__diagWrapped) {
                    const originalFetch = window.fetch.bind(window);
                    const wrappedFetch = async (input, init) => {
                        const url = typeof input === 'string' ? input : (input && input.url) || '';
                        let target = url;
                        try {
                            const u = new URL(url, location.href);
                            if (u.origin === location.origin) return originalFetch(input, init);
                            target = `${u.host}${u.pathname}`;
                        } catch (e) { /* keep the raw address; redact() still scrubs it */ }
                        const method = (init && init.method) || 'GET';
                        const started = performance.now();
                        try {
                            const res = await originalFetch(input, init);
                            DiagLog.add(res.ok ? 'net' : 'error', `${method} ${target} → ${res.status} in ${Math.round(performance.now() - started)} ms`);
                            return res;
                        } catch (err) {
                            DiagLog.add(err && err.name === 'AbortError' ? 'net' : 'error',
                                `${method} ${target} → ${err && err.name === 'AbortError' ? 'stopped' : 'failed: ' + (err && err.message)} after ${Math.round(performance.now() - started)} ms`);
                            throw err;
                        }
                    };
                    wrappedFetch.__diagWrapped = true;
                    window.fetch = wrappedFetch;
                }

                // Every AI request, with what it was for.
                this._wrap(APIService, 'callAI', async function (original, args) {
                    const [prompt, isJson, , , options] = args;
                    const state = self._state();
                    const text = self._promptText(prompt);
                    const model = self._model(state, options && options.model);
                    const images = prompt && Array.isArray(prompt.images) ? prompt.images.length : 0;
                    const started = performance.now();
                    try {
                        const result = await original.apply(this, args);
                        const out = typeof result === 'string' ? result : (result && result.text) || '';
                        DiagLog.add('ai', `${state.apiProvider} / ${model}${isJson ? ' (JSON)' : ''}: sent ${text.length} chars${images ? `, ${images} image(s)` : ''}, got ${out.length} chars${APIService.lastThinking ? ` + ${APIService.lastThinking.length} thinking` : ''} in ${Math.round(performance.now() - started)} ms`,
                            { textLabel: 'prompt start', text: text.slice(0, 600) });
                        if (!out.trim()) DiagLog.add('warn', 'The AI returned an empty answer.');
                        return result;
                    } catch (err) {
                        DiagLog.add('error', `${state.apiProvider} / ${model} request failed after ${Math.round(performance.now() - started)} ms: ${err && err.message}`,
                            { textLabel: 'prompt start', text: text.slice(0, 600) });
                        throw err;
                    }
                });

                // Turns: each send, pass, reroll or directive starts one.
                this._wrap(NarrativeController, 'handlePrimaryAction', function (original, args) {
                    const input = document.getElementById('chat-input');
                    const typed = input ? input.value.trim() : '';
                    const inThread = typeof TextModeController !== 'undefined' && TextModeController.isActive();
                    DiagLog.beginTurn();
                    const selector = document.getElementById('ai-character-selector');
                    const who = selector ? selector.value : 'any';
                    const state = self._state();
                    DiagLog.add('send', `${inThread ? 'Text thread: ' : ''}${typed ? `sent a message (${typed.length} chars)` : 'asked for the next reply'}; speaker choice "${who}"; Director mode ${state.swarmMode ? 'on' : 'off'}`,
                        { textLabel: 'message', text: typed });
                    return original.apply(this, args);
                });
                this._wrap(NarrativeController, 'handleRegen', function (original, args) {
                    DiagLog.beginTurn();
                    DiagLog.add('send', 'Rerolled the last reply');
                    return original.apply(this, args);
                });
                this._wrap(NarrativeController, 'handleDirectCharacter', function (original, args) {
                    DiagLog.beginTurn();
                    DiagLog.add('send', `Directed a character (${args[0]})${args[1] ? ', reroll' : ''}`);
                    return original.apply(this, args);
                });

                // A reply landing in the chat.
                this._wrap(NarrativeController, 'startStreamingResponse', function (original, args) {
                    const [charId, fullText, , targetIndex, , thinking] = args;
                    DiagLog.add('reply', `${self._speaker(charId)} replied (${(fullText || '').length} chars${thinking ? `, ${thinking.length} thinking` : ''})${targetIndex !== null && targetIndex !== undefined ? `, replacing message #${targetIndex}` : ''}`,
                        { textLabel: 'reply', text: fullText });
                    return original.apply(this, args);
                });

                // Agents.
                this._wrap(AgentController, 'buildNoteLayout', function (original, args) {
                    const layout = original.apply(this, args);
                    if (layout) {
                        const all = [...layout.before, ...layout.top, ...Object.values(layout.beforeMessage).flat(), ...layout.end];
                        const names = all.map(n => {
                            const agent = typeof AgentStore !== 'undefined' ? AgentStore.get(n.agentId) : null;
                            const spot = n.position === 'chat' ? `${n.depth} back` : n.position;
                            return `${agent ? agent.name : n.agentId} (${spot})`;
                        });
                        DiagLog.add('agent', `Placed in the prompt: ${names.join(', ')}`, { textLabel: 'agent text', text: all.map(n => n.text).join('\n---\n') });
                    }
                    return layout;
                });
                this._wrap(AgentController, 'runHelper', async function (original, args) {
                    const [agent, , manual] = args;
                    DiagLog.add('agent', `${agent && agent.name} started${manual ? ' (run by hand)' : ''}${agent && agent.brain && agent.brain.model ? ` on ${agent.brain.model}` : ''}`);
                    const saved = await original.apply(this, args);
                    const notes = self._state().agent_notes || [];
                    const note = saved ? notes.filter(n => n.agentId === (agent && agent.id)).slice(-1)[0] : null;
                    DiagLog.add('agent', `${agent && agent.name} ${saved ? `saved a note (${note ? note.content.length : '?'} chars)` : 'saved nothing (empty answer, "nothing to report", or failed; see lines above)'}`,
                        { textLabel: 'note', text: note ? note.content : '' });
                    return saved;
                });

                // Undo and redo.
                this._wrap(HistoryController, '_move', function (original, args) {
                    DiagLog.add('undo', `${args[0]} pressed (undo steps ${HistoryController.stack ? HistoryController.stack.undo.length : 0}, redo steps ${HistoryController.stack ? HistoryController.stack.redo.length : 0})`);
                    return original.apply(this, args);
                });

                // Anything the app already told the user.
                this._wrap(UIManager, 'showNotification', function (original, args) {
                    DiagLog.add(args[1] === 'error' ? 'error' : 'info', `Shown to user: ${args[0]}`);
                    return original.apply(this, args);
                });

                // Text Mode turns.
                if (typeof TextModeController !== 'undefined') {
                    this._wrap(TextModeController, 'sendInThread', function (original, args) {
                        DiagLog.beginTurn();
                        DiagLog.add('send', `Text thread: sent a text (${(args[0] || '').length} chars)`, { textLabel: 'text', text: args[0] });
                        return original.apply(this, args);
                    });
                    this._wrap(TextModeController, 'generateFollowUp', function (original, args) {
                        DiagLog.beginTurn();
                        DiagLog.add('send', 'Text thread: asked for the next text');
                        return original.apply(this, args);
                    });
                }
            },

            /**
             * Header facts for the report: app, device and settings, never keys.
             * @param {boolean} includeText
             * @returns {Promise<Object<string, string>>}
             */
            async facts(includeText) {
                const state = this._state();
                const globals = (StateManager.data && StateManager.data.globalSettings) || {};
                const keyFor = { openrouter: 'openRouterKey', gemini: 'geminiApiKey', nanogpt: 'nanoGPTKey' }[state.apiProvider];
                const agentsOn = (typeof AgentStore !== 'undefined' && typeof AgentController !== 'undefined')
                    ? AgentStore.list().filter(a => AgentController.isOnHere(a)).map(a => a.name)
                    : [];
                let storage = 'unknown';
                try {
                    if (navigator.storage && navigator.storage.estimate) {
                        const est = await navigator.storage.estimate();
                        storage = `${Math.round((est.usage || 0) / 1048576)} MB used of ${Math.round((est.quota || 0) / 1048576)} MB`;
                    }
                } catch (e) { /* not available */ }
                let offlineCopy = 'none';
                try {
                    const names = await caches.keys();
                    offlineCopy = `${navigator.serviceWorker && navigator.serviceWorker.controller ? 'active' : 'not controlling'} (${names.join(', ') || 'no cache'})`;
                } catch (e) { /* not available */ }

                const facts = {
                    'Created': new Date().toString(),
                    'App': typeof APP_BUILD_TIMESTAMP !== 'undefined' ? APP_BUILD_TIMESTAMP : 'unknown',
                    'Page': location.href.split('?')[0],
                    'Browser': navigator.userAgent,
                    'Screen': `${window.innerWidth}×${window.innerHeight}, ${document.body.classList.contains('layout-vertical') ? 'vertical' : 'horizontal'} layout`,
                    'Online': navigator.onLine ? 'yes' : 'no',
                    'Offline copy': offlineCopy,
                    'Storage': storage,
                    'Database': (typeof DBService !== 'undefined' && DBService.db) ? `open (version ${DBService.db.version})` : 'not open',
                    'AI provider': `${state.apiProvider || globals.apiProvider || 'none'} / ${this._model(state)}`,
                    'Key set': keyFor ? ((globals[keyFor] || state[keyFor]) ? 'yes' : 'NO') : 'n/a',
                    'Chat': `${(state.chat_history || []).length} entries, ${(state.chat_history || []).filter(m => m && m.type === 'chat').length} messages, counter ${state.messageCounter}`,
                    'Characters': `${(state.characters || []).length} (${(state.characters || []).filter(c => c.is_active).length} active)`,
                    'Modes': `Director ${state.swarmMode ? 'on' : 'off'}, Text Mode thread ${typeof TextModeController !== 'undefined' && TextModeController.isActive() ? 'open' : 'closed'}, response length ${state.responseLength || 'normal'}, image mode ${state.characterImageMode || 'none'}`,
                    'Agents on for this story': agentsOn.length ? agentsOn.join(', ') : 'none',
                    'Undo': (typeof HistoryController !== 'undefined' && HistoryController.stack) ? `${HistoryController.stack.undo.length} undo / ${HistoryController.stack.redo.length} redo steps` : 'not started'
                };
                if (includeText) {
                    facts['Story'] = `${state.name || '?'} / ${state.narrativeName || '?'}`;
                }
                return facts;
            },

            /**
             * Copies the report to the clipboard, or shows it in a box to copy by hand when the
             * browser blocks clipboard access.
             * @param {boolean} includeText
             */
            async copyReport(includeText) {
                this._secrets();
                const report = DiagLog.format(await this.facts(includeText), includeText);
                try {
                    await navigator.clipboard.writeText(report);
                    UIManager.showNotification(`Problem report copied (${DiagLog.entries.length} events). Paste it to Claude.`, 'success');
                } catch (e) {
                    this._showReportBox(report);
                }
            },

            _showReportBox(report) {
                let box = document.getElementById('diag-report-box');
                if (!box) {
                    box = document.createElement('div');
                    box.id = 'diag-report-box';
                    box.className = 'diag-report-box';
                    box.innerHTML = '<div class="diag-report-head"><span>Copy this report</span><button class="agents-btn" data-action="diag-close-box">Close</button></div><textarea readonly class="diag-report-text"></textarea>';
                    document.body.appendChild(box);
                }
                const area = box.querySelector('textarea');
                area.value = report;
                box.classList.remove('hidden');
                area.focus();
                area.select();
            },

            _includeTextFrom(el) {
                const scope = el && el.closest('[data-diag-scope]');
                const box = scope ? scope.querySelector('input[data-diag-include-text]') : null;
                return !!(box && box.checked);
            },

            /**
             * Console tracing prints every prompt the app builds, story and all. It stays off
             * unless asked for, and the answer is remembered between sessions.
             * @param {boolean} on
             */
            setConsoleTracing(on) {
                DiagLog.verbose = !!on;
                const settings = StateManager.data && StateManager.data.globalSettings;
                if (settings && settings.debug_console !== !!on) {
                    settings.debug_console = !!on;
                    StateManager.saveGlobalSettings();
                }
                document.querySelectorAll('input[data-diag-console]').forEach(box => { box.checked = !!on; });
            },

            registerActions() {
                const settings = StateManager.data && StateManager.data.globalSettings;
                this.setConsoleTracing(!!(settings && settings.debug_console));

                ActionHandler.register('diag-console-toggle', (ds, val, e) => {
                    const box = (e && e.target && e.target.closest) ? e.target.closest('input[data-diag-console]') : null;
                    this.setConsoleTracing(box ? box.checked : !DiagLog.verbose);
                });
                ActionHandler.register('diag-copy-report', (ds, val, e) => {
                    this.copyReport(this._includeTextFrom(e && e.target));
                });
                ActionHandler.register('diag-close-box', () => {
                    const box = document.getElementById('diag-report-box');
                    if (box) box.classList.add('hidden');
                });
            }
        };
