        /**
         * =================================================================================================
         * [SEC:JS:CTRL:INV]
         * InventoryController Module
         * Manages game state (resources, relationships, journal/quests) and handles [STATE: ...] updates.
         * =================================================================================================
         */
        const InventoryController = {
            /**
             * Processes all [STATE: ...] instructions found in a newly generated or modified message,
             * updates state.gameState, and displays notifications to the user.
             * @param {Object} messageObj - The narrative message object.
             */
            processStateUpdates(messageObj) {
                const state = StateManager.getState();
                if (!state) return;

                // Initialize gameState if it doesn't exist
                if (!state.gameState) {
                    state.gameState = { resources: [], relationships: [], journal: [] };
                }

                const parseResult = UTILITY.parseAndStripStateIndicators(messageObj.content);

                // Clean the message content of the indicators
                messageObj.content = parseResult.cleanedText;

                if (parseResult.changes.length === 0 || state.enableJournal === false) return;

                let snapshotObj = null;
                if (typeof NarrativeController !== 'undefined' && messageObj && messageObj.id) {
                    snapshotObj = NarrativeController.createKnowledgeSnapshot([messageObj.id]);
                }

                const notifications = [];

                parseResult.changes.forEach(change => {
                    if (change.type === 'resource') {
                        // Find existing resource
                        let res = state.resources ? state.resources.find(r => r.name.toLowerCase() === change.name.toLowerCase()) : null;
                        if (!res) {
                            res = state.gameState.resources.find(r => r.name.toLowerCase() === change.name.toLowerCase());
                        }

                        if (res) {
                            res.value = Math.max(0, res.value + change.change);
                            if (res.value === 0) {
                                // Remove resource
                                state.gameState.resources = state.gameState.resources.filter(r => r !== res);
                                if (state.resources) {
                                    state.resources = state.resources.filter(r => r !== res);
                                }
                                notifications.push(`Lost item: ${res.name}`);
                            } else {
                                notifications.push(`Item updated: ${res.name} (Qty: ${res.value})`);
                            }
                        } else if (change.change > 0) {
                            const newRes = { id: UTILITY.uuid(), name: change.name, value: change.change };
                            state.gameState.resources.push(newRes);
                            notifications.push(`Acquired item: ${change.name} (Qty: ${change.change})`);
                        }
                    } else if (change.type === 'quest') {
                        // Find quest by title
                        let quest = state.gameState.journal.find(q => q.title.toLowerCase() === change.title.toLowerCase());
                        if (quest) {
                            if (change.isUpdate) {
                                quest.objective = change.objective;
                                if (!quest.log) quest.log = [];
                                quest.log.push(change.objective);
                                notifications.push(`Quest updated: ${quest.title} - ${change.objective}`);
                            } else {
                                quest.status = change.status;
                                notifications.push(`Quest ${change.status}: ${quest.title}`);
                            }
                        } else {
                            // Start new quest
                            let charId = null;
                            if (change.characterName) {
                                const characters = (ReactiveStore.state.characters || []);
                                const character = characters.find(c => c.name.toLowerCase().includes(change.characterName.toLowerCase()));
                                if (character) charId = character.id;
                            }
                            const newQuest = {
                                id: UTILITY.uuid(),
                                title: change.title,
                                status: change.status,
                                objective: change.objective,
                                log: change.objective ? [change.objective] : [],
                                characterId: charId
                            };
                            state.gameState.journal.push(newQuest);
                            notifications.push(`New Quest active: ${change.title}`);
                        }
                    } else if (change.type === 'relationship') {
                        // Try to find character ID by matching name
                        const characters = (ReactiveStore.state.characters || []);
                        const character = characters.find(c => c.name.toLowerCase().includes(change.charName.toLowerCase()));
                        const charId = character ? character.id : null;
                        const actualName = character ? character.name : change.charName;

                        let rel = state.gameState.relationships.find(r => r.characterId === charId || r.characterName.toLowerCase() === change.charName.toLowerCase());
                        if (!rel) {
                            rel = {
                                id: UTILITY.uuid(),
                                characterId: charId,
                                characterName: actualName,
                                track: change.track,
                                value: 50 // starting baseline
                            };
                            state.gameState.relationships.push(rel);
                        }

                        const oldValue = rel.value;
                        if (change.isRelative) {
                            rel.value = Math.max(0, Math.min(100, rel.value + change.changeVal));
                        } else {
                            rel.value = Math.max(0, Math.min(100, change.changeVal));
                        }

                        const diff = rel.value - oldValue;
                        if (diff !== 0) {
                            const sign = diff > 0 ? '+' : '';
                            notifications.push(`${actualName} ${rel.track}: ${rel.value}% (${sign}${diff}%)`);
                        }
                    }
                });

                // Trigger Toast Notifications
                if (notifications.length > 0) {
                    notifications.forEach((note, index) => {
                        setTimeout(() => {
                            if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                                UIManager.showToast(note, false);
                            } else {
                                console.log("[STATE UPDATE]:", note);
                            }
                        }, index * 800);
                    });
                }

                if (snapshotObj) {
                    state.knowledge_revisions = state.knowledge_revisions || [];
                    state.knowledge_revisions.push(snapshotObj);
                    ReactiveStore.forceSave();
                }
            },

            /**
             * Directly adds/removes resources via UI modal actions.
             */
            addResource(name, value) {
                const state = ReactiveStore.state;
                if (!state.gameState) state.gameState = { resources: [], relationships: [], journal: [] };

                let res = state.gameState.resources.find(r => r.name.toLowerCase() === name.toLowerCase());
                if (res) {
                    res.value = Math.max(0, res.value + value);
                } else if (value > 0) {
                    state.gameState.resources.push({ id: UTILITY.uuid(), name, value });
                }

                // Clean up zero-value resources
                state.gameState.resources = state.gameState.resources.filter(r => r.value > 0);
            },

            removeResource(id) {
                const state = ReactiveStore.state;
                if (!state.gameState) return;
                state.gameState.resources = state.gameState.resources.filter(r => r.id !== id);
            },

            /**
             * Directly manages quests via UI modal actions.
             */
            addQuest(title, objective, characterId) {
                const state = ReactiveStore.state;
                if (!state.gameState) state.gameState = { resources: [], relationships: [], journal: [] };

                state.gameState.journal.push({
                    id: UTILITY.uuid(),
                    title,
                    status: 'active',
                    objective,
                    log: objective ? [objective] : [],
                    characterId: characterId || null
                });
            },

            updateQuest(id, status, objective, characterId) {
                const state = ReactiveStore.state;
                if (!state.gameState) return;

                const quest = state.gameState.journal.find(q => q.id === id);
                if (quest) {
                    quest.status = status;
                    if (objective) {
                        quest.objective = objective;
                        if (!quest.log) quest.log = [];
                        quest.log.push(objective);
                    }
                    if (characterId !== undefined) {
                        quest.characterId = characterId || null;
                    }
                }
            },

            updateQuestObjective(questId, objective) {
                const state = ReactiveStore.state;
                if (!state.gameState) return;

                const quest = state.gameState.journal.find(q => q.id === questId);
                if (quest) {
                    quest.objective = objective;
                    if (!quest.log) quest.log = [];
                    quest.log.push(objective);
                }
            },

            deleteQuest(id) {
                const state = ReactiveStore.state;
                if (!state.gameState) return;
                state.gameState.journal = state.gameState.journal.filter(q => q.id !== id);
            },

            /**
             * Directly manages relationships via UI modal actions.
             */
            updateRelationship(id, value, track) {
                const state = ReactiveStore.state;
                if (!state.gameState) return;

                const rel = state.gameState.relationships.find(r => r.id === id);
                if (rel) {
                    rel.value = Math.max(0, Math.min(100, value));
                    if (track) rel.track = track;
                }
            },

            deleteRelationship(id) {
                const state = ReactiveStore.state;
                if (!state.gameState) return;
                state.gameState.relationships = state.gameState.relationships.filter(r => r.id !== id);
            },

            /**
             * Processes lists of journal updates (inventory, quests, relationships) parsed from analysis,
             * modifies narrative state, and triggers toast notifications.
             * @param {Array} inventoryChanges - [{name, delta}]
             * @param {Array} questChanges - [{action, title, objective}]
             * @param {Array} relationshipChanges - [{charName, track, changeVal}]
             */
            applyJournalChanges(inventoryChanges, questChanges, relationshipChanges) {
                const state = StateManager.getState();
                if (!state || state.enableJournal === false) return;

                if (!state.gameState) {
                    state.gameState = { resources: [], relationships: [], journal: [] };
                }

                const notifications = [];

                // 1. Inventory changes
                if (Array.isArray(inventoryChanges)) {
                    inventoryChanges.forEach(change => {
                        const name = change.name;
                        const delta = change.delta;
                        if (!name || delta === 0) return;

                        let res = state.resources ? state.resources.find(r => r.name.toLowerCase() === name.toLowerCase()) : null;
                        if (!res) {
                            res = state.gameState.resources.find(r => r.name.toLowerCase() === name.toLowerCase());
                        }

                        if (res) {
                            res.value = Math.max(0, res.value + delta);
                            if (res.value === 0) {
                                state.gameState.resources = state.gameState.resources.filter(r => r !== res);
                                if (state.resources) {
                                    state.resources = state.resources.filter(r => r !== res);
                                }
                                notifications.push(`Lost item: ${res.name}`);
                            } else {
                                notifications.push(`Item updated: ${res.name} (Qty: ${res.value})`);
                            }
                        } else if (delta > 0) {
                            const newRes = { id: UTILITY.uuid(), name: name, value: delta };
                            state.gameState.resources.push(newRes);
                            notifications.push(`Acquired item: ${name} (Qty: ${delta})`);
                        }
                    });
                }

                // 2. Quest changes
                if (Array.isArray(questChanges)) {
                    questChanges.forEach(change => {
                        const title = change.title;
                        const action = change.action;
                        const objective = change.objective;
                        if (!title) return;

                        let quest = state.gameState.journal.find(q => q.title.toLowerCase() === title.toLowerCase());
                        if (quest) {
                            if (action === 'update') {
                                quest.objective = objective;
                                if (!quest.log) quest.log = [];
                                quest.log.push(objective);
                                notifications.push(`Quest updated: ${quest.title} - ${objective}`);
                            } else {
                                let status = 'active';
                                if (action === 'complete') status = 'completed';
                                else if (action === 'fail') status = 'failed';

                                quest.status = status;
                                notifications.push(`Quest ${status}: ${quest.title}`);
                            }
                        } else {
                            let status = 'active';
                            if (action === 'complete') status = 'completed';
                            else if (action === 'fail') status = 'failed';

                            let charId = null;
                            if (change.characterName) {
                                const characters = (ReactiveStore.state.characters || []);
                                const character = characters.find(c => c.name.toLowerCase().includes(change.characterName.toLowerCase()));
                                if (character) charId = character.id;
                            }

                            const newQuest = {
                                id: UTILITY.uuid(),
                                title: title,
                                status: status,
                                objective: objective,
                                log: objective ? [objective] : [],
                                characterId: charId
                            };
                            state.gameState.journal.push(newQuest);
                            notifications.push(`New Quest active: ${title}`);
                        }
                    });
                }

                // 3. Relationship changes
                if (Array.isArray(relationshipChanges)) {
                    relationshipChanges.forEach(change => {
                        const charName = change.charName;
                        const track = change.track || 'Affection';
                        const changeVal = change.changeVal;
                        if (!charName || changeVal === 0) return;

                        const characters = (ReactiveStore.state.characters || []);
                        const character = characters.find(c => c.name.toLowerCase().includes(charName.toLowerCase()));
                        const charId = character ? character.id : null;
                        const actualName = character ? character.name : charName;

                        let rel = state.gameState.relationships.find(r => r.characterId === charId || r.characterName.toLowerCase() === charName.toLowerCase());
                        if (!rel) {
                            rel = {
                                id: UTILITY.uuid(),
                                characterId: charId,
                                characterName: actualName,
                                track: track,
                                value: 50
                            };
                            state.gameState.relationships.push(rel);
                        }

                        const oldValue = rel.value;
                        rel.value = Math.max(0, Math.min(100, rel.value + changeVal));

                        const diff = rel.value - oldValue;
                        if (diff !== 0) {
                            const sign = diff > 0 ? '+' : '';
                            notifications.push(`${actualName} ${rel.track}: ${rel.value}% (${sign}${diff}%)`);
                        }
                    });
                }

                if (notifications.length > 0) {
                    notifications.forEach((note, index) => {
                        setTimeout(() => {
                            if (typeof UIManager !== 'undefined' && UIManager.showToast) {
                                UIManager.showToast(note, false);
                            } else {
                                console.log("[STATE UPDATE]:", note);
                            }
                        }, index * 800);
                    });

                    ReactiveStore.forceSave();
                    UIManager.renderInventoryPanel();
                }
            }
        };
