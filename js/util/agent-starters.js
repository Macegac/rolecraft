        /**
         * AgentStarters
         * The starter agents every library begins with. All arrive switched off; the user turns on
         * the ones they want. Each carries a stable key (source.app 'rolecraft-starter', source.id) so
         * later versions can add new starters without bringing back ones the user deleted.
         *
         * Written for Rolecraft. Do not paste SillyBunny agent text in here: SillyBunny is AGPL, and
         * bundling its prompts would put this Apache-2.0 app under that license.
         */
        const AgentStarters = {
            /**
             * @returns {Object[]} normalized agents without ids
             */
            list() {
                const starter = (key, fields) => AgentSchema.normalize({
                    ...fields,
                    author: 'Rolecraft',
                    defaultOn: false,
                    source: { app: 'rolecraft-starter', id: key }
                });

                return [
                    starter('slow-warmth', {
                        name: 'Slow Warmth',
                        description: 'Characters keep their pride and warm up over time instead of agreeing with everything',
                        kind: 'note',
                        prompt: [
                            "{{char}} does not warm to people quickly. Trust, affection and agreement are earned over time, not handed out because {{user}} was pleasant once.",
                            "Let {{char}} hold their own opinions, protect their pride, push back, change the subject or say no when that is what they would really do.",
                            "Keep reactions in proportion: guarded is not the same as hostile. When {{char}} does soften, show it in small, specific ways rather than sudden declarations."
                        ].join('\n'),
                        placement: { position: 'chat', depth: 4, role: 'system', order: 100 }
                    }),

                    starter('your-character', {
                        name: 'Your Character Is Yours',
                        description: "Never writes your dialogue, actions or feelings",
                        kind: 'note',
                        prompt: [
                            "Write only for {{char}} and any side characters. Never write {{user}}'s dialogue, actions, thoughts or feelings, and never decide how {{user}} reacts.",
                            "End the response at a point where {{user}} can choose what to do next."
                        ].join('\n'),
                        placement: { position: 'chat', depth: 2, role: 'system', order: 90 }
                    }),

                    starter('plain-prose', {
                        name: 'Plain, Vivid Prose',
                        description: 'Concrete writing without stock phrases and AI tics',
                        kind: 'note',
                        prompt: [
                            "Write clean, concrete prose. Prefer specific sensory detail and plain verbs over ornate description.",
                            "Avoid stock phrases and AI habits: shivers down spines, breaths nobody knew they were holding, eyes sparkling with mischief, air thick with tension, and closing on a rhetorical question.",
                            "Vary sentence length. Don't name an emotion the scene already shows. Don't reuse imagery or phrasing from your recent responses."
                        ].join('\n'),
                        placement: { position: 'chat', depth: 4, role: 'system', order: 110 }
                    }),

                    starter('scene-tracker', {
                        name: 'Scene Tracker',
                        description: 'Keeps where, when, who is here and what they are wearing straight',
                        kind: 'helper',
                        prompt: [
                            "Keep a short record of the current scene so details stay consistent. Start from your previous record, change only what the latest messages changed, and keep the rest.",
                            "",
                            "Use exactly this layout:",
                            "**Where:** the location and anything notable about it",
                            "**When:** time of day, and how much time has passed",
                            "**Who is here:** each character present, with what they are wearing and holding",
                            "**Positions:** where each person is and what they are doing",
                            "**Mood:** the emotional temperature of the scene",
                            "",
                            "Keep each line short. Record only what the story established; never invent details."
                        ].join('\n'),
                        placement: { position: 'chat', depth: 4, role: 'system', order: 120 },
                        helper: { run: 'auto', contextMessages: 6, includeCharacters: true, priorNotes: 1, display: 'panel', feedForward: true, feedCount: 1 }
                    }),

                    starter('relationship-lens', {
                        name: 'Relationship Lens',
                        description: 'How the main characters feel about each other, and what shifted',
                        kind: 'helper',
                        prompt: [
                            "Track how the important characters currently feel about each other. Start from your previous notes and update only what shifted in the latest messages.",
                            "",
                            "One line for each pair that matters:",
                            "**A → B:** trust (low / some / high), warmth (cold / neutral / warm), what changed and why, and what A might do next.",
                            "",
                            "Base everything on what happened in the story. Relationships change slowly: nobody goes from strangers to devoted in one scene."
                        ].join('\n'),
                        placement: { position: 'chat', depth: 4, role: 'system', order: 130 },
                        helper: { run: 'auto', contextMessages: 10, includeCharacters: true, priorNotes: 1, display: 'panel', feedForward: false }
                    }),

                    starter('loose-threads', {
                        name: 'Loose Threads',
                        description: 'Secrets, promises and unanswered questions the story set up',
                        kind: 'helper',
                        prompt: [
                            "Keep a running list of what is still unresolved in the story. Start from your previous list: add new items, mark anything resolved as (done) once, then drop it the next time.",
                            "",
                            "**Secrets:** who knows something that someone else doesn't",
                            "**Promises & plans:** what someone committed to or intends to do",
                            "**Open questions:** mysteries, setups and hooks not yet paid off",
                            "",
                            "One short line per item. Only what the story established."
                        ].join('\n'),
                        placement: { position: 'chat', depth: 6, role: 'system', order: 140 },
                        helper: { run: 'auto', contextMessages: 12, includeCharacters: false, priorNotes: 1, display: 'panel', feedForward: true, feedCount: 1 }
                    }),

                    starter('conditions', {
                        name: 'Conditions',
                        description: 'Injuries, exhaustion and other lasting states for each character',
                        kind: 'helper',
                        prompt: [
                            "Track lasting physical and mental conditions for each character: injuries, exhaustion, hunger, illness, intoxication, and strong feelings that linger.",
                            "Start from your previous list: add new conditions, update ones that changed, and remove ones that have clearly ended.",
                            "",
                            "One line each: **Name:** condition (mild / serious / severe), and its cause.",
                            "If nobody has a lasting condition, reply with just: No lasting conditions."
                        ].join('\n'),
                        placement: { position: 'chat', depth: 4, role: 'system', order: 150 },
                        helper: { run: 'auto', contextMessages: 8, includeCharacters: false, priorNotes: 1, display: 'panel', feedForward: true, feedCount: 1 }
                    }),

                    starter('continuity-check', {
                        name: 'Continuity Check',
                        description: 'Flags contradictions and forgotten details in the latest reply',
                        kind: 'helper',
                        prompt: [
                            "Check the latest reply against the recent conversation and note anything that doesn't line up: contradictions, forgotten injuries or items, characters acting in a scene they already left, and setups or promises that were dropped.",
                            "",
                            "Use 2 to 5 short bullets. If everything is consistent, reply with just: Continuity looks consistent."
                        ].join('\n'),
                        placement: { position: 'chat', depth: 4, role: 'system', order: 160 },
                        helper: { run: 'auto', contextMessages: 12, includeCharacters: true, priorNotes: 0, display: 'panel', feedForward: false }
                    }),

                    starter('plot-compass', {
                        name: 'Plot Compass',
                        description: 'Suggests where the story could go next when you press Run now',
                        kind: 'helper',
                        prompt: [
                            "Help steer the story. Read where it is now and suggest where it could go.",
                            "",
                            "**Where things stand:** one line.",
                            "**Three directions:** three numbered, clearly different ways the next scenes could develop, one sentence each, built on what the story already set up.",
                            "**A next move for {{user}}:** one concrete thing {{user}} could do.",
                            "",
                            "Don't write the story itself."
                        ].join('\n'),
                        placement: { position: 'chat', depth: 4, role: 'system', order: 170 },
                        helper: { run: 'manual', contextMessages: 16, includeCharacters: true, priorNotes: 0, display: 'panel', feedForward: false }
                    }),

                    starter('voice-holds', {
                        name: 'Voice Holds',
                        description: 'Keeps a character sounding like themselves when a scene turns intense',
                        kind: 'note',
                        prompt: [
                            "Whatever {{char}} does with words - deflect, joke, understate, give orders, go quiet - they keep doing it here. Heat changes their tempo and their breathing, never who they are.",
                            "Their vocabulary does not upgrade. A plain speaker stays plain and never reaches for poetry; a crude one stays crude; a formal one stays formal even while coming apart.",
                            "What {{char}} will not say stays unsaid. Pride, embarrassment, manners and habit still hold. Wanting something does not make them able to ask for it.",
                            "Show the state in breath, in pauses, in a dropped word or an unfinished sentence. The words themselves stay theirs."
                        ].join('\n'),
                        placement: { position: 'chat', depth: 4, role: 'system', order: 130 }
                    }),

                    starter('something-slips', {
                        name: 'Something Slips',
                        description: 'Sometimes their guard fails once, in a different way each time. Pair with Voice Holds',
                        kind: 'note',
                        prompt: [
                            "This reply, {{char}}'s guard fails exactly once. One thing gets out that they did not choose to let out: {{random::a word or a name they did not mean to use::an admission truer than they meant to give::a reaction their body shows before they can arrange it::a question they had not planned to ask::a silence they cannot cover::something asked for plainly, without their usual hedging::a sound they did not mean to make::an endearment they would never normally use}}.",
                            "One thing, not a change of character. Everything else about them holds.",
                            "{{char}} registers that it happened. They may cover it, laugh it off, push straight past it or pretend it did not - whatever that person would do - but they never explain it, apologise for it, or say what it meant.",
                            "Do not refer back to it in later replies unless {{user}} does first."
                        ].join('\n'),
                        // A fifth of replies. The roll is taken fresh each turn, and the {{random}}
                        // list is expanded at the same moment, so the slip is a different kind of
                        // slip each time it lands rather than the same beat on repeat.
                        trigger: { probability: 20 },
                        placement: { position: 'chat', depth: 4, role: 'system', order: 131 }
                    })
                ];
            }
        };
