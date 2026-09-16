        /**
         * =================================================================================================
         * [SEC:JS:SRV:IMG_GEN]
         * ImageGenerationService
         * Handles connections and calls to local (KoboldCPP/SD) and cloud (OpenRouter) image backends.
         * =================================================================================================
         */
        const ImageGenerationService = {

            ART_STYLE_PROMPTS: {
                "anime": "High-quality anime key visual, vibrant colors, clean lineart, cel shading, intricate details, cinematic lighting, 4k resolution",
                "cinematic": "Cinematic film still, photorealistic, shallow depth of field with bokeh, dramatic lighting, highly detailed textures, color graded, 8k resolution",
                "watercolor": "Soft watercolor painting on textured paper, wet-on-wet technique, translucent pastel colors, artistic paint splatters, dreamy atmosphere",
                "digital_illustration": "Modern digital 2D illustration, vector-style clean lines, smooth gradient shading, vibrant color palette, polished character art, high definition",
                "oil_painting": "Classic oil painting on canvas, thick impasto brushstrokes, textured surface, chiaroscuro lighting, rich pigments, traditional fine art style",
                "bw_photography": "Fine art black and white photography, high contrast monochrome, 35mm film grain, dramatic shadows, shallow depth of field, emotive composition",
                "80s_cartoon": "Vintage 1980s Saturday morning cartoon style, traditional hand-drawn cel animation, flat bold colors, retro aesthetic, slightly noisy film grain",
                "50s_pulp": "Vintage 1950s pulp fiction magazine cover, painted illustration style, dynamic action composition, saturated colors, distressed paper texture, retro noir aesthetic",
                "pixel_art": "16-bit pixel art, retro SNES game sprite style, clean distinct pixels, limited color palette, isometric view, sharp resolution",
                "concept_art": "Epic fantasy concept art, speedpaint style, atmospheric lighting, loose painterly brushstrokes, massive scale, detailed environment design, matte painting"
            },

            ART_STYLE_NEGATIVE_PROMPTS: {
                "anime": "photorealistic, 3d, realism, western cartoon, sketch, messy lines, nose, lips, live action",
                "cinematic": "drawing, painting, illustration, anime, cartoon, sketch, text, watermark, low quality, cel shaded, vector",
                "watercolor": "photograph, photorealistic, vector, bold lines, sharp edges, oil painting, acrylic, digital art, smooth",
                "digital_illustration": "photograph, photorealistic, traditional media, watercolor, sketch, messy, grain, paper texture, blurry",
                "oil_painting": "photograph, digital art, vector, smooth, flat color, cartoon, anime, 3d render, glossy",
                "bw_photography": "color, vibrant, saturation, sepia, painting, illustration, drawing, anime, 3d render, sketch",
                "80s_cartoon": "photorealistic, 3d render, modern style, volumetric lighting, gradient shading, highly detailed, vector, 4k",
                "50s_pulp": "photograph, 3d render, modern design, minimalist, clean, vector, digital art, text, title, typography",
                "pixel_art": "blur, anti-aliasing, vector, drawing, photograph, smooth, filters, interpolation, fuzzy, noise",
                "concept_art": "photograph, anime, lineart, cartoon, flat color, low quality, blurry, simple, minimalist"
            },

            /**
             * Generates an image based on the provided prompt and settings.
             * @param {string} prompt - The positive prompt.
             * @param {string} negativePrompt - The negative prompt.
             * @param {Object} options - Override options (width, height, etc.).
             * @param {Blob|null} initImage - Optional base image for Image-to-Image.
             * @returns {Promise<Blob>} - The generated image as a Blob.
             */
            async generateImage(prompt, negativePrompt = "", options = {}, initImage = null) {
                const globalSettings = StateManager.data.globalSettings;
                const backend = globalSettings.imageGenBackend || 'koboldcpp'; // 'koboldcpp' or 'openrouter'

                // Apply Art Style Logic
                const styleKey = (ReactiveStore.state && ReactiveStore.state.imageGenArtStyle) ? ReactiveStore.state.imageGenArtStyle : 'none';

                if (styleKey !== 'none') {
                    if (this.ART_STYLE_PROMPTS[styleKey]) {
                        prompt = `${this.ART_STYLE_PROMPTS[styleKey]}, ${prompt}`;
                    }
                    if (this.ART_STYLE_NEGATIVE_PROMPTS[styleKey]) {
                        negativePrompt = negativePrompt ? `${negativePrompt}, ${this.ART_STYLE_NEGATIVE_PROMPTS[styleKey]}` : this.ART_STYLE_NEGATIVE_PROMPTS[styleKey];
                    }
                }

                if (backend === 'disabled') {
                    console.log("Image generation is disabled.");
                    return null;
                }

                if (backend === 'koboldcpp') {
                    return this._generateKoboldCPP(prompt, negativePrompt, options, initImage);
                } else if (backend === 'openrouter') {
                    return this._generateOpenRouter(prompt, options, initImage);
                } else if (backend === 'nanogpt') {
                    return this._generateNanoGPT(prompt, options, initImage);
                } else {
                    throw new Error(`Unknown image generation backend: ${backend}`);
                }
            },

            /**
             * Tests the connection to the configured backend.
             * @returns {Promise<boolean>}
             */
            async testConnection() {
                const globalSettings = StateManager.data.globalSettings;
                const backend = globalSettings.imageGenBackend || 'koboldcpp';

                try {
                    if (backend === 'koboldcpp') {
                        const url = (globalSettings.koboldImageGenUrl || "http://localhost:5001").replace(/\/$/, "");
                        const res = await fetch(`${url}/sdapi/v1/options`, { method: 'GET' }); // Check SDAPI options
                        return res.ok;
                    } else if (backend === 'openrouter') {
                        // No easy lightweight check for OR image gen specifically, so we assume valid if we can hit models
                        const key = globalSettings.imageGenOpenRouterKey || globalSettings.openRouterKey;
                        if (!key) return false;
                        const res = await fetch("https://openrouter.ai/api/v1/models", {
                            headers: { "Authorization": `Bearer ${key}` }
                        });
                        return res.ok;
                    } else if (backend === 'nanogpt') {
                        const key = globalSettings.imageGenNanoGPTKey || globalSettings.nanoGPTKey;
                        if (!key) return false;
                        const res = await fetch("https://nano-gpt.com/api/v1/images/models", {
                            headers: { "Authorization": `Bearer ${key}` }
                        });
                        return res.ok;
                    }
                } catch (e) {
                    console.error("ImageGen Connection Test Failed:", e);
                    return false;
                }
                return false;
            },

            // --- Internal Adapters ---

            /**
             * KoboldCPP (SDAPI Compatible) Adapter
             */
            async _generateKoboldCPP(prompt, negativePrompt, options, initImage = null) {
                const globalSettings = StateManager.data.globalSettings;
                const url = (globalSettings.koboldImageGenUrl || "http://localhost:5001").replace(/\/$/, "");

                const width = options.width || globalSettings.imageGenWidth || 512;
                const height = options.height || globalSettings.imageGenHeight || 512;
                const steps = parseInt(globalSettings.koboldImageGenSteps || 20);

                const payload = {
                    prompt: prompt,
                    negative_prompt: negativePrompt || "",
                    width: width,
                    height: height,
                    steps: steps,
                    cfg_scale: parseFloat(globalSettings.koboldImageGenCfg || 7),
                    sampler_name: globalSettings.koboldImageGenSampler || "Euler",
                    scheduler: globalSettings.koboldImageGenScheduler || "simple",
                    send_images: true,
                    save_images: false,
                };

                // Image-to-Image (I2I) Extension
                let endpoint = `${url}/sdapi/v1/txt2img`;
                if (initImage) {
                    endpoint = `${url}/sdapi/v1/img2img`;
                    const base64 = await UTILITY.blobToBase64(initImage);
                    payload.init_images = [base64];
                    payload.denoising_strength = options.denoising_strength || 0.55; // Default for expression shifts
                }

                try {
                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (!response.ok) {
                        const errText = await response.text();
                        throw new Error(`KoboldCPP Error (${response.status}): ${errText}`);
                    }

                    const data = await response.json();
                    if (data.images && data.images.length > 0) {
                        // Kobold/SDAPI returns base64 string
                        return UTILITY.base64ToBlob(data.images[0], 'image/png');
                    } else {
                        throw new Error("KoboldCPP returned no images.");
                    }
                } catch (e) {
                    console.error("KoboldCPP Image Gen Failed:", e);
                    throw e;
                }
            },

            /**
             * OpenRouter (OpenAI Compatible) Adapter
             */
            async _generateOpenRouter(prompt, options, initImage = null) {
                const globalSettings = StateManager.data.globalSettings;
                const key = globalSettings.imageGenOpenRouterKey || globalSettings.openRouterKey;

                if (!key) throw new Error("OpenRouter API Key is missing. Please set your API key in settings.");

                // Default to Flux 1 Schnell as it is widely supported and fast on OpenRouter
                const model = globalSettings.imageGenOpenRouterModel || "black-forest-labs/flux-1-schnell";

                // OpenRouter uses the Chat Completions endpoint for Image Generation models
                // We send a user message with the prompt.
                // We add a System Prompt to force the model to behave like a generator and not a chatbot.
                const payload = {
                    model: model,
                    messages: [
                        {
                            role: "system",
                            content: "You are an image generation tool. Generate the image requested by the user and output ONLY the image URL. Do not add any conversational text, pleasantries, or explanations. Just the URL."
                        }
                    ],
                    // NEW: Required by OpenRouter for image models
                    extra_body: {
                        modalities: ["image", "text"]
                    }
                };

                // Image-to-Image (I2I) Extension for OpenRouter (Multimodal)
                if (initImage) {
                    const dataUrl = await UTILITY.blobToDataURL(initImage);
                    payload.messages.push({
                        role: "user",
                        content: [
                            { type: "text", text: `REVISE this image based on the following prompt. Maintain character consistency, just change the facial expression/emotion: ${prompt}` },
                            { type: "image_url", image_url: { url: dataUrl } }
                        ]
                    });
                } else {
                    payload.messages.push({ role: "user", content: prompt });
                }

                console.log("OpenRouter Image Req:", payload);

                try {
                    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                        method: 'POST',
                        headers: {
                            "Authorization": `Bearer ${key}`,
                            "Content-Type": "application/json",
                            "HTTP-Referer": window.location.href,
                            "X-Title": "Rolecraft"
                        },
                        body: JSON.stringify(payload)
                    });

                    if (!response.ok) {
                        const errText = await response.text();
                        let parsedError = "";
                        try {
                            const errJson = JSON.parse(errText);
                            parsedError = errJson.error?.message || errJson.message || errText;
                        } catch (e) {
                            parsedError = errText;
                        }
                        console.error("OpenRouter Image API Error Details:", { status: response.status, error: parsedError });
                        throw new Error(`OpenRouter Error (${response.status}): ${parsedError.substring(0, 200)}`);
                    }

                    const data = await response.json();
                    console.log("OpenRouter Image Res:", data);

                    if (data.choices && data.choices.length > 0) {
                        const message = data.choices[0].message;

                        // 0. Priority Check: OpenRouter/OpenAI 'images' array (Standard for GenAI)
                        if (message.images && message.images.length > 0) {
                            const imgData = message.images[0];
                            const url = (imgData.image_url && imgData.image_url.url) ? imgData.image_url.url : imgData.url;
                            if (url) {
                                console.log("OpenRouter: Found structured image URL/DataURI");
                                // data: URIs cannot be fetched due to CSP — decode directly
                                if (url.startsWith('data:')) {
                                    const [header, b64] = url.split(',');
                                    const mime = header.split(':')[1].split(';')[0];
                                    return UTILITY.base64ToBlob(b64, mime);
                                }
                                return await (await fetch(url)).blob();
                            }
                        }

                        const content = message.content || "";

                        // 1. Check for Markdown Image Syntax: ![alt](url)
                        const mdMatch = content.match(/!\[.*?\]\((.*?)\)/);
                        if (mdMatch) {
                            return await (await fetch(mdMatch[1])).blob();
                        }

                        // 2. Check for raw URL
                        const urlRegex = /https?:\/\/[^\s<>)\]}]+/;
                        const urlMatch = content.match(urlRegex);

                        if (urlMatch) {
                            let url = urlMatch[0];
                            url = url.replace(/[.,;!?]$/, '');
                            console.log("OpenRouter: Extracting URL:", url);
                            try {
                                const imgRes = await fetch(url);
                                const blob = await imgRes.blob();
                                if (blob.type.startsWith('image/')) return blob;
                            } catch (e) {
                                console.warn("Failed to fetch extracted URL:", url);
                            }
                        }

                        // 3. Check for Base64 Data URL or Raw Base64
                        const trimmedContent = content.trim();
                        if (trimmedContent.startsWith('data:image')) {
                            // data: URIs cannot be fetched due to CSP — decode directly
                            const [header, b64] = trimmedContent.split(',');
                            const mime = header.split(':')[1].split(';')[0];
                            return UTILITY.base64ToBlob(b64, mime);
                        }

                        // 4. Check for Raw Base64
                        if (trimmedContent.length > 100 && !trimmedContent.includes(' ') && /^[A-Za-z0-9+/=]+$/.test(trimmedContent)) {
                            console.log("OpenRouter: Detected Raw Base64");
                            return UTILITY.base64ToBlob(trimmedContent, 'image/png');
                        }

                        // 5. Special Case: b64_json
                        if (data.choices[0].message.b64_json) {
                            return UTILITY.base64ToBlob(data.choices[0].message.b64_json, 'image/png');
                        }

                        console.warn("OpenRouter Content (No Image Found):", content);
                        throw new Error("Could not extract image URL from OpenRouter response: " + content.substring(0, 100));
                    } else {
                        throw new Error("OpenRouter returned an empty choices array.");
                    }
                } catch (e) {
                    console.error("OpenRouter Image Gen Failed:", e);
                    throw e;
                }
            },

            /**
             * NanoGPT Image Generation Adapter
             */
            async _generateNanoGPT(prompt, options, initImage = null) {
                const globalSettings = StateManager.data.globalSettings;
                const key = globalSettings.imageGenNanoGPTKey || globalSettings.nanoGPTKey;

                if (!key) throw new Error("NanoGPT API Key is missing. Please set your API key in settings.");

                const model = globalSettings.imageGenNanoGPTModel || "black-forest-labs/flux-1-schnell";
                const width = options.width || globalSettings.imageGenWidth || 1024;
                const height = options.height || globalSettings.imageGenHeight || 1024;
                const size = `${width}x${height}`;

                // NanoGPT supports standard OpenAI /v1/images endpoint as well as chat completions
                // First attempt: Standard OpenAI DALL-E / /v1/images payload
                const imagePayload = {
                    model: model,
                    prompt: prompt,
                    n: 1,
                    size: size
                };

                console.log("NanoGPT Image Req:", imagePayload);

                try {
                    const response = await fetch("https://nano-gpt.com/api/v1/images", {
                        method: 'POST',
                        headers: {
                            "Authorization": `Bearer ${key}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify(imagePayload)
                    });

                    if (response.ok) {
                        const data = await response.json();
                        console.log("NanoGPT Image Res:", data);

                        if (data.data && data.data.length > 0) {
                            const item = data.data[0];
                            if (item.url) {
                                if (item.url.startsWith('data:')) {
                                    const [header, b64] = item.url.split(',');
                                    const mime = header.split(':')[1].split(';')[0];
                                    return UTILITY.base64ToBlob(b64, mime);
                                }
                                return await (await fetch(item.url)).blob();
                            }
                            if (item.b64_json) {
                                return UTILITY.base64ToBlob(item.b64_json, 'image/png');
                            }
                        }
                    }

                    // Fallback to OpenAI chat completions endpoint format for NanoGPT image models
                    const chatPayload = {
                        model: model,
                        messages: [
                            {
                                role: "system",
                                content: "You are an image generation tool. Generate the image requested by the user and output ONLY the image URL. Do not add any conversational text."
                            },
                            { role: "user", content: prompt }
                        ]
                    };

                    const chatRes = await fetch("https://nano-gpt.com/api/v1/chat/completions", {
                        method: 'POST',
                        headers: {
                            "Authorization": `Bearer ${key}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify(chatPayload)
                    });

                    if (!chatRes.ok) {
                        const errText = await chatRes.text();
                        throw new Error(`NanoGPT Image Error (${chatRes.status}): ${errText.substring(0, 200)}`);
                    }

                    const chatData = await chatRes.json();
                    if (chatData.choices && chatData.choices.length > 0) {
                        const msg = chatData.choices[0].message;
                        if (msg.images && msg.images.length > 0) {
                            const imgUrl = msg.images[0].url || msg.images[0];
                            if (typeof imgUrl === 'string') {
                                if (imgUrl.startsWith('data:')) {
                                    const [header, b64] = imgUrl.split(',');
                                    const mime = header.split(':')[1].split(';')[0];
                                    return UTILITY.base64ToBlob(b64, mime);
                                }
                                return await (await fetch(imgUrl)).blob();
                            }
                        }
                        const content = msg.content || "";
                        const urlMatch = content.match(/https?:\/\/[^\s<>)\]}]+/);
                        if (urlMatch) {
                            return await (await fetch(urlMatch[0])).blob();
                        }
                    }

                    throw new Error("Could not extract image from NanoGPT response.");
                } catch (e) {
                    console.error("NanoGPT Image Gen Failed:", e);
                    throw e;
                }
            },
        };
