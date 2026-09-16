        /**
         * =================================================================================================
         * [SEC:JS:UTIL:IMG]
         * ImageProcessor Module
         * Handles image manipulation tasks such as resizing, cropping, and format conversion.
         * Essential for optimizing images before storage or export.
         * =================================================================================================
         */
        const ImageProcessor = {
            /**
             * Processes an image file, resizing it if necessary, and returns a Blob.
             * @param {File|Blob} imageFile - The image file to process.
             * @returns {Promise<Blob>} - The processed image blob.
             */
            async processImageAsBlob(imageFile, maxHeight = 2000) {
                return new Promise((resolve, reject) => {
                    const MAX_HEIGHT = maxHeight;
                    const QUALITY = 0.85;
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const img = new Image();
                        img.onload = () => {
                            let { width, height } = img;
                            if (height > MAX_HEIGHT) {
                                const ratio = MAX_HEIGHT / height;
                                height = MAX_HEIGHT;
                                width *= ratio;
                            }
                            const canvas = document.createElement('canvas');
                            canvas.width = width;
                            canvas.height = height;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0, width, height);

                            canvas.toBlob((blob) => {
                                if (blob) {
                                    resolve(blob);
                                } else {
                                    reject(new Error('Canvas to Blob conversion failed.'));
                                }
                            }, 'image/jpeg', QUALITY);
                        };
                        img.onerror = (err) => reject(new Error('Failed to load image for processing.'));
                        img.src = e.target.result;
                    };
                    reader.onerror = (err) => reject(new Error('Failed to read image file.'));
                    reader.readAsDataURL(imageFile);
                });
            },

            /**
             * Converts an image blob to a PNG blob.
             * @param {Blob} imageBlob - The source image blob.
             * @returns {Promise<Blob>} - The PNG blob.
             */
            async convertBlobToPNGBlob(imageBlob) {
                return new Promise((resolve, reject) => {
                    const imageUrl = URL.createObjectURL(imageBlob);
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        URL.revokeObjectURL(imageUrl);
                        canvas.toBlob((pngBlob) => {
                            if (pngBlob) {
                                resolve(pngBlob);
                            } else {
                                reject(new Error('Canvas to PNG Blob conversion failed.'));
                            }
                        }, 'image/png');
                    };
                    img.onerror = (err) => {
                        URL.revokeObjectURL(imageUrl);
                        reject(new Error('Failed to load image blob for PNG conversion.'));
                    };
                    UTILITY.safeImageSet(img, imageUrl);
                });
            },

            /**
             * Textured Fluid Ink Bleed Transition Engine
             * Calibrated to exactly 1.0 Second Duration (1000ms)
             * * This engine simulates organic, capillary fluid absorption on textured surfaces (such as paper fibers).
             * It utilizes an offscreen canvas buffer for performance, running a 2D metaball calculation 
             * combined with high-frequency procedural noise subtraction, and finishes with a cubic Hermite 
             * interpolation pass (smoothstep) to feather the bleeding edges cleanly.
             *
             * @param {HTMLImageElement} imgElement - The underlying DOM Image element containing the target asset.
             * @param {HTMLCanvasElement} canvasElement - The rendering canvas overlaying the image.
             */
            triggerTexturedInkBleed(imgElement, canvasElement) {
                if (!canvasElement) return;
                const ctx = canvasElement.getContext('2d');
                if (!ctx) return;

                // 1. Establish the offscreen buffer boundaries
                // We downscale the buffer slightly to run pixel manipulation loops over a 
                // highly compressed space, saving CPU cycles on high-DPI (Retina) screens.
                const noiseWidth = 200;
                const noiseHeight = 250;

                const offscreen = document.createElement('canvas');
                const offCtx = offscreen.getContext('2d');
                offscreen.width = noiseWidth;
                offscreen.height = noiseHeight;

                // 2. Generate a local high-frequency noise array for paper grain texture
                const noiseBuffer = new Float32Array(noiseWidth * noiseHeight);
                for (let i = 0; i < noiseBuffer.length; i++) {
                    noiseBuffer[i] = Math.random();
                }

                // 3. Mathematical cubic Hermite interpolation (Smoothstep)
                // Helps feather the outer boundaries without causing harsh aliasing or stair-stepping.
                function smoothstep(edge0, edge1, x) {
                    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
                    return t * t * (3 - 2 * t);
                }

                // 4. Load the image source structure
                const img = new Image();
                img.src = imgElement.src;
                img.onload = () => {
                    // Set canvas resolution to match layout size of image
                    canvasElement.width = imgElement.offsetWidth || img.naturalWidth || 512;
                    canvasElement.height = imgElement.offsetHeight || img.naturalHeight || 512;

                    // Hide the sharp DOM element to allow the canvas simulation to act as the visual bridge
                    imgElement.style.opacity = '0';
                    imgElement.classList.remove('hidden');

                    // Setup capillary growth nodes (droplet locations)
                    const droplets = [];
                    const dropletCount = 18;

                    for (let i = 0; i < dropletCount; i++) {
                        droplets.push({
                            x: Math.random() * offscreen.width,
                            y: Math.random() * offscreen.height,
                            radius: 0,
                            maxRadius: Math.random() * 55 + 35,
                            speed: Math.random() * 0.7 + 0.4
                        });
                    }

                    const startTime = performance.now();
                    const totalDurationMs = 1000; // Calibrated strictly to 1.0 second as requested
                    let animationFrameId = null;

                    function renderBleedFrame() {
                        const elapsed = performance.now() - startTime;
                        const progress = Math.min(1, elapsed / totalDurationMs); // Normalized timeline t [0, 1]

                        // Clear buffers for fresh drawing pass
                        offCtx.clearRect(0, 0, offscreen.width, offscreen.height);

                        // Phase A: Generate expanding metaball field using radial gradients
                        droplets.forEach(d => {
                            // Radial growth rate bound directly to the normalized timeline progress
                            const r = d.maxRadius * progress * 1.25;

                            const grad = offCtx.createRadialGradient(d.x, d.y, 0, d.x, d.y, r);
                            grad.addColorStop(0, 'rgba(0,0,0,1)');
                            grad.addColorStop(0.5, 'rgba(0,0,0,0.65)');
                            grad.addColorStop(1, 'rgba(0,0,0,0)');

                            offCtx.fillStyle = grad;
                            offCtx.beginPath();
                            offCtx.arc(d.x, d.y, r, 0, Math.PI * 2);
                            offCtx.fill();
                        });

                        // Phase B: Retrieve raw pixels & subtract procedural paper grain noise
                        const tempImgData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
                        const data = tempImgData.data;

                        for (let i = 0; i < data.length; i += 4) {
                            const alphaVal = data[i + 3] / 255;
                            const pixelIdx = i / 4;
                            const noiseVal = noiseBuffer[pixelIdx];

                            // Subtract structural noise from current growth boundaries to mimic paper resistance
                            const texturedAlpha = alphaVal - (noiseVal * 0.28);

                            // Apply smoothstep to feather the bleeding front organically
                            const featheredAlpha = smoothstep(0.12, 0.42, texturedAlpha);

                            // Commit alpha back to the pixel buffer
                            data[i + 3] = featheredAlpha * 255;
                        }
                        offCtx.putImageData(tempImgData, 0, 0);

                        // Phase C: Compositing the final result
                        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);

                        // Draw the organic black shape mask onto visible canvas
                        ctx.drawImage(offscreen, 0, 0, canvasElement.width, canvasElement.height);

                        // Mask the final high-res image into the dynamic black shape boundary
                        ctx.globalCompositeOperation = 'source-in';
                        ctx.drawImage(img, 0, 0, canvasElement.width, canvasElement.height);

                        // Reset composite operation to default
                        ctx.globalCompositeOperation = 'source-over';

                        if (progress < 1) {
                            animationFrameId = requestAnimationFrame(renderBleedFrame);
                        } else {
                            // Transition finished: cleanly show raw sharp DOM image element and clear overlay canvas
                            imgElement.style.opacity = '1';
                            ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
                            cancelAnimationFrame(animationFrameId);
                        }
                    }

                    // Initialize animation loop
                    renderBleedFrame();
                };
            }
        };
