        /**
         * =================================================================================================
         * [SEC:JS:CORE:BOOT]
         * app Module
         * The Application Initializer.
         * =================================================================================================
         */
        const app = {
            /**
             * Initializes the application.
             * Sets up core services, loads library, hydrates images, and initializes the UI.
             */
            async init() {
                Diagnostics.install();
                if ('scrollRestoration' in history) {
                    history.scrollRestoration = 'manual';
                }

                // 1. Initialize Core Services
                try { await DBService.init(); } catch (e) { console.warn("DB init failed", e); }
                await AgentStore.init();

                // 2. Load Library
                await StateManager.loadLibrary();
                await AgentController.ensureBuiltins();
                const library = StateManager.getLibrary();

                // If the library is empty, seed the demo story and flag for onboarding.
                // We no longer reload — the app continues to init normally with the demo loaded.
                let isFirstLaunch = false;
                if (library.stories.length === 0) {
                    const { newStory, newNarrative } = await StoryService.createDefaultStoryAndNarrative();
                    library.stories.push(newStory);
                    library.active_story_id = newStory.id;
                    library.active_narrative_id = newNarrative.id;
                    localStorage.setItem('active_story_id', newStory.id);
                    localStorage.setItem('active_narrative_id', newNarrative.id);
                    StateManager.saveLibrary();
                    isFirstLaunch = true;
                }

                // 3. Hydrate Images (Optimized for performance)
                if (library.stories.length > 0) {
                    UIManager.RUNTIME.characterImageCache = UIManager.RUNTIME.characterImageCache || {};

                    // Loop over ALL stories in the library
                    for (const story of library.stories) {
                        if (!story.characters) continue;

                        // Hydrate Character Images
                        for (const char of story.characters) {
                            try {
                                // 1. Base Portrait
                                if (!UIManager.RUNTIME.characterImageCache[char.id]) {
                                    const blob = await DBService.getImage(char.id);
                                    if (blob) {
                                        UIManager.RUNTIME.characterImageCache[char.id] = URL.createObjectURL(blob);
                                    }
                                }

                                // Hydrate Base Alpha Masked
                                const baseMaskKey = `${char.id}::alpha_masked`;
                                if (!UIManager.RUNTIME.characterImageCache[baseMaskKey]) {
                                    const blob = await DBService.getImage(baseMaskKey);
                                    if (blob) {
                                        UIManager.RUNTIME.characterImageCache[baseMaskKey] = URL.createObjectURL(blob);
                                    }
                                }

                                // 2. Emotion Portraits
                                if (Array.isArray(char.extra_portraits)) {
                                    for (const p of char.extra_portraits) {
                                        const emotion = (p.emotion || 'neutral').toLowerCase();
                                        const emoKey = `${char.id}::emotion::${emotion}`;
                                        if (!UIManager.RUNTIME.characterImageCache[emoKey]) {
                                            const blob = await DBService.getImage(emoKey);
                                            if (blob) {
                                                UIManager.RUNTIME.characterImageCache[emoKey] = URL.createObjectURL(blob);
                                            }
                                        }

                                        // Hydrate Emotion Alpha Masked
                                        const emoMaskKey = `${emoKey}::alpha_masked`;
                                        if (!UIManager.RUNTIME.characterImageCache[emoMaskKey]) {
                                            const blob = await DBService.getImage(emoMaskKey);
                                            if (blob) {
                                                UIManager.RUNTIME.characterImageCache[emoMaskKey] = URL.createObjectURL(blob);
                                            }
                                        }
                                    }
                                }
                            } catch (e) {
                                console.warn("Image hydration failed for char", char.id, e);
                            }
                        }
                    }
                    console.log("Image hydration complete.");
                }

                // Hydrate Scoped Background Image
                const activeStoryId = localStorage.getItem('active_story_id');
                if (activeStoryId) {
                    try {
                        // Try fetching story-specific background
                        const bgBlob = await DBService.getImage(`bg_${activeStoryId}`);
                        if (bgBlob) {
                            UIManager.RUNTIME.globalBackgroundImageCache = URL.createObjectURL(bgBlob);
                            console.log("Scoped background hydrated.");
                        } else {
                            // Fallback: Check for legacy global image (migration path)
                            const globalBlob = await DBService.getImage('global_background_image');
                            if (globalBlob) {
                                // We don't auto-migrate here to avoid side effects, but we respect it if it exists
                                // and the story claims to use it.
                                UIManager.RUNTIME.globalBackgroundImageCache = URL.createObjectURL(globalBlob);
                            }
                        }
                    } catch (e) {
                        console.warn("Background hydration failed:", e);
                    }
                }

                // 4. Load Active Narrative
                await StateManager.loadActiveNarrative();
                const state = StateManager.getState();

                // Populate OpenRouter/NanoGPT cache early if active provider to ensure vision detection works
                if (state && state.apiProvider === 'openrouter') {
                    APIService.fetchOpenRouterModels().catch(() => { });
                } else if (state && state.apiProvider === 'nanogpt') {
                    APIService.fetchNanoGPTModels().catch(() => { });
                }

                // 5. Initialize Event System (THE NEW LOGIC)
                this.setupEventListeners();      // Updates layout
                UIManager.setButtonToSendMode(); // Sets initial button state
                ActionHandler.init();            // Starts listening for clicks
                ActionDispatcher.init();         // Wires clicks to Controllers
                AgentController.registerActions();
                HistoryController.init();
                Diagnostics.registerActions();
                UIManager.initChatScrollListener(); // Manages the scroll-to-bottom button visibility
                if (typeof CropController !== 'undefined') CropController.init();

                // 6. Initialize Reactive State
                if (!state || Object.keys(state).length === 0) {
                    // Empty state fallback
                    const activeStory = library.stories.find(s => s.id === library.active_story_id);
                    const title = activeStory ? activeStory.name : "No Story Loaded";
                    if (document.getElementById('story-title-input')) document.getElementById('story-title-input').value = title;
                    if (document.getElementById('mobile-story-title-overlay')) document.getElementById('mobile-story-title-overlay').value = title;

                    ReactiveStore.init({});
                    UIManager.renderChat();
                } else {
                    // Initialize Store
                    ReactiveStore.init(state);
                    await AgentController.migrateStory();
                    HistoryController.reset();

                    // Initialize Runtime Variables
                    if (typeof WorldController !== 'undefined') {
                        WorldController.RUNTIME.turnOfArrival = state.messageCounter;
                    }

                    // Ensure Colors
                    // Ensure Colors for ALL characters, including User
                    let aiCharCount = 0;
                    (state.characters || []).forEach(char => {
                        if (!char.color) {
                            if (char.is_user) {
                                // Default User Gray
                                char.color = { base: '#4b5563', bold: '#e5e7eb' };
                            } else {
                                // Cycle through AI colors
                                char.color = NarrativeController.CONSTANTS.CHARACTER_COLORS[aiCharCount % 8];
                                aiCharCount++;
                            }
                        } else if (!char.is_user) {
                            // Just increment counter if AI already has color, to keep variety for next new char
                            aiCharCount++;
                        }
                    });

                    // Setup Subscriptions (Mapped to UIManager)
                    [
                        'font', 'chatTextColor', 'textSize', 'bubbleOpacity', 'backgroundBlur',
                        'bubbleImageSize', 'backgroundImageURL', 'characterImageMode',
                        // Colors
                        'md_h1_color', 'md_h2_color', 'md_h3_color', 'md_bold_color',
                        'md_italic_color', 'md_quote_color',
                        // Fonts (The missing keys causing the update issue)
                        'md_h1_font', 'md_h2_font', 'md_h3_font', 'md_bold_font',
                        'md_italic_font', 'md_quote_font'
                    ]
                        .forEach(key => {
                            ReactiveStore.subscribe(key, () => UIManager.applyStyling());
                        });

                    // Update Art Style Dropdown on Load/Change
                    ReactiveStore.subscribe('imageGenArtStyle', () => {
                        const el = document.getElementById('image-gen-art-style');
                        if (el && ReactiveStore.state.imageGenArtStyle) {
                            el.value = ReactiveStore.state.imageGenArtStyle;
                        } else if (el) {
                            el.value = 'none';
                        }
                    });

                    // Smart Subscriptions (prevent focus loss)
                    ReactiveStore.subscribe('characters', () => {
                        const active = document.activeElement;
                        const isTypingInRoster = active && active.tagName === 'INPUT' && active.closest('#character-detail-modal-content');
                        if (!isTypingInRoster) {
                            UIManager.renderCharacters();
                            UIManager.updateAICharacterSelector();
                        }
                    });

                    // Don't re-render if we are manually handling the DOM (e.g., finishing a stream)
                    ReactiveStore.subscribe('chat_history', () => {
                        if (!UIManager.RUNTIME.suppressChatRender) UIManager.renderChat();
                    });

                    ReactiveStore.subscribe('static_entries', () => {
                        if (!document.activeElement?.closest('#static-entry-details')) UIManager.renderStaticEntries();
                    });
                    ReactiveStore.subscribe('dynamic_entries', () => {
                        if (!document.activeElement?.closest('#dynamic-entry-details')) UIManager.renderDynamicEntries();
                    });

                    ReactiveStore.subscribe('worldMap', () => {
                        UIManager.applyStyling();
                        if (!document.activeElement?.closest('#world-map-modal-content') && document.getElementById('world-map-modal').style.display !== 'none') {
                            UIManager.renderWorldMapModal();
                        }
                    });

                    ReactiveStore.subscribe('gameState', () => {
                        UIManager.renderInventoryPanel();
                    });

                    ReactiveStore.subscribe('selectedStaticEntryId', () => { UIManager.renderStaticEntries(); UIManager.renderStaticEntryDetails(); });
                    ReactiveStore.subscribe('selectedDynamicEntryId', () => { UIManager.renderDynamicEntries(); UIManager.renderDynamicEntryDetails(); });
                    ReactiveStore.subscribe('selectedGMRuleId', () => { UIManager.renderGMRules(); UIManager.renderGMRuleDetails(); });

                    // Vision Warning Sync
                    const visionSync = () => UIManager.updateVisionWarning();
                    ReactiveStore.subscribe('apiProvider', visionSync);
                    ReactiveStore.subscribe('geminiModel', visionSync);
                    ReactiveStore.subscribe('openRouterModel', visionSync);
                    ReactiveStore.subscribe('webllmModel', visionSync);

                    // Context Visualizer Subscriptions
                    ['chat_history', 'characters', 'static_entries', 'worldMap', 'apiProvider', 'system_prompt', 'event_master_prompt', 'responseLength', 'geminiModel', 'openRouterModel', 'webllmModel'].forEach(key => {
                        ReactiveStore.subscribe(key, () => {
                            if (document.getElementById('context-visualizer-container') && typeof AppController.renderTokenVisualizer === 'function') {
                                AppController.renderTokenVisualizer();
                            }
                        });
                    });

                    // Initial Render
                    // Hydrate Global Settings UI
                    const globalSettings = StateManager.data.globalSettings;
                    document.querySelectorAll('[data-setting-key]').forEach(el => {
                        const key = el.getAttribute('data-setting-key');
                        if (globalSettings[key] !== undefined) {
                            if (el.type === 'checkbox') el.checked = globalSettings[key];
                            else el.value = globalSettings[key];
                        }
                    });

                    AppController.updateImageGenSettingsVisibility();
                    UIManager.applyStyling();
                    UIManager.renderAll();

                    // Render stats panel if stats already exist
                    NarrativeController.renderStatsPanel();

                    // Initialize stats if new narrative (deferred, non-blocking)
                    if (!state.character_stats || Object.keys(state.character_stats).length === 0) {
                        setTimeout(() => NarrativeController.initializeStats(), 500);
                    }

                    // Generate CYOA options on load if enabled and last message is from AI
                    if (state.enableResponseOptions && state.chat_history && state.chat_history.length > 0) {
                        const lastMsg = state.chat_history[state.chat_history.length - 1];
                        const userChar = (state.characters || []).find(c => c.is_user);
                        if (lastMsg && lastMsg.type === 'chat' && lastMsg.character_id !== userChar?.id) {
                            setTimeout(() => NarrativeController.generateResponseOptions(), 1000); // 1s delay to let UI settle
                        }
                    }
                }

                // Enable line breaks for single newlines (Chat Style Markdown)
                if (typeof marked !== 'undefined') {
                    marked.use({ breaks: true, gfm: true });
                }

                if ('scrollRestoration' in history) {
                    history.scrollRestoration = 'manual';
                }

                // Force scroll to bottom on initial load
                setTimeout(() => {
                    const chatWindow = document.getElementById('chat-window');
                    if (chatWindow) chatWindow.scrollTop = chatWindow.scrollHeight;
                    window.scrollTo(0, document.body.scrollHeight);
                }, 100);

                // --- Onboarding: Show welcome modal on first-ever launch ---
                if (isFirstLaunch && !localStorage.getItem('onboarding_dismissed')) {
                    setTimeout(() => {
                        const modal = document.getElementById('onboarding-modal');
                        if (modal) {
                            modal.classList.remove('hidden');
                        }
                    }, 300);
                }
            },

            /**
             * Sets up global event listeners for the application.
             * Handles resizing, input events, and mobile menu interactions.
             */
            setupEventListeners() {
                this.updateLayout();
                window.addEventListener('resize', debounce(() => this.updateLayout(), 100));

                // ====================================================================
                // iOS Keyboard Dismiss Fix
                //
                // iOS 26+ shifts the webview up when the keyboard opens. On
                // dismiss, it often fails to scroll the webview back down,
                // leaving a ~24px blank gap at the bottom.
                //
                // Root cause: with overflow:hidden on html/body, scrollTo(0,0)
                // is a no-op — the browser thinks there's nothing to scroll,
                // even though the native webview IS scrolled. The fix is to
                // temporarily REMOVE overflow:hidden so scrollTo can actually
                // reach the webview-level scroll position, then re-lock it.
                //
                // Additionally, we dispatch a synthetic resize event to trigger
                // Safari's internal viewport recalculation and toggle the
                // viewport meta tag to force WebKit to re-evaluate safe areas.
                // ====================================================================
                const resetIOSViewport = () => {
                    const active = document.activeElement;
                    const isInputFocused = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
                    if (isInputFocused) return;

                    const html = document.documentElement;
                    const body = document.body;

                    // Step 1: Temporarily unlock overflow so scrollTo is not a no-op
                    html.style.overflow = 'auto';
                    body.style.overflow = 'auto';

                    // Step 2: Reset all scroll positions while overflow is unlocked
                    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
                    html.scrollTop = 0;
                    body.scrollTop = 0;

                    // Step 3: Force synchronous layout recalculation
                    void body.offsetHeight;

                    // Step 4: Re-lock overflow to prevent future scrolling
                    html.style.overflow = 'hidden';
                    body.style.overflow = 'hidden';

                    // Step 5: Dispatch synthetic resize to trigger Safari's
                    // internal viewport recalculation
                    window.dispatchEvent(new Event('resize'));
                };

                document.addEventListener('focusout', (e) => {
                    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) {
                        // Immediate attempt
                        setTimeout(resetIOSViewport, 50);
                        // Post keyboard-animation (~300ms slide-down)
                        setTimeout(resetIOSViewport, 350);
                        // Late catch for accessory bar removal
                        setTimeout(resetIOSViewport, 700);
                    }
                });

                // Also catch viewport resize events (orientation change, keyboard)
                if (window.visualViewport) {
                    let vvTimer = null;
                    window.visualViewport.addEventListener('resize', () => {
                        clearTimeout(vvTimer);
                        vvTimer = setTimeout(resetIOSViewport, 100);
                    });
                }

                // Update: Use LibraryController for title renaming
                const titleInputHandler = (e) => {
                    if (typeof NarrativeController !== 'undefined') {
                        NarrativeController.renameActiveNarrative(e.target.value);
                    }
                };

                const titleInput = document.getElementById('story-title-input');
                const mobileTitle = document.getElementById('mobile-story-title-overlay');
                if (titleInput) titleInput.addEventListener('input', titleInputHandler);
                if (mobileTitle) mobileTitle.addEventListener('input', titleInputHandler);

                // FIX: Blur title input on Enter
                const titleKeydownHandler = (e) => {
                    if (e.key === 'Enter') e.target.blur();
                };
                if (titleInput) titleInput.addEventListener('keydown', titleKeydownHandler);
                if (mobileTitle) mobileTitle.addEventListener('keydown', titleKeydownHandler);

                // Enter-to-Send Logic
                const chatInput = document.getElementById('chat-input');
                if (chatInput) {
                    let lastInputHandled = false;

                    // CYOA collapsible states listeners
                    chatInput.addEventListener('focus', () => {
                        if (typeof NarrativeController !== 'undefined' && NarrativeController.updateChatInputShrinkState) {
                            NarrativeController.updateChatInputShrinkState();
                        }
                    });
                    chatInput.addEventListener('blur', () => {
                        if (typeof NarrativeController !== 'undefined' && NarrativeController.updateChatInputShrinkState) {
                            NarrativeController.updateChatInputShrinkState();
                        }
                    });
                    chatInput.addEventListener('input', () => {
                        if (typeof NarrativeController !== 'undefined' && NarrativeController.updateChatInputShrinkState) {
                            NarrativeController.updateChatInputShrinkState();
                        }
                    });

                    const handleAutoClose = (char, event) => {
                        const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', '*': '*' };
                        if (pairs[char]) {
                            event.preventDefault();
                            const start = chatInput.selectionStart;
                            const end = chatInput.selectionEnd;
                            const text = chatInput.value;
                            const close = pairs[char];

                            chatInput.value = text.substring(0, start) + char + close + text.substring(end);
                            chatInput.selectionStart = chatInput.selectionEnd = start + 1;
                            lastInputHandled = true;
                            // Reset flag shortly after to allow new inputs
                            setTimeout(() => { lastInputHandled = false; }, 20);
                        }
                    };

                    // Mobile-Compatible Auto-Close (beforeinput handles visual characters reliably on mobile)
                    chatInput.addEventListener('beforeinput', (e) => {
                        if (!StateManager.data.globalSettings.autoCloseBrackets) return;
                        if (lastInputHandled) { return; } // Handled by keydown

                        if (e.inputType !== 'insertText' || !e.data) return;
                        handleAutoClose(e.data, e);
                    });

                    // Enter-to-Send & Desktop Auto-Close
                    chatInput.addEventListener('keydown', (e) => {
                        // History Navigation Logic
                        if (e.key === 'ArrowUp') {
                            const isAtTop = chatInput.value.substring(0, chatInput.selectionStart).indexOf('\n') === -1;
                            if (isAtTop) {
                                const history = UIManager.RUNTIME.inputHistory;
                                if (history && history.length > 0) {
                                    const index = UIManager.RUNTIME.inputHistoryIndex;
                                    const currentHistoryVal = (index >= 0 && index < history.length) ? history[index] : null;
                                    const hasUnsavedContent = chatInput.value.trim() !== '' && chatInput.value !== currentHistoryVal;
                                    if (hasUnsavedContent) {
                                        return;
                                    }

                                    e.preventDefault();
                                    if (UIManager.RUNTIME.inputHistoryIndex > 0) {
                                        UIManager.RUNTIME.inputHistoryIndex--;
                                        chatInput.value = history[UIManager.RUNTIME.inputHistoryIndex];
                                    }
                                    return;
                                }
                            }
                        } else if (e.key === 'ArrowDown') {
                            const isAtBottom = chatInput.value.substring(chatInput.selectionStart).indexOf('\n') === -1;
                            if (isAtBottom) {
                                const history = UIManager.RUNTIME.inputHistory;
                                if (history && UIManager.RUNTIME.inputHistoryIndex !== undefined && UIManager.RUNTIME.inputHistoryIndex < history.length) {
                                    const index = UIManager.RUNTIME.inputHistoryIndex;
                                    const currentHistoryVal = (index >= 0 && index < history.length) ? history[index] : null;
                                    const hasUnsavedContent = chatInput.value.trim() !== '' && chatInput.value !== currentHistoryVal;
                                    if (hasUnsavedContent) {
                                        return;
                                    }

                                    e.preventDefault();
                                    UIManager.RUNTIME.inputHistoryIndex++;
                                    if (UIManager.RUNTIME.inputHistoryIndex === history.length) {
                                        chatInput.value = '';
                                    } else {
                                        chatInput.value = history[UIManager.RUNTIME.inputHistoryIndex];
                                    }
                                    return;
                                }
                            }
                        }

                        // Desktop Auto-Close (Reliable, triggers before beforeinput, preventing duplicates)
                        if (StateManager.data.globalSettings.autoCloseBrackets) {
                            const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', '*': '*' };
                            if (pairs[e.key]) {
                                handleAutoClose(e.key, e);
                                return;
                            }
                        }

                        // On desktop, Enter sends without Shift. On mobile, Enter adds a newline.
                        const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
                        if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
                            // Prevent the default new line insertion
                            e.preventDefault();
                            // Trigger the send action
                            NarrativeController.handlePrimaryAction();
                        }
                    });
                }

                // Hamburger Menu
                const hamburgerBtn = document.getElementById('hamburger-menu-button');
                if (hamburgerBtn) {
                    hamburgerBtn.addEventListener('click', (e) => { e.stopPropagation(); AppController.toggleMobileMenu(); });
                }

                document.addEventListener('click', (e) => {
                    // Mobile Menu Logic
                    const menu = document.getElementById('mobile-menu');
                    const btn = document.getElementById('hamburger-menu-button');
                    if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
                        AppController.toggleMobileMenu();
                    }

                    // Story Library Dropdown Logic
                    const dropdown = document.getElementById('new-story-dropdown');
                    if (dropdown && !dropdown.classList.contains('hidden')) {
                        // Only close if we clicked OUTSIDE the dropdown
                        // (Clicks inside are handled by their own buttons or need to bubble for data-action)
                        if (!dropdown.contains(e.target)) {
                            dropdown.classList.add('hidden');
                        }
                    }

                    // Character Roster New Menu Logic
                    const rosterMenu = document.getElementById('roster-new-menu');
                    const rosterMenuBtn = document.getElementById('roster-new-btn');
                    if (rosterMenu && !rosterMenu.classList.contains('hidden')) {
                        if (!rosterMenu.contains(e.target) && (!rosterMenuBtn || !rosterMenuBtn.contains(e.target))) {
                            rosterMenu.classList.add('hidden');
                        }
                    }
                    // AI Character Dropdown Logic
                    const aiDropdown = document.getElementById('ai-character-dropdown');
                    if (aiDropdown && !aiDropdown.classList.contains('hidden')) {
                        if (!aiDropdown.contains(e.target)) {
                            aiDropdown.classList.add('hidden');
                        }
                    }

                    // Message Dropdown Menu Logic
                    const openMsgMenus = document.querySelectorAll('.message-dropdown-menu:not(.hidden)');
                    if (openMsgMenus.length > 0) {
                        openMsgMenus.forEach(m => {
                            const anchor = m.closest('.message-menu-anchor');
                            if (!anchor || !anchor.contains(e.target) || m.contains(e.target)) {
                                m.classList.add('hidden');
                            }
                        });
                    }
                });

                // Mobile Title Fade Logic
                const titleTrigger = document.getElementById('title-trigger-area');

                const showTitle = () => {
                    if (document.body.classList.contains('layout-vertical') && mobileTitle) {
                        clearTimeout(UIManager.RUNTIME.titleTimeout);
                        mobileTitle.style.opacity = '1';
                        mobileTitle.style.pointerEvents = 'auto';
                    }
                };

                const hideTitle = (immediate = false) => {
                    if (document.body.classList.contains('layout-vertical') && mobileTitle) {
                        clearTimeout(UIManager.RUNTIME.titleTimeout);
                        if (document.activeElement !== mobileTitle) {
                            const doHide = () => {
                                mobileTitle.style.opacity = '0';
                                mobileTitle.style.pointerEvents = 'none';
                            };
                            if (immediate) { doHide(); } else { UIManager.RUNTIME.titleTimeout = setTimeout(doHide, 2500); }
                        }
                    }
                };

                if (titleTrigger) {
                    titleTrigger.addEventListener('mouseenter', showTitle);
                    titleTrigger.addEventListener('mouseleave', () => hideTitle());
                    titleTrigger.addEventListener('touchstart', (e) => { e.preventDefault(); if (mobileTitle && mobileTitle.style.opacity === '1') { hideTitle(true); } else { showTitle(); hideTitle(); } });
                }

                // FIX: Ensure mobile title hides on blur (after editing)
                if (mobileTitle) {
                    mobileTitle.addEventListener('blur', () => hideTitle(true));
                }

                // Update: Use NarrativeController for Chat Buttons
                const regenBtn = document.getElementById('regen-btn');
                const undoBtn = document.getElementById('undo-btn');
                if (regenBtn) regenBtn.addEventListener('click', () => NarrativeController.handleRegen());
                if (undoBtn) undoBtn.addEventListener('click', () => NarrativeController.undoLastTurn());

                // Auto-Knowledge Toggle Logic
                const autoKnowToggle = document.getElementById('enable-auto-knowledge-toggle');
                if (autoKnowToggle) {
                    autoKnowToggle.addEventListener('change', (e) => {
                        if (typeof ReactiveStore !== 'undefined' && ReactiveStore.state) {
                            ReactiveStore.state.enableAutoStaticKnowledge = e.target.checked;
                        }
                    });
                    // Hydrate (Default to true)
                    // We try to grab value from StateManager since ReactiveStore might not be ready
                    const libState = StateManager.getState();
                    if (libState) {
                        const currentVal = libState.enableAutoStaticKnowledge;
                        autoKnowToggle.checked = (currentVal !== undefined) ? currentVal : true;
                    } else {
                        autoKnowToggle.checked = true;
                    }
                }

                // Auto-Initialize WebLLM if cached
                setTimeout(() => {
                    if (typeof APIService !== 'undefined' && APIService.autoInitializeWebLLM) {
                        APIService.autoInitializeWebLLM().catch(e => console.error("Auto-init WebLLM failed:", e));
                    }
                }, 1000);

                // Auto-Close Brackets Toggle Logic (Delegated for Dynamic Settings)
                document.addEventListener('change', (e) => {
                    if (e.target && e.target.id === 'auto-close-brackets-toggle') {
                        StateManager.data.globalSettings.autoCloseBrackets = e.target.checked;
                        StateManager.saveGlobalSettings();
                    }
                });

                // Chat Resizer Logic
                const resizer = document.getElementById('chat-resizer');
                const chatInputContainer = document.getElementById('chat-input-container');

                if (resizer && chatInputContainer) {
                    let startY, startHeight;

                    const onMouseMove = (e) => {
                        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                        const delta = startY - clientY; // Dragging up increases height
                        const newHeight = startHeight + delta;

                        // Constraints: Min 60px, Max (Window Height - 100px) (Leave space for header)
                        // This allows "as much as I want" significantly more than before.
                        if (newHeight >= 60 && newHeight < (window.innerHeight - 100)) {
                            chatInputContainer.style.height = `${newHeight}px`;
                        }
                    };

                    const onMouseUp = () => {
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                        document.removeEventListener('touchmove', onMouseMove);
                        document.removeEventListener('touchend', onMouseUp);
                        document.body.style.cursor = '';
                        document.body.style.userSelect = '';
                        document.body.style.webkitUserSelect = '';
                    };

                    const onMouseDown = (e) => {
                        startY = e.touches ? e.touches[0].clientY : e.clientY;
                        startHeight = chatInputContainer.getBoundingClientRect().height;

                        document.addEventListener('mousemove', onMouseMove);
                        document.addEventListener('mouseup', onMouseUp);
                        document.addEventListener('touchmove', onMouseMove, { passive: false });
                        document.addEventListener('touchend', onMouseUp);

                        document.body.style.cursor = 'ns-resize';
                        document.body.style.userSelect = 'none';
                        document.body.style.webkitUserSelect = 'none'; // Mobile Safari
                        if (e.cancelable) e.preventDefault(); // Prevent text selection/scrolling start
                    };

                    const onDoubleClick = () => {
                        chatInputContainer.style.height = ''; // Reset to auto
                    };

                    resizer.addEventListener('mousedown', onMouseDown);
                    resizer.addEventListener('touchstart', onMouseDown, { passive: false });
                    resizer.addEventListener('dblclick', onDoubleClick);
                }
            },




            /**
             * Updates the layout based on window dimensions.
             * Toggles between vertical and horizontal layouts.
             */
            updateLayout() {
                const isVertical = window.innerHeight > window.innerWidth;
                const activeState = (typeof ReactiveStore !== 'undefined' && ReactiveStore.state) || StateManager.getState();
                if (isVertical && activeState && activeState.characterImageMode === 'visual_novel') {
                    UIManager.showNotification('Visual Novel mode is designed for landscape layouts. Falling back to Cinematic.', 'warning');
                    if (typeof ReactiveStore !== 'undefined' && ReactiveStore.state) {
                        ReactiveStore.state.characterImageMode = 'cinematic_overlay';
                    } else if (activeState) {
                        activeState.characterImageMode = 'cinematic_overlay';
                    }
                }
                const wasVertical = document.body.classList.contains('layout-vertical');
                const layoutChanged = isVertical !== wasVertical;

                if (isVertical) {
                    document.body.classList.add('layout-vertical');
                    document.body.classList.remove('layout-horizontal');
                } else {
                    document.body.classList.add('layout-horizontal');
                    document.body.classList.remove('layout-vertical');
                }
                UIManager.updateSidePortrait();

                // Force a chat render on layout changes (essential for orientation shifts between Portrait and Visual Novel Landscape)
                if (layoutChanged) {
                    UIManager.renderChat();
                }

                // FIX: Force library re-render if layout changed (Mobile <-> Desktop)
                if (layoutChanged) {
                    const libModal = document.getElementById('story-library-modal');
                    if (libModal && !libModal.classList.contains('hidden')) {
                        // Capture current filter state
                        const search = document.getElementById('lib-search')?.value;
                        const sort = document.getElementById('lib-sort')?.value;
                        const tag = document.getElementById('lib-tag')?.value;

                        // Clear container to bypass 'Early Return' optimization in renderLibraryInterface
                        const container = document.getElementById('library-content-container');
                        if (container) container.innerHTML = '';

                        UIManager.renderLibraryInterface({
                            searchTerm: search,
                            sortBy: sort,
                            filterTag: tag
                        });

                        // Re-open Story Details if one was active
                        if (UIManager.RUNTIME.viewingStoryId) {
                            // If switching to Horizontal (Desktop), ensure the Mobile Overlay is hidden
                            if (!isVertical) {
                                const mobileOverlay = document.getElementById('story-details-modal');
                                if (mobileOverlay) mobileOverlay.classList.add('hidden');
                            }
                            // Re-trigger open to render in the correct new container
                            UIManager.openStoryDetails(UIManager.RUNTIME.viewingStoryId);
                        }
                    }
                }
            },


        };

        // Start the application once the DOM is fully loaded.
        document.addEventListener('DOMContentLoaded', () => app.init());
