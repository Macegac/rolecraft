        /**
         * =================================================================================================
         * [SEC:JS:CTRL:ISGP]
         * InStoryGenerationPipeline Module
         * Orchestrates the agentic workflow for adding scenarios to EXISTING stories.
         * Generates differential content (new characters, new lore) to avoid overwriting the foundation.
         * =================================================================================================
         */
        const InStoryGenerationPipeline = {

            async _callAgent(prompt, retries = 2) {
                return await LibraryController._callAIWithRetry(prompt, retries);
            },

            async _callAgentText(prompt, retries = 1) {
                let lastErr = null;
                for (let i = 0; i <= retries; i++) {
                    try {
                        const res = await APIService.callAI(prompt, false);
                        if (res) return res.trim();
                        throw new Error("Empty text response");
                    } catch (e) {
                        lastErr = e;
                    }
                }
                console.warn("[Architect] _callAgentText failed after retries:", lastErr && lastErr.message);
                return null;
            },

            async runScenarioConceptPhase(userPrompt, existingStory, updateUI) {
                updateUI(10, "Agent: Concept Director is drafting the scenario...");

                // Step A: Brief
                const briefPrompt = PromptBuilder.buildScenarioBriefPrompt(existingStory, userPrompt);
                const briefRaw = await this._callAgentText(briefPrompt);
                if (!briefRaw) throw new Error("Concept Agent failed to generate a valid scenario brief.");

                const briefData = UTILITY.extractStructuredHeadings(briefRaw, ['TITLE', 'CREATOR_NOTES', 'TAGS', 'SCENARIO_NAME', 'BRIEF_SUMMARY']);
                if (typeof briefData.tags === 'string') {
                    briefData.tags = briefData.tags.split(',').map(s => s.trim()).filter(Boolean);
                }

                // Step B: Roster
                updateUI(15, "Agent: Casting Director is reviewing the cast...");
                const rosterPrompt = PromptBuilder.buildScenarioRosterPrompt(existingStory, briefData, userPrompt);
                const rosterRaw = await this._callAgentText(rosterPrompt);

                const rawCharacters = UTILITY.extractDelimitedList(rosterRaw, '|', ['name', 'role', 'archetype']);
                briefData.characters = rawCharacters.filter(c => c.name);

                if (!briefData.characters || briefData.characters.length === 0) {
                    throw new Error("Concept Agent failed to generate a valid scenario roster.");
                }

                return briefData;
            },

            /**
             * Phase 1: Not used directly. Concept comes from UI inputs.
             */

            /**
             * Phase 2: World Builder Agent (Differential).
             * Generates NEW lore specific to the scenario, respecting the existing world.
             */
            async runWorldPhase(draftDiff, conceptData, existingStory, updateUI) {
                updateUI(25, "Agent: World Builder is expanding the lore...");

                const existingLoreSummary = existingStory.static_entries
                    .slice(0, 50)
                    .map(e => `${e.title}: ${e.content.substring(0, 100)}...`)
                    .join('\n');

                let summary = `Existing Story: ${existingStory.name}\nExisting Lore:\n${existingLoreSummary}\n\nNew Scenario Conflict: ${conceptData.brief_summary}`;

                // A. Topics (List)
                const topicsPrompt = `You are an expert World Builder expanding an existing universe.
CONTEXT:
${summary}
TASK:
Generate a list of 2-3 NEW nouns or short phrases representing lore topics (Key Locations, Factions, or History) that are specifically required for this new scenario.
Do NOT regenerate existing lore. Focus ONLY on what is new.
RESPONSE FORMAT:
Return a comma-separated list of topics. Example: The Old Mill, The Red Guard, The Great Fire`;

                const topicsRaw = await this._callAgentText(topicsPrompt);
                let topics = UTILITY.extractDelimitedList(topicsRaw);
                if (!topics || topics.length === 0) topics = ["Local Setting", "Incident Context"];

                // B. Details (Text - Sequential)
                const entries = [];
                for (let i = 0; i < topics.length; i++) {
                    const topic = topics[i];
                    updateUI(25 + (i * 3), `Agent: World Builder is drafting ${topic}...`);

                    const rosterNames = (conceptData.characters || []).map(c => c.name).join(', ');
                    const enrichedSummary = `${summary}\nCharacters Involved: ${rosterNames}`;

                    const detailPrompt = `CONTEXT: ${enrichedSummary}
                    
Write a single, rich encyclopedic lore entry detailing the following NEW topic: "${topic}".
It must fit seamlessly into the existing world without contradicting known lore.
Write only the descriptive paragraphs.`;
                    const content = await this._callAgentText(detailPrompt);
                    if (content) {
                        entries.push({
                            id: UTILITY.uuid(),
                            title: topic,
                            content: content,
                            is_immutable: true
                        });
                        summary += `\n[${topic}]: ${content.substring(0, 150)}...`;
                    }
                }

                draftDiff.static_entries = entries;
            },

            /**
             * Phase 3: Casting Director Agent (Differential).
             * Identifies which characters are needed (Existing vs New).
             */
            async runCastingPhase(draftDiff, conceptData, existingStory, updateUI) {
                const roster = conceptData.characters || []; // The AI suggested list for the scenario
                const existingChars = existingStory.characters || [];

                updateUI(40, "Agent: Casting Director is auditing the roster...");

                const existingCharList = existingChars.map(c => c.name).join(', ');

                const newCharactersToGenerate = [];
                const activeIds = []; // IDs of characters active in this scenario

                for (const suggestedChar of roster) {
                    const match = existingChars.find(ec => ec.name.toLowerCase() === suggestedChar.name.toLowerCase());
                    if (match) {
                        activeIds.push(match.id);
                    } else {
                        newCharactersToGenerate.push(suggestedChar);
                    }
                }

                // A. Generate Skeletons for NEW characters
                const newProfiles = [];
                if (newCharactersToGenerate.length > 0) {
                    updateUI(42, "Agent: Casting Director is outlining new recruits...");
                    for (const charDef of newCharactersToGenerate) {
                        const charContext = `Scenario: ${conceptData.brief_summary}\nExisting Cast: ${existingCharList}\nRole: ${charDef.role}\nArchetype: ${charDef.archetype}`;
                        const skeleton = await NarrativeController.generateCharacterSkeleton(charDef.name, charContext);
                        newProfiles.push({ ...charDef, skeleton });
                    }
                }

                // B. Relationship Matrix for NEW characters
                let relationshipContext = "";
                if (newProfiles.length > 0) {
                    updateUI(45, "Agent: Casting Director is mapping new relationships...");
                    const summary = `Scenario: ${conceptData.brief_summary}\nExisting Cast: ${existingCharList}`;
                    try {
                        const enrichedRoster = newProfiles.map(p => ({
                            name: p.name,
                            role: p.role,
                            archetype: p.archetype + ` (Description: ${p.skeleton.short_description})`
                        }));
                        const relPrompt = PromptBuilder.buildCastingAgentPrompt(summary, enrichedRoster);
                        relationshipContext = await this._callAgentText(relPrompt) || "";
                    } catch (e) { console.warn("Rel skipped", e); }
                }

                // C. Generate Profiles for NEW characters (Sequential)
                if (newProfiles.length > 0) {
                    for (let i = 0; i < newProfiles.length; i++) {
                        const charDefProfile = newProfiles[i];
                        updateUI(50 + Math.round((i / newProfiles.length) * 30), `Agent: Casting Director is interviewing ${charDefProfile.name} (${i + 1}/${newProfiles.length})...`);

                        const charDef = { name: charDefProfile.name, role: charDefProfile.role, archetype: charDefProfile.archetype };
                        const charContext = `Scenario: ${conceptData.brief_summary}\nExisting Cast: ${existingCharList}\nRELATIONSHIPS:\n${relationshipContext}\n\nRole: ${charDef.role}\nArchetype: ${charDef.archetype}`;

                        let charData = null;
                        try {
                            charData = await NarrativeController.generateCharacterProfile(charDef.name, charContext, charDefProfile.skeleton);
                        } catch (err) {
                            console.error(`[Architect] Profile generation failed for ${charDef.name}:`, err);
                        }

                        if (!charData) {
                            charData = {
                                description: `A character named ${charDef.name}.`,
                                short_description: charDefProfile.skeleton?.short_description || `A character.`,
                                appearance: `A character named ${charDef.name}.`,
                                model_instructions: charDefProfile.skeleton?.model_instructions || `Write the next response for ${charDef.name}.`,
                                tags: charDefProfile.skeleton?.tags || []
                            };
                        }

                        const charId = UTILITY.uuid();
                        let imageUrl = '';
                        let baseBlob = null;

                        // Auto-Image Gen (Base Portrait)
                        try {
                            const imagePrompt = `portrait of ${charDef.name}, ${charData.short_description || charData.description}, ${charDef.archetype}, detailed face, fantasy art, masterpiece`;
                            baseBlob = await ImageGenerationService.generateImage(imagePrompt);
                            if (baseBlob) {
                                await DBService.saveImage(charId, baseBlob);
                                imageUrl = `local_idb_${charId}`;
                                UIManager.RUNTIME.characterImageCache[charId] = URL.createObjectURL(baseBlob);
                            }
                        } catch (err) { console.warn("Primary image fail", err); }

                        const extraPortraits = [];
                        // [NEW] Auto-Generate Emotional Portraits using I2I (Sequential to prevent overload)
                        if (baseBlob) {
                            const emotions = ['happy', 'sad', 'angry'];
                            for (const emotion of emotions) {
                                try {
                                    const emoPrompt = `Portrait of ${charDef.name} expressing ${emotion} emotion. Intense ${emotion} facial expression, displayed in the mouth, eyes, and and brow especially.`;
                                    const emoBlob = await ImageGenerationService.generateImage(emoPrompt, "", { denoising_strength: 0.5 }, baseBlob);
                                    if (emoBlob) {
                                        const emoKey = `${charId}::emotion::${emotion}`;
                                        await DBService.saveImage(emoKey, emoBlob);
                                        UIManager.RUNTIME.characterImageCache[emoKey] = URL.createObjectURL(emoBlob);
                                        extraPortraits.push({ emotion: emotion, url: '' });
                                    }
                                } catch (err) { console.warn(`Emotion ${emotion} fail`, err); }
                            }
                        }

                        const charObj = {
                            id: charId,
                            name: charDef.name,
                            description: charData.description || "No description.",
                            short_description: charData.short_description || "A character.",
                            appearance: charData.appearance || "",
                            model_instructions: charData.model_instructions || `Write the next response for ${charDef.name}.`,
                            tags: charData.tags || [],
                            is_user: charDef.role === 'User',
                            is_active: true,
                            is_narrator: charDef.role === 'PrimaryAI' && !activeIds.some(id => {
                                const c = existingChars.find(ec => ec.id === id);
                                return c && c.is_user;
                            }),
                            color: NarrativeController.CONSTANTS.CHARACTER_COLORS[(existingChars.length + i) % NarrativeController.CONSTANTS.CHARACTER_COLORS.length],
                            image_url: imageUrl,
                            extra_portraits: extraPortraits
                        };

                        draftDiff.characters.push(charObj);
                        activeIds.push(charObj.id);

                        // Merge new character immediately into existingStory and save checkpoint
                        if (!existingStory.characters.some(ec => ec.id === charObj.id)) {
                            existingStory.characters.push(charObj);
                        }
                        try {
                            await DBService.saveStory(existingStory);
                        } catch (saveErr) {
                            console.warn("[Architect] Save checkpoint failed:", saveErr);
                        }
                    }
                }

                return { relationshipContext, activeIds };
            },

            /**
             * Phase 4: Scene Director Agent (Differential).
             * Generates the opening scenario using the mixed cast.
             */
            async runDirectorPhase(draftDiff, conceptData, relationshipContext, existingStory, activeIds, updateUI) {
                updateUI(85, "Agent: Director is writing the scenario lore...");

                // Resolve Characters for the prompt
                // We need actual objects, not just IDs
                const allChars = [...existingStory.characters, ...draftDiff.characters];

                // Find Speaker: First non-user active character
                const speakerChar = allChars.find(c => activeIds.includes(c.id) && !c.is_user) || allChars[0];
                const userChar = allChars.find(c => c.is_user) || { name: "You" };

                // Build Summary Context
                const existingLoreSummary = (existingStory.static_entries || [])
                    .slice(0, 20)
                    .map(e => `[${e.title}]: ${e.content.substring(0, 100)}...`)
                    .join('\n');
                const newLoreSummary = (draftDiff.static_entries || []).map(e => `[${e.title}]: ${e.content}`).join('\n\n');

                const activeCharacters = allChars.filter(c => activeIds.includes(c.id));
                const characterDescriptions = activeCharacters.map(c => `${c.name} (${c.role}): ${c.short_description}`).join('\n');

                const summary = `Story: ${existingStory.name}\nScenario Idea: ${conceptData.brief_summary}\n\nEXISTING LORE:\n${existingLoreSummary}\n\nNEW WORLD LORE:\n${newLoreSummary}\n\nACTIVE CHARACTERS:\n${characterDescriptions}`;

                const lorePrompt = PromptBuilder.buildDirectorLorePrompt(summary, relationshipContext);
                const scenarioLore = await this._callAgentText(lorePrompt) || "A new chapter.";

                if (scenarioLore) {
                    draftDiff.static_entries.push({ id: UTILITY.uuid(), title: "Current Scenario", content: scenarioLore, is_immutable: true });
                }

                updateUI(90, "Agent: Director is writing the opening message...");
                const msgPrompt = PromptBuilder.buildDirectorOpeningPrompt(summary, relationshipContext, scenarioLore, speakerChar, userChar);
                const firstMsg = await this._callAgentText(msgPrompt) || "The story continues...";

                return { firstMsg, scenarioLore, speakerChar };
            }
        };
