        /**
         * StoryService Module (Data Abstraction Layer)
         */
        /**
         * =================================================================================================
         * [SEC:JS:SRV:STORY]
         * StoryService Module
         * Data Abstraction Layer for managing Stories, Narratives, and their persistence.
         * Handles complex operations like saving state, importing/exporting, and context building.
         * =================================================================================================
         */
        const StoryService = {
            /**
             * Loads the initial application data (stories, active story/narrative).
             * @returns {Promise<{storyStubs: Array, activeStory: Object|null, activeNarrative: Object|null}>}
             */
            async loadApplicationData() {
                let storyStubs = await DBService.getAllStories();
                let folders = await DBService.getAllFolders();

                // Auto-Recovery Check: If primary DB returned empty, check rolling auto-backup
                if ((!storyStubs || storyStubs.length === 0) && typeof AutoBackupService !== 'undefined') {
                    const recovered = await AutoBackupService.autoRecoverIfMissing(storyStubs, []);
                    if (recovered) {
                        storyStubs = await DBService.getAllStories();
                        folders = await DBService.getAllFolders();
                    }
                }

                // Robust local storage retrieval
                let activeStoryId = localStorage.getItem('active_story_id');
                let activeNarrativeId = localStorage.getItem('active_narrative_id');

                // Clean "null" strings
                if (activeStoryId === 'null') activeStoryId = null;
                if (activeNarrativeId === 'null') activeNarrativeId = null;

                let activeStory = null;
                let activeNarrative = null;

                if (activeStoryId && activeNarrativeId) {
                    try {
                        const [story, narrative] = await Promise.all([
                            DBService.getStory(activeStoryId),
                            DBService.getNarrative(activeNarrativeId)
                        ]);

                        if (story && narrative) {
                            activeStory = story;
                            activeNarrative = narrative;
                        } else {
                            // Silent Fail-Safe: Data is missing, clear IDs but don't error out
                            console.warn("StoryService: Session data not found in DB. Resetting.");
                            localStorage.removeItem('active_story_id');
                            localStorage.removeItem('active_narrative_id');
                        }
                    } catch (e) {
                        console.error("StoryService: DB Load Error", e);
                        localStorage.removeItem('active_story_id');
                        localStorage.removeItem('active_narrative_id');
                    }
                }
                return { storyStubs, folders, activeStory, activeNarrative };
            },

            /**
             * Exports the current narrative's chat history as an HTML file.
             * @param {Object} narrative - The narrative object to export.
             * @param {Object} activeStory - The active story object, needed for character details.
             * @returns {Promise<void>}
             */
            async exportNarrativeHTML() {
                console.log("Export initiated...");
                const state = StateManager.getState();
                if (!state || !state.chat_history || state.chat_history.length === 0) {
                    alert('Error: No chat history to export.');
                    return;
                }

                // 1. Capture Current Style Settings
                const defaults = UTILITY.getDefaultUiSettings();
                const s = state; // shorthand

                const font = s.font || defaults.font;
                const textSize = s.textSize || defaults.textSize;
                const bubbleOpacity = s.bubbleOpacity !== undefined ? s.bubbleOpacity : 1.0;

                // Markdown Colors
                const mdH1 = s.md_h1_color || defaults.md_h1_color;
                const mdH2 = s.md_h2_color || defaults.md_h2_color;
                const mdH3 = s.md_h3_color || defaults.md_h3_color;
                const mdBold = s.md_bold_color || defaults.md_bold_color;
                const mdItalic = s.md_italic_color || defaults.md_italic_color;
                const mdQuote = s.md_quote_color || defaults.md_quote_color;

                // Support function for opacity
                const hexToRgba = (hex, alpha) => {
                    if (!hex) return hex;
                    // Handle shorthand hex
                    if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
                        let c = hex.substring(1).split('');
                        if (c.length === 3) {
                            c = [c[0], c[0], c[1], c[1], c[2], c[2]];
                        }
                        c = '0x' + c.join('');
                        return 'rgba(' + [(c >> 16) & 255, (c >> 8) & 255, c & 255].join(',') + ',' + alpha + ')';
                    }
                    return hex;
                };

                // Generate static HTML for chat history
                let chatHTML = '';
                state.chat_history.forEach(msg => {
                    const charId = msg.character_id;
                    const char = (state.characters || []).find(c => c.id === charId);
                    const isUser = (char && char.is_user) || msg.character_id === 'user';
                    const name = char ? char.name : (isUser ? (StateManager.data.globalSettings.userPersona?.name || 'You') : 'Unknown');

                    // Character Colors
                    const defaultColor = isUser ? { base: '#4b5563', bold: '#e5e7eb' } : { base: '#334155', bold: '#94a3b8' };
                    const charColor = (char && char.color) ? char.color : defaultColor;
                    const nameColor = charColor.bold;

                    // Bubble Colors: Respect stored characteristic and opacity
                    const bubbleBg = hexToRgba(charColor.base, bubbleOpacity);

                    // Apply Smart Quotes
                    const smartContent = (msg.content || '')
                        .replace(/(["“][^"”]*["”])/g, '<span class="dialogue-quote">$1</span>')
                        .replace(/(^|\s)'((?:[^']|'(?=\w)){2,})'(?=\s|[.,!?;:]|$)/gm, '$1<span class="dialogue-quote">\'$2\'</span>');

                    chatHTML += `
            <div class="message ${isUser ? 'user-message' : 'ai-message'}" style="background-color: ${bubbleBg};">
                <div class="message-header" style="color: ${nameColor};">${name}</div>
                <div class="message-content">${marked.parse(smartContent)}</div>
            </div>
        `;
                });

                if (!state.name) {
                    console.warn("Export: Narrative name missing, using default.");
                }
                const title = state.name || "Narrative Export";
                const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
        :root {
            --font-primary: ${font};
            --text-size: ${textSize}px;
            --md-h1-color: ${mdH1};
            --md-h2-color: ${mdH2};
            --md-h3-color: ${mdH3};
            --md-bold-color: ${mdBold};
            --md-italic-color: ${mdItalic};
            --md-quote-color: ${mdQuote};
            --chat-text-color: ${s.chatTextColor || '#e5e7eb'};
        }

        body {
            background-color: #0f172a;
            font-family: var(--font-primary);
            font-size: var(--text-size);
            padding: 2rem;
            max-width: 900px;
            margin: 0 auto;
            color: #cbd5e1;
        }

        h1.title {
            color: white;
            border-bottom: 1px solid #334155;
            padding-bottom: 1rem;
            margin-bottom: 2rem;
        }

        /* Smart Quotation Styling */
        .dialogue-quote {
            color: inherit;
            filter: saturate(175%) opacity(75%) drop-shadow(1px 1px 5px black);
            font-weight: 500;
        }

        .message {
            margin-bottom: 1rem;
            padding: 1rem;
            border-radius: 0.5rem;
            color: var(--chat-text-color);
        }

        .message-header {
            font-weight: bold;
            margin-bottom: 0.5rem;
            font-size: 0.9em;
        }

        /* Markdown Styling - Mirroring App Logic */
        .message-content {
            white-space: pre-wrap;
            line-height: 1.5;
        }

        .message-content h1 { color: var(--md-h1-color); font-size: 1.5em; font-weight: 700; margin: 0.5em 0; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.3em; }
        .message-content h2 { color: var(--md-h2-color); font-size: 1.3em; font-weight: 600; margin: 0.4em 0; }
        .message-content h3 { color: var(--md-h3-color); font-size: 1.1em; font-weight: 600; margin: 0.3em 0; }
        .message-content strong { color: var(--md-bold-color); font-weight: 700; }
        .message-content em { color: var(--md-italic-color); font-style: italic; }

        .message-content blockquote {
            border-left: 3px solid #6366f1;
            padding-left: 1rem;
            color: var(--md-quote-color);
            font-style: italic;
            margin: 0.5em 0;
            background: rgba(0,0,0,0.2);
            padding: 0.5rem 1rem;
            border-radius: 0.25rem;
        }

        .message-content code {
            background-color: rgba(0,0,0,0.3);
            padding: 0.1em 0.3em;
            border-radius: 0.2rem;
            font-family: monospace;
            font-size: 0.9em;
            color: #e2e8f0;
        }

        .message-content pre {
            background-color: #1e1e1e;
            padding: 1rem;
            border-radius: 0.5rem;
            overflow-x: auto;
            margin: 0.5em 0;
        }

        .message-content pre code {
            background-color: transparent;
            padding: 0;
            color: #d4d4d4;
        }

        .message-content ul, .message-content ol { margin-left: 1.5rem; margin-bottom: 0.5rem; }
        .message-content p { margin-bottom: 0.5rem; }
    </style>
</head>
<body>
    <h1 class="title">${title}</h1>
    <div id="chat-container">
        ${chatHTML}
    </div>
</body>
</html>`;

                try {
                    const blob = new Blob([fullHTML], { type: 'text/html' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_export.html`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    alert('Export started.');
                } catch (e) {
                    console.error("Export failed:", e);
                    alert("Export failed: " + e.message);
                }
            },



            /**
             * Saves the current active state (narrative and story) to the database.
             * @param {Object} currentState - The current state object.
             * @param {Array} narrativeStubs - The list of narrative stubs.
             * @returns {Promise<void>}
             */
            async saveActiveState(currentState, narrativeStubs) {
                if (!currentState || !currentState.id || !currentState.narrativeId) return;

                // 1. Prepare Data
                // Clone objects to break references (Sanitization)
                const rawCharacters = JSON.parse(JSON.stringify(currentState.characters || []));
                const safeChatHistory = JSON.parse(JSON.stringify(currentState.chat_history || []));
                const safeStaticEntries = JSON.parse(JSON.stringify(currentState.static_entries || []));
                const safeWorldMap = JSON.parse(JSON.stringify(currentState.worldMap || {}));
                const safeDynamicEntries = JSON.parse(JSON.stringify(currentState.dynamic_entries || []));

                // Image Sanitization
                const sanitizedCharacters = rawCharacters.map(c => {
                    let safeImage = c.image_url;
                    if (safeImage && safeImage.length > 500 && !safeImage.startsWith('http') && !safeImage.startsWith('local_')) {
                        safeImage = '';
                    }
                    c.image_url = safeImage;
                    return c;
                });

                const narrativeData = {
                    id: currentState.narrativeId,
                    name: currentState.narrativeName,
                    last_modified: new Date().toISOString(),
                    active_character_ids: sanitizedCharacters.filter(c => c.is_active).map(c => c.id),
                    state: {
                        chat_history: safeChatHistory,
                        messageCounter: currentState.messageCounter,
                        static_entries: safeStaticEntries,
                        worldMap: safeWorldMap,
                        character_stats: currentState.character_stats || {},
                        last_stat_deltas: currentState.last_stat_deltas || {},
                        // SWARM SETTINGS (Narrative Level)
                        // JSON round-trip strips Proxy wrappers, preventing IDB DataCloneError.
                        swarmMode: currentState.swarmMode || false,
                        swarmNarrativeCapital: JSON.parse(JSON.stringify(currentState.swarmNarrativeCapital || {})),
                        swarmSecrets: JSON.parse(JSON.stringify(currentState.swarmSecrets || {})),
                        swarmLastIntents: JSON.parse(JSON.stringify(currentState.swarmLastIntents || {})),

                        // EVERYTHING THE BACKGROUND AGENTS PRODUCE
                        // _createEmptyEllipsisNarrative lists these as part of a narrative,
                        // and load restores whatever is in narrative.state - but nothing here
                        // ever wrote them, so every reload discarded the timeline, the
                        // relationship matrix, the journal, evolved personas and the game
                        // state. Four to five API calls every sixth message went into
                        // building knowledge that never survived the tab being closed.
                        // Round-tripped like the swarm fields above, for the same reason.
                        narrative_timeline: JSON.parse(JSON.stringify(currentState.narrative_timeline || [])),
                        relationship_matrix: JSON.parse(JSON.stringify(currentState.relationship_matrix || [])),
                        journal_entries: JSON.parse(JSON.stringify(currentState.journal_entries || [])),
                        evolved_characters: JSON.parse(JSON.stringify(currentState.evolved_characters || {})),
                        livingPersonaCounters: JSON.parse(JSON.stringify(currentState.livingPersonaCounters || {})),
                        gameState: JSON.parse(JSON.stringify(currentState.gameState || null)),
                        gm_rules: JSON.parse(JSON.stringify(currentState.gm_rules || [])),
                        gm_ledger: JSON.parse(JSON.stringify(currentState.gm_ledger || [])),
                        agent_notes: JSON.parse(JSON.stringify(currentState.agent_notes || [])),

                        // Rollback points for deletions. Each one carries a full world-map
                        // snapshot, so keeping every revision would grow this record without
                        // bound against a quota the app already warns about. The most recent
                        // ones are what a rewind actually reaches for.
                        knowledge_revisions: JSON.parse(JSON.stringify(
                            (currentState.knowledge_revisions || []).slice(-10)))
                    }
                };

                // 2. Perform Transactional Story Update
                const storyId = currentState.id;
                const currentNarrativeId = currentState.narrativeId;

                try {
                    // A. Save Narrative
                    await DBService.saveNarrative(narrativeData);

                    // B. Sync Story
                    const freshStory = await DBService.getStory(storyId);

                    if (freshStory) {
                        freshStory.last_modified = new Date().toISOString();


                        // Sync Structures
                        freshStory.characters = sanitizedCharacters;
                        freshStory.dynamic_entries = safeDynamicEntries;
                        freshStory.static_entries = safeStaticEntries; // Sync Knowledge

                        if (currentState.tags) freshStory.tags = currentState.tags;
                        if (currentState.creator_notes) freshStory.creator_notes = currentState.creator_notes;

                        // Sync all relevant settings keys to ensure the story stub matches the active state.
                        const settingsKeys = [
                            // Appearance
                            'font', 'backgroundImageURL', 'bubbleOpacity', 'chatTextColor',
                            'backgroundBlur', 'textSize', 'bubbleImageSize', 'characterImageMode', 'useAlphaMask',

                            // Markdown Colors
                            'md_h1_color', 'md_h2_color', 'md_h3_color',
                            'md_bold_color', 'md_italic_color', 'md_quote_color',

                            // Markdown Fonts
                            'md_h1_font', 'md_h2_font', 'md_h3_font',
                            'md_bold_font', 'md_italic_font', 'md_quote_font',

                            // Core Prompts
                            'system_prompt', 'responseLength', 'responseStyle',

                            // Event Master
                            'event_master_base_prompt', 'event_master_prompt', 'event_master_probability',
                            'visual_master_base_prompt', 'visual_master_probability', // Visual Master Probability

                            // Generation Prompts
                            'prompt_persona_gen', 'prompt_living_persona_gen', 'prompt_world_map_gen', 'prompt_location_gen',
                            'prompt_adjacent_locations_gen',
                            'prompt_entry_gen', 'prompt_location_memory_gen', 'prompt_story_notes_gen', 'prompt_story_tags_gen',
                            'prompt_auto_static_knowledge', 'prompt_stats_init',
                            'prompt_text_mode',

                            // AI Logic Toggles
                            'enableAutoStaticKnowledge', 'enableAnalysis', 'enableResponseOptions', 'enableStats', 'enableLivingPersona', 'enableJournal',
                            'combineAsNarrator',

                            // Agents: this story's own on/off switches (agent id -> boolean),
                            // and which one-time moves from old settings have already run
                            'agent_switches', 'agent_migrations',
                            'enableAutoBuildLocations', 'enableAutoGenerateLocationImages',
                            'enableTextMode', 'dmAllowEmoji', 'dmTimestampAwareness', 'dmTypingIndicator', 'dmUnpromptedTexts',

                            // Visual
                            'imageGenArtStyle',
                            'prompt_response_options_gen'
                        ];

                        settingsKeys.forEach(key => {
                            // Only overwrite if the current state actually has a value (even if it's an empty string)
                            if (currentState[key] !== undefined) {
                                const value = currentState[key];
                                // Objects are round-tripped for the same reason as the narrative
                                // fields above: a Proxy wrapper cannot be stored in IndexedDB.
                                freshStory[key] = (value && typeof value === 'object')
                                    ? JSON.parse(JSON.stringify(value))
                                    : value;
                            }
                        });

                        // C. Update Stub
                        if (!freshStory.narratives) freshStory.narratives = [];
                        const stubIndex = freshStory.narratives.findIndex(n => n.id === currentNarrativeId);
                        if (stubIndex !== -1) {
                            freshStory.narratives[stubIndex].name = currentState.narrativeName;
                            freshStory.narratives[stubIndex].last_modified = narrativeData.last_modified;
                        } else {
                            freshStory.narratives.push({
                                id: narrativeData.id,
                                name: narrativeData.name,
                                last_modified: narrativeData.last_modified
                            });
                        }

                        // D. Commit
                        await DBService.saveStory(freshStory);
                        console.log("Story saved successfully with settings.");
                    }
                } catch (err) {
                    console.error("StoryService: Save Transaction Failed", err);
                }
            },

            /**
             * Creates a default story and narrative for a fresh start.
             * Seeds a rich, fully-featured fantasy demo ("The Shattered Crown") that
             * showcases all of Rolecraft's capabilities: multi-character management,
             * world map, static knowledge, dynamic knowledge (including sequential
             * multi-field entries), probability-based triggers, and a detailed opening.
             * @returns {Promise<{newStory: Object, newNarrative: Object}>}
             */
            async createDefaultStoryAndNarrative() {
                const now = new Date().toISOString();

                // --- Character IDs (pre-generated so cross-references work) ---
                const userId = UTILITY.uuid();
                const narratorId = UTILITY.uuid();
                const elaraId = UTILITY.uuid();
                const kaelId = UTILITY.uuid();
                const thorneId = UTILITY.uuid();

                const newStory = {
                    id: UTILITY.uuid(),
                    name: "The Shattered Crown",
                    last_modified: now,
                    created_date: now,
                    ...UTILITY.getDefaultApiSettings(),
                    ...UTILITY.getDefaultUiSettings(),
                    ...UTILITY.getDefaultSystemPrompts(),
                    ...UTILITY.getDefaultStorySettings(),
                    creator_notes: "A demo story showcasing Rolecraft's features. Explore the characters, lorebook, world map, and knowledge systems — then feel free to modify or delete this story and create your own!",
                    tags: ["fantasy", "adventure", "demo"],
                    enableAnalysis: true,
                    enableAutoStaticKnowledge: true,
                    enableResponseOptions: true,
                    enableStats: true,
                    enableLivingPersona: true,
                    enableJournal: true,
                    event_master_probability: 20,
                    visual_master_probability: 25,
                    responseLength: 'long',
                    font: "'Domine', serif",
                    characterImageMode: 'bubble',
                    md_italic_color: '#d9737b',
                    md_italic_font: "'Lora', serif",
                    backgroundImageURL: UTILITY.appAssetUrl("assets/demo/hearthstone_inn.png"),

                    // --- Characters ---
                    characters: [
                        UTILITY.getDefaultUserCharacter(),
                        {
                            id: narratorId,
                            name: "Narrator",
                            description: "The omniscient voice guiding the tale of the Shattered Crown. Speaks in rich, literary prose with a flair for atmospheric description and dramatic tension. Occasionally foreshadows coming events with subtle, poetic observations.",
                            short_description: "The omniscient storyteller of Aethermoor.",
                            model_instructions: "You are a world-class storyteller narrating an epic fantasy. Use vivid, atmospheric prose. Describe environments with sensory richness. Build tension and mystery. Never speak as a character — only narrate events, describe settings, and set the scene. Use third-person perspective when describing the user's character.",
                            is_user: false, is_active: true, image_url: '', extra_portraits: [], tags: ["narrator"],
                            color: { base: '#334155', bold: '#94a3b8' }, is_narrator: true,
                            dynamic_knowledge: []
                        },
                        {
                            id: elaraId,
                            name: "Elara Windsong",
                            description: "An elven mage of roughly two hundred years, though she appears no older than thirty by human reckoning. Her silver-white hair falls in a long braid over one shoulder, threaded with tiny crystal beads that catch the light. Her eyes are a striking violet, sharp and calculating, though she masks her intensity behind a wry, sardonic wit.\n\nElara presents herself as a freelance scholar researching pre-Shattering magical theory, but this is a half-truth. She is secretly a ranking operative of the Shadow Court — a clandestine order that believes the Crown's fragments must be destroyed rather than reunited, fearing any mortal who wields its full power. She has attached herself to the adventurer's quest to monitor their progress and, if necessary, sabotage the reunification.\n\nDespite her mission, Elara is not heartless. She genuinely enjoys intellectual discourse, has a dry sense of humor, and finds herself increasingly conflicted as she grows to respect her companions. She is an expert in ward magic and elemental evocation, favoring precise, elegant spellwork over raw power.\n\nSpeaks with measured eloquence, occasionally lapsing into archaic Elvish phrases when emotional. Has a weakness for honeyed mead and ancient texts.",
                            short_description: "A sharp-tongued elven mage with a hidden agenda.",
                            model_instructions: "Write as Elara Windsong — an elven mage who is intelligent, sardonic, and secretive. She speaks with elegant precision and dry wit. She occasionally uses archaic turns of phrase. She deflects personal questions with humor or counter-questions. She is privately conflicted about her secret mission. Never reveal her Shadow Court allegiance unless dramatically appropriate. In combat, describe her magic as precise and geometric — silver glyphs, crystalline barriers, focused beams of light.",
                            is_user: false, is_active: true, image_url: UTILITY.appAssetUrl('assets/demo/elara.png'), extra_portraits: [], tags: ["elf", "mage", "secretive"],
                            color: { base: '#312e81', bold: '#a5b4fc' }, is_narrator: false,
                            dynamic_knowledge: []
                        },
                        {
                            id: kaelId,
                            name: "Kael Ironheart",
                            description: "A human ranger in his late forties, broad-shouldered and weathered by decades of life on the road. His dark hair is streaked with grey at the temples, and a jagged scar runs from his left ear to his jaw — a memento from a border skirmish he rarely discusses. He wears practical leather armor, carries a well-maintained longbow, and keeps a short sword at his hip.\n\nKael is a former soldier of the Aethermoor Compact — the loose alliance of city-states that formed after the Shattering. He left military service after a mission went catastrophically wrong, costing the lives of people under his command. He now works as a guide and tracker, preferring the company of forests to politics.\n\nHe is gruff, practical, and slow to trust, but fiercely loyal once that trust is earned. He joined the Crown quest reluctantly, persuaded by Thorne (an old friend) that the fragments' power could stabilize the increasingly dangerous Arcane Tides. He is skeptical of magic users in general and watches Elara with quiet suspicion.\n\nKael is an excellent cook (surprisingly), a skilled tracker, and has an encyclopedic knowledge of Aethermoor's wilderness. He speaks plainly and directly, with occasional flashes of dark humor.",
                            short_description: "A grizzled human ranger and reluctant hero.",
                            model_instructions: "Write as Kael Ironheart — a gruff, practical ranger and ex-soldier. He speaks directly and plainly, using short sentences. He distrusts magic and watches Elara warily. He's protective of his companions but expresses it through actions, not words. He has a dry, dark sense of humor that surfaces unexpectedly. He often references practical survival knowledge. In combat, describe his fighting as efficient and experienced — no wasted movement.",
                            is_user: false, is_active: true, image_url: UTILITY.appAssetUrl('assets/demo/kael.png'), extra_portraits: [], tags: ["human", "ranger", "veteran"],
                            color: { base: '#3f2c1b', bold: '#d4a574' }, is_narrator: false,
                            dynamic_knowledge: []
                        },
                        {
                            id: thorneId,
                            name: "Thorne Copperkettle",
                            description: "A stout dwarven innkeeper who runs the Hearthstone Inn at the crossroads of Aethermoor's major trade routes. Rosy-cheeked with a magnificent braided auburn beard adorned with copper rings, Thorne is the picture of jovial hospitality. He stands barely four feet tall but fills any room with his booming laugh and generous spirit.\n\nBeneath the cheerful exterior, Thorne is one of the best-connected information brokers on the continent. Travelers from every corner of Aethermoor pass through his inn, and he has cultivated a network of contacts spanning merchants, soldiers, scholars, and smugglers. He knows far more about the political landscape than he lets on.\n\nThorne is an old friend of Kael's from the ranger's military days — he served as a quartermaster before retiring to civilian life. He was the one who connected the adventurer's party, recognizing that each member brought skills critical to the Crown quest.\n\nHe is warm, gossipy, and generous with food and drink, but shrewd in business. He speaks with a thick dwarven brogue and peppers his speech with old dwarven proverbs.",
                            short_description: "A jovial dwarven innkeeper who knows everyone's secrets.",
                            model_instructions: "Write as Thorne Copperkettle — a jovial dwarven innkeeper. He speaks with warmth and a thick brogue, using dwarven proverbs and folksy expressions. He loves sharing gossip and local news. He is perceptive and shrewd beneath his cheerful exterior. He often offers food or drink during conversations. He refers to regular patrons by nicknames.",
                            is_user: false, is_active: false, image_url: UTILITY.appAssetUrl('assets/demo/thorne.png'), extra_portraits: [], tags: ["dwarf", "innkeeper", "informant"],
                            color: { base: '#78350f', bold: '#fbbf24' }, is_narrator: false,
                            dynamic_knowledge: []
                        }
                    ],

                    // --- Dynamic Knowledge (Lorebook) ---
                    dynamic_entries: [
                        {
                            id: UTILITY.uuid(),
                            title: "The Prophecy of Reunification",
                            triggers: "prophecy, crown, shattered, reunification, 10%",
                            content_fields: ["An ancient prophecy foretells that the five fragments of the Crown of Dominion will be drawn together when the Arcane Tides reach their highest surge — an event calculated to occur within the coming year. The prophecy warns: 'When the Crown is whole, the bearer shall either mend the world or unmake it. There is no middle path.' Scholars debate whether the prophecy is literal or metaphorical, but the increasing instability of magic across Aethermoor lends it urgency."],
                            current_index: 0,
                            triggered_at_turn: null
                        },
                        {
                            id: UTILITY.uuid(),
                            title: "Elara's Shadow Court Allegiance",
                            triggers: "elara AND secret, shadow AND court",
                            content_fields: ["Elara Windsong is secretly a ranking operative of the Shadow Court — a clandestine order founded in the aftermath of the Shattering. The Court believes the Crown of Dominion is too dangerous for any mortal to wield and seeks to permanently destroy its fragments rather than allow their reunification. Elara was assigned to infiltrate the adventurer's party, monitor their progress, and if they get too close to success, sabotage the quest. She carries a concealed Shadow Court sigil — a black opal ring on her right hand that she claims is a family heirloom."],
                            current_index: 0,
                            triggered_at_turn: null
                        },
                        {
                            id: UTILITY.uuid(),
                            title: "The Warding Stones",
                            triggers: "warding, stones, barrier, monolith",
                            content_fields: ["The Warding Stones are a circle of seven ancient monoliths located east of Hearthstone, each carved with pre-Shattering runes that pulse with a faint blue-white light. They generate a protective barrier that shields the surrounding region from the worst effects of the Arcane Tides — wild magic surges, spontaneous elemental manifestations, and temporal distortions. The stones are slowly degrading; two of the seven have visible cracks, and the barrier flickers noticeably during high tide events. Local scholars believe a Crown fragment may be the original power source that was removed, causing the slow decay."],
                            current_index: 0,
                            triggered_at_turn: null
                        },
                        {
                            id: UTILITY.uuid(),
                            title: "The Ironveil March",
                            triggers: "army, soldiers, march, ironveil",
                            content_fields: [
                                "Distant rumors have reached the Hearthstone Inn of troop movements to the north. Merchants arriving from Thornfield Village speak of supply wagons being commandeered and blacksmiths being pressed into service forging weapons. The name 'Ironveil Legion' is whispered — a mercenary army that hasn't mobilized in decades. No one knows who is funding them or what their objective is.",
                                "Kael's ranger contacts have confirmed the rumors — the Ironveil Legion is on the march, numbering at least two thousand soldiers. Scout reports indicate they are moving south along the old Imperial Road, requisitioning food and supplies from every settlement in their path. Their banners bear a new sigil: a crown bisected by a sword. Their commander is unknown, but the legion moves with disciplined purpose.",
                                "The Ironveil Legion has reached the outskirts of the Hearthstone region. Their advance scouts have been spotted at the Ruined Watchtower, and their main column is less than two days' march away. Thorne's contacts report that the legion is searching for something specific — likely a Crown fragment. The Warding Stones' barrier may slow their advance, but it won't stop a determined military force. The party must decide: prepare defenses, flee with what they know, or attempt to reach the fragment first."
                            ],
                            current_index: 0,
                            triggered_at_turn: null
                        },
                        {
                            id: UTILITY.uuid(),
                            title: "Dragon Sighting",
                            triggers: "dragon, wyrm, 25%",
                            content_fields: ["A massive shadow passes overhead, momentarily blotting out the sun. Those who look up catch a glimpse of iridescent scales — green and gold — and wings spanning wider than the Hearthstone Inn itself. The creature is a Tidewyrm, one of the ancient dragons that feeds on raw magical energy released by the Arcane Tides. They were thought extinct since the Shattering. Its presence this far south suggests the Tides are surging to unprecedented levels. The wyrm shows no interest in the people below... for now."],
                            current_index: 0,
                            triggered_at_turn: null
                        }
                    ],

                    // --- Scenarios ---
                    scenarios: [{
                        id: UTILITY.uuid(),
                        name: "Arrival at the Crossroads",
                        message: "The last light of day bleeds across the horizon in bands of amber and violet as you crest the final hill on the trade road. Below, nestled in the gentle valley where three ancient highways converge, sits the Hearthstone Inn — a squat, sturdy building of dark timber and river stone, its chimney breathing a lazy column of wood smoke into the evening air. Warm light spills from its diamond-paned windows, and the muffled sound of laughter and a fiddle drifts up to meet you.\n\nYour boots are caked with mud from three days on the road, and the leather journal in your pack feels heavier than its physical weight — filled with your mentor's sketches, notes, and theories about the locations of the Shattered Crown's fragments. This inn is where the first lead begins: a contact named Thorne, who supposedly knows the whereabouts of the nearest fragment.\n\nAs you push through the heavy oak door, the warmth hits you like a wall. The common room is half-full — farmers, a pair of merchants arguing over prices, a hooded figure in the corner nursing a drink. Behind the bar, a stout dwarf with a magnificent copper-ringed beard looks up and greets you with a grin that suggests he's been expecting you.\n\n\"Ah, there ye are!\" Thorne booms, already reaching for a tankard. \"Kael said you'd be along before nightfall. Sit, sit — we've much to discuss, and I'll not have ye doing it on an empty stomach.\"\n\nAt a table near the hearth, two figures look up from a spread map. A silver-haired elf with violet eyes regards you with cool appraisal over the rim of her cup. Beside her, a weathered ranger with a scar down his jaw gives you a brief, measuring nod."
                    }],
                    narratives: []
                };

                // --- Build World Map ---
                const mapGrid = UTILITY.createDefaultMapGrid();
                const mapLocations = [
                    // --- ROW 0 (North Coast / Tundra) ---
                    { x: 0, y: 0, name: "Sunken Port of Valdris", description: "Submerged ruins of the old imperial capital's docks.", prompt: "A melancholic coastal scene where the white marble of imperial docks slips beneath the churning grey waves of the Sapphire Sea. Skeletal masts of long-wrecked merchant ships rise from the surf like warning fingers. The air is thick with salt and the smell of ancient wet stone. Ghostly gulls wheel overhead, their cries echoing in the empty, barnacle-encrusted archways of the port authority building." },
                    { x: 1, y: 0, name: "The Silent Lighthouse", description: "A lone beacon that pulses with a cold, pale light.", prompt: "A towering spire of weathered granite perched on a lonely, storm-lashed rock. Unlike a standard lighthouse, its lantern-room glow is a haunting, spectral white that provides no heat. The light doesn't sweep the horizon; it pulses like a slow heartbeat. The winding stone stairs are worn smooth by centuries of spectral feet, and the air smells of old lightning and ozone." },
                    { x: 2, y: 0, name: "Frost-Byte Reach", description: "A jagged peninsula where the sea is frozen in mid-sway.", prompt: "A coastline where the water has been flash-frozen into towering, crystalline waves that look like glass sculptures. The shapes of sea creatures are visible within the translucent ice, frozen in the middle of a struggle. The ground is a treacherous mix of slush and razor-sharp ice shards. Strange, clicking sounds emanate from the ice as the temperature fluctuates, sounding like a thousands brittle voices." },
                    { x: 3, y: 0, name: "The Ivory Gate", description: "A massive natural archway of white stone over the north road.", prompt: "A colossal arch of smooth, bone-white limestone that spans the northern trade road. Ancient runes are carved deep into its surface, though many have been worn away by the wind. The arch seems to filter the sunlight, casting a pale, ethereal glow on those who pass beneath it. Travelers often leave small offerings of stone or glass at its base, hoping for safe passage into the wilder north." },
                    { x: 4, y: 0, name: "Imperial Highroad (North)", description: "The well-maintained start of the northern trade route.", prompt: "A wide, straight road of interlocking basalt pavers, still remarkably level after two centuries. Low stone walls line either side, protecting the road from the encroaching weeds of the surrounding plains. To the north, the road disappears into a permanent mist, while to the south, the distant smoke of Hearthstone can be seen. Occasional milestones – heavy granite pillars – mark the distance to a capital that no longer exists." },
                    { x: 5, y: 0, name: "Sky-Reach Peak", description: "The tallest mountain in the northern range, often above the clouds.", prompt: "A massive, snow-capped mountain that pierces the clouds like a jagged tooth. Its slopes are a dizzying array of vertical cliffs and treacherous scree fields. Near the summit, the air is thin and cold, and the silence is absolute. A faint, constant vibration can be felt through the soles of your boots, as if the mountain is humming a deep, primordial note. Legends say the peak was once a landing site for celestial voyagers." },
                    { x: 6, y: 0, name: "Storm-Shield Keep", description: "A sturdy coastal fortress guarding against northern surges.", prompt: "A squat, heavy fortress built from dark volcanic rock, overlooking the northern sea. Its walls are thick and sloped to deflect both waves and magical projectiles. Great iron chains once used to close the harbor entrance hang rusted and heavy from the cliffs. The keep feels solid and defiant, a bastion of order in an increasingly chaotic world. Within its courtyard, the wind howls with a sound like a distant army." },
                    { x: 7, y: 0, name: "The Eternal Frost", description: "A massive glacier that marks the northern edge of the map.", prompt: "A breathtaking expanse of ancient ice that stretches as far as the eye can see. The glacier is a deep, translucent blue, cracked by massive crevasses that glow with their own internal light. The air is so cold it hurts to breathe, and the only sound is the occasional, thunderous 'crack' of the ice shifting. It is a primal, beautiful, and utterly indifferent landscape that predates the Shattering by eons." },

                    // --- ROW 1 (Northern Wilds) ---
                    { x: 0, y: 1, name: "Siren's Lament", description: "Jagged sea stacks where the wind produces eerie music.", prompt: "A series of towering rock needles rising from the frothing sea, honeycombed with natural holes of varying sizes. When the wind blows from the west, the stacks produce an hauntingly beautiful harmony of flute-like notes that can be heard for miles. Local legends say the rocks are haunted by the spirits of those lost in the Shattering, but scholars believe the resonance is amplified by the proximity of a Crown fragment deep beneath the seafloor." },
                    { x: 1, y: 1, name: "Starfall Cliffs", description: "Dramatic white cliffs where meteoric iron can be found.", prompt: "Dramatic white chalk cliffs overlooking a grey, restless sea. The cliff faces are pockmarked with impact craters — some small enough to cup in your hands, others large enough to swallow a house. Within the largest craters, shards of meteoric iron glint with an iridescent sheen, still faintly warm to the touch after two centuries. The exposed cliff faces reveal geological strata that are wildly distorted near the impact sites, as if reality itself was compressed by the force of the Shattering. Sea birds wheel and cry above, nesting in the smaller craters." },
                    { x: 2, y: 1, name: "The Weeping Willow", description: "A giant tree whose sap is used in powerful elixirs.", prompt: "A massive, ancient willow tree whose trailing branches dip into a dark, still pond. The tree's leaves are a vibrant, unnatural silver, and its sap – a thick, shimmering liquid – drips slowly from its bark like glowing tears. The air around the tree is heavy with the scent of damp earth and honey. The ground is carpeted in thick, soft moss, and the site feels like a sanctuary of quiet, mournful magic. Some say the tree remembers the world as it was." },
                    { x: 3, y: 1, name: "Rustling Glade", description: "A peaceful forest opening where the leaves never stop moving.", prompt: "A circular clearing in the hardwood forest where a permanent, gentle breeze keeps the long grass and leaves in constant motion. The sounds of rustling and whispering fill the air, creating a natural lullaby. Wildflowers of every color grow in profusion here, and the sunlight seems particularly warm and golden. It is a place where travelers often stop to rest, feeling their worries slip away in the rhythmic movement of the glade." },
                    { x: 4, y: 1, name: "Traveler's End", description: "A ghost town where the buildings appear to be melting.", prompt: "A haunting collection of stone and timber buildings that show signs of severe magical warping. Walls lean at impossible angles, and the stone looks as if it had once been soft and wax-like. No one lives here now, but the interiors are still furnished, as if the inhabitants simply stepped out a moment ago. A heavy silence hangs over the village, punctuated only by the occasional creak of a distorted floorboard. The air smells faintly of old smoke and ozone." },
                    { x: 5, y: 1, name: "Cloud-Top Sanctuary", description: "A ruined temple built on a high plateau, close to the stars.", prompt: "A sprawling complex of white marble pillars and open-air altars perched on a flat-topped mountain. Most of the roofs have collapsed, leaving the interiors open to the vast, wheeling sky. The stone floors are inlaid with intricate maps of constellations that shift and change of their own accord. It is a place of profound peace and dizzyizing heights, where the boundary between the mundane and the celestial feels dangerously thin." },
                    { x: 6, y: 1, name: "Star-Gazer's Observatory", description: "An ancient tower filled with brass astrolabes and star maps.", prompt: "The remains of a cylindrical stone tower crowned with a rusted brass dome that has partially collapsed. Inside, the walls are covered in fading murals of the cosmos, and the floors are littered with the fragments of glass lenses and intricate clockwork mechanisms. A massive central telescope points toward a patch of sky that is perpetually dark. The air smells of dust and old metal. Those who linger here often report hearing the faint, rhythmic clicking of phantom gears." },
                    { x: 7, y: 1, name: "The Frozen Eye", description: "A perfectly round, frozen pond that reflects the future.", prompt: "A small, perfectly circular pond nestled in a high mountain basin, its surface a sheet of flawless, black ice. The ice is so clear it looks like an abyss. If one stares into its depths, it is said they can see glimpses of events that have not yet transpired – though the visions are often cryptic and unsettling. The air around the pond is preternaturally still and cold, and no snow ever settles on its surface. It feels like an eye watching the world from the heights." },

                    // --- ROW 2 (North Central / Highlands) ---
                    { x: 0, y: 2, name: "Serpent's Coil", description: "Treacherous sea caves where the tides roar like dragons.", prompt: "A rugged shoreline where the sea has carved deep, winding tunnels into the dark basalt cliffs. The waves roar as they are funneled through the 'Coil', throwing spray high into the air. At low tide, the caves reveal floors carpeted in bioluminescent moss and the stranded remains of strange, deep-sea creatures. The entrance is marked by a natural stone arch that resembles a twin-headed serpent. Strange, rhythmic thumping can be heard from the depths of the tunnels." },
                    { x: 1, y: 2, name: "Amberwood Thicket", description: "Dense forest where the trees bleed golden resin.", prompt: "A thick, claustrophobic forest of ancient pines whose bark is crusted with thick, sticky amber. The air is heavy and sweet with the scent of pine and resin. Insects of unusual size and vibrant colors are trapped within the translucent amber, their forms perfectly preserved. The light is filtered through the golden sap, giving the entire forest a warm, sepia-toned appearance. Movement is difficult through the tangled, sticky undergrowth, and the silence is oppressive." },
                    { x: 2, y: 2, name: "Shifting Sands", description: "A small desert patch where the dunes move against the wind.", prompt: "A localized anomaly where a patch of fine, white sand covers several acres. The dunes here are in constant, slow motion, sliding and reshaping themselves even in absolute stillness. Patterns form and dissolve on the surface – geometric shapes, runes, and occasionally the likenesses of faces. The air above the sands shimmer with heat, even in the middle of winter. A metallic, humming sound emanates from the ground, rising and falling in pitch as the dunes move." },
                    { x: 3, y: 2, name: "The Gilded Vineyard", description: "Ancient ruins of an estate where the grapes were said to be gold.", prompt: "The skeletal remains of a grand manor house surrounded by rows of gnarled, blackened vines. A few of the vines still bear fruit – small, hard spheres that glint with a metallic gold sheen and are cold to the touch. The manor's marble statues are overturned and overgrown with ivy. It is a place of vanished luxury and lingering echoes of old wealth. The air here tastes faintly of copper and honey, and the wind through the dead vines sounds like whispering voices." },
                    { x: 4, y: 2, name: "Thornfield Village", description: "A farming settlement struggling against magical blights.", prompt: "A modest village of perhaps thirty thatched-roof cottages arranged around a central well and a small stone chapel. The surrounding fields grow wheat and barley in neat rows, bounded by low stone walls. Despite its pastoral appearance, there is an air of unease — several buildings show scorch marks, a field lies fallow and strangely blackened, and protective charms of iron and rowan hang from every doorframe. The villagers move with the wary alertness of people who have seen things they cannot explain." },
                    { x: 5, y: 2, name: "Hidden Spring", description: "A secluded oasis known only to trackers and rangers.", prompt: "A lush, hidden pocket of green nestled in a fold of the dry highlands. A crystal-clear spring bubbles up from the rock, feeding a small, deep pool surrounded by ferns and flowering shrubs. The air is significantly cooler here than in the surrounding plains. It is a vital waypoint for those who know how to find it, but the entrance is carefully masked by a stand of gnarled cedar trees. Animal tracks of all kinds converge here, marking it as a rare place of peace." },
                    { x: 6, y: 2, name: "Ruined Watchtower", description: "A crumbling military outpost with a view of the northern plains.", prompt: "The skeletal remains of a once-proud military watchtower, built from massive stone blocks now heavily weathered and partially collapsed. One wall still stands to its full three-story height, offering a commanding view of the northern plains stretching to the horizon. The floors have rotted away, but a precarious stone staircase still spirals upward within the surviving wall. Campfire ash and scattered refuse suggest the ruin is used as a waypoint by travelers and, less welcomely, by bandit scouts. Old arrow slits frame distant views of the trade road below." },
                    { x: 7, y: 2, name: "The Singing Sands", description: "A vast desert where the wind hums haunting melodies.", prompt: "A region of high, red sand dunes that stretch toward the eastern horizon. When the wind blows across the sharp crests of the dunes, it produces a low, resonant humming that vibrates in the chest. Movement across the sand is difficult, but the patterns created by the wind are mesmerizing. Occasional shards of blue glass – remnants of some ancient cataclysm – glint in the sand. At night, the desert radiates the heat of the day, and the stars feel impossibly close." },

                    // --- ROW 3 (Central North / Deep Forest) ---
                    { x: 0, y: 3, name: "Glimmering Reefs", description: "Shallow waters with bioluminescent coral formations.", prompt: "Crystal-clear turquoise waters revealing a breathtaking underwater world of giant coral formations that pulse with rhythmic, multi-colored light. Schools of iridescent fish dart between the glowing branches like living jewels. The reef is shallow enough that its top-most peaks break the surface at low tide, creating tiny, temporary islands of vibrant life. The water here is perpetually warm and carries a faint, melodic hum. It is a place of alien beauty and serene, glowing depths." },
                    { x: 1, y: 3, name: "The Salt Marshes", description: "Treacherous wetlands where the plants are encrusted in salt.", prompt: "A vast expanse of grey-green salt grass and shallow, brackish pools. Every surface – from the reeds to the gnarled shrubs – is covered in a thick crust of white salt crystals that sparkle in the sun. The ground is a deceptive mix of solid salt-crust and deep, sucking mud. Water birds with long, spindly legs pick their way through the pools, and the air is heavy with the smell of brine and decay. It is a harsh, beautiful, and lonely landscape." },
                    { x: 2, y: 3, name: "The Verdant Maze", description: "A thicket so dense it forms a natural, shifting labyrinth.", prompt: "A region of the forest where the trees and undergrowth have grown into a tangled, impenetrable wall. Narrow, winding paths lead into the thicket, but they seem to shift and change when not being watched. The air is cool and smells of damp earth and crushed leaves. Sunlight only reaches the floor in tiny, flickering needles of green light. It is easy to lose one's sense of direction here, as every turn looks identical to the last, and the forest seems to muffle all sound from the outside world." },
                    { x: 3, y: 3, name: "Whispering Woods", description: "Ancient forest where the wind carries the voices of the past.", prompt: "A vast primordial forest of towering oak and silver birch, their canopy so thick that only dappled shafts of pale green light reach the mossy floor. Strange bioluminescent fungi cluster at the base of ancient trunks. The air hums with a barely audible resonance — the whisper that gives the woods their name. Faint paths wind between the trees, marked by weathered stone cairns overgrown with ivy. Occasional glimpses of movement in the peripheral vision — darting lights, shifting shadows — suggest the forest is watching." },
                    { x: 4, y: 3, name: "Wayfarer's Bridge", description: "A massive stone bridge spanning the Silverrun River.", prompt: "A monumental structure of carved granite that arches across the rushing Silverrun. The bridge is wide enough for two wagons to pass, and its side walls are decorated with relief carvings of historical battles and mythical creatures. Stone benches are built into the piers, providing a place for travelers to rest and watch the river below. The water thunders against the massive stone pilings, sending up a constant mist that keeps the bridge surface damp and moss-grown. It is a vital link on the trade road." },
                    { x: 5, y: 3, name: "Silverrun River", description: "A rushing river with crystal-clear waters.", prompt: "A wide, fast-flowing river of crystal-clear water that sparkles silver in the sunlight. A once-magnificent stone bridge arches across it, now cracked and partially collapsed — one side has fallen into the current, forcing travelers to pick their way across the remaining span. Wildflowers grow in the cracks of the ancient masonry. The river banks are lined with smooth grey stones and tall reeds. Fish leap in the deeper pools downstream. The air is cool and fresh, carrying the sound of rushing water for miles." },
                    { x: 6, y: 3, name: "Wind-Swept Plateau", description: "A high plane where the grass grows in spiraling patterns.", prompt: "A massive, flat-topped highland covered in long, silver-green grass. The wind here is constant and powerful, causing the grass to grow in strange, beautiful spiral patterns that are only visible from a distance. A few gnarled, wind-bent trees cling to the edges of the plateau. The sky feels vast and overwhelming, and the view stretches for dozens of miles in every direction. It is a place of clarity and isolation, where the wind seems to blow right through one's thoughts." },
                    { x: 7, y: 3, name: "Oasis of Reflection", description: "A small water hole in the eastern desert that reveals truth.", prompt: "A tiny patch of life in the middle of the red desert sands. A single, ancient palm tree shadows a small, deep pool of perfectly clear water. Unlike normal water, the reflection in the Oasis is said to show the viewer as they truly are, stripped of deceptions and armor. The air around the pool is unnaturally still and cool. Small, colorful birds frequent the oasis, and the ground is littered with the bleached bones of those who spent too long staring into the depths. It is a place of profound, and sometimes painful, insight." },

                    // --- ROW 4 (Central / Crossroads) ---
                    { x: 0, y: 4, name: "The Fog-Bound Reach", description: "A coastal area perpetually shrouded in magical mist.", prompt: "A desolate stretch of coast where a thick, milky-white fog never lifts, even in the strongest winds. The mist feels cool and slightly oily against the skin, smelling faintly of ozone and old parchment. Sound is muffled here; the crashing waves become distant thuds, and voices seem to come from everywhere and nowhere. Occasionally, the silhouettes of massive, slow-moving entities can be seen through the gloom, heading deeper into the sea. It is a place where reality feels thin and permeable." },
                    { x: 1, y: 4, name: "Mire-Walk Path", description: "A treacherous trail through the edge of the great swamp.", prompt: "A narrow, winding path of rotting wooden planks and half-submerged stones that leads into the fringes of the Shadowmere. To either side, the ground is a soupy mix of black mud and stagnant water. Gnarled roots reach out like skeletal hands, and the air is thick with the buzzing of insects and the smell of sulfur and wet earth. Every step must be placed with care, as the path often disappears beneath the surface without warning. It is a test of both balance and nerve." },
                    { x: 2, y: 4, name: "Shadowmere Swamp", description: "Dark, stagnant wetlands hiding submerged imperial ruins.", prompt: "A vast expanse of dark, stagnant water and dense marshland shrouded in perpetual mist. Gnarled cypress trees draped with grey moss rise from the murk like skeletal fingers. The water is black and opaque, concealing treacherous depths. Half-submerged stone structures — the remnants of a pre-Shattering settlement — break the surface at irregular intervals, their carved facades eroded but still hinting at former grandeur. Will-o'-wisps drift between the ruins, their pale blue light both beautiful and dangerous. The air smells of peat and decay." },
                    { x: 3, y: 4, name: "Crossroads Camp", description: "A temporary settlement where travelers trade news and goods.", prompt: "A sprawling collection of tents, wagons, and lean-tos gathered just outside the Hearthstone junction. Campfires smoke throughout the day and night, and the air is filled with the sounds of multilingual chatter, the braying of pack animals, and the occasional song. It is a melting pot of cultures and classes – from wealthy merchants to desperate refugees. News from every corner of Aethermoor arrives here first, often relayed through a dozen hands. The camp is chaotic, vibrant, and constantly shifting." },
                    { x: 4, y: 4, name: "Hearthstone Inn", description: "A cozy tavern at the crossroads — the heart of the region.", prompt: "A warm, inviting tavern built from dark timber and river stone, sitting at the intersection of three ancient trade roads. Smoke curls from a stone chimney. Warm golden light pours from diamond-paned windows. A wooden sign depicting a glowing hearthstone swings gently in the evening breeze. Surrounding the inn are a few modest outbuildings — a stable, a well, and a small herb garden. The crossroads stretch away into rolling green hills under a twilight sky. Inside, the air is thick with the smell of roasting meat, mulled ale, and a century of stories." },
                    { x: 5, y: 4, name: "Sun-Dappled Vale", description: "A beautiful, fertile valley perfect for a quiet rest.", prompt: "A gentle dip in the plains where the grass is particularly lush and the wildflowers seem to bloom year-round. A small, clear stream meanders through the center of the vale, its banks lined with flowering cherry trees. The sunlight here feels soft and golden, as if the vale resides in a permanent late afternoon. It is a rare pocket of uncomplicated beauty in a scarred world, where the sound of the wind through the leaves is the only thing that matters. Travelers often find themselves lingering here longer than they intended." },
                    { x: 6, y: 4, name: "The Echoing Canyon", description: "A deep gorge where sounds are amplified and distorted.", prompt: "A narrow, deep fissure in the earth with walls of striped red and orange sandstone. The canyon acts as a natural acoustic chamber; a whisper at one end can be clearly heard at the other, while a loud shout produces a thunderous, overlapping cascade of echoes. The air in the depths is cool and still. Small, hardy shrubs cling to the rock faces, and a thin stream of water trickles along the floor. It is a place where one's own thoughts seem to take on a physical presence, bounced back by the ancient stone walls." },
                    { x: 7, y: 4, name: "The Buried Library", description: "Ruins of a temple where knowledge was kept before the cataclysm.", prompt: "The entrance to a massive underground complex, visible now only as a partially collapsed stone dome in the side of a hill. Inside, the air is stale and smells of old parchment. Row upon row of stone shelves stretch into the darkness, once holding thousands of scrolls and books - now mostly dust or ash. A few stone tablets remain, their inscriptions glowing with a faint, dying light. It is a place of profound loss and lingering mysteries, where the echoes of ancient debates still seem to linger in the stagnant air." },

                    // --- ROW 5 (Central South / Highlands) ---
                    { x: 0, y: 5, name: "Salt-Blasted Ruins", description: "Ancient coastal bastion turned white by sea and magic.", prompt: "The remains of a massive stone bastion, its walls ground smooth and turned bone-white by two centuries of wind-driven salt and magical spray. No wood remains; only the heavy masonry survives, looking like a bleached skeleton against the dark sky. The ground is a crunching carpet of dried salt and crushed shells. It is a lonely place, where the wind whistles through empty arrow slits with a sound like a low, mournful flute. The sea thunders against the base of the cliffs below, a constant, rhythmic assault." },
                    { x: 1, y: 5, name: "Granite Basin", description: "A natural amphitheater of grey stone and still water.", prompt: "A massive, bowl-shaped depression in the highlands, its walls formed of smooth, grey granite. At the center lies a large, deep lake that is unnaturally still and reflects the sky with startling clarity. The acoustic properties of the basin are perfect; the smallest sound carries across the water with crystalline precision. No vegetation grows on the granite walls, giving the place a stark, monumental feel. It was once used as a gathering place for imperial assemblies, and the steps carved into the rock are still visible." },
                    { x: 2, y: 5, name: "Echoing Ridge", description: "A series of hills that amplify distant conversations.", prompt: "A line of sawtooth hills that seem to catch and focus sounds from the surrounding plains. On a quiet day, one can hear the conversations of travelers miles away, or the lowing of cattle in distant fields. The ridge itself is rocky and sparsely vegetated, with steep slopes and narrow, winding paths. The air is always moving here, carrying a confusing jumble of sounds that can be both maddening and informative. It is a lookout's dream and a secret-keeper's nightmare." },
                    { x: 3, y: 5, name: "Mossy Hollow", description: "A cool, damp forest dip carpeted in neon-green moss.", prompt: "A sheltered depression in the deep forest where the humidity is perpetually high. Every surface – the ground, the fallen logs, the lower trunks of trees – is covered in a thick, velvety layer of vibrant, neon-green moss. The air is heavy with the scent of damp earth and growth. Tiny, translucent mushrooms that glow with a soft blue light cluster in the shadows. It is a place of soft edges and hushed sounds, where the world feels padded and safe. Movement through the hollow is nearly silent." },
                    { x: 4, y: 5, name: "Stone-Cutter's Quarters", description: "Abandoned quarry and worker huts near the Ironpeaks.", prompt: "A massive gash in the hillside where the grey granite for the imperial roads was once mined. The quarry is now a series of deep, water-filled pits and tiered ledges. Nearby sit the ruins of several dozen stone huts, their roofs long gone. Rusted iron tools – chisels, hammers, and saws – lie scattered among the piles of cut stone. There is a sense of sudden abandonment here, as if the workers simply walked away in the middle of a shift. The air smells of wet stone and cold iron." },
                    { x: 5, y: 5, name: "Shattered Bridge", description: "The broken remains of a major road crossing.", prompt: "A tragic sight where a grand imperial bridge once spanned a deep ravine. The central arch has collapsed, leaving two jagged piers reaching toward each other across the gap. The road leading to either side is cracked and overgrown. In the depths of the ravine below, the massive stone blocks of the bridge lie scattered in the riverbed like the toys of a giant. It is a powerful symbol of the Shattering's destructive force, forcing travelers to find long detours through the dangerous highlands." },
                    { x: 6, y: 5, name: "The Warding Stones", description: "Ancient monoliths pulsing with protective magic.", prompt: "A hilltop circle of seven towering stone monoliths, each twice the height of a man, carved with intricate runes that glow with a soft blue-white luminescence. The stones hum with subsonic vibration. The air within the circle feels charged and clean, as if purified. Two of the stones show deep cracks running through their cores, and around these damaged pillars the protective glow flickers irregularly. The surrounding grass within the circle is unnaturally green and lush, while beyond the perimeter, the landscape shows signs of magical scarring — twisted trees, discolored soil, and areas where reality seems to shimmer like a heat haze." },
                    { x: 7, y: 5, name: "Vault of Echoes", description: "A repository of recorded sounds from the world before.", prompt: "A small, unassuming stone building carved directly into the mountain face. Inside, the walls are lined with thousands of small, crystal cylinders. When touched, these cylinders release a few seconds of sound – a snatch of bird song, a child's laugh, a market-day bustle – from the world before the Shattering. It is a place of profound nostalgia and mourning, where the ghosts of the past are given a voice. The air is cool and perfectly still, preserving the fragile recordings for centuries. Each cylinder is a tiny, auditory window into a lost age." },

                    // --- ROW 6 (South Central / Industrial) ---
                    { x: 0, y: 6, name: "The Gold-Dust Grotto", description: "A sea cave where the sand is mixed with fine gold.", prompt: "A large, beautiful cave accessible only at low tide, where the floor is composed of a strange mix of black volcanic sand and fine, shimmering gold dust. The walls are encrusted with sea-salt and small, glowing anemones. Sunlight reflecting off the water fills the cave with dancings patterns of gold and blue. It is a place that tempts the greedy, but the gold is cursed with a magical anchor that prevents it from being easily removed. The air smells of salt and old wealth." },
                    { x: 1, y: 6, name: "Graystone Garrison", description: "A ruined fortress that once held the southern border.", prompt: "A massive complex of grey stone walls, barracks, and towers that once housed a thousand imperial soldiers. Most of the structures are now roofless husks, and the courtyards are overgrown with thorny weeds. The main gate is a buckled sheet of thick iron, hanging from broken hinges. There is an air of grim, martial history here, and the silence is punctuated by the sound of the wind whistling through the empty arrow slits. A few abandoned catapults sit on the walls, their wooden frames long rotted." },
                    { x: 2, y: 6, name: "The Boiling Pools", description: "Geothermal springs that bubble with sulfurous mud.", prompt: "A stark, volcanic landscape where the ground is a patchwork of steaming mud pits and pools of boiling, mineral-rich water. The air is thick with the smell of sulfur and the sound of rhythmic 'gloops' and hisses. The ground is hot to the touch and colored in vibrant shades of yellow, orange, and white by the mineral deposits. Stubby, heat-resistant plants cling to the edges of the pools. It is a dangerous, primeval place where the internal heat of the world feels uncomfortably close to the surface." },
                    { x: 3, y: 6, name: "Moonwell Clearing", description: "A sacred grove with a pool reflecting stars of another age.", prompt: "A perfectly circular clearing in the deep forest, ringed by ancient silver-barked trees whose branches arch inward to form a natural dome. At the center lies a still, mirror-flat pool of water — the Moonwell — fed by no visible stream. Even in daylight, the pool's surface reflects a night sky full of stars, showing constellations that do not match the current season. The air here is preternaturally still and carries a faint scent of night-blooming jasmine. Offerings of flowers and small carved tokens are arranged around the pool's edge, placed by unknown hands." },
                    { x: 4, y: 6, name: "Ironpeak Mines", description: "Vast dwarven mines rumored to hold a Crown fragment.", prompt: "The entrance to a massive dwarven mining complex carved into the face of a grey granite mountain. The main gate is an impressive arch of carved stone depicting mining scenes and dwarven ancestral figures, though the iron doors hang open and rusted. Mine cart tracks emerge from the darkness within, their rails corroded with age. Scattered around the entrance are the remnants of an abandoned settlement — collapsed bunkhouses, a rusted forge, and supply crates rotting in the elements. A faint, rhythmic vibration emanates from deep within the mountain, as if the stone itself has a heartbeat." },
                    { x: 5, y: 6, name: "Crystal Caverns", description: "Breathtaking caves of glowing multi-colored crystals.", prompt: "A natural cave system whose walls, ceiling, and floor are encrusted with enormous crystal formations in every color of the spectrum — deep amethyst, pale rose quartz, golden citrine, and ice-blue topaz. The crystals emit a soft, constant glow that eliminates the need for torches, casting prismatic light patterns across every surface. The air is cool and mineral-sharp. Deeper passages reveal crystals of increasing size and intensity, some as tall as trees, humming with stored magical energy. The caverns feel alive — the crystals pulse gently, as if breathing in slow geological time." },
                    { x: 6, y: 6, name: "The Black Smithy", description: "A legendary dwarven forge that uses lava for its fire.", prompt: "A massive, soot-stained structure built over a natural fissure in the earth. Inside, the roar of falling water meets the hiss of cooling metal. A stream of molten lava is diverted through stone channels to heat the massive anvils and furnace. The air is incredibly hot and carries the metallic tang of molten iron. Massive bellows, operated by waterwheels, keep the fires white-hot in the center of the forge. No one works here now, but the anvils still ring with the echoes of ancient strikes, and the forge seems to be waiting for someone to return and light the fires again." },
                    { x: 7, y: 6, name: "The Dragon's Maw", description: "A massive cave entrance that resembles a snarling beast.", prompt: "A terrifying natural formation where the entrance to a deep cavern is framed by jagged stalactites and stalagmites that look exactly like the teeth of a dragon. The rock is a dark, reddish-brown, and the air emanating from the depths is warm and smells faintly of sulfur and musk. No birds fly near the entrance, and the ground is littered with the bones of animals that wandered too close. Deep within, a low, rhythmic sound like a massive pair of lungs can be heard. It is a place of primal fear and ancient, slumbering power." },

                    // --- ROW 7 (South / Wasteland) ---
                    { x: 0, y: 7, name: "The Forgotten Anchorage", description: "A secluded bay used by smugglers and wayward souls.", prompt: "A quiet, crescent-shaped bay tucked behind high, overhanging cliffs that hide it from the open sea. The water is unnaturally still here, reflecting the dark cliffs like a mirror. A few ramshackle piers made of driftwood and salvaged ship-timbers extend into the bay, and the flickering light of small fires can be seen in the many shallow caves along the shore. It is a place of whispers and secrets, where the law of the city-states holds no sway. The air smells of salt, wood smoke, and cheap ale." },
                    { x: 1, y: 7, name: "Wyrm-Bone Desert", description: "A barren waste littered with the skeletons of giant drakes.", prompt: "A vast expanse of shifting yellow sand where the wind has uncovered the gargantuan, sun-bleached skeletons of dragons that died during the Shattering. The ribs of the creatures rise from the dunes like bleached white pillars, and their massive skulls still gape in a final roar of agony. Magical residue clings to the bones, causing them to hum with a low, mournful resonance. The air is dry and hot, and no water can be found for miles. It is a monument to a species that was almost wiped out by the cataclysm." },
                    { x: 2, y: 7, name: "Scorched Earth", description: "The site of a massive magical fire that never fully cooled.", prompt: "A large area of the southern plains where the ground has been obsidianized – turned into a sheet of black, volcanic glass. No plants grow here, and the air still shimmers with a residual heat that is noticeable even from a distance. Arcs of static electricity occasionally dance across the surface of the glass, and the ground is hot to the touch. It is a lifeless, beautiful, and dangerous scar on the landscape, a reminder of the raw power that was released when the Crown shattered. The silence is absolute and heavy." },
                    { x: 3, y: 7, name: "The Glass Forest", description: "Trees that were turned to crystal by a magical surge.", prompt: "A localized anomaly where a stand of ancient oaks was instantaneously transformed into solid, translucent glass. The leaves are delicate blades of crystal, and the bark is a smooth, hard surface that reflects the light in prismatic patterns. The 'forest' is incredibly fragile; a single loud noise can cause the glass to crack or shatter. The air is perfectly still and smells faintly of ozone. It is a place of frozen, crystalline beauty, where a moment of history has been preserved in a terrifying and beautiful transformation." },
                    { x: 4, y: 7, name: "The Silent Spires", description: "A forest of tall, thin rock needles that catch the wind.", prompt: "A field of hundreds of slender rock pillars, some rising dozens of feet into the air. They are weathered and pitted, giving them the appearance of ancient, skeletal trees. Unlike Siren's Lament, these stones produce no sound; they seem to absorb it instead, creating a zone of unnatural, absolute silence. The ground is a mix of dry earth and fine, grey dust. It is a place of eerie stillness and visual monotony, where the only movement is the slow shift of shadows across the grey landscape." },
                    { x: 5, y: 7, name: "Cinder-Field", description: "A landscape of ash and cooling lava flows.", prompt: "A stark, monochromatic world of grey ash and black, ropey lava. Occasional vents in the ground release plumes of hot, sulfurous steam. The ground is unstable, with hidden pockets of hot ash and brittle lava-crust. A few blackened, skeletal trees have survived the heat, looking like charred remains against the grey sky. It is a place of recent and ongoing transformation, where the world is being rebuilt in fire and ash. The air is thick with the smell of smoke and mineral-sharp dust." },
                    { x: 6, y: 7, name: "The Frozen Lake", description: "A mountain lake that remains frozen even in summer.", prompt: "A deep, sapphire-blue lake nestled high in the southern mountains. Despite the warmth of the surrounding valleys, the lake's surface remains covered in a thick layer of perfectly clear ice. Strange, moveing shapes can be seen deep within the ice – bubbles, frozen weeds, and perhaps something larger. The surrounding peaks are perpetually snow-capped, and the air is crisp and invigorating. It is a place of cold, clear beauty and hidden depths, where the laws of the seasons seem not to apply." },
                    { x: 7, y: 7, name: "The Obsidian Spire", description: "A needle-thin tower of black glass on the southern horizon.", prompt: "A needle-thin tower of jet-black obsidian that rises impossibly tall from a blasted, lifeless plain. No mortar holds its seamless construction — it appears grown rather than built. Strange lights pulse behind narrow window slits in unpredictable patterns. The ground around the spire's base is fused glass, as if subjected to tremendous heat. Storm clouds perpetually circle the tower's peak, and occasional arcs of violet lightning discharge from its apex into the churning sky. No vegetation grows within a mile of its base. Its purpose and builders are unknown." }
                ];

                for (const loc of mapLocations) {
                    const idx = mapGrid.findIndex(cell => cell.coords.x === loc.x && cell.coords.y === loc.y);
                    if (idx !== -1) {
                        mapGrid[idx].name = loc.name;
                        mapGrid[idx].description = loc.description;
                        mapGrid[idx].prompt = loc.prompt;
                    }
                }

                // --- Build Narrative ---
                const defaultScenario = newStory.scenarios[0];
                const newNarrative = {
                    id: UTILITY.uuid(),
                    name: `${defaultScenario.name} - Chat`,
                    last_modified: now,
                    active_character_ids: [userId, narratorId, elaraId, kaelId],
                    state: {
                        chat_history: [],
                        messageCounter: 0,
                        static_entries: [
                            {
                                id: UTILITY.uuid(),
                                title: "World Overview",
                                content: "The continent of Aethermoor — a land fractured by the cataclysm that shattered the Crown of Dominion two centuries ago. Once a unified empire governed by the Crown's power, Aethermoor is now a patchwork of independent city-states, wild frontiers, and regions warped by unstable magic. The landscape ranges from temperate forests and fertile plains in the heartland to wind-scoured cliffs along the western coast and dense marshlands in the south. Three major trade roads converge at the Hearthstone crossroads, making it a nexus of travel, commerce, and information. The political climate is tense — the Aethermoor Compact maintains fragile peace between the city-states, but border disputes, resource competition, and the growing threat of the Arcane Tides strain it to breaking point."
                            },
                            {
                                id: UTILITY.uuid(),
                                title: "The Shattered Crown",
                                content: "The Crown of Dominion was an artifact of immense power created in a forgotten age by a coalition of the world's greatest mages, smiths, and scholars. It granted its wearer absolute command over the Arcane Tides — the ebb and flow of raw magical energy that permeates Aethermoor. For centuries, the Crown maintained balance, its bearer serving as a living conduit that regulated magic across the continent. Two hundred years ago, the last Crown-bearer — Emperor Valdris III — was assassinated during a coup. The Crown shattered in the moment of his death, releasing a catastrophic magical shockwave known as 'the Shattering' that devastated the empire, reshaped the geography, and scattered five fragments across the continent. Each fragment retains a fraction of the Crown's power and exerts a localized influence on the surrounding magic, creating zones of heightened or distorted arcane activity."
                            },
                            {
                                id: UTILITY.uuid(),
                                title: "The Arcane Tides",
                                content: "Magic in Aethermoor is not a constant force but a fluctuating phenomenon known as the Arcane Tides. Like ocean tides governed by celestial bodies, the flow of magical energy waxes and wanes in cycles — daily, seasonal, and in longer multi-year surges. During low tide, magic is difficult and unreliable; spells may fizzle or produce unexpected results. During high tide, magic is potent but volatile; untrained individuals may accidentally manifest abilities, and areas near Crown fragments experience wild magic surges — spontaneous elemental manifestations, temporal distortions, or reality warps. Since the Shattering, the Tides have been growing increasingly erratic and powerful, with each surge reaching higher than the last. Scholars predict a 'Grand Surge' within the year — a tide of unprecedented magnitude that could reshape the continent if the Crown fragments are not stabilized or reunified."
                            }
                        ],
                        worldMap: {
                            grid: mapGrid,
                            currentLocation: { x: 4, y: 4 },
                            destination: { x: null, y: null },
                            path: []
                        },
                        livingPersonaCounters: {},
                        evolved_characters: {},
                        gm_rules: [],
                        gm_ledger: [],
                        knowledge_revisions: [],
                        swarmMode: true,
                        swarmNarrativeCapital: {},
                        swarmSecrets: {},
                        swarmLastIntents: {}
                    }
                };

                // --- Seed Opening Message ---
                newNarrative.state.chat_history.push({
                    character_id: narratorId,
                    content: defaultScenario.message,
                    type: 'chat',
                    emotion: 'neutral',
                    timestamp: now,
                });
                newNarrative.state.messageCounter = 1;

                newStory.narratives.push({ id: newNarrative.id, name: newNarrative.name });

                await DBService.saveStory(newStory);
                await DBService.saveNarrative(newNarrative);

                return { newStory, newNarrative };
            },

            /**
             * Creates a new empty story.
             * @returns {Promise<Object>} - The new story object.
             */
            async createNewStory() {
                const newStory = {
                    id: UTILITY.uuid(), name: "New Story", last_modified: new Date().toISOString(), created_date: new Date().toISOString(),
                    ...UTILITY.getDefaultApiSettings(), ...UTILITY.getDefaultUiSettings(), ...UTILITY.getDefaultSystemPrompts(), ...UTILITY.getDefaultStorySettings(),
                    search_index: "new story",
                    folder_ids: [],
                    characters: [
                        UTILITY.getDefaultUserCharacter(),
                        { id: UTILITY.uuid(), name: "Narrator", description: "Describes the world.", short_description: "The storyteller.", model_instructions: "You are a world-class storyteller.", is_user: false, is_active: true, image_url: '', extra_portraits: [], tags: [], color: { base: '#334155', bold: '#94a3b8' }, is_narrator: true }
                    ],
                    dynamic_entries: [{ id: UTILITY.uuid(), title: "Example Lorebook Entry", triggers: "example, 0%", content_fields: ["This is a sample dynamic lore entry."], current_index: 0, triggered_at_turn: null }],
                    scenarios: [{ id: UTILITY.uuid(), name: "Default Start", message: "The story begins..." }],
                    narratives: []
                };

                await DBService.saveStory(newStory);
                return newStory;
            },

            /**
             * Deletes a story and all its associated data (narratives, images).
             * @param {string} storyId - The ID of the story to delete.
             * @returns {Promise<void>}
             */
            async deleteStory(storyId) {
                const story = await DBService.getStory(storyId);
                if (!story) return;

                const deleteNarrativePromises = (story.narratives || []).map(n_stub =>
                    DBService.deleteNarrative(n_stub.id)
                );

                const deleteImagePromises = (story.characters || []).map(c => {
                    const baseDelete = DBService.deleteImage(c.id);
                    const emotionDeletes = (c.extra_portraits || []).map(p => {
                        const emoKey = `${c.id}::emotion::${p.emotion}`;
                        return DBService.deleteImage(emoKey);
                    });
                    return Promise.all([baseDelete, ...emotionDeletes]);
                });

                await Promise.all([...deleteNarrativePromises, ...deleteImagePromises]);
                await DBService.deleteStory(storyId);
            },

            /**
             * Deletes a specific narrative from a story.
             * @param {string} storyId - The ID of the parent story.
             * @param {string} narrativeId - The ID of the narrative to delete.
             * @returns {Promise<Object>} - The updated story object.
             */
            async deleteNarrative(storyId, narrativeId) {
                const story = await DBService.getStory(storyId);
                if (!story) throw new Error("Parent story not found.");

                await DBService.deleteNarrative(narrativeId);
                story.narratives = story.narratives.filter(n => n.id !== narrativeId);
                await DBService.saveStory(story);
                return story;
            },

            /**
             * Creates a new narrative based on a scenario.
             * @param {string} storyId - The ID of the story.
             * @param {string} scenarioId - The ID of the scenario.
             * @returns {Promise<Object>} - The new narrative object.
             */
            async createNarrativeFromScenario(storyId, scenarioId) {
                const story = await DBService.getStory(storyId);
                if (!story) throw new Error("Story not found");

                const scenario = story.scenarios.find(sc => sc.id === scenarioId);
                if (!scenario) throw new Error("Scenario not found");

                if (scenario.dynamic_entries) story.dynamic_entries = JSON.parse(JSON.stringify(scenario.dynamic_entries));
                if (scenario.prompts) Object.assign(story, scenario.prompts);

                if (scenario.user_character_id) {
                    story.characters.forEach(c => {
                        c.is_user = (c.id === scenario.user_character_id);
                    });
                }

                const activeIDs = scenario.active_character_ids || story.characters.map(c => c.id);

                const newNarrative = {
                    id: UTILITY.uuid(),
                    name: `${scenario.name} - Chat`,
                    last_modified: new Date().toISOString(),
                    active_character_ids: activeIDs,
                    state: {
                        chat_history: [],
                        messageCounter: 0,
                        static_entries: (scenario.static_entries && scenario.static_entries.length > 0) ? JSON.parse(JSON.stringify(scenario.static_entries)) : [{ id: UTILITY.uuid(), title: "World Overview", content: "The world." }],
                        worldMap: scenario.worldMap ? JSON.parse(JSON.stringify(scenario.worldMap)) : { grid: UTILITY.createDefaultMapGrid(), currentLocation: { x: 4, y: 4 }, destination: { x: null, y: null }, path: [] },
                        gameState: {
                            resources: [],
                            relationships: [],
                            journal: []
                        },
                        livingPersonaCounters: {}, evolved_characters: {},
                        gm_rules: [],
                        gm_ledger: [],
                        swarmMode: false, swarmNarrativeCapital: {}, swarmSecrets: {}, swarmLastIntents: {}
                    }
                };

                if (scenario.scenario_knowledge) {
                    newNarrative.state.static_entries.push({ id: UTILITY.uuid(), title: "Scenario Context", content: scenario.scenario_knowledge, is_immutable: true });
                }

                if (scenario.example_dialogue && Array.isArray(scenario.example_dialogue)) {
                    newNarrative.state.chat_history.push(...JSON.parse(JSON.stringify(scenario.example_dialogue)));
                }

                const firstMessage = scenario.message;
                if (firstMessage) {
                    let firstSpeaker = null;
                    if (scenario.opening_character_id) {
                        firstSpeaker = story.characters.find(c => c.id === scenario.opening_character_id);
                    }
                    if (!firstSpeaker) {
                        firstSpeaker = story.characters.find(c => !c.is_user && activeIDs.includes(c.id));
                    }
                    if (!firstSpeaker) {
                        firstSpeaker = story.characters.find(c => !c.is_user);
                    }

                    if (firstSpeaker) {
                        newNarrative.state.chat_history.push({
                            character_id: firstSpeaker.id, content: firstMessage, type: 'chat',
                            emotion: 'neutral', timestamp: new Date().toISOString(), isNew: true
                        });
                        newNarrative.state.messageCounter = 1;
                    }
                }

                // 1. Save the Narrative
                await DBService.saveNarrative(newNarrative);

                // 2. Update the Story with the new Narrative Stub
                // Explicitly include last_modified to ensure DB consistency
                story.narratives.push({
                    id: newNarrative.id,
                    name: newNarrative.name,
                    last_modified: newNarrative.last_modified
                });

                // 3. Save the Story
                await DBService.saveStory(story);

                return newNarrative;
            },

            /**
             * Updates a specific field of a story.
             * @param {string} storyId - The ID of the story.
             * @param {string} field - The field name to update.
             * @param {*} value - The new value.
             * @returns {Promise<Object>} - The updated story object.
             */
            async updateStoryField(storyId, field, value) {
                const story = await DBService.getStory(storyId);
                if (!story) throw new Error("Story not found.");

                story[field] = value;
                story.last_modified = new Date().toISOString();
                await DBService.saveStory(story);
                return story;
            },

            /**
             * Exports the entire library as a ZIP file.
             * @returns {Promise<Blob>} - The ZIP file blob.
             */
            async exportLibraryAsZip() {
                console.log("StoryService: Starting library export...");

                // 1. Force a save of the current state before exporting
                if (typeof ReactiveStore !== 'undefined') {
                    await ReactiveStore.forceSave();
                }

                const zip = new JSZip();
                const dataFolder = zip.folder("data");
                const imageFolder = zip.folder("images");

                // 2. Export Stories
                const stories = await DBService.getAllStories();
                dataFolder.file("stories.json", JSON.stringify(stories, null, 2));

                // 3. Export Narratives
                const narratives = await DBService.getAllNarratives();
                dataFolder.file("narratives.json", JSON.stringify(narratives, null, 2));

                // 4. Export Folders
                const folders = await DBService.getAllFolders();
                dataFolder.file("folders.json", JSON.stringify(folders, null, 2));

                // 5. Export Global Settings (contains User Personas)
                if (typeof StateManager !== 'undefined') {
                    dataFolder.file("globalSettings.json", JSON.stringify(StateManager.data.globalSettings, null, 2));
                }

                // 6. Export Images Iteratively (Memory Safe)
                // Capture the report from iterateStore
                const report = await DBService.iterateStore("characterImages", (key, blob) => {
                    if (blob) {
                        imageFolder.file(key, blob);
                    } else {
                        throw new Error("Blob was null in DB");
                    }
                });

                const blob = await zip.generateAsync({
                    type: "blob",
                    compression: "DEFLATE",
                    compressionOptions: { level: 6 }
                });

                return { blob, report };
            },

            /**
             * Imports a library from a ZIP file, replacing existing data.
             * @param {File} file - The ZIP file to import.
             * @returns {Promise<void>}
             */
            async importLibraryFromZip(file) {
                console.log("StoryService: Starting library import...");
                const zip = await JSZip.loadAsync(file);

                // 0. Pre-Flight Validation (Memory-Safe)
                let stories = [];
                let narratives = [];
                let folders = [];
                let globalSettings = null;

                const storiesFile = zip.file("data/stories.json");
                if (storiesFile) {
                    try {
                        const str = await storiesFile.async("string");
                        stories = JSON.parse(str);
                    } catch (e) { throw new Error("Invalid 'stories.json' in backup file."); }
                }

                const narrativesFile = zip.file("data/narratives.json");
                if (narrativesFile) {
                    try {
                        const str = await narrativesFile.async("string");
                        narratives = JSON.parse(str);
                    } catch (e) { throw new Error("Invalid 'narratives.json' in backup file."); }
                }

                const foldersFile = zip.file("data/folders.json");
                if (foldersFile) {
                    try {
                        const str = await foldersFile.async("string");
                        folders = JSON.parse(str);
                    } catch (e) { console.warn("Could not parse folders.json", e); }
                }

                const globalSettingsFile = zip.file("data/globalSettings.json");
                if (globalSettingsFile) {
                    try {
                        const str = await globalSettingsFile.async("string");
                        globalSettings = JSON.parse(str);
                    } catch (e) { console.warn("Could not parse globalSettings.json", e); }
                }

                // 1. Clear existing data (Only after validation passes)
                await Promise.all([
                    DBService.clearStore("stories"),
                    DBService.clearStore("narratives"),
                    DBService.clearStore("characterImages"),
                    DBService.clearStore("folders")
                ]);

                // 2. Import Stories
                for (const story of stories) {
                    const success = await DBService.saveStory(story);
                    if (!success) throw new Error(`Failed to save story "${story.name || 'Unknown'}". Storage may be full.`);
                }

                // 3. Import Narratives
                for (const narrative of narratives) {
                    const success = await DBService.saveNarrative(narrative);
                    if (!success) throw new Error(`Failed to save narrative "${narrative.name || 'Unknown'}". Storage may be full.`);
                }

                // 4. Import Folders
                for (const folder of folders) {
                    await DBService.saveFolder(folder);
                }

                // 5. Restore Global Settings
                if (globalSettings && typeof StateManager !== 'undefined') {
                    StateManager.data.globalSettings = globalSettings;
                    StateManager.saveGlobalSettings();
                    StateManager.loadGlobalSettings();
                }

                // 6. Import Images
                const imageFolder = zip.folder("images");
                if (imageFolder) {
                    const imageFiles = [];
                    imageFolder.forEach((relativePath, file) => {
                        imageFiles.push({ key: relativePath, file: file });
                    });

                    // Process images sequentially
                    for (const img of imageFiles) {
                        const blob = await img.file.async("blob");
                        const success = await DBService.saveImage(img.key, blob);
                        if (!success) throw new Error(`Failed to save image "${img.key}". Storage Quota Exceeded?`);
                    }
                }
            },

            /**
             * Builds a context string for a story, including characters and lore.
             * @param {string} storyId - The ID of the story.
             * @returns {Promise<string>} - The context string.
             */
            async buildStoryContext(storyId) {
                const story = await DBService.getStory(storyId);
                if (!story) return "No story found.";

                let context = `Story Name: ${story.name}\n`;
                context += `Creator's Note: ${story.creator_notes || 'N/A'}\n`;
                context += "Characters:\n";
                (story.characters || []).forEach(c => {
                    context += `- ${c.name}: ${c.short_description}\n`;
                });

                if (story.narratives && story.narratives.length > 0) {
                    const firstNarrative = await DBService.getNarrative(story.narratives[0].id);
                    if (firstNarrative && firstNarrative.state) {
                        context += "\nWorld Lore (Sample):\n";
                        (firstNarrative.state.static_entries || []).slice(0, 5).forEach(e => {
                            context += `- ${e.title}: ${e.content.substring(0, 100)}...\n`;
                        });
                    }
                }

                if (story.dynamic_entries && story.dynamic_entries.length > 0) {
                    context += "\nDynamic Lore (Sample):\n";
                    story.dynamic_entries.slice(0, 5).forEach(e => {
                        context += `- ${e.title} (Triggers: ${e.triggers})\n`;
                    });
                }
                return context;
            },
        };
