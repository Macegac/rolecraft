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

            newId(prefix) {
                return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
            },

            /** A character with no concept, no notes and every section empty. */
            blankState() {
                return {
                    concept: '',
                    notes: '',
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
                const changes = [
                    { section: '_concept', before: null, after: state.concept || '' },
                    { section: '_notes', before: null, after: state.notes || '' },
                    ...state.sections.map(s => ({ section: s.id, before: null, after: this._copy(s) }))
                ];
                return {
                    v: this.VERSION,
                    active: 'v_main',
                    original: { description: original.description || '', scenario: original.scenario || '' },
                    variants: [{ id: 'v_main', name: 'Main', head: commitId, at: now, state: { concept: state.concept || '', notes: state.notes || '', sections: this._copy(state.sections) } }],
                    commits: [{ id: commitId, parent: null, variant: 'v_main', at: now, origin, summary, changes }],
                    avoid: {}
                };
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
                return path.reduce((state, c) => this._apply(state, c.changes), { concept: '', notes: '', sections: [] });
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
                return { ...ws, active: variantId, variants: [...ws.variants, variant] };
            },

            switchVariant(ws, variantId) {
                return ws.variants.some(v => v.id === variantId) ? { ...ws, active: variantId } : ws;
            },

            /**
             * The description every reply reads: each section with words in it, under its heading.
             * Scenario is left out; it goes to the card's scenario field instead.
             */
            compile(state) {
                return state.sections
                    .filter(s => s.target === 'description' && String(s.text || '').trim())
                    .map(s => `## ${s.title}\n${s.text.trim()}`)
                    .join('\n\n');
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
                let { concept, notes } = state;
                const sections = state.sections.slice();
                for (const ch of changes) {
                    if (ch.section === '_concept') concept = ch.after;
                    else if (ch.section === '_notes') notes = ch.after;
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
                return { concept, notes, sections };
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
