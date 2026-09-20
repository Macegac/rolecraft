        /**
     * =================================================================================================
     * UI Components (Pure Functions)
     * Reusable, sanitized HTML generators.
     * =================================================================================================
     */
        /**
         * =================================================================================================
         * [SEC:JS:UI:TEMPLATE]
         * UIComponents
         * Pure functions that return sanitized HTML strings for various UI elements.
         * =================================================================================================
         */
        const UIComponents = {
            /**
             * Renders a Character Hub result card.
             * @param {Object} char - The character search result object.
             * @param {string} source - 'chub' or 'backyard'.
             * @returns {string} HTML string.
             */
            HubCharacterCard(char, source) {
                const id = UTILITY.escapeHTML(char.id || "");
                const name = UTILITY.escapeHTML(char.name || "Unknown");
                const tagline = UTILITY.escapeHTML(char.tagline || "");
                const avatarUrl = char.avatarUrl || '';
                const tileId = `hub-tile-${char.id}`;
                const date = char.createdAt ? new Date(char.createdAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }) : '';
                const usage = char.usageCount ? UTILITY.formatNumber(char.usageCount) : '';

                setTimeout(() => {
                    const el = document.getElementById(tileId);
                    if (el) UTILITY.safeBackgroundSet(el, avatarUrl);
                }, 0);

                return `
                    <div id="${tileId}" class="char-roster-btn group cursor-pointer relative h-full" 
                         data-action="view-hub-details" data-action-val='${UTILITY.escapeHTML(JSON.stringify({ id: char.id, source }))}'>
                        
                        <!-- Layered Backgrounds -->
                        <div class="placeholder-geometric absolute inset-0 z-0">
                            <div class="geo-circle geo-1"></div>
                            <div class="geo-circle geo-2"></div>
                            <div class="geo-circle geo-3"></div>
                        </div>
                        <div class="absolute inset-0 z-[5] bg-gray-800 transition-opacity duration-700" style="background-image: url('${UTILITY.safeStyleUrl(avatarUrl)}'); background-size: cover; background-position: center;"></div>

                        <!-- Corner Import Button (Apple Glass Style) -->
                        <button data-action="import-hub-character" 
                                data-action-val='${UTILITY.escapeHTML(JSON.stringify({ id: char.id, source }))}' 
                                onclick="event.stopPropagation()"
                                class="absolute top-4 right-4 w-12 h-12 bg-white/10 backdrop-blur-xl border border-white/20 text-white rounded-2xl shadow-2xl flex items-center justify-center transition-all z-30 active:scale-90 group/btn opacity-0 group-hover:opacity-100 transform scale-90 group-hover:scale-100 pointer-events-none group-hover:pointer-events-auto hover:bg-white/20 hover:scale-105 hover:border-white/30"
                                title="Import Character">
                            <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                        </button>

                        <!-- Premium Metadata Badges (Stacked Apple Glass) -->
                        <div class="absolute top-4 left-4 flex flex-col items-start gap-2 z-20 pointer-events-none">
                            ${usage ? `
                                <div class="user-badge-premium" style="background: rgba(99, 102, 241, 0.2); border-color: rgba(99, 102, 241, 0.3);">
                                    <svg class="w-3.5 h-3.5 opacity-70" fill="currentColor" viewBox="0 0 20 20"><path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3.005 3.005 0 013.75-2.906z"></path></svg>
                                    <span>${usage}</span>
                                </div>` : ''}
                            ${date ? `<div class="user-badge-premium"><span>${date}</span></div>` : ''}
                        </div>
                        
                        <div class="char-roster-content text-white">
                            <h3 class="group-hover:text-indigo-300 transition-colors tracking-tight">${name}</h3>
                            <div class="char-folio-description">${tagline}</div>
                        </div>
                    </div>
                `;
            },

            /**
             * Renders the character detail overlay content.
             */
            HubCharacterDetail(char, details) {
                const name = UTILITY.escapeHTML(char.name || "Unknown");
                const tagline = UTILITY.escapeHTML(char.tagline || "");
                const persona = UTILITY.escapeHTML(details.persona || "");
                const firstMsg = UTILITY.escapeHTML(details.firstMsg || "");
                const scenario = UTILITY.escapeHTML(details.scenario || "");
                const exampleDialogue = UTILITY.escapeHTML(details.exampleDialogue || "");
                const systemPrompt = UTILITY.escapeHTML(details.systemPrompt || "");
                const postHistoryInstructions = UTILITY.escapeHTML(details.postHistoryInstructions || "");
                const alternateGreetings = details.alternateGreetings || [];
                const topics = char.topics || [];
                const avatarUrl = char.avatarUrl || '';
                const usage = char.usageCount ? UTILITY.formatNumber(char.usageCount) : '';
                const d = char.createdAt ? new Date(char.createdAt) : null;
                const shortDate = d ? `${d.toLocaleString('en-us', { month: 'short' }).toUpperCase()} '${String(d.getFullYear()).slice(-2)}` : 'LEGACY';
                const longDate = d ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase() : 'LEGACY ENTRY';
                const source = details.source;

                return `
                    <div class="hub-detail-wrapper relative">
                        
                        <!-- Global Close Button (Top Right of Window) -->
                        <button data-action="close-hub-details" class="absolute top-8 right-8 z-[100] w-12 h-12 rounded-full bg-black/40 backdrop-blur-xl border border-white/20 flex items-center justify-center text-white shadow-2xl active:scale-90 transition-all hover:bg-black/60">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>

                        <!-- Side / Hero Image Section -->
                        <div class="hub-detail-sidebar">
                            <img src="${avatarUrl}" class="absolute inset-0 w-full h-full object-cover" />
                            <div class="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/40 to-transparent z-10"></div>
                            
                            <!-- Portrait-Only Hero Title (Visible in vertical mode) -->
                            <div class="portrait-only absolute z-20" style="bottom: 120px; left: 40px; right: 40px;">
                                <h2 class="text-5xl font-black text-white tracking-tighter leading-none mb-3 drop-shadow-2xl">${name}</h2>
                                <p class="text-indigo-300 font-bold text-xs uppercase tracking-[0.2em] opacity-90">${tagline}</p>
                            </div>

                            <!-- Action Panel (Import) - Fixed to Bottom -->
                            <div class="absolute left-0 right-0 flex flex-col items-center gap-3 z-40" style="bottom: 30px;">
                                <button data-action="import-hub-character" data-action-val='${UTILITY.escapeHTML(JSON.stringify({ id: char.id, source: source }))}'
                                        class="import-btn-premium w-fit" style="padding: 12px 32px; font-size: 11px; letter-spacing: 0.1em;">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="display: inline-block; margin-right: 8px; margin-top: -2px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                                    IMPORT
                                </button>
                                <p class="text-[9px] text-gray-400 uppercase tracking-widest font-bold opacity-40">Local Portrait Detected</p>
                            </div>
                        </div>

                        <!-- Content Area -->
                        <div class="hub-detail-content">
                            
                            <!-- Desktop Header (Pinned) - Visible in Landscape mode -->
                            <div class="landscape-only px-16 py-10 border-b border-white/5 justify-between items-start flex-shrink-0 bg-gray-950/80 backdrop-blur-xl sticky top-0 z-50">
                                <div>
                                    <h2 class="text-5xl font-black text-white tracking-tighter mb-2 leading-none">${name}</h2>
                                    <p class="text-gray-400 text-sm font-medium mb-4 opacity-60">${tagline}</p>
                                    <div class="flex gap-4">
                                        ${usage ? `<span class="text-indigo-400 font-black text-[10px] uppercase tracking-widest">${usage} Active Narratives</span>` : ''}
                                        <span class="text-gray-500 font-black text-[10px] uppercase tracking-widest">// ${longDate}</span>
                                    </div>
                                    <div class="flex flex-wrap gap-2 mt-4">
                                        ${topics.slice(0, 8).map(t => `<span class="px-2 py-1 bg-white/5 border border-white/10 rounded text-[9px] font-bold text-gray-400 uppercase tracking-tight">${t}</span>`).join('')}
                                    </div>
                                </div>
                            </div>

                            <!-- Scrollable Body Content -->
                            <div class="hub-detail-scroll-area custom-scroll space-y-12">
                                
                                <!-- Portrait-Only Stats Bar -->
                                <div class="portrait-only mb-12">
                                    <div class="flex gap-4 mt-4">
                                        ${usage ? `<div class="glass-badge shadow-xl">${usage} USES</div>` : ''}
                                        <div class="glass-badge shadow-xl">${shortDate}</div>
                                    </div>
                                    <div class="flex flex-wrap gap-2 mt-4">
                                        ${topics.slice(0, 8).map(t => `<span class="px-2 py-1 bg-white/5 border border-white/10 rounded text-[8px] font-bold text-gray-400 uppercase tracking-tight">${t}</span>`).join('')}
                                    </div>
                                </div>

                                <section>
                                    <div class="data-header">Character Persona</div>
                                    <div class="long-text whitespace-pre-wrap">
                                        ${persona || "No detailed persona data returned from the Hub API."}
                                    </div>
                                </section>
                                
                                ${scenario ? `
                                <section>
                                    <div class="data-header">World Scenario</div>
                                    <div class="long-text italic opacity-80 whitespace-pre-wrap">
                                        ${scenario}
                                    </div>
                                </section>` : ''}

                                ${firstMsg ? `
                                <section>
                                    <div class="data-header">Opening Message</div>
                                    <div class="glass-panel text-lg font-medium leading-relaxed italic bg-indigo-500/5">
                                        "${firstMsg}"
                                        <div class="mt-8 flex items-center gap-3">
                                            <div class="w-8 h-[1px] bg-indigo-500/30"></div>
                                            <p class="text-[10px] text-indigo-400 font-black uppercase tracking-[0.3em]">Initial Transmission</p>
                                        </div>
                                    </div>
                                </section>` : ''}

                                ${alternateGreetings.length > 0 ? `
                                <section>
                                    <div class="data-header">Alternate Greetings (${alternateGreetings.length})</div>
                                    <div class="space-y-4">
                                        ${alternateGreetings.map((g, i) => `
                                            <div class="glass-panel text-sm font-medium leading-relaxed italic bg-white/5 border-white/10 p-6">
                                                "${UTILITY.escapeHTML(g)}"
                                                <p class="text-[9px] text-gray-500 font-bold uppercase tracking-widest mt-4">Variation ${i + 1}</p>
                                            </div>
                                        `).join('')}
                                    </div>
                                </section>` : ''}

                                ${exampleDialogue ? `
                                <section>
                                    <div class="data-header">Example Dialogue</div>
                                    <div class="glass-panel font-mono text-sm leading-relaxed opacity-90 bg-indigo-500/5 border-indigo-500/20">
                                        ${exampleDialogue}
                                    </div>
                                </section>` : ''}

                                ${systemPrompt ? `
                                <section>
                                    <div class="data-header">System Prompt</div>
                                    <div class="long-text text-sm opacity-70 whitespace-pre-wrap font-mono bg-black/20 p-6 rounded-2xl border border-white/5">
                                        ${systemPrompt}
                                    </div>
                                </section>` : ''}

                                ${postHistoryInstructions ? `
                                <section>
                                    <div class="data-header">Post-History Instructions</div>
                                    <div class="long-text text-sm opacity-70 whitespace-pre-wrap italic">
                                        ${postHistoryInstructions}
                                    </div>
                                </section>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            },

            /**
             * Renders the Choose Your Own Adventure response options.
             * @param {Array} options - [{label, prompt}]
             * @returns {string} - HTML string
             */
            ResponseOptions(options) {
                if (!options || options.length === 0) return '';
                const buttons = options.map((opt, i) => {
                    // Use encodeURIComponent to safely pass arbitrary strings into an inline onclick handler
                    const safeOpt = encodeURIComponent(JSON.stringify(opt)).replace(/'/g, "%27");
                    return DOM.html`
                        <button onclick="NarrativeController.handleSelectOption('${safeOpt}')"
                            class="bg-gray-800/60 hover:bg-indigo-900/40 border border-gray-700 hover:border-indigo-500/50 text-gray-200 hover:text-white font-medium py-3 px-4 rounded-xl transition-all duration-300 text-sm shadow-xl backdrop-blur-md transform hover:scale-[1.02] active:scale-95 text-left flex items-start gap-3 group animate-rise-in"
                            style="animation-delay: ${i * 75}ms">
                            <div class="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center flex-shrink-0 group-hover:bg-indigo-500/20 transition-colors">
                                <span class="text-indigo-400 font-bold text-xs">${i + 1}</span>
                            </div>
                            <div class="flex flex-col">
                                <span class="text-white font-semibold mb-0.5">${opt.label}</span>
                                <span class="text-xs text-gray-400 group-hover:text-gray-300 transition-colors line-clamp-2">${opt.prompt}</span>
                            </div>
                        </button>
                    `;
                });
                return DOM.html`
                    <div class="flex flex-col bg-gradient-to-t from-gray-900/80 to-transparent p-4 pb-2">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                            ${buttons}
                        </div>
                    </div>
                `;
            },

            /**
             * [UI:TEMPLATE:STATS_PANEL]
             * Renders the character stats HUD panel.
             * @param {Object} characterStats - Keyed by character ID, each an array of { name, value, max }.
             * @param {Array} characters - The characters array from state.
             * @param {Object} [deltas] - Optional recent deltas keyed by charId, e.g. { charId: [{name, delta}] }
             * @returns {string} HTML string.
             */
            StatsPanel(characterStats, characters, deltas = {}) {
                if (!characterStats || Object.keys(characterStats).length === 0) return '';

                const charGroups = characters
                    .filter(c => characterStats[c.id] && characterStats[c.id].length > 0)
                    .map(char => {
                        const stats = characterStats[char.id];
                        const charDeltas = deltas[char.id] || [];
                        const dotColor = char.color ? char.color.base : '#6b7280';

                        const statRows = stats.map(stat => {
                            const pct = Math.max(0, Math.min(100, stat.value));
                            const colorClass = pct < 30 ? 'stat-low' : pct < 60 ? 'stat-mid' : 'stat-high';
                            const delta = charDeltas.find(d => d.name === stat.name);
                            const deltaHTML = delta ? `<span class="stat-delta ${delta.delta > 0 ? 'positive' : 'negative'}">${delta.delta > 0 ? '+' : ''}${delta.delta}</span>` : '';

                            return `<div class="stat-row">
                                <span class="stat-label" title="${stat.description || ''}">${stat.name}</span>
                                <div class="stat-bar-track">
                                    <div class="stat-bar-fill ${colorClass}" style="width: ${pct}%"></div>
                                </div>
                                <span class="stat-value">${Math.round(stat.value)}</span>
                                ${deltaHTML}
                            </div>`;
                        }).join('');

                        return `<div class="stats-char-group">
                            <div class="stats-char-name">
                                <span class="char-dot" style="background-color: ${dotColor}"></span>
                                ${char.name}
                            </div>
                            ${statRows}
                        </div>`;
                    }).join('');

                if (!charGroups) return '';

                return DOM.unsafe(`
                    <div class="stats-panel" id="stats-panel">
                        <div class="stats-panel-header">
                            <div class="stats-panel-title">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
                                Stats
                            </div>
                            <button onclick="NarrativeController.toggleStatsPanel()" class="bg-black/40 hover:bg-gray-700 text-gray-300 hover:text-white p-1.5 rounded-full backdrop-blur-sm transition-colors shadow-lg" title="Close Stats">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                        <div class="stats-panel-body">
                            ${charGroups}
                        </div>
                    </div>
                `);
            },

            /**
             * Renders the premium Journal and Inventory HUD panel.
             * @param {Object} gameState - The narrative's state (resources, relationships, journal).
             * @param {string} activeTab - The currently active tab: 'inventory', 'quests', 'relationships'.
             * @returns {string} HTML string.
             */
            InventoryPanel(gameState, activeTab = 'inventory') {
                const resources = (gameState && gameState.resources) || [];
                const relationships = (gameState && gameState.relationships) || [];
                const journal = (gameState && gameState.journal) || [];

                // 1. Tab headers
                const isInv = activeTab === 'inventory';
                const isQst = activeTab === 'quests';
                const isRel = activeTab === 'relationships';

                const tabClass = (active) => active
                    ? "px-3 py-1.5 text-xs font-bold rounded-lg bg-teal-600 text-white shadow-sm border border-teal-500/50 transition-all cursor-pointer"
                    : "px-3 py-1.5 text-xs font-medium rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-all cursor-pointer";

                // 2. Tab Contents
                let contentHTML = '';

                if (isInv) {
                    const itemsHTML = resources.length === 0
                        ? `<div class="text-center text-xs text-gray-500 py-8">No items in inventory.</div>`
                        : resources.map(item => `
                            <div class="flex justify-between items-center bg-white/[0.02] border border-white/5 rounded-lg p-2.5 shadow-sm group/item">
                                <div class="flex flex-col min-w-0">
                                    <span class="text-xs font-bold text-gray-200 truncate">${UTILITY.escapeHTML(item.name)}</span>
                                    <span class="text-[10px] text-gray-400 font-medium">Qty: ${item.value}</span>
                                </div>
                                <div class="flex items-center space-x-1.5 opacity-60 group-hover/item:opacity-100 transition-opacity">
                                    <button onclick="InventoryController.addResource('${UTILITY.escapeHTML(item.name.replace(/'/g, "\\'"))}', -1)" class="w-6 h-6 rounded-md bg-black/40 hover:bg-red-900/60 border border-white/5 text-gray-300 hover:text-white flex items-center justify-center text-xs font-bold cursor-pointer transition-colors shadow-sm" title="Decrease Qty">-</button>
                                    <button onclick="InventoryController.addResource('${UTILITY.escapeHTML(item.name.replace(/'/g, "\\'"))}', 1)" class="w-6 h-6 rounded-md bg-black/40 hover:bg-emerald-900/60 border border-white/5 text-gray-300 hover:text-white flex items-center justify-center text-xs font-bold cursor-pointer transition-colors shadow-sm" title="Increase Qty">+</button>
                                    <button onclick="InventoryController.removeResource('${item.id}')" class="w-6 h-6 rounded-md bg-black/40 hover:bg-red-600/80 border border-white/5 text-red-400 hover:text-white flex items-center justify-center text-xs cursor-pointer transition-colors shadow-sm" title="Delete Item">&times;</button>
                                </div>
                            </div>
                        `).join('');

                    contentHTML = `
                        <div class="space-y-2.5">
                            <div class="flex justify-between items-center mb-1">
                                <h3 class="text-[10px] uppercase tracking-wider font-extrabold text-gray-400">Inventory Items</h3>
                                <button onclick="UIManager.promptAddResource()" class="px-2 py-1 bg-teal-950/40 hover:bg-teal-700/60 border border-teal-500/30 text-[10px] font-bold text-teal-300 hover:text-white rounded-md cursor-pointer transition-all flex items-center gap-1 shadow-sm">
                                    + Add Item
                                </button>
                            </div>
                            <div class="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                                ${itemsHTML}
                            </div>
                        </div>
                    `;
                } else if (isQst) {
                    const sortedQuests = journal.slice().sort((a, b) => {
                        if (a.status === 'active' && b.status !== 'active') return -1;
                        if (a.status !== 'active' && b.status === 'active') return 1;
                        return 0;
                    });

                    const questsHTML = sortedQuests.length === 0
                        ? `<div class="text-center text-xs text-gray-500 py-8">No quests recorded.</div>`
                        : sortedQuests.map(quest => {
                            let badgeColor = 'bg-amber-900/40 text-amber-300 border-amber-500/30';
                            if (quest.status === 'completed') badgeColor = 'bg-emerald-900/40 text-emerald-300 border-emerald-500/30';
                            if (quest.status === 'failed') badgeColor = 'bg-red-900/40 text-red-300 border-red-500/30';

                            const hasObjective = quest.objective ? true : false;

                            return `
                                <div class="bg-white/[0.02] border border-white/5 rounded-lg p-3 shadow-sm space-y-2.5 group/item">
                                    <div class="flex justify-between items-start gap-2">
                                        <div class="min-w-0 flex-1">
                                            <h4 class="text-xs font-extrabold text-gray-100 truncate">${UTILITY.escapeHTML(quest.title)}</h4>
                                            <span class="inline-block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded border ${badgeColor} uppercase tracking-wider">${quest.status}</span>
                                        </div>
                                        <div class="flex items-center space-x-1 opacity-60 group-hover/item:opacity-100 transition-opacity">
                                            <button onclick="UIManager.promptUpdateQuestObjective('${quest.id}')" class="p-1 rounded bg-black/40 hover:bg-teal-900/60 border border-white/5 text-gray-300 hover:text-white text-[10px] font-bold cursor-pointer transition-colors shadow-sm" title="Update Objective">Update</button>
                                            <button onclick="InventoryController.updateQuest('${quest.id}', 'completed')" class="p-1 rounded bg-black/40 hover:bg-emerald-900/60 border border-white/5 text-emerald-400 hover:text-white text-[10px] font-bold cursor-pointer transition-colors shadow-sm" title="Mark Complete">Done</button>
                                            <button onclick="InventoryController.updateQuest('${quest.id}', 'failed')" class="p-1 rounded bg-black/40 hover:bg-red-900/60 border border-white/5 text-red-400 hover:text-white text-[10px] font-bold cursor-pointer transition-colors shadow-sm" title="Mark Failed">Fail</button>
                                            <button onclick="InventoryController.deleteQuest('${quest.id}')" class="p-1 rounded bg-black/40 hover:bg-red-600/80 border border-white/5 text-red-400 hover:text-white text-[10px] cursor-pointer transition-colors shadow-sm" title="Delete Quest">&times;</button>
                                        </div>
                                    </div>
                                    ${hasObjective ? `
                                        <div class="border-t border-white/5 pt-2">
                                            <div class="text-[9px] uppercase tracking-wider font-bold text-gray-500 mb-0.5">Objective</div>
                                            <p class="text-[11px] text-gray-300 leading-snug">${UTILITY.escapeHTML(quest.objective)}</p>
                                        </div>
                                    ` : ''}
                                </div>
                            `;
                        }).join('');

                    contentHTML = `
                        <div class="space-y-2.5">
                            <div class="flex justify-between items-center mb-1">
                                <h3 class="text-[10px] uppercase tracking-wider font-extrabold text-gray-400">Quest Log</h3>
                                <button onclick="UIManager.promptAddQuest()" class="px-2 py-1 bg-teal-950/40 hover:bg-teal-700/60 border border-teal-500/30 text-[10px] font-bold text-teal-300 hover:text-white rounded-md cursor-pointer transition-all flex items-center gap-1 shadow-sm">
                                    + New Quest
                                </button>
                            </div>
                            <div class="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                                ${questsHTML}
                            </div>
                        </div>
                    `;
                } else if (isRel) {
                    const relsHTML = relationships.length === 0
                        ? `<div class="text-center text-xs text-gray-500 py-8">No relationship tracking active.</div>`
                        : relationships.map(rel => {
                            const pct = Math.max(0, Math.min(100, rel.value));
                            const colorClass = pct < 35 ? 'bg-red-500/60' : pct < 65 ? 'bg-teal-500/60' : 'bg-emerald-500/60';

                            return `
                                <div class="bg-white/[0.02] border border-white/5 rounded-lg p-2.5 shadow-sm space-y-1.5 group/item">
                                    <div class="flex justify-between items-center">
                                        <div class="flex flex-col min-w-0">
                                            <span class="text-xs font-bold text-gray-200 truncate">${UTILITY.escapeHTML(rel.characterName)}</span>
                                            <span class="text-[9px] text-gray-400 uppercase tracking-wider font-semibold">${UTILITY.escapeHTML(rel.track)}</span>
                                        </div>
                                        <div class="flex items-center space-x-1.5 opacity-60 group-hover/item:opacity-100 transition-opacity">
                                            <button onclick="InventoryController.updateRelationship('${rel.id}', ${rel.value - 5})" class="w-6 h-6 rounded-md bg-black/40 hover:bg-red-900/60 border border-white/5 text-gray-300 hover:text-white flex items-center justify-center text-xs font-bold cursor-pointer transition-colors shadow-sm" title="Decrease -5">-5</button>
                                            <button onclick="InventoryController.updateRelationship('${rel.id}', ${rel.value + 5})" class="w-6 h-6 rounded-md bg-black/40 hover:bg-emerald-900/60 border border-white/5 text-gray-300 hover:text-white flex items-center justify-center text-xs font-bold cursor-pointer transition-colors shadow-sm" title="Increase +5">+5</button>
                                            <button onclick="InventoryController.deleteRelationship('${rel.id}')" class="w-6 h-6 rounded-md bg-black/40 hover:bg-red-600/80 border border-white/5 text-red-400 hover:text-white flex items-center justify-center text-xs cursor-pointer transition-colors shadow-sm" title="Delete Tracking">&times;</button>
                                        </div>
                                    </div>
                                    <div class="flex items-center space-x-2">
                                        <div class="flex-1 bg-white/10 h-1.5 rounded-full overflow-hidden">
                                            <div class="h-full ${colorClass} rounded-full transition-all duration-300" style="width: ${pct}%"></div>
                                        </div>
                                        <span class="text-[10px] font-bold text-gray-300 w-8 text-right">${pct}%</span>
                                    </div>
                                </div>
                            `;
                        }).join('');

                    contentHTML = `
                        <div class="space-y-2.5">
                            <div class="flex justify-between items-center mb-1">
                                <h3 class="text-[10px] uppercase tracking-wider font-extrabold text-gray-400">Relationships</h3>
                                <button onclick="UIManager.promptAddRelationship()" class="px-2 py-1 bg-teal-950/40 hover:bg-teal-700/60 border border-teal-500/30 text-[10px] font-bold text-teal-300 hover:text-white rounded-md cursor-pointer transition-all flex items-center gap-1 shadow-sm">
                                    + Add Relation
                                </button>
                            </div>
                            <div class="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                                ${relsHTML}
                            </div>
                        </div>
                    `;
                }

                return DOM.unsafe(`
                    <div class="inventory-panel bg-gray-900/90 backdrop-blur-xl border border-white/5 rounded-2xl shadow-2xl p-4 flex flex-col gap-4 text-left w-full h-full max-h-[75vh]" id="inventory-panel">
                        <!-- Header -->
                        <div class="flex justify-between items-center border-b border-white/5 pb-2.5">
                            <div class="flex items-center gap-2 text-teal-400 font-bold text-sm">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
                                Journal & Inventory
                            </div>
                            <button onclick="UIManager.toggleInventoryPanel()" class="bg-white/5 hover:bg-white/10 border border-white/5 text-gray-400 hover:text-white p-1.5 rounded-xl cursor-pointer transition-all shadow-sm">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>

                        <!-- Tab Selectors -->
                        <div class="flex bg-black/30 border border-white/5 p-1 rounded-xl gap-1">
                            <button onclick="UIManager.switchInventoryTab('inventory')" class="${tabClass(isInv)} flex-1 text-center">Inventory</button>
                            <button onclick="UIManager.switchInventoryTab('quests')" class="${tabClass(isQst)} flex-1 text-center">Quests</button>
                            <button onclick="UIManager.switchInventoryTab('relationships')" class="${tabClass(isRel)} flex-1 text-center">Relations</button>
                        </div>

                        <!-- Content Area -->
                        <div class="flex-1 min-h-0 overflow-y-auto pr-1">
                            ${contentHTML}
                        </div>
                    </div>
                `);
            },

            /**
             * [UI:TEMPLATE:CHARACTER_TILE]
             * Renders a single character card for the roster.
             */
            CharacterTile(char) {
                const tagsHTML = (Array.isArray(char.tags) ? char.tags : []).map(tag => DOM.html`<span class="tag-lozenge">${tag}</span>`);
                const isActive = char.is_active;

                // Role Badge
                let roleBadge = '';
                if (char.is_user) {
                    roleBadge = DOM.unsafe(`
                        <div class="user-badge-premium">
                            <svg fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"></path></svg>
                            <span>User</span>
                        </div>
                    `);
                } else if (char.is_narrator) {
                    roleBadge = DOM.unsafe(`
                        <div class="user-badge-premium" style="background: rgba(20, 184, 166, 0.4); border-color: rgba(20, 184, 166, 0.5);">
                            <svg class="w-3.5 h-3.5 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                            <span>Narrator</span>
                        </div>
                    `);
                }

                const portraitSrc = UIManager.getPortraitSrc(char);
                const tileId = `char-tile-${char.id}`;

                return DOM.html`
            <div id="${tileId}" data-action="open-character-detail" data-id="${char.id}" 
                 class="char-roster-btn bg-gray-900 group cursor-pointer relative overflow-hidden transition-all duration-300 ${!isActive ? 'grayscale-[80%] opacity-60' : ''}">
                
                ${portraitSrc ? DOM.html`<div class="absolute inset-0 z-0" style="background-image: url('${UTILITY.safeStyleUrl(portraitSrc)}'); background-size: cover; background-position: center;"></div>` : DOM.html`
                    <div class="placeholder-geometric z-0">
                        <div class="geo-circle geo-1"></div>
                        <div class="geo-circle geo-2"></div>
                        <div class="geo-circle geo-3"></div>
                    </div>
                `}

                <!-- Top Left: Meta -->
                <div class="absolute top-4 left-4 flex flex-row items-center gap-2 z-20 pointer-events-none">
                    ${roleBadge}
                </div>
                
                <!-- Top Right: Toggle (Hover) -->
                <div class="absolute top-4 right-4 z-30 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                    <button class="w-8 h-8 flex items-center justify-center bg-black/60 hover:bg-indigo-600/80 backdrop-blur-md rounded-full border border-white/10 text-white shadow-xl transition-all active:scale-90" 
                            onclick="event.stopPropagation(); NarrativeController.toggleCharacterActive(event, '${char.id}')"
                            title="${isActive ? 'Deactivate' : 'Activate'}">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${isActive ? 'M5 13l4 4L19 7' : 'M12 4v16m8-8H4'}"></path>
                        </svg>
                    </button>
                </div>

                <div class="char-roster-content text-white">
                    <h3 class="truncate">${char.name}</h3>
                    <div class="char-folio-description">${char.short_description}</div>
                    <div class="flex flex-wrap mt-2 h-6 overflow-hidden">${tagsHTML}</div>
                </div>
            </div>
        `;
            },

            /**
             * [UI:TEMPLATE:SCENARIO_CHARACTER_TILE]
             * Renders a single character card specifically for the Scenario Cast editor.
             */
            ScenarioCharacterTile(char, isActive, isSpeaker, isScenarioUser) {
                const portraitSrc = (char.base_image_id && window.characterImages?.[char.base_image_id]) ||
                    (UIManager.RUNTIME.characterImageCache[char.id]) ||
                    (char.image_url && !char.image_url.startsWith('local_') ? char.image_url : '');

                let roleBadge = '';
                if (isScenarioUser) {
                    roleBadge = DOM.unsafe(`
                        <div class="user-badge-premium">
                            <svg fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"></path></svg>
                            <span>User</span>
                        </div>
                    `);
                } else if (char.is_narrator) {
                    roleBadge = DOM.unsafe(`
                        <div class="user-badge-premium" style="background: rgba(20, 184, 166, 0.4); border-color: rgba(20, 184, 166, 0.5);">
                            <svg class="w-3.5 h-3.5 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                            <span>Narrator</span>
                        </div>
                    `);
                }

                const tileId = `char-scenario-tile-${char.id}`;

                return DOM.html`
            <div id="${tileId}" 
                 onclick="LibraryController.toggleScenarioCharacter('${char.id}')"
                 class="char-roster-btn bg-gray-900 group relative transition-all duration-200 cursor-pointer overflow-hidden ${!isActive ? 'grayscale-[80%] opacity-60' : ''}">
                 
                ${portraitSrc ? DOM.html`<div class="absolute inset-0 z-0" style="background-image: url('${UTILITY.safeStyleUrl(portraitSrc)}'); background-size: cover; background-position: center;"></div>` : DOM.html`
                    <div class="placeholder-geometric z-0">
                        <div class="geo-circle geo-1"></div>
                        <div class="geo-circle geo-2"></div>
                        <div class="geo-circle geo-3"></div>
                    </div>
                `}

                <!-- Top Left: Meta -->
                <div class="absolute top-4 left-4 flex flex-row items-center gap-2 z-20 pointer-events-none">
                    ${roleBadge}
                </div>
                
                ${isSpeaker ? DOM.unsafe('<div class="absolute bottom-5 right-5 bg-yellow-500 text-black text-[10px] font-black px-2.5 py-1.5 rounded-xl shadow-lg flex items-center gap-1.5 z-20 border border-yellow-300/50"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg> SPEAKER</div>') : ''}
                
                <!-- Top Right: Controls (On Hover) -->
                <div class="absolute top-4 right-4 z-40 flex flex-col gap-2 items-end opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                    <button class="w-8 h-8 flex items-center justify-center bg-black/60 hover:bg-indigo-600/80 backdrop-blur-md rounded-full border border-white/10 text-white shadow-xl transition-all active:scale-90" 
                            onclick="event.stopPropagation(); LibraryController.toggleScenarioCharacter('${char.id}')"
                            title="${isActive ? 'Deactivate' : 'Activate'}">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${isActive ? 'M5 13l4 4L19 7' : 'M12 4v16m8-8H4'}"></path>
                        </svg>
                    </button>
                    
                    ${!isScenarioUser && isActive ? DOM.unsafe(`
                    <button onclick="event.stopPropagation(); LibraryController.setScenarioUser('${char.id}')" class="bg-black/80 backdrop-blur-md p-2 rounded-xl border border-white/10 hover:bg-indigo-500/20 hover:border-indigo-400 transition-all shadow-lg text-indigo-400" title="Set as User">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                    </button>
                    `) : ''}
                    
                    ${!isSpeaker && isActive ? DOM.unsafe(`
                    <button onclick="event.stopPropagation(); LibraryController.setScenarioSpeaker('${char.id}')" class="bg-black/80 backdrop-blur-md p-2 rounded-xl border border-white/10 hover:bg-yellow-500/20 hover:border-yellow-400 transition-all shadow-lg text-yellow-400" title="Set as First Speaker">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                    </button>
                    `) : ''}
                </div>
                
                <div class="char-roster-content text-white">
                    <h3 class="truncate">${char.name}</h3>
                    <div class="char-folio-description">${char.short_description}</div>
                </div>
            </div>
        `;
            },

            /**
             * [UI:TEMPLATE:MESSAGE_BUBBLE]
             * Renders a single chat message bubble.
             * Handles Markdown parsing, newline preservation, and image embedding.
             */
            MessageBubble(msg, index, state) {
                if (msg.type === 'lore_reveal' || msg.isHidden) return '';

                // Text Mode reuses this same renderer so every message tool keeps working.
                // While a thread is open, show only that thread; otherwise hide private messages.
                const dmCharId = (typeof TextModeController !== 'undefined') ? TextModeController.RUNTIME.activeCharId : null;
                if (dmCharId) {
                    if (msg.type !== 'dm' || msg.exclusive_to_char_id !== dmCharId) return '';
                } else if (msg.type === 'dm') {
                    return '';
                }

                if (msg.type === 'visual_event') {
                    if (msg.isLoading) {
                        return DOM.html`
                            <div class="chat-bubble-container w-full my-6 flex flex-col items-center animate-fade-in" data-message-index="${index}">
                                <div class="visual-event-card bg-gray-900/40 border border-gray-700/50 rounded-xl overflow-hidden max-w-lg w-full shadow-2xl relative animate-pulse flex flex-col items-center justify-center min-h-[320px] backdrop-blur-sm group">
                                    <div class="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity flex space-x-2">
                                         <button data-action="confirm-delete-message" data-index="${index}" class="bg-black/50 hover:bg-red-500/80 p-2 rounded-full text-white backdrop-blur-md transition-colors" title="Delete Placeholder">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                         </button>
                                    </div>
                                    <div class="flex flex-col items-center text-gray-500">
                                        <svg class="w-12 h-12 mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                                        </svg>
                                        <p class="text-sm font-medium tracking-wide uppercase italic opacity-40">${msg.content || 'Painting scene...'}</p>
                                    </div>
                                </div>
                            </div>`;
                    }
                    const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                    return DOM.html`
                        <div class="chat-bubble-container w-full my-6 flex flex-col items-center animate-fade-in" data-message-index="${index}">
                            <div class="visual-event-card bg-gray-900 border border-gray-700 rounded-xl overflow-hidden max-w-lg w-full shadow-2xl relative group transform hover:scale-[1.01] transition-all duration-300">
                                <div class="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity flex space-x-2">
                                     <button onclick="NarrativeController.handleVisualAction('save', '${msg.image_key}')" class="bg-black/50 hover:bg-indigo-600 p-2 rounded-full text-white backdrop-blur-md transition-colors" title="Save to Device">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                     </button>
                                     <button onclick="NarrativeController.handleVisualAction('background', '${msg.image_key}')" class="bg-black/50 hover:bg-emerald-600 p-2 rounded-full text-white backdrop-blur-md transition-colors" title="Set as Background">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                     </button>
                                     <button onclick="NarrativeController.regenerateVisual(${index}, this)" class="bg-black/50 hover:bg-purple-500 p-2 rounded-full text-white backdrop-blur-md transition-colors" title="Regenerate Image">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                     </button>
                                     <button onclick="UIManager.showPromptModal(this.closest('.visual-event-card').querySelector('img').dataset.prompt)" class="bg-black/50 hover:bg-sky-500 p-2 rounded-full text-white backdrop-blur-md transition-colors" title="View Info">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                     </button>
                                     <button data-action="confirm-delete-message" data-index="${index}" class="bg-black/50 hover:bg-red-500/80 p-2 rounded-full text-white backdrop-blur-md transition-colors" title="Delete">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                     </button>
                                </div>
                                <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" 
                                     data-visual-key="${msg.image_key}" 
                                     data-prompt="${UTILITY.escapeHTML(msg.content)}"
                                     data-is-new="${msg.isNew ? 'true' : 'false'}"
                                     onclick="UIManager.viewChatImage(this.src, null)"
                                     class="w-full h-auto object-cover min-h-[256px] bg-gray-800 cursor-pointer" 
                                     alt="Generated Scene" 
                                     onload="UIManager.hydrateVisualImage(this)">
                                <canvas class="absolute inset-0 w-full h-full pointer-events-none z-[5]" data-bleed-canvas></canvas>
                            </div>
                        </div>`;
                }

                if (msg.type === 'system_event') {
                    return DOM.html`<div class="w-full text-center my-2"><p class="text-sm italic text-gray-400">${msg.content}</p></div>`;
                }

                // ── SWARM SUMMARY BUBBLE ──────────────────────────────────────────────────
                if (msg.type === 'swarm_summary') {
                    const agentResults = msg.agentResults || [];
                    const ncDelta = msg.ncDelta || {};
                    const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

                    const urgencyColors = {
                        NONE: 'bg-gray-700 text-gray-400',
                        LOW: 'bg-blue-900/70 text-blue-300',
                        MODERATE: 'bg-amber-900/70 text-amber-300',
                        HIGH: 'bg-orange-900/70 text-orange-300',
                        ABSOLUTE: 'bg-red-900/80 text-red-300'
                    };

                    const agentRows = agentResults.map(a => {
                        const urgency = (a.urgency || 'NONE').toUpperCase();
                        const colorClass = urgencyColors[urgency] || urgencyColors.NONE;
                        const ncInfo = ncDelta[a.charId] || {};
                        const ncStr = (ncInfo.remaining !== undefined)
                            ? `<span class="text-gray-500 text-[10px] ml-2">NC ${ncInfo.remaining} (${ncInfo.spent > 0 ? '-' + ncInfo.spent : '≈'})</span>`
                            : '';
                        const thoughtText = UTILITY.escapeHTML(a.thoughts || a.intent || a.reflection || '…');
                        return `<div class="flex items-start gap-2 py-1.5 border-t border-white/5 first:border-t-0">
                            <span class="shrink-0 font-medium text-gray-300 text-xs w-20 truncate" title="${UTILITY.escapeHTML(a.charName)}">${UTILITY.escapeHTML(a.charName)}</span>
                            <span class="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${colorClass}">${urgency}</span>
                            ${ncStr}
                            <span class="text-gray-400 text-xs italic flex-1">${thoughtText}</span>
                        </div>`;
                    }).join('');

                    const vacuumBadge = msg.vacuumTriggered
                        ? '<span class="text-[10px] bg-violet-900/60 text-violet-300 font-bold px-2 py-0.5 rounded uppercase ml-2">Vacuum</span>'
                        : '';

                    const summaryId = `swarm-summary-${index}`;
                    return DOM.html`<div class="chat-bubble-container w-full my-2 flex justify-center" data-message-index="${index}">
                        <div class="swarm-summary-card w-full max-w-2xl" id="${summaryId}">
                            <button class="swarm-summary-toggle w-full flex items-center gap-2 text-left px-3 py-2 rounded-t-lg bg-gray-900/60 border border-indigo-900/40 hover:bg-gray-900/80 transition-colors"
                                onclick="this.closest('.swarm-summary-card').classList.toggle('swarm-open')">
                                <svg class="w-3.5 h-3.5 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"/>
                                </svg>
                                <span class="text-[11px] font-semibold text-indigo-400 uppercase tracking-wider">Swarm Deliberation</span>
                                ${DOM.unsafe(vacuumBadge)}
                                <span class="ml-auto text-[10px] text-gray-600">${ts}</span>
                                <svg class="swarm-chevron w-3 h-3 text-gray-500 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                                </svg>
                            </button>
                            <div class="swarm-summary-body hidden px-3 py-2 bg-gray-950/60 border border-t-0 border-indigo-900/30 rounded-b-lg">
                                ${DOM.unsafe(agentRows || '<p class="text-gray-600 text-xs italic">No agent data.</p>')}
                            </div>
                        </div>
                    </div>`;
                }
                // ── END SWARM SUMMARY BUBBLE ──────────────────────────────────────────────

                const character = ReactiveStore.getCharacter(msg.character_id);
                if (!character) return '';

                const userChar = state.characters.find(c => c.is_user);
                const characterName = character.name;
                const userName = userChar ? userChar.name : 'You';

                const replacer = (text) => text.replace(/{character}/g, characterName).replace(/{user}/g, userName);

                // 1. Trim source to prevent initial whitespace issues
                let processedContent = replacer(msg.content).trim();

                // 2. Preserve Arbitrary Newlines (3 or more)
                // Standard Markdown collapses \n\n\n into a single paragraph break.
                // We replace 3+ newlines with explicit <br> tags so they render visually.
                processedContent = processedContent.replace(/\n{3,}/g, (match) => '<br>'.repeat(match.length));

                const styledContent = processedContent
                    .replace(/(["“][^"”]*["”])/g, `<span class="dialogue-quote">$1</span>`)
                    .replace(/(^|\s)'((?:[^']|'(?=\w)){2,})'(?=\s|[.,!?;:]|$)/gm, `$1<span class="dialogue-quote">'$2'</span>`);

                // 3. Trim output HTML to remove the trailing newline that 'marked' adds
                let contentHTML = DOM.unsafe(marked.parse(styledContent || '').trim());

                // Styling
                let bubbleStyle = '';
                let characterNameColor = '';
                // Determine which portrait to show (default vs emotion-specific)
                const imgSrc = UIManager.getPortraitSrc(character, msg.emotion);

                if (state.characterImageMode === 'bubble' && imgSrc) {
                    contentHTML = DOM.html`<img src="${imgSrc}" class="bubble-char-image cursor-pointer hover:opacity-90 transition-opacity" data-action="view-chat-image" data-src="${imgSrc}" title="View Full Size">${contentHTML}`;
                }

                const defaultColor = character.is_user
                    ? { base: '#4b5563', bold: '#e5e7eb' }
                    : { base: '#334155', bold: '#94a3b8' };

                const charColor = character.color || defaultColor;
                const topColor = UTILITY.hexToRgba(charColor.base, state.bubbleOpacity);
                const bottomColor = UTILITY.hexToRgba(UTILITY.darkenHex(charColor.base, 10), state.bubbleOpacity);

                bubbleStyle = `background-image: linear-gradient(to bottom, ${topColor}, ${bottomColor});`;
                characterNameColor = `style="color: ${charColor.bold};"`;

                const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';


                // Bubble Body with ClickHandler for Version Cycling
                // We add a data-attribute to indicate if it has versions for optional CSS cues
                const hasVersions = msg.versions && msg.versions.length > 1;
                // Version Hint moved to Header
                const versionHint = hasVersions
                    ? DOM.html`<span id="version-hint-${index}" class="text-[12px] text-gray-500 ml-2 select-none self-center" title="Click bubble to view ${msg.versions.length} versions">v${(msg.currentVersion || 0) + 1}/${msg.versions.length}</span>`
                    : DOM.html`<span id="version-hint-${index}"></span>`;

                const curVer = msg.currentVersion || 0;
                const thinkingText = (msg.versions && msg.versions[curVer] && msg.versions[curVer].thinking)
                    ? msg.versions[curVer].thinking
                    : (msg.thinking || '');
                const hasThinking = Boolean(thinkingText && thinkingText.trim());

                const thoughtBadge = DOM.html`
                    <span id="thought-badge-${index}" class="${hasThinking ? '' : 'hidden'}">
                        <button data-action="view-message-thinking" data-index="${index}" class="text-[11px] inline-flex items-center gap-1 text-purple-300/90 hover:text-purple-200 bg-purple-950/50 hover:bg-purple-900/60 border border-purple-700/50 px-1.5 py-0.5 rounded ml-2 select-none transition-colors" title="View Thinking / Reasoning">
                            <svg class="w-3 h-3 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>
                            <span>Thought</span>
                        </button>
                    </span>
                `;

                // Safe check for image gen
                let allowImageGen = false;
                try {
                    allowImageGen = (typeof UIManager !== 'undefined' && UIManager.isImageGenEnabled)
                        ? UIManager.isImageGenEnabled()
                        : (typeof StateManager !== 'undefined' && StateManager.data && StateManager.data.globalSettings && StateManager.data.globalSettings.imageGenBackend !== 'disabled');
                } catch (e) { console.warn("Chat Render Error (Image Gen):", e); }

                const imageGenBtn = allowImageGen
                    ? `<button data-action="trigger-visual-event" data-index="${index}" class="text-gray-400 hover:text-indigo-400 p-0.5 rounded transition-colors" title="Generate Image"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg></button>`
                    : '';

                const imagesHTML = (msg.images && msg.images.length > 0)
                    ? `<div class="message-image-container">${msg.images.map(imgId => `<img data-img-id="${imgId}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" class="message-img" onload="UIManager.hydrateMessageImage(this)" onclick="UIManager.viewChatImage(this.src)">`).join('')}</div>`
                    : '';

                return DOM.html`
            <div class="chat-bubble-container ${msg.isNew ? 'new-message' : ''}" data-message-index="${index}" data-dm-side="${character.is_user ? 'user' : 'char'}">
                <div class="bubble-header flex items-baseline">
                     <p class="dm-longpress-target font-bold text-sm cursor-pointer hover:underline decoration-dotted underline-offset-4"
                        ${DOM.unsafe(characterNameColor)}
                        data-action="open-character-detail"
                        data-id="${character.id}"
                        title="Open Character Details (long press or right click to text)">
                        ${character.name}
                     </p>
                     ${versionHint}
                     ${thoughtBadge}
                     <span class="timestamp text-xs text-gray-500 ml-2">${timestamp}</span>
                     <div class="action-btn-group flex items-center ml-auto space-x-2 pl-2">
                        ${DOM.unsafe(imageGenBtn)}
                        <button data-action="chat-edit" data-index="${index}" class="text-gray-400 hover:text-white p-0.5 rounded transition-colors" title="Edit Message">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                        </button>
                        <button data-action="confirm-delete-message" data-index="${index}" class="text-gray-400 hover:text-red-400 p-0.5 rounded transition-colors" title="Delete Message">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                        <div class="message-menu-anchor relative inline-block">
                            <button data-action="toggle-message-menu" data-index="${index}" class="text-gray-400 hover:text-white p-0.5 rounded transition-colors" title="More options">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path></svg>
                            </button>
                            <div id="message-menu-${index}" class="message-dropdown-menu hidden absolute right-0 top-full mt-1 bg-gray-900/95 border border-gray-700/80 rounded-lg shadow-2xl py-1.5 z-30 backdrop-blur-md text-xs" style="width: max-content; min-width: max-content;">
                                <button id="menu-view-thinking-${index}" data-action="view-message-thinking" data-index="${index}" class="${hasThinking ? 'flex' : 'hidden'} w-full items-center gap-2 px-3 py-1.5 text-left whitespace-nowrap text-purple-300 hover:bg-purple-900/30 transition-colors">
                                    <svg class="w-3.5 h-3.5 shrink-0 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>
                                    <span>View Thinking</span>
                                </button>
                                <button data-action="trigger-visual-event" data-index="${index}" class="${allowImageGen ? 'flex' : 'hidden'} w-full items-center gap-2 px-3 py-1.5 text-left whitespace-nowrap text-indigo-300 hover:bg-indigo-900/30 transition-colors">
                                    <svg class="w-3.5 h-3.5 shrink-0 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                    <span>Generate Image</span>
                                </button>
                                <button data-action="chat-copy" data-index="${index}" class="flex w-full items-center gap-2 px-3 py-1.5 text-left whitespace-nowrap text-gray-300 hover:bg-gray-800/80 transition-colors">
                                    <svg class="w-3.5 h-3.5 shrink-0 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                                    <span>Copy Text</span>
                                </button>
                                <button data-action="create-static-from-message" data-index="${index}" class="flex w-full items-center gap-2 px-3 py-1.5 text-left whitespace-nowrap text-gray-300 hover:bg-gray-800/80 transition-colors">
                                    <svg class="w-3.5 h-3.5 shrink-0 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                                    <span>Create Static Memory</span>
                                </button>
                                <button data-action="chat-edit" data-index="${index}" class="flex w-full items-center gap-2 px-3 py-1.5 text-left whitespace-nowrap text-gray-300 hover:bg-gray-800/80 transition-colors">
                                    <svg class="w-3.5 h-3.5 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                    <span>Edit Message</span>
                                </button>
                                <div class="my-1 border-t border-gray-800"></div>
                                <button data-action="confirm-delete-message" data-index="${index}" class="flex w-full items-center gap-2 px-3 py-1.5 text-left whitespace-nowrap text-red-400 hover:bg-red-950/40 transition-colors">
                                    <svg class="w-3.5 h-3.5 shrink-0 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                    <span>Delete Message</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="bubble-body rounded-lg px-3 py-2 cursor-pointer transition-all duration-200 relative" 
                     style="${DOM.unsafe(bubbleStyle)}" 
                     onclick="NarrativeController.cycleMessageVersion(${index})"
                     title="${hasVersions ? 'Click to cycle versions' : ''}">
                     ${DOM.unsafe(imagesHTML)}
                     <div id="message-content-${index}" class="whitespace-pre-wrap relative" style="color: ${state.chatTextColor}; font-family: ${state.font};">${contentHTML}</div>
                     <div class="clear-both"></div>
                </div>
            </div>`;
            },

            /**
             * [UI:TEMPLATE:STORY_LIST_ITEM]
             * Renders a story item in the library list as a visual card.
             */
            StoryListItem(story, isActive, viewMode = 'grid') {
                const duplicateIcon = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>`;
                const deleteIcon = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>`;
                const folderIcon = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path></svg>`;
                const playIcon = `<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>`;

                if (viewMode === 'list') {
                    const dateStr = new Date(story.last_modified).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                    const charCount = (story.characters || []).length;
                    const firstTag = (story.tags && story.tags.length > 0) ? story.tags[0] : null;
                    const listTagPill = firstTag ? DOM.html`<span class="ml-2 text-[10px] bg-teal-500/10 text-teal-400 border border-teal-500/20 px-1.5 py-0.5 rounded font-medium flex-shrink-0">${firstTag}</span>` : '';
                    return DOM.html`
                        <div class="group w-full max-w-full flex items-center justify-between p-4 min-h-[5.5rem] rounded-lg bg-gray-800/40 border border-transparent hover:border-teal-500/20 hover:bg-gray-800/60 transition-all cursor-pointer overflow-hidden relative ${isActive ? 'border-teal-500/30 bg-teal-950/10' : ''}"  
                             draggable="true"
                             ondragstart="LibraryController.handleStoryDragStart(event, '${story.id}')"
                             ontouchstart="LibraryController.handleStoryTouchStart(event, '${story.id}')"
                             ontouchmove="LibraryController.handleStoryTouchMove(event)"
                             ontouchend="LibraryController.handleStoryTouchEnd(event)"
                             onclick="UIManager.openStoryDetails('${story.id}')">
                            <div class="flex items-center gap-4 min-w-0 pr-2 flex-grow">
                                <div class="w-14 h-14 rounded-lg bg-gray-700 flex-shrink-0 overflow-hidden relative shadow-md">
                                     <div id="story-bg-${story.id}" class="absolute inset-0 bg-cover bg-center opacity-90" style="background-image: url('${UTILITY.safeStyleUrl(story.backgroundImageURL)}')"></div>
                                     ${isActive ? DOM.unsafe('<div class="absolute inset-0 ring-2 ring-inset ring-teal-500/30 rounded-lg"></div>') : ''}
                                </div>
                                <div class="min-w-0 flex-1 flex flex-col justify-center">
                                    <div class="flex items-center gap-2 min-w-0 mb-0.5">
                                        <h4 class="font-bold text-gray-100 text-base truncate leading-tight">${story.name || 'Untitled'}</h4>
                                        ${listTagPill}
                                    </div>
                                    <p class="text-sm text-gray-400 mt-1">${dateStr} &middot; ${charCount} chars</p>
                                </div>
                            </div>
                              <div class="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" onclick="event.stopPropagation()">
                                 <button onclick="LibraryController.handleQuickPlay('${story.id}')" class="p-1.5 text-gray-400 hover:text-green-400 transition-colors rounded" title="Quick Play">${DOM.unsafe(playIcon)}</button>
                                 <button onclick="UIManager.showAddStoryToFolderModal('${story.id}')" class="p-1.5 text-gray-400 hover:text-white transition-colors rounded" title="Add to Folder">${DOM.unsafe(folderIcon)}</button>
                                 <button onclick="LibraryController.duplicateStory('${story.id}')" class="p-1.5 text-gray-400 hover:text-white transition-colors rounded" title="Duplicate">${DOM.unsafe(duplicateIcon)}</button>
                                 <button onclick="LibraryController.deleteStory('${story.id}')" class="p-1.5 text-gray-400 hover:text-red-400 transition-colors rounded" title="Delete">${DOM.unsafe(deleteIcon)}</button>
                              </div>
                        </div>
                     `;
                }

                // Card Style with Active State
                const activeWrapperClass = isActive ? 'shadow-[0_0_15px_rgba(20,184,166,0.3)]' : '';
                const activeBadge = isActive ? DOM.html`<div class="absolute top-2 right-2 z-20 bg-teal-600/90 text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg backdrop-blur-sm tracking-wider">ACTIVE</div>` : '';

                // Fallback Deterministic Gradient based on Story ID
                const hue = parseInt(story.id.substring(0, 8), 16) % 360;
                const gradientStyle = `background: linear-gradient(135deg, hsl(${hue}, 30%, 15%) 0%, hsl(${(hue + 40) % 360}, 20%, 10%) 100%);`;
                const borderStyle = isActive ? 'border: 1px solid rgba(20,184,166,0.3);' : 'border: 1px solid rgba(255, 255, 255, 0.05);';

                // Metadata Formatting
                const dateStr = new Date(story.last_modified).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                const charCount = (story.characters || []).length;
                const charText = charCount === 1 ? '1 Character' : `${charCount} Characters`;

                // Appearance Settings (Sync with Story)
                const defaults = UTILITY.getDefaultUiSettings();
                const titleFont = story.font || defaults.font;
                const titleColor = story.chatTextColor || defaults.chatTextColor;

                return DOM.html`
            <div class="relative group h-48 w-full rounded-xl overflow-hidden transition-all duration-300 transform hover:scale-[1.02] cursor-pointer bg-gray-900 flex flex-col justify-end ${activeWrapperClass}" 
                 draggable="true"
                 ondragstart="LibraryController.handleStoryDragStart(event, '${story.id}')"
                 ontouchstart="LibraryController.handleStoryTouchStart(event, '${story.id}')"
                 ontouchmove="LibraryController.handleStoryTouchMove(event)"
                 ontouchend="LibraryController.handleStoryTouchEnd(event)"
                 onclick="UIManager.openStoryDetails('${story.id}')" style="${gradientStyle} ${borderStyle}">
                
                <!-- Background Image Layer (Async Hydrated) -->
                <div id="story-bg-${story.id}" class="absolute inset-0 bg-cover transition-transform duration-700 group-hover:scale-105 opacity-90" style="background-position: center 20%;"></div>
                
                <!-- Bottom Gradient for Text Readability -->
                <div class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/50 to-transparent z-10 pointer-events-none"></div>
 
                ${activeBadge}
 
                <!-- Action Overlay (Top Right) -->
                <div class="absolute top-2 right-2 z-30 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity" onclick="event.stopPropagation()">
                     <button onclick="LibraryController.handleQuickPlay('${story.id}')" class="p-1.5 bg-black/50 hover:bg-black/80 rounded text-gray-300 hover:text-green-400 backdrop-blur-sm transition-colors" title="Quick Play">${DOM.unsafe(playIcon)}</button>
                     <button onclick="UIManager.showAddStoryToFolderModal('${story.id}')" class="p-1.5 bg-black/50 hover:bg-black/80 rounded text-gray-300 hover:text-white backdrop-blur-sm transition-colors" title="Add to Folder">${DOM.unsafe(folderIcon)}</button>
                     <button onclick="LibraryController.duplicateStory('${story.id}')" class="p-1.5 bg-black/50 hover:bg-black/80 rounded text-gray-300 hover:text-white backdrop-blur-sm transition-colors" title="Duplicate">${DOM.unsafe(duplicateIcon)}</button>
                     <button onclick="LibraryController.deleteStory('${story.id}')" class="p-1.5 bg-black/50 hover:bg-red-900/80 rounded text-gray-300 hover:text-red-300 backdrop-blur-sm transition-colors" title="Delete">${DOM.unsafe(deleteIcon)}</button>
                </div>
 
                <!-- Card Content -->
                <div class="relative z-20 p-4 w-full pointer-events-none">
                    <h3 class="font-bold text-lg drop-shadow-md leading-tight mb-1.5 line-clamp-2 group-hover:opacity-80 transition-opacity pr-12" 
                        style="font-family: ${titleFont}; color: ${titleColor}; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">
                        ${story.name || 'Untitled Story'}
                    </h3>
                    <div class="flex items-center flex-wrap gap-1.5">
                        <span class="bg-black/50 px-1.5 py-0.5 rounded text-gray-400 border border-white/5 text-[10px] font-medium">${dateStr}</span>
                        <span class="text-gray-500 text-[9px]">&middot;</span>
                        <span class="text-gray-400 text-[10px]">${charText}</span>
                        ${DOM.unsafe((story.tags || []).slice(0, 3).map(t => `<span class="bg-teal-500/10 text-teal-300 border border-teal-500/20 px-1.5 py-0.5 rounded text-[10px] font-medium">${t}</span>`).join(''))}
                    </div>
                </div>
            </div>
        `;
            },


            /**
             * Renders a collapsible Scenario item for Story Details.
             */
            ScenarioItem(scenario, storyId) {
                const messageHTML = DOM.unsafe(marked.parse(scenario.message || '*(No message)*'));
                // Extract custom Scenario aesthetic configs (Cascading: Scenario -> Story -> Default)
                const story = StateManager.getLibrary().stories.find(s => s.id === storyId);
                const customFont = scenario.font || (story && story.font) || 'var(--font-primary)';
                const customColor = scenario.chatTextColor || (story && story.chatTextColor) || '#fff';

                return DOM.html`
            <div class="relative bg-white/[0.01] rounded-xl border border-white/5 shadow-[0_10px_30px_rgba(0,0,0,0.5)] overflow-hidden group transition-all hover:border-teal-500/30 min-w-[280px] w-[280px] md:min-w-[340px] md:w-[340px] shrink-0 snap-start flex flex-col h-[380px] hover:-translate-y-1 duration-300">
                
                <!-- Checkbox for Bulk Actions (Positioned top-left) -->
                <div class="absolute top-4 left-4 z-10 flex items-center justify-center h-6 w-6 hidden scenario-checkbox-container">
                    <input type="checkbox" 
                           class="scenario-select-check w-4 h-4 rounded border-gray-500 bg-black/40 text-teal-600 focus:ring-0 cursor-pointer" 
                           value="${scenario.id}" 
                           onchange="UIManager.updateBulkActionUI()">
                </div>

                <div class="p-6 flex flex-col h-full cursor-default relative">
                    <!-- Title synced with custom typography -->
                    <h3 class="text-2xl font-black text-center mb-3 tracking-wide drop-shadow-md" style="font-family: ${customFont}; color: ${customColor};">
                        ${scenario.name}
                    </h3>
                    
                    <!-- Decorative Divider -->
                    <div class="w-16 h-px bg-white/5 mx-auto mb-4"></div>

                    <!-- Blurb (First Message) styled as back cover synopsis -->
                    <div class="text-sm md:text-base text-gray-300/90 prose prose-invert prose-sm max-w-none text-center leading-relaxed italic px-1 md:px-2 flex-grow flex flex-col justify-start overflow-y-auto scrollbar-autohide min-h-0 pb-24">
                        ${messageHTML}
                    </div>

                    <!-- Modernized Controls (Hover Overlay) -->
                    <div class="absolute bottom-0 left-0 right-0 p-6 pt-12 bg-gradient-to-t from-black via-black/80 to-transparent flex gap-3 justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20 pointer-events-none">
                        <button data-action="load-scenario" data-story-id="${storyId}" data-scenario-id="${scenario.id}" class="pointer-events-auto text-xs font-semibold uppercase tracking-wider text-teal-400 hover:text-white px-4 py-2 border border-teal-500/30 hover:border-teal-400 bg-teal-900/60 hover:bg-teal-600/80 rounded-full transition-all shadow-lg backdrop-blur-sm" title="Load Scenario">Load</button>
                        <button data-action="edit-scenario" data-story-id="${storyId}" data-scenario-id="${scenario.id}" class="pointer-events-auto text-xs font-semibold uppercase tracking-wider text-teal-400 hover:text-white px-4 py-2 border border-teal-500/30 hover:border-teal-400 bg-teal-900/60 hover:bg-teal-600/80 rounded-full transition-all shadow-lg backdrop-blur-sm" title="Edit">Edit</button>
                        <button data-action="delete-scenario" data-story-id="${storyId}" data-scenario-id="${scenario.id}" class="pointer-events-auto text-xs font-semibold uppercase tracking-wider text-red-300/70 hover:text-red-200 px-4 py-2 border border-red-900/30 hover:border-red-500/50 bg-red-900/40 hover:bg-red-900/80 rounded-full transition-all shadow-lg backdrop-blur-sm" title="Delete">Delete</button>
                    </div>
                </div>
            </div>
        `;
            },

            /**
             * Renders a Narrative list item for Story Details.
             */
            NarrativeItem(narrative, storyId, isActive) {
                const activeBadge = isActive ? DOM.html`<span class="text-xs text-sky-300 font-bold flex-shrink-0 bg-sky-500/20 border border-sky-500/30 px-2 py-0.5 rounded">ACTIVE</span>` : '';

                // FIX: defensive date parsing
                let dateDisplay = 'Date unknown';
                if (narrative.last_modified) {
                    const dateObj = new Date(narrative.last_modified);
                    // Check if date is valid
                    if (!isNaN(dateObj.getTime())) {
                        dateDisplay = dateObj.toLocaleString();
                    }
                }

                const activeClass = isActive
                    ? 'border-sky-500/40 bg-sky-900/10 border-l-2 border-l-sky-400'
                    : 'border-gray-700/60 bg-gray-700/40 border-l-2 border-l-transparent';

                const msgText = narrative.messageCounter !== undefined
                    ? (narrative.messageCounter === 1 ? '1 msg &middot; ' : `${narrative.messageCounter} msgs &middot; `)
                    : '';

                return DOM.html`
            <div class="narrative-item p-3 rounded-lg flex justify-between items-center gap-2 relative group border transition-all cursor-pointer hover:bg-gray-600/40 ${activeClass}" 
                 onclick="UIManager.selectNarrative('${narrative.id}', this)" data-narrative-id="${narrative.id}"
                 title="Long press or right click to select several">
                <div class="absolute left-3 z-10 flex items-center justify-center h-6 w-6 hidden narrative-checkbox-container" onclick="event.stopPropagation()">
                    <input type="checkbox" 
                           class="narrative-select-check w-4 h-4 rounded border-gray-500 bg-black/40 text-sky-500 focus:ring-0 cursor-pointer" 
                           value="${narrative.id}" 
                           onchange="UIManager.updateBulkActionUI()">
                </div>
                <div class="flex-grow min-w-0 transition-[padding] narrative-content overflow-hidden">
                    <p class="font-semibold truncate text-gray-100 text-sm">${narrative.name}</p>
                    <p class="text-xs text-gray-500 mt-0.5">${DOM.unsafe(msgText)}${dateDisplay}</p>
                </div>
                ${activeBadge}
            </div>
        `;
            },

            /** * Renders a dynamic content field editor.
             */
            DynamicContentField(content, index, entryId, totalCount) {
                const isLastField = index === totalCount - 1;
                const stickyNote = isLastField ? DOM.unsafe(`<span class="text-xs text-gray-400 italic ml-4">This entry will be used for all future triggers.</span>`) : '';
                const separator = index > 0 ? DOM.unsafe('<hr class="border-gray-700/50 my-2">') : '';

                return DOM.html`
            ${separator}
            <div class="bg-black/20 p-3 rounded-lg">
                <label class="font-bold mb-2 flex justify-between items-center">
                    <span>Step ${index + 1}</span>
                    ${stickyNote}
                </label>
                <div class="relative">
                    <textarea 
                        placeholder="All empty content fields will be removed when the modal is closed."
                        oninput="WorldController.updateDynamicContentField('${entryId}', ${index}, this.value)" 
                        class="w-full h-24 bg-gray-900/80 border-gray-600 p-2 resize-y rounded-md text-sm"
                    >${content}</textarea>
                    <button 
                        data-action="gen-dynamic-ai" data-id="${entryId}" data-index="${index}" 
                        class="absolute top-2 right-2 text-gray-500 hover:text-indigo-400 transition-colors" 
                        title="Generate with AI"
                    >${UIManager.getAIGenIcon()}</button>
                </div>
            </div>
        `;
            },

            /**
             * Renders a Folder item for the library.
             */
            FolderItem(folder, viewMode = 'grid') {
                // Calculate story count (passed in or calculated)
                const count = folder.story_count !== undefined ? folder.story_count : '?';

                if (viewMode === 'list') {
                    return DOM.html`
                        <div class="group w-full max-w-full flex items-center justify-between p-6 rounded-lg bg-gray-800/60 border border-gray-700 hover:border-indigo-500/50 hover:bg-gray-700 transition-all cursor-pointer mb-2 overflow-hidden relative"
                             ondragover="LibraryController.handleStoryDragOver(event)"
                             ondragleave="LibraryController.handleStoryDragLeave(event)"
                             ondrop="LibraryController.handleStoryDrop(event, '${folder.id}')"
                             data-folder-id="${folder.id}"
                             onclick="UIManager.renderLibraryInterface({ folderId: '${folder.id}' })">
                            <div class="flex items-center space-x-3 min-w-0 flex-grow pr-2">
                                <svg class="w-8 h-8 text-indigo-400 group-hover:text-indigo-300 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path></svg>
                                <div class="min-w-0 flex-1">
                                    <h4 class="font-bold text-gray-200 text-sm truncate leading-tight">${folder.name}</h4>
                                    <p class="text-xs text-gray-500 truncate">${count} Stories</p>
                                </div>
                            </div>
                             <div class="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onclick="event.stopPropagation(); UIManager.showMoveFolderModal('${folder.id}')" class="p-1.5 text-gray-400 hover:text-white" title="Move Folder"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path></svg></button>
                                <button onclick="event.stopPropagation(); LibraryController.renameFolder('${folder.id}')" class="p-1.5 text-gray-400 hover:text-white" title="Rename"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                                <button onclick="event.stopPropagation(); LibraryController.deleteFolder('${folder.id}')" class="p-1.5 text-gray-400 hover:text-red-400" title="Delete"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                            </div>
                        </div>
                     `;
                }

                return DOM.html`
            <div class="relative group h-48 w-full rounded-xl overflow-hidden transition-all duration-300 transform hover:scale-[1.02] cursor-pointer flex flex-col items-center justify-center space-y-3"
                 style="background: linear-gradient(135deg, rgba(55,65,81,0.9) 0%, rgba(31,41,55,0.95) 100%); border: 1px solid rgba(75,85,99,0.7);"
                 ondragover="LibraryController.handleStoryDragOver(event)"
                 ondragleave="LibraryController.handleStoryDragLeave(event)"
                 ondrop="LibraryController.handleStoryDrop(event, '${folder.id}')"
                 data-folder-id="${folder.id}"
                 onclick="UIManager.renderLibraryInterface({ folderId: '${folder.id}' })">
                
                <!-- Folder icon with bounce on hover -->
                <div class="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-2xl group-hover:bg-indigo-500/20 group-hover:-translate-y-1 transition-all duration-300">
                    <svg class="w-10 h-10 text-indigo-400 group-hover:text-indigo-300 transition-colors" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path></svg>
                </div>
                
                <div class="text-center px-4 w-full">
                    <h3 class="font-bold text-base text-gray-200 group-hover:text-white transition-colors truncate">${folder.name}</h3>
                    <span class="inline-block mt-1.5 text-[10px] bg-gray-700/80 border border-gray-600 text-gray-400 px-2 py-0.5 rounded-full font-medium">${count} stories</span>
                </div>

                <!-- Folder Actions (Hover) -->
                <div class="absolute top-2 right-2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity translate-y-2 group-hover:translate-y-0 duration-200">
                    <button onclick="event.stopPropagation(); UIManager.showMoveFolderModal('${folder.id}')" class="p-1.5 bg-gray-900/90 border border-gray-600 rounded-md text-gray-400 hover:text-white hover:border-gray-400 shadow-sm" title="Move Folder"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path></svg></button>
                    <button onclick="event.stopPropagation(); LibraryController.renameFolder('${folder.id}')" class="p-1.5 bg-gray-900/90 border border-gray-600 rounded-md text-gray-400 hover:text-white hover:border-gray-400 shadow-sm" title="Rename"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                    <button onclick="event.stopPropagation(); LibraryController.deleteFolder('${folder.id}')" class="p-1.5 bg-red-900/90 border border-red-800 rounded-md text-red-300 hover:text-white hover:border-red-500 shadow-sm" title="Delete"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                </div>
            </div>
            `;
            }
        };
