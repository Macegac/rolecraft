        /**
         * AgentSchema
         * Pure helpers for agents: the shape of an agent, reading agent files (Rolecraft's own and
         * SillyBunny's), deciding whether an agent fires on a turn, and working out where note
         * agents land in a prompt. Nothing here touches the DOM, storage or the network, so all of
         * it is unit tested in test.js.
         *
         * An agent is one of two kinds:
         *   note   - its prompt is placed into the reply prompt itself. No extra AI request.
         *   helper - runs its own AI request and does something with the answer.
         */
        const AgentSchema = {
            FORMAT: 'rolecraft-agents',
            VERSION: 1,

            POSITIONS: ['chat', 'top', 'before'],
            ROLES: ['system', 'user', 'assistant'],
            DISPLAYS: ['card', 'panel', 'hidden'],

            /**
             * A complete agent with every field at its default.
             * @returns {Object}
             */
            createDefault() {
                return {
                    id: '',
                    name: '',
                    description: '',
                    author: '',
                    tags: [],
                    kind: 'note',
                    prompt: '',
                    defaultOn: false,
                    trigger: {
                        probability: 100,
                        keywords: [],
                        keywordDepth: 1,
                        everyMessages: 0,
                        minTokens: 0
                    },
                    placement: {
                        position: 'chat',
                        depth: 4,
                        role: 'system',
                        order: 100
                    },
                    helper: {
                        run: 'auto',
                        contextMessages: 10,
                        includeCharacters: true,
                        includeLore: false,
                        priorNotes: 1,
                        display: 'card',
                        feedForward: false,
                        feedCount: 1,
                        maxTokens: 0
                    },
                    brain: { model: '' },
                    builtin: '',
                    source: null,
                    created: 0,
                    updated: 0
                };
            },

            _int(value, fallback, min, max) {
                const n = parseInt(value, 10);
                if (!Number.isFinite(n)) return fallback;
                return Math.min(max, Math.max(min, n));
            },

            _str(value, fallback = '') {
                return typeof value === 'string' ? value : fallback;
            },

            _pick(value, allowed, fallback) {
                return allowed.includes(value) ? value : fallback;
            },

            _keywords(value) {
                const list = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',') : []);
                return list.map(k => String(k).trim()).filter(Boolean);
            },

            /**
             * Fills in missing fields and clamps bad values, so every agent the app handles has the
             * same shape no matter where it came from.
             * @param {Object} raw
             * @returns {Object}
             */
            normalize(raw = {}) {
                const d = this.createDefault();
                const r = raw && typeof raw === 'object' ? raw : {};
                const t = r.trigger || {};
                const p = r.placement || {};
                const h = r.helper || {};
                return {
                    id: this._str(r.id),
                    name: this._str(r.name).trim() || 'Untitled agent',
                    description: this._str(r.description),
                    author: this._str(r.author),
                    tags: this._keywords(r.tags),
                    kind: this._pick(r.kind, ['note', 'helper'], d.kind),
                    prompt: this._str(r.prompt),
                    defaultOn: r.defaultOn === true,
                    trigger: {
                        probability: this._int(t.probability, d.trigger.probability, 0, 100),
                        keywords: this._keywords(t.keywords),
                        keywordDepth: this._int(t.keywordDepth, d.trigger.keywordDepth, 1, 50),
                        everyMessages: this._int(t.everyMessages, d.trigger.everyMessages, 0, 1000),
                        minTokens: this._int(t.minTokens, d.trigger.minTokens, 0, 1000000)
                    },
                    placement: {
                        position: this._pick(p.position, this.POSITIONS, d.placement.position),
                        depth: this._int(p.depth, d.placement.depth, 0, 1000),
                        role: this._pick(p.role, this.ROLES, d.placement.role),
                        order: this._int(p.order, d.placement.order, -10000, 10000)
                    },
                    helper: {
                        run: this._pick(h.run, ['auto', 'manual'], d.helper.run),
                        contextMessages: this._int(h.contextMessages, d.helper.contextMessages, 1, 200),
                        includeCharacters: h.includeCharacters !== undefined ? h.includeCharacters === true : d.helper.includeCharacters,
                        includeLore: h.includeLore === true,
                        priorNotes: this._int(h.priorNotes, d.helper.priorNotes, 0, 20),
                        display: this._pick(h.display, this.DISPLAYS, d.helper.display),
                        feedForward: h.feedForward === true,
                        feedCount: this._int(h.feedCount, d.helper.feedCount, 1, 20),
                        maxTokens: this._int(h.maxTokens, d.helper.maxTokens, 0, 200000)
                    },
                    brain: { model: this._str((r.brain || {}).model).trim() },
                    builtin: this._str(r.builtin),
                    source: r.source && typeof r.source === 'object'
                        ? {
                            app: this._str(r.source.app),
                            id: this._str(r.source.id),
                            templateId: this._str(r.source.templateId),
                            skipped: Array.isArray(r.source.skipped) ? r.source.skipped.map(String) : []
                        }
                        : null,
                    created: this._int(r.created, 0, 0, Number.MAX_SAFE_INTEGER),
                    updated: this._int(r.updated, 0, 0, Number.MAX_SAFE_INTEGER)
                };
            },

            /**
             * True when the object looks like a SillyBunny In-Chat Agent.
             * @param {Object} raw
             * @returns {boolean}
             */
            isSillyBunnyAgent(raw) {
                return !!raw && typeof raw === 'object' && typeof raw.prompt === 'string'
                    && ('execution' in raw || 'injection' in raw || 'companion' in raw || 'preProcess' in raw);
            },

            /**
             * Converts one SillyBunny agent. Anything Rolecraft cannot do yet is listed in
             * source.skipped, in plain words, so the import can say so instead of dropping it
             * silently. Agents that only worked through a skipped feature arrive switched off.
             * @param {Object} sb
             * @returns {Object} normalized Rolecraft agent
             */
            fromSillyBunny(sb) {
                const skipped = [];
                const companion = sb.companion || {};
                const injection = sb.injection || {};
                const pre = sb.preProcess || {};
                const post = sb.postProcess || {};
                const conditions = sb.conditions || {};
                const isCompanion = sb.execution === 'companion';
                let usable = true;

                if (!isCompanion) {
                    if (pre.mode === 'intercept') {
                        skipped.push('It rewrote the prompt before sending (an intercept). Imported switched off.');
                        usable = false;
                    }
                    if (sb.phase === 'post') {
                        skipped.push('It only ran after the reply was written. Imported switched off.');
                        usable = false;
                    }
                }
                if (post.promptTransformEnabled) skipped.push('It rewrote or extended finished replies with a second AI pass.');
                if (post.enabled) skipped.push('It pulled values out of replies (post-processing).');
                if (Array.isArray(sb.regexScripts) && sb.regexScripts.length) skipped.push(`It carried ${sb.regexScripts.length} regex script(s).`);
                if (companion.batch) skipped.push('It batched its request with other companions.');
                if (Array.isArray(companion.dependencies) && companion.dependencies.length) skipped.push('It waited on other companions.');
                if (companion.sendContextToCompanions) skipped.push('It passed its notes to other companions.');
                if (sb.connectionProfile) skipped.push(`Its connection profile "${sb.connectionProfile}" (set a model on the agent instead).`);
                if (Array.isArray(sb.tools) && sb.tools.length) skipped.push('It offered tools to the model.');

                const positionMap = { 0: 'top', 1: 'chat', 2: 'before' };
                const roleMap = { 0: 'system', 1: 'user', 2: 'assistant' };

                return this.normalize({
                    name: sb.name,
                    description: sb.description,
                    author: sb.author,
                    tags: sb.tags,
                    kind: isCompanion ? 'helper' : 'note',
                    prompt: sb.prompt,
                    defaultOn: sb.enabled === true && usable,
                    trigger: {
                        probability: conditions.triggerProbability ?? 100,
                        keywords: conditions.triggerKeywords,
                        keywordDepth: 1,
                        everyMessages: 0,
                        minTokens: isCompanion ? (companion.minContextTokens || 0) : 0
                    },
                    placement: {
                        position: positionMap[injection.position] || 'chat',
                        depth: injection.depth ?? 4,
                        role: roleMap[injection.role] || 'system',
                        order: injection.order ?? 100
                    },
                    helper: {
                        run: companion.trigger === 'manual' ? 'manual' : 'auto',
                        contextMessages: companion.contextMessages ?? 10,
                        includeCharacters: companion.includeCharacterCard !== false,
                        includeLore: companion.includeWorldInfo === true,
                        priorNotes: companion.includeHistory ? (companion.historyDepth ?? 1) : 0,
                        display: companion.displayMode,
                        feedForward: !!(companion.feedback && companion.feedback.enabled),
                        feedCount: (companion.feedback && companion.feedback.depth) || 1,
                        maxTokens: 0
                    },
                    brain: { model: sb.modelOverride || '' },
                    source: {
                        app: 'sillybunny',
                        id: sb.id || '',
                        templateId: sb.sourceTemplateId || '',
                        skipped
                    }
                });
            },

            /**
             * Reads the text of an imported agent file. Accepts a Rolecraft bundle, a single
             * Rolecraft agent, a SillyBunny pack, a single SillyBunny agent, or a plain array of any
             * of those. Returned agents have no id yet; the store assigns fresh ones.
             * @param {string} text
             * @returns {{agents: Object[], notes: string[]}}
             */
            parseImport(text) {
                let data;
                try {
                    data = JSON.parse(text);
                } catch (e) {
                    throw new Error('This file is not valid JSON.');
                }

                let list;
                if (data && data.format === this.FORMAT && Array.isArray(data.agents)) list = data.agents;
                else if (data && data.format === 'sillybunny-inchat-agents' && Array.isArray(data.agents)) list = data.agents;
                else if (Array.isArray(data)) list = data;
                else if (data && typeof data === 'object' && typeof data.prompt === 'string') list = [data];
                else throw new Error('No agents found in this file.');

                const agents = [];
                const notes = [];
                list.forEach(raw => {
                    if (!raw || typeof raw !== 'object' || typeof raw.prompt !== 'string') return;
                    const agent = this.isSillyBunnyAgent(raw) ? this.fromSillyBunny(raw) : this.normalize(raw);
                    agent.id = '';
                    agent.builtin = '';
                    agents.push(agent);
                    if (agent.source && agent.source.skipped.length) {
                        notes.push(`${agent.name}: ${agent.source.skipped.join(' ')}`);
                    }
                });
                if (!agents.length) throw new Error('No agents found in this file.');
                return { agents, notes };
            },

            /**
             * Builds the export file contents for a set of agents.
             * @param {Object[]} agents
             * @returns {Object}
             */
            buildExport(agents) {
                return {
                    format: this.FORMAT,
                    version: this.VERSION,
                    agents: (agents || []).map(a => {
                        const copy = this.normalize(a);
                        delete copy.created;
                        delete copy.updated;
                        return copy;
                    })
                };
            },

            /**
             * Whether an agent is switched on for a story. A story's own switch wins; a story that
             * never touched the switch follows the agent's default.
             * @param {Object} agent
             * @param {Object} switches - story.agent_switches
             * @returns {boolean}
             */
            isOn(agent, switches) {
                if (switches && typeof switches[agent.id] === 'boolean') return switches[agent.id];
                return agent.defaultOn === true;
            },

            /**
             * Rough token count for text: about four characters per token, the same fallback
             * SillyBunny uses, so its "min context tokens" values mean the same thing here.
             * @param {string} text
             * @returns {number}
             */
            estimateTokens(text) {
                return Math.ceil(String(text || '').length / 4);
            },

            /**
             * Decides whether an agent fires on this turn. Every condition must pass: minimum chat
             * size, the message schedule, the keyword check, and the chance roll (in that order, so a
             * chance roll is only spent when everything else allows it).
             * @param {Object} agent
             * @param {{messageCounter: number, recentTexts: string[], roll: number, chatTokens: number}} ctx - roll in [0, 1)
             * @returns {boolean}
             */
            shouldFire(agent, ctx) {
                const trigger = agent.trigger || {};
                if ((trigger.minTokens || 0) > 0 && (ctx.chatTokens || 0) < trigger.minTokens) return false;
                const every = trigger.everyMessages || 0;
                if (every > 0) {
                    const count = ctx.messageCounter || 0;
                    if (count <= 0 || count % every !== 0) return false;
                }

                const keywords = trigger.keywords || [];
                if (keywords.length) {
                    const depth = Math.max(1, trigger.keywordDepth || 1);
                    const haystack = (ctx.recentTexts || []).slice(-depth).join('\n').toLowerCase();
                    if (!keywords.some(k => haystack.includes(String(k).toLowerCase()))) return false;
                }

                const probability = trigger.probability ?? 100;
                if (probability >= 100) return true;
                if (probability <= 0) return false;
                return ctx.roll * 100 < probability;
            },

            /**
             * Replaces placeholders in agent text. Supports SillyTavern/SillyBunny style
             * {{char}} and {{user}}, Rolecraft's older {character} and {user}, and
             * {{random::a::b}} or {{random:a,b}} which pick one option.
             * @param {string} text
             * @param {{char: string, user: string, pick: function(number): number}} ctx - pick(n) returns an index below n
             * @returns {string}
             */
            expandMacros(text, ctx) {
                if (typeof text !== 'string') return '';
                const pick = ctx.pick || (n => Math.floor(Math.random() * n));
                return text
                    .replace(/\{\{random::([^}]*)\}\}/gi, (m, body) => {
                        const options = body.split('::');
                        return options[pick(options.length)];
                    })
                    .replace(/\{\{random:([^}]*)\}\}/gi, (m, body) => {
                        const options = body.split(',');
                        return options[pick(options.length)].trim();
                    })
                    .replace(/\{\{char\}\}/gi, ctx.char || '')
                    .replace(/\{\{user\}\}/gi, ctx.user || '')
                    .replace(/\{character\}/g, ctx.char || '')
                    .replace(/\{user\}/g, ctx.user || '');
            },

            /**
             * Works out where each note lands in a prompt.
             *   before - ahead of everything, even the system prompt
             *   top    - right after the system prompt
             *   chat   - inside the conversation, `depth` messages up from the end (0 = after the
             *            last message, the last thing the model reads before its instructions)
             * Notes at the same spot keep ascending `order`.
             * @param {Object[]} notes - {text, position, depth, role, order}
             * @param {number} messageCount - number of messages that will be shown in the prompt
             * @returns {{before: Object[], top: Object[], beforeMessage: Object<number, Object[]>, end: Object[]}}
             */
            layoutNotes(notes, messageCount) {
                const layout = { before: [], top: [], beforeMessage: {}, end: [] };
                const sorted = [...(notes || [])].filter(n => n && n.text).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
                sorted.forEach(note => {
                    if (note.position === 'before') { layout.before.push(note); return; }
                    if (note.position === 'top') { layout.top.push(note); return; }
                    const depth = Math.max(0, note.depth || 0);
                    if (depth === 0 || messageCount <= 0) { layout.end.push(note); return; }
                    const index = Math.max(0, messageCount - depth);
                    (layout.beforeMessage[index] = layout.beforeMessage[index] || []).push(note);
                });
                return layout;
            },

            /**
             * The heading a note is shown under in a plain-text prompt.
             * @param {string} role
             * @returns {string}
             */
            noteHeading(role) {
                if (role === 'user') return '### User Note:';
                if (role === 'assistant') return '### Narrator Note:';
                return '### System Note:';
            }
        };
