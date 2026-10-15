        /**
         * =================================================================================================
         * [SEC:JS:UTIL:COWRITER]
         * CowriterPrompts
         * What the Workshop's co-writer reads before every reply, and how a reply is read back: its
         * words, the cards it proposes, and a question with choices. Pure, like WorkshopPrompts, whose
         * sheet of the character it builds on. Tested in test.js.
         * =================================================================================================
         */
        const CowriterPrompts = {

            /**
             * How much of each part one request carries. A chat's last 30 messages go to a local
             * model, which has less room; OpenRouter's models read the last 100, so a long
             * interview keeps its early answers in view.
             */
            LIMITS: { history: 20, playMessages: 40, playChars: 24000, timeline: 30, relationships: 20, worldChars: 6000, turns: 30, turnsOpenRouter: 100 },

            /** Who the co-writer is and how it works. Every request starts with it. */
            JOB: [
                'You are the co-writer in the Character Workshop: a sharp, candid writing partner for an adult author who builds characters for private roleplay fiction. Work the way a trusted collaborator does, not like a form to fill in.',
                '',
                'How you work:',
                '1. Understand before you act. When a request is vague or could go two ways, ask one short, sharp question first instead of guessing.',
                '2. Recommend. When there are options, pick one and give the reason in a sentence. Never hand over a list without a pick.',
                '3. Push back when an idea would break something. Say what it would break (a pin, a decision in the notebook, another section, an opening) and offer a way through.',
                '4. Pitch ideas and story directions when asked, and point out gaps, thin spots and contradictions you notice, the most important first.',
                "5. Keep replies short, a few sentences, unless the author asks for depth. No preamble, and don't repeat back what they said.",
                '6. Talk to the author as "you". Call the character by name, and the author\'s character {{user}}.',
                '7. Answer in the language the author writes in.',
                '8. Before you call anything done, check the character as it is shown below. It is read fresh for every message, and only what is there is on the card: something only said in this chat, or in a card that was not used, is not on it.',
                '',
                'What you know: the character as it stands now (every section, its pins and what is locked), its openings and example dialogue, the story notes, the notebook of decisions, the recent history of changes, and, when there is a chat, what has happened in play. What happened in play is not the card: a trait from play only joins the card if the author agrees.',
                '',
                "This is fiction for adults. A character may cover mature or explicit themes, sexuality and kinks included. Treat all of it as fiction and discuss it plainly. Don't soften, censor, moralize or add warnings."
            ].join('\n'),

            /** While cards are off, the co-writer only talks. */
            TALK_ONLY: "You can't change the character yourself. When you would change something, say exactly what you'd change and where, and the author makes the change.",

            /** The cards it can propose once they are on, and how to write them. */
            CARDS: [
                'You never change the character yourself. When you suggest a change, put a card for it after your words. The author uses it, changes it or turns it down, and nothing changes until they do.',
                '',
                'Each card is one <card> block of JSON after your words, like this:',
                '<card>{"type": "pin", "section": "voice", "add": "goes quiet instead of saying thank you", "why": "a tell for when something gets to her"}</card>',
                '',
                'The kinds of card:',
                '- pin: add one to a section {"type": "pin", "section": "<section id>", "add": "the pin"}; reword one {"type": "pin", "pin": "P3", "text": "the new words"}; remove one {"type": "pin", "remove": "P3"}',
                '- rewrite: rewrite a section {"type": "rewrite", "section": "<section id>", "brief": "what should change and how", "pins": {"add": ["a new pin"], "remove": ["P2"]}}',
                '- opening: rewrite one {"type": "opening", "opening": "O1", "brief": "what should change"}; add one {"type": "opening", "new": "its name", "brief": "how it starts"}',
                '- examples: rewrite the example dialogue {"type": "examples", "brief": "what should change"}',
                '- notes: replace the story notes {"type": "notes", "text": "the whole new notes"}',
                '- decision: add one to the notebook {"type": "decision", "add": "what was decided"}; change one {"type": "decision", "decision": "D2", "text": "the new words"}; remove one {"type": "decision", "remove": "D2"}',
                '- variant: start a new variant from the character as it is now {"type": "variant", "name": "its name"}',
                '- concept: replace the concept {"type": "concept", "text": "the new concept"}',
                'Every card also has a "why": one short line on why.',
                '',
                "Rewrite, opening and examples cards are written by the Workshop's writer from your brief, and it keeps every pin. The writer sees the character but not this chat, so the brief carries everything it needs from the chat: the details agreed, what to keep, what to drop. Say what the text should do; don't write the text yourself.",
                '',
                'Rules for cards:',
                '- One card per change. A rewrite can carry pin changes for its own section.',
                '- To put what was agreed in this chat onto the card, send a card for each part it touches: a rewrite for each section, and opening, examples, notes, concept and decision cards as needed.',
                '- Point at pins, openings and decisions by their labels (P3, O1, D2), and at sections by their ids.',
                '- Card text uses {{char}} and {{user}}, never a literal name.',
                '- When something is decided, add a decision card with its why, so later chats know.',
                '- When you suggest rewriting something, check the openings and the example dialogue, and add a card for any that would clash.',
                "- Locked sections are final: don't propose rewriting them.",
                "- Don't bring back a card the author turned down unless they ask."
            ].join('\n'),

            /** Questions with choices, which work with cards on or off. */
            ASK: [
                'To ask the author something with a few clear answers, end your reply with one <ask> block of JSON. They tap a choice or type their own:',
                '<ask>{"question": "What finally gets through to her?", "options": ["Patience, no pushing", "A promise kept", "Seeing {{user}} hurt"]}</ask>',
                'Two to five short options, and one question at a time. When the author asks you to interview them, ask one question at a time this way, and build on each answer.'
            ].join('\n'),

            /**
             * Short labels the co-writer can point at: P1, P2… for every pin in section order,
             * suggested ones included; O1… for the openings; D1… for the notebook's decisions.
             * @returns {{byLabel: Object<string, {kind: string, id: string, section?: string}>, pinLabel: Object<string, string>, sections: string[]}}
             */
            labels(state, extras = null) {
                const byLabel = {};
                const pinLabel = {};
                let n = 0;
                for (const s of state.sections) {
                    for (const p of s.pins || []) {
                        n += 1;
                        byLabel[`P${n}`] = { kind: 'pin', id: p.id, section: s.id };
                        pinLabel[p.id] = `P${n}`;
                    }
                }
                ((extras && extras.openings) || []).forEach((o, i) => { byLabel[o.label || `O${i + 1}`] = { kind: 'opening', id: o.id }; });
                (state.notebook || []).forEach((d, i) => { byLabel[`D${i + 1}`] = { kind: 'decision', id: d.id }; });
                return { byLabel, pinLabel, sections: state.sections.map(s => s.id) };
            },

            /**
             * One request to the co-writer, built fresh for every message: the job and everything it
             * reads in one system message, the parts that change least first, then this chat's turns.
             * @param {Object} opts
             * @param {string} opts.name - The character's name.
             * @param {Object} opts.state - The variant in use.
             * @param {Object} [opts.extras] - The lead's openings and examples, as WorkshopPrompts.sheet takes them.
             * @param {{active: string, others: string[]}} [opts.variants] - Variant names.
             * @param {Array<{at: number, origin: string, summary: string}>} [opts.history] - Steps, newest first.
             * @param {Object} [opts.play] - From playFrom: the open chat, or null.
             * @param {{messages: Array}} [opts.chat] - The chat being talked in.
             * @param {Object<string, Object>} [opts.cards] - Every card, by id.
             * @param {boolean} [opts.withCards] - Whether the co-writer may propose cards.
             * @param {number} [opts.turns] - How many of the chat's last messages it reads.
             * @returns {{messages: Array<{role: string, content: string}>, labels: Object}}
             */
            request({ name, state, extras = null, variants = {}, history = [], play = null, chat = null, cards = {}, withCards = false, turns = this.LIMITS.turns }) {
                const labels = this.labels(state, extras);
                const job = [this.JOB, withCards ? this.CARDS : this.TALK_ONLY, this.ASK].join('\n\n');
                const context = this.context({ name, state, extras, variants, history, play, labels });
                return {
                    messages: [{ role: 'system', content: `${job}\n\n${context}` }, ...this._turns(chat, cards, state, extras, turns)],
                    labels
                };
            },

            /** Everything the co-writer reads, as one block of text. */
            context({ name, state, extras = null, variants = {}, history = [], play = null, labels }) {
                const others = (variants.others || []).filter(Boolean);
                const notebook = state.notebook || [];
                const steps = (history || []).slice(0, this.LIMITS.history);
                const parts = [
                    `VARIANT IN USE: ${variants.active || 'Main'}${others.length ? ` (other variants: ${others.join(', ')})` : ''}`,
                    WorkshopPrompts.sheet(name, state, {}, extras, { pinLabels: labels.pinLabel }),
                    ['NOTEBOOK (what was decided, and why):', ...(notebook.length
                        ? notebook.map((d, i) => `D${i + 1}. ${d.text}${d.why ? ` Why: ${d.why}` : ''}`)
                        : ['(empty)'])].join('\n')
                ];
                if (steps.length) parts.push(['RECENT HISTORY (newest first):', ...steps.map(c => `- ${this._day(c.at)} · ${c.origin || 'you'} · ${c.summary || 'a change'}`)].join('\n'));
                const inPlay = this._play(play);
                if (inPlay) parts.push(inPlay);
                return parts.join('\n\n');
            },

            _day(at) {
                return Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : 'earlier';
            },

            /** What has happened in the open chat, each part inside its budget. */
            _play(play) {
                if (!play) return '';
                const limits = this.LIMITS;
                const lines = ['WHAT HAS HAPPENED IN PLAY (the open chat; this is not the card):'];
                const timeline = (play.timeline || []).slice(-limits.timeline);
                if (timeline.length) lines.push('TIMELINE:', ...timeline.map(t => `- ${t}`));
                const relationships = (play.relationships || []).slice(0, limits.relationships);
                if (relationships.length) lines.push('RELATIONSHIPS:', ...relationships.map(r => `- ${r}`));
                const world = this._world(play.world || []);
                if (world) lines.push('WORLD KNOWLEDGE:', world);
                const recent = this._recent(play.messages || []);
                if (recent.lines.length) {
                    lines.push('RECENT MESSAGES (oldest first):');
                    if (recent.skipped) lines.push(`(${recent.skipped} earlier messages not shown)`);
                    lines.push(...recent.lines);
                }
                return lines.length > 1 ? lines.join('\n') : '';
            },

            /** World Knowledge entries in order, until the next one would pass its budget. */
            _world(entries) {
                const blocks = [];
                let used = 0;
                for (const entry of entries) {
                    const block = `### ${entry.title}\n${entry.content}`;
                    if (used + block.length > this.LIMITS.worldChars) {
                        if (blocks.length === 0) blocks.push(`${block.slice(0, this.LIMITS.worldChars)}…`);
                        blocks.push('(more World Knowledge not shown)');
                        break;
                    }
                    blocks.push(block);
                    used += block.length;
                }
                return blocks.join('\n\n');
            },

            /** The newest messages that fit, at most 40 and about 24,000 characters, oldest first. */
            _recent(messages) {
                const lines = [];
                let used = 0;
                for (let i = messages.length - 1; i >= 0 && lines.length < this.LIMITS.playMessages; i--) {
                    const line = `${messages[i].who}: ${messages[i].text}`;
                    if (used + line.length + 1 > this.LIMITS.playChars) {
                        if (lines.length === 0) lines.unshift(`${line.slice(0, this.LIMITS.playChars - 1)}…`);
                        break;
                    }
                    lines.unshift(line);
                    used += line.length + 1;
                }
                return { lines, skipped: messages.length - lines.length };
            },

            /**
             * This chat's last turns. Each reply ends with what became of its cards, and of its
             * question, so the co-writer knows what was used and what was turned down; a second
             * opinion is added to the reply it answered. Messages in a row from one side (after a
             * delete, or a failed reply) go as one turn, since some backends refuse two in a row.
             */
            _turns(chat, cards, state, extras, limit = this.LIMITS.turns) {
                const turns = [];
                const add = (role, content) => {
                    const last = turns[turns.length - 1];
                    if (last && last.role === role) last.content += `\n\n${content}`;
                    else turns.push({ role, content });
                };
                for (const m of ((chat && chat.messages) || []).slice(-limit)) {
                    if (m.role === 'you') {
                        add('user', String(m.text || ''));
                        continue;
                    }
                    if (m.role === 'second') {
                        add('assistant', `[A second opinion from another model: ${String(m.text || '').trim()}]`);
                        continue;
                    }
                    const notes = [];
                    const made = (m.cards || []).map(id => (cards || {})[id]).filter(Boolean);
                    if (made.length) notes.push(`Your cards: ${made.map(c => `${this._cardLine(c, state, extras)} (${this._outcome(c)})`).join('; ')}`);
                    if (m.ask && m.ask.question) notes.push(`You asked: ${m.ask.question} (${(m.ask.options || []).join(' / ')})`);
                    if (m.stopped) notes.push('The author stopped this reply part way.');
                    add('assistant', [String(m.text || '').trim(), ...notes.map(n => `[${n}]`)].filter(Boolean).join('\n\n'));
                }
                return turns;
            },

            /** A card in a few words. */
            _cardLine(card, state, extras) {
                const title = id => ((state.sections || []).find(s => s.id === id) || {}).title || id;
                const opening = id => (((extras && extras.openings) || []).find(o => o.id === id) || {}).name || 'an opening';
                switch (card.type) {
                    case 'pin':
                        if (card.action === 'add') return `new pin on ${title(card.section)}: "${card.text}"`;
                        return card.action === 'reword' ? `reword a pin on ${title(card.section)} to "${card.text}"` : `remove a pin from ${title(card.section)}`;
                    case 'rewrite': return `rewrite ${title(card.section)}: ${card.brief}`;
                    case 'opening': return card.opening ? `rewrite the opening "${opening(card.opening)}": ${card.brief}` : `new opening "${card.name}": ${card.brief}`;
                    case 'examples': return `rewrite the example dialogue: ${card.brief}`;
                    case 'notes': return 'new story notes';
                    case 'decision':
                        if (card.action === 'add') return `new decision: "${card.text}"`;
                        return card.action === 'change' ? `change a decision to "${card.text}"` : 'remove a decision';
                    case 'variant': return `new variant "${card.name}"`;
                    case 'concept': return 'new concept';
                    default: return 'a card';
                }
            },

            _outcome(card) {
                const said = { used: 'used', 'turned-down': 'turned down', stopped: 'not written yet' }[card.status] || 'not answered yet';
                if (card.note) return `${said}, after the author asked for: ${card.note}`;
                return card.edited ? `${said}, after the author changed its words` : said;
            },

            /**
             * What has happened in the open chat, from its state: the messages anyone can see, by
             * name, without thinking or placeholders; the timeline; the relationship lines that name
             * this character; and World Knowledge.
             * @returns {{messages: Array<{who: string, text: string}>, timeline: string[], relationships: string[], world: Array<{title: string, content: string}>}|null}
             */
            playFrom(chatState, { characters = [], leadId = null } = {}) {
                if (!chatState) return null;
                const cast = Array.isArray(characters) ? characters : [];
                const people = new Map(cast.map(c => [c.id, c]));
                const user = cast.find(c => c.is_user);
                const userName = (user && user.name) || 'You';
                const leadName = (people.get(leadId) || {}).name || '';
                const messages = (Array.isArray(chatState.chat_history) ? chatState.chat_history : [])
                    .filter(m => m && m.type === 'chat' && !m.isHidden && typeof m.content === 'string')
                    .map(m => {
                        const speaker = people.get(m.character_id);
                        const who = speaker ? speaker.name : (m.character_id === 'user' ? userName : 'Someone');
                        const text = this._stripThinking(m.content)
                            .replace(/\{\{char\}\}/gi, leadName || who).replace(/\{\{user\}\}/gi, userName)
                            .replace(/\{character\}/g, who).replace(/\{user\}/g, userName)
                            .trim();
                        return { who, text };
                    })
                    .filter(m => m.text);
                const full = leadName.toLowerCase();
                const first = full.split(/\s+/)[0];
                const namesLead = line => !full || line.toLowerCase().includes(full) || (!!first && line.toLowerCase().includes(first));
                return {
                    messages,
                    timeline: (Array.isArray(chatState.narrative_timeline) ? chatState.narrative_timeline : []).map(String).filter(t => t.trim()),
                    relationships: (Array.isArray(chatState.relationship_matrix) ? chatState.relationship_matrix : []).map(String).filter(namesLead),
                    world: (Array.isArray(chatState.static_entries) ? chatState.static_entries : [])
                        .filter(e => e && String(e.content || '').trim())
                        .map(e => ({ title: String(e.title || 'Untitled'), content: String(e.content).trim() }))
                };
            },

            _stripThinking(text) {
                return String(text || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
            },

            /**
             * Reads a reply: the words, every card it can make sense of (labels turned back into ids,
             * a card repeated word for word kept once), and at most one question. A block it can't
             * read, or one the reply was cut off inside, comes back with the reason, to be shown.
             * @returns {{prose: string, cards: Object[], ask: {question: string, options: string[], multi: boolean}|null,
             *            unreadable: Array<{raw: string, reason: string}>}}
             */
            readReply(text, labels) {
                const cards = [];
                const unreadable = [];
                const seen = new Set();
                let ask = null;
                let rest = String(text || '').replace(/<(card|ask)>([\s\S]*?)<\/\1>/gi, (whole, tag, body) => {
                    const raw = whole.trim();
                    const data = this._json(body);
                    if (!data) {
                        unreadable.push({ raw, reason: 'It is not JSON.' });
                        return '';
                    }
                    if (tag.toLowerCase() === 'ask') {
                        const question = this.readAsk(data);
                        if (!question) unreadable.push({ raw, reason: 'A question needs its words and two or more choices.' });
                        else if (ask) unreadable.push({ raw, reason: 'Only one question at a time.' });
                        else ask = question;
                        return '';
                    }
                    const card = this.readCard(data, labels);
                    if (card.error) {
                        unreadable.push({ raw, reason: card.error });
                        return '';
                    }
                    const key = JSON.stringify(card);
                    if (!seen.has(key)) {
                        seen.add(key);
                        cards.push(card);
                    }
                    return '';
                });
                const open = rest.search(/<(card|ask)>/i);
                if (open !== -1) {
                    unreadable.push({ raw: rest.slice(open).trim(), reason: 'The reply was cut off before this was finished.' });
                    rest = rest.slice(0, open);
                }
                const prose = rest.split('\n').map(line => line.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
                return { prose, cards, ask, unreadable };
            },

            /** One card, checked and with its labels turned into ids, or {error} saying what is wrong with it. */
            readCard(data, labels) {
                const why = String(data.why || '').trim();
                const text = typeof data.text === 'string' ? data.text.trim() : '';
                const brief = typeof data.brief === 'string' ? data.brief.trim() : '';
                const find = (value, kind) => {
                    const label = String(value || '').trim().toUpperCase();
                    const found = labels.byLabel[label];
                    return found && found.kind === kind ? found : null;
                };
                const section = id => (labels.sections.includes(id) ? id : null);
                switch (String(data.type || '').trim().toLowerCase()) {
                    case 'pin': {
                        if (typeof data.add === 'string' && data.add.trim()) {
                            if (!section(data.section)) return { error: `There is no section "${data.section}".` };
                            return { type: 'pin', action: 'add', section: data.section, text: data.add.trim(), why };
                        }
                        const label = data.remove || data.pin;
                        const pin = find(label, 'pin');
                        if (!pin) return { error: `There is no pin ${String(label || '').trim().toUpperCase() || 'named'}.` };
                        if (data.remove) return { type: 'pin', action: 'remove', section: pin.section, pin: pin.id, why };
                        if (!text) return { error: 'A pin card adds, rewords or removes a pin.' };
                        return { type: 'pin', action: 'reword', section: pin.section, pin: pin.id, text, why };
                    }
                    case 'rewrite': {
                        if (!section(data.section)) return { error: `There is no section "${data.section}".` };
                        if (!brief) return { error: 'A rewrite needs a brief.' };
                        const pins = (data.pins && typeof data.pins === 'object') ? data.pins : {};
                        const addPins = (Array.isArray(pins.add) ? pins.add : []).filter(p => typeof p === 'string' && p.trim()).map(p => p.trim());
                        const removePins = (Array.isArray(pins.remove) ? pins.remove : []).map(p => find(p, 'pin'))
                            .filter(p => p && p.section === data.section).map(p => p.id);
                        return { type: 'rewrite', section: data.section, brief, addPins, removePins, why };
                    }
                    case 'opening': {
                        if (!brief) return { error: 'An opening card needs a brief.' };
                        if (typeof data.new === 'string' && data.new.trim()) return { type: 'opening', opening: null, name: data.new.trim(), brief, why };
                        const opening = find(data.opening, 'opening');
                        if (!opening) return { error: `There is no opening ${String(data.opening || '').trim().toUpperCase() || 'named'}.` };
                        return { type: 'opening', opening: opening.id, brief, why };
                    }
                    case 'examples':
                        return brief ? { type: 'examples', brief, why } : { error: 'An examples card needs a brief.' };
                    case 'notes':
                        return text ? { type: 'notes', text, why } : { error: 'A notes card needs the new notes.' };
                    case 'decision': {
                        if (typeof data.add === 'string' && data.add.trim()) return { type: 'decision', action: 'add', text: data.add.trim(), why };
                        const label = data.remove || data.decision;
                        const decision = find(label, 'decision');
                        if (!decision) return { error: `There is no decision ${String(label || '').trim().toUpperCase() || 'named'}.` };
                        if (data.remove) return { type: 'decision', action: 'remove', decision: decision.id, why };
                        if (!text) return { error: 'A decision card adds, changes or removes a decision.' };
                        return { type: 'decision', action: 'change', decision: decision.id, text, why };
                    }
                    case 'variant': {
                        const name = typeof data.name === 'string' ? data.name.trim() : '';
                        return name ? { type: 'variant', name, why } : { error: 'A variant card needs a name.' };
                    }
                    case 'concept':
                        return text ? { type: 'concept', text, why } : { error: 'A concept card needs the new concept.' };
                    default:
                        return { error: `There is no card type "${data.type}".` };
                }
            },

            /** A question with two to six different choices, or null. */
            readAsk(data) {
                const question = String((data && data.question) || '').trim();
                const options = [];
                for (const option of (data && Array.isArray(data.options)) ? data.options : []) {
                    const text = typeof option === 'string' ? option.trim() : '';
                    if (text && !options.includes(text)) options.push(text);
                }
                if (!question || options.length < 2) return null;
                return { question, options: options.slice(0, 6), multi: !!data.multi };
            },

            /** The JSON object in a block, with code fences and anything around the braces ignored. */
            _json(body) {
                const text = String(body || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
                for (const attempt of [text, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]) {
                    if (!attempt) continue;
                    try {
                        const value = JSON.parse(attempt);
                        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
                    } catch (e) {
                        // Not this way; try the next.
                    }
                }
                return null;
            }
        };
