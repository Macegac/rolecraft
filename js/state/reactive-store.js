        /**
             * =================================================================================================
             * Reactive State Store
             * Wraps the application state in a Proxy to handle auto-saving and UI updates.
             * =================================================================================================
             */

        /**
         * =================================================================================================
         * [SEC:JS:STATE:RS]
         * ReactiveStore
         * Proxy-based state management that auto-saves to IndexedDB on mutation.
         * =================================================================================================
         */
        const ReactiveStore = {
            state: null,
            _target: null,
            _listeners: new Map(),
            _proxyCache: new WeakMap(),
            _saveTimeout: null,
            _isSaving: false,
            _blockAutoSave: false, // New flag to prevent race conditions on reload

            /**
             * Initializes the reactive store with the given initial state.
             * Sets up auto-save triggers on visibility change and page unload.
             * @param {Object} initialState - The initial state object.
             */
            init(initialState) {
                this._target = initialState;
                this._listeners.clear();
                this._proxyCache = new WeakMap();
                this.state = this._createProxy(initialState);

                const saveNow = () => {
                    // Check if auto-save is blocked (e.g., during critical DB migrations or reloads)
                    if (this._blockAutoSave) return;

                    // If we are closing, trigger an immediate save without debounce
                    this.forceSave();
                };

                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'hidden') saveNow();
                });
                window.addEventListener('pagehide', saveNow);
                window.addEventListener('beforeunload', saveNow);

                // Data Sanitization: Clear literal placeholders from characters
                if (initialState.characters && Array.isArray(initialState.characters)) {
                    initialState.characters.forEach(char => {
                        if (char.image_url && char.image_url.includes('${imgSrc}')) {
                            char.image_url = '';
                        }
                        if (char.extra_portraits && Array.isArray(char.extra_portraits)) {
                            char.extra_portraits.forEach(p => {
                                if (p.url && p.url.includes('${imgSrc}')) p.url = '';
                            });
                        }
                    });
                }

                // Data Sanitization: User Personas
                if (initialState.userPersonas && Array.isArray(initialState.userPersonas)) {
                    initialState.userPersonas.forEach(persona => {
                        if (persona.image_url && persona.image_url.includes('${imgSrc}')) {
                            persona.image_url = '';
                        }
                    });
                }

                console.log("ReactiveStore: Initialized with Safety Nets.");
            },

            /**
             * Helper to find a character by ID, checking both the main roster and the world map.
             * Returns the proxied character object so edits trigger saves.
             * @param {string} id - The character ID.
             * @returns {Object|undefined} The reactive character object.
             */
            getCharacter(id) {
                if (!this.state || !this.state.characters) return undefined;
                if (!id) return undefined;
                if (id === 'user') {
                    const userChar = this.state.characters.find(c => c.is_user);
                    if (userChar) return userChar;
                }
                let char = this.state.characters.find(c => c.id === id);
                if (!char && this.state.worldMap && this.state.worldMap.grid) {
                    for (const loc of this.state.worldMap.grid) {
                        if (loc.characters) {
                            const found = loc.characters.find(c => c.id === id);
                            if (found) return found;
                        }
                    }
                }
                return char;
            },

            /**
             * Helper to retrieve all active location characters at the current coordinates.
             * Returns an array of reactive character objects.
             * @returns {Array} List of active location characters.
             */
            getActiveLocationCharacters() {
                if (!this.state || !this.state.worldMap || !this.state.worldMap.currentLocation || !this.state.worldMap.grid) {
                    return [];
                }
                const currentLoc = this.state.worldMap.grid.find(loc =>
                    loc.coords.x === this.state.worldMap.currentLocation.x &&
                    loc.coords.y === this.state.worldMap.currentLocation.y
                );
                if (currentLoc && currentLoc.characters) {
                    return currentLoc.characters.filter(c => c.is_active);
                }
                return [];
            },

            // New method to explicitly stop the auto-save mechanism
            blockAutoSave() {
                this._blockAutoSave = true;
                if (this._saveTimeout) {
                    clearTimeout(this._saveTimeout);
                    this._saveTimeout = null;
                }
            },

            /**
             * Subscribes a callback to changes in a specific state property.
             * @param {string} key - The state property key to observe.
             * @param {Function} callback - The callback function to execute on change.
             */
            subscribe(key, callback) {
                if (!this._listeners.has(key)) {
                    this._listeners.set(key, new Set());
                }
                this._listeners.get(key).add(callback);
            },

            /**
             * Creates a recursive proxy for the given target object.
             * @param {Object} target - The target object to proxy.
             * @param {string|null} [rootKey=null] - The root key for nested properties.
             * @returns {Proxy} - The reactive proxy.
             * @private
             */
            _createProxy(target, rootKey = null) {
                if (typeof target !== 'object' || target === null || target instanceof Blob || target instanceof File) return target;
                if (this._proxyCache.has(target)) return this._proxyCache.get(target);

                const handler = {
                    get: (obj, prop) => {
                        const value = obj[prop];
                        const nextRootKey = rootKey || (typeof prop === 'string' ? prop : null);
                        if (typeof value === 'object' && value !== null && !(value instanceof Blob) && !(value instanceof File)) {
                            return this._createProxy(value, nextRootKey);
                        }
                        return value;
                    },
                    set: (obj, prop, value) => {
                        if (obj[prop] === value) return true;
                        obj[prop] = value;
                        const notificationKey = rootKey || prop;
                        this._notify(notificationKey);
                        this._scheduleSave();
                        return true;
                    },
                    deleteProperty: (obj, prop) => {
                        delete obj[prop];
                        const notificationKey = rootKey || prop;
                        this._notify(notificationKey);
                        this._scheduleSave();
                        return true;
                    }
                };

                const proxy = new Proxy(target, handler);
                this._proxyCache.set(target, proxy);
                return proxy;
            },

            /**
             * Notifies listeners of a change in a state property.
             * @param {string} key - The key of the changed property.
             * @private
             */
            _notify(key) {
                if (this._listeners.has(key)) {
                    this._listeners.get(key).forEach(cb => cb(this.state[key]));
                }
            },

            /**
             * Pauses the auto-save mechanism (e.g., during streaming).
             */
            pauseSaving() {
                this._isSavingPaused = true;
                if (this._saveTimeout) {
                    clearTimeout(this._saveTimeout);
                    this._saveTimeout = null;
                }
            },

            /**
             * Resumes the auto-save mechanism and triggers an immediate save.
             */
            resumeSaving() {
                this._isSavingPaused = false;
                // Trigger one final save to catch up
                this.forceSave();
            },

            /**
             * Schedules a debounced save operation.
             * @private
             */
            _scheduleSave() {
                // If paused (streaming), DO NOT schedule a DB write
                if (this._isSavingPaused) return;
                if (this._blockAutoSave) return; // Respect block

                if (this._saveTimeout) clearTimeout(this._saveTimeout);
                this._saveTimeout = setTimeout(() => {
                    this.forceSave();
                }, 2000);
            },

            /**
             * Forces an immediate save of the current state to the database.
             * Resets any pending save timers.
             * @returns {Promise<void>}
             */
            async forceSave() {
                if (this._saveTimeout) {
                    clearTimeout(this._saveTimeout);
                    this._saveTimeout = null;
                }

                if (this._isSaving) return;
                // Even forceSave should respect the explicit block during critical transitions
                if (this._blockAutoSave) return;

                this._isSaving = true;

                try {
                    await StateManager.saveState();
                    console.log("ReactiveStore: State saved successfully.");
                } catch (err) {
                    console.error("ReactiveStore: Save failed", err);
                } finally {
                    this._isSaving = false;
                }
            },

            // Legacy compatibility
            persist() {
                this.forceSave();
            }
        };
