        /**
         * ProviderBlacklist
         * OpenRouter serves one model from many hosts ("providers") and keeps sending an account
         * back to whichever one answered last. When that one is having a bad stretch a redo cannot
         * get away from it. This is the list of providers the user has asked to avoid.
         *
         * An entry is temporary (it lifts by itself) or permanent (it stays until released). Nothing
         * in here makes an entry permanent on its own: only keep() does, and only the Settings
         * button calls it.
         *
         * Everything that takes a list is pure and unit tested in test.js. load() and save() are the
         * only parts that touch storage.
         */
        const ProviderBlacklist = {
            TEMP_MS: 12 * 60 * 60 * 1000,

            /** Entries still in force: permanent ones, and temporary ones that have not lifted yet. */
            active(list, now) {
                return (Array.isArray(list) ? list : []).filter(e =>
                    e && e.slug && (e.permanent || now - (e.addedAt || 0) < this.TEMP_MS));
            },

            /** What goes to OpenRouter as provider.ignore. */
            slugs(list, now) {
                return this.active(list, now).map(e => e.slug);
            },

            /**
             * Adds a temporary ban. Banning one that is already listed restarts its clock, unless it
             * is permanent, which stays permanent.
             */
            ban(list, provider, now) {
                const kept = this.active(list, now);
                const existing = kept.find(e => e.slug === provider.slug);
                if (existing) {
                    return kept.map(e => (e.slug === provider.slug && !e.permanent) ? { ...e, addedAt: now } : e);
                }
                return [...kept, { slug: provider.slug, name: provider.name || provider.slug, permanent: false, addedAt: now }];
            },

            keep(list, slug) {
                return (Array.isArray(list) ? list : []).map(e => e.slug === slug ? { ...e, permanent: true } : e);
            },

            release(list, slug) {
                return (Array.isArray(list) ? list : []).filter(e => e.slug !== slug);
            },

            hoursLeft(entry, now) {
                return Math.max(1, Math.ceil(((entry.addedAt || 0) + this.TEMP_MS - now) / 3600000));
            },

            _norm(text) {
                return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            },

            /** True when a provider name OpenRouter reported belongs to one of these entries. */
            matches(entries, reported) {
                const want = this._norm(reported);
                return !!want && (entries || []).some(e => this._norm(e.name) === want || this._norm(e.slug) === want);
            },

            /**
             * Turns the provider name OpenRouter reported into the slug its ignore list expects.
             * The two are not the same text ("OpenInference" is "open-inference", "Mancer 2" is
             * "mancer"), so the answer comes from OpenRouter's own list of who serves the model,
             * where each entry carries both. The slug is the part of `tag` before the slash; what
             * follows is a precision or region marker.
             * @param {string} reported - A display name or a slug.
             * @param {Array<{provider_name: string, tag: string}>} endpoints
             * @returns {{slug: string, name: string}|null}
             */
            resolveSlug(reported, endpoints) {
                const want = this._norm(reported);
                if (!want) return null;
                for (const e of (Array.isArray(endpoints) ? endpoints : [])) {
                    const slug = String((e && e.tag) || '').split('/')[0];
                    if (!slug) continue;
                    if (this._norm(e.provider_name) === want || this._norm(slug) === want) {
                        return { slug, name: e.provider_name || reported };
                    }
                }
                return null;
            },

            load() {
                const list = StateManager.data.globalSettings.provider_blacklist;
                return Array.isArray(list) ? list : [];
            },

            save(list) {
                StateManager.data.globalSettings.provider_blacklist = list;
                StateManager.saveGlobalSettings();
            }
        };
