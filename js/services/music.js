        /**
         * =================================================================================================
         * [SEC:JS:SRV:MUSIC]
         * MusicService Module
         * Handles AI-generated background music using Gemini's Lyria 3 API or OpenRouter.
         * Two-phase pipeline: Scene analysis (text LLM) → Music generation (Lyria/OpenRouter).
         * Playback via Web Audio API with looping and crossfade support.
         * =================================================================================================
         */
        const MusicService = {
            CONSTANTS: {
                MODEL: 'lyria-3-clip-preview',
                DEFAULT_VOLUME: 0.3,
                CROSSFADE_DURATION: 2500,
                PROMPT_SYSTEM: `You are a film score director. Analyze the following roleplay scene context and generate a precise, concise instrumental music generation prompt for an AI music generator. Focus on: genre, tempo (BPM), key instrumentation, mood, and atmosphere. The music MUST be INSTRUMENTAL ONLY — absolutely no vocals, no lyrics, no singing. The prompt must explicitly state "instrumental only, no vocals". Output ONLY the music prompt as a single paragraph and nothing else.

Example output: "Atmospheric dark ambient instrumental, 70 BPM, deep synthesizer pads with distant reverbed piano, tension and unease, cinematic horror atmosphere, no vocals"`
            },

            RUNTIME: {
                audioContext: null,
                currentSource: null,
                gainNode: null,
                currentAudioBuffer: null,
                isPlaying: false,
                isPaused: false,
                isGenerating: false,
                lastMusicPrompt: '',
                lastGeneratedAtCounter: 0,
                abortController: null
            },

            /**
             * Checks if background music should be triggered based on message counter.
             * Called from NarrativeController.startStreamingResponse (post-processing).
             * Non-blocking fire-and-forget.
             */
            checkTrigger() {
                const globalSettings = StateManager.data.globalSettings;
                if (globalSettings.musicMode !== 'on') return;

                // Validate the correct API key based on backend
                const backend = globalSettings.musicBackend || 'gemini';
                if (backend === 'gemini') {
                    if (!globalSettings.geminiApiKey) return;
                } else if (backend === 'openrouter') {
                    if (!globalSettings.openRouterKey) return;
                } else if (backend === 'nanogpt') {
                    if (!globalSettings.nanoGPTKey) return;
                } else {
                    return; // Unknown backend
                }

                if (this.RUNTIME.isGenerating) return;

                const state = ReactiveStore.state;
                const counter = state.messageCounter || 0;
                const interval = parseInt(globalSettings.musicInterval) || 10;

                // First trigger: generate immediately on first qualifying message if nothing is playing
                if (!this.RUNTIME.currentAudioBuffer && counter >= 2) {
                    this.generate();
                    return;
                }

                // Subsequent triggers: regenerate at interval
                if (counter > 0 && counter % interval === 0 && counter !== this.RUNTIME.lastGeneratedAtCounter) {
                    this.generate();
                }
            },

            /**
             * Main orchestrator. Generates a scene-aware music prompt, calls Lyria, and plays the result.
             */
            async generate() {
                if (this.RUNTIME.isGenerating) return;
                this.RUNTIME.isGenerating = true;
                this.RUNTIME.abortController = new AbortController();
                this.updateIndicator('generating');

                try {
                    const state = ReactiveStore.state;
                    this.RUNTIME.lastGeneratedAtCounter = state.messageCounter || 0;

                    // Phase 1: Scene Analysis → Music Prompt
                    console.log('🎵 MusicService: Analyzing scene for music prompt...');
                    const scenePrompt = PromptBuilder.buildMusicPrompt();
                    const musicPrompt = await APIService.callAI(scenePrompt, false, this.RUNTIME.abortController.signal);

                    if (!musicPrompt || musicPrompt.trim().length === 0) {
                        console.warn('MusicService: Empty music prompt from scene analysis.');
                        return;
                    }

                    // Deduplicate: Skip if the prompt is essentially the same
                    if (musicPrompt.trim() === this.RUNTIME.lastMusicPrompt) {
                        console.log('🎵 MusicService: Scene unchanged, skipping regeneration.');
                        return;
                    }
                    this.RUNTIME.lastMusicPrompt = musicPrompt.trim();

                    // Phase 2: Music Generation — route based on backend
                    const backend = StateManager.data.globalSettings.musicBackend || 'gemini';
                    let audioBuffer;
                    if (backend === 'openrouter') {
                        console.log('🎵 MusicService: Generating music via OpenRouter...');
                        audioBuffer = await this.callOpenRouterAudio(musicPrompt);
                    } else if (backend === 'nanogpt') {
                        console.log('🎵 MusicService: Generating music via NanoGPT...');
                        audioBuffer = await this.callNanoGPTAudio(musicPrompt);
                    } else {
                        console.log('🎵 MusicService: Generating music via Lyria (Direct)...');
                        audioBuffer = await this.callLyria(musicPrompt);
                    }

                    if (!audioBuffer) {
                        console.warn('MusicService: No audio data received from music backend.');
                        return;
                    }

                    // Phase 3: Playback
                    if (this.RUNTIME.currentSource) {
                        await this.crossfadeTo(audioBuffer);
                    } else {
                        await this.play(audioBuffer);
                    }

                    console.log('🎵 MusicService: Now playing background music.');

                } catch (e) {
                    if (e.name !== 'AbortError') {
                        console.error('MusicService: Generation failed:', e);
                    }
                } finally {
                    this.RUNTIME.isGenerating = false;
                    this.RUNTIME.abortController = null;
                    if (this.RUNTIME.isPlaying) {
                        this.updateIndicator('playing');
                    } else {
                        this.updateIndicator('hidden');
                    }
                }
            },

            /**
             * Calls the Lyria API to generate a 30-second MP3 clip.
             * @param {string} musicPrompt - The music generation prompt.
             * @returns {Promise<AudioBuffer|null>} Decoded audio buffer.
             */
            async callLyria(musicPrompt) {
                const globalSettings = StateManager.data.globalSettings;
                const apiKey = globalSettings.geminiApiKey;
                if (!apiKey) throw new Error('MusicService: Gemini API key not set.');

                const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.CONSTANTS.MODEL}:generateContent?key=${apiKey}`;

                const payload = {
                    contents: [{
                        parts: [{ text: musicPrompt }]
                    }]
                };

                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: this.RUNTIME.abortController?.signal
                });

                if (!res.ok) {
                    let errorMsg = `Status ${res.status}`;
                    try {
                        const errData = await res.json();
                        errorMsg += `: ${errData.error?.message || JSON.stringify(errData.error)}`;
                    } catch (e) {
                        errorMsg += `: ${await res.text()}`;
                    }
                    throw new Error(`Lyria API Error: ${errorMsg}`);
                }

                const data = await res.json();
                const parts = data.candidates?.[0]?.content?.parts || [];

                // Order-agnostic: iterate parts looking for inlineData with audio
                let audioBase64 = null;
                for (const part of parts) {
                    if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('audio/')) {
                        audioBase64 = part.inlineData.data;
                        break;
                    }
                }

                if (!audioBase64) {
                    console.warn('MusicService: No audio inlineData in Lyria response.', data);
                    return null;
                }

                // Decode Base64 → ArrayBuffer
                const binaryString = window.atob(audioBase64);
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }

                // Initialize AudioContext
                if (!this.RUNTIME.audioContext) {
                    this.RUNTIME.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                }

                // Decode MP3 → AudioBuffer
                const audioBuffer = await this.RUNTIME.audioContext.decodeAudioData(bytes.buffer.slice(0));
                return audioBuffer;
            },

            /**
             * Calls OpenRouter's chat completions API with audio modality to generate music.
             * Uses streaming to collect base64 audio chunks from delta.audio.
             * @param {string} musicPrompt - The music generation prompt.
             * @returns {Promise<AudioBuffer|null>} Decoded audio buffer.
             */
            async callOpenRouterAudio(musicPrompt) {
                const globalSettings = StateManager.data.globalSettings;
                const apiKey = globalSettings.openRouterKey;
                if (!apiKey) throw new Error('MusicService: OpenRouter API key not set.');

                const model = globalSettings.musicOpenRouterModel || 'google/lyria-3-clip-preview';

                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': window.location.href,
                        'X-Title': 'Rolecraft'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: 'user', content: musicPrompt }],
                        stream: true,
                        modalities: ['audio']
                    }),
                    signal: this.RUNTIME.abortController?.signal
                });

                if (!response.ok) {
                    let errorMsg = `Status ${response.status}`;
                    try {
                        const errText = await response.text();
                        const errJson = JSON.parse(errText);
                        errorMsg += `: ${errJson.error?.message || errText}`;
                    } catch (e) {
                        errorMsg += `: ${await response.text().catch(() => 'Unknown error')}`;
                    }
                    throw new Error(`OpenRouter Music API Error: ${errorMsg}`);
                }

                const contentType = response.headers.get('content-type') || '';
                let audioBase64 = '';

                if (contentType.includes('text/event-stream')) {
                    // Stream-read the SSE response, collecting base64 audio chunks
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder('utf-8');
                    let audioChunks = [];
                    let sseBuffer = '';

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        sseBuffer += decoder.decode(value, { stream: true });
                        const lines = sseBuffer.split('\n');
                        // Keep the last (potentially incomplete) line in the buffer
                        sseBuffer = lines.pop() || '';

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed.startsWith('data: ')) continue;
                            const dataStr = trimmed.slice(6);
                            if (dataStr === '[DONE]') continue;

                            try {
                                const json = JSON.parse(dataStr);
                                const delta = json.choices?.[0]?.delta;
                                if (delta?.audio) {
                                    if (typeof delta.audio === 'string') {
                                        audioChunks.push(delta.audio);
                                    } else if (delta.audio.data) {
                                        audioChunks.push(delta.audio.data);
                                    }
                                }
                            } catch (e) {
                                // Skip malformed chunks
                            }
                        }
                    }
                    audioBase64 = audioChunks.join('');
                } else {
                    // Parse non-streaming standard JSON response
                    const data = await response.json();
                    const message = data.choices?.[0]?.message;
                    if (message?.audio?.data) {
                        audioBase64 = message.audio.data;
                    } else if (message?.audio && typeof message.audio === 'string') {
                        audioBase64 = message.audio;
                    } else if (data.candidates?.[0]?.content?.parts) {
                        // Direct Gemini response wrapper passthrough fallback
                        const parts = data.candidates[0].content.parts;
                        for (const part of parts) {
                            if (part.inlineData?.data) {
                                audioBase64 = part.inlineData.data;
                                break;
                            }
                        }
                    }
                }

                if (!audioBase64) {
                    console.warn('MusicService: No audio data received from OpenRouter.');
                    return null;
                }

                // Decode Base64 → ArrayBuffer
                const binaryString = window.atob(audioBase64);
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }

                // Initialize AudioContext
                if (!this.RUNTIME.audioContext) {
                    this.RUNTIME.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                }

                // Decode audio → AudioBuffer
                const audioBuffer = await this.RUNTIME.audioContext.decodeAudioData(bytes.buffer.slice(0));
                return audioBuffer;
            },

            /**
             * Plays an AudioBuffer on loop.
             * @param {AudioBuffer} audioBuffer
             */
            async play(audioBuffer) {
                if (!this.RUNTIME.audioContext) {
                    this.RUNTIME.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                }

                // Resume if suspended (mobile auto-suspend policy)
                if (this.RUNTIME.audioContext.state === 'suspended') {
                    await this.RUNTIME.audioContext.resume();
                }

                const source = this.RUNTIME.audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.loop = true;

                const gainNode = this.RUNTIME.audioContext.createGain();
                const globalSettings = StateManager.data.globalSettings;
                const volume = (parseInt(globalSettings.musicVolume) || 30) / 100;
                gainNode.gain.value = volume;

                source.connect(gainNode);
                gainNode.connect(this.RUNTIME.audioContext.destination);

                source.start(0);

                this.RUNTIME.currentSource = source;
                this.RUNTIME.gainNode = gainNode;
                this.RUNTIME.currentAudioBuffer = audioBuffer;
                this.RUNTIME.isPlaying = true;
                this.RUNTIME.isPaused = false;
                this.updateIndicator('playing');
            },

            /**
             * Crossfades from the current track to a new one.
             * @param {AudioBuffer} newBuffer
             */
            async crossfadeTo(newBuffer) {
                const ctx = this.RUNTIME.audioContext;
                if (!ctx) return this.play(newBuffer);

                if (ctx.state === 'suspended') await ctx.resume();

                const fadeDuration = this.CONSTANTS.CROSSFADE_DURATION / 1000;
                const now = ctx.currentTime;

                // Fade out current
                const oldGain = this.RUNTIME.gainNode;
                if (oldGain) {
                    oldGain.gain.setValueAtTime(oldGain.gain.value, now);
                    oldGain.gain.linearRampToValueAtTime(0, now + fadeDuration);
                }

                // Create new source
                const newSource = ctx.createBufferSource();
                newSource.buffer = newBuffer;
                newSource.loop = true;

                const newGain = ctx.createGain();
                const globalSettings = StateManager.data.globalSettings;
                const targetVolume = (parseInt(globalSettings.musicVolume) || 30) / 100;
                newGain.gain.setValueAtTime(0, now);
                newGain.gain.linearRampToValueAtTime(targetVolume, now + fadeDuration);

                newSource.connect(newGain);
                newGain.connect(ctx.destination);
                newSource.start(0);

                // Clean up old source after fade
                const oldSource = this.RUNTIME.currentSource;
                setTimeout(() => {
                    try {
                        if (oldSource) oldSource.stop();
                    } catch (e) { /* already stopped */ }
                    if (oldGain) {
                        try { oldGain.disconnect(); } catch (e) { }
                    }
                }, this.CONSTANTS.CROSSFADE_DURATION + 100);

                this.RUNTIME.currentSource = newSource;
                this.RUNTIME.gainNode = newGain;
                this.RUNTIME.currentAudioBuffer = newBuffer;
                this.RUNTIME.isPlaying = true;
                this.RUNTIME.isPaused = false;
            },

            /**
             * Toggles pause/resume.
             */
            togglePlayback() {
                if (!this.RUNTIME.audioContext || !this.RUNTIME.currentSource) return;

                if (this.RUNTIME.isPaused) {
                    this.RUNTIME.audioContext.resume();
                    this.RUNTIME.isPaused = false;
                    this.RUNTIME.isPlaying = true;
                    this.updateIndicator('playing');
                } else {
                    this.RUNTIME.audioContext.suspend();
                    this.RUNTIME.isPaused = true;
                    this.RUNTIME.isPlaying = false;
                    this.updateIndicator('paused');
                }
            },

            /**
             * Cycles through volume levels: 30% → 60% → 100% → 15% → 30%
             */
            cycleVolume() {
                const globalSettings = StateManager.data.globalSettings;
                const steps = [15, 30, 60, 100];
                let current = parseInt(globalSettings.musicVolume) || 30;
                let idx = steps.indexOf(current);
                idx = (idx + 1) % steps.length;
                const newVol = steps[idx];

                globalSettings.musicVolume = newVol;
                StateManager.saveGlobalSettings();
                this.setVolume(newVol / 100);

                // Update label
                const label = document.querySelector('#music-indicator .music-label');
                if (label) label.textContent = `${newVol}%`;
                // Reset label after 1.5s
                setTimeout(() => {
                    if (label) label.textContent = 'Music';
                }, 1500);

                // Update settings slider if visible
                const slider = document.getElementById('music-volume-slider');
                const val = document.getElementById('music-volume-value');
                if (slider) slider.value = newVol;
                if (val) val.textContent = `${newVol}%`;
            },

            /**
             * Sets the gain node volume.
             * @param {number} vol - Volume 0.0 to 1.0
             */
            setVolume(vol) {
                if (this.RUNTIME.gainNode) {
                    this.RUNTIME.gainNode.gain.setValueAtTime(
                        Math.max(0, Math.min(1, vol)),
                        this.RUNTIME.audioContext?.currentTime || 0
                    );
                }
            },

            /**
             * Stops all playback and resets state.
             */
            stop() {
                if (this.RUNTIME.abortController) {
                    try { this.RUNTIME.abortController.abort(); } catch (e) { }
                }
                if (this.RUNTIME.currentSource) {
                    try { this.RUNTIME.currentSource.stop(); } catch (e) { }
                    this.RUNTIME.currentSource = null;
                }
                if (this.RUNTIME.gainNode) {
                    try { this.RUNTIME.gainNode.disconnect(); } catch (e) { }
                    this.RUNTIME.gainNode = null;
                }
                this.RUNTIME.currentAudioBuffer = null;
                this.RUNTIME.isPlaying = false;
                this.RUNTIME.isPaused = false;
                this.RUNTIME.isGenerating = false;
                this.RUNTIME.lastMusicPrompt = '';
                this.RUNTIME.lastGeneratedAtCounter = 0;
                this.updateIndicator('hidden');
            },

            /**
             * Updates the floating music indicator UI.
             * @param {'hidden'|'generating'|'playing'|'paused'} mode
             */
            updateIndicator(mode) {
                const el = document.getElementById('music-indicator');
                if (!el) return;

                el.classList.remove('generating', 'paused');

                switch (mode) {
                    case 'hidden':
                        el.style.display = 'none';
                        break;
                    case 'generating':
                        el.style.display = 'flex';
                        el.classList.add('generating');
                        break;
                    case 'playing':
                        el.style.display = 'flex';
                        break;
                    case 'paused':
                        el.style.display = 'flex';
                        el.classList.add('paused');
                        break;
                }
            }
        };
