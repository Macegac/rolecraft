        /**
         * =================================================================================================
         * [SEC:JS:UI:MODAL]
         * ModalManager Module
         * Controls the visibility and lifecycle of UI modals.
         * Handles opening, closing, and cleanup (e.g., clearing intervals).
         * =================================================================================================
         */
        const ModalManager = {
            RUNTIME: { carousel_interval: null },
            /**
             * Opens a modal by ID.
             * @param {string} modalId - The ID of the modal element.
             */
            open(modalId) {
                const modal = document.getElementById(modalId);
                if (modal) modal.style.display = 'flex';
            },
            /**
             * Closes a modal by ID and cleans up any intervals.
             * @param {string} modalId - The ID of the modal element.
             */
            close(modalId) {
                if (this.RUNTIME.carousel_interval) {
                    clearInterval(this.RUNTIME.carousel_interval);
                    this.RUNTIME.carousel_interval = null;
                }
                const modal = document.getElementById(modalId);
                if (modal) modal.style.display = 'none';
            }
        };
