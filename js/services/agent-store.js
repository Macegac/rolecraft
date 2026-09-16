        /**
         * AgentStore
         * The agent library: one shared list of agents kept in IndexedDB (store "agents") and
         * mirrored in memory so prompt building never waits on the database. Whether an agent is
         * on for a particular story lives on the story itself (story.agent_switches), not here.
         * Shapes and file formats are defined by AgentSchema.
         */
        const AgentStore = {
            agents: [],
            loaded: false,

            /**
             * Loads the library once at startup. Fails soft to an empty library, like the rest of
             * the app's storage.
             * @returns {Promise<void>}
             */
            async init() {
                try {
                    const rows = await DBService.getAllAgents();
                    this.agents = (rows || []).map(row => AgentSchema.normalize(row)).filter(a => a.id);
                } catch (e) {
                    console.warn('AgentStore: could not load agents.', e);
                    this.agents = [];
                }
                this.loaded = true;
            },

            /**
             * Every agent, sorted by order then name, the same order they run in.
             * @returns {Object[]}
             */
            list() {
                return [...this.agents].sort((a, b) =>
                    (a.placement.order - b.placement.order) || a.name.localeCompare(b.name));
            },

            get(id) {
                return this.agents.find(a => a.id === id) || null;
            },

            /**
             * Saves a new or edited agent and returns the stored copy.
             * @param {Object} agent
             * @returns {Promise<Object>}
             */
            async save(agent) {
                const now = Date.now();
                const clean = AgentSchema.normalize(agent);
                if (!clean.id) clean.id = UTILITY.uuid();
                const existing = this.get(clean.id);
                clean.created = existing ? (existing.created || now) : (clean.created || now);
                clean.updated = now;

                await DBService.saveAgent(clean);
                const index = this.agents.findIndex(a => a.id === clean.id);
                if (index === -1) this.agents.push(clean);
                else this.agents[index] = clean;
                return clean;
            },

            /**
             * Deletes an agent from the library. Story switches that point at it are left in place;
             * they are ignored once the agent is gone.
             * @param {string} id
             * @returns {Promise<void>}
             */
            async remove(id) {
                await DBService.deleteAgent(id);
                this.agents = this.agents.filter(a => a.id !== id);
            },

            /**
             * Imports every agent in a file. Each one gets a fresh id so importing the same file twice
             * gives two copies rather than silently overwriting edits.
             * @param {string} text - File contents.
             * @returns {Promise<{imported: Object[], notes: string[]}>}
             */
            async importText(text) {
                const { agents, notes } = AgentSchema.parseImport(text);
                const imported = [];
                for (const agent of agents) {
                    imported.push(await this.save({ ...agent, id: '' }));
                }
                return { imported, notes };
            },

            /**
             * The JSON text for an export file.
             * @param {string[]|null} ids - Agents to include; null exports the whole library.
             * @returns {string}
             */
            exportText(ids = null) {
                const chosen = ids ? this.list().filter(a => ids.includes(a.id)) : this.list();
                return JSON.stringify(AgentSchema.buildExport(chosen), null, 2);
            }
        };
