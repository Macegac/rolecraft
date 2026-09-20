        /**
         * =================================================================================================
         * [SEC:JS:CTRL:VIS]
         * VisualMaster
         * Orchestrates the generation and rendering of AI-painted scenes.
         * =================================================================================================
         */
        const VisualMaster = {
            RUNTIME: {
                isProcessing: false,
                imageUrls: {}
            },

            /**
             * Checks if a visual event should be triggered.
             * Returns a Promise that resolves when the visual event is complete (or null if not triggered).
             */
            checkTrigger() {
                if (this.RUNTIME.isProcessing) return null;

                // Guard: Global Image Gen Disabled
                if (typeof UIManager !== 'undefined' && !UIManager.isImageGenEnabled()) return null;

                const state = ReactiveStore.state;
                // Guard: Probability Check - Fix: Treat undefined/NaN as 0
                const rawProb = state.visual_master_probability;
                let probability = 0;

                if (rawProb !== undefined && rawProb !== null && rawProb !== "") {
                    probability = parseFloat(rawProb);
                }

                if (isNaN(probability) || probability <= 0) return null;

                // Dice Roll
                if (Math.random() * 100 > probability) return null;

                // Trigger Visual Event
                this.RUNTIME.isProcessing = true;

                // 1. ADD PLACEHOLDER IMMEDIATELY (Order Preservation)
                const tempId = 'visual_placeholder_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
                const placeholder = {
                    type: 'visual_event',
                    content: 'Painting the scene...',
                    isLoading: true,
                    _tempId: tempId,
                    timestamp: new Date().toISOString()
                };
                // We no longer rely purely on absolute index, as clearSystemErrors could shift it
                state.chat_history.push(placeholder);

                // 2. Start Async Process
                return (async () => {
                    try {
                        console.log("Visual Master: 🎲 Roll successful. Generating scene...");
                        await this.triggerVisualEvent(tempId); // Update the placeholder dynamically via tempId
                    } catch (e) {
                        console.warn("Visual Master failed:", e);
                        // Clean up the placeholder on failure
                        const idx = state.chat_history.findIndex(m => m._tempId === tempId);
                        if (idx !== -1) {
                            state.chat_history.splice(idx, 1);
                        }
                    } finally {
                        this.RUNTIME.isProcessing = false;
                        UIManager.hideLoadingSpinner();
                    }
                })();
            },

            /**
             * Orchestrates the visual generation process.
             * @param {number|string} [atIndexOrTempId] - Optional index or _tempId to generate from (history slicing).
             * @param {HTMLElement} [btnElement] - Optional button element to show loading state.
             */
            async triggerVisualEvent(atIndexOrTempId = null, btnElement = null) {
                // Guard: Global Image Gen Disabled
                if (typeof UIManager !== 'undefined' && !UIManager.isImageGenEnabled()) {
                    UIManager.showNotification("Image generation is disabled in settings.", "warning");
                    return;
                }

                const state = ReactiveStore.state;

                // --- RESOLVE INDEX IF USING TEMPID ---
                let atIndex = atIndexOrTempId;
                if (typeof atIndexOrTempId === 'string') {
                    atIndex = state.chat_history.findIndex(m => m._tempId === atIndexOrTempId);
                }

                // 1. Determine Range
                let historySlice;
                let contextDescription = "";

                if (typeof atIndex === 'number' && atIndex !== -1 && !state.chat_history[atIndex]?.isLoading) {
                    // Specific point in history: [atIndex-4 ... atIndex]
                    // Safe slice handling
                    const start = Math.max(0, atIndex - 4);
                    const end = atIndex + 1; // slice end is exclusive
                    historySlice = state.chat_history.slice(start, end);
                    contextDescription = `(Context: History at message #${atIndex})`;
                } else {
                    // Default: Last 5 messages (excluding current placeholder if at end)
                    const sliceEnd = (typeof atIndex === 'number' && atIndex === state.chat_history.length - 1) ? -1 : undefined;
                    historySlice = state.chat_history.slice(-5, sliceEnd);
                }

                // 1.5 Build Context (Last 5 messages)
                const recentHistory = historySlice
                    .filter(m => m && m.type === 'chat' && !m.isHidden)
                    .map(m => {
                        const char = ReactiveStore.getCharacter(m.character_id);
                        return `${char ? char.name : 'Unknown'}: ${m.content}`;
                    })
                    .join('\n');

                // 2. Gather Physical Descriptions for Active Participants
                const participantIds = NarrativeController.getActiveParticipantIds(5);
                const activeChars = [...state.characters, ...ReactiveStore.getActiveLocationCharacters()]
                    .filter(c => participantIds.includes(c.id));

                const charPersonas = activeChars.map(c => {
                    const appearance = c.appearance || c.short_description || (c.description ? c.description.substring(0, 200) : "No description available.");
                    return `${c.name} (Physical Aspect):\n${appearance}`;
                }).join('\n\n');

                let locationContext = "";
                if (state.worldMap && state.worldMap.currentLocation) {
                    const loc = state.worldMap.grid.find(l => l.coords.x === state.worldMap.currentLocation.x && l.coords.y === state.worldMap.currentLocation.y);
                    if (loc) locationContext = `Location: ${loc.name} - ${loc.description}`;
                }

                // 2. Generate Prompt using AI
                const systemPrompt = state.visual_master_base_prompt || UTILITY.getDefaultSystemPrompts().visual_master_base_prompt;

                const prompt = `${systemPrompt}\n\nCHARACTERS:\n${charPersonas}\n\nSETTING:\n${locationContext}\n\nDIALOGUE:\n${recentHistory}\n\nKey:`;

                const visualDescription = await APIService.callAI(prompt, false);
                if (!visualDescription) throw new Error("Failed to generate visual description.");

                // 3. Generate Image
                // UI feedback on button if present
                let originalIcon = '';
                if (btnElement) {
                    originalIcon = btnElement.innerHTML;
                    btnElement.innerHTML = `<svg class="animate-spin h-4 w-4 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
                    btnElement.disabled = true;
                    btnElement.classList.add('cursor-not-allowed');
                    // Notify the user globally as well
                    UIManager.showNotification("Visual Master: Generating scene...", "info");
                }

                try {
                    // 3. Generate Image
                    const blob = await ImageGenerationService.generateImage(
                        visualDescription, // prompt
                        "nsfw, nude, naked, bad anatomy, text, watermark, blurry, low quality", // negativePrompt
                        { // options
                            width: StateManager.data.globalSettings.imageGenWidth || 512,
                            height: StateManager.data.globalSettings.imageGenHeight || 512,
                            steps: StateManager.data.globalSettings.koboldImageGenSteps || 20
                        }
                    );

                    if (!blob) throw new Error("Image generation failed.");

                    // 4. Save Ephemeral Blob to IDB
                    const imageId = `visual_event_${Date.now()}`;
                    await DBService.saveImage(imageId, blob);

                    // 5. Add to Chat History
                    const visualEntry = {
                        type: 'visual_event',
                        content: visualDescription, // The prompt/caption
                        image_key: imageId,
                        timestamp: new Date().toISOString(),
                        isNew: true
                    };

                    // CRITICAL FIX: Re-resolve index right before update to account for messages added while waiting for generation.
                    let finalIndex = -1;
                    if (typeof atIndexOrTempId === 'string') {
                        finalIndex = state.chat_history.findIndex(m => m._tempId === atIndexOrTempId);
                    } else if (typeof atIndex === 'number' && atIndex !== -1) {
                        finalIndex = atIndex;
                    }

                    if (finalIndex !== -1 && (state.chat_history[finalIndex]?.isLoading || state.chat_history[finalIndex]?.type === 'visual_event')) {
                        // Replace the placeholder exactly where it is (Surgical update)
                        state.chat_history.splice(finalIndex, 1, visualEntry);
                    } else {
                        // Fallback: If placeholder is gone or was manual trigger from history, just append
                        state.chat_history.push(visualEntry);
                    }

                    await ReactiveStore.forceSave();

                    if (typeof atIndex !== 'number' || atIndex >= state.chat_history.length - 2) {
                        setTimeout(() => {
                            const chatWindow = document.getElementById('chat-window');
                            if (chatWindow) chatWindow.scrollTop = chatWindow.scrollHeight;
                        }, 50);
                    }
                } catch (err) {
                    console.error("Visual Event Error:", err);
                    UIManager.showNotification("Visual generation failed: " + err.message, "error");

                    // Take the "Painting the scene..." placeholder back out. This catch does not
                    // rethrow, so the caller's own cleanup never ran: a failed generation left a
                    // message stuck on isLoading forever, which also kept Undo switched off.
                    if (typeof atIndexOrTempId === 'string') {
                        const stuck = state.chat_history.findIndex(m => m._tempId === atIndexOrTempId);
                        if (stuck !== -1 && state.chat_history[stuck].isLoading) {
                            state.chat_history.splice(stuck, 1);
                            ReactiveStore.forceSave();
                            UIManager.renderChat();
                        }
                    }
                } finally {
                    if (btnElement) {
                        btnElement.innerHTML = originalIcon;
                        btnElement.disabled = false;
                        btnElement.classList.remove('cursor-not-allowed');
                    } else {
                        UIManager.hideLoadingSpinner();
                    }
                }
            },
        };
