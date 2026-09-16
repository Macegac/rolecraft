        /**
         * =================================================================================================
         * [SEC:JS:UTIL:DOM]
         * DOM
         * SafeString wrapper and HTML sanitization helpers.
         * =================================================================================================
         */
        const DOM = {
            SafeString: class {
                constructor(str) { this.str = str; }
                toString() { return this.str; }
            },
            html(strings, ...values) {
                let result = "";
                strings.forEach((string, i) => {
                    // Technical Safeguard: Ensure the literal parts of the template don't contain un-interpolated placeholders
                    result += string.replace(/\$\{imgSrc\}/g, "");

                    if (i < values.length) {
                        let val = values[i];

                        // Defensive Safeguard: Prevent un-interpolated placeholders or invalid paths from leaking into the DOM
                        if (val instanceof DOM.SafeString) {
                            if (val.str.includes('${imgSrc}')) {
                                console.warn("DOM.html: Intercepted un-interpolated ${imgSrc} placeholder in SafeString. Clearing.");
                                val = new DOM.SafeString("");
                            }
                        } else if (typeof val === 'string' && (val.includes('${imgSrc}') || val === 'undefined' || val === 'null' || val === '')) {
                            if (val.includes('${imgSrc}')) {
                                console.warn("DOM.html: Intercepted un-interpolated ${imgSrc} placeholder. Clearing.");
                            }
                            val = "";
                        }

                        if (Array.isArray(val)) {
                            // Recursively join arrays
                            result += val.join('');
                        } else if (val instanceof DOM.SafeString) {
                            result += val;
                        } else if (val !== null && val !== undefined) {
                            // Securely escape unsafe values
                            result += String(val)
                                .replace(/&/g, "&amp;")
                                .replace(/</g, "&lt;")
                                .replace(/>/g, "&gt;")
                                .replace(/"/g, "&quot;")
                                .replace(/'/g, "&#039;");
                        } else {
                            // Ensure null/undefined becomes an empty string in the DOM
                            result += "";
                        }
                    }
                });
                return new DOM.SafeString(result);
            },
            unsafe(str) {
                return new DOM.SafeString(str);
            }
        };
