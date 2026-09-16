                    (function initElectronKoboldUI() {
                        if (!window.electronBridge) return;
                        // Set current version
                        window.electronBridge.app.getVersion().then(v => {
                            document.getElementById("app-current-version").textContent = "Version: " + v;
                        });
                        document.getElementById('kobold-electron-controls').classList.remove('hidden');

                        const STATUS_MAP = {
                            stopped: { dot: 'bg-gray-500', label: 'KoboldCPP: Stopped' },
                            downloading: { dot: 'bg-indigo-400 animate-pulse', label: 'Downloading KoboldCPP...' },
                            starting: { dot: 'bg-amber-400 animate-pulse', label: 'Starting Backend...' },
                            running: { dot: 'bg-green-400', label: 'Running on port 5001' },
                            error: { dot: 'bg-red-500', label: 'Error — see details below' }
                        };

                        function applyStatus(s) {
                            console.log('[UI] Applying status:', s);
                            const cfg = STATUS_MAP[s] || STATUS_MAP.stopped;
                            document.getElementById('kobold-status-dot').className = 'w-2.5 h-2.5 rounded-full flex-shrink-0 ' + cfg.dot;
                            document.getElementById('kobold-status-text').textContent = cfg.label;

                            const isDownloading = (s === 'downloading');
                            const isActive = (s === 'running' || s === 'starting');
                            const isStopped = (s === 'stopped' || s === 'error');

                            document.getElementById('kobold-download-container').classList.toggle('hidden', !isDownloading);
                            document.getElementById('kobold-electron-start-btn').classList.toggle('hidden', !isStopped);
                            document.getElementById('kobold-electron-stop-btn').classList.toggle('hidden', !isActive);

                            // Hide error display if we just started something new
                            if (!isStopped) {
                                document.getElementById('kobold-error-display').classList.add('hidden');
                            }
                        }

                        // Status and Log handlers
                        window.electronBridge.kobold.onStatusChange(applyStatus);
                        window.electronBridge.kobold.onDownloadProgress((p) => {
                            const bar = document.getElementById('kobold-download-bar');
                            const txt = document.getElementById('kobold-download-percent');
                            if (bar) bar.style.width = p + '%';
                            if (txt) txt.textContent = Math.round(p) + '%';
                        });

                        window.electronBridge.kobold.onLog((line) => {
                            console.log('[KoboldCPP Log]:', line);
                            // If it's an error line, show it in the UI
                            if (line.includes('[ERROR]')) {
                                const errDisplay = document.getElementById('kobold-error-display');
                                const errText = document.getElementById('kobold-error-text');
                                if (errDisplay && errText) {
                                    errDisplay.classList.remove('hidden');
                                    errText.textContent = line.replace('[ERROR]', '').trim();
                                }
                            }
                        });

                        window.electronBridge.kobold.getStatus().then(applyStatus);
                    })();
                    // Updater Logic
                    window.electronCheckKoboldUpdate = async function () {
                        if (!window.electronBridge) return;
                        const btn = document.getElementById("kobold-check-update-btn");
                        const statusText = document.getElementById("kobold-update-status");
                        const actionDiv = document.getElementById("kobold-update-action");
                        const newVerSpan = document.getElementById("kobold-new-version");


                        btn.disabled = true; btn.textContent = "Checking...";
                        try {
                            const [local, remote] = await Promise.all([
                                window.electronBridge.kobold.getLocalVersion(),
                                window.electronBridge.kobold.getLatestVersion()
                            ]);

                            if (local === remote) {
                                statusText.textContent = `Up to date (${local})`;
                                actionDiv.classList.add("hidden");
                            } else {
                                statusText.textContent = `Update available: ${remote} (Local: ${local})`;
                                newVerSpan.textContent = remote;
                                actionDiv.classList.remove("hidden");
                            }
                        } catch (e) {
                            statusText.textContent = e.message || "Check failed.";
                            console.error("Update check failed:", e);
                        } finally {
                            btn.disabled = false; btn.textContent = "Check again";
                        }
                    };

                    window.electronUpdateKobold = async function () {
                        if (!window.electronBridge) return;
                        const remote = document.getElementById("kobold-new-version").textContent;
                        const statusText = document.getElementById("kobold-update-status");
                        if (!confirm(`Download KoboldCPP ${remote} in the background? You can continue roleplaying during the download.`)) return;

                        statusText.textContent = `Downloading ${remote}...`;
                        document.getElementById("kobold-update-action").classList.add("hidden");
                        await window.electronBridge.kobold.update(remote);
                    };

                    /**
                     * =================================================================================================
                     * [SEC:JS:MOD:UPD]
                     * Electron Updater
                     * Auto-update logic for the Rolecraft Electron build.
                     * =================================================================================================
                     */
                    let downloadedInstallerPath = null;
                    window.electronCheckAppUpdate = async function () {
                        if (!window.electronBridge) return;
                        const btn = document.getElementById("app-check-update-btn");
                        const statusText = document.getElementById("app-update-status");

                        btn.disabled = true; btn.textContent = "Checking GitHub...";
                        try {
                            const current = await window.electronBridge.app.getVersion();
                            const latest = await window.electronBridge.app.getLatestVersion();

                            if (current === latest.version) {
                                statusText.innerHTML = `<span class="text-indigo-300">✓ You are running the latest version (${current}).</span>`;
                                btn.textContent = "Up to Date";
                            } else {
                                statusText.innerHTML = `<span class="text-green-400 font-bold block mb-1">Update Available: ${latest.version}</span><p class="text-[10px] text-gray-500 leading-tight">A newer build is ready on GitHub. Click download to fetch the installer.</p>`;
                                btn.textContent = "Download Update";
                                btn.classList.replace("text-indigo-400", "text-green-400");
                                btn.onclick = () => window.electronDownloadAppUpdate(latest);
                            }
                        } catch (e) {
                            statusText.textContent = e.message || "Unable to reach GitHub. Check your connection.";
                            console.error(e);
                            btn.textContent = "Try Again"; btn.disabled = false;
                        }
                    };

                    window.electronDownloadAppUpdate = async function (release) {
                        const btn = document.getElementById("app-check-update-btn");
                        const progressContainer = document.getElementById("app-update-progress-container");
                        const statusText = document.getElementById("app-update-status");

                        const platform = window.electronBridge.app.getPlatform();
                        const ext = platform === 'darwin' ? '.dmg' : '.exe';
                        const asset = release.assets.find(a => a.name.endsWith(ext));
                        if (!asset) { alert(`This release does not contain an update for your platform (${ext}).`); return; }

                        btn.classList.add("hidden");
                        progressContainer.classList.remove("hidden");
                        statusText.classList.add("hidden");

                        window.electronBridge.app.onUpdateProgress((p) => {
                            document.getElementById("app-update-bar").style.width = p + "%";
                            document.getElementById("app-update-percent").textContent = Math.round(p) + "%";
                        });

                        try {
                            downloadedInstallerPath = await window.electronBridge.app.downloadUpdate(asset.url);
                            document.getElementById("app-update-status").innerHTML = `<span class="text-green-400">Update downloaded and ready!</span>`;
                            document.getElementById("app-update-status").classList.remove("hidden");
                            document.getElementById("app-new-version").textContent = release.version;
                            document.getElementById("app-update-action").classList.remove("hidden");
                        } catch (e) {
                            alert("Download interrupted: " + e.message);
                            btn.classList.remove("hidden");
                        } finally {
                            progressContainer.classList.add("hidden");
                        }
                    };

                    window.electronApplyAppUpdate = function () {
                        if (!window.electronBridge) return;
                        if (confirm("The application will close now to install the update. Please allow the installer to finish before restarting manually.")) {
                            window.electronBridge.app.applyUpdate(downloadedInstallerPath);
                        }
                    };

                    // Bootstrap App Version
                    if (window.electronBridge) {
                        window.electronBridge.app.getVersion().then(v => {
                            const display = document.getElementById("app-current-version");
                            if (display) display.textContent = "Local Instance: v" + v;
                        });
                    }
                    // Initial version check (silent)
                    if (window.electronBridge) {
                        setTimeout(async () => {
                            const local = await window.electronBridge.kobold.getLocalVersion();
                            document.getElementById("kobold-update-status").textContent = `Version: ${local}`;
                        }, 1000);
                    }

                    window.electronLaunchKobold = async function () {
                        if (!window.electronBridge) return;
                        const st = typeof ReactiveStore !== 'undefined' ? ReactiveStore.state : {};
                        const adapter = document.getElementById('koboldcpp-template-selector')?.value || 'none';
                        const normalizedAdapter = adapter === 'none' ? 'None' : (adapter === 'autoguess' ? 'AutoGuess' : adapter);

                        await window.electronBridge.kobold.start({
                            contextSize: 20480,
                            chatcompletionsadapter: normalizedAdapter,

                            defaultgenamt: 2048,
                            autofitpadding: 1024,
                            batchSize: 512,
                            autoFit: true,
                            port: 5001,
                            useCuda: true,
                            quantKv: 1,
                            modelPath: st.kobold_model_path || ''
                        });
                    };

                    window.electronStopKobold = function () {
                        if (window.electronBridge) window.electronBridge.kobold.stop();
                    };
