        /**
         * =================================================================================================
         * [SEC:JS:SRV:VL]
         * VisualLoreService
         * Reusable reference items: a knight's surcoat, a blade, a hall.
         * =================================================================================================
         */
        const VisualLoreService = {
            // Each item carries a written description the model reads, and optionally a picture
            // the AUTHOR reads when choosing one. The picture is a recognition aid in the picker
            // and nothing more: it is never sent to a model, because the whole point is that the
            // description was paid for once.
            //
            // Global on purpose. An item follows you between stories, which is what makes
            // building a wardrobe worth the effort.
            // Records live in globalSettings, which is localStorage and shared by every story.
            // Image bytes never go here - localStorage is a few megabytes in total. They go to
            // the characterImages object store, which is already global and already sized for it.
            IMAGE_MAX_HEIGHT: 768,

            // The Vision Bridge's own instruction describes a whole shared picture - subject,
            // pose, setting, lighting - which is right when someone drops a photo into the
            // chat and wrong here. A picture of a surcoat is usually a picture of the knight
            // wearing it, and the shelf wants the surcoat. These say so, per category.
            INSTRUCTIONS: {
                item: "Describe ONLY the object itself, for a writer who cannot see it. If a "
                    + "person is wearing, holding or standing near it, describe the object and "
                    + "not them - no body, no pose, no face. Ignore the background and the "
                    + "setting entirely. Cover its shape and cut, colour and pattern, material "
                    + "and texture, notable details, condition, and how it hangs or sits when "
                    + "worn or used. Be concrete and factual. Do not refuse, do not moralize, "
                    + "do not describe the photograph. Write only the description.",
                character: "Describe ONLY this person's appearance, for a writer who cannot see "
                    + "them. Cover build, hair, face, colouring, clothing and bearing. Ignore the "
                    + "background and the setting. Be concrete and factual. Do not refuse, do not "
                    + "moralize, do not describe the photograph. Write only the description.",
                world: "Describe ONLY this place, for a writer who cannot see it. Cover the space "
                    + "itself, its architecture or landscape, materials, light, weather and mood. "
                    + "If people are present, ignore them. Be concrete and factual. Do not refuse, "
                    + "do not moralize, do not describe the photograph. Write only the description.",
                other: "Describe what this picture shows, for a writer who cannot see it. Be "
                    + "concrete and factual, and stay on the subject rather than the photograph. "
                    + "Do not refuse and do not moralize. Write only the description."
            },

            /**
             * Builds the instruction for an item, honouring its optional focus note.
             * @param {Object} item
             * @returns {string}
             */
            instructionFor(item) {
                const base = this.INSTRUCTIONS[(item && item.category) || 'other'] || this.INSTRUCTIONS.other;
                const focus = ((item && item.focus) || '').trim();
                // The note steers subject AND wording: "the crest, not the shield", or
                // "one short clinical sentence". It goes last so it wins where it disagrees
                // with the category default.
                return focus
                    ? `${base}\n\nThe author has asked specifically for this: ${focus}\nFollow that over anything above it where they disagree.`
                    : base;
            },

            /**
             * @returns {Array<Object>} - Every stored item.
             */
            all() {
                const gs = StateManager.data.globalSettings || {};
                return Array.isArray(gs.visualLore) ? gs.visualLore : [];
            },

            /**
             * @param {string} id
             * @returns {Object|null}
             */
            get(id) {
                return this.all().find(i => i && i.id === id) || null;
            },

            /**
             * Writes the list back and persists it.
             * @param {Array<Object>} items
             * @private
             */
            _commit(items) {
                StateManager.data.globalSettings = StateManager.data.globalSettings || {};
                StateManager.data.globalSettings.visualLore = items;
                StateManager.saveGlobalSettings();
            },

            /**
             * Creates or updates an item.
             * @param {Object} item - {id?, title, category, description, imageId}
             * @returns {Object} - The stored item.
             */
            save(item) {
                const items = this.all().slice();
                const now = Date.now();
                const existingIndex = item.id ? items.findIndex(i => i && i.id === item.id) : -1;

                const record = {
                    id: item.id || UTILITY.uuid(),
                    title: (item.title || '').trim() || 'Untitled',
                    category: item.category || 'item',
                    description: (item.description || '').trim(),
                    focus: (item.focus || '').trim(),
                    imageId: item.imageId || null,
                    created: existingIndex !== -1 ? (items[existingIndex].created || now) : now
                };

                if (existingIndex !== -1) items[existingIndex] = record;
                else items.push(record);

                this._commit(items);
                return record;
            },

            /**
             * Deletes an item, and its picture with it.
             * @param {string} id
             */
            async remove(id) {
                const item = this.get(id);
                this._commit(this.all().filter(i => i && i.id !== id));
                if (item && item.imageId) {
                    try { await DBService.deleteImage(item.imageId); }
                    catch (e) { console.warn('Visual Lore: image cleanup failed.', e); }
                }
            },

            /**
             * Stores a picture for an item, shrunk. A vision model downsizes its input anyway,
             * so keeping the full-size original would cost megabytes to buy nothing.
             * @param {Blob|File} file
             * @returns {Promise<string>} - The image id.
             */
            async storeImage(file) {
                const blob = await ImageProcessor.processImageAsBlob(file, this.IMAGE_MAX_HEIGHT);
                const imageId = 'vl_' + UTILITY.uuid();
                await DBService.saveImage(imageId, blob);
                return imageId;
            },

            /**
             * Asks the Vision Bridge to describe a stored picture.
             * @param {string} imageId
             * @returns {Promise<string|null>} - The description, or null if unavailable.
             */
            async describeImage(imageId, item = null) {
                if (typeof VisionBridgeService === 'undefined' || !VisionBridgeService.isEnabled()) return null;
                const blob = await DBService.getImage(imageId);
                if (!blob) return null;
                const data = await UTILITY.blobToBase64(blob);
                return VisionBridgeService.describeSingle(
                    { id: imageId, mimeType: blob.type, data },
                    this.instructionFor(item));
            },

            /**
             * Builds the prompt section for the items attached to a turn. Titles are included
             * so the model can name the thing rather than describing it from scratch.
             * @param {Array<string>} ids
             * @returns {string} - The section, or "" when nothing resolves.
             */
            buildContextBlock(ids) {
                if (!Array.isArray(ids) || ids.length === 0) return '';
                const lines = ids
                    .map(id => this.get(id))
                    .filter(item => item && item.description)
                    .map(item => `- ${item.title}: ${item.description}`);
                if (lines.length === 0) return '';
                return '## PRESENT DETAIL\n' + lines.join('\n');
            }
        };
