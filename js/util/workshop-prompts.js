        /**
         * =================================================================================================
         * [SEC:JS:UTIL:WSPROMPTS]
         * WorkshopPrompts
         * What the Character Workshop asks its model, and how the answers are read back. Pure: each
         * builder returns { messages, temperature, read }. read(json) checks the answer's shape and
         * turns the pin labels the model saw (P1, P2...) back into pin ids. Tested in test.js.
         * =================================================================================================
         */
        const WorkshopPrompts = {

            /** What short, medium and long mean, in words the model can aim at. */
            LENGTHS: {
                short: 'about 60 to 120 words',
                medium: 'about 150 to 250 words',
                long: 'about 300 to 450 words'
            },

            /** The creativity dial for Takes, as a temperature and as the same request in words. */
            CREATIVITY: [
                { temperature: 0.6, words: 'Stay close to the plainest reading of the pins and the concept.' },
                { temperature: 0.8, words: 'Take a few liberties, but keep it grounded.' },
                { temperature: 1.0, words: 'Be inventive: surprising, specific details that still fit the character.' },
                { temperature: 1.15, words: 'Be bold: unusual angles and fresh details nobody would expect.' },
                { temperature: 1.3, words: 'Go as far as you can: the strangest takes that still honour every pin.' }
            ],

            SYSTEM: [
                'You are the writing partner inside the Character Workshop. You help an adult author build a character card for their private roleplay fiction, one section at a time.',
                '',
                'Rules:',
                '1. This is fiction for adults. A card may cover mature or explicit themes, sexuality and kinks included. Treat all of it as fiction and write it fully and frankly. Do not soften, censor, moralize or add warnings.',
                "2. Call the character {{char}} and the user's character {{user}}. Never write a literal name for either of them.",
                "3. Pins are the author's must-haves. Every pin given for a section must come through clearly in that section, woven into the prose in your own words, never as a list.",
                '4. Invent freely beyond the pins, but never contradict a pin, the concept, the story notes or another section.',
                '5. Text marked LOCKED is final. Never change it; write around it.',
                "6. Keep each section to what its title says, and don't repeat what other sections already cover.",
                '7. Write in third person, in the vivid, concrete style of a character card, with no headings inside a section.',
                '8. Reply with JSON only, in exactly the shape asked for.'
            ].join('\n'),

            /** What an opening is, for every request that writes one. */
            OPENING_RULES: "An opening is not a card section. It is the first message of a new roleplay chat, written from {{char}}'s side: what {{char}} does and says as the scene starts, in the same style as the other openings and the example dialogue, narration and dialogue together. Set the scene from the Scenario section and the story notes when they give one. Never write what {{user}} does, says, thinks or feels, and end where {{user}} can answer.",

            /**
             * The whole character as the model reads it before every task: name, concept, notes, card
             * text not sorted yet, and every section with its kept pins and text. Proposals waiting
             * for an answer count as written, so "Write all" builds each section on the ones before.
             * For the story's lead, extras adds the openings, labelled O1, O2…, and the example dialogue.
             * The co-writer also reads each section's id, and every pin by a label it can point at.
             * @param {{openings?: Array<{id: string, label: string, name: string, message: string}>, examples?: string|null}} [extras]
             * @param {{pinLabels?: Object<string, string>}} [view] - Pin id to label, for every pin, suggested ones included.
             */
            sheet(name, state, pending = {}, extras = null, view = {}) {
                const lines = [
                    `CHARACTER: ${String(name || '').trim() || 'unnamed'} (always written as {{char}})`,
                    `CONCEPT: ${String(state.concept || '').trim() || '(none yet)'}`
                ];
                if (String(state.notes || '').trim()) lines.push(`STORY NOTES: ${state.notes.trim()}`);
                if (String(state.unsorted || '').trim()) lines.push(`FROM THE OLD CARD, NOT SORTED INTO SECTIONS YET:\n${state.unsorted.trim()}`);
                lines.push('', 'SECTIONS:');
                for (const s of state.sections) {
                    const proposal = pending[s.id];
                    const text = String((proposal && proposal.text) || s.text || '').trim();
                    const pins = view.pinLabels
                        ? s.pins.map(p => `${view.pinLabels[p.id]} "${p.text}"${p.state === 'kept' ? '' : ' (suggested, not kept yet)'}`)
                        : s.pins.filter(p => p.state === 'kept').map(p => `"${p.text}"`);
                    lines.push(`## ${s.title}${view.pinLabels ? ` [id: ${s.id}]` : ''}${s.locked ? ' [LOCKED: keep word for word]' : ''}`);
                    if (pins.length) lines.push(`Pins: ${pins.join('; ')}`);
                    lines.push(text || '(empty)', '');
                }
                const openings = (extras && Array.isArray(extras.openings)) ? extras.openings : [];
                if (openings.length) {
                    lines.push('OPENINGS (the first message of each new chat; they may be older than the sections, and the sections win):');
                    openings.forEach(o => lines.push(`${o.label} "${o.name}":`, String(o.message || '').trim() || '(empty)', ''));
                }
                if (extras && extras.examples !== undefined) {
                    lines.push('EXAMPLE DIALOGUE (how {{char}} talks, shown to the roleplay model before the chat):', String(extras.examples || '').trim() || '(none)');
                }
                return lines.join('\n').trim();
            },

            /** A section's kept pins with the short labels the model answers with. */
            labels(section) {
                return section.pins.filter(p => p.state === 'kept').map((p, i) => ({ label: `P${i + 1}`, id: p.id, text: p.text }));
            },

            _pinLines(pins) {
                return pins.map(p => `${p.label}: ${p.text}`).join('\n');
            },

            _pinShape(pins) {
                return pins.map(p => `"${p.label}": "the exact phrase from your text that carries it"`).join(', ');
            },

            _messages(name, state, pending, task, extras = null) {
                return [
                    { role: 'system', content: this.SYSTEM },
                    { role: 'user', content: `${this.sheet(name, state, pending, extras)}\n\n${task.filter(Boolean).join('\n\n')}` }
                ];
            },

            /**
             * Write a section, or re-weave it: rewrite it around a changed set of pins, keeping
             * whatever still fits.
             * @returns {{messages: Array, temperature: undefined, read: Function}} read gives {text, pinMap}.
             */
            writeSection({ name, state, sectionId, pending = {}, reweave = false, extras = null, steer = '' }) {
                const s = state.sections.find(x => x.id === sectionId);
                const pins = this.labels(s);
                const hasText = !!String(s.text || '').trim();
                let first = `TASK: Write the "${s.title}" section${hasText ? ', replacing its current text' : ''}.`;
                if (reweave) {
                    first = `TASK: Re-weave the "${s.title}" section. Its pins have changed. Rewrite it around the pins below, keeping every sentence of the current text that still fits. Change only what bringing the pins in, or dropping what now contradicts them, requires.`;
                } else if (steer && hasText) {
                    first = `TASK: Rewrite the "${s.title}" section as asked below, keeping whatever the request doesn't touch.`;
                }
                const task = [
                    first,
                    `Length: ${this.LENGTHS[s.length] || this.LENGTHS.medium}.`,
                    pins.length ? `It must carry every one of these pins:\n${this._pinLines(pins)}` : 'It has no pins yet. Follow the concept, the story notes and the other sections.',
                    // From the co-writer: what should change, and why, plus anything you added to it.
                    steer ? `What should change: ${steer}` : '',
                    `Reply with JSON: {"text": "the section's text", "pins": {${this._pinShape(pins)}}}`
                ];
                return {
                    messages: this._messages(name, state, pending, task, extras),
                    // Left to the model's own default: providers of one model disagree on what a given number means.
                    temperature: undefined,
                    read: data => this.readSection(data, pins)
                };
            },

            readSection(data, pins) {
                const text = (data && typeof data.text === 'string') ? data.text.trim() : '';
                if (!text) throw new Error('The model sent no text for the section. Try again.');
                return { text, pinMap: this._pinMap(data.pins, pins) };
            },

            /**
             * Three takes on a section that differ in angle, structure and opening line, steering
             * clear of the current text and of every take turned down before.
             * @returns {{messages: Array, temperature: number, read: Function}} read gives [{angle, text, pinMap}].
             */
            takes({ name, state, sectionId, avoid = [], creativity = 3, pending = {}, extras = null }) {
                const s = state.sections.find(x => x.id === sectionId);
                const pins = this.labels(s);
                const level = this.CREATIVITY[Math.min(5, Math.max(1, Math.round(creativity) || 3)) - 1];
                const task = [
                    `TASK: Write three takes on the "${s.title}" section. Make them really different from each other: a different angle, a different structure and a different opening line each, never rewordings of one idea.`,
                    String(s.text || '').trim() ? "Don't reuse the current text's angle, structure or opening line." : '',
                    avoid.length ? `The author turned these down before. Steer well clear of them:\n${avoid.map(a => `- ${a}`).join('\n')}` : '',
                    `Creativity: ${level.words}`,
                    `Length of each take: ${this.LENGTHS[s.length] || this.LENGTHS.medium}.`,
                    pins.length ? `Every take must carry every one of these pins:\n${this._pinLines(pins)}` : '',
                    `Reply with JSON: {"takes": [{"angle": "one line naming this take's angle", "text": "the take", "pins": {${this._pinShape(pins)}}}, and two more like it]}`
                ];
                return {
                    messages: this._messages(name, state, pending, task, extras),
                    temperature: level.temperature,
                    read: data => this.readTakes(data, pins)
                };
            },

            readTakes(data, pins) {
                const takes = (data && Array.isArray(data.takes) ? data.takes : [])
                    .filter(t => t && typeof t.text === 'string' && t.text.trim())
                    .slice(0, 3)
                    .map(t => ({ angle: String(t.angle || '').trim() || 'A different take', text: t.text.trim(), pinMap: this._pinMap(t.pins, pins) }));
                if (takes.length === 0) throw new Error('The model sent no takes. Try again.');
                return takes;
            },

            /**
             * Two to four suggested pins for each of the given sections, which are empty.
             * @returns {{messages: Array, temperature: undefined, read: Function}} read gives {sectionId: [pin text]}.
             */
            suggestPins({ name, state, sectionIds, extras = null }) {
                const sections = state.sections.filter(s => sectionIds.includes(s.id));
                const task = [
                    'TASK: Suggest pins for the sections listed below, which are still empty. A pin is one short must-have idea, at most 12 words, that the author might want in that section: specific, vivid and true to the concept. Suggest 2 to 4 for each section, different from each other and from the pins the character already has.',
                    `Sections: ${sections.map(s => `${s.id} ("${s.title}")`).join(', ')}`,
                    `Reply with JSON: {"pins": {${sections.map(s => `"${s.id}": ["a pin", "another pin"]`).join(', ')}}}`
                ];
                return {
                    messages: this._messages(name, state, {}, task, extras),
                    temperature: undefined,
                    read: data => this.readSuggestions(data, sections)
                };
            },

            readSuggestions(data, sections) {
                const raw = (data && data.pins && typeof data.pins === 'object') ? data.pins : {};
                const out = {};
                for (const s of sections) {
                    const pins = this._cleanPins(raw[s.id], s);
                    if (pins.length) out[s.id] = pins;
                }
                if (Object.keys(out).length === 0) throw new Error('The model suggested no pins. Try again.');
                return out;
            },

            /**
             * Sorts the card text that is not in a section yet into the sections, in the author's own
             * words, and drafts pins from what each section says. With nothing left to sort, it only
             * drafts the pins.
             * @returns {{messages: Array, temperature: undefined, read: Function}} read gives
             *          {sections: {id: moved text}, leftover, pins: {id: [pin]}, restored: number}.
             */
            sortCard({ name, state, extras = null }) {
                const open = state.sections.filter(s => !s.locked);
                const hasLoose = !!String(state.unsorted || '').trim();
                const task = [
                    hasLoose
                        ? "TASK: Sort the card. Part of this character is still one block, shown above under FROM THE OLD CARD. Move every sentence of it into the section it belongs to, keeping the author's exact words: move sentences, never rewrite, shorten or add to them. A sentence that fits no section goes in \"leftover\". Leave nothing out."
                        : 'TASK: Draft pins from the text the sections already have.',
                    'Pins: for each section that has text, 2 to 4 short must-have ideas (at most 12 words each) that its text clearly wants kept.',
                    `Sections you may use: ${open.map(s => `${s.id} ("${s.title}")`).join(', ')}`,
                    `Reply with JSON: {${hasLoose ? '"sections": {"<section id>": "the sentences moved there, in their original order"}, "leftover": "sentences that fit nowhere, or an empty string", ' : ''}"pins": {"<section id>": ["a pin", "another pin"]}}`
                ];
                return {
                    messages: this._messages(name, state, {}, task, extras),
                    temperature: undefined,
                    read: data => this.readSort(data, state)
                };
            },

            /** The opening an opening task is about, from the extras the sheet shows. */
            _opening(extras, openingId) {
                return ((extras && extras.openings) || []).find(o => o.id === openingId) || { label: 'O1', name: 'the opening', message: '' };
            },

            /**
             * Write one of the story's openings, or re-weave it to fit the character as it is now. With
             * `newName` instead of an opening, a new one: another way a chat can start.
             * @returns {{messages: Array, temperature: undefined, read: Function}} read gives {text}.
             */
            writeOpening({ name, state, extras, openingId, reweave = false, steer = '', newName = '' }) {
                const o = this._opening(extras, openingId);
                const hasText = !!String(o.message || '').trim();
                let first = `TASK: Write the opening "${o.name}" (${o.label})${hasText ? ', replacing its current text' : ''}.`;
                if (newName) first = `TASK: Write a new opening, "${newName}": another way a chat with {{char}} can start.`;
                else if (reweave) first = `TASK: Re-weave the opening "${o.name}" (${o.label}). Rewrite it to fit the character as the concept and the sections have it now, keeping whatever still fits.`;
                else if (steer && hasText) first = `TASK: Rewrite the opening "${o.name}" (${o.label}) as asked below, keeping whatever the request doesn't touch.`;
                const task = [
                    first,
                    this.OPENING_RULES,
                    `Length: ${this.LENGTHS.medium}${newName ? '' : ', unless the opening is much longer or shorter now'}.`,
                    steer ? `${newName ? 'What it should be' : 'What should change'}: ${steer}` : '',
                    'Reply with JSON: {"text": "the opening"}'
                ];
                return {
                    messages: this._messages(name, state, {}, task, extras),
                    temperature: undefined,
                    read: data => this.readText(data, 'opening')
                };
            },

            /**
             * Three openings to choose from, each a different way into the story, steering clear of the
             * current one and of every take turned down before.
             * @returns {{messages: Array, temperature: number, read: Function}} read gives [{angle, text, pinMap}].
             */
            openingTakes({ name, state, extras, openingId, avoid = [], creativity = 3 }) {
                const o = this._opening(extras, openingId);
                const level = this.CREATIVITY[Math.min(5, Math.max(1, Math.round(creativity) || 3)) - 1];
                const task = [
                    `TASK: Write three takes on the opening "${o.name}" (${o.label}). Make them really different from each other: a different moment, place or way into the scene each, never rewordings of one idea.`,
                    String(o.message || '').trim() ? "Don't reuse the current opening's moment or its first line." : '',
                    avoid.length ? `The author turned these down before. Steer well clear of them:\n${avoid.map(a => `- ${a}`).join('\n')}` : '',
                    this.OPENING_RULES,
                    `Creativity: ${level.words}`,
                    `Length of each take: ${this.LENGTHS.medium}.`,
                    'Reply with JSON: {"takes": [{"angle": "one line naming this take\'s angle", "text": "the opening"}, and two more like it]}'
                ];
                return {
                    messages: this._messages(name, state, {}, task, extras),
                    temperature: level.temperature,
                    read: data => this.readTakes(data, [])
                };
            },

            /**
             * Write the example dialogue that shows the roleplay model how the character talks, or
             * re-weave it to fit the character as it is now.
             * @returns {{messages: Array, temperature: undefined, read: Function}} read gives {text}.
             */
            writeExamples({ name, state, extras, reweave = false, steer = '' }) {
                const current = String((extras && extras.examples) || '').trim();
                let first = `TASK: Write the example dialogue${current ? ', replacing what is there' : ''}.`;
                if (reweave) first = 'TASK: Re-weave the example dialogue. Rewrite it to fit the character as it is now, keeping whatever still fits.';
                else if (steer && current) first = "TASK: Rewrite the example dialogue as asked below, keeping whatever the request doesn't touch.";
                const task = [
                    first,
                    'Example dialogue shows the roleplay model how {{char}} talks: two to four short exchanges between {{user}} and {{char}}, true to the Voice section and the rest of the character. Every turn starts with "{{user}}:" or "{{char}}:" at the start of a line. {{char}}\'s lines carry the voice; keep {{user}}\'s short. Actions can go between asterisks.',
                    steer ? `What should change: ${steer}` : '',
                    'Reply with JSON: {"text": "the dialogue, each turn on its own line"}'
                ];
                return {
                    messages: this._messages(name, state, {}, task, extras),
                    temperature: undefined,
                    read: data => this.readExamples(data)
                };
            },

            readText(data, what) {
                const text = (data && typeof data.text === 'string') ? data.text.trim() : '';
                if (!text) throw new Error(`The model sent no text for the ${what}. Try again.`);
                return { text };
            },

            readExamples(data) {
                const text = (data && typeof data.text === 'string') ? data.text.trim() : '';
                if (!/\{\{char\}\}:/i.test(text)) throw new Error('The model sent no dialogue with {{char}} speaking in it. Try again.');
                return { text };
            },

            /**
             * Reads a sorting. Nothing of the old card may be lost: any sentence of it that did not
             * land somewhere word for word (the model changed it or dropped it) goes back into the
             * leftover text as it was.
             */
            readSort(data, state) {
                const open = new Map(state.sections.filter(s => !s.locked).map(s => [s.id, s]));
                const sections = {};
                for (const [id, text] of Object.entries((data && data.sections && typeof data.sections === 'object') ? data.sections : {})) {
                    if (open.has(id) && typeof text === 'string' && text.trim()) sections[id] = text.trim();
                }
                let leftover = (data && typeof data.leftover === 'string') ? data.leftover.trim() : '';
                const placed = this._loose([...Object.values(sections), leftover].join('\n'));
                const lost = this.sentences(state.unsorted).filter(sentence => !placed.includes(this._loose(sentence)));
                if (lost.length) leftover = [leftover, ...lost].filter(Boolean).join(' ');

                const pins = {};
                for (const [id, list] of Object.entries((data && data.pins && typeof data.pins === 'object') ? data.pins : {})) {
                    if (!open.has(id)) continue;
                    const clean = this._cleanPins(list, open.get(id));
                    if (clean.length) pins[id] = clean;
                }
                if (Object.keys(sections).length === 0 && Object.keys(pins).length === 0) throw new Error('The model sorted nothing. Try again.');
                return { sections, leftover, pins, restored: lost.length };
            },

            /** A text cut into sentences and lines, for checking that each one survived. */
            sentences(text) {
                return String(text || '').replace(/([.!?…])\s+/g, '$1\n').split(/\n+/).map(s => s.trim()).filter(s => s.length > 1);
            },

            /** Pin ideas as given: trimmed, at most four, none repeated or already on the section, case ignored. */
            _cleanPins(list, section) {
                const seen = new Set(section.pins.map(p => p.text.trim().toLowerCase()));
                const out = [];
                for (const raw of Array.isArray(list) ? list : []) {
                    if (typeof raw !== 'string' || !raw.trim()) continue;
                    const text = raw.trim().slice(0, 160);
                    if (seen.has(text.toLowerCase())) continue;
                    seen.add(text.toLowerCase());
                    out.push(text);
                    if (out.length === 4) break;
                }
                return out;
            },

            /** Spacing, curly quotes and case ignored, for comparing the author's words with the model's copy. */
            _loose(text) {
                return String(text || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
            },

            /** The phrases the model said carry each pin, under the pins' real ids. */
            _pinMap(raw, pins) {
                const map = {};
                if (raw && typeof raw === 'object') {
                    for (const p of pins) {
                        const phrase = raw[p.label];
                        if (typeof phrase === 'string' && phrase.trim()) map[p.id] = phrase.trim();
                    }
                }
                return map;
            }
        };
