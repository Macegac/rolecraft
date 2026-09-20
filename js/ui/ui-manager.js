        /**
         * =================================================================================================
         * [SEC:JS:CORE:UM]
         * UIManager
         * Central orchestration for UI updates, modal management, and chat rendering.
         * =================================================================================================
         */
        const UIManager = {
            RUNTIME: {
                streamingInterval: null,
                titleTimeout: null,
                lastCinematicImageUrl: null,
                activeCinematicBg: 1,
                globalBackgroundImageCache: null,
                characterImageCache: {},
                worldImageCache: {},
                inputHistory: [],
                inputHistoryIndex: -1,
                viewingStoryId: null, // FIX: Track currently viewed story for layout switching
                activeInventoryTab: 'inventory',
                vnHistoryIndex: null // Track currently viewed message index in Visual Novel history mode
            },

            /**
             * Switches the active tab in the Knowledge Modal.
             * @param {string} tabName - The name of the tab to switch to ('static' or 'dynamic').
             */
            switchKnowledgeTab(tabName) {
                // We can just call the render function, as it reads the active tab from the Controller/State
                if (typeof AppController !== 'undefined') AppController.activeKnowledgeTab = tabName;
                this.renderKnowledgeModalTabs();
            },

            /**
             * Toggles the Journal & Inventory panel collapsed/expanded state.
             */
            toggleInventoryPanel() {
                const state = StateManager.getState();
                if (state && state.enableJournal === false) return;
                const container = document.getElementById('inventory-panel-container');
                if (container) {
                    const wasHidden = container.classList.contains('hidden');
                    container.classList.toggle('hidden');
                    if (wasHidden) {
                        this.renderInventoryPanel();
                    }
                }
            },

            /**
             * Switches the active tab inside the Journal & Inventory panel.
             * @param {string} tab - The tab name ('inventory', 'quests', 'relationships').
             */
            switchInventoryTab(tab) {
                this.RUNTIME.activeInventoryTab = tab;
                this.renderInventoryPanel();
            },

            /**
             * Renders the Journal & Inventory panel into the DOM.
             */
            renderInventoryPanel() {
                const state = StateManager.getState();
                const container = document.getElementById('inventory-panel-container');
                if (!container) return;

                if (!state || !state.gameState || state.enableJournal === false) {
                    container.classList.add('hidden');
                    container.innerHTML = '';
                    return;
                }

                const activeTab = this.RUNTIME.activeInventoryTab || 'inventory';
                container.innerHTML = UIComponents.InventoryPanel(state.gameState, activeTab);
            },

            /**
             * Prompts the user to add a resource manually.
             */
            promptAddResource() {
                const name = prompt("Enter the item name:");
                if (!name) return;
                const valueStr = prompt("Enter initial quantity:", "1");
                if (valueStr === null) return;
                const value = parseInt(valueStr) || 1;
                InventoryController.addResource(name, value);
            },

            /**
             * Prompts the user to add a quest manually.
             */
            promptAddQuest() {
                const title = prompt("Enter quest title:");
                if (!title) return;
                const objective = prompt("Enter active objective (optional):") || '';
                InventoryController.addQuest(title, objective);
            },

            /**
             * Prompts the user to update a quest's objective manually.
             * @param {string} questId - The quest ID.
             */
            promptUpdateQuestObjective(questId) {
                const objective = prompt("Enter new objective:");
                if (objective === null) return;
                InventoryController.updateQuestObjective(questId, objective);
            },

            /**
             * Prompts the user to track a relationship manually.
             */
            promptAddRelationship() {
                const charName = prompt("Enter character name:");
                if (!charName) return;
                const track = prompt("Enter relationship track (e.g. Affection, Attraction, Trust):", "Affection");
                if (!track) return;
                const valStr = prompt("Enter starting percentage (0-100):", "50");
                if (valStr === null) return;
                const value = Math.max(0, Math.min(100, parseInt(valStr) || 50));

                // Try to find matching character ID in roster
                const characters = (ReactiveStore.state.characters || []);
                const character = characters.find(c => c.name.toLowerCase().includes(charName.toLowerCase()));
                const charId = character ? character.id : null;
                const actualName = character ? character.name : charName;

                // Add
                const state = StateManager.getState();
                if (state && state.gameState) {
                    state.gameState.relationships.push({
                        id: UTILITY.uuid(),
                        characterId: charId,
                        characterName: actualName,
                        track: track,
                        value: value
                    });
                }
            },

            /**
             * Switches the active tab in the World Map Modal.
             * @param {string} tabName - The name of the tab to switch to ('move' or 'worldmap').
             */
            switchWorldMapTab(tabName) {
                if (typeof WorldController !== 'undefined') WorldController.RUNTIME.activeWorldMapTab = tabName;
                this.renderWorldMapModal();
            },

            /**
             * Returns the SVG icon for AI generation buttons.
             * @returns {string} - The SVG HTML string.
             */
            getAIGenIcon() {
                return DOM.unsafe(`<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>`);
            },

            /**
             * Updates the vision warning visibility and text based on the current model.
             */
            updateVisionWarning() {
                const state = StateManager.getState();
                const provider = state.apiProvider;
                const model = (provider === 'gemini' ? (state.geminiModel || StateManager.data.globalSettings.geminiModel) :
                    provider === 'openrouter' ? state.openRouterModel :
                        provider === 'koboldcpp' ? 'local' :
                            provider === 'lmstudio' ? 'local' : 'unknown') || 'unknown';

                const warningBox = document.getElementById('vision-warning-box');
                const warningText = document.getElementById('vision-warning-text');

                if (!warningBox || !warningText) return;

                const supportsVision = APIService._supportsVision(provider, model);

                if (supportsVision) {
                    warningBox.classList.add('hidden');
                } else {
                    warningBox.classList.remove('hidden');
                    warningText.textContent = APIService.getVisionDirections(provider);
                }
            },

            /**
             * Checks if image generation is enabled globally.
             * @returns {boolean}
             */
            isImageGenEnabled() {
                // Safe access to StateManager
                if (typeof StateManager === 'undefined' || !StateManager.data || !StateManager.data.globalSettings) return true;
                return StateManager.data.globalSettings.imageGenBackend !== 'disabled';
            },

            /**
             * Shows the prompt modal with the given text.
             * @param {string} promptText - The prompt to display.
             */
            showPromptModal(promptText) {
                const modal = document.getElementById('prompt-modal');
                const contentEl = document.getElementById('prompt-modal-content');
                if (modal && contentEl) {
                    contentEl.textContent = promptText || "No prompt available.";
                    AppController.openModal('prompt-modal');
                }
            },

            /**
             * Opens the lightbox modal to view a chat image in full size.
             * @param {string} src - The source URL of the image.
             */
            /**
             * Opens the per-message context menu at the given viewport point.
             * Contents are built per message because image generation is conditional and
             * every entry needs the message index. Entries route through ActionHandler
             * delegation like the rest of the app rather than carrying their own listeners.
             * @param {number} index - The chat_history index of the message.
             * @param {number} clientX - Viewport X to anchor the menu to.
             * @param {number} clientY - Viewport Y to anchor the menu to.
             */
            openMessageMenu(index, clientX, clientY) {
                const menu = document.getElementById('message-context-menu');
                if (!menu) return;

                let allowImageGen = false;
                try {
                    allowImageGen = (typeof StateManager !== 'undefined' && StateManager.data
                        && StateManager.data.globalSettings
                        && StateManager.data.globalSettings.imageGenBackend !== 'disabled');
                } catch (e) { console.warn("Message Menu (Image Gen check):", e); }

                let hasThinking = false;
                try {
                    let msg = null;
                    if (typeof TextModeController !== 'undefined' && TextModeController.RUNTIME && TextModeController.RUNTIME.activeCharId) {
                        msg = TextModeController.RUNTIME.messages[index];
                    } else if (typeof NarrativeController !== 'undefined' && NarrativeController.RUNTIME) {
                        msg = NarrativeController.RUNTIME.messages[index];
                    }
                    if (msg) {
                        const curVer = msg.currentVersion || 0;
                        const thinkingText = (msg.versions && msg.versions[curVer] && msg.versions[curVer].thinking)
                            ? msg.versions[curVer].thinking
                            : (msg.thinking || '');
                        hasThinking = Boolean(thinkingText && thinkingText.trim());
                    }
                } catch (e) { console.warn("Message Menu (Thinking check):", e); }

                const icon = (d, colorClass) => `<svg class="w-4 h-4 mr-3 shrink-0 ${colorClass || ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${d}"></path></svg>`;
                const row = (action, label, path, hover, textColor, iconColor) =>
                    `<button data-action="${action}" data-index="${index}" class="w-full text-left px-4 py-2 ${hover} ${textColor || 'text-white'} text-sm transition-colors flex items-center whitespace-nowrap">${icon(path, iconColor)}${label}</button>`;

                const items = [];
                if (allowImageGen) {
                    items.push(`<button onclick="VisualMaster.triggerVisualEvent(${index}, this)" class="w-full text-left px-4 py-2 hover:bg-indigo-600/50 text-gray-300 text-sm transition-colors flex items-center whitespace-nowrap">${icon('M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z', 'text-indigo-400')}Generate Image</button>`);
                }

                if (hasThinking) {
                    items.push(row('view-message-thinking', 'View Thinking', 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z', 'hover:bg-purple-900/30', 'text-purple-300', 'text-purple-400'));
                }

                const inTextMode = typeof TextModeController !== 'undefined' && TextModeController.RUNTIME && TextModeController.RUNTIME.activeCharId;
                const history = (!inTextMode && ReactiveStore.state && ReactiveStore.state.chat_history) || [];
                const combineMsg = history[index];
                if (UTILITY.canCombineAt(history, index)) {
                    items.push(row('combine-with-previous', 'Combine with Previous', 'M4 6h16M4 12h16M9 18h6', 'hover:bg-gray-800/80', 'text-gray-300', 'text-indigo-400'));
                }
                if (combineMsg && combineMsg.combined_from) {
                    items.push(row('recombine-message', 'Combine Again', 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15', 'hover:bg-gray-800/80', 'text-gray-300', 'text-indigo-400'));
                    items.push(row('split-combined-message', 'Split Back Apart', 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4', 'hover:bg-gray-800/80', 'text-gray-300', 'text-amber-400'));
                }
                items.push(row('chat-copy', 'Copy Text', 'M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3', 'hover:bg-gray-800/80', 'text-gray-300', 'text-blue-400'));
                items.push(row('create-static-from-message', 'Create Static Memory', 'M12 6v6m0 0v6m0-6h6m-6 0H6', 'hover:bg-gray-800/80', 'text-gray-300', 'text-emerald-400'));
                items.push(row('chat-edit', 'Edit Message', 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z', 'hover:bg-gray-800/80', 'text-gray-300', 'text-gray-400'));
                items.push('<div class="my-1 border-t border-gray-700/80"></div>');
                items.push(row('confirm-delete-message', 'Delete Message', 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16', 'hover:bg-red-950/40', 'text-red-400', 'text-red-400'));

                menu.innerHTML = items.join('');
                menu.classList.remove('hidden');
                this._placeMenuAt(menu, clientX, clientY);
            },

            /**
             * Positions an already-visible menu at a viewport point, clamped to all four
             * edges. Measuring needs the menu unhidden, so this runs after showing it. The
             * older generate-context-menu clamps top-left only, which runs off the bottom
             * of a phone screen; anything opened from the composer sits down there.
             * @param {HTMLElement} menu - The menu element, already unhidden.
             * @param {number} clientX - Viewport X to anchor to.
             * @param {number} clientY - Viewport Y to anchor to.
             */
            _placeMenuAt(menu, clientX, clientY) {
                const rect = menu.getBoundingClientRect();
                const margin = 8;
                let left = clientX;
                let top = clientY;
                if (left + rect.width + margin > window.innerWidth) left = window.innerWidth - rect.width - margin;
                if (top + rect.height + margin > window.innerHeight) top = clientY - rect.height;
                if (left < margin) left = margin;
                if (top < margin) top = margin;

                menu.style.left = `${left}px`;
                menu.style.top = `${top}px`;
            },

            /**
             * Opens the image button's menu at the given viewport point. Contents are
             * static markup, so unlike the message menu there is nothing to build first.
             * @param {number} clientX - Viewport X to anchor to.
             * @param {number} clientY - Viewport Y to anchor to.
             */
            openImageMenu(clientX, clientY) {
                const menu = document.getElementById('image-context-menu');
                if (!menu) return;
                menu.classList.remove('hidden');
                this._placeMenuAt(menu, clientX, clientY);
            },

            /**
             * Hides the image button's menu if it is open.
             */
            closeImageMenu() {
                const menu = document.getElementById('image-context-menu');
                if (!menu) return;
                menu.classList.add('hidden');
            },

            /**
             * Hides the per-message context menu if it is open.
             */
            closeMessageMenu() {
                const menu = document.getElementById('message-context-menu');
                if (!menu) return;
                menu.classList.add('hidden');
                // If the long-press flag was never consumed (a browser that raises no
                // click after touchend), drop it here rather than let it swallow an
                // unrelated tap later on.
                delete menu.dataset.swallowNextClick;
            },

            viewChatImage(src, caption = null) {
                // Reuse the lightbox modal structure but override the navigation
                const imgEl = document.getElementById('lightbox-image');
                const modal = document.getElementById('lightbox-modal');
                const prevBtn = modal.querySelector('button[data-action="lightbox-prev"]');
                const nextBtn = modal.querySelector('button[data-action="lightbox-next"]');
                const capEl = document.getElementById('lightbox-caption');

                UTILITY.safeImageSet(imgEl, src);
                if (capEl) {
                    capEl.textContent = caption || "";
                    capEl.style.display = caption ? 'block' : 'none';
                }

                // Hide nav buttons since this is a single image view
                if (prevBtn) prevBtn.style.display = 'none';
                if (nextBtn) nextBtn.style.display = 'none';

                modal.classList.remove('hidden');
                modal.classList.add('flex');

                // Reset specific lightbox state so closing it works cleanly
                UIManager.RUNTIME.currentLightboxImages = [];
            },

            /**
             * Shows the confirmation modal with options for deleting a message.
             * Allows deleting a single message or all subsequent messages (forward).
             * @param {number} index - The index of the message to delete.
             */
            showDeleteMessageOptions(index) {
                const modal = document.getElementById('confirmation-modal');
                const messageEl = document.getElementById('confirmation-modal-message');
                const footerEl = modal.querySelector('.border-t'); // The footer div containing buttons

                if (!modal || !messageEl || !footerEl) return;

                messageEl.textContent = "How would you like to delete this message?";

                // FIX: Inject 3-Button Layout
                // We use flex-between and spacing to separate the destructive "Delete Forward"
                footerEl.innerHTML = `
            <div class="flex justify-between w-full items-center">
                <button onclick="AppController.closeModal('confirmation-modal')" class="bg-gray-600 hover:bg-gray-700 font-bold py-2 px-4 rounded-lg text-sm">Cancel</button>
                
                <div class="flex space-x-4">
                    <button onclick="NarrativeController.executeDelete(${index}, 'single')" class="bg-red-700 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg text-sm">Delete This One</button>
                    <button onclick="NarrativeController.executeDelete(${index}, 'forward')" class="bg-red-900 hover:bg-red-800 text-red-100 font-bold py-2 px-4 rounded-lg text-sm border border-red-500">Delete Forward &rarr;</button>
                </div>
            </div>
        `;

                AppController.openModal('confirmation-modal');
            },

            /**
             * Renders all main UI components to reflect the current state.
             * Updates characters, static entries, dynamic entries, chat, and AI selector.
             */
            renderAll() {
                const state = StateManager.getState();
                if (state && state.narrativeName) {
                    document.getElementById('story-title-input').value = state.narrativeName;
                    const mobileTitle = document.getElementById('mobile-story-title-overlay');
                    if (mobileTitle) mobileTitle.value = state.narrativeName;
                }
                this.renderCharacters();
                this.renderStaticEntries();
                this.renderDynamicEntries();
                this.renderChat();
                this.updateAICharacterSelector();
            },

            /**
             * Renders the Story Library interface with filtering, sorting, and folders.
             * @param {Object} [filterState={}] - Optional filter state overrides.
             */
            renderLibraryInterface(filterState = {}) {
                const library = StateManager.getLibrary();
                const container = document.getElementById('library-content-container');

                const searchInput = document.getElementById('lib-search');
                const sortInput = document.getElementById('lib-sort');
                const tagInput = document.getElementById('lib-tag');
                const listContainer = document.getElementById('lib-list');

                // 1. Determine Layout & Filter Values
                let { searchTerm, sortBy, filterTag, layout, folderId, viewMode } = filterState;

                // Persistence for Filter State
                if (folderId === undefined) {
                    folderId = UIManager.RUNTIME.currentLibraryFolder || null;
                } else {
                    UIManager.RUNTIME.currentLibraryFolder = folderId;
                }

                if (viewMode === undefined) {
                    // FIX: Check persisted library state first, then runtime, then default
                    viewMode = (library && library.viewMode) ? library.viewMode : (UIManager.RUNTIME.libraryViewMode || 'grid');
                    // Sync Runtime
                    UIManager.RUNTIME.libraryViewMode = viewMode;
                } else {
                    UIManager.RUNTIME.libraryViewMode = viewMode;
                    // Persist to StateManager and LocalStorage
                    if (library) {
                        library.viewMode = viewMode;
                        StateManager.saveLibrary();
                    }
                }

                if (searchTerm === undefined && searchInput) searchTerm = searchInput.value;
                if (sortBy === undefined && sortInput) sortBy = sortInput.value;
                if (filterTag === undefined && tagInput) filterTag = tagInput.value;

                searchTerm = searchTerm || '';
                sortBy = sortBy || 'last_modified';
                filterTag = filterTag || '';

                const isTallScreen = layout ? (layout === 'mobile') : (window.innerHeight > window.innerWidth);
                const isListView = viewMode === 'list';

                // 2. Filter & Sort Logic
                let stories = [...library.stories];
                let folders = [...(library.folders || [])];

                // A. Apply Search/Tags (Global Search, ignores folders if searching)
                // Behavior: If searching/tagging, flatten the hierarchy. If browsing, use folders.
                const isSearching = (searchTerm && searchTerm.trim().length > 0) || (filterTag && filterTag.length > 0);

                if (isSearching) {
                    if (searchTerm) {
                        const parsedQuery = UTILITY.parseSearchQuery(searchTerm);
                        stories = stories.filter(s => UTILITY.matchStory(s, parsedQuery));

                        // Filter folders (Simplified matching for folders)
                        if (parsedQuery.isRegex) {
                            folders = folders.filter(f => parsedQuery.regex.test(f.name || ""));
                        } else {
                            folders = folders.filter(f => {
                                if (parsedQuery.isEmpty) return true;
                                for (const token of parsedQuery.tokens) {
                                    const match = (f.name || "").toLowerCase().includes(token.text);
                                    if (token.isNegative) { if (match) return false; }
                                    else { if (!match) return false; }
                                }
                                return true;
                            });
                        }
                    }
                    if (filterTag) {
                        const lowerFilter = filterTag.toLowerCase();
                        stories = stories.filter(s => {
                            const storyTags = new Set();
                            (s.tags || []).forEach(t => storyTags.add(t.toLowerCase()));
                            (s.characters || []).forEach(c => (c.tags || []).forEach(t => storyTags.add(t.toLowerCase())));
                            return storyTags.has(lowerFilter);
                        });
                        // Folders don't have tags typically, so hide them or show all? Hide scenarios with no matching tag logic.
                        folders = [];
                    }
                } else {
                    // B. Folder Navigation (Hierarchy)
                    if (folderId) {
                        // Inside a folder
                        stories = stories.filter(s => s.folder_ids && s.folder_ids.includes(folderId));
                        folders = folders.filter(f => f.parent_id === folderId);
                    } else {
                        // Root Level
                        // Show ALL stories (Stories are 'added' to folders, not moved, so they remain in root)
                        // stories = stories.filter(s => !s.folder_ids || s.folder_ids.length === 0);
                        folders = folders.filter(f => !f.parent_id);
                    }
                }

                // Calculate Story Counts for Folders (Visual only)
                folders.forEach(f => {
                    // Count total stories in this folder (recursive? or just direct?)
                    // For now, direct children match.
                    f.story_count = library.stories.filter(s => s.folder_ids && s.folder_ids.includes(f.id)).length;
                });


                // Sort Stories
                stories.sort((a, b) => {
                    if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
                    if (sortBy === 'created_date') return new Date(b.created_date) - new Date(a.created_date);
                    return new Date(b.last_modified) - new Date(a.last_modified);
                });

                // Sort Folders (Always alphabetical or by creation?)
                folders.sort((a, b) => (a.name || '').localeCompare(b.name || ''));


                // 3. Generate HTML
                // Breadcrumbs
                let breadcrumbsHTML = '';
                if (!isSearching && folderId) {
                    const currentFolder = (library.folders || []).find(f => f.id === folderId);

                    if (currentFolder) {
                        // Build Path
                        let path = [];
                        let ptr = currentFolder;
                        let depth = 0;
                        while (ptr && ptr.parent_id && depth < 20) {
                            const parent = (library.folders || []).find(f => f.id === ptr.parent_id);
                            if (parent) {
                                path.unshift(parent);
                                ptr = parent;
                            } else {
                                ptr = null;
                            }
                            depth++;
                        }

                        // Generate HTML for Path
                        let pathHTML = path.map(f => `
                            <button onclick="UIManager.renderLibraryInterface({ folderId: '${f.id}' })" class="hover:text-white transition-colors text-gray-400 flex items-center">
                                <svg class="w-4 h-4 mr-1 text-gray-500" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path></svg>
                                ${f.name}
                            </button>
                            <span class="text-gray-600">/</span>
                        `).join('');

                        breadcrumbsHTML = DOM.html`
                            <div class="col-span-full flex items-center mb-4 space-x-2 text-sm text-gray-400 flex-wrap">
                                 <button onclick="UIManager.renderLibraryInterface({ folderId: null })" class="hover:text-white transition-colors flex items-center">
                                    <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
                                    Home
                                 </button>
                                 <span class="text-gray-600">/</span>
                                 ${DOM.unsafe(pathHTML)}
                                 <span class="text-white font-bold flex items-center">
                                    <svg class="w-4 h-4 mr-1 text-indigo-400" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path></svg>
                                    ${currentFolder.name}
                                 </span>
                            </div>
                        `;
                    }
                }

                const folderListHTML = folders.map(folder => UIComponents.FolderItem(folder, viewMode)).join('');

                const storyListHTML = stories.map((story) => {
                    const isActive = story.id === library.active_story_id;
                    return UIComponents.StoryListItem(story, isActive, viewMode);
                }).join('');

                let combinedListHTML = breadcrumbsHTML + folderListHTML + storyListHTML;

                if (stories.length === 0 && folders.length === 0) {
                    combinedListHTML = breadcrumbsHTML + DOM.html`
                        <div class="col-span-full flex flex-col items-center justify-center py-20 opacity-50 space-y-4">
                            <svg class="w-16 h-16 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path></svg>
                            <span class="text-lg">No stories or folders found.</span>
                        </div>
                     `;
                }


                // Update Existing Frame (if applicable and layout matches)
                const desktopDetailsPanel = document.getElementById('story-details-content-desktop');
                const isCurrentLayoutMobile = !desktopDetailsPanel;
                const layoutMatches = (isTallScreen === isCurrentLayoutMobile);

                // Define Grid Classes based on context
                let gridClasses = '';
                if (isListView) {
                    gridClasses = 'flex flex-col space-y-2 pb-20';
                } else {
                    gridClasses = isTallScreen
                        ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-20'
                        : 'grid grid-cols-1 gap-4 pb-20';
                }

                if (listContainer && searchInput && layoutMatches) {
                    listContainer.className = `p-2 overflow-y-auto flex-grow ${gridClasses}`;
                    listContainer.innerHTML = combinedListHTML;

                    // FIX: Update Toggle Button State explicitly since controls aren't re-rendered
                    const toggleBtn = document.getElementById('lib-view-toggle');
                    if (toggleBtn) {
                        // Re-calculate icons
                        const gridIcon = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>`;
                        const listIcon = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>`;
                        const viewIcon = isListView ? gridIcon : listIcon;

                        toggleBtn.innerHTML = viewIcon; // DOM.unsafe not needed for innerHTML assignment of known safe strings
                        toggleBtn.title = isListView ? 'Switch to Card View' : 'Switch to List View';
                        toggleBtn.setAttribute('onclick', `UIManager.renderLibraryInterface({ viewMode: '${isListView ? 'grid' : 'list'}' })`);
                    }

                    // Trigger hydration for updates (only needed for grid or small icons)
                    setTimeout(() => UIManager.hydrateStoryCards(stories), 50);
                    return;
                }

                // 4. Generate Full Frame (First Render or Layout Switch)
                const tagOptions = library.tag_cache.map(tag => DOM.html`<option value="${tag}" ${filterTag === tag ? 'selected' : ''}>${tag}</option>`);

                // View Toggle Icon: If in List Mode, show GRID icon (to switch to grid). If in Grid Mode, show LIST icon (to switch to list).
                const gridIcon = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>`;
                const listIcon = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>`;
                const viewIcon = isListView ? gridIcon : listIcon;



                // Create Folder Button (plain string — must use DOM.unsafe() at inject-site to preserve onclick)
                const createFolderBtn = `
                    <button onclick="UIManager.showCreateFolderModal()" class="flex-shrink-0 border border-gray-700 hover:border-gray-500 bg-gray-800/80 hover:bg-gray-700/80 p-2 rounded-lg text-gray-400 hover:text-white transition-all duration-200" title="New Folder">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"></path></svg>
                    </button>
                    <button id="lib-view-toggle" onclick="UIManager.renderLibraryInterface({ viewMode: '${isListView ? 'grid' : 'list'}' })" class="flex-shrink-0 border border-gray-700 hover:border-gray-500 bg-gray-800/80 hover:bg-gray-700/80 p-2 rounded-lg text-gray-400 hover:text-white transition-all duration-200" title="${isListView ? 'Switch to Card View' : 'Switch to List View'}">
                        ${viewIcon}
                    </button>
                `;

                const controlsHTML = DOM.html`
            <div class="space-y-3">
                <div>
                    <p class="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">Search</p>
                    <div class="flex items-center gap-2">
                        <div class="relative flex-1 min-w-0">
                            <div class="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                                <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0"/></svg>
                            </div>
                            <input id="lib-search" type="search" placeholder="Search stories..." value="${searchTerm}"
                                oninput="UIManager.renderLibraryInterface()"
                                class="w-full bg-gray-800/60 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 transition-colors">
                        </div>
                        ${DOM.unsafe(createFolderBtn)}
                    </div>
                </div>
                <div class="flex gap-2">
                    <div class="flex-1 min-w-0">
                        <p class="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">Sort</p>
                        <select id="lib-sort" onchange="UIManager.renderLibraryInterface()" class="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 transition-colors">
                            <option value="last_modified" ${sortBy === 'last_modified' ? 'selected' : ''}>Modified</option>
                            <option value="name" ${sortBy === 'name' ? 'selected' : ''}>Name</option>
                            <option value="created_date" ${sortBy === 'created_date' ? 'selected' : ''}>Created</option>
                        </select>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">Tag</p>
                        <select id="lib-tag" onchange="UIManager.renderLibraryInterface()" class="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 transition-colors">
                            <option value="">All Tags</option>
                            ${tagOptions}
                        </select>
                    </div>
                </div>
            </div>`;

                if (isTallScreen) {
                    // Mobile: Reduced padding (p-2) and added strict width constraints (w-full min-w-0 overflow-x-hidden)
                    container.innerHTML = DOM.html`<div class="flex flex-col flex-grow min-h-0 w-full min-w-0 overflow-x-hidden"><div class="p-4 border-b border-gray-700/80 space-y-3 w-full bg-gray-800/30">${controlsHTML}</div><div id="lib-list" class="p-2 overflow-y-auto flex-grow w-full ${gridClasses}">${DOM.unsafe(combinedListHTML)}</div></div>`.toString();
                } else {
                    container.innerHTML = DOM.html`
                <div class="w-[420px] flex-shrink-0 border-r border-gray-700/80 flex flex-col bg-gray-800/20"><div class="p-5 border-b border-gray-700/80 space-y-3 bg-gray-800/30">${controlsHTML}</div><div id="lib-list" class="p-3 overflow-y-auto flex-grow ${gridClasses}">${DOM.unsafe(combinedListHTML)}</div></div>
                <div id="story-details-content-desktop" class="flex-grow p-6 flex text-gray-500"><div class="w-full h-full flex items-center justify-center"><div class="text-center space-y-3 opacity-50"><svg class="w-12 h-12 mx-auto text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg><p class="text-sm">Select a story to view details</p></div></div></div>
            `.toString();
                }

                // Trigger Background Hydration
                setTimeout(() => UIManager.hydrateStoryCards(stories), 50);
            },

            /**
             * Shows a simple prompt to create a new folder.
             */
            async showCreateFolderModal() {
                const name = await UTILITY.customPrompt("Enter folder name:", "", "New Folder Name");
                if (name && name.trim()) {
                    const parentId = UIManager.RUNTIME.currentLibraryFolder || null;
                    LibraryController.createFolder(name, parentId);
                }
            },

            /**
             * Shows a modal to ADD a story to a folder (keeping it in others).
             */
            async showAddStoryToFolderModal(storyId) {
                const library = StateManager.getLibrary();
                const folders = library.folders || [];
                const story = library.stories.find(s => s.id === storyId);
                if (!story) return;

                // Sort and flatten folders with indentation
                const getFolderLevel = (id, list, level = 0) => {
                    let children = list.filter(f => f.parent_id === id);
                    children.sort((a, b) => a.name.localeCompare(b.name));
                    let result = [];
                    children.forEach(c => {
                        result.push({ ...c, level });
                        result = result.concat(getFolderLevel(c.id, list, level + 1));
                    });
                    return result;
                };

                // Get root folders first
                const rootFolders = folders.filter(f => !f.parent_id).sort((a, b) => a.name.localeCompare(b.name));
                let flatFolders = [];
                rootFolders.forEach(f => {
                    flatFolders.push({ ...f, level: 0 });
                    flatFolders = flatFolders.concat(getFolderLevel(f.id, folders, 1));
                });

                // Create Options
                const options = flatFolders.map(f => {
                    const indent = "&nbsp;&nbsp;&nbsp;".repeat(f.level);
                    const prefix = f.level > 0 ? "└─ " : ""; // Visual indicators
                    const isAlreadyIn = story.folder_ids && story.folder_ids.includes(f.id);
                    const mark = isAlreadyIn ? " (Already Added)" : "";
                    return `<option value="${f.id}" ${isAlreadyIn ? 'disabled' : ''}>${indent}${prefix}${f.name}${mark}</option>`;
                }).join('');

                const modalHTML = DOM.html`
                    <div id="add-story-folder-modal" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onclick="if(event.target.id === 'add-story-folder-modal') this.remove()">
                        <div class="bg-gray-800 rounded-lg shadow-xl w-96 p-6 border border-gray-700" onclick="event.stopPropagation()">
                             <h3 class="text-lg font-bold text-white mb-4">Add '${story.name}' to Folder</h3>
                             <label class="block text-sm text-gray-400 mb-2">Select Folder</label>
                             <select id="add-story-folder-select" class="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white mb-6 focus:border-indigo-500 focus:outline-none">
                                <option value="">(Select Folder)</option>
                                ${DOM.unsafe(options)}
                             </select>
                             <div class="flex justify-end space-x-3">
                                <button onclick="document.getElementById('add-story-folder-modal').remove()" class="px-4 py-2 text-gray-400 hover:text-white transition-colors">Cancel</button>
                                <button onclick="const fid = document.getElementById('add-story-folder-select').value; if(fid) { LibraryController.addStoryToFolder('${storyId}', fid); document.getElementById('add-story-folder-modal').remove(); }" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold transition-colors">Add</button>
                             </div>
                        </div>
                    </div>
                `;

                // Append to body
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = modalHTML;
                document.body.appendChild(tempDiv.firstElementChild);
            },

            /**
             * Shows a modal to move a folder into another folder.
             * Prevents circular dependencies by filtering out the folder itself and its children.
             */
            async showMoveFolderModal(folderId) {
                const library = StateManager.getLibrary();
                const folders = library.folders || [];
                const currentFolder = folders.find(f => f.id === folderId);
                if (!currentFolder) return;

                // Recursive function to get all descendant IDs
                const getDescendants = (parentId) => {
                    let descendants = [];
                    const children = folders.filter(f => f.parent_id === parentId);
                    children.forEach(child => {
                        descendants.push(child.id);
                        descendants = descendants.concat(getDescendants(child.id));
                    });
                    return descendants;
                };

                const invalidIds = [folderId, ...getDescendants(folderId)];

                // Filter valid parents
                const validFolders = folders.filter(f => !invalidIds.includes(f.id));

                // Sort and flatten valid folders for display
                const getFolderLevel = (id, list, level = 0) => {
                    let children = list.filter(f => f.parent_id === id);
                    children.sort((a, b) => a.name.localeCompare(b.name));
                    let result = [];
                    children.forEach(c => {
                        result.push({ ...c, level });
                        result = result.concat(getFolderLevel(c.id, list, level + 1));
                    });
                    return result;
                };

                // Get root folders first (from Valid List)
                const rootFolders = validFolders.filter(f => !f.parent_id).sort((a, b) => a.name.localeCompare(b.name));
                let flatFolders = [];
                rootFolders.forEach(f => {
                    flatFolders.push({ ...f, level: 0 });
                    flatFolders = flatFolders.concat(getFolderLevel(f.id, validFolders, 1));
                });


                const options = flatFolders.map(f => {
                    const indent = "&nbsp;&nbsp;&nbsp;".repeat(f.level);
                    const prefix = f.level > 0 ? "└─ " : "";
                    return `<option value="${f.id}">${indent}${prefix}${f.name}</option>`;
                }).join('');


                const modalHTML = DOM.html`
                    <div id="move-folder-modal" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onclick="if(event.target.id === 'move-folder-modal') this.remove()">
                        <div class="bg-gray-800 rounded-lg shadow-xl w-96 p-6 border border-gray-700" onclick="event.stopPropagation()">
                             <h3 class="text-lg font-bold text-white mb-4">Move Folder '${currentFolder.name}'</h3>
                             <label class="block text-sm text-gray-400 mb-2">Select Parent Folder</label>
                             <select id="move-folder-select" class="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white mb-6 focus:border-indigo-500 focus:outline-none">
                                <option value="">(Root / No Parent)</option>
                                ${DOM.unsafe(options)}
                             </select>
                             <div class="flex justify-end space-x-3">
                                <button onclick="document.getElementById('move-folder-modal').remove()" class="px-4 py-2 text-gray-400 hover:text-white transition-colors">Cancel</button>
                                <button onclick="const pid = document.getElementById('move-folder-select').value; LibraryController.setFolderParent('${folderId}', pid || null); document.getElementById('move-folder-modal').remove();" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold transition-colors">Move Folder</button>
                             </div>
                        </div>
                    </div>
                `;

                // Append
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = modalHTML;
                document.body.appendChild(tempDiv.firstElementChild);

                // Set initial
                document.getElementById('move-folder-select').value = currentFolder.parent_id || '';
            },

            /**
             * Asynchronously hydrates the background images for story cards.
             */
            async hydrateStoryCards(stories) {
                console.log("UIManager: Starting hydration for", stories.length, "stories.");

                // Process in chunks of 5 to avoid overwhelming the DB/UI thread
                const chunkSize = 5;
                for (let i = 0; i < stories.length; i += chunkSize) {
                    const chunk = stories.slice(i, i + chunkSize);
                    await Promise.all(chunk.map(async (story) => {
                        try {
                            const bgEl = document.getElementById(`story-bg-${story.id}`);
                            if (!bgEl) return;

                            // 1. Try Story Background
                            let bgResolved = false;
                            if (story.backgroundImageURL) {
                                const src = await this.resolveImageSource(story.backgroundImageURL);
                                if (src) {
                                    UTILITY.safeBackgroundSet(bgEl, src);
                                    bgResolved = true;
                                    return;
                                } else {
                                    // Soft failure, try fallback
                                    // console.debug(`Background image failed for ${story.name}, attempting fallback.`);
                                }
                            }

                            // 2. Fallback to First Non-User Character with Image
                            let fallbackUserImage = null;

                            if (story.characters && story.characters.length > 0) {
                                for (const char of story.characters) {
                                    // Determine potential image key (URL or ID)
                                    // If image_url is missing, try using ID (resolveImageSource handles local_idb_ prefixing)
                                    const imgKey = char.image_url || char.id;

                                    // Capture potential user image for later
                                    if (char.is_user) {
                                        if (imgKey && !fallbackUserImage) fallbackUserImage = imgKey;
                                        continue;
                                    }

                                    if (imgKey) {
                                        const src = await this.resolveImageSource(imgKey);
                                        if (src) {
                                            UTILITY.safeBackgroundSet(bgEl, src);
                                            bgResolved = true;
                                            return;
                                        }
                                    }
                                }
                            }

                            // 3. Last Resort: User Image (Commented out to prevent stories without portraits from incorrectly displaying the user's avatar)
                            /*
                            if (!bgResolved && fallbackUserImage) {
                                const src = await this.resolveImageSource(fallbackUserImage);
                                if (src) {
                                    UTILITY.safeBackgroundSet(bgEl, src);
                                    bgResolved = true;
                                }
                            }
                            */

                            // 3. Final Fallback (If no Non-User found with image, maybe Gradient is enough?)
                            // Only warn if we really expected an image but found nothing good
                            if (!bgResolved && story.backgroundImageURL) {
                                console.warn(`Card image missing for ${story.name}: Story BG failed & No valid NPC image found.`);
                            }
                        } catch (err) {
                            console.error(`Error hydrating card for story ${story.name}:`, err);
                        }
                    }));
                }
                console.log("UIManager: Hydration complete.");
            },


            /**
             * Resolves an image key or URL to a usable source (URL or Blob URL).
             * Utilizes runtime cache to prevent repeated DB fetches/Object creations.
             */
            async resolveImageSource(keyOrUrl) {
                if (!keyOrUrl) return null;
                // Exclude current session blob URLs if they are not in cache (likely stale), but allow valid http/data
                if (keyOrUrl.startsWith('data:')) return keyOrUrl;
                // file: covers bundled images when index.html is opened straight from disk.
                if (keyOrUrl.startsWith('http') || keyOrUrl.startsWith('file:')) return keyOrUrl;

                // Check Cache
                if (this.RUNTIME.worldImageCache[keyOrUrl]) return this.RUNTIME.worldImageCache[keyOrUrl];
                if (this.RUNTIME.characterImageCache[keyOrUrl]) return this.RUNTIME.characterImageCache[keyOrUrl];

                // Attempt DB Fetch
                try {
                    // 1. Try Exact Key
                    let blob = await DBService.getImage(keyOrUrl);

                    // 2. Try Fallback: Remove 'local_idb_' prefix (Fix for Key Mismatch)
                    if (!blob && keyOrUrl.startsWith('local_idb_')) {
                        const cleanKey = keyOrUrl.replace('local_idb_', '');
                        blob = await DBService.getImage(cleanKey);
                    }

                    // 3. Try Fallback: Add 'local_idb_' prefix
                    if (!blob && !keyOrUrl.startsWith('local_idb_')) {
                        blob = await DBService.getImage('local_idb_' + keyOrUrl);
                    }

                    if (blob) {
                        const url = URL.createObjectURL(blob);
                        this.RUNTIME.worldImageCache[keyOrUrl] = url; // Cache it
                        return url;
                    }
                } catch (e) {
                    console.warn(`Image resolution failed for ${keyOrUrl}:`, e);
                }

                return null;
            },

            /**
             * Opens the Story Details modal for a specific story.
             * Populates the modal with scenarios, narratives, and character carousel.
             * @param {string} storyId - The ID of the story to open.
             */
            async openStoryDetails(storyId) {
                const library = StateManager.getLibrary();
                const story = library.stories.find(s => s.id === storyId);
                if (!story) return;

                // Track for layout switching
                UIManager.RUNTIME.viewingStoryId = storyId;

                const desktopContainer = document.getElementById('story-details-content-desktop');
                // FIX: Fallback to mobile modal if the desktop container is missing (e.g. transitional layout state)
                const isMobile = (window.innerHeight > window.innerWidth) || !desktopContainer;
                const targetModal = isMobile ? 'story-details-modal' : 'story-library-modal';

                // Componentize Scenarios
                const scenariosHTML = (story.scenarios || []).map(scenario =>
                    UIComponents.ScenarioItem(scenario, story.id)
                );

                // Fetch Narratives recursively to inject message counts into the stubs
                const sortedNarrativeStubs = (story.narratives || []).slice().sort((a, b) => new Date(b.last_modified) - new Date(a.last_modified));
                await Promise.all(sortedNarrativeStubs.map(async stub => {
                    try {
                        const fullNarrative = await DBService.getNarrative(stub.id);
                        stub.messageCounter = fullNarrative && fullNarrative.state ? (fullNarrative.state.messageCounter || 0) : 0;
                    } catch (e) {
                        stub.messageCounter = 0;
                    }
                }));

                // Componentize Narratives
                const narrativesHTML = sortedNarrativeStubs.map(narrative => {
                    const isActive = (narrative.id === library.active_narrative_id && story.id === library.active_story_id);
                    return UIComponents.NarrativeItem(narrative, story.id, isActive);
                });

                const hasImages = (story.characters || []).some(c => UIManager.getPortraitSrc(c));

                // Extract custom typography config from the story object natively
                const customFont = story.font || 'var(--font-primary)';
                const customColor = story.chatTextColor || 'inherit';

                const carouselHTML = hasImages ? DOM.html`
            <div class="relative w-full aspect-square md:h-[48rem] md:aspect-auto bg-black border-b border-gray-800 group cursor-pointer" title="Click to view full image">
                 <div id="details-carousel" class="w-full h-full object-cover transition-opacity"></div>
                 <div class="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/40 to-transparent pointer-events-none z-10"></div>
                 
                 <!-- Story Title & Creator's Note overlay at the bottom of the hero -->
                 <div class="absolute bottom-0 left-0 right-0 p-6 flex flex-col gap-2 z-20 pointer-events-none">
                     <input type="text" 
                         value="${story.name}" 
                         style="font-family: ${customFont}; color: ${customColor};"
                         oninput="LibraryController.updateStoryField('${story.id}', 'name', this.value)" 
                         class="text-3xl md:text-4xl font-black bg-transparent border-0 p-0 placeholder-gray-400 tracking-tight focus:ring-0 focus:outline-none w-full md:w-11/12 pr-16 drop-shadow-[0_4px_4px_rgba(0,0,0,1)] hover:bg-white/10 focus:bg-white/20 rounded px-2 -ml-2 transition-colors cursor-text pointer-events-auto leading-none"
                         placeholder="STORY TITLE">
                     
                     <div class="relative w-full md:w-11/12 pointer-events-auto group/note">
                         <textarea oninput="LibraryController.updateStoryField('${story.id}', 'creator_notes', this.value)" style="font-family: ${customFont}; color: ${customColor};" class="w-full bg-transparent border border-transparent hover:border-gray-500/50 focus:border-teal-500/50 focus:bg-black/60 p-3 -ml-3 rounded-lg resize-none text-base md:text-xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] placeholder-gray-400 focus:ring-0 transition-all font-medium scrollbar-hide leading-snug" rows="4" placeholder="Creator's note...">${story.creator_notes || ''}</textarea>
                         <button data-action="gen-story-notes" data-id="${story.id}" class="absolute top-2 right-2 p-1.5 bg-teal-950/80 text-white rounded-md border border-teal-500/50 opacity-0 group-focus-within/note:opacity-100 group-hover/note:opacity-100 transition-opacity micro-hover backdrop-blur-md z-20" title="Generate with AI">${this.getAIGenIcon()}</button>
                     </div>
                 </div>
                 
                 <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                    <svg class="w-12 h-12 text-white/50 drop-shadow-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"></path></svg>
                 </div>
            </div>` : DOM.html`
            <div class="relative w-full bg-gray-900 border-b border-gray-800 p-6 pt-24 pb-8 flex flex-col gap-2">
                 <!-- Imageless fallback header -->
                 <input type="text" 
                    value="${story.name}" 
                    style="font-family: ${customFont}; color: ${customColor};"
                    oninput="LibraryController.updateStoryField('${story.id}', 'name', this.value)" 
                    class="text-3xl md:text-4xl font-black bg-transparent border-0 p-0 placeholder-gray-400 tracking-tight focus:ring-0 focus:outline-none w-full md:w-11/12 pr-16 drop-shadow-[0_4px_4px_rgba(0,0,0,1)] hover:bg-white/10 focus:bg-white/20 rounded px-2 -ml-2 transition-colors cursor-text leading-none"
                    placeholder="STORY TITLE">
                 
                 <div class="relative w-full md:w-11/12 group/note mt-2">
                     <textarea oninput="LibraryController.updateStoryField('${story.id}', 'creator_notes', this.value)" style="font-family: ${customFont}; color: ${customColor};" class="w-full bg-transparent border border-transparent hover:border-gray-500/50 focus:border-teal-500/50 focus:bg-black/60 p-3 -ml-3 rounded-lg resize-none text-base md:text-xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] placeholder-gray-400 focus:ring-0 transition-all font-medium scrollbar-hide leading-snug" rows="4" placeholder="Creator's note...">${story.creator_notes || ''}</textarea>
                     <button data-action="gen-story-notes" data-id="${story.id}" class="absolute top-2 right-2 p-1.5 bg-teal-950/80 text-white rounded-md border border-teal-500/50 opacity-0 group-focus-within/note:opacity-100 group-hover/note:opacity-100 transition-opacity micro-hover backdrop-blur-md z-20" title="Generate with AI">${this.getAIGenIcon()}</button>
                 </div>
            </div>`;

                // Pre-process Tags HTML to pill spans matching Character Details UI exactly
                let tagsHTML = '';
                (Array.isArray(story.tags) ? story.tags : []).forEach(tag => {
                    const escaped = String(tag).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
                    tagsHTML += `<span class="bg-teal-500/10 text-teal-300 text-[11px] font-bold px-2.5 py-1 rounded-md border border-teal-500/20 flex items-center shadow-sm whitespace-nowrap gap-1">${escaped} <button onclick="LibraryController.removeStoryTag('${story.id}', '${escaped}')" class="hover:text-white transition-colors ml-1">&times;</button></span>`;
                });

                const detailsHTML = DOM.html`
            <div class="absolute top-0 right-0 z-50 p-4 flex justify-end items-center pointer-events-none" style="padding-top: calc(1rem + env(safe-area-inset-top));">
                <!-- Action Buttons overlapping Hero top-right -->
                <div class="flex items-center space-x-2 pointer-events-auto">
                    <button data-action="duplicate-story" data-id="${story.id}" class="bg-black/40 hover:bg-gray-700 text-gray-300 hover:text-white p-2 rounded-full backdrop-blur-sm transition-colors shadow-lg" title="Duplicate Story">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                    </button>
                    <button data-action="delete-story" data-id="${story.id}" class="bg-red-900/50 hover:bg-red-700/80 text-red-200 p-2 rounded-full backdrop-blur-sm transition-colors shadow-lg" title="Delete Story">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                    <button data-action="close-modal" data-id="${targetModal}" class="bg-black/40 hover:bg-gray-700 text-gray-300 hover:text-white p-2 ml-2 rounded-full backdrop-blur-sm transition-colors shadow-lg" title="Close">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
            </div>

            <div class="flex-grow overflow-y-auto min-h-0 details-scroll-container">
                
                ${carouselHTML}

                <div class="p-6 space-y-8">
                    <!-- Top Row: Tags & Actions -->
                    <div class="w-full flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
                        
                        <!-- Tag Pills Area (Flex-grow) -->
                        <div class="w-full md:flex-1 md:max-w-xl">
                            <label class="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-2 block">Global Tags</label>
                            <div class="flex flex-wrap gap-2 mb-2" id="story-tags-container-${story.id}">
                                ${DOM.unsafe(tagsHTML)}
                            </div>
                            <div class="relative group w-full">
                                <input type="text" id="story-tag-input-${story.id}" placeholder="Type a tag and press comma..." 
                                       onkeyup="if(event.key===','){LibraryController.addStoryTag('${story.id}', this.value); this.value='';}"
                                       class="w-full bg-gray-900/60 border border-gray-700 p-2.5 rounded-lg text-sm text-gray-300 focus:ring-1 focus:ring-teal-500 focus:border-teal-500 transition-all placeholder-gray-600 shadow-inner">
                                <button data-action="gen-story-tags" data-id="${story.id}" class="absolute top-1/2 right-2 -translate-y-1/2 p-1 micro-hover text-gray-500 opacity-0 group-hover:opacity-100 hover:text-teal-400 bg-gray-800/50 rounded-md transition-all" title="Generate with AI">${this.getAIGenIcon()}</button>
                            </div>
                        </div>

                        <!-- Action Button (Shrinks to wrap) -->
                        ${sortedNarrativeStubs.length > 0 ? DOM.html`
                        <div class="w-full md:w-auto flex-shrink-0">
                            <button onclick="LibraryController.loadNarrative('${story.id}', '${sortedNarrativeStubs[0].id}')" class="w-full md:w-auto px-6 py-2.5 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-lg shadow-[0_0_15px_rgba(13,148,136,0.2)] hover:shadow-[0_0_25px_rgba(13,148,136,0.3)] transition-all flex items-center justify-center gap-2.5 group text-base transform hover:-translate-y-0.5 border border-teal-500/30">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                                </svg>
                                Continue
                            </button>
                        </div>
                        ` : ''}

                    </div>

                    <hr class="border-gray-800">

                    <div>
                        <div class="flex justify-between items-center mb-4">
                            <h4 class="font-bold text-lg text-teal-400 flex items-center">
                                <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                                Scenarios
                            </h4>
                            <div class="flex gap-2 items-center">
                                <button id="scenario-select-btn" onclick="UIManager.toggleSelectionMode('scenario')" class="text-xs font-bold text-gray-400 hover:text-teal-400 mr-2 transition-colors">Select</button>
                                <div id="scenario-bulk-actions" class="hidden flex items-center gap-2 mr-2">
                                    <span id="scenario-bulk-count" class="text-xs text-gray-400 font-mono">0 selected</span>
                                    <button onclick="LibraryController.deleteMultipleScenarios('${story.id}')" class="text-xs bg-red-900/80 hover:bg-red-700 text-white font-bold py-1 px-3 rounded border border-red-500 transition-colors">Delete Selected</button>
                                </div>
                                <button onclick="LibraryController.startInStoryGeneration('${story.id}')" class="text-xs bg-teal-600 hover:bg-teal-500 text-white font-bold py-1 px-3 rounded flex items-center gap-1 transition-colors" title="Generate with AI">
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                    AI Scenario
                                </button>
                                <button onclick="LibraryController.createNewScenario('${story.id}')" class="text-xs bg-gray-700 hover:bg-gray-600 text-white font-bold py-1 px-3 rounded flex items-center gap-1 transition-colors" title="Create Blank">
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                                    New Scenario
                                </button>
                            </div>
                        </div>
                        
                        <div class="relative group/slider flex items-center">
                            <!-- Scroll Left Arrow -->
                            <button onclick="document.getElementById('scenarios-list-container').scrollBy({left: -320, behavior: 'smooth'})" class="absolute left-2 z-10 p-2 bg-black/80 hover:bg-gray-800 border-2 border-gray-600 rounded-full text-white opacity-0 group-hover/slider:opacity-100 transition-opacity disabled:opacity-0 focus:outline-none" aria-label="Scroll Left">
                                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
                            </button>
                            
                            <div id="scenarios-list-container" class="flex flex-row overflow-x-auto snap-x snap-mandatory scrollbar-hide space-x-6 pb-4 w-full px-2" style="-webkit-overflow-scrolling: touch;">
                                ${scenariosHTML.length ? scenariosHTML : DOM.unsafe('<p class="text-sm text-gray-500 italic w-full text-center py-8 border border-dashed border-gray-700 rounded-xl">No scenarios available.</p>')}
                            </div>
                            
                            <!-- Scroll Right Arrow -->
                            <button onclick="document.getElementById('scenarios-list-container').scrollBy({left: 320, behavior: 'smooth'})" class="absolute right-2 z-10 p-2 bg-black/80 hover:bg-gray-800 border-2 border-gray-600 rounded-full text-white opacity-0 group-hover/slider:opacity-100 transition-opacity disabled:opacity-0 focus:outline-none" aria-label="Scroll Right">
                                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                            </button>
                        </div>
                    </div>

                    <hr class="border-gray-700">

                    <div>
                    <div>
                        <div class="flex justify-between items-center mb-4 min-h-[40px]">
                            <h4 class="font-bold text-lg text-sky-300 flex items-center shrink-0">
                                <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
                                Narratives
                            </h4>
                            <div class="flex items-center gap-4">
                                <button id="narrative-select-btn" onclick="UIManager.toggleSelectionMode('narrative')" class="text-xs font-bold text-gray-400 hover:text-sky-400 transition-colors flex-shrink-0">Select</button>
                                <div id="narrative-bulk-actions" class="hidden flex items-center gap-2">
                                    <span id="narrative-bulk-count" class="text-xs text-gray-400 font-mono">0 selected</span>
                                    <button onclick="LibraryController.deleteMultipleNarratives('${story.id}')" class="text-xs bg-red-900/80 hover:bg-red-700 text-white font-bold py-1 px-3 rounded border border-red-500 transition-colors">Delete Selected</button>
                                </div>
                                <div id="narrative-active-actions" class="hidden flex gap-4 items-center">
                                    <button id="narrative-action-delete" data-action="delete-narrative" data-story-id="${story.id}" data-narrative-id="" class="p-2 text-gray-500 hover:text-red-400 rounded transition-colors" title="Delete">
                                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                    </button>
                                    <button id="narrative-action-elevate" data-action="elevate-narrative" data-story-id="${story.id}" data-narrative-id="" class="p-2 text-gray-500 hover:text-teal-400 rounded transition-colors" title="Elevate to Scenario">
                                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 11l3-3m0 0l3 3m-3-3v8m0-13a9 9 0 110 18 9 9 0 010-18z"/></svg>
                                    </button>
                                    <button id="narrative-action-duplicate" data-action="duplicate-narrative" data-story-id="${story.id}" data-narrative-id="" class="p-2 text-gray-500 hover:text-gray-300 rounded transition-colors" title="Duplicate">
                                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                                    </button>
                                    <button id="narrative-action-load" data-action="load-narrative" data-story-id="${story.id}" data-narrative-id="" class="p-2 text-green-500 hover:text-green-300 rounded transition-colors" title="Load Narrative">
                                        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.841A1.5 1.5 0 0 0 4 4.11V15.89a1.5 1.5 0 0 0 2.3 1.269l9.344-5.89a1.5 1.5 0 0 0 0-2.538L6.3 2.84Z"/></svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div id="narratives-list-container" class="space-y-2">${narrativesHTML.length ? narrativesHTML : DOM.unsafe('<p class="text-sm text-gray-500 italic">No narratives started. Load a scenario to begin.</p>')}</div>
                    </div>
                </div>
            </div>
        `;

                if (isMobile) {
                    document.querySelector('#story-details-modal > div:not(.modal-overlay)').innerHTML = detailsHTML.toString();
                    AppController.openModal('story-details-modal');
                } else {
                    const detailsWrapperHTML = DOM.html`
                <div class="w-full h-full flex flex-col md:-m-6 bg-gray-900 relative">
                    ${detailsHTML}
                </div>
            `;
                    document.getElementById('story-details-content-desktop').innerHTML = detailsWrapperHTML.toString();
                }

                if (hasImages) {
                    this.startCarousel(story.characters, 'details-carousel', story.id);
                }
            },

            /**
             * Selects a narrative from the list to enable top-level action controls.
             * @param {string} narrativeId - The ID of the narrative
             * @param {HTMLElement} element - The DOM element of the narrative item clicked
             */
            selectNarrative(narrativeId, element) {
                const container = document.getElementById('narratives-list-container');
                if (container && container.dataset.selectionMode === 'true') {
                    // Bulk select mode: toggle checkbox instead of active highlighting
                    const cb = element.querySelector('.narrative-select-check');
                    if (cb) {
                        cb.checked = !cb.checked;
                        UIManager.updateBulkActionUI();
                    }
                    return;
                }

                // Deselect previously selected items
                document.querySelectorAll('.narrative-item.selected').forEach(el => {
                    el.classList.remove('selected', 'ring-2', 'ring-sky-500', 'bg-gray-700/80');
                });

                // Highlight the new selection
                if (element) {
                    element.classList.add('selected', 'ring-2', 'ring-sky-500', 'bg-gray-700/80');
                }

                // Show actions container
                const actionsContainer = document.getElementById('narrative-active-actions');
                if (actionsContainer) {
                    actionsContainer.classList.remove('hidden');
                }

                // Update datasets for controls
                const actions = ['load', 'duplicate', 'elevate', 'delete'];
                actions.forEach(action => {
                    const btn = document.getElementById(`narrative-action-${action}`);
                    if (btn) {
                        btn.dataset.narrativeId = narrativeId;
                    }
                });
            },

            /**
             * Toggles the selection mode for a list container.
             * @param {string} type - 'scenario' or 'narrative'
             */
            toggleSelectionMode(type) {
                const container = document.getElementById(`${type}s-list-container`);
                const btn = document.getElementById(`${type}-select-btn`);

                if (!container) return;

                // Toggle State
                const isActive = container.dataset.selectionMode === 'true';
                const newState = !isActive;
                container.dataset.selectionMode = newState;

                // Update Button Visuals
                if (btn) {
                    if (type === 'scenario') {
                        btn.classList.toggle('text-indigo-400', newState);
                        btn.classList.toggle('text-gray-400', !newState);
                    } else {
                        btn.classList.toggle('text-sky-400', newState);
                        btn.classList.toggle('text-gray-400', !newState);
                    }
                    btn.innerText = newState ? 'Cancel' : 'Select';
                }

                if (!newState) {
                    // Deselect all
                    container.querySelectorAll(`.${type}-select-check`).forEach(cb => cb.checked = false);
                    this.updateBulkActionUI();
                }

                // Toggle CSS Classes for UI
                if (type === 'scenario') {
                    // Toggle visibility of checkbox containers
                    container.querySelectorAll('.scenario-checkbox-container').forEach(el => el.classList.toggle('hidden', !newState));

                    // Toggle padding on the summary element (which has class .scenario-content)
                    container.querySelectorAll('.scenario-content').forEach(el => {
                        el.classList.toggle('pl-12', newState);
                        el.classList.toggle('pl-4', !newState);
                    });
                } else if (type === 'narrative') {
                    // Toggle visibility of checkbox containers
                    container.querySelectorAll('.narrative-checkbox-container').forEach(el => el.classList.toggle('hidden', !newState));

                    // Toggle padding on the content div (which has class .narrative-content)
                    container.querySelectorAll('.narrative-content').forEach(el => {
                        el.classList.toggle('pl-10', newState); // pl-10 roughly 2.5rem, enough for left-3 (0.75rem) + width
                        el.classList.toggle('pl-0', !newState);
                    });
                }
            },

            /**
             * Updates the visibility of the Bulk Action UI based on selection.
             */
            updateBulkActionUI() {
                // Scenarios
                const checkedScenarios = document.querySelectorAll('.scenario-select-check:checked');
                const actionsS = document.getElementById('scenario-bulk-actions');
                const countS = document.getElementById('scenario-bulk-count');

                if (actionsS && countS) {
                    if (checkedScenarios.length > 0) {
                        actionsS.classList.remove('hidden');
                        countS.textContent = `${checkedScenarios.length} selected`;
                    } else {
                        actionsS.classList.add('hidden');
                    }
                }

                // Narratives
                const checkedNarratives = document.querySelectorAll('.narrative-select-check:checked');
                const actionsN = document.getElementById('narrative-bulk-actions');
                const countN = document.getElementById('narrative-bulk-count');

                if (actionsN && countN) {
                    if (checkedNarratives.length > 0) {
                        actionsN.classList.remove('hidden');
                        countN.textContent = `${checkedNarratives.length} selected`;
                    } else {
                        actionsN.classList.add('hidden');
                    }
                }
            },

            /**
             * Starts the character image carousel for the story details modal.
             * @param {Array} characters - The list of characters in the story.
             * @param {string} containerId - The ID of the container element.
             * @param {string} storyId - The ID of the story.
             */
            startCarousel(characters, containerId, storyId) {
                if (ModalManager.RUNTIME.carousel_interval) clearInterval(ModalManager.RUNTIME.carousel_interval);

                const container = document.getElementById(containerId);
                if (!container) return;

                // Map characters to a clean object for the lightbox
                const imageData = (characters || []).map(c => {
                    const src = UIManager.getPortraitSrc(c);
                    return src ? { src, name: c.name, is_user: c.is_user } : null;
                }).filter(Boolean);

                if (imageData.length === 0) {
                    container.innerHTML = `<div class="w-full h-full flex items-center justify-center bg-gray-900 text-gray-500">No character images</div>`;
                    return;
                }

                // Cache this list for the lightbox
                UIManager.RUNTIME.currentLightboxImages = imageData;

                // Determine Start Index: First Non-User Character
                let startIndex = imageData.findIndex(img => !img.is_user);
                if (startIndex === -1) startIndex = 0; // Fallback to first image (User) if only User has image

                // If only 1 image, render static and do NOT start interval
                if (imageData.length === 1) {
                    container.innerHTML = DOM.html`
                <img src="${imageData[0].src}" 
                     data-action="open-lightbox" 
                     data-index="0"
                     class="absolute inset-0 w-full h-full object-cover object-top" 
                     style="opacity: 1;">
            `.toString();
                    return;
                }

                // Multiple images: Render two for crossfading
                container.innerHTML = DOM.html`
            <img id="${containerId}-img1" data-action="open-lightbox" data-index="${startIndex}" class="absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-1000" style="opacity: 1;">
            <img id="${containerId}-img2" data-action="open-lightbox" data-index="${startIndex}" class="absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-1000" style="opacity: 0;">
        `.toString();

                let currentIndex = startIndex;
                let activeImg = 1;
                const img1 = document.getElementById(`${containerId}-img1`);
                const img2 = document.getElementById(`${containerId}-img2`);

                img1.src = imageData[currentIndex].src;

                ModalManager.RUNTIME.carousel_interval = setInterval(() => {
                    currentIndex = (currentIndex + 1) % imageData.length;
                    const nextSrc = imageData[currentIndex].src;

                    // Update the hidden image source, then fade it in
                    if (activeImg === 1) {
                        img2.src = nextSrc;
                        img2.dataset.index = currentIndex; // Update index for lightbox
                        img1.style.opacity = 0;
                        img2.style.opacity = 1;
                        activeImg = 2;
                    } else {
                        img1.src = nextSrc;
                        img1.dataset.index = currentIndex; // Update index for lightbox
                        img1.style.opacity = 1;
                        img2.style.opacity = 0;
                        activeImg = 1;
                    }
                }, 4000);
            },

            /**
             * Opens the lightbox modal for a specific image index.
             * @param {number|string} index - The index of the image to show.
             */
            openLightbox(index) {
                const images = UIManager.RUNTIME.currentLightboxImages || [];
                if (images.length === 0) return;

                UIManager.RUNTIME.lightboxIndex = parseInt(index) || 0;
                this.updateLightboxDisplay();

                const modal = document.getElementById('lightbox-modal');
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            },

            /**
             * Updates the lightbox image and caption based on the current index.
             */
            updateLightboxDisplay() {
                const images = UIManager.RUNTIME.currentLightboxImages || [];
                const index = UIManager.RUNTIME.lightboxIndex;
                const data = images[index];

                const imgEl = document.getElementById('lightbox-image');
                const capEl = document.getElementById('lightbox-caption');

                if (imgEl && data) UTILITY.safeImageSet(imgEl, data.src);
                if (capEl && data) capEl.textContent = data.name;
            },

            /**
             * Navigates the lightbox to the next or previous image.
             * @param {number} direction - The direction to move (1 or -1).
             */
            navigateLightbox(direction) {
                const images = UIManager.RUNTIME.currentLightboxImages || [];
                if (images.length === 0) return;

                let newIndex = UIManager.RUNTIME.lightboxIndex + direction;
                if (newIndex >= images.length) newIndex = 0;
                if (newIndex < 0) newIndex = images.length - 1;

                UIManager.RUNTIME.lightboxIndex = newIndex;
                this.updateLightboxDisplay();
            },

            /**
             * Closes the lightbox modal.
             */
            closeLightbox() {
                const modal = document.getElementById('lightbox-modal');
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            },

            /**
             * Renders the character roster in the sidebar.
             * Sorts characters by User, Active status, then Alphabetical.
             */
            renderCharacters() {
                const state = StateManager.getState();
                const container = document.getElementById('characters-container');
                if (!state.characters) {
                    container.innerHTML = '';
                    return;
                }

                // Filter out any accidentally saved location characters from the main array just in case
                const regularChars = state.characters.filter(c => !c.is_location_character);

                // Sorting Logic: Prioritize User, then Active, then Alphabetical
                // 1. User First
                // 2. Active Next (Alphabetical)
                // 3. Inactive Last (Alphabetical)
                const sortedChars = [...regularChars].sort((a, b) => {
                    // Priority 1: User Character
                    if (a.is_user && !b.is_user) return -1;
                    if (!a.is_user && b.is_user) return 1;

                    // Priority 2: Active Status
                    if (a.is_active && !b.is_active) return -1;
                    if (!a.is_active && b.is_active) return 1;

                    // Priority 3: Alphabetical Name
                    const nameA = a.name || "";
                    const nameB = b.name || "";
                    return nameA.localeCompare(nameB);
                });

                let html = sortedChars.map(UIComponents.CharacterTile).join('');

                // Location Characters
                if (state.worldMap && state.worldMap.currentLocation) {
                    const currentLoc = state.worldMap.grid.find(loc => loc.coords.x === state.worldMap.currentLocation.x && loc.coords.y === state.worldMap.currentLocation.y);
                    if (currentLoc && currentLoc.characters && currentLoc.characters.length > 0) {
                        html += `
                            <div class="mt-8 mb-3 mx-2 flex items-center gap-2 border-b border-indigo-500/30 pb-2">
                                <i class="fas fa-map-marker-alt text-indigo-400/80 text-[10px]"></i>
                                <h3 class="text-xs font-bold tracking-widest uppercase text-indigo-300/90 glow-text-sm">Local Encounters</h3>
                            </div>
                        `;
                        // Map using the existing tile component
                        html += currentLoc.characters.map(UIComponents.CharacterTile).join('');
                    }
                }

                container.innerHTML = html;
            },

            /**
             * Renders the tabs for the Knowledge Modal (Static vs Dynamic vs GM).
             */
            renderKnowledgeModalTabs() {
                const tabName = (typeof AppController !== 'undefined' && AppController.activeKnowledgeTab) ? AppController.activeKnowledgeTab : 'static';

                const staticTab = document.getElementById('knowledge-tab-static');
                const dynamicTab = document.getElementById('knowledge-tab-dynamic');
                const gmTab = document.getElementById('knowledge-tab-gm');
                const visualTab = document.getElementById('knowledge-tab-visual');
                const staticContent = document.getElementById('knowledge-static-content');
                const dynamicContent = document.getElementById('knowledge-dynamic-content');
                const gmContent = document.getElementById('knowledge-gm-content');
                const visualContent = document.getElementById('knowledge-visual-content');

                // Helper to toggle active classes
                const setActiveTab = (activeTabEl, activeContentEl) => {
                    [staticTab, dynamicTab, gmTab, visualTab].forEach(tab => {
                        if (tab) {
                            if (tab === activeTabEl) {
                                tab.classList.add('border-indigo-500', 'text-white');
                                tab.classList.remove('border-transparent', 'text-gray-400');
                            } else {
                                tab.classList.add('border-transparent', 'text-gray-400');
                                tab.classList.remove('border-indigo-500', 'text-white');
                            }
                        }
                    });
                    [staticContent, dynamicContent, gmContent, visualContent].forEach(content => {
                        if (content) {
                            if (content === activeContentEl) {
                                content.classList.remove('hidden');
                            } else {
                                content.classList.add('hidden');
                            }
                        }
                    });
                };

                if (tabName === 'static') {
                    setActiveTab(staticTab, staticContent);
                    this.renderStaticEntries();
                } else if (tabName === 'dynamic') {
                    setActiveTab(dynamicTab, dynamicContent);
                    this.renderDynamicEntries();
                } else if (tabName === 'gm') {
                    setActiveTab(gmTab, gmContent);
                    this.renderGMRules();
                } else if (tabName === 'visual') {
                    setActiveTab(visualTab, visualContent);
                    if (visualContent) visualContent.classList.add('flex');
                    this.renderVisualLore();
                }
                if (visualContent && tabName !== 'visual') visualContent.classList.remove('flex');
            },

            /**
             * Renders the list of static lore entries.
             */
            /**
             * Visual Lore runtime: which category is filtered, and which item is open.
             */
            VISUAL_LORE: { filter: 'all', query: '', selectedId: null, busy: false },

            /**
             * Renders the Visual Lore shelf: filter pills, the item list, and the open item.
             */
            /**
             * Items chosen for the turn currently being written, before it is sent.
             */
            VISUAL_LORE_PENDING: [],

            /**
             * Opens the attach picker.
             */
            openVisualLorePicker() {
                const el = document.getElementById('visual-lore-picker');
                if (!el) return;
                this.VISUAL_LORE.pickerQuery = '';
                const search = document.getElementById('visual-lore-picker-search');
                if (search) search.value = '';
                this.renderVisualLorePicker();
                el.classList.remove('hidden');
                el.classList.add('flex');
            },

            /**
             * Closes the attach picker.
             */
            closeVisualLorePicker() {
                const el = document.getElementById('visual-lore-picker');
                if (!el) return;
                el.classList.add('hidden');
                el.classList.remove('flex');
            },

            /**
             * Renders the picker list, with what is already attached marked.
             */
            renderVisualLorePicker() {
                const listEl = document.getElementById('visual-lore-picker-list');
                const filterEl = document.getElementById('visual-lore-picker-filter');
                if (!listEl || !filterEl) return;

                const cats = [{ id: 'all', label: 'All' }, { id: 'item', label: 'Items' },
                { id: 'character', label: 'Characters' }, { id: 'world', label: 'Places' },
                { id: 'event', label: 'Events' }, { id: 'other', label: 'Other' }];
                const active = this.VISUAL_LORE.pickerFilter || 'all';
                filterEl.innerHTML = cats.map(c => {
                    const cls = c.id === active
                        ? 'px-2 py-1 text-xs font-semibold rounded bg-indigo-600 text-white'
                        : 'px-2 py-1 text-xs font-semibold rounded bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors';
                    return DOM.html`<button data-action="visual-lore-picker-filter" data-cat="${c.id}" class="${cls}">${c.label}</button>`.toString();
                }).join('');

                const items = UTILITY.filterVisualLore(
                    VisualLoreService.all(), active, this.VISUAL_LORE.pickerQuery || '');

                if (items.length === 0) {
                    listEl.innerHTML = DOM.html`<p class="text-xs text-gray-500 p-2">Nothing on the shelf yet. Add items in Knowledge, Visual Lore.</p>`.toString();
                    return;
                }

                listEl.innerHTML = items.map(item => {
                    const on = this.VISUAL_LORE_PENDING.includes(item.id);
                    const cls = on ? 'bg-teal-600/30 border-teal-500' : 'bg-black/20 border-transparent hover:bg-black/40';
                    const thumb = item.imageId
                        ? DOM.html`<img data-vl-img="${item.imageId}" class="visual-lore-thumb" alt="">`.toString()
                        : DOM.html`<div class="visual-lore-thumb visual-lore-thumb-empty"></div>`.toString();
                    const tick = on
                        ? '<svg class="w-4 h-4 text-teal-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>'
                        : '';
                    return DOM.html`<button data-action="visual-lore-toggle" data-id="${item.id}"
                        class="w-full text-left flex items-center gap-2 p-2 mb-1 rounded border ${cls} transition-colors">
                        ${DOM.unsafe(thumb)}
                        <span class="min-w-0 flex-1">
                            <span class="block text-xs font-semibold text-gray-100 truncate">${item.title}</span>
                            <span class="block text-[10px] text-gray-500 truncate">${item.description}</span>
                        </span>
                        ${DOM.unsafe(tick)}
                    </button>`.toString();
                }).join('');

                this._hydrateVisualLoreThumbs('#visual-lore-picker-list');
            },

            /**
             * Renders the attached chips above the message box.
             */
            renderVisualLoreChips() {
                const el = document.getElementById('visual-lore-chips');
                if (!el) return;
                const ids = this.VISUAL_LORE_PENDING;
                if (!ids.length) {
                    el.classList.add('hidden');
                    el.classList.remove('flex');
                    el.innerHTML = '';
                    return;
                }
                el.classList.remove('hidden');
                el.classList.add('flex');
                el.innerHTML = ids.map(id => {
                    const item = VisualLoreService.get(id);
                    if (!item) return '';
                    return DOM.html`<button data-action="visual-lore-toggle" data-id="${item.id}"
                        class="flex items-center gap-1 px-2 py-1 rounded-full bg-teal-600/25 border border-teal-500/40 text-[11px] text-teal-100 hover:bg-teal-600/40 transition-colors"
                        title="Remove from this message">${item.title}
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>`.toString();
                }).join('');
            },

            renderVisualLore() {
                const listEl = document.getElementById('visual-lore-list');
                const filterEl = document.getElementById('visual-lore-filter-container');
                if (!listEl || !filterEl) return;

                const cats = [{ id: 'all', label: 'All' }, { id: 'item', label: 'Items' }, { id: 'character', label: 'Characters' }, { id: 'world', label: 'Places' }, { id: 'event', label: 'Events' }, { id: 'other', label: 'Other' }];
                const active = this.VISUAL_LORE.filter;
                filterEl.innerHTML = cats.map(c => {
                    const cls = c.id === active
                        ? 'px-2 py-1 text-xs font-semibold rounded bg-indigo-600 text-white shadow'
                        : 'px-2 py-1 text-xs font-semibold rounded bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors';
                    return DOM.html`<button data-action="visual-lore-filter" data-cat="${c.id}" class="${cls}">${c.label}</button>`.toString();
                }).join('');

                const items = UTILITY.filterVisualLore(
                    VisualLoreService.all(), this.VISUAL_LORE.filter, this.VISUAL_LORE.query);

                if (items.length === 0) {
                    listEl.innerHTML = DOM.html`<p class="text-xs text-gray-500 p-2">Nothing here yet. Add an item to start your shelf.</p>`.toString();
                } else {
                    listEl.innerHTML = items.map(item => {
                        const sel = item.id === this.VISUAL_LORE.selectedId;
                        const cls = sel ? 'bg-indigo-600/30 border-indigo-500' : 'bg-black/20 border-transparent hover:bg-black/40';
                        // A blank tile keeps the rows aligned when an item has no picture.
                        const thumb = item.imageId
                            ? DOM.html`<img data-vl-img="${item.imageId}" class="visual-lore-thumb" alt="">`.toString()
                            : DOM.html`<div class="visual-lore-thumb visual-lore-thumb-empty"></div>`.toString();
                        return DOM.html`<button data-action="visual-lore-select" data-id="${item.id}"
                            class="w-full text-left flex items-center gap-2 p-2 mb-1 rounded border ${cls} transition-colors">
                            ${DOM.unsafe(thumb)}
                            <span class="min-w-0 flex-1">
                                <span class="block text-xs font-semibold text-gray-100 truncate">${item.title}</span>
                                <span class="block text-[10px] text-gray-500">${(cats.find(c => c.id === item.category) || {}).label || item.category}</span>
                            </span>
                        </button>`.toString();
                    }).join('');
                    this._hydrateVisualLoreThumbs();
                }

                this.renderVisualLoreDetails();
            },

            /**
             * Loads thumbnails from the image store into the rendered rows.
             * @private
             */
            async _hydrateVisualLoreThumbs(scope = '#visual-lore-list') {
                const imgs = document.querySelectorAll(scope + ' img[data-vl-img]');
                for (const img of imgs) {
                    try {
                        const blob = await DBService.getImage(img.dataset.vlImg);
                        if (blob) img.src = URL.createObjectURL(blob);
                    } catch (e) { console.warn('Visual Lore: thumbnail load failed.', e); }
                }
            },

            /**
             * Renders the open item, or the empty state.
             */
            renderVisualLoreDetails() {
                const el = document.getElementById('visual-lore-details');
                if (!el) return;

                const item = this.VISUAL_LORE.selectedId ? VisualLoreService.get(this.VISUAL_LORE.selectedId) : null;
                if (!item) {
                    el.innerHTML = DOM.html`<p class="text-sm text-gray-500">Pick an item, or add one.</p>`.toString();
                    return;
                }

                const cats = [{ id: 'all', label: 'All' }, { id: 'item', label: 'Items' }, { id: 'character', label: 'Characters' }, { id: 'world', label: 'Places' }, { id: 'event', label: 'Events' }, { id: 'other', label: 'Other' }];
                const bridgeReady = (typeof VisionBridgeService !== 'undefined') && VisionBridgeService.isEnabled();
                const busy = this.VISUAL_LORE.busy;

                const picture = item.imageId
                    ? DOM.html`<img data-vl-img="${item.imageId}" class="visual-lore-preview" alt="">`.toString()
                    : DOM.html`<div class="visual-lore-preview visual-lore-thumb-empty flex items-center justify-center"><span class="text-[10px] text-gray-600">No picture</span></div>`.toString();

                const describeLabel = item.description ? "Describe again" : "Describe with AI";
                const describeBtn = bridgeReady && item.imageId
                    ? DOM.html`<button data-action="visual-lore-describe" data-id="${item.id}" ${DOM.unsafe(busy ? "disabled" : "")}
                        class="px-3 py-1.5 text-xs font-semibold rounded bg-teal-600 hover:bg-teal-500 text-white transition-colors">${busy ? "Describing..." : describeLabel}</button>`.toString()
                    : '';

                const hint = !item.imageId
                    ? 'Text-only item. Add a picture if it helps you recognise it in the picker.'
                    : (bridgeReady ? '' : 'Set up the Vision Bridge in Settings to describe pictures automatically.');

                el.innerHTML = DOM.html`<div class="flex flex-col gap-3">
                    <div class="flex gap-4 items-start">
                        ${DOM.unsafe(picture)}
                        <div class="flex-1 flex flex-col gap-2 min-w-0">
                            <input type="text" id="visual-lore-title" value="${item.title}" placeholder="Name"
                                class="w-full bg-black/40 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100 outline-none focus:border-indigo-500">
                            <select id="visual-lore-category"
                                class="w-full bg-black/40 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-indigo-500">
                                ${DOM.unsafe(cats.filter(c => c.id !== 'all').map(c =>
                    `<option value="${c.id}"${c.id === item.category ? ' selected' : ''}>${c.label}</option>`).join(''))}
                            </select>
                            <div class="flex flex-wrap gap-2">
                                <button data-action="visual-lore-pick-image" data-id="${item.id}"
                                    class="px-3 py-1.5 text-xs font-semibold rounded bg-gray-700 hover:bg-gray-600 text-white transition-colors">${item.imageId ? "Replace picture" : "Add picture"}</button>
                                ${DOM.unsafe(describeBtn)}
                            </div>
                        </div>
                    </div>
                    <input type="text" id="visual-lore-focus" value="${item.focus || ''}"
                        placeholder="What should the AI describe, and how? (optional)"
                        class="w-full bg-black/40 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 outline-none focus:border-indigo-500">
                    <textarea id="visual-lore-description" rows="8" placeholder="What the character knows about this."
                        class="w-full bg-black/40 border border-gray-700 rounded px-2 py-2 text-sm text-gray-200 outline-none focus:border-indigo-500 resize-y">${item.description}</textarea>
                    <p class="text-[11px] text-gray-500">${hint}</p>
                    <div class="flex gap-2">
                        <button data-action="visual-lore-save" data-id="${item.id}"
                            class="px-4 py-2 text-xs font-semibold rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors">Save</button>
                        <button data-action="visual-lore-delete" data-id="${item.id}"
                            class="px-4 py-2 text-xs font-semibold rounded bg-red-900/60 hover:bg-red-800 text-red-100 transition-colors">Delete</button>
                    </div>
                </div>`.toString();

                this._hydrateVisualLoreThumbs();
                const preview = document.querySelector('#visual-lore-details img[data-vl-img]');
                if (preview) {
                    DBService.getImage(preview.dataset.vlImg).then(blob => {
                        if (blob) preview.src = URL.createObjectURL(blob);
                    }).catch(() => { });
                }
            },

            renderStaticEntries() {
                const state = StateManager.getState();

                // Render category filter pills
                const filterContainer = document.getElementById('static-category-filter-container');
                if (filterContainer) {
                    const categories = [
                        { id: 'all', label: 'All' },
                        { id: 'event', label: 'Events' },
                        { id: 'character', label: 'Characters' },
                        { id: 'item', label: 'Items' },
                        { id: 'world', label: 'World' },
                        { id: 'relationship', label: 'Relations' },
                        { id: 'other', label: 'Other' }
                    ];

                    const activeFilter = WorldController.RUNTIME.activeStaticCategoryFilter || 'all';

                    filterContainer.innerHTML = categories.map(cat => {
                        const isActive = cat.id === activeFilter;
                        const btnClass = isActive
                            ? 'px-2 py-1 text-xs font-semibold rounded bg-indigo-600 text-white shadow'
                            : 'px-2 py-1 text-xs font-semibold rounded bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors';
                        return `<button onclick="WorldController.switchStaticCategoryFilter('${cat.id}')" class="${btnClass}">${cat.label}</button>`;
                    }).join('');
                }

                const activeFilter = WorldController.RUNTIME.activeStaticCategoryFilter || 'all';
                let immutable = (state.static_entries || []).filter(e => e && e.is_immutable);
                let mutable = (state.static_entries || []).filter(e => e && !e.is_immutable);

                if (activeFilter !== 'all') {
                    immutable = immutable.filter(e => UTILITY.getEntryCategory(e.title) === activeFilter);
                    mutable = mutable.filter(e => UTILITY.getEntryCategory(e.title) === activeFilter);
                }

                const renderItem = (entry, index, group) => {
                    const isSelected = state.selectedStaticEntryId === entry.id;
                    const isImmutable = entry.is_immutable;

                    let classes = "p-3 rounded-lg cursor-pointer flex items-center gap-2 mb-1 border transition-all ";

                    if (isSelected) {
                        classes += "bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/20";
                    } else if (isImmutable) {
                        classes += "bg-amber-900/20 border-amber-600/30 hover:bg-amber-900/40 text-amber-100";
                    } else {
                        classes += "border-transparent hover:bg-gray-700/50 text-gray-200";
                    }

                    const lockIcon = isImmutable
                        ? DOM.unsafe(`<svg class="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>`)
                        : DOM.unsafe(`<svg class="w-4 h-4 text-gray-500 hover:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"></path></svg>`);

                    return DOM.html`
        <div 
            draggable="true"
            ondragstart="WorldController.handleStaticDragStart(event, '${entry.id}')"
            ondragover="WorldController.handleStaticDragOver(event)"
            ondrop="WorldController.handleStaticDrop(event, '${entry.id}', '${group}', ${index})"
            ontouchstart="WorldController.handleStaticTouchStart(event, '${entry.id}')"
            ontouchmove="WorldController.handleStaticTouchMove(event)"
            ontouchend="WorldController.handleStaticTouchEnd(event)"
            data-drag-target="true"
            data-drag-id="${entry.id}"
            data-drag-group="${group}"
            data-drag-index="${index}"
            onclick="WorldController.selectStaticEntry('${entry.id}')"
            class="${classes}"
        >
            <h4 class="font-semibold truncate flex-grow text-sm select-none pointer-events-none">${entry.title}</h4>
            <button 
                onclick="event.stopPropagation(); WorldController.toggleStaticEntryProtection('${entry.id}')" 
                class="p-1 hover:bg-white/10 rounded transition-colors"
                title="${isImmutable ? 'Protected (Click to Unlock)' : 'Updating (Click to Protect)'}"
            >
                ${lockIcon}
            </button>
        </div>`;
                };


                const immutableHtml = immutable.map((e, i) => renderItem(e, i, 'immutable')).join('');
                const mutableHtml = mutable.map((e, i) => renderItem(e, i, 'mutable')).join('');

                const container = document.getElementById('static-entries-list');

                const immutableHeader = `<div class="text-xs font-bold text-amber-500 uppercase tracking-wider mb-2 mt-2 px-1 flex justify-between items-center select-none"
                    ondragover="WorldController.handleStaticDragOver(event)"
                    ondrop="WorldController.handleStaticDrop(event, 'header-immutable', 'immutable', 0)"
                    ontouchmove="WorldController.handleStaticTouchMove(event)"
                    ontouchend="WorldController.handleStaticTouchEnd(event)"
                    data-drag-target="true"
                    data-drag-id="header-immutable"
                    data-drag-group="immutable"
                    data-drag-index="0"
                >
                    Protected
                </div>`;

                const mutableHeader = `<div class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 mt-4 px-1 flex justify-between items-center select-none"
                    ondragover="WorldController.handleStaticDragOver(event)"
                    ondrop="WorldController.handleStaticDrop(event, 'header-mutable', 'mutable', 0)"
                    ontouchmove="WorldController.handleStaticTouchMove(event)"
                    ontouchend="WorldController.handleStaticTouchEnd(event)"
                    data-drag-target="true"
                    data-drag-id="header-mutable"
                    data-drag-group="mutable"
                    data-drag-index="0"
                >
                    Updating
                </div>`;

                container.innerHTML = `
                    ${immutableHeader}
                    <div class="min-h-[20px] pb-2 transition-colors duration-200 rounded" ondragover="WorldController.handleStaticDragOver(event)" ondrop="WorldController.handleStaticDrop(event, 'header-immutable', 'immutable', ${immutable.length})">${immutableHtml || '<div class="text-xs text-gray-600 italic px-2">Drag entries here...</div>'}</div>
                    <hr class="border-gray-700 my-2">
                    ${mutableHeader}
                    <div class="min-h-[20px] pb-2 transition-colors duration-200 rounded" ondragover="WorldController.handleStaticDragOver(event)" ondrop="WorldController.handleStaticDrop(event, 'header-mutable', 'mutable', ${mutable.length})">${mutableHtml || '<div class="text-xs text-gray-600 italic px-2">Drag entries here...</div>'}</div>
                `;

                // Append button to parent container of the list
                let parent = container.parentElement;
                let existingBtn = parent.querySelector('.knowledge-add-btn-container');
                if (existingBtn) existingBtn.remove(); // Re-render logic

                const btnDiv = document.createElement('div');
                btnDiv.className = 'knowledge-add-btn-container flex-shrink-0 bg-black/30 rounded-b-lg p-2';
                btnDiv.innerHTML = `<button data-action="add-static-entry" class="w-full py-2 bg-gray-700 hover:bg-indigo-600 text-white rounded flex justify-center items-center transition-colors"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg></button>`;
                parent.appendChild(btnDiv);

                this.renderStaticEntryDetails();
            },

            /**
             * Renders the details view for the selected static entry.
             */
            renderStaticEntryDetails() {
                const state = StateManager.getState();
                const container = document.getElementById('static-entry-details-content');
                const entry = (state.static_entries || []).find(e => e && e.id === state.selectedStaticEntryId);
                if (entry) {
                    const currentCategory = UTILITY.getEntryCategory(entry);
                    container.innerHTML = DOM.html`
            <div class="flex flex-col h-full">
                <div class="flex flex-col gap-2 mb-4">
                    <div class="flex justify-between items-center gap-2">
                        <input type="text" value="${entry.title}" oninput="WorldController.updateStaticEntryField('${entry.id}', 'title', this.value)" onblur="UIManager.renderStaticEntries()" class="text-xl font-bold bg-black/30 p-2 flex-grow rounded focus:ring-1 focus:ring-indigo-500 border-none">
                        <div class="flex items-center gap-1.5 flex-shrink-0 bg-black/30 p-1.5 rounded border border-gray-700">
                            <label class="text-xs font-semibold text-gray-400">Category:</label>
                            <select onchange="WorldController.updateStaticEntryCategory('${entry.id}', this.value)" class="bg-gray-800 text-gray-200 text-xs rounded p-1 font-semibold focus:ring-1 focus:ring-indigo-500 border border-gray-700 cursor-pointer">
                                <option value="other" ${currentCategory === 'other' ? 'selected' : ''}>Other</option>
                                <option value="event" ${currentCategory === 'event' ? 'selected' : ''}>Event</option>
                                <option value="character" ${currentCategory === 'character' ? 'selected' : ''}>Character</option>
                                <option value="item" ${currentCategory === 'item' ? 'selected' : ''}>Item</option>
                                <option value="world" ${currentCategory === 'world' ? 'selected' : ''}>World</option>
                                <option value="relationship" ${currentCategory === 'relationship' ? 'selected' : ''}>Relationship</option>
                            </select>
                        </div>
                        <button onclick="WorldController.convertStaticToDynamic('${entry.id}')" class="text-xs bg-indigo-600/80 hover:bg-indigo-500 text-white font-bold py-2 px-3 rounded flex-shrink-0 transition-colors" title="Convert to Dynamic Entry">
                            To Dynamic &rarr;
                        </button>
                    </div>
                </div>
                <div class="relative flex-grow min-h-[300px]">
                    <textarea oninput="WorldController.updateStaticEntryField('${entry.id}', 'content', this.value)" class="w-full h-full bg-black/30 p-4 resize-none rounded-md">${entry.content}</textarea>
                    <button data-action="gen-static-ai" data-id="${entry.id}" class="absolute top-2 right-2 text-gray-500 hover:text-indigo-400 transition-colors" title="Generate with AI">${this.getAIGenIcon()}</button>
                </div>
                <div class="flex justify-end mt-4 flex-shrink-0">
                    <button data-action="delete-static-entry" data-id="${entry.id}" class="text-sm bg-red-900/50 hover:bg-red-700/80 text-red-200 font-semibold py-2 px-3 rounded-lg">Delete</button>
                </div>
            </div>`.toString();
                } else {
                    container.innerHTML = `<div class="text-gray-400 flex items-center justify-center h-full">Select a static entry.</div>`;
                }
            },

            /**
             * Renders the list of dynamic lore entries.
             */
            renderDynamicEntries() {
                const state = StateManager.getState();
                // Ensure Robust ID Comparison (Convert to String) to handle legacy numeric IDs
                const listHtml = (state.dynamic_entries || []).map(entry => {
                    const isSelected = String(state.selectedDynamicEntryId) === String(entry.id);
                    return DOM.html`
                <div data-action="select-dynamic-entry" data-id="${entry.id}" 
                     class="p-3 rounded-lg cursor-pointer ${isSelected ? 'bg-indigo-600' : 'hover:bg-indigo-600/50'} flex justify-between items-center mb-1">
                    <h4 class="font-semibold truncate">${entry.title}</h4> 
                    ${entry.triggered_at_turn !== null ? DOM.unsafe('<span class="text-xs text-sky-300">ACTIVE</span>') : ''}
                </div>`;
                }).join('');

                const container = document.getElementById('dynamic-entries-list');
                container.innerHTML = listHtml;

                let parent = container.parentElement;
                let existingBtn = parent.querySelector('.knowledge-add-btn-container');
                if (existingBtn) existingBtn.remove();

                const btnDiv = document.createElement('div');
                btnDiv.className = 'knowledge-add-btn-container flex-shrink-0 bg-black/30 rounded-b-lg p-2';
                btnDiv.innerHTML = `
                <div class="flex gap-2 w-full">
                    <button data-action="add-dynamic-entry" class="flex-1 py-2 bg-gray-700 hover:bg-indigo-600 text-white text-xs font-semibold rounded flex justify-center items-center gap-1 transition-colors" title="New Entry">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                        <span>New</span>
                    </button>
                    <button data-action="import-lorebook-trigger" class="flex-1 py-2 bg-gray-700 hover:bg-indigo-600 text-white text-xs font-semibold rounded flex justify-center items-center gap-1 transition-colors" title="Import Lorebook (ST / Chub JSON)">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                        <span>Import</span>
                    </button>
                    <button data-action="export-lorebook" class="flex-1 py-2 bg-gray-700 hover:bg-indigo-600 text-white text-xs font-semibold rounded flex justify-center items-center gap-1 transition-colors" title="Export Lorebook (SillyTavern JSON)">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                        <span>Export</span>
                    </button>
                </div>
                <input type="file" id="lorebook-file-input" accept=".json" style="display: none;" data-action="import-lorebook-file">
                `;
                parent.appendChild(btnDiv);

                this.renderDynamicEntryDetails();
            },

            /**
             * Renders the details view for the selected dynamic entry.
             */
            renderDynamicEntryDetails() {
                const state = StateManager.getState();
                const container = document.getElementById('dynamic-entry-details-content');

                // FIX: Ensure Robust ID Comparison (Convert to String)
                const entry = (state.dynamic_entries || []).find(e => String(e.id) === String(state.selectedDynamicEntryId));

                if (entry) {
                    const contentFieldsHTML = (entry.content_fields || [""]).map((content, index) =>
                        UIComponents.DynamicContentField(content, index, entry.id, entry.content_fields.length)
                    );

                    container.innerHTML = DOM.html`<div class="flex flex-col h-full">
                <label class="font-bold text-sm text-gray-400">Title</label>
                <input type="text" value="${entry.title}" oninput="WorldController.updateDynamicEntryField('${entry.id}', 'title', this.value)" onblur="UIManager.renderDynamicEntries()" class="text-xl font-bold bg-black/30 p-2 w-full mb-4 rounded">
                
                <label class="font-bold mb-1 text-sm text-gray-400">Triggers (Keywords, AND, XOR, % Chance)</label>
                <input type="text" value="${entry.triggers}" oninput="WorldController.updateDynamicEntryField('${entry.id}', 'triggers', this.value)" placeholder="e.g. house, cat AND dog, 25%" class="bg-black/30 p-2 w-full mb-4 rounded">
                
                <div class="relative flex-grow flex flex-col">
                    <label class="font-bold mb-2 text-sm text-gray-400">Content Sequence</label>
                    <div class="space-y-2 overflow-y-auto pr-1">
                        ${contentFieldsHTML}
                    </div>
                    <div class="mt-2 flex justify-end">
                        <button 
                            data-action="add-dynamic-field" data-id="${entry.id}" 
                            class="bg-gray-700 hover:bg-indigo-600 text-white text-xs font-bold py-1 px-3 rounded transition-colors"
                        >
                            + Add Step
                        </button>
                    </div>
                </div>

                <div class="flex justify-end mt-4 border-t border-gray-700 pt-2">
                    <button data-action="delete-dynamic-entry" data-id="${entry.id}" class="text-xs bg-red-900/50 hover:bg-red-700/80 text-red-200 font-semibold py-2 px-3 rounded">Delete Entry</button>
                </div>
            </div>`.toString();
                } else {
                    container.innerHTML = `<div class="text-gray-400 flex items-center justify-center h-full">Select a dynamic entry.</div>`;
                }
            },

            /**
             * Renders the list of GM Rules and the Ledger option.
             */
            renderGMRules() {
                const state = StateManager.getState();
                if (!state.selectedGMRuleId) {
                    state.selectedGMRuleId = 'ledger';
                }

                const isLedgerSelected = state.selectedGMRuleId === 'ledger';
                let listHtml = `
                <div data-action="select-gm-rule" data-id="ledger" 
                     class="p-3 rounded-lg cursor-pointer ${isLedgerSelected ? 'bg-indigo-600' : 'hover:bg-indigo-600/50'} flex justify-between items-center mb-4 border border-indigo-500/30 shadow-sm">
                    <h4 class="font-bold text-sm flex items-center gap-2">
                        <svg class="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                        </svg>
                        <span>GM Ledger Log</span>
                    </h4> 
                    <span class="text-xs px-2 py-0.5 bg-black/40 rounded-full text-amber-300 font-mono font-semibold">${(state.gm_ledger || []).length}</span>
                </div>
                <div class="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-2 px-1">Active Rules & Criteria</div>
                `;

                listHtml += (state.gm_rules || []).map(rule => {
                    const isSelected = String(state.selectedGMRuleId) === String(rule.id);
                    return DOM.html`
                <div data-action="select-gm-rule" data-id="${rule.id}" 
                     class="p-3 rounded-lg cursor-pointer ${isSelected ? 'bg-indigo-600' : 'hover:bg-indigo-600/50'} flex justify-between items-center mb-1">
                    <div class="flex items-center gap-2 overflow-hidden flex-grow mr-2">
                        <input type="checkbox" ${rule.is_active ? 'checked' : ''} 
                               onchange="WorldController.toggleGMRule('${rule.id}', this.checked)"
                               class="rounded border-gray-700 bg-black/30 text-indigo-600 focus:ring-indigo-500 h-4 w-4 flex-shrink-0 cursor-pointer"
                               onclick="event.stopPropagation()">
                        <h4 class="font-semibold text-sm truncate ${rule.is_active ? 'text-white' : 'text-gray-400 line-through'}">${rule.name}</h4> 
                    </div>
                    <span class="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded flex-shrink-0 ${rule.is_active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}">
                        ${rule.is_active ? 'ON' : 'OFF'}
                    </span>
                </div>`;
                }).join('');

                const container = document.getElementById('gm-rules-list');
                if (container) {
                    container.innerHTML = listHtml;

                    let parent = container.parentElement;
                    let existingBtn = parent.querySelector('.gm-add-btn-container');
                    if (existingBtn) existingBtn.remove();

                    const btnDiv = document.createElement('div');
                    btnDiv.className = 'gm-add-btn-container flex-shrink-0 bg-black/30 rounded-b-lg p-2';
                    btnDiv.innerHTML = `
                    <button data-action="add-gm-rule" class="w-full py-2 bg-gray-700 hover:bg-indigo-600 text-white text-xs font-semibold rounded flex justify-center items-center gap-1 transition-colors" title="Create New GM Rule">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                        <span>Add New GM Rule</span>
                    </button>
                    `;
                    parent.appendChild(btnDiv);
                }

                this.renderGMRuleDetails();
            },

            /**
             * Renders the details view for the selected GM rule or Ledger.
             */
            renderGMRuleDetails() {
                const state = StateManager.getState();
                const container = document.getElementById('gm-rule-details-content');
                if (!container) return;

                if (state.selectedGMRuleId === 'ledger') {
                    const ledger = state.gm_ledger || [];
                    const ledgerItemsHTML = ledger.length === 0
                        ? `<div class="text-gray-400 flex items-center justify-center h-full min-h-[200px]">No ledger events logged yet. Interacting in chat will trigger GM evaluations.</div>`
                        : ledger.slice().reverse().map(item => {
                            const badgeColor = item.status === 'triggered' || item.status === 'failed'
                                ? 'bg-red-500/20 text-red-300 border-red-500/30'
                                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';

                            const severityBadge = item.severity
                                ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded border border-gray-700 bg-gray-800 text-gray-300 ml-2">${item.severity.toUpperCase()}</span>`
                                : '';

                            return DOM.html`
                            <div class="p-3 bg-black/45 rounded-lg border border-gray-800/80 mb-2 flex flex-col gap-1.5">
                                <div class="flex justify-between items-start gap-2">
                                    <div class="flex items-center gap-1.5 flex-wrap">
                                        <span class="text-[10px] font-bold px-2 py-0.5 rounded border ${badgeColor}">
                                            ${item.status.toUpperCase()}
                                        </span>
                                        <span class="text-xs font-semibold text-indigo-300 font-mono">Turn ${item.turn}</span>
                                        ${severityBadge}
                                        <span class="text-xs font-semibold text-gray-300">${item.rule_name}</span>
                                    </div>
                                    <span class="text-[10px] text-gray-500 font-mono">${new Date(item.timestamp).toLocaleTimeString()}</span>
                                </div>
                                <div class="text-sm text-gray-200">${item.description}</div>
                                ${item.consequence ? DOM.html`<div class="text-xs text-amber-400 bg-amber-950/20 border border-amber-900/30 p-2 rounded mt-1 font-mono">Consequence: ${item.consequence}</div>` : ''}
                            </div>
                            `;
                        }).join('');

                    container.innerHTML = DOM.html`
                    <div class="flex flex-col h-full">
                        <div class="flex justify-between items-center border-b border-gray-800 pb-3 mb-4 flex-shrink-0">
                            <div>
                                <h3 class="text-lg font-bold text-white flex items-center gap-2">
                                    <svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                                    </svg>
                                    <span>GM Ledger & Evaluation Log</span>
                                </h3>
                                <p class="text-xs text-gray-400">Chronological history of rules evaluated during narrative progression.</p>
                            </div>
                            <button data-action="clear-gm-ledger" class="text-xs bg-red-900/50 hover:bg-red-700/80 text-red-200 font-semibold py-1.5 px-3 rounded transition-colors">
                                Clear Ledger
                            </button>
                        </div>
                        <div class="flex-grow overflow-y-auto pr-1 space-y-2">
                            ${DOM.unsafe(ledgerItemsHTML)}
                        </div>
                    </div>
                    `.toString();
                    return;
                }

                const rule = (state.gm_rules || []).find(r => String(r.id) === String(state.selectedGMRuleId));
                if (rule) {
                    container.innerHTML = DOM.html`
                    <div class="flex flex-col h-full">
                        <div class="flex justify-between items-center border-b border-gray-800 pb-3 mb-4 flex-shrink-0">
                            <div>
                                <h3 class="text-lg font-bold text-white">Edit GM Rule</h3>
                                <p class="text-xs text-gray-400">Configure how the GM Agent checks and enforces this rule.</p>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="text-xs text-gray-400">Active Status</span>
                                <input type="checkbox" ${rule.is_active ? 'checked' : ''} 
                                       onchange="WorldController.toggleGMRule('${rule.id}', this.checked)"
                                       class="rounded border-gray-700 bg-black/30 text-indigo-600 focus:ring-indigo-500 h-5 w-5 cursor-pointer">
                            </div>
                        </div>

                        <div class="flex-grow overflow-y-auto pr-1 space-y-4">
                            <div>
                                <label class="block font-bold text-xs text-gray-400 mb-1">Rule Name</label>
                                <input type="text" value="${rule.name}" 
                                       oninput="WorldController.updateGMRuleField('${rule.id}', 'name', this.value)" 
                                       onblur="UIManager.renderGMRules()"
                                       placeholder="e.g. Encumbrance, Sleep Deprivation..." 
                                       class="text-sm font-semibold bg-black/30 p-2.5 w-full rounded border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-white">
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label class="block font-bold text-xs text-gray-400 mb-1">Enforcement Mode</label>
                                    <select onchange="WorldController.updateGMRuleField('${rule.id}', 'mode', this.value)" 
                                            class="bg-black/30 p-2.5 w-full rounded border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm text-gray-200">
                                        <option value="standard" ${rule.mode === 'standard' ? 'selected' : ''}>Standard (Audit & Enforce)</option>
                                        <option value="active" ${rule.mode === 'active' ? 'selected' : ''}>Active (Inject GM Narration)</option>
                                        <option value="passive" ${rule.mode === 'passive' ? 'selected' : ''}>Passive (Silent Log Only)</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="block font-bold text-xs text-gray-400 mb-1">Severity / Threat Level</label>
                                    <select onchange="WorldController.updateGMRuleField('${rule.id}', 'severity', this.value)" 
                                            class="bg-black/30 p-2.5 w-full rounded border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm text-gray-200">
                                        <option value="negligible" ${rule.severity === 'negligible' ? 'selected' : ''}>Negligible</option>
                                        <option value="low" ${rule.severity === 'low' ? 'selected' : ''}>Low</option>
                                        <option value="medium" ${rule.severity === 'medium' ? 'selected' : ''}>Medium</option>
                                        <option value="high" ${rule.severity === 'high' ? 'selected' : ''}>High</option>
                                        <option value="critical" ${rule.severity === 'critical' ? 'selected' : ''}>Critical</option>
                                    </select>
                                </div>
                            </div>

                             <div>
                                 <label class="block font-bold text-xs text-gray-400 mb-1">Triggers (Comma-separated keywords, logical AND/XOR, or chance)</label>
                                 <textarea oninput="WorldController.updateGMRuleField('${rule.id}', 'triggers', this.value)" 
                                           placeholder="e.g. 'stolen, 50%' or 'cave AND dark' or '30%'"
                                           class="w-full h-24 bg-black/30 p-3 resize-none rounded-md border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm text-gray-200">${rule.triggers || rule.criteria || ''}</textarea>
                             </div>

                            <div>
                                <label class="block font-bold text-xs text-gray-400 mb-1">Consequences (What happens on trigger?)</label>
                                <textarea oninput="WorldController.updateGMRuleField('${rule.id}', 'consequence', this.value)" 
                                          placeholder="Describe exact impact. E.g. 'Deduct 1 torch from inventory.' or 'Inflict minor burns on the caster and set surroundings on fire.'"
                                          class="w-full h-24 bg-black/30 p-3 resize-none rounded-md border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm text-gray-200">${rule.consequence}</textarea>
                            </div>
                        </div>

                        <div class="flex justify-end mt-4 border-t border-gray-800 pt-3 flex-shrink-0">
                            <button data-action="delete-gm-rule" data-id="${rule.id}" class="text-xs bg-red-900/50 hover:bg-red-700/80 text-red-200 font-semibold py-2.5 px-4 rounded transition-colors">
                                Delete Rule
                            </button>
                        </div>
                    </div>
                    `.toString();
                } else {
                    container.innerHTML = `<div class="text-gray-400 flex items-center justify-center h-full">Select a GM Rule or create one to configure.</div>`;
                }
            },

            /**
             * Helper to create the HTML for a single chat message.
             * @param {Object} msg - The message object.
             * @param {number} index - The index of the message.
             * @returns {string} - The HTML string.
             * @private
             */
            _createMessageHTML(msg, index) {
                const state = StateManager.getState();
                return UIComponents.MessageBubble(msg, index, state);
            },

            /**
             * Renders the main chat window.
             * Handles scrolling, cinematic mode, and message display.
             */
            renderChat() {
                // Hardened check to prevent blinking during streaming updates
                if (this.RUNTIME.suppressChatRender) return;

                // Reset VN history index to latest on standard chat updates
                this.RUNTIME.vnHistoryIndex = null;

                const state = StateManager.getState();
                const chatWindow = document.getElementById('chat-window');


                // 1. Empty State Check
                if (!state || !state.chat_history) {
                    if (chatWindow) chatWindow.innerHTML = `<div class="h-full w-full flex items-center justify-center text-gray-500 text-lg">No Narrative Loaded</div>`;
                    const invBtn = document.getElementById('inventory-toggle-btn');
                    if (invBtn) invBtn.classList.add('hidden');
                    return;
                }

                // Self-healing: Ensure every message in chat history has a unique ID
                for (const msg of state.chat_history) {
                    if (msg && !msg.id) {
                        msg.id = UTILITY.uuid();
                    }
                }

                const invBtn = document.getElementById('inventory-toggle-btn');
                if (invBtn) {
                    if (state.enableJournal !== false) {
                        invBtn.classList.remove('hidden');
                    } else {
                        invBtn.classList.add('hidden');
                        const container = document.getElementById('inventory-panel-container');
                        if (container && !container.classList.contains('hidden')) {
                            container.classList.add('hidden');
                        }
                    }
                }

                // 2. Optimization: Don't full-render if actively streaming text
                if (this.RUNTIME.streamingInterval) return;

                // 3. Update Mode & Portraits
                document.body.dataset.mode = state.characterImageMode;
                this.updateSidePortrait();

                // 4. Handle Cinematic Background Logic (Supported in Cinematic mode only)
                if (state.characterImageMode === 'cinematic_overlay') {
                    let latestAiImageUrl = null;

                    // Find the last valid AI image in history
                    for (let i = state.chat_history.length - 1; i >= 0; i--) {
                        const msg = state.chat_history[i];
                        if (!msg) continue; // Safety check
                        if (msg.type !== 'chat' || msg.isHidden) continue;

                        const speaker = ReactiveStore.getCharacter(msg.character_id);
                        if (speaker && !speaker.is_user) {
                            const candidate = this.getPortraitSrc(speaker, msg.emotion);
                            if (candidate) { latestAiImageUrl = candidate; break; }
                        }
                    }

                    // Apply the image transition
                    if (latestAiImageUrl && latestAiImageUrl !== this.RUNTIME.lastCinematicImageUrl) {
                        this.RUNTIME.lastCinematicImageUrl = latestAiImageUrl;
                        const bg1 = document.getElementById('cinematic-bg-1');
                        const bg2 = document.getElementById('cinematic-bg-2');

                        if (this.RUNTIME.activeCinematicBg === 1) {
                            UTILITY.safeBackgroundSet(bg2, latestAiImageUrl);
                            bg1.style.opacity = 0;
                            bg2.style.opacity = 1;
                            this.RUNTIME.activeCinematicBg = 2;
                        } else {
                            UTILITY.safeBackgroundSet(bg1, latestAiImageUrl);
                            bg1.style.opacity = 1;
                            bg2.style.opacity = 0;
                            this.RUNTIME.activeCinematicBg = 1;
                        }
                    } else if (!latestAiImageUrl && this.RUNTIME.lastCinematicImageUrl) {
                        // Keep old image if no new one found, or handle specific fallback
                        const activeBg = document.getElementById(`cinematic-bg-${this.RUNTIME.activeCinematicBg}`);
                        if (activeBg) UTILITY.safeBackgroundSet(activeBg, this.RUNTIME.lastCinematicImageUrl);
                    }
                } else if (state.characterImageMode !== 'visual_novel') {
                    // Reset cinematic backgrounds if not in that mode and not in visual novel mode
                    const bg1 = document.getElementById('cinematic-bg-1');
                    const bg2 = document.getElementById('cinematic-bg-2');
                    if (bg1) { bg1.style.backgroundImage = 'none'; bg1.style.opacity = '0'; }
                    if (bg2) { bg2.style.backgroundImage = 'none'; bg2.style.opacity = '0'; }
                    this.RUNTIME.lastCinematicImageUrl = null;
                    this.RUNTIME.activeCinematicBg = 1;
                }

                // 5. Generate HTML
                // --- Current Scenario Banner ---
                // If the first static entry is titled "Current Scenario", render it as an
                // atmospheric intro card above the first message in the chat window.
                let scenarioBannerHTML = '';
                const scenarioEntry = (state.static_entries || []).find(
                    e => e.title && e.title.trim().toLowerCase() === 'current scenario'
                );
                if (scenarioEntry && scenarioEntry.content) {
                    const parsedContent = (typeof marked !== 'undefined')
                        ? marked.parse(scenarioEntry.content)
                        : scenarioEntry.content.replace(/\n/g, '<br>');

                    // --- Dynamic Titles ---
                    const library = StateManager.getLibrary();
                    const activeStory = library.stories.find(s => s.id === library.active_story_id);
                    const storyName = (activeStory ? activeStory.name : 'Untitled Story');
                    const narrativeName = (state.narrativeName || 'Untitled Narrative');

                    // --- User Character Chip ---
                    // Find the player-controlled character and build a portrait chip
                    // so the user immediately knows who they are playing.
                    const userChar = (state.characters || []).find(c => c.is_user);
                    let playerChipHTML = '';
                    if (userChar) {
                        const portraitUrl = UIManager.RUNTIME.characterImageCache[userChar.id] || null;
                        const avatarStyle = portraitUrl
                            ? DOM.unsafe(`background-image: url('${UTILITY.safeStyleUrl(portraitUrl)}');`)
                            : '';
                        // Fallback silhouette SVG shown when no portrait image exists
                        const avatarFallback = portraitUrl ? '' : DOM.unsafe(`
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                            </svg>`);
                        const shortDesc = userChar.short_description || '';
                        playerChipHTML = DOM.html`
                            <div class="scenario-banner-divider"></div>
                            <div class="scenario-banner-player">
                                <div class="scenario-banner-player-avatar" data-action="open-character-detail" data-id="${userChar.id}" style="${avatarStyle}; cursor: pointer;" title="View character sheet">${avatarFallback}</div>
                                <div class="scenario-banner-player-info">
                                    <span class="scenario-banner-player-role">You are playing</span>
                                    <span class="scenario-banner-player-name">${userChar.name}</span>
                                    ${shortDesc ? DOM.html`<span class="scenario-banner-player-desc">${shortDesc}</span>` : ''}
                                </div>
                            </div>`;
                    }

                    scenarioBannerHTML = DOM.html`
                        <div class="scenario-banner-card" id="scenario-banner">
                            <div class="scenario-banner-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                                </svg>
                            </div>
                            <div class="scenario-banner-story-title">${storyName}</div>
                            <div class="scenario-banner-narrative-subtitle">${narrativeName}</div>
                            <div class="scenario-banner-label">Opening Scene</div>
                            <div class="scenario-banner-content">${DOM.unsafe(parsedContent)}</div>
                            ${playerChipHTML}
                        </div>`.toString();
                }

                const showAgentCards = typeof AgentController !== 'undefined'
                    && state.characterImageMode !== 'visual_novel'
                    && !(typeof TextModeController !== 'undefined' && TextModeController.isActive());
                chatWindow.innerHTML = scenarioBannerHTML + (state.chat_history || [])
                    .map((msg, index) => {
                        // Guard against undefined messages during array mutation (Undo/Splice)
                        if (!msg) return '';
                        const bubble = UIComponents.MessageBubble(msg, index, state);
                        return showAgentCards && bubble ? bubble + AgentController.cardsHTML(msg) : bubble;
                    })
                    .join('');
                if (typeof AgentController !== 'undefined') AgentController.refreshPanel();

                // 5.5 Text Mode: insert time dividers, and keep the inbox badge current.
                if (typeof TextModeController !== 'undefined') {
                    if (TextModeController.isActive()) TextModeController.decorateThread();
                    TextModeController.updateInboxBadge();
                }

                // 6. Restore Typing Indicator (Persistence Fix for Visual Master Updates)
                if (this.RUNTIME.typingIndicatorState) {
                    const { charId, text, nameOverride } = this.RUNTIME.typingIndicatorState;
                    // We call showTypingIndicator again, but strictly for re-appending.
                    this.showTypingIndicator(charId, text, nameOverride);
                }

                // 7. Cleanup flags
                (state.chat_history || []).forEach(m => { if (m) m.isNew = false; });

                // 8. Scroll to bottom
                setTimeout(() => {
                    window.requestAnimationFrame(() => {
                        if (chatWindow) {
                            chatWindow.scrollTop = chatWindow.scrollHeight;
                        }
                    });
                }, 50);
            },

            /**
             * Renders the Example Dialogue modal content.
             */
            renderExampleDialogueModal() {
                const state = StateManager.getState();
                const container = document.getElementById('example-dialogue-container');
                if (!container) return;

                const userChar = state.characters.find(c => c.is_user);
                const aiChars = state.characters.filter(c => !c.is_user);

                // Fix: Filter to only include 'chat' type messages. 
                // This prevents 'lore_reveal' or 'system_event' messages (which might be hidden) from appearing as example dialogue.
                const exampleMessages = state.chat_history
                    .map((msg, index) => ({ ...msg, originalIndex: index }))
                    .filter(msg => msg.isHidden === true && msg.type === 'chat');

                if (exampleMessages.length === 0) {
                    container.innerHTML = `<div class="text-gray-400 text-center">No example dialogue found. Add a turn to start.</div>`;
                    return;
                }

                container.innerHTML = exampleMessages.map((msg, idx) => {
                    const speakerOptions = [userChar, ...aiChars].map(char => DOM.html`<option value="${char.id}" ${msg.character_id === char.id ? 'selected' : ''}>${char.name}</option>`);
                    return DOM.html`
                <div class="bg-black/20 p-4 rounded-lg flex items-center space-x-4">
                    <div class="flex flex-col space-y-2">
                        <button data-action="move-example-turn" data-index="${msg.originalIndex}" data-direction="up" ${idx === 0 ? 'disabled' : ''} class="bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:opacity-50 text-white font-bold p-2 rounded-lg" title="Move Up"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path></svg></button>
                        <button data-action="move-example-turn" data-index="${msg.originalIndex}" data-direction="down" ${idx === exampleMessages.length - 1 ? 'disabled' : ''} class="bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:opacity-50 text-white font-bold p-2 rounded-lg" title="Move Down"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></button>
                    </div>
                    <div class="flex-grow flex flex-col space-y-2">
                        <select onchange="NarrativeController.updateExampleDialogueTurn(${msg.originalIndex}, 'character_id', this.value)" class="w-full bg-gray-700 border-gray-600 rounded p-2 text-sm">${speakerOptions}</select>
                        <textarea oninput="NarrativeController.updateExampleDialogueTurn(${msg.originalIndex}, 'content', this.value)" class="w-full bg-gray-900/80 border-gray-600 p-2 resize-none rounded-md">${msg.content}</textarea>
                    </div>
                    <button data-action="delete-example-turn" data-index="${msg.originalIndex}" class="text-xs bg-red-900/50 hover:bg-red-700/80 text-red-200 font-semibold py-2 px-3 rounded" title="Delete Turn"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                </div>
            `;
                }).join('');

                const textareas = container.querySelectorAll('textarea');
                textareas.forEach(textarea => {
                    const autoResize = () => { textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight}px`; };
                    textarea.addEventListener('input', autoResize);
                    setTimeout(autoResize, 0);
                });
            },

            /**
             * Updates the side portrait image based on the last speaker.
             */
            updateSidePortrait() {
                const state = StateManager.getState();
                const portraitContainer = document.getElementById('character-portrait-container');
                const chatWindow = document.getElementById('chat-window');
                const globalSettings = StateManager.data.globalSettings;

                // Check Layout Mode AND the User Preference
                const showPanel = globalSettings.showPortraitPanel !== false; // Default true

                // Visual Novel Mode layout override
                if (state.characterImageMode === 'visual_novel') {
                    if (portraitContainer) {
                        portraitContainer.style.display = 'none';
                        portraitContainer.innerHTML = '';
                    }
                    const vnContainer = document.getElementById('vn-container');
                    if (vnContainer) vnContainer.classList.remove('hidden');
                    this.updateVisualNovelModeUI(state);
                    return;
                } else {
                    const vnContainer = document.getElementById('vn-container');
                    if (vnContainer) vnContainer.classList.add('hidden');
                    if (this.RUNTIME.typewriterTimeout) {
                        clearTimeout(this.RUNTIME.typewriterTimeout);
                        this.RUNTIME.typewriterTimeout = null;
                    }
                }

                // Vertical Layout (Mobile) always hides desktop portrait container
                if (document.body.classList.contains('layout-vertical')) {
                    if (portraitContainer) {
                        portraitContainer.style.display = 'none';
                        portraitContainer.innerHTML = '';
                    }
                    // Reset chat window styles for mobile to Defaults
                    if (chatWindow) {
                        chatWindow.style.width = '';
                        chatWindow.style.maxWidth = '';
                        chatWindow.style.margin = '';
                    }
                    return;
                }

                // Horizontal Layout (Desktop)
                if (portraitContainer && chatWindow) {
                    if (!showPanel) {
                        // If user disabled it, hide it and expand chat
                        portraitContainer.style.display = 'none';
                        portraitContainer.innerHTML = '';

                        // Adjust Chat Window to be centered and wider
                        chatWindow.style.width = '100%';
                        chatWindow.style.maxWidth = '900px'; // Prevent it from stretching too wide
                        chatWindow.style.margin = '0 auto';
                    } else {
                        // Restore default styles if enabled
                        portraitContainer.style.display = 'flex';

                        // Default horizontal layout style: 65% width, aligned next to portrait
                        chatWindow.style.width = '65%';
                        chatWindow.style.maxWidth = '100%';
                        chatWindow.style.margin = '0'; // IMPORTANT: Reset auto margin to align left
                    }
                }

                const lastChatMessages = (state.chat_history || [])
                    .filter(m => m.type === 'chat' && !m.isHidden && !ReactiveStore.getCharacter(m.character_id)?.is_user);
                const lastSpeakerMsg = lastChatMessages.length ? lastChatMessages[lastChatMessages.length - 1] : null;
                const lastSpeaker = lastSpeakerMsg ? ReactiveStore.getCharacter(lastSpeakerMsg.character_id) : null;

                if (!lastSpeaker) {
                    if (portraitContainer) portraitContainer.innerHTML = '';
                    return;
                }

                const mood = lastSpeakerMsg?.emotion || 'neutral';
                const portraitUrl = UIManager.getPortraitSrc(lastSpeaker, mood);

                if (!portraitUrl) {
                    if (portraitContainer) portraitContainer.innerHTML = '';
                    return;
                }

                if (portraitContainer) {
                    portraitContainer.innerHTML = DOM.html`<img src="${portraitUrl}" class="max-w-full max-h-full object-contain rounded-lg">`.toString();
                }
            },

            /**
             * Renders and updates the visual novel interface elements.
             * @param {Object} state - The current application state.
             */
            updateVisualNovelModeUI(state) {
                // Self-healing: Ensure every message in chat history has a unique ID
                if (state.chat_history) {
                    for (const msg of state.chat_history) {
                        if (msg && !msg.id) {
                            msg.id = UTILITY.uuid();
                        }
                    }
                }

                // 1. Get Active NPCs (excluding user and narrators)
                const activeNPCs = [...(state.characters || []), ...ReactiveStore.getActiveLocationCharacters()]
                    .filter(c => !c.is_user && !c.is_narrator && c.is_active);

                // Deduplicate by character ID
                const seen = new Set();
                const dedupedNPCs = [];
                for (const npc of activeNPCs) {
                    if (!seen.has(npc.id)) {
                        seen.add(npc.id);
                        dedupedNPCs.push(npc);
                    }
                }

                // 2. Identify the target message based on history index
                const visibleMessages = (state.chat_history || [])
                    .filter(m => m.type === 'chat' && !m.isHidden);

                let targetMsg = null;
                let targetMsgIndex = -1;

                if (visibleMessages.length > 0) {
                    if (this.RUNTIME.vnHistoryIndex !== null && this.RUNTIME.vnHistoryIndex >= 0 && this.RUNTIME.vnHistoryIndex < visibleMessages.length) {
                        targetMsgIndex = this.RUNTIME.vnHistoryIndex;
                    } else {
                        targetMsgIndex = visibleMessages.length - 1;
                        this.RUNTIME.vnHistoryIndex = null; // Normalize to null
                    }
                    targetMsg = visibleMessages[targetMsgIndex];
                }

                let activeSpeakerId = targetMsg ? targetMsg.character_id : null;
                let historyIndex = -1;
                if (targetMsg && state.chat_history) {
                    historyIndex = state.chat_history.findIndex(m => m.id === targetMsg.id);
                    if (historyIndex === -1) {
                        historyIndex = state.chat_history.indexOf(targetMsg);
                    }
                }

                // Ensure the active speaker is always in the pool of NPCs to cast from (even if inactive or not in current location)
                if (activeSpeakerId) {
                    const speakerObj = ReactiveStore.getCharacter(activeSpeakerId);
                    if (speakerObj && !speakerObj.is_user && !speakerObj.is_narrator) {
                        if (!seen.has(speakerObj.id)) {
                            seen.add(speakerObj.id);
                            dedupedNPCs.push(speakerObj);
                        }
                    }
                }

                // 3. Determine which characters should be visible in VN mode using the recency/casting logic
                const recentIds = [];
                if (state.chat_history && historyIndex !== -1) {
                    for (let i = historyIndex; i >= 0; i--) {
                        const m = state.chat_history[i];
                        if (m && m.type === 'chat') {
                            recentIds.push(m.character_id);
                        }
                    }
                }

                const sortedByRecency = [...dedupedNPCs].sort((a, b) => {
                    const ai = recentIds.indexOf(a.id);
                    const bi = recentIds.indexOf(b.id);
                    const scoreA = ai === -1 ? 999999 : ai;
                    const scoreB = bi === -1 ? 999999 : bi;
                    if (scoreA !== scoreB) {
                        return scoreA - scoreB;
                    }
                    // Fallback to alphabetical sorting if both have the same recency
                    return (a.name || '').localeCompare(b.name || '');
                });

                // Take up to 3
                const cappedNPCs = sortedByRecency.slice(0, 3);

                // Sort alphabetically to keep their on-screen positions stable
                cappedNPCs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

                // --- Resolve Visual Novel Background Image (Chronological Timeline Matcher) ---
                let defaultBackgroundUrl = '';

                // 1. Get the Overall Background Image (Priority 3 - Base)
                if (state.backgroundImageURL) {
                    if (state.backgroundImageURL.startsWith('local_idb_')) {
                        if (UIManager.RUNTIME.globalBackgroundImageCache) {
                            defaultBackgroundUrl = UIManager.RUNTIME.globalBackgroundImageCache;
                        }
                    } else if (!state.backgroundImageURL.includes('${imgSrc}')) {
                        defaultBackgroundUrl = state.backgroundImageURL;
                    }
                }

                if (!defaultBackgroundUrl) {
                    defaultBackgroundUrl = UTILITY.appAssetUrl('assets/demo/hearthstone_inn.png');
                }

                // Start background Url at overall background image
                let backgroundUrl = defaultBackgroundUrl;

                // Seed location-specific background for starting point (4,4 or current worldMap coords) (Priority 2)
                let currentX = 4;
                let currentY = 4;
                if (state.worldMap && state.worldMap.currentLocation && typeof state.worldMap.currentLocation.x === 'number') {
                    currentX = state.worldMap.currentLocation.x;
                    currentY = state.worldMap.currentLocation.y;
                }

                if (state.worldMap && state.worldMap.grid) {
                    const startLoc = state.worldMap.grid.find(l => l.coords.x === currentX && l.coords.y === currentY);
                    if (startLoc) {
                        const locationKey = `location::${currentX},${currentY}`;
                        if (UIManager.RUNTIME.worldImageCache && UIManager.RUNTIME.worldImageCache[locationKey]) {
                            backgroundUrl = UIManager.RUNTIME.worldImageCache[locationKey];
                        } else if (startLoc.imageUrl) {
                            if (startLoc.imageUrl.startsWith('local_idb_location')) {
                                this.hydrateLocationImage(startLoc.imageUrl);
                            } else {
                                backgroundUrl = startLoc.imageUrl;
                            }
                        }
                    }
                }

                // 2. Play back history chronologically to resolve latest state (Priority 1)
                const fullHistory = state.chat_history || [];
                if (fullHistory.length > 0) {
                    let playbackLimitIdx = fullHistory.length - 1;
                    if (this.RUNTIME.vnHistoryIndex !== null && targetMsg) {
                        let targetIdx = fullHistory.findIndex(m => m.id === targetMsg.id);
                        if (targetIdx === -1) {
                            targetIdx = fullHistory.indexOf(targetMsg);
                        }
                        if (targetIdx !== -1) {
                            playbackLimitIdx = targetIdx;
                        }
                    }

                    // Reset history simulation coordinates
                    let playbackX = 4;
                    let playbackY = 4;

                    // Set background at simulation start (start coords 4,4 location image, or fallback to default)
                    if (state.worldMap && state.worldMap.grid) {
                        const startLoc = state.worldMap.grid.find(l => l.coords.x === playbackX && l.coords.y === playbackY);
                        if (startLoc) {
                            const locationKey = `location::${playbackX},${playbackY}`;
                            if (UIManager.RUNTIME.worldImageCache && UIManager.RUNTIME.worldImageCache[locationKey]) {
                                backgroundUrl = UIManager.RUNTIME.worldImageCache[locationKey];
                            } else if (startLoc.imageUrl) {
                                if (startLoc.imageUrl.startsWith('local_idb_location')) {
                                    this.hydrateLocationImage(startLoc.imageUrl);
                                } else {
                                    backgroundUrl = startLoc.imageUrl;
                                }
                            } else {
                                backgroundUrl = defaultBackgroundUrl;
                            }
                        }
                    }

                    // Play back history chronologically
                    for (let i = 0; i <= playbackLimitIdx; i++) {
                        const msg = fullHistory[i];
                        if (!msg) continue;

                        // A: Handle Location Change system messages
                        if (msg.type === 'system' && msg.content && msg.content.startsWith('You have moved to ')) {
                            const locName = msg.content.substring('You have moved to '.length).replace(/\.$/, '').trim();
                            if (state.worldMap && state.worldMap.grid) {
                                const loc = state.worldMap.grid.find(l => l.name === locName);
                                if (loc) {
                                    playbackX = loc.coords.x;
                                    playbackY = loc.coords.y;
                                    const locationKey = `location::${playbackX},${playbackY}`;
                                    if (UIManager.RUNTIME.worldImageCache && UIManager.RUNTIME.worldImageCache[locationKey]) {
                                        backgroundUrl = UIManager.RUNTIME.worldImageCache[locationKey];
                                    } else if (loc.imageUrl) {
                                        if (loc.imageUrl.startsWith('local_idb_location')) {
                                            this.hydrateLocationImage(loc.imageUrl);
                                        } else {
                                            backgroundUrl = loc.imageUrl;
                                        }
                                    } else {
                                        backgroundUrl = defaultBackgroundUrl;
                                    }
                                }
                            }
                        }

                        // B: Handle Visual Master Generated Images (overrides location or default up to this point)
                        if (msg.type === 'visual_event' && msg.image_key && !msg.isLoading) {
                            const cacheUrl = typeof VisualMaster !== 'undefined' ? VisualMaster.RUNTIME.imageUrls[msg.image_key] : null;
                            if (cacheUrl) {
                                backgroundUrl = cacheUrl;
                            } else {
                                // Trigger async load to cache it
                                DBService.getImage(msg.image_key).then(blob => {
                                    if (blob && typeof VisualMaster !== 'undefined') {
                                        VisualMaster.RUNTIME.imageUrls[msg.image_key] = URL.createObjectURL(blob);
                                        UIManager.renderChat();
                                    }
                                }).catch(() => { });
                            }
                        }
                    }
                }

                // Apply the background image transition
                if (backgroundUrl && backgroundUrl !== this.RUNTIME.lastCinematicImageUrl) {
                    this.RUNTIME.lastCinematicImageUrl = backgroundUrl;
                    const bg1 = document.getElementById('cinematic-bg-1');
                    const bg2 = document.getElementById('cinematic-bg-2');
                    if (bg1 && bg2) {
                        const activeBg = this.RUNTIME.activeCinematicBg;
                        const nextBg = activeBg === 1 ? bg2 : bg1;
                        const currentBg = activeBg === 1 ? bg1 : bg2;

                        UTILITY.safeBackgroundSet(nextBg, backgroundUrl);
                        nextBg.style.opacity = 1;
                        currentBg.style.opacity = 0;

                        // Apply the transition classes for blur effect
                        nextBg.classList.remove('vn-bg-inactive');
                        nextBg.classList.add('vn-bg-active');
                        currentBg.classList.remove('vn-bg-active');
                        currentBg.classList.add('vn-bg-inactive');

                        this.RUNTIME.activeCinematicBg = activeBg === 1 ? 2 : 1;
                    }
                }

                // 3. Render Sprites
                const spritesContainer = document.getElementById('vn-sprites-container');
                if (spritesContainer) {
                    spritesContainer.innerHTML = '';
                    for (const npc of cappedNPCs) {
                        const isSpeaking = npc.id === activeSpeakerId;

                        // Find this NPC's emotion at or before the target message
                        let npcEmotion = 'neutral';
                        for (let i = targetMsgIndex; i >= 0; i--) {
                            const msg = visibleMessages[i];
                            if (msg.character_id === npc.id) {
                                npcEmotion = msg.emotion || 'neutral';
                                break;
                            }
                        }

                        const portraitUrl = this.getPortraitSrc(npc, npcEmotion);
                        if (!portraitUrl) continue;

                        // Check if we have an explicit custom sprite for the emotion, or if we use fallback tint
                        const cache = UIManager.RUNTIME.characterImageCache || {};
                        const emoKey = npcEmotion && npcEmotion !== 'neutral' ? `${npc.id}::emotion::${npcEmotion}` : null;
                        const hasCustomEmotion = emoKey && cache[emoKey] && !cache[emoKey].includes('${imgSrc}');

                        let tintClass = '';
                        if (!hasCustomEmotion && npcEmotion && npcEmotion !== 'neutral') {
                            if (['happy', 'sad', 'angry', 'fear'].includes(npcEmotion)) {
                                tintClass = `tint-${npcEmotion}`;
                            }
                        }

                        const statusClass = isSpeaking ? 'active' : 'inactive';

                        const wrapper = document.createElement('div');
                        wrapper.className = `vn-sprite-wrapper ${statusClass} ${tintClass}`;
                        wrapper.innerHTML = DOM.html`
                            <img src="${portraitUrl}" class="vn-sprite">
                        `.toString();

                        spritesContainer.appendChild(wrapper);
                    }
                }

                // Update navigation controls and progress indicator
                const prevBtn = document.getElementById('vn-nav-up');
                const nextBtn = document.getElementById('vn-nav-down');
                const indicatorEl = document.getElementById('vn-nav-indicator');
                const latestBtn = document.getElementById('vn-nav-latest');

                if (prevBtn && nextBtn && indicatorEl) {
                    if (visibleMessages.length > 0) {
                        // Progress indicator formatted as [Current Message Index / Total Messages]
                        const displayIndex = targetMsgIndex + 1;
                        indicatorEl.textContent = `${displayIndex}/${visibleMessages.length}`;

                        // Enable/disable navigation buttons based on boundaries
                        prevBtn.disabled = (targetMsgIndex <= 0);
                        nextBtn.disabled = (this.RUNTIME.vnHistoryIndex === null || targetMsgIndex >= visibleMessages.length - 1);

                        if (latestBtn) {
                            if (this.RUNTIME.vnHistoryIndex !== null) {
                                latestBtn.classList.remove('hidden');
                            } else {
                                latestBtn.classList.add('hidden');
                            }
                        }
                    } else {
                        indicatorEl.textContent = '0/0';
                        prevBtn.disabled = true;
                        nextBtn.disabled = true;
                        if (latestBtn) latestBtn.classList.add('hidden');
                    }
                }

                // 4. Render dialogue HUD typewriter / immediate content
                const dialogueEl = document.getElementById('vn-dialogue');
                const nameplateEl = document.getElementById('vn-nameplate');

                if (!targetMsg) {
                    if (dialogueEl) dialogueEl.innerHTML = '';
                    if (nameplateEl) nameplateEl.classList.add('hidden');
                    return;
                }

                // Nameplate
                const speaker = ReactiveStore.getCharacter(targetMsg.character_id) || { name: 'Narrator' };
                if (nameplateEl) {
                    if (speaker && !speaker.is_narrator && speaker.name !== 'Narrator') {
                        nameplateEl.textContent = speaker.name;
                        nameplateEl.setAttribute('data-action', 'open-character-detail');
                        nameplateEl.setAttribute('data-id', speaker.id);
                        nameplateEl.classList.remove('hidden');
                    } else {
                        nameplateEl.removeAttribute('data-action');
                        nameplateEl.removeAttribute('data-id');
                        nameplateEl.classList.add('hidden');
                    }
                }

                // Set data-message-index on vn-hud and render controls
                const hudEl = document.getElementById('vn-hud');
                if (hudEl) {
                    if (targetMsgIndex !== -1) {
                        hudEl.setAttribute('data-message-index', targetMsgIndex);
                    } else {
                        hudEl.removeAttribute('data-message-index');
                    }
                }

                const controlsContainer = document.getElementById('vn-controls-container');
                if (controlsContainer) {
                    if (targetMsgIndex !== -1 && historyIndex !== -1) {
                        let imageGenBtn = '';
                        try {
                            const allowImageGen = (typeof StateManager !== 'undefined' && StateManager.data && StateManager.data.globalSettings && StateManager.data.globalSettings.imageGenBackend !== 'disabled');
                            if (allowImageGen) {
                                imageGenBtn = `
                                    <button onclick="event.stopPropagation(); VisualMaster.triggerVisualEvent(${historyIndex}, this)" class="hover:text-indigo-400" title="Generate Image">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                    </button>
                                `;
                            }
                        } catch (e) { console.warn(e); }

                        let thinkingBtn = '';
                        const targetMsg = state.chat_history[historyIndex];
                        const curVer = targetMsg ? (targetMsg.currentVersion || 0) : 0;
                        const hasTargetThinking = Boolean(targetMsg && (targetMsg.thinking || (targetMsg.versions && targetMsg.versions[curVer]?.thinking)));
                        if (hasTargetThinking) {
                            thinkingBtn = `
                                <button data-action="view-message-thinking" data-index="${historyIndex}" class="hover:text-purple-400" title="View Thinking">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>
                                </button>
                            `;
                        }

                        controlsContainer.innerHTML = `
                            <div class="vn-controls" onclick="event.stopPropagation();">
                                ${imageGenBtn}
                                ${thinkingBtn}
                                <button data-action="create-static-from-message" data-index="${historyIndex}" class="hover:text-emerald-400" title="Create Static Memory">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                                </button>
                                <button data-action="chat-copy" data-index="${historyIndex}" class="hover:text-blue-400" title="Copy to Clipboard">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                                </button>
                                <button data-action="chat-edit" data-index="${historyIndex}" class="hover:text-white" title="Edit">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                </button>
                                <button data-action="confirm-delete-message" data-index="${historyIndex}" class="hover:text-red-400" title="Delete">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                </button>
                            </div>
                        `;
                    } else {
                        controlsContainer.innerHTML = '';
                    }
                }

                const userChar = state.characters.find(c => c.is_user);
                const characterName = speaker ? speaker.name : '';
                const userName = userChar ? userChar.name : 'You';
                const replacer = (text) => (text || '').replace(/{character}/g, characterName).replace(/{user}/g, userName);

                // Trim and run standard placeholders replacement
                let processedContent = replacer(targetMsg.content).trim();

                // Preserve Arbitrary Newlines (3 or more)
                processedContent = processedContent.replace(/\n{3,}/g, (match) => '<br>'.repeat(match.length));

                // Apply standard smart quote formatting (uses dialogue-quote style)
                const styledContent = processedContent
                    .replace(/(["“][^"”]*["”])/g, `<span class="dialogue-quote">$1</span>`)
                    .replace(/(^|\s)'((?:[^']|'(?=\w)){2,})'(?=\s|[.,!?;:]|$)/gm, `$1<span class="dialogue-quote">'$2'</span>`);

                // Parse content to HTML via marked, then trim it
                const html = (typeof marked !== 'undefined')
                    ? marked.parse(styledContent || '').trim()
                    : styledContent.replace(/\n/g, '<br>');

                // If browsing history, show immediately without typewriter delay/animation
                const isHistoryBrowse = this.RUNTIME.vnHistoryIndex !== null && this.RUNTIME.vnHistoryIndex !== visibleMessages.length - 1;
                if (isHistoryBrowse) {
                    if (dialogueEl) {
                        dialogueEl.innerHTML = html;
                        UIManager.RUNTIME.isTypewriterActive = false;
                        if (UIManager.RUNTIME.typewriterTimeout) {
                            clearTimeout(UIManager.RUNTIME.typewriterTimeout);
                            UIManager.RUNTIME.typewriterTimeout = null;
                        }
                    }
                    UIManager.RUNTIME.lastDialogueMsgId = targetMsg.id;
                    UIManager.RUNTIME.lastDialogueContent = targetMsg.content;
                    return;
                }

                const isNewMessage = UIManager.RUNTIME.lastDialogueMsgId !== targetMsg.id;
                const isContentChanged = UIManager.RUNTIME.lastDialogueContent !== targetMsg.content;

                if (!isNewMessage && !isContentChanged) {
                    if (!UIManager.RUNTIME.isTypewriterActive && dialogueEl) {
                        dialogueEl.innerHTML = html;
                    }
                    return;
                }

                UIManager.RUNTIME.lastDialogueMsgId = targetMsg.id;
                UIManager.RUNTIME.lastDialogueContent = targetMsg.content;

                if (!isNewMessage && isContentChanged) {
                    // Active stream updating
                    if (dialogueEl) dialogueEl.innerHTML = html;
                    UIManager.RUNTIME.isTypewriterActive = false;
                    return;
                }

                // Brand new message -> trigger typewriter
                if (dialogueEl) {
                    dialogueEl.innerHTML = '';
                    UIManager.RUNTIME.isTypewriterActive = true;

                    const tokens = UTILITY.tokenizeHtml(html);
                    let tokenIndex = 0;
                    let currentHtml = '';

                    // Clear old timeout
                    if (UIManager.RUNTIME.typewriterTimeout) {
                        clearTimeout(UIManager.RUNTIME.typewriterTimeout);
                        UIManager.RUNTIME.typewriterTimeout = null;
                    }

                    // Setup skip handler
                    UIManager.RUNTIME.skipTypewriter = () => {
                        if (!UIManager.RUNTIME.isTypewriterActive) return;
                        UIManager.RUNTIME.isTypewriterActive = false;
                        if (UIManager.RUNTIME.typewriterTimeout) {
                            clearTimeout(UIManager.RUNTIME.typewriterTimeout);
                            UIManager.RUNTIME.typewriterTimeout = null;
                        }
                        dialogueEl.innerHTML = html;
                    };

                    const typeNextToken = () => {
                        if (!UIManager.RUNTIME.isTypewriterActive) return;
                        if (tokenIndex >= tokens.length) {
                            UIManager.RUNTIME.isTypewriterActive = false;
                            return;
                        }

                        const token = tokens[tokenIndex];
                        currentHtml += token.value;
                        dialogueEl.innerHTML = currentHtml;
                        tokenIndex++;

                        if (token.type === 'tag' || token.type === 'entity') {
                            typeNextToken();
                        } else {
                            UIManager.RUNTIME.typewriterTimeout = setTimeout(typeNextToken, 15);
                        }
                    };

                    typeNextToken();
                }
            },

            /**
             * Scrolls Visual Novel history back or forward.
             * @param {number} direction - -1 to go back, 1 to go forward.
             */
            scrollVnHistory(direction) {
                const state = StateManager.getState();
                if (!state || state.characterImageMode !== 'visual_novel') return;

                const visibleMessages = (state.chat_history || [])
                    .filter(m => m.type === 'chat' && !m.isHidden);

                if (visibleMessages.length === 0) return;

                let currentIndex = this.RUNTIME.vnHistoryIndex;
                if (currentIndex === null) {
                    currentIndex = visibleMessages.length - 1;
                }

                let newIndex = currentIndex + direction;

                if (newIndex < 0) {
                    newIndex = 0; // Boundary
                } else if (newIndex >= visibleMessages.length) {
                    newIndex = null; // Return to latest mode
                } else if (newIndex === visibleMessages.length - 1) {
                    newIndex = null; // Exit history mode when back to the latest
                }

                this.RUNTIME.vnHistoryIndex = newIndex;

                // Re-render the VN interface
                this.updateVisualNovelModeUI(state);
            },



            /**
             * Processes and displays the full response from the AI immediately.
             * (Formerly startStreamingResponse, streaming effect removed per user request).
             * @param {string} charId - The ID of the speaking character.
             * @param {string} fullText - The full text to display.
             * @param {string} emotion - The emotion of the character.
             * @param {number|null} targetMessageIndex - If set, updates an existing message (Versioning support).
             */
            startStreamingResponse(charId, fullText, emotion, targetMessageIndex = null, images = [], thinking = null) {
                if (typeof NarrativeController !== 'undefined') {
                    NarrativeController.startStreamingResponse(charId, fullText, emotion, targetMessageIndex, images, thinking);
                }
            },

            /**
             * Displays a typing indicator for a specific character.
             * @param {string} charId - The ID of the character thinking.
             * @param {string} [text="is thinking..."] - The text to display.
             * @param {string} [nameOverride=null] - Optional override for the character name (e.g. for Scriptwriter).
             */
            showTypingIndicator(charId, text = "is thinking...", nameOverride = null) {
                // PERSIST STATE: Save this so we can restore it after a render
                this.RUNTIME.typingIndicatorState = { charId, text, nameOverride };

                this.hideTypingIndicator(false); // Don't clear state, just remove element

                const chatWindow = document.getElementById('chat-window');
                const state = StateManager.getState();
                const character = (state.characters || []).find(c => c.id === charId);
                const name = nameOverride || character?.name || 'System';

                // Color Logic
                const defaultColor = (character && character.is_user)
                    ? { base: '#4b5563', bold: '#e5e7eb' }
                    : { base: '#334155', bold: '#94a3b8' };

                const charColor = (character && character.color) ? character.color : defaultColor;
                const bubbleOpacity = state.bubbleOpacity !== undefined ? state.bubbleOpacity : 0.95;

                const topColor = UTILITY.hexToRgba(charColor.base, bubbleOpacity);
                const bottomColor = UTILITY.hexToRgba(UTILITY.darkenHex(charColor.base, 10), bubbleOpacity);

                const bubbleStyle = `background-image: linear-gradient(to bottom, ${topColor}, ${bottomColor});`;
                const nameStyle = `color: ${charColor.bold};`;
                const textStyle = `color: ${state.chatTextColor || '#e5e7eb'};`;

                const indicator = document.createElement('div');
                indicator.id = 'typing-indicator';

                indicator.className = 'chat-bubble-container';
                indicator.innerHTML = DOM.html`
            <div class="mb-4 flex flex-col items-start">
                <p class="font-bold text-sm mb-1" style="${DOM.unsafe(nameStyle)}">${name}</p>
                <div class="p-3 rounded-lg typing-bubble-pulse" style="${DOM.unsafe(bubbleStyle)}">
                    <p class="italic" style="${DOM.unsafe(textStyle)}">${text}</p>
                </div>
            </div>`.toString();

                chatWindow.appendChild(indicator);
                chatWindow.scrollTop = chatWindow.scrollHeight;
            },

            /**
             * Hides the current typing indicator.
             * @param {boolean} clearState - Whether to clear the persistent state (default: true).
             */
            hideTypingIndicator(clearState = true) {
                if (clearState) {
                    this.RUNTIME.typingIndicatorState = null;
                }
                const el = document.getElementById('typing-indicator');
                if (el) el.remove();
            },

            /**
             * Applies global styling based on the current state.
             * Updates background images, blur, fonts, and colors.
             */
            applyStyling() {
                const state = StateManager.getState();
                const backgroundElement = document.getElementById('global-background');

                // 1. Handle Background Image Logic
                let backgroundUrl = '';

                // Priority 1: Location Image (World Map)
                if (state.worldMap && state.worldMap.grid.length > 0 && state.worldMap.currentLocation) {
                    const currentLoc = state.worldMap.grid.find(loc => loc.coords.x === state.worldMap.currentLocation.x && loc.coords.y === state.worldMap.currentLocation.y);
                    if (currentLoc) {
                        const locationKey = `location::${currentLoc.coords.x},${currentLoc.coords.y}`;
                        UIManager.RUNTIME.worldImageCache = UIManager.RUNTIME.worldImageCache || {};

                        if (UIManager.RUNTIME.worldImageCache[locationKey]) {
                            backgroundUrl = UIManager.RUNTIME.worldImageCache[locationKey];
                        }
                        else if (currentLoc.imageUrl && !currentLoc.imageUrl.startsWith('local_idb_location')) {
                            backgroundUrl = currentLoc.imageUrl;
                        }
                        // HYDRATION FIX: If it SHOULD be a local IDB image, but it's not in cache, fetch it.
                        else if (currentLoc.imageUrl && currentLoc.imageUrl.startsWith('local_idb_location')) {
                            // Trigger async load, but don't block render.
                            // Pass the *stored* key (e.g. local_idb_location::4,4) to the hydration helper
                            // The helper expects the raw IDB key, which is "location::4,4" usually?
                            // Let's check how we save it. 
                            // In WorldController.handleWorldMapLocationImageUpload: 
                            // locationKey = `location::${x},${y}`;
                            // location.imageUrl = `local_idb_location::${x},${y}`;
                            // So we strip the prefix.
                            this.hydrateLocationImage(currentLoc.imageUrl);
                        }
                    }
                }

                // Priority 2: Story Setting
                // Only use the cache if the setting explicitly requests the local IDB image.
                // Logic: If Priority 1 set a backgroundUrl, we should skip this block.

                if (!backgroundUrl) {
                    // Handle any local_idb_ prefix by checking the cache
                    if (state.backgroundImageURL && state.backgroundImageURL.startsWith('local_idb_')) {
                        if (UIManager.RUNTIME.globalBackgroundImageCache) {
                            backgroundUrl = UIManager.RUNTIME.globalBackgroundImageCache;
                        }
                    }
                    else if (state.backgroundImageURL) {
                        backgroundUrl = state.backgroundImageURL;
                    }
                }

                if (backgroundElement) {
                    UTILITY.safeBackgroundSet(backgroundElement, backgroundUrl);
                }

                // 2. Handle Base UI Settings
                document.getElementById('app-container').style.backdropFilter = `blur(${state.backgroundBlur || 0}px)`;
                document.documentElement.style.setProperty('--chat-font-size', `${state.textSize || 16}px`);
                document.documentElement.style.setProperty('--bubble-image-size', `${state.bubbleImageSize || 100}px`);

                // 3. Calculate Border Hue from Text Color
                const hexToRgb = (hex) => {
                    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                    return result ? {
                        r: parseInt(result[1], 16),
                        g: parseInt(result[2], 16),
                        b: parseInt(result[3], 16)
                    } : null;
                };

                const rgb = hexToRgb(state.chatTextColor);
                if (rgb) {
                    document.documentElement.style.setProperty('--border-hue-color', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`);
                }

                document.documentElement.style.setProperty('--chat-text-color', state.chatTextColor);
                document.documentElement.style.setProperty('--chat-font-family', state.font);

                // 4. Sync Titles
                const storyTitleInput = document.getElementById('story-title-input');
                const mobileStoryTitleOverlay = document.getElementById('mobile-story-title-overlay');
                if (storyTitleInput) {
                    storyTitleInput.style.color = state.chatTextColor;
                    storyTitleInput.style.fontFamily = state.font;
                }
                if (mobileStoryTitleOverlay) {
                    mobileStoryTitleOverlay.style.color = state.chatTextColor;
                    mobileStoryTitleOverlay.style.fontFamily = state.font;
                }

                // 5. Apply Markdown Colors & Fonts
                const defaults = UTILITY.getDefaultUiSettings();
                const root = document.documentElement;
                const chatFont = state.font || defaults.font;

                // Colors
                root.style.setProperty('--md-h1-color', state.md_h1_color || defaults.md_h1_color);
                root.style.setProperty('--md-h2-color', state.md_h2_color || defaults.md_h2_color);
                root.style.setProperty('--md-h3-color', state.md_h3_color || defaults.md_h3_color);
                root.style.setProperty('--md-bold-color', state.md_bold_color || defaults.md_bold_color);
                root.style.setProperty('--md-italic-color', state.md_italic_color || defaults.md_italic_color);
                root.style.setProperty('--md-quote-color', state.md_quote_color || defaults.md_quote_color);

                // Fonts (Fallback to chat font if empty)
                root.style.setProperty('--md-h1-font', state.md_h1_font || chatFont);
                root.style.setProperty('--md-h2-font', state.md_h2_font || chatFont);
                root.style.setProperty('--md-h3-font', state.md_h3_font || chatFont);
                root.style.setProperty('--md-bold-font', state.md_bold_font || chatFont);
                root.style.setProperty('--md-italic-font', state.md_italic_font || chatFont);
                root.style.setProperty('--md-quote-font', state.md_quote_font || chatFont);

                // Smart Quote Logic
                // If the user is using the default color (#9ca3af), we use the original "Filter" style (inherit + opacity/saturation).
                // If the user picked a CUSTOM color, we disable the filter so the color appears exactly as chosen.
                const defaultQuoteColor = '#9ca3af';
                const isDefaultQuote = (state.md_quote_color || defaultQuoteColor).toLowerCase() === defaultQuoteColor.toLowerCase();

                if (isDefaultQuote) {
                    // Restore original cinematic look
                    root.style.setProperty('--active-quote-color', 'inherit');
                    root.style.setProperty('--active-quote-filter', 'saturate(175%) opacity(75%) drop-shadow(1px 1px 5px black)');
                } else {
                    // Use exact user color with a standard shadow (no opacity/saturation filter)
                    root.style.setProperty('--active-quote-color', state.md_quote_color);
                    root.style.setProperty('--active-quote-filter', 'drop-shadow(1px 1px 2px rgba(0,0,0,0.5))');
                }

                this.renderChat();
            },



            /**
             * Hydrates a location image from IndexDB into the runtime cache.
             * @param {string} locationUrl - The stored image URL (e.g. 'local_idb_location::4,4').
             */
            async hydrateLocationImage(locationUrl) {
                if (!locationUrl || !locationUrl.startsWith('local_idb_')) return;

                // key logic: remove the prefix?
                // In handleWorldMapLocationImageUpload: 
                // key = `location::${x},${y}`
                // saved url = `local_idb_location::${x},${y}`
                // So key = locationUrl.replace('local_idb_', '')

                const key = locationUrl.replace('local_idb_', ''); // "location::4,4"

                // Avoid double fetching
                UIManager.RUNTIME.worldImageCache = UIManager.RUNTIME.worldImageCache || {};
                if (UIManager.RUNTIME.worldImageCache[key]) return; // Already in cache

                try {
                    const blob = await DBService.getImage(key);
                    if (blob) {
                        const url = URL.createObjectURL(blob);
                        UIManager.RUNTIME.worldImageCache[key] = url;
                        // Re-apply styling to update the background immediately
                        this.applyStyling();

                        // Also re-render map execution if open (optional but nice)
                        // If map modal is open, re-render it
                        const mapModal = document.getElementById('world-map-modal');
                        if (mapModal && !mapModal.classList.contains('hidden')) {
                            this.renderWorldMapModal();
                        }
                    }
                } catch (e) {
                    console.warn("Hydration failed for", locationUrl, e);
                }
            },

            /**
             * Renders the World Map modal content.
             * Handles both "Move" and "World Map" (Edit) tabs.
             */
            renderWorldMapModal() {
                const state = StateManager.getState();
                const activeWorldMapTab = (typeof WorldController !== 'undefined') ? WorldController.RUNTIME.activeWorldMapTab : 'move';
                const pendingMove = (typeof WorldController !== 'undefined') ? WorldController.RUNTIME.pendingMove : null;
                const { worldMap } = state;
                const container = document.getElementById('world-map-modal-content');

                let contentHTML = '';
                // Only use columns for "Move" tab. "World Map" tab is now full width grid.
                const gridLayoutClass = activeWorldMapTab === 'move' ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1';

                if (activeWorldMapTab === 'move') {
                    // --- MOVE TAB LOGIC (Unchanged) ---
                    const { currentLocation } = worldMap;
                    let moveGridHTML = '';
                    // Generate 3x3 Grid centered on player
                    for (let y = currentLocation.y - 1; y <= currentLocation.y + 1; y++) {
                        for (let x = currentLocation.x - 1; x <= currentLocation.x + 1; x++) {
                            const isCenter = x === currentLocation.x && y === currentLocation.y;
                            const location = worldMap.grid.find(loc => loc.coords.x === x && loc.coords.y === y);
                            let imageSrc = '';
                            if (location) {
                                const locationKey = `location::${x},${y}`;
                                UIManager.RUNTIME.worldImageCache = UIManager.RUNTIME.worldImageCache || {};
                                if (UIManager.RUNTIME.worldImageCache[locationKey]) imageSrc = UIManager.RUNTIME.worldImageCache[locationKey];
                                else if (location.imageUrl && !location.imageUrl.startsWith('local_idb_location')) imageSrc = location.imageUrl;
                            }
                            const bgImage = imageSrc ? `background-image: url('${UTILITY.safeStyleUrl(imageSrc)}');` : '';
                            const isGenerating = (typeof WorldController !== 'undefined' && WorldController.RUNTIME.generatingTiles && WorldController.RUNTIME.generatingTiles.has(`${x},${y}`));
                            const isPainting = (typeof WorldController !== 'undefined' && WorldController.RUNTIME.generatingImages && WorldController.RUNTIME.generatingImages.has(`location::${x},${y}`));
                            let classList = ['aspect-square', 'rounded-lg', 'flex', 'items-center', 'justify-center', 'text-center', 'p-2', 'text-white', 'relative', 'overflow-hidden', 'bg-cover', 'bg-center', 'transition-all'];

                            if (isCenter) classList.push('bg-teal-800/80', 'ring-2', 'ring-teal-300');
                            else if (isGenerating) {
                                classList.push('animate-pulse', 'bg-sky-950/60', 'border', 'border-sky-500/50', 'text-sky-300', 'cursor-not-allowed');
                            }
                            else if (location) {
                                // If we have a background image, don't use the opaque gray background.
                                // Use a transparent black overlay to ensure text contrast if needed, but let the image shine.
                                if (imageSrc) classList.push('bg-black/20', 'cursor-pointer', 'hover:ring-2', 'hover:ring-sky-400');
                                else classList.push('bg-gray-700/80', 'cursor-pointer', 'hover:ring-2', 'hover:ring-sky-400');
                            }
                            else classList.push('bg-black/50');

                            if (pendingMove && pendingMove.x === x && pendingMove.y === y && !isCenter) classList.push('ring-4', 'ring-yellow-400');

                            if (isGenerating) {
                                moveGridHTML += DOM.html`
                                    <div class="${classList.join(' ')}">
                                        <div class="flex flex-col items-center justify-center gap-1 relative z-10">
                                            <svg class="animate-spin w-4 h-4 text-sky-400" viewBox="0 0 24 24" fill="none">
                                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            <span class="text-[9px] uppercase font-bold tracking-wider">Building...</span>
                                        </div>
                                    </div>`.toString();
                            } else if (location) {
                                const displayName = (location.name && location.name !== 'Undefined') ? location.name : '';
                                const paintingOverlay = isPainting ? `<div class="absolute inset-0 bg-amber-950/70 flex flex-col items-center justify-center gap-1 z-20"><svg class="animate-spin w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span class="text-[9px] text-amber-300 uppercase font-bold tracking-wider">Painting...</span></div>` : '';
                                moveGridHTML += DOM.html`<div class="${classList.join(' ')}" style="${DOM.unsafe(bgImage)}" ${!isCenter ? DOM.unsafe(`data-action="select-pending-move" data-x="${x}" data-y="${y}"`) : ''}>${DOM.unsafe(paintingOverlay)}<div class="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent"></div>${displayName ? DOM.html`<span class="relative z-10 text-sm font-bold">${displayName}</span>` : ''}</div>`.toString();
                            } else {
                                moveGridHTML += DOM.html`<div class="${classList.join(' ')}"></div>`.toString();
                            }
                        }
                    }

                    let detailsHTML = '';
                    const pendingLocation = pendingMove ? worldMap.grid.find(l => l.coords.x === pendingMove.x && l.coords.y === pendingMove.y) : null;
                    if (pendingLocation) {
                        detailsHTML = DOM.html`<h3 class="text-2xl font-bold">${pendingLocation.name}</h3><p class="text-gray-400 mt-2 flex-grow">${pendingLocation.description}</p><button data-action="confirm-move" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg mt-4">Confirm Move</button>`;
                    } else {
                        const currentLocationData = worldMap.grid.find(l => l.coords.x === currentLocation.x && l.coords.y === currentLocation.y);
                        detailsHTML = DOM.html`<h3 class="text-2xl font-bold">Movement</h3><p class="text-gray-400 mt-2">You are currently at <strong>${currentLocationData.name}</strong>.</p><p class="text-gray-400 mt-2">Select an adjacent tile to see its details and confirm your move.</p>`;
                    }

                    contentHTML = DOM.html`<div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-start h-full"><div class="grid grid-cols-3 gap-2">${DOM.unsafe(moveGridHTML)}</div><div class="flex flex-col h-full bg-black/20 p-4 rounded-lg">${detailsHTML}</div></div>`;

                } else {
                    // --- EDIT TAB LOGIC (Updated) ---
                    const { currentLocation, destination, path } = worldMap;
                    let mapGridHTML = '';
                    for (let y = 0; y < 8; y++) {
                        for (let x = 0; x < 8; x++) {
                            const location = worldMap.grid.find(loc => loc.coords.x === x && loc.coords.y === y);
                            // 1. Resolve Image for Edit Tab
                            let imageSrc = '';
                            if (location) {
                                const locationKey = `location::${x},${y}`;
                                UIManager.RUNTIME.worldImageCache = UIManager.RUNTIME.worldImageCache || {};
                                if (UIManager.RUNTIME.worldImageCache[locationKey]) imageSrc = UIManager.RUNTIME.worldImageCache[locationKey];
                                else if (location.imageUrl && !location.imageUrl.startsWith('local_idb_location')) imageSrc = location.imageUrl;
                            }

                            const isGenerating = (typeof WorldController !== 'undefined' && WorldController.RUNTIME.generatingTiles && WorldController.RUNTIME.generatingTiles.has(`${x},${y}`));
                            const isPainting = (typeof WorldController !== 'undefined' && WorldController.RUNTIME.generatingImages && WorldController.RUNTIME.generatingImages.has(`location::${x},${y}`));
                            let classList = [
                                'aspect-square', 'rounded', 'cursor-pointer', 'text-xs', 'p-1', 'overflow-hidden', 'leading-tight',
                                'flex', 'items-center', 'justify-center', 'text-center', 'transition-all', 'duration-200',
                                'bg-cover', 'bg-center', 'relative' // Added for image support
                            ];

                            // Subtle gradients for visibility
                            if (isGenerating) {
                                classList.push('animate-pulse', 'bg-sky-950/60', 'border', 'border-sky-500/50', 'text-sky-300', 'cursor-not-allowed');
                            } else if (location) {
                                if (imageSrc) {
                                    classList.push('bg-black/20', 'text-white', 'shadow-sm', 'text-shadow-sm');
                                } else {
                                    classList.push('bg-gradient-to-br', 'from-gray-700/90', 'to-gray-800/90', 'hover:from-gray-600/90', 'hover:to-gray-700/90', 'text-gray-100', 'shadow-sm');
                                }
                            } else {
                                classList.push('bg-gradient-to-br', 'from-gray-800/40', 'to-gray-900/40', 'hover:from-gray-800/60', 'hover:to-gray-900/60', 'text-gray-500');
                            }

                            if (currentLocation.x === x && currentLocation.y === y) classList.push('ring-2', 'ring-green-400', 'z-10');
                            if (destination && destination.x === x && destination.y === y) classList.push('ring-2', 'ring-red-500', 'z-10');
                            if (path && path.some(p => p.x === x && p.y === y)) classList.push('bg-sky-900/50');

                            const bgStyle = imageSrc ? `background-image: url('${UTILITY.safeStyleUrl(imageSrc)}');` : '';
                            // Add overlay for text readability if image exists
                            const displayName = (location && location.name && location.name !== 'Undefined') ? location.name : '';
                            const paintingOverlay = isPainting ? `<div class="absolute inset-0 bg-amber-950/70 flex flex-col items-center justify-center gap-1 z-20"><svg class="animate-spin w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span class="text-[9px] text-amber-300 uppercase font-bold tracking-wider hidden sm:inline">Painting...</span></div>` : '';
                            const content = isGenerating ?
                                `<div class="flex flex-col items-center justify-center gap-1 relative z-10">
                                    <svg class="animate-spin w-4 h-4 text-sky-400" viewBox="0 0 24 24" fill="none">
                                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span class="text-[9px] uppercase font-bold tracking-wider hidden sm:inline">Building...</span>
                                </div>` :
                                (location ? (paintingOverlay + (imageSrc ? `<div class="absolute inset-0 bg-black/40"></div>${displayName ? `<span class="relative z-10">${displayName}</span>` : ''}` : displayName)) : '');

                            mapGridHTML += DOM.html`<div class="${classList.join(' ')}" style="${DOM.unsafe(bgStyle)}" ${!isGenerating ? DOM.unsafe(`data-action="select-map-tile" data-x="${x}" data-y="${y}"`) : ''}>${DOM.unsafe(content)}</div>`.toString();
                        }
                    }

                    // Center the grid and limit width for better aesthetics
                    contentHTML = DOM.html`
            <div class="p-6 h-full flex flex-col items-center justify-center">
                <p class="text-sm text-gray-400 mb-2 w-full max-w-3xl text-left">Click any tile to edit details, set prompts, or manage local lore.</p>
                <div class="grid grid-cols-8 gap-1 w-full max-w-3xl aspect-square">
                    ${DOM.unsafe(mapGridHTML)}
                </div>
            </div>`;
                }

                const headerHTML = DOM.html`
                <div class="p-4 border-b border-gray-700 flex justify-between items-center bg-black/40 flex-shrink-0">
                     <div class="flex space-x-4">
                        <button onclick="UIManager.switchWorldMapTab('move')" class="pb-2 text-lg font-bold border-b-2 ${activeWorldMapTab === 'move' ? 'border-teal-500 text-white' : 'border-transparent text-gray-400 hover:text-white'} transition-colors">Move</button>
                        <button onclick="UIManager.switchWorldMapTab('worldmap')" class="pb-2 text-lg font-bold border-b-2 ${activeWorldMapTab === 'worldmap' ? 'border-teal-500 text-white' : 'border-transparent text-gray-400 hover:text-white'} transition-colors">Edit Map</button>
                     </div>
                     <div class="flex items-center space-x-3">
                        <div class="flex items-center mr-4 border-r border-gray-600 pr-4">
                             <label class="relative inline-flex items-center cursor-pointer" title="Generate specialized NPCs in each new location">
                                 <input type="checkbox" onchange="WorldController.toggleLocationCharacters(this.checked)" class="sr-only" ${state.enableLocationCharacters !== false ? 'checked' : ''}>
                                 <div class="w-10 h-5 bg-gray-700 rounded-full toggle-bg border-2 border-gray-600"></div>
                             </label>
                             <span class="text-xs text-gray-400 font-bold ml-2 uppercase tracking-wide">NPCs</span>
                        </div>
                        <div class="flex items-center mr-4 border-r border-gray-600 pr-4">
                             <label class="relative inline-flex items-center cursor-pointer" title="Automatically generate adjacent locations using AI when moving">
                                 <input type="checkbox" onchange="WorldController.toggleAutoBuildLocations(this.checked)" class="sr-only" ${state.enableAutoBuildLocations ? 'checked' : ''}>
                                 <div class="w-10 h-5 bg-gray-700 rounded-full toggle-bg border-2 border-gray-600"></div>
                             </label>
                             <span class="text-xs text-gray-400 font-bold ml-2 uppercase tracking-wide">Auto-Build</span>
                        </div>
                        <div class="flex items-center mr-4 border-r border-gray-600 pr-4">
                             <label class="relative inline-flex items-center cursor-pointer" title="Automatically generate background images for locations as you visit them">
                                 <input type="checkbox" onchange="WorldController.toggleAutoGenerateLocationImages(this.checked)" class="sr-only" ${state.enableAutoGenerateLocationImages ? 'checked' : ''}>
                                 <div class="w-10 h-5 bg-gray-700 rounded-full toggle-bg border-2 border-gray-600"></div>
                             </label>
                             <span class="text-xs text-gray-400 font-bold ml-2 uppercase tracking-wide">Auto-Image</span>
                        </div>
                        <button data-action="clear-world-map" class="text-red-400 hover:text-red-300 transition-colors" title="Clear World Map">
                             <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                        <button id="generate-world-button" data-action="gen-world-map" class="text-sky-400 hover:text-sky-300 transition-colors" title="Generate World with AI">${this.getAIGenIcon()}</button>
                        <button data-action="close-modal" data-id="world-map-modal" class="bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white p-2 rounded-lg transition-colors" title="Close">
                             <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                     </div>
                </div>`;

                container.innerHTML = DOM.html`<div class="flex flex-col h-full">${headerHTML}<div class="flex-grow overflow-y-auto min-h-0">${contentHTML}</div></div>`.toString();
            },

            /**
             * Renders the details modal for a selected map location.
             */
            renderLocationDetailsModal() {
                if (typeof WorldController === 'undefined') return;
                const { selectedMapTile } = WorldController.RUNTIME;
                const container = document.getElementById('location-details-content');

                if (!selectedMapTile || !container) return;

                // 1. Resolve Image Source (Lazy Load & Cache)
                const x = selectedMapTile.coords.x;
                const y = selectedMapTile.coords.y;
                const imgKey = `location::${x},${y}`;
                let visualSrc = null;

                // Ensure cache object exists
                UIManager.RUNTIME.worldImageCache = UIManager.RUNTIME.worldImageCache || {};

                if (selectedMapTile.imageUrl) {
                    if (selectedMapTile.imageUrl.startsWith('local_idb_')) {
                        if (UIManager.RUNTIME.worldImageCache[imgKey]) {
                            visualSrc = UIManager.RUNTIME.worldImageCache[imgKey];
                        } else {
                            DBService.getImage(imgKey).then(blob => {
                                if (blob) {
                                    UIManager.RUNTIME.worldImageCache[imgKey] = URL.createObjectURL(blob);
                                    if (WorldController.RUNTIME.selectedMapTile &&
                                        WorldController.RUNTIME.selectedMapTile.coords.x === x &&
                                        WorldController.RUNTIME.selectedMapTile.coords.y === y) {
                                        UIManager.renderLocationDetailsModal();
                                    }
                                }
                            }).catch(e => console.warn("Failed to load location image", e));
                        }
                    } else {
                        visualSrc = selectedMapTile.imageUrl;
                    }
                }

                // 2. Generate Image HTML
                const imageDisplayHTML = visualSrc
                    ? DOM.html`
                        <div class="relative w-full aspect-video rounded-lg overflow-hidden border border-gray-600 mb-3 group bg-black/50">
                             <img src="${visualSrc}" class="w-full h-full object-cover">
                             <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                <span class="text-white font-bold text-sm drop-shadow-md">Change Image</span>
                             </div>
                        </div>`.toString()
                    : DOM.html`
                        <div class="w-full aspect-video rounded-lg bg-black/40 border-2 border-dashed border-gray-700 mb-3 flex flex-col items-center justify-center text-gray-500 gap-2">
                            <svg class="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            <span class="text-xs">No Image Set</span>
                        </div>`.toString();

                const imageHint = selectedMapTile.imageUrl ? (selectedMapTile.imageUrl.startsWith('local_idb_') ? 'Local Storage' : 'Legacy URL') : 'None';

                const content = DOM.html`
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div class="space-y-6">
                    <div>
                        <label class="block text-sm font-bold text-gray-400 mb-1">Location Name</label>
                        <input type="text" value="${selectedMapTile.name}" oninput="WorldController.updateLocationDetail('name', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded text-lg focus:border-indigo-500">
                    </div>

                    <div>
                        <label class="block text-sm font-bold text-gray-400 mb-1">Brief Description</label>
                        <textarea oninput="WorldController.updateLocationDetail('description', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded h-24 resize-none text-sm">${selectedMapTile.description}</textarea>
                    </div>

                    <div>
                        <label class="block text-sm font-bold text-gray-400 mb-1">Visuals</label>
                        ${DOM.unsafe(imageDisplayHTML)}
                        <div class="flex items-center justify-between bg-black/20 p-2 rounded border border-gray-700">
                            <span class="text-xs text-gray-500">Source: ${imageHint}</span>
                            <div class="flex gap-2">
                                ${UIManager.isImageGenEnabled() ? DOM.html`<button data-action="gen-location-image" data-x="${selectedMapTile.coords.x}" data-y="${selectedMapTile.coords.y}" class="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-1 px-3 rounded transition-colors shadow-sm flex items-center gap-1">
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                                    Generate
                                </button>` : ''}
                                <label class="cursor-pointer bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold py-1 px-3 rounded transition-colors shadow-sm">
                                    Upload New
                                    <input type="file" accept="image/*" 
                                           onchange="WorldController.handleWorldMapLocationImageUpload(event, ${selectedMapTile.coords.x}, ${selectedMapTile.coords.y})"
                                           class="hidden">
                                </label>
                            </div>
                        </div>
                    </div>

                    <div class="pt-4 border-t border-gray-700">
                        <label class="block text-sm font-bold text-gray-400 mb-2">Navigation Actions</label>
                        <div class="grid grid-cols-2 gap-3">
                           <button data-action="set-destination" class="bg-sky-600/80 hover:bg-sky-600 text-white font-bold py-2 px-4 rounded-lg transition-colors">Set Destination</button>
                           <button data-action="jump-to-location" data-x="${selectedMapTile.coords.x}" data-y="${selectedMapTile.coords.y}" class="bg-indigo-600/80 hover:bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg transition-colors">Jump To Here</button>
                        </div>
                    </div>
                </div>

                <div class="space-y-6 flex flex-col h-full">
                    
                    <div class="flex-grow flex flex-col min-h-[200px]">
                        <label class="block text-sm font-bold text-gray-400 mb-1">Full Generative Prompt</label>
                        <div class="relative flex-grow">
                            <textarea oninput="WorldController.updateLocationDetail('prompt', this.value)" class="w-full h-full bg-black/30 border-gray-600 p-3 rounded resize-none text-sm leading-relaxed">${selectedMapTile.prompt}</textarea>
                            <button data-action="gen-loc-prompt" class="absolute top-2 right-2 text-gray-500 hover:text-indigo-400 transition-colors" title="Generate with AI">${this.getAIGenIcon()}</button>
                        </div>
                    </div>

                    <div class="h-1/2 flex flex-col min-h-[250px]">
                        <div class="flex justify-between items-center mb-2">
                            <h4 class="font-bold text-sm text-gray-300 flex items-center gap-2">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253z"></path></svg>
                                Local Static Memory
                            </h4>
                            <button data-action="add-local-static-entry" class="text-xs bg-gray-700 hover:bg-indigo-600 text-white font-bold py-1 px-2 rounded transition-colors">+ Add</button>
                        </div>
                        <div class="flex-grow border border-gray-700 rounded-lg overflow-hidden flex">
                            <div id="local-static-entries-list" class="w-1/3 bg-black/40 border-r border-gray-700 overflow-y-auto p-1 space-y-1"></div>
                            <div id="local-static-entry-details" class="w-2/3 bg-black/20 p-2 flex flex-col"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

                container.innerHTML = content.toString();
                this.renderLocalStaticEntriesList();
                this.renderLocalStaticEntryDetails();
            },

            /**
             * Renders the list of local static entries for a location.
             */
            renderLocalStaticEntriesList() {
                // Access Controller state via WorldController
                if (typeof WorldController === 'undefined') return;
                const { selectedMapTile, selectedLocalStaticEntryId } = WorldController.RUNTIME;

                const container = document.getElementById('local-static-entries-list');
                if (!container || !selectedMapTile) return;

                const entries = selectedMapTile.local_static_entries || [];
                container.innerHTML = entries.map(entry => DOM.html`
            <div data-action="select-local-static-entry" data-id="${entry.id}" 
                 class="p-2 rounded-md cursor-pointer ${selectedLocalStaticEntryId === entry.id ? 'bg-indigo-600' : 'hover:bg-indigo-600/50'}">
                <h5 class="font-semibold truncate text-sm">${entry.title}</h5>
            </div>
        `).join('');
            },

            /**
             * Renders the details view for a selected local static entry.
             */
            renderLocalStaticEntryDetails() {
                if (typeof WorldController === 'undefined') return;
                const { selectedMapTile, selectedLocalStaticEntryId } = WorldController.RUNTIME;

                const container = document.getElementById('local-static-entry-details');
                if (!container || !selectedMapTile) return;

                const entry = (selectedMapTile.local_static_entries || []).find(e => e.id === selectedLocalStaticEntryId);

                if (entry) {
                    container.innerHTML = DOM.html`
                <input type="text" value="${entry.title}" oninput="WorldController.updateLocalStaticEntryField('${entry.id}', 'title', this.value)" class="font-bold bg-black/30 p-2 w-full mb-2 text-sm rounded-md">
                <textarea oninput="WorldController.updateLocalStaticEntryField('${entry.id}', 'content', this.value)" class="w-full flex-grow bg-black/30 p-2 resize-none text-sm rounded-md">${entry.content}</textarea>
                <div class="flex justify-end mt-2">
                    <button data-action="delete-local-static-entry" data-id="${entry.id}" class="text-xs bg-red-900/50 hover:bg-red-700/80 text-red-200 font-semibold py-2 px-3 rounded">Delete</button>
                </div>`.toString();
                } else {
                    container.innerHTML = `<div class="text-gray-500 flex items-center justify-center h-full text-sm">Select an entry.</div>`;
                }
            },

            /**
             * Hydrates a visual event image from IndexedDB.
             * @param {HTMLImageElement} img - The image element.
             */
            async hydrateVisualImage(img) {
                const key = img.getAttribute('data-visual-key');
                if (!key || img.dataset.loaded === "true") return;

                img.dataset.loaded = "true";
                const isNew = img.getAttribute('data-is-new') === 'true';

                try {
                    // Check Cache
                    if (typeof VisualMaster !== 'undefined' && VisualMaster.RUNTIME.imageUrls[key]) {
                        const url = VisualMaster.RUNTIME.imageUrls[key];
                        const canvas = img.parentElement.querySelector('canvas[data-bleed-canvas]');
                        if (isNew && canvas) {
                            img.style.opacity = '0';
                            img.src = url;
                            img.dataset.src = url;
                            ImageProcessor.triggerTexturedInkBleed(img, canvas);
                        } else {
                            UTILITY.safeImageSet(img, url);
                        }
                        return;
                    }

                    const blob = await DBService.getImage(key);
                    if (blob) {
                        const url = URL.createObjectURL(blob);
                        // Cache it
                        if (typeof VisualMaster !== 'undefined') {
                            VisualMaster.RUNTIME.imageUrls[key] = url;
                        }
                        const canvas = img.parentElement.querySelector('canvas[data-bleed-canvas]');
                        if (isNew && canvas) {
                            img.style.opacity = '0';
                            img.src = url;
                            img.dataset.src = url;
                            ImageProcessor.triggerTexturedInkBleed(img, canvas);
                        } else {
                            UTILITY.safeImageSet(img, url);
                        }
                        img.onload = null;
                    } else {
                        img.alt = "[Image Expired]";
                        img.style.display = 'none';
                    }
                } catch (e) {
                    console.error("Failed to hydrate visual:", e);
                    img.alt = "[Error]";
                }
            },

            /**
             * Hydrates a message image from IndexedDB.
             */
            async hydrateMessageImage(img) {
                const imgId = img.getAttribute('data-img-id');
                if (!imgId || img.dataset.loaded === "true") return;

                img.dataset.loaded = "true";
                img.classList.add("animate-pulse");

                try {
                    const blob = await DBService.getImage(imgId);
                    if (blob) {
                        const url = URL.createObjectURL(blob);
                        UTILITY.safeImageSet(img, url);
                        img.onload = () => {
                            img.classList.remove("animate-pulse");
                        };
                    } else {
                        img.classList.remove("animate-pulse");
                        img.alt = "[Image Not Found]";
                        img.style.display = 'none';
                    }
                } catch (e) {
                    img.classList.remove("animate-pulse");
                    console.error("Failed to hydrate message image:", e);
                    img.alt = "[Error]";
                }
            },

            /**
             * Retrieves the appropriate portrait URL for a character and emotion.
             * Checks cache and local storage before falling back to URL.
             * @param {Object} character - The character object.
             * @param {string} [mood=null] - The emotion to retrieve.
             * @returns {string|null} - The image URL or null.
             */
            getPortraitSrc(character, mood) {
                const cache = UIManager.RUNTIME.characterImageCache || {};

                // By default, most messages pass 'neutral'. If there's an explicit extra_portrait for 'neutral', 
                // we should ONLY use it if the base portrait does not exist, to prevent it from permanently shadowing new primary images.
                const emoKey = mood && mood !== 'neutral' ? `${character.id}::emotion::${mood}` : null;
                const neutralEmoKey = `${character.id}::emotion::neutral`;

                let rawKey = null;
                let rawSrc = null;

                // 1. Explicit Non-Neutral Emotion
                if (emoKey && cache[emoKey] && !cache[emoKey].includes('${imgSrc}')) {
                    rawKey = emoKey;
                    rawSrc = cache[emoKey];
                }
                // 2. Base Portrait (Cache)
                else if (cache[character.id] && !cache[character.id].includes('${imgSrc}')) {
                    rawKey = character.id;
                    rawSrc = cache[character.id];
                }
                // 3. Explicit Neutral Emotion Fallback (if they have a neutral portrait but no base)
                else if (cache[neutralEmoKey] && !cache[neutralEmoKey].includes('${imgSrc}')) {
                    rawKey = neutralEmoKey;
                    rawSrc = cache[neutralEmoKey];
                }
                // 4. Legacy Web URL Fallback
                else if (character.image_url && !character.image_url.startsWith('local_idb_')) {
                    // Defensive Safeguard: Prevent literal placeholder strings from being treated as URLs
                    if (!character.image_url.includes('${imgSrc}')) {
                        rawSrc = character.image_url;
                        rawKey = character.image_url;
                    }
                }
                // 5. User Character Fallback
                else if (character.is_user && typeof AppController !== 'undefined') {
                    const fallbackUserImage = AppController.getUserAvatarImage();
                    if (fallbackUserImage) {
                        rawSrc = fallbackUserImage;
                        rawKey = fallbackUserImage;
                    }
                }

                if (!rawSrc) return null;

                // If useAlphaMask is enabled, retrieve the masked URL if it exists in cache
                const state = StateManager.getState();
                if (state && state.useAlphaMask) {
                    const maskKey = `${rawKey}::alpha_masked`;
                    const sourceSrc = cache[maskKey] || rawSrc;

                    const gradientKey = `${sourceSrc}::gradient`;
                    if (cache[gradientKey]) {
                        return cache[gradientKey];
                    }
                    // Trigger asynchronous generation of bottom gradient fade-out in the background so it's ready for future renders
                    this.applySingleAlphaMask(sourceSrc).then(masked => {
                        if (masked && masked !== sourceSrc) {
                            if (state.characterImageMode === 'visual_novel' || state.characterImageMode === 'cinematic_overlay') {
                                setTimeout(() => {
                                    if (state.characterImageMode === 'visual_novel') {
                                        this.updateVisualNovelModeUI(state);
                                    } else {
                                        this.renderChat();
                                    }
                                }, 50);
                            }
                        }
                    });
                    return sourceSrc;
                }

                return rawSrc;
            },

            /**
             * Asynchronously applies a bottom vertical linear gradient mask (fade out bottom 15%) and caches it.
             * @param {string} srcUrl - The image URL to mask.
             * @returns {Promise<string>} - The gradient-masked image URL, or original if failed.
             */
            applySingleAlphaMask(srcUrl) {
                if (!srcUrl) return Promise.resolve('');
                const cache = this.RUNTIME.characterImageCache || {};
                const gradientKey = `${srcUrl}::gradient`;
                if (cache[gradientKey]) return Promise.resolve(cache[gradientKey]);

                return new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = 'anonymous';
                    img.onload = () => {
                        try {
                            const canvas = document.createElement('canvas');
                            canvas.width = img.width;
                            canvas.height = img.height;
                            const ctx = canvas.getContext('2d');
                            if (!ctx) {
                                resolve(srcUrl);
                                return;
                            }
                            ctx.drawImage(img, 0, 0);

                            // Apply vertical gradient mask (fade out bottom 15% of the image)
                            ctx.globalCompositeOperation = 'destination-in';
                            const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
                            grad.addColorStop(0, 'rgba(0,0,0,1)');      // Solid at top
                            grad.addColorStop(0.8, 'rgba(0,0,0,1)');    // Solid down to 80%
                            grad.addColorStop(1, 'rgba(0,0,0,0)');      // Transparent at bottom

                            ctx.fillStyle = grad;
                            ctx.fillRect(0, 0, canvas.width, canvas.height);

                            canvas.toBlob((blob) => {
                                if (blob) {
                                    const maskedUrl = URL.createObjectURL(blob);
                                    cache[gradientKey] = maskedUrl;
                                    resolve(maskedUrl);
                                } else {
                                    resolve(srcUrl);
                                }
                            }, 'image/png');
                        } catch (e) {
                            console.warn("Single alpha mask canvas gradient build failed:", e);
                            resolve(srcUrl);
                        }
                    };
                    img.onerror = () => resolve(srcUrl);
                    img.src = srcUrl;
                });
            },

            /**
             * Checks if a given image Blob has any transparency (alpha < 255).
             * @param {Blob} blob - The image blob.
             * @returns {Promise<boolean>} - True if it has transparency, false if fully opaque.
             */
            checkImageHasAlpha(blob) {
                return new Promise((resolve) => {
                    const img = new Image();
                    const url = URL.createObjectURL(blob);
                    img.onload = () => {
                        try {
                            const canvas = document.createElement('canvas');
                            canvas.width = img.width;
                            canvas.height = img.height;
                            const ctx = canvas.getContext('2d');
                            if (!ctx) {
                                URL.revokeObjectURL(url);
                                resolve(false);
                                return;
                            }
                            ctx.drawImage(img, 0, 0);
                            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                            for (let i = 3; i < imgData.data.length; i += 4) {
                                if (imgData.data[i] < 255) {
                                    URL.revokeObjectURL(url);
                                    resolve(true);
                                    return;
                                }
                            }
                            URL.revokeObjectURL(url);
                            resolve(false);
                        } catch (e) {
                            URL.revokeObjectURL(url);
                            resolve(false);
                        }
                    };
                    img.onerror = () => {
                        URL.revokeObjectURL(url);
                        resolve(false);
                    };
                    img.src = url;
                });
            },

            /**
             * Asynchronously runs MediaPipe segmentation on a blob and returns the masked PNG blob.
             * @param {string} key - The identifier key.
             * @param {Blob} originalBlob - The unmasked original image blob.
             * @returns {Promise<Blob>} - The masked transparent PNG blob.
             */
            async generateSegmentationMask(key, originalBlob) {
                if (typeof window.SelfieSegmentation === 'undefined') {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js';
                        script.crossOrigin = 'anonymous';
                        script.onload = resolve;
                        script.onerror = reject;
                        document.head.appendChild(script);
                    });
                }

                const blobUrl = URL.createObjectURL(originalBlob);
                const img = await new Promise((resolve, reject) => {
                    const i = new Image();
                    i.onload = () => resolve(i);
                    i.onerror = reject;
                    i.src = blobUrl;
                });

                const selfieSegmentation = new window.SelfieSegmentation({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
                });
                selfieSegmentation.setOptions({ modelSelection: 1 });

                let maskedBlob = null;
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Segmentation timed out')), 15000);
                    selfieSegmentation.onResults((results) => {
                        clearTimeout(timeout);
                        try {
                            const canvas = document.createElement('canvas');
                            canvas.width = results.image.width;
                            canvas.height = results.image.height;
                            const ctx = canvas.getContext('2d');
                            ctx.clearRect(0, 0, canvas.width, canvas.height);
                            ctx.drawImage(results.image, 0, 0);
                            ctx.globalCompositeOperation = 'destination-in';
                            ctx.drawImage(results.segmentationMask, 0, 0);
                            canvas.toBlob((b) => { maskedBlob = b; resolve(); }, 'image/png');
                        } catch (e) { reject(e); }
                    });
                    selfieSegmentation.send({ image: img }).catch(reject);
                });

                URL.revokeObjectURL(blobUrl);
                selfieSegmentation.close();

                if (!maskedBlob) throw new Error('Segmentation produced no output');
                return maskedBlob;
            },

            /**
             * Iterates through all characters and their emotions to pre-generate and cache alpha masked images.
             * Only processes images that do not already have transparency or an existing mask.
             */
            async applyAlphaMasksToAllCharacters() {
                const state = StateManager.getState();
                if (!state || !state.characters) return;

                let generated = 0;
                for (const char of state.characters) {
                    // 1. Base Portrait
                    const baseKey = char.id;
                    try {
                        const hasMask = await DBService.getImage(`${baseKey}::alpha_masked`);
                        if (!hasMask) {
                            const baseBlob = await DBService.getImage(baseKey);
                            if (baseBlob) {
                                const hasAlpha = await this.checkImageHasAlpha(baseBlob);
                                if (!hasAlpha) {
                                    const maskedBlob = await this.generateSegmentationMask(baseKey, baseBlob);
                                    const maskKey = `${baseKey}::alpha_masked`;
                                    await DBService.saveImage(maskKey, maskedBlob);

                                    UIManager.RUNTIME.characterImageCache = UIManager.RUNTIME.characterImageCache || {};
                                    if (UIManager.RUNTIME.characterImageCache[maskKey]) {
                                        URL.revokeObjectURL(UIManager.RUNTIME.characterImageCache[maskKey]);
                                    }
                                    UIManager.RUNTIME.characterImageCache[maskKey] = URL.createObjectURL(maskedBlob);
                                    generated++;
                                }
                            }
                        }
                    } catch (e) {
                        console.error(`Auto-mask failed for base portrait of character ${char.name}:`, e);
                    }

                    // 2. Emotion Portraits
                    if (char.extra_portraits && Array.isArray(char.extra_portraits)) {
                        for (const p of char.extra_portraits) {
                            const emotion = (p.emotion || 'neutral').toLowerCase();
                            const emoKey = `${char.id}::emotion::${emotion}`;
                            try {
                                const hasMask = await DBService.getImage(`${emoKey}::alpha_masked`);
                                if (!hasMask) {
                                    const emoBlob = await DBService.getImage(emoKey);
                                    if (emoBlob) {
                                        const hasAlpha = await this.checkImageHasAlpha(emoBlob);
                                        if (!hasAlpha) {
                                            const maskedBlob = await this.generateSegmentationMask(emoKey, emoBlob);
                                            const maskKey = `${emoKey}::alpha_masked`;
                                            await DBService.saveImage(maskKey, maskedBlob);

                                            UIManager.RUNTIME.characterImageCache = UIManager.RUNTIME.characterImageCache || {};
                                            if (UIManager.RUNTIME.characterImageCache[maskKey]) {
                                                URL.revokeObjectURL(UIManager.RUNTIME.characterImageCache[maskKey]);
                                            }
                                            UIManager.RUNTIME.characterImageCache[maskKey] = URL.createObjectURL(maskedBlob);
                                            generated++;
                                        }
                                    }
                                }
                            } catch (e) {
                                console.error(`Auto-mask failed for character ${char.name} emotion ${emotion}:`, e);
                            }
                        }
                    }
                }

                if (generated > 0) {
                    console.log(`Auto-generated alpha masks for ${generated} images.`);
                    UIManager.showNotification(`Background removed from ${generated} character portraits/emotions.`, "success");
                    UIManager.renderChat();
                }
            },

            /**
             * Invalidates the alpha mask cache and DB entries for a given image key.
             * If alpha masking is currently active, it triggers background mask generation.
             * @param {string} key - The IDB key for the character/emotion image.
             * @param {string} [charId] - The ID of the character for UI refreshes.
             */
            async invalidateMaskAndTriggerRegen(key, charId = null) {
                const maskKey = `${key}::alpha_masked`;
                try {
                    await DBService.deleteImage(maskKey);
                } catch (e) {
                    console.warn(`Could not delete mask from DB for key ${maskKey}:`, e);
                }

                const cache = UIManager.RUNTIME.characterImageCache || {};

                // Revoke/delete gradient URL of the masked image
                if (cache[maskKey]) {
                    const gradKey = `${cache[maskKey]}::gradient`;
                    if (cache[gradKey]) {
                        try {
                            URL.revokeObjectURL(cache[gradKey]);
                        } catch (e) { }
                        delete cache[gradKey];
                    }
                    try {
                        URL.revokeObjectURL(cache[maskKey]);
                    } catch (e) { }
                    delete cache[maskKey];
                }

                // Revoke/delete gradient URL of the original image
                if (cache[key]) {
                    const gradKey = `${cache[key]}::gradient`;
                    if (cache[gradKey]) {
                        try {
                            URL.revokeObjectURL(cache[gradKey]);
                        } catch (e) { }
                        delete cache[gradKey];
                    }
                }

                // If useAlphaMask is active, automatically generate mask in the background
                const state = StateManager.getState();
                if (state && state.useAlphaMask) {
                    try {
                        const originalBlob = await DBService.getImage(key);
                        if (originalBlob) {
                            const hasAlpha = await this.checkImageHasAlpha(originalBlob);
                            if (!hasAlpha) {
                                const maskedBlob = await this.generateSegmentationMask(key, originalBlob);
                                await DBService.saveImage(maskKey, maskedBlob);
                                cache[maskKey] = URL.createObjectURL(maskedBlob);

                                UIManager.renderChat();
                                if (charId) {
                                    UIManager.openCharacterDetailModal(charId);
                                }
                            }
                        }
                    } catch (e) {
                        console.error(`Automatic mask generation failed for key ${key} after invalidation:`, e);
                    }
                }
            },
            /**
             * Opens the Character Detail modal for editing a character.
             */
            openCharacterDetailModal(charId) {
                const state = StateManager.getState();
                let char = ReactiveStore.getCharacter(charId);

                // Fallback: Check if it's a location specific character embedded in the world map
                if (!char && state.worldMap && state.worldMap.grid) {
                    for (const loc of state.worldMap.grid) {
                        if (loc.characters) {
                            const found = loc.characters.find(c => c.id === charId);
                            if (found) {
                                char = found;
                                break;
                            }
                        }
                    }
                }

                if (!char) return;
                const hasPortrait = !!this.getPortraitSrc(char);
                const container = document.getElementById('character-detail-modal-content');

                const detailsId = `extra-portraits-details-${char.id}`;
                const existingDetails = document.getElementById(detailsId);
                const wasOpen = existingDetails ? existingDetails.hasAttribute('open') : false;

                const canGenImage = UIManager.isImageGenEnabled();
                const hasEvolvedPersona = state.evolved_characters && state.evolved_characters[char.id];

                let currentRole = 'none';
                if (char.is_user) currentRole = 'user';
                else if (char.is_narrator) currentRole = 'narrator';

                // New Grid Layout for Portraits
                const extraPortraitsHTML = (char.extra_portraits || []).map((portrait, index) => {
                    const emo = portrait.emotion || 'neutral';
                    const fileInputId = `emo-file-${char.id}-${index}`;

                    // Resolve Image Source
                    const src = this.getPortraitSrc(char, emo);
                    // Stagger portraits: base delay after the section header fades in (0.28s)
                    const cardDelay = `${0.28 + index * 0.05}s`;

                    return DOM.html`
                <div class="card-hover animate-fade-rise relative group bg-white/[0.01] rounded-lg border border-white/5 overflow-hidden flex flex-col" style="animation-delay: ${cardDelay};">
                    <!-- Image / Placeholder Area -->
                    <div class="aspect-square w-full relative bg-gray-900/50 flex items-center justify-center overflow-hidden">
                        ${src ? DOM.html`<img src="${src}" class="w-full h-full object-cover">` : DOM.html`
                        <div class="flex flex-col items-center justify-center text-gray-600 gap-1 opacity-50">
                            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        </div>`}
                        
                        <!-- Overlay Actions -->
                        <div class="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 backdrop-blur-sm">
                             <label for="${fileInputId}" class="cursor-pointer bg-white/10 hover:bg-white/20 text-white text-xs font-bold py-1.5 px-3 rounded-lg border border-white/20 transition-colors flex items-center gap-1">
                                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                                Upload
                             </label>
                             <input id="${fileInputId}" type="file" accept="image/*" onchange="NarrativeController.handleLocalEmotionImageUpload(event, '${char.id}', ${index})" class="hidden">
                             
                             ${canGenImage ? DOM.html`<button onclick="NarrativeController.openCharacterImageGenerator('${char.id}', 'extra', ${index})" class="micro-hover bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold py-1.5 px-3 rounded-lg flex items-center gap-1 shadow-lg shadow-teal-500/20">
                                 ${this.getAIGenIcon()} Generate
                             </button>` : ''}

                             ${src ? DOM.html`
                                 <div class="flex items-center gap-1.5 mt-1">
                                     <button onclick="NarrativeController.applyAlphaMask('${char.id}', '${emo}')" class="micro-hover bg-purple-700 hover:bg-purple-600 text-white text-[10px] font-bold py-1 px-2 rounded-lg border border-purple-400/50 flex items-center gap-0.5 shadow-md" title="Remove Background (AI Mask)">
                                         <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"></path></svg>
                                         AI Mask
                                     </button>
                                     <button onclick="RefineMaskController.open('${char.id}', '${emo}')" class="micro-hover bg-pink-700 hover:bg-pink-600 text-white text-[10px] font-bold py-1 px-2 rounded-lg border border-pink-400/50 flex items-center gap-0.5 shadow-md" title="Refine Transparency Mask">
                                         <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                         Refine
                                     </button>
                                 </div>
                             ` : ''}
                        </div>

                        <!-- Delete Button -->
                        <button onclick="NarrativeController.removeExtraPortrait('${char.id}', ${index})" class="micro-hover absolute top-1 right-1 bg-red-600/80 hover:bg-red-500 text-white rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm" title="Remove">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>

                    <!-- Emotion Selector Footer -->
                    <div class="p-2 border-t border-white/5 bg-gray-900/30">
                        <select onchange="NarrativeController.updateExtraPortrait('${char.id}', ${index}, 'emotion', this.value)" class="w-full bg-transparent text-xs text-gray-300 font-bold focus:outline-none text-center appearance-none cursor-pointer hover:text-white transition-colors">
                            <option value="happy" class="bg-gray-800 text-white" ${emo === 'happy' ? 'selected' : ''}>Happy</option>
                            <option value="sad" class="bg-gray-800 text-white" ${emo === 'sad' ? 'selected' : ''}>Sad</option>
                            <option value="angry" class="bg-gray-800 text-white" ${emo === 'angry' ? 'selected' : ''}>Angry</option>
                            <option value="surprised" class="bg-gray-800 text-white" ${emo === 'surprised' ? 'selected' : ''}>Surprised</option>
                            <option value="neutral" class="bg-gray-800 text-white" ${emo === 'neutral' ? 'selected' : ''}>Neutral</option>
                            <option value="fear" class="bg-gray-800 text-white" ${emo === 'fear' ? 'selected' : ''}>Fear</option>
                            <option value="disgust" class="bg-gray-800 text-white" ${emo === 'disgust' ? 'selected' : ''}>Disgust</option>
                            <option value="blush" class="bg-gray-800 text-white" ${emo === 'blush' ? 'selected' : ''}>Blush</option>
                        </select>
                    </div>
                </div>`;
                });

                const tagsValue = ''; // Replaced by dynamic pill additions
                const color = char.color || { base: '#334155', bold: '#94a3b8' };

                // Pre-process Tags HTML to pill spans
                let tagsHTML = '';
                (Array.isArray(char.tags) ? char.tags : []).forEach(tag => {
                    const escaped = String(tag).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
                    tagsHTML += `<span class="bg-teal-500/10 text-teal-300 text-[11px] font-bold px-2.5 py-1 rounded-md border border-teal-500/20 flex items-center shadow-sm whitespace-nowrap gap-1">${escaped} <button onclick="NarrativeController.removeCharacterTag('${char.id}', '${escaped}')" class="hover:text-white transition-colors ml-1">&times;</button></span>`;
                });

                const modalHTML = DOM.html`
            <!-- Header Area (Tabs + Active Toggle) -->
            <div class="px-6 pt-4 flex flex-row items-center border-b border-white/5 bg-gray-900/80 rounded-t-xl relative z-40">
                <!-- Active Toggle shifted to far left Header -->
                <div class="flex items-center gap-3 mr-6 flex-shrink-0 border-r border-white/5 pr-6">
                    <label class="relative inline-flex items-center cursor-pointer group" title="Active in this chat">
                        <input type="checkbox" class="sr-only peer" ${char.is_active !== false ? 'checked' : ''} onchange="NarrativeController.toggleCharacterActive(event, '${char.id}')">
                        <div class="w-11 h-6 bg-gray-700/80 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-500 shadow-inner group-hover:ring-2 ring-teal-500/30 transition-all"></div>
                    </label>
                    <span class="text-[10px] uppercase tracking-[0.2em] font-bold ${char.is_active !== false ? 'text-teal-300' : 'text-gray-500'} transition-colors hidden sm:inline pt-0.5 mt-px">Active</span>
                </div>

                <!-- Tab Navigation Bar -->
                <div class="flex flex-row space-x-2 overflow-x-auto whitespace-nowrap scrollbar-hide">
                    <button onclick="window.switchCharTab(this, 'tab-identity')" data-tab="tab-identity" class="character-tab-btn border-b-2 border-teal-500 text-teal-400 px-4 py-3 font-semibold text-sm transition-colors hover:text-teal-300 flex-shrink-0 tracking-wide uppercase">Identity</button>
                    <button onclick="window.switchCharTab(this, 'tab-prompts')" data-tab="tab-prompts" class="character-tab-btn border-b-2 border-transparent text-gray-400 px-4 py-3 font-semibold text-sm transition-colors hover:text-gray-300 flex-shrink-0 tracking-wide uppercase">Prompts</button>
                    <button onclick="window.switchCharTab(this, 'tab-advanced')" data-tab="tab-advanced" class="character-tab-btn border-b-2 border-transparent text-gray-400 px-4 py-3 font-semibold text-sm transition-colors hover:text-gray-300 flex-shrink-0 tracking-wide uppercase">Advanced</button>
                </div>
            </div>

            <!-- Controls & Close (Absolute Top Right overriding Header) -->
            <div class="absolute top-2.5 right-2.5 z-50">
                <button data-action="close-modal" data-id="character-detail-modal" class="micro-hover bg-black/40 hover:bg-gray-700 text-gray-300 hover:text-white p-2 rounded-full backdrop-blur-sm transition-colors shadow-lg" title="Close">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>

            <!-- Scrollable Content Area -->
            <div class="p-6 md:p-8 overflow-y-auto space-y-6 bg-gray-800/80 rounded-b-xl relative">
                
                <!-- V4 Hero Identity Tab -->
                <div id="tab-identity" class="character-tab-content animate-fade-rise">
                    <!-- Hero Image Container -->
                    <div class="relative w-full ${hasPortrait ? 'aspect-square' : 'min-h-[100px] h-auto'} rounded-2xl overflow-hidden group mb-6 shadow-2xl bg-gray-900 border border-white/5 flex transition-all">
                        ${hasPortrait ? DOM.html`
                            <img src="${this.getPortraitSrc(char)}" class="absolute inset-0 w-full h-full object-cover object-top transition-transform duration-700 group-hover:scale-105">
                        ` : DOM.html`
                            <div class="absolute inset-0 flex flex-col items-center justify-center bg-gray-800/50">
                                <svg class="w-12 h-12 text-gray-500 mb-1 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                                <span class="text-gray-500 text-[10px] font-bold tracking-widest uppercase">Upload Hero Portrait</span>
                            </div>
                        `}
                        
                        <!-- Gradient Overlay -->
                        <div class="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/60 to-transparent pointer-events-none z-0"></div>

                        <!-- Hover Upload Overlay -->
                        <label class="absolute inset-0 cursor-pointer z-10 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-sm">
                            <svg class="w-8 h-8 text-white mb-1 drop-shadow-md" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 01-2-2h-3.86a2 2 0 01-1.664.89l-.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                            <span class="text-white text-xs font-bold tracking-widest uppercase drop-shadow-md">Change Portrait</span>
                            <input type="file" accept="image/*" data-action-change="upload-local-image" data-id="${char.id}" class="hidden">
                        </label>


                        <!-- Floating Text Over Image -->
                        <div class="${hasPortrait ? 'absolute bottom-0 left-0 right-0' : 'relative'} ${hasPortrait ? 'p-6' : 'p-4'} flex flex-col gap-2 z-20 pointer-events-none">
                            <div class="pointer-events-auto w-full md:w-3/4">
                                <input type="text" value="${char.name}" style="font-family: var(--chat-font-family)" oninput="NarrativeController.updateCharacterField('${char.id}', 'name', this.value)" class="${hasPortrait ? 'text-5xl md:text-6xl' : 'text-3xl md:text-4xl'} font-black bg-transparent border-0 p-0 text-white placeholder-gray-400 tracking-tight focus:ring-0 focus:outline-none w-full leading-none hover:bg-white/10 focus:bg-white/20 rounded-lg px-2 -ml-2 drop-shadow-lg transition-colors" placeholder="CHARACTER NAME">
                                
                                <div class="relative group mt-2 transition-all duration-300 rounded-xl focus-within:ring-1 focus-within:ring-teal-500/50">
                                    <!-- Markdown Styling Overlay (Synced metrics to fix caret alignment) -->
                                    <div class="markdown-backdrop absolute inset-0 p-3 ${hasPortrait ? 'text-xl md:text-2xl' : 'text-base md:text-lg'} text-gray-200 pointer-events-none whitespace-pre-wrap break-words drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] z-0 overflow-y-auto scrollbar-hide leading-snug border border-transparent" aria-hidden="true" style="font-family: var(--chat-font-family)">${DOM.unsafe(NarrativeController.formatMarkdownOverlay(char.short_description || ''))}</div>
                                    <!-- Transparent Text input -->
                                    <textarea oninput="NarrativeController.updateCharacterField('${char.id}', 'short_description', this.value); NarrativeController.syncMarkdownOverlay(this)" onscroll="NarrativeController.syncMarkdownOverlay(this)" placeholder="A shadowed past, a bright future..." class="relative z-10 w-full bg-transparent border border-transparent p-3 ${hasPortrait ? 'text-xl md:text-2xl' : 'text-base md:text-lg'} text-transparent caret-white placeholder-gray-400 focus:ring-0 resize-none overflow-y-auto scrollbar-hide max-h-[15rem] leading-snug rounded-xl transition-all" style="font-family: var(--chat-font-family); min-height: ${hasPortrait ? '80px' : '40px'};" rows="2">${char.short_description || ''}</textarea>
                                    
                                    <button data-action="gen-short-desc" data-id="${char.id}" class="absolute top-2 right-2 p-1.5 bg-teal-950/80 text-white rounded-md border border-teal-500/50 opacity-0 group-focus-within:opacity-100 hover:opacity-100 transition-opacity micro-hover backdrop-blur-md z-20" title="Summarize Persona">
                                        ${this.getAIGenIcon()}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Action Buttons floating Top Right -->
                        <div class="absolute top-4 right-4 flex items-center gap-2 z-30 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto">
                            ${canGenImage ? DOM.html`
                                <button onclick="NarrativeController.openCharacterImageGenerator('${char.id}', 'primary')" class="micro-hover p-2 bg-teal-600 hover:bg-teal-500 text-white rounded-full border border-teal-500/30 shadow-lg" title="Generate Portrait">
                                    ${this.getAIGenIcon()}
                                </button>
                            ` : ''}
                            ${this.getPortraitSrc(char) ? DOM.html`
                                <button onclick="NarrativeController.openImageCropper('${char.id}', 'primary')" class="micro-hover p-2 bg-gray-800 hover:bg-gray-700 text-white rounded-full border border-gray-600 shadow-lg" title="Crop / Reframe Avatar"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></button>
                                <button onclick="NarrativeController.applyAlphaMask('${char.id}')" class="micro-hover p-2 bg-purple-700 hover:bg-purple-600 text-white rounded-full border border-purple-400/50 shadow-lg" title="Remove Background (AI Mask)"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"></path></svg></button>
                                <button onclick="RefineMaskController.open('${char.id}')" class="micro-hover p-2 bg-pink-700 hover:bg-pink-600 text-white rounded-full border border-pink-400/50 shadow-lg" title="Refine Transparency Mask"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button>
                                <button onclick="NarrativeController.deleteCharacterImage('${char.id}')" class="micro-hover p-2 bg-red-600 hover:bg-red-500 text-white rounded-full border border-red-400/50 shadow-lg" title="Delete Avatar"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                            ` : ''}
                        </div>
                    </div>

                    <!-- Lower Dossier Elements -->
                    <div class="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between bg-gray-900/40 p-5 rounded-xl border border-white/5">
                        <!-- Role Pills -->
                        <div class="flex gap-2 items-center">
                            <label class="text-[10px] uppercase tracking-widest font-bold text-gray-500 mr-2">Role</label>
                            <button data-action="set-char-role" data-id="${char.id}" data-role="user" class="px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${currentRole === 'user' ? 'bg-teal-600 text-white shadow-[0_0_15px_rgba(20,184,166,0.3)]' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}">User</button>
                            <button data-action="set-char-role" data-id="${char.id}" data-role="none" class="px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${currentRole === 'none' ? 'bg-gray-600 text-white shadow-[0_0_15px_rgba(75,85,99,0.4)]' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}">NPC</button>
                            <button data-action="set-char-role" data-id="${char.id}" data-role="narrator" class="px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${currentRole === 'narrator' ? 'bg-teal-500 text-white shadow-[0_0_15px_rgba(20,184,166,0.4)]' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}">Narrator</button>
                        </div>
                        
                        <!-- Tiny Color Pickers -->
                        <div class="flex items-center gap-6">
                            <div class="flex items-center gap-3 group">
                                <label class="text-[10px] uppercase tracking-widest font-bold text-gray-500 group-hover:text-gray-300 transition-colors">Bubble Color</label>
                                <div class="w-5 h-5 rounded-full overflow-hidden border border-gray-600 shadow-sm relative cursor-pointer group-hover:scale-110 transition-transform">
                                    <input type="color" value="${color.base}" oninput="NarrativeController.updateCharacterColor('${char.id}', 'base', this.value)" class="absolute inset-[-10px] w-12 h-12 cursor-pointer border-0 p-0">
                                </div>
                            </div>
                            <div class="flex items-center gap-3 group">
                                <label class="text-[10px] uppercase tracking-widest font-bold text-gray-500 group-hover:text-gray-300 transition-colors">Name Color</label>
                                <div class="w-5 h-5 rounded-full overflow-hidden border border-gray-600 shadow-sm relative cursor-pointer group-hover:scale-110 transition-transform">
                                    <input type="color" value="${color.bold}" oninput="NarrativeController.updateCharacterColor('${char.id}', 'bold', this.value)" class="absolute inset-[-10px] w-12 h-12 cursor-pointer border-0 p-0">
                                </div>
                            </div>
                        </div>
                    </div>



                    <!-- Tags Section (Pill on Comma) -->
                    <div class="mt-6 flex flex-col gap-2 bg-gray-900/40 p-5 rounded-xl border border-white/5">
                        <div class="flex items-center justify-between mb-2">
                            <label class="text-[10px] uppercase tracking-widest font-bold text-gray-500">Identifiers / Tags</label>
                            <button data-action="gen-char-tags" data-id="${char.id}" class="text-[10px] uppercase tracking-widest font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1 transition-colors">${this.getAIGenIcon()} Auto-Detect</button>
                        </div>
                        <div class="w-full flex flex-wrap gap-2 items-center min-h-[2rem] bg-gray-950/20 p-2 rounded-lg border border-white/5">
                            ${DOM.unsafe(tagsHTML)}
                            <input type="text" id="tag-input-${char.id}" onkeyup="NarrativeController.handleTagInput(event, '${char.id}')" placeholder="Type a tag and press comma..." class="flex-grow bg-transparent border-0 text-sm font-medium text-gray-300 focus:ring-0 min-w-[150px] p-1 px-2">
                        </div>
                    </div>

                    <!-- Full Background Portrait Section -->
                    ${this.getPortraitSrc(char) ? DOM.html`
                    <div class="mt-8 flex flex-col items-center gap-4">
                        <label class="text-[10px] uppercase tracking-widest font-bold text-gray-500">Full Character Reference</label>
                        <div class="max-w-sm w-full bg-gray-900/40 rounded-2xl overflow-hidden border border-white/5 shadow-2xl relative group">
                            <img src="${this.getPortraitSrc(char)}" class="w-full h-auto object-contain max-h-[600px] transition-transform duration-500 group-hover:scale-[1.02]">
                            <div class="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none"></div>
                        </div>
                    </div>
                    ` : ''}
                </div>


                <!-- Prompts Tab -->
                <div id="tab-prompts" class="character-tab-content hidden animate-fade-rise">
                    <div class="space-y-6">
                        <!-- Outward Appearance (Moved) -->
                        <div class="bg-gray-900/40 border border-white/5 rounded-xl overflow-hidden shadow-inner flex flex-col transition-all duration-300 focus-within:ring-1 focus-within:ring-teal-500/50">
                            <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900/60">
                                <label class="text-[10px] uppercase tracking-widest font-bold text-gray-500">Outward Appearance (Prompt Basis)</label>
                                <button data-action="gen-char-appearance" data-id="${char.id}" class="micro-hover text-teal-400 hover:text-teal-300 p-1.5 bg-teal-950/20 rounded-md transition-colors border border-transparent hover:border-teal-500/30" title="Auto-Generate Appearance via AI">
                                    ${this.getAIGenIcon()}
                                </button>
                            </div>
                            <div class="relative group">
                                <div class="markdown-backdrop absolute inset-0 p-5 text-base leading-relaxed text-gray-200 pointer-events-none whitespace-pre-wrap break-words z-0 overflow-y-auto scrollbar-hide text-left border border-transparent" aria-hidden="true" style="font-family: var(--chat-font-family)">${DOM.unsafe(NarrativeController.formatMarkdownOverlay(char.appearance || char.physical_description || ''))}</div>
                                <textarea oninput="NarrativeController.updateCharacterField('${char.id}', 'appearance', this.value); NarrativeController.syncMarkdownOverlay(this)" onscroll="NarrativeController.syncMarkdownOverlay(this)" placeholder="Describe how others see this character..." class="relative z-10 w-full min-h-[16rem] bg-transparent border border-transparent p-5 text-base text-transparent caret-white placeholder-gray-600 focus:ring-0 resize-y overflow-y-auto scrollbar-hide max-h-[24rem] leading-relaxed rounded-xl transition-all" style="font-family: var(--chat-font-family)">${char.appearance || char.physical_description || ''}</textarea>
                            </div>
                        </div>

                        <div class="bg-gray-900/40 border border-white/5 rounded-xl overflow-hidden shadow-inner flex flex-col transition-all duration-300 focus-within:ring-1 focus-within:ring-teal-500/50">
                            <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900/60">
                                <label class="text-[10px] uppercase tracking-widest font-bold text-teal-400 flex items-center gap-2">
                                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                                    Persona Description (used by the character)
                                </label>
                                <div class="flex items-center gap-4">
                                    <span class="text-[10px] font-mono text-gray-500" id="token-counter-${char.id}">~${UTILITY.estimateTokens(char.description || '')} tokens</span>
                                    <button onclick="NarrativeController.viewEvolvedPersona('${char.id}')" class="micro-hover px-2 py-1 text-[10px] font-bold uppercase tracking-widest rounded-md transition-colors border ${hasEvolvedPersona ? 'bg-teal-950/40 text-teal-300 border-teal-500/50 hover:bg-teal-500 hover:text-white cursor-pointer' : 'bg-gray-800 text-gray-500 border-gray-700 opacity-50 cursor-not-allowed'}" ${hasEvolvedPersona ? '' : 'disabled'} title="View Narrative (Evolved) Persona">
                                        View Narrative Persona
                                    </button>
                                    <button data-action="enhance-persona" data-id="${char.id}" class="micro-hover text-teal-400 hover:text-teal-300 p-1.5 bg-teal-950/20 rounded-md transition-colors border border-transparent hover:border-teal-500/30" title="Enhance Persona via AI">
                                        ${this.getAIGenIcon()}
                                    </button>
                                </div>
                            </div>
                            <div class="relative">
                                <!-- Markdown Styling Overlay (Synced metrics to fix caret alignment) -->
                                <div class="markdown-backdrop absolute inset-0 p-5 text-base leading-relaxed text-gray-200 pointer-events-none whitespace-pre-wrap break-words z-0 overflow-y-auto scrollbar-hide text-left border border-transparent" aria-hidden="true" style="font-family: var(--chat-font-family)">${DOM.unsafe(NarrativeController.formatMarkdownOverlay(char.description || ''))}</div>
                                <textarea id="persona-description-${char.id}" oninput="NarrativeController.updateCharacterField('${char.id}', 'description', this.value); UIManager.updateTokenCount('${char.id}', this.value); NarrativeController.syncMarkdownOverlay(this)" onscroll="NarrativeController.syncMarkdownOverlay(this)" class="relative z-10 w-full min-h-[16rem] bg-transparent border border-transparent p-5 resize-y text-transparent caret-white focus:ring-0 focus:outline-none text-base leading-relaxed transition-colors overflow-y-auto scrollbar-hide" style="font-family: var(--chat-font-family)" placeholder="Describe the character's personality, background, appearance, and typical behavior...">${char.description}</textarea>
                            </div>
                        </div>
                        
                        <div class="bg-gray-900/40 border border-white/5 rounded-xl overflow-hidden shadow-inner flex flex-col transition-all duration-300 focus-within:ring-1 focus-within:ring-teal-500/50">
                            <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900/60">
                                <label class="text-[10px] uppercase tracking-widest font-bold text-teal-400 flex items-center gap-2">
                                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>
                                    Model Instructions
                                </label>
                                <button data-action="gen-model-instructions" data-id="${char.id}" class="micro-hover text-teal-400 hover:text-teal-300 p-1.5 bg-teal-950/20 rounded-md transition-colors border border-transparent hover:border-teal-500/30" title="Generate Instructions via AI">
                                    ${this.getAIGenIcon()}
                                </button>
                            </div>
                            <div class="relative">
                                <!-- Markdown Styling Overlay (Synced metrics to fix caret alignment) -->
                                <div class="markdown-backdrop absolute inset-0 p-5 text-base leading-relaxed text-gray-200 pointer-events-none whitespace-pre-wrap break-words z-0 overflow-y-auto scrollbar-hide text-left border border-transparent" aria-hidden="true" style="font-family: var(--chat-font-family)">${DOM.unsafe(NarrativeController.formatMarkdownOverlay(char.model_instructions || ''))}</div>
                                <textarea oninput="NarrativeController.updateCharacterField('${char.id}', 'model_instructions', this.value); NarrativeController.syncMarkdownOverlay(this)" onscroll="NarrativeController.syncMarkdownOverlay(this)" class="relative z-10 w-full min-h-[16rem] bg-transparent border border-transparent p-5 resize-y text-transparent caret-white focus:ring-0 focus:outline-none text-base leading-relaxed transition-colors overflow-y-auto scrollbar-hide" style="font-family: var(--chat-font-family)" placeholder="Specific instructions for how the AI should play this character (e.g., 'Speak with an Irish accent', 'Never use modern slang', etc.)...">${char.model_instructions}</textarea>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Advanced Tab (Voice + Portraits) -->
                <div id="tab-advanced" class="character-tab-content hidden animate-fade-rise">
                    <div class="space-y-12">
                        
                        <!-- Voice Section (Shifted Above Portraits) -->
                        <section>
                            <label class="text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-4 flex items-center gap-2 border-b border-white/5 pb-2">
                                <svg class="w-3.5 h-3.5 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path></svg>
                                Text-to-Speech Override
                            </label>
                            <div class="max-w-xl bg-gray-900/40 rounded-xl p-6 shadow-inner border border-white/5">
                                <p class="text-xs text-gray-400 mb-3 block">Select a specific voice to override the global setting.</p>
                                <select onchange="NarrativeController.updateCharacterField('${char.id}', 'ttsVoice', this.value)" class="w-full bg-gray-800 text-white border border-gray-700 hover:border-gray-500 rounded-lg p-3 text-sm focus:border-teal-500 focus:outline-none transition-colors shadow-inner appearance-none cursor-pointer">
                                    <option value="" class="bg-gray-800 text-white" ${!char.ttsVoice ? 'selected' : ''}>Default (Use Global Setting)</option>
                                    ${TTSService && TTSService.CONSTANTS && TTSService.CONSTANTS.VOICES ? DOM.unsafe(TTSService.CONSTANTS.VOICES.map(v => `<option value="${v.id}" class="bg-gray-800 text-white" ${char.ttsVoice === v.id ? 'selected' : ''}>${v.name}</option>`).join('')) : DOM.unsafe('<option class="bg-gray-800 text-white" disabled>No voices available</option>')}
                                </select>
                            </div>
                        </section>

                        <!-- Portraits Section -->
                        <section>
                            <label class="text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-4 flex items-center gap-2 border-b border-white/5 pb-2">
                                <svg class="w-3.5 h-3.5 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                Emotional Portraits
                            </label>
                            <div id="extra-portraits-${char.id}" class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                ${extraPortraitsHTML}
                                <!-- Add Button as a Card -->
                                <button data-action="add-extra-portrait" data-id="${char.id}" class="aspect-square rounded-xl border-2 border-dashed border-gray-600 bg-gray-800/30 hover:border-teal-500 hover:bg-teal-900/20 text-gray-500 hover:text-teal-400 transition-all flex flex-col items-center justify-center gap-3 shadow-inner group">
                                    <div class="bg-gray-800 group-hover:bg-teal-900/50 p-3 rounded-full transition-colors">
                                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                                    </div>
                                    <span class="text-[10px] font-bold tracking-widest uppercase">Add New</span>
                                </button>
                            </div>
                        </section>

                        <!-- Character Knowledge Section (Private) -->
                        <section>
                            <label class="text-[10px] uppercase tracking-widest font-bold text-teal-400 mb-4 flex items-center gap-2 border-b border-white/5 pb-2">
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
                                Character-Specific Knowledge (Private)
                            </label>
                            <div class="space-y-4">
                                ${(char.dynamic_knowledge || []).map((entry, eIdx) => DOM.html`
                                    <div class="bg-gray-900/40 rounded-xl border border-white/5 p-5 space-y-4 relative group/entry">
                                        <div class="flex gap-4 items-start">
                                            <div class="flex-grow space-y-4">
                                                <div class="flex flex-col md:flex-row gap-4">
                                                    <div class="md:w-1/3">
                                                        <label class="block text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-1">Entry Title</label>
                                                        <input type="text" value="${entry.title}" oninput="NarrativeController.updateCharacterKnowledgeField('${char.id}', '${entry.id}', 'title', this.value)" class="w-full bg-black/40 border border-gray-700 rounded-lg p-2 text-sm text-gray-200 focus:border-teal-500 outline-none transition-colors">
                                                    </div>
                                                    <div class="flex-grow">
                                                        <label class="block text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-1">Triggers (AND, XOR, %)</label>
                                                        <input type="text" value="${entry.triggers}" oninput="NarrativeController.updateCharacterKnowledgeField('${char.id}', '${entry.id}', 'triggers', this.value)" class="w-full bg-black/40 border border-gray-700 rounded-lg p-2 text-sm text-gray-200 focus:border-teal-500 outline-none transition-colors" placeholder="keyword1, keyword2 AND keyword3, 50%">
                                                    </div>
                                                </div>
                                                
                                                <div class="space-y-3">
                                                    <label class="block text-[10px] uppercase tracking-widest font-bold text-gray-500">Content Variations (Randomly progresses)</label>
                                                    ${(entry.content_fields || []).map((field, fIdx) => DOM.html`
                                                        <div class="flex gap-2 items-start group/field">
                                                            <textarea oninput="NarrativeController.updateCharacterKnowledgeContent('${char.id}', '${entry.id}', ${fIdx}, this.value)" class="flex-grow bg-black/20 border border-gray-800 rounded-lg p-3 text-sm text-gray-300 focus:border-teal-500 outline-none min-h-[5.5rem] transition-colors" placeholder="Secret knowledge to reveal...">${field}</textarea>
                                                            <button onclick="NarrativeController.removeCharacterKnowledgeContent('${char.id}', '${entry.id}', ${fIdx})" class="text-gray-600 hover:text-red-400 p-1 opacity-0 group-hover/field:opacity-100 transition-opacity" title="Remove Variation">
                                                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                                            </button>
                                                        </div>
                                                    `)}
                                                    <button onclick="NarrativeController.addCharacterKnowledgeContent('${char.id}', '${entry.id}')" class="text-[10px] uppercase tracking-widest font-bold text-teal-400 hover:text-teal-300 flex items-center gap-1 transition-colors">
                                                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg> Add Content Step
                                                    </button>
                                                </div>
                                            </div>
                                            <button onclick="NarrativeController.removeCharacterKnowledge('${char.id}', '${entry.id}')" class="micro-hover bg-red-900/20 hover:bg-red-900/40 text-red-400 p-2 rounded-lg border border-red-500/20 transition-all shadow-sm" title="Delete Entry">
                                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                            </button>
                                        </div>
                                    </div>
                                `)}
                                
                                <button onclick="NarrativeController.addCharacterKnowledge('${char.id}')" class="w-full border-2 border-dashed border-gray-700/50 rounded-xl p-6 text-gray-500 hover:text-teal-400 hover:border-teal-500/40 hover:bg-teal-900/10 transition-all flex flex-col items-center gap-2 group shadow-inner">
                                    <div class="bg-gray-800 group-hover:bg-teal-900/50 p-3 rounded-full transition-colors shadow-sm">
                                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                                    </div>
                                    <span class="text-xs font-bold uppercase tracking-widest">Add Private Knowledge Entry</span>
                                </button>
                            </div>
                        </section>
                        
                    </div>
                </div>
            </div>

            
            <div class="p-5 flex flex-row-reverse justify-between rounded-b-lg border-t border-white/5 bg-gray-900/60 backdrop-blur-sm">
                <!-- Empty spacer to push delete button to the left -->
                <button data-action="delete-character" data-id="${char.id}" class="px-4 py-2 bg-red-900/20 hover:bg-red-900/40 text-red-400 hover:text-red-300 text-xs uppercase tracking-wider font-bold rounded-lg border border-red-500/10 hover:border-red-500/30 transition-all flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    Delete Character
                </button>
            </div>
        `;
                container.innerHTML = modalHTML.toString();

                // Attach inline JS tab switcher with state persistence
                if (!window.switchCharTab) {
                    window.switchCharTab = function (btn, tabId) {
                        window.activeCharTab = tabId; // Persist state across re-renders
                        const container = btn.closest('#character-detail-modal-content');
                        if (!container) return;

                        container.querySelectorAll('.character-tab-content').forEach(el => {
                            el.classList.add('hidden');
                        });

                        container.querySelectorAll('.character-tab-btn').forEach(b => {
                            b.classList.remove('border-teal-500', 'text-teal-400');
                            b.classList.add('border-transparent', 'text-gray-400');
                        });

                        const targetContent = container.querySelector('#' + tabId);
                        if (targetContent) targetContent.classList.remove('hidden');

                        btn.classList.remove('border-transparent', 'text-gray-400');
                        btn.classList.add('border-teal-500', 'text-teal-400');
                    };
                }

                // Restore previous active tab state seamlessly
                setTimeout(() => {
                    const defaultTab = window.activeCharTab || 'tab-identity';
                    const targetBtn = container.querySelector('[data-tab="' + defaultTab + '"]');
                    if (targetBtn && window.switchCharTab) {
                        window.switchCharTab(targetBtn, defaultTab);
                    }
                }, 0);

                container.querySelectorAll('textarea').forEach(textarea => {
                    const autoResize = () => { textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight}px`; };
                    textarea.addEventListener('input', autoResize);
                    setTimeout(autoResize, 0);
                });
            },

            updateTokenCount(charId, text) {
                const counter = document.getElementById(`token-counter-${charId}`);
                if (counter) counter.textContent = `~${UTILITY.estimateTokens(text || '')} tokens`;
            },

            /**
             * Updates the AI character selector visibility and options.
             * Hides the selector if there is only one AI character.
             */
            updateAICharacterSelector() {
                const state = StateManager.getState();
                const wrapper = document.getElementById('ai-character-selector-wrapper');
                const selectorInput = document.getElementById('ai-character-selector');
                const dropdownMenu = document.getElementById('ai-character-dropdown-menu');
                const btn = document.getElementById('ai-character-selector-btn');

                if (!state || !state.characters || !dropdownMenu) {
                    if (dropdownMenu) dropdownMenu.innerHTML = '';
                    return;
                }

                // activeAiChars contains ONLY non-user characters
                let activeAiChars = state.characters.filter(c => !c.is_user && c.is_active);

                // Look for strictly local NPCs bound to your current world coordinates
                if (state.worldMap && state.worldMap.currentLocation && state.worldMap.grid) {
                    const currentLoc = state.worldMap.grid.find(loc => loc.coords.x === state.worldMap.currentLocation.x && loc.coords.y === state.worldMap.currentLocation.y);
                    if (currentLoc && currentLoc.characters && currentLoc.characters.length > 0) {
                        const localOnlyNpcs = currentLoc.characters.filter(c => c.is_active && !c.is_user);
                        activeAiChars = activeAiChars.concat(localOnlyNpcs);
                    }
                }

                // FIX: Item 7 - Logic check:
                // If 1 AI char + 1 User = 2 total. activeAiChars.length is 1. 1 <= 1 is true. Hidden. Correct.
                // If Event Master is configured, always show the selector
                const eventMasterOn = typeof AgentController !== 'undefined' && AgentController.isEventMasterOn();
                if (activeAiChars.length <= 1 && !eventMasterOn) {
                    if (wrapper) wrapper.style.display = 'none';
                } else {
                    if (wrapper) wrapper.style.display = 'block';
                }

                const currentValue = selectorInput.value || 'any';

                const createOption = (val, name, iconHtml, subtext) => {
                    const safeName = name.replace(/'/g, "\\'");
                    const subtextHtml = subtext ? `<span class="text-[10px] text-gray-500 leading-tight block truncate mt-0.5">${subtext}</span>` : '';
                    return `
                        <button onclick="document.getElementById('ai-character-selector').value = '${val}'; document.querySelector('#ai-character-selector-btn span').textContent = '${safeName}'; document.getElementById('ai-character-dropdown').classList.add('hidden');" class="w-full text-left hover:bg-indigo-600/20 px-3 py-2.5 rounded-lg text-sm flex items-center gap-3 transition-colors group" role="menuitem">
                            <div class="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center group-hover:bg-gray-700 transition-colors overflow-hidden border border-gray-600/50">
                                ${iconHtml}
                            </div>
                            <div class="overflow-hidden">
                                <span class="font-semibold text-white block leading-tight truncate">${name}</span>
                                ${subtextHtml}
                            </div>
                        </button>
                    `;
                };

                let optionsHTML = createOption('any', 'Any', '<svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>', 'Any character replies');

                if (eventMasterOn) {
                    optionsHTML += createOption('event_master', 'Event Master', '<svg class="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>', 'System Event');
                }

                activeAiChars.forEach(c => {
                    const imgUrl = UIManager.RUNTIME.characterImageCache && UIManager.RUNTIME.characterImageCache[c.id];
                    const avatarImg = imgUrl ? `<img src="${imgUrl}" class="w-full h-full object-cover" />` : '<svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>';
                    optionsHTML += createOption(c.id, c.name, avatarImg, c.persona ? c.persona.substring(0, 40) + '...' : 'AI Character');
                });

                dropdownMenu.innerHTML = optionsHTML;

                // Restore value or set to any
                let found = false;
                if (currentValue === 'any' || currentValue === 'event_master') found = true;
                if (!found) found = activeAiChars.some(c => c.id === currentValue);

                if (found) {
                    selectorInput.value = currentValue;
                    if (currentValue === 'any') btn.querySelector('span').textContent = 'Any';
                    else if (currentValue === 'event_master') btn.querySelector('span').textContent = 'Event Master';
                    else btn.querySelector('span').textContent = activeAiChars.find(c => c.id === currentValue).name;
                } else {
                    selectorInput.value = 'any';
                    btn.querySelector('span').textContent = 'Any';
                }
            },

            /**
             * Renders the Import/Export Hub modal.
             * Repurposed to handle Imports only. Exports moved to Settings.
             */
            renderIOHubModal() {
                const modalContent = document.getElementById('io-hub-modal-content');

                const hubHTML = DOM.html`
            <div class="p-6 border-b border-gray-700 flex justify-between items-center">
                <h2 class="text-2xl font-semibold">Library Management</h2>
                <button data-action="close-modal" data-id="io-hub-modal" class="bg-black/40 hover:bg-gray-700 text-gray-300 hover:text-white p-2 rounded-full backdrop-blur-sm transition-colors shadow-lg" title="Close">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
            <div class="p-6 overflow-y-auto">
                <div class="max-w-3xl mx-auto space-y-8">
                    
                    <!-- === EXPORT SECTION === -->
                    <div class="space-y-4">
                        <h3 class="text-xs uppercase tracking-wider text-gray-400 font-bold border-b border-gray-700 pb-2">Share</h3>
                        
                        <div class="bg-indigo-900/20 p-6 rounded-lg border border-indigo-500/30 hover:border-indigo-500/50 transition-colors">
                            <h3 class="text-xl font-bold mb-4 flex items-center gap-2 text-indigo-300">
                                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                Export Library Backup
                            </h3>
                            <p class="text-sm text-gray-300 mb-4">Create a portable backup of your entire library (Stories, Characters, Settings, and Images) as a ZIP archive.</p>
                            <button data-action="export-library" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                Download Library (ZIP)
                            </button>
                        </div>
                    </div>

                    <!-- === IMPORT SECTION === -->
                    <div class="space-y-4">
                        <h3 class="text-xs uppercase tracking-wider text-gray-400 font-bold border-b border-gray-700 pb-2">Import & Restore</h3>

                        <!-- Grid for Standard Imports -->
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <!-- Single File -->
                            <div class="bg-black/20 p-5 rounded-lg border border-gray-700/50 flex flex-col">
                                <h3 class="font-bold mb-2 flex items-center gap-2">
                                    <svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                                    Import File
                                </h3>
                                <p class="text-xs text-gray-400 mb-4 flex-grow">Import a Story or Character from .json, .png, .byaf, or .zip.</p>
                                <label for="single-file-upload" class="cursor-pointer">
                                    <div class="border border-dashed border-gray-600 hover:border-indigo-500 rounded-lg p-3 text-center bg-gray-800/30 hover:bg-gray-800/60 transition-all">
                                        <span class="text-sm font-semibold text-indigo-300">Select File</span>
                                    </div>
                                    <input id="single-file-upload" type="file" class="hidden" accept=".png,.byaf,.zip,.json" data-action-change="handle-file-upload">
                                </label>
                            </div>

                            <!-- Bulk Import -->
                            <div class="bg-black/20 p-5 rounded-lg border border-gray-700/50 flex flex-col">
                                <h3 class="font-bold mb-2 flex items-center gap-2">
                                    <svg class="w-5 h-5 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                                    Bulk Import
                                </h3>
                                <p class="text-xs text-gray-400 flex-grow mb-4">Import an entire folder of character cards or stories.</p>
                                <button data-action="handle-bulk-import" class="w-full bg-teal-600/20 hover:bg-teal-600/40 text-teal-200 border border-teal-600/50 font-bold py-2 px-3 rounded-lg transition-colors text-sm">
                                    Select Folder
                                </button>
                            </div>
                        </div>

                        <!-- Full Restore -->
                        <div class="bg-red-900/10 p-5 rounded-lg border border-red-900/30 mt-4">
                            <h3 class="font-bold mb-2 flex items-center gap-2 text-red-400">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                Restore Full Library
                            </h3>
                            <p class="text-xs text-gray-400 mb-3">Replace current library with a backup ZIP. <span class="font-bold text-red-400">Destructive: Overwrites existing data.</span></p>
                            <label class="w-full bg-red-900/40 hover:bg-red-800/60 text-white/90 font-bold py-2 px-4 rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer transition-colors text-sm">
                                <span>Upload Backup (ZIP)</span>
                                <input type="file" class="hidden" accept=".zip" data-action-change="import-library">
                            </label>
                        </div>
                    </div>

                </div>
            </div>
            <div class="p-4 bg-black/20 border-t border-gray-700 flex justify-end">
                <button data-action="close-modal" data-id="io-hub-modal" class="bg-gray-600 hover:bg-gray-700 font-bold py-2 px-4 rounded-lg">Close</button>
            </div>
        `;

                modalContent.innerHTML = hubHTML.toString();
            },

            /**
             * Shows a confirmation modal and returns a Promise resolving to true/false.
             * @param {string} message - The confirmation message.
             * @returns {Promise<boolean>} - Resolves with the user's choice.
             */
            showConfirmationPromise(message) {
                return new Promise((resolve) => {
                    const modal = document.getElementById('confirmation-modal');
                    const messageEl = document.getElementById('confirmation-modal-message');
                    const confirmBtn = document.getElementById('confirmation-modal-confirm-button');

                    // Defensive check: If critical UI elements are missing, auto-fail gracefully
                    if (!modal || !messageEl || !confirmBtn) {
                        console.error("UIManager: Critical Error - Confirmation Modal elements missing from DOM.");
                        resolve(false);
                        return;
                    }

                    const cancelBtn = modal.querySelector('button:not(#confirmation-modal-confirm-button)');
                    if (!cancelBtn) {
                        console.error("UIManager: Critical Error - Cancel button missing.");
                        resolve(false);
                        return;
                    }

                    messageEl.textContent = message;

                    const confirmClickHandler = () => {
                        cleanup();
                        resolve(true);
                    };
                    const cancelClickHandler = () => {
                        cleanup();
                        resolve(false);
                    };

                    const cleanup = () => {
                        confirmBtn.removeEventListener('click', confirmClickHandler);
                        cancelBtn.removeEventListener('click', cancelClickHandler);
                        const overlay = modal.querySelector('.modal-overlay');
                        if (overlay) overlay.removeEventListener('click', cancelClickHandler);
                        AppController.closeModal('confirmation-modal');
                    };

                    confirmBtn.addEventListener('click', confirmClickHandler, { once: true });
                    cancelBtn.addEventListener('click', cancelClickHandler, { once: true });

                    const overlay = modal.querySelector('.modal-overlay');
                    if (overlay) overlay.addEventListener('click', cancelClickHandler, { once: true });

                    AppController.openModal('confirmation-modal');
                });
            },

            /**
             * Displays a full-screen loading spinner with a message.
             * @param {string} [message='Loading...'] - The message to display.
             */
            showLoadingSpinner(message = 'Loading...') {
                let spinner = document.getElementById('loading-spinner');
                if (!spinner) {
                    spinner = document.createElement('div');
                    spinner.id = 'loading-spinner';
                    spinner.className = 'fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center';
                    spinner.innerHTML = DOM.html`
                <div class="w-16 h-16 border-4 border-t-indigo-500 border-gray-600 rounded-full animate-spin"></div>
                <p id="spinner-message" class="mt-4 text-white font-semibold"></p>
            `.toString();
                    document.body.appendChild(spinner);
                }
                document.getElementById('spinner-message').textContent = message;
                spinner.style.display = 'flex';
            },

            /**
             * Hides the loading spinner.
             */
            hideLoadingSpinner() {
                const spinner = document.getElementById('loading-spinner');
                if (spinner) {
                    spinner.style.display = 'none';
                }
            },

            /**
             * Displays a toast notification.
             */
            /**
             * Records an error and surfaces the dot. Replaces the red toast: that covered
             * the top of the chat on a phone and auto-dismissed after three seconds,
             * whether or not it had been read. The dot waits to be read instead.
             * @param {string} message - The error text.
             */
            logError(message) {
                this.RUNTIME.errorLog = this.RUNTIME.errorLog || [];
                this.RUNTIME.errorLog.push({ message: String(message || 'Unknown error'), ts: Date.now() });
                // Capped: a repeating background failure must not grow without bound.
                if (this.RUNTIME.errorLog.length > 50) this.RUNTIME.errorLog.shift();

                const dot = document.getElementById('error-dot');
                if (!dot) return;
                const count = document.getElementById('error-dot-count');
                if (count) count.textContent = String(this.RUNTIME.errorLog.length);
                dot.classList.add('is-visible');

                // Restart the one-shot pulse even if the dot was already showing.
                dot.classList.remove('error-dot-pulse');
                void dot.offsetWidth;
                dot.classList.add('error-dot-pulse');

                const openPanel = document.getElementById('error-log-panel');
                if (openPanel && !openPanel.classList.contains('hidden')) {
                    this.renderErrorLog();
                }
            },

            /**
             * Renders the collected errors into the panel, newest first.
             */
            renderErrorLog() {
                const list = document.getElementById('error-log-list');
                if (!list) return;
                const rows = UTILITY.collapseErrors(this.RUNTIME.errorLog || []);
                if (rows.length === 0) {
                    list.innerHTML = DOM.html`<p class="text-xs text-gray-500 py-2">Nothing has gone wrong.</p>`.toString();
                    return;
                }
                list.innerHTML = rows.map(r => {
                    const time = new Date(r.lastTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const badge = r.count > 1 ? DOM.html`<span class="shrink-0 text-[10px] font-bold text-red-300 bg-red-900/40 rounded px-1.5 py-0.5">x${r.count}</span>`.toString() : '';
                    return DOM.html`<div class="border-b border-gray-800 pb-2 last:border-0">
                        <div class="flex items-start justify-between gap-2">
                            <span class="text-xs text-gray-200 leading-relaxed">${r.message}</span>
                            ${DOM.unsafe(badge)}
                        </div>
                        <span class="text-[10px] text-gray-500">${time}</span>
                    </div>`.toString();
                }).join('');
            },

            /**
             * Opens the error list.
             */
            openErrorLog() {
                const panel = document.getElementById('error-log-panel');
                if (!panel) return;
                this.renderErrorLog();
                panel.classList.remove('hidden');
                panel.classList.add('flex');
            },

            /**
             * Closes the error list, leaving the dot in place so nothing is lost.
             */
            closeErrorLog() {
                const panel = document.getElementById('error-log-panel');
                if (panel) {
                    panel.classList.add('hidden');
                    panel.classList.remove('flex');
                }
            },

            /**
             * Discards the collected errors and hides the dot.
             */
            clearErrorLog() {
                this.RUNTIME.errorLog = [];
                this.renderErrorLog();
                this.closeErrorLog();
                const dot = document.getElementById('error-dot');
                if (dot) {
                    dot.classList.remove('is-visible', 'error-dot-pulse');
                }
            },

            showNotification(message, type = 'info') {
                // Errors go to the dot, not across the chat. Success and info still toast.
                if (type === 'error') {
                    this.logError(message);
                    return;
                }

                const container = document.getElementById('notification-container') || (() => {
                    const d = document.createElement('div');
                    d.id = 'notification-container';
                    d.className = 'fixed top-20 right-4 z-[90] flex flex-col gap-2 pointer-events-none';
                    document.body.appendChild(d);
                    return d;
                })();

                const toast = document.createElement('div');
                toast.className = `max-w-xs p-4 rounded-lg shadow-2xl text-white font-medium backdrop-blur-md transition-all duration-300 transform translate-x-full opacity-0 pointer-events-auto border border-white/10 ${type === 'error' ? 'bg-red-600/90' : 'bg-gray-800/90'}`;
                toast.style.minWidth = '200px';
                toast.innerHTML = `
                    <div class="flex items-center gap-3">
                        <div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${type === 'error' ? 'bg-red-500/20' : 'bg-indigo-500/20'}">
                            <svg class="w-4 h-4 ${type === 'error' ? 'text-red-300' : 'text-indigo-300'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${type === 'error' ? 'M6 18L18 6M6 6l12 12' : 'M5 13l4 4L19 7'}"></path>
                            </svg>
                        </div>
                        <span>${message}</span>
                    </div>
                `;
                container.appendChild(toast);

                // Animate In
                requestAnimationFrame(() => {
                    toast.classList.remove('translate-x-full', 'opacity-0');
                });

                // Remove after delay
                setTimeout(() => {
                    toast.classList.add('translate-x-full', 'opacity-0');
                    setTimeout(() => toast.remove(), 300);
                }, 3000);
            },

            showToast(message, isError = false) {
                this.showNotification(message, isError ? 'error' : 'info');
            },

            /**
             * Displays a report modal after a bulk import operation.
             * @param {Array<string>} importedStoryNames - List of successfully imported stories.
             * @param {Array<Object>} failedFiles - List of files that failed to import.
             */
            showBulkImportReport(importedStoryNames, failedFiles) {
                const container = document.getElementById('report-modal-content');

                const successList = importedStoryNames.map(name => DOM.html`<li>${name}</li>`);
                const failureSection = failedFiles.length > 0 ? (() => {
                    const logContent = failedFiles.map(f => `File: ${f.name}\nReason: ${f.reason}\n---`).join('\n');
                    const logBlob = new Blob([logContent], { type: 'text/plain' });
                    const logUrl = URL.createObjectURL(logBlob);
                    return DOM.html`
                <div>
                    <h3 class="font-bold text-lg text-red-400">Failures (${failedFiles.length})</h3>
                    <p class="text-sm mt-2">Some files could not be imported. <a href="${logUrl}" download="import_error_log.txt" class="text-indigo-400 hover:underline">Download Error Log</a> for details.</p>
                </div>
            `;
                })() : '';

                const reportHTML = DOM.html`
            <div class="p-6 border-b border-gray-700 flex justify-between items-center">
                <h2 class="text-2xl font-semibold">Bulk Import Report</h2>
                <button data-action="close-modal" data-id="report-modal" class="bg-black/40 hover:bg-gray-700 text-gray-300 hover:text-white p-2 rounded-full backdrop-blur-sm transition-colors shadow-lg" title="Close">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
            <div class="p-6 overflow-y-auto space-y-4">
                <div>
                    <h3 class="font-bold text-lg text-green-400">Success (${importedStoryNames.length})</h3>
                    <ul class="list-disc list-inside text-sm mt-2 max-h-40 overflow-y-auto bg-black/20 p-2 rounded-md">
                        ${successList.length ? successList : DOM.unsafe('<li>No stories were imported successfully.</li>')}
                    </ul>
                </div>
                ${failureSection}
            </div>
            <div class="p-4 bg-black/20 border-t border-gray-700 flex justify-end">
                <button data-action="close-modal" data-id="report-modal" class="bg-gray-600 hover:bg-gray-700 font-bold py-2 px-4 rounded-lg">Done</button>
            </div>
        `;

                container.innerHTML = reportHTML.toString();
                AppController.openModal('report-modal');
            },

            /**
             * Shows a confirmation modal with a callback for the confirm action.
             * @param {string} message - The confirmation message.
             * @param {Function} onConfirmCallback - The function to call on confirmation.
             */
            showConfirmationModal(message, onConfirmCallback) {
                const modal = document.getElementById('confirmation-modal');
                const messageEl = document.getElementById('confirmation-modal-message');
                const confirmBtn = document.getElementById('confirmation-modal-confirm-button');

                if (modal && messageEl && confirmBtn) {
                    messageEl.textContent = message;

                    const newConfirmBtn = confirmBtn.cloneNode(true);
                    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

                    newConfirmBtn.onclick = () => {
                        onConfirmCallback();
                        AppController.closeModal('confirmation-modal');
                    };
                    AppController.openModal('confirmation-modal');
                } else {
                    console.error("Confirmation modal elements not found.");
                }
            },

            /**
             * Opens a Generic Image Generator Modal.
             * @param {Object} options - Configuration for the generator.
             * @param {string} options.title - Header title.
             * @param {string} options.initialPrompt - Default prompt text.
             * @param {string|null} [options.initialNegative] - Default negative prompt.
             * @param {Function} options.onSave - Async callback(blob) when user clicks Save.
             */
            openGenericImageGenerator(opts) {
                const { title, initialPrompt, initialNegative = null, onSave, initImage = null } = opts;
                // Remove existing if any
                const existing = document.getElementById('image-gen-modal');
                if (existing) existing.remove();

                const modal = document.createElement('div');
                modal.id = 'image-gen-modal';
                modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] modal-overlay hidden';

                // Construct the source preview if in I2I mode
                const i2iSourceHtml = initImage ? DOM.html`
                    <div class="flex items-center gap-4 p-3 bg-indigo-900/20 border border-indigo-500/30 rounded-lg mb-4">
                        <div class="w-16 h-16 rounded overflow-hidden border border-indigo-500 bg-gray-900">
                            <img src="${URL.createObjectURL(initImage)}" class="w-full h-full object-cover">
                        </div>
                        <div class="flex-grow">
                            <div class="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">Image-to-Image Mode</div>
                            <div class="text-xs text-indigo-200/70 leading-tight">Using character portrait as starting point for facial expression shift.</div>
                        </div>
                    </div>
                ` : '';

                modal.innerHTML = DOM.unsafe(`
                             <div class="bg-gray-800 rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl border border-gray-700">
                                <div class="px-6 py-4 border-b border-gray-700 flex justify-between items-center bg-gray-900/50 rounded-t-lg">
                                    <h3 class="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">
                                        ${title}
                                    </h3>
                                    <button onclick="AppController.closeModal('image-gen-modal')" class="text-gray-400 hover:text-white">&times;</button>
                                </div>
                                <div id="image-gen-content" class="p-6 overflow-y-auto space-y-4">
                                     ${i2iSourceHtml}
                                     <div>
                                        <label class="block text-sm font-bold text-gray-400 mb-1">Prompt</label>
                                        <textarea id="gen-img-prompt" class="w-full bg-black/30 border-gray-600 p-3 rounded h-24 resize-none focus:border-indigo-500 font-mono text-sm">${initialPrompt}</textarea>
                                    </div>
                                    <div>
                                         <label class="block text-sm font-bold text-gray-400 mb-1">Negative Prompt (Optional)</label>
                                         <input type="text" id="gen-img-neg" value="${initialNegative || 'nsfw, text, watermark, bad anatomy, blurry'}" class="w-full bg-black/30 border-gray-600 p-2 rounded focus:border-indigo-500">
                                    </div>
                                    
                                    <div id="gen-result-area" class="mt-4 min-h-[300px] flex items-center justify-center bg-black/20 border-2 border-dashed border-gray-700 rounded-lg relative overflow-hidden group">
                                        <span class="text-gray-500 text-sm">Preview will appear here</span>
                                    </div>

                                    <div class="flex justify-end gap-3 pt-4 border-t border-gray-700 mt-4">
                                         <button onclick="AppController.closeModal('image-gen-modal')" class="px-4 py-2 text-gray-400 hover:text-white transition-colors">Cancel</button>
                                         <div class="flex-grow"></div>
                                         <button id="btn-do-generate" class="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-6 rounded-lg transition-all shadow-lg shadow-indigo-900/50 flex items-center gap-2">
                                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                            Generate
                                         </button>
                                    </div>
                                </div>
                            </div>
                         `);
                document.body.appendChild(modal);

                // Bind Generate Action
                document.getElementById('btn-do-generate').onclick = async (e) => {
                    const prompt = document.getElementById('gen-img-prompt').value;
                    const neg = document.getElementById('gen-img-neg').value;
                    const resultArea = document.getElementById('gen-result-area');
                    const btn = e.target.closest('button');

                    btn.disabled = true;
                    btn.innerHTML = `<svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Generating...`;

                    try {
                        const blob = await ImageGenerationService.generateImage(prompt, neg, {}, initImage);
                        const url = URL.createObjectURL(blob);

                        // Render Result with Save Options
                        resultArea.innerHTML = DOM.html`
                            <img src="${url}" class="w-full h-full object-contain">
                            <div class="absolute bottom-0 left-0 right-0 bg-black/80 p-3 flex justify-center gap-4 backdrop-blur-sm transition-transform translate-y-full group-hover:translate-y-0">
                                <button id="btn-save-img" class="bg-green-600 hover:bg-green-500 text-white font-bold py-1 px-4 rounded shadow-lg text-sm flex items-center gap-2">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                    Save & Use
                                </button>
                                <button id="btn-discard-img" class="bg-red-600/80 hover:bg-red-500 text-white font-bold py-1 px-4 rounded shadow-lg text-sm">Discard</button>
                            </div>
                        `;
                        resultArea.classList.remove('border-dashed', 'border-gray-700');
                        resultArea.classList.add('border-indigo-500');

                        // Move Save bar up immediately on mobile/touch? No, hover is fine for now, or ensure it's visible.
                        // Actually, let's make it always visible on completion to be safe.
                        resultArea.querySelector('div').classList.remove('translate-y-full', 'group-hover:translate-y-0');

                        // Save Handler
                        document.getElementById('btn-save-img').onclick = async () => {
                            try {
                                await onSave(blob);
                                AppController.closeModal('image-gen-modal');
                            } catch (err) {
                                alert("Failed to save image: " + err.message);
                            }
                        };

                        // Discard Handler
                        document.getElementById('btn-discard-img').onclick = () => {
                            resultArea.innerHTML = '<span class="text-gray-500 text-sm">Preview will appear here</span>';
                            resultArea.classList.add('border-dashed', 'border-gray-700');
                            resultArea.classList.remove('border-indigo-500');
                        };

                    } catch (err) {
                        resultArea.innerHTML = `<div class="text-red-400 p-4 text-center font-bold">Generation Failed</div><div class="text-red-300 text-xs px-4 pb-4 text-center">${err.message}</div>`;
                    } finally {
                        btn.disabled = false;
                        btn.innerHTML = 'Generate'; // Reset Label
                    }
                };

                AppController.openModal('image-gen-modal');
            },

            /**
             * Updates the primary action button to "Stop Generation" mode.
             */
            setButtonToStopMode() {
                const button = document.getElementById('primary-action-btn');
                if (!button) return;
                button.onclick = () => NarrativeController.stopGeneration();
                button.title = "Stop Generation";
                button.classList.remove('bg-indigo-600/50', 'hover:bg-indigo-600/80');
                button.classList.add('bg-red-700/60', 'hover:bg-red-700/80');
                // FIX: Updated Stop Icon (Rounded Square)
                button.innerHTML = DOM.unsafe(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-icon lucide-square" style="display: inline;"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>`);

                setTimeout(() => {
                    button.onclick = () => NarrativeController.stopGeneration();
                }, 0);
            },

            /**
             * Updates the primary action button to "Send / Generate Next" mode.
             */
            setButtonToSendMode() {
                const button = document.getElementById('primary-action-btn');
                if (!button) return;
                button.onclick = () => NarrativeController.handlePrimaryAction();
                button.title = "Send / Generate Next";
                button.classList.remove('bg-red-700/60', 'hover:bg-red-700/80');
                button.classList.add('bg-gray-700/00', 'hover:bg-gray-600/80');
                // FIX: Updated Send Icon (Paper Plane)
                button.innerHTML = DOM.unsafe(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-square-more-icon lucide-message-square-more" style="display: inline;"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M12 11h.01"/><path d="M16 11h.01"/><path d="M8 11h.01"/></svg>`);
            },

            /**
             * Initializes the scroll listener for the chat window to manage the scroll-to-bottom button.
             */
            initChatScrollListener() {
                const chatWindow = document.getElementById('chat-window');
                if (!chatWindow) return;

                // Use throttle-like behavior or just standard listener since it's lightweight
                chatWindow.addEventListener('scroll', () => this.handleChatScroll());

                // Also check on window resize
                window.addEventListener('resize', () => this.handleChatScroll());
            },

            /**
             * Handles the scroll event on the chat window to show/hide the scroll-to-bottom button.
             */
            handleChatScroll() {
                const chatWindow = document.getElementById('chat-window');
                const btn = document.getElementById('scroll-to-bottom-btn');
                if (!chatWindow || !btn) return;

                // Threshold: If user is more than 300px from the bottom
                const distanceFromBottom = chatWindow.scrollHeight - (chatWindow.scrollTop + chatWindow.clientHeight);
                const isFarUp = distanceFromBottom > 300;

                if (isFarUp) {
                    btn.classList.add('visible');
                } else {
                    btn.classList.remove('visible');
                }
            }
        };
