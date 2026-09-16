        /**
         * =================================================================================================
         * [SEC:JS:UTIL:DEBOUNCE]
         * debounce
         * Throttle helper that defers repeated calls until the wait window settles.
         * =================================================================================================
         */
        const debounce = (func, wait) => { let timeout; return function (...args) { const context = this; clearTimeout(timeout); timeout = setTimeout(() => func.apply(context, args), wait); }; };
