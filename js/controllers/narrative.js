        /**
         * =================================================================================================
         * [SEC:JS:CTRL:NAR]
         * NarrativeController
         * The primary engine for managing chat interactions, AI generation, and narrative flow.
         * =================================================================================================
         */
        const NarrativeController = {
            CONSTANTS: {
                CHARACTER_COLORS: [
                    { base: '#334155', bold: '#94a3b8' }, // Slate
                    { base: '#1e3a8a', bold: '#60a5fa' }, // Blue
                    { base: '#581c87', bold: '#f472b6' }, // Fuchsia
                    { base: '#78350f', bold: '#fbbf24' }, // Amber
                    { base: '#365314', bold: '#a3e635' }, // Lime
                    { base: '#5b21b6', bold: '#a78bfa' }, // Violet
                    { base: '#881337', bold: '#fb7185' }, // Rose
                    { base: '#155e75', bold: '#22d3ee' }  // Cyan
                ]
            },

            RUNTIME: {
                streamingInterval: null,
                activeRequestAbortController: null,
                lastPromptDetails: null // [NEW] Stores the last prompt sent to AI
            },

            /**
             * Handles image file selection for vision support.
             */
            async handleImageUpload(event) {
                const file = event.target.files[0];
                if (!file) return;

                if (!file.type.startsWith('image/')) {
                    UIManager.showToast("Please select an image file.", true);
                    return;
                }

                // Max 10MB safety check
                if (file.size > 10 * 1024 * 1024) {
                    UIManager.showToast("Image too large (Max 10MB).", true);
                    return;
                }

                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const blob = new Blob([arrayBuffer], { type: file.type });
                    ReactiveStore.state.pendingImage = blob;

                    // Vision Support Check
                    const state = StateManager.getState();
                    const provider = state.apiProvider;
                    const model = (provider === 'gemini' ? (state.geminiModel || StateManager.data.globalSettings.geminiModel) :
                        provider === 'openrouter' ? state.openRouterModel :
                            provider === 'koboldcpp' ? 'local' :
                                provider === 'lmstudio' ? 'local' : 'unknown') || 'unknown';

                    if (!APIService._supportsVision(provider, model)) {
                        const directions = APIService.getVisionDirections(provider);
                        UIManager.showToast(`Note: Your current model may not support image analysis. ${directions}`, true, 8000);
                    }

                    // Show preview
                    const previewContainer = document.getElementById('image-preview-container');
                    const previewImg = document.getElementById('image-preview');

                    if (previewContainer && previewImg) {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            previewImg.src = e.target.result;
                            previewContainer.style.display = 'block';
                            UIManager.updateVisionWarning(); // Update persistent warning if exists
                        };
                        reader.readAsDataURL(blob);
                    }

                    // Clear the input so the same file can be re-selected if removed
                    event.target.value = '';
                } catch (e) {
                    console.error("Image processing failed:", e);
                    UIManager.showToast("Failed to process image.", true);
                }
            },

            /**
             * Removes the currently selected pending image.
             */
            removePendingImage() {
                ReactiveStore.state.pendingImage = null;
                const previewContainer = document.getElementById('image-preview-container');
                if (previewContainer) previewContainer.style.display = 'none';
                const input = document.getElementById('image-upload-input');
                if (input) input.value = '';
            },

            /**
             * Clears and hides the response options container.
             */
            _clearResponseOptions() {
                const container = document.getElementById('response-options-container');
                if (container) {
                    container.innerHTML = '';
                    container.classList.add('hidden');
                }
                this.updateChatInputShrinkState();
            },

            /**
             * Updates the chat input container shrunk state based on whether CYOA options are visible.
             */
            updateChatInputShrinkState() {
                const container = document.getElementById('chat-input-container');
                const chatInput = document.getElementById('chat-input');
                const responseOptionsContainer = document.getElementById('response-options-container');
                if (!container || !chatInput || !responseOptionsContainer) return;

                const hasOptions = !responseOptionsContainer.classList.contains('hidden') && responseOptionsContainer.children.length > 0;
                const isFocused = document.activeElement === chatInput;
                const hasText = chatInput.value.trim().length > 0;

                const shouldShrink = hasOptions && !isFocused && !hasText;

                if (shouldShrink) {
                    if (!container.classList.contains('cyoa-shrunk')) {
                        container.classList.add('cyoa-shrunk');
                        chatInput.placeholder = "Or type a custom action...";
                    }
                } else {
                    if (container.classList.contains('cyoa-shrunk')) {
                        container.classList.remove('cyoa-shrunk');
                        chatInput.placeholder = "Message...";
                    }
                }
            },


            // --- Chat Interaction ---

            /**
             * Handles generating a specific directive from the user to a character.
             * @param {string|boolean} actionVal - 'user', 'ai', or 'regen'.
             * @param {boolean} isRegen - If true, regenerates the last message instead of creating a new one.
             */
            async handleDirectCharacter(actionVal, isRegen = false) {
                // Belt and braces: the context menu is suppressed in Text Mode, but this must
                // never reach the main narrative pipeline from a private thread.
                if (typeof TextModeController !== 'undefined' && TextModeController.isActive()) return;

                if (!StateManager.getLibrary().active_story_id) return;

                const input = document.getElementById('chat-input');
                const directiveText = input.value.trim();
                if (!directiveText) {
                    UIManager.showNotification("Please enter a directive in the input field first.", "warning");
                    return;
                }

                input.value = '';

                const state = ReactiveStore.state;
                let targetId = null;
                let targetMessageIndex = null;

                if (isRegen || actionVal === 'regen') {
                    for (let i = state.chat_history.length - 1; i >= 0; i--) {
                        const msg = state.chat_history[i];
                        if (msg && msg.type === 'chat' && !msg.isHidden) {
                            targetMessageIndex = i;
                            targetId = msg.character_id;
                            break;
                        }
                    }

                    if (targetMessageIndex === null || !targetId) {
                        UIManager.showNotification("No valid message to regenerate.", "error");
                        return;
                    }
                } else if (actionVal === 'user' || actionVal === true) {
                    const userChar = state.characters.find(c => c.is_user);
                    if (!userChar) {
                        UIManager.showNotification("No user character found in this scenario.", "error");
                        return;
                    }
                    targetId = userChar.id;
                } else {
                    const selectorVal = document.getElementById('ai-character-selector').value;
                    if (selectorVal === 'any' || selectorVal === 'event_master') {
                        targetId = await this.determineNextSpeaker(false);
                    } else {
                        targetId = selectorVal;
                    }
                }

                if (!targetId) return;

                const directiveInstruction = `[DIRECTIVE]: The Director has issued the following instruction for your next action. You MUST act this out exactly:\n"${directiveText}"`;

                if (this.RUNTIME.activeRequestAbortController) {
                    this.stopGeneration();
                }
                if (UIManager.RUNTIME.streamingInterval) {
                    clearInterval(UIManager.RUNTIME.streamingInterval);
                    UIManager.RUNTIME.streamingInterval = null;
                }

                this._clearResponseOptions();

                if (state.swarmMode && typeof SwarmOrchestrator !== 'undefined') {
                    await this._executeSwarmTurn(directiveInstruction, targetId, targetMessageIndex);
                } else {
                    await this.triggerAIResponse(targetId, directiveInstruction, true, targetMessageIndex, null);
                }
            },

            /**
             * Handles the primary action button (Send/Write).
             * Delegates to triggerAIResponse (if empty) or sendMessage (if text present).
             */
            async handlePrimaryAction() {
                if (!StateManager.getLibrary().active_story_id) {
                    UIManager.showConfirmationModal("Please load or create a story from the Story Library first.", () => AppController.openModal('story-library-modal'));
                    return;
                }

                // New logic: Empty = Trigger AI. Text = Send.
                const input = document.getElementById('chat-input');

                // ── TEXT MODE BRANCH ──────────────────────────────────────────────────────
                // A private thread is open, so neither branch should touch the main narrative.
                if (typeof TextModeController !== 'undefined' && TextModeController.isActive()) {
                    const typed = input.value.trim();
                    if (typed) {
                        input.value = '';
                        await TextModeController.sendInThread(typed);
                    } else {
                        await TextModeController.generateFollowUp();
                    }
                    return;
                }
                // ── END TEXT MODE BRANCH ──────────────────────────────────────────────────

                if (input.value.trim() === '') {
                    // Empty Input = Pass Turn
                    this._clearResponseOptions();

                    // 0. STOP existing generation if running
                    if (this.RUNTIME.activeRequestAbortController) {
                        this.stopGeneration();
                    }
                    if (UIManager.RUNTIME.streamingInterval) {
                        clearInterval(UIManager.RUNTIME.streamingInterval);
                        UIManager.RUNTIME.streamingInterval = null;
                    }

                    const state = ReactiveStore.state;

                    const selectorElement = document.getElementById('ai-character-selector');
                    let selectorVal = selectorElement.value;
                    const forceEventMaster = selectorVal === 'event_master';

                    // 1. If swarm mode is active and no specific character is forced, bypass standard pipeline entirely
                    if (state.swarmMode && typeof SwarmOrchestrator !== 'undefined' && selectorVal !== 'event_master') {
                        const forcedId = selectorVal === 'any' ? null : selectorVal;
                        await this._executeSwarmTurn('', forcedId);
                        return;
                    }

                    // 2. Run Event Master (BLOCKING)
                    await this.checkEventMaster(forceEventMaster);

                    if (forceEventMaster) {
                        selectorElement.value = 'any';
                        selectorVal = 'any';
                    }

                    // 3. Run Visual Master & Speaker Selection (Concurrent)
                    let speakerPromise = null;
                    if (selectorVal === 'any') {
                        speakerPromise = this.determineNextSpeaker(false);
                    } else {
                        speakerPromise = Promise.resolve(selectorVal);
                    }

                    let visualBlocker = null;
                    if (typeof VisualMaster !== 'undefined') {
                        visualBlocker = VisualMaster.checkTrigger();
                    }

                    // 4. Trigger standard single-character response
                    await this.triggerAIResponse(speakerPromise, '', false, null, visualBlocker);
                } else {
                    this.sendMessage();
                }
            },

            /**
             * Handles the "Bolt" button action (Continue Writing).
             * Sends the current input + history to AI to complete the sentence.
             */
            async handleBoltAction() {
                if (!StateManager.getLibrary().active_story_id) return;
                const input = document.getElementById('chat-input');
                const userText = input.value;

                // Show loading state
                const boltBtn = document.getElementById('bolt-btn');
                const originalIcon = boltBtn ? boltBtn.innerHTML : '';
                if (boltBtn) {
                    boltBtn.innerHTML = `<svg class="animate-spin h-5 w-5 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
                    boltBtn.disabled = true;
                }

                try {
                    const state = ReactiveStore.state;
                    const userChar = state.characters.find(c => c.is_user);
                    if (!userChar) {
                        UIManager.showNotification("User character not found. Set a character as 'User' in the roster.", "warning");
                        return;
                    }

                    // Calculate Custom Instruction
                    let customInstruction = null;
                    if (userText.trim().length > 0) {
                        customInstruction = `Begin your response with the following and continue writing for ${userChar.name}:\n${userText}`;
                    }

                    // Use PromptBuilder to generate the prompt with full context and rules
                    const prompt = PromptBuilder.buildPrompt(userChar.id, true, null, customInstruction);

                    // Call AI
                    const continuation = await APIService.callAI(prompt, false);

                    // Append logic
                    if (continuation) {
                        let finalResult = continuation.trim();

                        // Clean up leaked Event Master instructions if the model hallucinated them
                        const leakMatch = finalResult.match(/(?:---|###|\[|\n)?\s*SECRET EVENT MASTER INSTRUCTION/i);
                        if (leakMatch) {
                            finalResult = finalResult.substring(0, leakMatch.index).trim();
                        }

                        // Strip echoed prefix if the model repeats it (common for some chat models)
                        if (userText.trim() && finalResult.toLowerCase().startsWith(userText.trim().toLowerCase())) {
                            finalResult = finalResult.substring(userText.trim().length).trim();
                        }

                        // Add spacing if needed
                        const separator = (input.value.length > 0 && !input.value.endsWith(' ')) ? ' ' : '';
                        input.value = input.value + separator + finalResult;
                        input.focus();

                        // Trigger auto-expand if implementation exists
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }

                } catch (e) {
                    console.error("Bolt Action Failed:", e);
                    UIManager.showNotification("Failed to continue text.", "error");
                } finally {
                    if (boltBtn) {
                        boltBtn.innerHTML = originalIcon;
                        boltBtn.disabled = false;
                    }
                }
            },

            /**
             * Handles the "Bolt" button action inside the Edit Modal.
             * Continues writing based on the text currently in the modal.
             */
            async handleEditModalBoltAction() {
                const input = document.getElementById('edit-modal-input');
                const userText = input.value;
                if (!userText) return; // Don't continue empty text in edit mode, usually not desired

                // Show loading state
                const boltBtn = document.getElementById('edit-modal-bolt-button');
                const originalIcon = boltBtn ? boltBtn.innerHTML : '';
                if (boltBtn) {
                    boltBtn.innerHTML = `<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
                    boltBtn.disabled = true;
                }

                try {
                    const state = ReactiveStore.state;
                    // For Edit Mode, we assume the context is the relevant character or Story context.
                    // However, we need a "POV" character for the prompt.
                    // Ideally, we use the character who OWNS this message, OR the User if it's a user message.
                    // But openEditModal doesn't easily pass that info to us here unless we store it.
                    // WORKAROUND: We will use the USER character as the "Anchor" for the prompt perspective,
                    // but the instruction is to continue the text.

                    const userChar = state.characters.find(c => c.is_user);
                    if (!userChar) throw new Error("No user character found.");

                    // Calculate Custom Instruction
                    // "Continue the following text:"
                    const customInstruction = `Continue the following text exactly where it leaves off. Maintain the same style and voice:\n\n${userText}`;

                    // Retrieve valid chat history? 
                    // PROMPT TRICK: We don't want the AI to see the *original* version of the message we are editing in the history, 
                    // causing duplication loops.
                    // But determining which message is being edited is hard here without extra state.
                    // SIMPLIFICATION: We build a generic prompt. The 'customInstruction' is strong enough usually.

                    const prompt = PromptBuilder.buildPrompt(userChar.id, true, null, customInstruction);

                    // Call AI
                    const continuation = await APIService.callAI(prompt, false);

                    if (continuation) {
                        let finalResult = continuation.trim();

                        // Clean up leaked Event Master instructions if the model hallucinated them
                        const leakMatch = finalResult.match(/(?:---|###|\[|\n)?\s*SECRET EVENT MASTER INSTRUCTION/i);
                        if (leakMatch) {
                            finalResult = finalResult.substring(0, leakMatch.index).trim();
                        }

                        // Heuristic: If model repeats the input (common), strip it.
                        // We check the last 50 chars of input vs start of output
                        const inputEnd = userText.slice(-50).trim();
                        if (finalResult.startsWith(inputEnd)) {
                            // This is risky if the repetition is valid, but usually it's an Artifact.
                            // Let's rely on the "Continue..." instruction being robust first.
                        }

                        // Just Append
                        const separator = (userText.length > 0 && !userText.endsWith(' ') && !userText.endsWith('\n')) ? ' ' : '';
                        input.value = userText + separator + finalResult;

                        // Updates
                        input.focus();
                        input.scrollTop = input.scrollHeight;
                    }

                } catch (e) {
                    console.error("Edit Bolt Action Failed:", e);
                    UIManager.showNotification("Failed to continue text.", "error");
                } finally {
                    if (boltBtn) {
                        boltBtn.innerHTML = originalIcon;
                        boltBtn.disabled = false;
                    }
                }
            },
            /**
             * Generates just the character skeleton (tags, instructions, color, short_description).
             * @param {string} name - The character's name.
             * @param {string} contextString - The context surrounding the character.
             * @returns {Promise<Object>}
             */
            async generateCharacterSkeleton(name, contextString) {
                const skeletonPrompt = `You are a creative writer and roleplayer. You are outlining a character named "${name}".
                
CONTEXT FOR THIS CHARACTER:
${contextString}

TASK:
Generate the technical metadata and skeleton for this character.

You MUST format your response using EXACTLY these headings:

### Model Instructions
Write instructions for an AI model to roleplay as you. Write this in your own voice. Example: "I speak quietly and rarely make eye contact. I am suspicious of strangers..."

### Short Description
A standard, objective 3rd-person summary of who you are (one sentence).

### Tags
tag1, tag2, tag3 (comma separated list)

### Color Hex
#71717a (generate a hex code for a color that you feel matches this character's personality)`;

                try {
                    const response = await APIService.callAI(skeletonPrompt, false);
                    if (response) {
                        const skeleton = UTILITY.extractStructuredHeadings(response, ['Model Instructions', 'Short Description', 'Tags', 'Color Hex']);
                        if (typeof skeleton['Tags'] === 'string') {
                            skeleton.tags = skeleton['Tags'].split(',').map(s => s.trim()).filter(Boolean);
                        }
                        // Map back to standard keys
                        return {
                            model_instructions: skeleton['Model Instructions'],
                            short_description: skeleton['Short Description'],
                            tags: skeleton.tags || [],
                            color_hex: skeleton['Color Hex']
                        };
                    }
                    throw new Error("Empty skeleton response.");
                } catch (e) {
                    console.error("Skeleton Gen Failed:", e);
                    return { tags: [], color_hex: "#ffffff", short_description: "New Character", model_instructions: "" };
                }
            },

            /**
             * Generates a complete character profile systematically.
             * @param {string} name - The character's name.
             * @param {string} contextString - The context surrounding the character's creation.
             * @param {Object} [initialSkeleton=null] - Pre-generated skeleton to skip Step 1.
             * @returns {Promise<Object>} - The generated character profile.
             */
            async generateCharacterProfile(name, contextString, initialSkeleton = null) {
                let skeleton = initialSkeleton;

                if (!skeleton) {
                    // STEP 1: Generate Skeleton (Structured Markdown)
                    // We exclude the heavy description from the structural constraint to allow the model to be more concise here
                    // and avoid truncation issues.
                    const skeletonPrompt = `You are a creative writer and roleplayer. You are outlining a character named "${name}".
                
### Context for this Character
${contextString}

### Task
Generate the technical metadata and skeleton for this character.

You MUST format your response using EXACTLY these headings:

### Model Instructions
Write instructions for an AI model to roleplay as you. Write this in your own voice. Example: "I speak quietly and rarely make eye contact. I am suspicious of strangers..."

### Short Description
A standard, objective 3rd-person summary of who you are (one sentence).

### Tags
tag1, tag2, tag3 (comma separated list)

### Color Hex
#71717a (generate a hex code for a color that you feel matches this character's personality)`;
                    try {
                        const response = await APIService.callAI(skeletonPrompt, false);
                        if (response) {
                            const skeletonData = UTILITY.extractStructuredHeadings(response, ['Model Instructions', 'Short Description', 'Tags', 'Color Hex']);
                            skeleton = {
                                model_instructions: skeletonData['Model Instructions'],
                                short_description: skeletonData['Short Description'],
                                tags: (typeof skeletonData['Tags'] === 'string')
                                    ? skeletonData['Tags'].split(',').map(s => s.trim()).filter(Boolean)
                                    : [],
                                color_hex: skeletonData['Color Hex']
                            };
                        } else {
                            throw new Error("Empty skeleton response.");
                        }
                    } catch (e) {
                        console.error("Skeleton Gen Failed:", e);
                        // Fallback empty skeleton to at least try description
                        skeleton = { tags: [], color_hex: "#ffffff", short_description: "New Character", model_instructions: "" };
                    }
                }

                // STEP 2: Generate Description (Text/Prose) via Multi-Prompt Interview
                const interviewQuestions = [
                    {
                        heading: "Appearance",
                        question: "Describe your outward appearance and how you present yourself to others. Include detailed physical attributes (facial features, hair/eye color) and clothing. Focus on your 'public mask'—what you want the world to see and how that might differ from your true internal self or secret motives."
                    },
                    {
                        heading: "Description",
                        question: "Describe who you are in this world. Include your position in society, relation to others, and what you do professionally or otherwise."
                    },
                    {
                        heading: "Character intentions",
                        question: "What drives you? What are your goals, both long term and short term?"
                    },
                    {
                        heading: "Personal History",
                        question: "Describe your personal history; how you became who you are today and what you consider to be the most formative events of your life. They can be large or small events, but should be things that you feel molded how you approach the world."
                    },
                    {
                        heading: "Fears and Joys",
                        question: "What scares you? What brings you the most joy?"
                    }
                ];

                let compiledDescription = "";
                let appearanceText = "";
                let previousAnswersContext = "";

                for (let i = 0; i < interviewQuestions.length; i++) {
                    const q = interviewQuestions[i];

                    const descriptionPrompt = `You are a creative writer and roleplayer. You are interviewing a character named "${name}".
                
CONTEXT FOR THIS CHARACTER:
${contextString}

EXISTING METADATA:
Short Bio: ${skeleton.short_description}
Instructions: ${skeleton.model_instructions}

${previousAnswersContext ? `PREVIOUS INTERVIEW ANSWERS (Use these to maintain consistency):\n${previousAnswersContext}\n` : ""}

Adopt the persona of ${name}. I will ask you to describe yourself based on a specific question. You must answer in the first person, using prose that reflects your voice, mannerisms, and internal thoughts. Use first person 'prose-style' writing (e.g. "That's what I'm telling you!" I brush the hair from my eyes as I look out at the sunset. "Don't you understand *anything*?")

OUTPUT FORMAT:
Write ONLY the character's response text.

Your response to the interview question: ${q.question}
Write this as a prose scene. Use dialogue tags and action beats. Example: "I've never cared much for rules," I say, leaning back in my chair...

CRITICAL INSTRUCTION: The response MUST be written as an out of scenario context roleplay response in First Person Prose. The goal of this is thoroughly convey the character's voice and mannerisms. Emphasize these as you respond to ensure this character is unique, compelling, and easily identifiable through their speech alone.`;

                    let response = null;
                    try {
                        response = await APIService.callAI(descriptionPrompt, false);
                    } catch (err) {
                        console.error(`[Architect] Interview question "${q.heading}" for ${name} failed:`, err);
                    }

                    if (response && response.trim()) {
                        const answer = response.trim();
                        // Special Case: Appearance is stored in its own field but ALSO kept in the compiled description for context
                        if (q.heading === "Appearance") {
                            appearanceText = answer;
                        }

                        // Format specifically for markdown rendering with headings
                        compiledDescription += `### ${q.heading}\n${answer}\n\n`;
                        // Keep previous answers in context for AI consistency
                        previousAnswersContext += `Question: ${q.question}\nAnswer: ${answer}\n\n`;
                    }
                }

                // STEP 3: Generate specific meta-fields
                const descFinal = compiledDescription ? compiledDescription.trim() : "No description generated.";

                let finalShortDesc = skeleton.short_description;
                let finalAppearance = appearanceText;

                if (descFinal && descFinal !== "No description generated.") {
                    try {
                        const shortDescPrompt = `Read the following persona description and create a condensed, 1-2 sentence summary/short description representing the character's core identity:\n\n${descFinal}`;
                        const appearancePrompt = `You are a creative writer. Based on the following character persona, describe their outward physical appearance only. 
Include detailed physical attributes (facial features, hair/eye color, body type, posture). 
Focus strictly on visual, tangible details that could be used by an artist or image generator. 
Inner thoughts, personality traits, and history are inappropriate in this response and will be covered at a later time. 
Be concise but descriptive.

### Persona
${descFinal}

### Output Format
Return ONLY the physical description. Write in the 3rd person. No preamble.`;

                        const [shortDescRes, appearanceRes] = await Promise.all([
                            APIService.callAI(shortDescPrompt, false),
                            APIService.callAI(appearancePrompt, false)
                        ]);

                        if (shortDescRes && shortDescRes.trim()) finalShortDesc = shortDescRes.trim();
                        if (appearanceRes && appearanceRes.trim()) finalAppearance = appearanceRes.trim();
                    } catch (e) {
                        console.error("Meta-field gen failed:", e);
                    }
                }

                // STEP 4: Merge
                return {
                    ...skeleton,
                    short_description: finalShortDesc,
                    appearance: finalAppearance,
                    description: descFinal
                };
            },
            /**
             * Checks if the "Event Master" should trigger a random event.
             * Rolls a die and, if successful, generates a system instruction for the AI.
             * @param {boolean} force - If true, bypasses the probability check.
             */
            async checkEventMaster(force = false) {
                const state = ReactiveStore.state;

                // 1. Configuration Guard
                if (!state.event_master_base_prompt) return;

                // 2. Dice Roll: Configurable Chance
                if (!force) {
                    // Strictly parse probability to prevent NaN causing 100% trigger rate
                    let probability = parseInt(state.event_master_probability);
                    // Fix: Default to 0 (Disabled) if invalid or undefined (Legacy mismatch fix)
                    if (isNaN(probability)) probability = 0;

                    // Guard: Strict disable if probability is 0 (or less)
                    if (probability <= 0) return;

                    // Logic: If random roll (0-100) is GREATER than probability, we SKIP.
                    // Example: Prob 15. Roll 20. 20 > 15 is True. Return (Skip).
                    if (Math.random() * 100 > probability) return;
                }

                // 3. Overlap Guard
                if (state.event_master_prompt) return;

                // 4. Show UI Feedback
                // Since this blocks the chat, we must tell the user what is happening.
                UIManager.showLoadingSpinner("The Event Master is plotting...");

                try {
                    console.log("Event Master: 🎲 Roll successful. Analyzing narrative...");

                    // 5. Build Context (Last 10 messages)
                    // 6. Construct Prompt via PromptBuilder
                    const prompt = PromptBuilder.buildEventMasterPrompt();

                    // 7. Blocking API Call
                    // We use a new AbortController so this specific request has its own lifecycle
                    const controller = new AbortController();
                    const instruction = await APIService.callAI(prompt, false, controller.signal);

                    if (instruction && instruction.trim().length > 0) {
                        console.log("Event Master Triggered:", instruction);
                        // Save to state. 
                        // The PromptBuilder will inject this into the System Prompt when triggerAIResponse runs next.
                        state.event_master_prompt = instruction;
                    }

                } catch (e) {
                    console.warn("Event Master skipped turn:", e);
                } finally {
                    // 8. Always hide the spinner, whether we succeeded or failed
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Processes and applies static knowledge updates.
             * Handles category formatting, backward-compatibility plain title matching, and smart merging.
             * @param {string} responseText - The raw response from the AI.
             * @returns {Promise<number>} - The number of entries added or modified.
             */
            async applyStaticKnowledgeUpdates(responseText) {
                const state = ReactiveStore.state;
                if (!responseText || responseText.toLowerCase().trim() === 'null') return 0;

                const lines = UTILITY.extractDelimitedList(responseText, '|', ['col1', 'col2', 'col3']);
                if (!lines || lines.length === 0) return 0;

                let changeCount = 0;
                if (!state.static_entries) state.static_entries = [];

                const validCategories = ['event', 'character', 'item', 'world', 'relationship'];

                for (const line of lines) {
                    if (!line.col1) continue;

                    let isNewFormat = false;
                    let category = '';
                    let subject = '';
                    let detail = '';
                    let targetTitle = '';

                    const c1Lower = line.col1.trim().toLowerCase();
                    // Check if it matches a valid category
                    if (validCategories.includes(c1Lower)) {
                        isNewFormat = true;
                        category = c1Lower;
                        subject = line.col2 ? line.col2.trim() : '';
                        detail = line.col3 ? line.col3.trim() : '';

                        // Construct category-tagged title
                        if (category === 'event') {
                            targetTitle = `[Event] ${subject}`;
                        } else if (category === 'character') {
                            targetTitle = `[Character: ${subject}]`;
                        } else if (category === 'item') {
                            targetTitle = `[Item] ${subject}`;
                        } else if (category === 'world') {
                            targetTitle = `[World] ${subject}`;
                        } else if (category === 'relationship') {
                            targetTitle = `[Relationship] ${subject}`;
                        }
                    } else {
                        // Fallback to old format: Title | Content
                        targetTitle = line.col1.trim();
                        detail = line.col2 ? line.col2.trim() : '';
                    }

                    if (!targetTitle || !detail || targetTitle.toLowerCase() === 'null') continue;

                    // Find existing entry
                    let existingEntry = state.static_entries.find(e => e.title.toLowerCase() === targetTitle.toLowerCase());

                    if (!existingEntry && isNewFormat && subject) {
                        // Backward compatibility: match plain titles (e.g., "Alistair" matching "[Character: Alistair]")
                        existingEntry = state.static_entries.find(e => e.title.toLowerCase() === subject.toLowerCase());
                        if (existingEntry) {
                            // Automatically migrate the title to the new category format
                            existingEntry.title = targetTitle;
                        }
                    }

                    if (existingEntry) {
                        if (existingEntry.is_immutable) continue;

                        if (isNewFormat) {
                            // Step 2: Merge new detail into existing content
                            const mergePrompt = PromptBuilder.buildLoreMergePrompt(targetTitle, existingEntry.content, detail);
                            const mergedRes = await APIService.callAI(mergePrompt, false);
                            if (mergedRes && mergedRes.trim() !== 'null' && mergedRes.trim() !== '') {
                                existingEntry.content = UTILITY.cleanFactContent(mergedRes.trim());
                                changeCount++;
                            }
                        } else {
                            // Old format: direct overwrite to preserve expected behavior
                            const cleanDetail = UTILITY.cleanFactContent(detail);
                            if (existingEntry.content !== cleanDetail) {
                                existingEntry.content = cleanDetail;
                                changeCount++;
                            }
                        }
                    } else {
                        // Create a new entry
                        state.static_entries.push({
                            id: UTILITY.uuid(),
                            title: targetTitle,
                            content: UTILITY.cleanFactContent(detail)
                        });
                        changeCount++;
                    }
                }

                return changeCount;
            },

            /**
             * Checks if it's time to generate static knowledge (every 6 messages).
             */
            async checkAutoStaticKnowledge() {
                const state = ReactiveStore.state;
                // Check toggle (Default to true if undefined)
                if (state.enableAutoStaticKnowledge === false) return;

                if (state.messageCounter > 0 && state.messageCounter % 6 === 0) {
                    const history = state.chat_history;
                    const chatMessages = history.filter(m => m.type === 'chat');
                    const recent = chatMessages.slice(0, -1).slice(-6);

                    if (recent.length === 0) return;

                    const transcript = recent.map(m => {
                        const char = ReactiveStore.getCharacter(m.character_id);
                        return `${char ? char.name : 'Unknown'}: ${m.content}`;
                    }).join('\n');

                    // 1. Parallel Extractions (Timeline & Relationships)
                    await this._runBackgroundExtractions(transcript);

                    // 2. Global Lore (Wiki) Update
                    await this._updateGlobalLore(transcript);

                    // 3. Archivist Condensation (Check for bloat)
                    await this._checkAndCondenseLore();
                }
            },

            getCurrentLocationName() {
                const state = ReactiveStore.state;
                if (state && state.worldMap && state.worldMap.grid && state.worldMap.currentLocation) {
                    const currentLoc = state.worldMap.grid.find(loc => loc.coords.x === state.worldMap.currentLocation.x && loc.coords.y === state.worldMap.currentLocation.y);
                    if (currentLoc) {
                        return currentLoc.name;
                    }
                }
                return 'Unknown Location';
            },

            async checkAutoJournal() {
                const state = ReactiveStore.state;
                if (state.enableJournal === false) return;

                if (state.messageCounter > 0 && state.messageCounter % 6 === 0) {
                    const history = state.chat_history;
                    const chatMessages = history.filter(m => m.type === 'chat');
                    const recent = chatMessages.slice(0, -1).slice(-6);

                    if (recent.length === 0) return;

                    const transcript = recent.map(m => {
                        const char = ReactiveStore.getCharacter(m.character_id);
                        return `${char ? char.name : 'Unknown'}: ${m.content}`;
                    }).join('\n');

                    const characterNames = (state.characters || []).map(c => c.name).join(', ');

                    try {
                        const promptText = PromptBuilder.buildJournalExtractorPrompt(transcript, characterNames);
                        const aiResponse = await APIService.callAI(promptText, false);
                        if (aiResponse) {
                            const parsedEntries = UTILITY.parseJournalExtractions(aiResponse);
                            if (parsedEntries && parsedEntries.length > 0) {
                                if (!state.journal_entries) state.journal_entries = [];

                                const location = this.getCurrentLocationName();
                                const timestamp = new Date().toISOString();

                                for (const entry of parsedEntries) {
                                    state.journal_entries.push({
                                        id: UTILITY.uuid(),
                                        timestamp: timestamp,
                                        location: location,
                                        type: entry.type,
                                        character_name: entry.character_name || '',
                                        content: entry.content
                                    });
                                    // Capped like narrative_timeline is. This used to be
                                    // emptied by every reload, which hid the fact that it
                                    // grows without limit; now that it persists, an old
                                    // story would carry an ever longer list of near-identical
                                    // lines into every prompt.
                                    if (state.journal_entries.length > 50) state.journal_entries.shift();
                                }

                                UIManager.showToast("New journal entries extracted.");
                                UIManager.renderInventoryPanel();
                            }
                        }
                    } catch (err) {
                        console.error("Failed to auto-generate journal entries:", err);
                    }
                }
            },

            /**
             * Runs secondary extractions in parallel without blocking the main lore update.
             * @private
             */
            async _runBackgroundExtractions(transcript) {
                const state = ReactiveStore.state;
                try {
                    const [timelineRes, relationRes] = await Promise.all([
                        APIService.callAI(PromptBuilder.buildTimelineExtractorPrompt(transcript), false),
                        APIService.callAI(PromptBuilder.buildRelationshipMatrixPrompt(transcript), false)
                    ]);

                    // Update Timeline
                    if (timelineRes && timelineRes.toLowerCase().trim() !== 'null') {
                        if (!state.narrative_timeline) state.narrative_timeline = [];
                        state.narrative_timeline.push(timelineRes.trim());
                        // Limit to last 50 entries for safety
                        if (state.narrative_timeline.length > 50) state.narrative_timeline.shift();
                    }

                    // Update Relationships
                    if (relationRes && relationRes.toLowerCase().trim() !== 'null') {
                        const rels = UTILITY.extractDelimitedList(relationRes, '|', ['pair', 'desc']);
                        if (rels && rels.length > 0) {
                            if (!state.relationship_matrix) state.relationship_matrix = [];
                            rels.forEach(r => {
                                const pairStr = r.pair.trim();
                                const descStr = r.desc.trim();
                                // Replace existing entry for this pair if it exists
                                const existingIdx = state.relationship_matrix.findIndex(m => m.startsWith(pairStr));
                                if (existingIdx !== -1) state.relationship_matrix[existingIdx] = `${pairStr} | ${descStr}`;
                                else state.relationship_matrix.push(`${pairStr} | ${descStr}`);
                            });
                        }
                    }
                    ReactiveStore.forceSave();
                } catch (e) {
                    console.warn("Background extractions failed:", e);
                }
            },

            /**
             * Updates the persistent Global Lore wiki based on the transcript.
             * @private
             */
            async _updateGlobalLore(transcript) {
                const state = ReactiveStore.state;
                const existingKnowledgeStr = (state.static_entries || [])
                    .map(e => `Title: ${e.title}\nContent: ${e.content}`)
                    .join('\n\n') || "No existing knowledge.";

                let promptTemplate = state.prompt_auto_static_knowledge || UTILITY.getDefaultSystemPrompts().prompt_auto_static_knowledge;
                let prompt = promptTemplate.replace('{transcript}', transcript).replace('{existing_knowledge}', existingKnowledgeStr);

                try {
                    const response = await APIService.callAI(prompt, false);
                    if (!response || response.toLowerCase().trim() === 'null') return;

                    const changeCount = await this.applyStaticKnowledgeUpdates(response);

                    if (changeCount > 0) {
                        UIManager.showNotification(`Knowledge: ${changeCount} updates recorded.`);
                        ReactiveStore.forceSave();
                    }
                } catch (e) {
                    console.warn("Lore update failed:", e);
                }
            },

            /**
             * Checks if the lore is becoming too bloated and triggers any necessary condensation.
             * @private
             */
            async _checkAndCondenseLore() {
                const state = ReactiveStore.state;
                if (!state.static_entries || state.static_entries.length < 25) return;

                // Simple length-based check (approx 15000 chars)
                const totalChars = state.static_entries.reduce((acc, e) => acc + (e.content || '').length, 0);
                if (totalChars < 15000) return;

                console.log("Archivist: Lore bloat detected. Condensing knowledge base...");
                try {
                    const prompt = PromptBuilder.buildArchivistCondensationPrompt(state.static_entries.filter(e => !e.is_immutable));
                    const response = await APIService.callAI(prompt, false);

                    const condensedData = UTILITY.extractDelimitedList(response, '|', ['title', 'content']);
                    if (condensedData && condensedData.length > 0) {
                        // Preserve immutable entries
                        const immutables = state.static_entries.filter(e => e.is_immutable);
                        state.static_entries = [
                            ...immutables,
                            ...condensedData.map(d => ({ id: UTILITY.uuid(), title: d.title, content: UTILITY.cleanFactContent(d.content) }))
                        ];
                        UIManager.showNotification("Archivist: Knowledge base condensed and optimized.");
                        ReactiveStore.forceSave();
                    }
                } catch (e) {
                    console.warn("Lore condensation failed:", e);
                }
            },

            /**
             * Sends a user message.
             * Adds the message, checks triggers, runs Event Master, and triggers AI response.
             */
            /**
             * Executes a full multi-agent swarm turn.
             * Encapsulates orchestration, response streaming, and post-turn analysis.
             * Called from both sendMessage() (text present) and handlePrimaryAction() (empty input pass-turn).
             * @param {string} userMessage - The user's input text (may be empty string for a pass-turn).
             */
            async _executeSwarmTurn(userMessage, forcedCharId = null, targetMessageIndex = null, userImages = []) {
                const state = ReactiveStore.state;
                if (!this._isModelConfigured(state)) {
                    this.addSystemMessageToHistory('AI model not configured. Check Settings.');
                    return;
                }

                this._clearResponseOptions();

                // UI Setup for Swarm
                let originalContent = null;
                if (targetMessageIndex !== null) {
                    const char = ReactiveStore.getCharacter(forcedCharId);
                    originalContent = state.chat_history[targetMessageIndex].content;
                    const msgEl = document.getElementById(`message-content-${targetMessageIndex}`);
                    if (msgEl) {
                        msgEl.innerHTML = `<span class="animate-pulse text-gray-500">${char ? char.name : 'Character'} is thinking...</span>`;
                        state.chat_history[targetMessageIndex].content = `${char ? char.name : 'Character'} is thinking...`;
                    }
                } else {
                    UIManager.showTypingIndicator(null, 'deliberating\u2026', 'Director');
                }

                UIManager.setButtonToStopMode();
                this.RUNTIME.activeRequestAbortController = new AbortController();

                try {
                    // Run Visual Master (Concurrent)
                    if (typeof VisualMaster !== 'undefined') {
                        VisualMaster.checkTrigger();
                    }

                    const result = await SwarmOrchestrator.runTurn(
                        userMessage,
                        state,
                        this.RUNTIME.activeRequestAbortController.signal,
                        forcedCharId
                    );

                    if (targetMessageIndex === null) {
                        UIManager.hideTypingIndicator();
                    }

                    // Commit each character response as a separate chat bubble, in order.
                    let lastCharId = null;
                    let lastIndex = -1;
                    for (const { char, prose, thinking } of result.charResponses) {
                        this.startStreamingResponse(char.id, prose, 'neutral', targetMessageIndex, [], thinking || null);
                        lastCharId = char.id;
                        lastIndex = (targetMessageIndex !== null) ? targetMessageIndex : (state.chat_history.length - 1);
                    }

                    // Text Mode: deliver any private texts the agents decided to send while
                    // deliberating. Committed after the scene so they read as arriving during it.
                    if (typeof TextModeController !== 'undefined') {
                        TextModeController.deliverUnprompted(result.agentResults);
                    }

                    // Post-turn emotion analysis on the last character's bubble.
                    if (lastCharId !== null && lastIndex >= 0) {
                        const lastProse = result.charResponses[result.charResponses.length - 1]?.prose || '';
                        this.analyzeTurn(lastProse, lastCharId).then(aiAnalysis => {
                            const msg = state.chat_history[lastIndex];
                            if (msg && msg.type === 'chat') {
                                msg.emotion = aiAnalysis.emotion;
                                if (state.characterImageMode === 'bubble') {
                                    this.updateMessagePortrait(lastIndex, lastCharId, aiAnalysis.emotion);
                                }
                            }
                            this.applyAnalysisResults(lastCharId, aiAnalysis);
                        }).catch(err => console.warn('[Swarm] Post-turn analysis failed:', err));
                    }

                } catch (error) {
                    if (error.name === 'AbortError') {
                        console.log('[Swarm] Generation stopped by user.');
                    } else {
                        if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                            UIManager.showToast(`Swarm Error: ${error.message}`, true);
                        } else {
                            console.error(`Swarm Error: ${error.message}`);
                        }
                    }
                } finally {
                    UIManager.setButtonToSendMode();
                    this.RUNTIME.activeRequestAbortController = null;
                    UIManager.hideTypingIndicator();
                }
            },

            async sendMessage() {
                if (this.RUNTIME.activeRequestAbortController) {
                    this.stopGeneration();
                }
                if (UIManager.RUNTIME.streamingInterval) {
                    clearInterval(UIManager.RUNTIME.streamingInterval);
                    UIManager.RUNTIME.streamingInterval = null;
                }

                const state = ReactiveStore.state;
                const input = document.getElementById('chat-input');
                const userChar = state.characters.find(c => c.is_user);

                if (!userChar) {
                    alert("No character is set as the 'User'.");
                    return;
                }

                const messageContent = input.value.trim();
                if (!messageContent) return;

                // ── TEXT MODE BRANCH ──────────────────────────────────────────────────────
                // A private thread is open: route the send there instead of the main narrative.
                if (typeof TextModeController !== 'undefined' && TextModeController.isActive()) {
                    input.value = '';
                    await TextModeController.sendInThread(messageContent);
                    return;
                }
                // ── END TEXT MODE BRANCH ──────────────────────────────────────────────────

                // --- Input History Tracking ---
                if (UIManager.RUNTIME.inputHistory.length === 0 || UIManager.RUNTIME.inputHistory[UIManager.RUNTIME.inputHistory.length - 1] !== messageContent) {
                    UIManager.RUNTIME.inputHistory.push(messageContent);
                    if (UIManager.RUNTIME.inputHistory.length > 3) {
                        UIManager.RUNTIME.inputHistory.shift();
                    }
                }
                UIManager.RUNTIME.inputHistoryIndex = UIManager.RUNTIME.inputHistory.length;

                // 1. Add user message immediately
                const pendingImg = state.pendingImage;
                const userMsg = await this.addMessageToHistory(userChar.id, messageContent, 'chat', 'neutral', pendingImg ? [pendingImg] : null);

                // Visual Lore attached to this turn. Stored as ids on the message, never as
                // images: the picture is a recognition aid in the picker, and re-sending it
                // every turn would undo the point of describing it once.
                if (typeof UIManager !== 'undefined' && UIManager.VISUAL_LORE_PENDING && UIManager.VISUAL_LORE_PENDING.length) {
                    if (userMsg) userMsg.item_ids = UIManager.VISUAL_LORE_PENDING.slice();
                    UIManager.VISUAL_LORE_PENDING = [];
                    UIManager.renderVisualLoreChips();
                }
                const userImages = userMsg ? userMsg.images : [];

                input.value = '';
                this.removePendingImage();

                // Hide response options if visible
                this._clearResponseOptions();

                // 2. Check triggers (Lore)
                this.checkDynamicEntryTriggers();

                const selectorElement = document.getElementById('ai-character-selector');
                let selectorVal = selectorElement.value;
                const forceEventMaster = selectorVal === 'event_master';

                // ── SWARM MODE BRANCH ─────────────────────────────────────────────────────
                // When swarm mode is active, delegate entirely to _executeSwarmTurn UNLESS a specific character is forced.
                // The standard Event Master / Speaker Selection path is NOT executed.
                if (state.swarmMode && typeof SwarmOrchestrator !== 'undefined' && selectorVal !== 'event_master') {
                    const forcedId = selectorVal === 'any' ? null : selectorVal;
                    await this._executeSwarmTurn(messageContent, forcedId, null, userImages);
                    return; // EXIT EARLY — do not fall through to standard path
                }
                // ── END SWARM MODE BRANCH ─────────────────────────────────────────────────

                // 3. Run Event Master (BLOCKING)
                // This "cuts in line" before the character replies.
                await this.checkEventMaster(forceEventMaster);

                if (forceEventMaster) {
                    selectorElement.value = 'any';
                    selectorVal = 'any';
                }

                // 3.5. Run Visual Master & Speaker Selection (Concurrent & "Speaker First")
                // We launch Speaker Selection (if needed) AND Visual Master concurrently.
                // This ensures the "Character is typing..." UI appears as fast as possible (Speaker First),
                // even if the Visual Master request queues up on the backend.

                // A. Determine Speaker Promise
                let speakerPromise = null;
                if (selectorVal === 'any') {
                    // Auto-select: Launch the AI selector task
                    speakerPromise = this.determineNextSpeaker(false);
                } else {
                    // Manual select: Resolve immediately
                    speakerPromise = Promise.resolve(selectorVal);
                }

                // B. Run Visual Master (Concurrent)
                let visualBlocker = null;
                if (typeof VisualMaster !== 'undefined') {
                    visualBlocker = VisualMaster.checkTrigger();
                }

                // 4. Trigger Character Response
                // We pass the PROMISE for the speaker, not the ID.
                // The character will now see the Event Master's instruction in the prompt context.
                await this.triggerAIResponse(speakerPromise, messageContent, false, null, visualBlocker, userImages);

                // 5. Cleanup / Auto-Save logic is handled by ReactiveStore
            },


            // --- Streaming & UI ---

            /**
             * Processes and displays the full response from the AI immediately.
             * (Formerly startStreamingResponse, streaming effect removed per user request).
             * @param {string} charId - The ID of the speaking character.
             * @param {string} fullText - The full text to display.
             * @param {string} emotion - The emotion of the character.
             * @param {number|null} targetMessageIndex - If set, updates an existing message (Versioning support).
             */
            startStreamingResponse(charId, fullText, emotion, targetMessageIndex = null, images = [], thinking = null) {
                if (this.RUNTIME.streamingInterval) clearInterval(this.RUNTIME.streamingInterval);
                this.RUNTIME.streamingInterval = null;

                const state = ReactiveStore.state;

                // 1. LOCK THE DB (Prevent intermediate saves during state mutation)
                if (typeof ReactiveStore.pauseSaving === 'function') {
                    ReactiveStore.pauseSaving();
                }

                let messageIndex;
                let newMessage;

                if (targetMessageIndex !== null && state.chat_history[targetMessageIndex]) {
                    // VERSIONING PATH: Update Existing Message
                    messageIndex = targetMessageIndex;
                    newMessage = state.chat_history[messageIndex];

                    // Initialize versions if missing
                    if (!newMessage.versions) {
                        newMessage.versions = [{ content: newMessage.content, emotion: newMessage.emotion, thinking: newMessage.thinking || null }];
                        newMessage.currentVersion = 0;
                    }

                    // Push NEW version immediately
                    newMessage.versions.push({ content: fullText, emotion: emotion, thinking: thinking || null });
                    newMessage.currentVersion = newMessage.versions.length - 1;

                    // Update main display fields
                    newMessage.content = fullText;
                    newMessage.emotion = emotion;
                    newMessage.thinking = thinking || null;
                    newMessage.timestamp = new Date().toISOString();
                    newMessage.isNew = false;
                } else {
                    // STANDARD PATH: Create New Message
                    messageIndex = state.chat_history.length;
                    newMessage = {
                        id: UTILITY.uuid(),
                        character_id: charId,
                        content: fullText,
                        type: 'chat',
                        emotion: emotion,
                        thinking: thinking || null,
                        timestamp: new Date().toISOString(),
                        isNew: true,
                        versions: [{ content: fullText, emotion: emotion, thinking: thinking || null }],
                        currentVersion: 0,
                        images: images || []
                    };

                    state.chat_history.push(newMessage);

                    // Increment Counter (Only on NEW messages)
                    state.messageCounter = (state.messageCounter || 0) + 1;

                    // Living Persona Check
                    if (state.enableLivingPersona) {
                        state.livingPersonaCounters = state.livingPersonaCounters || {};
                        state.livingPersonaCounters[charId] = (state.livingPersonaCounters[charId] || 0) + 1;
                        if (state.livingPersonaCounters[charId] >= 10) {
                            state.livingPersonaCounters[charId] = 0; // Reset
                            this.evaluateLivingPersona(charId); // Fire & Forget
                        }
                    }
                }

                // Process [STATE: ...] updates in the message content
                if (typeof InventoryController !== 'undefined') {
                    InventoryController.processStateUpdates(newMessage);
                }

                // 2. Render UI
                // We use UIManager.renderChat() to ensure everything is in sync
                UIManager.renderChat();

                // 3. Post-Processing
                // Check if it's time to generate static knowledge (every 6 messages)
                if (targetMessageIndex === null && typeof NarrativeController !== 'undefined') {
                    NarrativeController.triggerAutoKnowledgeUpdates();
                }

                // Background Music Agent (Non-blocking, fire-and-forget)
                if (targetMessageIndex === null && typeof MusicService !== 'undefined') {
                    MusicService.checkTrigger();
                }

                // Helper agents (fire-and-forget): new replies, and a rerolled latest reply.
                if (typeof AgentController !== 'undefined'
                    && (targetMessageIndex === null || targetMessageIndex === state.chat_history.length - 1)) {
                    AgentController.runHelpersAfterReply(newMessage);
                }

                // Check for Dynamic Entries (Revealed Lore)
                if (typeof NarrativeController !== 'undefined') {
                    const structureChanged = NarrativeController.checkDynamicEntryTriggers();
                    // If lore was revealed, we re-render to show notification/scroll
                    if (structureChanged) {
                        UIManager.renderChat();
                    }
                }

                // 4. UNLOCK DB (Triggers save)
                if (typeof ReactiveStore.resumeSaving === 'function') {
                    ReactiveStore.resumeSaving();
                }

                // Final Scroll Ensure
                const chatWindow = document.getElementById('chat-window');
                if (chatWindow) chatWindow.scrollTop = chatWindow.scrollHeight;

                // Trigger Response Options if enabled (and it's the last AI message)
                const isLatestMessage = targetMessageIndex === null || targetMessageIndex === state.chat_history.length - 1;
                if (isLatestMessage && state.enableResponseOptions) {
                    const lastMsg = state.chat_history[state.chat_history.length - 1];
                    const userChar = state.characters.find(c => c.is_user);
                    if (lastMsg && lastMsg.character_id !== userChar?.id) {
                        this.generateResponseOptions();
                    }
                }
            },

            /**
             * Generates 4 response options for the user based on the last AI message.
             */
            async generateResponseOptions() {
                const state = ReactiveStore.state;
                if (!state.enableResponseOptions) return;
                if (!this._isModelConfigured(state)) return;

                // Find the absolute LAST CHAT message by traversing backwards
                let lastMsg = null;
                for (let i = state.chat_history.length - 1; i >= 0; i--) {
                    if (state.chat_history[i].type === 'chat' && !state.chat_history[i].isHidden) {
                        lastMsg = state.chat_history[i];
                        break;
                    }
                }

                if (!lastMsg) return;

                const userChar = state.characters.find(c => c.is_user);
                if (lastMsg.character_id === userChar?.id) return;

                const container = document.getElementById('response-options-container');
                if (!container) return;

                // UI: Show loading state
                container.innerHTML = DOM.unsafe(`
                    <div class="flex items-center space-x-2 p-4 text-indigo-400/50 animate-pulse bg-gradient-to-t from-gray-900/80 to-transparent">
                        <svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                        <span class="text-[10px] font-bold uppercase tracking-widest">Contemplating paths...</span>
                    </div>
                `);
                container.classList.remove('hidden');
                this.updateChatInputShrinkState();

                try {
                    const systemPrompt = state.prompt_response_options_gen || UTILITY.getDefaultSystemPrompts().prompt_response_options_gen;

                    // Build Context (Names mapping)
                    const charNames = [...state.characters, ...ReactiveStore.getActiveLocationCharacters()].reduce((acc, c) => ({ ...acc, [c.id]: c.name }), {});

                    // Base suggestions on what the player can currently see, matching MessageBubble:
                    // the open text thread while one is active, otherwise the main narrative only.
                    const dmCharId = (typeof TextModeController !== 'undefined') ? TextModeController.RUNTIME.activeCharId : null;

                    const filteredHistory = state.chat_history.filter(msg => {
                        if (!msg) return false;
                        if (msg.type === 'lore_reveal' && msg.exclusive_to_char_id && msg.exclusive_to_char_id !== userChar?.id) {
                            return false;
                        }
                        if (msg.type === 'dm') {
                            return msg.exclusive_to_char_id === dmCharId;
                        }
                        return true;
                    });

                    const context = filteredHistory.slice(-10).map(m => `${charNames[m.character_id] || (m.type === 'chat' ? 'Unknown' : 'System')}: ${m.content}`).join('\n');

                    const userName = userChar?.name || 'the player';
                    let prompt = systemPrompt
                        .replace(/{user_character}/g, userName)
                        .replace('{context}', context)
                        .replace('{last_response}', lastMsg.content);

                    // Always append a critical instruction to override older saved prompts
                    prompt += `\n\nCRITICAL INSTRUCTION: You MUST generate these 4 options strictly from the perspective of the user's character (${userName}). The options MUST describe their direct actions or dialogue, written from their perspective. Generate options for this specific character **only**. Furthermore, each option MUST be a completely unique direction for the character to take and lead to a completely different consequence, emotion, or narrative direction.`;

                    // Call AI
                    const response = await APIService.callAI(prompt, false, null, true);
                    const options = UTILITY.extractAndParseJSON(response);

                    if (Array.isArray(options) && options.length > 0) {
                        container.innerHTML = UIComponents.ResponseOptions(options.slice(0, 4));
                        this.updateChatInputShrinkState();
                        // Scroll to bottom
                        const chatWindow = document.getElementById('chat-window');
                        if (chatWindow) chatWindow.scrollTop = chatWindow.scrollHeight;
                    } else {
                        container.classList.add('hidden');
                        this.updateChatInputShrinkState();
                    }
                } catch (e) {
                    const isNetworkError = e instanceof TypeError || (e.message && e.message.toLowerCase().includes('failed to fetch'));
                    if (isNetworkError) {
                        console.warn("[Response Options] Generation skipped: AI provider is offline/unreachable.");
                    } else {
                        console.error("Response Options Generation Failed:", e);
                    }
                    container.classList.add('hidden');
                    this.updateChatInputShrinkState();
                }
            },

            /**
             * Handles the selection of a response option.
             * @param {string|Object} option - The selected option.
             */
            async handleSelectOption(option) {
                let opt = option;
                if (typeof option === 'string') {
                    try {
                        let decoded = option;
                        if (option.startsWith('%7B')) {
                            decoded = decodeURIComponent(option);
                        } else {
                            decoded = option.replace(/&quot;/g, '"').replace(/\\'/g, "'");
                        }
                        opt = JSON.parse(decoded);
                    } catch (e) {
                        console.error("Failed to parse selected option:", e);
                        return;
                    }
                }

                // 1. Clear and Hide Container
                this._clearResponseOptions();

                // 2. Set Input and Send
                const input = document.getElementById('chat-input');
                if (input) {
                    input.value = opt.prompt;
                    this.sendMessage();
                }
            },

            /**
             * Regenerates the last AI response with Versioning.
             */
            async handleRegen() {
                const state = ReactiveStore.state;
                if (!StateManager.getLibrary().active_narrative_id) { alert("Load a narrative first."); return; }

                // In a private thread, regenerate that thread's last text instead of the scene.
                if (typeof TextModeController !== 'undefined' && TextModeController.isActive()) {
                    await TextModeController.regenerateLast();
                    return;
                }
                if (this.RUNTIME.activeRequestAbortController || UIManager.RUNTIME.streamingInterval) return;

                // Hide response options if visible
                this._clearResponseOptions();

                // ── SWARM REGEN BRANCH ─────────────────────────────────────────────────
                // Re-runs ONLY the Director using cached swarmLastIntents.
                // This preserves the agent deliberation but generates fresh prose.
                if (state.swarmMode && typeof SwarmOrchestrator !== 'undefined' &&
                    state.swarmLastIntents && Object.keys(state.swarmLastIntents).length > 0) {

                    if (!this._isModelConfigured(state)) {
                        this.addSystemMessageToHistory("AI model not configured. Check Settings.");
                        return;
                    }

                    // UI IMPROVEMENT: Do not show detached typing indicator for regen
                    // UIManager.showTypingIndicator(null, 'rethinking\u2026', 'Director');
                    UIManager.setButtonToStopMode();
                    this.RUNTIME.activeRequestAbortController = new AbortController();

                    try {
                        // Reconstruct winner objects from the cached last intents
                        const allAiChars = [...(state.characters || []), ...ReactiveStore.getActiveLocationCharacters()]
                            .filter(c => !c.is_user && c.is_active);

                        const cachedWinners = allAiChars
                            .filter(c => state.swarmLastIntents[c.id])
                            .map(c => ({
                                char: c,
                                result: { urgency_level: 'HIGH', intent: state.swarmLastIntents[c.id] },
                                bid: 1
                            }));

                        if (cachedWinners.length === 0) throw new Error('No cached intents to regen from.');

                        // Find the last user message for context
                        const lastUserMsg = [...(state.chat_history || [])].reverse()
                            .find(m => m.type === 'chat' && ReactiveStore.getCharacter(m.character_id)?.is_user);
                        const lastUserContent = lastUserMsg ? lastUserMsg.content : '';

                        // Identify who the primary speaker was for this turn
                        const lastAiMsg = [...(state.chat_history || [])].reverse()
                            .find(m => m.type === 'chat' && !m.isHidden && !ReactiveStore.getCharacter(m.character_id)?.is_user);
                        let primarySpeaker = lastAiMsg ? ReactiveStore.getCharacter(lastAiMsg.character_id) : null;

                        if (!primarySpeaker) throw new Error('No speaker found to regenerate.');

                        // Find the last AI bubble index to overwrite
                        let targetIdx = state.chat_history.indexOf(lastAiMsg);
                        if (targetIdx === -1) targetIdx = null;

                        // UI IMPROVEMENT: Instead of detached typing indicator, update existing bubble to "thinking" state
                        let originalContent = null;
                        if (targetIdx !== null) {
                            originalContent = lastAiMsg.content;
                            const msgEl = document.getElementById(`message-content-${targetIdx}`);
                            if (msgEl) {
                                msgEl.innerHTML = `<span class="animate-pulse text-gray-500">${primarySpeaker.name} is thinking...</span>`;
                                // Update state temporarily so it persists through any intermediate renders
                                lastAiMsg.content = `${primarySpeaker.name} is thinking...`;
                            }
                        }

                        // Phase 3b: Re-run Director with cached intents
                        const directive = await SwarmOrchestrator.direct(
                            lastUserContent,
                            cachedWinners,
                            primarySpeaker,
                            state,
                            this.RUNTIME.activeRequestAbortController.signal
                        );

                        UIManager.hideTypingIndicator();

                        // Already calculated above in Swarm Regen branch
                        // let targetIdx = state.chat_history.indexOf(lastAiMsg);
                        // if (targetIdx === -1) targetIdx = null;

                        // Execute directive and write it
                        const execResult = await SwarmOrchestrator._executeDirective(
                            primarySpeaker, directive, lastUserContent, state,
                            this.RUNTIME.activeRequestAbortController.signal
                        );
                        const newProse = (typeof execResult === 'object' && execResult !== null) ? execResult.prose : execResult;
                        const newThinking = (typeof execResult === 'object' && execResult !== null) ? execResult.thinking : (APIService.getLastThinking() || null);
                        this.startStreamingResponse(primarySpeaker.id, newProse, 'neutral', targetIdx, lastAiMsg.images || [], newThinking);

                    } catch (error) {
                        UIManager.hideTypingIndicator();
                        if (error.name !== 'AbortError') {
                            if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                                UIManager.showToast(`Swarm Regen Error: ${error.message}`, true);
                            } else {
                                console.error(`Swarm Regen Error: ${error.message}`);
                            }
                        }
                        if (targetIdx !== null && originalContent !== null) {
                            state.chat_history[targetIdx].content = originalContent;
                            UIManager.renderChatHistory(state.chat_history);
                        }
                    } finally {
                        UIManager.setButtonToSendMode();
                        this.RUNTIME.activeRequestAbortController = null;
                        UIManager.hideTypingIndicator();
                    }
                    return;
                }
                // ── END SWARM REGEN BRANCH ─────────────────────────────────────────────

                const history = state.chat_history;
                let targetIndex = -1;

                // Search backwards for the last meaningful event
                for (let i = history.length - 1; i >= 0; i--) {
                    const msg = history[i];
                    if (msg.type === 'chat' && !msg.isHidden) {
                        const char = ReactiveStore.getCharacter(msg.character_id);

                        // If we hit an AI character first, we regenerate THAT message.
                        if (char && !char.is_user) {
                            targetIndex = i;
                            break;
                        }

                        // If we hit a User message first, we assume the user wants a NEW response to this message.
                        if (char && char.is_user) {
                            break; // Stop searching, targetIndex remains -1
                        }
                    }
                }

                if (targetIndex !== -1) {
                    // Update Mode: Regenerate the existing bubble
                    const msg = history[targetIndex];
                    // Carry any directive that produced this message, so a rerun answers
                    // the same direction rather than reverting to the previous message.
                    await this.triggerAIResponse(msg.character_id, msg.directive || '', false, targetIndex, null, msg.images || []);
                } else {
                    // New Mode: Just trigger a fresh response logic
                    let targetId = document.getElementById('ai-character-selector').value;
                    if (targetId === 'any') targetId = null;
                    if (!targetId) targetId = await this.determineNextSpeaker(false);

                    // Try to find the images from the last user message to carry forward
                    let userImages = [];
                    for (let i = history.length - 1; i >= 0; i--) {
                        const m = history[i];
                        if (m.type === 'chat' && ReactiveStore.getCharacter(m.character_id)?.is_user) {
                            userImages = m.images || [];
                            break;
                        }
                    }

                    await this.triggerAIResponse(targetId, '', false, null, null, userImages);
                }
            },


            /**
             * Cycles through versions of a message.
             * @param {number} index - The index of the message in chat_history.
             */
            /**
             * Resolves who owns a combined message. The character who replied owns it by
             * default; a narrator takes it only when the story opts in AND one is actually
             * active, because a narrator surfacing in a two-hander reads as a third wheel.
             * @param {Object} replyMsg - The later of the two messages.
             * @returns {string} - Character id to attribute the merge to.
             */
            resolveCombineSpeaker(replyMsg) {
                const state = ReactiveStore.state;
                if (state.combineAsNarrator) {
                    const located = (typeof ReactiveStore.getActiveLocationCharacters === 'function')
                        ? ReactiveStore.getActiveLocationCharacters()
                        : [];
                    const narrator = [...(state.characters || []), ...located]
                        .find(c => c && c.is_narrator && c.is_active);
                    // No narrator on stage: fall through rather than invent one.
                    if (narrator) return narrator.id;
                }
                return replyMsg.character_id;
            },

            /**
             * Fuses the message at `index` with the one before it into a single passage,
             * for when a reply retells the beats the previous message already covered.
             * The originals are kept on the merged message so it can be split again.
             * @param {number} index - Index of the later message.
             */
            async combineWithPrevious(index) {
                const state = ReactiveStore.state;
                if (this.RUNTIME.combineInFlight) return;
                if (!UTILITY.canCombineAt(state.chat_history, index)) return;

                const later = state.chat_history[index];
                const earlier = state.chat_history[index - 1];
                const prompt = PromptBuilder.buildCombineMessagesPrompt(earlier, later);
                if (!prompt) return;

                this.RUNTIME.combineInFlight = true;
                // Same indicator as an ordinary turn, attributed to whoever will own the
                // result, so a combine looks like every other wait in the app instead of
                // a toast that leaves you guessing whether anything is happening.
                UIManager.showTypingIndicator(this.resolveCombineSpeaker(later), 'is combining the last two messages...');
                let combined = null;
                try {
                    combined = await APIService.callAI(prompt);
                } catch (e) {
                    UIManager.showNotification(e.message || 'Combine failed.', 'error');
                } finally {
                    this.RUNTIME.combineInFlight = false;
                    UIManager.hideTypingIndicator();
                }
                if (!combined || !combined.trim()) {
                    UIManager.showNotification('Combine returned nothing. Messages left as they were.', 'error');
                    return;
                }
                combined = combined.trim();

                const merged = {
                    id: UTILITY.uuid(),
                    type: 'chat',
                    character_id: this.resolveCombineSpeaker(later),
                    content: combined,
                    emotion: later.emotion,
                    // The moment begins where the first passage began.
                    timestamp: earlier.timestamp || later.timestamp,
                    images: [...(earlier.images || []), ...(later.images || [])],
                    versions: [{ content: combined, emotion: later.emotion }],
                    currentVersion: 0,
                    // Deep copies so Split Back Apart restores exactly what was here.
                    combined_from: JSON.parse(JSON.stringify([earlier, later]))
                };

                state.chat_history.splice(index - 1, 2, merged);
                // Two chat messages became one; the every-six-messages agents count turns.
                state.messageCounter = Math.max(0, (state.messageCounter || 0) - 1);
                await ReactiveStore.forceSave();
                UIManager.renderChat();
                UIManager.showNotification('Messages combined.', 'success');
            },

            /**
             * Runs the combine again on the same two originals and keeps the result as
             * another version, so earlier takes stay reachable by tapping the bubble.
             * @param {number} index - Index of the combined message.
             */
            async recombineMessage(index) {
                const state = ReactiveStore.state;
                const msg = state.chat_history[index];
                if (!msg || !msg.combined_from || msg.combined_from.length < 2) return;
                if (this.RUNTIME.combineInFlight) return;

                const prompt = PromptBuilder.buildCombineMessagesPrompt(msg.combined_from[0], msg.combined_from[1]);
                if (!prompt) return;

                this.RUNTIME.combineInFlight = true;
                UIManager.showTypingIndicator(msg.character_id, 'is combining the scene again...');
                let combined = null;
                try {
                    combined = await APIService.callAI(prompt);
                } catch (e) {
                    UIManager.showNotification(e.message || 'Combine failed.', 'error');
                } finally {
                    this.RUNTIME.combineInFlight = false;
                    UIManager.hideTypingIndicator();
                }
                if (!combined || !combined.trim()) {
                    UIManager.showNotification('Combine returned nothing. The current take is unchanged.', 'error');
                    return;
                }
                combined = combined.trim();

                msg.versions = msg.versions || [{ content: msg.content, emotion: msg.emotion }];
                msg.versions.push({ content: combined, emotion: msg.emotion });
                msg.currentVersion = msg.versions.length - 1;
                msg.content = combined;
                await ReactiveStore.forceSave();
                UIManager.renderChat();
                UIManager.showNotification(`Take ${msg.versions.length}. Tap the bubble to compare.`, 'success');
            },

            /**
             * Restores a combined message to the two messages it was made from.
             * @param {number} index - Index of the combined message.
             */
            async splitCombinedMessage(index) {
                const state = ReactiveStore.state;
                const msg = state.chat_history[index];
                if (!msg || !msg.combined_from || msg.combined_from.length < 2) return;

                const originals = JSON.parse(JSON.stringify(msg.combined_from));
                state.chat_history.splice(index, 1, ...originals);
                state.messageCounter = (state.messageCounter || 0) + 1;
                await ReactiveStore.forceSave();
                UIManager.renderChat();
                UIManager.showNotification('Split back into two messages.', 'success');
            },

            async cycleMessageVersion(index) {
                const state = ReactiveStore.state;
                const msg = state.chat_history[index];
                if (!msg || !msg.versions || msg.versions.length <= 1) return;

                // Increment version index, loop back to 0
                const nextVer = ((msg.currentVersion || 0) + 1) % msg.versions.length;

                // Save
                // Suppress Global Render during this update to prevent scroll jump
                UIManager.RUNTIME.suppressChatRender = true;
                msg.currentVersion = nextVer;
                msg.content = msg.versions[nextVer].content;
                msg.emotion = msg.versions[nextVer].emotion;
                msg.thinking = msg.versions[nextVer].thinking || null;
                await ReactiveStore.forceSave();
                UIManager.RUNTIME.suppressChatRender = false;

                // Optimized Update: Direct DOM manipulation to avoid full re-render
                const bubbleContainer = document.querySelector(`.chat-bubble-container[data-message-index="${index}"]`);
                if (bubbleContainer) {
                    const contentEl = document.getElementById(`message-content-${index}`);
                    const hintEl = document.getElementById(`version-hint-${index}`);

                    // 1. Update Content
                    if (contentEl) {
                        const rawContent = msg.versions[nextVer].content;
                        // Basic Markdown + Quote Styling
                        const styledContent = rawContent
                            .replace(/(["“][^"”]*["”])/g, `<span class="dialogue-quote">$1</span>`)
                            .replace(/(^|\s)'((?:[^']|'(?=\w)){2,})'(?=\s|[.,!?;:]|$)/gm, `$1<span class="dialogue-quote">'$2'</span>`);
                        let finalHTML = DOM.unsafe(marked.parse(styledContent || ''));

                        // Re-apply character image if in bubble mode
                        const char = ReactiveStore.getCharacter(msg.character_id);
                        if (state.characterImageMode === 'bubble' && char) {
                            const imgSrc = UIManager.getPortraitSrc(char, msg.versions[nextVer].emotion);
                            if (imgSrc) {
                                finalHTML = DOM.html`
                                    <div class="flex items-start gap-4">
                                        <img src="${imgSrc}" class="bubble-char-image">
                                        <div class="flex-1 min-w-0">${finalHTML}</div>
                                    </div>
                                `;
                            }
                        }

                        contentEl.innerHTML = finalHTML;
                    }

                    // 2. Update Hint
                    // Now utilizing the stable ID we added to UIComponents.MessageBubble
                    if (hintEl) {
                        hintEl.textContent = `v${nextVer + 1}/${msg.versions.length}`;
                        hintEl.className = "text-[10px] text-gray-500 ml-2 select-none self-center"; // Ensure visibility
                    }

                    // 3. Update Thinking Elements
                    const thoughtBadgeEl = document.getElementById(`thought-badge-${index}`);
                    const menuViewThinkingEl = document.getElementById(`menu-view-thinking-${index}`);
                    const nextThinking = msg.versions[nextVer].thinking;
                    const hasNextThinking = Boolean(nextThinking && nextThinking.trim());
                    if (thoughtBadgeEl) {
                        if (hasNextThinking) {
                            thoughtBadgeEl.classList.remove('hidden');
                        } else {
                            thoughtBadgeEl.classList.add('hidden');
                        }
                    }
                    if (menuViewThinkingEl) {
                        if (hasNextThinking) {
                            menuViewThinkingEl.classList.remove('hidden');
                            menuViewThinkingEl.classList.add('flex');
                        } else {
                            menuViewThinkingEl.classList.add('hidden');
                            menuViewThinkingEl.classList.remove('flex');
                        }
                    }

                    // 4. Flash Effect on Bubble Body
                    const bubbleBody = bubbleContainer.querySelector('.bubble-body');
                    if (bubbleBody) {
                        bubbleBody.classList.remove('flash-outline');
                        void bubbleBody.offsetWidth; // Trigger reflow
                        bubbleBody.classList.add('flash-outline');
                        setTimeout(() => bubbleBody.classList.remove('flash-outline'), 400);
                    }
                } else {
                    // Fallback
                    UIManager.renderChat();
                }
            },

            /**
             * Adds a message to the chat history and updates the state.
             * @param {string} id - The character ID.
             * @param {string} content - The message content.
             * @param {string} [type='chat'] - The message type.
             * @param {string} [emotion='neutral'] - The emotion associated with the message.
             */
            async addMessageToHistory(id, content, type = 'chat', emotion = 'neutral', images = null) {
                if (UIManager.RUNTIME.streamingInterval) {
                    clearInterval(UIManager.RUNTIME.streamingInterval);
                    UIManager.RUNTIME.streamingInterval = null;
                }

                const state = ReactiveStore.state;

                if (state.chat_history.length > 0) {
                    const cleanHistory = state.chat_history.filter(msg =>
                        !(msg.type === 'system_event' && (msg.content.startsWith('AI Error') || msg.content.includes('Failed to fetch')))
                    );
                    if (cleanHistory.length !== state.chat_history.length) {
                        state.chat_history = cleanHistory;
                    }
                }

                const newMessage = {
                    id: UTILITY.uuid(),
                    character_id: id, content, type, emotion,
                    timestamp: new Date().toISOString(), isNew: true,
                    images: []
                };

                // Handle Images (Save to DB and store ID in message)
                if (images && Array.isArray(images) && images.length > 0) {
                    for (const imgBlob of images) {
                        const imgId = `msg_img_${UTILITY.uuid()}`;
                        await DBService.saveImage(imgId, imgBlob);
                        newMessage.images.push(imgId);
                    }
                }

                // Push to state
                ReactiveStore.state.chat_history.push(newMessage);

                if (type === 'chat') {
                    ReactiveStore.state.messageCounter++;
                    this.triggerAutoKnowledgeUpdates();

                    // Living Persona Check
                    if (state.enableLivingPersona) {
                        state.livingPersonaCounters = state.livingPersonaCounters || {};
                        state.livingPersonaCounters[id] = (state.livingPersonaCounters[id] || 0) + 1;
                        if (state.livingPersonaCounters[id] >= 10) {
                            state.livingPersonaCounters[id] = 0; // Reset
                            this.evaluateLivingPersona(id); // Fire & Forget
                        }
                    }
                }

                // Await the save operation to ensure iOS persistence
                await ReactiveStore.forceSave();

                setTimeout(() => {
                    const chatWindow = document.getElementById('chat-window');
                    if (chatWindow) chatWindow.scrollTop = chatWindow.scrollHeight;
                }, 50);

                return newMessage;
            },

            /**
             * Asynchronously evaluates the character's persona based on chat history.
             * @param {string} charId - The character ID.
             */
            async evaluateLivingPersona(charId) {
                this._pendingEvolutions = this._pendingEvolutions || new Set();
                this._pendingEvolutions.add(charId);

                try {
                    const prompt = PromptBuilder.buildLivingPersonaPrompt(charId);
                    if (!prompt) {
                        this._pendingEvolutions.delete(charId);
                        return;
                    }

                    const responseText = await APIService.callAI(prompt, false);

                    if (responseText) {
                        const state = StateManager.getState();
                        const characters = state.characters || [];
                        const charNames = characters.map(c => c.name);

                        const cleanedPersona = UTILITY.sanitizeEvolvedPersona(responseText, charNames);

                        if (cleanedPersona) {
                            // Snapshot BEFORE the overwrite, tagged with the same slice
                            // buildLivingPersonaPrompt read, so deleting those scenes also
                            // reverts the persona they produced. Runs fire-and-forget outside
                            // triggerAutoKnowledgeUpdates, so it logs its own revision.
                            const personaSourceIds = (state.chat_history || [])
                                .filter(m => m.type === 'chat' && !m.isHidden)
                                .slice(-21, -1)
                                .map(m => m.id);
                            if (personaSourceIds.length > 0) {
                                state.knowledge_revisions = state.knowledge_revisions || [];
                                state.knowledge_revisions.push(this.createKnowledgeSnapshot(personaSourceIds));
                            }

                            state.evolved_characters = state.evolved_characters || {};
                            state.evolved_characters[charId] = cleanedPersona;

                            // Unobtrusive visual indicator
                            const char = ReactiveStore.getCharacter(charId);
                            if (char) {
                                UIManager.showNotification(`✨ ${char.name}'s Persona Evolved!`, "success");
                            }

                            if (typeof ReactiveStore.forceSave === 'function') {
                                ReactiveStore.forceSave();
                            }
                        } else {
                            console.warn(`Living Persona evolution for ${charId} rejected by sanitization. Response length: ${responseText.length}`);
                        }
                    }
                } catch (e) {
                    console.error("Living Persona evaluation failed:", e);
                } finally {
                    this._pendingEvolutions.delete(charId);
                }
            },

            /**
             * Views the narrative-specific evolved persona for a character.
             * @param {string} charId - The character ID.
             */
            viewEvolvedPersona(charId) {
                const state = StateManager.getState();
                const char = ReactiveStore.getCharacter(charId);
                if (!char) return;

                const evolvedText = (state.evolved_characters && state.evolved_characters[charId]) ? state.evolved_characters[charId] : null;

                if (!evolvedText) {
                    Swal.fire({
                        title: 'No Changes Yet',
                        text: `${char.name} has not evolved enough to produce a distinct narrative persona.`,
                        icon: 'info',
                        background: '#1e293b',
                        color: '#f8fafc'
                    });
                    return;
                }

                Swal.fire({
                    title: `${char.name}'s Narrative Persona`,
                    html: `
                        <div class="text-left text-sm text-gray-300 max-h-96 overflow-y-auto w-full whitespace-pre-wrap font-sans custom-scrollbar leading-relaxed">
                            ${UTILITY.escapeHTML(evolvedText)}
                        </div>
                    `,
                    width: '600px',
                    background: '#1e293b',
                    color: '#f8fafc',
                    showCloseButton: true,
                    showDenyButton: true,
                    denyButtonText: 'Reset to Base',
                    denyButtonColor: '#ef4444',
                    confirmButtonText: 'Close',
                    confirmButtonColor: '#6366f1'
                }).then((result) => {
                    if (result.isDenied) {
                        Swal.fire({
                            title: 'Are you sure?',
                            text: `This will permanently reset ${char.name}'s persona back to the base description.`,
                            icon: 'warning',
                            showCancelButton: true,
                            confirmButtonText: 'Yes, Reset',
                            cancelButtonText: 'Cancel',
                            background: '#1e293b',
                            color: '#f8fafc',
                            confirmButtonColor: '#ef4444',
                            cancelButtonColor: '#475569'
                        }).then((resetResult) => {
                            if (resetResult.isConfirmed) {
                                NarrativeController.resetEvolvedPersona(charId);
                            }
                        });
                    }
                });
            },

            /**
             * Resets the narrative-specific evolved persona back to the base description.
             * @param {string} charId - The character ID.
             */
            resetEvolvedPersona(charId) {
                const state = StateManager.getState();
                const char = ReactiveStore.getCharacter(charId);
                if (!char) return;

                if (state.evolved_characters && state.evolved_characters[charId]) {
                    delete state.evolved_characters[charId];

                    if (typeof ReactiveStore.forceSave === 'function') {
                        ReactiveStore.forceSave();
                    }

                    UIManager.showNotification(`✨ ${char.name}'s persona reset to base description.`, "success");

                    // Refresh the character detail modal and overall UI to reflect the reset state
                    UIManager.openCharacterDetailModal(charId);
                }
            },

            /**
             * Adds a system message to the chat history.
             * @param {string} content - The system message content.
             */
            addSystemMessageToHistory(content) {
                ReactiveStore.state.chat_history.push({
                    type: 'system_event', content, timestamp: new Date().toISOString(), isNew: true
                });
            },

            /**
             * Deletes a single message by index.
             */
            deleteMessage(index) {
                const state = ReactiveStore.state;

                // Optimized Delete for Last Message (No Confirm)
                if (index === state.chat_history.length - 1) {
                    this.executeDelete(index, 'single');
                } else {
                    UIManager.showConfirmationModal('Delete this message?', () => {
                        this.executeDelete(index, 'single');
                    });
                }
            },

            /**
             * Opens the delete options modal for a message.
             * @param {number} index - The index of the message.
             */
            confirmDeleteMessage(index) {
                const state = ReactiveStore.state;
                const dmCharId = (typeof TextModeController !== 'undefined') ? TextModeController.RUNTIME.activeCharId : null;

                // Optimized Delete: Check if any VISIBLE message follows this one. In Text Mode
                // "visible" means the open thread, so the prompt matches what is on screen.
                const followingMessages = state.chat_history.slice(index + 1);
                const hasFollowingChat = dmCharId
                    ? followingMessages.some(m => m.type === 'dm' && m.exclusive_to_char_id === dmCharId)
                    : followingMessages.some(m => m.type === 'chat' && !m.isHidden);

                this.closeAllMessageMenus();
                if (!hasFollowingChat) {
                    this.executeDelete(index, 'single');
                } else {
                    UIManager.showDeleteMessageOptions(index);
                }
            },

            /**
             * Executes the deletion of messages based on the selected mode.
             * @param {number} index - The index of the message.
             * @param {string} mode - 'single' or 'forward'.
             */
            executeDelete(index, mode) {
                const state = ReactiveStore.state;

                if (mode === 'single') {
                    const msg = state.chat_history[index];
                    const deletedIds = [];
                    if (msg) {
                        deletedIds.push(msg.id);
                        const nextMsg = state.chat_history[index + 1];
                        if (nextMsg && nextMsg.type === 'lore_reveal') {
                            deletedIds.push(nextMsg.id);
                        }
                        this.rollbackKnowledgeForDeletedMessages(deletedIds);
                        this.restoreLoreIndicesForRemovedMessages([msg, nextMsg]);
                    }

                    if (msg && msg.type === 'chat') state.messageCounter--;
                    state.chat_history.splice(index, 1);

                    // Fix: Check if the message that is now at 'index' (shifted from index+1) is a 'lore_reveal'
                    // If so, it was likely triggered by the message we just deleted, so we should clean it up.
                    const shiftedMsg = state.chat_history[index];
                    if (shiftedMsg && shiftedMsg.type === 'lore_reveal') {
                        state.chat_history.splice(index, 1);
                    }
                }
                else if (mode === 'forward') {
                    const dmCharId = (typeof TextModeController !== 'undefined') ? TextModeController.RUNTIME.activeCharId : null;

                    if (dmCharId) {
                        // Text Mode: rewind only the open thread. Main narrative beats and other
                        // characters' threads sit interleaved in the same array but are not on
                        // screen, so a blind truncate here would destroy them invisibly.
                        const removed = state.chat_history.filter((m, i) =>
                            i >= index && m && m.type === 'dm' && m.exclusive_to_char_id === dmCharId);

                        this.rollbackKnowledgeForDeletedMessages(removed.map(m => m.id));
                        this.restoreLoreIndicesForRemovedMessages(removed);

                        // Splice backwards so earlier indices stay valid as we remove.
                        for (let i = state.chat_history.length - 1; i >= index; i--) {
                            const m = state.chat_history[i];
                            if (m && m.type === 'dm' && m.exclusive_to_char_id === dmCharId) {
                                state.chat_history.splice(i, 1);
                            }
                        }
                    } else {
                        // Main narrative: rewind the whole timeline, including any texts that
                        // happened after this point.
                        const removed = state.chat_history.slice(index);
                        const deletedIds = removed.map(m => m.id);
                        this.rollbackKnowledgeForDeletedMessages(deletedIds);
                        this.restoreLoreIndicesForRemovedMessages(removed);

                        const chatCount = removed.filter(m => m.type === 'chat').length;
                        state.messageCounter = Math.max(0, state.messageCounter - chatCount);

                        // Perform truncate
                        state.chat_history.splice(index);
                    }
                }

                AppController.closeModal('confirmation-modal');
            },

            /**
             * Undoes the last turn (removes the last message).
             */
            undoLastTurn() {
                if (this.RUNTIME.activeRequestAbortController || UIManager.RUNTIME.streamingInterval) return;
                const history = ReactiveStore.state.chat_history;
                if (history.length === 0) return;

                // In a private thread, undo removes that thread's last message. The main-story
                // walk below would otherwise delete trailing texts AND a scene message.
                if (typeof TextModeController !== 'undefined' && TextModeController.isActive()) {
                    const dmCharId = TextModeController.RUNTIME.activeCharId;
                    for (let i = history.length - 1; i >= 0; i--) {
                        const m = history[i];
                        if (m && m.type === 'dm' && m.exclusive_to_char_id === dmCharId) {
                            this.rollbackKnowledgeForDeletedMessages([m.id]);
                            this.restoreLoreIndicesForRemovedMessages([m]);
                            history.splice(i, 1);
                            break;
                        }
                    }
                    UIManager.renderChat();
                    return;
                }

                const deletedIds = [];
                const removedMessages = [];
                let removedChatMessage = false;
                let i = history.length - 1;
                while (i >= 0 && !removedChatMessage) {
                    const msg = history[i];
                    deletedIds.push(msg.id);
                    removedMessages.push(msg);
                    history.splice(i, 1); // Reactive splice
                    if (msg.type === 'chat') {
                        ReactiveStore.state.messageCounter--;
                        removedChatMessage = true;
                    }
                    i--;
                }

                if (deletedIds.length > 0) {
                    this.rollbackKnowledgeForDeletedMessages(deletedIds);
                    this.restoreLoreIndicesForRemovedMessages(removedMessages);
                }
            },

            /**
             * Creates a snapshot of the knowledge and game states.
             * @param {Array<string>} messageIds - The IDs of the related messages.
             * @returns {Object} The snapshot revision.
             */
            createKnowledgeSnapshot(messageIds) {
                const state = ReactiveStore.state;
                return {
                    id: UTILITY.uuid(),
                    timestamp: new Date().toISOString(),
                    messageIds: [...messageIds],
                    snapshot: {
                        static_entries: JSON.parse(JSON.stringify(state.static_entries || [])),
                        narrative_timeline: JSON.parse(JSON.stringify(state.narrative_timeline || [])),
                        relationship_matrix: JSON.parse(JSON.stringify(state.relationship_matrix || [])),
                        journal_entries: JSON.parse(JSON.stringify(state.journal_entries || [])),
                        evolved_characters: JSON.parse(JSON.stringify(state.evolved_characters || {})),
                        livingPersonaCounters: JSON.parse(JSON.stringify(state.livingPersonaCounters || {})),
                        gameState: state.gameState ? JSON.parse(JSON.stringify(state.gameState)) : null,
                        worldMapGrid: state.worldMap && state.worldMap.grid
                            ? JSON.parse(JSON.stringify(state.worldMap.grid))
                            : null
                    }
                };
            },

            /**
             * Checks the knowledge revisions and rolls them back if they were triggered/generated
             * using any of the deleted message IDs.
             * @param {Array<string>} deletedMessageIds - The IDs of the deleted messages.
             */
            rollbackKnowledgeForDeletedMessages(deletedMessageIds) {
                const state = ReactiveStore.state;
                if (!state.knowledge_revisions || state.knowledge_revisions.length === 0) return;

                let earliestAffectedIndex = -1;
                for (let i = 0; i < state.knowledge_revisions.length; i++) {
                    const rev = state.knowledge_revisions[i];
                    const hasIntersection = rev.messageIds.some(id => deletedMessageIds.includes(id));
                    if (hasIntersection) {
                        earliestAffectedIndex = i;
                        break;
                    }
                }

                if (earliestAffectedIndex !== -1) {
                    const rev = state.knowledge_revisions[earliestAffectedIndex];
                    console.log(`[Revisions] Rolling back knowledge to snapshot from ${rev.timestamp} due to deletion of:`, deletedMessageIds);

                    state.static_entries = JSON.parse(JSON.stringify(rev.snapshot.static_entries || []));
                    state.narrative_timeline = JSON.parse(JSON.stringify(rev.snapshot.narrative_timeline || []));
                    state.relationship_matrix = JSON.parse(JSON.stringify(rev.snapshot.relationship_matrix || []));
                    state.journal_entries = JSON.parse(JSON.stringify(rev.snapshot.journal_entries || []));

                    // Revisions saved before these two stores were tracked have no such key.
                    // Defaulting to {} would erase a persona the snapshot never captured, so
                    // an absent key means "leave it alone" rather than "it was empty".
                    if (rev.snapshot.evolved_characters) {
                        state.evolved_characters = JSON.parse(JSON.stringify(rev.snapshot.evolved_characters));
                    }
                    if (rev.snapshot.livingPersonaCounters) {
                        state.livingPersonaCounters = JSON.parse(JSON.stringify(rev.snapshot.livingPersonaCounters));
                    }

                    if (rev.snapshot.gameState) {
                        state.gameState = JSON.parse(JSON.stringify(rev.snapshot.gameState));
                    }
                    if (rev.snapshot.worldMapGrid && state.worldMap) {
                        state.worldMap.grid = JSON.parse(JSON.stringify(rev.snapshot.worldMapGrid));
                    }

                    // Remove this revision and all subsequent revisions from history
                    state.knowledge_revisions.splice(earliestAffectedIndex);

                    ReactiveStore.forceSave();

                    if (typeof UIManager !== 'undefined') {
                        UIManager.renderStaticEntries();
                        UIManager.renderDynamicEntries();
                        UIManager.renderInventoryPanel();
                    }
                }
            },

            /**
             * Rewinds sequential lorebook entries whose reveals are being deleted.
             * current_index advances every turn, so the every-6-messages knowledge
             * snapshot is too coarse to undo it; the stage is carried on the
             * lore_reveal message itself instead (see _triggerLoreEntry).
             * Scans the same pools as checkDynamicEntryTriggers: global dynamic_entries
             * plus dynamic_knowledge on roster and location characters.
             * @param {Array<Object>} removedMessages - The messages being removed.
             */
            restoreLoreIndicesForRemovedMessages(removedMessages) {
                const lowest = UTILITY.lowestLoreIndexByEntry(removedMessages);
                if (Object.keys(lowest).length === 0) return;

                const state = ReactiveStore.state;
                const locationChars = (typeof ReactiveStore.getActiveLocationCharacters === 'function')
                    ? ReactiveStore.getActiveLocationCharacters()
                    : [];
                const pools = [state.dynamic_entries || []];
                [...(state.characters || []), ...locationChars].forEach(c => {
                    if (c && c.dynamic_knowledge) pools.push(c.dynamic_knowledge);
                });

                let changed = false;
                pools.forEach(pool => {
                    pool.forEach(entry => {
                        if (!entry || !(entry.id in lowest)) return;
                        if (entry.current_index === lowest[entry.id]) return;
                        entry.current_index = lowest[entry.id];
                        changed = true;
                    });
                });

                if (changed) {
                    ReactiveStore.forceSave();
                    if (typeof UIManager !== 'undefined') UIManager.renderDynamicEntries();
                }
            },

            /**
             * Triggers background auto static knowledge and journal updates.
             * Wraps them in a snapshot transaction to log revisions.
             */
            async triggerAutoKnowledgeUpdates() {
                const state = ReactiveStore.state;
                if (state.messageCounter > 0 && state.messageCounter % 6 === 0) {
                    const history = state.chat_history;
                    const chatMessages = history.filter(m => m.type === 'chat');
                    const recent = chatMessages.slice(0, -1).slice(-6);

                    if (recent.length === 0) return;

                    const messageIds = recent.map(m => m.id);

                    // Create snapshot BEFORE updates
                    const snapshotObj = this.createKnowledgeSnapshot(messageIds);

                    // Sequential updates
                    await this.checkAutoStaticKnowledge();
                    await this.checkAutoJournal();

                    // Compare changes
                    const changed =
                        JSON.stringify(state.static_entries || []) !== JSON.stringify(snapshotObj.snapshot.static_entries) ||
                        JSON.stringify(state.narrative_timeline || []) !== JSON.stringify(snapshotObj.snapshot.narrative_timeline) ||
                        JSON.stringify(state.relationship_matrix || []) !== JSON.stringify(snapshotObj.snapshot.relationship_matrix) ||
                        JSON.stringify(state.journal_entries || []) !== JSON.stringify(snapshotObj.snapshot.journal_entries);

                    if (changed) {
                        state.knowledge_revisions = state.knowledge_revisions || [];
                        state.knowledge_revisions.push(snapshotObj);
                        ReactiveStore.forceSave();
                    }
                }
            },

            /**
             * Copies the content of a message to the clipboard.
             * @param {number} index - The index of the message.
             */
            copyMessage(index) {
                const msg = ReactiveStore.state.chat_history[index];
                if (!msg) return;

                // Use modern Clipboard API
                navigator.clipboard.writeText(msg.content).then(() => {
                    // UI Feedback
                    const btn = document.querySelector(`[data-message-index='${index}'] button[data-action='chat-copy']`);
                    if (btn) {
                        const original = btn.innerHTML;
                        btn.innerHTML = `<span class="text-xs text-green-400 font-bold">Copied!</span>`;
                        setTimeout(() => btn.innerHTML = original, 1500);
                    }
                    this.closeAllMessageMenus();
                }).catch(err => {
                    console.error('Failed to copy text: ', err);
                    alert("Failed to copy to clipboard.");
                });
            },

            /**
             * Opens the thinking / reasoning modal for a specific message.
             * @param {number} index - The index of the message.
             */
            openThinkingModal(index) {
                const state = ReactiveStore.state;
                const msg = state.chat_history[index];
                if (!msg) return;

                const currentVer = msg.currentVersion || 0;
                const thinkingText = (msg.versions && msg.versions[currentVer] && msg.versions[currentVer].thinking)
                    ? msg.versions[currentVer].thinking
                    : (msg.thinking || '');

                if (!thinkingText || !thinkingText.trim()) {
                    AppController.showNotification("No thinking data recorded for this message.", "info");
                    return;
                }

                const speaker = ReactiveStore.getCharacter(msg.character_id);
                const speakerName = speaker ? speaker.name : (msg.character_id === 'user' ? 'User' : 'Assistant');
                const modalTitle = document.getElementById('thinking-modal-title');
                const modalSubtitle = document.getElementById('thinking-modal-subtitle');
                const modalContent = document.getElementById('thinking-modal-content');
                const modalStats = document.getElementById('thinking-modal-stats');

                if (modalTitle) modalTitle.textContent = `${speakerName}'s Reasoning`;
                if (modalSubtitle) {
                    const verStr = (msg.versions && msg.versions.length > 1) ? ` (Version ${currentVer + 1}/${msg.versions.length})` : '';
                    modalSubtitle.textContent = `Internal scratchpad & thought process${verStr}`;
                }
                if (modalContent) modalContent.textContent = thinkingText.trim();
                if (modalStats) {
                    const words = thinkingText.trim().split(/\s+/).filter(Boolean).length;
                    const chars = thinkingText.length;
                    modalStats.textContent = `${words} words · ${chars} characters`;
                }

                this.closeAllMessageMenus();
                AppController.openModal('thinking-modal');
            },

            /**
             * Copies the text from the open thinking modal to clipboard.
             */
            copyThinkingModalText() {
                const contentEl = document.getElementById('thinking-modal-content');
                const text = contentEl ? contentEl.textContent : '';
                if (!text) return;
                navigator.clipboard.writeText(text).then(() => {
                    AppController.showNotification("Thinking copied to clipboard!", "info");
                }).catch(err => {
                    console.error("Failed to copy thinking: ", err);
                    alert("Failed to copy thinking to clipboard.");
                });
            },

            /**
             * Toggles the message dropdown menu for a specific message.
             * @param {number} index - The index of the message.
             * @param {Event} [event] - The triggering click event.
             */
            toggleMessageMenu(index, event) {
                if (event) {
                    event.stopPropagation();
                }
                const targetMenu = document.getElementById(`message-menu-${index}`);
                if (!targetMenu) return;
                const isCurrentlyOpen = !targetMenu.classList.contains('hidden');

                // Close all open message dropdowns first
                this.closeAllMessageMenus();

                if (!isCurrentlyOpen) {
                    targetMenu.classList.remove('hidden');
                }
            },

            /**
             * Closes all currently open message dropdown menus.
             */
            closeAllMessageMenus() {
                const openMenus = document.querySelectorAll('.message-dropdown-menu:not(.hidden)');
                openMenus.forEach(m => m.classList.add('hidden'));
            },

            /**
             * Opens the edit modal for a specific message.
             * @param {number} index - The index of the message.
             */
            openEditModal(index) {
                const message = ReactiveStore.state.chat_history[index];
                if (!message) return;

                this.closeAllMessageMenus();

                const input = document.getElementById('edit-modal-input');
                input.value = message.content;

                // Bind save button dynamically to this index
                const saveBtn = document.getElementById('edit-modal-save-button');
                // Remove old listener to prevent stacking
                const newBtn = saveBtn.cloneNode(true);
                saveBtn.parentNode.replaceChild(newBtn, saveBtn);

                // Bind Bolt (Continue) button dynamically
                const boltBtn = document.getElementById('edit-modal-bolt-button');
                if (boltBtn) {
                    const newBoltBtn = boltBtn.cloneNode(true);
                    boltBtn.parentNode.replaceChild(newBoltBtn, boltBtn);
                    newBoltBtn.onclick = () => NarrativeController.handleEditModalBoltAction();
                }

                newBtn.onclick = () => {
                    const targetMsg = ReactiveStore.state.chat_history[index];
                    targetMsg.content = input.value;
                    if (targetMsg.versions && targetMsg.versions[targetMsg.currentVersion || 0]) {
                        targetMsg.versions[targetMsg.currentVersion || 0].content = input.value;
                    }
                    if (typeof InventoryController !== 'undefined') {
                        InventoryController.processStateUpdates(targetMsg);
                    }
                    UIManager.renderChat();
                    AppController.closeModal('edit-response-modal');
                };

                AppController.openModal('edit-response-modal');
            },

            /**
             * Renames the active narrative (debounced).
             * @param {string} newName - The new name.
             */
            renameActiveNarrative: debounce(function (newName) {
                const state = ReactiveStore.state;
                if (!state) return;

                // 1. Update Reactive State immediately
                state.narrativeName = newName;

                // 2. Force a save immediately to sync this name to the DB Stubs
                // This relies on our new "Surgical Update" in StoryService.saveActiveState
                ReactiveStore.forceSave();

            }, 500),

            /**
             * Handles actions for visual events (Save, Set Background).
             * @param {string} action - 'save' or 'background'.
             * @param {string} key - The IndexedDB key of the image.
             */
            async handleVisualAction(action, key) {
                if (!key) return;
                const blob = await DBService.getImage(key);
                if (!blob) { alert("Image not found locally."); return; }

                if (action === 'save') {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `Rolecraft_Scene_${Date.now()}.png`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } else if (action === 'background') {
                    if (confirm("Set this image as the background for this story?")) {
                        // Save as persistent background
                        const library = StateManager.getLibrary();
                        const storyId = library.active_story_id;
                        if (!storyId) return;

                        // Use standard key format (bg_UUID)
                        const bgKey = `bg_${storyId}`;
                        const saved = await DBService.saveImage(bgKey, blob);
                        if (!saved) { alert("Failed to save background."); return; }

                        // Update Cache immediately (Critical for applyStyling)
                        if (UIManager.RUNTIME.globalBackgroundImageCache) URL.revokeObjectURL(UIManager.RUNTIME.globalBackgroundImageCache);
                        UIManager.RUNTIME.globalBackgroundImageCache = URL.createObjectURL(blob);

                        // Update State
                        StateManager.getState().backgroundImageURL = 'local_idb_background';
                        await ReactiveStore.forceSave();

                        // Apply
                        UIManager.applyStyling();

                        // Update UI hint if setting modal is open
                        const bgHint = document.getElementById('background-image-hint');
                        if (bgHint) bgHint.textContent = 'Current: [Visual Master Image]';
                    }
                }
            },

            /**
             * Regenerates a visual event image.
             * @param {number} index - The index of the message in chat_history.
             * @param {HTMLElement} btnElement - The button that triggered the action.
             */
            async regenerateVisual(index, btnElement) {
                const state = ReactiveStore.state;
                const msg = state.chat_history[index];
                if (!msg || msg.type !== 'visual_event') return;

                const prompt = msg.content;
                if (!prompt) return;

                // UI Feedback
                const originalContent = btnElement.innerHTML;
                btnElement.disabled = true;
                btnElement.innerHTML = `<svg class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;

                try {
                    // Call Image Generation directly (bypassing VisualMaster cues)
                    const blob = await ImageGenerationService.generateImage(
                        prompt,
                        "nsfw, nude, naked, bad anatomy, text, watermark, blurry, low quality",
                        {
                            width: StateManager.data.globalSettings.imageGenWidth || 512,
                            height: StateManager.data.globalSettings.imageGenHeight || 512,
                            steps: StateManager.data.globalSettings.koboldImageGenSteps || 20
                        }
                    );

                    if (!blob) throw new Error("Image generation failed.");

                    // Overwrite the existing image in DB with the SAME key (so we don't leak orphans)
                    // Actually, safer to create new key to avoid cache collisions, then delete old?
                    // Let's create NEW key.
                    const newImageId = `visual_event_${Date.now()}`;
                    await DBService.saveImage(newImageId, blob);

                    // Optional: Clean up old image if desired, but history undo might need it? 
                    // Ellipsis V1 strategy: Keep it safe.

                    // Update Message
                    msg.image_key = newImageId;
                    msg.timestamp = new Date().toISOString(); // Update timestamp to show freshness? Or keep original? Keep original context, maybe just update isNew for animation.

                    // Force Save
                    await ReactiveStore.forceSave();

                    // Force Update of this specific bubble image in DOM
                    const bubble = document.querySelector(`.chat-bubble-container[data-message-index="${index}"]`);
                    if (bubble) {
                        const img = bubble.querySelector('img[data-visual-key]');
                        const canvas = bubble.querySelector('canvas[data-bleed-canvas]');
                        if (img) {
                            img.dataset.visualKey = newImageId;
                            const url = URL.createObjectURL(blob);
                            if (canvas) {
                                img.style.opacity = '0';
                                img.src = url;
                                img.dataset.src = url;
                                ImageProcessor.triggerTexturedInkBleed(img, canvas);
                            } else {
                                UTILITY.safeImageSet(img, url);
                            }
                        }
                    } else {
                        UIManager.renderChat();
                    }

                } catch (err) {
                    console.error("Regen Failed:", err);
                    alert("Failed to regenerate image: " + err.message);
                } finally {
                    btnElement.disabled = false;
                    btnElement.innerHTML = originalContent;
                }
            },

            // --- AI Generation Logic ---

            /**
             * Clears any system error messages from the chat history.
             */
            clearSystemErrors() {
                const state = ReactiveStore.state;
                if (state.chat_history.length > 0) {
                    // Filter out system events starting with "AI Error"
                    const cleanHistory = state.chat_history.filter(msg =>
                        !(msg.type === 'system_event' && msg.content.startsWith('AI Error'))
                    );

                    if (cleanHistory.length !== state.chat_history.length) {
                        state.chat_history = cleanHistory;
                    }
                }
            },

            /**
             * Triggers the AI to generate a response.
             * Handles character selection, prompt building, API calls, and streaming.
             * @param {string|null} charId - The ID of the character to speak.
             * @param {string} userMessage - The user's last message (for analysis).
             * @param {boolean} isAfterMove - Whether this follows a location move.
             * @param {number|null} targetMessageIndex - Index of message to overwrite (regen/versioning).
             */
            /**
             * Triggers the AI to generate a response.
             * Handles character selection, prompt building, API calls, and streaming.
             * @param {string|Promise<string>|null} charIdOrPromise - The ID (or Promise resolving to ID) of the character to speak.
             * @param {string} userMessage - The user's last message (for analysis).
             * @param {boolean} isAfterMove - Whether this follows a location move.
             * @param {number|null} targetMessageIndex - Index of message to overwrite (regen/versioning).
             * @param {Promise|null} visualBlockerPromise - Optional promise from Visual Master to await before displaying.
             */
            async triggerAIResponse(charIdOrPromise = null, userMessage = '', isAfterMove = false, targetMessageIndex = null, visualBlockerPromise = null, userImages = []) {
                const state = ReactiveStore.state;

                // handleDirectCharacter passes its instruction in through userMessage, and
                // the prompt built below never forwarded it - so outside Swarm mode the
                // directive was read from the input, used to choose a speaker, and then
                // dropped. Swarm honours it because its own builders look for this marker.
                const directiveInstruction = (typeof userMessage === 'string' && userMessage.includes('[DIRECTIVE]:'))
                    ? userMessage
                    : null;

                // Visual Lore chosen for this turn. sendMessage attaches them to the message
                // it creates and clears the list before getting here, so anything still
                // pending belongs to a turn with no message of its own - directing a
                // character, or passing the turn. Without this they were silently ignored
                // and left sitting on the chip bar, ready to attach themselves to whatever
                // was sent next.
                let pendingLoreIds = [];
                if (typeof UIManager !== 'undefined' && Array.isArray(UIManager.VISUAL_LORE_PENDING)
                    && UIManager.VISUAL_LORE_PENDING.length) {
                    pendingLoreIds = UIManager.VISUAL_LORE_PENDING.slice();
                    UIManager.VISUAL_LORE_PENDING = [];
                    UIManager.renderVisualLoreChips();
                }

                // Clear previous error messages before starting new generation
                this.clearSystemErrors();
                this._clearResponseOptions();

                // 1. Validation
                const activeAiChars = [...state.characters, ...ReactiveStore.getActiveLocationCharacters()].filter(c => !c.is_user && c.is_active);
                if (activeAiChars.length === 0) {
                    this.addSystemMessageToHistory("No active AI characters.");
                    return;
                }
                if (!this._isModelConfigured(state)) {
                    this.addSystemMessageToHistory("AI model not configured. Check Settings.");
                    return;
                }

                // 2. Determine Speaker (Await Promise if provided)
                let targetId = null;

                // UX: If we are waiting for a speaker, show a generic loading indicator?
                // Actually, determineNextSpeaker handles its own "..." indicator.
                // checking strictly for Promise instance or duck-typing
                if (charIdOrPromise && typeof charIdOrPromise.then === 'function') {
                    try {
                        targetId = await charIdOrPromise;
                    } catch (e) {
                        console.error("Speaker selection promise failed:", e);
                    }
                } else {
                    targetId = charIdOrPromise;
                }

                // Fallback Logic (if null passed or promise failed, though sendMessage usually handles this)
                // This handles cases like manual calls where 'any' logic might be local
                if (!targetId) {
                    const selectorVal = document.getElementById('ai-character-selector').value;
                    if (selectorVal === 'any') {
                        // If we didn't receive a promise, we must run it now (Serial fallback)
                        targetId = await this.determineNextSpeaker(isAfterMove);
                    } else {
                        targetId = selectorVal;
                    }
                }

                if (!targetId) return;

                // Living Persona Block Check
                this._pendingEvolutions = this._pendingEvolutions || new Set();
                if (this._pendingEvolutions.has(targetId)) {
                    UIManager.showLoadingSpinner('Evaluating Living Persona...');
                    while (this._pendingEvolutions.has(targetId)) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    UIManager.hideLoadingSpinner();
                }

                let originalContent = null;
                // 3. Setup UI for Generation
                if (targetMessageIndex !== null) {
                    // REGEN MODE: Don't show new typing bubble.
                    // Instead, clear the existing message to indicate processing.
                    const char = ReactiveStore.getCharacter(targetId);
                    originalContent = state.chat_history[targetMessageIndex].content;
                    const msgEl = document.getElementById(`message-content-${targetMessageIndex}`);
                    if (msgEl) {
                        msgEl.innerHTML = `<span class="animate-pulse text-gray-500">${char ? char.name : 'Character'} is thinking...</span>`;
                        // Also update state so if a render happens, it doesn't revert immediately
                        state.chat_history[targetMessageIndex].content = `${char ? char.name : 'Character'} is thinking...`;
                    }
                } else {
                    // NORMAL MODE: Show typing indicator at bottom
                    UIManager.showTypingIndicator(targetId);
                }

                UIManager.setButtonToStopMode();
                this.RUNTIME.activeRequestAbortController = new AbortController();

                try {
                    // 4. Generate Response (Parallel Execution Start)
                    // (Note: Objectivity is now integrated into Director Mode by default)

                    // Fix: Provide clean history context if regenerating (exclude the old message)
                    const historyOverride = targetMessageIndex !== null ? state.chat_history.slice(0, targetMessageIndex) : null;
                    // customInstruction REPLACES the default instruction rather than adding
                    // to it, so the default is restated here and the directive follows it.
                    // Landing last puts it directly before the response anchor, which is
                    // where the Swarm director prompt deliberately places it too.
                    let directiveCustomInstruction = null;
                    if (directiveInstruction) {
                        const actingChar = ReactiveStore.getCharacter(targetId);
                        const actingName = actingChar ? actingChar.name : 'the character';
                        directiveCustomInstruction =
                            `Generate the next response for ${actingName}. Stay in character.\n\n${directiveInstruction}`;
                    }

                    // There is no message of our own to hang these on, so they ride with the
                    // instruction. customInstruction REPLACES the default, so restate it when
                    // there is no directive already doing that.
                    if (pendingLoreIds.length && typeof VisualLoreService !== 'undefined') {
                        const detail = VisualLoreService.buildContextBlock(pendingLoreIds);
                        if (detail) {
                            if (!directiveCustomInstruction) {
                                const actingChar = ReactiveStore.getCharacter(targetId);
                                const actingName = actingChar ? actingChar.name : 'the character';
                                directiveCustomInstruction =
                                    `Generate the next response for ${actingName}. Stay in character.`;
                            }
                            directiveCustomInstruction += `\n\n${detail}`;
                        }
                    }
                    const prompt = PromptBuilder.buildPrompt(targetId, false, historyOverride, directiveCustomInstruction);

                    // START REQUEST (Do not await yet if there might be other parallel work, but here we await basic text first)
                    // actually, to fully parallelize, we could start this promise and the emotion analysis promise.

                    // [NEW] Capture Prompt Metadata BEFORE sending
                    this.RUNTIME.lastPromptDetails = {
                        prompt: prompt, // The actual string
                        model: state.apiProvider,
                        charId: targetId,
                        timestamp: new Date().toISOString()
                    };

                    const textGenPromise = APIService.callAI(prompt, false, this.RUNTIME.activeRequestAbortController.signal, { returnMeta: true });

                    // Await Text Generation First
                    const genResult = await textGenPromise;
                    let responseText = (typeof genResult === 'object' && genResult !== null) ? genResult.text : genResult;
                    const thinkingText = (typeof genResult === 'object' && genResult !== null) ? genResult.thinking : (APIService.getLastThinking() || null);

                    // Clean up leaked Event Master instructions if the model hallucinated them
                    const leakMatch = responseText.match(/(?:---|###|\[|\n)?\s*SECRET EVENT MASTER INSTRUCTION/i);
                    if (leakMatch) {
                        responseText = responseText.substring(0, leakMatch.index).trim();
                    }

                    // Regex Formatting (Force Style)
                    try {
                        if (state.responseStyle === 'prose') {
                            responseText = TextFormatter.toProse(responseText);
                        } else if (state.responseStyle === 'roleplay') {
                            responseText = TextFormatter.toRoleplay(responseText);
                        }
                    } catch (e) {
                        console.error("Text Formatting failed:", e);
                    }

                    // 6. Stream Result IMMEDIATELY (Non-blocking display)
                    UIManager.hideTypingIndicator();
                    // Display with neutral emotion first to avoid blocking text display
                    this.startStreamingResponse(targetId, responseText, 'neutral', targetMessageIndex, [], thinkingText);

                    // Directives are otherwise one-shot: read from the input, used once,
                    // never stored. Regenerating the message then quietly dropped the
                    // direction and answered the previous message instead. Keeping it on
                    // the message it produced lets handleRegen apply it again.
                    if (directiveInstruction || pendingLoreIds.length) {
                        const producedIndex = (targetMessageIndex !== null)
                            ? targetMessageIndex
                            : (state.chat_history.length - 1);
                        const producedMsg = state.chat_history[producedIndex];
                        if (producedMsg) {
                            if (directiveInstruction) producedMsg.directive = directiveInstruction;
                            // Kept on the reply so the detail stays in play for the turns
                            // that follow, and so a rerun of this message still carries it.
                            if (pendingLoreIds.length) producedMsg.item_ids = pendingLoreIds.slice();
                        }
                    }

                    // 7. Analyze combined interaction (Post-Display Concurrency)
                    // We don't await this so the text shows up instantly. 
                    // Portrait will pop-in/update once analysis is done.
                    const charObj = ReactiveStore.getCharacter(targetId);
                    const npcName = charObj ? charObj.name : 'Character';
                    const combinedTurnText = userMessage ? `User: ${userMessage}\n${npcName}: ${responseText}` : responseText;

                    this.analyzeTurn(combinedTurnText, targetId).then(aiAnalysis => {
                        const targetIndex = (targetMessageIndex !== null) ? targetMessageIndex : (state.chat_history.length - 1);
                        const msg = state.chat_history[targetIndex];
                        if (msg) {
                            msg.emotion = aiAnalysis.emotion;
                            // Update the portrait visually if in bubble mode
                            if (state.characterImageMode === 'bubble') {
                                this.updateMessagePortrait(targetIndex, targetId, aiAnalysis.emotion);
                            }
                        }
                        // Apply all analysis results (stats, location, journal updates)
                        this.applyAnalysisResults(targetId, aiAnalysis);
                    }).catch(err => console.warn("Background sentiment analysis failed:", err));

                    // 8. Visual Master Synchronization (Non-blocking)
                    // We don't await here because visual master now uses placeholders.
                    // This allows the text to appear while the image is still being "painted".
                    // The placeholder at placeholderIndex will be replaced when visualBlockerPromise resolves.

                    // 9. TTS Trigger
                    // Check Mode
                    const globalSettings = StateManager.data.globalSettings;
                    const ttsMode = globalSettings.ttsMode || 'off'; // Default off

                    if (ttsMode !== 'off' && typeof TTSService !== 'undefined') {
                        // Resolve Voice
                        // We resolved targetId earlier
                        let voice = 'Puck'; // Default
                        const char = ReactiveStore.getCharacter(targetId);
                        if (char && char.ttsVoice) {
                            voice = char.ttsVoice;
                        } else if (globalSettings.ttsVoice) {
                            voice = globalSettings.ttsVoice;
                        }

                        // Resolve Text based on Mode
                        let textToSpeak = responseText;
                        if (ttsMode === 'dialogue') {
                            // Extract text between quotes (standard and smart)
                            // Regex: /"([^"]+)"|“([^”]+)”/g
                            const matches = [];
                            const regex = /"([^"]+)"|“([^”]+)”/g;
                            let match;
                            while ((match = regex.exec(responseText)) !== null) {
                                // match[1] is straight quotes, match[2] is smart quotes
                                if (match[1]) matches.push(match[1]);
                                if (match[2]) matches.push(match[2]);
                            }

                            if (matches.length > 0) {
                                // Join with pauses
                                textToSpeak = matches.join('. ... ');
                            } else {
                                textToSpeak = ""; // No dialogue found
                            }
                        }

                        if (textToSpeak && textToSpeak.trim().length > 0) {
                            TTSService.speak(textToSpeak, voice);
                        }
                    }

                    // 10. Run GM Rule Evaluation (programmatically)
                    if (typeof WorldController !== 'undefined' && typeof WorldController.checkGMRulesProgrammatic === 'function') {
                        try {
                            WorldController.checkGMRulesProgrammatic();
                        } catch (err) {
                            console.error("GM Rule evaluation failed:", err);
                        }
                    }
                } catch (error) {
                    if (error.name === 'AbortError') {
                        console.log("Stopped.");
                    } else {
                        // callAI already reports and marks the failures it recognises,
                        // so repeating it here produced two entries for one problem:
                        // "Connection failed: OpenRouter is offline or unreachable."
                        // alongside "AI Error: Failed to fetch".
                        if (!error.reported && typeof UIManager !== 'undefined' && UIManager.showToast) {
                            UIManager.showToast(`AI Error: ${error.message}`, true);
                        } else if (!error.reported) {
                            console.error(`AI Error: ${error.message}`);
                        }

                        // The connection was cut while the app was in another app, which
                        // is the common mobile case: submit, switch away, come back to a
                        // turn that never happened and no way forward but sending again.
                        // Take the turn once more as soon as the app is back on screen.
                        if (error.interruptedWhileHidden && !this.RUNTIME.resumeArmed) {
                            this.RUNTIME.resumeArmed = true;
                            const lengthAtFailure = state.chat_history.length;
                            const resume = () => {
                                if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
                                if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', resume);
                                this.RUNTIME.resumeArmed = false;
                                // A reply that landed in the meantime means there is nothing
                                // to resume, and retrying would produce a duplicate turn.
                                if (ReactiveStore.state.chat_history.length !== lengthAtFailure) return;
                                if (typeof UIManager !== 'undefined') {
                                    UIManager.showNotification('Connection dropped while you were away. Taking the turn again.', 'info');
                                }
                                this.triggerAIResponse(null, '', false, null, null);
                            };
                            if (typeof document !== 'undefined') {
                                document.addEventListener('visibilitychange', resume);
                                if (document.visibilityState === 'visible') setTimeout(resume, 0);
                            }
                        }
                    }
                    if (targetMessageIndex !== null && originalContent !== null) {
                        state.chat_history[targetMessageIndex].content = originalContent;
                        UIManager.renderChatHistory(state.chat_history);
                    }
                    UIManager.hideTypingIndicator(true);
                } finally {
                    UIManager.setButtonToSendMode();
                    this.RUNTIME.activeRequestAbortController = null;
                    UIManager.hideTypingIndicator();
                }
            },

            /**
             * Updates the portrait of a message in the chat history after analysis.
             * @param {number} index - The message index.
             * @param {string} charId - The character ID.
             * @param {string} emotion - The new emotion.
             */
            updateMessagePortrait(index, charId, emotion) {
                const char = ReactiveStore.getCharacter(charId);
                if (!char) return;

                const imgSrc = UIManager.getPortraitSrc(char, emotion);
                if (!imgSrc) return;

                const bubbleContainer = document.querySelector(`.chat-bubble-container[data-message-index="${index}"]`);
                if (bubbleContainer) {
                    const img = bubbleContainer.querySelector('.bubble-char-image');
                    if (img) {
                        UTILITY.safeImageSet(img, imgSrc);
                    }
                }
            },

            /**
             * Stops the current AI generation process.
             */
            stopGeneration() {
                if (this.RUNTIME.activeRequestAbortController) {
                    this.RUNTIME.activeRequestAbortController.abort();
                }
                const state = ReactiveStore.state;
                if (state.apiProvider === 'koboldcpp' && state.koboldcpp_url) {
                    fetch(`${state.koboldcpp_url}/api/v1/generate/stop`, { method: 'POST' }).catch(() => { });
                }

                if (UIManager.RUNTIME.streamingInterval) {
                    clearInterval(UIManager.RUNTIME.streamingInterval);
                    UIManager.RUNTIME.streamingInterval = null;
                }

                UIManager.hideTypingIndicator();
                UIManager.setButtonToSendMode();
                this.RUNTIME.activeRequestAbortController = null;
            },

            /**
             * Determines the next speaker using an LLM "Scriptwriter" agent.
             * @param {boolean} isAfterMove - Whether this follows a location move.
             * @returns {Promise<string|null>} - The ID of the next speaker.
             */
            async determineNextSpeaker(isAfterMove) {
                const state = ReactiveStore.state;
                const userChar = state.characters.find(c => c.is_user);
                const userCharName = userChar ? userChar.name : "User";

                const pool = [...state.characters, ...ReactiveStore.getActiveLocationCharacters()].filter(c => !c.is_user && c.is_active);

                if (pool.length === 0) return null;
                if (pool.length === 1 && !isAfterMove) return pool[0].id; // Optimization for single char

                UIManager.showTypingIndicator(null, "...", "...");

                try {
                    // 1. Gather Context
                    const activeChars = pool.map(c => c.name).join(', ');

                    // Supporting cast: Non-active chars that have spoken recently (last 8 messages)
                    const recentMsgIds = [...new Set(state.chat_history.slice(-8).map(m => m.character_id))];
                    const supportingChars = state.characters
                        .filter(c => !c.is_user && !c.is_active && !c.is_narrator && recentMsgIds.includes(c.id))
                        .map(c => c.name)
                        .join(', ');

                    const narrators = state.characters.filter(c => c.is_narrator).map(c => c.name).join(', ');

                    const recentHistory = state.chat_history.slice(-10).map(m => {
                        const char = ReactiveStore.getCharacter(m.character_id);
                        return `${char ? char.name : 'System'}: ${m.content}`;
                    }).join('\n');

                    // 2. Construct Scriptwriter Prompt (Tag-based)
                    const prompt = `You are a scriptwriter responsible for selecting the next character to respond in an ongoing roleplay. 
The list of existing characters in the roleplay is provided below. You may select any of these characters *or* choose an unlisted character if it makes sense within the roleplay.
For example, if the characters are ordering drinks, 'Bartender' might be an appropriate next responder even if not listed.
Always prioritize characters actively participating in the roleplay, either responding or mentioned.

Active characters: ${activeChars || "None"}
Supporting characters: ${supportingChars || "None"}
Narrators: ${narrators || "None"}

RECENT CONVERSATION:
${recentHistory}

Review the above and determine who should speak next. 
Rules:
1. Provide a brief one-sentence reasoning for your choice.
2. End your response with the exact tag: [FINAL SELECTION]: Name
3. Name must match exactly one of the names in the lists above.
4. Do NOT select "${userCharName}".
5. Prefer a character who did not just speak in the most recent turn (unless the context strongly demands a back-to-back response from the same character).`;

                    console.log("[Scriptwriter Prompt]:", prompt);

                    // 3. Call AI
                    const response = await APIService.callAI(prompt, false);
                    console.log("[Scriptwriter Response]:", response);

                    // 4. Parse Selection
                    let selection = null;
                    const selectionMatch = response.match(/\[FINAL SELECTION\]:\s*(.*)/i);
                    if (selectionMatch && selectionMatch[1]) {
                        selection = selectionMatch[1].trim().replace(/['"\x60\.]*$/, '');
                    }

                    const data = UTILITY.extractAndParseJSON(response);
                    if (!selection && data) {
                        selection = data.selection;
                    }

                    if (!selection && typeof response === 'string') {
                        // Fallback: simple text scan if parsing failed
                        const priorityList = [...pool, ...state.characters.filter(c => !c.is_user && !c.is_active), ...ReactiveStore.getActiveLocationCharacters().filter(c => !c.is_active)];
                        for (const char of priorityList) {
                            if (response.includes(char.name)) {
                                selection = char.name;
                                break;
                            }
                        }
                    }

                    if (selection && selection.toLowerCase() === userCharName.toLowerCase()) {
                        console.warn("Scriptwriter tried to select User despite instructions. Attempting fallback...");

                        let fallbackFound = false;
                        // Try parsed candidates first
                        const candidatesList = (data && Array.isArray(data.top_3_candidates)) ? data.top_3_candidates : [];
                        for (const candidate of candidatesList) {
                            if (candidate && typeof candidate === 'string' && candidate.toLowerCase() !== userCharName.toLowerCase()) {
                                console.info(`Redirecting selection from User to fallback candidate: ${candidate}`);
                                selection = candidate;
                                fallbackFound = true;
                                break;
                            }
                        }

                        // Parse Top 3 from response to find an alternative (Legacy disabled)
                        const top3Match = null; // response.match(/\[Top 3:\s*(.*?)\]/i);
                        // let fallbackFound = false; // Declared above

                        if (top3Match && top3Match[1]) {
                            // Split by comma, trim whitespace and punctuation
                            const candidates = top3Match[1].split(',').map(s => s.trim().replace(/['"\x60\.]*$/, ''));

                            for (const candidate of candidates) {
                                // Ignore if candidate is empty or is the user
                                if (candidate && candidate.toLowerCase() !== userCharName.toLowerCase()) {
                                    console.info(`Redirecting selection from User to fallback candidate: ${candidate}`);
                                    selection = candidate;
                                    fallbackFound = true;
                                    break;
                                }
                            }
                        }

                        if (!fallbackFound) {
                            console.warn("No valid fallback found in Top 3. Aborting.");
                            // Return null to stop generation
                            return null;
                        }
                    }

                    if (!selection) {
                        UIManager.showNotification("Scriptwriter could not determine next speaker.", "error");
                        return null;
                    }

                    console.log(`Scriptwriter selected: ${selection}`);

                    // 5. Resolve Selection to ID
                    // Try exact match
                    let targetChar = [...state.characters, ...ReactiveStore.getActiveLocationCharacters()].find(c => c.name.toLowerCase() === selection.toLowerCase());

                    if (!targetChar) {
                        // Unlisted Character Logic
                        // Verify it's not a user error (fuzzy match?)
                        // For now, strict creation as per plan

                        const aiCount = state.characters.filter(c => !c.is_user).length;
                        const color = this.CONSTANTS.CHARACTER_COLORS[aiCount % this.CONSTANTS.CHARACTER_COLORS.length];

                        targetChar = {
                            id: UTILITY.uuid(),
                            name: selection, // Original casing
                            description: "A character in the scene.",
                            short_description: "Unlisted character",
                            model_instructions: "", // Default prompt applies
                            image_url: "",
                            extra_portraits: [],
                            tags: ["unlisted"],
                            is_user: false,
                            is_active: false, // Keep them inactive so they don't flood the selector? 
                            // Actually, if they speak, they become part of history. 
                            // User might want to adopt them.
                            color: color,
                            is_narrator: false
                        };

                        state.characters.push(targetChar);
                        await ReactiveStore.forceSave(); // Persist immediately

                        UIManager.showNotification(`New character '${selection}' entered the scene.`, "info");
                    }

                    return targetChar.id;

                } catch (error) {
                    console.error("Scriptwriter Error:", error);
                    UIManager.showNotification("Error determining next speaker.", "error");
                    return null;
                } finally {
                    UIManager.hideTypingIndicator(); // Ensure bubble is removed
                }
            },

            /**
             * Swarm-specific variant of the Scriptwriter call.
             * Evaluates the active pool to return up to 3 candidate character *objects*
             * AND explicitly identifies which ONE of those candidates should be the primary speaker.
             * @param {string} userAction - The current user input/action to inform casting.
             * @returns {Promise<{candidates: Object[], primarySpeaker: Object}>}
             */
            async determineSwarmSpeakerAndCandidates(userAction = "") {
                const state = ReactiveStore.state;
                const pool = [...(state.characters || []), ...ReactiveStore.getActiveLocationCharacters()]
                    .filter(c => !c.is_user && !c.is_narrator && c.is_active);

                // Recency fallback generic logic
                const recentIds = [...(state.chat_history || [])]
                    .filter(m => m && m.type === 'chat')
                    .reverse()
                    .map(m => m.character_id);
                const sortedByRecency = [...pool].sort((a, b) => {
                    const ai = recentIds.indexOf(a.id);
                    const bi = recentIds.indexOf(b.id);
                    return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
                });

                const narrators = state.characters.filter(c => c.is_narrator && c.is_active);

                // Skip the LLM call if the pool is empty
                if (pool.length === 0 && narrators.length === 0) {
                    return { candidates: [], primarySpeaker: null };
                }

                if (pool.length === 0 && narrators.length > 0) {
                    return { candidates: [], primarySpeaker: narrators[0] };
                }

                if (pool.length <= 1 && narrators.length === 0) {
                    return { candidates: pool, primarySpeaker: pool[0] };
                }

                UIManager.showTypingIndicator(null, '...', 'Casting...');

                try {
                    const prompt = PromptBuilder.buildSwarmCastingPrompt(pool, narrators, userAction, state);
                    console.log("[Swarm Casting Prompt]:", prompt);
                    const response = await APIService.callAI(prompt, false);
                    console.log("[Swarm Casting Response]:", response);

                    // 4. Parse Selection
                    let candidatesNames = [];
                    let primarySpeakerName = null;

                    const candidatesMatch = response.match(/\[CANDIDATES\]:\s*(.*)/i);
                    if (candidatesMatch && candidatesMatch[1]) {
                        candidatesNames = candidatesMatch[1].split(',').map(s => s.trim().replace(/['"\x60\.]*$/, ''));
                    }

                    const primaryMatch = response.match(/\[PRIMARY SPEAKER\]:\s*(.*)/i);
                    if (primaryMatch && primaryMatch[1]) {
                        primarySpeakerName = primaryMatch[1].trim().replace(/['"\x60\.]*$/, '');
                    }

                    // Fallback to JSON
                    const data = UTILITY.extractAndParseJSON(response);
                    if (data) {
                        if (!primarySpeakerName) primarySpeakerName = data.primary_speaker;
                        if (candidatesNames.length === 0 && Array.isArray(data.top_3_candidates)) {
                            candidatesNames = data.top_3_candidates;
                        }
                    }

                    if (candidatesNames.length > 0 && primarySpeakerName) {
                        const candidates = candidatesNames
                            .slice(0, 3)
                            .map(name => pool.find(c => c.name.toLowerCase() === name.toLowerCase()))
                            .filter(Boolean); // drop any unresolved names

                        const matchedNarrator = narrators.find(n => n.name.toLowerCase() === primarySpeakerName.toLowerCase());
                        const primarySpeaker = matchedNarrator || pool.find(c => c.name.toLowerCase() === primarySpeakerName.toLowerCase()) || candidates[0];

                        if (primarySpeaker) {
                            console.log(`[Swarm Casting] Scriptwriter selected ${candidates.length} candidate(s), Speaker: ${primarySpeaker.name}`);
                            return { candidates, primarySpeaker };
                        }
                    }

                    console.warn('[Swarm Casting] Scriptwriter parse failed. Using recency fallback.');
                } catch (e) {
                    console.warn('[Swarm Casting] Scriptwriter call failed. Using recency fallback:', e.message);
                } finally {
                    UIManager.hideTypingIndicator();
                }

                // Recency fallback
                const candidates = sortedByRecency.slice(0, 3);
                return { candidates, primarySpeaker: candidates[0] };
            },

            /**
             * Analyzes a text turn for emotion, location changes, and stat changes.
             * Builds a single holistic JSON prompt. The location section is omitted
             * entirely when the world map has no named locations, preventing noise.
             * @param {string} text - The text to analyze.
             * @param {string} [charId] - Optional character ID to constrain emotions.
             * @returns {Promise<Object>} - { emotion, locationName, stat_changes, inventory_changes, quest_changes, relationship_changes }
             */
            async analyzeTurn(text, charId = null) {
                const state = ReactiveStore.state;

                // 1. Check Toggle
                if (state.enableAnalysis === false) {
                    return {
                        emotion: 'neutral',
                        locationName: null,
                        stat_changes: [],
                        inventory_changes: [],
                        quest_changes: [],
                        relationship_changes: []
                    };
                }

                // 1.5 Build current state context
                let currentStateContext = '';
                if (state.gameState && state.enableJournal !== false) {
                    const inv = (state.gameState.resources || []).map(r => `- ${r.name}: Qty ${r.value}`).join('\n') || 'None';
                    const activeQuests = (state.gameState.journal || []).filter(q => q.status === 'active');
                    const quests = activeQuests.map(q => `- ${q.title} (Current Objective: ${q.objective || 'None'})`).join('\n') || 'None';
                    const relationships = (state.gameState.relationships || []).map(r => `- ${r.characterName} (${r.track || 'Affection'}): ${r.value}%`).join('\n') || 'None';

                    currentStateContext = `### Current Game State
- Current Inventory:
${inv}

- Current Active Quests:
${quests}

- Current Character Relationships:
${relationships}
`;
                }

                // 2. Context-Aware Location List (Current cell + adjacent cells)
                const grid = state.worldMap?.grid || [];
                const currentCoords = state.worldMap?.currentLocation;
                let validLocations = [];

                if (currentCoords) {
                    const cur = grid.find(l => l.coords.x === currentCoords.x && l.coords.y === currentCoords.y);
                    if (cur) validLocations.push(cur.name);
                    for (let dx = -1; dx <= 1; dx++) {
                        for (let dy = -1; dy <= 1; dy++) {
                            if (dx === 0 && dy === 0) continue;
                            const adj = grid.find(l => l.coords.x === currentCoords.x + dx && l.coords.y === currentCoords.y + dy);
                            if (adj && adj.name) validLocations.push(adj.name);
                        }
                    }
                }
                if (validLocations.length === 0) validLocations = grid.map(l => l.name);
                validLocations = [...new Set(validLocations)].filter(Boolean);

                // Only ask about locations if the map has actual named locations.
                const hasLocations = validLocations.length > 0;
                const locStr = validLocations.join(', ');

                // 3. Constrain Emotions to portraits that exist for this character
                let validEmotions = ['happy', 'sad', 'angry', 'surprised', 'neutral', 'fear', 'disgust', 'blush'];
                const targetChar = charId ? ReactiveStore.getCharacter(charId) : null;
                const targetCharName = targetChar ? targetChar.name : 'the character';
                if (targetChar) {
                    const hasImages = ['neutral'];
                    if (targetChar.extra_portraits) {
                        targetChar.extra_portraits.forEach(p => {
                            if (p.emotion) hasImages.push(p.emotion.toLowerCase());
                        });
                    }
                    validEmotions = [...new Set(hasImages)];
                }
                const emoStr = validEmotions.map(e => `"${e}"`).join(' | ');

                // 4. Build stat context (conditional)
                let hasStats = false;
                let statsContext = '';
                if (state.enableStats !== false && state.character_stats) {
                    const statsLines = [];
                    Object.keys(state.character_stats).forEach(cId => {
                        const char = ReactiveStore.getCharacter(cId);
                        const cName = char ? char.name : 'Unknown';
                        const charStats = state.character_stats[cId];
                        if (charStats && charStats.length > 0) {
                            const cStatsStr = charStats.map(s => `${s.name}${s.description ? ' (' + s.description + ')' : ''}: ${Math.round(s.value)}`).join(', ');
                            statsLines.push(`- ${cName}: ${cStatsStr}`);
                        }
                    });
                    if (statsLines.length > 0) {
                        statsContext = statsLines.join('\n');
                        hasStats = true;
                    }
                }

                // Build character names context for relationships
                const validCharNames = state.characters ? state.characters.map(c => c.name).join(', ') : '';

                try {
                    let taskNum = 1;
                    const formatRequirements = [
                        `### Emotion\n<one of these exact values: ${emoStr}>`
                    ];
                    const taskLines = [`${taskNum++}. Identify the primary emotion of ${targetCharName} in the text. If ${targetCharName} is not present or has no clear emotion, output 'neutral'.`];

                    if (hasLocations) {
                        formatRequirements.push(`### Location\n<one of [${locStr}], or null>`);
                        taskLines.push(`${taskNum++}. Specify the location if the text explicitly describes moving to a location from the list. If no movement is described, output null.`);
                    }

                    if (hasStats) {
                        formatRequirements.push(`### Stats\n<character_name>|<stat_name>|<delta>\n<character_name>|<stat_name>|<delta>`);
                        taskLines.push(`${taskNum++}. Output any stats that changed due to the actions in the text (e.g. Thorne|Health|-5). Characters and stats: \n${statsContext}\nFormat as character_name|stat_name|delta. If none changed, leave it blank.`);
                    }

                    if (state.enableJournal !== false) {
                        // Inventory Task
                        formatRequirements.push(`### Inventory\n<item_name>|<delta>\n<item_name>|<delta>`);
                        taskLines.push(`${taskNum++}. Identify any items obtained or lost in the TEXT. Format as item name and integer change (e.g., Gold|10 or Key|-1). Reference the Current Inventory to avoid duplicate updates. Leave blank if no inventory changes.`);

                        // Quests Task
                        formatRequirements.push(`### Quests\n<action>|<quest_title>|<objective>\n<action>|<quest_title>|<objective>`);
                        taskLines.push(`${taskNum++}. Identify quest changes (action: 'start', 'update', 'complete', 'fail'). If starting or updating, specify the objective. Format as action|quest_title|objective. CRITICAL: Do NOT create quests that replicate relationship changes or character feelings. Reference the Current Active Quests list to update existing quests rather than starting duplicates. Leave blank if no quest changes.`);

                        // Relationships Task
                        formatRequirements.push(`### Relationships\n<character_name>|<track>|<change_value>\n<character_name>|<track>|<change_value>`);
                        taskLines.push(`${taskNum++}. Identify changes in character relationships (feelings, trust, standing, affection). Track defaults to 'Affection'. Format as character_name|track|change_value. Story characters: ${validCharNames}. Leave blank if no changes.`);
                    }

                    const prompt = `You are an analysis engine. Analyze the TEXT.

${currentStateContext}

### Tasks
${taskLines.join('\n')}

You MUST format your response using EXACTLY these headings:

${formatRequirements.join('\n\n')}

### Text
"${text}"`;

                    console.log('[AnalyzeTurn Prompt]:', prompt);
                    const res = await APIService.callAI(prompt, false);
                    console.log('[AnalyzeTurn Response]:', res);

                    const data = UTILITY.extractStructuredHeadings(res, ['Emotion', 'Location', 'Stats', 'Inventory', 'Quests', 'Relationships']);
                    let emotionRaw = typeof data['Emotion'] === 'string' ? data['Emotion'].toLowerCase().trim() : 'neutral';
                    const emotion = validEmotions.includes(emotionRaw) ? emotionRaw : 'neutral';

                    const parseLines = (textBlock, parserFn) => {
                        if (!textBlock || typeof textBlock !== 'string') return [];
                        return textBlock.split('\n')
                            .map(line => line.trim())
                            .filter(line => line && !line.match(/^(none|no change|n\/a|no updates)/i))
                            .map(line => parserFn(line))
                            .filter(Boolean);
                    };

                    let statChanges = [];
                    if (data['Stats'] && typeof data['Stats'] === 'string') {
                        statChanges = parseLines(data['Stats'], (line) => UTILITY.parseStatLine(line))
                            .filter(s => s.delta !== 0);
                    }

                    let inventoryChanges = [];
                    if (state.enableJournal !== false && data['Inventory'] && typeof data['Inventory'] === 'string') {
                        inventoryChanges = parseLines(data['Inventory'], (line) => UTILITY.parseInventoryLine(line))
                            .filter(i => i.name && i.delta !== 0);
                    }

                    let questChanges = [];
                    if (state.enableJournal !== false && data['Quests'] && typeof data['Quests'] === 'string') {
                        questChanges = parseLines(data['Quests'], (line) => UTILITY.parseQuestLine(line))
                            .filter(q => {
                                if (!q.title) return false;
                                // Filter out quests replicating character names
                                const characters = (state.characters || []);
                                if (characters.some(c => c.name.toLowerCase() === q.title.toLowerCase())) {
                                    console.warn('[AnalyzeTurn] Filtered out quest replicating character name:', q.title);
                                    return false;
                                }
                                return true;
                            });
                    }

                    let relationshipChanges = [];
                    if (state.enableJournal !== false && data['Relationships'] && typeof data['Relationships'] === 'string') {
                        relationshipChanges = parseLines(data['Relationships'], (line) => UTILITY.parseRelationshipLine(line))
                            .filter(r => r.charName && r.changeVal !== 0);
                    }

                    let locationNameRaw = typeof data['Location'] === 'string' ? data['Location'].trim() : null;
                    if (locationNameRaw && locationNameRaw.toLowerCase() === 'null') locationNameRaw = null;

                    return {
                        emotion,
                        locationName: hasLocations ? locationNameRaw : null,
                        stat_changes: statChanges,
                        inventory_changes: inventoryChanges,
                        quest_changes: questChanges,
                        relationship_changes: relationshipChanges
                    };
                } catch (e) {
                    console.warn('[AnalyzeTurn] Failed:', e);
                    return {
                        emotion: 'neutral',
                        locationName: null,
                        stat_changes: [],
                        inventory_changes: [],
                        quest_changes: [],
                        relationship_changes: []
                    };
                }
            },

            /**
             * Applies all results from a turn analysis (location changes, stat changes, and journal updates).
             * @param {string|null} charId - The character ID associated with the turn.
             * @param {Object} analysis - The parsed analysis object.
             */
            applyAnalysisResults(charId, analysis) {
                if (!analysis) return;
                const state = ReactiveStore.state;

                // 1. Apply location changes
                if (analysis.locationName && typeof WorldController !== 'undefined') {
                    const grid = state.worldMap?.grid || [];
                    const target = grid.find(l => l.name.toLowerCase() === analysis.locationName.toLowerCase());
                    const current = grid.find(l => l.coords.x === state.worldMap.currentLocation.x && l.coords.y === state.worldMap.currentLocation.y);

                    if (target && target.name !== current?.name) {
                        setTimeout(() => WorldController.moveToLocation(target.coords.x, target.coords.y), 1500);
                    }
                }

                // 2. Apply stat changes
                if (analysis.stat_changes && analysis.stat_changes.length > 0) {
                    const changesByChar = {};
                    analysis.stat_changes.forEach(change => {
                        let targetCharId = null;
                        if (change.charName) {
                            const char = state.characters.find(c => c.name.toLowerCase().includes(change.charName.toLowerCase()));
                            if (char) targetCharId = char.id;
                        }
                        if (!targetCharId) targetCharId = charId; // fallback

                        if (targetCharId) {
                            if (!changesByChar[targetCharId]) changesByChar[targetCharId] = [];
                            changesByChar[targetCharId].push({ name: change.name, delta: change.delta });
                        }
                    });

                    Object.keys(changesByChar).forEach(targetCharId => {
                        this.applyStatChanges(targetCharId, changesByChar[targetCharId]);
                    });
                }

                // 3. Apply journal changes (inventory, quests, relationships) via InventoryController
                if (state.enableJournal !== false && typeof InventoryController !== 'undefined' && typeof InventoryController.applyJournalChanges === 'function') {
                    InventoryController.applyJournalChanges(
                        analysis.inventory_changes,
                        analysis.quest_changes,
                        analysis.relationship_changes
                    );
                }
            },

            // --- Stats System ---

            /**
             * Initializes character stats via an AI call.
             * Called when a narrative is loaded and has no existing stats.
             */
            async initializeStats() {
                const state = ReactiveStore.state;
                if (state.enableStats === false) return;
                if (state.character_stats && Object.keys(state.character_stats).length > 0) return;

                // Don't init if no model configured
                if (!this._isModelConfigured(state)) return;

                const chars = (state.characters || []).filter(c => !c.is_narrator);
                if (chars.length === 0) return;

                console.log('[Stats] Initializing stats for', chars.length, 'characters...');

                try {
                    // Build context from static entries and characters
                    const staticLore = (state.static_entries || []).map(e => `${e.title}: ${e.content}`).join('\n');
                    const charDescriptions = chars.map(c => `${c.name}: ${c.short_description || c.description || 'No description'}`).join('\n');
                    const context = `LORE:\n${staticLore}`;

                    let promptTemplate = state.prompt_stats_init || UTILITY.getDefaultSystemPrompts().prompt_stats_init;
                    let prompt = promptTemplate.replace('{context}', context).replace('{characters}', charDescriptions);

                    const response = await APIService.callAI(prompt, true, null, true);
                    const data = UTILITY.extractAndParseJSON(response);

                    // Support both new format (stats: [{name, description}]) and legacy (stat_names: [])
                    if (!data) return;
                    const statDefs = data.stats || (data.stat_names ? data.stat_names.map(n => ({ name: n, description: '' })) : null);
                    if (!statDefs || !data.characters) {
                        console.warn('[Stats] AI returned invalid stats format:', data);
                        return;
                    }

                    // Build character_stats object keyed by character ID
                    const characterStats = {};

                    for (const char of chars) {
                        // Try to match character name from AI response
                        const aiValues = data.characters[char.name];
                        if (aiValues && Array.isArray(aiValues)) {
                            characterStats[char.id] = statDefs.map((stat, i) => ({
                                name: stat.name,
                                description: stat.description || '',
                                value: Math.max(0, Math.min(100, aiValues[i] || 50)),
                                max: 100
                            }));
                        } else {
                            // Fallback: Assign default values if AI didn't return for this char
                            characterStats[char.id] = statDefs.map(stat => ({
                                name: stat.name,
                                description: stat.description || '',
                                value: 50,
                                max: 100
                            }));
                        }
                    }

                    state.character_stats = characterStats;
                    await ReactiveStore.forceSave();
                    this.renderStatsPanel();
                    console.log('[Stats] Initialized successfully:', characterStats);
                } catch (e) {
                    const isNetworkError = e instanceof TypeError || (e.message && e.message.toLowerCase().includes('failed to fetch'));
                    if (isNetworkError) {
                        console.warn('[Stats] Initialization skipped: AI provider is offline/unreachable.');
                    } else {
                        console.error('[Stats] Initialization failed:', e);
                    }
                }
            },

            /**
             * Applies stat changes (deltas) for a specific character.
             * Clamps values between 0 and max (default 100).
             * @param {string} charId - The character ID.
             * @param {Array} changes - Array of { name, delta } objects.
             */
            applyStatChanges(charId, changes) {
                if (!changes || changes.length === 0) return;
                const state = ReactiveStore.state;
                if (!state.character_stats || !state.character_stats[charId]) return;

                const charStats = state.character_stats[charId];
                const appliedDeltas = [];

                for (const change of changes) {
                    const stat = charStats.find(s => s.name.toLowerCase() === change.name.toLowerCase());
                    if (stat) {
                        const delta = Math.max(-10, Math.min(10, change.delta || 0));
                        if (delta !== 0) {
                            stat.value = Math.max(0, Math.min(stat.max || 100, stat.value + delta));
                            appliedDeltas.push({ name: stat.name, delta: delta });
                        }
                    }
                }

                if (appliedDeltas.length > 0) {
                    // Store last deltas in state for persistent display
                    if (!state.last_stat_deltas) state.last_stat_deltas = {};
                    state.last_stat_deltas[charId] = appliedDeltas;
                    this.renderStatsPanel();
                    console.log(`[Stats] Applied deltas for ${charId}:`, appliedDeltas);
                }
            },

            /**
             * Renders the stats panel into the DOM.
             * @param {Object} [deltas] - Optional recent deltas for animation, keyed by charId.
             */
            renderStatsPanel(deltas = {}) {
                const state = ReactiveStore.state;
                const container = document.getElementById('stats-panel-container');
                const btn = document.getElementById('stats-toggle-btn');
                if (!container) return;

                if (state.enableStats === false || !state.character_stats || Object.keys(state.character_stats).length === 0) {
                    container.classList.add('hidden');
                    container.innerHTML = '';
                    if (btn) btn.classList.add('hidden');
                    return;
                }

                if (btn) btn.classList.remove('hidden');

                // Always show last deltas persistently
                const persistedDeltas = state.last_stat_deltas || {};
                container.innerHTML = UIComponents.StatsPanel(state.character_stats, state.characters, persistedDeltas);
            },

            /**
             * Toggles the stats panel collapsed/expanded state.
             */
            toggleStatsPanel() {
                const container = document.getElementById('stats-panel-container');
                if (container) {
                    container.classList.toggle('hidden');
                }
            },

            // --- Character Management ---

            /**
             * Adds a new character (Blank) to the roster.
             */
            addCharacterBlank() {
                const aiCount = ReactiveStore.state.characters.filter(c => !c.is_user).length;
                const color = this.CONSTANTS.CHARACTER_COLORS[aiCount % this.CONSTANTS.CHARACTER_COLORS.length];

                const newChar = {
                    id: UTILITY.uuid(), name: "New Character", description: "", short_description: "Summary",
                    model_instructions: "Write the next response for {character}.", image_url: "", extra_portraits: [],
                    tags: [], is_user: false, is_active: true, color: color, is_narrator: false,
                    dynamic_knowledge: []
                };

                ReactiveStore.state.characters.push(newChar);
                AppController.openModal('character-detail-modal', newChar.id);
            },

            /**
             * Opens the modal to generate a new character via AI.
             */
            openAIGenCharacterModal() {
                document.getElementById('ai-gen-char-name').value = '';
                document.getElementById('ai-gen-char-desc').value = '';
                AppController.openModal('ai-character-gen-modal');
            },

            /**
             * Submits the generation request from the AI Character Gen Modal.
             */
            async submitAIGenCharacter() {
                const nameInput = document.getElementById('ai-gen-char-name').value.trim();
                const descInput = document.getElementById('ai-gen-char-desc').value.trim();

                if (!nameInput) {
                    UIManager.showNotification("Character name is required.", "error");
                    return;
                }

                AppController.closeModal('ai-character-gen-modal');
                UIManager.showLoadingSpinner(`Generating profile for ${nameInput}...`);

                try {
                    let contextString = `This character's name is ${nameInput}.`;
                    if (descInput) {
                        contextString += `\nConcept/Description: ${descInput}`;
                    }

                    // Incorporate current story context
                    const state = ReactiveStore.state;
                    const prompts = StateManager.data?.globalSettings?.storyPrompts || [];
                    const storyContext = `
                    Story Genre/Setting: ${prompts.find(p => p.id === state.genre)?.content || 'General Roleplay'}
                    Current Location: ${state.worldMap?.currentLocation ? state.worldMap.grid.find(t => t.x === state.worldMap.currentLocation.x && t.y === state.worldMap.currentLocation.y)?.description : 'Unknown'}
                    `;

                    contextString += `\nAdditional World Context:\n${storyContext}`;

                    const charData = await this.generateCharacterProfile(nameInput, contextString);

                    const aiCount = ReactiveStore.state.characters.filter(c => !c.is_user).length;
                    const color = this.CONSTANTS.CHARACTER_COLORS[aiCount % this.CONSTANTS.CHARACTER_COLORS.length];

                    const charId = UTILITY.uuid();
                    let imageUrl = '';
                    let baseBlob = null;

                    // Auto-Image Gen (Base Portrait)
                    try {
                        UIManager.showLoadingSpinner(`Generating portrait for ${nameInput}...`);
                        const imagePrompt = `portrait of ${nameInput}, ${charData.short_description || charData.description}, ${charData.tags ? charData.tags.join(', ') : ''}, detailed face, fantasy art, masterpiece`;
                        baseBlob = await ImageGenerationService.generateImage(imagePrompt);
                        if (baseBlob) {
                            await DBService.saveImage(charId, baseBlob);
                            imageUrl = `local_idb_${charId}`;
                            UIManager.RUNTIME.characterImageCache[charId] = URL.createObjectURL(baseBlob);
                        }
                    } catch (err) { console.warn("Primary image fail", err); }

                    const extraPortraits = [];
                    // [NEW] Auto-Generate Emotional Portraits using I2I
                    if (baseBlob) {
                        const emotions = ['happy', 'sad', 'angry'];
                        for (const emotion of emotions) {
                            try {
                                UIManager.showLoadingSpinner(`Loading ${emotion} expression...`);
                                const emoPrompt = `portrait of ${nameInput} expressing ${emotion} emotion, ${emotion} facial expression`;
                                // Use I2I with relatively low denoising to maintain character identity
                                const emoBlob = await ImageGenerationService.generateImage(emoPrompt, "", { denoising_strength: 0.5 }, baseBlob);
                                if (emoBlob) {
                                    const emoKey = `${charId}::emotion::${emotion}`;
                                    await DBService.saveImage(emoKey, emoBlob);
                                    UIManager.RUNTIME.characterImageCache[emoKey] = URL.createObjectURL(emoBlob);
                                    extraPortraits.push({ emotion: emotion, url: '' }); // url is empty since it's in IDB
                                }
                            } catch (err) { console.warn(`Emotion ${emotion} fail`, err); }
                        }
                    }

                    const newChar = {
                        id: charId,
                        name: nameInput,
                        description: charData.description || "",
                        short_description: charData.short_description || "Summary",
                        appearance: charData.appearance || "",
                        model_instructions: charData.model_instructions || `Write the next response for ${nameInput}.`,
                        image_url: imageUrl,
                        color: color,
                        is_narrator: false,
                        dynamic_knowledge: []
                    };

                    ReactiveStore.state.characters.push(newChar);
                    AppController.openModal('character-detail-modal', newChar.id);
                    UIManager.showNotification(`Created character: ${nameInput}`, "success");

                } catch (e) {
                    console.error("AI Character Gen Failed:", e);
                    UIManager.showNotification("Failed to generate character.", "error");
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Opens the modal to select existing characters from other stories.
             */
            async openExistingCharacterModal() {
                const container = document.getElementById('existing-character-list');
                const loading = document.getElementById('existing-character-loading');
                const empty = document.getElementById('existing-character-empty');
                const countSpan = document.getElementById('existing-character-selected-count');

                container.innerHTML = '';
                loading.classList.remove('hidden');
                empty.classList.add('hidden');
                countSpan.textContent = '0';

                // Store selected IDs temporarily
                this._selectedExistingChars = new Set();

                AppController.openModal('roster-existing-character-modal');

                try {
                    const allStories = await DBService.getAllStories();
                    const currentStoryId = ReactiveStore.state.id;
                    const charDataList = [];

                    for (const story of allStories) {
                        if (story.id === currentStoryId) continue; // Skip current story
                        if (!story.characters) continue;

                        for (const char of story.characters) {
                            if (char.is_user) continue; // Skip user personas

                            let imgDataUrl = null;
                            if (char.image_url && char.image_url.startsWith('local_idb_')) {
                                try {
                                    const blob = await DBService.getImage(char.id);
                                    if (blob) imgDataUrl = URL.createObjectURL(blob);
                                } catch (e) {
                                    console.warn(`Could not load image for ${char.name}`, e);
                                }
                            }
                            charDataList.push({ char, storyName: story.name, imgDataUrl });
                        }
                    }

                    loading.classList.add('hidden');

                    if (charDataList.length === 0) {
                        empty.classList.remove('hidden');
                        return;
                    }

                    charDataList.sort((a, b) => a.char.name.localeCompare(b.char.name));

                    charDataList.forEach(data => {
                        const card = document.createElement('div');
                        card.className = "bg-gray-700/50 rounded-lg p-3 cursor-pointer border-2 border-transparent hover:border-gray-500 transition-colors flex flex-col gap-2 relative overflow-hidden group";
                        card.dataset.id = data.char.id;

                        // Selection toggle logic
                        card.onclick = () => {
                            if (this._selectedExistingChars.has(data.char.id)) {
                                this._selectedExistingChars.delete(data.char.id);
                                card.classList.remove('border-indigo-500', 'bg-indigo-900/30');
                                card.classList.add('border-transparent', 'bg-gray-700/50');
                            } else {
                                this._selectedExistingChars.add(data.char.id);
                                card.classList.remove('border-transparent', 'bg-gray-700/50');
                                card.classList.add('border-indigo-500', 'bg-indigo-900/30');
                            }
                            countSpan.textContent = this._selectedExistingChars.size;
                        };

                        let imgHTML = `<div class="w-full aspect-square bg-gray-800 rounded flex items-center justify-center text-gray-500 text-3xl font-bold flex-shrink-0">${data.char.name.charAt(0)}</div>`;
                        if (data.imgDataUrl) {
                            imgHTML = `<div class="w-full aspect-square rounded bg-cover bg-center flex-shrink-0" style="background-image: url('${UTILITY.safeStyleUrl(data.imgDataUrl)}')"></div>`;
                        }

                        card.innerHTML = DOM.html`
                            ${DOM.unsafe(imgHTML)}
                            <div class="flex flex-col flex-grow min-h-0">
                                <div class="font-bold text-white text-sm truncate" title="${data.char.name}">${data.char.name}</div>
                                <div class="text-xs text-gray-400 truncate" title="From: ${data.storyName}">From: ${data.storyName}</div>
                                <div class="text-xs text-gray-300 mt-1 line-clamp-2 italic" title="${data.char.short_description || ''}">${data.char.short_description || ''}</div>
                            </div>
                        `.toString();

                        // CSS hack for parent selector to style checkbox
                        if (this._selectedExistingChars.has(data.char.id)) {
                            card.classList.remove('border-transparent', 'bg-gray-700/50');
                            card.classList.add('border-indigo-500', 'bg-indigo-900/30');
                        }

                        container.appendChild(card);
                    });

                    // Search functionality
                    const searchInput = document.getElementById('existing-character-search');
                    if (searchInput) {
                        searchInput.value = '';
                        searchInput.oninput = (e) => {
                            const term = e.target.value.toLowerCase();
                            Array.from(container.children).forEach(card => {
                                const name = card.querySelector('.font-bold').textContent.toLowerCase();
                                const story = card.querySelector('.text-xs.text-gray-400').textContent.toLowerCase();
                                const desc = card.querySelector('.italic').textContent.toLowerCase();

                                if (name.includes(term) || story.includes(term) || desc.includes(term)) {
                                    card.style.display = '';
                                } else {
                                    card.style.display = 'none';
                                }
                            });
                        };
                    }

                    // Store raw data for import
                    this._existingCharsData = charDataList;

                } catch (e) {
                    console.error("Failed to load existing characters:", e);
                    loading.classList.add('hidden');
                    empty.classList.remove('hidden');
                    empty.textContent = "Error loading characters.";
                }
            },

            /**
             * Copies the selected existing characters into the current story roster.
             */
            async copySelectedExistingCharacters() {
                if (!this._selectedExistingChars || this._selectedExistingChars.size === 0) {
                    UIManager.showNotification("No characters selected.", "info");
                    return;
                }

                AppController.closeModal('roster-existing-character-modal');
                UIManager.showLoadingSpinner(`Importing ${this._selectedExistingChars.size} characters...`);

                try {
                    let importCount = 0;

                    for (const charId of this._selectedExistingChars) {
                        const dataMatch = this._existingCharsData.find(d => d.char.id === charId);
                        if (!dataMatch) continue;

                        const ogChar = dataMatch.char;
                        const newId = UTILITY.uuid();

                        let newImageUrl = "";
                        if (ogChar.image_url && ogChar.image_url.startsWith('local_idb_')) {
                            try {
                                const blob = await DBService.getImage(ogChar.id);
                                if (blob) {
                                    await DBService.saveImage(newId, blob);
                                    newImageUrl = `local_idb_${newId}`;
                                    UIManager.RUNTIME.characterImageCache[newId] = URL.createObjectURL(blob);
                                }
                            } catch (e) {
                                console.warn(`Failed to copy image for ${ogChar.name}`, e);
                            }
                        }

                        const newChar = {
                            id: newId,
                            name: ogChar.name,
                            description: ogChar.description || "",
                            short_description: ogChar.short_description || "Summary",
                            model_instructions: ogChar.model_instructions || `Write the next response for ${ogChar.name}.`,
                            image_url: newImageUrl,
                            extra_portraits: ogChar.extra_portraits ? JSON.parse(JSON.stringify(ogChar.extra_portraits)) : [],
                            tags: ogChar.tags ? [...ogChar.tags] : [],
                            is_user: false,
                            is_active: true,
                            color: ogChar.color || { base: '#4b5563', bold: '#e5e7eb' },
                            is_narrator: false
                        };

                        newChar.extra_portraits = [];

                        ReactiveStore.state.characters.push(newChar);
                        importCount++;
                    }

                    UIManager.renderCharacters();
                    UIManager.showNotification(`Imported ${importCount} characters successfully.`, "success");

                } catch (e) {
                    console.error("Failed to copy characters:", e);
                    UIManager.showNotification("Error importing characters.", "error");
                } finally {
                    UIManager.hideLoadingSpinner();
                    // Cleanup memory
                    if (this._existingCharsData) {
                        this._existingCharsData.forEach(d => {
                            if (d.imgDataUrl) URL.revokeObjectURL(d.imgDataUrl);
                        });
                        this._existingCharsData = null;
                        this._selectedExistingChars = null;
                    }
                }
            },

            /**
             * Opens the modal to select a User Persona for the current story.
             */
            openUserPersonaModal() {
                const container = document.getElementById('roster-user-persona-list');
                const empty = document.getElementById('roster-user-persona-empty');
                const personas = StateManager.data.globalSettings.userPersonas || [];

                container.innerHTML = '';

                if (personas.length === 0) {
                    empty.classList.remove('hidden');
                    AppController.openModal('roster-user-character-modal');
                    return;
                }

                empty.classList.add('hidden');

                personas.forEach(async (persona) => {
                    const card = document.createElement('div');
                    card.className = "bg-gray-700/50 rounded-lg p-4 cursor-pointer hover:bg-gray-600 transition-colors flex items-center gap-4 border border-gray-600 hover:border-indigo-400";

                    card.onclick = () => {
                        AppController.closeModal('roster-user-character-modal');
                        AppController.applyUserPersonaToCurrentStory(persona.id);
                    };

                    let imgHTML = `<div class="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center text-gray-500 text-xl font-bold flex-shrink-0">${persona.name.charAt(0)}</div>`;

                    if (persona.image_url && persona.image_url.startsWith('local_idb_')) {
                        try {
                            const blob = await DBService.getImage(persona.id);
                            if (blob) {
                                const url = URL.createObjectURL(blob);
                                imgHTML = `<div class="w-16 h-16 rounded-full bg-cover bg-center flex-shrink-0 shadow-md" style="background-image: url('${UTILITY.safeStyleUrl(url)}')"></div>`;
                            }
                        } catch (e) {
                            console.warn("Could not load persona image.");
                        }
                    }

                    card.innerHTML = `
                        ${imgHTML}
                        <div class="flex flex-col flex-grow min-h-0 justify-center">
                            <div class="font-bold text-white text-lg truncate">${persona.name}</div>
                            <div class="text-sm text-gray-300 italic line-clamp-2">${persona.short_description || 'No description'}</div>
                        </div>
                    `;
                    container.appendChild(card);
                });

                AppController.openModal('roster-user-character-modal');
            },

            /**
             * Deletes a character by ID.
             * @param {string} id - The character ID.
             */
            deleteCharacter(id) {
                UIManager.showConfirmationModal('Delete this character?', () => {
                    ReactiveStore.state.characters = ReactiveStore.state.characters.filter(c => c.id !== id);
                    DBService.deleteImage(id);
                    AppController.closeModal('character-detail-modal');
                });
            },

            /**
             * Deletes the primary image of a character.
             * @param {string} charId - The character ID.
             */
            deleteCharacterImage(charId) {
                UIManager.showConfirmationModal('Delete primary portrait?', async () => {
                    const char = ReactiveStore.getCharacter(charId);
                    if (char) {
                        const legacyUrl = char.image_url;
                        char.image_url = '';
                        await DBService.deleteImage(charId);

                        // If there was a legacy random ID stored here, delete that too from DB to prevent orphans
                        if (legacyUrl && legacyUrl.startsWith('local_idb_')) {
                            const legacyKey = legacyUrl.replace('local_idb_', '');
                            if (legacyKey !== charId) {
                                await DBService.deleteImage(legacyKey);
                            }
                        }

                        if (UIManager.RUNTIME.characterImageCache[charId]) {
                            if (UIManager.RUNTIME.characterImageCache[charId].startsWith('blob:')) {
                                URL.revokeObjectURL(UIManager.RUNTIME.characterImageCache[charId]);
                            }
                            delete UIManager.RUNTIME.characterImageCache[charId];
                        }
                        ReactiveStore.forceSave();
                        UIManager.openCharacterDetailModal(charId);
                        UIManager.renderCharacters();
                    }
                });
            },

            /**
             * Quickly creates a new character using AI based on a name and context.
             */
            async quickCreateCharacter() {
                const state = ReactiveStore.state;
                if (!state || !state.chat_history) {
                    alert("Please load a story first.");
                    return;
                }

                // 1. Get the name
                const name = await UTILITY.customPrompt("Who would you like to create? Enter a name mentioned in the story:", "", "Character Name");
                if (!name || name.trim() === "") return;

                UIManager.showLoadingSpinner(`Dreaming up ${name}...`);

                try {
                    // 2. Gather Context (Last 30 messages + World Info)
                    const recentHistory = state.chat_history
                        .slice(-30)
                        .filter(m => m.type === 'chat' && !m.isHidden)
                        .map(m => {
                            const char = ReactiveStore.getCharacter(m.character_id);
                            return `${char ? char.name : 'Unknown'}: ${m.content}`;
                        })
                        .join('\n');
                    const staticLore = (state.static_entries || []).map(e => `${e.title}: ${e.content}`).join('\n');

                    const context = `### Lore\n${staticLore}\n\n### Recent Chat\n${recentHistory}`;

                    // 3. Call Shared Generator
                    const data = await this.generateCharacterProfile(name, context);

                    if (!data) throw new Error("AI returned invalid JSON or failed to generate profile.");

                    // 4. Create Character Object
                    const aiCount = state.characters.filter(c => !c.is_user).length;

                    // Use AI-suggested color or cycle through defaults
                    const color = data.color_hex
                        ? { base: data.color_hex, bold: '#ffffff' }
                        : this.CONSTANTS.CHARACTER_COLORS[aiCount % this.CONSTANTS.CHARACTER_COLORS.length];

                    const newChar = {
                        id: UTILITY.uuid(),
                        name: name.trim(),
                        description: data.description || "A mysterious character.",
                        short_description: data.short_description || "A new character.",
                        appearance: data.appearance || "",
                        model_instructions: data.model_instructions || `Write the next response for ${name}.`,
                        image_url: "",
                        extra_portraits: [],
                        tags: data.tags || [],
                        is_user: false,
                        is_active: true,
                        color: color,
                        is_narrator: false,
                        dynamic_knowledge: []
                    };

                    // 5. Save and Open
                    state.characters.push(newChar);
                    await ReactiveStore.forceSave(); // Ensure persistence

                    UIManager.hideLoadingSpinner();
                    UIManager.renderCharacters();

                    // Open the detail modal so user can refine it
                    AppController.openModal('character-detail-modal', newChar.id);

                } catch (error) {
                    UIManager.hideLoadingSpinner();
                    console.error("Quick Create failed:", error);
                    alert(`Failed to generate character: ${error.message}`);
                }
            },

            /**
             * Updates a specific field of a character (debounced).
             * @param {string} id - The character ID.
             * @param {string} field - The field to update.
             * @param {string} value - The new value.
             */
            updateCharacterField: debounce(function (id, field, value) {
                const char = ReactiveStore.getCharacter(id);
                if (char) {
                    char[field] = value;
                    if (field === 'name') { // Live update modal header
                        const header = document.querySelector(`#character-detail-modal-content h2[data-char-id="${id}"]`);
                        if (header) header.textContent = value;
                    }
                }
            }, 300),

            /**
             * Updates a character's tags (debounced).
             * @param {string} id - The character ID.
             * @param {string} value - The comma-separated tags string.
             */

            updateCharacterTags: debounce(function (id, value) {
                const char = ReactiveStore.getCharacter(id);
                if (char) {
                    char.tags = value.split(',').map(t => t.trim()).filter(Boolean);
                }
            }, 300),

            /**
             * Adds a single character tag and re-renders modal
             */
            addCharacterTag(id, tag) {
                const char = ReactiveStore.getCharacter(id);
                if (char && tag) {
                    char.tags = [...(char.tags || []), tag];
                    UIManager.openCharacterDetailModal(id);
                }
            },

            /**
             * Removes a single character tag and re-renders modal
             */
            removeCharacterTag(id, tagToRemove) {
                const char = ReactiveStore.getCharacter(id);
                if (char && char.tags) {
                    char.tags = char.tags.filter(t => t !== tagToRemove);
                    UIManager.openCharacterDetailModal(id);
                }
            },

            /**
             * Handles keydown on the tag input pill creator
             */
            handleTagInput(event, id) {
                if (event.key === ',' || event.key === 'Enter') {
                    event.preventDefault();
                    let newTag = event.target.value.replace(/,/g, '').trim();
                    if (newTag) {
                        NarrativeController.addCharacterTag(id, newTag);
                        // Re-focus the input after 50ms to allow DOM refresh
                        setTimeout(() => {
                            const input = document.getElementById(`tag-input-${id}`);
                            if (input) input.focus();
                        }, 50);
                    } else {
                        event.target.value = ''; // just clear commas
                    }
                }
            },

            /**
             * Parses lightweight markdown for pure visual highlighting overlay
             */
            formatMarkdownOverlay(text) {
                if (!text) return '';
                return String(text)
                    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") // sanitize base
                    .replace(/\*\*(.*?)\*\*/g, '<span class="text-indigo-400 drop-shadow-[0_0_1px_rgba(129,140,248,0.5)]">**$1**</span>')
                    .replace(/\*(.*?)\*/g, '<span class="text-indigo-300 italic opacity-90">*$1*</span>');
            },

            /**
             * Syncs the transparent textarea scroll and content with its backdrop
             */
            syncMarkdownOverlay(textarea) {
                if (!textarea) return;
                const overlay = textarea.previousElementSibling;
                if (overlay && overlay.classList.contains('markdown-backdrop')) {
                    overlay.innerHTML = NarrativeController.formatMarkdownOverlay(textarea.value);
                    overlay.scrollTop = textarea.scrollTop;
                }
            },


            /**
             * Sets the role of a character (user or narrator).
             * @param {string} charId - The character ID.
             * @param {string} role - 'user' or 'narrator'.
             */
            setCharacterRole(charId, role) {
                ReactiveStore.state.characters.forEach(c => {
                    if (c.id === charId) {
                        c.is_user = (role === 'user');
                        c.is_narrator = (role === 'narrator');
                    } else if (role === 'user') {
                        c.is_user = false; // Single user enforcement
                    }
                });
                UIManager.openCharacterDetailModal(charId); // Refresh view
            },

            /**
             * Toggles a character's active status.
             * @param {Event} event - The checkbox change event.
             * @param {string} id - The character ID.
             */
            toggleCharacterActive(event, id) {
                const char = ReactiveStore.getCharacter(id);
                if (char) {
                    if (event && event.target && event.target.type === 'checkbox') {
                        char.is_active = event.target.checked;
                    } else {
                        char.is_active = !char.is_active;
                    }
                }
            },

            // Character Colors ---
            /**
             * Updates a character's color settings (debounced).
             * @param {string} id - The character ID.
             * @param {string} type - 'base' or 'bold'.
             * @param {string} value - The hex color code.
             */
            updateCharacterColor: debounce(function (id, type, value) {
                const char = ReactiveStore.getCharacter(id);
                if (char) {
                    if (!char.color) char.color = { base: '#334155', bold: '#94a3b8' };
                    char.color[type] = value;
                    // Force styling refresh if needed, though ReactiveStore should handle standard bindings.
                    // However, message bubbles use color directly from state during renderChat.
                    // If we want live update of existing bubbles without full re-render, we might need UIManager.renderChat();
                    UIManager.renderChat();
                }
            }, 300),

            // Emotional Portraits ---
            /**
             * Adds a new extra portrait slot for a character.
             * @param {string} charId - The character ID.
             */
            addExtraPortrait(charId) {
                const char = ReactiveStore.getCharacter(charId);
                if (!char) return;
                if (!char.extra_portraits) char.extra_portraits = [];

                // Capture scroll position
                const container = document.getElementById('character-detail-modal-content');
                const scrollTop = container ? container.scrollTop : 0;

                char.extra_portraits.push({ emotion: 'neutral', url: '' });
                UIManager.openCharacterDetailModal(charId); // Refresh modal

                // Restore scroll position
                const newContainer = document.getElementById('character-detail-modal-content');
                if (newContainer) newContainer.scrollTop = scrollTop;
            },

            /**
             * Removes an extra portrait slot.
             * @param {string} charId - The character ID.
             * @param {number} index - The index of the portrait.
             */
            removeExtraPortrait(charId, index) {
                UIManager.showConfirmationModal('Delete this emotional portrait?', async () => {
                    const char = ReactiveStore.getCharacter(charId);
                    if (!char || !char.extra_portraits) return;

                    const emotion = char.extra_portraits[index]?.emotion || 'neutral';
                    const emoKey = `${charId}::emotion::${emotion}`;

                    // Remove from array
                    char.extra_portraits.splice(index, 1);

                    // Clean up IDB image aggressively
                    await DBService.deleteImage(emoKey);
                    if (UIManager.RUNTIME.characterImageCache[emoKey]) {
                        if (UIManager.RUNTIME.characterImageCache[emoKey].startsWith('blob:')) {
                            URL.revokeObjectURL(UIManager.RUNTIME.characterImageCache[emoKey]);
                        }
                        delete UIManager.RUNTIME.characterImageCache[emoKey];
                    }

                    ReactiveStore.forceSave(); // Ensure the array deletion is saved

                    UIManager.openCharacterDetailModal(charId);
                    UIManager.renderChat(); // Refresh chat immediately to drop the emotion portrait
                });
            },

            /**
             * Updates a field of an extra portrait (debounced).
             * @param {string} charId - The character ID.
             * @param {number} index - The index of the portrait.
             * @param {string} field - The field to update.
             * @param {string} value - The new value.
             */
            updateExtraPortrait: debounce(function (charId, index, field, value) {
                const char = ReactiveStore.getCharacter(charId);
                if (char && char.extra_portraits && char.extra_portraits[index]) {
                    char.extra_portraits[index][field] = value;
                }
            }, 300),

            /**
             * Handles the upload of a local image for a specific emotion.
             * @param {Event} event - The file input change event.
             * @param {string} charId - The character ID.
             * @param {number} index - The index of the portrait.
             */
            async handleLocalEmotionImageUpload(event, charId, index) {
                const file = event.target.files[0];
                if (!file) return;
                const char = ReactiveStore.getCharacter(charId);
                if (!char || !char.extra_portraits[index]) return;

                UIManager.showLoadingSpinner('Processing image...');
                try {
                    const blob = await ImageProcessor.processImageAsBlob(file);
                    const emotion = char.extra_portraits[index].emotion || 'neutral';
                    const key = `${charId}::emotion::${emotion}`;

                    await DBService.saveImage(key, blob);
                    if (UIManager.RUNTIME.characterImageCache[key]) {
                        URL.revokeObjectURL(UIManager.RUNTIME.characterImageCache[key]);
                    }
                    UIManager.RUNTIME.characterImageCache[key] = URL.createObjectURL(blob);
                    // Clear manual URL
                    char.extra_portraits[index].url = '';

                    // Force save
                    ReactiveStore.forceSave();

                    await UIManager.invalidateMaskAndTriggerRegen(key, charId);

                    UIManager.openCharacterDetailModal(charId);
                } catch (e) {
                    alert("Image upload failed: " + e.message);
                } finally {
                    UIManager.hideLoadingSpinner();
                    event.target.value = '';
                }
            },

            // --- Character Specific Knowledge ---

            addCharacterKnowledge(charId) {
                const char = ReactiveStore.getCharacter(charId);
                if (!char) return;
                if (!char.dynamic_knowledge) char.dynamic_knowledge = [];

                char.dynamic_knowledge.push({
                    id: UTILITY.uuid(),
                    title: "New Secret",
                    triggers: "",
                    content_fields: [""]
                });
                UIManager.openCharacterDetailModal(charId);
            },

            removeCharacterKnowledge(charId, entryId) {
                UIManager.showConfirmationModal('Delete this private knowledge entry?', () => {
                    const char = ReactiveStore.getCharacter(charId);
                    if (char && char.dynamic_knowledge) {
                        char.dynamic_knowledge = char.dynamic_knowledge.filter(e => e.id !== entryId);
                        UIManager.openCharacterDetailModal(charId);
                    }
                });
            },

            updateCharacterKnowledgeField: debounce(function (charId, entryId, field, value) {
                const char = ReactiveStore.getCharacter(charId);
                if (char && char.dynamic_knowledge) {
                    const entry = char.dynamic_knowledge.find(e => e.id === entryId);
                    if (entry) {
                        entry[field] = value;
                    }
                }
            }, 300),

            addCharacterKnowledgeContent(charId, entryId) {
                const char = ReactiveStore.getCharacter(charId);
                if (char && char.dynamic_knowledge) {
                    const entry = char.dynamic_knowledge.find(e => e.id === entryId);
                    if (entry) {
                        if (!entry.content_fields) entry.content_fields = [];
                        entry.content_fields.push("");
                        UIManager.openCharacterDetailModal(charId);
                    }
                }
            },

            removeCharacterKnowledgeContent(charId, entryId, index) {
                const char = ReactiveStore.getCharacter(charId);
                if (char && char.dynamic_knowledge) {
                    const entry = char.dynamic_knowledge.find(e => e.id === entryId);
                    if (entry && entry.content_fields) {
                        entry.content_fields.splice(index, 1);
                        UIManager.openCharacterDetailModal(charId);
                    }
                }
            },

            updateCharacterKnowledgeContent: debounce(function (charId, entryId, index, value) {
                const char = ReactiveStore.getCharacter(charId);
                if (char && char.dynamic_knowledge) {
                    const entry = char.dynamic_knowledge.find(e => e.id === entryId);
                    if (entry && entry.content_fields && entry.content_fields[index] !== undefined) {
                        entry.content_fields[index] = value;
                    }
                }
            }, 300),

            // --- Example Dialogue Logic ---

            /**
             * Adds a new turn to the example dialogue.
             */
            addExampleDialogueTurn() {
                const state = ReactiveStore.state;
                const firstAi = state.characters.find(c => !c.is_user);
                if (!firstAi) return alert("Need AI character.");
                state.chat_history.push({
                    character_id: firstAi.id, content: "New example.", type: 'chat',
                    emotion: 'neutral', timestamp: new Date().toISOString(), isHidden: true
                });
                UIManager.renderExampleDialogueModal();
            },

            /**
             * Deletes a turn from the example dialogue.
             * @param {number} index - The index of the turn.
             */
            deleteExampleDialogueTurn(index) {
                ReactiveStore.state.chat_history.splice(index, 1);
                UIManager.renderExampleDialogueModal();
            },

            /**
             * Moves an example dialogue turn up or down.
             * @param {number} index - The index of the turn.
             * @param {string} direction - 'up' or 'down'.
             */
            moveExampleDialogueTurn(index, direction) {
                const history = ReactiveStore.state.chat_history;
                if (!history[index]) return;

                let swapIndex = -1;
                // Find next/prev hidden message
                if (direction === 'up') {
                    for (let i = index - 1; i >= 0; i--) { if (history[i].isHidden) { swapIndex = i; break; } }
                } else {
                    for (let i = index + 1; i < history.length; i++) { if (history[i].isHidden) { swapIndex = i; break; } }
                }

                if (swapIndex !== -1) {
                    const temp = history[swapIndex];
                    history[swapIndex] = history[index];
                    history[index] = temp;
                    UIManager.renderExampleDialogueModal();
                }
            },

            /**
             * Updates a field of an example dialogue turn (debounced).
             * @param {number} index - The index of the turn.
             * @param {string} field - The field to update.
             * @param {string} value - The new value.
             */
            updateExampleDialogueTurn: debounce(function (index, field, value) {
                if (ReactiveStore.state.chat_history[index]) {
                    ReactiveStore.state.chat_history[index][field] = value;
                }
            }, 300),

            // --- Helpers ---

            /**
             * Enhances a character's description using AI.
             * @param {Event} event - The click event.
             * @param {string} charId - The character ID.
             */
            async enhancePersonaWithAI(event, charId) {
                const char = ReactiveStore.getCharacter(charId);
                if (!char) return;

                // Capture the button immediately, as 'event' may be lost/stale in the async callback
                let targetBtn = null;
                if (event && event.target && typeof event.target.closest === 'function') {
                    targetBtn = event.target.closest('button');
                }
                // Fallback: Try to find the button via data attributes if event is missing
                if (!targetBtn) {
                    targetBtn = document.querySelector(`button[data-action="enhance-persona"][data-id="${charId}"]`);
                }

                UIManager.showConfirmationModal('Overwrite persona?', async () => {
                    const promptTemplate = ReactiveStore.state.prompt_persona_gen || UTILITY.getDefaultSystemPrompts().prompt_persona_gen;
                    // Robust replacement handling empty fields
                    const prompt = promptTemplate.replace(/{name}/g, char.name || 'Character').replace(/{concept}/g, char.description || '');

                    // Pass the captured button wrapped in a structure that _gen expects
                    const res = await this._gen({ target: targetBtn }, prompt);

                    if (res) {
                        char.description = res;
                        // Update UI manually for immediate feedback if open
                        const el = document.getElementById(`persona-description-${char.id}`);
                        if (el) {
                            el.value = res;
                            // Trigger input event or manually update token count if needed
                            if (UIManager.updateTokenCount) UIManager.updateTokenCount(char.id, res);
                        }
                    }
                });
            },

            /**
             * Opens the Generic Image Generator for a character.
             * @param {string} charId - The Character ID.
             * @param {string} type - 'primary' or 'extra'.
             * @param {number} [index] - Index for extra emotions.
             */
            async openCharacterImageGenerator(charId, type = 'primary', index = null) {
                const state = StateManager.getState();
                const char = ReactiveStore.getCharacter(charId);
                if (!char) return;

                // [NEW] Get base portrait blob for I2I if it exists
                let initImage = null;
                // Only load initImage if NOT primary type, to avoid self-ref loop/using existing primary to gen new primary
                if (type !== 'primary') {
                    try {
                        initImage = await DBService.getImage(charId);
                    } catch (e) {
                        // It might be using a local_idb key but renamed, but usually charId is the key for primary portrait
                        console.warn("No base image found for I2I", e);
                    }
                }

                let initialPrompt = char.appearance || char.short_description || char.description.substring(0, 500);
                let titleSuffix = "";

                if (type === 'extra' && index !== null) {
                    const portrait = char.extra_portraits[index];
                    const emotion = portrait ? portrait.emotion : 'neutral';
                    initialPrompt = `portrait of ${char.name} expressing ${emotion} emotion, ${emotion} facial expression`;
                    titleSuffix = ` (${emotion})`;
                }

                UIManager.openGenericImageGenerator({
                    title: `Generate: ${char.name}${titleSuffix}`,
                    initialPrompt: initialPrompt,
                    initImage: initImage, // Pass base image for I2I
                    onSave: async (blob) => {
                        if (type === 'primary') {
                            await this.handleLocalImageUpload({ target: { files: [new File([blob], "generated_portrait.png", { type: "image/png" })] } }, charId);
                        } else {
                            await this.handleLocalEmotionImageUpload({ target: { files: [new File([blob], "generated_emotion.png", { type: "image/png" })] } }, charId, index);
                        }
                        UIManager.renderCharacters();
                    }
                });
            },

            /**
             * Generates tags for a character using AI.
             * @param {Event} event - The click event.
             * @param {string} charId - The character ID.
             */
            async generateTagsForCharacter(event, charId) {
                const char = ReactiveStore.getCharacter(charId);
                if (!char) return;
                const prompt = `Generate 3-5 tags for: ${char.name}. Description: ${char.description}`;
                const res = await this._gen(event, prompt);
                if (res) {
                    const tags = res.split(',').map(t => t.trim().toLowerCase());
                    char.tags = [...new Set([...(char.tags || []), ...tags])];
                }
            },

            /**
             * Generates model instructions for a character using AI.
             * @param {Event} event - The click event.
             * @param {string} charId - The character ID.
             */
            async generateModelInstructions(event, charId) {
                const char = ReactiveStore.getCharacter(charId);
                if (!char) return;
                const prompt = `Generate model instructions for ${char.name} based on: ${char.description}`;
                const res = await this._gen(event, prompt);
                if (res) {
                    char.model_instructions = res;
                    UIManager.openCharacterDetailModal(charId);
                }
            },

            /**
             * Generates a short description for a character using AI.
             * @param {Event} event - The click event.
             * @param {string} charId - The character ID.
             */
            async generateShortDescForCharacter(event, charId) {
                const char = ReactiveStore.getCharacter(charId);
                if (!char) return;
                // If there's no main description, we can't reliably condense it.
                if (!char.description || char.description.trim() === '') {
                    alert("Please write or generate a Persona Description first.");
                    return;
                }
                const prompt = `Read the following persona description and create a condensed, 1-3 sentence summary/short description representing the character's core identity:\n\n${char.description}`;
                const res = await this._gen(event, prompt);
                if (res) {
                    char.short_description = res;
                    UIManager.openCharacterDetailModal(charId);
                }
            },

            /**
             * Generates the outward appearance for a character using AI, based on their persona.
             * @param {Event} event - The click event.
             * @param {string} charId - The character ID.
             */
            async generateAppearanceForCharacter(event, charId) {
                const char = ReactiveStore.getCharacter(charId);
                if (!char) return;
                if (!char.description || char.description.trim() === '') {
                    alert("Please write or generate a Persona Description first.");
                    return;
                }
                const prompt = `You are a creative writer. Based on the following character persona, describe their outward physical appearance only. 
Include detailed physical attributes (facial features, hair/eye color, body type, posture). 
Focus strictly on visual, tangible details that could be used by an artist or image generator. 
Inner thoughts, personality traits, and history are inappropriate im this response and will be covered at a later time. 
Be concise but descriptive.

### Persona
${char.description}

### Output Format
Return ONLY the physical description. Write in the 3rd person. No preamble.`;

                const res = await this._gen(event, prompt);
                if (res) {
                    char.appearance = res;
                    UIManager.openCharacterDetailModal(charId);
                }
            },

            /**
             * Handles the upload of a local image for a character.
             * @param {Event} event - The file input change event.
             * @param {string} charId - The character ID.
             */
            async handleLocalImageUpload(event, charId) {
                const file = event.target.files[0];
                if (!file) return;

                UIManager.showLoadingSpinner('Processing image...');
                try {
                    const blob = await ImageProcessor.processImageAsBlob(file);
                    await DBService.saveImage(charId, blob);
                    if (UIManager.RUNTIME.characterImageCache[charId]) {
                        URL.revokeObjectURL(UIManager.RUNTIME.characterImageCache[charId]);
                    }
                    UIManager.RUNTIME.characterImageCache[charId] = URL.createObjectURL(blob);

                    const char = ReactiveStore.getCharacter(charId);
                    if (char) {
                        const legacyUrl = char.image_url;
                        char.image_url = ''; // Clear legacy 

                        // Clean up legacy ID to prevent orphans
                        if (legacyUrl && legacyUrl.startsWith('local_idb_')) {
                            const legacyKey = legacyUrl.replace('local_idb_', '');
                            if (legacyKey !== charId) DBService.deleteImage(legacyKey); // Fire and forget
                        }
                    }
                    ReactiveStore.forceSave(); // Force save to persist immediately

                    await UIManager.invalidateMaskAndTriggerRegen(charId, charId);

                    UIManager.renderCharacters();
                    UIManager.openCharacterDetailModal(charId); // Ensure modal view updates with new image
                } catch (e) {
                    alert("Image upload failed: " + e.message);
                } finally {
                    UIManager.hideLoadingSpinner();
                    event.target.value = '';
                }
            },





            /**
             * Retrieves unique character IDs for characters (including the user) who have
             * spoken in the last N messages.
             * @param {number} limit - The number of messages to scan.
             * @returns {string[]} - Array of unique character IDs.
             */
            getActiveParticipantIds(limit = 5) {
                const state = ReactiveStore.state;
                if (!state.chat_history) return [];

                // Filter valid chat messages (not hidden, not system reveals)
                const recentMessages = state.chat_history
                    .filter(m => m && m.type === 'chat' && !m.isHidden)
                    .slice(-limit);

                const ids = new Set();
                recentMessages.forEach(m => {
                    if (m.character_id) ids.add(m.character_id);
                });

                return Array.from(ids);
            },

            /**
             * Checks the last message for dynamic entry keyphrases.
             * If triggered, injects the entry into the history (and optionally removes previous reveals).
             * @returns {boolean} - True if state changed (requires re-render).
             */
            /**
             * Internal helper to handle the logic of triggering a lore entry (Global or Character-Specific).
             * @param {Object} entry - The Lore entry object.
             * @param {string|null} charId - The ID of the character this lore is exclusive to, or null for global.
             * @returns {boolean} - Whether a change was made.
             * @private
             */
            _triggerLoreEntry(entry, charId = null) {
                const state = ReactiveStore.state;
                // De-duplicate: Look-behind 20 messages
                const searchWindowStart = Math.max(0, state.chat_history.length - 20);
                let foundIndex = -1;

                for (let i = state.chat_history.length - 1; i >= searchWindowStart; i--) {
                    const msg = state.chat_history[i];
                    if (msg && msg.type === 'lore_reveal' && msg.dynamic_entry_id === entry.id) {
                        foundIndex = i;
                        break;
                    }
                }

                if (foundIndex !== -1) {
                    state.chat_history.splice(foundIndex, 1);
                }

                // Sequential Logic
                const contentIndex = entry.current_index || 0;
                if (!entry.content_fields || entry.content_fields.length === 0) return false;

                let contentToReveal = entry.content_fields[contentIndex];

                // Variable Substitution: {{option1, option2}}
                if (contentToReveal && typeof contentToReveal === 'string') {
                    contentToReveal = contentToReveal.replace(/\{\{(.+?)\}\}/g, (match, inner) => {
                        const options = inner.split(',').map(s => s.trim());
                        if (options.length > 0) {
                            return options[Math.floor(Math.random() * options.length)];
                        }
                        return match;
                    });
                }

                let nextIndex = contentIndex + 1;
                if (nextIndex >= entry.content_fields.length) {
                    nextIndex = entry.content_fields.length - 1;
                }
                entry.current_index = nextIndex;

                state.chat_history.push({
                    type: 'lore_reveal',
                    title: entry.title,
                    content: contentToReveal,
                    dynamic_entry_id: entry.id,
                    // Stage this reveal consumed. Deleting the message rewinds
                    // entry.current_index back to it (restoreLoreIndicesForRemovedMessages).
                    previous_index: contentIndex,
                    exclusive_to_char_id: charId,
                    timestamp: new Date().toISOString(),
                    isHidden: true
                });
                console.log(`Lore Entry triggered${charId ? ' (Character-Specific)' : ' (Global)'}: ${entry.title}`);
                return true;
            },

            /**
             * Scans for both Global and Character-Specific dynamic lore triggers.
             * @returns {boolean} - Whether any lore was triggered.
             */
            checkDynamicEntryTriggers() {
                const state = ReactiveStore.state;

                const lastMsg = state.chat_history.slice().reverse().find(m => m && m.type === 'chat');
                if (!lastMsg) return false;

                const content = lastMsg.content;
                let stateChanged = false;

                // 1. Scan Global Dynamic Lore
                (state.dynamic_entries || []).forEach(entry => {
                    const triggeredEntry = UTILITY.testLoreEntries(content, [entry]);
                    if (triggeredEntry) {
                        if (this._triggerLoreEntry(entry)) stateChanged = true;
                    }
                });

                // 2. Scan Character-Specific Dynamic Lore
                const activeAiChars = [...state.characters, ...ReactiveStore.getActiveLocationCharacters()].filter(c => !c.is_user && c.is_active);
                activeAiChars.forEach(char => {
                    (char.dynamic_knowledge || []).forEach(entry => {
                        const triggeredEntry = UTILITY.testLoreEntries(content, [entry]);
                        if (triggeredEntry) {
                            if (this._triggerLoreEntry(entry, char.id)) stateChanged = true;
                        }
                    });
                });

                if (stateChanged) {
                    UIManager.renderDynamicEntries();
                }
                return stateChanged;
            },


            /**
             * Helper for AI generation buttons.
             * @param {Event} event - The triggering event.
             * @param {string} prompt - The prompt to send.
             * @returns {Promise<string|null>} - The generated content or null.
             * @private
             */
            async _gen(event, prompt) {
                // Return null immediately if no prompt
                if (!prompt) return null;

                // Helper for button state handling - Robust Check
                let btn = null;
                if (event && event.target) {
                    if (event.target instanceof Element && typeof event.target.closest === 'function') {
                        btn = event.target.closest('button');
                    } else if (event.target.tagName === 'BUTTON') {
                        btn = event.target;
                    }
                }

                // Preserve original text for restoration
                let originalText = '';
                if (btn) {
                    btn.disabled = true;
                    originalText = btn.innerHTML;
                    btn.innerHTML = '...';
                }

                try {
                    return await APIService.callAI(prompt);
                } catch (e) {
                    // Was alert(), a blocking system dialog that had to be dismissed by hand
                    // on mobile. callAI already reports what it recognises, so only speak up
                    // for the failures it did not.
                    if (!e || !e.reported) UIManager.showNotification((e && e.message) || 'Generation failed.', 'error');
                    return null;
                } finally {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = originalText || 'Gen'; // Restore or Default
                    }
                }
            },

            /**
             * Checks if an AI model is properly configured.
             * Checks both local state and global settings.
             */
            _isModelConfigured(s) {
                const global = StateManager.data.globalSettings;

                if (s.apiProvider === 'gemini') {
                    return (s.geminiApiKey && s.geminiApiKey.trim() !== '') ||
                        (global.geminiApiKey && global.geminiApiKey.trim() !== '');
                }
                if (s.apiProvider === 'openrouter') {
                    return (s.openRouterKey && s.openRouterKey.trim() !== '') ||
                        (global.openRouterKey && global.openRouterKey.trim() !== '');
                }
                if (s.apiProvider === 'nanogpt') {
                    return (s.nanoGPTKey && s.nanoGPTKey.trim() !== '') ||
                        (global.nanoGPTKey && global.nanoGPTKey.trim() !== '');
                }
                if (s.apiProvider === 'koboldcpp') return !!s.koboldcpp_url;
                if (s.apiProvider === 'lmstudio') return !!s.lmstudio_url;
                if (s.apiProvider === 'webllm') return !!s.webllmModel;

                return false;
            },

            /**
             * Toggles swarm mode on/off from the settings UI.
             * When enabling, initialises the NC ledger for all active AI characters.
             * Preserves existing balances so toggling mid-session doesn't reset progress.
             * @param {boolean} enabled
             */
            setSwarmMode(enabled) {
                const state = ReactiveStore.state;
                state.swarmMode = !!enabled;

                if (enabled) {
                    console.log(`[Swarm] Mode ENABLED.`);
                } else {
                    console.log('[Swarm] Mode DISABLED. Returning to standard narrator flow.');
                }

                if (typeof ReactiveStore.forceSave === 'function') ReactiveStore.forceSave();
            },

            /**
             * Displays the raw prompt that would be sent to the AI.
             * Useful for debugging.
             */
            async viewRawPrompt() {

                const state = ReactiveStore.state;

                // [NEW] Check for cached prompt first
                const runtime = (this && this.RUNTIME) ? this.RUNTIME : (typeof NarrativeController !== 'undefined' ? NarrativeController.RUNTIME : null);
                if (runtime && runtime.lastPromptDetails) {
                    const cached = runtime.lastPromptDetails;
                    const rawText = UTILITY.resolvePromptText(cached.prompt);
                    const images = (typeof cached.prompt === 'object' && cached.prompt && Array.isArray(cached.prompt.images)) ? cached.prompt.images : [];

                    let metaInfo = `--- LAST GENERATED PROMPT ---\n`;
                    metaInfo += `Timestamp: ${cached.timestamp}\n`;
                    metaInfo += `Target Character ID: ${cached.charId}\n`;
                    metaInfo += `Provider: ${cached.model}\n`;

                    if (images.length > 0) {
                        metaInfo += `Attached Image Entries: ${images.length}\n`;
                    }

                    if (cached.model === 'koboldcpp') {
                        const template = state.koboldcpp_template || 'none';
                        metaInfo += `Template Used: ${template.toUpperCase()}\n`;
                    }
                    metaInfo += `---------------------------\n\n`;

                    const contentEl = document.getElementById('raw-prompt-content');
                    if (contentEl) {
                        contentEl.textContent = metaInfo + rawText;
                    }
                    AppController.openModal('view-raw-prompt-modal');
                    return;
                }

                // --- FALLBACK / PREVIEW MODE (No previous prompt found) ---

                // 1. Determine who the prompt is for
                let charId = document.getElementById('ai-character-selector').value;
                if (charId === 'any') {
                    // PREVIEW MODE OPTIMIZATION:
                    // We do NOT want to trigger the expensive 'Scriptwriter' agent (determineNextSpeaker) just to view a prompt preview.
                    // Instead, we select the first available active AI character as a placeholder interactively.
                    const firstActive = state.characters.find(c => !c.is_user && c.is_active);
                    if (firstActive) {
                        charId = firstActive.id;
                    } else {
                        // Fallback: Try any non-user
                        const anyChar = state.characters.find(c => !c.is_user);
                        if (anyChar) charId = anyChar.id;
                    }
                }

                if (!charId) {
                    alert("Please select a specific character or ensure AI characters are active to view a prompt preview.");
                    return;
                }

                // 2. Build the prompt string using the shared logic
                const promptObj = PromptBuilder.buildPrompt(charId);
                const promptText = UTILITY.resolvePromptText(promptObj);
                const images = (typeof promptObj === 'object' && promptObj && Array.isArray(promptObj.images)) ? promptObj.images : [];

                // 3. Generate Metadata Header for the view
                let metaInfo = `--- PREVIEW (NEXT PROMPT) ---\n`;
                metaInfo += `Target Character ID: ${charId}\n`;
                metaInfo += `Active Provider: ${state.apiProvider}\n`;

                if (images.length > 0) {
                    metaInfo += `Attached Image Entries: ${images.length}\n`;
                }

                if (state.apiProvider === 'koboldcpp') {
                    // Show specific template being used
                    const template = state.koboldcpp_template || 'none';
                    metaInfo += `Active Template: ${template.toUpperCase()}\n`;

                    // Estimate Token Count (Roughly 4 chars per token)
                    const estTokens = Math.ceil(promptText.length / 4);
                    const maxCtx = 4096; // Default context limit
                    const usage = Math.round((estTokens / maxCtx) * 100);
                    metaInfo += `Est. Context Usage: ~${estTokens} / ${maxCtx} tokens (${usage}%)\n`;
                } else {
                    metaInfo += `Template: Standard (Cloud/Default)\n`;
                }

                metaInfo += `-----------------------------\n\n`;

                // 4. Render
                const contentEl = document.getElementById('raw-prompt-content');
                if (contentEl) {
                    contentEl.textContent = metaInfo + promptText;
                }

                AppController.openModal('view-raw-prompt-modal');
            },

            /**
             * Opens the image cropper for an existing character image.
             */
            async openImageCropper(charId, type = 'primary', index = null) {
                const state = ReactiveStore.state;
                const char = ReactiveStore.getCharacter(charId);
                if (!char) return;

                let key = charId;
                if (type === 'extra' && index !== null) {
                    // Extra portrait is tricky, we don't store them as blobs usually?
                    // The schema says extra_portraits is metadata?
                    // Ah, schema says "characterImages" store has keys like `uuid::emotion::happy`.
                    // We need to re-construct the key.
                    // If index is passed, we can look up the emotion in char.extra_portraits
                    const portrait = char.extra_portraits[index];
                    if (portrait && portrait.emotion) {
                        key = `${char.id}::emotion::${portrait.emotion}`;
                    }
                }

                try {
                    const blob = await DBService.getImage(key);
                    if (!blob) return alert("No image found to crop.");

                    CropController.open(blob, async (newBlob) => {
                        await DBService.saveImage(key, newBlob);

                        // Update runtime cache
                        if (UIManager.RUNTIME.characterImageCache[key]) {
                            URL.revokeObjectURL(UIManager.RUNTIME.characterImageCache[key]);
                        }
                        UIManager.RUNTIME.characterImageCache[key] = URL.createObjectURL(newBlob);

                        // Invalidate mask and trigger auto-mask if useAlphaMask is active
                        await UIManager.invalidateMaskAndTriggerRegen(key, charId);

                        // Force UI refresh
                        UIManager.openCharacterDetailModal(charId);
                    });
                } catch (e) {
                    console.error("Failed to load image for cropping:", e);
                    alert("Could not load image.");
                }
            },

            /**
             * Applies AI background removal (alpha mask) to a character's primary portrait in-place.
             * Loads the portrait from IDB, runs MediaPipe Selfie Segmentation, saves the
             * transparent PNG back. No crop modal is opened.
             * @param {string} charId - The character ID.
             */
            async applyAlphaMask(charId, mood = null) {
                const char = ReactiveStore.getCharacter(charId);
                if (!char) return;

                const key = mood ? `${charId}::emotion::${mood}` : charId;
                const maskKey = `${key}::alpha_masked`;
                let originalBlob = null;
                try {
                    originalBlob = await DBService.getImage(key);
                } catch (e) { /* ignore */ }

                if (!originalBlob) {
                    alert('No portrait found for this target. Upload one first.');
                    return;
                }

                // Disable the button while running
                const btnSelector = mood
                    ? `button[onclick*="applyAlphaMask('${charId}', '${mood}')"]`
                    : `button[onclick*="applyAlphaMask('${charId}')"]`;
                const cardBtn = document.querySelector(btnSelector);
                if (cardBtn) {
                    cardBtn.disabled = true;
                    cardBtn.title = 'Removing background…';
                    cardBtn.classList.add('opacity-50', 'animate-pulse');
                }

                try {
                    // Reuse the helper on UIManager
                    const maskedBlob = await UIManager.generateSegmentationMask(key, originalBlob);

                    // Save transparent PNG to maskKey (non-destructive)
                    await DBService.saveImage(maskKey, maskedBlob);

                    UIManager.RUNTIME.characterImageCache = UIManager.RUNTIME.characterImageCache || {};
                    const oldMaskUrl = UIManager.RUNTIME.characterImageCache[maskKey];
                    if (oldMaskUrl) {
                        const oldGradientKey = `${oldMaskUrl}::gradient`;
                        if (UIManager.RUNTIME.characterImageCache[oldGradientKey]) {
                            try {
                                URL.revokeObjectURL(UIManager.RUNTIME.characterImageCache[oldGradientKey]);
                            } catch (e) { }
                            delete UIManager.RUNTIME.characterImageCache[oldGradientKey];
                        }
                        try {
                            URL.revokeObjectURL(oldMaskUrl);
                        } catch (e) { }
                    }
                    UIManager.RUNTIME.characterImageCache[maskKey] = URL.createObjectURL(maskedBlob);

                    // Refresh character card & VN mode if active
                    UIManager.openCharacterDetailModal(charId);
                    UIManager.renderChat();
                    UIManager.showNotification(`Background removed successfully.`, "success");
                } catch (err) {
                    console.error('Alpha mask failed:', err);
                    alert('Background removal failed: ' + err.message);
                } finally {
                    if (cardBtn) {
                        cardBtn.disabled = false;
                        cardBtn.title = 'Remove Background (AI Mask)';
                        cardBtn.classList.remove('opacity-50', 'animate-pulse');
                    }
                }
            },

        };
