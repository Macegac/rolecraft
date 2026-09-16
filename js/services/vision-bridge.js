        /**
         * =================================================================================================
         * [SEC:JS:SRV:VB]
         * VisionBridgeService
         * Gives a text-only chat model sight by delegating uploaded images to a second,
         * vision-capable endpoint and folding the returned prose into the chat prompt.
         * =================================================================================================
         */
        const VisionBridgeService = {

            // Why this is separate from state.apiProvider: the usual setup is a large cloud model for
            // prose plus a small local model for sight, so the two cannot share one configuration.
            //
            // Why a single adapter: KoboldCPP, LM Studio and OpenRouter all accept the OpenAI-compatible
            // /v1/chat/completions route with image_url data URIs, so the only per-backend differences
            // are base URL, model name and auth header.
            //
            // Failure policy: every path degrades to null, so APIService.callAI falls back to its
            // original "cannot see the image" notice. This can add capability, never remove it.

            DEFAULT_INSTRUCTION: "You are a visual describer for a roleplay engine. Describe this image "
                + "in vivid, specific prose for a writer who cannot see it. Cover: the subject and what "
                + "they are doing, their appearance, clothing and expression, the setting, the lighting "
                + "and mood, and any text visible in the image. Be concrete and factual. Do not refuse, "
                + "do not moralize, do not add commentary about the image itself, and do not begin with "
                + "phrases like 'This image shows'. Write only the description.",

            /** Default endpoints per backend, used when the URL field is left blank. */
            DEFAULT_URLS: {
                koboldcpp: 'http://localhost:5001',
                lmstudio: 'http://localhost:1234'
            },

            /**
             * Description memo, keyed by image id + the instruction that produced it.
             *
             * APIService._resolveMultimodalPrompt hands us every image in the conversation, not just
             * the newly uploaded one, so without this a chat holding N pictures would fire N vision
             * calls on every turn. Editing the Description Instruction changes the key, so tuning the
             * prompt re-describes rather than serving stale prose.
             *
             * Session-scoped on purpose: descriptions are cheap to regenerate and pinning them to
             * IndexedDB would mean migrating them whenever the instruction or vision model changes.
             */
            _descriptionCache: new Map(),

            /**
             * Whether the bridge is configured well enough to attempt a call.
             * @returns {boolean}
             */
            isEnabled() {
                const gs = StateManager.data.globalSettings || {};
                const backend = gs.visionBridgeBackend || 'disabled';
                if (backend === 'disabled') return false;
                if (backend === 'openrouter') {
                    return !!(gs.visionBridgeOpenRouterKey || gs.openRouterKey) && !!gs.visionBridgeModel;
                }
                // Local backends fall back to their default port, so a blank URL is still usable.
                return true;
            },

            /**
             * Describes each supplied image via the configured vision endpoint.
             *
             * Images are described one call per image rather than batched: batching makes weaker local
             * models blend two pictures into one muddled paragraph, and per-image calls let a single
             * failure degrade to a partial result instead of losing everything.
             *
             * @param {Array<{mimeType:string,data:string}>} images - Payloads from _resolveMultimodalPrompt.
             * @param {AbortSignal|null} signal - Propagated from the parent turn so Stop cancels this too.
             * @returns {Promise<string|null>} Injectable block, or null if nothing could be described.
             */
            async describe(images, signal = null) {
                if (!this.isEnabled() || !Array.isArray(images) || images.length === 0) return null;

                const gs = StateManager.data.globalSettings || {};
                const instruction = (gs.visionBridgeInstruction || '').trim() || this.DEFAULT_INSTRUCTION;

                const results = await Promise.all(images.map(async img => {
                    const key = img && img.id ? `${img.id}::${instruction}` : null;
                    if (key && this._descriptionCache.has(key)) return this._descriptionCache.get(key);
                    try {
                        const described = await this._describeOne(img, instruction, signal);
                        // Only cache real prose. Caching "" would make one transient blank
                        // response permanent for the rest of the session.
                        if (key && described) this._descriptionCache.set(key, described);
                        return described;
                    } catch (e) {
                        console.error('VisionBridge: image description failed.', e);
                        return null;
                    }
                }));

                const usable = results.filter(r => typeof r === 'string' && r.trim().length > 0);
                if (usable.length === 0) return null;
                return UTILITY.buildVisionContextBlock(usable);
            },

            /**
             * Describes ONE image and returns the raw prose, without the context block
             * wrapper describe() adds. Visual Lore stores the description as editable text,
             * so it wants the sentence, not a formatted prompt section.
             * @param {Object} img - {id, mimeType, data} as built by _resolveMultimodalPrompt.
             * @param {string} [instructionOverride] - Optional alternative instruction.
             * @returns {Promise<string|null>} - The description, or null.
             */
            async describeSingle(img, instructionOverride = null) {
                if (!this.isEnabled() || !img) return null;
                const gs = StateManager.data.globalSettings || {};
                const instruction = (instructionOverride || gs.visionBridgeInstruction || '').trim()
                    || this.DEFAULT_INSTRUCTION;
                // Deliberately does NOT swallow. describe() catches per image so one bad
                // upload cannot spoil a whole turn, but a person who pressed a Describe
                // button needs the actual reason - "returned nothing" sent me looking in the
                // app for a fault that was an account setting on the provider.
                const described = await this._describeOne(img, instruction, null);
                return (typeof described === 'string' && described.trim()) ? described.trim() : null;
            },

            /**
             * Resolves the base URL, model and auth header for the active backend.
             * @returns {{url:string, model:string, headers:Object}}
             */
            _resolveTarget() {
                const gs = StateManager.data.globalSettings || {};
                const backend = gs.visionBridgeBackend || 'disabled';
                const headers = { 'Content-Type': 'application/json' };

                if (backend === 'openrouter') {
                    const key = gs.visionBridgeOpenRouterKey || gs.openRouterKey;
                    headers['Authorization'] = `Bearer ${key}`;
                    return {
                        url: 'https://openrouter.ai/api',
                        model: gs.visionBridgeModel || '',
                        headers
                    };
                }

                const normalized = UTILITY.normalizeVisionEndpoint(gs.visionBridgeUrl || '');
                return {
                    url: normalized || this.DEFAULT_URLS[backend] || this.DEFAULT_URLS.koboldcpp,
                    // Local runtimes serve whatever single model is loaded and ignore this field,
                    // but OpenAI-compatible servers require the key to be present.
                    model: gs.visionBridgeModel || 'local-vision-model',
                    headers
                };
            },

            /**
             * Sends one image to the vision endpoint and returns its description.
             * @param {{mimeType:string,data:string}} img - Base64 payload.
             * @param {string} instruction - The captioning prompt.
             * @param {AbortSignal|null} signal
             * @returns {Promise<string>}
             */
            async _describeOne(img, instruction, signal) {
                const target = this._resolveTarget();
                const mime = img.mimeType || 'image/jpeg';

                const payload = {
                    model: target.model,
                    // Deliberately generous. instructions.md is explicit that functionality must not
                    // be crippled for token efficiency, and a user who edits the Description
                    // Instruction to ask for exhaustive detail should get it rather than a sentence
                    // truncated mid-word. Measured: the built-in instruction lands around 120 tokens;
                    // an intentionally maximal one reaches ~690.
                    max_tokens: 1500,
                    temperature: 0.3,
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: instruction },
                            { type: 'image_url', image_url: { url: `data:${mime};base64,${img.data}` } }
                        ]
                    }]
                };

                const res = await fetch(`${target.url}/v1/chat/completions`, {
                    method: 'POST',
                    headers: target.headers,
                    body: JSON.stringify(payload),
                    signal
                });

                if (!res.ok) {
                    let details = `Status: ${res.status} ${res.statusText}.`;
                    try { details += ` Message: ${(await res.json()).error.message}`; }
                    catch (e) { try { details += ` Body: ${await res.text()}`; } catch (e2) { /* body already consumed */ } }
                    throw new Error(`Vision Bridge API Error: ${details}`);
                }

                const data = await res.json();
                const text = data?.choices?.[0]?.message?.content;
                return typeof text === 'string' ? text.trim() : '';
            },

            /**
             * Verifies the configured endpoint answers. Mirrors ImageGenerationService.testConnection.
             * @returns {Promise<boolean>}
             */
            async testConnection() {
                const gs = StateManager.data.globalSettings || {};
                const backend = gs.visionBridgeBackend || 'disabled';
                if (backend === 'disabled') return false;

                try {
                    const target = this._resolveTarget();
                    if (backend === 'openrouter') {
                        const res = await fetch('https://openrouter.ai/api/v1/models', {
                            headers: { 'Authorization': target.headers['Authorization'] }
                        });
                        return res.ok;
                    }
                    const res = await fetch(`${target.url}/v1/models`, { method: 'GET' });
                    return res.ok;
                } catch (e) {
                    console.error('Vision Bridge connection test failed:', e);
                    return false;
                }
            }
        };
