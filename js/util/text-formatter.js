        /**
         * =================================================================================================
         * [SEC:JS:UTIL:TXT]
         * TextFormatter Module
         * Regex-based post-processing for AI responses.
         * Enforces strict compliance with Prose or Roleplay styles.
         * =================================================================================================
         */
        const TextFormatter = {
            /**
            * Converts text to Prose format (Dialogue in quotes, Action plain).
            * Handles Deepseek artifacts like *(...)*.
            */
            /**
            * Converts text to Prose format (Dialogue in quotes, Action plain).
            * Handles artifacts like *(...)* or (*...*).
            */
            toProse(text) {
                if (!text) return "";
                // 0. Strip internal thinking blocks first
                let clean = UTILITY.stripThinking(text);

                // 1. Normalize artifacts: *(...) or (*...*) -> *...*
                clean = clean.replace(/\*\s*\(/g, '*').replace(/\)\s*\*/g, '*')

                    .replace(/\(\*/g, '*').replace(/\*\)/g, '*');

                // 2. Tokenize by Asterisks
                const segments = clean.split('*');

                // Heuristic: If it looks like Prose (has quotes, no stars), return as is
                if (segments.length === 1 && segments[0].includes('"')) return clean;

                const processed = segments.map((seg, i) => {
                    const isAction = (i % 2 === 1);
                    let content = seg.trim();
                    if (!content) return "";

                    if (isAction) {
                        return content;
                    } else {
                        if (content.startsWith('"') && content.endsWith('"')) return content;
                        return `"${content}"`;
                    }
                });

                return processed.filter(Boolean).join(' ');
            },

            /**
             * Converts text to Roleplay format (Dialogue plain, Action in stars).
             */
            toRoleplay(text) {
                if (!text) return "";

                // 0. Strip internal thinking blocks first
                let clean = UTILITY.stripThinking(text);

                // Normalize artifacts first
                clean = clean.replace(/\*\s*\(/g, '*').replace(/\)\s*\*/g, '*')

                    .replace(/\(\*/g, '*').replace(/\*\)/g, '*');

                // Tokenize by Quotes
                const segments = clean.split('"');

                // Heuristic: If it looks like RP (has stars, no quotes), return as is
                if (segments.length === 1 && segments[0].includes('*')) return clean;

                const processed = segments.map((seg, i) => {
                    const isDialogue = (i % 2 === 1);
                    let content = seg.trim();
                    if (!content) return "";

                    if (isDialogue) {
                        return content;
                    } else {
                        if (content.startsWith('*') && content.endsWith('*')) return content;
                        return `*${content}*`;
                    }
                });

                return processed.filter(Boolean).join(' ');
            },

            /**
             * Aggressively cleans formatting artifacts and removes name prefixes.
             */
            toStrictRoleplay(text, charName) {
                if (!text) return "";
                let clean = text.trim();

                // 1. Remove Name Prefix (e.g., "Char Name: " or "[Char Name]:")
                const escapedName = charName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const prefixRegex = new RegExp(`^(\\[?${escapedName}\\]?:?\\s*)`, 'i');
                clean = clean.replace(prefixRegex, '');

                return this.toRoleplay(clean);
            }
        };
