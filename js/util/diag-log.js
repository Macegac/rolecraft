        /**
         * DiagLog
         * The problem-report diary: a short rolling record of what the app did over the last few
         * turns (taps, AI requests, agent runs, background jobs, warnings, crashes), which the user
         * can copy and paste into a bug report.
         *
         * Two rules from the research this was built on:
         *   - Secrets never enter the diary. Every line is scrubbed when it is written, not when the
         *     report is copied.
         *   - Story text (messages, replies, notes) is kept apart from each event and only appears in
         *     the report when the user switches it on.
         *
         * Pure apart from Date.now(): unit tested in test.js.
         */
        const DiagLog = {
            entries: [],
            turn: 0,
            keepTurns: 5,
            maxEntries: 600,
            maxText: 4000,
            secrets: [],

            // Developer tracing to the browser console. Off by default: the prompts the app
            // builds run to tens of thousands of characters and carry the whole story, and the
            // console keeps every line it is handed for as long as the tab is open, which on a
            // phone costs memory for the entire session. Switched on in Settings → Appearance.
            verbose: false,

            /** console.log, but only when console tracing is switched on. */
            trace(...args) {
                if (this.verbose) console.log(...args);
            },

            /** console.groupCollapsed, paired with traceGroupEnd. */
            traceGroup(...args) {
                if (this.verbose) console.groupCollapsed(...args);
            },

            traceGroupEnd() {
                if (this.verbose) console.groupEnd();
            },

            /**
             * Values that must never appear in the diary, such as API keys from settings.
             * @param {string[]} values
             */
            setSecrets(values) {
                this.secrets = (values || []).filter(v => typeof v === 'string' && v.trim().length >= 8).map(v => v.trim());
            },

            /**
             * Removes anything that looks like a credential.
             * @param {*} value
             * @returns {string}
             */
            redact(value) {
                let s = typeof value === 'string' ? value : (() => {
                    try { return JSON.stringify(value); } catch (e) { return String(value); }
                })();
                if (s === undefined) s = String(value);
                for (const secret of this.secrets) {
                    if (secret && s.includes(secret)) s = s.split(secret).join('[key removed]');
                }
                return s
                    .replace(/sk-or-v1-[A-Za-z0-9]+/g, '[key removed]')
                    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[key removed]')
                    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, '[key removed]')
                    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[key removed]')
                    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[key removed]')
                    .replace(/([?&](?:key|api_key|apikey|token|access_token)=)[^&\s"']+/gi, '$1[key removed]');
            },

            _clip(s, max) {
                return s.length > max ? s.slice(0, max) + `… (${s.length - max} more characters)` : s;
            },

            /** Marks the start of a new turn and drops turns older than the last `keepTurns`. */
            beginTurn() {
                this.turn++;
                const oldest = this.turn - this.keepTurns + 1;
                this.entries = this.entries.filter(e => e.turn >= oldest);
            },

            /**
             * Adds one event.
             * @param {string} kind - tap, send, reply, ai, agent, job, undo, warn, error, crash, info
             * @param {string} message - What happened, without story text.
             * @param {{text?: string, textLabel?: string}} [extra] - Story text kept apart from the message.
             */
            add(kind, message, extra = {}) {
                const entry = {
                    t: Date.now(),
                    turn: this.turn,
                    kind: String(kind),
                    message: this._clip(this.redact(message), 600)
                };
                if (extra.text !== undefined && extra.text !== null && extra.text !== '') {
                    entry.textLabel = extra.textLabel || 'text';
                    entry.text = this._clip(this.redact(extra.text), this.maxText);
                }
                this.entries.push(entry);
                if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
            },

            clear() {
                this.entries = [];
            },

            _time(t) {
                const d = new Date(t);
                const pad = (n, w = 2) => String(n).padStart(w, '0');
                return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
            },

            /**
             * The report as plain text, ready to paste.
             * @param {Object<string, string>} facts - App and settings facts for the header (already safe).
             * @param {boolean} includeText - Whether story text is included.
             * @returns {string}
             */
            format(facts, includeText) {
                const lines = ['ROLECRAFT PROBLEM REPORT', ''];
                Object.entries(facts || {}).forEach(([k, v]) => lines.push(`${k}: ${this.redact(v)}`));
                lines.push(`Story text: ${includeText ? 'included' : 'not included'}`);
                lines.push(`Events: ${this.entries.length} (last ${this.keepTurns} turns)`, '');

                let currentTurn = null;
                for (const e of this.entries) {
                    if (e.turn !== currentTurn) {
                        currentTurn = e.turn;
                        lines.push(`--- turn ${e.turn} ---`);
                    }
                    lines.push(`${this._time(e.t)} [${e.kind}] ${e.message}`);
                    if (includeText && e.text) {
                        lines.push(`    ${e.textLabel}: ${e.text.replace(/\n/g, '\n    ')}`);
                    }
                }
                if (!this.entries.length) lines.push('(nothing recorded yet)');
                return lines.join('\n');
            }
        };
