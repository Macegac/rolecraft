        /**
         * =================================================================================================
         * [SEC:JS:STATE:SM]
         * StateManager Module
         * Centralizes application state management, including the library, global settings, and active narrative.
         * Handles persistence to localStorage and synchronization with DBService.
         * =================================================================================================
         */
        const StateManager = {
            data: {
                library: { active_story_id: null, active_narrative_id: null, stories: [], folders: [], tag_cache: [] },
                globalSettings: {},
                activeNarrativeState: {},
            },

            CONSTANTS: {
                GLOBAL_SETTINGS_KEY: 'aiStorytellerGlobalSettings',
                ACTIVE_STORY_ID_KEY: 'active_story_id',
                ACTIVE_NARRATIVE_ID_KEY: 'active_narrative_id',
            },

            /**
             * Loads global settings from localStorage.
             */
            loadGlobalSettings() {
                let parsedSettings = {};
                const defaults = UTILITY.getDefaultApiSettings();
                try {
                    const savedSettingsJSON = localStorage.getItem(this.CONSTANTS.GLOBAL_SETTINGS_KEY);
                    if (savedSettingsJSON) parsedSettings = JSON.parse(savedSettingsJSON);
                } catch (error) { parsedSettings = {}; }

                // Default autoCloseBrackets to false if not present
                this.data.globalSettings = { ...defaults, autoCloseBrackets: false, ...parsedSettings };

                // Cleanup legacy keys that are now story-specific to prevent pollution
                delete this.data.globalSettings.responseLength;
                delete this.data.globalSettings.imageGenArtStyle;
                delete this.data.globalSettings.visual_master_probability;
                delete this.data.globalSettings.visual_master_base_prompt;
                delete this.data.globalSettings.event_master_probability;
            },

            /**
             * Saves global settings to localStorage.
             */
            saveGlobalSettings() {
                localStorage.setItem(this.CONSTANTS.GLOBAL_SETTINGS_KEY, JSON.stringify(this.data.globalSettings));
            },

            /**
             * Returns the active narrative state.
             * @returns {Object}
             */
            getState() { return this.data.activeNarrativeState; },
            /**
             * Returns the library data.
             * @returns {Object}
             */
            getLibrary() { return this.data.library; },

            /**
             * Loads the library and hydrates the active narrative state.
             * @returns {Promise<void>}
             */
            async loadLibrary() {
                this.loadGlobalSettings();
                try {
                    const { storyStubs, folders, activeStory, activeNarrative } = await StoryService.loadApplicationData();
                    this.data.library.stories = storyStubs || [];
                    this.data.library.folders = folders || [];
                    this.data.library.active_story_id = activeStory ? activeStory.id : null;
                    this.data.library.active_narrative_id = activeNarrative ? activeNarrative.id : null;

                    if (activeStory && activeNarrative) {
                        const idList = activeNarrative.active_character_ids;
                        const activeIDs = (idList === null || idList === undefined)
                            ? new Set((activeStory.characters || []).map(c => c.id))
                            : new Set(idList);

                        const hydratedCharacters = (activeStory.characters || []).map(char => ({
                            ...char,
                            is_active: char.is_user || activeIDs.has(char.id)
                        }));
                        const uiDefaults = UTILITY.getDefaultUiSettings();
                        this.data.activeNarrativeState = {
                            ...uiDefaults,
                            ...this.data.globalSettings, // User Global Prefs
                            ...activeStory, // Story Specifics (Overrides Global)
                            ...activeNarrative.state, // Narrative Specifics (Overrides Story)

                            // FORCE GLOBALS: Critical API settings must come from Global Settings
                            // This ensures that stale provider/key data in Stories doesn't override user preference.
                            apiProvider: this.data.globalSettings.apiProvider,
                            geminiApiKey: this.data.globalSettings.geminiApiKey,
                            openRouterKey: this.data.globalSettings.openRouterKey,
                            koboldcpp_url: this.data.globalSettings.koboldcpp_url,
                            lmstudio_url: this.data.globalSettings.lmstudio_url,

                            characters: hydratedCharacters,

                            // FORCE GLOBALS: Critical API settings must come from Global Settings
                            // This ensures that stale provider/key data in Stories doesn't override user preference.
                            apiProvider: this.data.globalSettings.apiProvider,
                            geminiApiKey: this.data.globalSettings.geminiApiKey,
                            openRouterKey: this.data.globalSettings.openRouterKey,
                            koboldcpp_url: this.data.globalSettings.koboldcpp_url,
                            lmstudio_url: this.data.globalSettings.lmstudio_url,

                            // Also enforce Model Selections from Global
                            openRouterModel: this.data.globalSettings.openRouterModel,
                            geminiModel: this.data.globalSettings.geminiModel,
                            lmStudioModel: this.data.globalSettings.lmStudioModel, // If applicable

                            characters: hydratedCharacters,
                            narrativeId: activeNarrative.id,
                            narrativeName: activeNarrative.name
                        };

                        if (!this.data.activeNarrativeState.worldMap || !this.data.activeNarrativeState.worldMap.grid || this.data.activeNarrativeState.worldMap.grid.length === 0) {
                            this.data.activeNarrativeState.worldMap = {
                                grid: UTILITY.createDefaultMapGrid(),
                                currentLocation: { x: 4, y: 4 },
                                destination: { x: null, y: null },
                                path: []
                            };
                        }

                        if (!this.data.activeNarrativeState.gameState) {
                            this.data.activeNarrativeState.gameState = {
                                resources: [],
                                relationships: [],
                                journal: []
                            };
                        }

                        if (!this.data.activeNarrativeState.gm_rules) {
                            this.data.activeNarrativeState.gm_rules = [];
                        }

                        if (!this.data.activeNarrativeState.gm_ledger) {
                            this.data.activeNarrativeState.gm_ledger = [];
                        }

                        if (!this.data.activeNarrativeState.knowledge_revisions) {
                            this.data.activeNarrativeState.knowledge_revisions = [];
                        }

                        if (!this.data.activeNarrativeState.static_entries || this.data.activeNarrativeState.static_entries.length === 0) {
                            this.data.activeNarrativeState.static_entries = [{ id: UTILITY.uuid(), title: "World Overview", content: "The world." }];
                        }
                    } else {
                        this.data.activeNarrativeState = {};
                    }
                } catch (error) {
                    this.data.library = { stories: [], tag_cache: [] };
                    this.data.activeNarrativeState = {};
                }
                this.updateTagCache();
            },

            /**
             * Persists the current active story and narrative IDs to localStorage.
             */
            saveLibrary() {
                try {
                    // Persistence: Only save if we have valid IDs, otherwise remove the keys to prevent stale state
                    if (this.data.library.active_story_id) {
                        localStorage.setItem(this.CONSTANTS.ACTIVE_STORY_ID_KEY, this.data.library.active_story_id);
                    } else {
                        localStorage.removeItem(this.CONSTANTS.ACTIVE_STORY_ID_KEY);
                    }

                    if (this.data.library.active_narrative_id) {
                        localStorage.setItem(this.CONSTANTS.ACTIVE_NARRATIVE_ID_KEY, this.data.library.active_narrative_id);
                    } else {
                        localStorage.removeItem(this.CONSTANTS.ACTIVE_NARRATIVE_ID_KEY);
                    }
                } catch (e) {
                    console.warn("LocalStorage save failed:", e);
                }
            },

            /**
             * Updates localStorage with the currently active story and narrative IDs.
             */
            loadActiveNarrative() {
                const { active_story_id, active_narrative_id } = this.data.library;
                if (!active_story_id || !active_narrative_id) {
                    this.data.activeNarrativeState = {};
                    return;
                }
                localStorage.setItem(this.CONSTANTS.ACTIVE_STORY_ID_KEY, active_story_id);
                localStorage.setItem(this.CONSTANTS.ACTIVE_NARRATIVE_ID_KEY, active_narrative_id);
            },

            /**
             * Saves the full application state to the database.
             * @returns {Promise<void>}
             */
            async saveState() {
                // Destructure active_narrative_id to identify the correct stub to update.
                const { active_story_id, active_narrative_id, stories } = this.data.library;
                const currentState = this.data.activeNarrativeState;

                if (!active_story_id || !currentState) return;

                try {
                    const storyInLibrary = stories.find(s => s.id === active_story_id);
                    const storyStubs = (storyInLibrary || {}).narratives || [];

                    // Find the specific narrative stub and update its timestamp.
                    if (active_narrative_id) {
                        const currentStub = storyStubs.find(n => n.id === active_narrative_id);
                        if (currentStub) {
                            currentStub.last_modified = new Date().toISOString();
                        }
                    }

                    // Now save the story (with the updated narrative list) and the narrative itself
                    await StoryService.saveActiveState(currentState, storyStubs);

                    if (storyInLibrary) {
                        storyInLibrary.last_modified = new Date().toISOString();
                    }
                } catch (e) { console.error("Failed to save state:", e); }
            },

            /**
             * Updates the cache of all unique tags used in the library.
             */
            updateTagCache() {
                const allTags = new Set();
                this.data.library.stories.forEach(story => {
                    if (Array.isArray(story.tags)) story.tags.forEach(tag => allTags.add(String(tag).toLowerCase()));
                    if (Array.isArray(story.characters)) {
                        story.characters.forEach(char => {
                            if (char && Array.isArray(char.tags)) char.tags.forEach(tag => allTags.add(String(tag).toLowerCase()));
                        });
                    }
                });
                this.data.library.tag_cache = Array.from(allTags).sort();
            },
        };
