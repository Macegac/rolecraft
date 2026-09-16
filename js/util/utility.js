        /**
         * =================================================================================================
         * [SEC:JS:UTIL:UTILS]
         * UTILITY Module
         * Generic helper functions for formatting, parsing, and math.
         * =================================================================================================
         */
        const UTILITY = {
            activePromptResolver: null,

            /**
             * Safely extracts plain text content from string, multimodal prompt objects, or nested prompt objects.
             * @param {string|Object|null|undefined} promptInput
             * @returns {string} The text prompt string.
             */
            resolvePromptText(promptInput) {
                if (!promptInput) return "";
                if (typeof promptInput === 'string') return promptInput;
                if (typeof promptInput === 'object') {
                    if (typeof promptInput.text === 'string') return promptInput.text;
                    if (typeof promptInput.prompt === 'string') return promptInput.prompt;
                    if (typeof promptInput.prompt === 'object') return UTILITY.resolvePromptText(promptInput.prompt);
                }
                return String(promptInput);
            },

            /**
             * Reusable custom input prompt modal that replaces the native window.prompt() dialog.
             * This ensures full support in Electron environments where prompt() is disabled.
             */
            customPrompt(message, defaultValue = '', placeholder = '') {
                return new Promise((resolve) => {
                    const modal = document.getElementById('input-prompt-modal');
                    const titleEl = document.getElementById('input-prompt-title');
                    const msgEl = document.getElementById('input-prompt-message');
                    const field = document.getElementById('input-prompt-field');

                    if (!modal || !field) {
                        resolve(window.prompt(message, defaultValue));
                        return;
                    }

                    msgEl.textContent = message;
                    field.value = defaultValue;
                    field.placeholder = placeholder || 'Enter value...';

                    UTILITY.activePromptResolver = resolve;

                    modal.classList.remove('hidden');
                    modal.classList.add('flex');

                    setTimeout(() => {
                        field.focus();
                        field.select();
                    }, 50);

                    const handleKey = (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            cleanup();
                            this.submitCustomPrompt();
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            cleanup();
                            this.closeCustomPrompt(null);
                        }
                    };

                    const cleanup = () => {
                        field.removeEventListener('keydown', handleKey);
                    };

                    field.addEventListener('keydown', handleKey);
                });
            },

            closeCustomPrompt(value) {
                const modal = document.getElementById('input-prompt-modal');
                if (modal) {
                    modal.classList.add('hidden');
                    modal.classList.remove('flex');
                }
                if (UTILITY.activePromptResolver) {
                    const resolve = UTILITY.activePromptResolver;
                    UTILITY.activePromptResolver = null;
                    resolve(value);
                }
            },

            submitCustomPrompt() {
                const field = document.getElementById('input-prompt-field');
                const val = field ? field.value : null;
                this.closeCustomPrompt(val);
            },

            /**
             * Extracts the category of a static entry based on its category property or title tag.
             * @param {string|object} titleOrEntry - The entry title or entry object.
             * @returns {string} - 'event', 'character', 'item', 'world', 'relationship', or 'other'.
             */
            getEntryCategory(titleOrEntry) {
                if (!titleOrEntry) return 'other';
                if (typeof titleOrEntry === 'object') {
                    if (titleOrEntry.category && titleOrEntry.category !== 'other') {
                        return titleOrEntry.category;
                    }
                    return this.getEntryCategory(titleOrEntry.title);
                }
                const t = String(titleOrEntry).trim().toLowerCase();
                if (t.startsWith('[event]') || t.startsWith('event:') || t.includes('(event)')) return 'event';
                if (t.startsWith('[character:') || t.startsWith('[character]') || t.startsWith('character:') || t.includes('(character)')) return 'character';
                if (t.startsWith('[item]') || t.startsWith('item:') || t.includes('(item)')) return 'item';
                if (t.startsWith('[world]') || t.startsWith('world:') || t.includes('(world)')) return 'world';
                if (t.startsWith('[relationship]') || t.startsWith('relationship:') || t.includes('(relationship)')) return 'relationship';
                return 'other';
            },

            /**
             * Formats an entry title with a category tag.
             * @param {string} title - The current entry title.
             * @param {string} category - The target category ('event', 'character', 'item', 'world', 'relationship', 'other').
             * @returns {string} - The updated title with category tag applied or stripped.
             */
            formatTitleWithCategory(title, category) {
                if (!title) title = 'Untitled';
                let cleanTitle = String(title).trim();
                cleanTitle = cleanTitle.replace(/^\[(event|item|world|relationship)\]\s*/i, '');
                cleanTitle = cleanTitle.replace(/^\[character:\s*([^\]]+)\]/i, '$1');
                cleanTitle = cleanTitle.replace(/^\[character\]\s*/i, '');
                cleanTitle = cleanTitle.replace(/^(event|character|item|world|relationship)\s*:\s*/i, '');
                cleanTitle = cleanTitle.trim();
                if (!cleanTitle) cleanTitle = 'Untitled';

                if (category === 'event') return `[Event] ${cleanTitle}`;
                if (category === 'character') return `[Character: ${cleanTitle}]`;
                if (category === 'item') return `[Item] ${cleanTitle}`;
                if (category === 'world') return `[World] ${cleanTitle}`;
                if (category === 'relationship') return `[Relationship] ${cleanTitle}`;
                return cleanTitle;
            },

            /**
             * Cleans up fact content by removing leading/trailing dashes, quotes, category prefixes, and trailing notes.
             * @param {string} content - The raw content string.
             * @returns {string} - The cleaned content.
             */
            cleanFactContent(content) {
                if (!content) return '';
                let text = content.trim();
                // Strip leading/trailing dashes, quotes, and whitespace
                text = text.replace(/^[-"\s'\u201c\u201d]+|[-"\s'\u201c\u201d]+$/g, '').trim();
                // Strip leading "Character:", "Event details:", etc.
                text = text.replace(/^(character|event|item|world|relationship|fact|update|detail|event details|character details)\s*:\s*/i, '').trim();
                // Strip trailing parentheses like "(Character Details)", "(Relationship Update)", "(Event)"
                text = text.replace(/\s*\((character|event|item|world|relationship|fact|update|detail|event details|character details|character updates|relationship updates|relationship update)\s*\)$/i, '').trim();
                // Re-strip edge quotes/whitespace after cleaning
                text = text.replace(/^[-"\s'\u201c\u201d]+|[-"\s'\u201c\u201d]+$/g, '').trim();
                return text;
            },

            /**
             * Coerces a value into an array of trimmed, non-empty strings.
             * Accepts arrays, comma-separated strings, or scalars; returns [] for nullish/garbage input.
             * Used to repair LLM outputs and legacy/imported data that may store array fields as strings.
             */
            toStringArray(val) {
                if (val == null) return [];
                if (Array.isArray(val)) {
                    return val.map(v => (v == null ? '' : String(v)).trim()).filter(Boolean);
                }
                if (typeof val === 'string') {
                    return val.split(',').map(s => s.trim()).filter(Boolean);
                }
                if (typeof val === 'object') return [];
                const s = String(val).trim();
                return s ? [s] : [];
            },

            /**
             * Formats large numbers into human-readable strings (e.g., 1.5K, 2.3M).
             * @param {number|string} num - The number to format.
             * @returns {string} - The formatted string.
             */
            formatNumber(num) {
                const n = parseFloat(num);
                if (isNaN(n)) return "0";
                if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
                if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
                return n.toString();
            },

            /**
             * Repairs structural defects in a story object in-place.
             * Coerces tag fields to string arrays and ensures other expected
             * collections are arrays. Tolerant of legacy/imported/LLM-malformed data.
             * Returns the same story reference for chaining.
             */
            normalizeStoryShape(story) {
                if (!story || typeof story !== 'object') return story;

                story.tags = this.toStringArray(story.tags);
                if (!Array.isArray(story.characters)) story.characters = [];
                if (!Array.isArray(story.scenarios)) story.scenarios = [];
                if (!Array.isArray(story.static_entries)) story.static_entries = [];
                if (!Array.isArray(story.dynamic_entries)) story.dynamic_entries = [];
                if (!Array.isArray(story.narratives)) story.narratives = [];

                story.characters.forEach(c => {
                    if (!c || typeof c !== 'object') return;
                    c.tags = this.toStringArray(c.tags);
                    if (!Array.isArray(c.extra_portraits)) c.extra_portraits = [];
                    if (!Array.isArray(c.dynamic_knowledge)) c.dynamic_knowledge = [];
                });

                // Ensure default settings are populated for visual elements and other missing keys
                const apiDefaults = this.getDefaultApiSettings();
                const uiDefaults = this.getDefaultUiSettings();
                const sysDefaults = this.getDefaultSystemPrompts();
                const storyDefaults = this.getDefaultStorySettings();

                const allDefaults = {
                    ...apiDefaults,
                    ...uiDefaults,
                    ...sysDefaults,
                    ...storyDefaults
                };

                for (const [key, value] of Object.entries(allDefaults)) {
                    if (story[key] === undefined || story[key] === null) {
                        story[key] = value;
                    }
                }

                // Also ensure scenario prompts have default UI settings and system prompts
                story.scenarios.forEach(scenario => {
                    if (!scenario || typeof scenario !== 'object') return;
                    if (!scenario.prompts || typeof scenario.prompts !== 'object') {
                        scenario.prompts = {};
                    }
                    const scenarioPromptDefaults = {
                        system_prompt: story.system_prompt || sysDefaults.system_prompt,
                        event_master_base_prompt: story.event_master_base_prompt || sysDefaults.event_master_base_prompt,
                        prompt_persona_gen: story.prompt_persona_gen || sysDefaults.prompt_persona_gen,
                        prompt_living_persona_gen: story.prompt_living_persona_gen || sysDefaults.prompt_living_persona_gen,
                        prompt_world_map_gen: story.prompt_world_map_gen || sysDefaults.prompt_world_map_gen,
                        prompt_location_gen: story.prompt_location_gen || sysDefaults.prompt_location_gen,
                        prompt_adjacent_locations_gen: story.prompt_adjacent_locations_gen || sysDefaults.prompt_adjacent_locations_gen,
                        prompt_entry_gen: story.prompt_entry_gen || sysDefaults.prompt_entry_gen,
                        prompt_location_memory_gen: story.prompt_location_memory_gen || sysDefaults.prompt_location_memory_gen,
                        font: story.font || uiDefaults.font,
                        backgroundImageURL: story.backgroundImageURL || uiDefaults.backgroundImageURL,
                        bubbleOpacity: story.bubbleOpacity !== undefined && story.bubbleOpacity !== null ? story.bubbleOpacity : uiDefaults.bubbleOpacity,
                        chatTextColor: story.chatTextColor || uiDefaults.chatTextColor
                    };
                    for (const [key, value] of Object.entries(scenarioPromptDefaults)) {
                        if (scenario.prompts[key] === undefined || scenario.prompts[key] === null) {
                            scenario.prompts[key] = value;
                        }
                    }
                });

                return story;
            },

            /**
             * Extracts internal model "thinking" blocks (e.g. <think>...</think>) from a string.
             * Supports <think>, <thought>, <thinking>, <reasoning>, [THOUGHTS], [REASONING], [THINK].
             * Also cleanly handles unclosed tags at the end of the text (e.g. truncated responses).
             * @param {string} text - The raw AI response.
             * @returns {{ thinking: string, content: string }} - Extracted thoughts and cleaned content.
             */
            extractThinking(text) {
                if (!text || typeof text !== 'string') {
                    return { thinking: "", content: "" };
                }

                const thoughts = [];
                let content = text;

                const patterns = [
                    /<think>([\s\S]*?)(?:<\/think>|$)/gi,
                    /<thought>([\s\S]*?)(?:<\/thought>|$)/gi,
                    /<thinking>([\s\S]*?)(?:<\/thinking>|$)/gi,
                    /<reasoning>([\s\S]*?)(?:<\/reasoning>|$)/gi,
                    /<scratchpad>([\s\S]*?)(?:<\/scratchpad>|$)/gi,
                    /\[THOUGHTS?\]([\s\S]*?)(?:\[\/THOUGHTS?\]|$)/gi,
                    /\[REASONING\]([\s\S]*?)(?:\[\/REASONING\]|$)/gi,
                    /\[THINK\]([\s\S]*?)(?:\[\/THINK\]|$)/gi
                ];

                for (const pattern of patterns) {
                    content = content.replace(pattern, (match, thought) => {
                        const trimmed = (thought || "").trim();
                        if (trimmed) thoughts.push(trimmed);
                        return "";
                    });
                }

                return {
                    thinking: thoughts.join('\n\n').trim(),
                    content: content.trim()
                };
            },

            /**
             * Strips internal model "thinking" blocks (e.g. <think>...</think>) from a string.
             * Supports standard tags like <think>, <thought>, <thinking>, <scratchpad>, [THOUGHTS], [REASONING], [THINK].
             * Also cleanly removes unclosed tags at end of text.
             * @param {string} text - The raw AI response.
             * @returns {string} - The cleaned text.
             */
            stripThinking(text) {
                if (!text || typeof text !== 'string') return text;

                let clean = text
                    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
                    .replace(/<thought>[\s\S]*?(?:<\/thought>|$)/gi, '')
                    .replace(/<thinking>[\s\S]*?(?:<\/thinking>|$)/gi, '')
                    .replace(/<reasoning>[\s\S]*?(?:<\/reasoning>|$)/gi, '')
                    .replace(/<scratchpad>[\s\S]*?(?:<\/scratchpad>|$)/gi, '')
                    .replace(/\[THOUGHTS?\][\s\S]*?(?:\[\/THOUGHTS?\]|$)/gi, '')
                    .replace(/\[REASONING\][\s\S]*?(?:\[\/REASONING\]|$)/gi, '')
                    .replace(/\[THINK\][\s\S]*?(?:\[\/THINK\]|$)/gi, '');

                return clean.trim();
            },

            /**
             * Safely sets the source of an image element, preventing placeholders from leaking.
             * @param {HTMLImageElement} img - The image element.
             * @param {string} src - The image source URI.
             */
            safeImageSet(img, src) {
                if (!img) return;
                const transparentPixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
                let finalSrc = src;
                if (!src || src === 'undefined' || src === 'null' || src.includes('${imgSrc}')) {
                    finalSrc = transparentPixel;
                }
                img.src = finalSrc;
                // Sync dataset for lightbox if needed
                if (img.dataset) {
                    img.dataset.src = finalSrc;
                }
            },
            /**
             * Safely sets the background-image of an element, preventing placeholders from leaking.
             * @param {HTMLElement} el - The element to update.
             * @param {string} url - The image URL.
             */
            safeBackgroundSet(el, url) {
                if (!el) return;
                const transparentPixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
                if (!url || url === 'undefined' || url === 'null' || url.includes('${imgSrc}')) {
                    el.style.backgroundImage = `url('${transparentPixel}')`;
                } else {
                    el.style.backgroundImage = `url('${url.replace(/'/g, "%27")}')`;
                }
            },
            /**
             * Safely formats a URL for use in a CSS background-image: url() string.
             * Returns a transparent pixel if the URL is invalid or contains placeholders.
             */
            safeStyleUrl(url) {
                const transparentPixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
                if (!url || url === 'undefined' || url === 'null' || url.includes('${imgSrc}')) {
                    return transparentPixel;
                }
                return url.replace(/'/g, "%27");
            },
            /**
             * Converts a base64 string to a Blob.
             * @param {string} base64 - The base64 string.
             * @param {string} mimeType - The mime type (e.g., 'image/png').
             * @returns {Blob}
             */
            base64ToBlob(base64, mimeType = 'image/png') {
                const byteCharacters = atob(base64);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                return new Blob([byteArray], { type: mimeType });
            },

            /**
             * Converts a Blob to a base64 string.
             * @param {Blob} blob - The blob to convert.
             * @returns {Promise<string>}
             */
            blobToBase64(blob) {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const base64String = reader.result.split(',')[1];
                        resolve(base64String);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            },

            /**
             * Converts a Blob to a Data URL.
             * @param {Blob} blob - The blob to convert.
             * @returns {Promise<string>}
             */
            blobToDataURL(blob) {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            },
            /**
             * Generates a UUID v4.
             * @returns {string}
             */
            uuid() {
                try {
                    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
                } catch (e) {
                    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                        return v.toString(16);
                    });
                }
            },
            /**
             * Compiles a keyword into a robust regex.
             * @param {string} keyword - The keyword to compile.
             * @returns {RegExp}
             */
            compileTriggerRegex(keyword) {
                if (!keyword) return /^$/;
                // Escape regex specials but keep our logic
                let escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // Support partial word matching or exact depending on context? 
                // Core uses boundary check to avoid mid-word hits but that can be restrictive.
                // We'll stick to a balanced approach: boundary or start/end.
                return new RegExp(`(?:\\b)${escaped}(?:\\b)`, 'i');
            },

            /**
             * Parses a complex trigger string.
             * @param {string} triggersStr 
             * @returns {Object} { groups, chance, chanceOperator }
             */
            parseLoreTrigger(triggersStr) {
                if (!triggersStr) return { groups: [], chance: 0, chanceOperator: 'OR' };

                let chance = 0;
                let chanceOperator = 'OR';
                let cleanTriggers = triggersStr;

                const chanceRegex = /(?:^|[\s,])(?:(AND)\s+)?(\d+)\s*%/i;
                const match = triggersStr.match(chanceRegex);

                if (match) {
                    if (match[1] && match[1].toUpperCase() === 'AND') chanceOperator = 'AND';
                    chance = parseInt(match[2], 10);
                    cleanTriggers = triggersStr.replace(match[0], ' ');
                }

                // Operators are accepted in any case (AND, and, And, etc.) so that the
                // user-facing DSL is forgiving. Split on the operator with whitespace
                // boundaries so substrings inside keywords are not mistaken for operators.
                const xorRe = /\s+XOR\s+/i;
                const andRe = /\s+AND\s+/i;
                const parts = cleanTriggers.split(',').map(s => s.trim()).filter(Boolean);
                const groups = parts.map(part => {
                    if (xorRe.test(part)) {
                        const keywords = part.split(xorRe).map(k => k.trim().toLowerCase()).filter(Boolean);
                        if (keywords.length === 2) return { type: 'XOR', keywords };
                    }
                    if (andRe.test(part)) {
                        const keywords = part.split(andRe).map(k => k.trim().toLowerCase()).filter(Boolean);
                        if (keywords.length > 0) return { type: 'AND', keywords };
                    }
                    return { type: 'OR', keywords: [part.toLowerCase()] };
                });

                return { groups, chance, chanceOperator };
            },

            /**
             * Scans content against an array of lore entries.
             * @param {string} content - Text to scan.
             * @param {Array} entries - Lorebook entries.
             * @returns {Object|null} - The first triggered entry or null.
             */
            testLoreEntries(content, entries) {
                if (!content || !entries) return null;

                for (const entry of entries) {
                    const { groups, chance, chanceOperator } = this.parseLoreTrigger(entry.triggers);

                    const keywordMatch = groups.some(group => {
                        const patterns = group.keywords.map(kw => this.compileTriggerRegex(kw));
                        switch (group.type) {
                            case 'OR': return patterns.some(regex => regex.test(content));
                            case 'AND': return patterns.every(regex => regex.test(content));
                            case 'XOR':
                                const [f, s] = [patterns[0].test(content), patterns[1].test(content)];
                                return (f && !s) || (!f && s);
                            default: return false;
                        }
                    });

                    const chanceRolled = (Math.random() * 100 < chance);
                    let shouldTrigger = false;

                    if (groups.length === 0) {
                        shouldTrigger = chanceRolled;
                    } else {
                        if (chanceOperator === 'AND') {
                            shouldTrigger = keywordMatch && chanceRolled;
                        } else {
                            shouldTrigger = keywordMatch || chanceRolled;
                        }
                    }

                    if (shouldTrigger) return entry;
                }
                return null;
            },
            /**
             * Escapes HTML characters to prevent XSS.
             * @param {string} str - The string to escape.
             * @returns {string}
             */
            escapeHTML(str) {
                if (typeof str !== 'string') return '';
                const p = document.createElement("p");
                p.textContent = str;
                return p.innerHTML;
            },

            /**
             * Reduces removed chat messages to the earliest lore stage each dynamic entry
             * should rewind to. A single delete can remove several reveals for one entry
             * (a repeat reveal is spliced out and re-pushed by _triggerLoreEntry), so the
             * lowest previous_index wins. Reveals saved before previous_index existed are
             * skipped rather than guessed at.
             * @param {Array<Object>} messages - The messages being removed.
             * @returns {Object} - Map of dynamic_entry_id to the index to restore.
             */
            lowestLoreIndexByEntry(messages) {
                const lowest = {};
                (messages || []).forEach(m => {
                    if (!m || m.type !== 'lore_reveal' || !m.dynamic_entry_id) return;
                    if (typeof m.previous_index !== 'number') return;
                    const seen = lowest[m.dynamic_entry_id];
                    if (seen === undefined || m.previous_index < seen) {
                        lowest[m.dynamic_entry_id] = m.previous_index;
                    }
                });
                return lowest;
            },

            /**
             * Decides whether the message at `index` can absorb the one before it.
             * Both sides must be ordinary chat: lore reveals and system events are not
             * prose anyone wrote, and merging them would erase machinery the story needs.
             * @param {Array<Object>} history - The chat history.
             * @param {number} index - Index of the later message.
             * @returns {boolean} - Whether a combine is offered at this index.
             */
            canCombineAt(history, index) {
                if (!Array.isArray(history)) return false;
                if (!Number.isInteger(index) || index < 1) return false;
                const later = history[index];
                const earlier = history[index - 1];
                if (!later || !earlier) return false;
                if (later.type !== 'chat' || earlier.type !== 'chat') return false;
                if (!later.content || !earlier.content) return false;
                return true;
            },

            /**
             * Groups repeated error messages so a failure that fires twenty times reads as
             * one line with a count rather than twenty identical rows. Most recent first.
             * @param {Array<Object>} entries - Raw {message, ts} entries, oldest first.
             * @returns {Array<Object>} - [{ message, count, firstTs, lastTs }]
             */
            collapseErrors(entries) {
                const seen = {};
                const rows = [];
                (entries || []).forEach(e => {
                    if (!e || !e.message) return;
                    const key = String(e.message);
                    if (seen[key]) {
                        seen[key].count += 1;
                        seen[key].lastTs = e.ts;
                        return;
                    }
                    const row = { message: key, count: 1, firstTs: e.ts, lastTs: e.ts };
                    seen[key] = row;
                    rows.push(row);
                });
                return rows.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
            },

            /**
             * Filters Visual Lore items by category and a free-text query, newest first.
             * The query matches the title and the description, so "crimson" finds a banner
             * described as black even when the title does not say so.
             * @param {Array<Object>} items - The stored items.
             * @param {string} category - A category id, or "all".
             * @param {string} query - Free text; blank matches everything.
             * @returns {Array<Object>} - The matching items, newest first.
             */
            filterVisualLore(items, category, query) {
                const list = Array.isArray(items) ? items.filter(Boolean) : [];
                const cat = (category || 'all').toLowerCase();
                const q = String(query || '').trim().toLowerCase();

                const matched = list.filter(item => {
                    if (cat !== 'all' && (item.category || 'other').toLowerCase() !== cat) return false;
                    if (!q) return true;
                    const haystack = ((item.title || '') + ' ' + (item.description || '')).toLowerCase();
                    return haystack.includes(q);
                });

                return matched.sort((a, b) => (b.created || 0) - (a.created || 0));
            },

            /**
             * Safely extracts and parses JSON from a string, handling markdown code blocks.
             * @param {string} str - The string containing JSON.
             * @returns {Object|null} - The parsed object or null.
             */
            extractAndParseJSON(str) {
                if (!str) return null;

                const repair = (s) => {
                    let r = s.trim();
                    // Naked JSON: If it starts with a key but no root brace
                    if (r.startsWith('"') && !r.startsWith('{') && !r.startsWith('[') && r.includes(':')) {
                        r = '{' + r;
                    }

                    return r
                        .replace(/,\s*([\]}])/g, '$1') // Remove trailing commas
                        .replace(/(["'])\s*\n\s*(["'])/g, '$1\\n$2') // Fix basic unescaped newlines between quotes
                        .replace(/\]\s*,\s*\{/g, '},{') // Fix delimiter hallucination: ], { -> }, {
                        .replace(/\]\s*,\s*\]/g, '}]')   // Fix delimiter hallucination: ], ] -> }, ]
                        .replace(/\]\s*,\s*\}/g, '}}')   // Fix delimiter hallucination: ], } -> }}
                        .trim();
                };

                // 1. Try to extract from Markdown blocks first
                // This is critical for models that output multiple json blocks with chatting in between
                const markdownMatches = [...str.matchAll(/```(?:json)?\s*([\s\S]*?)```/ig)];
                for (const match of markdownMatches) {
                    try {
                        return JSON.parse(repair(match[1]));
                    } catch (e) {
                        // If it fails, continue to rules below
                    }
                }

                // Remove markdown for global regex fallback
                let clean = str.replace(/```json\s*/ig, '').replace(/```/g, '').trim();
                try {
                    return JSON.parse(repair(clean));
                } catch (e) {
                    // Find earliest structural character
                    const firstBrace = str.indexOf('{');
                    const firstBracket = str.indexOf('[');
                    const firstQuote = str.indexOf('"');

                    let start = -1;
                    if (firstBrace !== -1) start = (start === -1) ? firstBrace : Math.min(start, firstBrace);
                    if (firstBracket !== -1) start = (start === -1) ? firstBracket : Math.min(start, firstBracket);
                    if (firstQuote !== -1) start = (start === -1) ? firstQuote : Math.min(start, firstQuote);

                    if (start !== -1) {
                        const startChar = str[start];
                        const isArray = startChar === '[';
                        const isNaked = startChar === '"';

                        const endChar = isArray ? ']' : '}';
                        const end = str.lastIndexOf(endChar);

                        // Scenario 1: We found a closing brace/bracket
                        if (end > start) {
                            try {
                                return JSON.parse(repair(str.substring(start, end + 1)));
                            } catch (e2) {
                                // Fall through to last ditch if current span is invalid
                            }
                        }

                        // Scenario 2: Truncated or Span failed - try to force-close from the start
                        try {
                            let candidate = str.substring(start).trim();
                            // If we forced a start at a quote, wrap it
                            if (str[start] === '"') candidate = '{' + candidate;

                            const forcedIsArray = candidate.startsWith('[');
                            // Simple force-closure: just append the missing character
                            if (forcedIsArray && !candidate.endsWith(']')) candidate += ']';
                            if (!forcedIsArray && !candidate.endsWith('}')) candidate += '}';
                            return JSON.parse(repair(candidate));
                        } catch (e3) { }
                    }
                    return null;
                }
            },

            /**
             * Extracts data from a markdown response using structured headings (e.g. [TITLE] ... [SUMMARY] ...)
             * @param {string} text - The raw text
             * @param {Array<string>} keys - Array of expected keys (e.g. ['TITLE', 'SUMMARY'])
             * @returns {Object} Extracted key-value pairs
             */
            extractStructuredHeadings(text, keys) {
                const result = {};
                if (!text) return result;

                for (const key of keys) {
                    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    // Resilient lookahead: stop when we see the next known key or the end.
                    // We allow optional brackets, bold marks (**), or header marks (###) around the key.
                    const otherKeys = keys.filter(k => k !== key).join('|');
                    const pattern = `(?:\\[|\\*\\*|#|\\n|^|\\s)*${escapedKey}(?:\\]|\\*\\*|\\:|\\s)*\\n([\\s\\S]*?)(?=\\n\\s*[#\\[\\*\\s]*(${otherKeys})|$)`;
                    const regex = new RegExp(pattern, 'i');

                    let value = "";
                    const match = text.match(regex);
                    if (match && match[1]) {
                        value = match[1].trim();
                    } else {
                        // Fallback attempt: if the specific structured search fails, try a simpler "key exists" hunt
                        // as sometimes the stop lookahead is too strictly formatted.
                        const fallbackRegex = new RegExp(`\\[?${escapedKey}\\]?\\s*\\n?([\\s\\S]*?)(?=\\n\\[|\\n#|\\n\\*\\*|$)`, 'i');
                        const fallbackMatch = text.match(fallbackRegex);
                        if (fallbackMatch) value = fallbackMatch[1].trim();
                    }
                    // Expose the value under both the original case and lowercase so callers using
                    // either style work. Some readers use `data['Model Instructions']`, others
                    // use `briefData.tags`.
                    result[key] = value;
                    result[key.toLowerCase()] = value;
                }
                return result;
            },

            /**
             * Extracts an array of items from a list format.
             * Parses lines starting with '-' or '*'.
             * Can split values by delimiters like '|' if keys are provided.
             * @param {string} text - Raw text
             * @param {string} [delimiter=null] - Delimiter for parsing inline properties
             * @param {Array<string>} [keys=null] - Keys associated with split parts
             * @returns {Array<Object|string>}
             */
            extractDelimitedList(text, delimiter = null, keys = null) {
                const items = [];
                if (!text) return items;

                const bulletRe = /^([-*]\s+|\d+\.\s+)/;
                const stripBullet = (s) => s.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim();

                const lines = text.split('\n');
                for (const raw of lines) {
                    const line = raw.trim();
                    if (!line) continue;
                    const stripped = stripBullet(line);
                    if (!stripped) continue;

                    if (delimiter && keys) {
                        // Bullet markers explicitly signal "this is a row" — accept regardless.
                        // Unbulleted lines must contain the delimiter so prose intros get filtered.
                        // Several prompts ask the LLM for unbulleted "Title | Content" rows.
                        const wasBulleted = bulletRe.test(line);
                        // If it's not bulleted and lacks the primary delimiter, it's likely prose
                        if (!wasBulleted && !stripped.includes(delimiter)) continue;

                        let parts = stripped.split(delimiter).map(p => p.trim());

                        // Fallback: If delimiter not found but we expect 2 keys (e.g., Title/Content),
                        // try splitting by the first colon or dash if it exists.
                        if (parts.length === 1 && keys.length === 2) {
                            if (stripped.includes(':')) {
                                const firstColon = stripped.indexOf(':');
                                parts = [
                                    stripped.substring(0, firstColon).trim(),
                                    stripped.substring(firstColon + 1).trim()
                                ];
                            } else if (stripped.includes('-')) {
                                const firstDash = stripped.indexOf('-');
                                parts = [
                                    stripped.substring(0, firstDash).trim(),
                                    stripped.substring(firstDash + 1).trim()
                                ];
                            }
                        }

                        const obj = {};
                        keys.forEach((key, i) => {
                            let part = parts[i] || "";

                            // Attempt to remove label prefixes like "Title: " or "Desc: "
                            const colonMatch = part.match(/^([a-zA-Z0-9\s_-]{1,25}):(.*)$/);
                            if (colonMatch) {
                                const prefix = colonMatch[1].trim().toLowerCase();
                                const safeLabels = ['title', 'content', 'description', 'name', 'pair', 'desc', 'event', 'relationship', 'lore', 'entry', 'summary', 'location', 'memory'];
                                if (prefix.includes(key.toLowerCase()) || safeLabels.some(l => prefix === l || prefix.endsWith(' ' + l))) {
                                    part = colonMatch[2].trim();
                                }
                            }

                            // Strip markdown bold if the LLM bolded the value
                            part = part.replace(/^\*\*|\*\*$/g, '').trim();
                            obj[key] = part;
                        });
                        items.push(obj);
                    } else if (bulletRe.test(line)) {
                        // Bare-list mode: only accept actually-bulleted rows so prose is filtered.
                        items.push(stripped);
                    }
                }

                // Bare-list fallback: if the LLM returned a single comma-separated line
                // (the in-story scenario topics prompt asks for exactly this), accept it.
                if (!delimiter && items.length === 0) {
                    const trimmed = text.trim();
                    if (trimmed.includes(',') && !trimmed.includes('\n')) {
                        return trimmed.split(',').map(s => s.trim()).filter(Boolean);
                    }
                }

                return items;
            },

            /**
             * Converts a hex color to RGBA.
             * @param {string} hex - The hex color string.
             * @param {number} alpha - The alpha value (0-1).
             * @returns {string}
             */
            hexToRgba(hex, alpha) {
                let r = 0, g = 0, b = 0;
                if (hex.length == 4) { r = "0x" + hex[1] + hex[1]; g = "0x" + hex[2] + hex[2]; b = "0x" + hex[3] + hex[3]; }
                else if (hex.length == 7) { r = "0x" + hex[1] + hex[2]; g = "0x" + hex[3] + hex[4]; b = "0x" + hex[5] + hex[6]; }
                return `rgba(${+r},${+g},${+b},${alpha})`;
            },
            /**
             * Darkens a hex color by a percentage.
             * @param {string} hex - The hex color string.
             * @param {number} percent - The percentage to darken (0-100).
             * @returns {string}
             */
            darkenHex(hex, percent) {
                const num = parseInt(hex.replace("#", ""), 16);
                const amt = Math.round(2.55 * percent);
                const R = (num >> 16) - amt;
                const G = (num >> 8 & 0x00FF) - amt;
                const B = (num & 0x0000FF) - amt;
                return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
            },
            /**
             * Returns the default user character, optionally inheriting from the global default persona.
             * @returns {Object}
             */
            /**
             * Turns a path inside the app folder (e.g. "assets/demo/user.png") into a full
             * address. Image code treats anything not starting with http as a key into the
             * local image database, so bundled images must be stored as full addresses.
             * @param {string} relativePath - Path relative to index.html.
             * @returns {string} - Absolute URL, or the path unchanged when there is no page.
             */
            appAssetUrl(relativePath) {
                const base = (typeof document !== 'undefined' && document.baseURI) ? document.baseURI : '';
                if (!base) return relativePath;
                try { return new URL(relativePath, base).href; } catch (e) { return relativePath; }
            },

            getDefaultUserCharacter() {
                const globals = (typeof StateManager !== 'undefined' && StateManager.data && StateManager.data.globalSettings) ? StateManager.data.globalSettings : {};
                let userChar = {
                    id: UTILITY.uuid(),
                    name: "You",
                    description: "A mysterious wandering adventurer drawn to the crossroads town of Hearthstone by rumors of the Shattered Crown — an ancient artifact of immense power, fractured into fragments and scattered across Aethermoor two centuries ago.\n\nYou wear a dark, weathered traveling cloak with a deep hood that casts your features into shadow, revealing only a grim, determined jawline and piercing eyes. Beneath the cloak, you wear rugged, practical leather armor suited for long periods on the road. A faint, almost imperceptible magical mist sometimes seems to cling to your silhouette.\n\nYou carry a weathered journal filled with sketches of Crown fragment locations and pre-Shattering runic translations. This journal was passed down to you by your mentor, a scholar who vanished mysteriously while pursuing the same quest. You are resourceful, adaptable, and driven by a quiet determination to finish your mentor's work and discover the truth behind the Crown's shattering.\n\nYou rarely speak of your past before the road, preferring to keep your companions guessing, but your skills in survival and your deep knowledge of arcane history suggest a complicated lineage.",
                    short_description: "A mysterious wandering adventurer seeking the fragments of the Shattered Crown.",
                    model_instructions: "Write a response for {character} in a creative, immersive, and descriptive style. Use second-person perspective. Describe sensory details — sights, sounds, smells — to bring the scene alive. Maintain an air of competence and quiet mystery.",
                    is_user: true, is_active: true, image_url: UTILITY.appAssetUrl('assets/demo/user.png'), extra_portraits: [], tags: ["adventurer", "protagonist", "mysterious"], is_narrator: false,
                    dynamic_knowledge: []
                };

                if (globals.defaultPersonaId && globals.userPersonas) {
                    const dp = globals.userPersonas.find(p => p.id === globals.defaultPersonaId);
                    if (dp) {
                        userChar = { ...userChar, name: dp.name, description: dp.description, short_description: dp.short_description || '', model_instructions: dp.model_instructions || '', appearance: dp.appearance || '', tags: dp.tags || [] };
                        if (dp.image_url) userChar.image_url = dp.image_url;
                    }
                }
                return userChar;
            },
            /**
             * Parses structured journal lines into plot and reflection objects.
             * @param {string} text
             * @returns {Array<Object>}
             */
            parseJournalExtractions(text) {
                const entries = [];
                if (!text) return entries;
                const lines = text.split('\n');
                for (let line of lines) {
                    line = line.trim();
                    if (line.startsWith('[PLOT]')) {
                        const content = line.substring('[PLOT]'.length).trim();
                        if (content) {
                            entries.push({
                                type: 'plot',
                                content: content
                            });
                        }
                    } else if (line.startsWith('[REFLECTION:')) {
                        const closeBracketIdx = line.indexOf(']');
                        if (closeBracketIdx > 12) {
                            const charName = line.substring('[REFLECTION:'.length, closeBracketIdx).trim();
                            const content = line.substring(closeBracketIdx + 1).trim();
                            if (content) {
                                entries.push({
                                    type: 'reflection',
                                    character_name: charName,
                                    content: content
                                });
                            }
                        }
                    }
                }
                return entries;
            },
            /**
             * Returns default API settings.
             * @returns {Object}
             */
            getDefaultApiSettings() {
                return {
                    apiProvider: 'koboldcpp',
                    geminiApiKey: '',
                    geminiModel: 'gemini-1.5-flash',
                    openRouterKey: '',
                    openRouterModel: 'google/gemini-flash-1.5',
                    koboldcpp_url: 'http://localhost:5001',
                    koboldcpp_template: 'none',
                    koboldcpp_min_p: 0.1,
                    koboldcpp_dry: 0.25,
                    lmstudio_url: 'http://localhost:1234',
                    webllmModel: 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
                    userPersonas: [],
                    savedOpenRouterModels: [],
                    musicMode: 'off',
                    musicBackend: 'gemini',
                    musicOpenRouterModel: 'google/lyria-3-clip-preview',
                    musicVolume: 30,
                    musicInterval: 10,
                    // NanoGPT keys
                    nanoGPTKey: '',
                    nanoGPTModel: 'openai/gpt-4o-mini',
                    savedNanoGPTModels: [],
                    imageGenNanoGPTKey: '',
                    imageGenNanoGPTModel: 'black-forest-labs/flux-1-schnell',
                    savedNanoGPTImageModels: [],
                    ttsBackend: 'gemini',
                    nanoGPTTTSModel: 'tts-1',
                    nanoGPTTTSVoice: 'nova',
                    musicNanoGPTModel: 'google/lyria-3-clip-preview',
                    pendingImage: null
                };
            },
            /**
             * Returns default UI settings.
             * @returns {Object}
             */
            getDefaultUiSettings() {
                return {
                    font: "'Inter', sans-serif", backgroundImageURL: '', bubbleOpacity: 0.35,
                    chatTextColor: '#cdc6b6', characterImageMode: 'none',
                    backgroundBlur: 3, textSize: 16, bubbleImageSize: 100,
                    showPortraitPanel: true, useAlphaMask: false,
                    // ... markdown colors ...
                    md_h1_color: '#818cf8', md_h2_color: '#a5b4fc', md_h3_color: '#c7d2fe',
                    md_bold_color: '#ffffff', md_italic_color: '#9ca3af', md_quote_color: '#9ca3af',
                    md_h1_font: '', md_h2_font: '', md_h3_font: '', md_bold_font: '', md_italic_font: '', md_quote_font: ''
                };
            },
            getDefaultStorySettings() {
                const globals = (typeof StateManager !== 'undefined' && StateManager.data && StateManager.data.globalSettings) ? StateManager.data.globalSettings : {};
                return {
                    creator_notes: "",
                    tags: [],
                    event_master_probability: 0,
                    visual_master_probability: 0,
                    enableAnalysis: true,
                    enableAutoStaticKnowledge: globals.default_enableAutoStaticKnowledge !== undefined ? globals.default_enableAutoStaticKnowledge : true,
                    enableResponseOptions: globals.default_enableResponseOptions !== undefined ? globals.default_enableResponseOptions : false,
                    enableStats: globals.default_enableStats !== undefined ? globals.default_enableStats : false,
                    enableLivingPersona: globals.default_enableLivingPersona !== undefined ? globals.default_enableLivingPersona : false,
                    enableJournal: globals.default_enableJournal !== undefined ? globals.default_enableJournal : true,
                    combineAsNarrator: false,
                    responseLength: globals.default_responseLength || 'normal',
                    useAlphaMask: false,
                    enableAutoBuildLocations: false,
                    enableAutoGenerateLocationImages: false,
                    enableTextMode: globals.default_enableTextMode !== undefined ? globals.default_enableTextMode : true,
                    dmAllowEmoji: false,
                    dmTimestampAwareness: true,
                    dmTypingIndicator: true,
                    dmUnpromptedTexts: true
                };
            },
            /**
             * Returns default system prompts.
             * @returns {Object}
             */
            getHardcodedSystemPrompts() {
                return {
                    system_prompt: 'You are a master storyteller. Follow instructions precisely.',
                    prompt_text_mode: "### TEXT MESSAGE MODE\nYou are {character_name}, texting {user_character} privately on a phone. This is a one-to-one conversation. No other character can see it.\n\nRules for this mode:\n- Write ONLY what would be typed into a phone. Plain text messages.\n- Do NOT write actions, gestures, or physical description. No asterisks, no *does something*.\n- Do NOT write internal thoughts or narration. No italics for inner monologue.\n- Do NOT describe the scene, the setting, or the weather.\n- Let length follow feeling, not a formula. Real texting is inconsistent:\n    - Calm, casual, or busy: one or two sentences. This is the normal case.\n    - Worked up \u2014 angry, hurt, anxious, excited \u2014 can go either way, and both are true to life:\n        - A wall of text: venting, over-explaining, listing grievances, repeating yourself, sending the thing you swore you would not send.\n        - Or the opposite: \"fine.\" \"whatever.\" \"k.\" A clipped reply often carries more anger than a paragraph does.\n    - Choose whichever fits THIS character at THIS moment. Do not default to long just because the mood is heavy, and do not be terse every time either.\n- A long message must come from feeling, never from description. Even at your angriest you are still typing on a phone, not narrating a scene.\n- Stay fully in character. Your personality, mood, and history still apply.\n- You may reference anything you know from the main story, and anything said in this private thread.\n- What is said here is private. Other characters do not know it unless you choose to tell them later.\n{emoji_rule}\n{elapsed_time}",
                    event_master_base_prompt: 'You are a secret Event Master. Read the chat. Generate a brief, secret instruction for AI characters to introduce a logical but unexpected event.',
                    event_master_prompt: '',
                    prompt_persona_gen: "Embellish this character concept into a rich, detailed, and compelling persona description, focusing on detailed appearance, personality, goals, relationships, and backstory.\n\nSTYLE INSTRUCTIONS: Write in an immersive interview style. Use double quotes for any dialogue and plain text for actions. For example: *He leaned back, adjusted his glasses, and sighed.* \"I didn't think you would find me here so soon.\"\n\n### Name\n\"{name}\"\n\n### Concept\n\"{concept}\"",
                    prompt_living_persona_gen: "You are a character evolution analyzer. Review the following roleplay transcript and the character's base persona. If the events logically necessitate a permanent change in their worldview, relationships, goals, or personality, rewrite the persona to incorporate those changes. Maintain the immersive interview style: use double quotes for dialogue and plain text for actions. Review your work to ensure it follows this style strictly before responding.\n\nIMPORTANT: Output ONLY the updated persona text block itself. Do NOT include any introductory comments, conversational preambles, explanations, postambles, formatting structures, or any part of the roleplay transcript itself. Your entire response must be the rewritten persona block, nothing else.\n\n### Base Persona\n{base_persona}\n\n### Recent Transcript\n{transcript}",
                    prompt_world_map_gen: "Based on the following story context, generate a genre-appropriate 8x8 grid of interconnected locations. The central location (4,4) should be a neutral starting point. Attempt to include locations mentioned in the context.\n\n### Story Context\n\n### Characters\n{characters}\n\n### Static Lore\n{static}\n\n### Recent Events\n{recent}\n\nRespond with a valid JSON object: { \"grid\": [ { \"coords\": {\"x\":int, \"y\":int}, \"name\": \"string\", \"description\": \"string (one-line summary)\", \"prompt\": \"string (a rich, detailed paragraph description of the location and its appearance)\", \"imageUrl\": \"\" } ] }. The grid must contain exactly 64 locations.",
                    prompt_location_gen: "Generate a rich, detailed, and evocative paragraph-long prompt for a location named '{name}' which is briefly described as '{description}'.",
                    prompt_adjacent_locations_gen: "Based on the story context and current map data, generate logical and genre-appropriate location details for the specified blank coordinates adjacent to the player's current location. Keep them coherent and interconnected with the existing surrounding locations.\n\n### Story Context\nCharacters:\n{characters}\n\nStatic Lore:\n{static}\n\nRecent Events:\n{recent}\n\n### Map Geography\nCurrent Coordinates: {current_coords}\nExisting Surrounding Locations:\n{surrounding_locations}\n\n### Target Coordinates to Generate:\n{target_coords}\n\nRespond with a valid JSON object matching this structure:\n{ \"locations\": [ { \"coords\": {\"x\":int, \"y\":int}, \"name\": \"string\", \"description\": \"string (one-line summary)\", \"prompt\": \"string (a rich, detailed paragraph description of the location and its appearance)\", \"imageUrl\": \"\" } ] }",
                    prompt_entry_gen: "Generate a detailed and informative encyclopedia-style entry for a lore topic titled '{title}'. If relevant, use the following triggers as context: '{triggers}'.",
                    prompt_location_memory_gen: "You are an archivist. Read the following chat transcript that occurred at a specific location. Summarize the key events, character developments, and important facts into a concise, single paragraph. This will serve as a memory for what happened at that location.\n\n### Transcript\n{transcript}",
                    prompt_timeline_extractor: "Summarize the following core narrative events into a single, punchy chronological bullet point. Do not list mechanics, character stats, or generic dialogue. Focus purely on major PLOT progression (e.g. discoveries, battles, changes in objective). Output ONLY the single bullet point text. Avoid using dashes or asterisks, just write the sentence.\n\n### Transcript\n{transcript}",
                    prompt_relationship_matrix: "Analyze the shifting interpersonal dynamics between characters in the transcript. Output a list describing how one character currently views another, focusing on emotions, trust, and secret alliances.\n\n### Transcript\n{transcript}\n\n### Output Format\nRespond with a delimited list using a pipe character '|' in this exact format:\n[Character A] -> [Character B] | Short emotional description.\nIf there are no meaningful shifts, simply return 'null'.",
                    prompt_story_notes_gen: "Based on the following story context (characters, lore), generate a brief, 1-2 sentence creator's note or 'blurb' for this story to show in a library.\n\n### Context\n{context}",
                    prompt_story_tags_gen: "Based on the following story context (characters, lore), generate 3-5 relevant, one-word, comma-separated tags for this story (e.g., fantasy, sci-fi, mystery, horror, romance).\n\n### Context\n{context}",
                    visual_master_base_prompt: "You are a visual director. Based on the provided chat history, characters, and location, generate a high-quality, vivid, and detailed image generation prompt that captures the current scene. Focus on atmosphere, lighting, and key subjects. Output ONLY the visual description.",
                    prompt_auto_static_knowledge: "You are an automated archivist. Analyze the recent conversation transcript and the EXISTING static knowledge base. Your goal is to identify new information that needs to be recorded or updated.\n\n### Tasks\n1. Analyze the transcript for new events, character updates, items used/found, world-building lore, or relationship changes.\n2. Cross-reference with the existing list of entries to see if any matches exist.\n\n### Existing Knowledge\n{existing_knowledge}\n\n### Transcript\n{transcript}\n\n### Output Format\nRespond with a delimited list using a pipe character '|' in this exact format:\nCategory | Subject | New Detail or Update\nIf there are multiple entries, place each on a new line. If no changes are needed, return literally 'null'.\n\nValid Categories:\n- Event (for major plot events)\n- Character (for character details/updates)\n- Item (for important items)\n- World (for locations and world lore)\n- Relationship (for character interpersonal updates)\n\nExample Output:\nCharacter | Alistair | He has acquired a mysterious silver amulet with a blue gem.\nRelationship | Alistair & Elara | Alistair has started to trust Elara after she saved him from the wolf.",
                    prompt_response_options_gen: "You are a master roleplayer and choose-your-own-adventure guide.\nBased on the current story context, characters, and the last response, generate 4 drastically different and divergent follow-up actions or responses strictly from the first-person perspective of the user character, {user_character}.\nEach option must take the narrative in a completely distinct direction. Ensure no two options are similar in tone, intent, or action.\nEach option should have a short, catchy 'label' (for a button) and a full 'prompt' (the text that will be sent to the AI if selected, written from the user character's perspective).\nLabels should be highly distinct and represent entirely different emotional or strategic paths (e.g., Aggressive Confrontation, Cautious Retreat, Clever Deception, Compassionate Inquiry).\n\n### Context\n{context}\n\n### Last Response\n{last_response}\n\nRespond ONLY with a valid JSON array of objects: [{ \"label\": \"Short Action\", \"prompt\": \"The full detailed response text representing {user_character}'s action or dialogue.\" }]. Generate exactly 4 options.",
                    prompt_combine_messages: "You are a prose editor. The two passages below cover the SAME stretch of story, written from two sides, so the same beats are told twice.\n\nRewrite them as ONE continuous passage that reads as a single moment.\n\n### RULES\n1. Interleave the beats in the order they actually happen. Do not simply place one passage after the other.\n2. Keep every distinct action, reaction, and line of dialogue from both passages.\n3. Where both passages describe the same beat, merge them into a single telling and keep the more vivid wording.\n4. Preserve dialogue as written. Do not reword what a character says.\n5. Invent nothing. No new events, characters, or details.\n6. Match the voice, tense, and sentence rhythm of the source passages. If they run long flowing sentences, do not break the result into short clipped ones.\n7. Output ONLY the combined passage. No preamble, no headings, no commentary.\n\n### PASSAGE ONE \u2014 {first_speaker}\n{first_passage}\n\n### PASSAGE TWO \u2014 {second_speaker}\n{second_passage}",
                    prompt_stats_init: "You are analyzing a roleplay story to determine appropriate character stats for a game-like RPG system.\n\n### Story Context\n{context}\n\n### Characters\n{characters}\n\n### Task\nGenerate 4 to 6 stats appropriate for this story's genre and setting, interpersonal relationships, and emotions. Each stat must have a brief one-sentence description explaining what it measures and how it can change. Each character should have unique values reflecting their strengths, weaknesses, and relationships. Values range 0-100.\n\nReturn valid JSON:\n{\n  \"stats\": [{\"name\": \"Stat1\", \"description\": \"Brief explanation of what this stat measures.\"}, {\"name\": \"Stat2\", \"description\": \"Brief explanation.\"}],\n  \"characters\": {\n    \"CharacterName1\": [val1, val2],\n    \"CharacterName2\": [val1, val2]\n  }\n}",
                    swarm_scratchpad_prompt: "You are {character_name}. You are privately evaluating the current scene based on your internal state and the objective reality of the situation.\n\n## OBJECTIVE SCENE Analysis\n{objective_description}\n\n## YOUR PERSONA\n{character_description}\n\n## RECENT SCENE — LAST 5 EXCHANGES\n{recent_history}\n\n## INSTRUCTIONS\nAnalyze this scene from your specific perspective. Consider your motivations, desires, and the immediate physical situation. Focus on how your personality influences your goals for this interaction. Your reflections remain private and are intended purely for internal character consistency.\n\nRespond with a single paragraph describing your deep, internal emotional chain-of-thought. Focus exclusively on the immediate impact of the scene and your intended behavior. \n\nWrite your internal thoughts now:",
                    swarm_director_prompt: "You are the Scene Architect and Narrative Director. Your objective is to shape the scene's momentum, tension, and subtext based on the internal character states and the recent narrative flow.\n\n### WORLD LORE\n{world_lore}\n\n### CHARACTER REFERENCE\n{character_descriptions}\n\n### CHARACTER REFLECTIONS\n{winner_intents}\n\n### RECENT NARRATIVE EXCERPT\n{recent_history}\n\n## INSTRUCTIONS\nBased on the context above, provide precise staging instructions for {primary_speaker}. Your goal is to guide their next actions and dialogue to maximize narrative impact, build on relationships, and reflect their internal motivations.\n\n## STAGING GUIDELINES\n- Objective Directives: Provide behavioral cues and subtext (e.g., 'Action: Approaching with cautious optimism.', 'Tone: Impatient beneath a mask of politeness.').\n- Perspective Rule: DO NOT address the character as 'You'. Write instructions as objective behavioral tags that describe their intended state or action.\n- Conflict & Pacing: Use the character's internal reflections to drive the scene toward the most compelling narrative path.",
                    prompt_objectivity_description: "You are a helpful assistant focused on following instructions perfectly. You shall analyze the provided roleplay history and create a strictly objective, out of context, third-person overview of the current scene focusing on physical reality.\n\n### REQUIREMENTS\n1. Describe the character's ({character_name}) immediate physical surroundings.\n2. Describe their current physical position and state (standing, sitting, wounded, etc.).\n3. Summarize the immediate observable actions of other characters in the scene.\n4. Avoid describing emotions, internal thoughts, or hidden subtext.\n5. Keep it concise (1-2 paragraphs).\n\n### ROLEPLAY EXCERPT\n{history}\n### END EXCERPT\n\n## INSTRUCTIONS\nNow you will follow instructions by writing a concise description of the objective physical reality for the character at this exact moment, focusing on what is being done to them.\n### REQUIREMENTS\n1. Describe the character's ({character_name}) immediate physical surroundings.\n2. Describe their current physical position and state (standing, sitting, wounded, etc.).\n3. Summarize the immediate observable actions of other characters in the scene.\n4. Avoid describing emotions, internal thoughts, or hidden subtext.\n5. Keep it concise (1-2 paragraphs).",
                    prompt_objectivity_thoughts: "You are {character_name}. Based on the following objective reality of the current scene, process your internal state before you respond.\n\n### OBJECTIVE REALITY\n{objective_description}\n\n### YOUR TASK\nThink about this reality through the lens of:\n1. Your Personal Goals: {personal_goal}\n2. Your Relationship to others in the scene: {relationships}\n3. Your Physical and Emotional Sensations: {sensations}\n\nWrite a brief, immersive internal monologue (first-person) reflecting on your situation and what you intend to do or say next. This monologue will inform your final roleplay response."
                };
            },
            getDefaultSystemPrompts() {
                const hardcoded = this.getHardcodedSystemPrompts();
                const globals = (typeof StateManager !== 'undefined' && StateManager.data && StateManager.data.globalSettings) ? StateManager.data.globalSettings : {};

                const result = { ...hardcoded };

                // Historically system_prompt was stored as default_system_prompt
                if (globals.default_system_prompt) {
                    result.system_prompt = globals.default_system_prompt;
                }

                // Override with globals
                for (const key in hardcoded) {
                    if (globals[key] !== undefined && globals[key] !== null && globals[key] !== '') {
                        result[key] = globals[key];
                    }
                }

                return result;
            },
            /**
             * Creates a default 8x8 map grid.
             * @returns {Array<Object>}
             */
            createDefaultMapGrid() {
                const grid = [];
                for (let y = 0; y < 8; y++) {
                    for (let x = 0; x < 8; x++) {
                        grid.push({
                            coords: { x, y },
                            name: "",
                            description: "",
                            prompt: "",
                            imageUrl: "",
                            local_static_entries: []
                        });
                    }
                }
                return grid;
            },
            /**
             * Finds a path between two coordinates on the grid using A*.
             * @param {Array<Object>} grid - The map grid.
             * @param {Object} startCoords - The starting coordinates.
             * @param {Object} endCoords - The ending coordinates.
             * @returns {Array<Object>} - The path coordinates.
             */
            findPath(grid, startCoords, endCoords) {
                const toKey = ({ x, y }) => `${x},${y}`;
                const nodes = grid.map(loc => ({
                    ...loc,
                    g: Infinity,
                    h: Infinity,
                    f: Infinity,
                    parent: null,
                }));

                const startNode = nodes.find(n => n.coords.x === startCoords.x && n.coords.y === startCoords.y);
                const endNode = nodes.find(n => n.coords.x === endCoords.x && n.coords.y === endCoords.y);
                if (!startNode || !endNode) return [];

                const heuristic = (a, b) => Math.abs(a.coords.x - b.coords.x) + Math.abs(a.coords.y - b.coords.y);

                let openSet = [startNode];
                let closedSet = new Set();

                startNode.g = 0;
                startNode.h = heuristic(startNode, endNode);
                startNode.f = startNode.h;

                while (openSet.length > 0) {
                    openSet.sort((a, b) => a.f - b.f);
                    let currentNode = openSet.shift();

                    if (currentNode === endNode) {
                        let path = [];
                        let temp = currentNode;
                        while (temp) {
                            path.push(temp.coords);
                            temp = temp.parent;
                        }
                        return path.reverse();
                    }

                    closedSet.add(toKey(currentNode.coords));

                    const neighbors = nodes.filter(n => {
                        const dx = Math.abs(n.coords.x - currentNode.coords.x);
                        const dy = Math.abs(n.coords.y - currentNode.coords.y);
                        return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
                    });

                    for (let neighbor of neighbors) {
                        if (closedSet.has(toKey(neighbor.coords))) continue;
                        let tentativeG = currentNode.g + 1;
                        if (tentativeG < neighbor.g) {
                            neighbor.parent = currentNode;
                            neighbor.g = tentativeG;
                            neighbor.h = heuristic(neighbor, endNode);
                            neighbor.f = neighbor.g + neighbor.h;
                            if (!openSet.includes(neighbor)) openSet.push(neighbor);
                        }
                    }
                }
                return [];
            },
            /**
             * Selects an item from a list based on weights.
             * @param {Array} characters - The items to choose from.
             * @param {Array<number>} weights - The weights for each item.
             * @returns {*} - The selected item.
             */
            weightedChoice(characters, weights) {
                if (characters.length !== weights.length || characters.length === 0) return null;
                const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
                if (totalWeight <= 0) return characters[Math.floor(Math.random() * characters.length)];
                let random = Math.random() * totalWeight;
                for (let i = 0; i < characters.length; i++) {
                    random -= weights[i];
                    if (random <= 0) return characters[i];
                }
                return characters[characters.length - 1];
            },
            /**
             * Checks if there is enough localStorage quota.
             * @param {number} estimatedSize - The estimated size of data to save.
             * @returns {boolean} - True if quota is sufficient.
             */
            checkLocalStorageQuota(estimatedSize) {
                try {
                    const testKey = 'quota-check';
                    const existingDataSize = JSON.stringify(localStorage).length;
                    const availableSpace = (5 * 1024 * 1024) - existingDataSize;
                    if (estimatedSize > availableSpace) return false;
                    localStorage.setItem(testKey, '1');
                    localStorage.removeItem(testKey);
                    return true;
                } catch (e) { return false; }
            },

            /**
             * Parses a search query into a structured object.
             * Supports: Regex (/pattern/v), negation (-term), field-specific (tag:term), and phrases ("term term").
             * @param {string} query - The raw search input.
             * @returns {Object} - Parsed query object.
             */
            parseSearchQuery(query) {
                const trimmed = (query || "").trim();
                if (!trimmed) return { isEmpty: true };

                // 1. Check for Regex
                const regexMatch = trimmed.match(/^\/(.*)\/([a-z]*)$/);
                if (regexMatch) {
                    try {
                        return { isRegex: true, regex: new RegExp(regexMatch[1], regexMatch[2] || 'i') };
                    } catch (e) {
                        // Fallback to text search if regex is invalid
                    }
                }

                // 2. Tokenize Text Search
                const tokens = [];
                // Regex to match: "phrase" | field:value | -term | term
                const tokenRegex = /(-?"[^"]+")|(-?\w+:[^\s]+)|(-?[^\s]+)/g;
                let match;
                while ((match = tokenRegex.exec(trimmed)) !== null) {
                    let token = match[0];
                    let isNegative = token.startsWith('-');
                    if (isNegative) token = token.substring(1);

                    let isPhrase = token.startsWith('"') && token.endsWith('"');
                    if (isPhrase) token = token.substring(1, token.length - 1);

                    let field = null;
                    if (!isPhrase && token.includes(':')) {
                        const parts = token.split(':');
                        field = parts[0].toLowerCase();
                        token = parts.slice(1).join(':'); // Handle multiple colons
                    }

                    tokens.push({
                        text: token.toLowerCase(),
                        isNegative,
                        isPhrase,
                        field
                    });
                }

                return { isRegex: false, tokens };
            },

            /**
             * Matches a story object against a parsed search query.
             * @param {Object} story - The story object.
             * @param {Object} parsedQuery - The object returned by parseSearchQuery.
             * @returns {boolean} - True if it matches.
             */
            matchStory(story, parsedQuery) {
                if (parsedQuery.isEmpty) return true;
                if (!story) return false;

                if (parsedQuery.isRegex) {
                    // Reset lastIndex so a global/sticky-flagged regex doesn't carry state
                    // across multiple matchStory() calls and produce false negatives.
                    parsedQuery.regex.lastIndex = 0;
                    return parsedQuery.regex.test(story.search_index || story.name || "");
                }

                // All tokens must pass (AND logic for positive tokens, NOT logic for negative)
                for (const token of parsedQuery.tokens) {
                    let targetText = "";

                    if (token.field) {
                        // Field specific search
                        switch (token.field) {
                            case 'tag':
                            case 'tags':
                                targetText = (story.tags || []).join(' ');
                                (story.characters || []).forEach(c => {
                                    if (c.tags) targetText += " " + c.tags.join(' ');
                                });
                                break;
                            case 'name':
                            case 'title':
                                targetText = story.name || "";
                                break;
                            case 'notes':
                            case 'desc':
                                targetText = story.creator_notes || "";
                                break;
                            case 'char':
                            case 'character':
                                targetText = (story.characters || []).map(c => c.name).join(' ');
                                break;
                            case 'is':
                                if (token.text === 'active') {
                                    const library = StateManager.getLibrary();
                                    const isActive = story.id === library.active_story_id;
                                    return token.isNegative ? !isActive : isActive;
                                }
                                break;
                            case 'chat':
                                targetText = story.chat_index || "";
                                break;
                            default:
                                targetText = story.search_index || "";
                        }
                    } else {
                        targetText = story.search_index || "";
                    }

                    const isMatch = targetText.toLowerCase().includes(token.text);

                    if (token.isNegative) {
                        if (isMatch) return false;
                    } else {
                        if (!isMatch) return false;
                    }
                }
                return true;
            },
            /**
             * Estimating token count for a given text.
             * Fast, low-overhead regex word-to-token approximation (words * 1.33),
             * with fallback based on characters (chars / 4) to ensure non-empty strings have tokens.
             * @param {string} text - The text to estimate.
             * @returns {number} Estimated token count.
             */
            estimateTokens(text) {
                if (!text || typeof text !== 'string') return 0;
                const trimmed = text.trim();
                if (!trimmed) return 0;
                const words = trimmed.split(/\s+/).filter(Boolean).length;
                return Math.max(Math.ceil(words * 1.33), Math.ceil(trimmed.length / 4));
            },
            /**
             * Derives a clean short description from a longer text.
             * Finds the first sentence-ending boundary (period, exclamation, question mark) within
             * maxLen characters and returns everything up to and including it. Falls back to a
             * hard character truncation with an ellipsis if no sentence boundary is found.
             * This prevents naive `.split('.')[0]` from returning the entire text when there are
             * no period-terminated sentences (common in character cards that use line-breaks).
             * @param {string} text - The source text.
             * @param {number} [maxLen=160] - Maximum character length before forced truncation.
             * @returns {string}
             */
            truncateShortDescription(text, maxLen = 160) {
                if (!text || typeof text !== 'string') return '';
                const trimmed = text.trim();
                if (!trimmed) return '';
                // Try to find the first sentence boundary within maxLen characters
                const searchWindow = trimmed.slice(0, maxLen + 50);
                const match = searchWindow.match(/[^.!?]*[.!?]/);
                if (match && match[0].trim().length <= maxLen) {
                    return match[0].trim();
                }
                // No short sentence found — hard-truncate at the last word boundary before maxLen
                if (trimmed.length <= maxLen) return trimmed;
                const truncated = trimmed.slice(0, maxLen);
                const lastSpace = truncated.lastIndexOf(' ');
                return (lastSpace > maxLen * 0.7 ? truncated.slice(0, lastSpace) : truncated) + '...';
            },
            /**
             * Sanitizes an LLM-generated evolved persona, removing conversational preambles/postambles,
             * and rejecting the output if it is too long (>2000 chars) or contains repeated dialogue transcripts.
             * @param {string} text - The raw response from the LLM.
             * @param {string[]} [charNames=[]] - List of character names to check for transcript repetition.
             * @returns {string|null} - The sanitized persona description, or null if rejected.
             */
            sanitizeEvolvedPersona(text, charNames = []) {
                if (!text || typeof text !== 'string') return null;
                let cleaned = text.trim();
                if (!cleaned) return null;

                // Split into lines
                let lines = cleaned.split(/\r?\n/);
                while (lines.length > 0 && lines[0].trim() === '') lines.shift();
                while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

                if (lines.length === 0) return null;

                // Preamble filtering: strip common intro lines
                const introPatterns = [
                    /here is/i, /based on/i, /updated persona/i, /sure/i, /revised persona/i,
                    /ok/i, /below is/i, /evolution report/i, /analyzing/i, /here's/i,
                    /according to/i, /the persona/i, /evolved persona/i, /changes/i, /analysis/i
                ];

                const firstLine = lines[0].trim();
                const isPreamble = firstLine.endsWith(':') ||
                    introPatterns.some(pat => pat.test(firstLine)) ||
                    (firstLine.length < 120 && (firstLine.includes('persona') || firstLine.includes('character') || firstLine.includes('evolution') || firstLine.includes('changes')));

                if (isPreamble) {
                    lines.shift();
                    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
                }

                // Postamble filtering: strip common outro lines
                if (lines.length > 0) {
                    const lastLine = lines[lines.length - 1].trim();
                    const outroPatterns = [
                        /let me know/i, /hope this/i, /is there anything/i, /does this/i,
                        /personality/i, /changes/i, /evolved/i
                    ];
                    const isPostamble = outroPatterns.some(pat => pat.test(lastLine)) ||
                        (lastLine.length < 120 && (lastLine.includes('persona') || lastLine.includes('change') || lastLine.includes('hope') || lastLine.includes('feedback')));
                    if (isPostamble) {
                        lines.pop();
                        while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
                    }
                }

                cleaned = lines.join('\n').trim();

                // Discard if empty or too short
                if (cleaned.length < 10) return null;

                // Discard if indicating no changes
                const lower = cleaned.toLowerCase();
                if (lower.includes("no major changes") ||
                    lower.includes("original persona unchanged") ||
                    lower.includes("no changes") ||
                    cleaned === "null") {
                    return null;
                }

                // Length safeguard
                if (cleaned.length > 2000) {
                    return null;
                }

                // Transcript repetition check:
                // Count lines starting with speaker names followed by a colon.
                const namesToCheck = ['user', 'narrator', 'unknown', ...charNames.map(n => n.toLowerCase())];
                let dialogueLineCount = 0;
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    const match = trimmedLine.match(/^([^:]+):/);
                    if (match) {
                        const speaker = match[1].trim().toLowerCase();
                        if (namesToCheck.includes(speaker)) {
                            dialogueLineCount++;
                        }
                    }
                }
                if (dialogueLineCount >= 2) {
                    return null;
                }

                return cleaned;
            },

            /**
             * Resiliently parses a SillyTavern / Chub.ai JSON lorebook string
             * and maps the entries to separate static and dynamic knowledge collections.
             * @param {string} jsonStr - The JSON string to parse.
             * @returns {Object} { static_entries, dynamic_entries }
             */
            parseLorebook(jsonStr) {
                const result = { static_entries: [], dynamic_entries: [] };
                if (!jsonStr || typeof jsonStr !== 'string') return result;

                let data;
                try {
                    data = JSON.parse(jsonStr);
                } catch (e) {
                    console.error("parseLorebook: Failed to parse JSON", e);
                    return result;
                }

                if (!data) return result;

                let rawEntries = [];
                if (Array.isArray(data)) {
                    rawEntries = data;
                } else if (typeof data === 'object') {
                    if (data.character_book && typeof data.character_book === 'object') {
                        const cb = data.character_book;
                        if (Array.isArray(cb.entries)) {
                            rawEntries = cb.entries;
                        } else if (cb.entries && typeof cb.entries === 'object') {
                            rawEntries = Object.values(cb.entries);
                        }
                    } else if (Array.isArray(data.entries)) {
                        rawEntries = data.entries;
                    } else if (data.entries && typeof data.entries === 'object') {
                        rawEntries = Object.values(data.entries);
                    } else if (data.content !== undefined && (data.key !== undefined || data.keys !== undefined || data.comment !== undefined)) {
                        rawEntries = [data];
                    }
                }

                // Filter out non-object entries
                rawEntries = rawEntries.filter(entry => entry && typeof entry === 'object');

                // Sort rawEntries by order ascending to preserve insertion priority
                const entriesWithOrder = rawEntries.map(entry => {
                    let orderNum = parseInt(entry.order, 10);
                    if (isNaN(orderNum)) orderNum = 100;
                    return { entry, order: orderNum };
                });
                entriesWithOrder.sort((a, b) => a.order - b.order);

                entriesWithOrder.forEach(({ entry }) => {
                    const isConstant = (entry.constant === true);
                    const title = entry.comment || entry.displayName || entry.title ||
                        (Array.isArray(entry.key) && entry.key[0]) ||
                        (Array.isArray(entry.keys) && entry.keys[0]) ||
                        (typeof entry.key === 'string' && entry.key.split(',')[0]?.trim()) ||
                        (typeof entry.keys === 'string' && entry.keys.split(',')[0]?.trim()) ||
                        "Imported Entry";

                    const content = entry.content || "";

                    if (isConstant) {
                        result.static_entries.push({
                            id: this.uuid(),
                            title: title,
                            content: content,
                            is_immutable: false
                        });
                    } else {
                        let keysArr = [];
                        if (Array.isArray(entry.key)) {
                            keysArr = entry.key;
                        } else if (typeof entry.key === 'string') {
                            keysArr = entry.key.split(',');
                        } else if (Array.isArray(entry.keys)) {
                            keysArr = entry.keys;
                        } else if (typeof entry.keys === 'string') {
                            keysArr = entry.keys.split(',');
                        }

                        keysArr = keysArr.map(k => String(k).trim()).filter(Boolean);
                        let triggersStr = keysArr.join(', ');

                        const prob = entry.probability !== undefined ? entry.probability : entry.chance;
                        if (prob !== undefined) {
                            const probNum = parseFloat(prob);
                            if (!isNaN(probNum) && probNum >= 0 && probNum < 100) {
                                if (triggersStr) {
                                    triggersStr += `, AND ${probNum}%`;
                                } else {
                                    triggersStr = `${probNum}%`;
                                }
                            }
                        }

                        result.dynamic_entries.push({
                            id: this.uuid(),
                            title: title,
                            triggers: triggersStr,
                            content_fields: [content],
                            current_index: 0,
                            triggered_at_turn: null
                        });
                    }
                });

                return result;
            },

            /**
             * Converts dynamic and static entries back into a SillyTavern-compliant
             * JSON string envelope.
             * @param {Array} staticEntries - The static entries array.
             * @param {Array} dynamicEntries - The dynamic entries array.
             * @returns {string} The stringified SillyTavern World Info JSON.
             */
            exportLorebook(staticEntries, dynamicEntries) {
                const entriesObj = {};
                let index = 0;

                (staticEntries || []).forEach(e => {
                    entriesObj[String(index)] = {
                        uid: index,
                        key: [],
                        keysecondary: [],
                        comment: e.title || "Static Entry",
                        content: e.content || "",
                        constant: true,
                        selective: false,
                        selectiveLogic: 0,
                        add_to_back: true,
                        order: 100,
                        probability: 100,
                        disable: false,
                        excludeRecursion: false,
                        preventRecursion: false,
                        delayUntilRecursion: false,
                        scanDepth: null,
                        caseSensitive: null,
                        matchWholeWords: null,
                        useRegex: null,
                        extensions: {}
                    };
                    index++;
                });

                (dynamicEntries || []).forEach(e => {
                    const { groups, chance } = this.parseLoreTrigger(e.triggers);
                    const keyList = [];
                    groups.forEach(g => {
                        g.keywords.forEach(kw => {
                            keyList.push(kw);
                        });
                    });

                    entriesObj[String(index)] = {
                        uid: index,
                        key: keyList,
                        keysecondary: [],
                        comment: e.title || "Dynamic Entry",
                        content: (e.content_fields || []).join('\n'),
                        constant: false,
                        selective: false,
                        selectiveLogic: 0,
                        add_to_back: true,
                        order: 100,
                        probability: chance !== 0 ? chance : 100,
                        disable: false,
                        excludeRecursion: false,
                        preventRecursion: false,
                        delayUntilRecursion: false,
                        scanDepth: null,
                        caseSensitive: null,
                        matchWholeWords: null,
                        useRegex: null,
                        extensions: {}
                    };
                    index++;
                });

                return JSON.stringify({ entries: entriesObj }, null, 2);
            },

            /**
             * Splits HTML content into an array of tokens (tags, entities, or individual characters).
             * This allows a typewriter effect to render styling tags instantly while typing normal text.
             * @param {string} html - The HTML string to tokenize.
             * @returns {Array} The tokenized components.
             */
            tokenizeHtml(html) {
                if (!html) return [];
                const tokens = [];
                let i = 0;
                while (i < html.length) {
                    if (html[i] === '<') {
                        let end = html.indexOf('>', i);
                        if (end === -1) {
                            tokens.push({ type: 'text', value: html[i] });
                            i++;
                        } else {
                            tokens.push({ type: 'tag', value: html.slice(i, end + 1) });
                            i = end + 1;
                        }
                    } else if (html[i] === '&') {
                        let end = html.indexOf(';', i);
                        if (end === -1 || (end - i) > 10) {
                            tokens.push({ type: 'text', value: html[i] });
                            i++;
                        } else {
                            tokens.push({ type: 'entity', value: html.slice(i, end + 1) });
                            i = end + 1;
                        }
                    } else {
                        tokens.push({ type: 'text', value: html[i] });
                        i++;
                    }
                }
                return tokens;
            },

            /**
             * Parses GM Rule evaluation XML block from LLM output.
             * @param {string} xmlText - The raw XML text from LLM.
             * @returns {Array} - List of parsed rule evaluation objects.
             */
            parseGMEvaluationsXML(xmlText) {
                const evaluations = [];
                if (!xmlText || typeof xmlText !== 'string') return evaluations;
                let cleanXml = xmlText.replace(/```xml/g, '').replace(/```/g, '').trim();

                const evalRegex = /<evaluation>([\s\S]*?)<\/evaluation>/g;
                let match;
                while ((match = evalRegex.exec(cleanXml)) !== null) {
                    const content = match[1];

                    const ruleId = (content.match(/<rule_id>([\s\S]*?)<\/rule_id>/) || [])[1]?.trim() || '';
                    const ruleName = (content.match(/<rule_name>([\s\S]*?)<\/rule_name>/) || [])[1]?.trim() || '';
                    const status = (content.match(/<status>([\s\S]*?)<\/status>/) || [])[1]?.trim() || 'passed';
                    const description = (content.match(/<description>([\s\S]*?)<\/description>/) || [])[1]?.trim() || '';
                    const consequence = (content.match(/<consequence>([\s\S]*?)<\/consequence>/) || [])[1]?.trim() || '';

                    const proposals = {
                        resources: [],
                        character_stats: [],
                        relationships: [],
                        narration: null
                    };

                    const proposalsMatch = content.match(/<proposals>([\s\S]*?)<\/proposals>/);
                    if (proposalsMatch) {
                        const proposalsContent = proposalsMatch[1];

                        const resRegex = /<resource\s+name="([^"]+)"\s+delta="([^"]+)"\s*\/?>/g;
                        let resMatch;
                        while ((resMatch = resRegex.exec(proposalsContent)) !== null) {
                            proposals.resources.push({
                                name: resMatch[1],
                                delta: parseFloat(resMatch[2]) || 0
                            });
                        }

                        const statRegex = /<character_stat\s+character_name="([^"]+)"\s+stat="([^"]+)"\s+value="([^"]+)"\s*\/?>/g;
                        let statMatch;
                        while ((statMatch = statRegex.exec(proposalsContent)) !== null) {
                            proposals.character_stats.push({
                                character_name: statMatch[1],
                                stat: statMatch[2],
                                value: statMatch[3]
                            });
                        }

                        const relRegex = /<relationship\s+character_a="([^"]+)"\s+character_b="([^"]+)"\s+delta="([^"]+)"\s*\/?>/g;
                        let relMatch;
                        while ((relMatch = relRegex.exec(proposalsContent)) !== null) {
                            proposals.relationships.push({
                                character_a: relMatch[1],
                                character_b: relMatch[2],
                                delta: parseFloat(relMatch[3]) || 0
                            });
                        }

                        const narrMatch = proposalsContent.match(/<narration>([\s\S]*?)<\/narration>/);
                        if (narrMatch) {
                            proposals.narration = narrMatch[1].trim();
                        }
                    }

                    evaluations.push({
                        rule_id: ruleId,
                        rule_name: ruleName,
                        status: status.toLowerCase(),
                        description: description,
                        consequence: consequence,
                        proposals: proposals
                    });
                }
                return evaluations;
            },

            parseStateUpdateString(str) {
                if (typeof str !== 'string') return null;
                const trimmed = str.trim();

                // 1. Resource Add/Sub: e.g., "+Rusted Key", "+10 Gold", "-1 Iron Sword", "-Gold"
                const resourceMatch = trimmed.match(/^([+-])\s*(\d*)\s*(.+)$/);
                if (resourceMatch) {
                    const sign = resourceMatch[1];
                    const amountStr = resourceMatch[2].trim();
                    const name = resourceMatch[3].trim();
                    const amount = amountStr ? parseInt(amountStr) : 1;
                    const change = sign === '-' ? -amount : amount;
                    return {
                        type: 'resource',
                        name,
                        change
                    };
                }

                // 2. Quest Action: e.g., "Quest Complete: Escape the Dungeon", "Quest Update: Escape the Dungeon (Objective: Find exit)"
                const questMatch = trimmed.match(/^quest\s+(complete|active|failed|fail|start|update):\s*(.+)$/i);
                if (questMatch) {
                    const action = questMatch[1].toLowerCase();
                    const content = questMatch[2].trim();

                    let title = content;
                    let objective = "";
                    let characterName = "";

                    // Extract options inside parentheses like (assigned: Marcus) or (objective: Find exit)
                    const optionRegex = /\(([^)]+):([^)]+)\)/g;
                    let match;
                    const options = {};
                    while ((match = optionRegex.exec(content)) !== null) {
                        options[match[1].trim().toLowerCase()] = match[2].trim();
                    }

                    // Also support simple objective (no colon) like (Find exit)
                    const simpleParenMatch = content.match(/\(([^:]+?)\)/);
                    if (simpleParenMatch && !simpleParenMatch[1].includes(':')) {
                        objective = simpleParenMatch[1].trim();
                    }

                    title = content.replace(/\s*\([^)]+\)/g, '').trim();

                    if (options.assigned) characterName = options.assigned;
                    if (options.character) characterName = options.character;
                    if (options.objective) objective = options.objective;

                    let status = 'active';
                    if (action === 'complete') status = 'completed';
                    else if (action === 'failed' || action === 'fail') status = 'failed';

                    const resObj = {
                        type: 'quest',
                        title,
                        status,
                        objective,
                        isUpdate: action === 'update'
                    };
                    if (characterName) resObj.characterName = characterName;
                    return resObj;
                }

                // 3. Relationship: e.g., "Relationship: Alice +5", "Relationship: Alice Affection +5"
                const relMatch = trimmed.match(/^(?:relationship|relation):\s*(.+)$/i);
                if (relMatch) {
                    const inner = relMatch[1].trim();
                    // Match character name, optional track name, and the value change
                    const innerMatch = inner.match(/^(.+?)(?:\s+(affection|attraction|standing|romance))?\s*([+-]?\d+)\s*%?$/i);
                    if (innerMatch) {
                        const charName = innerMatch[1].trim();
                        const track = innerMatch[2] ? innerMatch[2].trim() : 'Affection';
                        const changeStr = innerMatch[3].trim();

                        // Check if it's relative (+5 / -10) or absolute (75)
                        const isRelative = changeStr.startsWith('+') || changeStr.startsWith('-');
                        const changeVal = parseInt(changeStr);

                        return {
                            type: 'relationship',
                            charName,
                            track,
                            changeVal,
                            isRelative
                        };
                    }
                }

                return null;
            },

            parseAndStripStateIndicators(text) {
                if (typeof text !== 'string') return { cleanedText: text, changes: [] };

                const regex = /\[STATE:\s*(.*?)\s*\]/gi;
                const changes = [];
                let cleanedText = text;

                // Match all state indicators
                const matches = [...text.matchAll(regex)];
                if (matches.length === 0) return { cleanedText, changes };

                // Strip them from the text
                cleanedText = text.replace(regex, '').trim();

                matches.forEach(match => {
                    const updateStr = match[1].trim();
                    const parsed = this.parseStateUpdateString(updateStr);
                    if (parsed) {
                        changes.push(parsed);
                    }
                });

                return { cleanedText, changes };
            },

            parseInventoryLine(line) {
                if (typeof line !== 'string') return null;
                const trimmed = line.trim();
                if (!trimmed || trimmed.match(/^(none|no change|n\/a|no updates)/i)) return null;

                const stripped = trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim();
                if (!stripped) return null;

                if (stripped.includes('|')) {
                    const parts = stripped.split('|').map(p => p.trim());
                    if (parts.length >= 2) {
                        return {
                            name: parts[0],
                            delta: parseInt(parts[1], 10) || 0
                        };
                    }
                }

                const matchLeading = stripped.match(/^([+-])\s*(\d*)\s*(.+)$/);
                if (matchLeading) {
                    const sign = matchLeading[1];
                    const qtyStr = matchLeading[2];
                    const name = matchLeading[3].trim();
                    const qty = qtyStr ? parseInt(qtyStr, 10) : 1;
                    return {
                        name,
                        delta: sign === '-' ? -qty : qty
                    };
                }

                const matchTrailing = stripped.match(/^(.+?)\s*([+-]\d+)$/);
                if (matchTrailing) {
                    return {
                        name: matchTrailing[1].trim(),
                        delta: parseInt(matchTrailing[2], 10) || 0
                    };
                }

                return null;
            },

            parseQuestLine(line) {
                if (typeof line !== 'string') return null;
                const trimmed = line.trim();
                if (!trimmed || trimmed.match(/^(none|no change|n\/a|no updates)/i)) return null;

                const stripped = trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim();
                if (!stripped) return null;

                let action = 'update';
                let title = '';
                let objective = '';
                let characterName = '';

                if (stripped.includes('|')) {
                    const parts = stripped.split('|').map(p => p.trim());
                    if (parts.length >= 4) {
                        const rawAction = parts[0].toLowerCase();
                        if (rawAction.includes('start') || rawAction.includes('active')) action = 'start';
                        else if (rawAction.includes('complete')) action = 'complete';
                        else if (rawAction.includes('fail')) action = 'fail';

                        characterName = parts[1];
                        title = parts[2];
                        objective = parts[3] || '';
                    } else if (parts.length === 3) {
                        const rawAction = parts[0].toLowerCase();
                        if (rawAction.includes('start') || rawAction.includes('active')) action = 'start';
                        else if (rawAction.includes('complete')) action = 'complete';
                        else if (rawAction.includes('fail')) action = 'fail';

                        // Disambiguate based on action type
                        if (action === 'complete' || action === 'fail') {
                            characterName = parts[1];
                            title = parts[2];
                        } else {
                            title = parts[1];
                            objective = parts[2];
                        }
                    } else if (parts.length === 2) {
                        const rawAction = parts[0].toLowerCase();
                        if (rawAction.includes('start') || rawAction.includes('active')) action = 'start';
                        else if (rawAction.includes('complete')) action = 'complete';
                        else if (rawAction.includes('fail')) action = 'fail';

                        title = parts[1];
                    }
                } else {
                    const matchQuest = stripped.match(/^(start|update|complete|fail|failed|active)\s*:\s*(.+)$/i);
                    if (matchQuest) {
                        const rawAction = matchQuest[1].toLowerCase();
                        if (rawAction.includes('start') || rawAction.includes('active')) action = 'start';
                        else if (rawAction.includes('complete')) action = 'complete';
                        else if (rawAction.includes('fail')) action = 'fail';

                        const rest = matchQuest[2].trim();
                        // Parse options like (assigned: Marcus) or (objective: Find cell key)
                        const optionRegex = /\(([^)]+):([^)]+)\)/g;
                        let match;
                        const options = {};
                        while ((match = optionRegex.exec(rest)) !== null) {
                            options[match[1].trim().toLowerCase()] = match[2].trim();
                        }

                        const simpleParenMatch = rest.match(/\(([^:]+?)\)/);
                        if (simpleParenMatch && !simpleParenMatch[1].includes(':')) {
                            objective = simpleParenMatch[1].trim();
                        }

                        title = rest.replace(/\s*\([^)]+\)/g, '').trim();

                        if (options.assigned) characterName = options.assigned;
                        if (options.character) characterName = options.character;
                        if (options.objective) objective = options.objective;
                    }
                }

                if (title) {
                    const result = { action, title, objective };
                    if (characterName) result.characterName = characterName;
                    return result;
                }
                return null;
            },

            parseRelationshipLine(line) {
                if (typeof line !== 'string') return null;
                const trimmed = line.trim();
                if (!trimmed || trimmed.match(/^(none|no change|n\/a|no updates)/i)) return null;

                const stripped = trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim();
                if (!stripped) return null;

                if (stripped.includes('|')) {
                    const parts = stripped.split('|').map(p => p.trim());
                    if (parts.length >= 3) {
                        return {
                            charName: parts[0],
                            track: parts[1] || 'Affection',
                            changeVal: parseInt(parts[2], 10) || 0
                        };
                    }
                    if (parts.length === 2) {
                        return {
                            charName: parts[0],
                            track: 'Affection',
                            changeVal: parseInt(parts[1], 10) || 0
                        };
                    }
                }

                const cleanLine = stripped.replace(':', ' ').trim();
                const matchRel = cleanLine.match(/^([^+-]+?)(?:\s+(affection|attraction|standing|romance))?\s*([+-]\d+)\s*%?$/i);
                if (matchRel) {
                    return {
                        charName: matchRel[1].trim(),
                        track: matchRel[2] ? matchRel[2].trim() : 'Affection',
                        changeVal: parseInt(matchRel[3], 10) || 0
                    };
                }

                return null;
            },

            parseStatLine(line) {
                if (typeof line !== 'string') return null;
                const trimmed = line.trim();
                if (!trimmed || trimmed.match(/^(none|no change|n\/a|no updates)/i)) return null;

                const stripped = trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim();
                if (!stripped) return null;

                if (stripped.includes('|')) {
                    const parts = stripped.split('|').map(p => p.trim());
                    if (parts.length >= 3) {
                        return {
                            charName: parts[0],
                            name: parts[1],
                            delta: parseInt(parts[2], 10) || 0
                        };
                    }
                    if (parts.length === 2) {
                        return {
                            charName: '',
                            name: parts[0],
                            delta: parseInt(parts[1], 10) || 0
                        };
                    }
                }

                const match3 = stripped.match(/^([^:+-]+?)\s*:\s*([^:+-]+?)\s*([+-]?\d+)$/);
                if (match3) {
                    return {
                        charName: match3[1].trim(),
                        name: match3[2].trim(),
                        delta: parseInt(match3[3], 10) || 0
                    };
                }
                const match2 = stripped.match(/^([^:+-]+?)\s*([+-]?\d+)$/);
                if (match2) {
                    return {
                        charName: '',
                        name: match2[1].trim(),
                        delta: parseInt(match2[2], 10) || 0
                    };
                }

                return null;
            },

            migrateGameState(rawGs) {
                const result = { resources: [], relationships: [], journal: [] };
                if (!rawGs || typeof rawGs !== 'object') return result;

                if (Array.isArray(rawGs.resources)) {
                    result.resources = rawGs.resources.map(r => {
                        if (typeof r === 'string') {
                            return {
                                id: this.uuid(),
                                name: r,
                                value: 1,
                                type: 'Misc',
                                rarity: 'Common',
                                description: ''
                            };
                        } else if (r && typeof r === 'object') {
                            return {
                                id: r.id || this.uuid(),
                                name: r.name || 'Unknown Item',
                                value: typeof r.value === 'number' ? r.value : 1,
                                type: r.type || 'Misc',
                                rarity: r.rarity || 'Common',
                                description: r.description || ''
                            };
                        }
                        return null;
                    }).filter(Boolean);
                }

                if (Array.isArray(rawGs.journal)) {
                    result.journal = rawGs.journal.map(q => {
                        if (typeof q === 'string') {
                            return {
                                id: this.uuid(),
                                title: q,
                                objective: q,
                                status: 'active',
                                log: [q],
                                objectives: []
                            };
                        } else if (q && typeof q === 'object') {
                            return {
                                id: q.id || this.uuid(),
                                title: q.title || 'Untitled Quest',
                                status: q.status || 'active',
                                objective: q.objective || q.title || '',
                                log: q.log || (q.objective ? [q.objective] : []),
                                objectives: Array.isArray(q.objectives) ? q.objectives : [],
                                characterId: q.characterId || null
                            };
                        }
                        return null;
                    }).filter(Boolean);
                }

                if (Array.isArray(rawGs.relationships)) {
                    result.relationships = rawGs.relationships.map(r => {
                        if (r && typeof r === 'object') {
                            return {
                                id: r.id || this.uuid(),
                                characterId: r.characterId || null,
                                characterName: r.characterName || 'Unknown',
                                track: r.track || 'Affection',
                                value: typeof r.value === 'number' ? r.value : 50,
                                stance: r.stance || '',
                                history: Array.isArray(r.history) ? r.history : []
                            };
                        }
                        return null;
                    }).filter(Boolean);
                }

                return result;
            },

            /**
             * Auto-Backup Utility Helpers
             */
            buildBackupPayload(stories = [], narratives = [], folders = [], appVersion = '1.0') {
                return {
                    version: appVersion,
                    timestamp: new Date().toISOString(),
                    storiesCount: Array.isArray(stories) ? stories.length : 0,
                    narrativesCount: Array.isArray(narratives) ? narratives.length : 0,
                    foldersCount: Array.isArray(folders) ? folders.length : 0,
                    stories: Array.isArray(stories) ? stories : [],
                    narratives: Array.isArray(narratives) ? narratives : [],
                    folders: Array.isArray(folders) ? folders : []
                };
            },

            sanitizeBackupForLocalStorage(payload, maxBytes = 2000000) {
                if (!payload || typeof payload !== 'object') return null;
                let clean = JSON.parse(JSON.stringify(payload));

                if (clean.stories && Array.isArray(clean.stories)) {
                    clean.stories.forEach(s => {
                        if (s && s.characterImages) delete s.characterImages;
                    });
                }

                let str = JSON.stringify(clean);
                if (str.length <= maxBytes) return clean;

                if (clean.narratives && Array.isArray(clean.narratives)) {
                    clean.narratives.forEach(n => {
                        if (n && Array.isArray(n.chat_history) && n.chat_history.length > 50) {
                            n.chat_history = n.chat_history.slice(-50);
                        }
                    });
                }

                str = JSON.stringify(clean);
                if (str.length <= maxBytes) return clean;

                if (clean.narratives && Array.isArray(clean.narratives)) {
                    clean.narratives.forEach(n => {
                        if (n && Array.isArray(n.chat_history) && n.chat_history.length > 20) {
                            n.chat_history = n.chat_history.slice(-20);
                        }
                    });
                }

                return clean;
            },

            validateBackupData(data) {
                if (!data || typeof data !== 'object') return { valid: false, storiesCount: 0, narrativesCount: 0, reason: 'Invalid object' };
                const stories = Array.isArray(data.stories) ? data.stories : [];
                const narratives = Array.isArray(data.narratives) ? data.narratives : [];
                if (stories.length === 0 && narratives.length === 0) {
                    return { valid: false, storiesCount: 0, narrativesCount: 0, reason: 'Empty stories and narratives' };
                }
                return {
                    valid: true,
                    storiesCount: stories.length,
                    narrativesCount: narratives.length,
                    foldersCount: Array.isArray(data.folders) ? data.folders.length : 0,
                    timestamp: data.timestamp || null
                };
            },

            isBackupNewerOrRicher(backupData, currentStories = [], currentNarratives = []) {
                const validation = this.validateBackupData(backupData);
                if (!validation.valid) return false;

                const currStoriesCount = Array.isArray(currentStories) ? currentStories.length : 0;
                const currNarrativesCount = Array.isArray(currentNarratives) ? currentNarratives.length : 0;

                if (currStoriesCount === 0 && currNarrativesCount === 0) return true;
                if (validation.storiesCount > currStoriesCount || validation.narrativesCount > currNarrativesCount) return true;

                return false;
            },

            /**
             * Normalizes a user-entered Vision Bridge endpoint down to its origin.
             * People paste whatever their provider's docs showed them — a bare host, a
             * trailing slash, or the full chat-completions path. All three must resolve
             * to the same base so VisionBridgeService can append its own route.
             * Pure: no DOM, no network. Tested in test.js.
             * @param {string} url - Raw user input.
             * @returns {string} Origin with no trailing slash, or "" if unusable.
             */
            normalizeVisionEndpoint(url) {
                if (typeof url !== 'string') return '';
                let out = url.trim();
                if (!out) return '';
                out = out.replace(/\s+/g, '');
                // Strip the OpenAI-compatible suffixes users commonly paste in whole.
                out = out.replace(/\/+(v1\/)?chat\/completions\/*$/i, '');
                out = out.replace(/\/+v1\/*$/i, '');
                out = out.replace(/\/+$/, '');
                if (!out) return '';
                if (!/^https?:\/\//i.test(out)) out = 'http://' + out;
                return out;
            },

            /**
             * Formats vision-model descriptions into the block injected into the chat
             * model's prompt. Deliberately instructs the model to treat the text as
             * direct sight and never to narrate the mechanism — a character who says
             * "according to the image description" breaks the fiction instantly.
             * Pure: no DOM, no network. Tested in test.js.
             * @param {string[]} descriptions - One entry per image, in upload order.
             * @returns {string} The injectable block, or "" when there is nothing to say.
             */
            buildVisionContextBlock(descriptions) {
                if (!Array.isArray(descriptions)) return '';
                const clean = descriptions
                    .map(d => (typeof d === 'string' ? d.trim() : ''))
                    .filter(d => d.length > 0);
                if (clean.length === 0) return '';

                const plural = clean.length === 1 ? 'an image' : `${clean.length} images`;
                const lines = clean.length === 1
                    ? clean[0]
                    : clean.map((d, i) => `Image ${i + 1}: ${d}`).join('\n');

                return `[VISUAL CONTEXT]\nThe user has shared ${plural} with you. `
                    + `You can see it directly. The following is what is depicted:\n\n`
                    + `${lines}\n\n`
                    + `Respond as though you are looking at it yourself. Never mention this `
                    + `description, never refer to it as a description, and never state that `
                    + `anything was described to you.`;
            }
        };
