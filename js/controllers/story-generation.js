        /**
         * =================================================================================================
         * [SEC:JS:CTRL:SGP]
         * StoryGenerationPipeline Module
         * Orchestrates the agentic workflow for Story Architect V2.
         * =================================================================================================
         */
        const StoryGenerationPipeline = {

            async _callAgent(prompt, retries = 2) {
                // Ensure LibraryController is available (it should be at runtime)
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

            /**
             * Phase 1: Concept Agent.
             * Generates the "Story Bible" from the user prompt.
             */
            async runConceptPhase(userPrompt, updateUI) {
                updateUI(10, "Agent: Concept Director is refining the pitch...");

                // Step A: Brief
                const briefPrompt = PromptBuilder.buildConceptBriefPrompt(userPrompt);
                const briefRaw = await this._callAgentText(briefPrompt);
                if (!briefRaw) throw new Error("Concept Agent failed to generate a valid story brief.");

                const briefData = UTILITY.extractStructuredHeadings(briefRaw, ['TITLE', 'CREATOR_NOTES', 'TAGS', 'SCENARIO_NAME', 'BRIEF_SUMMARY']);
                if (typeof briefData.tags === 'string') {
                    briefData.tags = briefData.tags.split(',').map(s => s.trim()).filter(Boolean);
                }

                // Step B: Roster
                updateUI(15, "Agent: Casting Director is selecting the roster...");
                const rosterPrompt = PromptBuilder.buildConceptRosterPrompt(briefData, userPrompt);
                const rosterRaw = await this._callAgentText(rosterPrompt);

                const rawCharacters = UTILITY.extractDelimitedList(rosterRaw, '|', ['name', 'role', 'archetype']);
                briefData.characters = rawCharacters.filter(c => c.name);

                if (!briefData.characters || briefData.characters.length === 0) {
                    throw new Error("Concept Agent failed to generate a valid character roster.");
                }

                return briefData;
            },

            /**
             * Phase 2: World Builder Agent.
             * Generates deep lore based on the concept.
             */
            async runWorldPhase(draft, conceptData, updateUI) {
                updateUI(25, "Agent: World Builder is setting the foundation...");

                let summary = `Title: ${draft.name}\nSummary: ${draft.creator_notes}\nCore Conflict: ${conceptData.brief_summary}`;

                // A. Topics (List)
                const topicsPrompt = PromptBuilder.buildWorldTopicsPrompt(summary);
                const topicsRaw = await this._callAgentText(topicsPrompt);
                let topics = UTILITY.extractDelimitedList(topicsRaw);
                if (!topics || topics.length === 0) topics = ["Key Locations", "Factions", "Recent History"];

                // B. Details (Text - Sequential)
                const entries = [];
                for (let i = 0; i < topics.length; i++) {
                    const topic = topics[i];
                    updateUI(25 + (i * 3), `Agent: World Builder is detailing ${topic}...`);

                    const rosterNames = (draft.characters || []).map(c => c.name).join(', ');
                    const enrichedSummary = `${summary}\nCharacters: ${rosterNames}`;
                    const detailPrompt = PromptBuilder.buildWorldDetailPrompt(enrichedSummary, topic);

                    const content = await this._callAgentText(detailPrompt);
                    if (content) {
                        entries.push({
                            id: UTILITY.uuid(),
                            title: topic,
                            content: content,
                            is_immutable: true
                        });
                        // Append to summary to maintain sequential consistency
                        summary += `\n[${topic}]: ${content.substring(0, 150)}...`;
                    }
                }

                draft.static_entries = entries;
            },

            /**
             * Phase 3: Casting Director Agent.
             * Generates relationships and character profiles.
             */
            async runCastingPhase(draft, conceptData, updateUI) {
                const roster = conceptData.characters || [];
                const summary = `Title: ${draft.name}\nSummary: ${draft.creator_notes}\nCore Conflict: ${conceptData.brief_summary}`;

                // Pass World Lore to Skeletons and Interviews.
                const worldLoreStr = (draft.static_entries || []).map(e => `[${e.title}]: ${e.content}`).join('\n\n');

                // A. Generate Skeletons first
                updateUI(40, "Agent: Casting Director is outlining the cast...");
                const preInterviewProfiles = [];
                for (const charDef of roster) {
                    const charContext = `${summary}\n\nWORLD LORE:\n${worldLoreStr}\n\nRole: ${charDef.role}\nArchetype: ${charDef.archetype}`;
                    const skeleton = await NarrativeController.generateCharacterSkeleton(charDef.name, charContext);
                    preInterviewProfiles.push({ ...charDef, skeleton });
                }

                // B. Relationship Matrix based on actual skeleton details
                updateUI(42, "Agent: Casting Director is mapping relationships...");
                let relationshipContext = "";
                try {
                    const enrichedRoster = preInterviewProfiles.map(p => ({
                        name: p.name,
                        role: p.role,
                        archetype: p.archetype + ` (Description: ${p.skeleton.short_description})`
                    }));
                    const relPrompt = PromptBuilder.buildCastingAgentPrompt(summary, enrichedRoster);
                    relationshipContext = await this._callAgentText(relPrompt) || "No relationships defined.";
                } catch (e) {
                    console.warn("Relationship generation skipped:", e);
                }

                // C. Character Profiles - The Interview (Sequential)
                for (let i = 0; i < preInterviewProfiles.length; i++) {
                    const charDefProfile = preInterviewProfiles[i];
                    updateUI(45 + Math.round((i / preInterviewProfiles.length) * 35), `Agent: Casting Director is interviewing ${charDefProfile.name} (${i + 1}/${preInterviewProfiles.length})...`);

                    const charDef = { name: charDefProfile.name, role: charDefProfile.role, archetype: charDefProfile.archetype };
                    const charContext = `${summary}\n\nWORLD LORE:\n${worldLoreStr}\n\nRELATIONSHIPS:\n${relationshipContext}\n\nRole: ${charDef.role}\nArchetype: ${charDef.archetype}`;

                    // Profile generation uses pre-generated skeleton
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
                                const emoPrompt = `portrait of ${charDef.name} expressing ${emotion} emotion, ${emotion} facial expression`;
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
                        is_narrator: charDef.role === 'PrimaryAI' && !roster.some(r => r.role === 'User'),
                        color: NarrativeController.CONSTANTS.CHARACTER_COLORS[i % NarrativeController.CONSTANTS.CHARACTER_COLORS.length],
                        image_url: imageUrl,
                        extra_portraits: extraPortraits,
                        dynamic_knowledge: []
                    };

                    draft.characters.push(charObj);

                    // Save progress checkpoint
                    try {
                        await DBService.saveStory(draft);
                    } catch (saveErr) {
                        console.warn("[Architect] Save checkpoint failed:", saveErr);
                    }
                }

                // Fallback User
                if (!draft.characters.some(c => c.is_user)) {
                    const fallbackUser = UTILITY.getDefaultUserCharacter();
                    draft.characters.push(fallbackUser);
                    try {
                        await DBService.saveStory(draft);
                    } catch (saveErr) {
                        console.warn("[Architect] Save checkpoint failed:", saveErr);
                    }
                }

                return relationshipContext;
            },

            /**
             * Phase 4: Scene Director Agent.
             * Generates the opening scenario and message.
             */
            async runDirectorPhase(draft, conceptData, relationshipContext, updateUI) {
                updateUI(85, "Agent: Director is writing the scenario lore...");

                const speakerChar = draft.characters.find(c => !c.is_user) || draft.characters[0];
                const userChar = draft.characters.find(c => c.is_user) || { name: "You" };

                const worldLoreStr = (draft.static_entries || []).map(e => `[${e.title}]: ${e.content}`).join('\n\n');
                const characterDescriptions = (draft.characters || []).map(c => `${c.name} (${c.role}): ${c.short_description}`).join('\n');

                const enrichedSummary = `Title: ${draft.name}\nSummary: ${draft.creator_notes}\nCore Conflict: ${conceptData.brief_summary}\n\nWORLD LORE:\n${worldLoreStr}\n\nCHARACTERS:\n${characterDescriptions}`;

                const lorePrompt = PromptBuilder.buildDirectorLorePrompt(enrichedSummary, relationshipContext);
                const scenarioLore = await this._callAgentText(lorePrompt) || "A new adventure.";

                if (scenarioLore) {
                    draft.static_entries.push({ id: UTILITY.uuid(), title: "Current Scenario", content: scenarioLore, is_immutable: true });
                }

                updateUI(90, "Agent: Director is writing the opening message...");
                const msgPrompt = PromptBuilder.buildDirectorOpeningPrompt(enrichedSummary, relationshipContext, scenarioLore, speakerChar, userChar);
                const firstMsg = await this._callAgentText(msgPrompt) || "The story begins.";

                return { firstMsg, scenarioLore, speakerChar };
            }
        };
