        /**
         * =================================================================================================
         * [SEC:JS:CTRL:WLD]
         * WorldController
         * Manages game state related to the world map, movement, and location-based triggers.
         * =================================================================================================
         */
        const WorldController = {
            RUNTIME: {
                activeWorldMapTab: 'move',
                selectedMapTile: null,
                pendingMove: null,
                turnOfArrival: 0,
                selectedLocalStaticEntryId: null,
                activeStaticCategoryFilter: 'all',
                generatingTiles: new Set(),
                generatingImages: new Set()
            },

            // --- World Map Navigation ---

            /**
             * Switches the active tab in the World Map modal.
             * @param {string} tabName - 'move' or 'edit'.
             */
            switchWorldMapTab(tabName) {
                this.RUNTIME.activeWorldMapTab = tabName;
                UIManager.renderWorldMapModal();
            },

            /**
             * Switches the active category filter for static entries (lore).
             * @param {string} cat - 'all', 'event', 'character', 'item', 'world', 'relationship'
             */
            switchStaticCategoryFilter(cat) {
                this.RUNTIME.activeStaticCategoryFilter = cat;
                UIManager.renderStaticEntries();
            },



            /**
             * Toggles location specific characters generation on or off.
             * @param {boolean} enabled - True to enable, false to disable.
             */
            toggleLocationCharacters(enabled) {
                ReactiveStore.state.enableLocationCharacters = enabled;
            },

            toggleAutoBuildLocations(enabled) {
                ReactiveStore.state.enableAutoBuildLocations = enabled;
                if (enabled) {
                    const state = ReactiveStore.state;
                    if (state.worldMap && state.worldMap.currentLocation) {
                        this.checkAndGenerateAdjacentLocations(state.worldMap.currentLocation.x, state.worldMap.currentLocation.y);
                    }
                }
            },

            /**
             * Toggles automatic background image generation for visited locations.
             * @param {boolean} enabled - True to enable, false to disable.
             */
            toggleAutoGenerateLocationImages(enabled) {
                ReactiveStore.state.enableAutoGenerateLocationImages = enabled;
                if (enabled) {
                    const state = ReactiveStore.state;
                    if (state.worldMap && state.worldMap.currentLocation) {
                        const cur = state.worldMap.currentLocation;
                        const location = state.worldMap.grid.find(l => l.coords.x === cur.x && l.coords.y === cur.y);
                        if (location && !location.imageUrl) {
                            this.generateLocationImage(location).catch(err => {
                                console.error('[Auto-Image] Failed to generate image for current location:', err);
                            });
                        }
                    }
                }
            },

            /**
             * Generates and saves a background image for a location using its prompt/description.
             * Tracks the operation in RUNTIME.generatingImages and updates the map UI on completion.
             * @param {Object} location - The location object from the world map grid.
             */
            async generateLocationImage(location) {
                if (!location) return;
                const imgKey = `location::${location.coords.x},${location.coords.y}`;

                // Prevent duplicate concurrent requests for the same tile
                if (this.RUNTIME.generatingImages.has(imgKey)) {
                    console.log(`[Auto-Image] Already generating image for ${imgKey}. Skipping.`);
                    return;
                }

                // Check Image Generation Service is available
                if (typeof ImageGenerationService === 'undefined') {
                    console.warn('[Auto-Image] ImageGenerationService is not available. Is an image endpoint configured?');
                    return;
                }

                console.log(`[Auto-Image] Starting background image generation for: ${location.name || imgKey}`);
                this.RUNTIME.generatingImages.add(imgKey);

                // Trigger map re-render to show "Painting..." indicator immediately
                if (typeof UIManager !== 'undefined') {
                    UIManager.renderWorldMapModal();
                }

                try {
                    // Build a descriptive image prompt from the location data
                    const promptContent = (location.prompt || '').trim() || (location.description || '').trim();
                    const imagePrompt = `Fantasy landscape, environment art. Location: ${location.name || 'Unnamed Area'}. ${promptContent}`.substring(0, 500);
                    const negativePrompt = 'people, characters, faces, persons, figure, text, watermark, low quality, blurry, distorted, nsfw, nude';

                    // Use landscape dimensions (wider than tall)
                    const globalSettings = StateManager.data.globalSettings;
                    const width = globalSettings.imageGenWidth || 768;
                    const height = Math.round((globalSettings.imageGenHeight || 512) * 0.65) || 340;

                    const blob = await ImageGenerationService.generateImage(imagePrompt, negativePrompt, { width, height });

                    if (!blob) {
                        console.warn(`[Auto-Image] No image blob returned for: ${location.name}`);
                        return;
                    }

                    // Save to IndexedDB
                    await DBService.saveImage(imgKey, blob);

                    // Cache the Object URL in UIManager
                    UIManager.RUNTIME.worldImageCache = UIManager.RUNTIME.worldImageCache || {};
                    if (UIManager.RUNTIME.worldImageCache[imgKey]) URL.revokeObjectURL(UIManager.RUNTIME.worldImageCache[imgKey]);
                    UIManager.RUNTIME.worldImageCache[imgKey] = URL.createObjectURL(blob);

                    // Update the reactive grid entry
                    const state = ReactiveStore.state;
                    const reactiveLoc = state.worldMap.grid.find(l => l.coords.x === location.coords.x && l.coords.y === location.coords.y);
                    if (reactiveLoc) {
                        reactiveLoc.imageUrl = `local_idb_${imgKey}`;
                    }

                    // Persist to IndexedDB
                    await ReactiveStore.forceSave();

                    console.log(`[Auto-Image] Image saved for: ${location.name || imgKey}`);

                    // Update the UI
                    if (typeof UIManager !== 'undefined') {
                        UIManager.applyStyling();
                        UIManager.renderWorldMapModal();
                    }

                } catch (e) {
                    console.error(`[Auto-Image] Error generating image for ${location.name || imgKey}:`, e);
                } finally {
                    this.RUNTIME.generatingImages.delete(imgKey);
                    if (typeof UIManager !== 'undefined') {
                        UIManager.renderWorldMapModal();
                    }
                }
            },

            /**
             * Checks if any adjacent locations to the current coordinates are empty,
             * and initiates batch generation for them if enableAutoBuildLocations is true.
             * @param {number} currentX
             * @param {number} currentY
             */
            async checkAndGenerateAdjacentLocations(currentX, currentY) {
                const state = ReactiveStore.state;
                if (!state.enableAutoBuildLocations) return;

                const emptyAdjacentCoords = [];
                // Check surrounding 3x3 tiles
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = currentX + dx;
                        const ny = currentY + dy;
                        if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8) {
                            const loc = state.worldMap.grid.find(l => l.coords.x === nx && l.coords.y === ny);
                            if (loc) {
                                const hasName = loc.name && loc.name.trim() !== "" && loc.name !== "Undefined";
                                const hasDesc = loc.description && loc.description.trim() !== "";
                                if (!hasName && !hasDesc) {
                                    // Make sure we are not already generating this coordinate
                                    if (!this.RUNTIME.generatingTiles.has(`${nx},${ny}`)) {
                                        emptyAdjacentCoords.push({ x: nx, y: ny });
                                    }
                                }
                            }
                        }
                    }
                }

                if (emptyAdjacentCoords.length === 0) return;

                console.log(`[Auto-Build] Found ${emptyAdjacentCoords.length} empty adjacent locations. Starting background generation...`);

                if (typeof UIManager !== 'undefined' && UIManager.showNotification) {
                    UIManager.showNotification(`Auto-building ${emptyAdjacentCoords.length} adjacent locations...`, 'info');
                }

                // Call the generation method asynchronously (don't block the user's move)
                this.generateAdjacentLocations(emptyAdjacentCoords).catch(err => {
                    console.error("[Auto-Build] Failed to generate adjacent locations:", err);
                });
            },

            /**
             * Generates blank adjacent locations on the fly.
             * @param {Array<Object>} emptyCoords - Coordinates to generate locations for.
             */
            async generateAdjacentLocations(emptyCoords) {
                if (!emptyCoords || emptyCoords.length === 0) return;
                const state = ReactiveStore.state;
                const startMsgId = UTILITY.uuid();

                // 1. Mark tiles as generating
                emptyCoords.forEach(coord => {
                    this.RUNTIME.generatingTiles.add(`${coord.x},${coord.y}`);
                });

                if (typeof UIManager !== 'undefined') {
                    UIManager.renderWorldMapModal();
                }

                // 2. Add System Message indicating progress
                if (typeof NarrativeController !== 'undefined') {
                    state.chat_history.push({
                        id: startMsgId,
                        type: 'system_event',
                        content: `System: Auto-building ${emptyCoords.length} adjacent locations in the background...`,
                        timestamp: new Date().toISOString(),
                        isNew: true
                    });
                    if (typeof UIManager !== 'undefined') {
                        UIManager.renderChat();
                    }
                }

                // Chunk coordinates in batches of max 3 to prevent timeouts on slower/local backends
                const chunkSize = 3;
                const chunks = [];
                for (let i = 0; i < emptyCoords.length; i += chunkSize) {
                    chunks.push(emptyCoords.slice(i, i + chunkSize));
                }

                let totalUpdated = 0;
                const allGeneratedNames = [];
                let hasFailure = false;

                try {
                    for (let batchIdx = 0; batchIdx < chunks.length; batchIdx++) {
                        const batch = chunks[batchIdx];
                        console.log(`[Auto-Build] Processing batch ${batchIdx + 1}/${chunks.length} with ${batch.length} coords...`);

                        try {
                            const prompt = PromptBuilder.buildAdjacentLocationsPrompt(state, batch, state);
                            const jsonResponse = await APIService.callAI(prompt, true);
                            const responseObj = UTILITY.extractAndParseJSON(jsonResponse);

                            let locationsArray = null;
                            if (responseObj && typeof responseObj === 'object') {
                                if (Array.isArray(responseObj.locations)) {
                                    locationsArray = responseObj.locations;
                                } else if (Array.isArray(responseObj)) {
                                    locationsArray = responseObj;
                                }
                            }

                            if (!locationsArray || locationsArray.length === 0) {
                                console.warn(`[Auto-Build] Batch ${batchIdx + 1} received empty or invalid response from AI.`);
                                hasFailure = true;
                                continue;
                            }

                            let batchUpdatedCount = 0;
                            for (const generatedLoc of locationsArray) {
                                if (!generatedLoc.coords || generatedLoc.coords.x === undefined || generatedLoc.coords.y === undefined) continue;
                                const targetLoc = state.worldMap.grid.find(l => l.coords.x === generatedLoc.coords.x && l.coords.y === generatedLoc.coords.y);
                                if (targetLoc) {
                                    // Only update if it is still empty (to prevent overwriting if user manually edited it in the meantime)
                                    const hasName = targetLoc.name && targetLoc.name.trim() !== "" && targetLoc.name !== "Undefined";
                                    const hasDesc = targetLoc.description && targetLoc.description.trim() !== "";
                                    if (!hasName && !hasDesc) {
                                        targetLoc.name = generatedLoc.name || "Unnamed Area";
                                        targetLoc.description = generatedLoc.description || "";
                                        targetLoc.prompt = generatedLoc.prompt || "";
                                        targetLoc.local_static_entries = generatedLoc.local_static_entries || [];
                                        targetLoc.characters = generatedLoc.characters || [];
                                        batchUpdatedCount++;
                                        allGeneratedNames.push(targetLoc.name);

                                        // Trigger NPCs generation if toggle is enabled and location does not have NPCs
                                        if (state.enableLocationCharacters !== false) {
                                            this.generateLocationCharacters(targetLoc, true).catch(err => {
                                                console.error(`[Auto-Build] Failed to generate characters for location: ${targetLoc.name}`, err);
                                            });
                                        }
                                    }
                                }
                            }

                            if (batchUpdatedCount > 0) {
                                totalUpdated += batchUpdatedCount;
                                // Force save immediately to persist changes to IndexedDB
                                await ReactiveStore.forceSave();

                                // Update system message and re-render map incrementally
                                const chatMsg = state.chat_history.find(m => m.id === startMsgId);
                                if (chatMsg) {
                                    chatMsg.content = `System: Auto-building adjacent locations (${allGeneratedNames.length}/${emptyCoords.length} built)...`;
                                }
                                if (typeof UIManager !== 'undefined') {
                                    UIManager.renderChat();
                                    UIManager.renderWorldMapModal();
                                }
                            }
                        } catch (err) {
                            console.error(`[Auto-Build] Error in batch ${batchIdx + 1}:`, err);
                            hasFailure = true;
                        } finally {
                            // Clear generated status for this batch's tiles immediately
                            batch.forEach(coord => {
                                this.RUNTIME.generatingTiles.delete(`${coord.x},${coord.y}`);
                            });
                            if (typeof UIManager !== 'undefined') {
                                UIManager.renderWorldMapModal();
                            }
                        }
                    }

                    // Finalizing system message and notifications
                    const chatMsg = state.chat_history.find(m => m.id === startMsgId);
                    if (totalUpdated > 0) {
                        if (chatMsg) {
                            if (hasFailure) {
                                chatMsg.content = `System: Generated adjacent locations (partial success): ${allGeneratedNames.join(', ')}`;
                            } else {
                                chatMsg.content = `System: Generated adjacent locations: ${allGeneratedNames.join(', ')}`;
                            }
                        }
                        if (typeof UIManager !== 'undefined') {
                            UIManager.renderChat();
                            if (UIManager.showNotification) {
                                UIManager.showNotification(`Successfully auto-built ${totalUpdated} locations!`, 'success');
                            }
                        }
                    } else {
                        if (chatMsg) {
                            chatMsg.content = `System: Failed to auto-build adjacent locations.`;
                        }
                        if (typeof UIManager !== 'undefined') {
                            UIManager.renderChat();
                        }
                    }

                } catch (e) {
                    console.error("[Auto-Build] Global error in generateAdjacentLocations:", e);
                    const chatMsg = state.chat_history.find(m => m.id === startMsgId);
                    if (chatMsg) {
                        chatMsg.content = `System: Failed to auto-build adjacent locations.`;
                    }
                    if (typeof UIManager !== 'undefined') {
                        UIManager.renderChat();
                    }
                } finally {
                    // Safety clean up of all tiles in this request
                    emptyCoords.forEach(coord => {
                        this.RUNTIME.generatingTiles.delete(`${coord.x},${coord.y}`);
                    });
                    if (typeof UIManager !== 'undefined') {
                        UIManager.renderWorldMapModal();
                    }
                }
            },

            /**
             * Generates location-specific characters for a given location using the AI.
             * @param {Object} location - The location object from the world map grid.
             * @param {boolean} skipIfExisting - Whether to abort if the location already has characters.
             */
            async generateLocationCharacters(location, skipIfExisting = true) {
                if (!location) return;
                const state = ReactiveStore.state;

                console.log(`[Location NPCs] Triggered for location: ${location.name || 'Unnamed tile'}. Skip if existing: ${skipIfExisting}`);

                if (skipIfExisting && location.characters && location.characters.length > 0) {
                    console.log(`[Location NPCs] Location already has ${location.characters.length} characters. Skipping.`);
                    return;
                }

                try {
                    console.log(`[Location NPCs] Calling API to generate 3 characters for: ${location.name}`);
                    const prompt = PromptBuilder.buildLocationCharactersPrompt(location.name, location.description || "");
                    const jsonResponse = await APIService.callAI(prompt, true);
                    console.log(`[Location NPCs] Received API response payload. Attempting to parse JSON...`);

                    const characters = UTILITY.extractAndParseJSON(jsonResponse);

                    // Sometimes LLMs wrap it in an object like { "characters": [...] } instead of raw array
                    let charArray = characters;
                    if (characters && typeof characters === 'object' && !Array.isArray(characters) && Array.isArray(characters.characters)) {
                        charArray = characters.characters;
                    }

                    if (Array.isArray(charArray) && charArray.length > 0) {
                        location.characters = charArray.map(char => ({
                            ...char,
                            id: UTILITY.uuid(),
                            is_location_character: true,
                            is_active: true
                        }));
                        console.log(`[Location NPCs] Success! Generated ${charArray.length} location characters for ${location.name}.`);
                        console.log(`[Location NPCs] Characters Created:`);
                        location.characters.forEach((c, idx) => {
                            console.log(`  ${idx + 1}. Name: ${c.name} | Role: ${c.role || c.short_description || 'Unknown'} | Goal: ${c.personal_goal || 'None'}`);
                        });

                        // Provide initial image tracking keys before firing the parallel generation
                        location.characters.forEach(char => {
                            char.image_url = `local_idb_${char.id}`;
                        });

                        // Force an initial re-render to show the cards with loading/default avatars
                        if (typeof UIManager !== 'undefined' && state.worldMap.currentLocation.x === location.coords.x && state.worldMap.currentLocation.y === location.coords.y) {
                            UIManager.renderCharacters();
                        }

                        // Fire Async Image Generation Loop
                        setTimeout(async () => {
                            for (const char of location.characters) {
                                try {
                                    if (typeof ImageGenerationService === 'undefined') continue;
                                    console.log(`[Location NPCs] 🎨 Requesting image generation for: ${char.name}`);
                                    const imagePrompt = `Portrait of a fantasy character. ${char.physical_description}`;
                                    const blob = await ImageGenerationService.generateImage(imagePrompt, "text, signature, watermark, multiple people, full body");

                                    if (blob) {
                                        await DBService.saveImage(char.id, blob);
                                        UIManager.RUNTIME.characterImageCache[char.id] = URL.createObjectURL(blob);
                                        console.log(`[Location NPCs] 🖼️ Saved image to indexedDB for: ${char.name}`);
                                        // Try to softly re-render again if they are still on this tile
                                        if (state.worldMap.currentLocation.x === location.coords.x && state.worldMap.currentLocation.y === location.coords.y) {
                                            UIManager.renderCharacters();
                                        }
                                    }
                                } catch (imgErr) {
                                    console.error(`[Location NPCs] Image gen failed for ${char.name}`, imgErr);
                                }
                            }
                        }, 500); // 500ms delay to let the UI breathe

                    } else {
                        console.warn(`[Location NPCs] Failed to parse an array of characters. Parsed data:`, characters);
                    }
                } catch (e) {
                    console.error("[Location NPCs] Exception during character generation:", e);
                }
            },

            /**
             * Selects a tile for a pending move operation.
             * @param {number} x - The x-coordinate.
             * @param {number} y - The y-coordinate.
             */
            selectPendingMove(x, y) {
                this.RUNTIME.pendingMove = { x, y };
                UIManager.renderWorldMapModal();
            },

            /**
             * Confirms and executes the pending move.
             */
            confirmMove() {
                const state = ReactiveStore.state;
                const { pendingMove } = this.RUNTIME;
                const { currentLocation } = state.worldMap;

                if (pendingMove && (pendingMove.x !== currentLocation.x || pendingMove.y !== currentLocation.y)) {
                    this.moveToLocation(pendingMove.x, pendingMove.y);
                }

                this.RUNTIME.pendingMove = null;
                AppController.closeModal('world-map-modal');
            },

            /**
             * Moves the party to a specific location.
             * Updates state, path, background, and triggers AI response.
             * @param {number} x - The x-coordinate.
             * @param {number} y - The y-coordinate.
             */
            moveToLocation(x, y) {
                const state = ReactiveStore.state;
                const targetLocation = state.worldMap.grid.find(loc => loc.coords.x === x && loc.coords.y === y);

                if (targetLocation) {
                    const previousLocationCoords = { ...state.worldMap.currentLocation };
                    const turnOfDeparture = state.messageCounter;

                    // Trigger memory summary (Async side effect)
                    if (this.RUNTIME.turnOfArrival !== null && turnOfDeparture > this.RUNTIME.turnOfArrival) {
                        this.summarizeActivityForLocation(previousLocationCoords, this.RUNTIME.turnOfArrival);
                    }

                    // 1. Update Location (Triggers auto-save)
                    state.worldMap.currentLocation = { x, y };
                    this.RUNTIME.turnOfArrival = state.messageCounter;

                    // Trigger Auto-Build of adjacent locations if enabled
                    this.checkAndGenerateAdjacentLocations(x, y);

                    // 2. Update Path
                    if (state.worldMap.destination && state.worldMap.destination.x !== null) {
                        state.worldMap.path = UTILITY.findPath(state.worldMap.grid, state.worldMap.currentLocation, state.worldMap.destination);
                    } else {
                        state.worldMap.path = [];
                    }

                    // 3. Add System Message
                    if (typeof NarrativeController !== 'undefined') {
                        NarrativeController.addSystemMessageToHistory(`You have moved to ${targetLocation.name}.`);
                    }

                    // 4. Reset UI Selection Runtime State
                    this.RUNTIME.selectedMapTile = null;
                    this.RUNTIME.pendingMove = null;

                    // 4.5 Try to Generate Location Characters if enabled and missing
                    if (state.enableLocationCharacters !== false) {
                        if (!targetLocation.characters || targetLocation.characters.length === 0) {
                            console.log(`[Location NPCs] Moving to new location ${targetLocation.name}. Initiating character generation.`);
                            this.generateLocationCharacters(targetLocation, true);
                        } else {
                            console.log(`[Location NPCs] Moving to location ${targetLocation.name}. Characters already exist.`);
                        }
                    } else {
                        console.log(`[Location NPCs] Movement detected, but Location NPCs feature is disabled.`);
                    }

                    // 4.6 Try to Generate Location Background Image if enabled and missing
                    if (state.enableAutoGenerateLocationImages) {
                        if (!targetLocation.imageUrl) {
                            console.log(`[Auto-Image] Moving to ${targetLocation.name} with no image. Initiating background image generation.`);
                            this.generateLocationImage(targetLocation).catch(err => {
                                console.error(`[Auto-Image] Failed to generate image for ${targetLocation.name}:`, err);
                            });
                        } else {
                            console.log(`[Auto-Image] Moving to ${targetLocation.name}. Image already exists.`);
                        }
                    }

                    // 5. Trigger AI Response (Narrator prefers to speak on move)
                    const narrator = state.characters.find(c => c.is_narrator && c.is_active);
                    if (typeof NarrativeController !== 'undefined') {
                        // 5.1 Run Visual Master (Concurrent)
                        let visualBlocker = null;
                        if (typeof VisualMaster !== 'undefined') {
                            visualBlocker = VisualMaster.checkTrigger();
                        }

                        // 5.2 Trigger Character Response
                        // We pass the narrator as a resolved ID or null if missing
                        NarrativeController.triggerAIResponse(narrator ? narrator.id : null, '', true, null, visualBlocker);
                    }

                    // 6. Update Background
                    UIManager.applyStyling();
                }
            },

            /**
             * Generates a summary of activity at a location upon departure.
             * @param {Object} locationCoords - The coordinates of the location.
             * @param {number} startTurn - The turn number when arrived.
             */
            async summarizeActivityForLocation(locationCoords, startTurn) {
                try {
                    const state = ReactiveStore.state;
                    const endTurn = state.messageCounter;

                    // Access raw array from proxy to avoid issues, though proxy access is usually fine for read
                    const history = state.chat_history;
                    const relevantHistory = history.slice(startTurn, endTurn).filter(msg => msg.type === 'chat' && !msg.isHidden);

                    if (relevantHistory.length === 0) return;

                    const chatTranscript = relevantHistory.map(msg => {
                        const char = ReactiveStore.getCharacter(msg.character_id);
                        return `${char ? char.name : 'Unknown'}: ${msg.content}`;
                    }).join('\n');

                    const promptTemplate = state.prompt_location_memory_gen || UTILITY.getDefaultSystemPrompts().prompt_location_memory_gen;
                    const prompt = promptTemplate.replace('{transcript}', chatTranscript);

                    const summaryContent = await APIService.callAI(prompt);

                    // Find location in ReactiveStore to update
                    const location = state.worldMap.grid.find(loc => loc.coords.x === locationCoords.x && loc.coords.y === locationCoords.y);
                    if (location) {
                        if (!location.local_static_entries) location.local_static_entries = [];

                        const messageIds = relevantHistory.map(msg => msg.id);
                        let snapshotObj = null;
                        if (typeof NarrativeController !== 'undefined' && messageIds.length > 0) {
                            snapshotObj = NarrativeController.createKnowledgeSnapshot(messageIds);
                        }

                        location.local_static_entries.push({
                            id: UTILITY.uuid(),
                            title: `Events from turn ${startTurn} to ${endTurn}`,
                            content: summaryContent
                        });

                        if (snapshotObj) {
                            state.knowledge_revisions = state.knowledge_revisions || [];
                            state.knowledge_revisions.push(snapshotObj);
                        }
                    }
                } catch (error) {
                    console.error("Failed to auto-generate location memory:", error);
                }
            },

            // --- Map Management (Edit Mode) ---

            /**
             * Selects a map tile for editing or viewing details.
             * @param {number} x - The x-coordinate.
             * @param {number} y - The y-coordinate.
             */
            selectMapTile(x, y) {
                const state = ReactiveStore.state;
                const tile = state.worldMap.grid.find(loc => loc.coords.x === x && loc.coords.y === y);
                this.RUNTIME.selectedMapTile = tile || null;
                this.RUNTIME.selectedLocalStaticEntryId = null;

                // Open the specific location details modal
                if (this.RUNTIME.selectedMapTile) {
                    AppController.openModal('location-details-modal');
                    UIManager.renderLocationDetailsModal();
                }
            },

            // Update image upload handler to refresh the new modal if open
            /**
             * Handles the upload of a custom image for a location.
             * @param {Event} event - The file input change event.
             * @param {number} x - The x-coordinate.
             * @param {number} y - The y-coordinate.
             */
            async handleWorldMapLocationImageUpload(event, x, y) {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) { alert("Image too large."); return; }

                UIManager.showLoadingSpinner('Processing location image...');
                try {
                    const blob = await ImageProcessor.processImageAsBlob(file);
                    const locationKey = `location::${x},${y}`;
                    await DBService.saveImage(locationKey, blob);

                    UIManager.RUNTIME.worldImageCache = UIManager.RUNTIME.worldImageCache || {};
                    if (UIManager.RUNTIME.worldImageCache[locationKey]) URL.revokeObjectURL(UIManager.RUNTIME.worldImageCache[locationKey]);
                    UIManager.RUNTIME.worldImageCache[locationKey] = URL.createObjectURL(blob);

                    const grid = ReactiveStore.state.worldMap.grid;
                    const location = grid.find(loc => loc.coords.x === x && loc.coords.y === y);
                    if (location) location.imageUrl = `local_idb_location::${x},${y}`;

                    // Refresh the new modal
                    UIManager.renderLocationDetailsModal();
                    UIManager.applyStyling();

                } catch (err) {
                    alert(`Upload failed: ${err.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                    event.target.value = '';
                }
            },

            /**
             * Sets the current selected tile as the travel destination.
             * Calculates the path.
             */
            setDestination() {
                const selected = this.RUNTIME.selectedMapTile;
                if (!selected) return;

                const state = ReactiveStore.state;
                state.worldMap.destination = selected.coords;
                state.worldMap.path = UTILITY.findPath(state.worldMap.grid, state.worldMap.currentLocation, selected.coords);

                UIManager.renderWorldMapModal();
            },

            /**
             * Updates a field of the selected location (debounced).
             * @param {string} field - The field to update.
             * @param {string} value - The new value.
             */
            updateLocationDetail: debounce(function (field, value) {
                const selected = this.RUNTIME.selectedMapTile;
                if (!selected) return;

                // Find the object INSIDE the ReactiveStore array to trigger the proxy
                const grid = ReactiveStore.state.worldMap.grid;
                const locationInGrid = grid.find(loc => loc.coords.x === selected.coords.x && loc.coords.y === selected.coords.y);

                if (locationInGrid) {
                    locationInGrid[field] = value;
                }
            }, 500),




            /**
             * Clears the entire world map after confirmation.
             */
            async clearWorldMap() {
                const proceed = await UIManager.showConfirmationPromise('Are you sure you want to clear the entire world map? This cannot be undone.');
                if (!proceed) return;

                const state = ReactiveStore.state;
                state.worldMap.grid = UTILITY.createDefaultMapGrid();
                state.worldMap.currentLocation = { x: 4, y: 4 };
                state.worldMap.destination = { x: null, y: null };
                state.worldMap.path = [];
                this.RUNTIME.selectedMapTile = null;

                UIManager.renderWorldMapModal();
                UIManager.applyStyling();
            },

            /**
             * Pure Generator Function.
             * Generates a 8x8 map grid based on context.
             * @param {Object} contextObj - The context for generation.
             * @returns {Promise<Array>} - The generated grid.
             */
            async generateMapGrid(contextObj) {
                const promptTemplate = StateManager.getState().prompt_world_map_gen || UTILITY.getDefaultSystemPrompts().prompt_world_map_gen;
                let prompt = promptTemplate
                    .replace('{characters}', contextObj.characters || '')
                    .replace('{static}', contextObj.static_lore || '')
                    .replace('{recent}', contextObj.recent_events || '');

                const response = await APIService.callAI(prompt, true);
                const data = UTILITY.extractAndParseJSON(response);
                if (data && data.grid && data.grid.length === 64) {
                    // Sanitize
                    data.grid.forEach(l => {
                        if (!l.local_static_entries) l.local_static_entries = [];
                        if (!l.imageUrl) l.imageUrl = "";
                        if (!l.prompt) l.prompt = "";
                        if (!l.name || l.name === "Undefined") l.name = "";
                    });
                    return data.grid;
                }
                throw new Error("Invalid grid");
            },

            /**
             * UI Handler for generating the world map.
             * Requests user confirmation before overwriting.
             * @param {Event} event - The click event.
             */
            async generateWorldMap(event) {
                const proceed = await UIManager.showConfirmationPromise('Overwrite map with AI generation?');
                if (!proceed) return;

                const state = ReactiveStore.state;
                const btn = event.target.closest('button');
                if (btn) { btn.disabled = true; btn.innerHTML = '...'; }

                try {
                    const context = {
                        characters: state.characters.map(c => `${c.name}: ${c.short_description}`).join('\n'),
                        static_lore: (state.static_entries || []).map(e => `* ${e.title}: ${e.content}`).join('\n'),
                        recent_events: (state.chat_history || []).filter(m => m.type === 'chat').slice(-3).map(m => m.content).join('\n---\n')
                    };

                    const newGrid = await this.generateMapGrid(context);
                    state.worldMap.grid = newGrid;
                    state.worldMap.currentLocation = { x: 4, y: 4 };
                    state.worldMap.destination = { x: null, y: null };
                    state.worldMap.path = [];

                    // 4.5 Try to Generate Location Characters for starting tile
                    if (state.enableLocationCharacters !== false) {
                        const startLoc = state.worldMap.grid.find(loc => loc.coords.x === 4 && loc.coords.y === 4);
                        if (startLoc && (!startLoc.characters || startLoc.characters.length === 0)) {
                            this.generateLocationCharacters(startLoc, true);
                        }
                    }

                    this.RUNTIME.selectedMapTile = null;
                    UIManager.renderWorldMapModal();
                    UIManager.applyStyling();
                } catch (e) {
                    alert(e.message);
                } finally {
                    if (btn) { btn.disabled = false; btn.innerHTML = UIManager.getAIGenIcon(); }
                }
            },

            /**
             * Generates a description for a location using AI.
             * @param {Event} event - The click event.
             */
            async generateLocationPromptAI(event) {
                const state = ReactiveStore.state;
                const location = this.RUNTIME.selectedMapTile;
                if (!location) return;

                // Resolve button first
                const button = event.target.closest('button');
                if (!button) return;

                button.disabled = true; button.innerHTML = '...';

                try {
                    const prompt = state.prompt_location_gen
                        .replace('{name}', location.name)
                        .replace('{description}', location.description);

                    const newContent = await APIService.callAI(prompt);
                    this.updateLocationDetail('prompt', newContent);

                    // Find textarea relative to the BUTTON
                    const textarea = button.parentElement.querySelector('textarea');
                    if (textarea) textarea.value = newContent;

                } catch (e) { alert(e.message); }
                finally { button.disabled = false; button.innerHTML = UIManager.getAIGenIcon(); }
            },

            // --- Local Static Lore (Map Specific) ---

            /**
             * Adds a new local static entry to the selected location.
             */
            addLocalStaticEntry() {
                const location = this.RUNTIME.selectedMapTile;
                if (!location) return;

                // We must operate on the reactive object
                const state = ReactiveStore.state;
                const reactiveLoc = state.worldMap.grid.find(l => l.coords.x === location.coords.x && l.coords.y === location.coords.y);

                if (reactiveLoc) {
                    if (!reactiveLoc.local_static_entries) reactiveLoc.local_static_entries = [];
                    const newEntry = { id: UTILITY.uuid(), title: "New Local Entry", content: "" };
                    reactiveLoc.local_static_entries.push(newEntry);
                    this.RUNTIME.selectedLocalStaticEntryId = newEntry.id;

                    UIManager.renderLocalStaticEntriesList();
                    UIManager.renderLocalStaticEntryDetails();
                }
            },

            /**
             * Deletes a local static entry.
             * @param {string} entryId - The entry ID.
             */
            deleteLocalStaticEntry(entryId) {
                const location = this.RUNTIME.selectedMapTile;
                if (!location) return;

                const state = ReactiveStore.state;
                const reactiveLoc = state.worldMap.grid.find(l => l.coords.x === location.coords.x && l.coords.y === location.coords.y);

                if (reactiveLoc && reactiveLoc.local_static_entries) {
                    reactiveLoc.local_static_entries = reactiveLoc.local_static_entries.filter(e => e.id !== entryId);
                    if (this.RUNTIME.selectedLocalStaticEntryId === entryId) {
                        this.RUNTIME.selectedLocalStaticEntryId = null;
                    }
                    UIManager.renderLocalStaticEntriesList();
                    UIManager.renderLocalStaticEntryDetails();
                }
            },

            /**
             * Opens the Generic Image Generator for a location.
             */
            openLocationImageGenerator() {
                const { selectedMapTile } = this.RUNTIME;
                if (!selectedMapTile) return;

                // Prioritize the AI-generated prompt if available, else usage Name + Description
                const promptContent = selectedMapTile.prompt || selectedMapTile.description || "";
                const initialPrompt = `${selectedMapTile.name}: ${promptContent}`;

                UIManager.openGenericImageGenerator({
                    title: `Generate: ${selectedMapTile.name}`,
                    initialPrompt: initialPrompt,
                    onSave: async (blob) => {
                        await this.handleWorldMapLocationImageUpload({ target: { files: [new File([blob], "generated_location.png", { type: "image/png" })] } }, selectedMapTile.coords.x, selectedMapTile.coords.y);
                        // Modal re-render is handled by upload
                    }
                });
            },

            /**
             * Selects a local static entry for viewing/editing.
             * @param {string} entryId - The entry ID.
             */
            selectLocalStaticEntry(entryId) {
                this.RUNTIME.selectedLocalStaticEntryId = entryId;
                UIManager.renderLocalStaticEntriesList();
                UIManager.renderLocalStaticEntryDetails();
            },

            /**
             * Updates a field of a local static entry (debounced).
             * @param {string} entryId - The entry ID.
             * @param {string} field - The field to update.
             * @param {string} value - The new value.
             */
            updateLocalStaticEntryField: debounce(function (entryId, field, value) {
                const location = this.RUNTIME.selectedMapTile;
                if (!location) return;
                const state = ReactiveStore.state;
                const reactiveLoc = state.worldMap.grid.find(l => l.coords.x === location.coords.x && l.coords.y === location.coords.y);

                if (reactiveLoc && reactiveLoc.local_static_entries) {
                    const entry = reactiveLoc.local_static_entries.find(e => e.id === entryId);
                    if (entry) entry[field] = value;
                }
            }, 300),

            // --- Static Knowledge (Global) ---

            /**
             * Adds a new global static entry.
             */
            addStaticEntry() {
                const newEntry = { id: UTILITY.uuid(), title: "New Static Entry", content: "", is_immutable: false };
                ReactiveStore.state.static_entries.push(newEntry);
                ReactiveStore.state.selectedStaticEntryId = newEntry.id;

                // Force re-render of the list and details
                // WorldController (which owns the UI for this) needs to be triggered.
                // Looking at the context, this seems to be inside WorldController...
                // Let's assume WorldController context.
                this.renderStaticEntries(); // Corrected function name
                this.renderStaticEntryDetails();
            },

            /**
             * Moves a static entry to a new position/group.
             * @param {string} id - The entry ID to move.
             * @param {number} newIndex - The new relative index within the target group.
             * @param {string} targetGroup - 'immutable' or 'mutable'.
             */
            moveStaticEntry(id, newIndex, targetGroup) {
                const state = ReactiveStore.state;
                if (!state.static_entries) return;

                // Operate on a COPY to avoid side-effects triggering UI updates on partial state
                const currentList = [...state.static_entries].filter(e => e);
                const entryIndex = currentList.findIndex(e => e.id === id);
                if (entryIndex === -1) return;

                // 1. Extract Entry
                const [entry] = currentList.splice(entryIndex, 1);

                // 2. Update Status
                entry.is_immutable = (targetGroup === 'immutable');

                // 3. Re-sort into groups
                const immutable = currentList.filter(e => e.is_immutable);
                const mutable = currentList.filter(e => !e.is_immutable);

                // 4. Insert at correct relative index
                if (entry.is_immutable) {
                    if (newIndex < 0) newIndex = 0;
                    if (newIndex > immutable.length) newIndex = immutable.length;
                    immutable.splice(newIndex, 0, entry);
                } else {
                    if (newIndex < 0) newIndex = 0;
                    if (newIndex > mutable.length) newIndex = mutable.length;
                    mutable.splice(newIndex, 0, entry);
                }

                // 5. Recombine and ATOMICALLY update state
                // Filter out any potential nulls to self-heal state
                state.static_entries = [...immutable, ...mutable].filter(e => e);

                // 6. Force Save & Render
                ReactiveStore.forceSave();
                UIManager.renderStaticEntries();
            },

            handleStaticDragStart(event, id) {
                event.dataTransfer.setData("text/plain", id);
                event.dataTransfer.effectAllowed = "move";
            },

            handleStaticDragOver(event) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
            },

            handleStaticDrop(event, targetId, targetGroup, targetIndex) {
                event.preventDefault();
                const dragId = event.dataTransfer.getData("text/plain");
                if (!dragId || dragId === targetId) return;

                let finalIndex = targetIndex;

                // Logic: If we drop onto an ITEM (not header), determine if we are dropping Before or After
                if (!targetId.startsWith('header-')) {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const relY = event.clientY - rect.top;
                    // If dropping on lower half, insert AFTER
                    if (relY > rect.height / 2) {
                        finalIndex++;
                    }
                }

                const state = ReactiveStore.state;
                const dragEntry = state.static_entries.find(e => e.id === dragId);
                if (!dragEntry) return;

                // Adjust Index if moving strictly DOWN within same group
                // Because removing the item at index X will shift everything > X down by 1.
                const isDragImmutable = dragEntry.is_immutable;
                const dragGroup = isDragImmutable ? 'immutable' : 'mutable';

                const groupList = state.static_entries.filter(e => e && e.is_immutable === isDragImmutable);
                const dragIndex = groupList.findIndex(e => e.id === dragId);

                // If we are in same group and moving the item to a higher index, we need to decrement target index
                // because the item itself is being removed from before the target.
                if (dragGroup === targetGroup && dragIndex < finalIndex) {
                    finalIndex--;
                }

                this.moveStaticEntry(dragId, finalIndex, targetGroup);
            },

            // --- Touch Support for Mobile DnD ---
            touchDragId: null,
            dragTimer: null,
            isDragging: false,
            startTouchX: 0,
            startTouchY: 0,

            handleStaticTouchStart(event, id) {
                // Initialize drag state but DO NOT block default yet (allows scroll)
                this.touchDragId = id;
                this.isDragging = false;

                // Track start position to detect if user scrolls away
                if (event.touches && event.touches[0]) {
                    this.startTouchX = event.touches[0].clientX;
                    this.startTouchY = event.touches[0].clientY;
                }

                // Identify visual target for feedback
                const target = event.target.closest('[data-drag-target="true"]');

                // Start Long-Press Timer (300ms)
                this.dragTimer = setTimeout(() => {
                    this.isDragging = true;
                    if (navigator.vibrate) navigator.vibrate(50); // Haptic feedback

                    // Visual Feedback: Item 'pops' up
                    if (target) {
                        target.classList.add('ring-2', 'ring-indigo-500', 'opacity-75', 'scale-95', 'transform', 'transition-all');
                    }
                    console.log("Drag Mode Activated for", id);
                }, 300);
            },

            handleStaticTouchMove(event) {
                if (!this.touchDragId) return;

                const touch = event.touches[0];
                const deltaX = Math.abs(touch.clientX - this.startTouchX);
                const deltaY = Math.abs(touch.clientY - this.startTouchY);

                // Scenario A: User is trying to scroll (moved finger before timer fired)
                if (!this.isDragging) {
                    // Tolerance: 10px buffer for shaky fingers
                    if (deltaY > 10 || deltaX > 10) {
                        clearTimeout(this.dragTimer);
                        this.touchDragId = null; // Cancel drag attempt
                    }
                    return; // Allow native scroll to happen
                }

                // Scenario B: Long-press succeeded, now we are dragging
                if (this.isDragging) {
                    event.preventDefault(); // Block scroll so we can drag item
                }
            },

            handleStaticTouchEnd(event) {
                clearTimeout(this.dragTimer);

                // Cleanup Visuals
                // We use a general query to ensure we catch the highlighted item even if target reference lost
                const activeEls = document.querySelectorAll('.ring-indigo-500.scale-95');
                activeEls.forEach(el => el.classList.remove('ring-2', 'ring-indigo-500', 'opacity-75', 'scale-95'));

                if (!this.isDragging) {
                    // Timer didn't fire? Then it was a tap/click. 
                    // Allow the onclick handler (Select) to fire naturally.
                    this.touchDragId = null;
                    return;
                }

                // If we WERE dragging, prevent the click and execute Drop
                event.preventDefault();
                const touch = event.changedTouches[0];
                this.finalizeTouchDrop(touch);

                // Reset State
                this.touchDragId = null;
                this.isDragging = false;
            },

            finalizeTouchDrop(touch) {
                if (!this.touchDragId) return;

                const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
                if (!targetEl) return;

                const dropTarget = targetEl.closest('[data-drag-target="true"]');
                if (!dropTarget) return;

                const targetId = dropTarget.getAttribute('data-drag-id');
                const targetGroup = dropTarget.getAttribute('data-drag-group');
                const targetIndex = parseInt(dropTarget.getAttribute('data-drag-index'));

                if (!targetId || !targetGroup || isNaN(targetIndex)) return;
                if (this.touchDragId === targetId) return;

                // Determine precise insertion point (Above/Below)
                let finalIndex = targetIndex;
                if (!targetId.startsWith('header-')) {
                    const rect = dropTarget.getBoundingClientRect();
                    const relY = touch.clientY - rect.top;
                    if (relY > rect.height / 2) {
                        finalIndex++;
                    }
                }

                const state = ReactiveStore.state;
                const dragEntry = state.static_entries.find(e => e.id === this.touchDragId);
                if (!dragEntry) return;

                // Normalize Indexing Logic
                const isDragImmutable = dragEntry.is_immutable;
                const dragGroup = isDragImmutable ? 'immutable' : 'mutable';
                const groupList = state.static_entries.filter(e => e && e.is_immutable === isDragImmutable);
                const dragIndex = groupList.findIndex(e => e.id === this.touchDragId);

                // Adjustment for self-removal shifting indices
                if (dragGroup === targetGroup && dragIndex < finalIndex) {
                    finalIndex--;
                }

                this.moveStaticEntry(this.touchDragId, finalIndex, targetGroup);
            },

            /**
             * Deletes a global static entry.
             * @param {string} id - The entry ID.
             */
            deleteStaticEntry(id) {
                ReactiveStore.state.static_entries = ReactiveStore.state.static_entries.filter(e => e.id !== id);
                if (ReactiveStore.state.selectedStaticEntryId === id) {
                    ReactiveStore.state.selectedStaticEntryId = null;
                }
            },

            /**
             * Selects a global static entry for viewing/editing.
             * @param {string} id - The entry ID.
             */
            selectStaticEntry(id) {
                ReactiveStore.state.selectedStaticEntryId = id;
            },

            /**
             * Toggles the protection status (is_immutable) of a static entry.
             * @param {string} id - The entry ID.
             */
            toggleStaticEntryProtection(id) {
                const state = ReactiveStore.state;
                const entry = state.static_entries.find(e => e.id === id);
                if (entry) {
                    entry.is_immutable = !entry.is_immutable;
                    // Logic to move entry is inherent in renderStaticEntries grouping
                    UIManager.renderStaticEntries();
                }
            },


            /**
             * Updates a field of a global static entry (debounced).
             * @param {string} id - The entry ID.
             * @param {string} field - The field to update.
             * @param {string} value - The new value.
             */
            updateStaticEntryField: debounce(function (id, field, value) {
                const entry = ReactiveStore.state.static_entries.find(e => e.id === id);
                if (entry) entry[field] = value;
            }, 300),

            /**
             * Updates the category of a global static entry.
             * @param {string} id - The entry ID.
             * @param {string} category - The new category value.
             */
            updateStaticEntryCategory(id, category) {
                const entry = ReactiveStore.state.static_entries.find(e => e.id === id);
                if (entry) {
                    entry.category = category;
                    entry.title = UTILITY.formatTitleWithCategory(entry.title, category);
                    UIManager.renderStaticEntries();
                    UIManager.renderStaticEntryDetails();
                }
            },

            /**
             * Generates content for a static entry using AI.
             * @param {Event} event - The click event.
             * @param {string} entryId - The entry ID.
             */
            async generateStaticEntryContentAI(event, entryId) {
                const entry = ReactiveStore.state.static_entries.find(e => e.id === entryId);
                if (!entry) return;

                // Resolve button first
                const button = event.target.closest('button');
                if (!button) return;

                button.disabled = true; button.innerHTML = '...';

                try {
                    const prompt = ReactiveStore.state.prompt_entry_gen.replace('{title}', entry.title).replace('{triggers}', '');
                    const content = await APIService.callAI(prompt);
                    this.updateStaticEntryField(entryId, 'content', content);

                    // Find textarea relative to the BUTTON
                    const textarea = button.parentElement.querySelector('textarea');
                    if (textarea) textarea.value = content;
                } catch (e) { UIManager.showNotification(e.message, "error"); }
                finally { button.disabled = false; button.innerHTML = UIManager.getAIGenIcon(); }
            },

            // --- Dynamic Knowledge ---

            /**
             * Adds a new dynamic entry.
             */
            addDynamicEntry() {
                const newEntry = {
                    id: UTILITY.uuid(),
                    title: "New Dynamic Entry",
                    triggers: "",
                    content_fields: [""],
                    current_index: 0,
                    triggered_at_turn: null
                };
                ReactiveStore.state.dynamic_entries.push(newEntry);
                ReactiveStore.state.selectedDynamicEntryId = newEntry.id;
            },

            /**
             * Deletes a dynamic entry.
             * @param {string} id - The entry ID.
             */
            deleteDynamicEntry(id) {
                ReactiveStore.state.dynamic_entries = ReactiveStore.state.dynamic_entries.filter(e => e.id !== id);
                if (ReactiveStore.state.selectedDynamicEntryId === id) {
                    ReactiveStore.state.selectedDynamicEntryId = null;
                }
            },

            /**
             * Selects a dynamic entry for viewing/editing.
             * @param {string} id - The entry ID.
             */
            selectDynamicEntry(id) {
                ReactiveStore.state.selectedDynamicEntryId = id;
            },

            /**
             * Imports a SillyTavern or Chub.ai lorebook JSON.
             * @param {Event} event - The file input change event.
             */
            importLorebook(event) {
                const file = event.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (e) => {
                    const text = e.target.result;
                    const result = UTILITY.parseLorebook(text);

                    if (result.static_entries.length === 0 && result.dynamic_entries.length === 0) {
                        UIManager.showNotification("Failed to import: no valid entries found in the file.", "error");
                        event.target.value = '';
                        return;
                    }

                    const currentStatics = ReactiveStore.state.static_entries || [];
                    const currentDynamics = ReactiveStore.state.dynamic_entries || [];

                    const updatedStatics = [...currentStatics, ...result.static_entries];
                    const updatedDynamics = [...currentDynamics, ...result.dynamic_entries];

                    ReactiveStore.state.static_entries = updatedStatics;
                    ReactiveStore.state.dynamic_entries = updatedDynamics;

                    if (result.dynamic_entries.length > 0) {
                        ReactiveStore.state.selectedDynamicEntryId = result.dynamic_entries[0].id;
                    }

                    UIManager.renderStaticEntries();
                    UIManager.renderDynamicEntries();

                    UIManager.showNotification(`Successfully imported ${result.static_entries.length} static and ${result.dynamic_entries.length} dynamic entries!`, "success");

                    event.target.value = '';
                };

                reader.onerror = (err) => {
                    console.error("FileReader error:", err);
                    UIManager.showNotification("Failed to read the selected file.", "error");
                    event.target.value = '';
                };

                reader.readAsText(file);
            },

            /**
             * Exports the current static and dynamic lore entries as a SillyTavern World Info JSON.
             */
            exportLorebook() {
                const state = ReactiveStore.state;
                const staticEntries = state.static_entries || [];
                const dynamicEntries = state.dynamic_entries || [];

                if (staticEntries.length === 0 && dynamicEntries.length === 0) {
                    UIManager.showNotification("No lorebook entries to export.", "warning");
                    return;
                }

                try {
                    const jsonStr = UTILITY.exportLorebook(staticEntries, dynamicEntries);
                    const blob = new Blob([jsonStr], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);

                    const storyName = state.story_name || "story";
                    const cleanName = storyName.toLowerCase().replace(/[^a-z0-9]/g, '_');

                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `ellipsis_lorebook_${cleanName}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    UIManager.showNotification("Lorebook exported successfully!", "success");
                } catch (e) {
                    console.error("Export failed:", e);
                    UIManager.showNotification(`Failed to export lorebook: ${e.message}`, "error");
                }
            },

            /**
             * Updates a field of a dynamic entry (debounced).
             * @param {string} id - The entry ID.
             * @param {string} field - The field to update.
             * @param {string} value - The new value.
             */
            updateDynamicEntryField: debounce(function (id, field, value) {
                const entry = ReactiveStore.state.dynamic_entries.find(e => e.id === id);
                if (entry && (field === 'title' || field === 'triggers')) {
                    entry[field] = value;
                }
            }, 300),

            /**
             * Adds a new content field to a dynamic entry.
             * @param {string} entryId - The entry ID.
             */
            addDynamicContentField(entryId) {
                const entry = ReactiveStore.state.dynamic_entries.find(e => e.id === entryId);
                if (entry) {
                    entry.content_fields.push("");
                    // Force UI refresh since subscription protects inputs
                    UIManager.renderDynamicEntryDetails();
                }
            },

            /**
             * Updates a content field of a dynamic entry (debounced).
             * @param {string} entryId - The entry ID.
             * @param {number} index - The index of the field.
             * @param {string} value - The new value.
             */
            updateDynamicContentField: debounce(function (entryId, index, value) {
                const entry = ReactiveStore.state.dynamic_entries.find(e => e.id === entryId);
                if (entry && entry.content_fields[index] !== undefined) {
                    entry.content_fields[index] = value;
                }
            }, 300),

            /**
             * Generates content for a dynamic entry field using AI.
             * @param {Event} event - The click event.
             * @param {string} entryId - The entry ID.
             * @param {number} index - The index of the field.
             */
            async generateDynamicEntryContentAI(event, entryId, index) {
                const entry = ReactiveStore.state.dynamic_entries.find(e => e.id === entryId);
                if (!entry) return;

                // Resolve button first
                const button = event.target.closest('button');
                if (!button) return;

                button.disabled = true; button.innerHTML = '...';

                try {
                    const prompt = ReactiveStore.state.prompt_entry_gen
                        .replace('{title}', entry.title)
                        .replace('{triggers}', entry.triggers);

                    const content = await APIService.callAI(prompt);
                    this.updateDynamicContentField(entryId, index, content);

                    // Find textarea relative to the BUTTON, not the click target (event.target)
                    const textarea = button.parentElement.querySelector('textarea');
                    if (textarea) textarea.value = content;
                } catch (e) { UIManager.showNotification(e.message, "error"); }
                finally { button.disabled = false; button.innerHTML = UIManager.getAIGenIcon(); }
            },

            /**
             * Cleans up empty content fields in dynamic entries.
             */
            cleanupEmptyDynamicFields() {
                const state = ReactiveStore.state;
                if (state.dynamic_entries) {
                    state.dynamic_entries.forEach(entry => {
                        if (entry.content_fields) {
                            // Filter out whitespace-only fields
                            entry.content_fields = entry.content_fields.filter(field => field.trim() !== "");
                            // Ensure at least one field exists
                            if (entry.content_fields.length === 0) entry.content_fields.push("");
                            // Clamp index
                            if (entry.current_index >= entry.content_fields.length) {
                                entry.current_index = entry.content_fields.length - 1;
                            }
                        }
                    });
                }
            },

            // --- Background Agents ---

            /**
             * Runs the World Info Agent to update static knowledge based on recent chat.
             * @param {boolean} [silent=false] - Whether to suppress UI feedback.
             */
            async checkWorldInfoAgent(silent = false) {
                const state = ReactiveStore.state;
                if (!StateManager.getLibrary().active_narrative_id) return;

                if (!silent) UIManager.showTypingIndicator('static-entry-agent', 'Updating static knowledge...');

                try {
                    // Build Context
                    let recentTranscript = "";
                    (state.chat_history || [])
                        .filter(m => m.type === 'chat')
                        .slice(-8)
                        .forEach(msg => {
                            const c = state.characters.find(i => i.id === msg.character_id);
                            if (c) recentTranscript += `${c.name}: ${msg.content}\n`;
                        });

                    const existingKnowledgeStr = (state.static_entries || [])
                        .map(e => `Title: ${e.title}\nContent: ${e.content}`)
                        .join('\n\n') || "No existing knowledge.";

                    const prompt = `You are an automated archivist. Analyze the recent conversation transcript and the EXISTING static knowledge base. Your goal is to identify new information that needs to be recorded or updated.

### Tasks
1. Analyze the transcript for new events, character updates, items used/found, world-building lore, or relationship changes.
2. Cross-reference with the existing list of entries to see if any matches exist.

### Existing Knowledge
${existingKnowledgeStr}

### Transcript
${recentTranscript}

### Output Format
Respond with a delimited list using a pipe character '|' in this exact format:
Category | Subject | New Detail or Update
If there are multiple entries, place each on a new line. If no changes are needed, return literally 'null'.

Valid Categories:
- Event (for major plot events)
- Character (for character details/updates)
- Item (for important items)
- World (for locations and world lore)
- Relationship (for character interpersonal updates)

Example Output:
Character | Alistair | He has acquired a mysterious silver amulet with a blue gem.
Relationship | Alistair & Elara | Alistair has started to trust Elara after she saved him from the wolf.`;

                    const response = await APIService.callAI(prompt, false);
                    const changeCount = await NarrativeController.applyStaticKnowledgeUpdates(response);

                    if (!silent) {
                        if (changeCount > 0) {
                            UIManager.renderStaticEntries();
                            UIManager.showNotification("Static knowledge updated successfully.", "success");
                        } else {
                            UIManager.showNotification("No new static knowledge updates found.", "info");
                        }
                        const input = document.getElementById('chat-input');
                        if (input) input.focus();
                    }

                } catch (e) {
                    if (!silent) {
                        console.error("Static Entry Agent failed:", e);
                        UIManager.showNotification("The AI failed to update static entries.", "error");
                        const input = document.getElementById('chat-input');
                        if (input) input.focus();
                    }
                } finally {
                    if (!silent) UIManager.hideTypingIndicator();
                }
            },

            // --- New Features ---

            /**
             * Creates a new static entry from a specific chat message.
             * @param {number} index - The index of the message.
             */
            async createStaticFromMessage(index) {
                const state = ReactiveStore.state;
                const msg = state.chat_history[index];
                if (!msg) return;

                if (typeof NarrativeController !== 'undefined') NarrativeController.closeAllMessageMenus();

                // 1. Show Feedback
                UIManager.showLoadingSpinner("Extracting knowledge...");

                // Defaults (Fallback)
                let entryTitle = "Extracted Memory";
                let entryContent = msg.content;

                try {
                    // 2. Construct Prompt
                    const char = ReactiveStore.getCharacter(msg.character_id);
                    const speaker = char ? char.name : "Unknown Character";

                    const prompt = `Analyze the following roleplay message from ${speaker}.
            Extract the most significant static facts, lore, or plot developments into a concise World Info entry.
            
            Return valid JSON only:
            {
                "title": "A short, descriptive title for this entry (3-6 words)",
                "content": "A concise, objective summary of the new information found in the message."
            }

            MESSAGE:
            "${msg.content}"`;

                    // 3. Call AI
                    const response = await APIService.callAI(prompt, true); // true = parses JSON automatically logic in APIService or returns string to parse

                    // Note: APIService.callAI(..., true) returns the JSON string block, we must parse it.
                    const data = JSON.parse(response);

                    if (data.title) entryTitle = data.title;
                    if (data.content) entryContent = data.content;

                } catch (e) {
                    console.warn("AI extraction failed, falling back to raw text:", e);
                    // We proceed with the raw text defaults defined above
                }

                // 4. Create Entry
                const newEntry = {
                    id: UTILITY.uuid(),
                    title: entryTitle,
                    content: entryContent
                };

                state.static_entries.push(newEntry);
                state.selectedStaticEntryId = newEntry.id;

                // 5. Update UI
                UIManager.hideLoadingSpinner();
                AppController.openModal('knowledge-modal');
                UIManager.switchKnowledgeTab('static');
            },

            /**
             * Converts a static entry into a dynamic entry.
             * @param {string} staticId - The ID of the static entry.
             */
            convertStaticToDynamic(staticId) {
                const state = ReactiveStore.state;
                const staticEntry = state.static_entries.find(e => e.id === staticId);

                if (!staticEntry) return;

                if (confirm("Convert this to a Dynamic Entry? The Static entry will be removed.")) {
                    // 1. Create Dynamic
                    const newDynamic = {
                        id: UTILITY.uuid(),
                        title: staticEntry.title,
                        triggers: staticEntry.title, // Default trigger to title
                        content_fields: [staticEntry.content],
                        current_index: 0,
                        triggered_at_turn: null
                    };

                    // 2. Add Dynamic, Remove Static
                    state.dynamic_entries.push(newDynamic);
                    state.static_entries = state.static_entries.filter(e => e.id !== staticId);

                    // 3. Switch Views
                    state.selectedDynamicEntryId = newDynamic.id;
                    state.selectedStaticEntryId = null;

                    // 4. Force UI Refresh
                    UIManager.switchKnowledgeTab('dynamic');
                }
            },

            /**
             * Updates a field of a GM Rule (debounced).
             * @param {string} id - The rule ID.
             * @param {string} field - The field to update.
             * @param {string} value - The new value.
             */
            updateGMRuleField: debounce(function (id, field, value) {
                const state = ReactiveStore.state;
                if (!state.gm_rules) state.gm_rules = [];
                const rule = state.gm_rules.find(r => String(r.id) === String(id));
                if (rule) {
                    rule[field] = value;
                }
            }, 300),

            /**
             * Toggles a GM Rule active state.
             * @param {string} id - The rule ID.
             * @param {boolean} isActive - The active state.
             */
            toggleGMRule(id, isActive) {
                const state = ReactiveStore.state;
                if (!state.gm_rules) state.gm_rules = [];
                const rule = state.gm_rules.find(r => String(r.id) === String(id));
                if (rule) {
                    rule.is_active = isActive;
                    UIManager.renderGMRules();
                }
            },

            /**
             * Adds a new default GM Rule.
             */
            addGMRule() {
                const state = ReactiveStore.state;
                if (!state.gm_rules) state.gm_rules = [];
                const newRule = {
                    id: UTILITY.uuid(),
                    name: "New GM Rule",
                    triggers: "stolen, 100%",
                    consequence: "Describe the consequences here...",
                    mode: "standard",
                    severity: "medium",
                    is_active: true
                };
                state.gm_rules.push(newRule);
                state.selectedGMRuleId = newRule.id;
                UIManager.renderGMRules();
            },

            /**
             * Deletes a GM Rule.
             * @param {string} id - The rule ID.
             */
            deleteGMRule(id) {
                const state = ReactiveStore.state;
                if (!state.gm_rules) return;
                if (confirm("Are you sure you want to delete this GM Rule?")) {
                    state.gm_rules = state.gm_rules.filter(r => String(r.id) !== String(id));
                    state.selectedGMRuleId = 'ledger';
                    UIManager.renderGMRules();
                }
            },

            /**
             * Clears the GM evaluation ledger.
             */
            clearGMLedger() {
                const state = ReactiveStore.state;
                if (confirm("Are you sure you want to clear the GM Ledger log?")) {
                    state.gm_ledger = [];
                    UIManager.renderGMRules();
                }
            },

            /**
             * Parses GM Rule evaluation XML block from LLM output.
             * @param {string} xmlText - The raw XML text from LLM.
             * @returns {Array} - List of parsed rule evaluation objects.
             */
            parseGMEvaluationsXML(xmlText) {
                return UTILITY.parseGMEvaluationsXML(xmlText);
            },

            /**
             * Checks active GM rules programmatically using keyword and probability matching.
             * Excludes any background LLM calls.
             */
            checkGMRulesProgrammatic() {
                const state = ReactiveStore.state;
                if (!state.gm_rules || state.gm_rules.length === 0) return;

                const activeRules = state.gm_rules.filter(r => r.is_active);
                if (activeRules.length === 0) return;

                // Get the last chat message content
                const lastMsg = state.chat_history.slice().reverse().find(m => m && m.type === 'chat' && !m.isHidden);
                if (!lastMsg) return;

                const content = lastMsg.content || '';
                const turn = (state.chat_history || []).filter(m => m.type === 'chat' && !m.isHidden).length;

                let triggeredAny = false;

                activeRules.forEach(rule => {
                    // Adapt rule triggers to match the format UTILITY.testLoreEntries expects: { triggers: String }
                    const ruleEntry = { id: rule.id, triggers: rule.triggers || rule.criteria || '' };
                    const triggered = UTILITY.testLoreEntries(content, [ruleEntry]);

                    if (triggered) {
                        console.log(`[GM Agent] Programmatic trigger matched for rule: ${rule.name}`);
                        triggeredAny = true;

                        // 1. Log to ledger
                        if (!state.gm_ledger) state.gm_ledger = [];
                        state.gm_ledger.push({
                            id: UTILITY.uuid(),
                            rule_id: rule.id,
                            rule_name: rule.name,
                            status: 'triggered',
                            description: `Keyword trigger matched: "${ruleEntry.triggers}"`,
                            consequence: rule.consequence,
                            severity: rule.severity,
                            turn: turn,
                            timestamp: Date.now()
                        });

                        // 2. Parse state updates and narration from consequence
                        const parseResult = UTILITY.parseAndStripStateIndicators(rule.consequence);

                        // Apply state changes to inventory/game state
                        if (parseResult.changes && parseResult.changes.length > 0) {
                            if (typeof InventoryController !== 'undefined' && typeof InventoryController.processStateUpdates === 'function') {
                                // Create a dummy message object to pass to InventoryController
                                const dummyMsg = { content: rule.consequence };
                                InventoryController.processStateUpdates(dummyMsg);
                            }
                        }

                        // 3. Inject narration if mode is active and has narration text (stripped of state tags)
                        if (rule.mode === 'active' && parseResult.cleanedText.trim()) {
                            const narratorMsg = {
                                id: UTILITY.uuid(),
                                type: 'chat',
                                character_id: 'narrator',
                                content: `*[GM Intercession]*\n${parseResult.cleanedText.trim()}`,
                                timestamp: Date.now(),
                                tokens: 0,
                                isHidden: false
                            };
                            state.chat_history.push(narratorMsg);
                            UIManager.renderChat();
                        }

                        UIManager.showToast(`GM Rule Triggered: ${rule.name}`, false);
                    }
                });

                if (triggeredAny) {
                    // Update ledger UI if open
                    if (document.getElementById('knowledge-modal') && document.getElementById('knowledge-modal').style.display !== 'none' && state.selectedGMRuleId === 'ledger') {
                        UIManager.renderGMRules();
                    }
                }
            },

        };
