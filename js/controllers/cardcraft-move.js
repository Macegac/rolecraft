        /**
         * =================================================================================================
         * [SEC:JS:CTRL:CCMOVE]
         * CardcraftMove
         * Brings Cardcraft's cards into Rolecraft. Cardcraft lives at the same web address
         * (macegac.github.io/cardcraft), so its card library, the IndexedDB database "ginger-studio",
         * can be read from here, on any phone or PC where Cardcraft was used. It is only read:
         * Cardcraft keeps its copies. Each card picked becomes a story, as an imported card does.
         * Cardcraft retires once its cards have moved, and this file goes with it.
         * =================================================================================================
         */
        const CardcraftMove = {
            DB_NAME: 'ginger-studio',
            MOVED_KEY: 'rolecraft-cardcraft-moved',
            RUNTIME: { rows: [], urls: [] },

            /**
             * Cardcraft's cards on this device, newest first. Empty when Cardcraft was never used here,
             * and its database is never created by looking.
             * @returns {Promise<Array<Object>>} Cardcraft's own rows: { id, updated, data, concept, png, ... }.
             */
            async findCards() {
                const db = await new Promise(resolve => {
                    let request;
                    try {
                        request = indexedDB.open(this.DB_NAME);
                    } catch (e) {
                        resolve(null);
                        return;
                    }
                    // Opening a database that isn't there makes an empty one; stopping the upgrade stops that.
                    request.onupgradeneeded = () => request.transaction.abort();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = (event) => {
                        event.preventDefault();
                        resolve(null);
                    };
                    request.onblocked = () => resolve(null);
                });
                if (!db) return [];
                try {
                    if (!db.objectStoreNames.contains('cards')) return [];
                    const rows = await new Promise((resolve, reject) => {
                        const read = db.transaction('cards', 'readonly').objectStore('cards').getAll();
                        read.onsuccess = () => resolve(read.result || []);
                        read.onerror = () => reject(read.error);
                    });
                    return rows.filter(r => r && r.id && r.data).sort((a, b) => (b.updated || 0) - (a.updated || 0));
                } finally {
                    db.close();
                }
            },

            /**
             * A Cardcraft card as a story, with its portrait. Cardcraft's own edits are in the row's
             * data; the PNG's card is the one first imported, so only its picture is used. The card's
             * concept becomes the Workshop's, the idea the character grows from.
             * @returns {Promise<{story: Object, imageBlob: Blob|null}>}
             */
            async toStory(row) {
                const story = ImportExportService._convertV2toEllipsis(row.data);
                const character = story.characters.find(c => !c.is_user);
                const concept = String(row.concept || '').trim();
                if (concept && !character.workshop) {
                    const ws = WorkshopStore.fromDescription(character.description, { concept, summary: 'Brought over from Cardcraft' });
                    character.workshop = ws;
                    character.description = WorkshopStore.compile(WorkshopStore.active(ws).state);
                }
                const imageBlob = row.png ? await ImageProcessor.processImageAsBlob(new Blob([row.png], { type: 'image/png' })) : null;
                return { story, imageBlob };
            },

            /** Ids of the Cardcraft cards already brought over, and when. */
            _moved() {
                try {
                    return JSON.parse(localStorage.getItem(this.MOVED_KEY) || '{}') || {};
                } catch (e) {
                    return {};
                }
            },

            _saveMoved(moved) {
                try {
                    localStorage.setItem(this.MOVED_KEY, JSON.stringify(moved));
                } catch (e) { /* Only the ticks are lost: the cards themselves are saved. */ }
            },

            _revoke() {
                this.RUNTIME.urls.forEach(url => URL.revokeObjectURL(url));
                this.RUNTIME.urls = [];
            },

            /** The list of Cardcraft's cards to tick, in the Library Management window. */
            async open() {
                const content = document.getElementById('io-hub-modal-content');
                if (!content) return;
                this._revoke();
                content.innerHTML = this._frame(DOM.html`<p class="text-sm text-gray-400">Looking for Cardcraft's cards...</p>`).toString();
                const rows = await this.findCards();
                this.RUNTIME.rows = rows;
                content.innerHTML = this._frame(rows.length ? this._list(rows) : this._none()).toString();
            },

            _frame(body) {
                return DOM.html`
                    <div class="p-6 border-b border-gray-700 flex justify-between items-center">
                        <h2 class="text-2xl font-semibold">Bring over Cardcraft cards</h2>
                        <button data-action="cardcraft-back" class="bg-black/40 hover:bg-gray-700 text-gray-300 hover:text-white p-2 rounded-full backdrop-blur-sm transition-colors shadow-lg" title="Back">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
                        </button>
                    </div>
                    <div class="p-6 overflow-y-auto">
                        <div class="max-w-3xl mx-auto space-y-4">${body}</div>
                    </div>`;
            },

            _none() {
                return DOM.html`
                    <p class="text-sm text-gray-300">No Cardcraft cards on this device.</p>
                    <p class="text-xs text-gray-400">Cardcraft keeps its cards in the browser where you used it, so open this there: the same phone or PC, in the same browser. Or export the cards from Cardcraft and use Import File.</p>`;
            },

            _list(rows) {
                const moved = this._moved();
                const items = rows.map(row => {
                    const name = String(row.data.name || '').trim() || 'Unnamed card';
                    const when = row.updated ? new Date(row.updated).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
                    const done = !!moved[row.id];
                    let thumb = DOM.html`<div class="w-10 h-14 rounded bg-gray-700 flex-shrink-0"></div>`;
                    if (row.png) {
                        const url = URL.createObjectURL(new Blob([row.png], { type: 'image/png' }));
                        this.RUNTIME.urls.push(url);
                        thumb = DOM.html`<img src="${url}" alt="" class="w-10 h-14 rounded object-cover flex-shrink-0">`;
                    }
                    return DOM.html`
                        <label class="flex items-center gap-3 p-3 rounded-lg border border-gray-700/50 bg-black/20 cursor-pointer">
                            <input type="checkbox" class="cardcraft-pick w-5 h-5 flex-shrink-0" value="${row.id}"${done ? '' : DOM.unsafe(' checked')}>
                            ${thumb}
                            <span class="min-w-0">
                                <span class="block font-semibold truncate">${name}</span>
                                <span class="block text-xs text-gray-400">${when ? `Edited ${when}` : ''}${done ? ' · already brought over' : ''}</span>
                            </span>
                        </label>`;
                });
                return DOM.html`
                    <p class="text-sm text-gray-300">Cardcraft's cards on this device. Each one ticked becomes a story here, with its portrait, and its concept goes into the Workshop. Cardcraft keeps its copies.</p>
                    <div class="space-y-2">${items}</div>
                    <button data-action="cardcraft-bring" class="w-full bg-teal-600/20 hover:bg-teal-600/40 text-teal-200 border border-teal-600/50 font-bold py-3 px-4 rounded-lg transition-colors">Bring over the ticked cards</button>`;
            },

            /** Brings the ticked cards over, one story each, and remembers which came over. */
            async bringOver(ids) {
                const rows = this.RUNTIME.rows.filter(r => ids.includes(r.id));
                if (rows.length === 0) {
                    UIManager.showNotification('Tick at least one card.', 'info');
                    return;
                }
                const moved = this._moved();
                const failed = [];
                for (const [i, row] of rows.entries()) {
                    const name = String(row.data.name || '').trim() || 'Unnamed card';
                    UIManager.showLoadingSpinner(`Bringing over ${name} (${i + 1} of ${rows.length})...`);
                    try {
                        const { story, imageBlob } = await this.toStory(row);
                        await LibraryController.addImportedStory(story, imageBlob);
                        moved[row.id] = Date.now();
                    } catch (err) {
                        console.error('CardcraftMove: could not bring over a card.', err);
                        failed.push(name);
                    }
                }
                this._saveMoved(moved);
                StateManager.updateTagCache();
                StateManager.saveLibrary();
                UIManager.hideLoadingSpinner();
                UIManager.renderLibraryInterface();
                const done = rows.length - failed.length;
                if (done) UIManager.showNotification(`Brought over ${done} card${done === 1 ? '' : 's'} from Cardcraft.`, 'success');
                if (failed.length) UIManager.showNotification(`Could not bring over: ${failed.join(', ')}.`, 'error');
                this._revoke();
                AppController.closeModal('io-hub-modal');
            },

            registerActions() {
                ActionHandler.register('cardcraft-open', () => this.open());
                ActionHandler.register('cardcraft-back', () => {
                    this._revoke();
                    UIManager.renderIOHubModal();
                });
                ActionHandler.register('cardcraft-bring', () => {
                    const ids = [...document.querySelectorAll('#io-hub-modal-content .cardcraft-pick:checked')].map(box => box.value);
                    this.bringOver(ids);
                });
            }
        };
