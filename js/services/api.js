        /**
         * =================================================================================================
         * [SEC:JS:SRV:API]
         * APIService Module
         * Handles interactions with various AI providers (Gemini, OpenRouter, KoboldCPP, LM Studio).
         * Manages API keys, request formatting, and error handling.
         * =================================================================================================
         */
        const APIService = {
            webllmEngine: null,
            webllmInitProgress: "",
            openRouterModelCache: null,
            lastThinking: "",

            // How long an un-signaled (background) call may take before it is given up on.
            // The main story turn is exempt: it passes its own signal so the stop button owns it.
            CALL_TIMEOUT_MS: 180000,
            CALL_TIMEOUT_LABEL: '3 minutes',

            // Ceiling on one reply. On a model that reasons this covers the thinking as well
            // as the visible text, so it needs headroom for both or the reply comes back empty.
            MAX_OUTPUT_TOKENS: 4096,

            getLastThinking() {
                return this.lastThinking || "";
            },

            async testConnection(provider, config) {
                try {
                    if (provider === 'gemini') {
                        const apiKey = config.geminiApiKey;
                        if (!apiKey) throw new Error("API Key is required.");
                        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
                        const res = await fetch(url);
                        if (!res.ok) {
                            let errorMsg = "Invalid API Key or Model unavailable.";
                            try {
                                const errData = await res.json();
                                if (errData.error && errData.error.message) {
                                    errorMsg = `Gemini Error: ${errData.error.message}`;
                                }
                            } catch (e) { }
                            throw new Error(errorMsg);
                        }
                        return true;
                    } else if (provider === 'koboldcpp') {
                        const url = config.koboldcpp_url || 'http://localhost:5001';
                        const res = await fetch(`${url}/api/v1/model`);
                        if (!res.ok) throw new Error("Local server not responding.");
                        return true;
                    } else if (provider === 'openrouter') {
                        const apiKey = config.openRouterKey;
                        if (!apiKey) throw new Error("API Key is required.");
                        const res = await fetch('https://openrouter.ai/api/v1/models', {
                            method: 'GET',
                            headers: {
                                'Authorization': `Bearer ${apiKey}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        if (!res.ok) throw new Error("Invalid OpenRouter API Key.");
                        return true;
                    } else if (provider === 'nanogpt') {
                        const apiKey = config.nanoGPTKey;
                        if (!apiKey) throw new Error("API Key is required.");
                        const res = await fetch('https://nano-gpt.com/api/v1/models', {
                            method: 'GET',
                            headers: {
                                'Authorization': `Bearer ${apiKey}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        if (!res.ok) throw new Error("Invalid NanoGPT API Key.");
                        return true;
                    } else if (provider === 'lmstudio') {
                        const rawUrl = config.lmstudio_url || 'http://localhost:1234';
                        const baseUrl = rawUrl.replace(/\/+$/, '');
                        const res = await fetch(`${baseUrl}/v1/models`);
                        if (!res.ok) throw new Error("LM Studio server not responding.");
                        return true;
                    }
                    return false;
                } catch (e) {
                    console.error("Connection test failed:", e);
                    throw e;
                }
            },

            async initWebLLM() {
                const state = StateManager.getState();
                const model = state.webllmModel;
                if (!model) throw new Error("WebLLM model not selected.");

                const progressElement = document.getElementById('webllm-download-progress');

                const initProgressCallback = (initProgress) => {
                    if (progressElement) {
                        progressElement.textContent = `${Math.round(initProgress.progress * 100)}% - ${initProgress.text}`;
                    }
                    console.log(initProgress);
                };

                try {
                    if (progressElement) progressElement.textContent = "Loading WebLLM library...";
                    const { CreateMLCEngine } = await import("https://esm.run/@mlc-ai/web-llm");

                    if (progressElement) progressElement.textContent = "Initializing WebGPU...";
                    this.webllmEngine = await CreateMLCEngine(
                        model,
                        { initProgressCallback: initProgressCallback }, // engineConfig
                        { // ChatOptions override
                            context_window_size: -1,
                            sliding_window_size: 16384,
                            attention_sink_size: 4
                        }
                    );
                    if (progressElement) progressElement.textContent = "Engine Ready";
                } catch (error) {
                    if (progressElement) progressElement.textContent = "Error initializing WebLLM";
                    console.error("WebLLM Initialization Error:", error);
                    throw error;
                }
            },

            async autoInitializeWebLLM() {
                const state = StateManager.getState();
                if (state.apiProvider !== 'webllm' || !state.webllmModel) return;

                const { hasModelInCache } = await import("https://esm.run/@mlc-ai/web-llm");

                // Check if the model is already downloaded to the device's disk
                const isCached = await hasModelInCache(state.webllmModel);

                if (isCached) {
                    console.log("WebLLM model found in local cache. Auto-initializing WebGPU...");
                    // Silently initialize so it's ready by the time they hit "Send"
                    await this.initWebLLM();
                } else {
                    console.log("WebLLM model not cached. User must initialize manually.");
                }
            },

            async callWebLLM(prompt, signal) {
                if (!this.webllmEngine) {
                    await this.initWebLLM();
                }

                let cleanPrompt = prompt;
                if (typeof cleanPrompt === 'string') {
                    cleanPrompt = cleanPrompt.replace(/<\|ELLIPSIS_CACHE_BREAK\|>\n?/g, '');
                }

                const messagesPayload = [{ role: 'user', content: cleanPrompt }];

                const extract = (res) => {
                    const msg = res?.choices?.[0]?.message || {};
                    let thinking = msg.reasoning_content || msg.reasoning || "";
                    let content = msg.content || "";
                    const extracted = UTILITY.extractThinking(content);
                    if (extracted.thinking) {
                        thinking = [thinking.trim(), extracted.thinking.trim()].filter(Boolean).join('\n\n');
                        content = extracted.content;
                    }
                    return { text: content.trim(), thinking: thinking.trim() };
                };

                try {
                    const res = await this.webllmEngine.chat.completions.create({
                        messages: messagesPayload
                    });
                    return extract(res);
                } catch (error) {
                    // Catch iOS Safari WebGPU context loss and auto-reboot the engine
                    if (error.message && (error.message.includes("device lost") || error.name === "DeviceLostError")) {
                        console.warn("WebGPU Device Lost (likely iOS backgrounding). Rebooting engine...");
                        this.webllmEngine = null; // Clear stale instance
                        await this.initWebLLM();  // Re-init from local cache

                        // Retry the text generation once
                        const res = await this.webllmEngine.chat.completions.create({
                            messages: messagesPayload
                        });
                        return extract(res);
                    }
                    throw error;
                }
            },

            /**
             * Internal helper to load images and prepare them for API payloads.
             */
            async _resolveMultimodalPrompt(prompt) {
                if (typeof prompt === 'string') return { text: prompt, images: [] };

                const { text, images } = prompt;
                const imagePayloads = [];

                // Collect all images from the history
                if (images && images.length > 0) {
                    for (const turn of images) {
                        for (const imgId of turn.imageIds) {
                            const blob = await DBService.getImage(imgId);
                            if (blob) {
                                const base64 = await UTILITY.blobToBase64(blob);
                                imagePayloads.push({
                                    // id is carried so VisionBridgeService can memoize descriptions
                                    // per image ([SEC:JS:SRV:VB]); providers that don't need it ignore it.
                                    id: imgId,
                                    mimeType: blob.type,
                                    data: base64
                                });
                            }
                        }
                    }
                }
                return { text, images: imagePayloads };
            },

            /**
             * Checks if a model likely supports vision based on its name/provider.
             */
            _supportsVision(provider, model) {
                if (provider === 'gemini') return true;
                if (provider === 'openrouter') {
                    if (!model) return false;
                    // Try cache first for precise metadata
                    if (this.openRouterModelCache) {
                        const cached = this.openRouterModelCache.find(m => m.id === model);
                        if (cached && cached.architecture) {
                            if (Array.isArray(cached.architecture.input_modalities) && cached.architecture.input_modalities.includes('image')) {
                                return true;
                            }
                            if (typeof cached.architecture.modality === 'string' && cached.architecture.modality.includes('image')) {
                                return true;
                            }
                        }
                    }
                    const visionKeywords = ['vision', 'vl', 'claude-3', 'gpt-4o', 'gpt-4-turbo', 'gemini-1.5', 'pixtral', 'llama-3.2'];
                    return visionKeywords.some(kw => model.toLowerCase().includes(kw));
                }
                if (provider === 'nanogpt') {
                    if (!model) return false;
                    // NanoGPT is OpenAI-compatible; check model name for known vision models
                    const visionKeywords = ['vision', 'vl', 'gpt-4o', 'gpt-4-turbo', 'claude-3', 'pixtral', 'llama-3.2', 'gemini'];
                    return visionKeywords.some(kw => model.toLowerCase().includes(kw));
                }
                if (provider === 'koboldcpp') return true; // Kobold handles it gracefully if Llava is loaded
                if (provider === 'lmstudio') {
                    // LM Studio usually supports vision if the model name implies it
                    if (!model) return false;
                    const visionKeywords = ['vision', 'vl', 'mplug', 'llava', 'pixtral', 'qwen-vl', 'llama-3.2'];
                    return visionKeywords.some(kw => model.toLowerCase().includes(kw));
                }
                return false;
            },

            /**
             * Provides directions to the user on how to find or enable vision support for a provider.
             */
            getVisionDirections(provider) {
                switch (provider) {
                    case 'gemini':
                        return "Most Gemini models (Pro/Flash) support vision. If analysis fails, ensure you are using a 1.5+ model.";
                    case 'openrouter':
                        return "Use models with 'Vision' in their name, such as GPT-4o, Claude 3.5 Sonnet, or Pixtral.";
                    case 'nanogpt':
                        return "Use vision-capable models such as gpt-4o or claude-3-5-sonnet. Check nano-gpt.com/models for the full list.";
                    case 'koboldcpp':
                        return "Ensure you have a Multimodal (Llava) projector file loaded alongside your model in KoboldCPP.";
                    case 'lmstudio':
                        return "Ensure the model loaded in LM Studio supports vision (e.g., Llama 3.2 Vision or Pixtral).";
                    case 'webllm':
                        return "WebLLM vision support is not yet available. Please switch to Gemini or OpenRouter for image analysis.";
                    default:
                        return "Check your provider's documentation for vision-enabled model IDs.";
                }
            },

            /** Human-readable name for the configured backend, used in failure notices. */
            _providerLabel(provider) {
                switch (provider) {
                    case 'koboldcpp': return 'KoboldCPP';
                    case 'lmstudio': return 'LM Studio';
                    case 'gemini': return 'Gemini API';
                    case 'openrouter': return 'OpenRouter';
                    case 'nanogpt': return 'NanoGPT';
                    case 'webllm': return 'the in-browser model';
                    default: return provider || 'the AI backend';
                }
            },

            /** True for backends that run on the user's own machine, where "is it running?" is useful advice. */
            _isLocalProvider(provider) {
                return provider === 'koboldcpp' || provider === 'lmstudio' || provider === 'webllm';
            },

            async callAI(prompt, isJson = false, signal = null, silent = false, options = null) {
                const state = StateManager.getState();

                // Resolve prompt structure
                const resolved = await this._resolveMultimodalPrompt(prompt);
                let text = resolved.text;
                const images = resolved.images;

                // Vision Support Check & Graceful Failure
                const provider = state.apiProvider;
                // options.model lets one call use a different model on the same provider (an agent's
                // own model). KoboldCPP and WebLLM run whatever is loaded, so they ignore it.
                const modelOverride = (options && typeof options.model === 'string' && options.model.trim()) || '';
                const model = (modelOverride || (provider === 'gemini' ? (state.geminiModel || StateManager.data.globalSettings.geminiModel) :
                    provider === 'openrouter' ? state.openRouterModel :
                        provider === 'koboldcpp' ? 'local' : 'unknown')) || 'unknown';

                if (images.length > 0 && !this._supportsVision(provider, model)) {
                    // Vision Bridge ([SEC:JS:SRV:VB]): before telling the model it is blind, try
                    // routing the images through a second, vision-capable endpoint and injecting the
                    // prose it returns. Any failure — unconfigured, offline, aborted — falls through
                    // to the original notice, so this can only ever add capability, never remove it.
                    let bridged = null;
                    if (typeof VisionBridgeService !== 'undefined' && VisionBridgeService.isEnabled()) {
                        try {
                            bridged = await VisionBridgeService.describe(images, signal);
                        } catch (e) {
                            console.error("Vision Bridge failed; falling back to the no-vision notice.", e);
                            bridged = null;
                        }
                    }

                    if (bridged) {
                        text += "\n\n" + bridged;
                    } else {
                        text += "\n\n[SYSTEM NOTE: The user has provided an image, but your current model configuration does not support image analysis. Please acknowledge the user's intent if necessary, but inform them you cannot see the image.]";
                    }
                }

                // Apply a default timeout to prevent background/un-signaled tasks from hanging forever.
                //
                // Nothing is streamed (every provider is called with stream:false), so this budget
                // has to cover the model's entire thinking-and-writing time with nothing arriving
                // until the very end. The old 60 seconds was shorter than a single whole-transcript
                // summary on a cloud model, so healthy replies were thrown away as failures.
                //
                // The budget counts only time the app is actually on screen. A phone that
                // backgrounds the tab suspends this timer, and the browser fires anything
                // overdue the moment the user comes back - so a reply still on its way was
                // aborted for "taking too long" when it had only been waiting to be looked
                // at. That is the single most common way a generation is lost on mobile.
                let activeSignal = signal;
                let timeoutId = null;
                let onVisibilityChange = null;

                // Tracked for every call, not just the ones that own the abort budget,
                // because the main turn passes its own signal for the stop button. A
                // network failure that spans a period off screen is a dropped connection,
                // not a broken setup, and the caller can recover from it.
                let wentHiddenDuringCall = (typeof document !== 'undefined' && document.visibilityState === 'hidden');
                const hiddenProbe = () => {
                    if (document.visibilityState === 'hidden') wentHiddenDuringCall = true;
                };
                if (typeof document !== 'undefined') {
                    document.addEventListener('visibilitychange', hiddenProbe);
                }
                if (!activeSignal) {
                    const controller = new AbortController();
                    activeSignal = controller.signal;

                    let remainingMs = APIService.CALL_TIMEOUT_MS;
                    let armedAt = 0;

                    const arm = () => {
                        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
                        armedAt = Date.now();
                        timeoutId = setTimeout(() => controller.abort(), remainingMs);
                    };

                    const disarm = () => {
                        if (!timeoutId) return;
                        clearTimeout(timeoutId);
                        timeoutId = null;
                        // Keep a floor so returning to a nearly-expired request still
                        // leaves a moment for the response to land.
                        remainingMs = Math.max(5000, remainingMs - (Date.now() - armedAt));
                    };

                    onVisibilityChange = () => {
                        if (document.visibilityState === 'hidden') disarm();
                        else if (!timeoutId) arm();
                    };

                    if (typeof document !== 'undefined') {
                        document.addEventListener('visibilitychange', onVisibilityChange);
                    }
                    arm();
                }

                let responseText = "";
                this.lastThinking = "";
                try {
                    let rawResult = null;
                    if (provider === 'gemini') {
                        rawResult = await this.callGemini({ text, images }, activeSignal, modelOverride);
                    } else if (provider === 'openrouter') {
                        rawResult = await this.callOpenRouter({ text, images }, activeSignal, modelOverride);
                    } else if (provider === 'nanogpt') {
                        rawResult = await this.callNanoGPT({ text, images }, activeSignal, modelOverride);
                    } else if (provider === 'webllm') {
                        rawResult = await this.callWebLLM(text, activeSignal);
                    } else if (provider === 'koboldcpp') {
                        rawResult = await this.callKoboldCPP({ text, images }, activeSignal, isJson);
                    } else if (provider === 'lmstudio') {
                        rawResult = await this.callLMStudio({ text, images }, activeSignal, isJson, modelOverride);
                    }

                    let finishReason = "";
                    if (rawResult && typeof rawResult === 'object' && ('text' in rawResult || 'thinking' in rawResult)) {
                        responseText = rawResult.text ?? "";
                        this.lastThinking = rawResult.thinking ?? "";
                        finishReason = rawResult.finishReason || "";
                    } else {
                        responseText = rawResult;
                    }

                    // Defend against providers that return null/undefined or non-strings.
                    if (responseText == null) responseText = "";
                    else if (typeof responseText !== 'string') responseText = String(responseText);

                    // If responseText still contains thought tags, extract them into lastThinking
                    const extracted = UTILITY.extractThinking(responseText);
                    if (extracted.thinking) {
                        this.lastThinking = [this.lastThinking.trim(), extracted.thinking.trim()].filter(Boolean).join('\n\n');
                        responseText = extracted.content;
                    }

                    // Always strip internal thinking blocks before downstream processing
                    responseText = UTILITY.stripThinking(responseText);

                    if (isJson) {
                        // Match either {} or [] patterns, whichever comes first
                        const jsonMatch = responseText.match(/[\{\[][\s\S]*[\}\]]/);
                        if (jsonMatch && jsonMatch[0]) return jsonMatch[0];
                        throw new Error("AI response was not in the expected JSON format.");
                    }

                    const cleanProse = responseText.trim();
                    if (options && options.returnMeta) {
                        return { text: cleanProse, thinking: this.lastThinking, finishReason };
                    }
                    return cleanProse;

                } catch (error) {
                    if (error.name === 'AbortError') {
                        if (timeoutId && !signal) {
                            // One report per failure. This used to raise its own toast AND
                            // throw a differently worded error, so every caller that reported
                            // e.message produced a second banner for the same problem.
                            // The friendly wording now rides on the error itself.
                            const label = this._providerLabel(state.apiProvider);
                            const timeoutError = new Error(this._isLocalProvider(state.apiProvider)
                                ? `${label} did not answer within ${APIService.CALL_TIMEOUT_LABEL}. Check that it is running.`
                                : `${label} did not answer within ${APIService.CALL_TIMEOUT_LABEL}. The model may be busy — try again, or switch to a faster one.`);
                            // Background chores pass silent:true; they must not raise a red banner
                            // for work the user never asked for and whose failure changes nothing
                            // on screen. The network path below already respects this flag.
                            if (!silent && typeof UIManager !== 'undefined' && UIManager.showNotification) {
                                UIManager.showNotification(timeoutError.message, 'error');
                                timeoutError.reported = true;
                            }
                            throw timeoutError;
                        }
                        throw error;
                    }
                    const isNetworkError = error instanceof TypeError ||
                        (error.message && (
                            error.message.toLowerCase().includes('failed to fetch') ||
                            error.message.toLowerCase().includes('networkerror') ||
                            error.message.toLowerCase().includes('net::err')
                        ));
                    if (isNetworkError) {
                        const friendlyProvider = this._providerLabel(state.apiProvider);

                        const msg = wentHiddenDuringCall
                            ? `Connection dropped while the app was in the background (${friendlyProvider}).`
                            : `Connection failed: ${friendlyProvider} is offline or unreachable.`;
                        // Lets the caller tell "your backend is down" apart from "the phone
                        // cut this off while you were in another app", which is recoverable.
                        error.interruptedWhileHidden = wentHiddenDuringCall;
                        console.warn(`[APIService] ${msg}`, error);
                        if (!silent && typeof UIManager !== 'undefined' && UIManager.showNotification) {
                            UIManager.showNotification(msg, 'error');
                            // Marked so a caller that also reports does not double up.
                            error.reported = true;
                        }
                    } else {
                        console.error(`AI call failed (${state.apiProvider}):`, error);
                    }
                    throw error;
                } finally {
                    if (timeoutId) clearTimeout(timeoutId);
                    if (typeof document !== 'undefined') {
                        document.removeEventListener('visibilitychange', hiddenProbe);
                        if (onVisibilityChange) {
                            document.removeEventListener('visibilitychange', onVisibilityChange);
                        }
                    }
                }
            },

            /**
             * Fetches available models from the Gemini API.
             */
            async getGeminiModels() {
                // Check Global Settings first, then State
                const globalKey = StateManager.data.globalSettings.geminiApiKey;
                const stateKey = StateManager.getState().geminiApiKey;
                const apiKey = globalKey || stateKey;

                if (!apiKey) {
                    console.warn("getGeminiModels: No API key found.");
                    return [];
                }

                try {
                    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
                    if (!res.ok) {
                        console.error("Gemini List Models Failed:", res.status, res.statusText);
                        return [];
                    }
                    const data = await res.json();

                    // Filter for models that support generating content
                    return (data.models || []).filter(m =>
                        m.supportedGenerationMethods &&
                        m.supportedGenerationMethods.includes('generateContent')
                    );
                } catch (e) {
                    console.error("Failed to fetch Gemini models:", e);
                    return [];
                }
            },

            /**
             * Calls the Gemini API.
             * @param {string} prompt - The prompt.
             * @param {AbortSignal} signal - AbortSignal.
             * @returns {Promise<string>}
             */
            async callGemini(prompt, signal, modelOverride = '') {
                const state = StateManager.getState();
                const global = StateManager.data.globalSettings;
                const apiKey = global.geminiApiKey || state.geminiApiKey;

                if (!apiKey) throw new Error("Gemini API key not set.");

                // 1. Resolve Model Name
                // State might hold "gemini-1.5-flash" OR "models/gemini-1.5-flash".
                // Global setting might hold the fallback.
                let rawModel = modelOverride || state.geminiModel || global.geminiModel || 'gemini-1.5-flash';

                // Strip "models/" prefix if present to ensure clean base ID
                if (rawModel.startsWith('models/')) {
                    rawModel = rawModel.replace('models/', '');
                }

                // 2. Construct Endpoint
                // The correct format is: models/{model_id}:generateContent
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${rawModel}:generateContent?key=${apiKey}`;

                let cleanPrompt = typeof prompt === 'string' ? prompt : prompt.text;
                const images = typeof prompt === 'string' ? [] : (prompt.images || []);

                if (typeof cleanPrompt === 'string') {
                    cleanPrompt = cleanPrompt.replace(/<\|ELLIPSIS_CACHE_BREAK\|>\n?/g, '');
                }

                // Construct Gemini Payload
                const requestParts = [{ text: cleanPrompt }];
                if (this._supportsVision('gemini', rawModel)) {
                    images.forEach(img => {
                        requestParts.push({
                            inline_data: {
                                mime_type: img.mimeType,
                                data: img.data
                            }
                        });
                    });
                }

                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: requestParts }] }),
                    signal
                });

                if (!res.ok) {
                    let errorMsg = `Status ${res.status}`;
                    try {
                        const errData = await res.json();
                        errorMsg += `: ${errData.error.message}`;
                    } catch (e) {
                        errorMsg += `: ${await res.text()}`;
                    }
                    throw new Error(`Gemini API Error: ${errorMsg}`);
                }

                const data = await res.json();
                // Aggregate all non-thought text parts. Some Gemini responses split output
                // across multiple parts, and reasoning models put thinking in `thought:true`
                // parts that should be captured as thinking and excluded from the user-facing text.
                const parts = data.candidates?.[0]?.content?.parts || [];
                const thoughtParts = parts
                    .filter(p => p && p.thought && typeof p.text === 'string')
                    .map(p => p.text)
                    .join('');
                const rawText = parts
                    .filter(p => p && !p.thought && typeof p.text === 'string')
                    .map(p => p.text)
                    .join('');

                const extracted = UTILITY.extractThinking(rawText);
                const finalThinking = [thoughtParts.trim(), extracted.thinking.trim()].filter(Boolean).join('\n\n');
                return { text: extracted.content || "", thinking: finalThinking };
            },

            /**
             * Calls the OpenRouter API.
             * @param {string} prompt - The prompt.
             * @param {AbortSignal} signal - AbortSignal.
             * @returns {Promise<string>}
             */
            async callOpenRouter(prompt, signal, modelOverride = '') {
                const state = StateManager.getState();
                const global = StateManager.data.globalSettings;
                const apiKey = global.openRouterKey || state.openRouterKey;
                const model = modelOverride || state.openRouterModel || global.openRouterModel;
                if (!apiKey || !model) throw new Error("OpenRouter API key or model not set.");

                let messagesPayload = [];
                const cacheDelimiter = "<|ELLIPSIS_CACHE_BREAK|>";

                let cleanPrompt = typeof prompt === 'string' ? prompt : prompt.text;
                const images = typeof prompt === 'string' ? [] : (prompt.images || []);

                if (typeof cleanPrompt === 'string' && cleanPrompt.includes(cacheDelimiter)) {
                    // Split the prompt into static (cached) and dynamic (uncached) parts
                    const parts = cleanPrompt.split(cacheDelimiter);
                    const staticContext = parts[0].trim();
                    const dynamicContext = parts[1].trim();

                    if (staticContext) {
                        messagesPayload.push({
                            role: "user",
                            content: [
                                {
                                    type: "text",
                                    text: staticContext,
                                    cache_control: { type: "ephemeral" }
                                }
                            ]
                        });
                    }

                    if (dynamicContext) {
                        if (messagesPayload.length > 0) {
                            messagesPayload[0].content.push({
                                type: "text",
                                text: "\n\n" + dynamicContext
                            });
                        } else {
                            messagesPayload.push({
                                role: "user",
                                content: [{ type: "text", text: dynamicContext }]
                            });
                        }
                    }
                } else {
                    // Standard single-block prompt
                    messagesPayload = [{ role: 'user', content: [{ type: 'text', text: cleanPrompt }] }];
                }

                // Append images to the last user message
                if (images.length > 0 && this._supportsVision('openrouter', model)) {
                    const lastUserMsg = messagesPayload[messagesPayload.length - 1];
                    if (typeof lastUserMsg.content === 'string') {
                        lastUserMsg.content = [{ type: 'text', text: lastUserMsg.content }];
                    }
                    images.forEach(img => {
                        lastUserMsg.content.push({
                            type: 'image_url',
                            image_url: {
                                url: `data:${img.mimeType};base64,${img.data}`
                            }
                        });
                    });
                }

                // Sampling. Every other backend gets a full set - KoboldCPP is sent rep_pen,
                // rep_pen_slope and dry_multiplier, which exist precisely to stop a model
                // falling into a repeating groove - while this path sent model and messages
                // and nothing else. With no penalty and no output cap, a run of repetition
                // had nothing to break it and nothing to stop it, so it ran to the
                // provider ceiling and came back as a wall of the same clause.
                //
                // OpenRouter drops parameters the chosen model does not accept rather than
                // erroring, so these can be sent unconditionally: Gemini takes only the
                // first three and ignores the penalties, DeepSeek and GLM take them all.
                const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({
                        model: model,
                        messages: messagesPayload,
                        // Generous, but bounded, so a failure costs seconds rather than minutes.
                        //
                        // This budget covers reasoning as well as the visible reply. A model
                        // that thinks before it answers can spend the whole of it thinking and
                        // return nothing - billed in full - which reached the user as an empty
                        // message bubble. 2048 left no room for both.
                        max_tokens: APIService.MAX_OUTPUT_TOKENS,
                        // The style guide is a port of a preset that was tuned at its own sampler
                        // settings, so switching it on adopts them. Sending it at this app's
                        // defaults would be testing something the author never tested.
                        ...(state.enableStyleGuide && typeof StyleGuide !== 'undefined' ? StyleGuide.sampling : {
                            temperature: 1.0,
                            top_p: 1.0,
                            // Deliberately mild. Roleplay reuses names and pronouns constantly,
                            // so a heavy hand here reads as a model avoiding the words it needs.
                            frequency_penalty: 0.2,
                            presence_penalty: 0.0,
                            repetition_penalty: 1.05
                        })
                    }),
                    signal
                });

                if (!res.ok) {
                    let errorDetails = `Status: ${res.status} ${res.statusText}.`;
                    try {
                        const errorJson = await res.json();
                        errorDetails += ` Message: ${errorJson.error.message || JSON.stringify(errorJson.error)}`;
                    } catch (e) {
                        errorDetails += ` Response body: ${await res.text()}`;
                    }
                    throw new Error(`API Error: ${errorDetails}`);
                }
                const data = await res.json();
                const choice = data.choices?.[0] || {};
                const finishReason = choice.finish_reason || choice.native_finish_reason || "";
                const msg = choice.message || {};
                let thinking = msg.reasoning || msg.reasoning_content || "";
                let content = msg.content || "";

                // In case the model outputs raw thought tags in content
                const extracted = UTILITY.extractThinking(content);
                if (extracted.thinking) {
                    thinking = [thinking.trim(), extracted.thinking.trim()].filter(Boolean).join('\n\n');
                    content = extracted.content;
                }

                return { text: content.trim(), thinking: thinking.trim(), finishReason };
            },

            /**
             * Calls the NanoGPT API (OpenAI-compatible).
             * @param {string|Object} prompt - The prompt or {text, images}.
             * @param {AbortSignal} signal - AbortSignal.
             * @returns {Promise<string>}
             */
            async callNanoGPT(prompt, signal, modelOverride = '') {
                const state = StateManager.getState();
                const global = StateManager.data.globalSettings;
                const apiKey = global.nanoGPTKey || state.nanoGPTKey;
                const model = modelOverride || state.nanoGPTModel || global.nanoGPTModel;
                if (!apiKey || !model) throw new Error("NanoGPT API key or model not set.");

                let cleanPrompt = typeof prompt === 'string' ? prompt : prompt.text;
                const images = typeof prompt === 'string' ? [] : (prompt.images || []);

                // Strip cache-break delimiter (NanoGPT doesn't use prompt caching)
                if (typeof cleanPrompt === 'string') {
                    cleanPrompt = cleanPrompt.replace(/<\|ELLIPSIS_CACHE_BREAK\|>\n?/g, '');
                }

                let messagesPayload = [{ role: 'user', content: [{ type: 'text', text: cleanPrompt }] }];

                // Append images if the model supports vision
                if (images.length > 0 && this._supportsVision('nanogpt', model)) {
                    images.forEach(img => {
                        messagesPayload[0].content.push({
                            type: 'image_url',
                            image_url: { url: `data:${img.mimeType};base64,${img.data}` }
                        });
                    });
                }

                const res = await fetch('https://nano-gpt.com/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({ model, messages: messagesPayload }),
                    signal
                });

                if (!res.ok) {
                    let errorDetails = `Status: ${res.status} ${res.statusText}.`;
                    try {
                        const errorJson = await res.json();
                        errorDetails += ` Message: ${errorJson.error?.message || JSON.stringify(errorJson.error)}`;
                    } catch (e) {
                        errorDetails += ` Response body: ${await res.text()}`;
                    }
                    throw new Error(`NanoGPT API Error: ${errorDetails}`);
                }
                const data = await res.json();
                const choice = data.choices?.[0] || {};
                const finishReason = choice.finish_reason || choice.native_finish_reason || "";
                const msg = choice.message || {};
                let thinking = msg.reasoning_content || msg.reasoning || "";
                let content = msg.content || "";

                const extracted = UTILITY.extractThinking(content);
                if (extracted.thinking) {
                    thinking = [thinking.trim(), extracted.thinking.trim()].filter(Boolean).join('\n\n');
                    content = extracted.content;
                }

                return { text: content.trim(), thinking: thinking.trim(), finishReason };
            },

            /**
             * Fetches available models from OpenRouter API.
             * @param {string} [mode='text'] - 'text', 'image', or 'audio'. When 'image', uses the
             *   ?output_modalities=image query param so the API returns all image-capable
             *   models (including pure image generators that are omitted from the default
             *   endpoint). When 'audio', uses ?output_modalities=audio for music models.
             *   A separate cache is maintained per mode.
             * @returns {Promise<Array>} Array of model objects with id, name, pricing, context_length, etc.
             */
            async fetchOpenRouterModels(mode = 'text') {
                const state = StateManager.getState();
                const global = StateManager.data.globalSettings;
                const apiKey = global.imageGenOpenRouterKey || global.openRouterKey || state.openRouterKey;
                const headers = { 'Content-Type': 'application/json' };
                if (apiKey) {
                    headers['Authorization'] = `Bearer ${apiKey}`;
                }

                // The default /api/v1/models endpoint only returns text-capable models.
                // Pure image/audio generators are silently omitted unless we use
                // ?output_modalities=image/audio which returns the relevant models.
                let url = 'https://openrouter.ai/api/v1/models';
                if (mode === 'image') {
                    url = 'https://openrouter.ai/api/v1/models?output_modalities=image';
                } else if (mode === 'audio') {
                    url = 'https://openrouter.ai/api/v1/models?output_modalities=audio';
                }

                const res = await fetch(url, { method: 'GET', headers });
                if (!res.ok) {
                    let errorDetails = `Status: ${res.status} ${res.statusText}.`;
                    try {
                        const errorJson = await res.json();
                        errorDetails += ` Message: ${errorJson.error?.message || JSON.stringify(errorJson.error)}`;
                    } catch (e) {
                        errorDetails += ` Response body: ${await res.text()}`;
                    }
                    throw new Error(`Failed to fetch OpenRouter models: ${errorDetails}`);
                }
                const data = await res.json();
                const models = data.data || [];

                // Use separate caches so browser results don't pollute each other.
                if (mode === 'image') {
                    this.openRouterImageModelCache = models;
                } else if (mode === 'audio') {
                    this.openRouterAudioModelCache = models;
                } else {
                    this.openRouterModelCache = models;
                }
                return models;
            },

            /**
             * Fetches available models from NanoGPT API.
             * @param {string} [mode='text'] - 'text' or 'image'. 'image' uses the images/models endpoint.
             * @returns {Promise<Array>} Array of model objects normalized for the shared browser UI.
             */
            async fetchNanoGPTModels(mode = 'text') {
                const global = StateManager.data.globalSettings;
                const apiKey = global.nanoGPTKey;
                const headers = { 'Content-Type': 'application/json' };
                if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

                // NanoGPT exposes a dedicated image-model list vs the general models list
                const url = mode === 'image'
                    ? 'https://nano-gpt.com/api/v1/images/models'
                    : 'https://nano-gpt.com/api/v1/models';

                const res = await fetch(url, { method: 'GET', headers });
                if (!res.ok) {
                    let errorDetails = `Status: ${res.status} ${res.statusText}.`;
                    try {
                        const errorJson = await res.json();
                        errorDetails += ` Message: ${errorJson.error?.message || JSON.stringify(errorJson.error)}`;
                    } catch (e) {
                        errorDetails += ` Response body: ${await res.text()}`;
                    }
                    throw new Error(`Failed to fetch NanoGPT models: ${errorDetails}`);
                }
                const data = await res.json();

                // NanoGPT returns { data: [...] } for /api/v1/models (OpenAI-compat)
                // and may return a bare array or { models: [...] } for image models.
                let rawModels = [];
                if (Array.isArray(data)) {
                    rawModels = data;
                } else if (Array.isArray(data.data)) {
                    rawModels = data.data;
                } else if (Array.isArray(data.models)) {
                    rawModels = data.models;
                }

                // Normalize to the same shape as OpenRouter model objects so the
                // shared _renderNanoGPTModelList can display pricing and context info.
                return rawModels.map(m => ({
                    id: m.id || m.name || '',
                    name: m.name || m.id || '',
                    context_length: m.context_length || m.context_window || null,
                    pricing: m.pricing || null,
                    architecture: m.architecture || null,
                }));
            },

            /**
             * Calls the KoboldCPP API.
             * @param {string} prompt - The prompt.
             * @param {AbortSignal} signal - AbortSignal.
             * @returns {Promise<string>}
             */
            async callKoboldCPP(prompt, signal, isJson = false) {
                const state = StateManager.getState();

                const stopSequences = ["<|eot_id|>", "<|im_end|>", "<|end_of_text|>"];
                const allChars = [...(state.characters || []), ...(typeof ReactiveStore !== 'undefined' && ReactiveStore.getActiveLocationCharacters ? ReactiveStore.getActiveLocationCharacters() : [])];
                allChars.forEach(c => {
                    if (c.name) {
                        stopSequences.push(`\n${c.name}: `);
                        stopSequences.push(`\n${c.name}:`);
                        stopSequences.push(`\n${c.name}:\n`);
                        stopSequences.push(`\n[${c.name}]: `);
                        stopSequences.push(`\n[${c.name}]:`);
                        stopSequences.push(`\n[${c.name}]:\n`);
                        stopSequences.push(`\n### ${c.name}: `);
                        stopSequences.push(`\n### ${c.name}:`);
                        stopSequences.push(`\n### ${c.name}:\n`);
                    }
                });

                let cleanPrompt = typeof prompt === 'string' ? prompt : prompt.text;
                // Same as every other provider: the cache marker is not part of the story.
                if (typeof cleanPrompt === 'string') {
                    cleanPrompt = cleanPrompt.replace(/<\|ELLIPSIS_CACHE_BREAK\|>\n?/g, '');
                }
                const images = typeof prompt === 'string' ? [] : (prompt.images || []);

                const payload = {
                    prompt: cleanPrompt,
                    use_story: false, use_memory: false, use_authors_note: false, use_world_info: false,
                    max_context_length: 18432,
                    max_length: 1024,
                    quiet: true,
                    temperature: 1.0,
                    min_p: state.koboldcpp_min_p,
                    top_p: 1.0,
                    top_k: 0,
                    tfs: 1,
                    typical: 1,
                    rep_pen: isJson ? 1.1 : 1.0,
                    rep_pen_range: 2048,
                    rep_pen_slope: 0.7,
                    mirostat: 0,
                    mirostat_tau: 4,
                    mirostat_eta: 0.1,
                    dry_multiplier: state.koboldcpp_dry,
                    dry_base: 1.75,
                    dry_allowed_length: 2,
                    dry_penalty_last_n: state.koboldcpp_dry > 0 ? -1 : 0,
                    dry_sequence_breakers: isJson ? [] : ["\n", ":", "\"", "*"],
                    stop_sequence: stopSequences,
                    images: images.map(img => img.data)
                };

                const res = await fetch(`${state.koboldcpp_url}/api/v1/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal
                });

                if (!res.ok) {
                    let errorDetails = `Status: ${res.status} ${res.statusText}.`;
                    try { errorDetails += ` Message: ${(await res.json()).error.message}`; } catch (e) { errorDetails += ` Response body: ${await res.text()}`; }
                    throw new Error(`KoboldCPP API Error: ${errorDetails}`);
                }

                const data = await res.json();
                let resultText = data.results?.[0]?.text ?? "";
                if (typeof resultText !== 'string') resultText = String(resultText ?? "");

                let truncateIdx = -1;
                for (const seq of stopSequences) {
                    if (seq.startsWith('\n')) {
                        const idx = resultText.indexOf(seq);
                        if (idx !== -1 && (truncateIdx === -1 || idx < truncateIdx)) {
                            truncateIdx = idx;
                        }
                    }
                }

                if (truncateIdx !== -1) {
                    resultText = resultText.substring(0, truncateIdx);
                }

                const extracted = UTILITY.extractThinking(resultText);
                return { text: extracted.content.trim(), thinking: extracted.thinking.trim() };
            },

            /**
             * Streams a response from KoboldCPP using polling.
             * @param {string} prompt - The prompt.
             * @param {Function} onChunk - Callback for each text chunk.
             * @param {AbortSignal} signal - AbortSignal.
             */
            async streamKoboldPolled(prompt, onChunk, signal) {
                const state = StateManager.getState();

                const stopSequences = ["<|eot_id|>", "<|im_end|>", "<|end_of_text|>"];
                const allChars = [...(state.characters || []), ...(typeof ReactiveStore !== 'undefined' && ReactiveStore.getActiveLocationCharacters ? ReactiveStore.getActiveLocationCharacters() : [])];
                allChars.forEach(c => {
                    if (c.name) {
                        stopSequences.push(`\n${c.name}: `);
                        stopSequences.push(`\n${c.name}:`);
                        stopSequences.push(`\n${c.name}:\n`);
                        stopSequences.push(`\n[${c.name}]: `);
                        stopSequences.push(`\n[${c.name}]:`);
                        stopSequences.push(`\n[${c.name}]:\n`);
                    }
                });

                let cleanPrompt = prompt;
                if (typeof cleanPrompt === 'string') {
                    cleanPrompt = cleanPrompt.replace(/<\|ELLIPSIS_CACHE_BREAK\|>\n?/g, '');
                }

                const payload = {
                    prompt: cleanPrompt,
                    use_story: false, use_memory: false, use_authors_note: false, use_world_info: false,
                    max_context_length: 18432,
                    max_length: 1024,
                    quiet: true,
                    temperature: 1.0,
                    min_p: state.koboldcpp_min_p,
                    top_p: 1.0,
                    dry_multiplier: state.koboldcpp_dry,
                    dry_base: 1.75,
                    dry_allowed_length: 2,
                    dry_penalty_last_n: state.koboldcpp_dry > 0 ? -1 : 0,
                    dry_sequence_breakers: ["\n", ":", "\"", "*"],
                    stop_sequence: stopSequences
                };

                const res = await fetch(`${state.koboldcpp_url}/api/v1/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal
                });

                if (!res.ok) throw new Error(`KoboldCPP Error: ${res.status}`);

                let finished = false;
                while (!finished) {
                    if (signal?.aborted) return;
                    try {
                        const check = await fetch(`${state.koboldcpp_url}/api/extra/generate/check`, { signal });
                        const data = await check.json();

                        if (data.results && data.results[0]) {
                            let textSoFar = data.results[0].text ?? "";
                            if (typeof textSoFar !== 'string') textSoFar = String(textSoFar ?? "");
                            let truncateIdx = -1;
                            for (const seq of stopSequences) {
                                if (seq.startsWith('\n')) {
                                    const idx = textSoFar.indexOf(seq);
                                    if (idx !== -1 && (truncateIdx === -1 || idx < truncateIdx)) {
                                        truncateIdx = idx;
                                    }
                                }
                            }

                            if (truncateIdx !== -1) {
                                textSoFar = textSoFar.substring(0, truncateIdx);
                                onChunk(textSoFar);
                                finished = true;
                                try { fetch(`${state.koboldcpp_url}/api/extra/abort`, { method: 'POST' }); } catch (e) { }
                                break;
                            }
                            onChunk(textSoFar);
                        }

                        if (data.done) finished = true;
                    } catch (e) {
                        if (e.name !== 'AbortError') console.warn("Polling error:", e);
                    }
                    if (!finished) await new Promise(r => setTimeout(r, 100));
                }
            },

            /**
             * Calls the LM Studio API.
             * @param {string} prompt - The prompt.
             * @param {AbortSignal} signal - AbortSignal.
             * @returns {Promise<string>}
             */
            async callLMStudio(prompt, signal, isJson = false, modelOverride = '') {
                const state = StateManager.getState();
                if (!state.lmstudio_url) throw new Error("LM Studio URL not set.");
                const baseUrl = state.lmstudio_url.replace(/\/+$/, '');
                const endpoint = `${baseUrl}/v1/chat/completions`;
                let cleanPrompt = typeof prompt === 'string' ? prompt : prompt.text;
                // The cache marker only means something to providers that split the prompt on it.
                // Anywhere else it is a stray <|...|> token sitting in the middle of the story,
                // right where the conversation begins.
                if (typeof cleanPrompt === 'string') {
                    cleanPrompt = cleanPrompt.replace(/<\|ELLIPSIS_CACHE_BREAK\|>\n?/g, '');
                }
                const images = typeof prompt === 'string' ? [] : (prompt.images || []);

                let contentPayload = cleanPrompt;
                if (images.length > 0) {
                    contentPayload = [{ type: 'text', text: cleanPrompt }];
                    images.forEach(img => {
                        contentPayload.push({
                            type: 'image_url',
                            image_url: {
                                url: `data:${img.mimeType};base64,${img.data}`
                            }
                        });
                    });
                }

                const messages = [{ role: 'user', content: contentPayload }];

                const payload = {
                    model: modelOverride || state.lmStudioModel || 'local-model',
                    messages: messages,
                    temperature: 0.7,
                    stream: false
                };

                if (isJson) {
                    payload.response_format = { type: "json_object" };
                }

                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal
                });

                if (!res.ok) {
                    let errorDetails = `Status: ${res.status} ${res.statusText}.`;
                    try {
                        const errorJson = await res.json();
                        errorDetails += ` Message: ${errorJson.error?.message || JSON.stringify(errorJson)}`;
                    } catch (e) {
                        errorDetails += ` Response body: ${await res.text()}`;
                    }
                    throw new Error(`LM Studio API Error: ${errorDetails}`);
                }
                const data = await res.json();
                const choice = data.choices?.[0] || {};
                const finishReason = choice.finish_reason || choice.native_finish_reason || "";
                const msg = choice.message || {};
                let thinking = msg.reasoning_content || msg.reasoning || "";
                let content = msg.content || "";

                const extracted = UTILITY.extractThinking(content);
                if (extracted.thinking) {
                    thinking = [thinking.trim(), extracted.thinking.trim()].filter(Boolean).join('\n\n');
                    content = extracted.content;
                }

                return { text: content.trim(), thinking: thinking.trim(), finishReason };
            },
        };
