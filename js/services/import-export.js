        /**
         * =================================================================================================
         * [SEC:JS:SRV:IE]
         * ImportExportService
         * Handles the complexities of saving/loading stories in JSON, PNG, and BYAF formats.
         * =================================================================================================
         */
        const ImportExportService = {
            /**
             * Parses an uploaded file based on its extension.
             * @param {File} file - The uploaded file.
             * @param {boolean} [skipImages=false] - Whether to skip image processing.
             * @returns {Promise<Object>} - The parsed story object and optional image blob.
             */
            async parseUploadedFile(file, skipImages = false) {
                const lowerCaseName = file.name.toLowerCase();
                if (lowerCaseName.endsWith('.png')) {
                    return this._parseV2Card(file, skipImages);
                } else if (lowerCaseName.endsWith('.zip') || lowerCaseName.endsWith('.byaf')) {
                    // Peek inside ZIP to distinguish between BYAF and Ellipsis ZIP
                    const zip = await JSZip.loadAsync(file);
                    if (zip.file('narrative.json')) {
                        return this._parseStoryZip(zip, file, skipImages);
                    }
                    return this._parseBYAF(file, skipImages);
                } else if (lowerCaseName.endsWith('.json')) {
                    return this._parseEllipsisJSON(file);
                } else {
                    throw new Error("Unsupported file type. Please use .png, .byaf, .zip, or .json.");
                }
            },

            /**
             * Exports a story as a JSON blob.
             * @param {Object} story - The story object.
             * @returns {Blob} - The JSON blob.
             */
            exportStoryAsJSON(story) {
                const storyExport = JSON.parse(JSON.stringify(story));
                return new Blob([JSON.stringify(storyExport, null, 2)], { type: 'application/json' });
            },

            /**
             * Ensures all characters in the chat history exist in the story.
             * @param {Object} story - The story object.
             * @param {Array} chatHistory - The chat history.
             * @returns {Array<string>} - The list of active character IDs.
             * @private
             */
            _ensureCharactersExist(story, chatHistory) {
                const registeredIds = new Set(story.characters.map(c => c.id));
                const activeIds = new Set(story.characters.filter(c => c.is_active).map(c => c.id));

                // Map names to IDs for existing chars to avoid duplicates if ID is missing but name matches
                const nameToId = {};
                story.characters.forEach(c => nameToId[c.name] = c.id);

                chatHistory.forEach(msg => {
                    if (msg.type === 'chat' && !registeredIds.has(msg.character_id)) {
                        // We found a message with an ID that isn't in the roster.
                        // This is a "Ghost". We must manifest a body for it.

                        // 1. Check if we can recover it by name (common in V2 imports)
                        // (Assuming content might have name prefix, or we just create a generic one)
                        // Since V2/BYAF often don't give us the ID in the message, we might have generated a random UUID 
                        // for the message that has no matching char. 

                        // Actually, for V2/BYAF, the previous logic often maps names to IDs. 
                        // If the mapping failed, we need a fallback.

                        const ghostChar = {
                            id: msg.character_id, // Use the ID the message is already pointing to
                            name: msg.name || "Unknown Speaker", // Fallback name
                            description: "Imported from group chat history.",
                            short_description: "Imported.",
                            model_instructions: "Act as this character.",
                            tags: ["imported"],
                            image_url: "",
                            extra_portraits: [],
                            is_user: false,
                            is_active: true, // Keep active so they show up
                            is_narrator: false,
                            color: { base: '#475569', bold: '#94a3b8' } // Slate
                        };

                        story.characters.push(ghostChar);
                        registeredIds.add(ghostChar.id);
                        activeIds.add(ghostChar.id);
                    }
                });

                return Array.from(activeIds);
            },

            /**
             * Exports a story as a V2 Character Card (PNG).
             * @param {Object} story - The story object.
             * @param {Object} narrative - The narrative object.
             * @param {string} primaryCharId - The ID of the primary character.
             * @returns {Promise<Uint8Array>} - The PNG buffer with embedded data.
             */
            async exportStoryAsV2(story, narrative, primaryCharId) {
                const primaryChar = story.characters.find(c => c.id === primaryCharId);
                if (!primaryChar) throw new Error("V2 export requires a selected primary character.");
                let originalImageBlob = null;
                try { originalImageBlob = await DBService.getImage(primaryChar.id); } catch (dbError) { }
                if (!originalImageBlob && primaryChar.image_url && !primaryChar.image_url.startsWith('local_idb_')) {
                    try {
                        const response = await fetch(primaryChar.image_url);
                        if (response.ok) originalImageBlob = await response.blob();
                    } catch (fetchError) { }
                }
                if (!originalImageBlob) throw new Error("V2 export requires the primary character to have a valid image.");

                let pngBlob;
                try {
                    if (originalImageBlob.type === 'image/png') pngBlob = originalImageBlob;
                    else pngBlob = await ImageProcessor.convertBlobToPNGBlob(originalImageBlob);
                } catch (conversionError) { throw new Error("Failed to convert character image to PNG format for export."); }

                const v2Object = this._convertEllipsistoV2(story, narrative, primaryCharId);
                const pngImageBuffer = await pngBlob.arrayBuffer();
                return this._injectDataIntoPng(pngImageBuffer, v2Object);
            },

            /**
             * Exports a story as a BYAF (Backyard AI Format) ZIP.
             * @param {Object} story - The story object.
             * @param {Object} narrative - The narrative object.
             * @param {string} primaryCharId - The ID of the primary character.
             * @returns {Promise<Blob>} - The ZIP blob.
             */
            async exportStoryAsBYAF(story, narrative, primaryCharId) {
                const primaryChar = story.characters.find(c => c.id === primaryCharId);
                if (!primaryChar) throw new Error("BYAF export requires a selected primary character.");
                let imageBlob = null;
                let imageExtension = 'png';
                let imageFilename = null;
                try {
                    const blob = await DBService.getImage(primaryChar.id);
                    if (blob) {
                        imageBlob = blob;
                        const typeParts = blob.type.split('/');
                        if (typeParts.length === 2 && ['png', 'jpeg', 'jpg', 'webp'].includes(typeParts[1])) {
                            imageExtension = typeParts[1] === 'jpeg' ? 'jpg' : typeParts[1];
                        }
                    }
                } catch (dbError) { }
                if (!imageBlob && primaryChar.image_url && !primaryChar.image_url.startsWith('local_idb_')) {
                    try {
                        const response = await fetch(primaryChar.image_url);
                        if (response.ok) {
                            imageBlob = await response.blob();
                            const contentType = response.headers.get('content-type');
                            if (contentType) {
                                const typeParts = contentType.split('/');
                                if (typeParts.length === 2 && ['png', 'jpeg', 'jpg', 'webp'].includes(typeParts[1])) {
                                    imageExtension = typeParts[1] === 'jpeg' ? 'jpg' : typeParts[1];
                                }
                            } else {
                                const urlParts = primaryChar.image_url.split('.').pop()?.toLowerCase();
                                if (urlParts && ['png', 'jpg', 'jpeg', 'webp'].includes(urlParts)) imageExtension = urlParts === 'jpeg' ? 'jpg' : urlParts;
                            }
                        }
                    } catch (fetchError) { }
                }
                if (imageBlob) imageFilename = `${primaryChar.id}.${imageExtension}`;
                const byafArchiveData = this._convertEllipsistoBYAF(story, narrative, primaryCharId, imageFilename);
                if (!byafArchiveData || !byafArchiveData.manifest) throw new Error("Failed to generate BYAF data structure.");
                const zip = new JSZip();
                zip.file("manifest.json", JSON.stringify(byafArchiveData.manifest, null, 2));
                const charFolder = zip.folder(`characters/${primaryChar.id}`);
                charFolder.file("character.json", JSON.stringify(byafArchiveData.character, null, 2));
                if (imageBlob && imageFilename) charFolder.file(`images/${imageFilename}`, imageBlob);
                zip.file(`scenarios/scenario1.json`, JSON.stringify(byafArchiveData.scenario, null, 2));
                // Background Image: Include in ZIP for BYAF format compatibility
                if (story.backgroundImageURL === 'local_idb_background') {
                    try {
                        const bgBlob = await DBService.getImage(`bg_${story.id}`);
                        if (bgBlob) {
                            zip.file("images/story_background.png", bgBlob);
                        }
                    } catch (e) { console.warn("Failed to add background to BYAF:", e); }
                }

                return zip.generateAsync({ type: "blob" });
            },

            /**
             * Exports a story as a comprehensive ZIP archive.
             * Includes narrative.html (viewable), narrative.json (data), and an images folder.
             * @param {Object} story - The story object.
             * @param {Object} narrative - The narrative object.
             * @returns {Promise<Blob>} - The ZIP blob.
             */
            async exportStoryAsZip(story, narrative) {
                const zip = new JSZip();
                const imagesFolder = zip.folder("images");
                const imageMap = new Map(); // key -> filename
                const log = []; // Debug log
                const logMsg = (msg) => { console.log(msg); log.push(msg); };

                logMsg(`Exporting ZIP for story: ${story.name} (${story.id})`);
                logMsg(`Characters: ${story.characters.length}`);

                // Pre-fetch all image keys for fuzzy matching
                const allImageKeys = await DBService.getAllKeys("characterImages");
                logMsg(`Total DB Image Keys: ${allImageKeys.length}`);

                // Helper to add image to ZIP and track filename
                const addImage = async (key, filenamePrefix) => {
                    if (!key) return;
                    // Since we might try multiple keys for the same conceptual image, verify we haven't already exported this KEY.
                    if (imageMap.has(key)) return;

                    // Check if we already have this blob under a DIFFERENT key? 
                    // Hard to check blob equality without fetching. Let's rely on key uniqueness.

                    let blob = null;
                    let successKey = key;

                    // Strategy 1: Direct Lookup
                    try {
                        blob = await DBService.getImage(key);
                    } catch (e) { }

                    // Strategy 2: Prefix/Suffix Variations
                    if (!blob && !key.startsWith('http')) {
                        const candidates = [
                            `local_idb_${key}`,
                            key.replace('local_idb_', ''),
                            // Try finding key in allImageKeys that ENDS with the ID (uuid)
                            // This covers 'local_idb_UUID' matching 'UUID'
                            ...allImageKeys.filter(k => typeof k === 'string' && (k.includes(key) || key.includes(k)))
                        ];

                        // Deduplicate and filter candidates
                        const uniqueCandidates = [...new Set(candidates)].filter(c => c !== key);

                        for (const cand of uniqueCandidates) {
                            if (blob) break;
                            logMsg(`  > Trying fallback key: ${cand} for ${key}`);
                            blob = await DBService.getImage(cand);
                            if (blob) successKey = cand;
                        }
                    }

                    if (blob) {
                        const ext = blob.type.split('/')[1] || 'png';
                        const safeExt = ext === 'jpeg' ? 'jpg' : ext;

                        // Sanitize filename
                        const safePrefix = filenamePrefix.replace(/[^a-z0-9_-]/gi, '_');
                        // Use the ORIGINAL key for suffix to keep file name consistent with expectation, 
                        // unless it's way too long, then use hash or slice.
                        const safeKeySuffix = key.replace(/[^a-z0-9]/gi, '').substring(0, 12);
                        const filename = `${safePrefix}_${safeKeySuffix}.${safeExt}`;

                        imagesFolder.file(filename, blob);
                        imageMap.set(key, `images/${filename}`); // Map the ORIGINAL key request to this file

                        // If we found it via a fallback key, ALSO map the fallback key just in case
                        if (successKey !== key) {
                            imageMap.set(successKey, `images/${filename}`);
                        }

                        logMsg(`  [OK] Added: ${filename} (Size: ${blob.size}, Key: ${key}, FoundAt: ${successKey})`);
                    } else {
                        if (!key.startsWith('http')) {
                            logMsg(`  [FAIL] Could not find image for key: ${key}`);
                        }
                    }
                };

                // 1. Export Character Images
                for (const char of story.characters) {
                    logMsg(`Processing Character: ${char.name} (${char.id})`);
                    if (char.image_url) await addImage(char.image_url, `char_${char.name}`);
                    // ALWAYS try the ID as a fallback / primary for local images
                    await addImage(char.id, `char_${char.name}`);

                    if (char.extra_portraits) {
                        for (const p of char.extra_portraits) {
                            const emoKey = `${char.id}::emotion::${p.emotion}`;
                            await addImage(emoKey, `char_${char.name}_${p.emotion}`);
                        }
                    }
                }

                // 2. Export Location Images (if any) and Story Background
                if (story.backgroundImageURL && !story.backgroundImageURL.startsWith('http')) {
                    await addImage(story.backgroundImageURL, 'background');
                    // Also try bg_${story.id} just in case
                    await addImage(`bg_${story.id}`, 'background_legacy');
                }

                // Scan World Map for location images (assuming they are keys)
                if (narrative.state.worldMap && narrative.state.worldMap.grid) {
                    for (const loc of narrative.state.worldMap.grid) {
                        const locKey = `location::${loc.coords.x},${loc.coords.y}`;
                        // Try explicit key
                        await addImage(locKey, `loc_${loc.coords.x}_${loc.coords.y}`);
                        // Try URL if present
                        if (loc.imageUrl && !loc.imageUrl.startsWith('http')) {
                            await addImage(loc.imageUrl, `loc_${loc.coords.x}_${loc.coords.y}_ref`);
                        }
                    }
                }

                // 3. Export Visual Event Images from Chat History
                if (narrative.state.chat_history) {
                    for (const msg of narrative.state.chat_history) {
                        if (msg.type === 'visual_event' && msg.image_key) {
                            await addImage(msg.image_key, 'visual');
                        }
                    }
                }

                // 4. Generate JSON Data
                // Hydrate full narratives like in JSON export
                // We need to fetch ALL narratives associated with the story to make it a complete backup
                // But the user might only strictly care about the active one + context?
                // The task says "Export ZIP Archive" (singular narrative implicitly?) -> No, typically "Export Story" implies the whole thing.
                // The original code tried fetching all.
                const fullNarratives = await Promise.all((story.narratives || []).map(n => DBService.getNarrative(n.id)));
                const exportObj = JSON.parse(JSON.stringify(story));
                exportObj.narratives = fullNarratives.filter(n => n);

                zip.file("narrative.json", JSON.stringify(exportObj, null, 2));

                // 5. Generate HTML
                const htmlContent = this._generateNarrativeHTML(story, narrative, imageMap);
                zip.file("narrative.html", htmlContent);
                zip.file("image_manifest.json", JSON.stringify(Object.fromEntries(imageMap), null, 2));

                // 6. Debug Log
                zip.file("_debug_export_log.txt", log.join('\n'));

                return zip.generateAsync({ type: "blob" });
            },

            /**
             * Generates a standalone HTML string for the narrative.
             * @param {Object} story - The story object.
             * @param {Object} narrative - The narrative object.
             * @param {Map} imageMap - Map of DB keys to ZIP relative paths.
             * @returns {string} - The HTML string.
             */
            _generateNarrativeHTML(story, narrative, imageMap) {
                const state = narrative.state;
                const title = story.name + " - " + narrative.name;
                const defaults = UTILITY.getDefaultUiSettings();
                const settings = { ...defaults, ...story }; // Merge defaults with story settings

                // CSS Variables Extraction
                const cssVars = `
            :root {
                --font-primary: ${settings.font || 'Inter, sans-serif'};
                --text-size: ${settings.textSize || 16}px;
                --md-h1-color: ${settings.md_h1_color || defaults.md_h1_color};
                --md-h2-color: ${settings.md_h2_color || defaults.md_h2_color};
                --md-h3-color: ${settings.md_h3_color || defaults.md_h3_color};
                --md-bold-color: ${settings.md_bold_color || defaults.md_bold_color};
                --md-italic-color: ${settings.md_italic_color || defaults.md_italic_color};
                --md-quote-color: ${settings.md_quote_color || defaults.md_quote_color};
                --chat-text-color: ${settings.chatTextColor || '#e5e7eb'};
                --brand-color: #6366f1;
            }
                `;

                // Render Chat History
                let chatHTML = '';
                (state.chat_history || []).forEach(msg => {
                    if (msg.isHidden || msg.type === 'lore_reveal' || msg.type === 'swarm_summary') return;

                    // Handle Visual Events
                    if (msg.type === 'visual_event') {
                        const imgPath = imageMap.get(msg.image_key);
                        if (imgPath && !imgPath.includes('${imgSrc}')) {
                            chatHTML += DOM.html`
                            <div class="message visual-event" style="text-align: center; margin: 2rem 0;">
                                <img src="${imgPath}" alt="Visual Event" style="max-width: 100%; border-radius: 0.75rem; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
                            </div>`.toString();
                        }
                        return;
                    }

                    // Handle Chat Messages
                    const charId = msg.character_id;
                    const char = story.characters.find(c => c.id === charId);
                    const isUser = (char && char.is_user) || msg.character_id === 'user';
                    const name = char ? char.name : (isUser ? 'You' : 'Unknown');

                    // Colors & Styles
                    const charColor = (char && char.color) ? char.color : (isUser ? { base: '#4b5563', bold: '#e5e7eb' } : { base: '#334155', bold: '#94a3b8' });
                    const bubbleOpacity = settings.bubbleOpacity !== undefined ? settings.bubbleOpacity : 1.0;
                    // Hex to RGBA helper
                    const hexToRgba = (hex, alpha) => {
                        if (!hex) return hex;
                        if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
                            let c = hex.substring(1).split('');
                            if (c.length === 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
                            c = '0x' + c.join('');
                            return 'rgba(' + [(c >> 16) & 255, (c >> 8) & 255, c & 255].join(',') + ',' + alpha + ')';
                        }
                        return hex;
                    };
                    const bubbleBg = hexToRgba(charColor.base, bubbleOpacity);

                    // Avatar (if valid)
                    let avatarHTML = '';
                    let avatarKey = char?.image_url;
                    if (!avatarKey && char?.id) avatarKey = char.id; // Fallback for local images

                    if (avatarKey && imageMap.has(avatarKey) && !imageMap.get(avatarKey).includes('${imgSrc}')) {
                        avatarHTML = DOM.html`<img src="${imageMap.get(avatarKey)}" class="avatar" style="float: left; width: 50px; height: 50px; border-radius: 50%; margin-right: 1rem; object-fit: cover;">`.toString();
                    } else if (char?.image_url && char.image_url.startsWith('http') && !char.image_url.includes('${imgSrc}')) {
                        avatarHTML = DOM.html`<img src="${char.image_url}" class="avatar" style="float: left; width: 50px; height: 50px; border-radius: 50%; margin-right: 1rem; object-fit: cover;">`.toString();
                    }

                    // Smart Quotes
                    const smartContent = (msg.content || '')
                        .replace(/(["“][^"”]*["”])/g, '<span class="dialogue-quote">$1</span>')
                        .replace(/(^|\s)'((?:[^']|'(?=\w)){2,})'(?=\s|[.,!?;:]|$)/gm, '$1<span class="dialogue-quote">\'$2\'</span>');

                    chatHTML += `
                    <div class="message ${isUser ? 'user-message' : 'ai-message'}" style="background-color: ${bubbleBg}; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem; overflow: hidden; color: var(--chat-text-color);">
                        ${avatarHTML}
                        <div class="message-header" style="color: ${charColor.bold}; font-weight: bold; margin-bottom: 0.5rem;">${name}</div>
                        <div class="message-content" style="line-height: 1.5; white-space: pre-wrap;">${marked.parse(smartContent)}</div>
                    </div>`;
                });

                return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        ${cssVars}
        body { background-color: #0f172a; font-family: var(--font-primary); font-size: var(--text-size); padding: 2rem; max-width: 900px; margin: 0 auto; color: #cbd5e1; }
        a { color: var(--brand-color); }
        .dialogue-quote { color: inherit; filter: saturate(175%) opacity(75%) drop-shadow(1px 1px 5px black); font-weight: 500; }
        .message-content blockquote { border-left: 3px solid var(--brand-color); padding-left: 1rem; font-style: italic; background: rgba(0,0,0,0.2); padding: 0.5rem 1rem; border-radius: 0.25rem; }
        .message-content code { background-color: rgba(0,0,0,0.3); padding: 0.1em 0.3em; border-radius: 0.2rem; font-family: monospace; }
    </style>
</head>
<body>
    <h1 style="color: white; border-bottom: 1px solid #334155; padding-bottom: 1rem; margin-bottom: 2rem;">${title}</h1>
    <div id="chat-container">
        ${chatHTML}
    </div>
</body>
</html>`;
            },

            /**
             * Parses the new ZIP format (Import).
             * @param {JSZip} zip - The loaded ZIP object.
             * @param {File} file - The original file (unused but kept for signature).
             * @param {boolean} skipImages - Whether to skip importing images.
             * @returns {Promise<Object>} - The parsed story object.
             */
            async _parseStoryZip(zip, file, skipImages) {
                const jsonFile = zip.file("narrative.json");
                if (!jsonFile) throw new Error("ZIP does not contain 'narrative.json'.");
                const jsonStr = await jsonFile.async("string");
                const story = JSON.parse(jsonStr);

                // --- SAFE IMPORT: ID Remapping ---
                // We MUST generate new IDs for everything to prevent overwriting existing stories/characters
                // if the user imports a ZIP that originated from this same library.

                story.id = UTILITY.uuid();
                // Add timestamp to name to avoid confusion if same name exists
                // (Controller handles name dupe check too, but this helps)
                // story.name = `${story.name} (Imported)`; // Optional, let controller handle duplicate names

                const charIdMap = {};
                (story.characters || []).forEach(c => {
                    const oldId = c.id;
                    const newId = UTILITY.uuid();
                    c.id = newId;
                    charIdMap[oldId] = newId;
                });

                // Helper to remap IDs in history
                const remapHistory = (history) => {
                    if (!Array.isArray(history)) return;
                    history.forEach(msg => {
                        if (msg.character_id && charIdMap[msg.character_id]) {
                            msg.character_id = charIdMap[msg.character_id];
                        }
                    });
                };

                // Helper to remap active character IDs
                const remapActiveIds = (ids) => {
                    if (!Array.isArray(ids)) return ids;
                    return ids.map(id => charIdMap[id] || id);
                };

                // Several parts of a story are filed under a character's id rather than holding it
                // in a field: how that character has grown, their stats, their secrets. Everyone
                // gets a new id on import, so without this the data arrives in the file but is
                // filed under a character who no longer exists, and the story quietly comes back
                // with its personas reset and its stat bars empty.
                const CHARACTER_KEYED = [
                    'evolved_characters', 'character_stats', 'livingPersonaCounters',
                    'last_stat_deltas', 'swarmSecrets', 'swarmLastIntents', 'swarmNarrativeCapital'
                ];
                const remapCharacterKeyed = (state) => {
                    if (!state || typeof state !== 'object') return;
                    for (const key of CHARACTER_KEYED) {
                        const original = state[key];
                        if (!original || typeof original !== 'object' || Array.isArray(original)) continue;
                        const moved = {};
                        for (const [oldId, value] of Object.entries(original)) {
                            moved[charIdMap[oldId] || oldId] = value;
                        }
                        state[key] = moved;
                    }
                    // Journal relationships and quests point at a character by id.
                    const game = state.gameState;
                    if (game && typeof game === 'object') {
                        ['relationships', 'journal'].forEach(listName => {
                            (Array.isArray(game[listName]) ? game[listName] : []).forEach(entry => {
                                if (entry && entry.characterId && charIdMap[entry.characterId]) {
                                    entry.characterId = charIdMap[entry.characterId];
                                }
                            });
                        });
                    }
                };

                // 1. Remap Scenarios
                (story.scenarios || []).forEach(s => {
                    s.id = UTILITY.uuid();
                    remapHistory(s.example_dialogue);
                    if (s.active_character_ids) {
                        s.active_character_ids = remapActiveIds(s.active_character_ids);
                    }
                });

                // 2. Remap Narratives (both stubs and full objects if present)
                // In ZIP export, 'narratives' are full objects.
                (story.narratives || []).forEach(n => {
                    n.id = UTILITY.uuid();
                    if (n.state) {
                        remapHistory(n.state.chat_history);
                        if (n.state.static_entries) {
                            n.state.static_entries.forEach(e => e.id = UTILITY.uuid());
                        }
                        remapCharacterKeyed(n.state);
                    }
                    if (n.active_character_ids) {
                        n.active_character_ids = remapActiveIds(n.active_character_ids);
                    }
                });

                // 3. Remap Dynamic Entries
                (story.dynamic_entries || []).forEach(e => e.id = UTILITY.uuid());

                // --- End ID Remapping ---

                // Process Images
                const manifestFile = zip.file("image_manifest.json");
                let imageManifest = {};
                if (manifestFile) {
                    try {
                        imageManifest = JSON.parse(await manifestFile.async("string"));
                    } catch (e) {
                        console.warn("Failed to parse image_manifest.json", e);
                    }
                }

                if (!skipImages) {
                    // We iterate sequentially to avoid memory spikes ("piecemeal" processing)
                    for (const [oldKey, path] of Object.entries(imageManifest)) {
                        const imgFile = zip.file(path);
                        if (imgFile) {
                            try {
                                const blob = await imgFile.async("blob");

                                // DETERMINE NEW KEY
                                let newKey = oldKey; // Default to old key (e.g. for non-ID keys)

                                // Check if oldKey contains a remapped Character ID
                                // key format: local_idb_UUID or just UUID
                                // We check against the keys of charIdMap
                                const matchingOldId = Object.keys(charIdMap).find(oid => oldKey.includes(oid));

                                if (matchingOldId) {
                                    // Replace the old ID part with the new ID
                                    newKey = oldKey.replace(matchingOldId, charIdMap[matchingOldId]);
                                } else if (oldKey === `bg_${story.id}` || oldKey.includes('bg_')) {
                                    // Handle background specific key logic if needed
                                    // But since we regenerated story.id at top, we just need to construct new key
                                    // Wait, we don't know the OLD story ID easily unless we parse it out.
                                    // If key is 'bg_OLDSTORYID', we want 'bg_NEWSTORYID'.
                                    // Heuristic: if it looks like a background key, assign it to current story
                                    if (oldKey.startsWith('bg_')) {
                                        newKey = `bg_${story.id}`;
                                    }
                                }

                                // Update the Story/Character reference to point to this new key
                                // Characters:
                                const relatedChar = story.characters.find(c => c.image_url === oldKey);
                                if (relatedChar) {
                                    relatedChar.image_url = newKey;
                                }

                                // Extra Portraits:
                                story.characters.forEach(c => {
                                    if (c.extra_portraits) {
                                        c.extra_portraits.forEach(p => {
                                            // emotion key: CHARID::emotion::EMOTION
                                            // Since we remapped c.id already, and matchingOldId logic above handles the key replacement...
                                            // The key in manifest is OLD key. 
                                            // The key in c.extra_portraits (if any) ? extra_portraits doesn't store keys usually, 
                                            // the logic constructs them dynamically: ID::emotion::Name.
                                            // So we just need to ensure the IMAGE is saved under the NEW ID-based key.
                                            // If newKey was correctly transformed using charIdMap replacement, we are good.
                                        });
                                    }
                                });

                                // Story Background:
                                if (story.backgroundImageURL === oldKey) {
                                    story.backgroundImageURL = newKey;
                                }

                                await DBService.saveImage(newKey, blob);

                            } catch (e) {
                                console.warn(`Failed to import image ${oldKey} from ${path}`, e);
                            }
                        }
                    }
                }

                return { story, imageBlob: null };
            },




            /**
             * Parses an Ellipsis JSON file.
             * @param {File} file - The JSON file.
             * @returns {Promise<Object>} - The parsed story object.
             * @private
             */
            async _parseEllipsisJSON(file) {
                const jsonString = await file.text();
                const story = JSON.parse(jsonString);
                if (!story.id || !story.name || !story.characters) throw new Error("Invalid Ellipsis JSON file.");

                story.id = UTILITY.uuid();

                // ID Remapping: Ensure unique IDs for imported characters to prevent collisions
                const charIdMap = {};
                (story.characters || []).forEach(c => {
                    const oldId = c.id;
                    const newId = UTILITY.uuid();
                    c.id = newId;
                    charIdMap[oldId] = newId;
                });

                // Helper to remap IDs in history
                const remapHistory = (history) => {
                    if (!Array.isArray(history)) return;
                    history.forEach(msg => {
                        if (msg.character_id && charIdMap[msg.character_id]) {
                            msg.character_id = charIdMap[msg.character_id];
                        }
                    });
                };

                // Scenario Updates: Update example dialogue references to match new character IDs
                (story.scenarios || []).forEach(s => {
                    s.id = UTILITY.uuid();
                    remapHistory(s.example_dialogue);
                    if (s.active_character_ids) {
                        s.active_character_ids = (s.active_character_ids || []).map(id => charIdMap[id] || id);
                    }
                });

                // Narrative Handling: Process both legacy stubs and full narrative objects for DB storage
                // We need to prepare them for the DB
                story.narratives.forEach(n => {
                    // Ensure ID is unique/remapped (already handled by ID remapping logic previously applied)
                    // We generate a new ID to ensure this imported narrative doesn't overwrite an existing one
                    n.id = UTILITY.uuid();

                    // If this is a FULL narrative (has state), we must allow it to be passed 
                    // back to the controller to be saved to the 'narratives' store.
                    // However, LibraryController.handleFileUpload expects the story object 
                    // to contain the full narratives in the .narratives array so it can loop and save them.

                    // 1. Remap Active Character IDs
                    if (n.active_character_ids) {
                        n.active_character_ids = (n.active_character_ids || []).map(id => charIdMap[id] || id);
                    }

                    // 2. Remap Chat History Character IDs
                    if (n.state?.chat_history) {
                        remapHistory(n.state.chat_history);
                    }

                    // Ensure IDs are consistent
                    if (n.state?.static_entries) {
                        n.state.static_entries.forEach(e => e.id = UTILITY.uuid());
                    }
                });

                (story.dynamic_entries || []).forEach(e => e.id = UTILITY.uuid());

                return { story, imageBlob: null };
            },

            /**
             * Parses a V2 Character Card (PNG).
             * @param {File} file - The PNG file.
             * @param {boolean} skipImages - Whether to skip image processing.
             * @returns {Promise<Object>} - The parsed story object.
             * @private
             */
            async _parseV2Card(file, skipImages) {
                const arrayBuffer = await file.arrayBuffer();
                const v2DataString = await this._extractV2Data(arrayBuffer);
                if (!v2DataString) throw new Error("No character data found in PNG file.");
                const v2RawData = JSON.parse(this._b64_to_utf8(v2DataString));
                const v2Data = v2RawData.data || v2RawData;
                let imageBlob = null;
                if (!skipImages) imageBlob = await ImageProcessor.processImageAsBlob(file);
                return { story: this._convertV2toEllipsis(v2Data), imageBlob };
            },

            /**
             * Parses a BYAF ZIP file.
             * @param {File} file - The ZIP file.
             * @param {boolean} skipImages - Whether to skip image processing.
             * @returns {Promise<Object>} - The parsed story object.
             * @private
             */
            async _parseBYAF(file, skipImages) {
                const zip = await JSZip.loadAsync(file);
                const characterFile = zip.file(/character\.json$/i)[0];
                const scenarioFiles = zip.file(/scenario\d*\.json$/i);

                const imageFile = zip.file(/\.png$/i)[0];
                if (!characterFile) throw new Error("Archive is missing character.json.");

                const characterData = JSON.parse(await characterFile.async('string'));
                const scenariosData = [];

                if (scenarioFiles && scenarioFiles.length > 0) {
                    for (const f of scenarioFiles) {
                        try {
                            scenariosData.push(JSON.parse(await f.async('string')));
                        } catch (e) { console.warn("Failed to parse a scenario file", e); }
                    }
                }

                let imageBlob = null;
                if (!skipImages && imageFile) {
                    const imageFileBlob = await imageFile.async('blob');
                    imageBlob = await ImageProcessor.processImageAsBlob(imageFileBlob);
                }
                // Check for Background Image (BYAF Only)
                let backgroundImageBlob = null;
                const bgFile = zip.file("images/story_background.png");
                if (bgFile) {
                    try {
                        const bgData = await bgFile.async('blob');
                        backgroundImageBlob = await ImageProcessor.processImageAsBlob(bgData);
                    } catch (e) { console.warn("Failed to extract BYAF background:", e); }
                }

                return { story: this._convertBYAFtoEllipsis(characterData, scenariosData), imageBlob, backgroundImageBlob };
            },

            /**
             * Converts BYAF data to Ellipsis format.
             * @param {Object} byafData - The BYAF data.
             * @returns {Object} - The Ellipsis story object.
             * @private
             */
            _convertBYAFtoEllipsis(characterData, scenariosData) {
                const character = characterData;
                const story = this._createEmptyEllipsisStory();
                story.name = character.displayName || character.name || "Imported Character";
                story.tags = character.tags || [];

                const userChar = UTILITY.getDefaultUserCharacter();

                // Use first scenario for default model instructions match
                const firstScenarioRaw = (scenariosData && scenariosData.length > 0) ? scenariosData[0] : {};

                const aiChar = {
                    id: UTILITY.uuid(),
                    name: character.displayName || character.name,
                    description: character.persona || "",
                    short_description: UTILITY.truncateShortDescription(character.persona || ""),
                    model_instructions: firstScenarioRaw.formattingInstructions || "Write the next response from {character}, giving their speech and actions.",
                    image_url: '',
                    extra_portraits: [],
                    tags: character.tags || [],
                    is_user: false,
                    is_active: true,
                    is_narrator: false,
                    dynamic_knowledge: []
                };

                story.characters = [userChar, aiChar];
                const nameToId = {
                    'user': userChar.id,
                    'character': aiChar.id,
                    [userChar.name.toLowerCase()]: userChar.id,
                    [aiChar.name.toLowerCase()]: aiChar.id
                };

                // Helper to get or create character ID for a name
                const resolveCharacter = (name) => {
                    const lower = name.toLowerCase();
                    if (nameToId[lower]) return nameToId[lower];

                    const newId = UTILITY.uuid();
                    const newChar = {
                        id: newId, name: name, description: "Imported character.", short_description: "Imported.",
                        model_instructions: `Write the next response for ${name} giving their next actions and speech.`, image_url: '', tags: [], is_user: false, is_active: true, is_narrator: false,
                        dynamic_knowledge: []
                    };
                    story.characters.push(newChar);
                    nameToId[lower] = newId;
                    return newId;
                };

                /**
                 * Parses BYAF messages (both exampleMessages and narrative messages)
                 * @param {Array} msgs - The messages array
                 * @param {boolean} isHidden - Whether these are hidden example turns
                 * @returns {Array} - The parsed turns
                 */
                const parseMessages = (msgs, isHidden) => {
                    const output = [];
                    if (!msgs) return output;

                    msgs.forEach(msg => {
                        let content = "";
                        let charId = aiChar.id;

                        // 1. Extract content and determine speaker based on msg structure
                        if (msg.type === 'human') {
                            content = msg.text || "";
                            charId = userChar.id;
                        } else if (msg.type === 'ai') {
                            // Find the active output or use the last one
                            if (msg.outputs && msg.outputs.length > 0) {
                                let activeOutput = msg.outputs.find(o => o.activeTimestamp);
                                if (!activeOutput) activeOutput = msg.outputs[msg.outputs.length - 1];
                                content = activeOutput.text || "";
                            } else {
                                content = msg.text || "";
                            }
                            charId = aiChar.id;
                        } else {
                            // Standard message object (used in exampleMessages)
                            content = msg.text || "";
                            charId = aiChar.id; // Default to AI
                        }

                        // 2. Further refine speaker via name prefixes if present (common in multi-char stories)
                        const match = content.match(/^(.+?):/);
                        if (match) {
                            const foundName = match[1].trim();
                            if (foundName === '#{user}' || foundName === '{{user}}') {
                                charId = userChar.id;
                                content = content.substring(match[0].length).trim();
                            } else if (foundName === '#{character}' || foundName === '{{char}}') {
                                charId = aiChar.id;
                                content = content.substring(match[0].length).trim();
                            } else if (foundName.match(/^[a-zA-Z0-9_\s]{2,20}$/)) { // Heuristic: Looks like a name?
                                // Only process as name prefix if it's not starting with # or {
                                charId = resolveCharacter(foundName);
                                content = content.substring(match[0].length).trim();
                            }
                        }

                        // 3. Strip Trailing Prompts (common in BYAF/SillyTavern exports to prompt next speaker)
                        const trailingTokens = [
                            '#{user}:', '{{user}}:', '{{user}}', '#{character}:', '{{char}}:', '{{char}}',
                            '#You:', 'You:', '#{user}', '#{character}'
                        ];
                        // Also strip user character's specific name if it's a prompt
                        if (userChar.name) {
                            trailingTokens.push(`${userChar.name}:`, `#${userChar.name}:`);
                        }

                        let stripped = true;
                        while (stripped) {
                            stripped = false;
                            const trimmed = content.trim();
                            for (const token of trailingTokens) {
                                if (trimmed.endsWith(token)) {
                                    content = trimmed.slice(0, -token.length).trim();
                                    stripped = true;
                                    break;
                                }
                            }
                        }

                        if (content.trim()) {
                            output.push({
                                character_id: charId,
                                content: content,
                                type: 'chat',
                                emotion: 'neutral',
                                timestamp: msg.createdAt || new Date().toISOString(),
                                isHidden: isHidden
                            });
                        }
                    });
                    return output;
                };

                // De-duplication map for Scenarios
                const scenarioMessageToId = new Map();

                // Process Scenarios
                if (!scenariosData || scenariosData.length === 0) {
                    scenariosData = [{ title: "Default", prompt: "Interact with the character.", exampleMessages: [] }];
                }

                scenariosData.forEach((scenario, index) => {
                    const exampleDialogue = parseMessages(scenario.exampleMessages, true);
                    const staticEntries = [];
                    if (scenario.narrative) {
                        staticEntries.push({ id: UTILITY.uuid(), title: "Scenario Context", content: scenario.narrative });
                    }

                    const firstMes = (scenario.firstMessages && scenario.firstMessages[0]?.text) || `The story begins.`;

                    // SCENARIO DE-DUPLICATION:
                    // If we have seen this exact first message before, we associate the narrative with the existing scenario.
                    let scenarioId = scenarioMessageToId.get(firstMes);

                    if (!scenarioId) {
                        const newScenario = {
                            id: UTILITY.uuid(),
                            name: scenario.title || `Scenario ${index + 1}`,
                            message: firstMes,
                            active_character_ids: story.characters.map(c => c.id),
                            dynamic_entries: [],
                            example_dialogue: exampleDialogue,
                            static_entries: staticEntries,
                            worldMap: { grid: UTILITY.createDefaultMapGrid(), currentLocation: { x: 4, y: 4 }, destination: { x: null, y: null }, path: [] },
                            prompts: UTILITY.getDefaultSystemPrompts()
                        };
                        story.scenarios.push(newScenario);
                        scenarioId = newScenario.id;
                        scenarioMessageToId.set(firstMes, scenarioId);
                    }

                    // NARRATIVE CREATION (One per unique chat history)
                    const narrative = this._createEmptyEllipsisNarrative(scenario.title || "Imported Chat");
                    const activeScenario = story.scenarios.find(s => s.id === scenarioId);
                    narrative.active_character_ids = activeScenario.active_character_ids;

                    // 1. Initial Message
                    if (activeScenario.message) {
                        narrative.state.chat_history.push({
                            character_id: aiChar.id, content: activeScenario.message, type: 'chat',
                            emotion: 'neutral', timestamp: new Date().toISOString(), isHidden: false
                        });
                        narrative.state.messageCounter = 1;
                    }

                    // 2. Chat history from 'messages' array (Unique to Narrative)
                    if (scenario.messages && scenario.messages.length > 0) {
                        const history = parseMessages(scenario.messages, false);
                        history.forEach(turn => {
                            narrative.state.chat_history.push(turn);
                            narrative.state.messageCounter++;
                        });
                    }

                    narrative.state.static_entries = JSON.parse(JSON.stringify(activeScenario.static_entries));
                    story.narratives.push(narrative);
                });

                // Lore Items / Global Dynamic Entries
                if (character.loreItems) {
                    story.dynamic_entries = character.loreItems.map(item => ({
                        id: UTILITY.uuid(),
                        title: item.key || "Lore",
                        triggers: item.key || "",
                        content_fields: [item.value || ""],
                        current_index: 0,
                        triggered_at_turn: null
                    }));
                }

                return story;
            },

            /**
             * Converts V2 data to Ellipsis format.
             * @param {Object} v2Data - The V2 data.
             * @returns {Object} - The Ellipsis story object.
             * @private
             */
            _convertV2toEllipsis(v2Data) {
                const story = this._createEmptyEllipsisStory();
                story.name = v2Data.name || "Imported Character";
                story.tags = v2Data.tags || [];
                const userChar = UTILITY.getDefaultUserCharacter();
                const charName = v2Data.name || "Imported Character";
                const asPersona = t => String(t || "").replace(/{{char}}/g, charName).replace(/{{user}}/g, "{user}");

                // A card's "personality" is part of who the character is, and belongs with the
                // description — the same place SillyTavern puts it. It used to be dropped, so a
                // character arrived with half of themselves missing and nothing said so.
                const persona = [asPersona(v2Data.description), asPersona(v2Data.personality)]
                    .map(t => t.trim()).filter(Boolean).join('\n\n');

                let instructions = String(v2Data.system_prompt || "Write the next response for {character}. Be descriptive and engaging.")
                    .replace(/{{char}}/g, "{character}").replace(/{{user}}/g, "{user}");
                // A card's post-history instructions are its rules for how to write. Rolecraft has
                // no separate slot for them after the conversation, so they ride along with the
                // rest of the instructions rather than being thrown away.
                const postHistory = String(v2Data.post_history_instructions || "").trim();
                if (postHistory) {
                    instructions += `\n\n### Author's Rules\n${postHistory.replace(/{{char}}/g, "{character}").replace(/{{user}}/g, "{user}")}`;
                }

                const aiChar = {
                    id: UTILITY.uuid(),
                    name: charName,
                    ...UTILITY.getDefaultStorySettings(),
                    description: persona,
                    short_description: UTILITY.truncateShortDescription(persona),
                    model_instructions: instructions,
                    image_url: '',
                    extra_portraits: [],
                    tags: v2Data.tags || [],
                    is_user: false,
                    is_active: true,
                    is_narrator: false
                };

                // Who made the card, kept with the story rather than lost on the way in.
                if (v2Data.creator) story.card_creator = String(v2Data.creator);
                if (v2Data.character_version) story.card_version = String(v2Data.character_version);
                if (v2Data.creator_notes) story.creator_notes = String(v2Data.creator_notes);
                story.characters = [userChar, aiChar];
                const activeIDs = [userChar.id, aiChar.id];
                if (v2Data.character_book && v2Data.character_book.entries) {
                    story.dynamic_entries = v2Data.character_book.entries.map(entry => ({
                        id: UTILITY.uuid(),
                        title: (entry.keys || []).join(', ') || "Imported Lore",
                        triggers: (entry.keys || []).join(', '),
                        content_fields: [entry.content || ""],
                        current_index: 0,
                        triggered_at_turn: null
                    }));
                }
                const promptSnapshot = {
                    system_prompt: story.system_prompt,
                    event_master_base_prompt: story.event_master_base_prompt,
                    prompt_persona_gen: story.prompt_persona_gen,
                    prompt_living_persona_gen: story.prompt_living_persona_gen,
                    prompt_world_map_gen: story.prompt_world_map_gen,
                    prompt_location_gen: story.prompt_location_gen,
                    prompt_adjacent_locations_gen: story.prompt_adjacent_locations_gen,
                    prompt_entry_gen: story.prompt_entry_gen,
                    prompt_location_memory_gen: story.prompt_location_memory_gen,
                    font: story.font,
                    bubbleOpacity: story.bubbleOpacity,
                    chatTextColor: story.chatTextColor
                };
                const exampleDialogue = [];
                if (v2Data.mes_example) {
                    const charNameIdMap = { '{{user}}': userChar.id, '{{char}}': aiChar.id };
                    const regex = /({{user}}|{{char}}):([\s\S]*?)(?={{user}}:|{{char}}:|$)/g;
                    let cleanedText = v2Data.mes_example.replace(/<START>/gi, '').trim();

                    const formattedExample = cleanedText.replace(/{{char}}/gi, aiChar.name).replace(/{{user}}/gi, "{user}");
                    if (formattedExample) {
                        aiChar.model_instructions += `\n\n### Example Dialogue\n${formattedExample}`;
                    }

                    for (const match of cleanedText.matchAll(regex)) {
                        const speakerPrefix = match[1];
                        const messageContent = match[2].trim().replace(/{{char}}/g, aiChar.name).replace(/{{user}}/g, "{user}");
                        const speakerId = charNameIdMap[speakerPrefix];
                        if (speakerId && messageContent) {
                            exampleDialogue.push({
                                character_id: speakerId,
                                content: messageContent,
                                type: 'chat',
                                isHidden: true,
                                timestamp: new Date().toISOString()
                            });
                        }
                    }
                }
                const allGreetings = [v2Data.first_mes || `The story of ${aiChar.name} begins.`];
                if (Array.isArray(v2Data.alternate_greetings)) allGreetings.push(...v2Data.alternate_greetings);

                // NEW: Parse V2 Scenario into Static Entry
                const staticEntries = [];
                if (v2Data.scenario) {
                    staticEntries.push({
                        id: UTILITY.uuid(),
                        title: "Imported Scenario",
                        content: v2Data.scenario.replace(/{{char}}/g, aiChar.name).replace(/{{user}}/g, "{user}")
                    });
                }

                story.scenarios = [];
                allGreetings.forEach((greeting, index) => {
                    const scenarioName = index === 0 ? "Imported Start" : `Alternate Start ${index}`;
                    const messageContent = (greeting || "").replace(/{{char}}/g, aiChar.name).replace(/{{user}}/g, "{user}");
                    story.scenarios.push({
                        id: UTILITY.uuid(),
                        name: scenarioName,
                        message: messageContent,
                        active_character_ids: activeIDs,
                        dynamic_entries: JSON.parse(JSON.stringify(story.dynamic_entries)),
                        prompts: JSON.parse(JSON.stringify(promptSnapshot)),
                        example_dialogue: JSON.parse(JSON.stringify(exampleDialogue)),
                        static_entries: JSON.parse(JSON.stringify(staticEntries)),
                        worldMap: { grid: UTILITY.createDefaultMapGrid(), currentLocation: { x: 4, y: 4 }, destination: { x: null, y: null }, path: [] }
                    });
                });
                const narrative = this._createEmptyEllipsisNarrative("Imported Chat");
                narrative.active_character_ids = activeIDs;
                narrative.state.static_entries = JSON.parse(JSON.stringify(staticEntries));
                if (exampleDialogue.length > 0) narrative.state.chat_history.push(...JSON.parse(JSON.stringify(exampleDialogue)));
                const firstScenario = story.scenarios[0];
                if (firstScenario && firstScenario.message) {
                    narrative.state.chat_history.push({
                        character_id: aiChar.id,
                        content: firstScenario.message,
                        type: 'chat',
                        isHidden: false,
                        timestamp: new Date().toISOString()
                    });
                    narrative.state.messageCounter = 1;
                }
                story.narratives.push(narrative);
                return story;
            },

            /**
             * Converts Ellipsis format to V2 data.
             * @param {Object} story - The story object.
             * @param {Object} narrative - The narrative object.
             * @param {string} primaryCharId - The ID of the primary character.
             * @returns {Object} - The V2 data object.
             * @private
             */
            _convertEllipsistoV2(story, narrative, primaryCharId) {
                const primaryChar = story.characters.find(c => c.id === primaryCharId);
                const activeIDs = narrative.active_character_ids || story.characters.map(c => c.id);
                const otherAiChars = story.characters.filter(c => !c.is_user && c.id !== primaryCharId && activeIDs.includes(c.id));
                if (!primaryChar) throw new Error("Primary character not found.");
                let fullDescription = primaryChar.description || "";
                if (otherAiChars.length > 0) {
                    fullDescription += "\n\n--- Other Characters ---\n";
                    otherAiChars.forEach(char => {
                        fullDescription += `\nName: ${char.name || 'Unnamed Character'}\nDescription: ${char.description || '(No description)'}\n`;
                    });
                }
                const bookEntries = [];
                let insertionCounter = 0;
                (story.dynamic_entries || []).forEach(entry => {
                    // Lore text lives in content_fields, a list of stages. This used to read
                    // entry.content, a field these never have, so every exported card carried a
                    // lorebook of correctly-named entries with nothing written in them.
                    const text = Array.isArray(entry.content_fields)
                        ? entry.content_fields.filter(Boolean).join('\n\n')
                        : (entry.content || "");
                    bookEntries.push({
                        keys: (entry.triggers || entry.title || "").split(',').map(t => t.trim()).filter(Boolean),
                        content: text,
                        enabled: true, insertion_order: insertionCounter++, extensions: {}, case_sensitive: false,
                    });
                });
                (narrative.state.worldMap?.grid || []).filter(loc => loc.name).forEach(loc => {
                    bookEntries.push({
                        keys: [loc.name],
                        content: `Location Description: ${loc.description || '(No description)'}\n\nLocation Prompt: ${loc.prompt || '(No prompt)'}`,
                        enabled: true, insertion_order: insertionCounter++, extensions: {}, case_sensitive: false,
                    });
                });
                const currentLocCoords = narrative.state.worldMap?.currentLocation;
                if (currentLocCoords) {
                    const currentLocData = narrative.state.worldMap.grid.find(l => l.coords.x === currentLocCoords.x && l.coords.y === currentLocCoords.y);
                    if (currentLocData && currentLocData.local_static_entries) {
                        currentLocData.local_static_entries.forEach(entry => {
                            bookEntries.push({
                                keys: [(entry.title || "Local Lore").toLowerCase()],
                                content: entry.content || "",
                                enabled: true, insertion_order: insertionCounter++, extensions: {}, case_sensitive: false,
                            });
                        });
                    }
                }
                const replacePlaceholdersV2 = (text) => {
                    if (typeof text !== 'string') return '';
                    let processed = text.replace(/{character}/gi, '{{char}}');
                    processed = processed.replace(/{user}/gi, '{{user}}');
                    processed = processed.replace(/\{\{char\}\}/gi, '{{char}}');
                    processed = processed.replace(/\{\{user\}\}/gi, '{{user}}');
                    return processed;
                }
                const mesExample = (narrative.state.chat_history || []).filter(m => m.isHidden && m.type === 'chat').map(m => {
                    const speaker = story.characters.find(c => c.id === m.character_id);
                    if (speaker) {
                        const prefix = speaker.is_user ? '{{user}}:' : '{{char}}:';
                        return `${prefix}\n${replacePlaceholdersV2(m.content)}`;
                    }
                    return replacePlaceholdersV2(m.content);
                }).join('\n');
                const firstMessageEntry = (narrative.state.chat_history || []).find(m => !m.isHidden && m.type === 'chat');
                const firstMes = firstMessageEntry ? replacePlaceholdersV2(firstMessageEntry.content) : replacePlaceholdersV2(`The story of ${primaryChar.name} begins.`);
                const scenarioText = (narrative.state.static_entries || []).map(entry => `[${entry.title || 'Untitled Entry'}]\n${entry.content || '(No content)'}`).join('\n\n---\n\n');
                const v2Data = {
                    name: primaryChar.name || "",
                    description: replacePlaceholdersV2(fullDescription),
                    personality: "",
                    scenario: replacePlaceholdersV2(scenarioText),
                    first_mes: firstMes,
                    mes_example: mesExample,
                    creator_notes: story.creator_notes || "",
                    system_prompt: replacePlaceholdersV2(primaryChar.model_instructions || ""),
                    post_history_instructions: "",
                    // The story's other openings. A card importer offers these as alternative
                    // first messages; this used to always send an empty list, so every extra
                    // opening a story had was left behind when the card was shared.
                    alternate_greetings: (story.scenarios || [])
                        .map(s => s && s.message)
                        .filter(m => typeof m === 'string' && m.trim() && replacePlaceholdersV2(m) !== firstMes)
                        .map(m => replacePlaceholdersV2(m)),
                    character_book: {
                        name: "", description: "", scan_depth: 100, token_budget: 2048, recursive_scanning: false, extensions: {}, entries: bookEntries
                    },
                    tags: primaryChar.tags || [],
                    creator: story.card_creator || "", character_version: story.card_version || "", extensions: {}
                };
                return { spec: 'chara_card_v2', spec_version: '2.0', data: v2Data };
            },

            /**
             * Converts Ellipsis format to BYAF data.
             * @param {Object} story - The story object.
             * @param {Object} narrative - The narrative object.
             * @param {string} primaryCharId - The ID of the primary character.
             * @param {string} [imageFilename=null] - The filename of the character image.
             * @returns {Object} - The BYAF data object.
             * @private
             */
            /**
             * Converts Ellipsis format to BYAF data.
             * @param {Object} story - The story object.
             * @param {Object} narrative - The narrative object.
             * @param {string} primaryCharId - The ID of the primary character.
             * @param {string} [imageFilename=null] - The filename of the character image.
             * @returns {Object} - The BYAF data object.
             * @private
             */
            /**
             * Converts an Ellipsis story object to the BYAF (Backyard AI Format) structure.
             * @param {Object} story - The story object.
             * @param {Object} narrative - The narrative object.
             * @param {string} primaryCharId - The ID of the primary character.
             * @param {string|null} [imageFilename=null] - Optional filename for the character image.
             * @returns {Object} The BYAF manifest, character, and scenario objects.
             * @private
             */
            _convertEllipsistoBYAF(story, narrative, primaryCharId, imageFilename = null) {
                const primaryChar = story.characters.find(c => c.id === primaryCharId);
                if (!primaryChar) return { manifest: {}, character: {}, scenario: {} };
                const now = new Date().toISOString();
                const loreItems = [
                    ...(story.dynamic_entries || []),
                    ...(narrative.state.worldMap?.grid || []).filter(loc => loc.name).map(loc => ({
                        id: UTILITY.uuid(), title: loc.name, triggers: loc.name, content: `Description: ${loc.description || '(no description)'}\n\nPrompt: ${loc.prompt || '(no prompt)'}`
                    }))
                ].map((entry, index) => ({
                    id: entry.id || UTILITY.uuid(),
                    order: Math.random().toString(36).substring(2, 12),
                    key: entry.triggers || entry.title || `Imported Lore ${index + 1}`,
                    value: entry.content || "",
                    createdAt: entry.created_date || now,
                    updatedAt: entry.last_modified || now
                }));
                const character = {
                    schemaVersion: 1, name: primaryChar.name || "", displayName: primaryChar.name || "",
                    images: imageFilename ? [{ path: `images/${imageFilename}`, label: "" }] : [],
                    createdAt: primaryChar.created_date || now, updatedAt: primaryChar.last_modified || now,
                    id: primaryChar.id, isNSFW: false, persona: primaryChar.description || "", loreItems: loreItems, tags: primaryChar.tags || []
                };
                const firstMessageEntry = (narrative.state.chat_history || []).find(m => !m.isHidden && m.type === 'chat');
                const firstMessageText = firstMessageEntry ? firstMessageEntry.content : `The story of ${primaryChar.name} begins.`;
                const exampleMessages = (narrative.state.chat_history || []).filter(m => m.isHidden && m.type === 'chat').map(m => {
                    const speaker = story.characters.find(c => c.id === m.character_id);
                    let byafFormattedText = m.content || "";
                    let msgCharId = null;
                    if (speaker) {
                        if (speaker.is_user) {
                            byafFormattedText = `#{user}:\n${byafFormattedText}`;
                        } else if (speaker.id === primaryChar.id) {
                            byafFormattedText = `#{character}:\n${byafFormattedText}`;
                            msgCharId = primaryChar.id;
                        }
                    }
                    return { text: byafFormattedText, characterID: msgCharId };
                });
                const scenario = {
                    schemaVersion: 1, title: narrative.name || "Exported Scenario", canDeleteExampleMessages: true, exampleMessages: exampleMessages,
                    model: "", temperature: 1.0, topP: 0.9, minP: 0.1,
                    firstMessages: [{ text: firstMessageText, characterID: primaryChar.id }],
                    formattingInstructions: primaryChar.model_instructions || "", grammar: "", repeatPenalty: 1.05, repeatLastN: 256, topK: 30, minPEnabled: false,
                    narrative: (narrative.state.static_entries || []).map(e => e.content).join('\n\n'),
                    promptTemplate: null, messages: []
                };
                const manifest = {
                    schemaVersion: 1, createdAt: now, characters: [`characters/${primaryChar.id}/character.json`], scenarios: [`scenarios/scenario1.json`]
                };
                return { manifest, character, scenario };
            },

            /**
             * Creates an empty Ellipsis story object.
             * @returns {Object}
             * @private
             */
            _createEmptyEllipsisStory() {
                return {
                    id: UTILITY.uuid(), name: "New Imported Story", last_modified: new Date().toISOString(), created_date: new Date().toISOString(),
                    ...UTILITY.getDefaultApiSettings(), ...UTILITY.getDefaultUiSettings(), ...UTILITY.getDefaultSystemPrompts(),
                    characters: [], dynamic_entries: [], scenarios: [], narratives: []
                };
            },

            /**
             * Creates an empty Ellipsis narrative object.
             * @param {string} name - The narrative name.
             * @returns {Object}
             * @private
             */
            _createEmptyEllipsisNarrative(name) {
                return {
                    id: UTILITY.uuid(), name: name, last_modified: new Date().toISOString(),
                    state: {
                        chat_history: [], messageCounter: 0, static_entries: [],
                        narrative_timeline: [], relationship_matrix: [], journal_entries: [],
                        worldMap: { grid: UTILITY.createDefaultMapGrid(), currentLocation: { x: 4, y: 4 }, destination: { x: null, y: null }, path: [] },
                        gameState: {
                            resources: [],
                            relationships: [],
                            journal: []
                        },
                        livingPersonaCounters: {}, evolved_characters: {},
                        gm_rules: [],
                        gm_ledger: [],
                        knowledge_revisions: [],
                        swarmMode: false, swarmNarrativeCapital: {}, swarmSecrets: {}, swarmLastIntents: {}
                    }
                };
            },

            _b64_to_utf8(str) { return decodeURIComponent(escape(atob(str))); },
            _utf8_to_b64(str) { return btoa(unescape(encodeURIComponent(str))); },

            /**
             * Extracts V2 data from a PNG buffer.
             * @param {ArrayBuffer} arrayBuffer - The PNG buffer.
             * @returns {Promise<string|null>} - The extracted data string or null.
             * @private
             */
            async _extractV2Data(arrayBuffer) {
                const dataView = new DataView(arrayBuffer);
                const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
                for (let i = 0; i < PNG_SIGNATURE.length; i++) { if (dataView.getUint8(i) !== PNG_SIGNATURE[i]) throw new Error("Invalid PNG signature."); }
                let offset = 8;
                while (offset < arrayBuffer.byteLength) {
                    const length = dataView.getUint32(offset);
                    const type = String.fromCharCode.apply(null, new Uint8Array(arrayBuffer, offset + 4, 4));
                    if (['tEXt', 'zTXt'].includes(type)) {
                        let keywordEnd = -1;
                        for (let i = 0; i < length; i++) { if (dataView.getUint8(offset + 8 + i) === 0) { keywordEnd = i; break; } }
                        if (keywordEnd !== -1) {
                            const keyword = new TextDecoder().decode(new Uint8Array(arrayBuffer, offset + 8, keywordEnd));
                            if (keyword === 'chara') {
                                if (type === 'tEXt') return new TextDecoder().decode(new Uint8Array(arrayBuffer, offset + 8 + keywordEnd + 1, length - keywordEnd - 1));
                                if (type === 'zTXt') return new TextDecoder().decode(pako.inflate(new Uint8Array(arrayBuffer, offset + 8 + keywordEnd + 2, length - keywordEnd - 2)));
                            }
                        }
                    }
                    if (type === 'IEND') break;
                    offset += 12 + length;
                }
                return null;
            },

            /**
             * Injects V2 data into a PNG buffer.
             * @param {ArrayBuffer} imageBuffer - The source PNG buffer.
             * @param {Object} v2Object - The V2 data object.
             * @returns {Promise<Uint8Array>} - The new PNG buffer.
             * @private
             */
            async _injectDataIntoPng(imageBuffer, v2Object) {
                const _CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); return c; });
                const _crc32 = (bytes) => { let crc = -1; for (const byte of bytes) crc = (crc >>> 8) ^ _CRC_TABLE[(crc ^ byte) & 0xff]; return (crc ^ -1) >>> 0; };
                const jsonDataString = JSON.stringify(v2Object);
                const base64Data = this._utf8_to_b64(jsonDataString);
                const base64Bytes = new TextEncoder().encode(base64Data);
                const compressedData = pako.deflate(base64Bytes);
                const keyword = 'chara';
                const keywordBytes = new TextEncoder().encode(keyword);
                const chunkData = new Uint8Array(keywordBytes.length + 1 + 1 + compressedData.length);
                chunkData.set(keywordBytes);
                chunkData[keywordBytes.length] = 0;
                chunkData[keywordBytes.length + 1] = 0;
                chunkData.set(compressedData, keywordBytes.length + 2);
                const chunkType = new TextEncoder().encode('zTXt');
                const dataForCrc = new Uint8Array(chunkType.length + chunkData.length);
                dataForCrc.set(chunkType);
                dataForCrc.set(chunkData, chunkType.length);
                const crc = _crc32(dataForCrc);
                const originalPng = new Uint8Array(imageBuffer);
                const dataView = new DataView(originalPng.buffer);
                let iendOffset = -1;
                let offset = 8;
                while (offset < originalPng.length) {
                    const length = dataView.getUint32(offset);
                    const type = String.fromCharCode.apply(null, originalPng.slice(offset + 4, offset + 8));
                    if (type === 'IEND') {
                        iendOffset = offset;
                        break;
                    }
                    offset += 12 + length;
                }
                if (iendOffset === -1) throw new Error('Could not find IEND chunk.');
                const newChunkLength = chunkData.length;
                const newPngSize = iendOffset + (12 + newChunkLength) + 12;
                const newPng = new Uint8Array(newPngSize);
                const newPngView = new DataView(newPng.buffer);
                newPng.set(originalPng.slice(0, iendOffset));
                let writeOffset = iendOffset;
                newPngView.setUint32(writeOffset, newChunkLength);
                writeOffset += 4;
                newPng.set(chunkType, writeOffset);
                writeOffset += chunkType.length;
                newPng.set(chunkData, writeOffset);
                writeOffset += chunkData.length;
                newPngView.setUint32(writeOffset, crc);
                writeOffset += 4;
                newPng.set(originalPng.slice(iendOffset, iendOffset + 12), writeOffset);
                return new Blob([newPng], { type: 'image/png' });
            }
        };
