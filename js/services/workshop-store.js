        /**
         * =================================================================================================
         * [SEC:JS:SRV:WSSTORE]
         * WorkshopStore
         * A character in the Character Workshop: its sections, the history of every accepted change,
         * and its variants. Pure functions only: each takes a Workshop and returns a new one, and none
         * touches the page, the story or storage. WorkshopController puts the result on the character.
         * =================================================================================================
         */
        const WorkshopStore = {

            // The history works like version control. Each accepted change is a commit that stores,
            // for every part it touched, that part before and after; never a copy of the whole
            // character. A commit's parent makes the history a tree, and a variant is a named branch:
            // its head is its newest commit, and its state is the character at that commit, kept
            // ready to read. The first commit holds every part, so any point can be rebuilt by
            // replaying the commits that lead to it. Going back to a point is a new commit too, so
            // nothing is ever deleted.

            VERSION: 1,

            /** The eleven sections every character starts with, in the order the card shows them. */
            sectionDefs: [
                { id: 'appearance', title: 'Appearance & body', target: 'description', length: 'medium' },
                { id: 'personality', title: 'Personality', target: 'description', length: 'medium' },
                { id: 'sexuality', title: 'Sexuality', target: 'description', length: 'medium' },
                { id: 'relationship', title: 'Relationship to {{user}}', target: 'description', length: 'medium' },
                { id: 'background', title: 'Background', target: 'description', length: 'medium' },
                { id: 'voice', title: 'Voice', target: 'description', length: 'short' },
                { id: 'scenario', title: 'Scenario', target: 'scenario', length: 'medium' },
                { id: 'kinks', title: 'Kinks & limits', target: 'description', length: 'short' },
                { id: 'secrets', title: 'Secrets & wants', target: 'description', length: 'short' },
                { id: 'wardrobe', title: 'Wardrobe', target: 'description', length: 'short' },
                { id: 'likes', title: 'Likes & dislikes', target: 'description', length: 'short' }
            ],

            /** Headings found in cards and written by the Story Architect, and the section each belongs to. */
            HEADINGS: {
                appearance: ['appearance & body', 'appearance and body', 'appearance', 'body', 'looks', 'physical description'],
                personality: ['personality', 'description', 'traits', 'personality traits'],
                sexuality: ['sexuality'],
                relationship: ['relationship to {{user}}', 'relationship to user', 'relationship', 'relationships'],
                background: ['background', 'personal history', 'history', 'backstory'],
                voice: ['voice', 'speech', 'speech style', 'speaking style'],
                scenario: ['scenario'],
                kinks: ['kinks & limits', 'kinks and limits', 'kinks', 'limits'],
                secrets: ['secrets & wants', 'secrets and wants', 'secrets', 'wants', 'goals', 'character intentions'],
                wardrobe: ['wardrobe', 'clothing', 'outfit', 'outfits'],
                likes: ['likes & dislikes', 'likes and dislikes', 'likes', 'dislikes', 'fears and joys']
            },

            newId(prefix) {
                return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
            },

            /**
             * A character with nothing in it yet. `unsorted` holds card text that has not been put into
             * a section; it stays in the description word for word until it is sorted.
             */
            blankState() {
                return {
                    concept: '',
                    notes: '',
                    unsorted: '',
                    // The lead's text for each of the story's openings, by its id in the story. An
                    // opening with no text here reads as the story has it.
                    openings: {},
                    // The example dialogue as '{{user}}: …' and '{{char}}: …' lines; null reads as the story's own.
                    examples: null,
                    // What was decided about the character, and why: the co-writer reads it at the start of every chat.
                    notebook: [],
                    sections: this.sectionDefs.map(d => ({
                        id: d.id, title: d.title, target: d.target, pins: [], text: '', pinMap: {}, locked: false, length: d.length, at: 0
                    }))
                };
            },

            /**
             * A new Workshop. Its first commit holds every part as it started.
             * @param {Object} [opts]
             * @param {Object} [opts.state] - Where the character starts. Blank when left out.
             * @param {{description: string, scenario: string}} [opts.original] - The card's text before
             *        the Workshop touched it, kept as it was for exporting the original.
             * @param {string} [opts.origin] - Where the start came from: 'you', 'unflatten' and so on.
             * @param {string} [opts.summary]
             * @param {number} [opts.now]
             * @param {string} [opts.commitId]
             * @returns {Object} The Workshop.
             */
            create({ state = this.blankState(), original = {}, origin = 'you', summary = 'Started', now = Date.now(), commitId = this.newId('c') } = {}) {
                const openings = this._copy(state.openings || {});
                const examples = state.examples ?? null;
                const notebook = this._copy(state.notebook || []);
                const changes = [
                    { section: '_concept', before: null, after: state.concept || '' },
                    { section: '_notes', before: null, after: state.notes || '' },
                    { section: '_unsorted', before: null, after: state.unsorted || '' },
                    // Only when there are some, so a character that starts without them starts as before.
                    ...(Object.keys(openings).length ? [{ section: '_openings', before: null, after: this._copy(openings) }] : []),
                    ...(examples !== null ? [{ section: '_examples', before: null, after: examples }] : []),
                    ...(notebook.length ? [{ section: '_notebook', before: null, after: this._copy(notebook) }] : []),
                    ...state.sections.map(s => ({ section: s.id, before: null, after: this._copy(s) }))
                ];
                const start = {
                    concept: state.concept || '', notes: state.notes || '', unsorted: state.unsorted || '', openings, examples, notebook, sections: this._copy(state.sections)
                };
                return {
                    v: this.VERSION,
                    active: 'v_main',
                    original: { description: original.description || '', scenario: original.scenario || '' },
                    variants: [{ id: 'v_main', name: 'Main', head: commitId, at: now, state: start }],
                    commits: [{ id: commitId, parent: null, variant: 'v_main', at: now, origin, summary, changes }],
                    avoid: {}
                };
            },

            /**
             * A Workshop started from a card's description, without any AI. Text under headings the
             * Workshop knows goes to those sections; the rest stays unsorted, so the description keeps
             * every word.
             * @param {string} description
             * @param {{concept?: string, summary?: string, now?: number, commitId?: string}} [opts]
             */
            fromDescription(description, { concept = '', summary, now, commitId } = {}) {
                const text = String(description || '');
                const state = this.blankState();
                const split = this.splitCard(text);
                state.concept = concept;
                state.unsorted = split.unsorted;
                state.sections.forEach(s => { if (split.sections[s.id]) s.text = split.sections[s.id]; });
                const fromCard = !!text.trim();
                return this.create({
                    state, original: { description: text, scenario: '' }, origin: fromCard ? 'card' : 'you',
                    summary: summary || (fromCard ? 'Taken from the card' : 'Started'), now, commitId
                });
            },

            /** The variant being worked on. */
            active(ws) {
                return ws.variants.find(v => v.id === ws.active) || ws.variants[0];
            },

            /**
             * Records a change on the active variant. The commit holds each part that differs between
             * the variant's state and `next`, before and after, and the sections that changed are
             * stamped with the time. When nothing differs, nothing is recorded.
             * @param {Object} ws
             * @param {Object} next - The whole character as it should be now.
             * @param {{origin?: string, summary?: string, now?: number, commitId?: string, from?: string}} [opts]
             * @returns {Object} The new Workshop, or the same one when nothing changed.
             */
            commit(ws, next, { origin = 'you', summary = '', now = Date.now(), commitId = this.newId('c'), from } = {}) {
                const variant = this.active(ws);
                const stamped = this._stamp(variant.state, next, now);
                const changes = this.diff(variant.state, stamped);
                if (changes.length === 0) return ws;
                const commit = { id: commitId, parent: variant.head, variant: variant.id, at: now, origin, summary, changes };
                if (from) commit.from = from;
                return {
                    ...ws,
                    commits: [...ws.commits, commit],
                    variants: ws.variants.map(v => v.id === variant.id ? { ...v, head: commitId, state: stamped } : v)
                };
            },

            /** What differs between two states: one entry per part, with copies of both sides. */
            diff(a, b) {
                const changes = [];
                if ((a.concept || '') !== (b.concept || '')) changes.push({ section: '_concept', before: a.concept || '', after: b.concept || '' });
                if ((a.notes || '') !== (b.notes || '')) changes.push({ section: '_notes', before: a.notes || '', after: b.notes || '' });
                if ((a.unsorted || '') !== (b.unsorted || '')) changes.push({ section: '_unsorted', before: a.unsorted || '', after: b.unsorted || '' });
                // A Workshop from before openings were kept has neither, which reads as none.
                if (!this._same(a.openings || {}, b.openings || {})) changes.push({ section: '_openings', before: this._copy(a.openings || {}), after: this._copy(b.openings || {}) });
                if ((a.examples ?? null) !== (b.examples ?? null)) changes.push({ section: '_examples', before: a.examples ?? null, after: b.examples ?? null });
                if (!this._same(a.notebook || [], b.notebook || [])) changes.push({ section: '_notebook', before: this._copy(a.notebook || []), after: this._copy(b.notebook || []) });
                const before = new Map(a.sections.map(s => [s.id, s]));
                const after = new Map(b.sections.map(s => [s.id, s]));
                for (const id of new Set([...before.keys(), ...after.keys()])) {
                    const x = before.has(id) ? before.get(id) : null;
                    const y = after.has(id) ? after.get(id) : null;
                    if (!this._same(x, y)) changes.push({ section: id, before: this._copy(x), after: this._copy(y) });
                }
                return changes;
            },

            /** The commits leading to this one, oldest first. Empty when the commit is unknown. */
            lineage(ws, commitId) {
                const byId = new Map(ws.commits.map(c => [c.id, c]));
                const path = [];
                const seen = new Set();
                for (let c = byId.get(commitId); c && !seen.has(c.id); c = c.parent ? byId.get(c.parent) : null) {
                    seen.add(c.id);
                    path.push(c);
                }
                return path.reverse();
            },

            /** The character as it was at a commit, rebuilt by replaying the commits that lead to it. */
            stateAt(ws, commitId) {
                const path = this.lineage(ws, commitId);
                if (path.length === 0) return null;
                return path.reduce((state, c) => this._apply(state, c.changes), { concept: '', notes: '', unsorted: '', openings: {}, examples: null, notebook: [], sections: [] });
            },

            /**
             * Goes back to a saved point on the active variant. It is a new commit, so the steps in
             * between stay in the history and can be gone back to as well.
             */
            restore(ws, commitId, { now = Date.now(), commitId: newCommitId = this.newId('c') } = {}) {
                const target = this.stateAt(ws, commitId);
                if (!target) return ws;
                const point = ws.commits.find(c => c.id === commitId);
                return this.commit(ws, target, {
                    origin: 'restore', summary: `Went back to: ${point.summary || 'an earlier point'}`, now, commitId: newCommitId, from: commitId
                });
            },

            /** Starts a new variant at a saved point and makes it the one being worked on. */
            branch(ws, commitId, { name = '', now = Date.now(), variantId = this.newId('v') } = {}) {
                const state = this.stateAt(ws, commitId);
                if (!state) return ws;
                const variant = { id: variantId, name: name.trim() || `Variant ${ws.variants.length + 1}`, head: commitId, at: now, state };
                return this._activate({ ...ws, variants: [...ws.variants, variant] }, variantId);
            },

            switchVariant(ws, variantId) {
                return ws.variants.some(v => v.id === variantId && !v.deletedAt) ? this._activate(ws, variantId) : ws;
            },

            /**
             * Makes another variant the one being worked on. Proposals were written for the variant
             * they wait on, so they are set aside with it and come back when it is used again.
             */
            _activate(ws, variantId) {
                if (ws.active === variantId) return ws;
                const parked = { ...(ws.parked || {}) };
                if (Object.keys(ws.pending || {}).length) parked[ws.active] = ws.pending;
                const pending = parked[variantId] || {};
                delete parked[variantId];
                return { ...ws, active: variantId, pending, parked };
            },

            renameVariant(ws, variantId, name) {
                const clean = String(name || '').trim().slice(0, 60);
                if (!clean) return ws;
                return { ...ws, variants: ws.variants.map(v => (v.id === variantId ? { ...v, name: clean } : v)) };
            },

            /**
             * Hides a variant rather than deleting it, so it can be brought back. The last one left
             * cannot go. Hiding the one being worked on switches to the newest of the others.
             */
            deleteVariant(ws, variantId, now = Date.now()) {
                const live = ws.variants.filter(v => !v.deletedAt);
                if (live.length < 2 || !live.some(v => v.id === variantId)) return ws;
                const next = { ...ws, variants: ws.variants.map(v => (v.id === variantId ? { ...v, deletedAt: now } : v)) };
                if (ws.active !== variantId) return next;
                const others = live.filter(v => v.id !== variantId);
                return this._activate(next, others[others.length - 1].id);
            },

            restoreVariant(ws, variantId) {
                return {
                    ...ws,
                    variants: ws.variants.map(v => {
                        if (v.id !== variantId) return v;
                        const kept = { ...v };
                        delete kept.deletedAt;
                        return kept;
                    })
                };
            },

            /**
             * Puts a proposal on a section, or takes it off with null. Proposals wait in the Workshop,
             * outside the history, so closing the Workshop does not lose them; nothing in the card
             * changes until one is accepted.
             */
            setPending(ws, sectionId, proposal) {
                const pending = { ...(ws.pending || {}) };
                if (proposal) pending[sectionId] = proposal;
                else delete pending[sectionId];
                return { ...ws, pending };
            },

            /**
             * Accepts proposals, by section id: each section takes its proposal's text and pin places,
             * all in one commit, and those proposals are cleared. A locked section keeps its text and
             * just loses the proposal.
             */
            acceptMany(ws, proposals, { origin = 'ai', summary = '', now = Date.now(), commitId = this.newId('c') } = {}) {
                const state = this.active(ws).state;
                const next = {
                    ...state,
                    sections: state.sections.map(s => ((proposals[s.id] && !s.locked)
                        ? { ...s, text: proposals[s.id].text, pinMap: { ...(proposals[s.id].pinMap || {}) } }
                        : s))
                };
                let out = this.commit(ws, next, { origin, summary, now, commitId });
                for (const id of Object.keys(proposals)) out = this.setPending(out, id, null);
                return out;
            },

            /** Remembers a take that was turned down, in a line, so later takes steer clear of it. */
            addAvoid(ws, sectionId, gist) {
                const line = String(gist || '').trim();
                if (!line) return ws;
                const list = ((ws.avoid || {})[sectionId] || []).filter(g => g !== line);
                return { ...ws, avoid: { ...(ws.avoid || {}), [sectionId]: [...list, line].slice(-20) } };
            },

            /**
             * The state after a sorting of the old card: moved sentences join the end of each
             * section's text, the leftover becomes the unsorted text, and drafted pins arrive as
             * suggestions. Locked sections are left as they are.
             */
            applySort(state, sort, now = Date.now()) {
                return {
                    ...state,
                    unsorted: sort.leftover || '',
                    sections: state.sections.map(s => {
                        if (s.locked) return s;
                        let next = s;
                        if (sort.sections[s.id]) next = { ...next, text: [String(s.text || '').trim(), sort.sections[s.id]].filter(Boolean).join('\n\n') };
                        if ((sort.pins[s.id] || []).length) {
                            next = { ...next, pins: [...next.pins, ...sort.pins[s.id].map(text => ({ id: this.newId('p'), text, origin: 'unflatten', state: 'suggested', at: now }))] };
                        }
                        return next;
                    })
                };
            },

            /** The state with suggested pins added to each section named, marked as suggestions. */
            addSuggestions(state, bySection, now = Date.now()) {
                return {
                    ...state,
                    sections: state.sections.map(s => (bySection[s.id]
                        ? { ...s, pins: [...s.pins, ...bySection[s.id].map(text => ({ id: this.newId('p'), text, origin: 'ai', state: 'suggested', at: now }))] }
                        : s))
                };
            },

            /** The state with a decision added to the notebook. An empty one adds nothing. */
            addDecision(state, { text, why = '', origin = 'you', now = Date.now(), id = this.newId('n') } = {}) {
                const clean = String(text || '').trim();
                if (!clean) return state;
                return { ...state, notebook: [...(state.notebook || []), { id, text: clean, why: String(why || '').trim(), at: now, origin }] };
            },

            /** The state with a decision's words or why changed. */
            changeDecision(state, id, { text, why } = {}, now = Date.now()) {
                return {
                    ...state,
                    notebook: (state.notebook || []).map(d => (d.id !== id ? d : {
                        ...d,
                        text: text !== undefined && String(text).trim() ? String(text).trim() : d.text,
                        why: why !== undefined ? String(why).trim() : d.why,
                        at: now
                    }))
                };
            },

            removeDecision(state, id) {
                return { ...state, notebook: (state.notebook || []).filter(d => d.id !== id) };
            },

            // The co-writer's chats live on the Workshop, outside the history, the way proposals do:
            // talking about a character doesn't change it. Each chat keeps its messages, and each
            // reply's cards are kept by id, so a card can be used, changed or turned down later.

            /** The chats and cards, with gaps filled. A Workshop from before the co-writer has none. */
            cowriterOf(ws) {
                const cw = (ws && ws.cowriter) || {};
                return {
                    open: cw.open || null,
                    chats: Array.isArray(cw.chats) ? cw.chats : [],
                    cards: (cw.cards && typeof cw.cards === 'object') ? cw.cards : {}
                };
            },

            /** A new, empty chat, first in the list and open. */
            newChat(ws, { id = this.newId('k'), now = Date.now(), title = 'New chat' } = {}) {
                const cw = this.cowriterOf(ws);
                return { ...ws, cowriter: { ...cw, open: id, chats: [{ id, title, at: now, updated: now, messages: [] }, ...cw.chats] } };
            },

            openChat(ws, chatId) {
                const cw = this.cowriterOf(ws);
                if (!cw.chats.some(c => c.id === chatId && !c.hiddenAt)) return ws;
                return { ...ws, cowriter: { ...cw, open: chatId } };
            },

            renameChat(ws, chatId, title) {
                const clean = String(title || '').trim().slice(0, 80);
                return clean ? this._mapChat(ws, chatId, c => ({ ...c, title: clean })) : ws;
            },

            /** Hides a chat rather than deleting it. Hiding the open one opens the next one still shown. */
            hideChat(ws, chatId, now = Date.now()) {
                const cw = this.cowriterOf(ws);
                const chats = cw.chats.map(c => (c.id === chatId ? { ...c, hiddenAt: now } : c));
                const open = cw.open === chatId ? ((chats.find(c => !c.hiddenAt) || {}).id || null) : cw.open;
                return { ...ws, cowriter: { ...cw, chats, open } };
            },

            unhideChat(ws, chatId) {
                return this._mapChat(ws, chatId, c => {
                    const shown = { ...c };
                    delete shown.hiddenAt;
                    return shown;
                });
            },

            /** Deletes a chat for good, so it stops taking up space. Deleting the open one opens the next one shown. */
            deleteChat(ws, chatId) {
                const cw = this.cowriterOf(ws);
                if (!cw.chats.some(c => c.id === chatId)) return ws;
                const chats = cw.chats.filter(c => c.id !== chatId);
                const open = cw.open === chatId ? ((chats.find(c => !c.hiddenAt) || {}).id || null) : cw.open;
                return { ...ws, cowriter: { ...cw, chats, open } };
            },

            /** A deleted chat put back in its place (Undo), and opened again if it was open. */
            restoreChat(ws, chat, { at = 0, open = false } = {}) {
                const cw = this.cowriterOf(ws);
                if (!chat || cw.chats.some(c => c.id === chat.id)) return ws;
                const chats = cw.chats.slice();
                chats.splice(Math.min(Math.max(at, 0), chats.length), 0, chat);
                return { ...ws, cowriter: { ...cw, chats, open: open ? chat.id : cw.open } };
            },

            /** Adds a message to a chat. A chat still called "New chat" is named after the first thing you say in it. */
            addMessage(ws, chatId, message, now = Date.now()) {
                const entry = { id: this.newId('m'), at: now, ...message };
                return this._mapChat(ws, chatId, c => ({
                    ...c,
                    updated: entry.at,
                    title: (c.title === 'New chat' && entry.role === 'you') ? this.chatTitle(entry.text) : c.title,
                    messages: [...c.messages, entry]
                }));
            },

            /** A chat's name from its first message: its first six words, without the "About …:" a Talk it over button starts it with. */
            chatTitle(text) {
                const words = String(text || '').replace(/^About [^:]+:\s*/i, '').split(/\s+/).filter(Boolean);
                const title = words.slice(0, 6).join(' ');
                if (!title) return 'New chat';
                return `${title.charAt(0).toUpperCase()}${title.slice(1)}${words.length > 6 ? '…' : ''}`;
            },

            /** Changes a message. On a rerolled reply the change goes to the version shown, too. */
            updateMessage(ws, chatId, messageId, patch) {
                return this._mapChat(ws, chatId, c => ({
                    ...c,
                    messages: c.messages.map(m => {
                        if (m.id !== messageId) return m;
                        const next = { ...m, ...patch };
                        if (Array.isArray(m.versions) && m.versions[m.shown]) {
                            next.versions = m.versions.map((v, i) => (i === m.shown ? { ...v, ...this._version(patch) } : v));
                        }
                        return next;
                    })
                }));
            },

            /**
             * Takes a message out of a chat, or it and everything after it. A question left as the
             * newest message is open again, since nothing answers it any more.
             */
            removeMessages(ws, chatId, messageId, { after = false } = {}) {
                const chat = this.cowriterOf(ws).chats.find(c => c.id === chatId);
                const at = chat ? chat.messages.findIndex(m => m.id === messageId) : -1;
                if (at === -1) return ws;
                const messages = after ? chat.messages.slice(0, at) : chat.messages.filter(m => m.id !== messageId);
                const cut = this.putMessages(ws, chatId, messages);
                const last = messages[messages.length - 1];
                if (last && last.role === 'cowriter' && last.ask && last.ask.picked !== null && last.ask.picked !== undefined) {
                    return this.updateMessage(cut, chatId, last.id, { ask: { ...last.ask, picked: null } });
                }
                return cut;
            },

            /** A chat's messages, put back as they were (Undo). */
            putMessages(ws, chatId, messages) {
                return this._mapChat(ws, chatId, c => ({ ...c, messages }));
            },

            /** What makes each version of a rerolled reply its own. */
            VERSION_KEYS: ['text', 'ask', 'proposed', 'unreadable', 'stopped', 'model', 'provider', 'variant', 'cards', 'at'],

            /** A reply asked for again: the new one shows, and every earlier one is kept to flip back to. */
            addVersion(ws, chatId, messageId, reply, now = Date.now()) {
                return this._mapChat(ws, chatId, c => ({
                    ...c,
                    updated: now,
                    messages: c.messages.map(m => {
                        if (m.id !== messageId) return m;
                        const versions = [...(Array.isArray(m.versions) ? m.versions : [this._version(m)]), this._version({ at: now, ...reply })];
                        return this._showing({ ...m, versions }, versions.length - 1);
                    })
                }));
            },

            showVersion(ws, chatId, messageId, index) {
                const chat = this.cowriterOf(ws).chats.find(c => c.id === chatId);
                const message = chat && chat.messages.find(m => m.id === messageId);
                if (!message || !Array.isArray(message.versions) || !message.versions[index]) return ws;
                return this._mapChat(ws, chatId, c => ({ ...c, messages: c.messages.map(m => (m.id === messageId ? this._showing(m, index) : m)) }));
            },

            _version(m) {
                const version = {};
                this.VERSION_KEYS.forEach(k => { if (m[k] !== undefined) version[k] = m[k]; });
                return version;
            },

            /** The message showing one of its versions, with nothing left over from the one before. */
            _showing(m, index) {
                const shown = { ...m };
                this.VERSION_KEYS.forEach(k => { delete shown[k]; });
                return { ...shown, ...m.versions[index], shown: index };
            },

            /** Keeps a reply's cards, each waiting for an answer and marked with the variant it was written for. */
            addCards(ws, chatId, messageId, cards, { variant, now = Date.now() } = {}) {
                const made = (cards || []).map(card => ({ ...card, id: this.newId('card'), status: 'waiting', variant, at: now }));
                if (made.length === 0) return ws;
                const cw = this.cowriterOf(ws);
                const kept = { ...cw.cards };
                made.forEach(card => { kept[card.id] = card; });
                const withCards = { ...ws, cowriter: { ...cw, cards: kept } };
                return this.updateMessage(withCards, chatId, messageId, { cards: made.map(card => card.id) });
            },

            setCard(ws, cardId, patch) {
                const cw = this.cowriterOf(ws);
                if (!cw.cards[cardId]) return ws;
                return { ...ws, cowriter: { ...cw, cards: { ...cw.cards, [cardId]: { ...cw.cards[cardId], ...patch } } } };
            },

            _mapChat(ws, chatId, change) {
                const cw = this.cowriterOf(ws);
                if (!cw.chats.some(c => c.id === chatId)) return ws;
                return { ...ws, cowriter: { ...cw, chats: cw.chats.map(c => (c.id === chatId ? change(c) : c)) } };
            },

            /**
             * The description every reply reads: card text not yet sorted into a section, as it was,
             * then each section with words in it, under its heading. Scenario is left out; it goes to
             * the card's scenario field instead.
             */
            compile(state) {
                const unsorted = String(state.unsorted || '').trim();
                const sections = state.sections
                    .filter(s => s.target === 'description' && String(s.text || '').trim())
                    .map(s => `## ${s.title}\n${s.text.trim()}`);
                return (unsorted ? [unsorted, ...sections] : sections).join('\n\n');
            },

            // A card shows one version of the character in its standard fields. The whole Workshop
            // rides along in data.extensions[CARD_KEY], so importing the card brings it back.

            CARD_KEY: 'rolecraft_workshop',

            /**
             * The card's own text for one version of the character: the description built from its
             * sections, and the Scenario section's text.
             * @param {Object} ws
             * @param {string} [pick] - 'current', 'original', a variant id or a commit id.
             * @returns {{description: string, scenario: string}|null} Null for a version that isn't there.
             */
            cardFields(ws, pick = 'current') {
                if (pick === 'original') {
                    const original = ws.original || {};
                    return { description: original.description || '', scenario: original.scenario || '' };
                }
                const variant = ws.variants.find(v => v.id === pick);
                const state = pick === 'current' ? this.active(ws).state : (variant ? variant.state : this.stateAt(ws, pick));
                if (!state) return null;
                const scenario = state.sections.find(s => s.target === 'scenario');
                return { description: this.compile(state), scenario: String((scenario && scenario.text) || '').trim() };
            },

            /**
             * A short fingerprint of the text a card was written with, so an import can tell it was
             * changed since. Line endings and space around each field don't count: other apps tidy those.
             */
            cardCheck(...texts) {
                let hash = 0x811c9dc5;
                for (const ch of texts.map(t => String(t || '').replace(/\r\n?/g, '\n').trim()).join('\u0000')) {
                    hash ^= ch.codePointAt(0);
                    hash = Math.imul(hash, 0x01000193) >>> 0;
                }
                return hash.toString(16).padStart(8, '0');
            },

            /**
             * What a card carries in data.extensions[CARD_KEY]: the whole Workshop, which version the
             * card shows, and a fingerprint of the fields exactly as written. A lead's card also notes
             * which opening each greeting came from, in order, with a fingerprint of the greetings and
             * the examples.
             * @param {Object} ws
             * @param {string} pick
             * @param {{description: string, personality: string, scenario: string, ownScenario: boolean,
             *          openings?: string[], greetings?: string[], examples?: string}} written -
             *        ownScenario says the scenario is the Scenario section's, not the story's.
             */
            toCard(ws, pick, written, now = Date.now()) {
                const exported = {
                    pick, at: now, ownScenario: !!written.ownScenario,
                    check: this.cardCheck(written.description, written.personality, written.scenario)
                };
                if (Array.isArray(written.openings)) {
                    exported.openings = written.openings.slice();
                    exported.openingsCheck = this.cardCheck(...(written.greetings || []), written.examples || '');
                }
                return { format: 1, exported, workshop: this._copy(ws) };
            },

            /**
             * The Workshop a card carries, ready to put on the imported character, or null when there
             * is none that can be read. If the card's text was changed in another app since it was
             * written, that text wins: it becomes a new step on the variant in use, split by its
             * headings like any card, and everything before it stays in the history.
             * Greetings and examples changed elsewhere win the same way, in the openings they came from.
             * @param {Object} carried - data.extensions[CARD_KEY]
             * @param {{description: string, personality: string, scenario: string, greetings?: string[],
             *          examples?: string}} card - The fields as found; greetings are the first message, then the others.
             */
            fromCard(carried, card, now = Date.now()) {
                const ws = carried && carried.workshop;
                const readable = ws && ws.v === this.VERSION && Array.isArray(ws.commits) && Array.isArray(ws.variants) && ws.variants.length > 0
                    && ws.variants.every(v => v && v.state && Array.isArray(v.state.sections));
                if (!readable) return null;
                const copy = this._copy(ws);
                const exported = carried.exported || {};
                const ids = Array.isArray(exported.openings) ? exported.openings : null;
                const textSame = exported.check === this.cardCheck(card.description, card.personality, card.scenario);
                const openingsSame = !ids || !Array.isArray(card.greetings)
                    || exported.openingsCheck === this.cardCheck(...card.greetings, card.examples || '');
                if (textSame && openingsSame) return copy;

                let next = this.active(copy).state;
                if (!textSame) {
                    // Rolecraft adds the story's other characters below the description; they aren't this character.
                    const description = String(card.description || '').split('\n\n--- Other Characters ---\n')[0];
                    const split = this.splitCard(description);
                    const base = next;
                    next = {
                        ...base,
                        unsorted: [split.unsorted, String(card.personality || '').trim()].filter(Boolean).join('\n\n'),
                        sections: base.sections.map(s => {
                            if (s.target !== 'scenario') return { ...s, text: split.sections[s.id] || '' };
                            return exported.ownScenario ? { ...s, text: String(card.scenario || '').trim() } : s;
                        })
                    };
                }
                if (!openingsSame) {
                    const openings = { ...(next.openings || {}) };
                    ids.forEach((id, i) => {
                        if (!id || typeof card.greetings[i] !== 'string') return;
                        const name = (openings[id] || {}).name;
                        openings[id] = name ? { name, message: card.greetings[i].trim() } : { message: card.greetings[i].trim() };
                    });
                    next = { ...next, openings, examples: this.examplesFromCard(card.examples || '') };
                }
                return this.commit(copy, next, { origin: 'card', summary: 'Changed outside Rolecraft', now });
            },

            // A story's openings are the first message of each new chat, with the example dialogue
            // that comes before it. They belong to the story, so the Workshop keeps only its own
            // text for them, by each opening's id in the story, and writes that text into the story.

            /**
             * Whose Workshop holds the story's openings: whoever speaks the first one, or else the
             * story's first character who isn't you or the narrator.
             * @returns {string|null} A character id.
             */
            leadOf(characters, scenarios) {
                const cast = (Array.isArray(characters) ? characters : []).filter(c => c && !c.is_user && !c.is_narrator);
                const first = Array.isArray(scenarios) ? scenarios[0] : null;
                const speaker = first && first.opening_character_id ? cast.find(c => c.id === first.opening_character_id) : null;
                return (speaker || cast[0] || {}).id || null;
            },

            /**
             * Card wording, {{char}} and {{user}}, as the story keeps it: the character's own name, the
             * way card import writes openings, and {user}. Not {character}: in a chat that means
             * whoever speaks the message, and a story's narrator can speak its opening.
             * @param {string} [name] - The lead's name. Without one, {{char}} becomes {character}.
             */
            storyText(text, name) {
                return String(text || '').replace(/\{\{char\}\}/gi, name || '{character}').replace(/\{\{user\}\}/gi, '{user}');
            },

            /** The story's {character} and {user} as card wording. Card wording already there is left as it is. */
            cardText(text) {
                // Card wording is matched first, so the {user} inside {{user}} is never touched.
                return String(text || '').replace(/\{\{(?:char|user)\}\}|\{character\}|\{user\}/gi,
                    m => (m.startsWith('{{') ? m : (/character/i.test(m) ? '{{char}}' : '{{user}}')));
            },

            /** Example dialogue as turns in card wording: each runs from "{{user}}:" or "{{char}}:" to the next one. */
            exampleLines(text) {
                const lines = [];
                const source = String(text || '').replace(/<START>/gi, '');
                for (const match of source.matchAll(/(\{\{user\}\}|\{\{char\}\}):([\s\S]*?)(?=\{\{user\}\}:|\{\{char\}\}:|$)/gi)) {
                    const content = match[2].trim();
                    if (content) lines.push({ who: /user/i.test(match[1]) ? 'user' : 'char', text: content });
                }
                return lines;
            },

            /** Example dialogue as the hidden chat turns a story keeps, in the story's wording. */
            turnsFromExamples(text, leadId, userId, at = Date.now(), leadName = '') {
                return this.exampleLines(text).map(line => ({
                    character_id: line.who === 'user' ? userId : leadId, content: this.storyText(line.text, leadName),
                    type: 'chat', isHidden: true, timestamp: new Date(at).toISOString()
                }));
            },

            /** A story's example turns as lines of card wording. The lead speaks as {{char}}; anyone else as {{user}}. */
            examplesFromTurns(turns, leadId) {
                return (Array.isArray(turns) ? turns : [])
                    .filter(t => t && typeof t.content === 'string' && t.content.trim())
                    .map(t => `${t.character_id === leadId ? '{{char}}' : '{{user}}'}: ${this.cardText(t.content.trim())}`)
                    .join('\n');
            },

            /** A card's example block, however it is laid out, as the Workshop's lines. */
            examplesFromCard(text) {
                return this.exampleLines(text).map(line => `{{${line.who}}}: ${line.text}`).join('\n');
            },

            /** The examples a story has: those of its first opening that has any, as lines. */
            storyExamples(scenarios, leadId) {
                const first = (Array.isArray(scenarios) ? scenarios : []).find(sc => sc && Array.isArray(sc.example_dialogue) && sc.example_dialogue.length);
                return first ? this.examplesFromTurns(first.example_dialogue, leadId) : '';
            },

            /**
             * Keeps the story's own text for an opening, the first time the Workshop changes it, for
             * exporting the original card and for variants made from before the change.
             */
            keepOriginalOpening(ws, scenario) {
                const kept = (ws.original && ws.original.openings) || {};
                if (!scenario || kept[scenario.id]) return ws;
                const opening = { name: scenario.name || '', message: this.cardText(scenario.message || '') };
                return { ...ws, original: { ...(ws.original || {}), openings: { ...kept, [scenario.id]: opening } } };
            },

            keepOriginalExamples(ws, text) {
                const original = ws.original || {};
                if (original.examples !== undefined && original.examples !== null) return ws;
                return { ...ws, original: { ...original, examples: String(text || '') } };
            },

            /** An opening in a version of the character: its own text, or else the story's from before the Workshop changed it. */
            openingIn(state, original, scenario) {
                const own = ((state && state.openings) || {})[scenario.id];
                const kept = ((original && original.openings) || {})[scenario.id];
                const from = own || kept;
                return {
                    name: (from && from.name) || scenario.name || '',
                    message: from ? String(from.message || '') : this.cardText(scenario.message || '')
                };
            },

            /** The examples in a version of the character, or null when they are the story's own. */
            examplesIn(state, original) {
                if (state && state.examples !== undefined && state.examples !== null) return state.examples;
                if (original && original.examples !== undefined && original.examples !== null) return original.examples;
                return null;
            },

            /**
             * The story's openings with the variant in use written into them: each one's name and
             * message, and the example turns in every opening, the way import fills them. Nothing
             * else about an opening changes, an opening the Workshop never changed keeps its text, and
             * text for an opening that is gone from the story is left out.
             * @param {{leadId: string, leadName: string, userId: string}} who - The lead, by id and name, and you.
             * @returns {{scenarios: Object[], changed: boolean}} The openings passed in, when nothing changed.
             */
            syncStory(scenarios, ws, { leadId, leadName, userId }, at = Date.now()) {
                const list = Array.isArray(scenarios) ? scenarios : [];
                const state = this.active(ws).state;
                const original = ws.original || {};
                const examples = this.examplesIn(state, original);
                const turns = examples === null ? null : this.turnsFromExamples(examples, leadId, userId, at, leadName);
                const wanted = turns && this.examplesFromTurns(turns, leadId);
                let changed = false;
                const out = list.map(sc => {
                    let next = sc;
                    const own = (state.openings || {})[sc.id] || (original.openings || {})[sc.id];
                    if (own) {
                        const name = own.name || sc.name;
                        const message = this.storyText(own.message || '', leadName);
                        if (name !== sc.name || message !== sc.message) next = { ...next, name, message };
                    }
                    if (turns && this.examplesFromTurns(sc.example_dialogue || [], leadId) !== wanted) {
                        next = { ...next, example_dialogue: this._copy(turns) };
                    }
                    if (next !== sc) changed = true;
                    return next;
                });
                return { scenarios: changed ? out : list, changed };
            },

            /**
             * A lead's card: each opening's message in the version picked, in the story's order, and
             * its examples, null when they are the story's own.
             * @param {string} pick - 'current', 'original', a variant id or a commit id.
             * @returns {{ids: string[], greetings: string[], examples: string|null}|null} Null for a version that isn't there.
             */
            cardOpenings(ws, pick = 'current', scenarios = []) {
                const original = ws.original || {};
                let state = null;
                if (pick !== 'original') {
                    const variant = ws.variants.find(v => v.id === pick);
                    state = pick === 'current' ? this.active(ws).state : (variant ? variant.state : this.stateAt(ws, pick));
                    if (!state) return null;
                }
                const list = (Array.isArray(scenarios) ? scenarios : []).filter(Boolean);
                return {
                    ids: list.map(sc => sc.id),
                    greetings: list.map(sc => this.openingIn(state, original, sc).message),
                    examples: this.examplesIn(state, original)
                };
            },

            /** The Workshop with each old opening id swapped for a new one everywhere, its history included. */
            renameOpenings(ws, map) {
                let json = JSON.stringify(ws);
                for (const [from, to] of Object.entries(map || {})) {
                    if (!from || !to || from === to) continue;
                    json = json.split(JSON.stringify(from)).join(JSON.stringify(to));
                }
                return JSON.parse(json);
            },

            // Card import used to paste the example dialogue into the character's instructions as well
            // as making it hidden turns in each opening, so replies read it twice.
            EXAMPLE_COPY: /(^|\n\n)### Example Dialogue\n[\s\S]*?(?=\n### |$)/,

            hasExampleCopy(text) {
                return this.EXAMPLE_COPY.test(String(text || ''));
            },

            /** The instructions without that copy, and with everything else as it was. */
            withoutExampleCopy(text) {
                const source = String(text || '');
                const match = source.match(this.EXAMPLE_COPY);
                if (!match) return source;
                const rest = source.slice(0, match.index) + source.slice(match.index + match[0].length);
                return match.index === 0 ? rest.replace(/^\n+/, '') : rest;
            },

            /**
             * Splits a card's description by its headings, without any AI. A heading the Workshop
             * knows sends its text to that section. Text before the first heading, and text under a
             * heading it does not know (kept with its heading), stays unsorted, word for word.
             * @param {string} text
             * @returns {{sections: Object<string, string>, unsorted: string}}
             */
            splitCard(text) {
                const lookup = new Map();
                for (const [id, names] of Object.entries(this.HEADINGS)) names.forEach(name => lookup.set(name, id));
                const sections = {};
                const unsorted = [];
                let block = { id: null, heading: null, lines: [] };
                const finish = () => {
                    const body = block.lines.join('\n').trim();
                    if (block.id) {
                        if (body) sections[block.id] = sections[block.id] ? `${sections[block.id]}\n\n${body}` : body;
                    } else {
                        const kept = [block.heading, body].filter(Boolean).join('\n').trim();
                        if (kept) unsorted.push(kept);
                    }
                };
                for (const line of String(text || '').split(/\r?\n/)) {
                    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
                    if (heading) {
                        finish();
                        const name = heading[1].replace(/[*_:]+/g, '').trim().toLowerCase();
                        block = { id: lookup.get(name) || null, heading: line.trim(), lines: [] };
                    } else {
                        block.lines.push(line);
                    }
                }
                finish();
                return { sections, unsorted: unsorted.join('\n\n') };
            },

            /**
             * The pin check for one section: each kept pin is found, with its place, or missing. A
             * pin counts as found where the model said it landed or, failing that, where its own
             * words appear. An empty section has nothing to check yet.
             * @returns {{landed: Array<{id: string, start: number, end: number}>, missing: string[]}}
             */
            checkPins(section) {
                const text = String(section.text || '');
                const kept = (section.pins || []).filter(p => p.state === 'kept');
                if (!text.trim() || kept.length === 0) return { landed: [], missing: [] };
                const map = section.pinMap || {};
                const landed = [];
                const missing = [];
                for (const pin of kept) {
                    const where = this.locate(text, map[pin.id]) || this.locate(text, pin.text);
                    if (where) landed.push({ id: pin.id, start: where[0], end: where[1] });
                    else missing.push(pin.id);
                }
                return { landed, missing };
            },

            /**
             * Which pins really made it into a section. The model says which phrase carries each pin;
             * this checks the phrase is in the text and gives its place, for the highlights.
             * @param {string} text
             * @param {Object<string, string>} pinMap - Pin id to the phrase the model said carries it.
             * @param {string[]} [pinIds] - Every pin that should be there. One the model never placed is missing.
             * @returns {{landed: Array<{id: string, start: number, end: number}>, missing: string[]}}
             */
            verifyPins(text, pinMap = {}, pinIds = Object.keys(pinMap || {})) {
                const landed = [];
                const missing = [];
                for (const id of pinIds) {
                    const where = this.locate(text, (pinMap || {})[id]);
                    if (where) landed.push({ id, start: where[0], end: where[1] });
                    else missing.push(id);
                }
                return { landed, missing };
            },

            /**
             * Where a phrase sits in a text, as [start, end). Case, spacing, curly or straight quotes,
             * dash styles and "..." against "…" are all ignored, along with punctuation at either end
             * of the phrase, because models quote their own words loosely.
             */
            locate(text, phrase) {
                const find = String(phrase || '').trim().replace(/^[\s"'“”‘’.,;:!?]+|[\s"'“”‘’.,;:!?]+$/g, '');
                if (!text || !find) return null;
                const exact = text.indexOf(find);
                if (exact !== -1) return [exact, exact + find.length];
                const t = this._loose(text);
                const f = this._loose(find);
                const i = t.text.indexOf(f.text);
                if (!f.text || i === -1) return null;
                return [t.at[i], t.at[i + f.text.length - 1] + 1];
            },

            /** The text in a loose form for matching, with where each of its characters came from. */
            _loose(s) {
                const out = [];
                const at = [];
                let space = false;
                for (let i = 0; i < s.length; i++) {
                    let c = s[i];
                    if (/\s/.test(c)) {
                        if (space) continue;
                        c = ' ';
                        space = true;
                    } else {
                        space = false;
                        if ('‘’‚‛′'.includes(c)) c = "'";
                        else if ('“”„‟″'.includes(c)) c = '"';
                        else if ('‐‑‒–—―'.includes(c)) c = '-';
                        else if (c === '…') c = '...';
                        c = c.toLowerCase();
                    }
                    for (const piece of c) {
                        out.push(piece);
                        at.push(i);
                    }
                }
                return { text: out.join(''), at };
            },

            _apply(state, changes) {
                let { concept, notes, unsorted } = state;
                let openings = this._copy(state.openings || {});
                let examples = state.examples ?? null;
                let notebook = this._copy(state.notebook || []);
                const sections = state.sections.slice();
                for (const ch of changes) {
                    if (ch.section === '_concept') concept = ch.after;
                    else if (ch.section === '_notes') notes = ch.after;
                    else if (ch.section === '_unsorted') unsorted = ch.after;
                    else if (ch.section === '_openings') openings = this._copy(ch.after || {});
                    else if (ch.section === '_examples') examples = ch.after ?? null;
                    else if (ch.section === '_notebook') notebook = this._copy(ch.after || []);
                    else {
                        const i = sections.findIndex(s => s.id === ch.section);
                        if (ch.after === null) {
                            if (i !== -1) sections.splice(i, 1);
                        } else if (i === -1) {
                            sections.push(this._copy(ch.after));
                        } else {
                            sections[i] = this._copy(ch.after);
                        }
                    }
                }
                return { concept, notes, unsorted: unsorted || '', openings, examples, notebook, sections };
            },

            /**
             * A copy of next where each section that differs from the current one carries the time,
             * and each one that does not keeps its old time, so a time alone is never a change.
             */
            _stamp(current, next, now) {
                const before = new Map(current.sections.map(s => [s.id, s]));
                return {
                    concept: next.concept || '',
                    notes: next.notes || '',
                    unsorted: next.unsorted || '',
                    openings: this._copy(next.openings || {}),
                    examples: next.examples ?? null,
                    notebook: this._copy(next.notebook || []),
                    sections: next.sections.map(s => {
                        const copy = this._copy(s);
                        const old = before.get(s.id);
                        copy.at = (old && this._same({ ...old, at: 0 }, { ...copy, at: 0 })) ? old.at : now;
                        return copy;
                    })
                };
            },

            _copy(value) {
                return value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
            },

            /** Same content, whatever order the keys were written in. */
            _same(a, b) {
                return this._canon(a) === this._canon(b);
            },

            _canon(value) {
                if (Array.isArray(value)) return `[${value.map(v => this._canon(v)).join(',')}]`;
                if (value && typeof value === 'object') {
                    return `{${Object.keys(value).filter(k => value[k] !== undefined).sort()
                        .map(k => `${JSON.stringify(k)}:${this._canon(value[k])}`).join(',')}}`;
                }
                return JSON.stringify(value === undefined ? null : value);
            }
        };
