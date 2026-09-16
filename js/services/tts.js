        /**
         * TTSService Module
         */
        /**
         * =================================================================================================
         * [SEC:JS:SRV:TTS]
         * TTSService Module
         * Handles Text-to-Speech generation using Gemini's API.
         * Support for multiple voices and audio playback.
         * =================================================================================================
         */
        const TTSService = {
            CONSTANTS: {
                VOICES: [
                    { id: 'Zephyr', name: 'Zephyr (M, Bright)' },
                    { id: 'Puck', name: 'Puck (M, Upbeat)' },
                    { id: 'Charon', name: 'Charon (M, Informative)' },
                    { id: 'Kore', name: 'Kore (F, Firm)' },
                    { id: 'Fenrir', name: 'Fenrir (M, Excitable)' },
                    { id: 'Leda', name: 'Leda (F, Youthful)' },
                    { id: 'Orus', name: 'Orus (M, Firm)' },
                    { id: 'Aoede', name: 'Aoede (F, Breezy)' },
                    { id: 'Callirrhoe', name: 'Callirrhoe (F, Easy-going)' },
                    { id: 'Autonoe', name: 'Autonoe (F, Bright)' },
                    { id: 'Enceladus', name: 'Enceladus (M, Breathy)' },
                    { id: 'Iapetus', name: 'Iapetus (M, Clear)' },
                    { id: 'Umbriel', name: 'Umbriel (M, Easy-going)' },
                    { id: 'Algieba', name: 'Algieba (M, Smooth)' },
                    { id: 'Despina', name: 'Despina (F, Smooth)' },
                    { id: 'Erinome', name: 'Erinome (F, Clear)' },
                    { id: 'Algenib', name: 'Algenib (M, Gravelly)' },
                    { id: 'Rasalgethi', name: 'Rasalgethi (M, Informative)' },
                    { id: 'Laomedeia', name: 'Laomedeia (F, Upbeat)' },
                    { id: 'Achernar', name: 'Achernar (F, Soft)' },
                    { id: 'Alnilam', name: 'Alnilam (M, Firm)' },
                    { id: 'Schedar', name: 'Schedar (M, Even)' },
                    { id: 'Gacrux', name: 'Gacrux (F, Mature)' },
                    { id: 'Pulcherrima', name: 'Pulcherrima (M, Forward)' },
                    { id: 'Achird', name: 'Achird (M, Friendly)' },
                    { id: 'Zubenelgenubi', name: 'Zubenelgenubi (M, Casual)' },
                    { id: 'Vindemiatrix', name: 'Vindemiatrix (F, Gentle)' },
                    { id: 'Sadachbia', name: 'Sadachbia (M, Lively)' },
                    { id: 'Sadaltager', name: 'Sadaltager (M, Knowledgeable)' },
                    { id: 'Sulafat', name: 'Sulafat (F, Warm)' }
                ]
            },

            RUNTIME: {
                audioContext: null,
                currentSource: null,
                isPlaying: false
            },

            /**
             * Generates and plays speech for the given text using the specified voice.
             * @param {string} text - The text to speak.
             * @param {string} voiceName - The voice to use (e.g., 'Puck', 'Kore').
             * @returns {Promise<void>}
             */
            async speak(text, voiceName = 'Puck') {
                const state = StateManager.getState();
                const global = StateManager.data.globalSettings;
                const backend = global.ttsBackend || 'gemini';

                if (backend === 'nanogpt') {
                    return this.speakNanoGPT(text, voiceName);
                }

                // Default: Gemini TTS
                const apiKey = global.geminiApiKey || state.geminiApiKey;

                if (!apiKey) {
                    console.warn("TTSService: No Gemini API Key found.");
                    return;
                }

                if (!text || text.trim() === '') return;

                try {
                    // Stop any current audio
                    this.stop();

                    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

                    const payload = {
                        contents: [{ parts: [{ text: text }] }],
                        generationConfig: {
                            responseModalities: ["AUDIO"],
                            speechConfig: {
                                voiceConfig: {
                                    prebuiltVoiceConfig: {
                                        voiceName: voiceName
                                    }
                                }
                            }
                        }
                    };

                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (!response.ok) {
                        const errText = await response.text();
                        console.error("TTS API Error:", errText);
                        // Fallback or notification?
                        UIManager.showNotification("TTS Generation Failed. Check Console.", "error");
                        return;
                    }

                    const data = await response.json();

                    // Extract Audio Base64
                    // Structure: candidates[0].content.parts[0].inlineData.data (Base64)
                    const audioBase64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

                    if (!audioBase64) {
                        console.warn("TTS: No audio data in response.", data);
                        return;
                    }

                    console.log("TTS Audio size:", audioBase64.length);
                    // Play it

                    // Play it
                    this.playAudioFromBase64(audioBase64);

                } catch (e) {
                    console.error("TTS Failure:", e);
                    UIManager.showNotification("TTS Error: " + e.message, "error");
                }
            },

            /**
             * Generates and plays speech using NanoGPT TTS API.
             */
            async speakNanoGPT(text, voiceName = 'nova') {
                const global = StateManager.data.globalSettings;
                const apiKey = global.nanoGPTKey;
                if (!apiKey) {
                    UIManager.showNotification("TTS Error: NanoGPT API Key missing in Settings.", "error");
                    return;
                }
                if (!text || text.trim() === '') return;

                try {
                    this.stop();
                    const model = global.nanoGPTTTSModel || 'tts-1';
                    const voice = global.nanoGPTTTSVoice || voiceName || 'nova';

                    const res = await fetch('https://nano-gpt.com/api/v1/audio/speech', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ model, input: text, voice })
                    });

                    if (!res.ok) {
                        const errText = await res.text();
                        throw new Error(`NanoGPT TTS API Error (${res.status}): ${errText.substring(0, 200)}`);
                    }

                    const contentType = res.headers.get('content-type') || '';
                    if (contentType.includes('application/json')) {
                        const data = await res.json();
                        if (data.id && (data.status === 'processing' || data.status === 'pending')) {
                            const audioUrl = await this._pollNanoGPTTTS(data.id, apiKey);
                            await this.playAudioFromUrl(audioUrl);
                            return;
                        }
                        if (data.audio) {
                            this.playAudioFromBase64(data.audio);
                            return;
                        }
                        if (data.url) {
                            await this.playAudioFromUrl(data.url);
                            return;
                        }
                    }

                    // Direct binary audio stream
                    const arrayBuffer = await res.arrayBuffer();
                    await this.playAudioBuffer(arrayBuffer);
                } catch (e) {
                    console.error("NanoGPT TTS Error:", e);
                    UIManager.showNotification("NanoGPT TTS Error: " + e.message, "error");
                }
            },

            /**
             * Polls NanoGPT async TTS job status until completed.
             */
            async _pollNanoGPTTTS(jobId, apiKey, maxAttempts = 30) {
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    await new Promise(r => setTimeout(r, 1000));
                    const res = await fetch(`https://nano-gpt.com/api/v1/audio/speech/${jobId}`, {
                        headers: { 'Authorization': `Bearer ${apiKey}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.status === 'completed' && data.url) return data.url;
                        if (data.status === 'failed') throw new Error(data.error || "Async TTS job failed.");
                    }
                }
                throw new Error("NanoGPT TTS generation timed out.");
            },

            /**
             * Plays audio directly from an ArrayBuffer (MP3/WAV/OGG).
             */
            async playAudioBuffer(arrayBuffer) {
                try {
                    if (!this.RUNTIME.audioContext) {
                        this.RUNTIME.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    }
                    const audioBuffer = await this.RUNTIME.audioContext.decodeAudioData(arrayBuffer);
                    const source = this.RUNTIME.audioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(this.RUNTIME.audioContext.destination);
                    source.onended = () => {
                        this.RUNTIME.isPlaying = false;
                        this.RUNTIME.currentSource = null;
                        this.updateIndicator(false);
                    };
                    this.RUNTIME.currentSource = source;
                    source.start(0);
                    this.RUNTIME.isPlaying = true;
                    this.updateIndicator(true);
                } catch (e) {
                    console.error("AudioBuffer Playback Error:", e);
                }
            },

            /**
             * Plays audio from a URL string.
             */
            async playAudioFromUrl(url) {
                const res = await fetch(url);
                const arrayBuffer = await res.arrayBuffer();
                await this.playAudioBuffer(arrayBuffer);
            },

            /**
             * Decodes and plays base64 audio.
             * @param {string} base64String 
             */
            async playAudioFromBase64(base64String) {
                try {
                    // Convert Base64 to ArrayBuffer
                    const binaryString = window.atob(base64String);
                    const len = binaryString.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const arrayBuffer = bytes.buffer;

                    // Header Logging (Optional, kept for verification)
                    // const header = Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');
                    // console.log("TTS Audio Header:", header);

                    // Convert PCM to WAV
                    // Gemini TTS returns raw PCM (24kHz, 1 channel, 16-bit usually for these voices)
                    // decodeAudioData requires a container (WAV)
                    const wavBuffer = this.pcmToWav(arrayBuffer, 24000, 1, 16);

                    // Log Header for Debugging
                    const header = Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');
                    console.log("TTS Audio Header:", header);

                    // Initialize AudioContext if needed
                    if (!this.RUNTIME.audioContext) {
                        this.RUNTIME.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    }

                    // Decode
                    // Decode the WAV buffer
                    const audioBuffer = await this.RUNTIME.audioContext.decodeAudioData(wavBuffer);

                    // Create Source
                    const source = this.RUNTIME.audioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(this.RUNTIME.audioContext.destination);

                    source.onended = () => {
                        this.RUNTIME.isPlaying = false;
                        this.RUNTIME.currentSource = null;
                        this.updateIndicator(false);
                    };

                    this.RUNTIME.currentSource = source;
                    source.start(0);
                    this.RUNTIME.isPlaying = true;
                    this.updateIndicator(true);

                } catch (e) {
                    console.error("Audio Playback Error:", e);
                }
            },

            /**
             * Stops current playback.
             */
            stop() {
                if (this.RUNTIME.currentSource) {
                    try {
                        this.RUNTIME.currentSource.stop();
                    } catch (e) { /* ignore if already stopped */ }
                    this.RUNTIME.currentSource = null;
                }
                this.RUNTIME.isPlaying = false;
                this.updateIndicator(false);
            },

            /**
             * Updates the UI indicator for audio playback.
             */


            /**
             * Converts raw PCM data to a WAV buffer.
             */
            pcmToWav(pcmData, sampleRate = 24000, numChannels = 1, bitDepth = 16) {
                const bytesPerSample = bitDepth / 8;
                const blockAlign = numChannels * bytesPerSample;
                const byteRate = sampleRate * blockAlign;
                const dataSize = pcmData.byteLength;
                const buffer = new ArrayBuffer(44 + dataSize);
                const view = new DataView(buffer);

                // RIFF chunk
                this._writeString(view, 0, 'RIFF');
                view.setUint32(4, 36 + dataSize, true);
                this._writeString(view, 8, 'WAVE');

                // fmt chunk
                this._writeString(view, 12, 'fmt ');
                view.setUint32(16, 16, true); // Subchunk1Size
                view.setUint16(20, 1, true); // AudioFormat (PCM)
                view.setUint16(22, numChannels, true);
                view.setUint32(24, sampleRate, true);
                view.setUint32(28, byteRate, true);
                view.setUint16(32, blockAlign, true);
                view.setUint16(34, bitDepth, true);

                // data chunk
                this._writeString(view, 36, 'data');
                view.setUint32(40, dataSize, true);

                // Write PCM data
                const pcmBytes = new Uint8Array(pcmData);
                const wavBytes = new Uint8Array(buffer, 44);
                wavBytes.set(pcmBytes);

                return buffer;
            },

            _writeString(view, offset, string) {
                for (let i = 0; i < string.length; i++) {
                    view.setUint8(offset + i, string.charCodeAt(i));
                }
            },

            updateIndicator(isActive) {
                const indicator = document.getElementById('tts-indicator');
                if (indicator) {
                    indicator.style.display = isActive ? 'flex' : 'none';
                }
            }
        };
