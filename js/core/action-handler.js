        /**
         * =================================================================================================
         * [SEC:JS:MOD:AH]
         * ActionHandler Module
         * Centralized Event Delegation
         * =================================================================================================
         */
        const ActionHandler = {
            actions: {},

            // Register an action name to a function
            /**
             * Registers an action handler.
             * @param {string} name - The action name (data-action value).
             * @param {Function} fn - The callback function.
             */
            register(name, fn) {
                this.actions[name] = fn;
            },

            /**
             * Manually triggers a registered action.
             * @param {string} actionName - The name of the action.
             * @param {Object} [dataset={}] - Mock dataset.
             * @param {*} [val=null] - Mock value.
             * @param {Event} [event=null] - Mock event.
             */
            handle(actionName, dataset = {}, val = null, event = null) {
                const handler = this.actions[actionName];
                if (handler) {
                    handler(dataset, val, event);
                } else {
                    console.warn(`ActionHandler: No handler for "${actionName}"`);
                }
            },

            // Initialize the global listener
            /**
             * Initializes the global click and change listeners.
             */
            init() {
                // We attach one listener to the body to catch ALL bubbled clicks
                document.body.addEventListener('click', (e) => {
                    // 1. Find the closest element with a data-action attribute
                    const target = e.target.closest('[data-action]');
                    if (!target) return;

                    const actionName = target.dataset.action;
                    const val = target.dataset.actionVal; // Capture value
                    const handler = this.actions[actionName];

                    if (handler) {
                        // 2. Prevent default browser behavior for links/buttons if handled
                        if (target.tagName === 'A' || target.tagName === 'BUTTON') {
                            e.preventDefault();
                        }

                        // 3. Pass the element's dataset, value key, and the event
                        // Signature Match: (dataset, value, event)
                        handler(target.dataset, val, e);
                    } else {
                        console.warn(`No handler registered for action: ${actionName}`);
                    }
                });

                // Handle 'change' events for inputs using data-action-change
                document.body.addEventListener('change', (e) => {
                    // Try data-action first (Unified)
                    let target = e.target.closest('[data-action]');
                    let actionName, handler;

                    if (target) {
                        actionName = target.dataset.action;
                        handler = this.actions[actionName];
                        if (handler) {
                            const val = target.dataset.actionVal || target.value;
                            handler(target.dataset, val, e);
                            return;
                        }
                    }

                    // Fallback to data-action-change (Legacy)
                    target = e.target.closest('[data-action-change]');
                    if (!target) return;

                    actionName = target.dataset.actionChange;
                    handler = this.actions[actionName];
                    if (handler) handler(target.dataset, target.value, e);
                });

                // --- DIRECT CHARACTER CONTEXT MENU LOGIC ---
                document.body.addEventListener('contextmenu', (e) => {
                    const primaryBtn = e.target.closest('#primary-action-btn');
                    const regenBtn = e.target.closest('#regen-btn');
                    const btn = primaryBtn || regenBtn;

                    // Directives drive the main narrative, so the menu has no meaning in a thread.
                    if (btn && typeof TextModeController !== 'undefined' && TextModeController.isActive()) {
                        e.preventDefault();
                        return;
                    }

                    if (btn) {
                        e.preventDefault();
                        const contextMenu = document.getElementById('generate-context-menu');
                        if (contextMenu) {
                            const isRegen = !!regenBtn;
                            contextMenu.dataset.source = isRegen ? 'regen' : 'primary';

                            contextMenu.querySelectorAll('.direct-new-btn').forEach(b => b.classList.toggle('hidden', isRegen));
                            contextMenu.querySelectorAll('.direct-regen-btn').forEach(b => b.classList.toggle('hidden', !isRegen));

                            let leftPos = e.clientX - 100;
                            let topPos = e.clientY - 90;
                            if (leftPos < 10) leftPos = 10;
                            if (topPos < 10) topPos = 10;

                            contextMenu.style.left = `${leftPos}px`;
                            contextMenu.style.top = `${topPos}px`;
                            contextMenu.classList.remove('hidden');
                        }
                    }
                });

                // --- IMAGE BUTTON MENU: LONG PRESS / RIGHT CLICK ---
                // The Visual Lore shelf attaches to the turn being written, so its trigger
                // belongs in the composer - but it does not earn a button of its own beside
                // Send. It shares the image button, which opens a small menu the way the
                // generate button does: upload a picture, or attach from the shelf. Both
                // are "put something visual in this turn", so one button covers them.

                let imgPressTimer = null;
                let imgPressStart = null;
                // The button opens the file dialog from an inline onclick. The synthetic
                // click a long press raises when the finger lifts would open that dialog
                // behind the menu, so it gets consumed.
                let imgSwallowClick = false;
                const cancelImgPress = () => {
                    if (imgPressTimer) clearTimeout(imgPressTimer);
                    imgPressTimer = null;
                    imgPressStart = null;
                };

                // Desktop right-click. Android Chrome raises this too, after the timer
                // below has already opened the menu; opening it twice only repositions it.
                document.body.addEventListener('contextmenu', (e) => {
                    if (!e.target.closest('#upload-image-btn')) return;
                    e.preventDefault();
                    UIManager.openImageMenu(e.clientX, e.clientY);
                });

                // iOS Safari never raises contextmenu, so long-press needs its own timer.
                // 300ms + haptic matches the message menu and the story card drag.
                document.body.addEventListener('touchstart', (e) => {
                    const btn = e.target.closest('#upload-image-btn');
                    if (!btn || !e.touches || !e.touches[0]) return;
                    const t = e.touches[0];
                    imgPressStart = { x: t.clientX, y: t.clientY };
                    imgPressTimer = setTimeout(() => {
                        if (navigator.vibrate) navigator.vibrate(50);
                        UIManager.openImageMenu(imgPressStart.x, imgPressStart.y);
                        imgSwallowClick = true;
                        cancelImgPress();
                    }, 300);
                }, { passive: true });

                // Sliding off the button cancels, so a mis-aimed press still uploads.
                document.body.addEventListener('touchmove', (e) => {
                    if (!imgPressStart || !e.touches || !e.touches[0]) return;
                    const t = e.touches[0];
                    if (Math.abs(t.clientX - imgPressStart.x) > 10 || Math.abs(t.clientY - imgPressStart.y) > 10) {
                        cancelImgPress();
                    }
                }, { passive: true });
                document.body.addEventListener('touchend', cancelImgPress);
                document.body.addEventListener('touchcancel', cancelImgPress);

                // Capture phase: the file dialog is opened by an inline onclick on the
                // button itself, so the document is the only place a click can be caught
                // ahead of it. Two get consumed here - the synthetic one the long press
                // raises, and a tap on the button while the menu is open, which should put
                // the menu away rather than also opening the dialog behind it. The flag
                // clears on the first click either way, so a press that never raised one
                // cannot swallow an unrelated tap later.
                document.addEventListener('click', (e) => {
                    const onButton = !!e.target.closest('#upload-image-btn');
                    const menu = document.getElementById('image-context-menu');
                    const menuOpen = !!menu && !menu.classList.contains('hidden');

                    if (imgSwallowClick) {
                        imgSwallowClick = false;
                        if (onButton) {
                            e.stopPropagation();
                            e.preventDefault();
                            return;
                        }
                    }
                    if (onButton && menuOpen) {
                        e.stopPropagation();
                        e.preventDefault();
                        UIManager.closeImageMenu();
                    }
                }, true);

                // Dismissal. Choosing an entry closes it too: ActionHandler's own listener
                // is on document.body, so the action has already run by the time this one
                // sees the click on its way up.
                document.addEventListener('click', (e) => {
                    const menu = document.getElementById('image-context-menu');
                    if (!menu || menu.classList.contains('hidden')) return;
                    if (e.target.closest('#upload-image-btn')) return;
                    UIManager.closeImageMenu();
                });
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') UIManager.closeImageMenu();
                });
                // Capture phase so scrolling any container, not just the window, dismisses.
                window.addEventListener('scroll', () => UIManager.closeImageMenu(), true);

                // Visual Lore picker search.
                const vlPickerSearch = document.getElementById('visual-lore-picker-search');
                if (vlPickerSearch) {
                    vlPickerSearch.addEventListener('input', debounce((e) => {
                        UIManager.VISUAL_LORE.pickerQuery = e.target.value;
                        UIManager.renderVisualLorePicker();
                    }, 150));
                }

                // Visual Lore search. Typed filtering, so it re-renders as you go.
                const vlSearch = document.getElementById('visual-lore-search');
                if (vlSearch) {
                    vlSearch.addEventListener('input', debounce((e) => {
                        UIManager.VISUAL_LORE.query = e.target.value;
                        UIManager.renderVisualLore();
                    }, 150));
                }

                // Hide context menu on outside click
                document.addEventListener('click', (e) => {
                    const contextMenu = document.getElementById('generate-context-menu');
                    if (contextMenu && !contextMenu.classList.contains('hidden')) {
                        if (!e.target.closest('#primary-action-btn') && !e.target.closest('#regen-btn')) {
                            setTimeout(() => contextMenu.classList.add('hidden'), 50);
                        }
                    }
                });

                // --- MESSAGE CONTEXT MENU ---
                // Every trigger below is bound to .bubble-header, never .bubble-body.
                // Long-press on message text is native copy/select on iOS and Android;
                // capturing it there would cost text selection on every message.

                const openMessageMenuFrom = (header, x, y) => {
                    const container = header.closest('[data-message-index]');
                    if (!container) return;
                    const index = parseInt(container.dataset.messageIndex);
                    if (isNaN(index)) return;
                    UIManager.openMessageMenu(index, x, y);
                };

                // Desktop right-click and Android Chrome long-press both raise contextmenu.
                document.body.addEventListener('contextmenu', (e) => {
                    const header = e.target.closest('.bubble-header');
                    if (!header) return;
                    // The character name is its own control and sits inside this strip.
                    // Leave anything carrying its own action alone, so a right-click there
                    // stays available to whatever owns it rather than being claimed here.
                    // Matches the touch path, which already skips these.
                    if (e.target.closest('[data-action]')) return;
                    e.preventDefault();
                    openMessageMenuFrom(header, e.clientX, e.clientY);
                });

                // iOS Safari never raises contextmenu, so long-press needs its own timer.
                // 300ms + haptic matches the drag long-press on story and lore cards.
                let msgPressTimer = null;
                let msgPressStart = null;
                const cancelMsgPress = () => {
                    if (msgPressTimer) clearTimeout(msgPressTimer);
                    msgPressTimer = null;
                    msgPressStart = null;
                };

                document.body.addEventListener('touchstart', (e) => {
                    const header = e.target.closest('.bubble-header');
                    if (!header || !e.touches || !e.touches[0]) return;
                    // The kebab, Edit, Delete and the character name are all tap targets
                    // in this same strip; let their own click handlers own those presses.
                    if (e.target.closest('[data-action]')) return;
                    const t = e.touches[0];
                    msgPressStart = { x: t.clientX, y: t.clientY };
                    msgPressTimer = setTimeout(() => {
                        if (navigator.vibrate) navigator.vibrate(50);
                        openMessageMenuFrom(header, msgPressStart.x, msgPressStart.y);
                        // Lifting the finger raises a synthetic click on this same
                        // header. Mark it so dismissal swallows exactly that one click.
                        // A time window would do here too, but a slow device can exceed
                        // any threshold picked; consuming a flag cannot drift.
                        const openMenu = document.getElementById('message-context-menu');
                        if (openMenu) openMenu.dataset.swallowNextClick = '1';
                        cancelMsgPress();
                    }, 300);
                }, { passive: true });

                // Scrolling away cancels the press instead of firing the menu mid-scroll.
                document.body.addEventListener('touchmove', (e) => {
                    if (!msgPressStart || !e.touches || !e.touches[0]) return;
                    const t = e.touches[0];
                    if (Math.abs(t.clientX - msgPressStart.x) > 10 || Math.abs(t.clientY - msgPressStart.y) > 10) {
                        cancelMsgPress();
                    }
                }, { passive: true });
                document.body.addEventListener('touchend', cancelMsgPress);
                document.body.addEventListener('touchcancel', cancelMsgPress);

                // Dismissal.
                document.addEventListener('click', (e) => {
                    const menu = document.getElementById('message-context-menu');
                    if (!menu || menu.classList.contains('hidden')) return;

                    // Choosing an entry always dismisses, however fast the tap came.
                    if (menu.contains(e.target)) {
                        UIManager.closeMessageMenu();
                        return;
                    }

                    // The kebab toggles it open; let that click through.
                    if (e.target.closest('[data-action="open-message-menu"]')) return;

                    // Swallow the synthetic click raised by the long-press that opened
                    // this menu, so the gesture does not close it again immediately.
                    if (menu.dataset.swallowNextClick) {
                        delete menu.dataset.swallowNextClick;
                        return;
                    }

                    UIManager.closeMessageMenu();
                });
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        UIManager.closeMessageMenu();
                        if (typeof NarrativeController !== 'undefined') NarrativeController.closeAllMessageMenus();
                    }
                });
                // Capture phase so scrolling any container, not just the window, dismisses.
                window.addEventListener('scroll', () => UIManager.closeMessageMenu(), true);

                // --- NARRATIVE LIST: LONG PRESS / RIGHT CLICK TO MULTI-SELECT ---
                // Bulk selection already exists behind the "Select" button above the list.
                // A long press is the quicker way in on a phone: it switches the mode on
                // AND ticks the row that was pressed, so clearing out a few narratives is
                // one gesture and some taps rather than a trip to the header button first.

                // Ticks the pressed row, turning the mode on if it is not already. Setting
                // checked rather than toggling keeps a second long press on the same row
                // from undoing the first, and lets the touch and contextmenu paths both
                // fire on Android without cancelling each other out.
                const armNarrativeSelection = (item) => {
                    if (!item) return;
                    const container = document.getElementById('narratives-list-container');
                    if (container && container.dataset.selectionMode !== 'true') {
                        UIManager.toggleSelectionMode('narrative');
                    }
                    const cb = item.querySelector('.narrative-select-check');
                    if (!cb) return;
                    cb.checked = true;
                    UIManager.updateBulkActionUI();
                };

                let narPressTimer = null;
                let narPressStart = null;
                // The row carries an inline onclick that toggles its own tick, so the
                // synthetic click after a long press has to be consumed rather than
                // allowed to undo the selection the press just made.
                let narSwallowClick = false;
                const cancelNarPress = () => {
                    if (narPressTimer) clearTimeout(narPressTimer);
                    narPressTimer = null;
                    narPressStart = null;
                };

                // Desktop right-click. Android Chrome raises this too, after the timer
                // below has already armed the same row, which is harmless.
                document.body.addEventListener('contextmenu', (e) => {
                    const item = e.target.closest('.narrative-item');
                    if (!item) return;
                    // The checkbox is its own control sitting inside the row.
                    if (e.target.closest('.narrative-checkbox-container')) return;
                    e.preventDefault();
                    armNarrativeSelection(item);
                });

                // iOS Safari never raises contextmenu, so long-press needs its own timer.
                // 300ms + haptic matches the message menu and the story card drag.
                document.body.addEventListener('touchstart', (e) => {
                    const item = e.target.closest('.narrative-item');
                    if (!item || !e.touches || !e.touches[0]) return;
                    if (e.target.closest('.narrative-checkbox-container')) return;
                    const t = e.touches[0];
                    narPressStart = { x: t.clientX, y: t.clientY };
                    narPressTimer = setTimeout(() => {
                        if (navigator.vibrate) navigator.vibrate(50);
                        armNarrativeSelection(item);
                        narSwallowClick = true;
                        cancelNarPress();
                    }, 300);
                }, { passive: true });

                // Scrolling the list away cancels the press instead of selecting mid-scroll.
                document.body.addEventListener('touchmove', (e) => {
                    if (!narPressStart || !e.touches || !e.touches[0]) return;
                    const t = e.touches[0];
                    if (Math.abs(t.clientX - narPressStart.x) > 10 || Math.abs(t.clientY - narPressStart.y) > 10) {
                        cancelNarPress();
                    }
                }, { passive: true });
                document.body.addEventListener('touchend', cancelNarPress);
                document.body.addEventListener('touchcancel', cancelNarPress);

                // Capture phase: the row's handler is an inline onclick on the row itself,
                // so stopping the event at the document is the only place it can be caught
                // before that handler runs. The flag clears on the first click either way,
                // so a press that never raised one cannot swallow an unrelated tap later.
                document.addEventListener('click', (e) => {
                    if (!narSwallowClick) return;
                    narSwallowClick = false;
                    if (e.target.closest('.narrative-item')) {
                        e.stopPropagation();
                        e.preventDefault();
                    }
                }, true);
                // --- TEXT MODE: LONG PRESS / RIGHT CLICK ON A CHARACTER NAME ---
                // Long press (touch) or right click (desktop) a name in the chat to open a
                // private text thread with that character.
                let dmPressTimer = null;
                let dmPressFired = false;

                const hideCharacterMenu = () => {
                    const menu = document.getElementById('character-context-menu');
                    if (menu) menu.classList.add('hidden');
                };

                const showCharacterMenu = (target, clientX, clientY) => {
                    const menu = document.getElementById('character-context-menu');
                    const charId = target.dataset.id;
                    if (!menu || !charId) return;

                    const char = ReactiveStore.getCharacter(charId);
                    const nameEl = document.getElementById('character-context-menu-name');
                    if (nameEl) nameEl.textContent = char ? char.name : '';

                    // Stamp the character onto each entry so the existing handlers receive it.
                    menu.querySelectorAll('.char-ctx-btn').forEach(btn => { btn.dataset.id = charId; });

                    // Texting is only offered for other characters, and only when the mode is on.
                    const state = ReactiveStore.state;
                    const dmBtn = menu.querySelector('[data-action="open-dm-thread"]');
                    if (dmBtn) {
                        const allow = char && !char.is_user && !(state && state.enableTextMode === false);
                        dmBtn.classList.toggle('hidden', !allow);
                    }

                    // Unhide first so the menu can be measured, then keep it inside the viewport.
                    menu.classList.remove('hidden');
                    const rect = menu.getBoundingClientRect();
                    let left = clientX;
                    let top = clientY;
                    if (left + rect.width > window.innerWidth - 10) left = window.innerWidth - rect.width - 10;
                    if (top + rect.height > window.innerHeight - 10) top = clientY - rect.height;
                    menu.style.left = `${Math.max(10, left)}px`;
                    menu.style.top = `${Math.max(10, top)}px`;
                };

                document.body.addEventListener('pointerdown', (e) => {
                    const target = e.target.closest('.dm-longpress-target');
                    if (!target) return;
                    dmPressFired = false;
                    const x = e.clientX, y = e.clientY;
                    dmPressTimer = setTimeout(() => {
                        dmPressFired = true;
                        showCharacterMenu(target, x, y);
                    }, 500);
                });

                const cancelDmPress = () => {
                    if (dmPressTimer) {
                        clearTimeout(dmPressTimer);
                        dmPressTimer = null;
                    }
                };
                document.body.addEventListener('pointerup', cancelDmPress);
                document.body.addEventListener('pointercancel', cancelDmPress);
                document.body.addEventListener('pointermove', cancelDmPress);

                // Swallow the click that follows a completed long press, so the character
                // detail modal does not open on top of the thread.
                document.body.addEventListener('click', (e) => {
                    if (dmPressFired && e.target.closest('.dm-longpress-target')) {
                        dmPressFired = false;
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }, true);

                document.body.addEventListener('contextmenu', (e) => {
                    const target = e.target.closest('.dm-longpress-target');
                    if (!target) return;
                    e.preventDefault();
                    cancelDmPress();
                    showCharacterMenu(target, e.clientX, e.clientY);
                });

                // Dismiss the character menu on any outside interaction.
                document.addEventListener('click', (e) => {
                    const menu = document.getElementById('character-context-menu');
                    if (!menu || menu.classList.contains('hidden')) return;
                    if (!e.target.closest('#character-context-menu')) hideCharacterMenu();
                    else setTimeout(hideCharacterMenu, 50);
                });
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') hideCharacterMenu();
                });
                window.addEventListener('scroll', hideCharacterMenu, true);

                // Dismiss the thread options menu on any outside click.
                document.addEventListener('click', (e) => {
                    const menu = document.getElementById('dm-options-menu');
                    if (!menu || menu.classList.contains('hidden')) return;
                    if (e.target.closest('#dm-options-menu') || e.target.closest('[data-action="toggle-dm-options"]')) return;
                    menu.classList.add('hidden');
                });
            }
        };
