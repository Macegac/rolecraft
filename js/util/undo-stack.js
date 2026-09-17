        /**
         * UndoStack
         * The bookkeeping behind Undo and Redo, with no knowledge of the app. A snapshot is a plain
         * object of JSON strings, one per piece of story state ({chat_history: "[...]", ...}).
         *
         * Only a change to one of the "step" keys (the chat itself) becomes an undo step. Changes to
         * anything else (knowledge a background agent wrote, say) quietly update the current
         * snapshot, so an undo takes them back together with the chat change that caused them and
         * a redo brings the latest version back.
         *
         * Pure: unit tested in test.js.
         */
        const UndoStack = {
            STEP_KEYS: ['chat_history', 'messageCounter'],

            /**
             * @param {{maxSteps?: number, maxChars?: number}} [limits]
             * @returns {Object} a new, empty stack
             */
            create(limits = {}) {
                return {
                    undo: [],
                    redo: [],
                    current: null,
                    maxSteps: limits.maxSteps || 30,
                    maxChars: limits.maxChars || 20000000
                };
            },

            _size(snapshot) {
                return Object.values(snapshot || {}).reduce((sum, s) => sum + (typeof s === 'string' ? s.length : 0), 0);
            },

            // Reuse the reference's strings where the text is identical, so unchanged parts of the
            // story are held in memory once rather than once per step.
            _share(snapshot, reference) {
                if (!reference) return snapshot;
                const out = {};
                for (const key of Object.keys(snapshot)) {
                    out[key] = snapshot[key] === reference[key] ? reference[key] : snapshot[key];
                }
                return out;
            },

            _trim(stack) {
                while (stack.undo.length > stack.maxSteps) stack.undo.shift();
                let total = stack.undo.reduce((sum, s) => sum + this._size(s), 0);
                while (stack.undo.length > 1 && total > stack.maxChars) {
                    total -= this._size(stack.undo.shift());
                }
            },

            /**
             * Records the state as it is now.
             * @param {Object} stack
             * @param {Object} snapshot
             * @returns {boolean} true when this became a new undo step
             */
            record(stack, snapshot) {
                if (!stack.current) {
                    stack.current = snapshot;
                    return false;
                }
                const isStep = this.STEP_KEYS.some(key => snapshot[key] !== stack.current[key]);
                if (!isStep) {
                    stack.current = this._share(snapshot, stack.current);
                    return false;
                }
                stack.undo.push(stack.current);
                stack.current = this._share(snapshot, stack.current);
                stack.redo = [];
                this._trim(stack);
                return true;
            },

            /**
             * @param {Object} stack
             * @returns {Object|null} the snapshot to restore, or null when there is nothing to undo
             */
            undo(stack) {
                if (!stack.undo.length) return null;
                stack.redo.push(stack.current);
                stack.current = stack.undo.pop();
                return stack.current;
            },

            /**
             * @param {Object} stack
             * @returns {Object|null} the snapshot to restore, or null when there is nothing to redo
             */
            redo(stack) {
                if (!stack.redo.length) return null;
                stack.undo.push(stack.current);
                stack.current = stack.redo.pop();
                return stack.current;
            }
        };
