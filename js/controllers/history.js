        /**
         * HistoryController
         * Undo and Redo for the story. Instead of every feature describing how to reverse itself, the
         * story state is photographed each time the app saves while nothing is being generated, and
         * a change to the chat becomes one step (UndoStack). Undo puts the previous photograph back:
         * the messages, and the knowledge, lore stages, persona changes, map and agent notes that
         * went with them.
         *
         * Steps live in memory for the open story. Closing the app or switching stories clears them.
         */
        const HistoryController = {
            SLICES: [
                'chat_history', 'messageCounter', 'static_entries', 'dynamic_entries',
                'narrative_timeline', 'relationship_matrix', 'journal_entries', 'evolved_characters',
                'livingPersonaCounters', 'gameState', 'worldMap', 'knowledge_revisions', 'agent_notes',
                'character_stats', 'last_stat_deltas'
            ],
            MISSING: '__missing__',

            stack: null,
            narrativeId: null,
            retryTimer: null,

            _state() {
                return (typeof ReactiveStore !== 'undefined' && ReactiveStore.state) || null;
            },

            /**
             * Starts a fresh history for the story that just loaded.
             */
            reset() {
                const state = this._state();
                this.stack = UndoStack.create();
                this.narrativeId = state ? state.narrativeId : null;
                if (state && state.chat_history) UndoStack.record(this.stack, this._capture(state));
                this.refreshButtons();
            },

            _capture(state) {
                const snapshot = {};
                for (const key of this.SLICES) {
                    snapshot[key] = state[key] === undefined ? this.MISSING : JSON.stringify(state[key]);
                }
                // Per-character lore entries advance through their stages as the story goes; only
                // that position is captured, so undo never touches edits made to a character.
                const lorePositions = {};
                (state.characters || []).forEach(c => {
                    if (Array.isArray(c.dynamic_knowledge)) {
                        lorePositions[c.id] = c.dynamic_knowledge.map(e => [e.id, e.current_index ?? null]);
                    }
                });
                snapshot.character_lore_positions = JSON.stringify(lorePositions);
                return snapshot;
            },

            /**
             * Whether a reply, combine or image is still in progress. Photographs taken mid-way would
             * hold placeholders like "is thinking...", so nothing is recorded until it finishes.
             * @returns {boolean}
             */
            isBusy() {
                const narrative = (typeof NarrativeController !== 'undefined') ? NarrativeController.RUNTIME : {};
                if (narrative.activeRequestAbortController || narrative.combineInFlight) return true;
                if (typeof UIManager !== 'undefined' && UIManager.RUNTIME && UIManager.RUNTIME.streamingInterval) return true;
                if (typeof TextModeController !== 'undefined' && TextModeController.RUNTIME.isGenerating) return true;
                const state = this._state();
                return !!(state && (state.chat_history || []).some(m => m && (m.isLoading || /is thinking\.\.\.$/.test(m.content || ''))));
            },

            /**
             * Called whenever the app saves the story. Records a step if the chat changed.
             */
            observe() {
                const state = this._state();
                if (!state || !state.chat_history) return;
                if (!this.stack || state.narrativeId !== this.narrativeId) {
                    this.reset();
                    return;
                }
                if (this.isBusy()) {
                    // Look again once the reply lands, so the finished reply is its own step even if
                    // nothing else triggers a save before the next change.
                    if (!this.retryTimer) {
                        this.retryTimer = setTimeout(() => { this.retryTimer = null; this.observe(); }, 700);
                    }
                    return;
                }
                if (UndoStack.record(this.stack, this._capture(state))) this.refreshButtons();
            },

            canUndo() {
                return !!(this.stack && this.stack.undo.length);
            },

            canRedo() {
                return !!(this.stack && this.stack.redo.length);
            },

            undo() {
                this._move('undo');
            },

            redo() {
                this._move('redo');
            },

            _move(direction) {
                if (this.isBusy()) {
                    UIManager.showNotification('Wait for the reply to finish first.', 'info');
                    return;
                }
                // A change made in the last moment may not have been saved (and so recorded) yet.
                this.observe();
                const snapshot = direction === 'undo' ? UndoStack.undo(this.stack) : UndoStack.redo(this.stack);
                if (!snapshot) return;
                this._apply(snapshot);
                UIManager.showNotification(direction === 'undo' ? 'Undone.' : 'Redone.', 'success');
            },

            _apply(snapshot) {
                const state = this._state();
                if (!state) return;
                for (const key of this.SLICES) {
                    if (snapshot[key] === this.MISSING) {
                        if (key in state) delete state[key];
                    } else {
                        state[key] = JSON.parse(snapshot[key]);
                    }
                }
                const positions = JSON.parse(snapshot.character_lore_positions || '{}');
                (state.characters || []).forEach(c => {
                    const saved = positions[c.id];
                    if (!saved || !Array.isArray(c.dynamic_knowledge)) return;
                    const byId = new Map(saved);
                    c.dynamic_knowledge.forEach(entry => {
                        if (byId.has(entry.id)) entry.current_index = byId.get(entry.id);
                    });
                });

                ReactiveStore.forceSave();
                UIManager.renderAll();
                if (typeof UIManager.renderInventoryPanel === 'function') UIManager.renderInventoryPanel();
                if (typeof NarrativeController !== 'undefined' && typeof NarrativeController.renderStatsPanel === 'function') {
                    NarrativeController.renderStatsPanel();
                }
                this.refreshButtons();
            },

            refreshButtons() {
                const undoBtn = document.getElementById('history-undo-btn');
                const redoBtn = document.getElementById('history-redo-btn');
                if (undoBtn) undoBtn.disabled = !this.canUndo();
                if (redoBtn) redoBtn.disabled = !this.canRedo();
            },

            init() {
                ActionHandler.register('history-undo', () => this.undo());
                ActionHandler.register('history-redo', () => this.redo());

                // Ctrl+Z / Ctrl+Y (Cmd on Mac) when not typing in a text box.
                document.addEventListener('keydown', (e) => {
                    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
                    const target = e.target;
                    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
                    const key = e.key.toLowerCase();
                    if (key === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
                    else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); this.redo(); }
                });
            }
        };
