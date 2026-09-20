        /**
         * =================================================================================================
         * [SEC:JS:MOD:AD]
         * ActionDispatcher Module
         * The "Glue" that connects UI Events (ActionHandler) to the specific Controllers.
         * =================================================================================================
         */
        const ActionDispatcher = {
            /**
             * Initializes the ActionDispatcher.
             * Registers all action handlers to their respective controllers.
             */
            init() {

                ActionHandler.register('gen-story-phase-1', (ds, val, e) => LibraryController.generateStoryPhase1(e));
                ActionHandler.register('gen-story-retry', () => LibraryController.retryGenStory());
                ActionHandler.register('gen-story-confirm', () => LibraryController.confirmGenStory());

                // --- AppController (Navigation & Global UI) ---
                ActionHandler.register('open-modal', (ds) => AppController.openModal(ds.target, ds.id));
                ActionHandler.register('open-hub', () => HubController.openHub());
                ActionHandler.register('view-hub-details', (ds, val) => HubController.viewDetails(val));
                ActionHandler.register('close-hub-details', () => HubController.closeDetails());
                ActionHandler.register('import-hub-character', (ds, val) => HubController.importCharacter(val));
                ActionHandler.register('close-modal', (ds) => AppController.closeModal(ds.id));
                ActionHandler.register('toggle-mobile-menu', () => AppController.toggleMobileMenu());

                // --- TextModeController (Private text threads) ---
                ActionHandler.register('open-dm-thread', (ds) => TextModeController.open(ds.id));
                ActionHandler.register('close-dm-thread', () => TextModeController.close());
                ActionHandler.register('toggle-dm-options', () => TextModeController.toggleOptions());
                ActionHandler.register('open-dm-inbox', () => TextModeController.openInbox());
                ActionHandler.register('close-dm-inbox', () => TextModeController.closeInbox());

                // Thread option toggles write straight to narrative state.
                document.querySelectorAll('.dm-opt-toggle').forEach(el => {
                    el.addEventListener('change', (e) => {
                        const key = el.dataset.dmOpt;
                        if (!key || !ReactiveStore.state) return;
                        ReactiveStore.state[key] = e.target.checked;
                        if (typeof ReactiveStore.forceSave === 'function') ReactiveStore.forceSave();
                    });
                });
                // Sending is handled by the normal chat input via NarrativeController.sendMessage,
                // so the thread keeps every existing message tool. Escape leaves the thread.
                document.addEventListener('keydown', (e) => {
                    if (e.key !== 'Escape') return;
                    if (typeof TextModeController === 'undefined') return;

                    // Inbox closes first if it is open.
                    const inbox = document.getElementById('dm-inbox');
                    if (inbox && !inbox.classList.contains('hidden')) {
                        e.preventDefault();
                        TextModeController.closeInbox();
                        return;
                    }
                    if (!TextModeController.isActive()) return;

                    // If the character menu is open, Escape dismisses that first.
                    const menu = document.getElementById('character-context-menu');
                    if (menu && !menu.classList.contains('hidden')) return;

                    e.preventDefault();
                    TextModeController.close();
                });

                // Onboarding Actions
                ActionHandler.register('onboarding-create-blank', () => {
                    localStorage.setItem('onboarding_dismissed', 'true');
                    AppController.closeModal('onboarding-modal');
                    LibraryController.createNewStory();
                });
                ActionHandler.register('onboarding-ai-generate', () => {
                    localStorage.setItem('onboarding_dismissed', 'true');
                    AppController.closeModal('onboarding-modal');
                    AppController.openModal('gen-story-modal');
                });
                ActionHandler.register('onboarding-import-png', () => {
                    localStorage.setItem('onboarding_dismissed', 'true');
                    AppController.closeModal('onboarding-modal');
                    // "Import Character Card" on the last onboarding step used to click an
                    // #onboarding-file-input that is not in the page, so the card closed the
                    // welcome screen and then did nothing. The library's own file picker only
                    // exists once the library has been drawn, which has not happened yet during
                    // onboarding, so bring one along and hand the file to the same importer.
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.png,.byaf,.zip,.json';
                    input.className = 'hidden';
                    input.addEventListener('change', (e) => {
                        LibraryController.handleFileUpload(e);
                        input.remove();
                    });
                    document.body.appendChild(input);
                    input.click();
                });
                ActionHandler.register('onboarding-explore-demo', () => {
                    localStorage.setItem('onboarding_dismissed', 'true');
                    AppController.closeModal('onboarding-modal');
                    const library = StateManager.getLibrary();

                    // Priority 1: Current active story
                    // Priority 2: Story with "Shattered Crown" in title (the demo)
                    // Priority 3: First story in library
                    let storyId = library.active_story_id;
                    if (!storyId && library.stories.length > 0) {
                        const demoStory = library.stories.find(s => s.name?.includes("Shattered Crown"));
                        storyId = demoStory ? demoStory.id : library.stories[0].id;
                    }

                    if (storyId) {
                        // Ensure library state reflects this story
                        library.active_story_id = storyId;
                        UIManager.openStoryDetails(storyId);
                    } else {
                        // Fallback: Just open the library modal
                        AppController.openModal('story-library-modal');
                    }
                });

                // Settings are mostly bi-directional bindings handled inside AppController.bindSettingsListeners,
                // but we can map specific actions here if needed in the future.

                // --- LibraryController (Stories, Scenarios, IO) ---
                ActionHandler.register('open-story', (ds) => UIManager.openStoryDetails(ds.id));
                ActionHandler.register('duplicate-story', (ds) => LibraryController.duplicateStory(ds.id));
                ActionHandler.register('delete-story', (ds) => LibraryController.deleteStory(ds.id));
                ActionHandler.register('gen-story-notes', (ds, val, e) => LibraryController.generateStoryNotesAI(e, ds.id));
                ActionHandler.register('gen-story-tags', (ds, val, e) => LibraryController.generateStoryTagsAI(e, ds.id));

                // Lightbox Actions
                ActionHandler.register('open-lightbox', (ds) => UIManager.openLightbox(ds.index));
                ActionHandler.register('lightbox-next', () => UIManager.navigateLightbox(1));
                ActionHandler.register('lightbox-prev', () => UIManager.navigateLightbox(-1));
                ActionHandler.register('close-lightbox', () => UIManager.closeLightbox());

                // Scenario Actions (Load, Rename, Delete)
                ActionHandler.register('load-scenario', (ds) => LibraryController.createNarrativeFromScenario(ds.storyId, ds.scenarioId));
                ActionHandler.register('edit-scenario', (ds) => LibraryController.editScenario(ds.storyId, ds.scenarioId));
                ActionHandler.register('rename-scenario', (ds) => LibraryController.renameScenario(ds.storyId, ds.scenarioId));
                ActionHandler.register('delete-scenario', (ds) => LibraryController.deleteScenario(ds.storyId, ds.scenarioId));
                ActionHandler.register('select-scenario-static', (ds) => LibraryController.selectScenarioStaticEntry(ds.id));
                ActionHandler.register('delete-scenario-static', (ds) => LibraryController.deleteScenarioStaticEntry(ds.id));
                ActionHandler.register('select-scenario-dynamic', (ds) => LibraryController.selectScenarioDynamicEntry(ds.id));
                ActionHandler.register('delete-scenario-dynamic', (ds) => LibraryController.deleteScenarioDynamicEntry(ds.id));

                // Narrative Actions
                ActionHandler.register('load-narrative', (ds) => LibraryController.loadNarrative(ds.storyId, ds.narrativeId));
                ActionHandler.register('duplicate-narrative', (ds) => LibraryController.duplicateNarrative(ds.storyId, ds.narrativeId));
                ActionHandler.register('delete-narrative', (ds) => LibraryController.deleteNarrative(ds.storyId, ds.narrativeId));
                ActionHandler.register('elevate-narrative', (ds) => LibraryController.elevateNarrativeToScenario(ds.storyId, ds.narrativeId));

                // Import / Export
                ActionHandler.register('handle-file-upload', (ds, val, e) => LibraryController.handleFileUpload(e));
                ActionHandler.register('handle-bulk-import', () => LibraryController.handleBulkImport());
                ActionHandler.register('import-library', (ds, val, e) => LibraryController.importLibrary(e));
                ActionHandler.register('export-story', (ds) => LibraryController.exportStoryAs(ds.format));
                ActionHandler.register('export-library', () => LibraryController.exportLibrary());

                // --- NarrativeController (Chat, Characters, AI) ---
                ActionHandler.register('open-message-menu', (ds, val, e) => {
                    // Anchor under the kebab rather than at the pointer, so on touch the
                    // menu doesn't open beneath the finger that summoned it.
                    const btn = (e && e.target) ? e.target.closest('[data-action="open-message-menu"]') : null;
                    const r = btn ? btn.getBoundingClientRect() : null;
                    const x = r ? r.left : (e ? e.clientX : 0);
                    const y = r ? r.bottom + 4 : (e ? e.clientY : 0);
                    UIManager.openMessageMenu(parseInt(ds.index), x, y);
                });
                ActionHandler.register('combine-with-previous', (ds) => NarrativeController.combineWithPrevious(parseInt(ds.index)));
                ActionHandler.register('recombine-message', (ds) => NarrativeController.recombineMessage(parseInt(ds.index)));
                ActionHandler.register('split-combined-message', (ds) => NarrativeController.splitCombinedMessage(parseInt(ds.index)));
                // --- Visual Lore: attaching to a turn ---
                // Both entries in the image button's menu. Upload duplicates what a plain
                // tap does, so the menu reads as a choice rather than a single stray item.
                ActionHandler.register('upload-image', () => {
                    const input = document.getElementById('image-upload-input');
                    if (input) input.click();
                });
                ActionHandler.register('visual-lore-open-picker', () => UIManager.openVisualLorePicker());
                ActionHandler.register('visual-lore-close-picker', () => UIManager.closeVisualLorePicker());
                ActionHandler.register('visual-lore-picker-filter', (ds) => {
                    UIManager.VISUAL_LORE.pickerFilter = ds.cat || 'all';
                    UIManager.renderVisualLorePicker();
                });
                ActionHandler.register('visual-lore-toggle', (ds) => {
                    const list = UIManager.VISUAL_LORE_PENDING;
                    const at = list.indexOf(ds.id);
                    if (at === -1) list.push(ds.id); else list.splice(at, 1);
                    UIManager.renderVisualLoreChips();
                    // The chips are also toggles, so only redraw the picker while it is open.
                    const picker = document.getElementById('visual-lore-picker');
                    if (picker && !picker.classList.contains('hidden')) UIManager.renderVisualLorePicker();
                });

                // --- Visual Lore ---
                ActionHandler.register('visual-lore-filter', (ds) => {
                    UIManager.VISUAL_LORE.filter = ds.cat || 'all';
                    UIManager.renderVisualLore();
                });
                ActionHandler.register('visual-lore-select', (ds) => {
                    UIManager.VISUAL_LORE.selectedId = ds.id;
                    UIManager.renderVisualLore();
                });
                ActionHandler.register('visual-lore-add', () => {
                    const item = VisualLoreService.save({ title: 'New Item', category: 'item', description: '' });
                    UIManager.VISUAL_LORE.selectedId = item.id;
                    UIManager.renderVisualLore();
                });
                ActionHandler.register('visual-lore-save', (ds) => {
                    const item = VisualLoreService.get(ds.id);
                    if (!item) return;
                    const title = document.getElementById('visual-lore-title');
                    const category = document.getElementById('visual-lore-category');
                    const description = document.getElementById('visual-lore-description');
                    const focus = document.getElementById('visual-lore-focus');
                    VisualLoreService.save({
                        id: item.id,
                        title: title ? title.value : item.title,
                        category: category ? category.value : item.category,
                        description: description ? description.value : item.description,
                        focus: focus ? focus.value : item.focus,
                        imageId: item.imageId
                    });
                    UIManager.renderVisualLore();
                    UIManager.showNotification('Saved.', 'success');
                });
                ActionHandler.register('visual-lore-delete', async (ds) => {
                    const item = VisualLoreService.get(ds.id);
                    if (!item) return;
                    UIManager.showConfirmationModal(`Delete "${item.title}"?`, async () => {
                        await VisualLoreService.remove(ds.id);
                        if (UIManager.VISUAL_LORE.selectedId === ds.id) UIManager.VISUAL_LORE.selectedId = null;
                        UIManager.renderVisualLore();
                    });
                });
                ActionHandler.register('visual-lore-pick-image', (ds) => {
                    const input = document.getElementById('visual-lore-file');
                    if (!input) return;
                    // One-shot handler so the id being edited travels with the pick.
                    input.onchange = async (e) => {
                        const file = e.target.files && e.target.files[0];
                        input.value = '';
                        if (!file) return;
                        try {
                            const item = VisualLoreService.get(ds.id);
                            if (!item) return;
                            const previous = item.imageId;
                            const imageId = await VisualLoreService.storeImage(file);
                            VisualLoreService.save(Object.assign({}, item, { imageId }));
                            // Replacing a picture should not leave the old one behind.
                            if (previous) {
                                try { await DBService.deleteImage(previous); } catch (err) { }
                            }
                            UIManager.renderVisualLore();
                        } catch (err) {
                            UIManager.showNotification(err.message || 'Could not store that picture.', 'error');
                        }
                    };
                    input.click();
                });
                ActionHandler.register('visual-lore-describe', async (ds) => {
                    const item = VisualLoreService.get(ds.id);
                    if (!item || !item.imageId || UIManager.VISUAL_LORE.busy) return;
                    UIManager.VISUAL_LORE.busy = true;
                    UIManager.renderVisualLoreDetails();
                    try {
                        const focusEl = document.getElementById('visual-lore-focus');
                        const catEl = document.getElementById('visual-lore-category');
                        // Use what is on screen, so a focus note works before it is saved.
                        const aimed = Object.assign({}, item, {
                            focus: focusEl ? focusEl.value : item.focus,
                            category: catEl ? catEl.value : item.category
                        });
                        const described = await VisualLoreService.describeImage(item.imageId, aimed);
                        if (described) {
                            VisualLoreService.save(Object.assign({}, aimed, { description: described }));
                            UIManager.showNotification('Described. Edit it to taste.', 'success');
                        } else {
                            UIManager.showNotification('The model replied with an empty description. It may have declined this picture.', 'error');
                        }
                    } catch (err) {
                        UIManager.showNotification(err.message || 'Describe failed.', 'error');
                    } finally {
                        UIManager.VISUAL_LORE.busy = false;
                        UIManager.renderVisualLore();
                    }
                });

                ActionHandler.register('open-error-log', () => UIManager.openErrorLog());
                ActionHandler.register('close-error-log', () => UIManager.closeErrorLog());
                ActionHandler.register('clear-error-log', () => UIManager.clearErrorLog());
                ActionHandler.register('chat-copy', (ds) => NarrativeController.copyMessage(ds.index));
                ActionHandler.register('chat-edit', (ds) => NarrativeController.openEditModal(ds.index));
                ActionHandler.register('chat-delete', (ds) => NarrativeController.deleteMessage(ds.index));
                ActionHandler.register('trigger-visual-event', (ds, val, e) => {
                    const btn = (e && e.target) ? e.target.closest('button') : null;
                    if (typeof NarrativeController !== 'undefined') NarrativeController.closeAllMessageMenus();
                    if (typeof VisualMaster !== 'undefined') {
                        VisualMaster.triggerVisualEvent(parseInt(ds.index, 10), btn);
                    }
                });
                ActionHandler.register('view-message-thinking', (ds) => NarrativeController.openThinkingModal(parseInt(ds.index, 10)));
                ActionHandler.register('toggle-message-menu', (ds, val, e) => NarrativeController.toggleMessageMenu(parseInt(ds.index, 10), e));
                ActionHandler.register('copy-thinking-modal-text', () => NarrativeController.copyThinkingModalText());
                ActionHandler.register('quick-create-character', () => NarrativeController.quickCreateCharacter());
                ActionHandler.register('skip-typewriter', () => {
                    if (UIManager.RUNTIME.skipTypewriter) UIManager.RUNTIME.skipTypewriter();
                });

                ActionHandler.register('move-example-turn', (ds) => NarrativeController.moveExampleDialogueTurn(parseInt(ds.index), ds.direction));
                ActionHandler.register('delete-example-turn', (ds) => NarrativeController.deleteExampleDialogueTurn(parseInt(ds.index)));

                ActionHandler.register('open-character-detail', (ds) => AppController.openModal('character-detail-modal', ds.id));
                ActionHandler.register('delete-character', (ds) => NarrativeController.deleteCharacter(ds.id));
                ActionHandler.register('set-char-role', (ds) => NarrativeController.setCharacterRole(ds.id, ds.role));
                ActionHandler.register('gen-char-tags', (ds, val, e) => NarrativeController.generateTagsForCharacter(e, ds.id));
                ActionHandler.register('gen-char-appearance', (ds, val, e) => NarrativeController.generateAppearanceForCharacter(e, ds.id));
                ActionHandler.register('gen-short-desc', (ds, val, e) => NarrativeController.generateShortDescForCharacter(e, ds.id));
                ActionHandler.register('enhance-persona', (ds, val, e) => NarrativeController.enhancePersonaWithAI(e, ds.id));
                ActionHandler.register('gen-model-instructions', (ds, val, e) => NarrativeController.generateModelInstructions(e, ds.id));
                ActionHandler.register('add-extra-portrait', (ds) => NarrativeController.addExtraPortrait(ds.id));
                ActionHandler.register('remove-extra-portrait', (ds) => NarrativeController.removeExtraPortrait(ds.id, ds.index));
                ActionHandler.register('upload-local-image', (ds, val, e) => NarrativeController.handleLocalImageUpload(e, ds.id));
                ActionHandler.register('upload-emo-image', (ds, val, e) => NarrativeController.handleLocalEmotionImageUpload(e, ds.id, ds.index));

                // --- WorldController (Map, Lore) ---
                ActionHandler.register('switch-world-map-tab', (ds) => WorldController.switchWorldMapTab(ds.tab));
                ActionHandler.register('gen-world-map', (ds, val, e) => WorldController.generateWorldMap(e));
                ActionHandler.register('clear-world-map', () => WorldController.clearWorldMap());
                ActionHandler.register('select-pending-move', (ds) => WorldController.selectPendingMove(parseInt(ds.x), parseInt(ds.y)));
                ActionHandler.register('confirm-move', () => WorldController.confirmMove());
                ActionHandler.register('select-map-tile', (ds) => WorldController.selectMapTile(parseInt(ds.x), parseInt(ds.y)));
                ActionHandler.register('upload-loc-image', (ds, val, e) => WorldController.handleWorldMapLocationImageUpload(e, ds.x, ds.y));
                ActionHandler.register('gen-loc-prompt', (ds, val, e) => WorldController.generateLocationPromptAI(e));
                ActionHandler.register('set-destination', () => WorldController.setDestination());
                ActionHandler.register('jump-to-location', (ds) => {
                    WorldController.moveToLocation(parseInt(ds.x), parseInt(ds.y));
                    AppController.closeModal('world-map-modal');
                });

                ActionHandler.register('add-static-entry', () => WorldController.addStaticEntry());
                ActionHandler.register('select-static-entry', (ds) => WorldController.selectStaticEntry(ds.id));
                ActionHandler.register('gen-static-ai', (ds, val, e) => WorldController.generateStaticEntryContentAI(e, ds.id));
                ActionHandler.register('delete-static-entry', (ds) => WorldController.deleteStaticEntry(ds.id));
                ActionHandler.register('check-world-info', () => WorldController.checkWorldInfoAgent());
                ActionHandler.register('gen-location-image', (ds) => WorldController.openLocationImageGenerator());

                ActionHandler.register('add-dynamic-entry', () => WorldController.addDynamicEntry());
                ActionHandler.register('select-dynamic-entry', (ds) => WorldController.selectDynamicEntry(ds.id));
                ActionHandler.register('gen-dynamic-ai', (ds, val, e) => WorldController.generateDynamicEntryContentAI(e, ds.id, ds.index));
                ActionHandler.register('add-dynamic-field', (ds) => WorldController.addDynamicContentField(ds.id));
                ActionHandler.register('delete-dynamic-entry', (ds) => WorldController.deleteDynamicEntry(ds.id));
                ActionHandler.register('import-lorebook-trigger', () => {
                    const input = document.getElementById('lorebook-file-input');
                    if (input) input.click();
                });
                ActionHandler.register('import-lorebook-file', (ds, val, e) => WorldController.importLorebook(e));
                ActionHandler.register('export-lorebook', () => WorldController.exportLorebook());

                ActionHandler.register('select-gm-rule', (ds) => {
                    ReactiveStore.state.selectedGMRuleId = ds.id;
                    UIManager.renderGMRules();
                });
                ActionHandler.register('add-gm-rule', () => WorldController.addGMRule());
                ActionHandler.register('delete-gm-rule', (ds) => WorldController.deleteGMRule(ds.id));
                ActionHandler.register('clear-gm-ledger', () => WorldController.clearGMLedger());

                ActionHandler.register('add-local-static-entry', () => WorldController.addLocalStaticEntry());
                ActionHandler.register('select-local-static-entry', (ds) => WorldController.selectLocalStaticEntry(ds.id));
                ActionHandler.register('delete-local-static-entry', (ds) => WorldController.deleteLocalStaticEntry(ds.id));

                // Narrative Actions
                ActionHandler.register('view-chat-image', (ds) => UIManager.viewChatImage(ds.src));
                ActionHandler.register('create-static-from-message', (ds) => WorldController.createStaticFromMessage(parseInt(ds.index)));
                ActionHandler.register('confirm-delete-message', (ds) => NarrativeController.confirmDeleteMessage(parseInt(ds.index)));

                // Scroll to Bottom
                ActionHandler.register('scroll-to-bottom', () => {
                    const chatWindow = document.getElementById('chat-window');
                    if (chatWindow) {
                        chatWindow.scrollTo({
                            top: chatWindow.scrollHeight,
                            behavior: 'smooth'
                        });
                    }
                });

                // Background Music Controls
                ActionHandler.register('toggle-music', () => {
                    if (typeof MusicService !== 'undefined') MusicService.togglePlayback();
                });
                ActionHandler.register('cycle-music-volume', () => {
                    if (typeof MusicService !== 'undefined') MusicService.cycleVolume();
                });

                // Direct Character Context Menu
                ActionHandler.register('direct-character', (ds, val) => {
                    if (typeof NarrativeController !== 'undefined') {
                        const contextMenu = document.getElementById('generate-context-menu');
                        const isRegen = contextMenu && contextMenu.dataset.source === 'regen';
                        NarrativeController.handleDirectCharacter(val, isRegen);
                    }
                });
            }
        };
