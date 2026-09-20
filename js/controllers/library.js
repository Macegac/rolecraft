        /**
         * =================================================================================================
         * [SEC:JS:CTRL:LIB]
         * LibraryController
         * Handles the logic for managing stories, narratives, and character data.
         * =================================================================================================
         */
        const LibraryController = {

            // --- Story Management ---

            /**
             * Creates a new, blank story in the library.
             */
            async createNewStory() {
                UIManager.showLoadingSpinner('Creating new story...');
                try {
                    // 1. Call the service to create and save the story in the DB
                    const newStory = await StoryService.createNewStory();

                    // 2. Add the new story (which is a stub) to the in-memory library
                    const library = StateManager.getLibrary();
                    library.stories.push(newStory);

                    // 3. Clear active session to ensure clean slate
                    library.active_story_id = null;
                    library.active_narrative_id = null;
                    StateManager.saveLibrary(); // Saves the (cleared) active IDs

                    // 4. Refresh the UI and open the details for the new story
                    UIManager.renderLibraryInterface();
                    UIManager.openStoryDetails(newStory.id);

                } catch (e) {
                    console.error("Failed to create new story:", e);
                    alert("Error: Could not create a new story in the database.");
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Creates a new blank scenario and opens the editor.
             */
            async createNewScenario(storyId) {
                const story = await DBService.getStory(storyId);
                if (!story) return;

                const newScenario = {
                    id: UTILITY.uuid(),
                    name: "New Scenario",
                    message: "The story begins..."
                };

                if (!story.scenarios) story.scenarios = [];
                story.scenarios.push(newScenario);
                story.last_modified = new Date().toISOString();

                await DBService.saveStory(story);

                const library = StateManager.getLibrary();
                const storyInLibrary = library.stories.find(s => s.id === storyId);
                if (storyInLibrary) {
                    storyInLibrary.scenarios = story.scenarios;
                    storyInLibrary.last_modified = story.last_modified;
                }

                UIManager.openStoryDetails(storyId);
                this.editScenario(storyId, newScenario.id);
            },

            /**
             * Opens the scenario edit modal.
             */
            // --- SCENARIO EDITING STATE ---
            currentEditScenario: null,
            currentEditScenarioStoryId: null,
            selectedScenarioStaticId: null,
            selectedScenarioDynamicId: null,

            switchScenarioTab(tabId) {
                const tabs = ['setup', 'cast', 'static', 'dynamic'];
                tabs.forEach(t => {
                    const tabEl = document.getElementById(`scenario-tab-${t}`);
                    if (tabEl) tabEl.classList.add('hidden');
                    const btn = document.getElementById(`scenario-tab-btn-${t}`);
                    if (btn) {
                        btn.classList.remove('border-indigo-500', 'text-white');
                        btn.classList.add('border-transparent', 'text-gray-400');
                    }
                });

                const activeTabEl = document.getElementById(`scenario-tab-${tabId}`);
                if (activeTabEl) activeTabEl.classList.remove('hidden');

                const activeBtn = document.getElementById(`scenario-tab-btn-${tabId}`);
                if (activeBtn) {
                    activeBtn.classList.remove('border-transparent', 'text-gray-400');
                    activeBtn.classList.add('border-indigo-500', 'text-white');
                }

                if (tabId === 'static') this.renderScenarioStaticDetails();
                if (tabId === 'dynamic') this.renderScenarioDynamicDetails();
            },

            async editScenario(storyId, scenarioId) {
                const story = await DBService.getStory(storyId);
                if (!story) return;

                const scenario = story.scenarios.find(sc => sc.id === scenarioId);
                if (!scenario) return;

                // Deep clone for isolated editing
                this.currentEditScenario = JSON.parse(JSON.stringify(scenario));
                this.currentEditScenarioStoryId = storyId;

                // Migrate legacy scenario_knowledge to static entries if needed
                if (this.currentEditScenario.scenario_knowledge && (!this.currentEditScenario.static_entries || this.currentEditScenario.static_entries.length === 0)) {
                    this.currentEditScenario.static_entries = [{
                        id: UTILITY.uuid(),
                        title: "Scenario Context",
                        content: this.currentEditScenario.scenario_knowledge,
                        is_immutable: true
                    }];
                    delete this.currentEditScenario.scenario_knowledge;
                }

                if (!this.currentEditScenario.static_entries) this.currentEditScenario.static_entries = [];
                if (!this.currentEditScenario.dynamic_entries) this.currentEditScenario.dynamic_entries = [];
                if (!this.currentEditScenario.active_character_ids) {
                    this.currentEditScenario.active_character_ids = story.characters.map(c => c.id);
                }

                // Reset selections
                this.selectedScenarioStaticId = null;
                this.selectedScenarioDynamicId = null;

                if (this.currentEditScenario.user_character_id === undefined) {
                    const existingUser = story.characters.find(c => c.is_user);
                    this.currentEditScenario.user_character_id = existingUser ? existingUser.id : null;
                }

                // Populate Setup
                document.getElementById('edit-scenario-story-id').value = storyId;
                document.getElementById('edit-scenario-id').value = scenarioId;
                document.getElementById('edit-scenario-name').value = this.currentEditScenario.name || '';
                document.getElementById('edit-scenario-message').value = this.currentEditScenario.message || '';

                this.switchScenarioTab('setup');
                this.renderScenarioCast(story.characters);
                this.renderScenarioStaticEntries();
                this.renderScenarioDynamicEntries();

                AppController.openModal('edit-scenario-modal');
            },

            renderScenarioCast(allCharacters) {
                const container = document.getElementById('edit-scenario-characters');
                if (!container) return;

                const html = allCharacters.map(char => {
                    const isActive = this.currentEditScenario.active_character_ids.includes(char.id);
                    const isSpeaker = this.currentEditScenario.opening_character_id === char.id;
                    const isScenarioUser = this.currentEditScenario.user_character_id === char.id;
                    return UIComponents.ScenarioCharacterTile(char, isActive, isSpeaker, isScenarioUser);
                }).join('');

                container.innerHTML = DOM.unsafe(html);
            },

            toggleScenarioCharacter(charId) {
                if (!this.currentEditScenario) return;
                const idx = this.currentEditScenario.active_character_ids.indexOf(charId);
                if (idx > -1) {
                    this.currentEditScenario.active_character_ids.splice(idx, 1);
                    if (this.currentEditScenario.opening_character_id === charId) {
                        this.currentEditScenario.opening_character_id = null;
                    }
                } else {
                    this.currentEditScenario.active_character_ids.push(charId);
                }

                DBService.getStory(this.currentEditScenarioStoryId).then(story => {
                    if (story) this.renderScenarioCast(story.characters);
                });
            },

            setScenarioSpeaker(charId) {
                if (!this.currentEditScenario) return;
                if (!this.currentEditScenario.active_character_ids.includes(charId)) return;
                this.currentEditScenario.opening_character_id = charId;

                DBService.getStory(this.currentEditScenarioStoryId).then(story => {
                    if (story) this.renderScenarioCast(story.characters);
                });
            },

            setScenarioUser(charId) {
                if (!this.currentEditScenario) return;
                this.currentEditScenario.user_character_id = charId;
                if (!this.currentEditScenario.active_character_ids.includes(charId)) {
                    this.currentEditScenario.active_character_ids.push(charId);
                }

                DBService.getStory(this.currentEditScenarioStoryId).then(story => {
                    if (story) this.renderScenarioCast(story.characters);
                });
            },

            // --- SCENARIO STATIC KNOWLEDGE ---
            addScenarioStaticEntry() {
                if (!this.currentEditScenario) return;
                const newEntry = { id: UTILITY.uuid(), title: "New Lore", content: "", is_immutable: true };
                this.currentEditScenario.static_entries.push(newEntry);
                this.selectedScenarioStaticId = newEntry.id;
                this.renderScenarioStaticEntries();
                this.renderScenarioStaticDetails();
            },

            selectScenarioStaticEntry(id) {
                this.selectedScenarioStaticId = id;
                this.renderScenarioStaticEntries();
                this.renderScenarioStaticDetails();
            },

            updateScenarioStaticEntry(field, value) {
                if (!this.currentEditScenario || !this.selectedScenarioStaticId) return;
                const entry = this.currentEditScenario.static_entries.find(e => e.id === this.selectedScenarioStaticId);
                if (entry) {
                    entry[field] = value;
                }
            },

            deleteScenarioStaticEntry(id) {
                if (!this.currentEditScenario) return;
                this.currentEditScenario.static_entries = this.currentEditScenario.static_entries.filter(e => e.id !== id);
                if (this.selectedScenarioStaticId === id) this.selectedScenarioStaticId = null;
                this.renderScenarioStaticEntries();
                this.renderScenarioStaticDetails();
            },

            renderScenarioStaticEntries() {
                const container = document.getElementById('scenario-static-entries-list');
                if (!container || !this.currentEditScenario) return;

                const renderItem = (e) => `
                    <div data-action="select-scenario-static" data-id="${e.id}" class="group relative flex justify-between items-center p-2 rounded cursor-pointer transition-colors ${this.selectedScenarioStaticId === e.id ? 'bg-indigo-600' : 'hover:bg-indigo-900/50'}">
                        <span class="text-sm font-semibold truncate ${this.selectedScenarioStaticId === e.id ? 'text-white' : 'text-gray-300'}">${e.title || 'Untitled'}</span>
                        <button data-action="delete-scenario-static" data-id="${e.id}" class="text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                    </div>`;

                container.innerHTML = DOM.unsafe(this.currentEditScenario.static_entries.map(renderItem).join(''));
            },

            renderScenarioStaticDetails() {
                const container = document.getElementById('scenario-static-entry-details');
                if (!container || !this.currentEditScenario) return;

                if (!this.selectedScenarioStaticId) {
                    container.innerHTML = '<div class="text-gray-400 flex items-center justify-center h-full">Select a static entry.</div>';
                    return;
                }

                const entry = this.currentEditScenario.static_entries.find(e => e.id === this.selectedScenarioStaticId);
                if (!entry) return;

                const currentCategory = UTILITY.getEntryCategory(entry);

                container.innerHTML = DOM.unsafe(`
                    <div class="flex flex-col gap-2 mb-4 h-full">
                        <div class="flex items-center gap-2">
                            <input type="text" value="${entry.title}" oninput="LibraryController.updateScenarioStaticEntry('title', this.value)" onblur="LibraryController.renderScenarioStaticEntries()" class="text-xl font-bold bg-black/30 p-2 rounded focus:ring-1 focus:ring-indigo-500 border-none flex-grow text-white">
                            <div class="flex items-center gap-1.5 flex-shrink-0 bg-black/30 p-1.5 rounded border border-gray-700">
                                <label class="text-xs font-semibold text-gray-400">Category:</label>
                                <select onchange="LibraryController.updateScenarioStaticEntryCategory(this.value)" class="bg-gray-800 text-gray-200 text-xs rounded p-1 font-semibold focus:ring-1 focus:ring-indigo-500 border border-gray-700 cursor-pointer">
                                    <option value="other" ${currentCategory === 'other' ? 'selected' : ''}>Other</option>
                                    <option value="event" ${currentCategory === 'event' ? 'selected' : ''}>Event</option>
                                    <option value="character" ${currentCategory === 'character' ? 'selected' : ''}>Character</option>
                                    <option value="item" ${currentCategory === 'item' ? 'selected' : ''}>Item</option>
                                    <option value="world" ${currentCategory === 'world' ? 'selected' : ''}>World</option>
                                    <option value="relationship" ${currentCategory === 'relationship' ? 'selected' : ''}>Relationship</option>
                                </select>
                            </div>
                        </div>
                        <textarea oninput="LibraryController.updateScenarioStaticEntry('content', this.value)" class="w-full flex-grow bg-black/30 border border-gray-600 p-3 rounded text-gray-200 resize-none focus:ring-1 focus:ring-indigo-500 font-mono text-sm leading-relaxed" placeholder="Lore content...">${entry.content}</textarea>
                    </div>
                `);
            },

            updateScenarioStaticEntryCategory(category) {
                if (!this.currentEditScenario || !this.selectedScenarioStaticId) return;
                const entry = this.currentEditScenario.static_entries.find(e => e.id === this.selectedScenarioStaticId);
                if (entry) {
                    entry.category = category;
                    entry.title = UTILITY.formatTitleWithCategory(entry.title, category);
                    this.renderScenarioStaticEntries();
                    this.renderScenarioStaticDetails();
                }
            },

            // --- SCENARIO DYNAMIC KNOWLEDGE ---
            addScenarioDynamicEntry() {
                if (!this.currentEditScenario) return;
                const newEntry = { id: UTILITY.uuid(), title: "New Dynamic Entry", triggers: "", content_fields: [""] };
                this.currentEditScenario.dynamic_entries.push(newEntry);
                this.selectedScenarioDynamicId = newEntry.id;
                this.renderScenarioDynamicEntries();
                this.renderScenarioDynamicDetails();
            },

            selectScenarioDynamicEntry(id) {
                this.selectedScenarioDynamicId = id;
                this.renderScenarioDynamicEntries();
                this.renderScenarioDynamicDetails();
            },

            updateScenarioDynamicEntry(field, value) {
                if (!this.currentEditScenario || !this.selectedScenarioDynamicId) return;
                const entry = this.currentEditScenario.dynamic_entries.find(e => e.id === this.selectedScenarioDynamicId);
                if (entry) {
                    entry[field] = value;
                }
            },

            updateScenarioDynamicContentField(entryId, index, value) {
                if (!this.currentEditScenario) return;
                const entry = this.currentEditScenario.dynamic_entries.find(e => e.id === entryId);
                if (entry && entry.content_fields[index] !== undefined) {
                    entry.content_fields[index] = value;
                }
            },

            addScenarioDynamicContentField(entryId) {
                if (!this.currentEditScenario) return;
                const entry = this.currentEditScenario.dynamic_entries.find(e => e.id === entryId);
                if (entry) {
                    if (!entry.content_fields) entry.content_fields = [];
                    entry.content_fields.push("");
                    this.renderScenarioDynamicDetails();
                }
            },

            deleteScenarioDynamicEntry(id) {
                if (!this.currentEditScenario) return;
                this.currentEditScenario.dynamic_entries = this.currentEditScenario.dynamic_entries.filter(e => e.id !== id);
                if (this.selectedScenarioDynamicId === id) this.selectedScenarioDynamicId = null;
                this.renderScenarioDynamicEntries();
                this.renderScenarioDynamicDetails();
            },

            renderScenarioDynamicEntries() {
                const container = document.getElementById('scenario-dynamic-entries-list');
                if (!container || !this.currentEditScenario) return;

                const renderItem = (e) => `
                    <div data-action="select-scenario-dynamic" data-id="${e.id}" class="group relative flex justify-between items-center p-2 rounded cursor-pointer transition-colors ${this.selectedScenarioDynamicId === e.id ? 'bg-teal-600' : 'hover:bg-teal-900/50'}">
                        <div class="flex flex-col truncate w-4/5">
                            <span class="text-sm font-semibold truncate ${this.selectedScenarioDynamicId === e.id ? 'text-white' : 'text-gray-300'}">${e.title || 'Untitled'}</span>
                            <span class="text-[10px] text-gray-400 truncate">${e.triggers || 'No triggers'}</span>
                        </div>
                        <button data-action="delete-scenario-dynamic" data-id="${e.id}" class="text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                    </div>`;

                container.innerHTML = DOM.unsafe(this.currentEditScenario.dynamic_entries.map(renderItem).join(''));
            },

            renderScenarioDynamicDetails() {
                const container = document.getElementById('scenario-dynamic-entry-details');
                if (!container || !this.currentEditScenario) return;

                if (!this.selectedScenarioDynamicId) {
                    container.innerHTML = '<div class="text-gray-400 flex items-center justify-center h-full">Select a dynamic entry.</div>';
                    return;
                }

                const entry = this.currentEditScenario.dynamic_entries.find(e => e.id === this.selectedScenarioDynamicId);
                if (!entry) return;

                const contentFieldsHTML = (entry.content_fields || [""]).map((content, index) =>
                    `
                    <div class="${index > 0 ? 'border-t border-gray-700 pt-2 mt-2' : ''}">
                        <label class="font-bold mb-2 flex justify-between items-center text-gray-400 text-xs">
                            <span>Step ${index + 1}</span>
                        </label>
                        <textarea oninput="LibraryController.updateScenarioDynamicContentField('${entry.id}', ${index}, this.value)" class="w-full h-24 bg-black/40 border-gray-600 border p-2 resize-y rounded-md text-sm text-gray-200 focus:ring-1 focus:ring-teal-500 font-mono">${content}</textarea>
                    </div>
                    `
                ).join('');

                container.innerHTML = DOM.unsafe(`
                    <div class="flex flex-col h-full">
                        <label class="font-bold text-sm text-gray-400 mb-1">Title</label>
                        <input type="text" value="${entry.title || ''}" oninput="LibraryController.updateScenarioDynamicEntry('title', this.value)" onblur="LibraryController.renderScenarioDynamicEntries()" class="text-xl font-bold bg-black/30 p-2 w-full mb-4 rounded focus:ring-1 focus:ring-teal-500 border-none text-white">
                        
                        <label class="font-bold mb-1 text-sm text-gray-400">Triggers (Keywords, AND, XOR, % Chance)</label>
                        <input type="text" value="${entry.triggers || ''}" oninput="LibraryController.updateScenarioDynamicEntry('triggers', this.value)" onblur="LibraryController.renderScenarioDynamicEntries()" placeholder="e.g. house, cat AND dog, 25%" class="bg-black/30 p-2 w-full mb-4 rounded focus:ring-1 focus:ring-teal-500 border border-gray-600 text-white font-mono">
                        
                        <div class="relative flex-grow flex flex-col mt-2">
                            <label class="font-bold mb-2 text-sm text-gray-400">Content Sequence</label>
                            <div class="space-y-2 overflow-y-auto pr-1 flex-grow">
                                ${contentFieldsHTML}
                            </div>
                            <div class="mt-2 flex justify-end">
                                <button onclick="LibraryController.addScenarioDynamicContentField('${entry.id}')" class="bg-gray-700 hover:bg-teal-600 text-white text-xs font-bold py-1.5 px-3 rounded transition-colors shadow">
                                    + Add Step
                                </button>
                            </div>
                        </div>
                    </div>
                `);
            },

            async saveScenario() {
                const storyId = document.getElementById('edit-scenario-story-id').value;
                const scenarioId = document.getElementById('edit-scenario-id').value;
                const name = document.getElementById('edit-scenario-name').value.trim();
                const message = document.getElementById('edit-scenario-message').value.trim();

                if (!name || !message) {
                    alert("Name and Message cannot be empty.");
                    return;
                }

                const story = await DBService.getStory(storyId);
                if (!story) return;

                const scenario = story.scenarios.find(sc => sc.id === scenarioId);
                if (!scenario) return;

                // Sync UI fields into the deep clone
                this.currentEditScenario.name = name;
                this.currentEditScenario.message = message;

                // Mutate the original scenario
                Object.assign(scenario, this.currentEditScenario);
                delete scenario.scenario_knowledge; // Ensure legacy is cleaned

                story.last_modified = new Date().toISOString();

                await DBService.saveStory(story);

                const library = StateManager.getLibrary();
                const storyInLibrary = library.stories.find(s => s.id === storyId);
                if (storyInLibrary) {
                    storyInLibrary.scenarios = story.scenarios;
                    storyInLibrary.last_modified = story.last_modified;
                }

                AppController.closeModal('edit-scenario-modal');
                UIManager.openStoryDetails(storyId);
            },

            /**
             * Renames a scenario within a story.
             * @param {string} storyId - The ID of the story.
             * @param {string} scenarioId - The ID of the scenario.
             */
            async renameScenario(storyId, scenarioId) {
                const story = await DBService.getStory(storyId);
                if (!story) return;

                const scenario = story.scenarios.find(sc => sc.id === scenarioId);
                if (!scenario) return;

                const newName = await UTILITY.customPrompt("Enter new name for this scenario:", scenario.name, "Scenario Name");
                if (!newName || newName.trim() === "") return;

                try {
                    scenario.name = newName.trim();
                    story.last_modified = new Date().toISOString();

                    // 1. Save to DB
                    await DBService.saveStory(story);

                    // 2. Update In-Memory Library Stub
                    const library = StateManager.getLibrary();
                    const storyInLibrary = library.stories.find(s => s.id === storyId);
                    if (storyInLibrary) {
                        storyInLibrary.scenarios = story.scenarios;
                        storyInLibrary.last_modified = story.last_modified;
                    }

                    // 3. Refresh UI
                    UIManager.openStoryDetails(storyId);

                } catch (e) {
                    console.error("Failed to rename scenario:", e);
                    alert(`Error: ${e.message}`);
                }
            },

            /**
             * Deletes a story and all associated data.
             * @param {string} storyId - The ID of the story to delete.
             */
            async deleteStory(storyId) {
                const proceed = await UIManager.showConfirmationPromise('Are you sure you want to permanently delete this entire story, including all its narratives and scenarios?');
                if (!proceed) return;

                UIManager.showLoadingSpinner('Deleting story...');
                try {
                    // 1. Call the service to delete everything from DB
                    await StoryService.deleteStory(storyId);

                    // 2. Update the in-memory library
                    const library = StateManager.getLibrary();
                    library.stories = library.stories.filter(s => s.id !== storyId);
                    StateManager.updateTagCache();

                    // 3. Handle active session
                    if (library.active_story_id === storyId) {
                        library.active_story_id = null;
                        library.active_narrative_id = null;
                        StateManager.saveLibrary(); // Save cleared IDs
                        window.location.reload();
                    } else {
                        StateManager.saveLibrary();
                        // Close modal if open
                        AppController.closeModal('story-details-modal');
                        UIManager.renderLibraryInterface(); // Refresh library list
                    }
                } catch (e) {
                    console.error("Failed to delete story:", e);
                    alert(`Error: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Duplicates an entire story structure, including narratives and scenarios.
             * @param {string} storyId - The ID of the story to duplicate.
             */
            async duplicateStory(storyId) {
                UIManager.showLoadingSpinner('Duplicating story...');
                try {
                    // 1. Get all data for the original story
                    const originalStory = await DBService.getStory(storyId);
                    if (!originalStory) throw new Error("Original story not found in database.");

                    const originalNarrativeStubs = originalStory.narratives || [];
                    const originalNarratives = await Promise.all(
                        originalNarrativeStubs.map(stub => DBService.getNarrative(stub.id))
                    );

                    // 2. Create new story object
                    const newStory = JSON.parse(JSON.stringify(originalStory));
                    newStory.id = UTILITY.uuid();
                    newStory.name = `${originalStory.name || 'Untitled Story'} (Copy)`;
                    newStory.last_modified = new Date().toISOString();
                    newStory.created_date = new Date().toISOString();

                    // Create ID Mapping for Characters
                    // We must track which Old ID maps to which New ID so we can update the chat history
                    const charIdMap = {};
                    (newStory.characters || []).forEach(c => {
                        const oldId = c.id;
                        const newId = UTILITY.uuid();
                        c.id = newId;
                        charIdMap[oldId] = newId;
                    });

                    // Helper to remap IDs in a history array
                    const remapHistory = (history) => {
                        if (!Array.isArray(history)) return;
                        history.forEach(msg => {
                            if (msg.character_id && charIdMap[msg.character_id]) {
                                msg.character_id = charIdMap[msg.character_id];
                            }
                        });
                    };

                    // Helper to remap active character lists
                    const remapActiveIds = (ids) => {
                        if (!Array.isArray(ids)) return ids;
                        return ids.map(id => charIdMap[id] || id);
                    };

                    // 3. Create new narratives with new IDs AND Remapped Character References
                    const newNarratives = [];
                    const newNarrativeStubs = [];

                    for (const narrative of originalNarratives) {
                        if (!narrative) continue;
                        const newNarrative = JSON.parse(JSON.stringify(narrative));
                        newNarrative.id = UTILITY.uuid();

                        // Update Chat History to point to new Character IDs
                        if (newNarrative.state && newNarrative.state.chat_history) {
                            remapHistory(newNarrative.state.chat_history);
                        }

                        // Update Active Character List
                        if (newNarrative.active_character_ids) {
                            newNarrative.active_character_ids = remapActiveIds(newNarrative.active_character_ids);
                        }

                        newNarratives.push(newNarrative);
                        newNarrativeStubs.push({ id: newNarrative.id, name: newNarrative.name, last_modified: newNarrative.last_modified });
                    }

                    // 4. Update new story with new narrative stubs
                    newStory.narratives = newNarrativeStubs;

                    // 5. Update Scenarios and other IDs
                    (newStory.scenarios || []).forEach(s => {
                        s.id = UTILITY.uuid();
                        // Update Scenario Example Dialogue and Active Lists
                        remapHistory(s.example_dialogue);
                        if (s.active_character_ids) {
                            s.active_character_ids = remapActiveIds(s.active_character_ids);
                        }
                    });

                    (newStory.dynamic_entries || []).forEach(e => e.id = UTILITY.uuid());

                    // 6. Save all new data to DB
                    await DBService.saveStory(newStory);
                    await Promise.all(newNarratives.map(n => DBService.saveNarrative(n)));

                    // 7. Update in-memory library
                    await this.updateSearchIndex(newStory);
                    const library = StateManager.getLibrary();
                    library.stories.push(newStory);
                    StateManager.updateTagCache();

                    UIManager.renderLibraryInterface();
                    UIManager.openStoryDetails(newStory.id);

                } catch (e) {
                    console.error("Failed to duplicate story:", e);
                    alert(`Error: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Handles the "Quick Play" button on story cards.
             * Resumes the most recently modified narrative, or starts a new one from the first scenario.
             * @param {string} storyId - The ID of the story.
             */
            async handleQuickPlay(storyId) {
                try {
                    const story = await DBService.getStory(storyId);
                    if (!story) return;

                    const narratives = story.narratives || [];

                    // 1. If narratives exist, load the most recent one
                    if (narratives.length > 0) {
                        // Sort by last_modified desc
                        narratives.sort((a, b) => new Date(b.last_modified) - new Date(a.last_modified));
                        this.loadNarrative(storyId, narratives[0].id);
                        return;
                    }

                    // 2. If no narratives, check for scenarios
                    const scenarios = story.scenarios || [];
                    if (scenarios.length > 0) {
                        // Create new narrative from the first scenario
                        await this.createNarrativeFromScenario(storyId, scenarios[0].id);
                        return;
                    }

                    // 3. Fallback
                    alert("This story has no content to play. Please add a scenario or narrative.");

                } catch (e) {
                    console.error("Quick Play failed:", e);
                    alert("Failed to start story.");
                }
            },

            /**
             * Updates a specific field of a story object (debounced).
             * This handles updating both the Database and the In-Memory Library Stub.
             * @param {string} storyId - The ID of the story.
             * @param {string} field - The field to update.
             * @param {*} value - The new value.
             */
            updateStoryField: debounce(async function (storyId, field, value) {
                try {
                    // 1. Call the service to update the DB
                    const updatedStory = await StoryService.updateStoryField(storyId, field, value);

                    // 2. Update the in-memory stub
                    const library = StateManager.getLibrary();
                    const storyInLibrary = library.stories.find(s => s.id === storyId);
                    if (storyInLibrary) {
                        storyInLibrary[field] = updatedStory[field];
                        storyInLibrary.last_modified = updatedStory.last_modified;
                    }

                    // 3. Update search index if needed
                    if (field === 'creator_notes' || field === 'name') {
                        await this.updateSearchIndex(storyInLibrary);
                    }

                    // 4. If this is the active story, sync ReactiveStore to show changes live (e.g. title bar)
                    if (storyId === library.active_story_id && typeof ReactiveStore !== 'undefined') {
                        if (field === 'name') ReactiveStore.state.name = value;
                        // Note: creator_notes isn't usually reactive in the UI, but we could set it if needed
                    }

                } catch (e) {
                    console.error(`Failed to update story field ${field}:`, e);
                }
            }, 300),

            /**
             * Adds a new tag to the story and saves.
             */
            addStoryTag: debounce(async function (storyId, newTag) {
                if (!newTag || !newTag.trim()) return;
                try {
                    const library = StateManager.getLibrary();
                    const story = library.stories.find(s => s.id === storyId);
                    if (!story) return;

                    let tags = [...(story.tags || [])];
                    const cleanTag = newTag.trim();
                    if (!tags.includes(cleanTag)) {
                        tags.push(cleanTag);
                        await this.updateStoryTags(storyId, tags.join(', '));
                        if (UIManager.RUNTIME.viewingStoryId === storyId) {
                            UIManager.openStoryDetails(storyId);
                        } else {
                            UIManager.renderLibraryInterface();
                        }
                    }
                } catch (e) { console.error("Failed to add story tag", e); }
            }, 300),

            /**
             * Removes a tag from the story and saves.
             */
            removeStoryTag: async function (storyId, tagToRemove) {
                try {
                    const library = StateManager.getLibrary();
                    const story = library.stories.find(s => s.id === storyId);
                    if (!story) return;

                    let tags = (Array.isArray(story.tags) ? story.tags : []).filter(t => t !== tagToRemove);
                    await this.updateStoryTags(storyId, tags.join(', '));
                    if (UIManager.RUNTIME.viewingStoryId === storyId) {
                        UIManager.openStoryDetails(storyId);
                    } else {
                        UIManager.renderLibraryInterface();
                    }
                } catch (e) { console.error("Failed to remove story tag", e); }
            },

            /**
             * Updates a story's tags (debounced).
             * @param {string} storyId - The ID of the story.
             * @param {string} value - The comma-separated tags string.
             */
            updateStoryTags: debounce(async function (storyId, value) {
                const tags = value.split(',').map(t => t.trim()).filter(Boolean);
                try {
                    // 1. Call the service to update the DB
                    const updatedStory = await StoryService.updateStoryField(storyId, 'tags', tags);

                    // 2. Update the in-memory stub
                    const library = StateManager.getLibrary();
                    const storyInLibrary = library.stories.find(s => s.id === storyId);
                    if (storyInLibrary) {
                        storyInLibrary.tags = updatedStory.tags;
                        storyInLibrary.last_modified = updatedStory.last_modified;
                    }

                    // 3. Update search and tag cache
                    await this.updateSearchIndex(storyInLibrary);
                    StateManager.updateTagCache();

                    // 4. Sync ReactiveStore if active
                    if (storyId === library.active_story_id && typeof ReactiveStore !== 'undefined') {
                        ReactiveStore.state.tags = tags;
                    }

                } catch (e) {
                    console.error("Failed to update story tags:", e);
                }
            }, 500),

            // --- Scenario & Narrative Management ---

            /**
             * Loads a specific narrative and reloads the page.
             * @param {string} storyId - The ID of the story.
             * @param {string} narrativeId - The ID of the narrative.
             */
            loadNarrative(storyId, narrativeId) {
                const library = StateManager.getLibrary();
                library.active_story_id = storyId;
                library.active_narrative_id = narrativeId;
                StateManager.saveLibrary(); // Save IDs to localStorage
                window.location.reload();
            },

            /**
             * Creates a new narrative from a scenario template.
             * @param {string} storyId - The ID of the story.
             * @param {string} scenarioId - The ID of the scenario.
             */
            async createNarrativeFromScenario(storyId, scenarioId) {
                UIManager.showLoadingSpinner('Creating new narrative...');
                try {
                    // 1. Force save current state to be safe
                    if (typeof ReactiveStore !== 'undefined') await ReactiveStore.forceSave();

                    // 2. Block auto-save to prevent race condition on reload
                    if (typeof ReactiveStore !== 'undefined' && ReactiveStore.blockAutoSave) {
                        ReactiveStore.blockAutoSave();
                    }

                    const newNarrative = await StoryService.createNarrativeFromScenario(storyId, scenarioId);

                    const library = StateManager.getLibrary();
                    const storyInLibrary = library.stories.find(s => s.id === storyId);

                    if (storyInLibrary) {
                        if (!storyInLibrary.narratives) storyInLibrary.narratives = [];
                        storyInLibrary.narratives.push({
                            id: newNarrative.id,
                            name: newNarrative.name,
                            last_modified: newNarrative.last_modified
                        });
                        storyInLibrary.last_modified = new Date().toISOString();
                    }

                    this.loadNarrative(storyId, newNarrative.id);

                } catch (error) {
                    UIManager.hideLoadingSpinner();
                    console.error("Failed to create narrative from scenario:", error);
                    alert(`Error: ${error.message}`);
                }
            },

            /**
             * Deletes a narrative and its history.
             * @param {string} storyId - The ID of the story.
             * @param {string} narrativeId - The ID of the narrative.
             */
            async deleteNarrative(storyId, narrativeId) {
                const proceed = await UIManager.showConfirmationPromise('Are you sure you want to permanently delete this narrative and all its chat history?');
                if (!proceed) return;

                UIManager.showLoadingSpinner('Deleting narrative...');
                try {
                    const updatedStory = await StoryService.deleteNarrative(storyId, narrativeId);

                    const library = StateManager.getLibrary();
                    const storyInLibrary = library.stories.find(s => s.id === storyId);
                    if (storyInLibrary) {
                        storyInLibrary.narratives = updatedStory.narratives;
                        storyInLibrary.last_modified = updatedStory.last_modified;
                    }

                    if (library.active_narrative_id === narrativeId) {
                        library.active_narrative_id = null;
                        library.active_story_id = null;
                        StateManager.saveLibrary();
                        window.location.reload();
                    } else {
                        StateManager.saveLibrary();
                        UIManager.openStoryDetails(storyId); // Refresh UI
                    }
                } catch (e) {
                    console.error("Failed to delete narrative:", e);
                    alert(`Error: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Duplicates an existing narrative.
             * @param {string} storyId - The ID of the story.
             * @param {string} narrativeId - The ID of the narrative.
             */
            async duplicateNarrative(storyId, narrativeId) {
                UIManager.showLoadingSpinner('Duplicating narrative...');
                try {
                    const story = await DBService.getStory(storyId);
                    const narrative = await DBService.getNarrative(narrativeId);
                    if (!story || !narrative) throw new Error("Data not found.");

                    const newNarrative = JSON.parse(JSON.stringify(narrative));
                    newNarrative.id = UTILITY.uuid();
                    newNarrative.name = `${narrative.name} (Copy)`;
                    newNarrative.last_modified = new Date().toISOString();

                    await DBService.saveNarrative(newNarrative);

                    story.narratives.push({ id: newNarrative.id, name: newNarrative.name, last_modified: newNarrative.last_modified });
                    story.last_modified = new Date().toISOString();
                    await DBService.saveStory(story);

                    const library = StateManager.getLibrary();
                    const storyInLibrary = library.stories.find(s => s.id === storyId);
                    if (storyInLibrary) {
                        storyInLibrary.narratives = story.narratives;
                        storyInLibrary.last_modified = story.last_modified;
                    }

                    UIManager.openStoryDetails(storyId);
                } catch (e) {
                    console.error("Failed to duplicate narrative:", e);
                    alert(`Error: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Deletes a scenario from a story.
             * @param {string} storyId - The ID of the story.
             * @param {string} scenarioId - The ID of the scenario.
             */
            async deleteScenario(storyId, scenarioId) {
                const story = await DBService.getStory(storyId);
                if (!story) return;
                if (story.scenarios.length <= 1) {
                    alert("You cannot delete the last scenario.");
                    return;
                }

                const proceed = await UIManager.showConfirmationPromise('Are you sure you want to delete this scenario?');
                if (!proceed) return;

                try {
                    story.scenarios = story.scenarios.filter(sc => sc.id !== scenarioId);
                    story.last_modified = new Date().toISOString();
                    await DBService.saveStory(story);

                    const library = StateManager.getLibrary();
                    const storyInLibrary = library.stories.find(s => s.id === storyId);
                    if (storyInLibrary) {
                        storyInLibrary.scenarios = story.scenarios;
                        storyInLibrary.last_modified = story.last_modified;
                    }

                    UIManager.openStoryDetails(storyId);
                } catch (e) {
                    console.error("Failed to delete scenario:", e);
                    alert(`Error: ${e.message}`);
                }
            },

            /**
             * Duplicates an existing scenario.
             * @param {string} storyId - The ID of the story.
             * @param {string} scenarioId - The ID of the scenario.
             */
            async duplicateScenario(storyId, scenarioId) {
                UIManager.showLoadingSpinner('Duplicating scenario...');
                try {
                    const story = await DBService.getStory(storyId);
                    const scenario = story.scenarios.find(sc => sc.id === scenarioId);
                    if (!story || !scenario) throw new Error("Data not found.");

                    const newScenario = JSON.parse(JSON.stringify(scenario));
                    newScenario.id = UTILITY.uuid();
                    newScenario.name = `${scenario.name} (Copy)`;
                    story.scenarios.push(newScenario);
                    story.last_modified = new Date().toISOString();

                    await DBService.saveStory(story);

                    const library = StateManager.getLibrary();
                    const storyInLibrary = library.stories.find(s => s.id === storyId);
                    if (storyInLibrary) {
                        storyInLibrary.scenarios = story.scenarios;
                        storyInLibrary.last_modified = story.last_modified;
                    }

                    UIManager.openStoryDetails(storyId);
                } catch (e) {
                    console.error("Failed to duplicate scenario:", e);
                    alert(`Error: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Deletes multiple scenarios at once.
             * @param {string} storyId 
             */
            async deleteMultipleScenarios(storyId) {
                const checked = document.querySelectorAll('.scenario-select-check:checked');
                if (checked.length === 0) return;

                const ids = Array.from(checked).map(c => c.value);
                const confirmMsg = `Are you sure you want to delete ${ids.length} scenarios? This cannot be undone.`;
                const proceed = await UIManager.showConfirmationPromise(confirmMsg);

                if (!proceed) return;

                UIManager.showLoadingSpinner('Deleting scenarios...');
                try {
                    const story = await DBService.getStory(storyId);
                    if (!story) throw new Error("Story not found.");

                    // Filter out deleted scenarios
                    const initialCount = story.scenarios.length;
                    story.scenarios = story.scenarios.filter(sc => !ids.includes(sc.id));

                    if (story.scenarios.length === initialCount) return; // No changes

                    story.last_modified = new Date().toISOString();
                    await DBService.saveStory(story);

                    // Update memory
                    const library = StateManager.getLibrary();
                    const storyInLibrary = library.stories.find(s => s.id === storyId);
                    if (storyInLibrary) {
                        storyInLibrary.scenarios = story.scenarios;
                        storyInLibrary.last_modified = story.last_modified;
                    }

                    UIManager.openStoryDetails(storyId);
                } catch (e) {
                    console.error("Bulk delete failed:", e);
                    alert("Error: " + e.message);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Deletes multiple narratives at once.
             * @param {string} storyId
             */
            async deleteMultipleNarratives(storyId) {
                const checked = document.querySelectorAll('.narrative-select-check:checked');
                if (checked.length === 0) return;

                const ids = Array.from(checked).map(c => c.value);
                const confirmMsg = `Are you sure you want to delete ${ids.length} narratives? This cannot be undone.`;
                const proceed = await UIManager.showConfirmationPromise(confirmMsg);

                if (!proceed) return;

                UIManager.showLoadingSpinner('Deleting narratives...');
                try {
                    const story = await DBService.getStory(storyId);
                    if (!story) throw new Error("Story not found.");

                    // Filter out deleted narrative stubs
                    const initialCount = story.narratives.length;
                    story.narratives = story.narratives.filter(n => !ids.includes(n.id));

                    if (story.narratives.length === initialCount) return; // No changes to story wrapper

                    story.last_modified = new Date().toISOString();
                    await DBService.saveStory(story);

                    // Delete actual narrative objects from DB
                    // Try/Catch individually or all at once? All at once is fine.
                    await Promise.all(ids.map(id => DBService.deleteNarrative(id)));

                    // Update memory
                    const library = StateManager.getLibrary();
                    const storyInLibrary = library.stories.find(s => s.id === storyId);
                    if (storyInLibrary) {
                        storyInLibrary.narratives = story.narratives;
                        storyInLibrary.last_modified = story.last_modified;
                    }

                    // Handle Active Narrative Deletion
                    if (ids.includes(library.active_narrative_id)) {
                        library.active_narrative_id = null;
                        StateManager.saveLibrary();
                        if (library.active_story_id === storyId) {
                            window.location.reload();
                            return;
                        }
                    }

                    UIManager.openStoryDetails(storyId);
                } catch (e) {
                    console.error("Bulk delete narratives failed:", e);
                    alert("Error: " + e.message);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Starts the In-Story Scenario Generation process.
             * @param {string} storyId - The ID of the story.
             */
            startInStoryGeneration(storyId) {
                this.RUNTIME_GEN.mode = 'in-story';
                this.RUNTIME_GEN.targetStoryId = storyId;

                const title = document.getElementById('gen-story-modal-title');
                if (title) title.textContent = "Scenario Architect";

                const draftBtn = document.getElementById('gen-story-draft-btn');
                if (draftBtn) draftBtn.textContent = "Draft Scenario";

                const confirmBtn = document.getElementById('gen-story-confirm-btn');
                if (confirmBtn) confirmBtn.textContent = "Generate Scenario";

                const hint = document.getElementById('gen-story-approval-hint');
                if (hint) hint.textContent = "Refine the scenario concept. When ready, we will generate the full cast and scene.";

                document.getElementById('gen-story-prompt').value = "";
                document.getElementById('gen-story-prompt').placeholder = "Describe the new scenario you want to add to this story...";
                document.getElementById('gen-story-input-view').classList.remove('hidden');
                document.getElementById('gen-story-progress-view').classList.add('hidden');
                document.getElementById('gen-story-approval-view').classList.add('hidden');

                AppController.openModal('gen-story-modal');
            },

            startNewStoryGeneration() {
                this.RUNTIME_GEN.mode = 'new-story';
                this.RUNTIME_GEN.targetStoryId = null;

                const title = document.getElementById('gen-story-modal-title');
                if (title) title.textContent = "AI Story Architect";

                const draftBtn = document.getElementById('gen-story-draft-btn');
                if (draftBtn) draftBtn.textContent = "Draft Concept";

                const confirmBtn = document.getElementById('gen-story-confirm-btn');
                if (confirmBtn) confirmBtn.textContent = "Build This World";

                const hint = document.getElementById('gen-story-approval-hint');
                if (hint) hint.textContent = "Refine the concept above. When ready, we will generate the full world.";

                document.getElementById('gen-story-prompt').value = "";
                document.getElementById('gen-story-prompt').placeholder = "e.g. A cyberpunk noir detective story on Mars where water is more expensive than gold.";
                document.getElementById('gen-story-input-view').classList.remove('hidden');
                document.getElementById('gen-story-progress-view').classList.add('hidden');
                document.getElementById('gen-story-approval-view').classList.add('hidden');

                AppController.openModal('gen-story-modal');
            },

            /**
             * Adds a story to a folder (appending to existing folders).
             * @param {string} storyId
             * @param {string} folderId
             */
            async addStoryToFolder(storyId, folderId) {
                try {
                    const library = StateManager.getLibrary();
                    const story = await DBService.getStory(storyId); // Fetch fresh to be safe
                    if (!story) return;

                    // Update DB
                    if (!story.folder_ids) story.folder_ids = [];
                    if (!story.folder_ids.includes(folderId)) {
                        story.folder_ids.push(folderId);
                        await DBService.saveStory(story);

                        // Update Memory
                        const storyInLib = library.stories.find(s => s.id === storyId);
                        if (storyInLib) {
                            storyInLib.folder_ids = story.folder_ids;
                        }

                        // Refresh Library (background)
                        UIManager.renderLibraryInterface();
                    }
                } catch (e) {
                    console.error("Failed to add story to folder:", e);
                }
            },

            /**
             * Sets the folder for a story. (Deprecated / Legacy Move logic)
             * @param {string} storyId
             * @param {string} folderId
             */
            async setStoryFolder(storyId, folderId) {
                try {
                    const library = StateManager.getLibrary();
                    const story = await DBService.getStory(storyId); // Fetch fresh to be safe
                    if (!story) return;

                    // Update DB
                    if (!folderId) {
                        story.folder_ids = [];
                    } else {
                        story.folder_ids = [folderId];
                    }
                    await DBService.saveStory(story);

                    // Update Memory
                    const storyInLib = library.stories.find(s => s.id === storyId);
                    if (storyInLib) {
                        storyInLib.folder_ids = story.folder_ids;
                    }

                    // Refresh Library (background)
                    UIManager.renderLibraryInterface();

                } catch (e) {
                    console.error("Failed to set story folder:", e);
                }
            },

            /**
             * Promotes a narrative to a scenario, saving its current state as a template.
             * @param {string} storyId - The ID of the story.
             * @param {string} narrativeId - The ID of the narrative.
             */
            async elevateNarrativeToScenario(storyId, narrativeId) {
                UIManager.showLoadingSpinner('Creating scenario from chat...');
                try {
                    // Re-use Controller logic logic, but ensure it's fully encapsulated here
                    const story = await DBService.getStory(storyId);
                    const narrative = await DBService.getNarrative(narrativeId);
                    if (!story || !narrative) throw new Error("Data not found.");

                    const firstMessage = (narrative.state.chat_history || []).find(m => !m.isHidden && m.type === 'chat');
                    const exampleDialogue = (narrative.state.chat_history || []).filter(m => m.isHidden);
                    let activeIDs = narrative.active_character_ids || (story.characters || []).map(c => c.id);

                    const newScenario = {
                        id: UTILITY.uuid(),
                        name: `${narrative.name} (Scenario)`,
                        message: firstMessage ? firstMessage.content : "The story continues...",
                        static_entries: JSON.parse(JSON.stringify(narrative.state.static_entries || [])),
                        worldMap: JSON.parse(JSON.stringify(narrative.state.worldMap || {})),
                        example_dialogue: JSON.parse(JSON.stringify(exampleDialogue)),
                        active_character_ids: activeIDs,
                        // Snapshot dynamic entries and prompts from current story settings
                        dynamic_entries: JSON.parse(JSON.stringify(story.dynamic_entries || [])),
                        prompts: {
                            system_prompt: story.system_prompt,
                            event_master_base_prompt: story.event_master_base_prompt,
                            prompt_persona_gen: story.prompt_persona_gen,
                            prompt_living_persona_gen: story.prompt_living_persona_gen,
                            prompt_world_map_gen: story.prompt_world_map_gen,
                            prompt_location_gen: story.prompt_location_gen,
                            prompt_adjacent_locations_gen: story.prompt_adjacent_locations_gen,
                            prompt_entry_gen: story.prompt_entry_gen,
                            prompt_location_memory_gen: story.prompt_location_memory_gen,
                            font: story.font,
                            backgroundImageURL: story.backgroundImageURL,
                            bubbleOpacity: story.bubbleOpacity,
                            chatTextColor: story.chatTextColor
                        }
                    };

                    story.scenarios.push(newScenario);
                    story.last_modified = new Date().toISOString();
                    await DBService.saveStory(story);

                    const library = StateManager.getLibrary();
                    const storyInLibrary = library.stories.find(s => s.id === storyId);
                    if (storyInLibrary) {
                        storyInLibrary.scenarios = story.scenarios;
                        storyInLibrary.last_modified = story.last_modified;
                    }

                    UIManager.openStoryDetails(storyId);
                } catch (e) {
                    console.error("Failed to elevate narrative:", e);
                    alert(`Error: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            // --- Folder Management ---

            /**
             * Creates a new folder.
             * @param {string} name - The name of the folder.
             * @param {string} [parentId=null] - The ID of the parent folder (optional).
             */
            async createFolder(name, parentId = null) {
                const folder = {
                    id: UTILITY.uuid(),
                    name: name,
                    parent_id: parentId,
                    created_at: new Date().toISOString()
                };

                try {
                    await DBService.saveFolder(folder);
                    const library = StateManager.getLibrary();
                    library.folders.push(folder);
                    UIManager.renderLibraryInterface();
                } catch (e) {
                    console.error("Failed to create folder:", e);
                    alert("Error creating folder.");
                }
            },

            /**
             * Renames a folder. The Rename button hands over the name the folder already has, so
             * a name that matches the current one means "ask me for a new one".
             * @param {string} folderId
             * @param {string} [newName] - The new name, or the current one to be asked instead.
             */
            async renameFolder(folderId, newName) {
                try {
                    const library = StateManager.getLibrary();
                    const folder = library.folders.find(f => f.id === folderId);
                    if (!folder) return;

                    let name = newName;
                    if (!name || !name.trim() || name.trim() === folder.name) {
                        name = await UTILITY.customPrompt("Enter new folder name:", folder.name, "Folder Name");
                    }
                    if (!name || !name.trim() || name.trim() === folder.name) return;

                    folder.name = name.trim();
                    await DBService.saveFolder(folder);
                    UIManager.renderLibraryInterface();
                } catch (e) {
                    console.error("Failed to rename folder:", e);
                }
            },

            /**
             * Deletes a folder and unlinks it from stories.
             * @param {string} folderId 
             */
            async deleteFolder(folderId) {
                const proceed = await UIManager.showConfirmationPromise("Delete this folder? Stories inside will not be deleted, just removed from the folder.");
                if (!proceed) return;

                try {
                    // 1. Delete from DB
                    await DBService.deleteFolder(folderId);

                    // 2. Remove from State
                    const library = StateManager.getLibrary();
                    library.folders = library.folders.filter(f => f.id !== folderId);

                    // 3. Unlink from Stories (in memory and DB)
                    const updates = [];
                    library.stories.forEach(story => {
                        if (story.folder_ids && story.folder_ids.includes(folderId)) {
                            story.folder_ids = story.folder_ids.filter(id => id !== folderId);
                            updates.push(DBService.saveStory(story)); // Async save
                        }
                    });

                    await Promise.all(updates);

                    // Don't leave the library looking inside a folder that is now gone.
                    if (UIManager.RUNTIME.currentLibraryFolder === folderId) {
                        UIManager.RUNTIME.currentLibraryFolder = null;
                    }
                    UIManager.renderLibraryInterface();

                } catch (e) {
                    console.error("Failed to delete folder:", e);
                }
            },

            /**
             * Sets the parent folder for a given folder.
             * @param {string} folderId 
             * @param {string} newParentId 
             */
            async setFolderParent(folderId, newParentId) {
                try {
                    const library = StateManager.getLibrary();
                    const folder = library.folders.find(f => f.id === folderId);
                    if (!folder) return;

                    // Prevent Circular Dependency (Logic duplicated here for safety)
                    if (folderId === newParentId) return;

                    // Update parent
                    folder.parent_id = newParentId;

                    // Persist to DB
                    await DBService.saveFolder(folder);

                    // Update UI
                    UIManager.renderLibraryInterface();

                } catch (e) {
                    console.error("Failed to move folder:", e);
                }
            },

            /**
             * Toggles a story's presence in a folder.
             * @param {string} storyId 
             * @param {string} folderId 
             */
            async toggleStoryInFolder(storyId, folderId) {
                try {
                    const story = await DBService.getStory(storyId);
                    if (!story) return;

                    if (!story.folder_ids) story.folder_ids = [];

                    if (story.folder_ids.includes(folderId)) {
                        story.folder_ids = story.folder_ids.filter(id => id !== folderId);
                    } else {
                        story.folder_ids.push(folderId);
                    }

                    story.last_modified = new Date().toISOString();
                    await DBService.saveStory(story);

                    // Update State
                    const library = StateManager.getLibrary();
                    const storyInLib = library.stories.find(s => s.id === storyId);
                    if (storyInLib) {
                        storyInLib.folder_ids = story.folder_ids;
                        storyInLib.last_modified = story.last_modified;
                    }

                    UIManager.renderLibraryInterface();
                } catch (e) {
                    console.error("Failed to toggle story in folder:", e);
                }
            },

            /**
             * Opens a modal to add stories to a specific folder.
             * @param {string} folderId 
             */
            async addStoriesToFolder(folderId) {
                const library = StateManager.getLibrary();
                const folder = library.folders.find(f => f.id === folderId);
                if (!folder) return;

                // Get all stories NOT in this folder
                const stories = library.stories.filter(s => !s.folder_ids || !s.folder_ids.includes(folderId));

                // Helper to render checkable list
                const storyListHTML = stories.map(s => {
                    const charCount = (s.characters || []).length;
                    return DOM.html`
                        <div class="flex items-center space-x-3 p-2 hover:bg-gray-700/50 rounded cursor-pointer" onclick="this.querySelector('input').click()">
                            <input type="checkbox" value="${s.id}" class="story-select-check w-4 h-4 rounded bg-gray-700 border-gray-500 text-indigo-500 focus:ring-0">
                            <div class="flex-grow">
                                <h4 class="text-sm font-bold text-gray-200">${s.name}</h4>
                                <p class="text-xs text-gray-500">${new Date(s.last_modified).toLocaleDateString()} • ${charCount} Chars</p>
                            </div>
                        </div>
                    `;
                }).join('');

                const modalHTML = DOM.html`
                    <div id="add-to-folder-modal" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onclick="if(event.target.id === 'add-to-folder-modal') this.remove()">
                        <div class="bg-gray-800 rounded-lg shadow-xl w-[500px] max-h-[80vh] flex flex-col border border-gray-700" onclick="event.stopPropagation()">
                             <div class="p-6 border-b border-gray-700">
                                 <h3 class="text-lg font-bold text-white">Add Stories to '${folder.name}'</h3>
                                 <p class="text-xs text-gray-400 mt-1">Select stories to move into this folder.</p>
                             </div>
                             
                             <div class="flex-grow overflow-y-auto p-6 space-y-2">
                                ${stories.length ? storyListHTML : '<p class="text-gray-500 italic">No available stories to add.</p>'}
                             </div>

                             <div class="p-6 border-t border-gray-700 flex justify-end space-x-3 bg-gray-800 rounded-b-lg">
                                <button onclick="document.getElementById('add-to-folder-modal').remove()" class="px-4 py-2 text-gray-400 hover:text-white transition-colors">Cancel</button>
                                <button onclick="LibraryController.executeAddStories('${folderId}');" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold transition-colors">Add Selected</button>
                             </div>
                        </div>
                    </div>
                `;

                // Append
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = modalHTML;
                document.body.appendChild(tempDiv.firstElementChild);
            },

            /**
             * Executes the addition of selected stories to a folder.
             * @param {string} folderId 
             */
            async executeAddStories(folderId) {
                const modal = document.getElementById('add-to-folder-modal');
                if (!modal) return;

                const checked = modal.querySelectorAll('.story-select-check:checked');
                const storyIds = Array.from(checked).map(cb => cb.value);

                if (storyIds.length === 0) {
                    modal.remove();
                    return;
                }

                try {
                    // Update all stories
                    await Promise.all(storyIds.map(async (id) => {
                        await this.toggleStoryInFolder(id, folderId); // This logic handles "remove if present, add if not". We know they are NOT present.
                    }));

                    modal.remove();
                    UIManager.renderLibraryInterface();

                } catch (e) {
                    console.error("Failed to batch add stories:", e);
                    alert("Failed to add stories.");
                }
            },

            // === STORY ARCHITECT ===

            // --- Drag and Drop Logic ---

            /**
             * Handles the start of a drag operation for a story.
             * @param {Event} e 
             * @param {string} storyId 
             */
            handleStoryDragStart(e, storyId) {
                e.dataTransfer.setData("text/plain", storyId);
                e.dataTransfer.effectAllowed = "move";
                // Add a visual class to the dragged element if needed
            },

            /**
             * Handles dragging over a folder (allows dropping).
             * @param {Event} e 
             */
            handleStoryDragOver(e) {
                e.preventDefault(); // Necessary to allow dropping
                e.dataTransfer.dropEffect = "move";
                e.currentTarget.classList.add('bg-indigo-900/50', 'border-indigo-500'); // Visual feedback
            },

            /**
            * Handles dragging leaving a folder.
            * @param {Event} e 
            */
            handleStoryDragLeave(e) {
                e.currentTarget.classList.remove('bg-indigo-900/50', 'border-indigo-500');
            },

            /**
             * Handles dropping a story into a folder.
             * @param {Event} e 
             * @param {string} targetFolderId 
             */
            async handleStoryDrop(e, targetFolderId) {
                e.preventDefault();
                e.currentTarget.classList.remove('bg-indigo-900/50', 'border-indigo-500');
                const storyId = e.dataTransfer.getData("text/plain");

                if (storyId) {
                    await this.addStoryToFolder(storyId, targetFolderId);
                }
            },

            // --- Mobile Touch Drag Logic (Long Press) ---

            RUNTIME_DRAG: {
                timer: null,
                activeStoryId: null,
                touchStartX: 0,
                touchStartY: 0,
                isDragging: false,
                ghostEl: null
            },

            handleStoryTouchStart(e, storyId) {
                const touch = e.touches[0];
                this.RUNTIME_DRAG.touchStartX = touch.clientX;
                this.RUNTIME_DRAG.touchStartY = touch.clientY;
                this.RUNTIME_DRAG.activeStoryId = storyId;

                // Long press to start drag
                this.RUNTIME_DRAG.timer = setTimeout(() => {
                    this.RUNTIME_DRAG.isDragging = true;
                    // Haptic feedback
                    if (navigator.vibrate) navigator.vibrate(50);

                    // Visual feedback on the element
                    e.currentTarget.classList.add('opacity-50', 'scale-95');

                    // Create Ghost Element
                    const ghost = e.currentTarget.cloneNode(true);
                    ghost.style.position = 'fixed';
                    ghost.style.width = `${e.currentTarget.offsetWidth}px`;
                    ghost.style.left = `${touch.clientX}px`;
                    ghost.style.top = `${touch.clientY}px`;
                    ghost.style.opacity = '0.8';
                    ghost.style.pointerEvents = 'none'; // Click through
                    ghost.style.zIndex = '1000';
                    document.body.appendChild(ghost);
                    this.RUNTIME_DRAG.ghostEl = ghost;

                }, 500); // 500ms long press
            },

            handleStoryTouchMove(e) {
                if (!this.RUNTIME_DRAG.isDragging) {
                    // Cancel if moved too much before longpress triggers
                    const touch = e.touches[0];
                    const moveX = Math.abs(touch.clientX - this.RUNTIME_DRAG.touchStartX);
                    const moveY = Math.abs(touch.clientY - this.RUNTIME_DRAG.touchStartY);
                    if (moveX > 10 || moveY > 10) {
                        clearTimeout(this.RUNTIME_DRAG.timer);
                    }
                    return;
                }

                e.preventDefault(); // Prevent scrolling
                const touch = e.touches[0];
                if (this.RUNTIME_DRAG.ghostEl) {
                    this.RUNTIME_DRAG.ghostEl.style.left = `${touch.clientX}px`;
                    this.RUNTIME_DRAG.ghostEl.style.top = `${touch.clientY}px`;
                }

                // Highlight drop targets
                const elements = document.elementsFromPoint(touch.clientX, touch.clientY);
                const folderEl = elements.find(el => el.getAttribute('data-folder-id'));

                // Clear previous highlights
                document.querySelectorAll('.folder-drag-active').forEach(el => {
                    el.classList.remove('bg-indigo-900/50', 'border-indigo-500', 'folder-drag-active');
                });

                if (folderEl) {
                    folderEl.classList.add('bg-indigo-900/50', 'border-indigo-500', 'folder-drag-active');
                }
            },

            async handleStoryTouchEnd(e) {
                clearTimeout(this.RUNTIME_DRAG.timer);

                // Cleanup Visuals
                if (this.RUNTIME_DRAG.ghostEl) {
                    this.RUNTIME_DRAG.ghostEl.remove();
                    this.RUNTIME_DRAG.ghostEl = null;
                }
                const draggedEl = document.querySelector('.opacity-50.scale-95');
                if (draggedEl) draggedEl.classList.remove('opacity-50', 'scale-95');

                if (this.RUNTIME_DRAG.isDragging) {
                    // Check drop target
                    const touch = e.changedTouches[0];
                    const elements = document.elementsFromPoint(touch.clientX, touch.clientY);
                    const folderEl = elements.find(el => el.getAttribute('data-folder-id'));

                    if (folderEl) {
                        const targetFolderId = folderEl.getAttribute('data-folder-id');
                        await this.addStoryToFolder(this.RUNTIME_DRAG.activeStoryId, targetFolderId);
                        // Visual success feedback could go here
                        if (navigator.vibrate) navigator.vibrate(100);
                    }
                }

                // Reset
                this.RUNTIME_DRAG.isDragging = false;
                this.RUNTIME_DRAG.activeStoryId = null;
                document.querySelectorAll('.folder-drag-active').forEach(el => {
                    el.classList.remove('bg-indigo-900/50', 'border-indigo-500', 'folder-drag-active');
                });
            },

            RUNTIME_GEN: {
                draftStory: null,
                userPrompt: "",
                conceptData: null,
                mode: 'new', // 'new' or 'in-story'
                targetStoryId: null
            },

            /**
             * Phase 1 of Story Architect: Generates the initial story concept from a user prompt.
             * @param {Event} event - The click event from the Generate button.
             */
            async generateStoryPhase1(event) {
                const input = document.getElementById('gen-story-prompt');
                const userPrompt = input.value.trim();
                if (!userPrompt) { alert("Please enter a prompt."); return; }

                let promptToUse = userPrompt;

                // INJECT CONTEXT (In-Story Mode)
                if (this.RUNTIME_GEN.mode === 'in-story' && this.RUNTIME_GEN.targetStoryId) {
                    try {
                        const story = await DBService.getStory(this.RUNTIME_GEN.targetStoryId);
                        if (story) {
                            const charNames = (story.characters || []).map(c => c.name).join(', ');
                            const loreTitles = (story.static_entries || []).map(e => e.title).join(', ');

                            const context = `[CONTEXT: Generating a new scenario for existing story "${story.name}". \nSummary: ${story.creator_notes || "N/A"}\nExisting Characters: ${charNames}\nExisting Lore: ${loreTitles}]\n\nREQUEST: `;

                            promptToUse = context + userPrompt;
                        }
                    } catch (e) {
                        console.warn("Could not load context for in-story generation", e);
                    }
                }

                // 1. VISUAL FEEDBACK: Disable Button
                let btn = null;
                if (event && event.target) {
                    btn = event.target.closest('button');
                    if (btn) {
                        btn.disabled = true;
                        btn.innerHTML = `<svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Drafting...`;
                    }
                }

                // Reset UI
                document.getElementById('gen-story-input-view').classList.add('hidden');
                document.getElementById('gen-story-progress-view').classList.remove('hidden');
                document.getElementById('gen-story-progress-view').classList.add('flex');

                const updateUI = (pct, msg) => {
                    document.getElementById('gen-story-bar').style.width = `${pct}%`;
                    document.getElementById('gen-story-status').textContent = msg;
                };

                try {
                    // STEP 1: CONCEPT AGENT
                    let conceptData;
                    if (this.RUNTIME_GEN.mode === 'in-story' && this.RUNTIME_GEN.targetStoryId) {
                        const story = await DBService.getStory(this.RUNTIME_GEN.targetStoryId);
                        conceptData = await InStoryGenerationPipeline.runScenarioConceptPhase(userPrompt, story, updateUI);
                    } else {
                        conceptData = await StoryGenerationPipeline.runConceptPhase(promptToUse, updateUI);
                    }

                    this.RUNTIME_GEN.conceptData = conceptData;

                    // Switch to Edit/Approval View
                    document.getElementById('gen-story-progress-view').classList.remove('flex');
                    document.getElementById('gen-story-progress-view').classList.add('hidden');
                    document.getElementById('gen-story-approval-view').classList.remove('hidden');
                    document.getElementById('gen-story-approval-view').classList.add('flex');

                    // Populate Inputs for Editing
                    document.getElementById('gen-approval-title-input').value = conceptData.title;
                    document.getElementById('gen-approval-summary-input').value = conceptData.creator_notes; // Using creator_notes as summary for display
                    document.getElementById('gen-approval-tags-input').value = (conceptData.tags || []).join(', ');

                } catch (e) {
                    alert("Generation Error: " + e.message);
                    this.retryGenStory();
                }
            },

            /**
             * Resets the UI to the input phase for regenerating a story concept.
             */
            retryGenStory() {
                this.RUNTIME_GEN.draftStory = null;
                this.RUNTIME_GEN.busy = false;
                document.getElementById('gen-story-approval-view').classList.add('hidden');
                document.getElementById('gen-story-approval-view').classList.remove('flex');
                document.getElementById('gen-story-progress-view').classList.add('hidden');
                document.getElementById('gen-story-progress-view').classList.remove('flex');
                document.getElementById('gen-story-input-view').classList.remove('hidden');
                // Re-enable the Phase 1 draft button and restore its label.
                const phase1Btn = document.querySelector('[data-action="gen-story-phase-1"]');
                if (phase1Btn) {
                    phase1Btn.disabled = false;
                    phase1Btn.innerHTML = 'Draft Concept';
                }
            },

            /**
             * Confirms the generated story concept and proceeds to generate lore, characters, and scenario.
             * This is the "Phase 2" of the Story Architect flow.
             */
            async confirmGenStory() {
                // Re-entrancy guard: ignore double-clicks while a generation pass is in flight.
                if (this.RUNTIME_GEN && this.RUNTIME_GEN.busy) return;
                if (!this.RUNTIME_GEN) this.RUNTIME_GEN = {};
                this.RUNTIME_GEN.busy = true;

                // Read Edited Values
                const title = document.getElementById('gen-approval-title-input').value;
                const summary = document.getElementById('gen-approval-summary-input').value;
                const tagsStr = document.getElementById('gen-approval-tags-input').value;
                const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
                const shouldGenerateMap = document.getElementById('gen-approval-map-toggle').checked;
                const shouldGenerateBg = document.getElementById('gen-approval-bg-toggle')?.checked ?? true;

                // UI Switch
                document.getElementById('gen-story-approval-view').classList.remove('flex');
                document.getElementById('gen-story-approval-view').classList.add('hidden');
                document.getElementById('gen-story-progress-view').classList.remove('hidden');
                document.getElementById('gen-story-progress-view').classList.add('flex');

                const updateUI = (pct, msg) => {
                    document.getElementById('gen-story-bar').style.width = `${pct}%`;
                    document.getElementById('gen-story-status').textContent = msg;
                };

                // BRANCH: In-Story Generation
                if (this.RUNTIME_GEN.mode === 'in-story' && this.RUNTIME_GEN.targetStoryId) {
                    try {
                        const story = await DBService.getStory(this.RUNTIME_GEN.targetStoryId);
                        if (!story) throw new Error("Target story not found.");

                        const concept = this.RUNTIME_GEN.conceptData;
                        const contextSummary = `Title: ${title}\nSummary: ${summary}\nCore Conflict: ${concept.brief_summary}`;

                        // We create a temp draft object just to hold the new generated assets
                        // We initialize it with existing story data to help the AI maintain consistency?
                        // Actually, the pipeline doesn't read the draft, it writes to it. 
                        // But Casting Phase MIGHT benefit from knowing existing characters.
                        // For now, we'll let it generate fresh, and we merge. 

                        const draftDiff = {
                            characters: [], static_entries: [], narratives: [], scenarios: [], dynamic_entries: []
                        };

                        // PHASE 2: WORLD (Differential)
                        await InStoryGenerationPipeline.runWorldPhase(draftDiff, concept, story, updateUI);
                        // Save checkpoint for lore
                        draftDiff.static_entries.forEach(entry => {
                            if (!story.static_entries.some(e => e.id === entry.id)) {
                                story.static_entries.push(entry);
                            }
                        });
                        try {
                            await DBService.saveStory(story);
                        } catch (saveErr) {
                            console.warn("[Architect] Save checkpoint failed:", saveErr);
                        }

                        // PHASE 3: CASTING (Differential)
                        // Returns active IDs (New + Existing) and relationship context
                        const { relationshipContext, activeIds } = await InStoryGenerationPipeline.runCastingPhase(draftDiff, concept, story, updateUI);

                        // PHASE 4: DIRECTOR
                        const { firstMsg, scenarioLore, speakerChar } = await InStoryGenerationPipeline.runDirectorPhase(draftDiff, concept, relationshipContext, story, activeIds, updateUI);

                        // MERGE
                        updateUI(90, "Merging timelines...");

                        // 1. Add NEW Characters only
                        draftDiff.characters.forEach(char => {
                            if (!story.characters.some(c => c.id === char.id)) {
                                story.characters.push(char);
                            }
                        });

                        // 2. Add NEW Lore only
                        draftDiff.static_entries.forEach(entry => {
                            if (!story.static_entries.some(e => e.id === entry.id)) {
                                story.static_entries.push(entry);
                            }
                        });

                        // 3. Create Scenario
                        // Scenario should capture the state of the story *at this moment*, including the new lore and active characters.
                        let originalWorldMap = story.scenarios[0]?.worldMap || story.narratives[0]?.state?.worldMap;
                        let resolvedWorldMap;
                        if (originalWorldMap) {
                            try {
                                resolvedWorldMap = JSON.parse(JSON.stringify(originalWorldMap));
                            } catch (e) {
                                console.warn("Failed to parse existing worldMap, creating default:", e);
                            }
                        }
                        if (!resolvedWorldMap || !resolvedWorldMap.grid) {
                            resolvedWorldMap = {
                                grid: UTILITY.createDefaultMapGrid(),
                                currentLocation: { x: 4, y: 4 },
                                destination: { x: null, y: null },
                                path: []
                            };
                        }

                        const newScenario = {
                            id: UTILITY.uuid(),
                            name: title || concept.scenario_name,
                            message: firstMsg,
                            active_character_ids: activeIds, // Valid mixed list
                            static_entries: [...story.static_entries], // Snapshot ALL lore (Old + New)
                            dynamic_entries: [...story.dynamic_entries],
                            worldMap: resolvedWorldMap
                        };

                        story.scenarios.push(newScenario);
                        story.last_modified = new Date().toISOString();

                        // 4. Create Narrative (Jumpstart)
                        const newNarrative = {
                            id: UTILITY.uuid(), name: `${newScenario.name}`,
                            last_modified: new Date().toISOString(),
                            active_character_ids: newScenario.active_character_ids,
                            state: {
                                chat_history: [], messageCounter: 1,
                                static_entries: [...newScenario.static_entries],
                                worldMap: newScenario.worldMap || {}
                            }
                        };

                        // Ensure speakerChar is in the roster.
                        newNarrative.state.chat_history.push({
                            character_id: speakerChar.id,
                            content: firstMsg,
                            type: 'chat',
                            emotion: 'neutral',
                            timestamp: new Date().toISOString()
                        });

                        story.narratives.push({ id: newNarrative.id, name: newNarrative.name, last_modified: newNarrative.last_modified });

                        const storySaved = await DBService.saveStory(story);
                        const narrativeSaved = await DBService.saveNarrative(newNarrative);
                        if (!storySaved || !narrativeSaved) {
                            throw new Error("Failed to persist scenario to local database (disk full or quota exceeded?).");
                        }

                        // Handle Image Imports (The Pipeline generates Blob URLs, but we need to persist them)
                        // The Pipeline `runCastingPhase` assigns `image_url` as Blob URL or internal ID.
                        // We need to save these blobs to DB.
                        // Currently Pipeline does `DBService.saveImage`. Let's assume it does. 
                        // (Checking Pipeline code would confirm, but usually it does).

                        updateUI(100, "Done!");

                        // Reload Strategy
                        StateManager.getLibrary().active_story_id = story.id;
                        StateManager.getLibrary().active_narrative_id = newNarrative.id;
                        StateManager.saveLibrary();

                        AppController.closeModal('gen-story-modal');
                        window.location.reload();

                        return;

                    } catch (e) {
                        console.error(e);
                        alert("In-Story Generation Failed: " + e.message);
                        this.retryGenStory();
                        return;
                    }
                }

                // EXISTING LOGIC (New Story)
                const draft = {
                    id: UTILITY.uuid(), created_date: new Date().toISOString(), last_modified: new Date().toISOString(),
                    ...UTILITY.getDefaultApiSettings(), ...UTILITY.getDefaultUiSettings(),
                    ...UTILITY.getDefaultSystemPrompts(), ...UTILITY.getDefaultStorySettings(),
                    characters: [], static_entries: [], narratives: [], scenarios: [], dynamic_entries: [],
                    name: title, creator_notes: summary, tags: tags, backgroundImageURL: ""
                };

                const concept = this.RUNTIME_GEN.conceptData;
                // Update concept summary with user edits
                const contextSummary = `Title: ${title}\nSummary: ${summary}\nCore Conflict: ${concept.brief_summary}`;

                try {
                    // Checkpoint: Save initial draft to DB and in-memory library so it's preserved
                    await DBService.saveStory(draft);
                    if (!StateManager.getLibrary().stories.some(s => s.id === draft.id)) {
                        StateManager.getLibrary().stories.push(draft);
                    }
                    await LibraryController.updateSearchIndex(draft);
                    StateManager.updateTagCache();

                    // PIPELINE EXECUTION (OPTIMIZED PARALLEL FLOW)

                    // PHASE 2: WORLD (Sequential - provides context for everything else)
                    await StoryGenerationPipeline.runWorldPhase(draft, concept, updateUI);
                    // Checkpoint: Save draft after world phase
                    await DBService.saveStory(draft);

                    // PARALLEL BLOCK: CASTING + DIRECTOR vs MAP GENERATION
                    updateUI(40, "Sculpting characters and mapping the world...");

                    // 1. Start Map Generation (Async)
                    const mapPromise = (async () => {
                        if (shouldGenerateMap) {
                            try {
                                const loreDetails = draft.static_entries.map(e => `${e.title}: ${e.content}`).join('\n');
                                const mapContext = {
                                    characters: (concept.characters || []).map(c => c.name).join(', '),
                                    static_lore: `${contextSummary}\nKey worldbuilding to respond to and expand upon with locations that are authentic and logical within the story framework and scale. Provide a physical description of the location, along with any importance within the environment or scenario:\n${loreDetails}`,
                                    recent_events: concept.brief_summary // Using brief summary since Director hasn't run yet
                                };
                                return await WorldController.generateMapGrid(mapContext);
                            } catch (e) {
                                console.warn("Map Gen Failed, using default", e);
                                return UTILITY.createDefaultMapGrid();
                            }
                        }
                        return UTILITY.createDefaultMapGrid();
                    })();

                    // 2. Run Casting and Director (Sequential to each other, but parallel to Map)
                    const castingAndDirectorPromise = (async () => {
                        // PHASE 3: CASTING
                        const relationshipContext = await StoryGenerationPipeline.runCastingPhase(draft, concept, updateUI);
                        // PHASE 4: DIRECTOR
                        return await StoryGenerationPipeline.runDirectorPhase(draft, concept, relationshipContext, updateUI);
                    })();

                    // Wait for both "tracks" to finish
                    const [grid, directorResults] = await Promise.all([mapPromise, castingAndDirectorPromise]);
                    const { firstMsg, scenarioLore, speakerChar } = directorResults;

                    // STEP 5.5: BACKGROUND IMAGE GENERATION
                    // Builds a cinematic scene prompt from the story concept and generates a background image.
                    // This step is optional (controlled by the approval toggle) and never blocks the story save.
                    if (shouldGenerateBg) {
                        try {
                            updateUI(95, "Painting the world...");

                            // Determine the starting location name for the prompt
                            const startLocName = grid.find(l => l.coords.x === 4 && l.coords.y === 4)?.name || concept.scenario_name || 'the starting area';
                            const startLocDesc = grid.find(l => l.coords.x === 4 && l.coords.y === 4)?.prompt || grid.find(l => l.coords.x === 4 && l.coords.y === 4)?.description || '';

                            // Ask the LLM to write a rich image prompt focused on the environment/atmosphere
                            const bgPromptRequest = `You are a cinematic art director. Given this story concept, write a single, vivid, detailed image generation prompt for a BACKGROUND SCENE — focusing solely on the environment, atmosphere, and mood. No characters or people. Output ONLY the raw image description (no labels, no JSON).

TITLE: ${title}
GENRE/TAGS: ${tags.join(', ')}
SETTING SUMMARY: ${summary.substring(0, 400)}
STARTING LOCATION: ${startLocName}${startLocDesc ? ' — ' + startLocDesc.substring(0, 200) : ''}
OPENING SCENE: ${firstMsg.substring(0, 200)}`;

                            const rawBgPrompt = await APIService.callAI(bgPromptRequest);
                            const bgImagePrompt = (rawBgPrompt || '').trim();

                            if (bgImagePrompt) {
                                const bgNegativePrompt = 'people, characters, faces, persons, figure, text, watermark, low quality, blurry, distorted, duplicate';

                                // Generate at landscape aspect ratio if possible; fall back to global settings
                                const globalSettings = StateManager.data.globalSettings;
                                const bgOptions = {
                                    width: globalSettings.imageGenWidth || 768,
                                    height: Math.round((globalSettings.imageGenHeight || 512) * 0.65) || 512
                                };

                                const bgBlob = await ImageGenerationService.generateImage(bgImagePrompt, bgNegativePrompt, bgOptions);

                                if (bgBlob) {
                                    // Key must match what `app.init()` hydrates: `bg_${storyId}`
                                    const bgKey = `bg_${draft.id}`;
                                    await DBService.saveImage(bgKey, bgBlob);
                                    // Set the story background to the IDB reference key
                                    draft.backgroundImageURL = `local_idb_${bgKey}`;
                                    console.log('Story Architect: Background image saved as', bgKey);
                                }
                            }
                        } catch (bgErr) {
                            // Non-fatal: log but do not abort story creation
                            console.warn('Story Architect: Background image generation skipped.', bgErr);
                        }
                    }

                    // FINAL SAVE
                    updateUI(100, "Finalizing...");
                    const newScenario = {
                        id: UTILITY.uuid(), name: concept.scenario_name || "The Beginning", message: firstMsg,
                        active_character_ids: draft.characters.map(c => c.id),
                        static_entries: JSON.parse(JSON.stringify(draft.static_entries)), dynamic_entries: [], example_dialogue: [],
                        worldMap: { grid: grid, currentLocation: { x: 4, y: 4 }, destination: { x: null, y: null }, path: [] },
                        prompts: UTILITY.getDefaultSystemPrompts()
                    };
                    draft.scenarios.push(newScenario);

                    const newNarrative = {
                        id: UTILITY.uuid(), name: `${newScenario.name} - Chat`,
                        last_modified: new Date().toISOString(),
                        active_character_ids: draft.characters.map(c => c.id),
                        state: {
                            chat_history: [], messageCounter: 1,
                            static_entries: JSON.parse(JSON.stringify(newScenario.static_entries)),
                            worldMap: JSON.parse(JSON.stringify(newScenario.worldMap))
                        }
                    };

                    // Assign the message logic
                    newNarrative.state.chat_history.push({
                        character_id: speakerChar.id,
                        content: firstMsg,
                        type: 'chat',
                        emotion: 'neutral',
                        timestamp: new Date().toISOString()
                    });

                    draft.narratives.push({ id: newNarrative.id, name: newNarrative.name, last_modified: newNarrative.last_modified });

                    const storySaved = await DBService.saveStory(draft);
                    const narrativeSaved = await DBService.saveNarrative(newNarrative);
                    if (!storySaved || !narrativeSaved) {
                        throw new Error("Failed to persist generated story to local database (disk full or quota exceeded?).");
                    }

                    if (!StateManager.getLibrary().stories.some(s => s.id === draft.id)) {
                        StateManager.getLibrary().stories.push(draft);
                    }
                    await LibraryController.updateSearchIndex(draft);
                    StateManager.updateTagCache();

                    // Auto Load
                    StateManager.getLibrary().active_story_id = draft.id;
                    StateManager.getLibrary().active_narrative_id = newNarrative.id;
                    StateManager.saveLibrary();

                    AppController.closeModal('gen-story-modal');
                    window.location.reload();


                } catch (e) {
                    console.error(e);
                    alert("Generation Error: " + e.message);
                    this.retryGenStory();
                }
            },

            /**
             * Helper: Calls the AI service with automatic retries for JSON parsing.
             * @param {string} prompt - The prompt to send.
             * @param {number} [retries=2] - Number of retry attempts.
             * @returns {Promise<Object|null>} - The parsed JSON response or null on failure.
             */
            async _callAIWithRetry(prompt, retries = 2) {
                for (let i = 0; i <= retries; i++) {
                    try {
                        const res = await APIService.callAI(prompt, true);
                        const json = UTILITY.extractAndParseJSON(res);
                        if (json) return json;
                        throw new Error("Invalid JSON");
                    } catch (e) {
                        if (i === retries) return null;
                    }
                }
            },

            // --- Import / Export & File Handling ---

            /**
             * Handles the upload of a single story file (JSON, PNG, BYAF, ZIP).
             * Parses the file and imports it into the library.
             * @param {Event} event - The file input change event.
             */
            async handleFileUpload(event) {
                const file = event.target.files[0];
                if (!file) return;
                UIManager.showLoadingSpinner('Parsing file...');
                try {
                    // Accept backgroundImageBlob from the parser
                    const { story: newStory, imageBlob, backgroundImageBlob } = await ImportExportService.parseUploadedFile(file);
                    const library = StateManager.getLibrary();

                    // Duplicate Name Check
                    const existingStory = library.stories.find(s => s.name && newStory.name && s.name.toLowerCase() === newStory.name.toLowerCase());
                    if (existingStory) {
                        const now = new Date();
                        // Simple timestamp
                        newStory.name = `${newStory.name} - ${Date.now()}`;
                    }

                    // Separating Narratives from the Story Object
                    const narratives = newStory.narratives || [];
                    const narrativeStubs = narratives.map(n => ({ id: n.id, name: n.name, last_modified: n.last_modified }));
                    newStory.narratives = narrativeStubs;

                    // 1. Save Story to DB
                    await DBService.saveStory(newStory);

                    // 2. Save Narratives to DB (Sequentially for memory safety)
                    if (narratives.length > 0) {
                        for (const n of narratives) {
                            await DBService.saveNarrative(n);
                        }
                    }

                    // 3. Update In-Memory Library
                    library.stories.push(newStory);

                    // 4. Save Primary Image to DB
                    const primaryAiChar = newStory.characters?.find(c => !c.is_user);
                    if (imageBlob && primaryAiChar && primaryAiChar.id) {
                        await DBService.saveImage(primaryAiChar.id, imageBlob);

                        // Update Cache
                        UIManager.RUNTIME.characterImageCache = UIManager.RUNTIME.characterImageCache || {};
                        if (UIManager.RUNTIME.characterImageCache[primaryAiChar.id]) URL.revokeObjectURL(UIManager.RUNTIME.characterImageCache[primaryAiChar.id]);
                        UIManager.RUNTIME.characterImageCache[primaryAiChar.id] = URL.createObjectURL(imageBlob);
                    }

                    // Save Background Image if the parser found one (BYAF or JSON)
                    if (backgroundImageBlob) {
                        const bgKey = `bg_${newStory.id}`;
                        await DBService.saveImage(bgKey, backgroundImageBlob);

                        // Update the story setting to use local background
                        newStory.backgroundImageURL = 'local_idb_background';
                        await DBService.saveStory(newStory);
                    }

                    await this.updateSearchIndex(newStory);
                    StateManager.updateTagCache();
                    StateManager.saveLibrary();
                    UIManager.hideLoadingSpinner();
                    alert(`Story "${newStory.name}" imported successfully!`);
                    UIManager.renderLibraryInterface();
                    AppController.closeModal('io-hub-modal');

                } catch (err) {
                    UIManager.hideLoadingSpinner();
                    alert(`Error importing file: ${err.message}`);
                } finally {
                    event.target.value = '';
                }
            },

            /**
             * Handles the bulk import of multiple story files from a directory.
             * Uses the File System Access API to read a directory.
             */
            async handleBulkImport() {
                if (!window.showDirectoryPicker) {
                    alert("Your browser does not support directory selection.");
                    return;
                }
                try {
                    const dirHandle = await window.showDirectoryPicker();
                    UIManager.showLoadingSpinner('Starting bulk import...');

                    let processedFiles = 0;
                    const failedFiles = [];
                    const importedStoryNames = [];
                    const library = StateManager.getLibrary();

                    for await (const entry of dirHandle.values()) {
                        if (entry.kind !== 'file' || !entry.name) continue;
                        const lowerCaseName = entry.name.toLowerCase();

                        if (lowerCaseName.endsWith('.png') || lowerCaseName.endsWith('.byaf') || lowerCaseName.endsWith('.zip') || lowerCaseName.endsWith('.json')) {
                            UIManager.showLoadingSpinner(`Processing file ${++processedFiles}: ${entry.name}`);
                            try {
                                const file = await entry.getFile();

                                // 1. Parse the file into memory
                                const { story: newStory, imageBlob } = await ImportExportService.parseUploadedFile(file, false);

                                if (!newStory || !newStory.name) throw new Error("Invalid parsed story data.");

                                // 2. Handle Duplicate Names
                                const existingStory = library.stories.find(s => s.name && s.name.toLowerCase() === newStory.name.toLowerCase());
                                if (existingStory) {
                                    newStory.name = `${newStory.name} - ${Date.now()}`;
                                }

                                // 3. Separate heavy narrative data from the story object
                                // We must separate the heavy narrative data from the story object to ensure the story object remains lightweight.
                                const narratives = newStory.narratives || [];
                                const narrativeStubs = narratives.map(n => ({
                                    id: n.id,
                                    name: n.name,
                                    last_modified: n.last_modified
                                }));

                                // Replace full narratives with stubs in the story object
                                newStory.narratives = narrativeStubs;

                                // Save the Story to DB
                                await DBService.saveStory(newStory);

                                // Save all Narratives to DB
                                for (const narrative of narratives) {
                                    await DBService.saveNarrative(narrative);
                                }

                                // 4. Save Image to DB
                                const primaryAiChar = newStory.characters?.find(c => !c.is_user);
                                if (imageBlob && primaryAiChar) {
                                    await DBService.saveImage(primaryAiChar.id, imageBlob);

                                    // Update cache immediately so it shows in UI
                                    UIManager.RUNTIME.characterImageCache = UIManager.RUNTIME.characterImageCache || {};
                                    if (UIManager.RUNTIME.characterImageCache[primaryAiChar.id]) {
                                        URL.revokeObjectURL(UIManager.RUNTIME.characterImageCache[primaryAiChar.id]);
                                    }
                                    UIManager.RUNTIME.characterImageCache[primaryAiChar.id] = URL.createObjectURL(imageBlob);
                                }

                                // 5. Update In-Memory Library (UI)
                                library.stories.push(newStory);
                                await this.updateSearchIndex(newStory);
                                importedStoryNames.push(newStory.name);

                            } catch (err) {
                                console.error(`Failed to import ${entry.name}`, err);
                                failedFiles.push({ name: entry.name, reason: err.message || 'Unknown error' });
                            }
                        }
                    }

                    StateManager.updateTagCache();
                    // Save the library list order/meta-data
                    StateManager.saveLibrary();

                    UIManager.hideLoadingSpinner();
                    UIManager.showBulkImportReport(importedStoryNames, failedFiles);
                    UIManager.renderLibraryInterface();

                } catch (err) {
                    UIManager.hideLoadingSpinner();
                    if (err.name !== 'AbortError') alert(`Bulk import error: ${err.message}`);
                }
            },

            /**
             * Imports a full library backup from a ZIP file.
             * Replaces the current library with the imported one.
             * @param {Event} event - The file input change event.
             */
            async importLibrary(event) {
                const file = event.target.files[0];
                if (!file) return;
                event.target.value = ''; // Reset

                try {
                    const proceed = await UIManager.showConfirmationPromise('WARNING: This will permanently replace your entire story library. Are you sure?');
                    if (proceed) {
                        // Prevent ReactiveStore from saving the *old* state during the unload/reload cycle.
                        // If we don't do this, the 'beforeunload' event will trigger forceSave(), which will 
                        // write the old in-memory state back to the DB, corrupting the fresh import.
                        if (typeof ReactiveStore !== 'undefined') {
                            ReactiveStore.blockAutoSave();
                        }

                        // Clear in-memory references to prevent any accidental UI reads/writes during the process
                        StateManager.data.library.stories = [];
                        StateManager.data.activeNarrativeState = {};

                        UIManager.showLoadingSpinner('Importing library... Do not close this tab.');

                        await StoryService.importLibraryFromZip(file);

                        UIManager.hideLoadingSpinner();
                        alert("Library imported successfully! Reloading...");
                        setTimeout(() => window.location.reload(), 500);
                    }
                } catch (err) {
                    UIManager.hideLoadingSpinner();
                    console.error("Import failed:", err);
                    alert(`Error importing library: ${err.message}`);
                }
            },

            /**
             * Exports the entire library as a ZIP file.
             */
            async exportLibrary() {
                UIManager.showLoadingSpinner('Exporting entire library...');
                try {
                    const result = await StoryService.exportLibraryAsZip();
                    // Handle legacy return (blob only) vs new object return
                    const zipBlob = result.blob || result;
                    const report = result.report || { success: true, errors: [] };

                    const url = URL.createObjectURL(zipBlob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `ellipsis_library_backup_${new Date().toISOString().split('T')[0]}.zip`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    if (report.errors && report.errors.length > 0) {
                        const errorMsg = report.errors.map(e => `• ${e.key}: ${e.error}`).join('\n');
                        alert(`⚠️ Export Partial Success\n\nThe backup was created, BUT ${report.errors.length} files failed to be included:\n\n${errorMsg}\n\nPlease check your Console for details.`);
                        console.error("Export Failures:", report.errors);
                    }
                } catch (e) {
                    alert(`Library export failed: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Exports the current story in the specified format (JSON, PNG, BYAF).
             * @param {string} format - The format to export as ('json', 'png', 'byaf').
             */
            /**
             * Exports the current story in the specified format (JSON, PNG, BYAF).
             * @param {string} format - The format to export as ('json', 'png', 'byaf').
             */
            async exportStoryAs(format) {
                const library = StateManager.getLibrary();
                const storyId = library.active_story_id;
                const narrativeId = library.active_narrative_id;

                if (!storyId || !narrativeId) {
                    alert("Please load a story to export.");
                    return;
                }

                if (format !== 'json' && format !== 'zip') {
                    const proceed = await UIManager.showConfirmationPromise("Exporting to a non-Rolecraft format may result in data loss. Continue?");
                    if (!proceed) return;
                }

                UIManager.showLoadingSpinner(`Exporting as ${format.toUpperCase()}...`);
                try {
                    // Fetch the FULL Story object from DB to ensure we have all characters and metadata
                    // The library stub is insufficient for export, especially for ZIPs which need image checks
                    const story = await DBService.getStory(storyId);

                    // Fetch the FULL narrative object from DB
                    const narrative = await DBService.getNarrative(narrativeId);

                    if (!story) throw new Error("Story not found in database.");
                    if (!narrative) throw new Error("Narrative data not found in database.");

                    // Default to the first non-user character (The "AI")
                    const selectorVal = document.getElementById('export-primary-character-selector')?.value;
                    const primaryCharId = selectorVal || story.characters?.find(c => !c.is_user)?.id;

                    // Ensure state exists to prevent crashes if data is malformed
                    if (!narrative.state) narrative.state = { worldMap: {}, chat_history: [], static_entries: [] };

                    if ((format === 'png' || format === 'byaf') && !primaryCharId) {
                        throw new Error("No AI character found to export.");
                    }

                    let blob, filename;
                    switch (format) {
                        case 'json':
                            // Hydrate the narrative stubs with full data
                            // The story object in memory only has stubs. We need the real data from IDB.
                            const fullNarratives = await Promise.all(
                                (story.narratives || []).map(n => DBService.getNarrative(n.id))
                            );

                            // Create a clone to avoid mutating the live object with heavy data
                            const exportObj = JSON.parse(JSON.stringify(story));
                            // Replace stubs with full objects (filtering out any nulls from DB errors)
                            exportObj.narratives = fullNarratives.filter(n => n);

                            blob = ImportExportService.exportStoryAsJSON(exportObj);
                            filename = `${story.name}.json`;
                            break;
                        case 'png':
                            blob = await ImportExportService.exportStoryAsV2(story, narrative, primaryCharId);
                            filename = `${story.name}.png`;
                            break;
                        case 'byaf':
                            blob = await ImportExportService.exportStoryAsBYAF(story, narrative, primaryCharId);
                            filename = `${story.name}.byaf`;
                            break;
                        case 'zip':
                            blob = await ImportExportService.exportStoryAsZip(story, narrative);
                            filename = `${story.name}.zip`;
                            break;
                    }

                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename.replace(/[/\\?%*:|"<>]/g, '-');
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                } catch (e) {
                    console.error(e);
                    alert(`Export failed: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            // --- Meta / AI Helpers ---

            /**
             * Generates AI notes for the story based on its content.
             * @param {Event} event - The click event.
             * @param {string} storyId - The ID of the story.
             */
            async generateStoryNotesAI(event, storyId) {
                const context = await StoryService.buildStoryContext(storyId);
                const state = StateManager.getState(); // Access prompts from active state if avail, else defaults
                const prompt = state.prompt_story_notes_gen || UTILITY.getDefaultSystemPrompts().prompt_story_notes_gen;

                const result = await this._generateContentForField(event, prompt, { context });
                if (result) {
                    this.updateStoryField(storyId, 'creator_notes', result);
                    UIManager.openStoryDetails(storyId);
                }
            },

            /**
             * Generates AI tags for the story based on its content.
             * @param {Event} event - The click event.
             * @param {string} storyId - The ID of the story.
             */
            async generateStoryTagsAI(event, storyId) {
                const context = await StoryService.buildStoryContext(storyId);
                const state = StateManager.getState();
                const prompt = state.prompt_story_tags_gen || UTILITY.getDefaultSystemPrompts().prompt_story_tags_gen;

                const result = await this._generateContentForField(event, prompt, { context });
                if (result) {
                    const newTags = result.split(',').map(t => t.trim().toLowerCase());
                    const library = StateManager.getLibrary();
                    const story = library.stories.find(s => s.id === storyId);
                    const combined = [...new Set([...(story.tags || []), ...newTags])];
                    this.updateStoryTags(storyId, combined.join(', '));
                    UIManager.openStoryDetails(storyId);
                }
            },

            // --- Global Image Handling ---

            /**
             * Handles the upload of a custom background image for the story.
             * @param {Event} event - The file input change event.
             */
            async handleBackgroundImageUpload(event) {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) { alert("Image too large (>5MB)."); return; }

                const library = StateManager.getLibrary();
                const storyId = library.active_story_id;
                if (!storyId) { alert("No active story to save background to."); return; }

                UIManager.showLoadingSpinner('Processing background...');
                try {
                    const blob = await ImageProcessor.processImageAsBlob(file);

                    // Save with Story-Specific Key (bg_UUID)
                    const key = `bg_${storyId}`;
                    const saved = await DBService.saveImage(key, blob);

                    if (!saved) throw new Error("Failed to save to database.");

                    if (UIManager.RUNTIME.globalBackgroundImageCache) URL.revokeObjectURL(UIManager.RUNTIME.globalBackgroundImageCache);
                    UIManager.RUNTIME.globalBackgroundImageCache = URL.createObjectURL(blob);

                    // Update State to use the marker
                    if (typeof ReactiveStore !== 'undefined' && ReactiveStore.state) {
                        ReactiveStore.state.backgroundImageURL = 'local_idb_background';
                        // Trigger save to persist the 'local_idb_background' setting to the story object
                        ReactiveStore.forceSave();
                    }

                    UIManager.applyStyling();

                    const bgHint = document.getElementById('background-image-hint');
                    if (bgHint) bgHint.textContent = 'Current: [Local Image]';
                } catch (e) {
                    alert(`Upload failed: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                    event.target.value = '';
                }
            },

            /**
             * Clears the custom background image for the active story.
             */
            async clearBackgroundImage() {
                const library = StateManager.getLibrary();
                const storyId = library.active_story_id;

                // Delete Story-Specific Key
                if (storyId) {
                    await DBService.deleteImage(`bg_${storyId}`);
                }

                if (UIManager.RUNTIME.globalBackgroundImageCache) URL.revokeObjectURL(UIManager.RUNTIME.globalBackgroundImageCache);
                UIManager.RUNTIME.globalBackgroundImageCache = null;

                if (typeof ReactiveStore !== 'undefined' && ReactiveStore.state) {
                    ReactiveStore.state.backgroundImageURL = '';
                    ReactiveStore.forceSave();
                }

                UIManager.applyStyling();
                const bgHint = document.getElementById('background-image-hint');
                if (bgHint) bgHint.textContent = 'Current: None';
            },

            /**
             * Shared helper for AI generation buttons
             */
            /**
             * Helper function to generate AI content for a specific field.
             * @param {Event} event - The triggering event.
             * @param {string} promptTemplate - The prompt template to use.
             * @param {Object} context - The context object for prompt replacement.
             * @returns {Promise<string|null>} - The generated content or null.
             * @private
             */
            async _generateContentForField(event, promptTemplate, context) {
                const button = event.target.closest('button');
                if (!button) return null;
                const originalContent = button.innerHTML;
                button.disabled = true;
                button.innerHTML = '...';
                try {
                    let prompt = promptTemplate;
                    for (const key in context) {
                        prompt = prompt.replace(new RegExp(`{${key}}`, 'g'), context[key]);
                    }
                    return await APIService.callAI(prompt, false);
                } catch (error) {
                    alert(`AI generation failed: ${error.message}`);
                    return null;
                } finally {
                    button.disabled = false;
                    button.innerHTML = originalContent;
                }
            },

            /**
             * Updates the search index for a story object, including narrative context.
             * @param {Object} story - The story object to update.
             */
            async updateSearchIndex(story) {
                if (!story) return;
                let index = [story.name];
                if (story.tags) index.push(...story.tags);
                if (story.creator_notes) index.push(story.creator_notes);
                if (story.characters) {
                    story.characters.forEach(char => {
                        index.push(char.name);
                        index.push(char.description);
                        if (char.tags) index.push(...char.tags);
                    });
                }
                story.search_index = index.join(' ').toLowerCase();

                // Advanced: Narrative Indexing
                // We fetch all narratives to extract their text for the search index.
                try {
                    const narrativeStubs = story.narratives || [];
                    const fullNarratives = await Promise.all(
                        narrativeStubs.map(stub => DBService.getNarrative(stub.id))
                    );
                    let chatLines = [];
                    fullNarratives.forEach(n => {
                        if (n && n.state && n.state.chat_history) {
                            n.state.chat_history.forEach(m => {
                                if (m.text) chatLines.push(m.text);
                            });
                        }
                    });
                    story.chat_index = chatLines.join(' ').toLowerCase();
                } catch (e) { console.warn("Search Index: Failed to index chat history", e); }

                // Persistence to DB Store (Stubs)
                if (story.id) await DBService.saveStory(story);
            }
        };
