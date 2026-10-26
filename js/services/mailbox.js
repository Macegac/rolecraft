        /**
         * =================================================================================================
         * [SEC:JS:SRV:MAILBOX]
         * MailboxService
         * Sends what happens in a session to the mailbox on the user's PC (tools/mailbox.js), so it
         * can be read there without copying anything off the phone: every AI request in full, each
         * reply with its thinking, what was sent, the helper agents, and errors. Diagnostics hands it
         * each event from the same watchers that fill the problem report.
         *
         * Nothing waits on the phone: while the PC can't be reached, events are skipped. Keys are
         * scrubbed the way the problem report scrubs them. Set up by opening Rolecraft with
         * #mailbox=<address>&key=<key>, and switched off and on in Settings → Appearance.
         * =================================================================================================
         */
        const MailboxService = {
            // The browser's own fetch, taken before Diagnostics starts watching fetch, so the
            // mailbox's posts don't show up in the problem report or come back to the mailbox.
            _fetch: typeof fetch === 'function' ? fetch.bind(globalThis) : null,
            seq: 0,
            lastSent: 0,
            lastError: '',

            /** Where events go, and whether they go at all. */
            settings() {
                const gs = (typeof StateManager !== 'undefined' && StateManager.data && StateManager.data.globalSettings) || {};
                const url = String(gs.mailboxUrl || '').trim().replace(/\/+$/, '');
                const key = String(gs.mailboxKey || '').trim();
                return { on: !!gs.mailboxOn && !!url && !!key, url, key };
            },

            /** The address and key in a setup link's #mailbox=…&key=…, or null. */
            readLink(hash) {
                const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
                const url = String(params.get('mailbox') || '').trim().replace(/\/+$/, '');
                const key = String(params.get('key') || '').trim();
                if (!/^https:\/\/[^\s/]+$/.test(url) || key.length < 16) return null;
                return { url, key };
            },

            /**
             * At startup: a setup link saves the mailbox's address and key, switches sending on, and
             * leaves the address bar, so the key isn't left showing or bookmarked.
             * @returns {boolean} Whether there was one.
             */
            applyLink() {
                const link = this.readLink(location.hash);
                if (!link) return false;
                Object.assign(StateManager.data.globalSettings, { mailboxUrl: link.url, mailboxKey: link.key, mailboxOn: true });
                StateManager.saveGlobalSettings();
                if (typeof Diagnostics !== 'undefined') Diagnostics._secrets();
                history.replaceState(null, '', `${location.pathname}${location.search}`);
                UIManager.showNotification('Your RP now goes to the mailbox on your PC. Switch it off in Settings → Appearance.', 'success');
                this.send('setup', { device: navigator.userAgent });
                return true;
            },

            /** Which story and chat are open, for every event. */
            _context() {
                const library = (typeof StateManager !== 'undefined' && StateManager.getLibrary && StateManager.getLibrary()) || {};
                const story = (library.stories || []).find(s => s.id === library.active_story_id);
                return {
                    story: story ? story.name : '',
                    storyId: library.active_story_id || '',
                    chat: library.active_narrative_id || '',
                    build: typeof APP_BUILD_TIMESTAMP !== 'undefined' ? APP_BUILD_TIMESTAMP : ''
                };
            },

            /** One event as the mailbox keeps it: what it was, its number and time, and where it happened. */
            entry(kind, data, now = Date.now()) {
                this.seq += 1;
                return { kind, n: this.seq, at: new Date(now).toISOString(), ...this._context(), ...data };
            },

            /**
             * Sends one event, without waiting on it and without trying again: when the PC can't be
             * reached, the event is skipped and the reason kept for Settings.
             * @returns {Promise<boolean>} Whether the mailbox took it.
             */
            send(kind, data = {}) {
                const cfg = this.settings();
                if (!cfg.on || !this._fetch) return Promise.resolve(false);
                let body;
                try {
                    body = DiagLog.redact(JSON.stringify(this.entry(kind, data)));
                } catch (e) {
                    return Promise.resolve(false);
                }
                return this._fetch(`${cfg.url}/log`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Mailbox-Key': cfg.key },
                    body,
                    // Chrome asks before a public page may reach a device on a private network.
                    targetAddressSpace: 'local'
                }).then(res => {
                    if (res.ok) {
                        this.lastSent = Date.now();
                        this.lastError = '';
                    } else {
                        this.lastError = `The mailbox answered ${res.status}.`;
                    }
                    return !!res.ok;
                }).catch(err => {
                    this.lastError = `Couldn't reach the mailbox (${(err && err.message) || err}).`;
                    return false;
                });
            },

            /** A request's body with its long text cut to a length, since the AI event carries that text in full. */
            requestParams(body) {
                let data;
                try {
                    data = typeof body === 'string' ? JSON.parse(body) : body;
                } catch (e) {
                    return { body: `${String(body).length} characters, not JSON` };
                }
                return this._squeeze(data);
            },

            _squeeze(value, depth = 0) {
                if (typeof value === 'string') {
                    if (value.startsWith('data:')) return `[data, ${value.length} characters]`;
                    return value.length > 400 ? `[${value.length} characters]` : value;
                }
                if (Array.isArray(value)) return depth > 6 ? `[${value.length} items]` : value.map(v => this._squeeze(v, depth + 1));
                if (value && typeof value === 'object') {
                    if (depth > 6) return '[more]';
                    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this._squeeze(v, depth + 1)]));
                }
                return value;
            },

            /** Settings → Appearance: the switch, and what happened to the last event. */
            renderSettings() {
                const box = document.getElementById('mailbox-on');
                const status = document.getElementById('mailbox-status');
                const gs = (StateManager.data && StateManager.data.globalSettings) || {};
                const cfg = this.settings();
                if (box) {
                    box.checked = !!gs.mailboxOn;
                    box.disabled = !gs.mailboxUrl || !gs.mailboxKey;
                }
                if (!status) return;
                if (!gs.mailboxUrl || !gs.mailboxKey) status.textContent = 'Not set up. Open the setup link on this phone.';
                else if (!cfg.on) status.textContent = `Off. The mailbox is at ${cfg.url}.`;
                else if (this.lastError) status.textContent = `On, but the last send failed: ${this.lastError}`;
                else if (this.lastSent) status.textContent = `On. Last sent at ${new Date(this.lastSent).toLocaleTimeString()}.`;
                else status.textContent = `On. Sending to ${cfg.url}.`;
            },

            /** The switch in Settings. */
            setOn(on) {
                const gs = StateManager.data.globalSettings;
                gs.mailboxOn = !!on;
                StateManager.saveGlobalSettings();
                this.renderSettings();
            },

            /** Send a test, and say whether it arrived. */
            async test() {
                if (!this.settings().on) {
                    UIManager.showNotification('Switch on sending to your PC first.', 'info');
                    return;
                }
                const ok = await this.send('test', { device: navigator.userAgent });
                UIManager.showNotification(ok ? 'The test arrived in the mailbox on your PC.' : `The test didn't arrive. ${this.lastError}`, ok ? 'success' : 'error');
                this.renderSettings();
            }
        };
