        /**
         * =================================================================================================
         * [SEC:JS:CTRL:SWM]
         * SwarmOrchestrator
         * Multi-Agent Swarm engine. Orchestrates per-character hidden scratchpad calls,
         * the Narrative Capital (NC) economy arbitration, and the Director synthesis phase.
         * All swarm metadata is ephemeral — it is NEVER injected into the permanent LLM context.
         * =================================================================================================
         */
        const SwarmOrchestrator = {
            RUNTIME: {
                lastPromptDetails: null
            },

            // ── PHASE 1: BROADCAST ────────────────────────────────────────────────────


            /**
             * Fires a single character's hidden scratchpad prompt.
             * The scratchpad reflection is NEVER stored in state — only the structured result is used.
             * @param {Object} char - The character object.
             * @param {string} userAction - The user's submitted action text.
             * @param {Object} state - The reactive narrative state.
             * @param {AbortSignal} signal
             * @returns {Promise<{thoughts: string, secret_used: boolean}>}
             */
            async _runAgentScratchpad(char, userAction, state, signal, objectiveDescription = "") {
                const prompt = PromptBuilder.buildSwarmScratchpadPrompt(char, userAction, state, objectiveDescription);
                console.log(`[Swarm Thinking Prompt for ${char.name}]:`, prompt);

                try {
                    console.log(`%c[Swarm Thinking] Calling Scratchpad for ${char.name}...`, "color: #94a3b8; font-style: italic;");
                    const rawResponse = await APIService.callAI(prompt, false, signal);
                    if (!rawResponse) throw new Error('Empty scratchpad response.');
                    console.log(`%c[Swarm Thinking] ${char.name} Raw:`, "color: #64748b; font-size: 10px;", rawResponse);

                    // Split off an optional private text before the monologue is handed to the
                    // Director, so the decision never leaks into the spoken scene.
                    let thoughts = rawResponse.trim();
                    let textMessage = null;
                    const textMatch = thoughts.match(/^[ \t]*TEXT:[ \t]*([\s\S]+)$/m);
                    if (textMatch) {
                        textMessage = textMatch[1].split('\n')[0].trim();
                        thoughts = thoughts.slice(0, textMatch.index).trim();
                    }

                    return {
                        thoughts: thoughts,
                        secret_used: false,
                        text_message: textMessage || null
                    };
                } catch (e) {
                    if (e.name === 'AbortError') throw e;
                    console.warn(`SwarmOrchestrator: Scratchpad call failed for ${char.name}:`, e.message);
                    // Graceful degradation: agent defaults to passive observation
                    return { thoughts: `${char.name} watches silently.`, secret_used: false, text_message: null };
                }
            },

            /**
             * Broadcasts the user action to a specific set of AI characters simultaneously via Promise.all().
             * The character set is pre-filtered by determineSwarmCandidates() before this is called.
             * On single-threaded local backends (KoboldCPP), requests queue automatically.
             * Failed agents degrade gracefully to NONE urgency.
             * @param {string} userAction
             * @param {Object} state
             * @param {AbortSignal} signal
             * @param {Object[]|null} candidates - Pre-filtered character objects to broadcast to.
             *   If null, falls back to the full active AI pool (legacy/vacuum path only).
             * @returns {Promise<Array<{char, result}>>}
             */
            async broadcast(userAction, state, signal, candidates = null, objectiveDescription = "") {
                const activeAiChars = candidates || (
                    [...(state.characters || []), ...ReactiveStore.getActiveLocationCharacters()]
                        .filter(c => !c.is_user && !c.is_narrator && c.is_active)
                );

                if (activeAiChars.length === 0) return [];

                console.log(`[Swarm] Broadcasting to ${activeAiChars.length} agent(s):`, activeAiChars.map(c => c.name));

                const agentPromises = activeAiChars.map(char =>
                    this._runAgentScratchpad(char, userAction, state, signal, objectiveDescription)
                        .then(result => {
                            console.log(`%c[Swarm Thinking] ${char.name} (Result):`, "color: #10b981; font-weight: bold;", result);
                            return { char, result };
                        })
                        .catch(err => {
                            if (err.name === 'AbortError') throw err;
                            console.error(`%c[Swarm Thinking] ${char.name} (Error):`, "color: #ef4444;", err);
                            return { char, result: { urgency_level: 'NONE', thoughts: `${char.name} stays silent.`, secret_used: false } };
                        })
                );

                const results = await Promise.all(agentPromises);
                console.groupEnd();
                return results;
            },

            // ── PHASE 2: DIRECTOR → CHARACTER RESPONSES ──────────────────────────────

            /**
             * Calls the Director agent to get a stage direction for the primary speaker.
             * @param {string} userAction
             * @param {Array<{char, result}>} agentResults - Scratchpads from all active candidates
             * @param {Object} primarySpeaker - The character selected to respond
             * @param {Object} state
             * @param {AbortSignal} signal
             * @returns {Promise<string>} The directive string
             */
            async direct(userAction, agentResults, primarySpeaker, state, signal, objectiveDescription = "") {
                if (!agentResults || agentResults.length === 0 || !primarySpeaker) {
                    throw new Error('[Swarm] direct() called with empty context.');
                }

                // Expose the primary speaker to the builder via state
                state.swarmPrimarySpeaker = primarySpeaker;
                const prompt = PromptBuilder.buildSwarmDirectorPrompt(userAction, agentResults, state, objectiveDescription);
                state.swarmPrimarySpeaker = null; // cleanup

                console.groupCollapsed("%c[Swarm Director] Prompt Details", "color: #818cf8; font-weight: bold;");
                console.log(prompt);
                console.groupEnd();

                const raw = await APIService.callAI(prompt, false, signal);
                if (!raw || !raw.trim()) throw new Error('Director returned empty response.');
                console.log("%c[Swarm Director] Raw Response:", "color: #64748b; font-size: 10px;", raw);

                try {
                    const parsed = UTILITY.extractAndParseJSON(raw);
                    if (parsed && parsed.directive) {
                        if (parsed.reasoning) {
                            console.log("%c[Swarm Director Reasoning]:", "color: #818cf8; font-weight: bold; font-size: 11px;", parsed.reasoning);
                        }
                        return parsed.directive;
                    }
                } catch (e) {
                    console.warn('[Swarm Director] JSON parse failed, using raw response:', e.message);
                }

                return raw; // Fallback to raw text if it wasn't valid JSON
            },

            /**
             * Executes a single winning character's final in-character response call.
             * @param {Object} char
             * @param {string} directive - The Director's instruction for this character.
             * @param {string} userAction
             * @param {Object} state
             * @param {AbortSignal} signal
             * @returns {Promise<string>} The character's in-character prose response.
             */
            async _executeDirective(char, directive, userAction, state, signal, scratchpadResult = null, objectiveDescription = "") {
                const prompt = PromptBuilder.buildSwarmCharacterResponsePrompt(char, directive, userAction, state, scratchpadResult, objectiveDescription);
                const promptDetails = {
                    prompt: prompt,
                    model: state.apiProvider,
                    charId: char.id,
                    timestamp: new Date().toISOString()
                };
                if (this.RUNTIME) this.RUNTIME.lastPromptDetails = promptDetails;
                if (typeof NarrativeController !== 'undefined' && NarrativeController.RUNTIME) {
                    NarrativeController.RUNTIME.lastPromptDetails = promptDetails;
                }

                console.groupCollapsed(`%c[Swarm Phase 4] Character Response: ${char.name}`, "color: #ec4899; font-weight: bold;");
                console.log("%cDirective:", "color: #f472b6; font-weight: bold;", directive);
                console.log("%cFull Prompt:", "color: #94a3b8; font-size: 10px;", prompt);
                console.groupEnd();

                const genResult = await APIService.callAI(prompt, false, signal, { returnMeta: true });
                const rawText = (typeof genResult === 'object' && genResult !== null) ? genResult.text : genResult;
                const thinking = (typeof genResult === 'object' && genResult !== null) ? genResult.thinking : (APIService.getLastThinking() || null);

                if (!rawText || !rawText.trim()) throw new Error(`${char.name} returned an empty response.`);

                let prose = rawText.trim();

                // Apply text formatting if a style is set
                try {
                    if (state.responseStyle === 'prose') {
                        prose = TextFormatter.toProse(prose);
                    } else if (state.responseStyle === 'roleplay') {
                        prose = TextFormatter.toRoleplay(prose);
                    }
                } catch (e) {
                    console.warn(`[Swarm] TextFormatter error for ${char.name}:`, e);
                }

                return { prose, thinking };
            },

            // ── MAIN ENTRY POINT ──────────────────────────────────────────────────────

            /**
             * Executes a full swarm turn: Broadcast → Direct → CharacterResponse.
             * Returns an array of character responses (each to be rendered as a separate bubble)
             * plus swarm metadata.
             * @param {string} userAction - The user's submitted message.
             * @param {Object} state - The reactive narrative state.
             * @param {AbortSignal} signal - AbortController signal for cancellation.
             * @returns {Promise<{
             *   charResponses: Array<{char: Object, prose: string}>,
             *   winners: Array,
             *   agentResults: Array,
             *   vacuumTriggered: boolean
             * }>}
             */
            async runTurn(userAction, state, signal, forcedCharId = null) {
                console.group(`%c[Swarm Turn] "${userAction || 'Generate Next'}"`, "background: #1e1b4b; color: #818cf8; padding: 4px 8px; border-radius: 4px; font-weight: bold;");

                // ── Phase 0: Cast ───────────────────────────────────────────────────────────
                // Ask the Scriptwriter to narrow the pool to the top 3 and pick the primary speaker.
                let candidates = [];
                let primarySpeaker = null;

                if (forcedCharId) {
                    primarySpeaker = state.characters.find(c => c.id === forcedCharId) || ReactiveStore.getCharacter(forcedCharId);
                    candidates = [primarySpeaker];
                    if (!primarySpeaker) console.warn(`[Swarm] Forced speaker ${forcedCharId} not found in state.`);
                }

                if (!primarySpeaker) {
                    try {
                        const result = await NarrativeController.determineSwarmSpeakerAndCandidates(userAction);
                        candidates = result.candidates;
                        primarySpeaker = result.primarySpeaker;
                    } catch (e) {
                        console.warn('[Swarm] Casting failed, using full pool (capped at 3):', e.message);
                        candidates = [...(state.characters || []), ...ReactiveStore.getActiveLocationCharacters()]
                            .filter(c => !c.is_user && !c.is_narrator && c.is_active)
                            .slice(0, 3);
                        primarySpeaker = candidates[0];
                    }
                }

                if (!primarySpeaker) {
                    throw new Error('No primary speaker could be determined for the swarm.');
                }

                // Update typing indicator to the primary speaker
                if (typeof UIManager !== 'undefined') {
                    UIManager.showTypingIndicator(primarySpeaker.id, 'thinking...');
                }

                // ── Phase 0.2: Objective Analysis ──────────────────────────────────────────
                // Generate a factual baseline of the scene to ground characters.
                let objectiveDescription = "";
                try {
                    console.log("%c[Swarm Phase 0.2] Generating Objective Analysis...", "color: #6366f1; font-weight: bold;");
                    if (typeof UIManager !== 'undefined') UIManager.showTypingIndicator(primarySpeaker.id, 'analyzing scene facts...');
                    const objPrompt = PromptBuilder.buildObjectivityDescriptionPrompt(primarySpeaker.id, userAction);
                    console.log("[Swarm Objectivity Prompt]:", objPrompt);
                    objectiveDescription = await APIService.callAI(objPrompt, false, signal);

                    if (objectiveDescription) {
                        console.log("%c[Swarm Objective Reality]:", "color: #64748b; font-size: 10px; font-style: italic;", objectiveDescription);
                    } else {
                        console.warn('[Swarm] Objective Analysis returned empty. Using fallback.');
                        objectiveDescription = "The scene continues naturally from the recent history.";
                    }
                } catch (objErr) {
                    console.warn('[Swarm] Objective Analysis failed:', objErr.message);
                    objectiveDescription = "The scene continues naturally from the recent history.";
                }

                // FINAL LOG: Ensure the baseline is ALWAYS visible if we got this far
                if (!objectiveDescription.includes("The scene continues naturally")) {
                    // Already logged above if successful
                } else {
                    console.log("%c[Swarm Objective Reality (Fallback)]:", "color: #94a3b8; font-size: 10px;", objectiveDescription);
                }

                // ── Phase 0.5: Narrator Bypass ──────────────────────────────────────────────
                if (primarySpeaker.is_narrator) {
                    console.log(`%c[Swarm Phase 0.5] Narrator selected (${primarySpeaker.name}). Bypassing thoughts and director.`, "color: #f59e0b; font-weight: bold;");
                    const prompt = PromptBuilder.buildPrompt(primarySpeaker.id, false);
                    const promptDetails = {
                        prompt: prompt,
                        model: state.apiProvider,
                        charId: primarySpeaker.id,
                        timestamp: new Date().toISOString()
                    };
                    if (this.RUNTIME) this.RUNTIME.lastPromptDetails = promptDetails;
                    if (typeof NarrativeController !== 'undefined' && NarrativeController.RUNTIME) {
                        NarrativeController.RUNTIME.lastPromptDetails = promptDetails;
                    }
                    const genResult = await APIService.callAI(prompt, false, signal, { returnMeta: true });
                    const raw = (typeof genResult === 'object' && genResult !== null) ? genResult.text : genResult;
                    const thinking = (typeof genResult === 'object' && genResult !== null) ? genResult.thinking : (APIService.getLastThinking() || null);
                    if (!raw || !raw.trim()) throw new Error('Narrator returned empty response.');

                    let prose = raw.trim();
                    if (state.responseStyle === 'prose' && window.TextFormatter) prose = window.TextFormatter.toProse(prose);
                    else if (state.responseStyle === 'roleplay' && window.TextFormatter) prose = window.TextFormatter.toStrictRoleplay(prose, primarySpeaker.name);

                    return {
                        charResponses: [{ char: primarySpeaker, prose, thinking }],
                        winners: [],
                        agentResults: [],
                        vacuumTriggered: false
                    };
                }

                if (!candidates || candidates.length === 0) {
                    throw new Error('No active AI characters available to participate in the swarm broadcast.');
                }

                console.log(`[Swarm] Cast for this turn (${candidates.length}):`, candidates.map(c => c.name), ` | Primary: ${primarySpeaker.name}`);

                // Phase 1: Broadcast to candidates to get their deep reflections
                console.groupCollapsed("%c[Swarm Phase 1] Emotional Reflection", "color: #10b981; font-weight: bold;");
                if (typeof UIManager !== 'undefined') UIManager.showTypingIndicator(primarySpeaker.id, 'reflecting...');
                const agentResults = await this.broadcast(userAction, state, signal, candidates, objectiveDescription);
                console.groupEnd();

                // Phase 2: Director synthesizes thoughts and yields directive to primary speaker
                if (typeof UIManager !== 'undefined') UIManager.showTypingIndicator(primarySpeaker.id, 'directing...');
                const directive = await this.direct(userAction, agentResults, primarySpeaker, state, signal, objectiveDescription);
                console.log(`[Swarm] Director issued directive to ${primarySpeaker.name}:`, directive);

                // Keep track of intents to provide back-end continuity
                state.swarmLastIntents = state.swarmLastIntents || {};
                agentResults.forEach(r => state.swarmLastIntents[r.char.id] = r.result.intent);

                // Phase 3: Primary character responds
                const charResponses = [];
                const primaryScratchpad = agentResults.find(r => r.char.id === primarySpeaker.id)?.result || null;
                try {
                    if (typeof UIManager !== 'undefined') UIManager.showTypingIndicator(primarySpeaker.id, 'is speaking...');
                    const execResult = await this._executeDirective(primarySpeaker, directive, userAction, state, signal, primaryScratchpad, objectiveDescription);
                    const prose = (typeof execResult === 'object' && execResult !== null) ? execResult.prose : execResult;
                    const thinking = (typeof execResult === 'object' && execResult !== null) ? execResult.thinking : (APIService.getLastThinking() || null);
                    charResponses.push({ char: primarySpeaker, prose, thinking });
                } catch (e) {
                    if (e.name === 'AbortError') throw e;
                    console.warn(`[Swarm] ${primarySpeaker.name} response failed:`, e.message);
                }

                if (charResponses.length === 0) {
                    throw new Error('Character response failed. The swarm yielded no output.');
                }

                console.groupEnd(); // [Swarm Turn]
                return { charResponses, winners: [{ char: primarySpeaker, result: primaryScratchpad }], agentResults, vacuumTriggered: false };
            }
        };
