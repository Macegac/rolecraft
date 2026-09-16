        /**
         * =================================================================================================
         * [SEC:JS:SRV:DB]
         * DBService (resilient, fail-soft, self-initializing)
         * =================================================================================================
         */
        /**
         * DBService
         * A resilient, fail-soft wrapper for IndexedDB to handle persistent storage.
         * Includes self-initialization, error handling for restricted environments, and transaction management.
         */
        const DBService = {
            db: null,
            DB_NAME: "EllipsisDB",
            OPEN_TIMEOUT_MS: 3000,

            /**
             * Opens the IndexedDB connection.
             * @param {number} [version=4] - The schema version.
             * @returns {Promise<boolean>} - True if successful, false otherwise.
             * @private
             */
            _open(version = 4) {
                return new Promise((resolve) => {
                    try {
                        if (this.db) return resolve(true);
                        if (!("indexedDB" in window)) {
                            console.warn("IndexedDB not supported in this environment.");
                            return resolve(false);
                        }

                        const request = indexedDB.open(this.DB_NAME, version);

                        const timeout = setTimeout(() => {
                            console.warn("IDB open timed out (likely blocked). Failing soft.");
                            resolve(false);
                        }, this.OPEN_TIMEOUT_MS);

                        request.onerror = (event) => {
                            clearTimeout(timeout);
                            console.warn("IndexedDB open error (fail-soft):", event?.target?.error);
                            resolve(false);
                        };

                        request.onblocked = () => {
                            clearTimeout(timeout);
                            console.warn("IndexedDB upgrade blocked. Continuing without cache.");
                            resolve(false);
                        };

                        request.onupgradeneeded = (event) => {
                            try {
                                const db = event.target.result;
                                if (!db.objectStoreNames.contains("characterImages")) {
                                    db.createObjectStore("characterImages");
                                }
                                if (!db.objectStoreNames.contains("stories")) {
                                    db.createObjectStore("stories", { keyPath: "id" });
                                }
                                if (!db.objectStoreNames.contains("narratives")) {
                                    db.createObjectStore("narratives", { keyPath: "id" });
                                }
                                if (!db.objectStoreNames.contains("folders")) {
                                    db.createObjectStore("folders", { keyPath: "id" });
                                }
                                // Version 4: the agent library, shared by every story.
                                if (!db.objectStoreNames.contains("agents")) {
                                    db.createObjectStore("agents", { keyPath: "id" });
                                }
                            } catch (e) {
                                console.warn("onupgradeneeded failed (fail-soft):", e);
                            }
                        };

                        request.onsuccess = (event) => {
                            clearTimeout(timeout);
                            try {
                                this.db = event.target.result;
                                this.db.onversionchange = () => {
                                    try { this.db.close(); } catch { }
                                    this.db = null;
                                };
                                resolve(true);
                            } catch (e) {
                                resolve(false);
                            }
                        };
                    } catch (err) {
                        resolve(false);
                    }
                });
            },

            _saveQueue: Promise.resolve(),

            /**
             * Performs a write operation to the database using a queue to prevent concurrency issues.
             * @param {string} storeName - The name of the object store.
             * @param {Object} data - The data to write.
             * @returns {Promise<boolean>} - True if successful, false otherwise.
             * @private
             */
            async _performWrite(storeName, data) {
                // Chain the write operation to the queue
                this._saveQueue = this._saveQueue.then(async () => {
                    if (!(await this.ensure())) throw new Error("Database closed.");

                    return new Promise((resolve, reject) => {
                        const tx = this.db.transaction([storeName], "readwrite");
                        const store = tx.objectStore(storeName);
                        const req = store.put(data); // Overwrite logic

                        tx.oncomplete = () => resolve(true);

                        tx.onerror = (e) => {
                            console.error(`DB Write Error (${storeName}):`, e.target.error);
                            reject(e.target.error);
                        };

                        req.onerror = (e) => {
                            // Specific check for Quota Exceeded
                            if (e.target.error.name === 'QuotaExceededError') {
                                alert("CRITICAL: Storage Quota Exceeded. Your recent chat cannot be saved. Please delete old stories or images.");
                            }
                            reject(e.target.error);
                        };
                    });
                }).catch(err => {
                    console.error("Critical Save Failure:", err);
                    // OPTIONAL: Update UI to show "Save Failed" icon
                    const saveIndicator = document.getElementById('save-status-indicator');
                    if (saveIndicator) { saveIndicator.textContent = "❌ Save Failed"; saveIndicator.style.color = "red"; }
                    return false;
                });

                return this._saveQueue;
            },

            /**
             * Initializes the database connection.
             * @returns {Promise<void>}
             */
            async init() {
                if (this.db) return;
                await this._open(4);
            },

            /**
             * Ensures the database is initialized and open.
             * @returns {Promise<boolean>} - True if the database is ready.
             */
            async ensure() {
                if (!this.db) await this.init();
                return !!this.db;
            },

            /**
             * Iterates over all items in a store and applies a callback.
             * @param {string} storeName - The name of the object store.
             * @param {Function} callback - The function to call for each item (key, value).
             * @returns {Promise<{success: boolean, processedCount: number, errors: Array<{key: string, error: string}>}>}
             */
            async iterateStore(storeName, callback) {
                if (!(await this.ensure())) return { success: false, processedCount: 0, errors: [] };
                return new Promise((resolve, reject) => {
                    try {
                        const tx = this.db.transaction([storeName], "readonly");
                        const store = tx.objectStore(storeName);
                        const req = store.openCursor();

                        let processedCount = 0;
                        const errors = [];

                        req.onsuccess = async (event) => {
                            const cursor = event.target.result;
                            if (cursor) {
                                try {
                                    await callback(cursor.key, cursor.value);
                                    processedCount++;
                                    cursor.continue();
                                } catch (err) {
                                    console.error(`Error processing item ${cursor.key} in ${storeName}:`, err);
                                    errors.push({ key: cursor.key, error: err.message });
                                    cursor.continue(); // Continue even if one item fails
                                }
                            } else {
                                resolve({ success: true, processedCount, errors });
                            }
                        };
                        req.onerror = () => resolve({ success: false, processedCount, errors, globalError: req.error });
                    } catch (e) { resolve({ success: false, processedCount: 0, errors: [], globalError: e }); }
                });
            },

            // --- Generic Getters/Setters/Deleters ---
            async _getAll(storeName) {
                if (!(await this.ensure())) return [];
                return new Promise((resolve) => {
                    try {
                        const tx = this.db.transaction([storeName], "readonly");
                        const store = tx.objectStore(storeName);
                        const req = store.getAll();
                        req.onsuccess = () => resolve(req.result ?? []);
                        req.onerror = () => resolve([]);
                    } catch (e) { resolve([]); }
                });
            },

            async _get(storeName, key) {
                if (!(await this.ensure())) return null;
                return new Promise((resolve) => {
                    try {
                        const tx = this.db.transaction([storeName], "readonly");
                        const store = tx.objectStore(storeName);
                        const req = store.get(key);
                        req.onsuccess = () => resolve(req.result ?? null);
                        req.onerror = () => resolve(null);
                    } catch (e) { resolve(null); }
                });
            },

            async _delete(storeName, key) {
                if (!(await this.ensure())) return false;
                return new Promise((resolve) => {
                    try {
                        const tx = this.db.transaction([storeName], "readwrite");
                        const store = tx.objectStore(storeName);
                        const req = store.delete(key);
                        req.onsuccess = () => resolve(true);
                        req.onerror = () => resolve(false);
                    } catch (e) { resolve(false); }
                });
            },

            // --- Specific Accessors ---

            async getAllStories() { return this._getAll('stories'); },
            async getStory(id) { return this._get('stories', id); },
            async saveStory(story) {
                const res = await this._performWrite('stories', story);
                if (res && typeof AutoBackupService !== 'undefined') AutoBackupService.scheduleBackup();
                return res;
            },
            async deleteStory(id) { return this._delete('stories', id); },

            async getNarrative(id) { return this._get('narratives', id); },
            async saveNarrative(narrative) {
                const res = await this._performWrite('narratives', narrative);
                if (res && typeof AutoBackupService !== 'undefined') AutoBackupService.scheduleBackup();
                return res;
            },
            async deleteNarrative(id) { return this._delete('narratives', id); },

            async getAllFolders() { return this._getAll('folders'); },
            async saveFolder(folder) { return this._performWrite('folders', folder); },
            async deleteFolder(id) { return this._delete('folders', id); },

            async getAllAgents() { return this._getAll('agents'); },
            async saveAgent(agent) { return this._performWrite('agents', agent); },
            async deleteAgent(id) { return this._delete('agents', id); },

            /**
             * Saves an image blob to the database.
             * @param {string} id - The unique ID for the image.
             * @param {Blob} blob - The image data.
             * @returns {Promise<boolean>} - True if saved successfully.
             */
            async saveImage(id, blob) {
                if (!(await this.ensure())) return false;

                // Invalidate mask and caches if a base/emotion image is replaced
                if (id && !id.endsWith('::alpha_masked') && !id.includes('::original') && !id.includes('::gradient')) {
                    const maskKey = `${id}::alpha_masked`;
                    this.deleteImage(maskKey); // Fire-and-forget DB delete

                    if (window.UIManager && window.UIManager.RUNTIME && window.UIManager.RUNTIME.characterImageCache) {
                        const cache = window.UIManager.RUNTIME.characterImageCache;
                        if (cache[id]) {
                            try { URL.revokeObjectURL(cache[id]); } catch (e) { }
                            delete cache[id];
                        }
                        const oldMaskUrl = cache[maskKey];
                        if (oldMaskUrl) {
                            const oldGradientKey = `${oldMaskUrl}::gradient`;
                            if (cache[oldGradientKey]) {
                                try { URL.revokeObjectURL(cache[oldGradientKey]); } catch (e) { }
                                delete cache[oldGradientKey];
                            }
                            try { URL.revokeObjectURL(oldMaskUrl); } catch (e) { }
                            delete cache[maskKey];
                        }
                    }
                }

                return new Promise((resolve) => {
                    try {
                        const tx = this.db.transaction(["characterImages"], "readwrite");
                        const store = tx.objectStore("characterImages");
                        tx.onabort = () => resolve(false);
                        tx.onerror = (e) => {
                            console.error("DBService.saveImage Transaction Error:", e.target.error);
                            resolve(false);
                        };
                        const req = store.put(blob, id);
                        req.onsuccess = () => {
                            resolve(true);
                            if (window.UIManager && typeof UIManager.applyAlphaMasksToAllCharacters === 'function') {
                                const story = ReactiveStore.getActiveStory();
                                if (story && story.settings && story.settings.useAlphaMask) {
                                    setTimeout(() => {
                                        UIManager.applyAlphaMasksToAllCharacters()
                                            .then(() => UIManager.renderChat())
                                            .catch(e => console.error("Auto mask generation failed:", e));
                                    }, 100);
                                }
                            }
                        };
                        req.onerror = (e) => {
                            console.error("DBService.saveImage Request Error:", e.target.error);
                            resolve(false);
                        };
                    } catch (e) {
                        console.error("DBService.saveImage Exception:", e);
                        resolve(false);
                    }
                });
            },

            async getAllKeys(storeName) {
                if (!(await this.ensure())) return [];
                return new Promise((resolve) => {
                    try {
                        const tx = this.db.transaction([storeName], "readonly");
                        const store = tx.objectStore(storeName);
                        const req = store.getAllKeys();
                        req.onsuccess = () => resolve(req.result || []);
                        req.onerror = () => resolve([]);
                    } catch (e) { resolve([]); }
                });
            },

            /**
             * Retrieves an image blob from the database.
             * @param {string} id - The ID of the image.
             * @returns {Promise<Blob|null>} - The image blob or null if not found.
             */
            async getImage(id) {
                if (!(await this.ensure())) return null;
                return new Promise((resolve) => {
                    try {
                        const tx = this.db.transaction(["characterImages"], "readonly");
                        const store = tx.objectStore("characterImages");
                        tx.onabort = () => resolve(null);
                        tx.onerror = () => resolve(null);
                        const req = store.get(id);
                        req.onsuccess = () => resolve(req.result ?? null);
                        req.onerror = () => resolve(null);
                    } catch (e) { resolve(null); }
                });
            },

            /**
             * Deletes an image from the database.
             * @param {string} id - The ID of the image to delete.
             * @returns {Promise<boolean>} - True if deleted successfully.
             */
            async deleteImage(id) {
                if (!(await this.ensure())) return false;

                // Invalidate mask and caches if a base/emotion image is deleted
                if (id && !id.endsWith('::alpha_masked') && !id.includes('::original') && !id.includes('::gradient')) {
                    const maskKey = `${id}::alpha_masked`;
                    this.deleteImage(maskKey); // Recursive DB delete

                    if (window.UIManager && window.UIManager.RUNTIME && window.UIManager.RUNTIME.characterImageCache) {
                        const cache = window.UIManager.RUNTIME.characterImageCache;
                        if (cache[id]) {
                            try { URL.revokeObjectURL(cache[id]); } catch (e) { }
                            delete cache[id];
                        }
                        const oldMaskUrl = cache[maskKey];
                        if (oldMaskUrl) {
                            const oldGradientKey = `${oldMaskUrl}::gradient`;
                            if (cache[oldGradientKey]) {
                                try { URL.revokeObjectURL(cache[oldGradientKey]); } catch (e) { }
                                delete cache[oldGradientKey];
                            }
                            try { URL.revokeObjectURL(oldMaskUrl); } catch (e) { }
                            delete cache[maskKey];
                        }
                    }
                }

                return new Promise((resolve) => {
                    try {
                        const tx = this.db.transaction(["characterImages"], "readwrite");
                        const store = tx.objectStore("characterImages");
                        tx.onabort = () => resolve(false);
                        tx.onerror = () => resolve(false);
                        const req = store.delete(id);
                        req.onsuccess = () => resolve(true);
                        req.onerror = () => resolve(false);
                    } catch (e) { resolve(false); }
                });
            },

            /**
             * Clears all images from the database.
             * @returns {Promise<boolean>} - True if cleared successfully.
             */
            async clear() {
                if (!(await this.ensure())) return false;
                return new Promise((resolve) => {
                    try {
                        const tx = this.db.transaction(["characterImages"], "readwrite");
                        const store = tx.objectStore("characterImages");
                        const req = store.clear();
                        req.onsuccess = () => resolve(true);
                    } catch (e) { resolve(false); }
                });
            },

            /**
             * Saves a story object to the database.
             * @param {Object} story - The story object.
             * @returns {Promise<boolean>} - True if saved successfully.
             */
            async saveStory(story) {
                UTILITY.normalizeStoryShape(story);
                return this._performWrite("stories", story);
            },

            /**
             * Retrieves a story by its ID.
             * @param {string} storyId - The ID of the story.
             * @returns {Promise<Object|null>} - The story object or null.
             */
            async getStory(storyId) {
                if (!(await this.ensure())) return null;
                return new Promise((resolve) => {
                    try {
                        const tx = this.db.transaction(["stories"], "readonly");
                        const store = tx.objectStore("stories");
                        const req = store.get(storyId);
                        req.onsuccess = () => resolve(UTILITY.normalizeStoryShape(req.result ?? null));
                        req.onerror = () => resolve(null);
                    } catch (e) { resolve(null); }
                });
            },

            /**
             * Retrieves all stories from the database.
             * @returns {Promise<Array<Object>>} - An array of story objects.
             */
            async getAllStories() {
                if (!(await this.ensure())) return [];
                return new Promise((resolve) => {
                    try {
                        const tx = this.db.transaction(["stories"], "readonly");
                        const store = tx.objectStore("stories");
                        const req = store.getAll();
                        req.onsuccess = () => resolve((req.result ?? []).map(s => UTILITY.normalizeStoryShape(s)));
                        req.onerror = () => resolve([]);
                    } catch (e) { resolve([]); }
                });
            },

            /**
             * Deletes a story by its ID.
             * @param {string} storyId - The ID of the story to delete.
             * @returns {Promise<boolean>} - True if deleted successfully.
             */
            async deleteStory(storyId) {
                if (!(await this.ensure())) return false;
                return new Promise((resolve) => {
                    try {
                        const tx = this.db.transaction(["stories"], "readwrite");
                        const store = tx.objectStore("stories");
                        const req = store.delete(storyId);
                        req.onsuccess = () => resolve(true);
                        req.onerror = () => resolve(false);
                    } catch (e) { resolve(false); }
                });
            },

            /**
             * Saves a narrative object to the database.
             * @param {Object} narrative - The narrative object.
             * @returns {Promise<boolean>} - True if saved successfully.
             */
            async saveNarrative(narrative) {
                return this._performWrite("narratives", narrative);
            },

            /**
             * Retrieves a narrative by its ID.
             * @param {string} narrativeId - The ID of the narrative.
             * @returns {Promise<Object|null>} - The narrative object or null.
             */
            async getNarrative(narrativeId) {
                if (!(await this.ensure())) return null;
                return new Promise((resolve) => {
                    try {
                        const tx = this.db.transaction(["narratives"], "readonly");
                        const store = tx.objectStore("narratives");
                        const req = store.get(narrativeId);
                        req.onsuccess = () => resolve(req.result ?? null);
                        req.onerror = () => resolve(null);
                    } catch (e) { resolve(null); }
                });
            },

            /**
             * Retrieves all narratives from the database.
             * @returns {Promise<Array<Object>>} - An array of narrative objects.
             */
            async getAllNarratives() {
                if (!(await this.ensure())) return [];
                return new Promise((resolve) => {
                    try {
                        const tx = this.db.transaction(["narratives"], "readonly");
                        const store = tx.objectStore("narratives");
                        const req = store.getAll();
                        req.onsuccess = () => resolve(req.result ?? []);
                        req.onerror = () => resolve([]);
                    } catch (e) { resolve([]); }
                });
            },

            /**
             * Deletes a narrative by its ID.
             * @param {string} narrativeId - The ID of the narrative to delete.
             * @returns {Promise<boolean>} - True if deleted successfully.
             */
            async deleteNarrative(narrativeId) {
                if (!(await this.ensure())) return false;
                return new Promise((resolve) => {
                    try {
                        const tx = this.db.transaction(["narratives"], "readwrite");
                        const store = tx.objectStore("narratives");
                        const req = store.delete(narrativeId);
                        req.onsuccess = () => resolve(true);
                        req.onerror = () => resolve(false);
                    } catch (e) { resolve(false); }
                });
            },

            /**
             * Retrieves all entries from a specific store as key-value pairs.
             * @param {string} storeName - The name of the store.
             * @returns {Promise<Array<Array>>} - An array of [key, value] pairs.
             */
            async getAllEntries(storeName) {
                if (!(await this.ensure())) return [];
                return new Promise((resolve) => {
                    try {
                        const tx = this.db.transaction([storeName], "readonly");
                        const store = tx.objectStore(storeName);
                        const entries = [];
                        const req = store.openCursor();
                        req.onsuccess = (event) => {
                            const cursor = event.target.result;
                            if (cursor) {
                                entries.push([cursor.key, cursor.value]);
                                cursor.continue();
                            } else {
                                resolve(entries);
                            }
                        };
                        req.onerror = () => resolve([]);
                    } catch (e) { resolve([]); }
                });
            },

            /**
             * Clears all data from a specific store.
             * @param {string} storeName - The name of the store to clear.
             * @returns {Promise<boolean>} - True if cleared successfully.
             */
            async clearStore(storeName) {
                if (!(await this.ensure())) return false;
                return new Promise((resolve) => {
                    try {
                        const tx = this.db.transaction([storeName], "readwrite");
                        const store = tx.objectStore(storeName);
                        const req = store.clear();
                        req.onsuccess = () => resolve(true);
                        req.onerror = () => resolve(false);
                    } catch (e) { resolve(false); }
                });
            }
        };
