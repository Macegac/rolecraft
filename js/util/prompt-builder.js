        /**
         * =================================================================================================
         * [SEC:JS:UTIL:PB]
         * PromptBuilder Module
         * Responsible for constructing context-rich prompts for the LLM.
         * =================================================================================================
         */
        const PromptBuilder = {
            buildGameStateXml(gameState) {
                if (!gameState) return "";
                const lines = [];

                // Inventory
                if (gameState.resources && gameState.resources.length > 0) {
                    const invStr = gameState.resources.map(r => `${r.name} (${r.value})`).join(', ');
                    lines.push(`Inventory: ${invStr}`);
                }

                // Quests (Active quests only)
                if (gameState.journal && gameState.journal.length > 0) {
                    const activeQuests = gameState.journal.filter(q => q.status === 'active');
                    if (activeQuests.length > 0) {
                        const questsStr = activeQuests.map(q => {
                            const objective = q.objective || (q.log && q.log.length > 0 ? q.log[q.log.length - 1] : q.status);
                            return `${q.title} (Objective: ${objective})`;
                        }).join(', ');
                        lines.push(`Active Quests: ${questsStr}`);
                    }
                }

                // Relationships
                if (gameState.relationships && gameState.relationships.length > 0) {
                    gameState.relationships.forEach(rel => {
                        const char = typeof ReactiveStore !== 'undefined' ? ReactiveStore.getCharacter(rel.characterId) : null;
                        const name = char ? char.name : (rel.characterName || 'Unknown');
                        lines.push(`${name} ${rel.track || 'Affection'}: ${rel.value}%`);
                    });
                }

                if (lines.length === 0) return "";

                return `<CURRENT_STATE>\n${lines.join('\n')}\n</CURRENT_STATE>`;
            },

            /**
             * Generates a prompt for creating 3 location-specific characters.
             * @param {string} locationName - The name of the location.
             * @param {string} locationDesc - The description of the location.
             * @returns {string} The formatted prompt.
             */
            buildLocationCharactersPrompt(locationName, locationDesc) {
                return `### SYSTEM INSTRUCTION
You are a creative world-building assistant. You are tasked with populating a location with exactly 3 distinct characters.
The characters should fit the setting, but also offer varied interaction opportunities for the user.

### LOCATION INFO
Name: ${locationName}
Description: ${locationDesc}

### REQUIREMENTS
Generate exactly 3 characters with the following archetypes:
1. Normal: An ordinary resident or worker (e.g., innkeeper, guard, merchant, commoner). Unimportant to the grand plot, but adds flavor to the world.
2. Impactful: Someone with authority, specialized knowledge, or significant influence in this specific location (e.g., mayor, captain, guild master, headpriest).
3. Mysterious: An intriguing individual who has their own hidden agenda or a 'side quest' they want the user to be involved in (e.g., a shaded figure, a stranger looking for an artifact, an exiled noble).

### OUTPUT FORMAT
You must respond with a raw JSON object containing a "characters" array with exactly 3 objects. Provide **only** the JSON without markdown code blocks or add any conversational text. Use this **exact** schema:
{
  "characters": [
    {
      "name": "Character Name",
      "short_description": "A very brief 1-sentence summary.",
      "role": "Their role/archetype (e.g. 'Normal: Innkeeper' or 'Mysterious: Stranger')",
      "personal_goal": "What they currently want or are trying to achieve.",
      "reason_for_being_there": "Why they are at this location.",
      "appearance": "A detailed outward appearance of what they look like and what they are wearing. This should capture the character's 'public mask'—the physical attributes and presentation they show to the world, which might deliberately contrast with their true nature or hidden goals.",
      "description": "A massive, multi-paragraph deep dive into their psychological profile, history, secrets, and personality traits. Write at least 3 paragraphs detailing who they are and how they got to this location.",
      "model_instructions": "Direct instructions to the AI on how to roleplay this string. Include speech patterns, conversational tics, typical moods, and boundaries. (e.g. 'Always speak in short, nervous sentences. You are highly suspicious of strangers. Never reveal your true name.')"
    }
  ]
}`;
            },

            /**
             * Builds the prompt for generating blank/adjacent locations on the fly.
             * @param {Object} story - The story object containing the custom prompt template.
             * @param {Array<Object>} emptyCoords - Coordinates to generate locations for.
             * @param {Object} state - The current state.
             * @returns {string} The formatted prompt.
             */
            buildAdjacentLocationsPrompt(story, emptyCoords, state) {
                const promptTemplate = story.prompt_adjacent_locations_gen || "";

                // Formulate variables
                const count = emptyCoords.length;

                // Characters list
                const characters = (state.characters || [])
                    .filter(c => c && !c.is_user && c.is_active !== false)
                    .map(c => `- ${c.name}: ${c.short_description || 'NPC'}`)
                    .join('\n');

                // World Lore Summary: World-level static knowledge
                const staticKnowledge = (state.static_knowledge || [])
                    .map(e => `### ${e.title}\n${e.content}`)
                    .join('\n\n');

                // Recent History
                const recentHistory = (state.chat_history || [])
                    .filter(m => m && m.type === 'chat' && !m.isHidden)
                    .slice(-15)
                    .map(m => `${m.sender_name || 'Narrator'}: ${m.content}`)
                    .join('\n');

                // Current player coordinates
                const currentCoords = state.worldMap && state.worldMap.currentLocation
                    ? `x: ${state.worldMap.currentLocation.x}, y: ${state.worldMap.currentLocation.y}`
                    : "Unknown";

                // Target coordinates we are generating for
                const targetCoordsJson = JSON.stringify(emptyCoords);

                // Surrounding/known locations
                // Only pass coordinates, name, and short description to save tokens
                const surrounding = (state.worldMap && state.worldMap.grid || [])
                    .filter(loc => loc.name && loc.name.trim() !== "" && loc.name !== "Undefined")
                    .map(loc => ({
                        coords: loc.coords,
                        name: loc.name,
                        description: loc.description
                    }));
                const surroundingJson = JSON.stringify(surrounding);

                let prompt = promptTemplate
                    .replace(/{count}/g, count)
                    .replace(/{characters}/g, characters)
                    .replace(/{static}/g, staticKnowledge)
                    .replace(/{recent}/g, recentHistory)
                    .replace(/{current_coords}/g, currentCoords)
                    .replace(/{surrounding_locations}/g, surroundingJson)
                    .replace(/{target_coords}/g, targetCoordsJson);

                // Append requirements to guarantee robust JSON response
                prompt += `\n\n### IMPORTANT OUTPUT FORMAT REQUIREMENT
You MUST return a raw JSON object containing a "locations" array. The array must contain exactly ${count} objects, each representing one of the requested target coordinates. Provide ONLY the JSON response without markdown code blocks, text prefix/suffix, or commentary.

Target Coordinates requested: ${targetCoordsJson}

JSON Schema:
{
  "locations": [
    {
      "coords": { "x": number, "y": number },
      "name": "Distinct Location Name",
      "description": "Short, immersive description of the location (1-2 sentences).",
      "prompt": "Detailed prompt describing the visual design and sensory details of the location."
    }
  ]
}`;
                return prompt;
            },

            /**
             * Builds the prompt for the Scriptwriter casting step.
             * @param {Array} pool - The pool of active characters.
             * @param {Array} narrators - The active narrators.
             * @param {string} userAction - The latest user input.
             * @param {Object} state - The current narrative state.
             * @returns {string} - The constructed prompt.
             */
            buildSwarmCastingPrompt(pool, narrators, userAction, state) {
                const activeChars = pool.map(c => c.name).join(', ');
                const narratorNames = narrators.map(n => n.name).join(', ');
                const userChar = state.characters.find(c => c.is_user);
                const userCharName = userChar ? userChar.name : 'User';

                const recentHistory = (state.chat_history || [])
                    .filter(m => m && m.type === 'chat' && !m.isHidden)
                    .slice(-10)
                    .map(m => {
                        const char = ReactiveStore.getCharacter(m.character_id);
                        return `${char ? char.name : 'System'}: ${m.content}`;
                    }).join('\n');

                const tag = (userAction || "").includes('[DIRECTIVE]:') ? "USER DIRECTIVE" : "USER INPUT";

                let prompt = "### AGENT INSTRUCTION\nYou are a scriptwriter casting the next scene in an ongoing roleplay. Your goal is to select the most relevant characters to drive the narrative forward.\n\n";

                // 1. CHARACTER POOL
                prompt += "### CHARACTER POOL\n" + (activeChars || "None") + "\n\n";

                // 2. ACTIVE NARRATORS
                prompt += "### ACTIVE NARRATORS\n" + (narratorNames || "None") + "\n\n";

                // 3. RECENT HISTORY
                prompt += "### RECENT HISTORY\n" + recentHistory + "\n\n";

                // 4. USER DIRECTIVE
                prompt += "### " + tag + "\n" + (userAction || "None") + "\n\n";

                prompt += "[OUTPUT INSTRUCTION]\n" +
                    "Review the roleplay history and user input above and provide ONLY the cast for the next scene.\n" +
                    "Rules:\n" +
                    "1. Provide a brief one-sentence reasoning for your choices.\n" +
                    "2. Names must match exactly from the lists above.\n" +
                    "3. Do NOT select \"" + userCharName + "\".\n" +
                    "4. You must include the following tags at the end of your response:\n" +
                    "[CANDIDATES]: Name1, Name2, Name3\n" +
                    "[PRIMARY SPEAKER]: Name";

                return prompt;
            },

            /**
             * Creates a replacement function for template strings.
             * @param {Object} contextCharacter - The character context.
             * @returns {Function} - The replacer function.
             * @private
             */
            _getReplacer(contextCharacter) {
                const state = StateManager.getState();
                const userChar = state.characters.find(c => c.is_user);
                const characterName = contextCharacter ? contextCharacter.name : '';
                const userName = userChar ? userChar.name : 'You';
                return (text) => {
                    if (typeof text !== 'string') return '';
                    let processedText = text.replace(/{character}/g, characterName);
                    processedText = processedText.replace(/{user}/g, userName);
                    return processedText;
                };
            },

            /**
             * Constructs a textual summary of current character stats for prompt injection.
             * @param {Object} state - The current narrative state.
             * @returns {string} A formatted stats context string, or empty string if no stats exist.
             * @private
             */
            _buildStatsContext(state) {
                if (!state.character_stats || !state.enableStats) return '';
                const statsObj = state.character_stats;
                const chars = state.characters || [];
                const lines = [];

                for (const char of chars) {
                    const charStats = statsObj[char.id];
                    if (!charStats || charStats.length === 0) continue;
                    const statStr = charStats.map(s => `${s.name}: ${Math.round(s.value)}/${s.max || 100}`).join(', ');
                    lines.push(`${char.name}: ${statStr}`);
                }

                return lines.length > 0 ? lines.join('\n') : '';
            },

            /**
             * Retrieves a slice of chat history, filtering out hidden messages in a smart way.
             * @param {Array} history - The chat history.
             * @param {number} maxSpaces - The maximum number of space characters to include (proxy for token limit).
             * @returns {Array} - The history slice.
             * @private
             */
            _getSmartHistorySlice(history, maxSpaces = 8000, activeCharId = null) {
                if (!Array.isArray(history)) return [];

                // 1. Hard Filter: Remove private messages not intended for the current active character.
                // Covers lore reveals and direct (text mode) messages. This ensures private content never
                // reaches the final prompt components for unintended speakers.
                const filteredHistory = history.filter(msg => {
                    if (!msg) return false;
                    if (msg.exclusive_to_char_id && msg.exclusive_to_char_id !== activeCharId) {
                        return false;
                    }
                    return true;
                });

                let currentSpaceCount = 0;
                let startIndex = filteredHistory.length;

                // 2. Loop backwards through the filtered set to determine the token-limit slice
                for (let i = filteredHistory.length - 1; i >= 0; i--) {
                    const msg = filteredHistory[i];

                    let spacesInMessage = 0;
                    if (!msg.isHidden) {
                        const content = UTILITY.stripThinking(msg.content || '');
                        spacesInMessage = (content.split(" ").length - 1);
                    }

                    // If adding this message would exceed the limit, stop here
                    if (currentSpaceCount + spacesInMessage > maxSpaces) {
                        break;
                    }

                    // Include this message
                    startIndex = i;
                    currentSpaceCount += spacesInMessage;
                }
                return filteredHistory.slice(startIndex);
            },

            /**
             * Whether a history entry produces text in a reply prompt. Agent note depth counts only
             * these, so "2 messages back" means two things the model actually sees.
             * @param {Object} msg
             * @returns {boolean}
             * @private
             */
            _isPromptVisible(msg) {
                if (!msg) return false;
                if (msg.type === 'chat') return !msg.isHidden;
                return msg.type === 'lore_reveal' || msg.type === 'system_event';
            },

            /**
             * Returns the history with agent notes slotted in as `agent_note` entries at their depth.
             * The original array is left alone, because image indexes are counted against it.
             * @param {Array} history
             * @param {Object|null} layout - AgentSchema.layoutNotes result
             * @returns {Array}
             * @private
             */
            _withAgentNotes(history, layout) {
                if (!layout) return history;
                const toEntry = note => ({ type: 'agent_note', role: note.role, content: note.text });
                const out = [];
                let visibleIndex = 0;
                history.forEach(msg => {
                    if (this._isPromptVisible(msg)) {
                        (layout.beforeMessage[visibleIndex] || []).forEach(note => out.push(toEntry(note)));
                        visibleIndex++;
                    }
                    out.push(msg);
                });
                layout.end.forEach(note => out.push(toEntry(note)));
                return out;
            },

            /**
             * Plain-text block for notes placed outside the conversation (before/top).
             * @param {Object[]} notes
             * @returns {string}
             * @private
             */
            _agentNotesText(notes) {
                return notes.map(note => `${AgentSchema.noteHeading(note.role)}\n${note.text}`).join('\n\n');
            },

            /**
             * Safe, read-only method to retrieve prompt components without mutating state.
             * @param {string} charToActId - The ID of the character acting.
             * @param {Array|null} [historyOverride=null] - Optional override for chat history.
             * @param {string|null} [customInstruction=null] - Optional custom instruction.
             * @returns {Object|null} The prompt components object.
             */
            getPromptComponents(charToActId, historyOverride = null, customInstruction = null, isDirectMessage = false) {
                const state = StateManager.getState();
                const charToAct = ReactiveStore.getCharacter(charToActId);
                if (!charToAct) return null;

                const replacer = this._getReplacer(charToAct);
                let modelInstructions = charToAct.model_instructions || state.system_prompt;
                if (state.gameState && state.enableJournal !== false) {
                    const gameStateXml = this.buildGameStateXml(state.gameState);
                    if (gameStateXml) {
                        modelInstructions = gameStateXml + "\n\n" + modelInstructions;
                    }
                }

                let locationContext = '';
                if (state.worldMap && state.worldMap.grid.length > 0) {
                    const { grid, currentLocation, path } = state.worldMap;
                    const currentLoc = grid.find(l => l.coords.x === currentLocation.x && l.coords.y === currentLocation.y);

                    if (currentLoc && currentLoc.name) {
                        locationContext += `### Current Location: ${currentLoc.name}\n`;
                        if (currentLoc.prompt) locationContext += `${currentLoc.prompt}\n\n`;
                        else locationContext += `(No detailed description available.)\n\n`;

                        if (currentLoc.local_static_entries && currentLoc.local_static_entries.length > 0) {
                            locationContext += "### Location-Specific Knowledge\n";
                            locationContext += currentLoc.local_static_entries
                                .map(l => `Title: ${l.title}\nContent: ${replacer(l.content)}`)
                                .join('\n\n') + "\n\n";
                        }
                    }

                    if (currentLoc) {
                        const directions = [
                            { dir: 'North', x: 0, y: -1 }, { dir: 'South', x: 0, y: 1 },
                            { dir: 'East', x: 1, y: 0 }, { dir: 'West', x: -1, y: 0 },
                            { dir: 'Northeast', x: 1, y: -1 }, { dir: 'Northwest', x: -1, y: -1 },
                            { dir: 'Southeast', x: 1, y: 1 }, { dir: 'Southwest', x: -1, y: 1 }
                        ];
                        const validAdjacentLocations = directions
                            .map(({ dir, x, y }) => {
                                const adjLoc = grid.find(l => l.coords.x === currentLocation.x + x && l.coords.y === currentLocation.y + y);
                                if (adjLoc && adjLoc.name && adjLoc.description) {
                                    return `- (${dir}): ${adjLoc.name} - ${adjLoc.description}`;
                                }
                                return null;
                            })
                            .filter(Boolean);
                        if (validAdjacentLocations.length > 0) {
                            locationContext += '### Adjacent Locations\n' + validAdjacentLocations.join('\n') + '\n\n';
                        }
                    }

                    if (path && path.length > 0) {
                        const pathNames = path.map(p => grid.find(l => l.coords.x === p.x && l.coords.y === p.y)?.name).filter(Boolean).join(' -> ');
                        if (pathNames) locationContext += `### Travel Path to Destination: ${pathNames}\n`;
                    }
                }

                const history = historyOverride || state.chat_history || [];
                const smartHistory = this._getSmartHistorySlice(history, 8000, charToActId);

                const filteredHistory = history.filter(msg => {
                    if (!msg) return false;
                    if (msg.exclusive_to_char_id && msg.exclusive_to_char_id !== charToActId) {
                        return false;
                    }
                    return true;
                });
                const prunedCount = filteredHistory.length - smartHistory.length;

                // Normalize private text messages into chat-shaped entries so every downstream
                // formatter (default and all KoboldCPP template variants) renders them. Without
                // this they fall through the type checks and vanish from the prompt entirely.
                const promptHistory = smartHistory.map(msg => {
                    if (msg && msg.type === 'dm') {
                        return { ...msg, type: 'chat', content: `[via text] ${msg.content || ''}` };
                    }
                    return msg;
                });

                return {
                    system_prompt: replacer(modelInstructions),
                    static_entries: (state.static_entries || []).map(l => `### ${l.title}\n${replacer(l.content)}`).join('\n\n'),
                    characters: [...(state.characters || []), ...ReactiveStore.getActiveLocationCharacters()]
                        .filter(c => c.is_active)
                        .filter(c => {
                            if (c.is_narrator) {
                                return c.id === charToActId;
                            }
                            return true;
                        })
                        .map(c => {
                            const isActing = (c.id === charToActId);
                            const desc = (state.evolved_characters && state.evolved_characters[c.id]) ? state.evolved_characters[c.id] : c.description;

                            if (isActing) {
                                return `### Character (YOU): ${c.name}\n\n${replacer(desc)}`;
                            } else {
                                const appearance = c.appearance || c.physical_description || c.short_description || "Unknown appearance.";
                                return `### Character (Present): ${c.name}\n### Outward Appearance\n${replacer(appearance)}`;
                            }
                        })
                        .join('\n\n'),
                    history: promptHistory,
                    charToAct: charToAct,
                    location_context: locationContext,
                    stats_context: this._buildStatsContext(state),
                    dynamic_entries: '',
                    customInstruction: customInstruction,
                    isDirectMessage: isDirectMessage,
                    prunedCount: prunedCount
                };
            },

            /**
             * Builds the main prompt for the AI.
             * @param {string} charToActId - The ID of the character acting.
             * @param {boolean} [isForUser=false] - Whether the prompt is for the user.
             * @param {Array|null} [historyOverride=null] - Optional override for chat history (e.g. for regeneration).
             * @returns {string} - The constructed prompt.
             */
            buildPrompt(charToActId, isForUser = false, historyOverride = null, customInstruction = null, isDirectMessage = false) {
                const state = StateManager.getState();
                const charToAct = ReactiveStore.getCharacter(charToActId);
                if (!charToAct) return "";

                const replacer = this._getReplacer(charToAct);
                const components = this.getPromptComponents(charToActId, historyOverride, customInstruction, isDirectMessage);
                if (!components) return "";
                components.isForUser = isForUser;

                // Agents add to character replies only: not to text written for the user, and not to
                // Text Mode threads, which have their own voice rules.
                components.agent_notes = (!isForUser && !isDirectMessage && typeof AgentController !== 'undefined')
                    ? AgentController.buildNoteLayout(charToAct, components.history.filter(m => this._isPromptVisible(m)).length)
                    : null;

                let result;
                if (state.apiProvider === 'koboldcpp') {
                    result = this.buildKoboldTemplatedPrompt(components, replacer);
                } else {
                    result = this.buildDefaultPrompt(components, replacer);
                }

                // If result is already an object (from sub-methods), return it.
                // Otherwise, wrap it and extract images.
                if (typeof result === 'object' && result.text) return result;

                const images = [];
                components.history.forEach((msg, idx) => {
                    if (msg.images && msg.images.length > 0) {
                        images.push({ index: idx, imageIds: msg.images });
                    }
                });

                return { text: result, images: images };
            },

            /**
             * Formats an elapsed millisecond span into a natural phrase for the model.
             * @param {number} ms - Elapsed milliseconds.
             * @returns {string} - A human phrase such as "about 3 days".
             * @private
             */
            _formatElapsed(ms) {
                const mins = Math.floor(ms / 60000);
                if (mins < 2) return "less than a minute";
                if (mins < 60) return `about ${mins} minutes`;
                const hours = Math.floor(mins / 60);
                if (hours < 24) return `about ${hours} hour${hours === 1 ? '' : 's'}`;
                const days = Math.floor(hours / 24);
                if (days < 7) return `about ${days} day${days === 1 ? '' : 's'}`;
                const weeks = Math.floor(days / 7);
                if (weeks < 5) return `about ${weeks} week${weeks === 1 ? '' : 's'}`;
                const months = Math.floor(days / 30);
                return `about ${months} month${months === 1 ? '' : 's'}`;
            },

            /**
             * Builds the custom instruction that governs Text Mode (direct message) behavior.
             * Passed to buildPrompt() as the customInstruction so it layers over the normal persona.
             * @param {string} charId - The character being texted.
             * @param {Array} thread - The direct message thread for this character.
             * @returns {string} - The constructed instruction block.
             */
            buildDirectMessageInstruction(charId, thread = []) {
                const state = StateManager.getState();
                const char = ReactiveStore.getCharacter(charId);
                const userChar = (state.characters || []).find(c => c.is_user);
                const userName = userChar ? userChar.name : 'the user';

                const template = state.prompt_text_mode || UTILITY.getDefaultSystemPrompts().prompt_text_mode;

                // {emoji_rule}: driven by the Allow Emoji toggle.
                const emojiRule = state.dmAllowEmoji
                    ? '- Emoji are allowed, but use them sparingly and only where the character would naturally.'
                    : '- Do NOT use emoji, emoticons, or kaomoji of any kind.';

                // {elapsed_time}: driven by the Timestamp Awareness toggle. Empty when there is
                // no prior message to measure against, or the toggle is off.
                let elapsedBlock = '';
                if (state.dmTimestampAwareness !== false && thread.length > 0) {
                    const last = thread[thread.length - 1];
                    if (last && last.timestamp) {
                        const elapsed = Date.now() - new Date(last.timestamp).getTime();
                        if (elapsed > 0) {
                            elapsedBlock = `\n### ELAPSED TIME\n`
                                + `Time since the previous message in this thread: ${this._formatElapsed(elapsed)}. `
                                + `React naturally if that gap is long enough to be worth mentioning. `
                                + `Do not mention it if it is short.\n`;
                        }
                    }
                }

                return template
                    .replace(/{character_name}/g, char ? char.name : 'the character')
                    .replace(/{user_character}/g, userName)
                    .replace(/{emoji_rule}/g, emojiRule)
                    .replace(/{elapsed_time}/g, elapsedBlock);
            },

            /**
             * Builds the prompt for the background generation of a Living Persona.
             * @param {string} characterId - The ID of the character to evolve.
             * @returns {string} - The constructed prompt.
             */
            /**
             * Builds the prompt that fuses a message and its reply into one passage.
             * @param {Object} firstMsg - The earlier message.
             * @param {Object} secondMsg - The reply that overlaps it.
             * @returns {string} - The constructed prompt, or "" if either side is empty.
             */
            buildCombineMessagesPrompt(firstMsg, secondMsg) {
                if (!firstMsg || !secondMsg) return "";
                const state = StateManager.getState();
                const nameOf = (m) => {
                    const c = ReactiveStore.getCharacter(m.character_id);
                    return c ? c.name : 'Unknown';
                };

                const template = state.prompt_combine_messages
                    || UTILITY.getDefaultSystemPrompts().prompt_combine_messages;

                return template
                    .replace(/\{first_speaker\}/g, nameOf(firstMsg))
                    .replace(/\{first_passage\}/g, firstMsg.content || '')
                    .replace(/\{second_speaker\}/g, nameOf(secondMsg))
                    .replace(/\{second_passage\}/g, secondMsg.content || '');
            },

            buildLivingPersonaPrompt(characterId) {
                const state = StateManager.getState();
                const char = ReactiveStore.getCharacter(characterId);
                if (!char) return "";

                const promptTemplate = state.prompt_living_persona_gen || UTILITY.getDefaultSystemPrompts().prompt_living_persona_gen;
                const basePersona = char.description;

                // Get the last N messages, excluding the *very last* one per requirements
                const chatHistory = state.chat_history || [];
                const visibleHistory = chatHistory.filter(m => m.type === 'chat' && !m.isHidden);
                const historySlice = visibleHistory.slice(-21, -1); // Last 20 messages, skip the newest

                const transcript = historySlice.map(msg => {
                    const speaker = ReactiveStore.getCharacter(msg.character_id) || { name: 'Unknown' };
                    return `${speaker.name}: ${UTILITY.stripThinking(msg.content || '')}`;
                }).join('\n\n');

                return promptTemplate
                    .replace(/\{base_persona\}/g, basePersona)
                    .replace(/\{transcript\}/g, transcript);
            },

            /**
             * Builds the prompt for the objective description step.
             * @param {string} characterId - The character ID.
             * @param {string} userAction - The current user input/action.
             * @returns {string} - The constructed prompt.
             */
            buildObjectivityDescriptionPrompt(characterId, userAction = "") {
                const state = StateManager.getState();
                const char = ReactiveStore.getCharacter(characterId) || { name: 'Unknown' };
                const promptTemplate = state.prompt_objectivity_description || UTILITY.getDefaultSystemPrompts().prompt_objectivity_description;

                // Use last 10 messages for context (strictly chat history, no lore)
                const history = (state.chat_history || [])
                    .filter(m => m && m.type === 'chat' && !m.isHidden)
                    .slice(-10);
                const transcript = history.map(msg => {
                    const speaker = ReactiveStore.getCharacter(msg.character_id) || { name: 'Unknown' };
                    return `${speaker.name}: ${UTILITY.stripThinking(msg.content || '')}`;
                }).join('\n\n');

                // As per Swarm V2: Only recent history is included in this phase
                let prompt = "### AGENT INSTRUCTION\n" +
                    "You are an Objectivity Analyst. Your job is to describe the current state of the scene factually and neutrally based on the recent history provided below.\n" +
                    "Focus on physical location, character positions, and immediate sensory details. Do not include character thoughts or dialogue.\n\n" +
                    "### RECENT HISTORY\n" + transcript + "\n\n";

                const tag = (userAction || "").includes('[DIRECTIVE]:') ? "USER DIRECTIVE" : "USER INPUT";
                prompt += "### " + tag + "\n" + (userAction || "None") + "\n\n";

                return prompt;
            },

            /**
             * Builds the prompt for the subjective thought step.
             * @param {string} characterId - The character ID.
             * @param {string} objectiveDescription - The previously generated objective reality.
             * @returns {string} - The constructed prompt.
             */
            buildObjectivityThoughtPrompt(characterId, objectiveDescription) {
                const state = StateManager.getState();
                const char = ReactiveStore.getCharacter(characterId);
                if (!char) return "";
                const promptTemplate = state.prompt_objectivity_thoughts || UTILITY.getDefaultSystemPrompts().prompt_objectivity_thoughts;

                // Gather character specifics
                const goals = char.personal_goal || "Survive and pursue personal interests.";

                // Retrieve relationships from matrix if available
                const relationships = (state.relationship_matrix || [])
                    .filter(rel => rel.includes(char.name))
                    .join('\n') || "No specific relationship data established.";

                // Physical/Emotional Sensations (Heuristics or derived from evolved persona)
                const sensations = "Tired, alert, and processing the immediate impact of the scene.";

                return promptTemplate
                    .replace(/\{character_name\}/g, char.name)
                    .replace(/\{objective_description\}/g, objectiveDescription)
                    .replace(/\{personal_goal\}/g, goals)
                    .replace(/\{relationships\}/g, relationships)
                    .replace(/\{sensations\}/g, sensations);
            },

            /**
             * Builds the default prompt format.
             * @param {Object} components - The prompt components.
             * @param {Function} replacer - The replacer function.
             * @returns {string}
             */
            buildDefaultPrompt(components, replacer) {
                const state = StateManager.getState();
                const agentNotes = components.agent_notes || null;
                let p = "";
                if (agentNotes && agentNotes.before.length) p += this._agentNotesText(agentNotes.before) + "\n\n";
                p += components.system_prompt + "\n\n";
                if (agentNotes && agentNotes.top.length) p += this._agentNotesText(agentNotes.top) + "\n\n";
                if (components.location_context) p += "## LOCATION CONTEXT\n" + components.location_context + "\n\n";
                if (components.stats_context) p += "## CHARACTER STATS\n" + components.stats_context + "\n\n";

                if (state.narrative_timeline && state.narrative_timeline.length > 0) {
                    p += "## THE STORY SO FAR (TIMELINE)\n" + state.narrative_timeline.map(line => `- ${line}`).join('\n') + "\n\n";
                }

                if (state.relationship_matrix && state.relationship_matrix.length > 0) {
                    p += "## CHARACTER RELATIONSHIPS\n" + state.relationship_matrix.join('\n') + "\n\n";
                }

                if (components.static_entries) p += "## WORLD KNOWLEDGE\n" + components.static_entries + "\n\n";
                // Note: Dynamic entries usually injected into chat history as 'lore_reveal', but can be added here if architectural preference changes.
                if (components.characters) p += "## CHARACTERS\n" + components.characters + "\n\n";

                const exampleDialogue = (state.chat_history || []).filter(m => m && m.isHidden);
                if (exampleDialogue.length > 0) {
                    let examplesText = "";
                    exampleDialogue.forEach(msg => {
                        if (!msg) return;
                        const char = ReactiveStore.getCharacter(msg.character_id);
                        if (char) examplesText += `${char.name}: ${replacer(UTILITY.stripThinking(msg.content || ''))}\n`;
                    });
                    if (examplesText) {
                        p += "## EXAMPLE DIALOGUE\n" + examplesText + "\n";
                    }
                }

                // --- PROMPT CACHING BREAKPOINT ---
                // Everything above this point is considered "Static" and can be cached by supported APIs (like OpenRouter/Anthropic).
                p += "\n<|ELLIPSIS_CACHE_BREAK|>\n";

                p += "## RECENT CONVERSATION & EVENTS\n";
                this._withAgentNotes(components.history, agentNotes).forEach(msg => {
                    // Safety Checks
                    if (!msg) return;
                    if (msg.type === 'chat' && msg.isHidden) return;

                    if (msg.type === 'chat') {
                        const char = ReactiveStore.getCharacter(msg.character_id);
                        const name = char ? char.name : (msg.character_id === 'user' ? 'User' : 'Character');
                        p += `### ${name}:\n${replacer(UTILITY.stripThinking(msg.content || ''))}\n\n`;
                        // Visual Lore attached to this turn. Kept beside its message so it
                        // leaves the prompt when the message scrolls out of the window,
                        // rather than needing its own rule for when a detail stops mattering.
                        if (msg.item_ids && msg.item_ids.length && typeof VisualLoreService !== 'undefined') {
                            const detail = VisualLoreService.buildContextBlock(msg.item_ids);
                            if (detail) p += `${detail}\n\n`;
                        }
                    } else if (msg.type === 'agent_note') {
                        p += `${AgentSchema.noteHeading(msg.role)}\n${msg.content}\n\n`;
                    } else if (msg.type === 'lore_reveal') {
                        p += `### System Note:\n${replacer(UTILITY.stripThinking(msg.content || ''))}\n\n`;
                    } else if (msg.type === 'system_event') {
                        p += `### System Event: ${replacer(UTILITY.stripThinking(msg.content || ''))}\n\n`;
                    }
                });
                p += "\n## INSTRUCTION\n";

                if (components.customInstruction) {
                    p += components.customInstruction;
                } else {
                    p += components.isForUser ? `Generate the next creative response for the user's character, ${components.charToAct.name}.` : `Generate the next response for ${components.charToAct.name}. Stay in character.`;
                }



                // Response Length Instruction
                const responseLength = state.responseLength || 'normal';
                // Text Mode sets its own brevity rules; the narrative length setting would fight them.
                if (!components.charToAct.is_narrator && !components.isDirectMessage) {
                    if (responseLength === 'short') p += " Keep the response concise and under two sentences, focusing only on the character's next words and actions.";
                    else if (responseLength === 'medium') p += " Keep the response between three to six sentences, including the character's next words and actions written with descriptive language.";
                    else if (responseLength === 'long') p += " Keep the response between two and four paragraphs. Be descriptive, verbose, and detailed in your response, providing this character's dialogue and actions, as well as full sensory descriptions of the surroundings, characters, and event.";
                    else if (responseLength === 'novel') p += " Continue writing a long-form addition to the text that builds on the current actions, describes the scene, and contributes to world-building. Include full sensory descriptions of the surroundings, characters, and events.";
                }

                p += " Do not repeat the character's name in the response itself.\n### " + components.charToAct.name + ":";

                // Extract images from history
                const images = [];
                components.history.forEach((msg, idx) => {
                    if (msg.images && msg.images.length > 0) {
                        images.push({ index: idx, imageIds: msg.images });
                    }
                });

                return { text: p, images: images };
            },

            /**
             * Builds a prompt formatted for KoboldCPP templates.
             * @param {Object} components - The prompt components.
             * @param {Function} replacer - The replacer function.
             * @returns {string}
             */
            buildKoboldTemplatedPrompt(components, replacer) {
                const state = StateManager.getState();
                const template = state.koboldcpp_template || 'none';

                // 1. Construct System/Context Block
                const agentNotes = components.agent_notes || null;
                const promptHistory = this._withAgentNotes(components.history, agentNotes);
                let system = [components.system_prompt];
                if (agentNotes && agentNotes.before.length) system.unshift(this._agentNotesText(agentNotes.before));
                if (agentNotes && agentNotes.top.length) system.push(this._agentNotesText(agentNotes.top));

                // Location
                if (components.location_context) system.push("## LOCATION CONTEXT\n" + components.location_context);

                // Stats
                if (components.stats_context) system.push("## CHARACTER STATS\n" + components.stats_context);

                // Static/World Knowledge
                system.push("## WORLD KNOWLEDGE\n" + components.static_entries);

                // Characters
                system.push("## CHARACTERS\n" + components.characters);

                // Example Dialogue
                const exampleDialogue = (state.chat_history || []).filter(m => m && m.isHidden);
                if (exampleDialogue.length > 0) {
                    let examples = "";
                    exampleDialogue.forEach(msg => {
                        if (!msg) return;
                        const char = ReactiveStore.getCharacter(msg.character_id);
                        if (char) examples += `${char.name}: ${replacer(UTILITY.stripThinking(msg.content || ''))}\n`;
                    });
                    if (examples) {
                        system.push("## EXAMPLE DIALOGUE\n" + examples);
                    }
                }

                const system_prompt_str = system.join('\n\n');

                let instruction = "";
                if (components.customInstruction) {
                    instruction = components.customInstruction;
                } else {
                    instruction = components.isForUser
                        ? `Generate the next creative response for the user's character, ${components.charToAct.name}.`
                        : `Generate the next response for ${components.charToAct.name}. Stay in character.`;
                }

                // Response Length Instruction
                const responseLength = state.responseLength || 'normal';
                // Text Mode sets its own brevity rules; the narrative length setting would fight them.
                if (!components.charToAct.is_narrator && !components.isDirectMessage) {
                    if (responseLength === 'short') instruction += " Keep the response concise and under two sentences, focusing only on the character's next words and actions.";
                    else if (responseLength === 'medium') instruction += " Keep the response between three to six sentences, including the character's next words and actions written with descriptive language.";
                    else if (responseLength === 'long') instruction += " Keep the response between two and four paragraphs. Be descriptive, verbose, and detailed in your response, providing this character's dialogue and actions, as well as full sensory descriptions of the surroundings, characters, and event.";
                    else if (responseLength === 'novel') instruction += " Continue writing a long-form addition to the text that builds on the current actions, describes the scene, and contributes to world-building. Include full sensory descriptions of the surroundings, characters, and events.";
                }

                instruction += " Do not repeat the character's name in the response itself.";

                if (template === 'none') return this.buildDefaultPrompt(components, replacer);

                // Helper for uniform system message formatting across templates
                const formatSystemMsg = (msg) => {
                    if (msg.type === 'agent_note') {
                        return `${AgentSchema.noteHeading(msg.role)}\n${msg.content}`;
                    }
                    if (msg.type === 'lore_reveal') {
                        return `### System Note:\n${replacer(UTILITY.stripThinking(msg.content || ''))}`;
                    } else if (msg.type === 'system_event') {
                        return `### System Event: ${replacer(UTILITY.stripThinking(msg.content || ''))}`;
                    }
                    return '';
                };

                // --- LLAMA 3 ---
                if (template === 'llama3') {
                    const history_llama3 = promptHistory.map(msg => {
                        if (!msg || (msg.type === 'chat' && msg.isHidden)) return null;
                        let role = 'user';
                        let content = '';
                        if (msg.type === 'chat') {
                            const char = ReactiveStore.getCharacter(msg.character_id);
                            const is_user = char ? char.is_user : (msg.character_id === 'user');
                            const name = char ? char.name : (is_user ? 'User' : 'Character');
                            role = is_user ? 'user' : 'assistant';
                            content = `${name}:\n${replacer(UTILITY.stripThinking(msg.content || ''))}`;
                        } else {
                            role = 'system';
                            content = formatSystemMsg(msg);
                        }
                        return `<|start_header_id|>${role}<|end_header_id|>\n\n${content}<|eot_id|>`;
                    }).filter(Boolean).join('\n');

                    return `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${system_prompt_str}<|eot_id|>\n${history_llama3}\n<|start_header_id|>user<|end_header_id|>\n\n${instruction}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n${components.charToAct.name}:\n`;
                }

                // --- GEMMA (Google) ---
                if (template === 'gemma') {
                    const history_gemma = promptHistory.map(msg => {
                        if (!msg || (msg.type === 'chat' && msg.isHidden)) return null;
                        let role = 'user';
                        let content = '';

                        if (msg.type === 'chat') {
                            const char = ReactiveStore.getCharacter(msg.character_id);
                            const is_user = char ? char.is_user : (msg.character_id === 'user');
                            const name = char ? char.name : (is_user ? 'User' : 'Character');
                            role = is_user ? 'user' : 'model';
                            content = `${name}:\n${replacer(UTILITY.stripThinking(msg.content || ''))}`;
                        } else {
                            // System events injected as user context for Gemma
                            return `<start_of_turn>user\n${formatSystemMsg(msg)}<end_of_turn>`;
                        }

                        return `<start_of_turn>${role}\n${content}<end_of_turn>`;
                    }).filter(Boolean).join('\n');

                    return `<start_of_turn>user\n${system_prompt_str}<end_of_turn>\n${history_gemma}\n<start_of_turn>user\n${instruction}<end_of_turn>\n<start_of_turn>model\n${components.charToAct.name}:\n`;
                }

                // --- PHI-3 (Microsoft) ---
                if (template === 'phi3') {
                    const history_phi = promptHistory.map(msg => {
                        if (!msg || (msg.type === 'chat' && msg.isHidden)) return null;
                        let role = 'user';
                        let content = '';
                        if (msg.type === 'chat') {
                            const char = ReactiveStore.getCharacter(msg.character_id);
                            const is_user = char ? char.is_user : (msg.character_id === 'user');
                            const name = char ? char.name : (is_user ? 'User' : 'Character');
                            role = is_user ? 'user' : 'assistant';
                            content = `${name}:\n${replacer(UTILITY.stripThinking(msg.content || ''))}`;
                        } else {
                            return `<|system|>\n${formatSystemMsg(msg)}<|end|>`;
                        }

                        return `<|${role}|>\n${content}<|end|>`;
                    }).filter(Boolean).join('\n');

                    return `<|system|>\n${system_prompt_str}<|end|>\n${history_phi}\n<|user|>\n${instruction}<|end|>\n<|assistant|>\n${components.charToAct.name}:\n`;
                }

                // --- MISTRAL ---
                if (template === 'mistral') {
                    const history_str = promptHistory.map(msg => {
                        if (!msg || (msg.type === 'chat' && msg.isHidden)) return null;
                        if (msg.type === 'chat') {
                            const char = ReactiveStore.getCharacter(msg.character_id);
                            const is_user = char ? char.is_user : (msg.character_id === 'user');
                            const name = char ? char.name : (is_user ? 'User' : 'Character');
                            return `${is_user ? 'user' : 'assistant'}:${name}:\n${replacer(UTILITY.stripThinking(msg.content || ''))}`;
                        } else {
                            return `system:${formatSystemMsg(msg)}`;
                        }
                    }).filter(Boolean).join('\n');
                    return `<s>[INST] ${system_prompt_str}\n\n${history_str}\n\n${instruction} [/INST]`;
                }

                // --- CHATML ---
                if (template === 'chatml') {
                    const history_chatml = promptHistory.map(msg => {
                        if (!msg || (msg.type === 'chat' && msg.isHidden)) return null;
                        let role = 'system';
                        let content = '';
                        if (msg.type === 'chat') {
                            const char = ReactiveStore.getCharacter(msg.character_id);
                            const is_user = char ? char.is_user : (msg.character_id === 'user');
                            const name = char ? char.name : (is_user ? 'User' : 'Character');
                            role = is_user ? 'user' : 'assistant';
                            content = `${name}:\n${replacer(UTILITY.stripThinking(msg.content || ''))}`;
                        } else {
                            content = formatSystemMsg(msg);
                        }
                        return `<|im_start|>${role}\n${content}<|im_end|>`;
                    }).filter(Boolean).join('\n');
                    return `<|im_start|>system\n${system_prompt_str}<|im_end|>\n${history_chatml}\n<|im_start|>user\n${instruction}<|im_end|>\n<|im_start|>assistant\n${components.charToAct.name}:\n`;
                }

                // --- ALPACA ---
                if (template === 'alpaca') {
                    const history_str = promptHistory.map(msg => {
                        if (!msg || (msg.type === 'chat' && msg.isHidden)) return null;
                        if (msg.type === 'chat') {
                            const char = ReactiveStore.getCharacter(msg.character_id);
                            const name = char ? char.name : (msg.character_id === 'user' ? 'User' : 'Character');
                            return `${name}: ${replacer(UTILITY.stripThinking(msg.content || ''))}`;
                        } else {
                            return formatSystemMsg(msg);
                        }
                    }).filter(Boolean).join('\n');
                    return `### Instruction:\n${system_prompt_str}\n\n${history_str}\n\n${instruction}\n\n### Response:\n`;
                }

                return this.buildDefaultPrompt(components, replacer);
            },

            /**
             * Builds the prompt for the Event Master agent.
             * @returns {string} - The constructed prompt.
             */
            /**
             * Builds the scene analysis prompt for the MusicService.
             * This prompt is sent to the user's configured text LLM, NOT to Lyria directly.
             * The LLM analyzes the scene and outputs a tight music generation prompt.
             * @returns {string} - The constructed prompt.
             */
            buildMusicPrompt() {
                const state = StateManager.getState();
                const systemPrompt = (typeof MusicService !== 'undefined') ? MusicService.CONSTANTS.PROMPT_SYSTEM : '';

                // Story tags / genre
                const tags = (state.tags || []).join(', ') || 'unspecified genre';

                // Current location
                let locationContext = '';
                if (state.worldMap && state.worldMap.grid && state.worldMap.currentLocation) {
                    const loc = state.worldMap.grid.find(l =>
                        l.coords.x === state.worldMap.currentLocation.x &&
                        l.coords.y === state.worldMap.currentLocation.y
                    );
                    if (loc) {
                        locationContext = `\nCurrent Location: ${loc.name}${loc.description ? ' — ' + loc.description : ''}`;
                    }
                }

                // Active characters
                const activeChars = (state.characters || [])
                    .filter(c => c.is_active && !c.is_user)
                    .map(c => c.name)
                    .join(', ');

                // Recent chat (last 10 messages, condensed)
                const recentHistory = (state.chat_history || [])
                    .slice(-10)
                    .filter(m => m && m.type === 'chat' && !m.isHidden)
                    .map(m => {
                        const char = (state.characters || []).find(c => c.id === m.character_id);
                        // Truncate long messages to conserve tokens
                        const stripped = UTILITY.stripThinking(m.content || '');
                        const content = stripped.length > 200 ? stripped.substring(0, 200) + '...' : stripped;
                        return `${char ? char.name : 'Unknown'}: ${content}`;
                    })
                    .join('\n');

                return `${systemPrompt}

### Scene Context
Genre/Tags: ${tags}${locationContext}
Active Characters: ${activeChars || 'None specified'}

### Recent Chat History
${recentHistory || '(No history yet — generate atmospheric intro music for this genre.)'}

Generate the instrumental music prompt now.`;
            },

            buildTimelineExtractorPrompt(transcript) {
                const state = StateManager.getState();
                let prompt = state.prompt_timeline_extractor || UTILITY.getDefaultSystemPrompts().prompt_timeline_extractor;
                return prompt.replace('{transcript}', transcript);
            },

            buildJournalExtractorPrompt(transcript, characterNames) {
                return `You are a narrative chronicler. Review the following recent chat transcript from a roleplay session:

### Recent Transcript
${transcript}

### Active Characters in Play
${characterNames}

Your task is to extract:
1. Significant PLOT events (discoveries, major actions, battles, objective updates, or movements).
2. Deep CHARACTER reflections (how specific characters reacted emotionally, what they realized, or how their feelings changed).

You must format each point on a new line using the following prefix tags. Do not output anything else.
Use "[PLOT] <event description>" for plot events.
Use "[REFLECTION: <Character Name>] <reflection description>" for character reflections.

Example Output:
[PLOT] The group decided to explore the dark dungeon.
[REFLECTION: Arthur] Arthur felt a deep sense of dread, recalling his past trauma in similar caves.

Please generate the entries for the recent transcript now:`;
            },

            buildRelationshipMatrixPrompt(transcript) {
                const state = StateManager.getState();
                let prompt = state.prompt_relationship_matrix || UTILITY.getDefaultSystemPrompts().prompt_relationship_matrix;
                return prompt.replace('{transcript}', transcript);
            },

            buildArchivistCondensationPrompt(entries) {
                return `You are a master archivist and story editor. The following world knowledge base has become bloated with redundant or overly detailed entries. Your task is to condense and optimize it.
                
### Important Rules
1. Do NOT discard concrete details, major plot milestones, character traits, relationship changes, or item status.
2. Focus ONLY on merging duplicate or highly similar entries (e.g., merging duplicate Character or World entries that cover the same entity).
3. Do NOT merge entries of different categories (e.g. do not merge an Event entry with an Item entry, or a Relationship entry with a World entry).
4. Preserve the exact category-tagged naming structure: [Event] <Title>, [Character: <Name>], [Item] <Name>, [World] <Topic>, or [Relationship] <Name A> & <Name B>.
5. Tighten the prose to make the entries clean and information-dense, without deleting any actual story facts.

### Existing Entries
${entries.map(e => `Title: ${e.title}\nContent: ${e.content}`).join('\n\n')}

### Output Format
Respond with a delimited list using a pipe character '|' in this exact format:
Exact Title | Condensed Content
Each entry on a new line.`;
            },

            buildLoreMergePrompt(title, oldContent, newFact) {
                return `You are a master archivist and scribe. Your task is to update an existing lore entry with a new fact that has just occurred or been revealed, without losing any pre-existing detail.

### Lore Entry
Title: ${title}

### Current Content
${oldContent}

### New Detail to Integrate
${newFact}

### Instructions
1. Integrate the new detail into the current content smoothly.
2. Maintain all pre-existing details, descriptions, history, and atmosphere. Do NOT remove any existing information unless it is directly contradicted by the new detail.
3. Keep the prose natural, clean, and cohesive.
4. Output ONLY the updated content text. Do NOT wrap it in quotes, code blocks, or include any conversational intro/outro.`;
            },

            /**
             * Builds the prompt for the GM Agent to evaluate active rules against history.
             * @param {Array} activeRules - List of active GM rules.
             * @returns {string} - The constructed prompt.
             */
            buildGMRulePrompt(activeRules) {
                const state = StateManager.getState();

                // Get last 15 messages, keeping it concise
                const recentHistory = (state.chat_history || [])
                    .slice(-15)
                    .filter(m => m && m.type === 'chat' && !m.isHidden)
                    .map(m => {
                        const char = (state.characters || []).find(c => c.id === m.character_id);
                        const name = char ? char.name : (m.is_user ? 'Player' : 'Unknown');
                        return `${name}: ${UTILITY.stripThinking(m.content || '')}`;
                    })
                    .join('\n');

                const rulesDescription = activeRules.map(rule => `
Rule ID: ${rule.id}
Rule Name: ${rule.name}
Criteria: ${rule.criteria}
Resolution Mode: ${rule.mode}
Consequences: ${rule.consequence}
Severity: ${rule.severity}
----------------------------------------`).join('\n');

                return `You are the Game Master (GM) Agent for a text-based roleplay game. Your task is to objectively evaluate the active game rules against the recent chat history and determine if any rules have been triggered or violated.

Here are the active rules to evaluate:
${rulesDescription}

### Recent Chat History:
${recentHistory}

Analyze the history and evaluate each rule. You must output a valid XML block inside <evaluations> tags.
For each rule, output an <evaluation> node containing:
- <rule_id>: The exact Rule ID.
- <rule_name>: The exact Rule Name.
- <status>: "triggered" if the rule's criteria was met/violated in the recent turns, or "passed" if it was not triggered.
- <description>: A brief, objective explanation of why the rule triggered or passed based on the chat history.
- <consequence>: The consequences if triggered.
- <proposals>: (Only if status is "triggered") List any state/inventory/health changes or narrative interventions.
  Supported proposal tags inside <proposals>:
  * <resource name="Resource Name" delta="-10" /> (For adding/subtracting from game resources/inventory)
  * <character_stat character_name="Character Name" stat="Health" value="80" /> (For setting character stats)
  * <relationship character_a="Char A Name" character_b="Char B" delta="-5" /> (For changing relationships)
  * <narration>A short GM narrative message to inject into the story.</narration> (Optional narration to enforce active rules. Keep it short, atmospheric, and focus on the rule violation.)

If no rules are triggered, output:
<evaluations>
    <!-- No rules triggered -->
</evaluations>

Output ONLY the XML block. Do not write any conversational text or markdown code block wrapper. Begin directly with <evaluations>.`;
            },

            /**
             * Builds the prompt for the Concept Agent (Step 1: The Brief).
             * @param {string} userInput - The user's initial idea.
             * @returns {string} - The constructed prompt.
             */
            buildConceptBriefPrompt(userInput) {
                return `You are a creative director for a high-quality interactive novel. Base your work on this prompt: "${userInput}".

### Task
Create the foundational concept for a story bible. Focus on the world, tone, and core conflict. 

### Critical Constraints
1. characters yet will be generated at a later time.
2. Commentary on target audience, platforms, monetization, or any other Game Design Document (GDD) metadata is strictly forbidden.
3. If specific world-building details were mentioned in the user prompt, they MUST be incorporated.

You MUST format your response using EXACTLY these headings:

### TITLE
A Compelling Story Title

### CREATOR_NOTES
An atmospheric, engaging introduction to the story's environment and tone (approx 2 paragraphs). Sell the concept.

### TAGS
tag1, tag2, genre, vibe (comma separated list)

### SCENARIO_NAME
A creative name for the starting scene.

### BRIEF_SUMMARY
A rich summary of the world, the core conflict, and the stakes involved. Incorporate any specific requests from the user.`;
            },

            /**
             * Builds the prompt for the Casting Agent (Step 2: The Roster).
             * @param {Object} briefData - The data from the brief phase.
             * @returns {string} - The constructed prompt.
             */
            buildConceptRosterPrompt(briefData, originalPrompt = "") {
                const intentBlock = originalPrompt ? `\nORIGINAL USER INTENT:\n"${originalPrompt}"\n` : "";

                return `You are a casting director for the story: "${briefData.title}".
### Story Tone and Environment
${briefData.creator_notes}
### Tags
${briefData.tags}

### Conflict
${briefData.brief_summary}
${intentBlock}
### Task
Create a roster of characters that makes sense for this narrative, with a *minimum* of 3 characters total.

### Critical Constraints
1. The first character in the list MUST be the 'User' (the player).
2. If specific characters or archetypes were requested in the ORIGINAL USER INTENT, they MUST be included in this roster.
3. Provide only the name, role, and archetype summary.

Format your response as a bulleted list using this EXACT format for each character:
- Name: (Name here) | Role: User | Archetype: The Protagonist (Briefly describe their place in the roleplay and situation)
- Name: (Name here) | Role: PrimaryAI | Archetype: The Companion/Narrator (Briefly describe their place and situation)
- Name: (Name here) | Role: Support | Archetype: Supporting cast member (Briefly describe their place and situation)`;
            },

            /**
             * Builds the prompt for the Concept Agent specifically for adding a scenario to an existing story (Step 1: The Brief).
             * @param {Object} existingStory - The existing story object.
             * @param {string} userInput - The user's prompt for the new scenario.
             * @returns {string} - The constructed prompt.
             */
            buildScenarioBriefPrompt(existingStory, userInput) {
                const charNames = (existingStory.characters || []).map(c => c.name).join(', ');
                const loreTitles = (existingStory.static_entries || []).map(e => e.title).join(', ');

                return `You are a creative director for a high-quality interactive novel. We are adding a new scenario to an existing story titled "${existingStory.name}".
                
### Existing Context
Summary: ${existingStory.creator_notes || "N/A"}
Existing Characters: ${charNames}
Existing Lore: ${loreTitles}

### New Scenario Prompt 
"${userInput}"

### Task
Create the foundational concept for this new scenario. Ensure it fits logically into the existing world.

### Critical Constraints
1. it is strictly forbidden to output target audience, platforms, or other GDD metadata.
2. If the user requested specific characters or locations in the NEW SCENARIO PROMPT, they MUST be prioritized.

You MUST format your response using EXACTLY these headings:

### TITLE
Scenario Name

### CREATOR_NOTES
Atmospheric introduction to the scenario (approx 2 paragraphs).

### TAGS
tag1, tag2 (comma separated list)

### SCENARIO_NAME
Scenario Name

### BRIEF_SUMMARY
Detailed setup and conflict for this specific scenario.`;
            },

            /**
             * Builds the prompt for the Casting Agent specifically for adding a scenario to an existing story (Step 2: The Roster).
             * @param {Object} existingStory - The existing story object.
             * @param {Object} briefData - The data from the brief phase.
             * @returns {string} - The constructed prompt.
             */
            buildScenarioRosterPrompt(existingStory, briefData, originalPrompt = "") {
                const charNames = (existingStory.characters || []).map(c => c.name).join(', ');
                const intentBlock = originalPrompt ? `\nNEW SCENARIO REQUEST:\n"${originalPrompt}"\n` : "";

                return `You are a casting director for a new scenario in the story: "${existingStory.name}".
### New Scenario Context
${briefData.brief_summary}

### Existing Characters
${charNames}
${intentBlock}
### Task
Define the character roster for this scenario.
1. Identify which EXISTING characters are required.
2. Identify any NEW characters that need to be created.
3. If specific characters were requested in the NEW SCENARIO REQUEST, they MUST be prioritized.

Format your response as a bulleted list using this EXACT format for each character:
- Name: (Name) | Role: (User/PrimaryAI/Support) | Archetype: (Description of their role in this scenario)
- Name: (Name) | Role: Support | Archetype: (Description of new character's role)`;
            },

            /**
             * Builds the prompt for the World Builder Agent (Step 2A - Topics).
             * @param {string} conceptSummary - The approved concept summary.
             * @returns {string} - The constructed prompt.
             */
            buildWorldTopicsPrompt(conceptSummary) {
                return `### Roleplay Context
"${conceptSummary}"
                
Analyze the current setting, tone, and genre of our roleplay. Based on this analysis, generate a list of 3 to 5 nouns or short phrases representing worldbuilding topics that need fleshing out (e.g., specific locations, impactful past events, factions, or technology).

Return your response as a simple bulleted list.
- Topic 1
- Topic 2
- Topic 3`;
            },

            /**
             * Builds the prompt for the World Builder Agent (Step 2B - Details).
             * @param {string} conceptSummary - The approved concept summary.
             * @param {string} topic - The specific topic to expand.
             * @returns {string} - The constructed prompt.
             */
            buildWorldDetailPrompt(conceptSummary, topic) {
                return `### Roleplay Context
"${conceptSummary}"
                
Write a single, rich encyclopedic lore entry detailing the following topic: "${topic}".
It should feel like a natural extension of the established narrative. Ensure the depth and scale strictly mirrors the roleplay's current scope.
Write only the descriptive paragraphs.`;
            },

            /**
             * Builds the prompt for the Casting Agent (Step 3).
             * @param {string} contextSummary - The story context.
             * @param {Array} roster - Array of character definitions from the concept.
             * @returns {string} - The constructed prompt.
             */
            buildCastingAgentPrompt(contextSummary, roster) {
                const charList = roster.map(c => c.name + ' (' + c.role + ')').join(', ');
                return `Given the characters: ${charList}.
### Story Context
${contextSummary}.

Define the specific relationship dynamics between the User and the Primary AI character, and then between other characters. 

Focus on *intentions*. What does each character want from the others? Define emotional connections, hidden agendas, and past conflicts based on these intentions.

Write the analysis in plain text.`;
            },

            /**
             * Builds the prompt for the Scene Director Agent (Step 4A - Lore).
             * @param {string} contextSummary - The story context.
             * @param {string} relationshipContext - The relationship matrix.
             * @returns {string} - The constructed prompt.
             */
            buildDirectorLorePrompt(contextSummary, relationshipContext) {
                return `### Context
${contextSummary}
### Relationships
${relationshipContext}

Write the "Scenario Lore". This is a static, 3rd-person description of the setting and the inciting incident that kicks off the very first scene of the roleplay.

Write only the descriptive paragraphs.`;
            },

            /**
             * Builds the prompt for the Scene Director Agent (Step 4B - Message).
             * @param {string} contextSummary - The story context.
             * @param {string} relationshipContext - The relationship matrix.
             * @param {string} scenarioLore - The generated scenario lore.
             * @param {Object} speakerChar - The character speaking first.
             * @param {Object} userChar - The user character.
             * @returns {string} - The constructed prompt.
             */
            buildDirectorOpeningPrompt(contextSummary, relationshipContext, scenarioLore, speakerChar, userChar) {
                return `### Context
${contextSummary}
### Relationships
${relationshipContext}
### Scene Setup
${scenarioLore}

Write the opening chat message for this roleplay. 
This message is spoken or enacted by ${speakerChar.name}. It must be directed AT ${userChar.name}. 
Start *in media res* (in the middle of action or conversation). 
Do NOT describe ${userChar.name}'s thoughts or actions. Only describe what ${speakerChar.name} says or does.
Use first person 'prose-style' writing (e.g. "That's what I'm telling you!" I brush the hair from my eyes as I look out at the sunset. "Don't you understand *anything*?")

Write only the character's message.`;
            },

            /**
             * Builds the hidden scratchpad prompt for a single character agent.
             * Contains ONLY this character's private knowledge — no other character's internals.
             * The reasoning field in the output is STRIPPED by SwarmOrchestrator before forwarding to the Director.
             * @param {Object} char - The character object.
             * @param {string} userAction - The user's submitted action text.
             * @param {Object} state - The reactive narrative state.
             * @returns {string}
             */
            buildSwarmScratchpadPrompt(char, userAction, state, objectiveDescription = "") {
                const replacer = this._getReplacer(char);

                // 1. CHARACTER PERSONA
                const descSource = (state.evolved_characters && state.evolved_characters[char.id])
                    ? state.evolved_characters[char.id]
                    : (char.description || '');

                // 2. RECENT HISTORY
                const recentHistory = (state.chat_history || [])
                    .filter(m => m && m.type === 'chat' && !m.isHidden)
                    .slice(-5)
                    .map(m => {
                        const speaker = ReactiveStore.getCharacter(m.character_id);
                        return `${speaker ? speaker.name : 'Unknown'}: ${m.content}`;
                    }).join('\n');

                // 4. WORLD LORE
                let worldLore = (state.static_entries || []).map(l => `### ${l.title}\n${replacer(l.content)}`).join('\n\n');

                // 5. CHARACTER SECRETS
                const secrets = (state.swarmSecrets || {})[char.id] || 'No special secrets defined.';

                // Assemble in specified order: persona, history, objective, lore, secrets, directive
                let prompt = "### AGENT INSTRUCTION\n" +
                    "You are the internal monologue for " + char.name + ". Reflect on the current situation and describe your internal state, intentions, and reaction to the objective scene reality.\n\n" +
                    "### CHARACTER PERSONA\n" + descSource + "\n\n" +
                    "### RECENT HISTORY\n" + recentHistory + "\n\n" +
                    "### OBJECTIVE REALITY\n" + objectiveDescription + "\n\n" +
                    "### ADDITIONAL INSTRUCTIONS\n" + worldLore + "\n\n" +
                    "### CHARACTER SECRETS\n" + secrets + "\n\n";

                if (userAction) {
                    const tag = (userAction || "").includes('[DIRECTIVE]:') ? "USER DIRECTIVE" : "USER INPUT";
                    prompt += "### " + tag + "\n" + userAction + "\n\n";
                }

                prompt += "[OUTPUT INSTRUCTION]\n" +
                    "Respond with exactly ONE paragraph of internal monologue. Focus on your character's immediate emotional response and planned next move.";

                // Text Mode: let the character decide, during the thinking step they already run,
                // whether they would privately text the player right now. Appended after the
                // editable template so a customised scratchpad prompt keeps working.
                if (state.enableTextMode !== false && state.dmUnpromptedTexts !== false) {
                    const userChar = (state.characters || []).find(c => c.is_user);
                    const userName = userChar ? userChar.name : 'the user';
                    prompt += "\n\n### PRIVATE TEXT MESSAGE (OPTIONAL)\n"
                        + `You have a phone. You may privately text ${userName} right now.\n`
                        + "Only do it if you genuinely would: something just happened you cannot say out loud "
                        + "in front of the others, you want to reach them alone, or you have been sitting with "
                        + "something unsaid.\n"
                        + "Most turns you will NOT text. Saying nothing is the normal case.\n"
                        + "If and only if you decide to, finish your response with a line starting exactly:\n"
                        + "TEXT: the message, written the way a real person types on a phone\n"
                        + "Keep it short. Write nothing after that line, and never mention texting inside your monologue.";
                }

                return prompt;
            },

            /**
             * Builds the Director prompt from the winning agents' intents.
             * CRITICAL: Only the 'intent' field from each agent is forwarded — NOT 'reasoning'.
             * The Director receives no scratchpad internal monologue.
             * The Director now returns a JSON directive list, not prose.
             * @param {string} userAction
             * @param {Array<{char, result, bid}>} winners
             * @param {Object} state
             * @returns {string}
             */
            buildSwarmDirectorPrompt(userAction, winners, state, objectiveDescription = "") {
                const replacer = this._getReplacer();
                const primary = state.swarmPrimarySpeaker;

                // 1. OTHER CHARACTERS PRESENT
                const otherActiveChars = [...(state.characters || []), ...ReactiveStore.getActiveLocationCharacters()]
                    .filter(c => c.is_active && c.id !== primary?.id);
                const otherCharsContext = otherActiveChars.map(c => {
                    const appearance = c.appearance || c.physical_description || c.short_description || "Unknown appearance.";
                    return `- ${c.name}: ${appearance}`;
                }).join('\n');

                // 3. INNER THOUGHTS
                const winnerThoughts = winners.map(w =>
                    `* Character: ${w.char.name}\n  - Inner Thoughts: "${w.result.thoughts || w.result.reflection || w.result.intent}"`
                ).join('\n\n');

                // 4. USER DIRECTIVE
                let finalUserAction = userAction;
                if ((userAction || "").includes('[DIRECTIVE]:')) {
                    finalUserAction = "### ACTIVE USER DIRECTIVE\n" + userAction + "\n\n(Note: This directive takes absolute precedence over recent history.)";
                } else {
                    finalUserAction = "### USER INPUT\n" + userAction;
                }

                // 5. RECENT HISTORY
                const recentHistory = (state.chat_history || [])
                    .filter(m => m && m.type === 'chat' && !m.isHidden)
                    .slice(-8)
                    .map(m => {
                        const speaker = ReactiveStore.getCharacter(m.character_id);
                        return `${speaker ? speaker.name : 'Unknown'}: ${m.content}`;
                    }).join('\n\n');

                // 6. WORLD LORE
                let worldLore = (state.static_entries || []).map(l => `### ${l.title}\n${replacer(l.content)}`).join('\n\n');

                // 7. CHARACTER SECRETS
                const secrets = (state.swarmSecrets || {})[primary?.id] || "No specific secrets.";

                // Assemble in specified order: other_chars, objective, thoughts, directive, history, lore, secrets
                const primaryName = primary ? primary.name : "the primary character";
                let prompt = "### DIRECTOR INSTRUCTION\n" +
                    "You are the Scene Director. Synthesize character thoughts and reality into a single cohesive directive for the primary speaker.\n\n" +
                    "The next character to respond in this narrative is " + primaryName + "\n\n" +
                    "### OTHER CHARACTERS PRESENT\n" + otherCharsContext + "\n\n" +
                    "### OBJECTIVE REALITY\n" + objectiveDescription + "\n\n" +
                    "### INNER THOUGHTS\n" + winnerThoughts + "\n\n" +
                    finalUserAction + "\n\n" +
                    "### RECENT HISTORY\n" + recentHistory + "\n\n" +
                    "### ADDITIONAL INSTRUCTIONS\n" + worldLore + "\n\n" +
                    "### CHARACTER SECRETS (PRIMARY SPEAKER)\n" + secrets + "\n\n";

                prompt += "[OUTPUT INSTRUCTION]\n" +
                    "As the Director, your job is to orchestrate the next move for " + primaryName + ". " +
                    "Review the objective reality and the character's internal monologue, then provide a single, concise directive.\n\n" +
                    "Format your response as a single sentence or short paragraph that tells " + primaryName + " exactly what to do or say next.";

                return prompt;
            },

            /**
             * @returns {string}
             */
            buildSwarmCharacterResponsePrompt(char, directive, userAction, state, scratchpadResult = null, objectiveDescription = "") {
                const descSource = (state.evolved_characters && state.evolved_characters[char.id])
                    ? state.evolved_characters[char.id]
                    : (char.description || '');

                const systemPrompt = char.model_instructions || state.systemPrompt || 'You are a creative roleplay AI.';

                const historyArray = this._getSmartHistorySlice(state.chat_history || [], 2000, char.id).slice(-6);
                const agentNotes = (typeof AgentController !== 'undefined')
                    ? AgentController.buildNoteLayout(char, historyArray.length)
                    : null;

                // 1. SYSTEM INSTRUCTION
                let prompt = "";
                if (agentNotes && agentNotes.before.length) prompt += this._agentNotesText(agentNotes.before) + "\n\n";
                prompt += "### SYSTEM INSTRUCTION\n" + systemPrompt + "\n\n";
                if (agentNotes && agentNotes.top.length) prompt += this._agentNotesText(agentNotes.top) + "\n\n";

                // 2. DIRECTOR INSTRUCTION
                prompt += "### SCENE DIRECTION\n" + directive + "\n\n";

                // 3. PERSONA
                prompt += "### YOUR PERSONA\n" + descSource + "\n\n";

                // 4. RECENT HISTORY (agent notes slot in by depth; every entry here is shown)
                const transcriptParts = [];
                historyArray.forEach((msg, i) => {
                    if (agentNotes) (agentNotes.beforeMessage[i] || []).forEach(note => transcriptParts.push(this._agentNotesText([note])));
                    const speaker = ReactiveStore.getCharacter(msg.character_id);
                    transcriptParts.push(`${speaker ? speaker.name : 'Unknown'}: ${msg.content}`);
                });
                if (agentNotes) agentNotes.end.forEach(note => transcriptParts.push(this._agentNotesText([note])));
                const transcript = transcriptParts.join('\n\n');
                prompt += "### RECENT HISTORY\n" + transcript + "\n\n";

                // 5. PRIVATE THOUGHTS
                if (scratchpadResult && scratchpadResult.thoughts) {
                    prompt += "### YOUR PRIVATE THOUGHTS\n" + scratchpadResult.thoughts + "\n\n";
                }

                // 6. OTHER CHARACTERS PRESENT
                const otherCharsContext = [...(state.characters || []), ...ReactiveStore.getActiveLocationCharacters()]
                    .filter(c => c.is_active && c.id !== char.id)
                    .map(c => {
                        const appearance = c.appearance || c.physical_description || c.short_description || "Unknown appearance.";
                        return `- ${c.name}: ${appearance}`;
                    }).join('\n');
                prompt += "### OTHER CHARACTERS PRESENT\n" + otherCharsContext + "\n\n";

                // 7. WORLD LORE
                let worldLore = (state.static_entries || []).map(l => `### ${l.title}\n${this._getReplacer(char)(l.content)}`).join('\n\n');
                if (worldLore) {
                    prompt += "### ADDITIONAL INSTRUCTIONS\n" + worldLore + "\n\n";
                }

                // 8. FORMATTING GUIDELINES
                const style = state.responseStyle || 'prose';
                if (style === 'prose') {
                    prompt += "### FORMATTING GUIDELINE\nWrite in third-person novel prose. Use double quotes for speech and plain text for actions.\n\n";
                } else {
                    prompt += "### FORMATTING GUIDELINE\nWrite in roleplay style. Use asterisks for actions (*) and plain text for speech.\n\n";
                }

                // 9. USER DIRECTIVE (END FOR PRIORITY)
                if (userAction) {
                    const tag = userAction.includes('[DIRECTIVE]:') ? "USER DIRECTIVE" : "USER INPUT";
                    prompt += "### " + tag + " (PRIORITY)\n" + userAction + "\n\nReact to this input naturally but decisively in your response.";
                }

                prompt += "\n[PERSPECTIVE]\n" +
                    "Write exclusively from the perspective of " + char.name + ". Describe your own actions and words. Maintain total immersion.";

                return prompt;
            }
        };
