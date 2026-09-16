        /**
         * =================================================================================================
         * [SEC:JS:CTRL:HUB]
         * HubController
         * Handles browsing and importing characters from external hubs (Chub.ai, Backyard.ai).
         * =================================================================================================
         */
        const HubController = {
            state: {
                source: 'chub',
                sort: 'relevance',
                query: '',
                results: [],
                isLoading: false,
                backyardBuildId: null,
                searchError: null
            },

            openHub() {
                AppController.closeModal('story-library-modal');
                AppController.openModal('character-hub-modal');
                this.closeDetails(); // Reset details view
                if (this.state.results.length === 0 && !this.state.query) {
                    this.state.query = 'fantasy';
                    const input = document.getElementById('hub-search-input');
                    if (input) input.value = 'fantasy';
                    this.search();
                } else {
                    this.renderResults();
                }
            },

            async promptImportLink() {
                const url = await UTILITY.customPrompt("Enter a Chub.ai, Backyard.ai, AIDungeon.com, FictionLab, or Wyvern.chat character URL:", "", "https://...");
                if (!url || !url.trim()) return;
                const trimmed = url.trim();

                // Wyvern.chat match
                const wyvernMatch = trimmed.match(/(?:wyvern\.chat\/chat\/|wyvern\.chat\/characters\/)(_?[a-zA-Z0-9_-]{15,40})/);
                if (wyvernMatch) {
                    const id = wyvernMatch[1];
                    this.state.source = 'wyvern';
                    this.state.isLoading = true;
                    this.state.searchError = null;
                    this.renderResults();

                    try {
                        const apiUrl = `https://api.wyvern.chat/characters/${id}`;
                        let res;
                        try {
                            res = await fetch(apiUrl);
                        } catch (e) { /* CORS blocked */ }
                        if (!res || !res.ok) {
                            try {
                                res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(apiUrl)}`);
                            } catch (e) { /* Fallback */ }
                        }
                        if (!res || !res.ok) {
                            res = await fetch(`https://corsproxy.io/?${encodeURIComponent(apiUrl)}`);
                        }
                        if (!res || !res.ok) {
                            throw new Error(`Failed to fetch Wyvern character data (${res ? res.status : 'Network Error'}).`);
                        }
                        const charData = await res.json();
                        if (!charData || !charData.name) {
                            throw new Error("Invalid character data returned from Wyvern.chat.");
                        }

                        const newStory = this._convertWyvernToStory(charData);
                        const aiChar = newStory.characters.find(c => !c.is_user) || newStory.characters[1];
                        if (aiChar && charData.avatar) {
                            try {
                                let imgRes;
                                try {
                                    imgRes = await fetch(charData.avatar);
                                } catch (e) { /* CORS blocked */ }
                                if (!imgRes || !imgRes.ok) {
                                    try {
                                        imgRes = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(charData.avatar)}`);
                                    } catch (e) { /* Fallback */ }
                                }
                                if (!imgRes || !imgRes.ok) {
                                    imgRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(charData.avatar)}`);
                                }
                                if (imgRes && imgRes.ok) {
                                    const imgBlob = await imgRes.blob();
                                    await DBService.saveImage(aiChar.id, imgBlob);
                                    aiChar.image_id = aiChar.id;
                                    aiChar.image_url = `local_idb_${aiChar.id}`;
                                }
                            } catch (e) { console.warn('[HubController] Failed to download Wyvern avatar image', e); }
                        }

                        await this._saveImportedStory(newStory);

                        // Save mockResult for UI results state
                        const mockResult = {
                            id: id,
                            name: charData.name,
                            tagline: charData.tagline || charData.description?.substring(0, 150) || '',
                            avatarUrl: charData.avatar || '',
                            usageCount: charData.statistics_record?.messages || 0,
                            createdAt: charData.created_at || '',
                            rawWyvernData: charData
                        };
                        this.state.results = [mockResult];
                        this.renderResults();

                    } catch (e) {
                        console.error('[HubController] Wyvern link import error:', e);
                        this.state.searchError = "Import failed: " + e.message;
                        this.state.results = [];
                    } finally {
                        this.state.isLoading = false;
                        this.renderResults();
                    }
                    return;
                }

                // Chub.ai: fetch V2 PNG card from CDN, fall back to corsproxy.io — works in browser
                const chubMatch = trimmed.match(/chub\.ai\/characters\/([^?#\s]+)/);
                if (chubMatch) {
                    const fullPath = chubMatch[1];
                    const cdnUrl = `https://avatars.charhub.io/avatars/${fullPath}/chara_card_v2.png`;

                    this.state.source = 'chub';
                    this.state.isLoading = true;
                    this.state.searchError = null;
                    this.renderResults();

                    try {
                        let blob = null;
                        try {
                            const res = await fetch(cdnUrl);
                            if (res.ok) blob = await res.blob();
                        } catch (e) { /* fall through to proxy */ }

                        if (!blob) {
                            const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(cdnUrl)}`;
                            const res = await fetch(proxyUrl);
                            if (!res.ok) throw new Error(`Could not fetch character card (${res.status})`);
                            blob = await res.blob();
                        }

                        const name = fullPath.split('/').pop() || 'Imported Character';
                        const file = new File([blob], `${name}.png`, { type: 'image/png' });
                        const { story: newStory, imageBlob } = await ImportExportService.parseUploadedFile(file);

                        // CDN PNG omits alternate_greetings — fetch from API and inject as scenarios
                        try {
                            const apiUrl = `https://api.chub.ai/api/characters/${fullPath}?full=true`;
                            let apiRes = null;
                            try {
                                apiRes = await fetch(apiUrl);
                                if (!apiRes.ok) apiRes = null;
                            } catch (e) { /* CORS blocked — fall through to proxy */ }
                            if (!apiRes) {
                                apiRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(apiUrl)}`);
                            }
                            if (apiRes.ok) {
                                const apiData = await apiRes.json();
                                const charData = apiData?.character || apiData?.node?.definition || apiData?.node;
                                const altGreetings = charData?.alternate_greetings;
                                if (Array.isArray(altGreetings) && altGreetings.length > 0 && newStory.scenarios?.length > 0) {
                                    const template = newStory.scenarios[0];
                                    const charName = newStory.characters?.[0]?.name || '';
                                    altGreetings.forEach((greeting, i) => {
                                        const msg = greeting.replace(/\{\{char\}\}/g, charName).replace(/\{\{user\}\}/g, '{user}');
                                        newStory.scenarios.push({
                                            ...JSON.parse(JSON.stringify(template)),
                                            id: crypto.randomUUID(),
                                            name: `Alternate Start ${i + 1}`,
                                            message: msg
                                        });
                                    });
                                }
                            }
                        } catch (e) { /* API unavailable — proceed with PNG data only */ }

                        await this._saveImportedStory(newStory, imageBlob);

                    } catch (e) {
                        console.error('[HubController] Chub link import error:', e);
                        this.state.searchError = "Import failed: " + e.message;
                        this.state.results = [];
                    } finally {
                        this.state.isLoading = false;
                        this.renderResults();
                    }
                    return;
                }

                // Backyard.ai Party / Character: fetch from public tRPC API
                const backyardMatch = trimmed.match(/backyard\.ai\/hub\/character\/([a-zA-Z0-9_-]+)/);
                const backyardPartyMatch = trimmed.match(/backyard\.ai\/hub\/party\/([a-zA-Z0-9_-]+)/);
                if (backyardMatch || backyardPartyMatch) {
                    const id = backyardMatch ? backyardMatch[1] : backyardPartyMatch[1];
                    this.state.source = 'backyard';
                    this.state.isLoading = true;
                    this.state.searchError = null;
                    this.renderResults();

                    try {
                        let newStory = null;
                        let mockResult = null;

                        if (backyardMatch) {
                            const encodedInput = encodeURIComponent(JSON.stringify({ '0': { json: { hubCharacterConfigId: id, includeStandaloneGroupConfig: true } } }));
                            const apiUrl = `https://backyard.ai/api/trpc/hub.browse.getHubCharacterConfigById?batch=1&input=${encodedInput}`;

                            let res;
                            try {
                                res = await fetch(apiUrl);
                            } catch (e) { /* CORS blocked - fall through to proxy */ }
                            if (!res || !res.ok) {
                                try {
                                    res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(apiUrl)}`);
                                } catch (e) { /* Fallback */ }
                            }
                            if (!res || !res.ok) {
                                res = await fetch(`https://corsproxy.io/?${encodeURIComponent(apiUrl)}`);
                            }

                            const dataList = await res.json();
                            const config = dataList[0]?.result?.data?.json;

                            if (!config) throw new Error('Could not parse Backyard character data');

                            const chatConfig = config.standaloneGroupConfig?.PrimaryChat || {};
                            const storyName = config.displayName || config.standaloneGroupConfig?.displayName || config.standaloneGroupConfig?.name || config.name || config.character?.name || 'Imported Backyard Character';
                            const charName = config.name || config.character?.name || 'Imported Backyard Character';
                            const persona = config.persona || config.personality || config.description ||
                                config.character?.persona || config.character?.personality || config.character?.description || '';
                            const firstMsg = chatConfig.HubGreetingMessages?.[0]?.text || config.HubGreetingMessages?.[0]?.text || config.firstMessage || config.first_mes || config.greeting || '';
                            const scenarioLore = chatConfig.context || config.scenario || config.context || '';
                            const avatarUrl = config.Images?.[0]?.imageUrl || config.character?.Images?.[0]?.imageUrl || config.imageUrl || config.avatarUrl || config.avatar_url || config.character?.imageUrl || config.character?.avatarUrl;

                            let exampleDialogue = '';
                            if (chatConfig.HubExampleMessages && Array.isArray(chatConfig.HubExampleMessages)) {
                                exampleDialogue = chatConfig.HubExampleMessages.map(m => {
                                    const isUser = m.role === 'user' || m.characterName?.toLowerCase() === 'user' || m.hubCharacterConfigId === 'global-user-persona';
                                    const speaker = isUser ? '{{user}}' : (m.characterName || '{{char}}');
                                    return `${speaker}: ${m.text}`;
                                }).join('\n');
                            } else if (config.exampleDialogue || config.mes_example || config.character?.exampleDialogue || config.character?.mes_example) {
                                exampleDialogue = config.exampleDialogue || config.mes_example || config.character?.exampleDialogue || config.character?.mes_example || '';
                            }

                            const dynamic_entries = [];
                            if (config.LorebookItems && Array.isArray(config.LorebookItems)) {
                                config.LorebookItems.forEach(item => {
                                    dynamic_entries.push({
                                        id: crypto.randomUUID(),
                                        title: item.key || "Lore",
                                        triggers: item.key || '',
                                        content_fields: [item.value || ''],
                                        current_index: 0,
                                        triggered_at_turn: null
                                    });
                                });
                            }

                            const userChar = UTILITY.getDefaultUserCharacter();
                            const userCharId = userChar.id;

                            const charId = crypto.randomUUID();

                            let modelInstructions = '';
                            if (chatConfig.modelInstructions) {
                                modelInstructions = typeof chatConfig.modelInstructions === 'string' ? chatConfig.modelInstructions : (chatConfig.modelInstructions.customText || '');
                            } else if (config.modelInstructions) {
                                modelInstructions = typeof config.modelInstructions === 'string' ? config.modelInstructions : (config.modelInstructions.customText || '');
                            }

                            if (!modelInstructions) {
                                modelInstructions = chatConfig.systemPrompt ||
                                    chatConfig.system_prompt ||
                                    chatConfig.instruction ||
                                    chatConfig.instructions ||
                                    config.systemPrompt ||
                                    config.system_prompt ||
                                    config.instruction ||
                                    config.instructions ||
                                    config.character?.modelInstructions ||
                                    config.character?.systemPrompt ||
                                    config.character?.system_prompt ||
                                    config.character?.instruction ||
                                    config.character?.instructions ||
                                    '';
                            }
                            if (exampleDialogue) {
                                modelInstructions += `\n\n### Example Dialogue\n${exampleDialogue}`;
                            }

                            newStory = {
                                id: crypto.randomUUID(),
                                name: storyName,
                                description: (config.description || persona || '').substring(0, 100),
                                created_date: new Date().toISOString(),
                                last_modified: new Date().toISOString(),
                                tags: ['Backyard.ai Import'],
                                creator_notes: 'Imported from Backyard.ai URL',
                                characters: [
                                    userChar,
                                    {
                                        id: charId,
                                        name: charName,
                                        is_active: true,
                                        prompt_tags: '',
                                        persona: persona,
                                        description: persona,
                                        image_url: avatarUrl ? `local_idb_${charId}` : '',
                                        model_instructions: modelInstructions
                                    }
                                ],
                                static_entries: [
                                    {
                                        id: crypto.randomUUID(),
                                        title: "Starting Scenario",
                                        content: scenarioLore
                                    }
                                ],
                                dynamic_entries: dynamic_entries,
                                scenarios: [
                                    {
                                        id: crypto.randomUUID(),
                                        name: 'Base Scenario',
                                        description: 'Imported from Backyard',
                                        characters: [userCharId, charId],
                                        message: firstMsg,
                                        initial_message: firstMsg,
                                        scenario_knowledge: scenarioLore,
                                        world_lore: scenarioLore,
                                        player_context: '',
                                        system_prompt_additions: modelInstructions
                                    }
                                ],
                                narratives: []
                            };

                            if (avatarUrl) {
                                try {
                                    let imgRes;
                                    try {
                                        imgRes = await fetch(avatarUrl);
                                    } catch (e) { /* CORS blocked */ }
                                    if (!imgRes || !imgRes.ok) {
                                        try {
                                            imgRes = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(avatarUrl)}`);
                                        } catch (e) { /* Fallback */ }
                                    }
                                    if (!imgRes || !imgRes.ok) {
                                        imgRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(avatarUrl)}`);
                                    }
                                    const imgBlob = await imgRes.blob();
                                    await DBService.saveImage(charId, imgBlob);
                                    newStory.characters[1].image_id = charId;
                                    newStory.characters[1].image_url = `local_idb_${charId}`;
                                } catch (e) { console.warn('[HubController] Failed to download backyard image', e); }
                            }

                            mockResult = {
                                id: id,
                                name: storyName,
                                tagline: config.description || '',
                                avatarUrl: avatarUrl || '',
                                usageCount: config.messageCount || 0,
                                createdAt: config.createdAt || new Date().toISOString(),
                                isParty: false
                            };

                        } else {
                            // Backyard Party match
                            const encodedInput = encodeURIComponent(JSON.stringify({ '0': { json: { hubGroupConfigId: id } } }));
                            const apiUrl = `https://backyard.ai/api/trpc/hub.browse.getHubGroupConfigById?batch=1&input=${encodedInput}`;

                            let res;
                            try {
                                res = await fetch(apiUrl);
                            } catch (e) { /* CORS blocked - fall through to proxy */ }
                            if (!res || !res.ok) {
                                try {
                                    res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(apiUrl)}`);
                                } catch (e) { /* Fallback */ }
                            }
                            if (!res || !res.ok) {
                                res = await fetch(`https://corsproxy.io/?${encodeURIComponent(apiUrl)}`);
                            }

                            const dataList = await res.json();
                            const config = dataList[0]?.result?.data?.json;

                            if (!config) throw new Error('Could not parse Backyard party data');

                            const chatConfig = config.PrimaryChat || {};
                            const name = config.name || 'Imported Backyard Party';

                            let firstMsg = chatConfig.HubGreetingMessages?.[0]?.text || config.firstMessage || config.first_mes || config.greeting || '';
                            const scenarioLore = chatConfig.context || config.scenario || '';

                            const userChar = UTILITY.getDefaultUserCharacter();
                            const userCharId = userChar.id;

                            const characters = [userChar];
                            const charIds = [userCharId];
                            const dynamic_entries = [];

                            let partyModelInstructions = '';
                            if (chatConfig.modelInstructions) {
                                if (typeof chatConfig.modelInstructions === 'string') {
                                    partyModelInstructions = chatConfig.modelInstructions;
                                } else if (chatConfig.modelInstructions.customText) {
                                    partyModelInstructions = chatConfig.modelInstructions.customText;
                                }
                            }
                            if (!partyModelInstructions) {
                                partyModelInstructions = chatConfig.systemPrompt || chatConfig.system_prompt || chatConfig.instruction || chatConfig.instructions ||
                                    config.modelInstructions || config.systemPrompt || config.system_prompt || config.instruction || config.instructions || '';
                            }

                            const charConfigs = config.CharacterConfigs || [];
                            if (!firstMsg) {
                                for (const c of charConfigs) {
                                    firstMsg = c.firstMessage || c.first_mes || c.greeting || c.character?.firstMessage || c.character?.first_mes || c.character?.greeting || '';
                                    if (firstMsg) break;
                                }
                            }

                            for (const c of charConfigs) {
                                const charId = crypto.randomUUID();
                                charIds.push(charId);

                                const charName = c.name || c.character?.name || 'Group Character';
                                const charPersona = c.persona || c.personality || c.description ||
                                    c.character?.persona || c.character?.personality || c.character?.description || '';

                                let charModelInstructions = '';
                                if (c.modelInstructions) {
                                    charModelInstructions = typeof c.modelInstructions === 'string' ? c.modelInstructions : (c.modelInstructions.customText || '');
                                } else if (c.character?.modelInstructions) {
                                    charModelInstructions = typeof c.character.modelInstructions === 'string' ? c.character.modelInstructions : (c.character.modelInstructions.customText || '');
                                }

                                if (!charModelInstructions) {
                                    charModelInstructions = c.systemPrompt || c.system_prompt || c.instruction || c.instructions ||
                                        c.character?.systemPrompt || c.character?.system_prompt || c.character?.instruction || c.character?.instructions ||
                                        partyModelInstructions;
                                }

                                let exampleDialogue = '';
                                if (chatConfig.HubExampleMessages && Array.isArray(chatConfig.HubExampleMessages)) {
                                    exampleDialogue = chatConfig.HubExampleMessages.map(m => {
                                        const isUser = m.role === 'user' || m.characterName?.toLowerCase() === 'user' || m.hubCharacterConfigId === 'global-user-persona';
                                        const speaker = isUser ? '{{user}}' : (m.characterName || '{{char}}');
                                        return `${speaker}: ${m.text}`;
                                    }).join('\n');
                                } else if (c.exampleDialogue || c.mes_example || c.character?.exampleDialogue || c.character?.mes_example) {
                                    exampleDialogue = c.exampleDialogue || c.mes_example || c.character?.exampleDialogue || c.character?.mes_example || '';
                                }

                                if (exampleDialogue) {
                                    charModelInstructions += `\n\n### Example Dialogue\n${exampleDialogue}`;
                                }

                                const charObj = {
                                    id: charId,
                                    name: charName,
                                    is_active: true,
                                    prompt_tags: '',
                                    persona: charPersona,
                                    description: charPersona,
                                    model_instructions: charModelInstructions
                                };

                                const avatarUrl = c.Images?.[0]?.imageUrl || c.character?.Images?.[0]?.imageUrl || c.avatarUrl || c.character?.avatarUrl;
                                if (avatarUrl) {
                                    try {
                                        let imgRes;
                                        try {
                                            imgRes = await fetch(avatarUrl);
                                        } catch (e) { /* CORS blocked */ }
                                        if (!imgRes || !imgRes.ok) {
                                            try {
                                                imgRes = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(avatarUrl)}`);
                                            } catch (e) { /* Fallback */ }
                                        }
                                        if (!imgRes || !imgRes.ok) {
                                            imgRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(avatarUrl)}`);
                                        }
                                        const imgBlob = await imgRes.blob();
                                        await DBService.saveImage(charId, imgBlob);
                                        charObj.image_id = charId;
                                    } catch (e) { console.warn('[HubController] Failed to download backyard character image', e); }
                                }

                                characters.push(charObj);

                                const lorebookItems = c.LorebookItems || c.character?.LorebookItems || [];
                                if (Array.isArray(lorebookItems)) {
                                    lorebookItems.forEach(item => {
                                        dynamic_entries.push({
                                            id: crypto.randomUUID(),
                                            title: item.key || "Lore",
                                            triggers: item.key || '',
                                            content_fields: [item.value || ''],
                                            current_index: 0,
                                            triggered_at_turn: null
                                        });
                                    });
                                }
                            }

                            if (characters.length === 1) {
                                const charId = crypto.randomUUID();
                                charIds.push(charId);
                                characters.push({
                                    id: charId,
                                    name: 'Narrator',
                                    is_active: true,
                                    prompt_tags: '',
                                    persona: 'The Storyteller.',
                                    description: 'The Storyteller.',
                                    model_instructions: 'Describe the world and active scenes.'
                                });
                            }

                            newStory = {
                                id: crypto.randomUUID(),
                                name: name,
                                description: config.tagline || config.creatorNotes?.substring(0, 100) || '',
                                created_date: new Date().toISOString(),
                                last_modified: new Date().toISOString(),
                                tags: ['Backyard.ai Party Import'],
                                creator_notes: config.creatorNotes || 'Imported from Backyard.ai Party URL',
                                characters: characters,
                                static_entries: [
                                    {
                                        id: crypto.randomUUID(),
                                        title: "Starting Scenario",
                                        content: scenarioLore
                                    }
                                ],
                                dynamic_entries: dynamic_entries,
                                scenarios: [
                                    {
                                        id: crypto.randomUUID(),
                                        name: 'Base Scenario',
                                        description: 'Imported from Backyard Party',
                                        characters: charIds,
                                        message: firstMsg,
                                        initial_message: firstMsg,
                                        scenario_knowledge: scenarioLore,
                                        world_lore: scenarioLore,
                                        player_context: '',
                                        system_prompt_additions: partyModelInstructions
                                    }
                                ],
                                narratives: []
                            };

                            mockResult = {
                                id: id,
                                name: name,
                                tagline: config.tagline || '',
                                avatarUrl: '',
                                usageCount: 0,
                                createdAt: new Date().toISOString(),
                                isParty: true
                            };
                        }

                        await this._saveImportedStory(newStory);

                        this.state.results = [mockResult];
                        this.renderResults();

                    } catch (e) {
                        console.error('[HubController] Backyard link import error:', e);
                        this.state.searchError = "Import failed: " + e.message;
                        this.state.results = [];
                    } finally {
                        this.state.isLoading = false;
                        this.renderResults();
                    }
                    return;
                }

                // AIDungeon: fetch from public GraphQL endpoint using anonymous Firebase auth
                const aidungeonMatch = trimmed.match(/(?:play\.)?aidungeon\.com\/scenario\/([^/?#\s]+)/);
                if (aidungeonMatch) {
                    const shortId = aidungeonMatch[1];
                    this.state.source = 'aidungeon';
                    this.state.isLoading = true;
                    this.state.searchError = null;
                    this.renderResults();

                    try {
                        // Step 1: Sign up anonymously to get Firebase ID token
                        const apiKey = 'AIzaSyCnvo_XFPmAabrDkOKBRpbivp5UH8r_3mg';
                        const authUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`;
                        const authRes = await fetch(authUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ returnSecureToken: true })
                        });
                        if (!authRes.ok) {
                            if (authRes.status === 403) {
                                throw new Error('Failed to authenticate anonymously with AI Dungeon (403 Forbidden). Browser CORS/Referrer security restrictions prevent direct imports. Please use the EllipsisLM Desktop App to import AI Dungeon links seamlessly.');
                            }
                            throw new Error('Failed to authenticate anonymously with AI Dungeon Firebase');
                        }
                        const authData = await authRes.json();
                        const idToken = authData.idToken;

                        if (!idToken) throw new Error('Failed to obtain AI Dungeon authorization token');

                        // Step 2: Query the scenario/adventure configuration via playAdventure GraphQL mutation
                        const graphqlUrl = 'https://api.aidungeon.com/graphql';
                        const query = `
                            mutation StartPlayAdventure($scenarioShortId: String!) {
                                playAdventure(scenarioShortId: $scenarioShortId) {
                                    code
                                    success
                                    message
                                    adventure {
                                        id
                                        title
                                        description
                                        memory
                                        authorsNote
                                        thirdPerson
                                        storyCards {
                                            id
                                            keys
                                            value
                                            type
                                            title
                                            description
                                        }
                                        read {
                                            actions {
                                                id
                                                text
                                                type
                                            }
                                        }
                                    }
                                }
                            }
                        `;

                        const gqlRes = await fetch(graphqlUrl, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `firebase ${idToken}`
                            },
                            body: JSON.stringify({
                                query,
                                variables: { scenarioShortId: shortId }
                            })
                        });

                        if (!gqlRes.ok) throw new Error(`AI Dungeon API returned ${gqlRes.status}: ${gqlRes.statusText}`);
                        const gqlData = await gqlRes.json();

                        if (gqlData.errors && gqlData.errors.length > 0) {
                            throw new Error(gqlData.errors[0].message);
                        }

                        const adventure = gqlData.data?.playAdventure?.adventure;
                        if (!adventure) {
                            const errMsg = gqlData.data?.playAdventure?.message || 'Scenario details could not be retrieved. Ensure it is public.';
                            throw new Error(errMsg);
                        }

                        const name = adventure.title || 'Imported AI Dungeon Scenario';
                        const description = adventure.description || 'Imported from AI Dungeon';
                        const scenarioLore = adventure.memory || '';
                        const systemPromptAdds = adventure.authorsNote ? `[Author's Note: ${adventure.authorsNote}]` : '';

                        // Retrieve the first action starting message
                        let firstMsg = 'The story begins...';
                        if (adventure.read && adventure.read.actions && Array.isArray(adventure.read.actions)) {
                            const startAction = adventure.read.actions.find(act => act.type === 'start' || act.id === '0');
                            if (startAction && startAction.text) {
                                firstMsg = startAction.text;
                            } else if (adventure.read.actions[0] && adventure.read.actions[0].text) {
                                firstMsg = adventure.read.actions[0].text;
                            }
                        }

                        // Map storyCards to dynamic_entries
                        const dynamic_entries = [];
                        if (adventure.storyCards && Array.isArray(adventure.storyCards)) {
                            adventure.storyCards.forEach(card => {
                                dynamic_entries.push({
                                    id: crypto.randomUUID(),
                                    title: card.title || card.keys || 'Lorebook Item',
                                    triggers: card.keys || '',
                                    content_fields: [card.value || card.description || ''],
                                    current_index: 0,
                                    triggered_at_turn: null
                                });
                            });
                        }

                        const userChar = UTILITY.getDefaultUserCharacter();
                        const userCharId = userChar.id;

                        const charId = crypto.randomUUID();
                        const newStory = {
                            id: crypto.randomUUID(),
                            name: name,
                            description: description.substring(0, 200),
                            created_date: new Date().toISOString(),
                            last_modified: new Date().toISOString(),
                            tags: ['AI Dungeon Import'],
                            creator_notes: 'Imported from AIDungeon.com scenario share link.',
                            characters: [
                                userChar,
                                {
                                    id: charId,
                                    name: 'Narrator',
                                    is_active: true,
                                    prompt_tags: '',
                                    persona: 'The Storyteller.',
                                    description: 'The Storyteller.',
                                    model_instructions: 'You are the Narrator. Describe the actions and world vividly.',
                                    is_narrator: true
                                }
                            ],
                            static_entries: [
                                {
                                    id: crypto.randomUUID(),
                                    title: "Starting Scenario",
                                    content: scenarioLore
                                }
                            ],
                            dynamic_entries: dynamic_entries,
                            scenarios: [
                                {
                                    id: crypto.randomUUID(),
                                    name: 'Base Scenario',
                                    description: 'Imported from AI Dungeon',
                                    characters: [userCharId, charId],
                                    message: firstMsg,
                                    initial_message: firstMsg,
                                    scenario_knowledge: scenarioLore,
                                    world_lore: scenarioLore,
                                    player_context: '',
                                    system_prompt_additions: systemPromptAdds
                                }
                            ],
                            narratives: []
                        };

                        await this._saveImportedStory(newStory);

                        // Save mockResult for the UI results state
                        const mockResult = {
                            id: shortId,
                            name: name,
                            tagline: description,
                            avatarUrl: '',
                            usageCount: 0,
                            createdAt: new Date().toISOString()
                        };
                        this.state.results = [mockResult];
                        this.renderResults();

                    } catch (e) {
                        console.error('[HubController] AI Dungeon link import error:', e);
                        this.state.searchError = "Import failed: " + e.message;
                        this.state.results = [];
                    } finally {
                        this.state.isLoading = false;
                        this.renderResults();
                    }
                    return;
                }

                // FictionLab: fetch from public Svelte REST API with robust proxy fallbacks
                if (trimmed.includes('fictionlab.ai')) {
                    this.state.source = 'fictionlab';
                    this.state.isLoading = true;
                    this.state.searchError = null;
                    this.renderResults();

                    try {
                        const uuidMatch = trimmed.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
                        if (!uuidMatch) throw new Error("Could not find a valid scenario ID in the FictionLab URL.");
                        const scenarioId = uuidMatch[0];

                        const apiUrl = `https://fictionlab.ai/api/scenario/fetch/${scenarioId}?token=null&version=2`;

                        let res;
                        try {
                            res = await fetch(apiUrl);
                        } catch (e) { /* CORS blocked - fall through to proxy */ }
                        if (!res || !res.ok) {
                            try {
                                res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(apiUrl)}`);
                            } catch (e) { /* Fallback */ }
                        }
                        if (!res || !res.ok) {
                            res = await fetch(`https://corsproxy.io/?${encodeURIComponent(apiUrl)}`);
                        }

                        if (!res || !res.ok) {
                            throw new Error(`Failed to fetch FictionLab API data (${res ? res.status : 'Network Error'}).`);
                        }

                        const sourceData = await res.json();
                        if (!sourceData || !sourceData.displayName) {
                            throw new Error("Invalid or empty scenario data returned from FictionLab.");
                        }

                        const name = sourceData.displayName || "Imported Character";
                        const description = sourceData.description || "Imported from FictionLab";
                        const persona = sourceData.backStory || "";
                        const firstMsg = sourceData.customGreeting || "...";
                        const avatarFilename = sourceData.avatarURL || "";
                        const avatarUrl = avatarFilename ? `https://fictionlab.ai/image-cdn/${avatarFilename}` : "";

                        const mockId = scenarioId; // Use the actual scenario ID
                        const mockResult = {
                            id: mockId,
                            name: name,
                            tagline: description,
                            avatarUrl: avatarUrl,
                            usageCount: 0,
                            createdAt: new Date().toISOString(),
                            rawScenarioData: sourceData
                        };

                        this.state.results = [mockResult];
                        this.renderResults();

                        const details = {
                            source: 'fictionlab',
                            persona: persona,
                            firstMsg: firstMsg,
                            scenario: sourceData.backStory || "",
                            exampleDialogue: "",
                            systemPrompt: sourceData.customInstructions || ""
                        };

                        const overlay = document.getElementById('hub-character-details');
                        if (overlay) {
                            overlay.innerHTML = UIComponents.HubCharacterDetail(mockResult, details);
                            overlay.classList.remove('hidden');
                        }

                    } catch (e) {
                        console.error('[HubController] Import Link error:', e);
                        this.state.searchError = "Failed to extract data: " + e.message;
                        this.state.results = [];
                        this.renderResults();
                    } finally {
                        this.state.isLoading = false;
                    }
                    return;
                }

                alert("Supported URL sources: chub.ai, backyard.ai, aidungeon.com, fictionlab.ai, or wyvern.chat");
            },

            async viewDetails(valStr) {
                const { id, source } = JSON.parse(valStr);
                const char = this.state.results.find(c => String(c.id) === String(id));
                if (!char) return;

                const overlay = document.getElementById('hub-character-details');
                if (!overlay) return;

                overlay.innerHTML = '<div class="flex-grow flex items-center justify-center"><div class="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div></div>';
                overlay.classList.remove('hidden');

                try {
                    let details = { source };
                    if (source === 'chub') {
                        // Fetch full character data for Chub to get persona and first message
                        try {
                            const res = await fetch(`https://api.chub.ai/api/characters/${char.fullPath}?full=true`);
                            const data = await res.json();
                            const charData = data?.character || data?.node?.definition || data?.node;
                            if (charData) {
                                details.persona = charData.personality || charData.description || charData.definition || charData.persona || "";
                                details.firstMsg = charData.first_message || charData.first_mes || "";
                                details.scenario = charData.scenario || "";
                                details.exampleDialogue = charData.example_dialogs || charData.mes_example || charData.definition?.example_dialogs || "";
                                details.systemPrompt = charData.system_prompt || "";
                                details.postHistoryInstructions = charData.post_history_instructions || "";
                                details.alternateGreetings = charData.alternate_greetings || [];

                                // Ensure topics are picked up if available in the detail fetch too
                                if (data?.node?.topics && (!char.topics || char.topics.length === 0)) {
                                    char.topics = data.node.topics;
                                }
                            } else {
                                details.persona = "";
                            }
                        } catch (e) {
                            console.error('[HubController] Chub detail fetch error:', e);
                            details.persona = "";
                        }
                    } else if (source === 'backyard') {
                        let config;
                        if (char.isParty) {
                            const encodedInput = encodeURIComponent(JSON.stringify({ '0': { json: { hubGroupConfigId: id } } }));
                            const apiUrl = `https://backyard.ai/api/trpc/hub.browse.getHubGroupConfigById?batch=1&input=${encodedInput}`;
                            let res;
                            try {
                                res = await fetch(apiUrl);
                            } catch (e) { /* CORS blocked */ }
                            if (!res || !res.ok) {
                                try {
                                    res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(apiUrl)}`);
                                } catch (e) { /* Fallback */ }
                            }
                            if (!res || !res.ok) {
                                res = await fetch(`https://corsproxy.io/?${encodeURIComponent(apiUrl)}`);
                            }
                            const dataList = await res.json();
                            config = dataList[0]?.result?.data?.json;
                        } else {
                            const encodedInput = encodeURIComponent(JSON.stringify({ '0': { json: { hubCharacterConfigId: id, includeStandaloneGroupConfig: true } } }));
                            const apiUrl = `https://backyard.ai/api/trpc/hub.browse.getHubCharacterConfigById?batch=1&input=${encodedInput}`;
                            let res;
                            try {
                                res = await fetch(apiUrl);
                            } catch (e) { /* CORS blocked */ }
                            if (!res || !res.ok) {
                                try {
                                    res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(apiUrl)}`);
                                } catch (e) { /* Fallback */ }
                            }
                            if (!res || !res.ok) {
                                res = await fetch(`https://corsproxy.io/?${encodeURIComponent(apiUrl)}`);
                            }
                            const dataList = await res.json();
                            config = dataList[0]?.result?.data?.json;
                        }

                        if (config) {
                            if (char.isParty) {
                                const chatConfig = config.PrimaryChat || {};
                                details.persona = (config.CharacterConfigs || []).map(c => `[${c.name}]\n${c.persona || ''}`).join('\n\n');
                                details.firstMsg = chatConfig.HubGreetingMessages?.[0]?.text || "";
                                details.scenario = chatConfig.context || "";
                                details.exampleDialogue = (chatConfig.HubExampleMessages || []).map(m => `${m.role === 'user' ? '{{user}}' : '{{char}}'}: ${m.text}`).join('\n') || "";
                            } else {
                                const chatConfig = config.standaloneGroupConfig?.PrimaryChat || {};
                                details.persona = config.persona || "";
                                details.firstMsg = chatConfig.HubGreetingMessages?.[0]?.text || config.HubGreetingMessages?.[0]?.text || "";
                                details.scenario = chatConfig.context || config.scenario || "";
                                details.exampleDialogue = (chatConfig.HubExampleMessages || []).map(m => `${m.role === 'user' ? '{{user}}' : '{{char}}'}: ${m.text}`).join('\n') || "";
                            }
                        }
                    } else if (source === 'aidungeon') {
                        try {
                            const apiKey = 'AIzaSyCnvo_XFPmAabrDkOKBRpbivp5UH8r_3mg';
                            const authUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`;
                            const authRes = await fetch(authUrl, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ returnSecureToken: true })
                            });
                            if (authRes.ok) {
                                const authData = await authRes.json();
                                const idToken = authData.idToken;
                                if (idToken) {
                                    const graphqlUrl = 'https://api.aidungeon.com/graphql';
                                    const query = `
                                        mutation StartPlayAdventure($scenarioShortId: String!) {
                                            playAdventure(scenarioShortId: $scenarioShortId) {
                                                adventure {
                                                    title
                                                    description
                                                    memory
                                                    authorsNote
                                                }
                                            }
                                        }
                                    `;
                                    const gqlRes = await fetch(graphqlUrl, {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'Authorization': `firebase ${idToken}`
                                        },
                                        body: JSON.stringify({
                                            query,
                                            variables: { scenarioShortId: id }
                                        })
                                    });
                                    if (gqlRes.ok) {
                                        const gqlData = await gqlRes.json();
                                        const adventure = gqlData.data?.playAdventure?.adventure;
                                        if (adventure) {
                                            details.persona = adventure.description || '';
                                            details.scenario = adventure.memory || '';
                                            details.systemPrompt = adventure.authorsNote || '';
                                        }
                                    }
                                }
                            }
                        } catch (e) { console.error('[HubController] AIDungeon detail fetch error:', e); }
                    } else if (source === 'fictionlab') {
                        details.persona = char.rawScenarioData?.backStory || char.tagline || '';
                        details.firstMsg = char.rawScenarioData?.customGreeting || '';
                        details.scenario = char.rawScenarioData?.backStory || '';
                        details.systemPrompt = char.rawScenarioData?.customInstructions || '';
                    } else if (source === 'wyvern') {
                        let charData = char.rawWyvernData;
                        if (!charData) {
                            try {
                                const apiUrl = `https://api.wyvern.chat/characters/${id}`;
                                let res;
                                try {
                                    res = await fetch(apiUrl);
                                } catch (e) { /* CORS blocked */ }
                                if (!res || !res.ok) {
                                    try {
                                        res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(apiUrl)}`);
                                    } catch (e) { /* Fallback */ }
                                }
                                if (!res || !res.ok) {
                                    res = await fetch(`https://corsproxy.io/?${encodeURIComponent(apiUrl)}`);
                                }
                                if (res.ok) {
                                    charData = await res.json();
                                    char.rawWyvernData = charData;
                                }
                            } catch (e) {
                                console.error('[HubController] Wyvern detail fetch error:', e);
                            }
                        }

                        if (charData) {
                            details.persona = charData.description || charData.personality || "";
                            details.firstMsg = charData.first_mes || charData.first_message || "";
                            details.scenario = charData.scenario || "";
                            details.exampleDialogue = charData.mes_example || "";
                            details.systemPrompt = [
                                charData.character_note,
                                charData.pre_history_instructions,
                                charData.post_history_instructions
                            ].filter(Boolean).join("\n\n");
                            details.alternateGreetings = charData.alternate_greetings || [];
                        } else {
                            details.persona = char.tagline || "";
                        }
                    }
                    overlay.innerHTML = UIComponents.HubCharacterDetail(char, details);
                } catch (e) {
                    console.error('[HubController] Details error:', e);
                    overlay.innerHTML = `<div class="p-8 text-center"><p class="text-red-400 mb-4">Failed to load details: ${e.message}</p><button data-action="close-hub-details" class="bg-gray-800 text-white px-4 py-2 rounded-lg">Close</button></div>`;
                }
            },

            closeDetails() {
                const overlay = document.getElementById('hub-character-details');
                if (overlay) {
                    overlay.classList.add('hidden');
                    overlay.innerHTML = '';
                }
            },

            async getBackyardBuildId() {
                if (this.state.backyardBuildId) return this.state.backyardBuildId;
                try {
                    const res = await fetch('https://backyard.ai/hub');
                    const text = await res.text();

                    // Try to find in __NEXT_DATA__ script tag first (most reliable)
                    const nextDataMatch = text.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
                    if (nextDataMatch) {
                        try {
                            const nextData = JSON.parse(nextDataMatch[1]);
                            if (nextData.buildId) {
                                this.state.backyardBuildId = nextData.buildId;
                                return nextData.buildId;
                            }
                        } catch (e) { console.warn('[HubController] Failed to parse __NEXT_DATA__ for buildId', e); }
                    }

                    // Fallback to direct regex match
                    const match = text.match(/"buildId":"([^"]+)"/);
                    if (match) {
                        this.state.backyardBuildId = match[1];
                        return match[1];
                    }
                } catch (e) {
                    console.error('[HubController] Failed to fetch Backyard.ai build ID', e);
                    throw new Error('Backyard.ai search is currently restricted by browser CORS security. This feature works natively when running EllipsisLM in Electron. If you are in a browser, searching Backyard.ai is not possible due to cross-origin security policies.');
                }
                return null;
            },

            async search() {
                const input = document.getElementById('hub-search-input');
                if (input) this.state.query = input.value.trim();
                if (!this.state.query) return;

                const sourceSelect = document.getElementById('hub-source-select');
                if (sourceSelect) this.state.source = sourceSelect.value;
                const sortSelect = document.getElementById('hub-sort-select');
                if (sortSelect) this.state.sort = sortSelect.value;

                this.state.isLoading = true;
                this.state.searchError = null;
                this.renderResults();

                try {
                    if (this.state.source === 'chub') {
                        // Map the UI sort keys to Chub API sort keys
                        const chubSortMap = {
                            'relevance': '',
                            'created_at': 'created_at',
                            'usage_count': 'msgs_user', // Chub's recognized sort key for total message volume
                            'name': 'name'
                        };
                        const sortKey = chubSortMap[this.state.sort] || '';
                        const sortParam = sortKey ? `&sort=${sortKey}&order=desc` : '';

                        const res = await fetch(`https://api.chub.ai/search?search=${encodeURIComponent(this.state.query)}&first=50${sortParam}`);
                        if (!res.ok) throw new Error(`Chub API returned ${res.status}: ${res.statusText}`);

                        const data = await res.json();
                        const nodes = data?.data?.nodes || [];
                        this.state.results = nodes.map(n => ({
                            id: n.id,
                            name: n.name,
                            tagline: n.tagline || n.description || '',
                            avatarUrl: n.avatar_url || '',
                            maxResUrl: n.max_res_url || '',
                            fullPath: n.fullPath || '',
                            usageCount: n.nMessages || n.usage_count || 0,
                            createdAt: n.createdAt || n.created_at,
                            topics: n.topics || []
                        }));
                    } else if (this.state.source === 'backyard') {
                        const buildId = await this.getBackyardBuildId();
                        if (!buildId) throw new Error('Could not find Backyard.ai build ID');

                        const res = await fetch(`https://backyard.ai/_next/data/${buildId}/en/hub/search.json?q=${encodeURIComponent(this.state.query)}`);
                        const data = await res.json();

                        let configs = [];

                        // Try modern structure first (tRPC pages)
                        const trpcPages = data?.pageProps?.trpcState?.json?.queries?.find(q => q.state?.data?.pages)?.state?.data?.pages;
                        const hubData = trpcPages?.[0]?.hubGroupConfigs || data?.pageProps?.hubSearchData;

                        if (hubData && Array.isArray(hubData)) {
                            configs = hubData;
                        } else {
                            // Fallback to recursive extraction for older/alternative structures
                            const extractConfigs = (obj) => {
                                if (!obj) return;
                                if (Array.isArray(obj)) obj.forEach(extractConfigs);
                                else if (typeof obj === 'object') {
                                    if (obj.hubGroupConfigs && Array.isArray(obj.hubGroupConfigs)) {
                                        configs = configs.concat(obj.hubGroupConfigs);
                                    } else {
                                        Object.values(obj).forEach(extractConfigs);
                                    }
                                }
                            };
                            extractConfigs(data);
                        }

                        // Client-side sorting for Backyard
                        if (this.state.sort === 'name') {
                            configs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                        } else if (this.state.sort === 'usage_count') {
                            configs.sort((a, b) => (b.messageCount || 0) - (a.messageCount || 0));
                        } else if (this.state.sort === 'created_at') {
                            configs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
                        }

                        this.state.results = configs.map(n => ({
                            id: n.hubCharacterConfigs?.[0]?.id || n.id,
                            name: n.name,
                            tagline: n.description || n.tagline || '',
                            avatarUrl: n.iconUrl || (n.hubCharacterConfigs?.[0]?.imageUrl) || '',
                            usageCount: n.messageCount || n.numTotalCharacters,
                            createdAt: n.createdAt
                        })).filter(r => r.id);
                    } else if (this.state.source === 'wyvern') {
                        const sortMap = {
                            'relevance': '',
                            'created_at': 'created_at',
                            'usage_count': 'messages',
                            'name': 'name'
                        };
                        const sortKey = sortMap[this.state.sort] || '';
                        const sortParam = sortKey ? `&sort=${sortKey}` : '';
                        const orderParam = '&order=DESC';

                        const apiUrl = `https://api.wyvern.chat/characters/public?page=1&limit=50&query=${encodeURIComponent(this.state.query)}${sortParam}${orderParam}`;

                        let res;
                        try {
                            res = await fetch(apiUrl);
                        } catch (e) { /* CORS blocked */ }
                        if (!res || !res.ok) {
                            try {
                                res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(apiUrl)}`);
                            } catch (e) { /* Fallback */ }
                        }
                        if (!res || !res.ok) {
                            res = await fetch(`https://corsproxy.io/?${encodeURIComponent(apiUrl)}`);
                        }
                        if (!res || !res.ok) throw new Error(`Wyvern API returned ${res ? res.status : 'Network Error'}`);

                        const data = await res.json();
                        const characters = data?.characters || [];
                        this.state.results = characters.map(c => ({
                            id: c._id,
                            name: c.name,
                            tagline: c.tagline || c.description?.substring(0, 150) || '',
                            avatarUrl: c.avatar || '',
                            usageCount: c.statistics_record?.messages || 0,
                            createdAt: c.created_at || '',
                            rawWyvernData: c
                        }));
                    }
                } catch (e) {
                    console.error('[HubController] Search error:', e);
                    this.state.searchError = e.message;
                    this.state.results = [];
                } finally {
                    this.state.isLoading = false;
                    this.renderResults();
                }
            },

            renderResults() {
                const container = document.getElementById('hub-results-grid');
                if (!container) return;

                if (this.state.isLoading) {
                    container.innerHTML = '<div class="col-span-full flex justify-center py-12"><div class="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div></div>';
                    return;
                }

                if (this.state.searchError) {
                    const isCors = this.state.searchError.toLowerCase().includes('cors') || this.state.searchError.toLowerCase().includes('security');
                    container.innerHTML = `
                        <div class="col-span-full flex flex-col items-center justify-center py-12 px-6 text-center">
                            <div class="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-4 border border-red-500/20">
                                <svg class="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                            </div>
                            <h3 class="text-white font-bold text-lg mb-2">${isCors ? 'Search Restriction' : 'Search Error'}</h3>
                            <p class="text-gray-400 text-sm max-w-md leading-relaxed mb-6">
                                ${this.state.searchError}
                            </p>
                            ${isCors ? `
                                <div class="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-xl text-xs text-indigo-300 max-w-sm">
                                    <strong>Recommendation:</strong> Use the <strong>Chub.ai</strong> source instead, or run EllipsisLM in <strong>Electron</strong> to bypass browser security blocks.
                                </div>
                            ` : ''}
                        </div>
                    `;
                    return;
                }

                if (this.state.results.length === 0) {
                    container.innerHTML = '<div class="col-span-full text-center py-12 text-gray-500">No characters found. Try a different search term.</div>';
                    return;
                }

                container.innerHTML = this.state.results.map(char => UIComponents.HubCharacterCard(char, this.state.source)).join('');
            },

            async importCharacter(valStr) {
                let parsed;
                try { parsed = JSON.parse(valStr); } catch { return; }
                const { id, source } = parsed;
                const char = this.state.results.find(c => String(c.id) === String(id));
                if (!char) return;

                UIManager.showLoadingSpinner('Importing Character...');
                try {
                    if (source === 'chub') {
                        if (!char.maxResUrl) throw new Error('Character does not have a V2 PNG card.');

                        const res = await fetch(char.maxResUrl);
                        const blob = await res.blob();
                        const file = new File([blob], `${char.name}.png`, { type: 'image/png' });

                        const { story: newStory, imageBlob } = await ImportExportService.parseUploadedFile(file);
                        await this._saveImportedStory(newStory, imageBlob);

                    } else if (source === 'backyard') {
                        let newStory = null;
                        if (char && char.isParty) {
                            const encodedInput = encodeURIComponent(JSON.stringify({ '0': { json: { hubGroupConfigId: id } } }));
                            const apiUrl = `https://backyard.ai/api/trpc/hub.browse.getHubGroupConfigById?batch=1&input=${encodedInput}`;

                            let res;
                            try {
                                res = await fetch(apiUrl);
                            } catch (e) { /* CORS blocked - fall through to proxy */ }
                            if (!res || !res.ok) {
                                try {
                                    res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(apiUrl)}`);
                                } catch (e) { /* Fallback */ }
                            }
                            if (!res || !res.ok) {
                                res = await fetch(`https://corsproxy.io/?${encodeURIComponent(apiUrl)}`);
                            }

                            const dataList = await res.json();
                            const config = dataList[0]?.result?.data?.json;

                            if (!config) throw new Error('Could not parse Backyard party data');

                            const chatConfig = config.PrimaryChat || {};
                            const name = config.name || 'Imported Backyard Party';

                            let firstMsg = chatConfig.HubGreetingMessages?.[0]?.text || config.firstMessage || config.first_mes || config.greeting || '';
                            const scenarioLore = chatConfig.context || config.scenario || '';

                            const userChar = UTILITY.getDefaultUserCharacter();
                            const userCharId = userChar.id;

                            const characters = [userChar];
                            const charIds = [userCharId];
                            const dynamic_entries = [];

                            let partyModelInstructions = '';
                            if (chatConfig.modelInstructions) {
                                if (typeof chatConfig.modelInstructions === 'string') {
                                    partyModelInstructions = chatConfig.modelInstructions;
                                } else if (chatConfig.modelInstructions.customText) {
                                    partyModelInstructions = chatConfig.modelInstructions.customText;
                                }
                            }
                            if (!partyModelInstructions) {
                                partyModelInstructions = chatConfig.systemPrompt || chatConfig.system_prompt || chatConfig.instruction || chatConfig.instructions ||
                                    config.modelInstructions || config.systemPrompt || config.system_prompt || config.instruction || config.instructions || '';
                            }

                            const charConfigs = config.CharacterConfigs || [];
                            if (!firstMsg) {
                                for (const c of charConfigs) {
                                    firstMsg = c.firstMessage || c.first_mes || c.greeting || c.character?.firstMessage || c.character?.first_mes || c.character?.greeting || '';
                                    if (firstMsg) break;
                                }
                            }

                            for (const c of charConfigs) {
                                const charId = crypto.randomUUID();
                                charIds.push(charId);

                                const charName = c.name || c.character?.name || 'Group Character';
                                const charPersona = c.persona || c.personality || c.description ||
                                    c.character?.persona || c.character?.personality || c.character?.description || '';

                                let charModelInstructions = '';
                                if (c.modelInstructions) {
                                    charModelInstructions = typeof c.modelInstructions === 'string' ? c.modelInstructions : (c.modelInstructions.customText || '');
                                } else if (c.character?.modelInstructions) {
                                    charModelInstructions = typeof c.character.modelInstructions === 'string' ? c.character.modelInstructions : (c.character.modelInstructions.customText || '');
                                }

                                if (!charModelInstructions) {
                                    charModelInstructions = c.systemPrompt || c.system_prompt || c.instruction || c.instructions ||
                                        c.character?.systemPrompt || c.character?.system_prompt || c.character?.instruction || c.character?.instructions ||
                                        partyModelInstructions;
                                }

                                let exampleDialogue = '';
                                if (chatConfig.HubExampleMessages && Array.isArray(chatConfig.HubExampleMessages)) {
                                    exampleDialogue = chatConfig.HubExampleMessages.map(m => {
                                        const isUser = m.role === 'user' || m.characterName?.toLowerCase() === 'user' || m.hubCharacterConfigId === 'global-user-persona';
                                        const speaker = isUser ? '{{user}}' : (m.characterName || '{{char}}');
                                        return `${speaker}: ${m.text}`;
                                    }).join('\n');
                                } else if (c.exampleDialogue || c.mes_example || c.character?.exampleDialogue || c.character?.mes_example) {
                                    exampleDialogue = c.exampleDialogue || c.mes_example || c.character?.exampleDialogue || c.character?.mes_example || '';
                                }

                                if (exampleDialogue) {
                                    charModelInstructions += `\n\n### Example Dialogue\n${exampleDialogue}`;
                                }

                                const charObj = {
                                    id: charId,
                                    name: charName,
                                    is_active: true,
                                    prompt_tags: '',
                                    persona: charPersona,
                                    description: charPersona,
                                    model_instructions: charModelInstructions
                                };

                                const avatarUrl = c.Images?.[0]?.imageUrl || c.character?.Images?.[0]?.imageUrl || c.avatarUrl || c.character?.avatarUrl;
                                if (avatarUrl) {
                                    try {
                                        let imgRes;
                                        try {
                                            imgRes = await fetch(avatarUrl);
                                        } catch (e) { /* CORS blocked */ }
                                        if (!imgRes || !imgRes.ok) {
                                            try {
                                                imgRes = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(avatarUrl)}`);
                                            } catch (e) { /* Fallback */ }
                                        }
                                        if (!imgRes || !imgRes.ok) {
                                            imgRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(avatarUrl)}`);
                                        }
                                        const imgBlob = await imgRes.blob();
                                        await DBService.saveImage(charId, imgBlob);
                                        charObj.image_id = charId;
                                    } catch (e) { console.warn('[HubController] Failed to download backyard character image', e); }
                                }

                                characters.push(charObj);

                                const lorebookItems = c.LorebookItems || c.character?.LorebookItems || [];
                                if (Array.isArray(lorebookItems)) {
                                    lorebookItems.forEach(item => {
                                        dynamic_entries.push({
                                            id: crypto.randomUUID(),
                                            title: item.key || "Lore",
                                            triggers: item.key || '',
                                            content_fields: [item.value || ''],
                                            current_index: 0,
                                            triggered_at_turn: null
                                        });
                                    });
                                }
                            }

                            if (characters.length === 1) {
                                const charId = crypto.randomUUID();
                                charIds.push(charId);
                                characters.push({
                                    id: charId,
                                    name: 'Narrator',
                                    is_active: true,
                                    prompt_tags: '',
                                    persona: 'The Storyteller.',
                                    description: 'The Storyteller.',
                                    model_instructions: 'Describe the world and active scenes.'
                                });
                            }

                            newStory = {
                                id: crypto.randomUUID(),
                                name: name,
                                description: config.tagline || config.creatorNotes?.substring(0, 100) || '',
                                created_date: new Date().toISOString(),
                                last_modified: new Date().toISOString(),
                                tags: ['Backyard.ai Party Import'],
                                creator_notes: config.creatorNotes || 'Imported from Backyard.ai Party URL',
                                characters: characters,
                                static_entries: [
                                    {
                                        id: crypto.randomUUID(),
                                        title: "Starting Scenario",
                                        content: scenarioLore
                                    }
                                ],
                                dynamic_entries: dynamic_entries,
                                scenarios: [
                                    {
                                        id: crypto.randomUUID(),
                                        name: 'Base Scenario',
                                        description: 'Imported from Backyard Party',
                                        characters: charIds,
                                        message: firstMsg,
                                        initial_message: firstMsg,
                                        scenario_knowledge: scenarioLore,
                                        world_lore: scenarioLore,
                                        player_context: '',
                                        system_prompt_additions: partyModelInstructions
                                    }
                                ],
                                narratives: []
                            };
                        } else {
                            const encodedInput = encodeURIComponent(JSON.stringify({ '0': { json: { hubCharacterConfigId: id, includeStandaloneGroupConfig: true } } }));
                            const res = await fetch(`https://backyard.ai/api/trpc/hub.browse.getHubCharacterConfigById?batch=1&input=${encodedInput}`);
                            const dataList = await res.json();
                            const config = dataList[0]?.result?.data?.json;

                            if (!config) throw new Error('Could not parse Backyard character data');

                            // Backyard.ai's latest schema uses standaloneGroupConfig.PrimaryChat for scenario/greetings
                            const chatConfig = config.standaloneGroupConfig?.PrimaryChat || {};
                            const storyName = config.displayName || config.standaloneGroupConfig?.displayName || config.standaloneGroupConfig?.name || config.name || char.name || 'Imported Backyard Character';
                            const charName = config.name || config.character?.name || char.name || 'Imported Backyard Character';
                            const persona = config.persona || config.personality || config.description ||
                                config.character?.persona || config.character?.personality || config.character?.description || '';
                            const firstMsg = chatConfig.HubGreetingMessages?.[0]?.text || config.HubGreetingMessages?.[0]?.text || config.firstMessage || config.first_mes || config.greeting || '';
                            const scenarioLore = chatConfig.context || config.scenario || config.context || '';
                            const avatarUrl = config.Images?.[0]?.imageUrl || config.character?.Images?.[0]?.imageUrl || config.imageUrl || config.avatarUrl || config.avatar_url || config.character?.imageUrl || config.character?.avatarUrl || char.avatarUrl;

                            // Extract Example Dialogues
                            let exampleDialogue = '';
                            if (chatConfig.HubExampleMessages && Array.isArray(chatConfig.HubExampleMessages)) {
                                exampleDialogue = chatConfig.HubExampleMessages.map(m => {
                                    const isUser = m.role === 'user' || m.characterName?.toLowerCase() === 'user' || m.hubCharacterConfigId === 'global-user-persona';
                                    const speaker = isUser ? '{{user}}' : (m.characterName || '{{char}}');
                                    return `${speaker}: ${m.text}`;
                                }).join('\n');
                            } else if (config.exampleDialogue || config.mes_example || config.character?.exampleDialogue || config.character?.mes_example) {
                                exampleDialogue = config.exampleDialogue || config.mes_example || config.character?.exampleDialogue || config.character?.mes_example || '';
                            }

                            // Map Lorebook to dynamic_entries
                            const dynamic_entries = [];
                            if (config.LorebookItems && Array.isArray(config.LorebookItems)) {
                                config.LorebookItems.forEach(item => {
                                    dynamic_entries.push({
                                        id: crypto.randomUUID(),
                                        title: item.key || "Lore",
                                        triggers: item.key || '',
                                        content_fields: [item.value || ''],
                                        current_index: 0,
                                        triggered_at_turn: null
                                    });
                                });
                            }

                            const userChar = UTILITY.getDefaultUserCharacter();
                            const userCharId = userChar.id;

                            const charId = crypto.randomUUID();

                            let modelInstructions = '';
                            if (chatConfig.modelInstructions) {
                                modelInstructions = typeof chatConfig.modelInstructions === 'string' ? chatConfig.modelInstructions : (chatConfig.modelInstructions.customText || '');
                            } else if (config.modelInstructions) {
                                modelInstructions = typeof config.modelInstructions === 'string' ? config.modelInstructions : (config.modelInstructions.customText || '');
                            }

                            if (!modelInstructions) {
                                modelInstructions = chatConfig.systemPrompt ||
                                    chatConfig.system_prompt ||
                                    chatConfig.instruction ||
                                    chatConfig.instructions ||
                                    config.systemPrompt ||
                                    config.system_prompt ||
                                    config.instruction ||
                                    config.instructions ||
                                    config.character?.modelInstructions ||
                                    config.character?.systemPrompt ||
                                    config.character?.system_prompt ||
                                    config.character?.instruction ||
                                    config.character?.instructions ||
                                    '';
                            }
                            if (exampleDialogue) {
                                modelInstructions += `\n\n### Example Dialogue\n${exampleDialogue}`;
                            }

                            newStory = {
                                id: crypto.randomUUID(),
                                name: storyName,
                                description: char.tagline || persona.substring(0, 100),
                                created_date: new Date().toISOString(),
                                last_modified: new Date().toISOString(),
                                tags: ['Backyard.ai Import'],
                                creator_notes: 'Imported from Backyard.ai',
                                characters: [
                                    userChar,
                                    {
                                        id: charId,
                                        name: charName,
                                        is_active: true,
                                        prompt_tags: '',
                                        persona: persona,
                                        description: persona,
                                        image_url: avatarUrl ? `local_idb_${charId}` : '',
                                        model_instructions: modelInstructions
                                    }
                                ],
                                static_entries: [
                                    {
                                        id: crypto.randomUUID(),
                                        title: "Starting Scenario",
                                        content: scenarioLore
                                    }
                                ],
                                dynamic_entries: dynamic_entries,
                                scenarios: [
                                    {
                                        id: crypto.randomUUID(),
                                        name: 'Base Scenario',
                                        description: 'Imported from Backyard',
                                        characters: [userCharId, charId],
                                        message: firstMsg,
                                        initial_message: firstMsg,
                                        scenario_knowledge: scenarioLore,
                                        world_lore: scenarioLore,
                                        player_context: '',
                                        system_prompt_additions: modelInstructions
                                    }
                                ],
                                narratives: []
                            };

                            if (avatarUrl) {
                                try {
                                    let imgRes;
                                    try {
                                        imgRes = await fetch(avatarUrl);
                                    } catch (e) { /* CORS blocked */ }
                                    if (!imgRes || !imgRes.ok) {
                                        try {
                                            imgRes = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(avatarUrl)}`);
                                        } catch (e) { /* Fallback */ }
                                    }
                                    if (!imgRes || !imgRes.ok) {
                                        imgRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(avatarUrl)}`);
                                    }
                                    const imgBlob = await imgRes.blob();
                                    await DBService.saveImage(charId, imgBlob);
                                    newStory.characters[1].image_id = charId;
                                    newStory.characters[1].image_url = `local_idb_${charId}`;
                                } catch (e) { console.warn('[HubController] Failed to download backyard image', e); }
                            }
                        }

                        await this._saveImportedStory(newStory);
                    } else if (source === 'fictionlab') {
                        if (!char.rawScenarioData) throw new Error('Scenario data is missing.');
                        const sourceData = char.rawScenarioData;

                        const storyName = sourceData.displayName || "Imported FictionLab Character";
                        const tagline = sourceData.description || "Imported from FictionLab";
                        const backStory = sourceData.backStory || "";
                        const customGreeting = sourceData.customGreeting || "...";
                        const customInstructions = sourceData.customInstructions || "";
                        const avatarFilename = sourceData.avatarURL || "";
                        const avatarUrl = avatarFilename ? `https://fictionlab.ai/image-cdn/${avatarFilename}` : "";
                        const lorePieces = sourceData.lorePieces || [];

                        const userChar = UTILITY.getDefaultUserCharacter();
                        const userCharId = userChar.id;
                        const primaryCharId = crypto.randomUUID();

                        const characters = [
                            userChar,
                            {
                                id: primaryCharId,
                                name: storyName,
                                is_active: true,
                                prompt_tags: '',
                                persona: backStory || tagline || '',
                                description: tagline || '',
                                image_url: avatarUrl ? `local_idb_${primaryCharId}` : '',
                                model_instructions: customInstructions || ''
                            }
                        ];
                        const activeCharIds = [userCharId, primaryCharId];

                        const dynamic_entries = [];
                        if (Array.isArray(lorePieces)) {
                            lorePieces.forEach(piece => {
                                if (piece.type === 'character') {
                                    const secondaryCharId = crypto.randomUUID();
                                    const secName = piece.displayName || piece.title || 'Secondary Character';
                                    const secPersona = piece.content || '';
                                    const secAvatar = piece.avatarURL ? `https://fictionlab.ai/image-cdn/${piece.avatarURL}` : '';
                                    characters.push({
                                        id: secondaryCharId,
                                        name: secName,
                                        is_active: true,
                                        prompt_tags: '',
                                        persona: secPersona,
                                        description: piece.description || '',
                                        image_url: secAvatar ? `local_idb_${secondaryCharId}` : '',
                                        model_instructions: ''
                                    });
                                    activeCharIds.push(secondaryCharId);
                                } else {
                                    dynamic_entries.push({
                                        id: crypto.randomUUID(),
                                        title: piece.title || piece.displayName || "Lore",
                                        triggers: piece.title || piece.displayName || '',
                                        content_fields: [piece.content || ''],
                                        current_index: 0,
                                        triggered_at_turn: null
                                    });
                                }
                            });
                        }

                        newStory = {
                            id: crypto.randomUUID(),
                            name: storyName,
                            description: tagline,
                            created_date: new Date().toISOString(),
                            last_modified: new Date().toISOString(),
                            tags: ['FictionLab Import'],
                            creator_notes: 'Imported from FictionLab.ai scenario link.',
                            characters: characters,
                            static_entries: [
                                {
                                    id: crypto.randomUUID(),
                                    title: "Backstory",
                                    content: backStory
                                }
                            ],
                            dynamic_entries: dynamic_entries,
                            scenarios: [
                                {
                                    id: crypto.randomUUID(),
                                    name: 'Base Scenario',
                                    description: 'Imported from FictionLab',
                                    characters: activeCharIds,
                                    message: customGreeting,
                                    initial_message: customGreeting,
                                    scenario_knowledge: backStory,
                                    world_lore: backStory,
                                    player_context: '',
                                    system_prompt_additions: customInstructions
                                }
                            ],
                            narratives: []
                        };

                        if (avatarUrl) {
                            try {
                                let imgRes;
                                try {
                                    imgRes = await fetch(avatarUrl);
                                } catch (e) { /* CORS blocked */ }
                                if (!imgRes || !imgRes.ok) {
                                    try {
                                        imgRes = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(avatarUrl)}`);
                                    } catch (e) { /* Fallback */ }
                                }
                                if (!imgRes || !imgRes.ok) {
                                    imgRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(avatarUrl)}`);
                                }
                                const imgBlob = await imgRes.blob();
                                await DBService.saveImage(primaryCharId, imgBlob);
                                newStory.characters[1].image_id = primaryCharId;
                                newStory.characters[1].image_url = `local_idb_${primaryCharId}`;
                            } catch (e) { console.warn('[HubController] Failed to download FictionLab primary image', e); }
                        }

                        // Also download secondary character images!
                        for (let i = 2; i < characters.length; i++) {
                            const charObj = characters[i];
                            const secPiece = lorePieces.find(p => p.type === 'character' && (p.displayName === charObj.name || p.title === charObj.name));
                            const secAvatarUrl = secPiece && secPiece.avatarURL ? `https://fictionlab.ai/image-cdn/${secPiece.avatarURL}` : '';
                            if (secAvatarUrl) {
                                try {
                                    let imgRes;
                                    try {
                                        imgRes = await fetch(secAvatarUrl);
                                    } catch (e) { }
                                    if (!imgRes || !imgRes.ok) {
                                        try {
                                            imgRes = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(secAvatarUrl)}`);
                                        } catch (e) { }
                                    }
                                    if (!imgRes || !imgRes.ok) {
                                        imgRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(secAvatarUrl)}`);
                                    }
                                    const imgBlob = await imgRes.blob();
                                    await DBService.saveImage(charObj.id, imgBlob);
                                    charObj.image_id = charObj.id;
                                    charObj.image_url = `local_idb_${charObj.id}`;
                                } catch (e) { console.warn('[HubController] Failed to download FictionLab secondary image', e); }
                            }
                        }

                        await this._saveImportedStory(newStory);
                    } else if (source === 'wyvern') {
                        let charData = char.rawWyvernData;
                        if (!charData) {
                            const apiUrl = `https://api.wyvern.chat/characters/${id}`;
                            let res;
                            try {
                                res = await fetch(apiUrl);
                            } catch (e) { /* CORS blocked */ }
                            if (!res || !res.ok) {
                                try {
                                    res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(apiUrl)}`);
                                } catch (e) { /* Fallback */ }
                            }
                            if (!res || !res.ok) {
                                res = await fetch(`https://corsproxy.io/?${encodeURIComponent(apiUrl)}`);
                            }
                            if (!res || !res.ok) {
                                throw new Error(`Failed to fetch Wyvern character data (${res ? res.status : 'Network Error'}).`);
                            }
                            charData = await res.json();
                        }

                        const newStory = this._convertWyvernToStory(charData);
                        const aiChar = newStory.characters.find(c => !c.is_user) || newStory.characters[1];
                        if (aiChar && charData.avatar) {
                            try {
                                let imgRes;
                                try {
                                    imgRes = await fetch(charData.avatar);
                                } catch (e) { /* CORS blocked */ }
                                if (!imgRes || !imgRes.ok) {
                                    try {
                                        imgRes = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(charData.avatar)}`);
                                    } catch (e) { /* Fallback */ }
                                }
                                if (!imgRes || !imgRes.ok) {
                                    imgRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(charData.avatar)}`);
                                }
                                if (imgRes && imgRes.ok) {
                                    const imgBlob = await imgRes.blob();
                                    await DBService.saveImage(aiChar.id, imgBlob);
                                    aiChar.image_id = aiChar.id;
                                    aiChar.image_url = `local_idb_${aiChar.id}`;
                                }
                            } catch (e) { console.warn('[HubController] Failed to download Wyvern avatar image', e); }
                        }

                        await this._saveImportedStory(newStory);
                    }
                } catch (e) {
                    console.error('[HubController] Import error:', e);
                    alert('Failed to import character: ' + e.message);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            async _saveImportedStory(newStory, imageBlob) {
                const library = StateManager.getLibrary();
                const existingStory = library.stories.find(s => s.name && newStory.name && s.name.toLowerCase() === newStory.name.toLowerCase());
                if (existingStory) {
                    newStory.name = `${newStory.name} - ${Date.now()}`;
                }

                const narratives = newStory.narratives || [];
                const narrativeStubs = narratives.map(n => ({ id: n.id, name: n.name, last_modified: n.last_modified }));
                newStory.narratives = narrativeStubs;

                await DBService.saveStory(newStory);
                for (const n of narratives) {
                    await DBService.saveNarrative(n);
                }

                // Save image if provided (for Chub V2 PNG cards) — assign to AI char, not user
                const imageTarget = newStory.characters?.find(c => !c.is_user) || newStory.characters?.[0];
                if (imageBlob && imageTarget) {
                    try {
                        await DBService.saveImage(imageTarget.id, imageBlob);
                        imageTarget.image_id = imageTarget.id;
                        await DBService.saveStory(newStory);
                    } catch (e) { console.warn('[HubController] Image save failed:', e); }
                }

                library.stories.push(newStory);

                StateManager.saveLibrary();
                UIManager.renderLibraryInterface();

                // Automate transition flow:
                // 1. Close character hub (search) modal and open story library modal
                AppController.closeModal('character-hub-modal');
                AppController.openModal('story-library-modal');

                // 2. Pre-cache character images in runtime cache to guarantee immediate rendering
                for (const char of (newStory.characters || [])) {
                    if (char.image_id && !UIManager.RUNTIME.characterImageCache[char.id]) {
                        try {
                            const b = await DBService.getImage(char.id);
                            if (b) UIManager.RUNTIME.characterImageCache[char.id] = URL.createObjectURL(b);
                        } catch (e) { }
                    }
                }

                // 3. Notify success and hydrate details view
                UIManager.showNotification(`Successfully imported ${newStory.name}!`);
                await UIManager.openStoryDetails(newStory.id);
            },

            _convertWyvernToStory(data) {
                const wyvernEntries = [];
                if (data.lorebooks && Array.isArray(data.lorebooks)) {
                    data.lorebooks.forEach(lb => {
                        if (lb.entries && Array.isArray(lb.entries)) {
                            lb.entries.forEach(entry => {
                                wyvernEntries.push({
                                    keys: entry.keys || [],
                                    content: entry.content || ""
                                });
                            });
                        }
                    });
                }

                const v2Data = {
                    name: data.name || "Imported Wyvern Character",
                    tags: data.tags || [],
                    description: data.description || data.personality || "",
                    system_prompt: [
                        data.character_note,
                        data.pre_history_instructions,
                        data.post_history_instructions
                    ].filter(Boolean).join("\n\n"),
                    mes_example: data.mes_example || "",
                    first_mes: data.first_mes || data.first_message || "",
                    alternate_greetings: data.alternate_greetings || [],
                    scenario: data.scenario || "",
                    character_book: {
                        entries: wyvernEntries
                    }
                };

                const story = ImportExportService._convertV2toEllipsis(v2Data);
                const aiChar = story.characters.find(c => !c.is_user) || story.characters[1];
                if (aiChar && data.avatar) {
                    aiChar.image_url = data.avatar;
                }
                return story;
            }
        };
