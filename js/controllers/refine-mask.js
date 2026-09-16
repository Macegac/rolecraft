        /**
         * =================================================================================================
         * [SEC:JS:CTRL:REFINE]
         * RefineMaskController Module
         * Handles manual transparency mask painting/refining.
         * Uses the proven DBService.getImage → Blob → createObjectURL pattern (same as CropController).
         * The visible canvas is CSS-sized to fill its container; brush coordinates are mapped
         * via scaleRatio so strokes land correctly regardless of display vs image resolution.
         * =================================================================================================
         */
        const RefineMaskController = {
            RUNTIME: {
                charId: null,
                mood: null,
                key: null,
                mode: 'erase',
                brushSize: 20,
                brushFeather: 20,
            },

            // Internal canvases (off-screen, at image resolution)
            _originalCanvas: null,   // Pristine original image (never mutated)
            _maskCanvas: null,       // White = opaque, transparent = erased
            _maskCtx: null,

            // Stroke canvases (off-screen, for non-accumulating feathered drawing)
            _strokeStartCanvas: null,
            _strokeStartCtx: null,
            _strokeCanvas: null,
            _strokeCtx: null,
            _strokePoints: [],

            // Display canvas (DOM element, CSS-stretched)
            _canvas: null,
            _ctx: null,

            // Scale from CSS pixels to image pixels
            _scaleRatio: 1,
            _imgWidth: 0,
            _imgHeight: 0,

            // Drawing state
            _isDrawing: false,
            _lastCoords: null,

            // History stacks
            _undoStack: [],
            _redoStack: [],

            // Cleanup tracking
            _blobUrls: [],
            _boundHandlers: null,

            /**
             * Opens the refine mask modal for a character portrait.
             * Loads images directly from IndexedDB as raw Blobs (proven pattern from CropController).
             */
            async open(charId, mood = null) {
                this.RUNTIME.charId = charId;
                this.RUNTIME.mood = mood;
                this.RUNTIME.key = mood ? `${charId}::emotion::${mood}` : charId;
                this.RUNTIME.mode = 'erase';
                this.RUNTIME.brushSize = 20;
                this.RUNTIME.brushFeather = 20;
                this._blobUrls = [];
                this._isDrawing = false;
                this._lastCoords = null;
                this._undoStack = [];
                this._redoStack = [];

                // --- Load images as raw Blobs from IndexedDB (same as CropController) ---
                let originalBlob = null;
                try { originalBlob = await DBService.getImage(this.RUNTIME.key); } catch (e) { /* ignore */ }

                if (!originalBlob) {
                    // Fallback: try the character's stored image_url/avatar_url as a DB key
                    const char = ReactiveStore.getCharacter(charId);
                    if (char) {
                        const fallbackKey = mood
                            ? ((char.extra_portraits || []).find(p => p.emotion === mood) || {}).url
                            : (char.image_url || char.avatar_url);
                        if (fallbackKey) {
                            try { originalBlob = await DBService.getImage(fallbackKey); } catch (e) { /* ignore */ }
                        }
                    }
                }

                if (!originalBlob) {
                    UIManager.showNotification('No portrait image found. Upload a portrait first.', 'warning');
                    return;
                }

                // Load masked version if it exists, otherwise use original
                const maskKey = `${this.RUNTIME.key}::alpha_masked`;
                let maskedBlob = null;
                try { maskedBlob = await DBService.getImage(maskKey); } catch (e) { /* ignore */ }

                // --- Convert Blobs to HTMLImageElement ---
                let originalImg, maskedImg;
                try {
                    originalImg = await this._blobToImage(originalBlob);
                    maskedImg = maskedBlob ? await this._blobToImage(maskedBlob) : originalImg;
                } catch (e) {
                    console.error('[RefineMask] Image load failed:', e);
                    UIManager.showNotification('Failed to load image for mask refinement.', 'error');
                    return;
                }

                // --- Initialize off-screen canvases at native resolution ---
                this._imgWidth = originalImg.naturalWidth || originalImg.width;
                this._imgHeight = originalImg.naturalHeight || originalImg.height;

                // Original (pristine, never painted on)
                this._originalCanvas = document.createElement('canvas');
                this._originalCanvas.width = this._imgWidth;
                this._originalCanvas.height = this._imgHeight;
                this._originalCanvas.getContext('2d').drawImage(originalImg, 0, 0);

                // Mask canvas (white = opaque, transparent = erased)
                this._maskCanvas = document.createElement('canvas');
                this._maskCanvas.width = this._imgWidth;
                this._maskCanvas.height = this._imgHeight;
                this._maskCtx = this._maskCanvas.getContext('2d');

                // Stroke temporary canvases
                this._strokeStartCanvas = document.createElement('canvas');
                this._strokeStartCanvas.width = this._imgWidth;
                this._strokeStartCanvas.height = this._imgHeight;
                this._strokeStartCtx = this._strokeStartCanvas.getContext('2d');

                this._strokeCanvas = document.createElement('canvas');
                this._strokeCanvas.width = this._imgWidth;
                this._strokeCanvas.height = this._imgHeight;
                this._strokeCtx = this._strokeCanvas.getContext('2d');

                // Extract alpha channel from the masked image into the mask canvas
                this._maskCtx.drawImage(maskedImg, 0, 0);
                const imgData = this._maskCtx.getImageData(0, 0, this._imgWidth, this._imgHeight);
                const d = imgData.data;
                for (let i = 0; i < d.length; i += 4) {
                    // Keep alpha, set RGB to white (mask is a white/transparent image)
                    d[i] = 255;
                    d[i + 1] = 255;
                    d[i + 2] = 255;
                }
                this._maskCtx.putImageData(imgData, 0, 0);

                // --- Setup display canvas ---
                this._canvas = document.getElementById('refine-canvas');
                if (!this._canvas) return;
                this._ctx = this._canvas.getContext('2d');

                // Set the internal resolution to match the image
                this._canvas.width = this._imgWidth;
                this._canvas.height = this._imgHeight;

                // Initial composite draw
                this._redraw();

                // --- Show modal BEFORE measuring (so container has layout dimensions) ---
                const modal = document.getElementById('refine-mask-modal');
                if (modal) {
                    modal.classList.remove('hidden');
                    modal.classList.add('flex');
                }

                // UI state
                this.updateModeButtons();
                const sizeInput = document.getElementById('refine-brush-size');
                if (sizeInput) sizeInput.value = this.RUNTIME.brushSize;
                const sizeVal = document.getElementById('refine-brush-size-val');
                if (sizeVal) sizeVal.textContent = `${this.RUNTIME.brushSize}px`;

                const featherInput = document.getElementById('refine-brush-feather');
                if (featherInput) featherInput.value = this.RUNTIME.brushFeather;
                const featherVal = document.getElementById('refine-brush-feather-val');
                if (featherVal) featherVal.textContent = `${this.RUNTIME.brushFeather}%`;

                this.updateUndoRedoButtons();

                // Compute scale ratio after layout
                this._updateScaleRatio();

                // Attach listeners
                this._attachListeners();
            },

            /** Convert a Blob to an HTMLImageElement (creates and tracks a blob URL). */
            _blobToImage(blob) {
                return new Promise((resolve, reject) => {
                    const url = URL.createObjectURL(blob);
                    this._blobUrls.push(url);
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = () => reject(new Error('Image load failed'));
                    img.src = url;
                });
            },

            /** Recalculate the ratio between CSS display size and internal canvas resolution. */
            _updateScaleRatio() {
                if (!this._canvas) return;
                const rect = this._canvas.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    // Use the axis with the tighter fit
                    this._scaleRatio = Math.max(
                        this._imgWidth / rect.width,
                        this._imgHeight / rect.height
                    );
                }
            },

            /** Composite: draw original, then use mask as alpha. */
            _redraw() {
                const ctx = this._ctx;
                if (!ctx) return;
                ctx.clearRect(0, 0, this._imgWidth, this._imgHeight);
                ctx.globalCompositeOperation = 'source-over';
                ctx.drawImage(this._originalCanvas, 0, 0);
                ctx.globalCompositeOperation = 'destination-in';
                ctx.drawImage(this._maskCanvas, 0, 0);
                ctx.globalCompositeOperation = 'source-over';
            },

            // --- Event Handling ---

            _attachListeners() {
                // Remove old listeners if any
                this._detachListeners();

                const canvas = document.getElementById('refine-canvas');
                const container = document.getElementById('refine-canvas-container');
                if (!canvas) return;

                const onMouseDown = (e) => { e.preventDefault(); this._startDraw(e); };
                const onMouseMove = (e) => { this._onMove(e); };
                const onMouseUp = () => { this._stopDraw(); };
                const onTouchStart = (e) => { e.preventDefault(); this._startDraw(e); };
                const onTouchMove = (e) => { e.preventDefault(); this._onMove(e); };
                const onTouchEnd = () => { this._stopDraw(); };
                const onResize = () => { this._updateScaleRatio(); };
                const onKeyDown = (e) => {
                    if (e.ctrlKey || e.metaKey) {
                        if (e.key.toLowerCase() === 'z') {
                            e.preventDefault();
                            this.undo();
                        } else if (e.key.toLowerCase() === 'y') {
                            e.preventDefault();
                            this.redo();
                        }
                    }
                };

                canvas.addEventListener('mousedown', onMouseDown);
                canvas.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);

                canvas.addEventListener('touchstart', onTouchStart, { passive: false });
                canvas.addEventListener('touchmove', onTouchMove, { passive: false });
                window.addEventListener('touchend', onTouchEnd);
                window.addEventListener('touchcancel', onTouchEnd);

                window.addEventListener('resize', onResize);
                window.addEventListener('keydown', onKeyDown);

                // Store for cleanup
                this._boundHandlers = {
                    canvas, onMouseDown, onMouseMove, onMouseUp,
                    onTouchStart, onTouchMove, onTouchEnd, onResize, onKeyDown
                };
            },

            _detachListeners() {
                const h = this._boundHandlers;
                if (!h) return;
                h.canvas.removeEventListener('mousedown', h.onMouseDown);
                h.canvas.removeEventListener('mousemove', h.onMouseMove);
                window.removeEventListener('mouseup', h.onMouseUp);
                h.canvas.removeEventListener('touchstart', h.onTouchStart);
                h.canvas.removeEventListener('touchmove', h.onTouchMove);
                window.removeEventListener('touchend', h.onTouchEnd);
                window.removeEventListener('touchcancel', h.onTouchEnd);
                window.removeEventListener('resize', h.onResize);
                window.removeEventListener('keydown', h.onKeyDown);
                this._boundHandlers = null;
            },

            _getCanvasCoords(e) {
                if (!this._canvas) return { x: 0, y: 0 };
                const rect = this._canvas.getBoundingClientRect();
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;

                // Map CSS pixels to internal canvas pixels
                const x = ((clientX - rect.left) / rect.width) * this._imgWidth;
                const y = ((clientY - rect.top) / rect.height) * this._imgHeight;
                return { x, y };
            },

            _startDraw(e) {
                this._updateScaleRatio();
                this._saveHistory();
                this._isDrawing = true;

                // Copy current mask to start canvas
                this._strokeStartCtx.clearRect(0, 0, this._imgWidth, this._imgHeight);
                this._strokeStartCtx.drawImage(this._maskCanvas, 0, 0);

                const coords = this._getCanvasCoords(e);
                this._strokePoints = [coords];
                this._drawStrokeToMask();
                this._redraw();
            },

            _onMove(e) {
                // Update brush cursor
                this._updateBrushCursor(e);

                if (!this._isDrawing) return;
                const coords = this._getCanvasCoords(e);
                this._strokePoints.push(coords);
                this._drawStrokeToMask();
                this._redraw();
            },

            _stopDraw() {
                this._isDrawing = false;
                this._strokePoints = [];
            },

            _drawStrokeToMask() {
                if (!this._strokePoints || this._strokePoints.length === 0) return;
                const r = this.RUNTIME.brushSize * this._scaleRatio / 2;
                const feather = this.RUNTIME.brushFeather || 0;

                // 1. Clear stroke canvas
                const sCtx = this._strokeCtx;
                sCtx.clearRect(0, 0, this._imgWidth, this._imgHeight);

                // 2. Draw the hard path onto stroke canvas (always fully white)
                sCtx.strokeStyle = '#ffffff';
                sCtx.fillStyle = '#ffffff';
                sCtx.lineWidth = r * 2;
                sCtx.lineCap = 'round';
                sCtx.lineJoin = 'round';

                if (this._strokePoints.length === 1) {
                    const p = this._strokePoints[0];
                    sCtx.beginPath();
                    sCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
                    sCtx.fill();
                } else {
                    sCtx.beginPath();
                    sCtx.moveTo(this._strokePoints[0].x, this._strokePoints[0].y);
                    for (let i = 1; i < this._strokePoints.length; i++) {
                        sCtx.lineTo(this._strokePoints[i].x, this._strokePoints[i].y);
                    }
                    sCtx.stroke();
                }

                // 3. Clear main mask canvas and restore starting state
                const mCtx = this._maskCtx;
                mCtx.clearRect(0, 0, this._imgWidth, this._imgHeight);
                mCtx.drawImage(this._strokeStartCanvas, 0, 0);

                // 4. Composite the blurred/feathered stroke canvas onto main mask
                if (this.RUNTIME.mode === 'erase') {
                    mCtx.globalCompositeOperation = 'destination-out';
                } else {
                    mCtx.globalCompositeOperation = 'source-over';
                }

                if (feather > 0) {
                    const blurRadius = r * (feather / 100);
                    mCtx.filter = `blur(${blurRadius}px)`;
                } else {
                    mCtx.filter = 'none';
                }

                // Draw the stroke canvas onto main mask
                mCtx.drawImage(this._strokeCanvas, 0, 0);

                // Reset composite and filter
                mCtx.globalCompositeOperation = 'source-over';
                mCtx.filter = 'none';
            },

            /** Update the visual brush cursor indicator. */
            _updateBrushCursor(e) {
                const cursor = document.getElementById('refine-brush-cursor');
                const canvas = document.getElementById('refine-canvas');
                const container = document.getElementById('refine-canvas-container');
                if (!cursor || !canvas || !container) return;

                const rect = canvas.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;

                // Coordinates relative to the canvas drawing area
                const canvasX = clientX - rect.left;
                const canvasY = clientY - rect.top;

                // Coordinates relative to the container for positioning the cursor div
                const x = clientX - containerRect.left;
                const y = clientY - containerRect.top;

                // Bounds check: cursor should be hidden if outside the active canvas element
                if (canvasX < 0 || canvasY < 0 || canvasX > rect.width || canvasY > rect.height) {
                    cursor.classList.add('hidden');
                    return;
                }

                cursor.classList.remove('hidden');
                const size = this.RUNTIME.brushSize;
                cursor.style.width = `${size}px`;
                cursor.style.height = `${size}px`;
                cursor.style.left = `${x}px`;
                cursor.style.top = `${y}px`;

                // Update radial gradient to visually represent feathering
                const feather = this.RUNTIME.brushFeather || 0;
                if (feather > 0) {
                    cursor.style.background = `radial-gradient(circle, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.35) ${100 - feather}%, rgba(255,255,255,0) 100%)`;
                } else {
                    cursor.style.background = 'rgba(255,255,255,0.1)';
                }
            },

            // --- Public Controls ---

            setMode(mode) {
                this.RUNTIME.mode = mode;
                this.updateModeButtons();
            },

            updateModeButtons() {
                const eraseBtn = document.getElementById('refine-btn-erase');
                const restoreBtn = document.getElementById('refine-btn-restore');
                if (!eraseBtn || !restoreBtn) return;

                const active = 'py-2 px-4 rounded-md text-xs font-semibold bg-indigo-600 text-white shadow-md focus:outline-none transition-all';
                const inactive = 'py-2 px-4 rounded-md text-xs font-semibold text-gray-400 hover:text-gray-200 hover:bg-white/5 focus:outline-none transition-all';

                eraseBtn.className = this.RUNTIME.mode === 'erase' ? active : inactive;
                restoreBtn.className = this.RUNTIME.mode === 'restore' ? active : inactive;
            },

            setBrushSize(size) {
                this.RUNTIME.brushSize = parseInt(size, 10);
                const sizeVal = document.getElementById('refine-brush-size-val');
                if (sizeVal) sizeVal.textContent = `${this.RUNTIME.brushSize}px`;
            },

            setBrushFeather(feather) {
                this.RUNTIME.brushFeather = parseInt(feather, 10);
                const featherVal = document.getElementById('refine-brush-feather-val');
                if (featherVal) featherVal.textContent = `${this.RUNTIME.brushFeather}%`;
            },

            _saveHistory() {
                if (!this._maskCtx || !this._imgWidth) return;
                const state = this._maskCtx.getImageData(0, 0, this._imgWidth, this._imgHeight);
                this._undoStack.push(state);
                if (this._undoStack.length > 20) {
                    this._undoStack.shift();
                }
                this._redoStack = []; // Clear redo stack on new action
                this.updateUndoRedoButtons();
            },

            undo() {
                if (this._undoStack.length === 0) return;
                const prevState = this._undoStack.pop();
                const currentState = this._maskCtx.getImageData(0, 0, this._imgWidth, this._imgHeight);
                this._redoStack.push(currentState);

                this._maskCtx.putImageData(prevState, 0, 0);
                this._redraw();
                this.updateUndoRedoButtons();
            },

            redo() {
                if (this._redoStack.length === 0) return;
                const nextState = this._redoStack.pop();
                const currentState = this._maskCtx.getImageData(0, 0, this._imgWidth, this._imgHeight);
                this._undoStack.push(currentState);

                this._maskCtx.putImageData(nextState, 0, 0);
                this._redraw();
                this.updateUndoRedoButtons();
            },

            updateUndoRedoButtons() {
                const undoBtn = document.getElementById('refine-btn-undo');
                const redoBtn = document.getElementById('refine-btn-redo');
                if (undoBtn) {
                    undoBtn.disabled = this._undoStack.length === 0;
                    if (undoBtn.disabled) {
                        undoBtn.classList.add('opacity-40', 'cursor-not-allowed', 'text-gray-500');
                        undoBtn.classList.remove('hover:bg-gray-700', 'text-white');
                    } else {
                        undoBtn.classList.remove('opacity-40', 'cursor-not-allowed', 'text-gray-500');
                        undoBtn.classList.add('hover:bg-gray-700', 'text-white');
                    }
                }
                if (redoBtn) {
                    redoBtn.disabled = this._redoStack.length === 0;
                    if (redoBtn.disabled) {
                        redoBtn.classList.add('opacity-40', 'cursor-not-allowed', 'text-gray-500');
                        redoBtn.classList.remove('hover:bg-gray-700', 'text-white');
                    } else {
                        redoBtn.classList.remove('opacity-40', 'cursor-not-allowed', 'text-gray-500');
                        redoBtn.classList.add('hover:bg-gray-700', 'text-white');
                    }
                }
            },

            /** Reset the mask back to fully opaque (show entire original image). */
            resetMask() {
                if (!this._maskCtx || !this._imgWidth) return;
                this._saveHistory();
                this._maskCtx.clearRect(0, 0, this._imgWidth, this._imgHeight);
                this._maskCtx.fillStyle = '#ffffff';
                this._maskCtx.fillRect(0, 0, this._imgWidth, this._imgHeight);
                this._redraw();
                UIManager.showNotification('Mask reset to fully opaque. Undo if needed.', 'info');
            },

            close() {
                const modal = document.getElementById('refine-mask-modal');
                if (modal) {
                    modal.classList.remove('flex');
                    modal.classList.add('hidden');
                }

                // Hide brush cursor
                const cursor = document.getElementById('refine-brush-cursor');
                if (cursor) cursor.classList.add('hidden');

                // Detach listeners
                this._detachListeners();

                // Revoke blob URLs
                if (this._blobUrls && this._blobUrls.length > 0) {
                    this._blobUrls.forEach(url => { try { URL.revokeObjectURL(url); } catch (e) { } });
                    this._blobUrls = [];
                }

                // Clear references
                this._canvas = null;
                this._ctx = null;
                this._originalCanvas = null;
                this._maskCanvas = null;
                this._maskCtx = null;
                this._strokeStartCanvas = null;
                this._strokeStartCtx = null;
                this._strokeCanvas = null;
                this._strokeCtx = null;
                this._strokePoints = [];
            },

            async save() {
                if (!this._canvas) return;

                // Composite final image at full resolution
                const exportCanvas = document.createElement('canvas');
                exportCanvas.width = this._imgWidth;
                exportCanvas.height = this._imgHeight;
                const ectx = exportCanvas.getContext('2d');
                ectx.drawImage(this._originalCanvas, 0, 0);
                ectx.globalCompositeOperation = 'destination-in';
                ectx.drawImage(this._maskCanvas, 0, 0);
                ectx.globalCompositeOperation = 'source-over';

                exportCanvas.toBlob(async (blob) => {
                    if (!blob) {
                        UIManager.showNotification('Failed to generate image from canvas.', 'error');
                        return;
                    }

                    try {
                        const maskKey = `${this.RUNTIME.key}::alpha_masked`;
                        await DBService.saveImage(maskKey, blob);

                        // Update runtime cache
                        UIManager.RUNTIME.characterImageCache = UIManager.RUNTIME.characterImageCache || {};
                        const oldUrl = UIManager.RUNTIME.characterImageCache[maskKey];
                        if (oldUrl) {
                            const oldGradientKey = `${oldUrl}::gradient`;
                            if (UIManager.RUNTIME.characterImageCache[oldGradientKey]) {
                                try { URL.revokeObjectURL(UIManager.RUNTIME.characterImageCache[oldGradientKey]); } catch (e) { }
                                delete UIManager.RUNTIME.characterImageCache[oldGradientKey];
                            }
                            try { URL.revokeObjectURL(oldUrl); } catch (e) { }
                        }
                        UIManager.RUNTIME.characterImageCache[maskKey] = URL.createObjectURL(blob);

                        this.close();

                        UIManager.showNotification('Mask saved successfully.', 'success');
                        UIManager.openCharacterDetailModal(this.RUNTIME.charId);
                        UIManager.renderChat();
                    } catch (e) {
                        UIManager.showNotification('Failed to save refined mask: ' + e.message, 'error');
                    }
                }, 'image/png');
            }
        };
