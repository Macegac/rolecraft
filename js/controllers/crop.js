        /**
         * =================================================================================================
         * [SEC:JS:CTRL:CROP]
         * CropController Module
         * Handles the image cropping interface.
         * =================================================================================================
         */
        const CropController = {
            RUNTIME: {
                file: null, img: null, scale: 1, posX: 0, posY: 0,
                isDragging: false, isResizing: false, startX: 0, startY: 0,
                startWidth: 0, startHeight: 0, callback: null,
                cropWidth: 300, cropHeight: 450 // Default 2:3
            },

            open(file, onConfirm) {
                // Determine source: File object or Blob/Url from IDB
                this.RUNTIME.file = file;
                this.RUNTIME.callback = onConfirm;
                this.RUNTIME.scale = 1;
                this.RUNTIME.posX = 0;
                this.RUNTIME.posY = 0;
                this.RUNTIME.shape = 'rect';

                // Reset to default Portrait 2:3
                this.setAspectRatio(300, 450);

                // Update shape buttons state
                const rectBtn = document.getElementById('crop-shape-rect');
                const circleBtn = document.getElementById('crop-shape-circle');
                if (rectBtn && circleBtn) {
                    rectBtn.className = "px-2.5 py-1 bg-indigo-600 rounded text-xs text-white font-medium";
                    circleBtn.className = "px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-200";
                }
                const overlay = document.getElementById('crop-overlay-frame');
                if (overlay) {
                    overlay.style.borderRadius = '0.125rem';
                }

                const img = document.getElementById('crop-target');
                // Handle both File objects and Blobs (passed as URL usually, but file handles it)
                if (file instanceof File || file instanceof Blob) {
                    img.src = URL.createObjectURL(file);
                } else {
                    // Assume it's a string URL? Not supported by current calls, safe fallback
                    img.src = file;
                }

                // Reset transform
                img.style.transform = `translate(0px, 0px) scale(1)`;

                document.getElementById('crop-scale').value = 1;
                document.getElementById('crop-modal').classList.remove('hidden');
                document.getElementById('crop-modal').classList.add('flex');
            },

            setShape(shape) {
                this.RUNTIME.shape = shape;
                const rectBtn = document.getElementById('crop-shape-rect');
                const circleBtn = document.getElementById('crop-shape-circle');
                if (rectBtn && circleBtn) {
                    if (shape === 'circle') {
                        rectBtn.className = "px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-200";
                        circleBtn.className = "px-2.5 py-1 bg-indigo-600 rounded text-xs text-white font-medium";
                    } else {
                        rectBtn.className = "px-2.5 py-1 bg-indigo-600 rounded text-xs text-white font-medium";
                        circleBtn.className = "px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-200";
                    }
                }
                const overlay = document.getElementById('crop-overlay-frame');
                if (overlay) {
                    overlay.style.borderRadius = shape === 'circle' ? '50%' : '0.125rem';
                }
                if (shape === 'circle') {
                    const size = Math.min(this.RUNTIME.cropWidth, this.RUNTIME.cropHeight);
                    this.setAspectRatio(size, size);
                }
            },

            async autoMask() {
                const btn = document.getElementById('crop-auto-mask');
                if (btn) {
                    btn.disabled = true;
                    btn.classList.add('opacity-50');
                    const span = btn.querySelector('span');
                    if (span) span.textContent = 'Masking...';
                }

                try {
                    // 1. Dynamic CDN load of MediaPipe Selfie Segmentation if not present
                    if (typeof window.SelfieSegmentation === 'undefined') {
                        await new Promise((resolve, reject) => {
                            const script = document.createElement('script');
                            script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js';
                            script.crossOrigin = 'anonymous';
                            script.onload = resolve;
                            script.onerror = reject;
                            document.head.appendChild(script);
                        });
                    }

                    // 2. Initialize SelfieSegmentation
                    const selfieSegmentation = new window.SelfieSegmentation({
                        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
                    });

                    selfieSegmentation.setOptions({
                        modelSelection: 1, // 1 is landscape/accurate
                    });

                    const img = document.getElementById('crop-target');
                    if (!img || !img.complete) {
                        throw new Error('Image not loaded yet');
                    }

                    // Run segmentation on the crop target
                    let maskBlob = null;
                    await new Promise((resolve, reject) => {
                        let timeout = setTimeout(() => reject(new Error('Segmentation timeout')), 10000);
                        selfieSegmentation.onResults((results) => {
                            clearTimeout(timeout);
                            try {
                                const canvas = document.createElement('canvas');
                                canvas.width = results.image.width;
                                canvas.height = results.image.height;
                                const ctx = canvas.getContext('2d');

                                // Draw original image
                                ctx.drawImage(results.image, 0, 0);

                                // Mask using source-in or destination-in. 
                                // MediaPipe's segmentationMask is green on a transparent/black background.
                                // We want to keep only pixels where the mask is visible.
                                ctx.globalCompositeOperation = 'destination-in';
                                ctx.drawImage(results.segmentationMask, 0, 0);

                                canvas.toBlob((blob) => {
                                    maskBlob = blob;
                                    resolve();
                                }, 'image/png');
                            } catch (e) {
                                reject(e);
                            }
                        });

                        selfieSegmentation.send({ image: img }).catch(reject);
                    });

                    if (maskBlob) {
                        // Revoke old object URL if needed
                        if (img.src && img.src.startsWith('blob:')) {
                            URL.revokeObjectURL(img.src);
                        }
                        const newUrl = URL.createObjectURL(maskBlob);
                        img.src = newUrl;
                        this.RUNTIME.file = maskBlob; // Update file in runtime
                    }

                    // Close the pipeline
                    selfieSegmentation.close();

                } catch (err) {
                    console.error('Auto Mask failed:', err);
                    alert('Auto Mask failed: ' + err.message);
                } finally {
                    if (btn) {
                        btn.disabled = false;
                        btn.classList.remove('opacity-50');
                        const span = btn.querySelector('span');
                        if (span) span.textContent = 'Auto Mask';
                    }
                }
            },

            setAspectRatio(width, height) {
                this.RUNTIME.cropWidth = width;
                this.RUNTIME.cropHeight = height;

                const overlay = document.getElementById('crop-overlay-frame');
                if (overlay) {
                    overlay.style.width = `${width}px`;
                    overlay.style.height = `${height}px`;
                }
            },

            cancel() {
                document.getElementById('crop-modal').classList.add('hidden');
                document.getElementById('crop-modal').classList.remove('flex');
                const img = document.getElementById('crop-target');
                if (img.src && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
                this.RUNTIME.file = null;
            },

            confirm() {
                if (!this.RUNTIME.file) return;
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                const width = this.RUNTIME.cropWidth;
                const height = this.RUNTIME.cropHeight;
                canvas.width = width;
                canvas.height = height;

                const img = document.getElementById('crop-target');

                // Clear canvas to keep transparent background
                ctx.clearRect(0, 0, width, height);

                // Clip to circular region if circle shape is selected
                if (this.RUNTIME.shape === 'circle') {
                    ctx.beginPath();
                    ctx.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
                    ctx.clip();
                }

                // Draw image centered with transforms
                ctx.translate(width / 2 + this.RUNTIME.posX, height / 2 + this.RUNTIME.posY);
                ctx.scale(this.RUNTIME.scale, this.RUNTIME.scale);
                ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

                canvas.toBlob((blob) => {
                    if (this.RUNTIME.callback) this.RUNTIME.callback(blob);
                    this.cancel();
                }, 'image/png');
            },

            init() {
                const container = document.getElementById('crop-container');
                const slider = document.getElementById('crop-scale');
                const resizeHandle = document.getElementById('crop-resize-handle');
                const overlay = document.getElementById('crop-overlay-frame');

                if (slider) {
                    slider.addEventListener('input', (e) => {
                        this.RUNTIME.scale = parseFloat(e.target.value);
                        this.updateTransform();
                    });
                }

                // --- Pan Event Handlers ---
                const startPan = (clientX, clientY) => {
                    if (this.RUNTIME.isResizing) return;
                    this.RUNTIME.isDragging = true;
                    this.RUNTIME.startX = clientX - this.RUNTIME.posX;
                    this.RUNTIME.startY = clientY - this.RUNTIME.posY;
                };

                const movePan = (clientX, clientY) => {
                    if (!this.RUNTIME.isDragging) return;
                    this.RUNTIME.posX = clientX - this.RUNTIME.startX;
                    this.RUNTIME.posY = clientY - this.RUNTIME.startY;
                    this.updateTransform();
                };

                // --- Resize Event Handlers ---
                const startResize = (clientX, clientY, e) => {
                    if (e) {
                        e.stopPropagation(); // prevent pan
                        e.preventDefault(); // prevent selection
                    }
                    this.RUNTIME.isResizing = true;
                    this.RUNTIME.startX = clientX;
                    this.RUNTIME.startY = clientY;
                    this.RUNTIME.startWidth = this.RUNTIME.cropWidth;
                    this.RUNTIME.startHeight = this.RUNTIME.cropHeight;
                    // Disable CSS transition for smooth resizing
                    if (overlay) overlay.style.transition = 'none';
                };

                const moveResize = (clientX, clientY) => {
                    if (!this.RUNTIME.isResizing) return;
                    const deltaX = clientX - this.RUNTIME.startX;
                    const deltaY = clientY - this.RUNTIME.startY;

                    // Add constraints
                    let newWidth = Math.max(50, Math.min(container.clientWidth - 20, this.RUNTIME.startWidth + deltaX * 2));
                    let newHeight = Math.max(50, Math.min(container.clientHeight - 20, this.RUNTIME.startHeight + deltaY * 2));

                    if (this.RUNTIME.shape === 'circle') {
                        const size = Math.min(newWidth, newHeight);
                        newWidth = size;
                        newHeight = size;
                    }

                    this.setAspectRatio(newWidth, newHeight);
                };

                // Mouse Events - Pan
                if (container) {
                    container.addEventListener('mousedown', (e) => {
                        if (e.target === resizeHandle || e.target.closest('#crop-resize-handle')) return;
                        startPan(e.clientX, e.clientY);
                    });
                }

                window.addEventListener('mousemove', (e) => {
                    if (this.RUNTIME.isResizing) {
                        e.preventDefault(); // prevent text selection
                        moveResize(e.clientX, e.clientY);
                    } else if (this.RUNTIME.isDragging) {
                        e.preventDefault(); // prevent text selection
                        movePan(e.clientX, e.clientY);
                    }
                });

                // Mouse Events - Resize
                // Wait for DOM to be fully loaded or handle dynamically? 
                if (resizeHandle) {
                    resizeHandle.addEventListener('mousedown', (e) => startResize(e.clientX, e.clientY, e));
                } else {
                    // Fallback to fetch dynamically on demand if we attach event to container
                    if (container) {
                        container.addEventListener('mousedown', (e) => {
                            if (e.target.id === 'crop-resize-handle' || e.target.closest('#crop-resize-handle')) {
                                startResize(e.clientX, e.clientY, e);
                            }
                        });
                    }
                }

                // Touch Events - Pan & Resize
                if (container) {
                    container.addEventListener('touchstart', (e) => {
                        if (e.target.id === 'crop-resize-handle' || e.target.closest('#crop-resize-handle')) {
                            startResize(e.touches[0].clientX, e.touches[0].clientY, e);
                            return;
                        }
                        if (e.touches.length === 1) startPan(e.touches[0].clientX, e.touches[0].clientY);
                    }, { passive: false });
                }

                window.addEventListener('touchmove', (e) => {
                    if (this.RUNTIME.isResizing) {
                        e.preventDefault();
                        moveResize(e.touches[0].clientX, e.touches[0].clientY);
                    } else if (this.RUNTIME.isDragging) {
                        e.preventDefault();
                        movePan(e.touches[0].clientX, e.touches[0].clientY);
                    }
                }, { passive: false });

                const endInteractions = () => {
                    this.RUNTIME.isDragging = false;
                    if (this.RUNTIME.isResizing) {
                        this.RUNTIME.isResizing = false;
                        const overlayNow = document.getElementById('crop-overlay-frame');
                        if (overlayNow) overlayNow.style.transition = ''; // Restore transition
                    }
                };

                window.addEventListener('mouseup', endInteractions);
                window.addEventListener('mouseleave', endInteractions);
                window.addEventListener('touchend', endInteractions);
                window.addEventListener('touchcancel', endInteractions);

                // Wheel zoom
                if (container) {
                    container.addEventListener('wheel', (e) => {
                        e.preventDefault();
                        const delta = e.deltaY > 0 ? -0.1 : 0.1;
                        let newScale = this.RUNTIME.scale - delta;
                        newScale = Math.max(0.1, Math.min(3, newScale));
                        this.RUNTIME.scale = newScale;
                        if (slider) slider.value = newScale;
                        this.updateTransform();
                    });
                }
            },

            updateTransform() {
                const img = document.getElementById('crop-target');
                if (img) img.style.transform = `translate(${this.RUNTIME.posX}px, ${this.RUNTIME.posY}px) scale(${this.RUNTIME.scale})`;
            }
        };
