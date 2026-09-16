        /**
         * =================================================================================================
         * [SEC:JS:CTRL:APP]
         * AppController
         * Central coordinating controller for high-level application logic.
         * Handles Modal orchestration, Settings management, and Persona logic.
         * Acts as the bridge between UI events and the Data/State layers.
         * =================================================================================================
         */
        const AppController = {
            RUNTIME: {
                activeSettingsTab: 'appearance',
                onboardingStep: 1,
                onboardingProvider: null
            },

            CONSTANTS: {
                MODEL_SETTING_KEYS: [
                    'apiProvider', 'geminiApiKey', 'openRouterKey', 'openRouterModel',
                    'koboldcpp_url', 'koboldcpp_template', 'koboldcpp_min_p', 'koboldcpp_dry', 'lmstudio_url',
                    'geminiModel', 'webllmModel',
                    // Image Gen Keys
                    'imageGenBackend', 'koboldImageGenUrl', 'imageGenOpenRouterKey', 'imageGenOpenRouterModel',
                    'imageGenWidth', 'imageGenHeight',
                    'koboldImageGenCfg', 'koboldImageGenSampler', 'koboldImageGenScheduler', 'koboldImageGenSteps',
                    // Vision Bridge Keys
                    'visionBridgeBackend', 'visionBridgeUrl', 'visionBridgeModel',
                    'visionBridgeOpenRouterKey', 'visionBridgeInstruction',
                    // TTS Keys
                    'ttsEnabled', 'ttsVoice', 'ttsAutoPlayback', 'ttsBackend',
                    // Music Keys
                    'musicMode', 'musicBackend', 'musicOpenRouterModel', 'musicVolume', 'musicInterval',
                    // NanoGPT Keys
                    'nanoGPTKey', 'nanoGPTModel', 'imageGenNanoGPTKey', 'imageGenNanoGPTModel',
                    'nanoGPTTTSModel', 'nanoGPTTTSVoice', 'musicNanoGPTModel'
                ]
            },

            // --- Onboarding Logic ---
            goToOnboardingStep(step) {
                document.querySelectorAll('.onboarding-step').forEach(el => el.classList.remove('active'));
                const target = document.getElementById(`onboarding-step-${step}`);
                if (target) target.classList.add('active');
                this.RUNTIME.onboardingStep = step;
            },

            selectOnboardingModel(provider) {
                this.RUNTIME.onboardingProvider = provider;

                // UI feedback
                document.querySelectorAll('.model-option-card').forEach(el => el.classList.remove('selected'));
                let cardId = 'onboarding-model-local';
                if (provider === 'gemini') cardId = 'onboarding-model-cloud';
                else if (provider === 'openrouter') cardId = 'onboarding-model-openrouter';

                const targetCard = document.getElementById(cardId);
                if (targetCard) targetCard.classList.add('selected');

                // Toggle config sections
                const geminiCfg = document.getElementById('onboarding-config-gemini');
                const openrouterCfg = document.getElementById('onboarding-config-openrouter');
                const localCfg = document.getElementById('onboarding-config-local');
                if (geminiCfg) geminiCfg.classList.toggle('hidden', provider !== 'gemini');
                if (openrouterCfg) openrouterCfg.classList.toggle('hidden', provider !== 'openrouter');
                if (localCfg) localCfg.classList.toggle('hidden', provider !== 'koboldcpp');

                // Reset continue button
                const continueBtn = document.getElementById('onboarding-continue-btn');
                if (continueBtn) {
                    continueBtn.disabled = true;
                    continueBtn.classList.add('opacity-50', 'cursor-not-allowed');
                }
            },

            async verifyOnboardingModel(btn) {
                const provider = this.RUNTIME.onboardingProvider;
                if (!btn) btn = event.target; // Fallback
                const originalText = btn.textContent;
                btn.textContent = "Checking...";
                btn.disabled = true;

                try {
                    let success = false;
                    if (provider === 'gemini') {
                        const key = document.getElementById('onboarding-gemini-key').value;
                        if (!key) throw new Error("Please enter an API key.");
                        success = await APIService.testConnection('gemini', { geminiApiKey: key });
                        if (success) {
                            StateManager.data.globalSettings.geminiApiKey = key;
                            StateManager.data.globalSettings.apiProvider = 'gemini';
                            StateManager.saveGlobalSettings();
                        }
                    } else if (provider === 'openrouter') {
                        const key = document.getElementById('onboarding-openrouter-key').value;
                        if (!key) throw new Error("Please enter an API key.");
                        success = await APIService.testConnection('openrouter', { openRouterKey: key });
                        if (success) {
                            StateManager.data.globalSettings.openRouterKey = key;
                            StateManager.data.globalSettings.apiProvider = 'openrouter';
                            // Set a sensible default model for OpenRouter (Free/Stable)
                            StateManager.data.globalSettings.openRouterModel = 'openrouter/free';
                            StateManager.saveGlobalSettings();
                        }
                    } else if (provider === 'koboldcpp') {
                        // Test both default ports
                        try {
                            success = await APIService.testConnection('koboldcpp', { koboldcpp_url: 'http://localhost:5001' });
                            StateManager.data.globalSettings.apiProvider = 'koboldcpp';
                            StateManager.data.globalSettings.koboldcpp_url = 'http://localhost:5001';
                        } catch (e) {
                            try {
                                success = await APIService.testConnection('lmstudio', { lmstudio_url: 'http://localhost:1234' });
                                StateManager.data.globalSettings.apiProvider = 'lmstudio';
                                StateManager.data.globalSettings.lmstudio_url = 'http://localhost:1234';
                            } catch (e2) {
                                throw new Error("Could not find a running local server on port 5001 or 1234.");
                            }
                        }
                        if (success) StateManager.saveGlobalSettings();
                    }

                    if (success) {
                        btn.textContent = "Verified!";
                        btn.classList.remove('bg-indigo-600', 'bg-gray-700');
                        btn.classList.add('bg-green-600');

                        // Show model selection container
                        if (provider === 'gemini') {
                            await this.populateGeminiModels('onboarding-gemini-model-selector');
                            document.getElementById('onboarding-gemini-model-container')?.classList.remove('hidden');
                        } else if (provider === 'openrouter') {
                            document.getElementById('onboarding-openrouter-model-container')?.classList.remove('hidden');
                            this.populateOnboardingOpenRouterModels('text');
                        }

                        const continueBtn = document.getElementById('onboarding-continue-btn');
                        if (continueBtn) {
                            continueBtn.disabled = false;
                            continueBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                        }
                    }
                } catch (e) {
                    alert(e.message);
                    btn.textContent = "Failed - Try Again";
                    btn.classList.add('bg-red-600');
                } finally {
                    btn.disabled = false;
                    setTimeout(() => {
                        if (btn && btn.textContent !== "Verified!") {
                            btn.textContent = originalText;
                            btn.classList.remove('bg-red-600');
                        }
                    }, 3000);
                }
            },

            confirmOnboardingModel() {
                const provider = this.RUNTIME.onboardingProvider;
                if (provider === 'gemini') {
                    const model = document.getElementById('onboarding-gemini-model-selector').value;
                    StateManager.data.globalSettings.geminiModel = model;
                } else if (provider === 'openrouter') {
                    const model = document.getElementById('onboarding-openrouter-model').value;
                    StateManager.data.globalSettings.openRouterModel = model;
                }
                StateManager.saveGlobalSettings();
                this.goToOnboardingStep(3);
            },

            selectOnboardingImageProvider(provider) {
                this.RUNTIME.onboardingImageProvider = provider;
                document.querySelectorAll('#onboarding-step-3 .model-option-card').forEach(el => el.classList.remove('selected'));

                let cardId = 'onboarding-img-skip';
                if (provider === 'openrouter') cardId = 'onboarding-img-openrouter';
                else if (provider === 'koboldcpp') cardId = 'onboarding-img-local';

                document.getElementById(cardId)?.classList.add('selected');

                document.getElementById('onboarding-img-config-openrouter')?.classList.toggle('hidden', provider !== 'openrouter');
                document.getElementById('onboarding-img-config-local')?.classList.toggle('hidden', provider !== 'koboldcpp');

                if (provider === 'openrouter') {
                    this.populateOnboardingOpenRouterModels('image');
                }
            },

            confirmOnboardingImage() {
                const provider = this.RUNTIME.onboardingImageProvider || 'none';
                StateManager.data.globalSettings.imageGenBackend = provider === 'none' ? 'koboldcpp' : provider;

                if (provider === 'openrouter') {
                    StateManager.data.globalSettings.imageGenOpenRouterKey = StateManager.data.globalSettings.openRouterKey;
                    StateManager.data.globalSettings.imageGenOpenRouterModel = document.getElementById('onboarding-img-openrouter-model').value;
                } else if (provider === 'koboldcpp') {
                    StateManager.data.globalSettings.koboldImageGenUrl = document.getElementById('onboarding-img-local-url').value;
                }

                StateManager.saveGlobalSettings();
                this.goToOnboardingStep(4);
            },

            confirmOnboardingStep4(action) {
                // Execute via ActionHandler to leverage existing logic and persistence
                switch (action) {
                    case 'blank':
                        ActionHandler.handle('onboarding-create-blank');
                        break;
                    case 'architect':
                        ActionHandler.handle('onboarding-ai-generate');
                        break;
                    case 'import':
                        ActionHandler.handle('onboarding-import-png');
                        break;
                    case 'demo':
                        ActionHandler.handle('onboarding-explore-demo');
                        break;
                }
            },

            async initLocalWebLLM() {
                try {
                    await APIService.initWebLLM();
                    if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                        UIManager.showToast("WebLLM Engine successfully initialized.");
                    } else {
                        console.log("WebLLM Engine successfully initialized.");
                    }
                } catch (e) {
                    if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                        UIManager.showToast("Failed to initialize WebLLM.", true);
                    } else {
                        console.error("Failed to initialize WebLLM.", e);
                    }
                }
            },

            /**
             * Opens a modal dialog, performing necessary setup and guard checks.
             * @param {string} modalId - The ID of the modal to open.
             * @param {*} [contextId=null] - Optional context (character ID, message index, etc.).
             */
            openModal(modalId, contextId = null) {
                // 1. Guard: Check if story is loaded for context-dependent modals
                // 'io-hub-modal' and 'story-library-modal' are allowed without an active story.
                const needsStory = ['knowledge-modal', 'characters-modal', 'settings-modal', 'world-map-modal', 'example-dialogue-modal', 'character-detail-modal', 'edit-response-modal'];

                if (needsStory.includes(modalId) && !StateManager.getLibrary().active_story_id) {
                    alert("Please load a narrative first.");
                    return;
                }

                // 2. Specific Setup Logic based on Modal ID
                switch (modalId) {
                    case 'story-library-modal':
                        // Detect layout mode and pass it down
                        const isMobile = document.body.classList.contains('layout-vertical') || (window.innerHeight > window.innerWidth);
                        UIManager.renderLibraryInterface({ layout: isMobile ? 'mobile' : 'desktop' });
                        break;

                    case 'io-hub-modal':
                        UIManager.renderIOHubModal();
                        break;

                    case 'knowledge-modal':
                        // Reset to static tab by default
                        this.activeKnowledgeTab = 'static'; // Ensure Controller state is sync'd if used elsewhere
                        UIManager.switchKnowledgeTab('static');
                        break;

                    case 'world-map-modal':
                        // Reset map selection state via WorldController
                        if (typeof WorldController !== 'undefined') {
                            WorldController.RUNTIME.selectedMapTile = null;
                            WorldController.RUNTIME.pendingMove = null;
                            WorldController.RUNTIME.selectedLocalStaticEntryId = null;
                        }
                        UIManager.switchWorldMapTab('move');
                        break;

                    case 'settings-modal':
                        this.prepareSettingsModal();
                        this.switchSettingsTab(this.RUNTIME.activeSettingsTab || 'appearance');
                        break;

                    case 'example-dialogue-modal':
                        UIManager.renderExampleDialogueModal();
                        break;

                    case 'character-detail-modal':
                        UIManager.openCharacterDetailModal(contextId);
                        break;

                    case 'edit-response-modal':
                        // Delegate to NarrativeController if it exists
                        if (typeof NarrativeController !== 'undefined') {
                            NarrativeController.openEditModal(contextId);
                        }
                        break;


                    case 'location-details-modal':
                        UIManager.renderLocationDetailsModal();
                        break;
                }

                // 3. Open the modal via the low-level manager
                ModalManager.open(modalId);
            },

            /**
             * Closes a modal and performs necessary cleanup.
             * @param {string} modalId 
             */
            closeModal(modalId) {
                ModalManager.close(modalId);

                // Clear viewingStoryId if closing story details
                if (modalId === 'story-details-modal' || modalId === 'story-library-modal') {
                    UIManager.RUNTIME.viewingStoryId = null;
                }

                // Cleanup Logic
                if (modalId === 'character-detail-modal') {
                    UIManager.renderCharacters();
                }

                if (modalId === 'characters-modal') {
                    UIManager.updateAICharacterSelector();
                }

                if (modalId === 'knowledge-modal') {
                    // Clean up empty fields in dynamic entries
                    if (typeof WorldController !== 'undefined') {
                        WorldController.cleanupEmptyDynamicFields();
                    }
                }
            },

            /**
             * Updates a generic global setting and saves the state.
             */
            updateGlobalSetting(key, value) {
                if (!StateManager.data.globalSettings) StateManager.data.globalSettings = {};
                StateManager.data.globalSettings[key] = value;
                StateManager.saveGlobalSettings();
            },

            /**
             * Toggles the mobile navigation menu.
             */
            toggleMobileMenu() {
                const menu = document.getElementById('mobile-menu');
                if (menu) {
                    menu.classList.toggle('hidden');
                }
            },

            /**
             * Prepares the settings modal structure if it hasn't been initialized yet.
             */
            prepareSettingsModal() {
                // Logic removed to allow natural scrolling.
                // The CSS classes (flex-grow, min-h-0, overflow-y-auto) on the container 
                // handle the layout correctly without a fixed min-height.
            },

            /**
             * Renders the token usage visualizer and limits gauge.
             */
            renderTokenVisualizer() {
                const container = document.getElementById('context-visualizer-container');
                if (!container) return;

                const state = ReactiveStore.state;
                const selector = document.getElementById('visualizer-character-selector');

                if (selector) {
                    const currentVal = selector.value;
                    selector.innerHTML = '';
                    const characters = state.characters || [];
                    characters.forEach(char => {
                        const opt = document.createElement('option');
                        opt.value = char.id;
                        opt.textContent = char.name;
                        if (char.id === currentVal) {
                            opt.selected = true;
                        }
                        selector.appendChild(opt);
                    });

                    if (!selector.value && characters.length > 0) {
                        selector.value = characters[0].id;
                    }

                    if (!selector.dataset.listenerBound) {
                        selector.addEventListener('change', () => {
                            this.renderTokenVisualizer();
                        });
                        selector.dataset.listenerBound = 'true';
                    }
                }

                const charId = selector ? selector.value : null;
                if (!charId) {
                    this._updateVisualizerUI(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2048, 'N/A', 0);
                    return;
                }

                // Get components
                const components = PromptBuilder.getPromptComponents(charId);
                if (!components) {
                    this._updateVisualizerUI(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2048, 'N/A', 0);
                    return;
                }

                // Estimate context limit based on model provider settings
                let limit = 18432;
                let providerName = 'Default';

                if (state.apiProvider === 'koboldcpp') {
                    limit = 18432;
                    providerName = 'KoboldCPP';
                } else if (state.apiProvider === 'lmstudio') {
                    limit = 16384;
                    providerName = 'LM Studio';
                } else if (state.apiProvider === 'webllm') {
                    limit = 8192;
                    providerName = 'WebLLM';
                } else if (state.apiProvider === 'gemini') {
                    limit = 32768;
                    providerName = 'Gemini';
                } else if (state.apiProvider === 'openrouter') {
                    limit = 32768;
                    providerName = 'OpenRouter';
                } else if (state.apiProvider === 'nanogpt') {
                    limit = 32768;
                    providerName = 'NanoGPT';
                }

                const replacer = PromptBuilder._getReplacer(components.charToAct);

                // 1. Model Instructions
                const exampleDialogue = (state.chat_history || []).filter(m => m && m.isHidden);
                let exampleDialogueText = '';
                if (exampleDialogue.length > 0) {
                    let examples = "";
                    exampleDialogue.forEach(msg => {
                        if (!msg) return;
                        const char = ReactiveStore.getCharacter(msg.character_id);
                        const is_user = char ? char.is_user : (msg.character_id === 'user');
                        const name = char ? char.name : (is_user ? 'User' : 'Character');
                        examples += `${name}: ${replacer(msg.content)}\n`;
                    });
                    if (examples) {
                        exampleDialogueText = "## EXAMPLE DIALOGUE\n" + examples + "\n";
                    }
                }

                let instruction = "";
                if (components.customInstruction) {
                    instruction = components.customInstruction;
                } else {
                    instruction = `Generate the next response for ${components.charToAct.name}. Stay in character.`;
                }
                const responseLength = state.responseLength || 'normal';
                if (!components.charToAct.is_narrator) {
                    if (responseLength === 'short') instruction += " Keep the response concise and under two sentences, focusing only on the character's next words and actions.";
                    else if (responseLength === 'medium') instruction += " Keep the response between three to six sentences, including the character's next words and actions written with descriptive language.";
                    else if (responseLength === 'long') instruction += " Keep the response between two and four paragraphs. Be descriptive, verbose, and detailed in your response, providing this character's dialogue and actions, as well as full sensory descriptions of the surroundings, characters, and event.";
                    else if (responseLength === 'novel') instruction += " Continue writing a long-form addition to the text that builds on the current actions, describes the scene, and contributes to world-building. Include full sensory descriptions of the surroundings, characters, and events.";
                }
                instruction += " Do not repeat the character's name in the response itself.";

                const systemText = (components.system_prompt || '') + '\n\n' +
                    instruction + '\n\n' +
                    exampleDialogueText;
                const systemTokens = UTILITY.estimateTokens(systemText);
                const systemChars = systemText.length;

                // 2. Static Knowledge
                const staticLoreText = components.static_entries || '';
                const staticLoreTokens = UTILITY.estimateTokens(staticLoreText);
                const staticLoreChars = staticLoreText.length;

                // 3. Active Dynamic Knowledge (Triggered dynamic lorebooks)
                let dynamicLoreText = '';
                if (components.history && components.history.length > 0) {
                    components.history.forEach(msg => {
                        if (msg && msg.type === 'lore_reveal') {
                            dynamicLoreText += `### System Note:\n${replacer(msg.content)}\n\n`;
                        }
                    });
                }
                const dynamicLoreTokens = UTILITY.estimateTokens(dynamicLoreText);
                const dynamicLoreChars = dynamicLoreText.length;

                // 4. Character Persona (YOU)
                const activeChar = components.charToAct;
                const activeCharDesc = (state.evolved_characters && state.evolved_characters[activeChar.id]) ? state.evolved_characters[activeChar.id] : activeChar.description;
                const personaText = `### Character (YOU): ${activeChar.name}\n\n${replacer(activeCharDesc || '')}`;
                const personaTokens = UTILITY.estimateTokens(personaText);
                const personaChars = personaText.length;

                // 5. Roleplay Context (Scene locations & stats & other character appearances & timeline & relationships)
                const otherCharsText = [...(state.characters || []), ...ReactiveStore.getActiveLocationCharacters()]
                    .filter(c => c.is_active && c.id !== charId)
                    .map(c => {
                        const appearance = c.appearance || c.physical_description || c.short_description || "Unknown appearance.";
                        return `### Character (Present): ${c.name}\n### Outward Appearance\n${replacer(appearance)}`;
                    })
                    .join('\n\n');

                let timelineText = '';
                if (state.narrative_timeline && state.narrative_timeline.length > 0) {
                    timelineText = "## THE STORY SO FAR (TIMELINE)\n" + state.narrative_timeline.map(line => `- ${line}`).join('\n') + "\n\n";
                }

                let relationshipsText = '';
                if (state.relationship_matrix && state.relationship_matrix.length > 0) {
                    relationshipsText = "## CHARACTER RELATIONSHIPS\n" + state.relationship_matrix.join('\n') + "\n\n";
                }

                const contextText = (components.location_context ? ("## LOCATION CONTEXT\n" + components.location_context) : '') + '\n\n' +
                    (components.stats_context ? ("## CHARACTER STATS\n" + components.stats_context) : '') + '\n\n' +
                    otherCharsText + '\n\n' +
                    timelineText + '\n\n' +
                    relationshipsText;
                const contextTokens = UTILITY.estimateTokens(contextText);
                const contextChars = contextText.length;

                // 6. Recent History (Conversational chat & system events - excluding lore reveals)
                let historyText = '';
                if (components.history && components.history.length > 0) {
                    components.history.forEach(msg => {
                        if (!msg) return;
                        if (msg.type === 'chat' && msg.isHidden) return;

                        if (msg.type === 'chat') {
                            const char = ReactiveStore.getCharacter(msg.character_id);
                            const is_user = char ? char.is_user : (msg.character_id === 'user');
                            const name = char ? char.name : (is_user ? 'User' : 'Character');
                            historyText += `### ${name}:\n${replacer(msg.content)}\n\n`;
                        } else if (msg.type === 'system_event') {
                            historyText += `### System Event: ${replacer(msg.content)}\n\n`;
                        }
                    });
                }
                const historyTokens = UTILITY.estimateTokens(historyText);
                const historyChars = historyText.length;

                // Calculate Totals
                const totalUsedTokens = systemTokens + staticLoreTokens + dynamicLoreTokens + personaTokens + contextTokens + historyTokens;
                const freeTokens = Math.max(0, limit - totalUsedTokens);

                this._updateVisualizerUI(
                    systemTokens, systemChars,
                    staticLoreTokens, staticLoreChars,
                    dynamicLoreTokens, dynamicLoreChars,
                    personaTokens, personaChars,
                    contextTokens, contextChars,
                    historyTokens, historyChars,
                    freeTokens, limit, providerName,
                    components.prunedCount || 0
                );
            },

            /**
             * Updates the DOM elements for the context visualizer bar and legends.
             */
            _updateVisualizerUI(sysTok, sysCh, staticLoreTok, staticLoreCh, dynamicLoreTok, dynamicLoreCh, personaTok, personaCh, contextTok, contextCh, histTok, histCh, freeTok, limit, provider, prunedCount) {
                const badge = document.getElementById('context-limit-badge');
                const barWrapper = document.getElementById('context-progress-bar-wrapper');

                const sysBar = document.getElementById('bar-segment-system');
                const contextBar = document.getElementById('bar-segment-context');
                const staticLoreBar = document.getElementById('bar-segment-static-lore');
                const personaBar = document.getElementById('bar-segment-persona');
                const histBar = document.getElementById('bar-segment-history');
                const dynamicLoreBar = document.getElementById('bar-segment-dynamic-lore');
                const freeBar = document.getElementById('bar-segment-free');

                const legendSys = document.getElementById('legend-system-tokens');
                const legendContext = document.getElementById('legend-context-tokens');
                const legendStaticLore = document.getElementById('legend-static-lore-tokens');
                const legendPersona = document.getElementById('legend-persona-tokens');
                const legendHist = document.getElementById('legend-history-tokens');
                const legendDynamicLore = document.getElementById('legend-dynamic-lore-tokens');
                const legendFree = document.getElementById('legend-free-tokens');

                const alertEl = document.getElementById('context-pruned-alert');
                const prunedCountEl = document.getElementById('pruned-messages-count');

                const totalUsed = sysTok + staticLoreTok + dynamicLoreTok + personaTok + contextTok + histTok;

                let badgeText = `${totalUsed.toLocaleString()} / ${limit.toLocaleString()} tkn`;
                if (provider === 'Gemini') {
                    badgeText = `${totalUsed.toLocaleString()} / 1M+ tkn (Gemini)`;
                } else if (provider === 'OpenRouter') {
                    badgeText = `${totalUsed.toLocaleString()} / 128K+ tkn (OpenRouter)`;
                } else {
                    badgeText = `${totalUsed.toLocaleString()} / ${limit.toLocaleString()} tkn (${provider})`;
                }
                if (badge) badge.textContent = badgeText;

                let sysWidth = (sysTok / limit) * 100;
                let contextWidth = (contextTok / limit) * 100;
                let staticLoreWidth = (staticLoreTok / limit) * 100;
                let personaWidth = (personaTok / limit) * 100;
                let histWidth = (histTok / limit) * 100;
                let dynamicLoreWidth = (dynamicLoreTok / limit) * 100;

                const totalPct = sysWidth + contextWidth + staticLoreWidth + personaWidth + histWidth + dynamicLoreWidth;
                if (totalPct > 100) {
                    const scale = 100 / totalPct;
                    sysWidth *= scale;
                    contextWidth *= scale;
                    staticLoreWidth *= scale;
                    personaWidth *= scale;
                    histWidth *= scale;
                    dynamicLoreWidth *= scale;
                }
                const freeWidth = Math.max(0, 100 - (sysWidth + contextWidth + staticLoreWidth + personaWidth + histWidth + dynamicLoreWidth));

                if (sysBar) {
                    sysBar.style.width = `${sysWidth}%`;
                    sysBar.dataset.tokens = sysTok;
                    sysBar.dataset.chars = sysCh;
                    sysBar.dataset.pct = Math.round(sysWidth);
                }
                if (contextBar) {
                    contextBar.style.width = `${contextWidth}%`;
                    contextBar.dataset.tokens = contextTok;
                    contextBar.dataset.chars = contextCh;
                    contextBar.dataset.pct = Math.round(contextWidth);
                }
                if (staticLoreBar) {
                    staticLoreBar.style.width = `${staticLoreWidth}%`;
                    staticLoreBar.dataset.tokens = staticLoreTok;
                    staticLoreBar.dataset.chars = staticLoreCh;
                    staticLoreBar.dataset.pct = Math.round(staticLoreWidth);
                }
                if (personaBar) {
                    personaBar.style.width = `${personaWidth}%`;
                    personaBar.dataset.tokens = personaTok;
                    personaBar.dataset.chars = personaCh;
                    personaBar.dataset.pct = Math.round(personaWidth);
                }
                if (histBar) {
                    histBar.style.width = `${histWidth}%`;
                    histBar.dataset.tokens = histTok;
                    histBar.dataset.chars = histCh;
                    histBar.dataset.pct = Math.round(histWidth);
                }
                if (dynamicLoreBar) {
                    dynamicLoreBar.style.width = `${dynamicLoreWidth}%`;
                    dynamicLoreBar.dataset.tokens = dynamicLoreTok;
                    dynamicLoreBar.dataset.chars = dynamicLoreCh;
                    dynamicLoreBar.dataset.pct = Math.round(dynamicLoreWidth);
                }
                if (freeBar) {
                    freeBar.style.width = `${freeWidth}%`;
                    freeBar.dataset.tokens = Math.max(0, limit - totalUsed);
                    freeBar.dataset.chars = 0;
                    freeBar.dataset.pct = Math.round(freeWidth);
                }

                if (legendSys) legendSys.textContent = `${sysTok.toLocaleString()} tkn (${Math.round(sysWidth)}%)`;
                if (legendContext) legendContext.textContent = `${contextTok.toLocaleString()} tkn (${Math.round(contextWidth)}%)`;
                if (legendStaticLore) legendStaticLore.textContent = `${staticLoreTok.toLocaleString()} tkn (${Math.round(staticLoreWidth)}%)`;
                if (legendPersona) legendPersona.textContent = `${personaTok.toLocaleString()} tkn (${Math.round(personaWidth)}%)`;
                if (legendHist) legendHist.textContent = `${histTok.toLocaleString()} tkn (${Math.round(histWidth)}%)`;
                if (legendDynamicLore) legendDynamicLore.textContent = `${dynamicLoreTok.toLocaleString()} tkn (${Math.round(dynamicLoreWidth)}%)`;
                if (legendFree) legendFree.textContent = `${Math.max(0, limit - totalUsed).toLocaleString()} tkn (${Math.round(freeWidth)}%)`;

                if (prunedCount > 0) {
                    if (alertEl) alertEl.classList.remove('hidden');
                    if (prunedCountEl) prunedCountEl.textContent = prunedCount;
                    if (barWrapper) {
                        barWrapper.classList.add('border-red-500', 'animate-pulse-crimson');
                        barWrapper.classList.remove('border-gray-800');
                    }
                } else {
                    if (alertEl) alertEl.classList.add('hidden');
                    if (barWrapper) {
                        barWrapper.classList.remove('border-red-500', 'animate-pulse-crimson');
                        barWrapper.classList.add('border-gray-800');
                    }
                }

                this._setupVisualizerTooltip();
            },

            /**
             * Binds hover and tooltip tracking to the visualizer progress bar.
             */
            _setupVisualizerTooltip() {
                const barWrapper = document.getElementById('context-progress-bar-wrapper');
                const tooltip = document.getElementById('context-visualizer-tooltip');
                if (!barWrapper || !tooltip) return;

                const handleMouseMove = (e) => {

                    const target = e.target;
                    const segment = target.dataset.segment;
                    if (!segment) {
                        tooltip.style.opacity = '0';
                        return;
                    }

                    let title = '';
                    let colorClass = '';
                    let details = '';

                    const tokens = parseInt(target.dataset.tokens || '0');
                    const chars = parseInt(target.dataset.chars || '0');
                    const pct = target.dataset.pct || '0';

                    switch (segment) {
                        case 'system':
                            title = 'Model Instructions';
                            colorClass = 'text-indigo-400';
                            details = `Base system prompt, event master directives, and custom roleplay instruction overrides directing the model.`;
                            break;
                        case 'context':
                            title = 'Roleplay Context & Scene';
                            colorClass = 'text-amber-400';
                            details = `Current spatial coordinates, location prompt descriptions, character stats, and present characters' outward appearances.`;
                            break;
                        case 'static-lore':
                            title = 'Static Knowledge';
                            colorClass = 'text-teal-400';
                            details = `Persistent lore, global rules, and World Bible entries currently active for this story.`;
                            break;
                        case 'persona':
                            title = 'Character Persona (YOU)';
                            colorClass = 'text-emerald-400';
                            details = `The complete description, history, psychological rules, and core personality traits of the acting character.`;
                            break;
                        case 'history':
                            title = 'Recent History';
                            colorClass = 'text-violet-400';
                            details = `Recent conversational messages and system events, maintaining context continuity.`;
                            break;
                        case 'dynamic-lore':
                            title = 'Active Dynamic Knowledge';
                            colorClass = 'text-cyan-400';
                            details = `Triggered context-specific dynamic lorebook items, injected to give the model short-term world memory.`;
                            break;
                        case 'free':
                            title = 'Available Remaining Space';
                            colorClass = 'text-gray-400';
                            details = `Unused capacity in context window. Higher remaining space allows for longer response generation lengths.`;
                            break;
                    }

                    tooltip.innerHTML = `
                        <div class="font-bold ${colorClass} text-xs uppercase tracking-wide mb-1">${title}</div>
                        <div class="font-mono text-gray-300 font-bold mb-1">
                            ${tokens.toLocaleString()} tokens <span class="text-gray-500 font-normal">(${pct}%)</span>
                        </div>
                        ${chars > 0 ? `<div class="text-[10px] text-gray-400 mb-1">${chars.toLocaleString()} characters</div>` : ''}
                        <div class="text-[10px] text-gray-500 font-sans mt-1.5 leading-normal border-t border-gray-800 pt-1.5">${details}</div>
                    `;

                    const barRect = barWrapper.getBoundingClientRect();
                    let y = barRect.top - tooltip.offsetHeight - 8;
                    if (y < 8) {
                        y = barRect.bottom + 8;
                    }

                    tooltip.style.left = `${Math.min(window.innerWidth - tooltip.offsetWidth - 8, Math.max(8, e.clientX - tooltip.offsetWidth / 2))}px`;
                    tooltip.style.top = `${y}px`;
                    tooltip.style.opacity = '1';
                };

                const handleMouseLeave = () => {
                    tooltip.style.opacity = '0';
                };

                if (barWrapper.dataset.tooltipBound) {
                    barWrapper.removeEventListener('mousemove', barWrapper._onMouseMove);
                    barWrapper.removeEventListener('mouseleave', barWrapper._onMouseLeave);
                }

                barWrapper._onMouseMove = handleMouseMove;
                barWrapper._onMouseLeave = handleMouseLeave;
                barWrapper.addEventListener('mousemove', handleMouseMove);
                barWrapper.addEventListener('mouseleave', handleMouseLeave);
                barWrapper.dataset.tooltipBound = 'true';
            },

            /**
             * Switches tabs within the Settings modal.
             * @param {string} tabName - 'appearance', 'prompt', or 'model'.
             */
            switchSettingsTab(tabName) {
                this.RUNTIME.activeSettingsTab = tabName;
                const tabs = ['appearance', 'prompt', 'agents', 'model', 'personas', 'image-gen', 'export', 'defaults'];
                const container = document.getElementById('settings-content-container');
                const template = document.getElementById(`settings-${tabName}-content`);

                if (container && template) {
                    container.innerHTML = template.innerHTML;
                    const buildDisplay = document.getElementById('build-info-display');
                    if (buildDisplay && typeof APP_BUILD_TIMESTAMP !== 'undefined') {
                        buildDisplay.textContent = APP_BUILD_TIMESTAMP;
                    }
                }

                tabs.forEach(tab => {
                    const tabButton = document.getElementById(`settings-tab-${tab}`);
                    if (tabButton) {
                        if (tab === tabName) {
                            tabButton.classList.add('border-teal-500', 'text-white');
                            tabButton.classList.remove('border-transparent', 'text-gray-400');
                        } else {
                            tabButton.classList.remove('border-teal-500', 'text-white');
                            tabButton.classList.add('border-transparent', 'text-gray-400');
                        }
                    }
                    const sidebarButton = document.getElementById(`settings-tab-sidebar-${tab}`);
                    if (sidebarButton) {
                        if (tab === tabName) {
                            sidebarButton.classList.add('active');
                        } else {
                            sidebarButton.classList.remove('active');
                        }
                    }
                });

                this.bindSettingsListeners();

                if (tabName === 'agents') {
                    if (typeof AgentController !== 'undefined') AgentController.renderSettings();
                } else if (tabName === 'personas') {
                    this.renderUserPersonaList();
                } else if (tabName === 'prompt') {
                    this.renderTokenVisualizer();
                } else if (tabName === 'model') {
                    this.renderSavedOpenRouterModels();
                    this.renderSavedNanoGPTModels();
                    // NEW: Populate Gemini Models dynamically
                    this.populateGeminiModels();
                    // Render TTS Settings
                    this.renderTTSSettings();

                    const testLMBtn = document.getElementById('test-lmstudio-btn');
                    const lmStatusText = document.getElementById('lmstudio-status-text');
                    if (testLMBtn) {
                        testLMBtn.onclick = async () => {
                            const url = document.getElementById('lmstudio-url-input')?.value || 'http://localhost:1234';
                            if (lmStatusText) {
                                lmStatusText.textContent = "Testing...";
                                lmStatusText.className = "text-xs text-yellow-400 font-semibold";
                            }
                            try {
                                const ok = await APIService.testConnection('lmstudio', { lmstudio_url: url });
                                if (lmStatusText) {
                                    if (ok) {
                                        lmStatusText.textContent = "Online ✅";
                                        lmStatusText.className = "text-xs text-green-400 font-semibold";
                                    } else {
                                        lmStatusText.textContent = "Offline ❌";
                                        lmStatusText.className = "text-xs text-red-400 font-semibold";
                                    }
                                }
                            } catch (e) {
                                if (lmStatusText) {
                                    lmStatusText.textContent = `Error: ${e.message || "Failed"}`;
                                    lmStatusText.className = "text-xs text-red-400 font-semibold";
                                }
                            }
                        };
                    }
                } else if (tabName === 'image-gen') {
                    // Dynamic show/hide based on backend
                    const backendSelect = document.getElementById('image-gen-backend');
                    const koboldSettings = document.getElementById('image-gen-kobold-settings');
                    const openRouterSettings = document.getElementById('image-gen-openrouter-settings');
                    const nanoGPTSettings = document.getElementById('image-gen-nanogpt-settings');

                    // NEW: Render saved image models
                    this.renderSavedOpenRouterImageModels();
                    this.renderSavedNanoGPTImageModels();



                    // Initial Visibility Check (handled by bindSettingsListeners primarily, but we force one check)
                    setTimeout(() => AppController.updateImageGenSettingsVisibility(), 50);

                    // Test Connection Button
                    const testBtn = document.getElementById('test-image-gen-connection-btn');
                    const statusEl = document.getElementById('image-gen-connection-status');
                    if (testBtn) {
                        testBtn.onclick = async () => {
                            if (statusEl) { statusEl.textContent = "Testing..."; statusEl.className = "text-yellow-400 text-xs mt-2"; }
                            const result = await ImageGenerationService.testConnection();
                            if (statusEl) {
                                if (result) {
                                    statusEl.textContent = "Connection Successful!";
                                    statusEl.className = "text-green-400 text-xs mt-2";
                                } else {
                                    statusEl.textContent = "Connection Failed. Check URL/Key.";
                                    statusEl.className = "text-red-400 text-xs mt-2";
                                }
                            }
                        };
                    }
                } else if (tabName === 'export') {
                    const selector = document.getElementById('export-primary-character-selector');
                    if (selector) {
                        const currentVal = selector.value;
                        selector.innerHTML = '<option value="">Auto-detect (First AI)</option>';
                        const state = StateManager.getState();
                        if (state && state.characters && Array.isArray(state.characters)) {
                            state.characters.forEach(c => {
                                const opt = document.createElement('option');
                                opt.value = c.id;
                                opt.textContent = `${c.name || 'Unnamed'}${c.is_user ? ' (User)' : ''}`;
                                if (c.id === currentVal) opt.selected = true;
                                selector.appendChild(opt);
                            });
                        }
                    }
                }
            },

            /**
             * Fetches available Gemini models and populates the selector.
             */
            async populateGeminiModels(selectorId = 'gemini-model-selector') {
                const selector = document.getElementById(selectorId);
                const state = StateManager.getState();
                const globalSettings = StateManager.data.globalSettings;

                // Get Key from global settings primarily
                const apiKey = globalSettings.geminiApiKey || state.geminiApiKey;

                if (!selector) return;

                // If no key, show placeholder
                if (!apiKey) {
                    selector.innerHTML = '<option value="gemini-flash-latest">Default (Gemini 1.5 Flash)</option>';
                    return;
                }

                const currentSelection = globalSettings.geminiModel || state.geminiModel || 'gemini-1.5-flash-latest';

                // Add loading indicator
                selector.innerHTML = '<option>Fetching available models...</option>';

                try {
                    const models = await APIService.getGeminiModels();

                    if (models.length > 0) {
                        selector.innerHTML = ''; // Clear loading
                        models.forEach(m => {
                            // m.name usually comes as "models/gemini-pro"
                            // We will use the simple ID "gemini-pro" as value to keep things clean,
                            // or keep the full name. APIService.callGemini now handles both.
                            // Let's store the CLEAN ID.
                            const simpleId = m.name.replace('models/', '');

                            const opt = document.createElement('option');
                            opt.value = simpleId;
                            opt.text = `${m.displayName} (${m.version})`;
                            selector.appendChild(opt);
                        });
                    } else {
                        // Fallback if list fails but key exists
                        selector.innerHTML = '<option value="gemini-flash-latest">Gemini 1.5 Flash (Fallback)</option><option value="gemini-1.5-pro">Gemini 1.5 Pro</option>';
                    }

                    // Restore selection
                    // We check against the simple ID (e.g. "gemini-1.5-flash")
                    let cleanCurrent = currentSelection.replace('models/', '');
                    selector.value = cleanCurrent;

                } catch (e) {
                    console.error("Error populating models", e);
                    selector.innerHTML = '<option value="gemini-flash-latest">Error loading list (Using Flash)</option>';
                }
            },

            /**
             * Fetches and populates OpenRouter model datalists for onboarding.
             */
            async populateOnboardingOpenRouterModels(mode = 'text') {
                const datalistId = mode === 'text' ? 'onboarding-openrouter-models-list' : 'onboarding-img-openrouter-models-list';
                const datalist = document.getElementById(datalistId);
                if (!datalist) return;

                // If already populated, skip (unless we want to refresh)
                if (datalist.options.length > 5) return;

                try {
                    const models = await APIService.fetchOpenRouterModels();
                    if (!models || models.length === 0) return;

                    // Filter based on mode
                    const filtered = mode === 'image' ?
                        models.filter(m => {
                            const id = m.id.toLowerCase();
                            return m.modalities?.includes('image') ||
                                m.architecture?.output_modalities?.includes('image') ||
                                id.includes('flux') || id.includes('diffusion') || id.includes('dall-e');
                        }) :
                        models.filter(m => {
                            const mod = m.architecture?.modality;
                            return mod !== 'text->image';
                        });

                    datalist.innerHTML = '';

                    // Ensure the default free model is always at the top if it exists
                    const defaultFree = 'openrouter/free';
                    if (!filtered.find(m => m.id === defaultFree)) {
                        const opt = document.createElement('option');
                        opt.value = defaultFree;
                        opt.textContent = "OpenRouter Free (Auto)";
                        datalist.appendChild(opt);
                    }

                    filtered.forEach(m => {
                        const opt = document.createElement('option');
                        opt.value = m.id;
                        opt.textContent = m.name || m.id;
                        datalist.appendChild(opt);
                    });
                } catch (e) {
                    console.error("Failed to populate onboarding OpenRouter models", e);
                }
            },

            /**
             * Renders the TTS settings interface.
             */
            renderTTSSettings() {
                const selector = document.getElementById('tts-voice-selector');
                if (!selector) return;

                const globalSettings = StateManager.data.globalSettings;
                const currentVoice = globalSettings.ttsVoice || 'Puck';

                // Clear and populate
                selector.innerHTML = '';

                if (TTSService && TTSService.CONSTANTS && TTSService.CONSTANTS.VOICES) {
                    TTSService.CONSTANTS.VOICES.forEach(voice => {
                        const opt = document.createElement('option');
                        opt.value = voice.id;
                        opt.textContent = voice.name;
                        if (voice.id === currentVoice) opt.selected = true;
                        selector.appendChild(opt);
                    });
                } else {
                    const opt = document.createElement('option');
                    opt.textContent = "Error loading voices";
                    selector.appendChild(opt);
                }

                // TTS Mode (Replaces toggles)
                const ttsModeSelect = document.getElementById('tts-mode-select');
                if (ttsModeSelect) {
                    // Migration / Default
                    if (!globalSettings.ttsMode) {
                        if (globalSettings.ttsEnabled === true || globalSettings.ttsEnabled === 'true') {
                            globalSettings.ttsMode = 'all'; // Default to 'all' if previously enabled
                        } else {
                            globalSettings.ttsMode = 'off';
                        }
                    }
                    ttsModeSelect.value = globalSettings.ttsMode;
                }

                // Background Music Settings Load
                const musicModeSelect = document.getElementById('music-mode-select');
                if (musicModeSelect) {
                    musicModeSelect.value = globalSettings.musicMode || 'off';
                }

                // Hydrate backend selector buttons
                const musicBackend = globalSettings.musicBackend || 'gemini';
                const backendBtns = document.querySelectorAll('#music-backend-selector .music-backend-option');
                const activeBackendValue = (globalSettings.musicMode === 'on') ? musicBackend : 'off';
                backendBtns.forEach(btn => {
                    btn.classList.toggle('active', btn.getAttribute('data-action-val') === activeBackendValue);
                });

                // Show/hide provider panels + playback controls
                const geminiInfo = document.getElementById('music-gemini-info');
                const orInfo = document.getElementById('music-openrouter-info');
                const nanoInfo = document.getElementById('music-nanogpt-info');
                const playbackCtrl = document.getElementById('music-playback-controls');
                const badge = document.getElementById('music-backend-badge');

                if (geminiInfo) geminiInfo.classList.toggle('hidden', activeBackendValue !== 'gemini');
                if (orInfo) orInfo.classList.toggle('hidden', activeBackendValue !== 'openrouter');
                if (nanoInfo) nanoInfo.classList.toggle('hidden', activeBackendValue !== 'nanogpt');
                if (playbackCtrl) playbackCtrl.classList.toggle('hidden', activeBackendValue === 'off');
                if (badge) {
                    badge.textContent = activeBackendValue === 'off' ? 'AI Music'
                        : activeBackendValue === 'gemini' ? 'Gemini / Lyria'
                            : activeBackendValue === 'nanogpt' ? 'NanoGPT'
                                : 'OpenRouter';
                }

                // Populate OpenRouter/NanoGPT music model inputs
                const musicORModelInput = document.getElementById('music-openrouter-model-input');
                if (musicORModelInput) {
                    musicORModelInput.value = globalSettings.musicOpenRouterModel || 'google/lyria-3-clip-preview';
                }
                const musicNanoModelInput = document.getElementById('music-nanogpt-model-input');
                if (musicNanoModelInput) {
                    musicNanoModelInput.value = globalSettings.musicNanoGPTModel || 'google/lyria-3-clip-preview';
                }

                const musicVolSlider = document.getElementById('music-volume-slider');
                const musicVolValue = document.getElementById('music-volume-value');
                if (musicVolSlider) {
                    musicVolSlider.value = globalSettings.musicVolume || 30;
                    if (musicVolValue) musicVolValue.textContent = `${globalSettings.musicVolume || 30}%`;
                }
                const musicIntSlider = document.getElementById('music-interval-slider');
                const musicIntValue = document.getElementById('music-interval-value');
                if (musicIntSlider) {
                    musicIntSlider.value = globalSettings.musicInterval || 10;
                    if (musicIntValue) musicIntValue.textContent = `${globalSettings.musicInterval || 10} msgs`;
                }
            },

            /**
             * Opens the settings modal and immediately switches to a specific tab.
             */
            openSettingsToTab(tabName) {
                this.openModal('settings-modal');
                this.switchSettingsTab(tabName);
            },

            /**
             * Binds live event listeners to inputs in the Settings modal.
             * Handles bi-directional binding between UI and ReactiveStore/GlobalSettings.
             */
            bindSettingsListeners() {
                const state = ReactiveStore.state;
                const globalSettings = StateManager.data.globalSettings;

                // Retrieve defaults to handle uninitialized values (e.g. blank prompts)
                const defaultPrompts = UTILITY.getDefaultSystemPrompts();
                const defaultUI = UTILITY.getDefaultUiSettings();
                const defaultStory = UTILITY.getDefaultStorySettings();
                const allDefaults = { ...defaultPrompts, ...defaultUI, ...defaultStory };

                const setListener = (id, key, callback) => {
                    const input = document.getElementById(id);
                    if (!input) return;

                    const isGlobal = this.CONSTANTS.MODEL_SETTING_KEYS.includes(key);

                    // Logic to determine value: Global -> State -> Default -> Empty String
                    let val;
                    if (isGlobal) {
                        val = globalSettings[key];
                    } else {
                        val = state[key];
                        // If state value is missing/undefined, try the default
                        if (val === undefined || val === null) {
                            val = allDefaults[key];
                        }
                    }

                    input.value = (val !== undefined && val !== null) ? val : '';

                    // Define debounced saver to prevent DB thrashing
                    const debouncedSaver = debounce(function (callback) {
                        if (isGlobal) {
                            StateManager.saveGlobalSettings();
                        } else {
                            // Explicitly trigger the save mechanism
                            if (typeof ReactiveStore.forceSave === 'function') {
                                ReactiveStore.forceSave();
                            }
                        }
                        if (callback) callback();
                    }.bind(this), 500);

                    // Create Input Handler
                    const inputHandler = (e) => {
                        const newVal = e.target.value;

                        if (isGlobal) {
                            globalSettings[key] = newVal;
                            // Sync runtime immediately
                            state[key] = newVal;
                        } else {
                            // Update Proxy State immediately
                            state[key] = newVal;
                        }

                        // Schedule Save
                        debouncedSaver(callback);
                    };

                    input.addEventListener('input', inputHandler);
                };

                // Helper: Bind range sliders
                const setupSlider = (sliderId, valueId, stateKey, callback = null) => {
                    const slider = document.getElementById(sliderId);
                    const valueDisplay = document.getElementById(valueId);
                    if (!slider || !valueDisplay) return;

                    const isGlobal = this.CONSTANTS.MODEL_SETTING_KEYS.includes(stateKey);
                    let currentValue = isGlobal ? globalSettings[stateKey] : state[stateKey];
                    if (currentValue === undefined || currentValue === null) {
                        currentValue = allDefaults[stateKey] !== undefined ? allDefaults[stateKey] : 0;
                    }

                    slider.value = currentValue;
                    valueDisplay.textContent = slider.value;
                    if (callback) callback(slider.value);

                    slider.addEventListener('input', (e) => {
                        const newValue = parseFloat(e.target.value);

                        if (isGlobal) {
                            globalSettings[stateKey] = newValue;
                            state[stateKey] = newValue; // Sync runtime
                        } else {
                            state[stateKey] = newValue;
                        }

                        valueDisplay.textContent = e.target.value;
                        if (callback) callback(e.target.value);
                    });

                    slider.addEventListener('change', () => {
                        if (isGlobal) StateManager.saveGlobalSettings();
                        // ReactiveStore auto-saves state on set, so no manual save needed for local state
                    });
                };

                // --- Bindings: Vision Bridge (Model Tab) ---
                if (document.getElementById('vision-bridge-backend')) setListener('vision-bridge-backend', 'visionBridgeBackend', () => {
                    AppController.updateVisionBridgeSettingsVisibility();
                });
                if (document.getElementById('vision-bridge-url')) setListener('vision-bridge-url', 'visionBridgeUrl');
                if (document.getElementById('vision-bridge-model')) setListener('vision-bridge-model', 'visionBridgeModel');
                if (document.getElementById('vision-bridge-openrouter-key')) setListener('vision-bridge-openrouter-key', 'visionBridgeOpenRouterKey');
                if (document.getElementById('vision-bridge-instruction')) setListener('vision-bridge-instruction', 'visionBridgeInstruction');

                // --- Bindings: Image Generation Tab ---
                if (document.getElementById('image-gen-backend')) setListener('image-gen-backend', 'imageGenBackend', () => {
                    // Trigger visibility update if valid
                    AppController.updateImageGenSettingsVisibility();
                });

                // Art Style Binding (Explicit)
                const artStyleSelect = document.getElementById('image-gen-art-style');
                if (artStyleSelect) {
                    artStyleSelect.value = state.imageGenArtStyle || 'none';
                    artStyleSelect.addEventListener('change', (e) => {
                        state.imageGenArtStyle = e.target.value;
                        if (typeof ReactiveStore.forceSave === 'function') ReactiveStore.forceSave();
                    });
                }

                if (document.getElementById('image-gen-kobold-url')) setListener('image-gen-kobold-url', 'koboldImageGenUrl');
                if (document.getElementById('image-gen-width')) setListener('image-gen-width', 'imageGenWidth');
                if (document.getElementById('image-gen-height')) setListener('image-gen-height', 'imageGenHeight');
                if (document.getElementById('image-gen-openrouter-key-input')) setListener('image-gen-openrouter-key-input', 'imageGenOpenRouterKey');
                if (document.getElementById('image-gen-openrouter-model-input')) setListener('image-gen-openrouter-model-input', 'imageGenOpenRouterModel');
                if (document.getElementById('image-gen-nanogpt-key-input')) setListener('image-gen-nanogpt-key-input', 'imageGenNanoGPTKey');
                if (document.getElementById('image-gen-nanogpt-model-input')) setListener('image-gen-nanogpt-model-input', 'imageGenNanoGPTModel');

                // Kobold Extended Settings
                if (document.getElementById('kobold-cfg-scale')) setListener('kobold-cfg-scale', 'koboldImageGenCfg');
                if (document.getElementById('kobold-sampler')) setListener('kobold-sampler', 'koboldImageGenSampler');
                if (document.getElementById('kobold-scheduler')) setListener('kobold-scheduler', 'koboldImageGenScheduler');
                if (document.getElementById('kobold-steps')) setListener('kobold-steps', 'koboldImageGenSteps');

                // --- Bindings: Model Tab ---
                if (document.getElementById('gemini-api-key-input')) setListener('gemini-api-key-input', 'geminiApiKey');
                if (document.getElementById('openrouter-api-key-input')) setListener('openrouter-api-key-input', 'openRouterKey');
                if (document.getElementById('openrouter-model-input')) setListener('openrouter-model-input', 'openRouterModel');
                if (document.getElementById('nanogpt-api-key-input')) setListener('nanogpt-api-key-input', 'nanoGPTKey');
                if (document.getElementById('nanogpt-model-input')) setListener('nanogpt-model-input', 'nanoGPTModel');
                if (document.getElementById('koboldcpp-min-p-slider')) setupSlider('koboldcpp-min-p-slider', 'koboldcpp-min-p-value', 'koboldcpp_min_p');
                if (document.getElementById('koboldcpp-dry-slider')) setupSlider('koboldcpp-dry-slider', 'koboldcpp-dry-value', 'koboldcpp_dry');
                if (document.getElementById('koboldcpp-url-input')) setListener('koboldcpp-url-input', 'koboldcpp_url');
                if (document.getElementById('lmstudio-url-input')) setListener('lmstudio-url-input', 'lmstudio_url');
                if (document.getElementById('webllm-model-selector')) setListener('webllm-model-selector', 'webllmModel');
                // Gemini Model Selector (Just bind listener, population handled in switchSettingsTab)
                setListener('gemini-model-selector', 'geminiModel');


                // --- Bindings: TTS ---
                if (document.getElementById('tts-mode-select')) {
                    const modeSelect = document.getElementById('tts-mode-select');
                    modeSelect.addEventListener('change', (e) => {
                        const val = e.target.value;
                        globalSettings.ttsMode = val;
                        // Legacy persistence (optional)
                        if (val === 'off') globalSettings.ttsEnabled = false;
                        else globalSettings.ttsEnabled = true;

                        state.ttsMode = val;
                        StateManager.saveGlobalSettings();
                    });
                }
                if (document.getElementById('tts-voice-selector')) setListener('tts-voice-selector', 'ttsVoice');

                // --- Bindings: Background Music ---
                if (document.getElementById('music-mode-select')) {
                    const musicSelect = document.getElementById('music-mode-select');
                    musicSelect.addEventListener('change', (e) => {
                        const val = e.target.value;
                        globalSettings.musicMode = val;
                        StateManager.saveGlobalSettings();
                        // Stop music if turning off
                        if (val === 'off' && typeof MusicService !== 'undefined') {
                            MusicService.stop();
                        }
                    });
                }
                if (document.getElementById('music-volume-slider')) {
                    const slider = document.getElementById('music-volume-slider');
                    const valDisplay = document.getElementById('music-volume-value');
                    slider.addEventListener('input', (e) => {
                        const vol = parseInt(e.target.value);
                        globalSettings.musicVolume = vol;
                        if (valDisplay) valDisplay.textContent = `${vol}%`;
                        if (typeof MusicService !== 'undefined') MusicService.setVolume(vol / 100);
                        StateManager.saveGlobalSettings();
                    });
                }
                if (document.getElementById('music-interval-slider')) {
                    const slider = document.getElementById('music-interval-slider');
                    const valDisplay = document.getElementById('music-interval-value');
                    slider.addEventListener('input', (e) => {
                        const val = parseInt(e.target.value);
                        globalSettings.musicInterval = val;
                        if (valDisplay) valDisplay.textContent = `${val} msgs`;
                        StateManager.saveGlobalSettings();
                    });
                }

                // Backend selector button group (Off / Gemini / OpenRouter)
                const backendSelector = document.getElementById('music-backend-selector');
                if (backendSelector) {
                    backendSelector.addEventListener('click', (e) => {
                        const btn = e.target.closest('.music-backend-option');
                        if (!btn) return;
                        const val = btn.getAttribute('data-action-val');

                        // Toggle active state on buttons
                        backendSelector.querySelectorAll('.music-backend-option').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');

                        // Update globalSettings
                        if (val === 'off') {
                            globalSettings.musicMode = 'off';
                            if (typeof MusicService !== 'undefined') MusicService.stop();
                        } else {
                            globalSettings.musicMode = 'on';
                            globalSettings.musicBackend = val;
                        }

                        // Sync hidden select for backward compat
                        const hiddenSelect = document.getElementById('music-mode-select');
                        if (hiddenSelect) hiddenSelect.value = globalSettings.musicMode;

                        // Toggle provider info panels + playback controls
                        const geminiInfo = document.getElementById('music-gemini-info');
                        const orInfo = document.getElementById('music-openrouter-info');
                        const nanoInfo = document.getElementById('music-nanogpt-info');
                        const playbackCtrl = document.getElementById('music-playback-controls');
                        const badge = document.getElementById('music-backend-badge');

                        if (geminiInfo) geminiInfo.classList.toggle('hidden', val !== 'gemini');
                        if (orInfo) orInfo.classList.toggle('hidden', val !== 'openrouter');
                        if (nanoInfo) nanoInfo.classList.toggle('hidden', val !== 'nanogpt');
                        if (playbackCtrl) playbackCtrl.classList.toggle('hidden', val === 'off');
                        if (badge) {
                            badge.textContent = val === 'off' ? 'AI Music'
                                : val === 'gemini' ? 'Gemini / Lyria'
                                    : val === 'nanogpt' ? 'NanoGPT'
                                        : 'OpenRouter';
                        }

                        StateManager.saveGlobalSettings();
                    });
                }

                // Save music NanoGPT model when manually typed
                const musicNanoModelInput = document.getElementById('music-nanogpt-model-input');
                if (musicNanoModelInput) {
                    musicNanoModelInput.addEventListener('change', (e) => {
                        const val = e.target.value.trim();
                        if (val) {
                            globalSettings.musicNanoGPTModel = val;
                            StateManager.saveGlobalSettings();
                        }
                    });
                }

                // --- Bindings: Appearance Tab ---
                // Background Image Handlers (Delegating to LibraryController if available)
                document.getElementById('background-image-upload')?.addEventListener('change', (e) => {
                    if (typeof LibraryController !== 'undefined') LibraryController.handleBackgroundImageUpload(e);
                });
                document.getElementById('background-image-clear')?.addEventListener('click', () => {
                    if (typeof LibraryController !== 'undefined') LibraryController.clearBackgroundImage();
                });

                // Visual Settings
                if (document.getElementById('chat-text-color')) setListener('chat-text-color', 'chatTextColor');
                if (document.getElementById('blur-slider')) setupSlider('blur-slider', 'blur-value', 'backgroundBlur');
                if (document.getElementById('text-size-slider')) setupSlider('text-size-slider', 'text-size-value', 'textSize');
                if (document.getElementById('bubble-image-size-slider')) setupSlider('bubble-image-size-slider', 'bubble-image-size-value', 'bubbleImageSize');

                // Response Length Binding
                if (document.getElementById('response-length-selector')) setListener('response-length-selector', 'responseLength');
                if (document.getElementById('response-style-selector')) setListener('response-style-selector', 'responseStyle');

                // Local visual master chance slider (the Event Master is an agent now: Settings → Agents)
                if (document.getElementById('visual-master-prob-slider')) {
                    setupSlider('visual-master-prob-slider', 'visual-master-prob-value', 'visual_master_probability', (val) => {
                        const el = document.getElementById('visual-master-prob-value');
                        if (el) el.textContent = `${val}%`;
                    });
                }

                // Background Hint Update
                const bgHint = document.getElementById('background-image-hint');
                if (bgHint) {
                    if (state.backgroundImageURL === 'local_idb_background') {
                        bgHint.textContent = 'Current: [Local Image]';
                    } else if (state.backgroundImageURL) {
                        bgHint.textContent = 'Current: ' + state.backgroundImageURL;
                    }
                }

                // --- Prompt Editor Logic (Unified) ---
                const promptGroups = {
                    'Core Narrative': ['system_prompt', 'prompt_combine_messages', 'prompt_response_options_gen', 'prompt_stats_init', 'prompt_story_notes_gen', 'prompt_story_tags_gen'],
                    'Agents': ['visual_master_base_prompt', 'prompt_persona_gen', 'prompt_living_persona_gen', 'prompt_timeline_extractor', 'prompt_relationship_matrix'],
                    'Lore & Map': ['prompt_world_map_gen', 'prompt_location_gen', 'prompt_adjacent_locations_gen', 'prompt_entry_gen', 'prompt_location_memory_gen', 'prompt_auto_static_knowledge'],
                    'Director Mode': ['swarm_scratchpad_prompt', 'swarm_director_prompt'],
                    'Objectivity': ['prompt_objectivity_description', 'prompt_objectivity_thoughts'],
                    'Text Mode': ['prompt_text_mode']
                };

                const promptInfo = {
                    'system_prompt': 'The core persona and instructions for the main narrative AI. Variables: {character_name}',
                    'visual_master_base_prompt': 'Automatically generates visuals for the scene based on chat context. Variable: {chat_history}',
                    'prompt_persona_gen': 'Used by the AI button on a character\'s persona. Variables: {concept}, {name}',
                    'prompt_living_persona_gen': 'Evolves a character based on recent history. Variables: {base_persona}, {transcript}',
                    'prompt_combine_messages': 'Fuses a message and the reply to it into one passage, for when both retell the same beats. Variables: {first_speaker}, {first_passage}, {second_speaker}, {second_passage}',
                    'prompt_response_options_gen': 'Guide the AI as it generates 4 follow-up options for the user. Variables: {context}, {last_response}',
                    'prompt_world_map_gen': 'Generates the entire world map. Variables: {characters}, {static}, {recent}',
                    'prompt_location_gen': 'Generates a location\'s detailed prompt. Variables: {name}, {description}',
                    'prompt_adjacent_locations_gen': 'Generates blank adjacent locations on the fly. Variables: {characters}, {static}, {recent}, {current_coords}, {surrounding_locations}, {target_coords}',
                    'prompt_entry_gen': 'Used for Static/Dynamic memory entries. Variables: {title}, {triggers}',
                    'prompt_location_memory_gen': 'Auto-summarizes events when leaving a location. Variable: {transcript}',
                    'prompt_timeline_extractor': 'Extracts a chronological timeline bullet from the narrative. Variable: {transcript}',
                    'prompt_relationship_matrix': 'Evaluates character relationship changes. Variable: {transcript}',
                    'prompt_story_notes_gen': 'Generates a short blurb for the library. Variable: {context}',
                    'prompt_story_tags_gen': 'Generates 3-5 tags for the story. Variable: {context}',
                    'prompt_auto_static_knowledge': 'Runs in background every 6 turns to generate static knowledge. Variables: {transcript}, {existing_knowledge}',
                    'prompt_stats_init': 'Generates game-like stats for characters. Variables: {context}, {characters}',
                    'swarm_scratchpad_prompt': 'Director Mode: Private scratchpad for each character agent. Variables: {character_name}, {objective_description}, {character_description}, {recent_history}',
                    'swarm_director_prompt': 'Director Mode: Multi-agent orchestrator that resolves all character intents into a single prose scene. Variables: {recent_history}, {winner_intents}, {character_descriptions}, {primary_speaker}',
                    'prompt_objectivity_description': 'Objectivity Step 1: Neutral overview of the physical scene. Variables: {character_name}, {history}',
                    'prompt_objectivity_thoughts': 'Objectivity Step 2: Internal character monologue processing the scene. Variables: {character_name}, {objective_description}, {personal_goal}, {relationships}, {sensations}',
                    'prompt_text_mode': 'Governs how a character writes in a private text thread. Variables: {character_name}, {user_character}, {emoji_rule}, {elapsed_time}'
                };

                const setupPromptEditor = (selectorId, editorId, hintId, isGlobal = false, resetBtnId = null) => {
                    const selector = document.getElementById(selectorId);
                    const editor = document.getElementById(editorId);
                    const hint = document.getElementById(hintId);
                    if (!selector || !editor || !hint) return;

                    const hardcoded = UTILITY.getHardcodedSystemPrompts();
                    const defs = UTILITY.getDefaultSystemPrompts();

                    // Populate Selector
                    if (selector.options.length === 0) {
                        for (const [groupLabel, keys] of Object.entries(promptGroups)) {
                            const optGroup = document.createElement('optgroup');
                            optGroup.label = groupLabel;
                            keys.forEach(key => {
                                if (hardcoded[key] !== undefined) {
                                    const opt = document.createElement('option');
                                    opt.value = key;
                                    opt.textContent = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                                    optGroup.appendChild(opt);
                                }
                            });
                            selector.appendChild(optGroup);
                        }
                    }

                    const savePrompt = debounce(() => {
                        if (isGlobal) {
                            StateManager.saveGlobalSettings();
                        } else {
                            if (typeof ReactiveStore.forceSave === 'function') ReactiveStore.forceSave();
                        }
                    }, 500);

                    const loadPrompt = (key) => {
                        if (!key) return;
                        let val;
                        if (isGlobal) {
                            const globalKey = key === 'system_prompt' ? 'default_system_prompt' : key;
                            val = globalSettings[globalKey];
                            if (val === undefined || val === null || val === '') {
                                val = hardcoded[key] || '';
                            }
                        } else {
                            val = state[key];
                            if (val === undefined || val === null || val === '') {
                                val = defs[key] || '';
                                state[key] = val;
                                savePrompt();
                            }
                        }
                        editor.value = val;

                        const info = promptInfo[key] || '';
                        hint.innerHTML = info.replace(/\{([^}]+)\}/g, '<code class="bg-black/40 px-1 rounded text-indigo-300">{$1}</code>');
                    };

                    loadPrompt(selector.value);

                    selector.addEventListener('change', (e) => {
                        loadPrompt(e.target.value);
                        if (typeof AppController.renderTokenVisualizer === 'function') {
                            AppController.renderTokenVisualizer();
                        }
                    });

                    editor.addEventListener('input', (e) => {
                        const key = selector.value;
                        if (isGlobal) {
                            const globalKey = key === 'system_prompt' ? 'default_system_prompt' : key;
                            globalSettings[globalKey] = e.target.value;
                        } else {
                            state[key] = e.target.value;
                        }
                        savePrompt();
                        if (typeof AppController.renderTokenVisualizer === 'function') {
                            AppController.renderTokenVisualizer();
                        }
                    });

                    if (resetBtnId) {
                        const resetBtn = document.getElementById(resetBtnId);
                        if (resetBtn) {
                            resetBtn.addEventListener('click', () => {
                                const key = selector.value;
                                if (isGlobal) {
                                    const globalKey = key === 'system_prompt' ? 'default_system_prompt' : key;
                                    delete globalSettings[globalKey];
                                    loadPrompt(key);
                                    StateManager.saveGlobalSettings();
                                    if (typeof AppController.renderTokenVisualizer === 'function') {
                                        AppController.renderTokenVisualizer();
                                    }
                                }
                            });
                        }
                    }
                };

                // Bind both editors
                setupPromptEditor('prompt-template-selector', 'prompt-template-editor', 'prompt-template-hint', false);
                setupPromptEditor('global-prompt-template-selector', 'global-prompt-template-editor', 'global-prompt-template-hint', true, 'global-prompt-reset-btn');

                // --- Global Toggles & Sliders (Defaults Tab) ---
                const bindGlobalToggle = (id, globalKey) => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    el.checked = globalSettings[globalKey] === true;
                    el.addEventListener('change', (e) => {
                        globalSettings[globalKey] = e.target.checked;
                        StateManager.saveGlobalSettings();
                    });
                };

                const bindGlobalSelect = (id, globalKey) => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    el.value = globalSettings[globalKey] || 'normal';
                    el.addEventListener('change', (e) => {
                        globalSettings[globalKey] = e.target.value;
                        StateManager.saveGlobalSettings();
                    });
                };

                const setupGlobalSlider = (sliderId, valueId, globalKey, defaultValue) => {
                    const slider = document.getElementById(sliderId);
                    const label = document.getElementById(valueId);
                    if (!slider || !label) return;

                    if (globalSettings[globalKey] === undefined) globalSettings[globalKey] = defaultValue;
                    slider.value = globalSettings[globalKey];
                    label.textContent = `${slider.value}%`;

                    slider.addEventListener('input', (e) => {
                        label.textContent = `${e.target.value}%`;
                        globalSettings[globalKey] = parseInt(e.target.value, 10);
                        StateManager.saveGlobalSettings();
                    });
                };

                bindGlobalToggle('global-default-swarm-mode-toggle', 'default_swarm_mode');
                bindGlobalToggle('global-default-enable-analysis-toggle', 'default_enableAnalysis');
                bindGlobalToggle('global-default-auto-knowledge', 'default_enableAutoStaticKnowledge');
                bindGlobalToggle('global-default-enable-stats-toggle', 'default_enableStats');
                bindGlobalToggle('global-default-living-persona', 'default_enableLivingPersona');
                bindGlobalToggle('global-default-enable-response-options-toggle', 'default_enableResponseOptions');
                bindGlobalToggle('global-default-enable-journal-toggle', 'default_enableJournal');

                bindGlobalSelect('global-default-response-length-selector', 'default_responseLength');
                bindGlobalSelect('global-default-response-style-selector', 'default_responseStyle');

                setupGlobalSlider('global-default-visual-master-prob-slider', 'global-default-visual-master-prob-value', 'default_visual_master_probability', 50);

                // --- Story Toggles (Prompts Tab) ---

                // Auto-Knowledge Toggle
                // Auto-Knowledge Toggle
                const autoKnowToggle = document.getElementById('enable-auto-knowledge-toggle');
                if (autoKnowToggle) {
                    autoKnowToggle.checked = state.enableAutoStaticKnowledge !== false; // Default true
                    autoKnowToggle.addEventListener('change', (e) => {
                        state.enableAutoStaticKnowledge = e.target.checked;
                        if (typeof ReactiveStore.forceSave === 'function') ReactiveStore.forceSave();
                    });
                }

                // Response Options Toggle
                const respOptToggle = document.getElementById('enable-response-options-toggle');
                if (respOptToggle) {
                    respOptToggle.checked = state.enableResponseOptions === true;
                    respOptToggle.addEventListener('change', (e) => {
                        state.enableResponseOptions = e.target.checked;
                        if (typeof ReactiveStore.forceSave === 'function') ReactiveStore.forceSave();

                        if (e.target.checked) {
                            const lastMsg = state.chat_history && state.chat_history[state.chat_history.length - 1];
                            const userChar = (state.characters || []).find(c => c.is_user);
                            if (lastMsg && lastMsg.type === 'chat' && lastMsg.character_id !== userChar?.id) {
                                NarrativeController.generateResponseOptions();
                            }
                        } else {
                            const container = document.getElementById('response-options-container');
                            if (container) {
                                container.innerHTML = '';
                                container.classList.add('hidden');
                            }
                        }
                    });
                }


                // Stats Toggle
                const statsToggle = document.getElementById('enable-stats-toggle');
                if (statsToggle) {
                    statsToggle.checked = state.enableStats !== false; // Default true
                    statsToggle.addEventListener('change', (e) => {
                        state.enableStats = e.target.checked;
                        if (typeof ReactiveStore.forceSave === 'function') ReactiveStore.forceSave();
                        NarrativeController.renderStatsPanel();
                        // If toggled ON and no stats exist, generate them
                        if (e.target.checked) {
                            NarrativeController.initializeStats();
                        }
                    });
                }

                // Response Options Prompt Gen
                // (Now handled dynamically by prompt-template-selector)

                // Toggle for Analysis
                const analysisToggle = document.getElementById('enable-analysis-toggle');
                if (analysisToggle) {
                    analysisToggle.checked = state.enableAnalysis !== false; // Default true
                    analysisToggle.addEventListener('change', (e) => {
                        state.enableAnalysis = e.target.checked;
                        if (typeof ReactiveStore.forceSave === 'function') ReactiveStore.forceSave();
                    });
                }

                // Toggle for Living Persona
                const livingPersonaToggle = document.getElementById('enable-living-persona-toggle');
                if (livingPersonaToggle) {
                    livingPersonaToggle.checked = state.enableLivingPersona === true; // Default false
                    livingPersonaToggle.addEventListener('change', (e) => {
                        state.enableLivingPersona = e.target.checked;
                        if (typeof ReactiveStore.forceSave === 'function') ReactiveStore.forceSave();
                    });
                }

                // Toggle for Combine As Narrator
                const combineNarratorToggle = document.getElementById('combine-as-narrator-toggle');
                if (combineNarratorToggle) {
                    combineNarratorToggle.checked = state.combineAsNarrator === true; // Default false
                    combineNarratorToggle.addEventListener('change', (e) => {
                        state.combineAsNarrator = e.target.checked;
                        if (typeof ReactiveStore.forceSave === 'function') ReactiveStore.forceSave();
                    });
                }

                // Toggle for Journal
                const journalToggle = document.getElementById('enable-journal-toggle');
                if (journalToggle) {
                    journalToggle.checked = state.enableJournal !== false; // Default true
                    journalToggle.addEventListener('change', (e) => {
                        state.enableJournal = e.target.checked;
                        if (typeof ReactiveStore.forceSave === 'function') ReactiveStore.forceSave();
                        UIManager.renderChat();
                    });
                }

                // ── TEXT MODE SETTINGS WIRING ───────────────────────────────────────────
                const bindTextModeToggle = (elId, key, defaultOn) => {
                    const el = document.getElementById(elId);
                    if (!el) return;
                    el.checked = defaultOn ? state[key] !== false : state[key] === true;
                    el.addEventListener('change', (e) => {
                        state[key] = e.target.checked;
                        if (typeof ReactiveStore.forceSave === 'function') ReactiveStore.forceSave();
                    });
                };
                // Only the master switch lives in settings. The per-conversation feel toggles
                // are in the thread gear menu, wired by TextModeController.
                bindTextModeToggle('enable-text-mode-toggle', 'enableTextMode', true);

                // ── DIRECTOR MODE SETTINGS WIRING ───────────────────────────────────────
                const swarmToggle = document.getElementById('swarm-mode-toggle');
                if (swarmToggle) {
                    swarmToggle.checked = state.swarmMode === true;
                    // Use cloneNode to strip any previous listener before re-attaching
                    const freshToggle = swarmToggle.cloneNode(true);
                    swarmToggle.parentNode.replaceChild(freshToggle, swarmToggle);
                    freshToggle.checked = state.swarmMode === true;
                    freshToggle.addEventListener('change', (e) => {
                        NarrativeController.setSwarmMode(e.target.checked);
                    });
                }
                // ── END DIRECTOR MODE SETTINGS WIRING ───────────────────────────────────

                // Font Selector
                const fontSelector = document.getElementById('font-selector');
                if (fontSelector) {
                    fontSelector.value = state.font;
                    fontSelector.addEventListener('change', (e) => this.changeFont(e.target.value));
                }

                // Markdown Color & Font Bindings
                [
                    'md_h1_color', 'md_h2_color', 'md_h3_color', 'md_bold_color', 'md_italic_color', 'md_quote_color',
                    'md_h1_font', 'md_h2_font', 'md_h3_font', 'md_bold_font', 'md_italic_font', 'md_quote_font'
                ].forEach(key => {
                    // The HTML IDs use dashes, the state keys use underscores
                    const inputId = key.replace(/_/g, '-') + '-input';
                    if (document.getElementById(inputId)) setListener(inputId, key);
                });

                // Kobold Template Selector
                const templateSelector = document.getElementById('koboldcpp-template-selector');
                if (templateSelector) {
                    templateSelector.value = globalSettings.koboldcpp_template || 'none';
                    templateSelector.addEventListener('change', (e) => {
                        globalSettings.koboldcpp_template = e.target.value;
                        StateManager.saveGlobalSettings();
                    });
                }

                // Bubble Opacity
                const opacitySlider = document.getElementById('bubble-opacity-slider');
                if (opacitySlider) {
                    const opacityValue = document.getElementById('bubble-opacity-value');
                    opacitySlider.value = state.bubbleOpacity;
                    opacityValue.textContent = `${Math.round(state.bubbleOpacity * 100)}%`;
                    opacitySlider.addEventListener('input', (e) => {
                        state.bubbleOpacity = parseFloat(e.target.value);
                        opacityValue.textContent = `${Math.round(state.bubbleOpacity * 100)}%`;
                    });
                }

                // Horizontal Toggle for Character Image Display
                const displayToggleContainer = document.getElementById('character-image-display');
                if (displayToggleContainer) {
                    const buttons = displayToggleContainer.querySelectorAll('button');
                    buttons.forEach(btn => {
                        const val = btn.getAttribute('data-value');
                        // Update visual active state
                        if (state.characterImageMode === val) {
                            btn.className = "flex-grow py-1.5 px-3 rounded-md text-xs font-semibold transition-all duration-200 focus:outline-none bg-indigo-600 text-white shadow-md";
                        } else {
                            btn.className = "flex-grow py-1.5 px-3 rounded-md text-xs font-semibold transition-all duration-200 focus:outline-none text-gray-400 hover:text-gray-200 hover:bg-white/5";
                        }

                        // Rebind listener by replacing button to prevent multiple bindings
                        const newBtn = btn.cloneNode(true);
                        newBtn.addEventListener('click', () => {
                            this.setCharacterImageMode(val);
                            // Visual update of all buttons in this segment
                            displayToggleContainer.querySelectorAll('button').forEach(b => {
                                const bVal = b.getAttribute('data-value');
                                if (bVal === state.characterImageMode) {
                                    b.className = "flex-grow py-1.5 px-3 rounded-md text-xs font-semibold transition-all duration-200 focus:outline-none bg-indigo-600 text-white shadow-md";
                                } else {
                                    b.className = "flex-grow py-1.5 px-3 rounded-md text-xs font-semibold transition-all duration-200 focus:outline-none text-gray-400 hover:text-gray-200 hover:bg-white/5";
                                }
                            });
                        });
                        btn.parentNode.replaceChild(newBtn, btn);
                    });
                }

                // Use Alpha Masking Toggle
                const alphaMaskToggle = document.getElementById('use-alpha-mask-toggle');
                if (alphaMaskToggle) {
                    const freshToggle = alphaMaskToggle.cloneNode(true);
                    alphaMaskToggle.parentNode.replaceChild(freshToggle, alphaMaskToggle);
                    freshToggle.checked = state.useAlphaMask === true;
                    freshToggle.addEventListener('change', async (e) => {
                        const checked = e.target.checked;
                        ReactiveStore.state.useAlphaMask = checked;
                        if (checked) {
                            UIManager.showNotification("Applying alpha masks to all characters...", "info");
                            await UIManager.applyAlphaMasksToAllCharacters();
                        } else {
                            UIManager.renderChat();
                        }
                    });
                }

                // API Provider Dropdown
                const apiProviderSelect = document.getElementById('api-provider-selector');
                if (apiProviderSelect) {
                    // Use Global Settings as source of truth, fallback to 'gemini'
                    const activeProvider = globalSettings.apiProvider || 'gemini';
                    apiProviderSelect.value = activeProvider;

                    apiProviderSelect.addEventListener('change', (e) => {
                        this.setApiProvider(e.target.value);
                    });
                }

                // Settings Visibility Toggles
                const geminiSettings = document.getElementById('gemini-settings');
                const openrouterSettings = document.getElementById('openrouter-settings');
                const nanogptSettings = document.getElementById('nanogpt-settings');
                const koboldcppSettings = document.getElementById('koboldcpp-settings');
                const lmstudioSettings = document.getElementById('lmstudio-settings');
                const webllmSettings = document.getElementById('webllm-settings');

                const currentProvider = globalSettings.apiProvider || 'gemini';

                if (geminiSettings) geminiSettings.style.display = currentProvider === 'gemini' ? 'block' : 'none';
                if (openrouterSettings) openrouterSettings.style.display = currentProvider === 'openrouter' ? 'block' : 'none';
                if (nanogptSettings) nanogptSettings.style.display = currentProvider === 'nanogpt' ? 'block' : 'none';
                if (koboldcppSettings) koboldcppSettings.style.display = currentProvider === 'koboldcpp' ? 'block' : 'none';
                if (lmstudioSettings) lmstudioSettings.style.display = currentProvider === 'lmstudio' ? 'block' : 'none';
                if (webllmSettings) webllmSettings.style.display = currentProvider === 'webllm' ? 'block' : 'none';

                // Toggle for Portrait Panel
                const portraitToggle = document.getElementById('show-portrait-panel-toggle');
                if (portraitToggle) {
                    // Use Global Settings for UI preference, or Story settings? usually UI pref is global
                    portraitToggle.checked = globalSettings.showPortraitPanel !== false; // Default true
                    portraitToggle.addEventListener('change', (e) => {
                        globalSettings.showPortraitPanel = e.target.checked;
                        StateManager.saveGlobalSettings();
                        if (typeof app !== 'undefined' && app.updateLayout) {
                            app.updateLayout(); // Trigger immediate layout refresh
                        }
                    });
                }

                // Toggle for Auto-Close Brackets
                const autoCloseToggle = document.getElementById('auto-close-brackets-toggle');
                if (autoCloseToggle) {
                    // Default false
                    autoCloseToggle.checked = !!globalSettings.autoCloseBrackets;
                    // Note: Event delegation handles the 'change' event globally to support dynamic rendering,
                    // but we still need to set the initial checked state here when the tab loads.
                }

                // Force visibility update on init
                AppController.updateImageGenSettingsVisibility();
                AppController.updateVisionBridgeSettingsVisibility();
            },



            /**
             * Helper: Updates font setting via Reactive Store.
             */
            changeFont(font) {
                ReactiveStore.state.font = font;
            },

            /**
             * Helper: Updates character image display mode via Reactive Store.
             */
            setCharacterImageMode(mode) {
                if (mode === 'visual_novel' && window.innerHeight > window.innerWidth) {
                    UIManager.showNotification('Visual Novel mode is designed for landscape layouts. Falling back to Cinematic.', 'warning');
                    mode = 'cinematic_overlay';
                }
                ReactiveStore.state.characterImageMode = mode;

                if (mode === 'visual_novel') {
                    const story = ReactiveStore.getActiveStory();
                    if (story) {
                        story.settings = story.settings || {};
                        story.settings.useAlphaMask = true;
                        ReactiveStore.forceSave();

                        // Fire-and-forget background mask generation
                        UIManager.applyAlphaMasksToAllCharacters().then(() => {
                            UIManager.renderChat();
                        }).catch(e => console.error("Auto-masking failed in VN mode switch:", e));
                    }
                }

                // Keep the button toggle state visual representation in sync
                const displayToggleContainer = document.getElementById('character-image-display');
                if (displayToggleContainer) {
                    displayToggleContainer.querySelectorAll('button').forEach(b => {
                        const bVal = b.getAttribute('data-value');
                        if (bVal === mode) {
                            b.className = "flex-grow py-1.5 px-3 rounded-md text-xs font-semibold transition-all duration-200 focus:outline-none bg-indigo-600 text-white shadow-md";
                        } else {
                            b.className = "flex-grow py-1.5 px-3 rounded-md text-xs font-semibold transition-all duration-200 focus:outline-none text-gray-400 hover:text-gray-200 hover:bg-white/5";
                        }
                    });
                }
            },

            /**
             * Helper: Updates API Provider setting (Global & Local) and refreshes settings view.
             */
            setApiProvider(provider) {
                // Update live state
                ReactiveStore.state.apiProvider = provider;

                // Update global state
                StateManager.data.globalSettings.apiProvider = provider;
                StateManager.saveGlobalSettings();

                // Re-bind to show/hide correct sections
                this.bindSettingsListeners();
            },

            /**
             * Opens the generator for the story background.
             */
            openBackgroundImageGenerator() {
                UIManager.openGenericImageGenerator({
                    title: 'Generate Background',
                    initialPrompt: 'A cinematic, high-resolution background landscape...',
                    onSave: async (blob) => {
                        const file = new File([blob], "generated_background.png", { type: "image/png" });
                        if (typeof LibraryController !== 'undefined') {
                            await LibraryController.handleBackgroundImageUpload({ target: { files: [file] } });
                        }
                        AppController.closeModal('image-gen-modal');
                    }
                });
            },

            // --- User Persona Methods ---

            /**
             * Retrieves a fallback user avatar.
             * Checks the first user persona for an image, or returns null.
             * @returns {string|null}
             */
            getUserAvatarImage() {
                const globalSettings = StateManager.data.globalSettings;
                if (!globalSettings || !globalSettings.userPersonas || globalSettings.userPersonas.length === 0) {
                    return null;
                }
                const persona = globalSettings.userPersonas[0];
                if (!persona) return null;

                // If the persona has an image, return its cache or url (with safeguard)
                if (persona.image_url && persona.image_url.includes('${imgSrc}')) return null;
                return UIManager.RUNTIME.characterImageCache[persona.id] || persona.image_url || null;
            },

            /**
             * Creates a new user persona with default values.
             */
            addUserPersona() {
                const globalSettings = StateManager.data.globalSettings;
                if (!globalSettings.userPersonas) globalSettings.userPersonas = [];

                const newPersona = {
                    id: UTILITY.uuid(),
                    name: "New Persona",
                    short_description: "Brief summary.",
                    description: "Full description.",
                    model_instructions: "Write a response for {character}...",
                    tags: []
                };

                globalSettings.userPersonas.push(newPersona);
                StateManager.saveGlobalSettings();
                this.RUNTIME.selectedPersonaId = newPersona.id;
                this.renderUserPersonaList();
            },

            /**
             * Deletes a user persona by ID after confirmation.
             * @param {string} id - The ID of the persona to delete.
             */
            deleteUserPersona(id) {
                const globalSettings = StateManager.data.globalSettings;
                if (!globalSettings.userPersonas) return;

                if (confirm("Delete this persona?")) {
                    globalSettings.userPersonas = globalSettings.userPersonas.filter(p => p.id !== id);
                    if (this.RUNTIME.selectedPersonaId === id) this.RUNTIME.selectedPersonaId = null;
                    StateManager.saveGlobalSettings();
                    this.renderUserPersonaList();
                }
            },

            /**
             * Selects a user persona for editing.
             * @param {string} id - The ID of the persona to select.
             */
            selectUserPersona(id) {
                this.RUNTIME.selectedPersonaId = id;
                this.renderUserPersonaList(); // Update visual selection state
            },

            /**
             * Updates a specific field of a user persona.
             * @param {string} id - The ID of the persona.
             * @param {string} field - The field to update.
             * @param {string} value - The new value.
             */
            updateUserPersonaField(id, field, value) {
                const globalSettings = StateManager.data.globalSettings;
                const persona = globalSettings.userPersonas.find(p => p.id === id);
                if (persona) {
                    if (field === 'tags') {
                        persona.tags = value.split(',').map(t => t.trim()).filter(Boolean);
                    } else {
                        persona[field] = value;
                    }
                    StateManager.saveGlobalSettings();
                    // If name changed, update list
                    if (field === 'name') this.renderUserPersonaList(true);
                }
            },

            /**
             * Renders the list of user personas in the settings modal.
             * @param {boolean} [preserveDetails=false] - Whether to skip re-rendering details.
             */
            renderUserPersonaList(preserveDetails = false) {
                const globalSettings = StateManager.data.globalSettings;
                const personas = globalSettings.userPersonas || [];
                const listContainer = document.getElementById('user-personas-list');

                listContainer.innerHTML = personas.map(p => `
            <div onclick="AppController.selectUserPersona('${p.id}')" class="p-3 rounded-lg cursor-pointer ${this.RUNTIME.selectedPersonaId === p.id ? 'bg-indigo-600' : 'hover:bg-indigo-600/50'} mb-1 transition-colors">
                <div class="flex justify-between items-center gap-2">
                    <h4 class="font-semibold truncate">${p.name}</h4>
                    ${globalSettings.defaultPersonaId === p.id ? '<span class="bg-indigo-500/50 border border-indigo-400/30 text-indigo-100 text-[10px] font-bold py-0.5 px-2 rounded-full flex-shrink-0">Default</span>' : ''}
                </div>
                <p class="text-xs text-gray-300 truncate mt-1">${p.short_description}</p>
            </div>
        `).join('');

                if (!preserveDetails) this.renderUserPersonaDetails();
            },

            /**
             * Renders the details form for the selected user persona.
             * Handles image hydration and display.
             */
            async renderUserPersonaDetails() {
                const container = document.getElementById('user-persona-details');
                const globalSettings = StateManager.data.globalSettings;
                const persona = (globalSettings.userPersonas || []).find(p => p.id === this.RUNTIME.selectedPersonaId);

                if (!persona) {
                    container.innerHTML = `<div class="text-gray-400 flex items-center justify-center h-full">Select a persona to edit.</div>`;
                    return;
                }

                // Renders the details form for the selected user persona using DOM.html.
                const imgSrc = UIManager.RUNTIME.characterImageCache[persona.id] || persona.image_url;
                const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%234b5563' opacity='0.25'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
                const displayImage = imgSrc ? imgSrc : placeholder;

                const portraitId = `persona-portrait-${persona.id}`;
                setTimeout(() => {
                    const img = document.getElementById(portraitId);
                    if (img) UTILITY.safeImageSet(img, displayImage);
                }, 0);

                container.innerHTML = DOM.html`
            <div class="flex flex-col gap-4">
                <div class="flex justify-between items-center pb-2 border-b border-gray-700">
                    <h3 class="text-xl font-bold">Edit Persona</h3>
                    <div class="flex gap-2">
                        ${globalSettings.defaultPersonaId === persona.id ?
                        DOM.html`<span class="bg-indigo-600/50 text-indigo-200 text-sm font-bold py-1 px-3 rounded flex items-center">Default</span>` :
                        DOM.html`<button onclick="AppController.updateGlobalSetting('defaultPersonaId', '${persona.id}'); AppController.renderUserPersonaDetails(); AppController.renderUserPersonaList(true)" class="bg-gray-700 hover:bg-gray-600 text-white text-sm font-bold py-1 px-3 rounded">Set Default</button>`
                    }
                        <button onclick="AppController.applyUserPersonaToCurrentStory('${persona.id}')" class="bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold py-1 px-3 rounded">Add to Roleplay</button>
                        <button onclick="AppController.deleteUserPersona('${persona.id}')" class="bg-red-900/50 hover:bg-red-700/80 text-red-200 text-sm font-bold py-1 px-3 rounded">Delete</button>
                    </div>
                </div>

                <div class="flex items-start gap-4">
                    <div class="w-24 h-32 flex-shrink-0 bg-gray-800 rounded-lg overflow-hidden border border-gray-600 relative group">
                        <img id="${portraitId}" class="w-full h-full object-cover">
                        <label class="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity text-xs text-white font-bold">
                            Change
                            <input type="file" accept="image/*" onchange="AppController.handleUserPersonaImageUpload(event, '${persona.id}')" class="hidden">
                        </label>
                    </div>
                    <div class="flex-grow space-y-4">
                        <div>
                            <label class="block text-sm font-bold text-gray-400 mb-1">Name</label>
                            <input type="text" value="${persona.name}" oninput="AppController.updateUserPersonaField('${persona.id}', 'name', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded focus:border-indigo-500">
                        </div>
                        <div>
                            <label class="block text-sm font-bold text-gray-400 mb-1">Short Description</label>
                            <input type="text" value="${persona.short_description || ''}" oninput="AppController.updateUserPersonaField('${persona.id}', 'short_description', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded focus:border-indigo-500">
                        </div>
                    </div>
                </div>

                <div>
                    <label class="block text-sm font-bold text-gray-400 mb-1">Full Description</label>
                    <textarea oninput="AppController.updateUserPersonaField('${persona.id}', 'description', this.value)" class="w-full h-32 bg-black/30 border-gray-600 p-2 rounded resize-y">${persona.description}</textarea>
                </div>

                <div>
                    <label class="block text-sm font-bold text-gray-400 mb-1">Outward Appearance (Public)</label>
                    <textarea oninput="AppController.updateUserPersonaField('${persona.id}', 'appearance', this.value)" class="w-full h-24 bg-black/30 border-gray-600 p-2 rounded resize-y focus:border-indigo-500" placeholder="Describe the character's physical appearance...">${persona.appearance || ''}</textarea>
                </div>

                <div>
                    <label class="block text-sm font-bold text-gray-400 mb-1">Model Instructions</label>
                    <textarea oninput="AppController.updateUserPersonaField('${persona.id}', 'model_instructions', this.value)" class="w-full h-24 bg-black/30 border-gray-600 p-2 rounded resize-y">${persona.model_instructions}</textarea>
                </div>

                <div>
                    <label class="block text-sm font-bold text-gray-400 mb-1">Tags (comma-separated)</label>
                    <input type="text" value="${(persona.tags || []).join(', ')}" oninput="AppController.updateUserPersonaField('${persona.id}', 'tags', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded focus:border-indigo-500">
                </div>
            </div>`;
            },

            /**
             * Handles the upload of a custom image for a user persona.
             * Processes the image and saves it to IndexedDB.
             * @param {Event} event - The file input change event.
             * @param {string} personaId - The ID of the persona.
             */
            async handleUserPersonaImageUpload(event, personaId) {
                const file = event.target.files[0];
                if (!file) return;

                UIManager.showLoadingSpinner('Saving persona image...');
                try {
                    const blob = await ImageProcessor.processImageAsBlob(file);
                    await DBService.saveImage(personaId, blob);

                    // Update Cache
                    if (UIManager.RUNTIME.characterImageCache[personaId]) {
                        URL.revokeObjectURL(UIManager.RUNTIME.characterImageCache[personaId]);
                    }
                    UIManager.RUNTIME.characterImageCache[personaId] = URL.createObjectURL(blob);

                    // Update Data Object marker
                    this.updateUserPersonaField(personaId, 'image_url', `local_idb_persona_${personaId}`);

                    // Refresh UI
                    this.renderUserPersonaDetails();
                } catch (e) {
                    alert("Image upload failed: " + e.message);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Applies the selected user persona to the current story.
             * Demotes the current user to an NPC and creates a new User character.
             * @param {string} personaId - The ID of the persona to apply.
             */
            async applyUserPersonaToCurrentStory(personaId) {
                const state = ReactiveStore.state;
                if (!state || !state.characters) {
                    alert("No active story loaded.");
                    return;
                }

                const globalSettings = StateManager.data.globalSettings;
                const persona = globalSettings.userPersonas.find(p => p.id === personaId);
                if (!persona) return;

                if (!confirm(`Add "${persona.name}" as the new User? The current User character will be saved as an inactive NPC.`)) {
                    return;
                }

                // 1. Demote existing User(s)
                state.characters.forEach(c => {
                    if (c.is_user) {
                        c.is_user = false;
                        c.is_active = false;
                    }
                });

                // 2. Create New Character Object
                const newCharId = UTILITY.uuid();

                // Clone Image Logic:
                // If persona has an image in IDB, copy it to the new character ID
                // This ensures the story character has an independent copy of the image
                let newImageUrl = "";
                try {
                    const personaBlob = await DBService.getImage(persona.id);
                    if (personaBlob) {
                        await DBService.saveImage(newCharId, personaBlob);
                        newImageUrl = `local_idb_${newCharId}`;
                        // Pre-cache for immediate display
                        UIManager.RUNTIME.characterImageCache[newCharId] = URL.createObjectURL(personaBlob);
                    }
                } catch (e) {
                    console.warn("Failed to clone persona image:", e);
                }

                const newChar = {
                    id: newCharId,
                    name: persona.name,
                    short_description: persona.short_description || "User Persona",
                    description: persona.description || "",
                    model_instructions: persona.model_instructions || `Write the next response for ${persona.name}.`,
                    tags: [...(persona.tags || [])],
                    appearance: persona.appearance || "",
                    image_url: newImageUrl,
                    extra_portraits: [],
                    is_user: true,
                    is_active: true,
                    is_narrator: false,
                    color: { base: '#4b5563', bold: '#e5e7eb' },
                    dynamic_knowledge: []
                };

                // 3. Add to Story
                state.characters.push(newChar);

                // 4. Save and Refresh UI
                await ReactiveStore.forceSave();
                UIManager.renderCharacters();
                UIManager.updateAICharacterSelector();

                alert(`"${persona.name}" is now the active User.`);
            },
            // --- OpenRouter Saved Models Logic ---

            /**
             * Updates visibility of Vision Bridge settings based on the selected backend.
             * Local and cloud backends need different fields; model + instruction are shared
             * by all of them and hidden only when the bridge is off entirely.
             */
            updateVisionBridgeSettingsVisibility() {
                const backendSelect = document.getElementById('vision-bridge-backend');
                if (!backendSelect) return;
                const val = backendSelect.value;

                const show = (id, visible) => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    if (visible) el.classList.remove('hidden');
                    else el.classList.add('hidden');
                };

                const isLocal = val === 'koboldcpp' || val === 'lmstudio';
                show('vision-bridge-local-settings', isLocal);
                show('vision-bridge-openrouter-settings', val === 'openrouter');
                show('vision-bridge-shared-settings', val !== 'disabled');

                // Nudge the URL placeholder to the right default port for the chosen runtime,
                // so a blank field visibly means "the usual place" rather than "unset".
                const urlInput = document.getElementById('vision-bridge-url');
                if (urlInput && isLocal) {
                    urlInput.placeholder = VisionBridgeService.DEFAULT_URLS[val] || 'http://localhost:5001';
                }
            },

            /**
             * Updates visibility of Image Generation settings based on selected backend.
             */
            updateImageGenSettingsVisibility() {
                const backendSelect = document.getElementById('image-gen-backend');
                if (!backendSelect) return;
                const val = backendSelect.value;

                const koboldSettings = document.getElementById('image-gen-kobold-settings');
                const openRouterSettings = document.getElementById('image-gen-openrouter-settings');

                // Toggle Visual Master controls
                const vmSlider = document.getElementById('visual-master-probability-slider');
                const isDisabled = val === 'disabled';

                if (vmSlider) {
                    vmSlider.disabled = isDisabled;
                    // Visual feedback
                    if (isDisabled) {
                        vmSlider.parentElement.classList.add('opacity-50', 'pointer-events-none');
                    } else {
                        vmSlider.parentElement.classList.remove('opacity-50', 'pointer-events-none');
                    }
                }

                if (koboldSettings) {
                    const show = val === 'koboldcpp';
                    koboldSettings.style.display = show ? 'block' : 'none';
                    if (show) koboldSettings.classList.remove('hidden');
                    else koboldSettings.classList.add('hidden');
                }
                if (openRouterSettings) {
                    const show = val === 'openrouter';
                    openRouterSettings.style.display = show ? 'block' : 'none';
                    if (show) openRouterSettings.classList.remove('hidden');
                    else openRouterSettings.classList.add('hidden');
                }
                const nanoGPTSettings = document.getElementById('image-gen-nanogpt-settings');
                if (nanoGPTSettings) {
                    const show = val === 'nanogpt';
                    nanoGPTSettings.style.display = show ? 'block' : 'none';
                    if (show) nanoGPTSettings.classList.remove('hidden');
                    else nanoGPTSettings.classList.add('hidden');
                }
            },

            /**
             * Saves the current OpenRouter model string to the global settings.
             */
            saveOpenRouterModel() {
                const input = document.getElementById('openrouter-model-input');
                if (!input) return;

                const value = input.value.trim();
                if (!value) return;

                const globalSettings = StateManager.data.globalSettings;
                if (!globalSettings.savedOpenRouterModels) globalSettings.savedOpenRouterModels = [];

                // Avoid duplicates
                if (!globalSettings.savedOpenRouterModels.includes(value)) {
                    globalSettings.savedOpenRouterModels.push(value);
                    StateManager.saveGlobalSettings();
                    this.renderSavedOpenRouterModels();
                }
            },

            /**
             * Deletes a saved OpenRouter model from the global settings.
             * @param {string} modelName - The name of the model to delete.
             */
            deleteOpenRouterModel(modelName) {
                const globalSettings = StateManager.data.globalSettings;
                if (!globalSettings.savedOpenRouterModels) return;

                if (confirm(`Remove "${modelName}" from saved models?`)) {
                    globalSettings.savedOpenRouterModels = globalSettings.savedOpenRouterModels.filter(m => m !== modelName);
                    StateManager.saveGlobalSettings();
                    this.renderSavedOpenRouterModels();
                }
            },

            /**
             * Selects a saved OpenRouter model and updates the input field.
             * @param {string} modelName - The name of the model to select.
             */
            selectOpenRouterModel(modelName) {
                const input = document.getElementById('openrouter-model-input');
                if (input) {
                    input.value = modelName;
                    // Manually trigger the input event to update the Global Settings via the listener
                    input.dispatchEvent(new Event('input'));
                }
            },

            /**
             * Renders the list of saved OpenRouter models in the settings modal.
             */
            renderSavedOpenRouterModels() {
                const container = document.getElementById('openrouter-saved-models-list');
                if (!container) return;

                const globalSettings = StateManager.data.globalSettings;
                const models = globalSettings.savedOpenRouterModels || [];

                if (models.length === 0) {
                    container.innerHTML = '<span class="text-xs text-gray-500 italic">No saved models.</span>';
                    return;
                }

                container.innerHTML = models.map(model => {
                    // Simplify: show only the part after the slash if present
                    const shortName = model.includes('/') ? model.split('/').slice(1).join('/') : model;

                    // Color logic based on :free suffix
                    const isFree = model.endsWith(':free');
                    const borderColor = isFree ? 'border-green-500' : 'border-gray-600';
                    const textColor = isFree ? 'text-green-200' : 'text-gray-300';

                    return `
            <div class="inline-flex items-center bg-black/30 border ${borderColor} rounded-lg overflow-hidden" title="${model}">
                <button onclick="AppController.selectOpenRouterModel('${model}')" class="px-3 py-1 text-xs ${textColor} hover:text-white hover:bg-white/10 transition-colors truncate max-w-[200px]">
                    ${shortName}
                </button>
                <button onclick="AppController.deleteOpenRouterModel('${model}')" class="px-2 py-1 text-xs text-gray-500 hover:text-red-400 hover:bg-black/20 border-l ${borderColor} transition-colors" title="Remove">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        `;
                }).join('');
            },

            // --- OpenRouter Model Browser ---

            /**
             * Opens the OpenRouter model browser modal and fetches available models.
             * @param {string} [mode='text'] - 'text', 'image', or 'audio'.
             */
            async openOpenRouterModelBrowser(mode = 'text') {
                this.RUNTIME.modelBrowserMode = mode;

                const listContainer = document.getElementById('openrouter-model-list');
                const searchInput = document.getElementById('openrouter-model-search');

                // Ensure search input is visible (in case hidden by Image Browser)
                if (searchInput) searchInput.style.display = 'block';

                // Reset search input
                if (searchInput) {
                    searchInput.value = '';
                }

                // Show loading state
                if (listContainer) {
                    listContainer.innerHTML = '<div class="flex items-center justify-center h-full text-gray-400"><span>Loading models...</span></div>';
                }

                this.openModal('openrouter-model-modal');

                try {
                    // Pass mode to fetchOpenRouterModels so it uses the correct endpoint:
                    // - 'image' mode -> ?output_modalities=image  (returns all 28 image models)
                    // - 'text' mode  -> default endpoint          (returns text/multimodal models)
                    let models = await APIService.fetchOpenRouterModels(mode);

                    // "image" mode means models that PRODUCE pictures. The Vision Bridge
                    // needs the opposite: models that can READ one. That is not a separate
                    // endpoint, so filter the normal list on input modalities.
                    if (mode === 'vision') {
                        models = models.filter(m => {
                            const arch = m && m.architecture;
                            if (!arch) return false;
                            if (Array.isArray(arch.input_modalities)) {
                                return arch.input_modalities.includes('image');
                            }
                            return typeof arch.modality === 'string' && arch.modality.includes('image');
                        });
                    }

                    if (models.length > 0) {
                        console.groupCollapsed("OpenRouter Model Fetch Debug");
                        console.log(`Total Models Fetched (${mode} mode):`, models.length);
                        console.log("Sample Model 0:", models[0]);
                        console.groupEnd();
                    }

                    // In text mode, still filter out any pure image-only generators that
                    // may have slipped through (e.g. models with text->image modality) to
                    // keep the text browser clean.
                    if (mode === 'text') {
                        models = models.filter(m => {
                            const id = m.id.toLowerCase();
                            const mod = m.architecture?.modality;
                            if (mod && String(mod) === 'text->image') return false; // Strict image-only
                            if (id.includes('dall-e')) return false;
                            if (id.includes('stable-diffusion') || id.includes('stabilityai/stable-diffusion')) return false;
                            if (id.includes('flux') && !id.includes('text')) return false;
                            return true;
                        });
                    }
                    // Image mode: the API already filtered to only image-output models,
                    // so no additional client-side filtering is needed.

                    // Audio mode: filter out speech-only models (GPT Audio) to focus on
                    // music generation models (Lyria family).
                    if (mode === 'audio') {
                        models = models.filter(m => {
                            const id = m.id.toLowerCase();
                            // Keep Lyria and other music-gen models, exclude pure speech/TTS
                            if (id.includes('gpt-audio') || id.includes('gpt-4o-audio')) return false;
                            return true;
                        });
                    }

                    this._openRouterModelsList = models;
                    this._renderOpenRouterModelList(models);

                    // Setup search handler with debounce
                    if (searchInput) {
                        searchInput.oninput = debounce((e) => {
                            const query = e.target.value.toLowerCase().trim();
                            const filtered = query ? models.filter(m =>
                                m.id.toLowerCase().includes(query) ||
                                (m.name && m.name.toLowerCase().includes(query))
                            ) : models;
                            this._renderOpenRouterModelList(filtered);
                        }, 200);
                    }
                } catch (error) {
                    console.error('Failed to fetch OpenRouter models:', error);
                    if (listContainer) {
                        listContainer.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-red-400 p-4">
                            <span class="text-center">Failed to load models.</span>
                            <span class="text-center text-sm mt-1">${error.message}</span>
                            <button onclick="AppController.openOpenRouterModelBrowser('${mode}')" class="mt-4 bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg text-white">Retry</button>
                        </div>`;
                    }
                }
            },

            /**
             * Helper to open the browser in Image Mode.
             */
            async openOpenRouterImageModelBrowser() {
                await this.openOpenRouterModelBrowser('image');
            },

            /**
             * Helper to open the browser in Audio/Music Mode.
             */
            async openOpenRouterMusicModelBrowser() {
                await this.openOpenRouterModelBrowser('audio');
            },

            /**
             * Renders the OpenRouter model list in the browser modal.
             * @param {Array} models - Array of model objects to render.
             */
            _renderOpenRouterModelList(models) {
                const listContainer = document.getElementById('openrouter-model-list');
                if (!listContainer) return;

                if (!models || models.length === 0) {
                    listContainer.innerHTML = '<div class="flex items-center justify-center h-full text-gray-400"><span>No models found</span></div>';
                    return;
                }

                const global = StateManager.data.globalSettings;
                const state = StateManager.getState();

                // Determine current model based on mode
                let currentModel;
                if (this.RUNTIME.modelBrowserMode === 'image') {
                    currentModel = global.imageGenOpenRouterModel || state.imageGenOpenRouterModel;
                } else if (this.RUNTIME.modelBrowserMode === 'audio') {
                    currentModel = global.musicOpenRouterModel || 'google/lyria-3-clip-preview';
                } else {
                    currentModel = global.openRouterModel || state.openRouterModel;
                }

                // Sort models: selected first, then alphabetically by name
                const sortedModels = [...models].sort((a, b) => {
                    if (a.id === currentModel) return -1;
                    if (b.id === currentModel) return 1;
                    return (a.name || a.id).localeCompare(b.name || b.id);
                });

                const formatPrice = (price) => {
                    if (!price || price === 0) return 'Free';
                    const perMillion = parseFloat(price) * 1000000;
                    if (perMillion < 0.01) return '<$0.01/M';
                    return `$${perMillion.toFixed(2)}/M`;
                };

                const getPriceColor = (price) => {
                    const val = parseFloat(price || 0) * 1000000;
                    if (val <= 0.05) return 'text-green-400 font-bold'; // Free or dirt cheap
                    if (val < 5) return 'text-gray-300'; // Reasonable
                    return 'text-amber-400'; // Expensive
                };

                listContainer.innerHTML = sortedModels.map(model => {
                    const isSelected = model.id === currentModel;
                    const promptPrice = formatPrice(model.pricing?.prompt);
                    const completionPrice = formatPrice(model.pricing?.completion);
                    const contextLength = model.context_length ? `${Math.round(model.context_length / 1024)}K ctx` : '';

                    const pColor = getPriceColor(model.pricing?.prompt);
                    const cColor = getPriceColor(model.pricing?.completion);

                    return `
                        <div class="p-3 rounded-lg cursor-pointer transition-colors mb-1 ${isSelected ? 'bg-indigo-600/50 border border-indigo-500' : 'bg-gray-700/50 hover:bg-gray-600/50 border border-transparent'}" onclick="AppController._selectModelFromBrowser('${model.id}')">
                            <div class="flex justify-between items-start">
                                <div class="flex-1 min-w-0">
                                    <div class="font-medium text-white truncate">${model.name || model.id}</div>
                                    <div class="text-xs text-gray-400 truncate">${model.id}</div>
                                </div>
                                ${isSelected ? '<span class="ml-2 text-indigo-300 text-sm whitespace-nowrap">Current</span>' : ''}
                            </div>
                            <div class="flex gap-3 mt-2 text-xs text-gray-400">
                                <span title="Input price per million tokens" class="${pColor}">In: ${promptPrice}</span>
                                <span title="Output price per million tokens" class="${cColor}">Out: ${completionPrice}</span>
                                ${contextLength ? `<span title="Context window">${contextLength}</span>` : ''}
                            </div>
                        </div>
                    `;
                }).join('');
            },

            /**
             * Selects a model from the browser and populates the input field.
             * @param {string} modelId - The model ID to select.
             */
            _selectModelFromBrowser(modelId) {
                if (this.RUNTIME.modelBrowserMode === 'vision') {
                    const input = document.getElementById('vision-bridge-model');
                    if (input) {
                        input.value = modelId;
                        // The settings binding listens for input, so this keeps the stored
                        // value in step with the field.
                        input.dispatchEvent(new Event('input'));
                    }
                    StateManager.data.globalSettings.visionBridgeModel = modelId;
                    StateManager.saveGlobalSettings();
                    this.closeModal('openrouter-model-modal');
                    return;
                }

                if (this.RUNTIME.modelBrowserMode === 'image') {
                    // Image Mode Selection
                    const input = document.getElementById('image-gen-openrouter-model-input');
                    if (input) {
                        input.value = modelId;
                        input.dispatchEvent(new Event('input')); // Sync with Global/State
                    }

                    // Onboarding Sync
                    const onboardingInput = document.getElementById('onboarding-img-openrouter-model');
                    if (onboardingInput) {
                        onboardingInput.value = modelId;
                    }

                    ReactiveStore.state.imageGenOpenRouterModel = modelId;
                } else if (this.RUNTIME.modelBrowserMode === 'audio') {
                    // Audio/Music Mode Selection
                    const input = document.getElementById('music-openrouter-model-input');
                    if (input) {
                        input.value = modelId;
                    }
                    // Save directly to global settings
                    const globalSettings = StateManager.data.globalSettings;
                    globalSettings.musicOpenRouterModel = modelId;
                    StateManager.saveGlobalSettings();
                } else {
                    // Text Mode Selection (Default)
                    const input = document.getElementById('openrouter-model-input');
                    if (input) {
                        input.value = modelId;
                        input.dispatchEvent(new Event('input'));
                    }

                    // Onboarding Sync
                    const onboardingInput = document.getElementById('onboarding-openrouter-model');
                    if (onboardingInput) {
                        onboardingInput.value = modelId;
                    }

                    ReactiveStore.state.openRouterModel = modelId;
                }

                this.closeModal('openrouter-model-modal');
            },

            // --- OpenRouter Image Model Management ---

            /**
             * Saves the current OpenRouter image model string to the global settings.
             */
            saveOpenRouterImageModel() {
                const input = document.getElementById('image-gen-openrouter-model-input');
                if (!input) return;

                const value = input.value.trim();
                if (!value) return;

                const globalSettings = StateManager.data.globalSettings;
                if (!globalSettings.savedOpenRouterImageModels) globalSettings.savedOpenRouterImageModels = [];

                // Avoid duplicates
                if (!globalSettings.savedOpenRouterImageModels.includes(value)) {
                    globalSettings.savedOpenRouterImageModels.push(value);
                    StateManager.saveGlobalSettings();
                    this.renderSavedOpenRouterImageModels();
                }
            },

            /**
             * Deletes a saved OpenRouter image model from the global settings.
             * @param {string} modelName - The name of the model to delete.
             */
            deleteOpenRouterImageModel(modelName) {
                const globalSettings = StateManager.data.globalSettings;
                if (!globalSettings.savedOpenRouterImageModels) return;

                if (confirm(`Remove "${modelName}" from saved image models?`)) {
                    globalSettings.savedOpenRouterImageModels = globalSettings.savedOpenRouterImageModels.filter(m => m !== modelName);
                    StateManager.saveGlobalSettings();
                    this.renderSavedOpenRouterImageModels();
                }
            },

            /**
             * Selects a saved OpenRouter image model and updates the input field.
             * @param {string} modelName - The name of the model to select.
             */
            selectOpenRouterImageModel(modelName) {
                const input = document.getElementById('image-gen-openrouter-model-input');
                if (input) {
                    input.value = modelName;
                    // Manually trigger the input event to update the Global Settings via the listener
                    input.dispatchEvent(new Event('input'));
                }
            },

            /**
             * Renders the list of saved OpenRouter image models in the settings modal.
             */
            renderSavedOpenRouterImageModels() {
                const container = document.getElementById('image-gen-openrouter-saved-models-list');
                if (!container) return;

                const globalSettings = StateManager.data.globalSettings;
                const models = globalSettings.savedOpenRouterImageModels || [];

                if (models.length === 0) {
                    container.innerHTML = '<span class="text-xs text-gray-500 italic">No saved models.</span>';
                    return;
                }

                container.innerHTML = models.map(model => {
                    // Simplify: show only the part after the slash if present
                    const shortName = model.includes('/') ? model.split('/').slice(1).join('/') : model;

                    return `
            <div class="inline-flex items-center bg-black/30 border border-gray-600 rounded-lg overflow-hidden" title="${model}">
                <button onclick="AppController.selectOpenRouterImageModel('${model}')" class="px-3 py-1 text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors truncate max-w-[200px]">
                    ${shortName}
                </button>
                <button onclick="AppController.deleteOpenRouterImageModel('${model}')" class="px-2 py-1 text-xs text-gray-500 hover:text-red-400 hover:bg-black/20 border-l border-gray-600 transition-colors" title="Remove">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        `;
                }).join('');
            },

            // --- NanoGPT Model Browser & Saved Models Logic ---

            /**
             * Opens the NanoGPT Model Browser modal.
             * @param {string} [mode='text'] - 'text', 'image', or 'audio'
             */
            async openNanoGPTModelBrowser(mode = 'text') {
                this.RUNTIME.modelBrowserMode = mode;
                const listContainer = document.getElementById('nanogpt-model-list');
                const searchInput = document.getElementById('nanogpt-model-search');

                if (searchInput) searchInput.value = '';

                if (listContainer) {
                    listContainer.innerHTML = '<div class="flex items-center justify-center h-full text-gray-400"><span>Loading NanoGPT models...</span></div>';
                }

                this.openModal('nanogpt-model-modal');

                try {
                    let models = await APIService.fetchNanoGPTModels(mode);

                    if (mode === 'text') {
                        models = models.filter(m => {
                            const id = m.id.toLowerCase();
                            if (id.includes('dall-e') || id.includes('stable-diffusion')) return false;
                            return true;
                        });
                    }

                    this._nanoGPTModelsList = models;
                    this._renderNanoGPTModelList(models);

                    if (searchInput) {
                        searchInput.oninput = debounce((e) => {
                            const query = e.target.value.toLowerCase().trim();
                            const filtered = query ? models.filter(m =>
                                m.id.toLowerCase().includes(query) ||
                                (m.name && m.name.toLowerCase().includes(query))
                            ) : models;
                            this._renderNanoGPTModelList(filtered);
                        }, 200);
                    }
                } catch (error) {
                    console.error('Failed to fetch NanoGPT models:', error);
                    if (listContainer) {
                        listContainer.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-red-400 p-4">
                            <span class="text-center">Failed to load NanoGPT models.</span>
                            <span class="text-center text-sm mt-1">${error.message}</span>
                            <button onclick="AppController.openNanoGPTModelBrowser('${mode}')" class="mt-4 bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg text-white">Retry</button>
                        </div>`;
                    }
                }
            },

            async openNanoGPTImageModelBrowser() {
                await this.openNanoGPTModelBrowser('image');
            },

            async openNanoGPTMusicModelBrowser() {
                await this.openNanoGPTModelBrowser('audio');
            },

            _renderNanoGPTModelList(models) {
                const listContainer = document.getElementById('nanogpt-model-list');
                if (!listContainer) return;

                if (!models || models.length === 0) {
                    listContainer.innerHTML = '<div class="flex items-center justify-center h-full text-gray-400"><span>No models found</span></div>';
                    return;
                }

                const global = StateManager.data.globalSettings;
                const state = StateManager.getState();

                let currentModel;
                if (this.RUNTIME.modelBrowserMode === 'image') {
                    currentModel = global.imageGenNanoGPTModel || state.imageGenNanoGPTModel;
                } else if (this.RUNTIME.modelBrowserMode === 'audio') {
                    currentModel = global.musicNanoGPTModel || 'google/lyria-3-clip-preview';
                } else {
                    currentModel = global.nanoGPTModel || state.nanoGPTModel;
                }

                const sortedModels = [...models].sort((a, b) => {
                    if (a.id === currentModel) return -1;
                    if (b.id === currentModel) return 1;
                    return (a.name || a.id).localeCompare(b.name || b.id);
                });

                listContainer.innerHTML = sortedModels.map(model => {
                    const isSelected = model.id === currentModel;
                    const contextLength = model.context_length ? `${Math.round(model.context_length / 1024)}K ctx` : '';

                    return `
                        <div class="p-3 rounded-lg cursor-pointer transition-colors mb-1 ${isSelected ? 'bg-indigo-600/50 border border-indigo-500' : 'bg-gray-700/50 hover:bg-gray-600/50 border border-transparent'}" onclick="AppController._selectNanoGPTModelFromBrowser('${model.id}')">
                            <div class="flex justify-between items-start">
                                <div class="flex-1 min-w-0">
                                    <div class="font-medium text-white truncate">${model.name || model.id}</div>
                                    <div class="text-xs text-gray-400 truncate">${model.id}</div>
                                </div>
                                ${isSelected ? '<span class="ml-2 text-indigo-300 text-sm whitespace-nowrap">Current</span>' : ''}
                            </div>
                            ${contextLength ? `<div class="mt-2 text-xs text-gray-400"><span title="Context window">${contextLength}</span></div>` : ''}
                        </div>
                    `;
                }).join('');
            },

            _selectNanoGPTModelFromBrowser(modelId) {
                if (this.RUNTIME.modelBrowserMode === 'image') {
                    const input = document.getElementById('image-gen-nanogpt-model-input');
                    if (input) {
                        input.value = modelId;
                        input.dispatchEvent(new Event('input'));
                    }
                    ReactiveStore.state.imageGenNanoGPTModel = modelId;
                } else if (this.RUNTIME.modelBrowserMode === 'audio') {
                    const input = document.getElementById('music-nanogpt-model-input');
                    if (input) input.value = modelId;
                    const globalSettings = StateManager.data.globalSettings;
                    globalSettings.musicNanoGPTModel = modelId;
                    StateManager.saveGlobalSettings();
                } else {
                    const input = document.getElementById('nanogpt-model-input');
                    if (input) {
                        input.value = modelId;
                        input.dispatchEvent(new Event('input'));
                    }
                    ReactiveStore.state.nanoGPTModel = modelId;
                }
                this.closeModal('nanogpt-model-modal');
            },

            saveNanoGPTModel() {
                const input = document.getElementById('nanogpt-model-input');
                if (!input) return;
                const value = input.value.trim();
                if (!value) return;
                const globalSettings = StateManager.data.globalSettings;
                if (!globalSettings.savedNanoGPTModels) globalSettings.savedNanoGPTModels = [];
                if (!globalSettings.savedNanoGPTModels.includes(value)) {
                    globalSettings.savedNanoGPTModels.push(value);
                    StateManager.saveGlobalSettings();
                    this.renderSavedNanoGPTModels();
                }
            },

            deleteNanoGPTModel(modelName) {
                const globalSettings = StateManager.data.globalSettings;
                if (!globalSettings.savedNanoGPTModels) return;
                if (confirm(`Remove "${modelName}" from saved models?`)) {
                    globalSettings.savedNanoGPTModels = globalSettings.savedNanoGPTModels.filter(m => m !== modelName);
                    StateManager.saveGlobalSettings();
                    this.renderSavedNanoGPTModels();
                }
            },

            selectNanoGPTModel(modelName) {
                const input = document.getElementById('nanogpt-model-input');
                if (input) {
                    input.value = modelName;
                    input.dispatchEvent(new Event('input'));
                }
            },

            renderSavedNanoGPTModels() {
                const container = document.getElementById('nanogpt-saved-models-list');
                if (!container) return;
                const globalSettings = StateManager.data.globalSettings;
                const models = globalSettings.savedNanoGPTModels || [];
                if (models.length === 0) {
                    container.innerHTML = '<span class="text-xs text-gray-500 italic">No saved models.</span>';
                    return;
                }
                container.innerHTML = models.map(model => {
                    const shortName = model.includes('/') ? model.split('/').slice(1).join('/') : model;
                    return `
                        <div class="inline-flex items-center bg-black/30 border border-gray-600 rounded-lg overflow-hidden" title="${model}">
                            <button onclick="AppController.selectNanoGPTModel('${model}')" class="px-3 py-1 text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors truncate max-w-[200px]">${shortName}</button>
                            <button onclick="AppController.deleteNanoGPTModel('${model}')" class="px-2 py-1 text-xs text-gray-500 hover:text-red-400 hover:bg-black/20 border-l border-gray-600 transition-colors" title="Remove"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                        </div>`;
                }).join('');
            },

            saveNanoGPTImageModel() {
                const input = document.getElementById('image-gen-nanogpt-model-input');
                if (!input) return;
                const value = input.value.trim();
                if (!value) return;
                const globalSettings = StateManager.data.globalSettings;
                if (!globalSettings.savedNanoGPTImageModels) globalSettings.savedNanoGPTImageModels = [];
                if (!globalSettings.savedNanoGPTImageModels.includes(value)) {
                    globalSettings.savedNanoGPTImageModels.push(value);
                    StateManager.saveGlobalSettings();
                    this.renderSavedNanoGPTImageModels();
                }
            },

            deleteNanoGPTImageModel(modelName) {
                const globalSettings = StateManager.data.globalSettings;
                if (!globalSettings.savedNanoGPTImageModels) return;
                if (confirm(`Remove "${modelName}" from saved image models?`)) {
                    globalSettings.savedNanoGPTImageModels = globalSettings.savedNanoGPTImageModels.filter(m => m !== modelName);
                    StateManager.saveGlobalSettings();
                    this.renderSavedNanoGPTImageModels();
                }
            },

            selectNanoGPTImageModel(modelName) {
                const input = document.getElementById('image-gen-nanogpt-model-input');
                if (input) {
                    input.value = modelName;
                    input.dispatchEvent(new Event('input'));
                }
            },

            renderSavedNanoGPTImageModels() {
                const container = document.getElementById('image-gen-nanogpt-saved-models-list');
                if (!container) return;
                const globalSettings = StateManager.data.globalSettings;
                const models = globalSettings.savedNanoGPTImageModels || [];
                if (models.length === 0) {
                    container.innerHTML = '<span class="text-xs text-gray-500 italic">No saved models.</span>';
                    return;
                }
                container.innerHTML = models.map(model => {
                    const shortName = model.includes('/') ? model.split('/').slice(1).join('/') : model;
                    return `
                        <div class="inline-flex items-center bg-black/30 border border-gray-600 rounded-lg overflow-hidden" title="${model}">
                            <button onclick="AppController.selectNanoGPTImageModel('${model}')" class="px-3 py-1 text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors truncate max-w-[200px]">${shortName}</button>
                            <button onclick="AppController.deleteNanoGPTImageModel('${model}')" class="px-2 py-1 text-xs text-gray-500 hover:text-red-400 hover:bg-black/20 border-l border-gray-600 transition-colors" title="Remove"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                        </div>`;
                }).join('');
            }
        };
