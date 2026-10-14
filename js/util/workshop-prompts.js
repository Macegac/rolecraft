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

            /**
             * The whole character as the model reads it before every task: name, concept, notes, card
             * text not sorted yet, and every section with its kept pins and text. Proposals waiting
             * for an answer count as written, so "Write all" builds each section on the ones before.
             */
            sheet(name, state, pending = {}) {
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
                    const pins = s.pins.filter(p => p.state === 'kept').map(p => `"${p.text}"`);
                    lines.push(`## ${s.title}${s.locked ? ' [LOCKED: keep word for word]' : ''}`);
                    if (pins.length) lines.push(`Pins: ${pins.join('; ')}`);
                    lines.push(text || '(empty)', '');
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

            _messages(name, state, pending, task) {
                return [
                    { role: 'system', content: this.SYSTEM },
                    { role: 'user', content: `${this.sheet(name, state, pending)}\n\n${task.filter(Boolean).join('\n\n')}` }
                ];
            },

            /**
             * Write a section, or re-weave it: rewrite it around a changed set of pins, keeping
             * whatever still fits.
             * @returns {{messages: Array, temperature: undefined, read: Function}} read gives {text, pinMap}.
             */
            writeSection({ name, state, sectionId, pending = {}, reweave = false }) {
                const s = state.sections.find(x => x.id === sectionId);
                const pins = this.labels(s);
                const task = [
                    reweave
                        ? `TASK: Re-weave the "${s.title}" section. Its pins have changed. Rewrite it around the pins below, keeping every sentence of the current text that still fits. Change only what bringing the pins in, or dropping what now contradicts them, requires.`
                        : `TASK: Write the "${s.title}" section${String(s.text || '').trim() ? ', replacing its current text' : ''}.`,
                    `Length: ${this.LENGTHS[s.length] || this.LENGTHS.medium}.`,
                    pins.length ? `It must carry every one of these pins:\n${this._pinLines(pins)}` : 'It has no pins yet. Follow the concept, the story notes and the other sections.',
                    `Reply with JSON: {"text": "the section's text", "pins": {${this._pinShape(pins)}}}`
                ];
                return {
                    messages: this._messages(name, state, pending, task),
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
            takes({ name, state, sectionId, avoid = [], creativity = 3, pending = {} }) {
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
                    messages: this._messages(name, state, pending, task),
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
            suggestPins({ name, state, sectionIds }) {
                const sections = state.sections.filter(s => sectionIds.includes(s.id));
                const task = [
                    'TASK: Suggest pins for the sections listed below, which are still empty. A pin is one short must-have idea, at most 12 words, that the author might want in that section: specific, vivid and true to the concept. Suggest 2 to 4 for each section, different from each other and from the pins the character already has.',
                    `Sections: ${sections.map(s => `${s.id} ("${s.title}")`).join(', ')}`,
                    `Reply with JSON: {"pins": {${sections.map(s => `"${s.id}": ["a pin", "another pin"]`).join(', ')}}}`
                ];
                return {
                    messages: this._messages(name, state, {}, task),
                    temperature: undefined,
                    read: data => this.readSuggestions(data, sections)
                };
            },

            readSuggestions(data, sections) {
                const raw = (data && data.pins && typeof data.pins === 'object') ? data.pins : {};
                const out = {};
                for (const s of sections) {
                    const have = new Set(s.pins.map(p => p.text.trim().toLowerCase()));
                    const seen = new Set();
                    const pins = (Array.isArray(raw[s.id]) ? raw[s.id] : [])
                        .filter(t => typeof t === 'string' && t.trim())
                        .map(t => t.trim().slice(0, 160))
                        .filter(t => {
                            const key = t.toLowerCase();
                            if (have.has(key) || seen.has(key)) return false;
                            seen.add(key);
                            return true;
                        })
                        .slice(0, 4);
                    if (pins.length) out[s.id] = pins;
                }
                if (Object.keys(out).length === 0) throw new Error('The model suggested no pins. Try again.');
                return out;
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
