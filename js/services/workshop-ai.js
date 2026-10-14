        /**
         * =================================================================================================
         * [SEC:JS:SRV:WSAI]
         * WorkshopAI
         * The Character Workshop's own line to a model, separate from the story's.
         * =================================================================================================
         */
        const WorkshopAI = {

            // Why not APIService.callAI: that one is tied to the open story's provider and sampling,
            // sends a single user message, never streams, overwrites the lastThinking and lastProvider
            // slots the chat reads, and returns "" when no story is loaded. The Workshop needs a real
            // conversation (system, user and assistant turns), replies that arrive word by word, and a
            // model of its own that works with no story open.
            //
            // One adapter covers every backend: OpenRouter, KoboldCPP, LM Studio and Ollama all speak
            // the OpenAI-style /v1/chat/completions route, so they differ only in address, model name,
            // key and which extras they accept.

            DEFAULTS: {
                backend: 'openrouter',
                model: 'deepseek/deepseek-v4.1-flash',
                secondOpinionModel: 'deepseek/deepseek-v4-pro-0813',
                reasoning: 'medium',
                maxTokens: 16000
            },

            /** Where each backend lives when no address is given, and whether it takes JSON mode. */
            BACKENDS: {
                openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api', jsonMode: true },
                koboldcpp: { name: 'KoboldCPP', url: 'http://localhost:5001', jsonMode: false },
                lmstudio: { name: 'LM Studio', url: 'http://localhost:1234', jsonMode: false },
                ollama: { name: 'Ollama', url: 'http://localhost:11434', jsonMode: true }
            },

            REASONING_LEVELS: ['off', 'low', 'medium', 'high'],

            /** How long the line may stay silent before the request is given up. Every chunk resets it. */
            IDLE_MS: 90000,

            /** The Workshop's settings from Settings → Model, every gap filled with a default. */
            settings() {
                const gs = StateManager.data.globalSettings || {};
                const state = (StateManager.getState && StateManager.getState()) || {};
                return this.resolveSettings(gs, state);
            },

            /**
             * Turns stored settings into what a request needs. Pure. Tested in test.js.
             * @param {Object} gs - Global settings.
             * @param {Object} [state] - The open story; older setups kept the main key there.
             * @returns {{backend: string, url: string, model: string, key: string, keySource: string,
             *            reasoning: string, maxTokens: number, secondOpinionModel: string}}
             */
            resolveSettings(gs, state = {}) {
                const backend = this.BACKENDS[gs.workshopBackend] ? gs.workshopBackend : this.DEFAULTS.backend;
                const isOpenRouter = backend === 'openrouter';
                const ownKey = String(gs.workshopOpenRouterKey || '').trim();
                const mainKey = String(gs.openRouterKey || state.openRouterKey || '').trim();
                return {
                    backend,
                    url: isOpenRouter ? this.BACKENDS.openrouter.url
                        : (UTILITY.normalizeVisionEndpoint(gs.workshopUrl || '') || this.BACKENDS[backend].url),
                    model: String(gs.workshopModel || '').trim() || (isOpenRouter ? this.DEFAULTS.model : ''),
                    key: isOpenRouter ? (ownKey || mainKey) : '',
                    keySource: !isOpenRouter ? 'none' : (ownKey ? 'own' : (mainKey ? 'main' : 'missing')),
                    reasoning: this.REASONING_LEVELS.includes(gs.workshopReasoning) ? gs.workshopReasoning : this.DEFAULTS.reasoning,
                    maxTokens: Number(gs.workshopMaxTokens) > 0 ? Number(gs.workshopMaxTokens) : this.DEFAULTS.maxTokens,
                    secondOpinionModel: String(gs.workshopSecondOpinionModel || '').trim() || this.DEFAULTS.secondOpinionModel
                };
            },

            /**
             * The fetch for one request. Pure. Tested in test.js.
             * @param {{messages: Array, json?: boolean, temperature?: number, model?: string}} opts
             * @param {Object} cfg - From resolveSettings.
             * @param {string[]} [blocked] - Provider slugs to keep away from (OpenRouter only).
             * @param {string} [referer] - The page address, which OpenRouter credits the request to.
             * @returns {{url: string, init: {method: string, headers: Object, body: string}}}
             */
            buildRequest({ messages, json = false, temperature, model }, cfg, blocked = [], referer = '') {
                const body = {
                    // Local servers run whatever is loaded and ignore the name, but the field must be there.
                    model: model || cfg.model || 'local-model',
                    messages,
                    stream: true,
                    max_tokens: cfg.maxTokens
                };
                if (typeof temperature === 'number') body.temperature = temperature;
                if (json && this.BACKENDS[cfg.backend].jsonMode) body.response_format = { type: 'json_object' };

                const headers = { 'Content-Type': 'application/json' };
                if (cfg.backend === 'openrouter') {
                    // Always explicit, so the setting in Settings is what happens rather than whatever
                    // the model or the provider defaults to. Local servers get no reasoning field:
                    // each runs its model's own template, and they name the field differently.
                    body.reasoning = cfg.reasoning === 'off' ? { enabled: false } : { effort: cfg.reasoning };
                    if (blocked.length) body.provider = { ignore: blocked };
                    headers['Authorization'] = `Bearer ${cfg.key}`;
                    if (referer) headers['HTTP-Referer'] = referer;
                    headers['X-Title'] = 'Rolecraft';
                }
                return { url: `${cfg.url}/v1/chat/completions`, init: { method: 'POST', headers, body: JSON.stringify(body) } };
            },

            _isLoopback(url) {
                try {
                    const host = new URL(url).hostname;
                    return host === 'localhost' || host.startsWith('127.') || host === '[::1]';
                } catch (e) {
                    return false;
                }
            },

            /**
             * Chrome lets an https page call a plain-http address on the home network only when it
             * knows up front that the address is local, and then asks the user once. Private IP
             * addresses and .local names count by themselves; any other name needs this flag. This
             * device (localhost) is allowed anyway and is not "local" in that sense, so it is left out.
             * @returns {Object} Extra fetch options, possibly none.
             */
            localNetworkOption(url, pageProtocol) {
                if (pageProtocol !== 'https:' || !/^http:\/\//i.test(url) || this._isLoopback(url)) return {};
                return { targetAddressSpace: 'local' };
            },

            /**
             * Reads an OpenAI-style stream of server-sent events to the end.
             *
             * Chunks can end in the middle of a line, or in the middle of a character, so text is
             * decoded as a stream and buffered until each line is complete. Comment lines (OpenRouter's
             * ": OPENROUTER PROCESSING" while it waits) and [DONE] carry nothing. An error chunk part way
             * through means the provider dropped the reply, which counts as a failure.
             *
             * @param {ReadableStream} body
             * @param {{onDelta?: Function, onChunk?: Function}} [hooks] - onDelta gets the text and
             *        thinking so far whenever more arrives; onChunk fires on every chunk, comments included.
             * @returns {Promise<{text: string, thinking: string, finishReason: string, provider: string}>}
             */
            async readStream(body, { onDelta, onChunk } = {}) {
                const reader = body.getReader();
                const decoder = new TextDecoder('utf-8');
                const out = { text: '', thinking: '', finishReason: '', provider: '' };
                let buffer = '';

                const readLine = (line) => {
                    if (!line.startsWith('data:')) return;
                    const data = line.slice(5).trim();
                    if (!data || data === '[DONE]') return;
                    let chunk;
                    try { chunk = JSON.parse(data); } catch (e) { return; }
                    if (chunk.provider) out.provider = chunk.provider;
                    if (chunk.error) {
                        throw new Error(`The model stopped part way through${out.provider ? ` (${out.provider})` : ''}: ${chunk.error.message || 'no reason given'}`);
                    }
                    const choice = chunk.choices && chunk.choices[0];
                    if (!choice) return;
                    const delta = choice.delta || {};
                    const thought = delta.reasoning || delta.reasoning_content || '';
                    const words = delta.content || '';
                    out.thinking += thought;
                    out.text += words;
                    if (choice.finish_reason) out.finishReason = choice.finish_reason;
                    if ((thought || words) && onDelta) onDelta({ text: out.text, thinking: out.thinking });
                };

                try {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (onChunk) onChunk();
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop();
                        for (const line of lines) readLine(line.trim());
                    }
                    buffer += decoder.decode();
                    if (buffer.trim()) readLine(buffer.trim());
                } catch (err) {
                    reader.cancel().catch(() => { });
                    throw err;
                }
                return out;
            },

            /**
             * One conversation turn with the Workshop model. Replies stream: onDelta gets the text and
             * the thinking so far each time more arrives.
             *
             * With json, the reply must be one JSON object. Code fences and chat around it are cleaned
             * away; if nothing usable is left, the model is shown what it sent and asked once more.
             *
             * @param {Object} opts
             * @param {Array<{role: string, content: string}>} opts.messages
             * @param {boolean} [opts.json] - The parsed object comes back as `data`.
             * @param {number} [opts.temperature]
             * @param {Function} [opts.onDelta]
             * @param {AbortSignal} [opts.signal] - Stops the request; the promise then rejects with an AbortError.
             * @param {string} [opts.model] - A different model for this one request (the second opinion).
             * @returns {Promise<{text: string, thinking: string, finishReason: string, provider: string,
             *                    data?: Object, attempts: number}>}
             */
            async chat({ messages, json = false, temperature, onDelta, signal, model } = {}) {
                const cfg = this.settings();
                if (cfg.backend === 'openrouter' && !cfg.key) {
                    throw new Error('The Workshop needs an OpenRouter key. Add one under Settings → Model: your main key, or one just for the Workshop.');
                }
                const ask = msgs => this._send({ messages: msgs, json, temperature, onDelta, signal, model }, cfg);

                const first = await ask(messages);
                if (!json) return { ...first, attempts: 1 };
                // A reply cut off by the length limit would only be cut off again, and its JSON can
                // look whole once repaired, so it is reported rather than parsed or retried.
                if (first.finishReason === 'length') {
                    throw new Error('The reply hit the length limit before its JSON was finished. Try again, or turn thinking down.');
                }
                const data = this._parseObject(first.text);
                if (data) return { ...first, data, attempts: 1 };

                const second = await ask([...messages,
                    { role: 'assistant', content: first.text },
                    { role: 'user', content: 'Reply with JSON only: one JSON object, with nothing before or after it.' }]);
                const retried = second.finishReason === 'length' ? null : this._parseObject(second.text);
                if (retried) return { ...second, data: retried, attempts: 2 };
                throw new Error('The model did not reply with usable JSON, even when asked a second time. Try again, or try another model.');
            },

            _parseObject(text) {
                const value = UTILITY.extractAndParseJSON(text);
                return (value && typeof value === 'object' && !Array.isArray(value)) ? value : null;
            },

            /** One request, streamed, with the idle timer and the caller's Stop. */
            async _send({ messages, json, temperature, onDelta, signal, model }, cfg) {
                const blocked = cfg.backend === 'openrouter' ? ProviderBlacklist.slugs(ProviderBlacklist.load(), Date.now()) : [];
                const { url, init } = this.buildRequest({ messages, json, temperature, model }, cfg, blocked, window.location.href);

                const controller = new AbortController();
                let timer = null;
                let wentQuiet = false;
                const touch = () => {
                    clearTimeout(timer);
                    timer = setTimeout(() => { wentQuiet = true; controller.abort(); }, this.IDLE_MS);
                };
                const stop = () => controller.abort();
                if (signal) {
                    if (signal.aborted) controller.abort();
                    else signal.addEventListener('abort', stop, { once: true });
                }

                // Local models often think inside the reply itself, between tags. Split that off as
                // it arrives, so the words shown are only the answer.
                const relay = onDelta && (({ text, thinking }) => {
                    if (!/[<[]/.test(text)) return onDelta({ text, thinking });
                    const tagged = UTILITY.extractThinking(text);
                    onDelta(tagged.thinking ? { text: tagged.content, thinking: [thinking, tagged.thinking].filter(Boolean).join('\n\n') } : { text, thinking });
                });

                touch();
                try {
                    let res;
                    try {
                        res = await fetch(url, { ...init, ...this.localNetworkOption(url, window.location.protocol), signal: controller.signal });
                    } catch (err) {
                        if (err && err.name === 'AbortError') throw err;
                        throw new Error(this._unreachable(cfg, window.location.protocol));
                    }
                    touch();
                    if (!res.ok) throw new Error(await this._failure(res, cfg));

                    const isStream = (res.headers.get('Content-Type') || '').includes('text/event-stream');
                    // A local server that ignores stream:true answers in one piece instead.
                    const reply = isStream ? await this.readStream(res.body, { onDelta: relay, onChunk: touch }) : this._fromJson(await res.json());
                    reply.provider = reply.provider || res.headers.get('X-Provider-Name') || '';

                    const tagged = UTILITY.extractThinking(reply.text);
                    if (tagged.thinking) {
                        reply.text = tagged.content;
                        reply.thinking = [reply.thinking, tagged.thinking].filter(Boolean).join('\n\n');
                    }
                    if (!reply.text.trim()) throw new Error(UTILITY.emptyReplyReason(reply.finishReason, reply.thinking));
                    return reply;
                } catch (err) {
                    if (wentQuiet) throw new Error(`The Workshop model went quiet for ${Math.round(this.IDLE_MS / 1000)} seconds, so the request was stopped. Try again.`);
                    throw err;
                } finally {
                    clearTimeout(timer);
                    if (signal) signal.removeEventListener('abort', stop);
                }
            },

            _fromJson(data) {
                if (data && data.error) throw new Error(`The model's server refused: ${data.error.message || 'no reason given'}`);
                const choice = (data && data.choices && data.choices[0]) || {};
                const msg = choice.message || {};
                return {
                    text: msg.content || '',
                    thinking: msg.reasoning || msg.reasoning_content || '',
                    finishReason: choice.finish_reason || '',
                    provider: (data && data.provider) || ''
                };
            },

            /** Why a request was refused, in plain words, with the server's own words after it. */
            async _failure(res, cfg) {
                let detail = '';
                try {
                    const body = await res.text();
                    try { detail = (JSON.parse(body).error || {}).message || body; } catch (e) { detail = body; }
                } catch (e) { /* no body */ }
                const isOpenRouter = cfg.backend === 'openrouter';
                const reason = {
                    401: isOpenRouter ? 'OpenRouter did not accept the key.' : 'The server refused the request.',
                    402: 'OpenRouter says the account is out of credit.',
                    404: isOpenRouter ? 'OpenRouter does not know that model.' : 'The server has no model by that name, or nothing at that address.',
                    429: 'Too many requests right now. Wait a moment and try again.'
                }[res.status] || `The Workshop model's server answered with error ${res.status}.`;
                const said = String(detail || '').trim().slice(0, 300);
                return said ? `${reason} (${said})` : reason;
            },

            _unreachable(cfg, pageProtocol) {
                if (cfg.backend === 'openrouter') return 'Could not reach OpenRouter. Check the internet connection and try again.';
                const name = this.BACKENDS[cfg.backend].name;
                let msg = `Could not reach ${name} at ${cfg.url}. Check that it is running there and lets this page call it${cfg.backend === 'ollama' ? ' (OLLAMA_ORIGINS)' : ''}.`;
                if (pageProtocol === 'https:' && /^http:\/\//i.test(cfg.url) && !this._isLoopback(cfg.url)) {
                    msg += ' From another device the browser can also block a plain http:// address: allow local network access when Chrome asks, or use an https address.';
                }
                return msg;
            }
        };
