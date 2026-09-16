        /**
         * =================================================================================================
         * [SEC:JS:SRV:BACKUP]
         * AutoBackupService Module
         * Manages seamless, zero-impact rolling auto-backups and automatic recovery from DB loss.
         * =================================================================================================
         */
        const AutoBackupService = {
            _backupTimer: null,
            _isBackupRunning: false,

            async requestPersistentStorage() {
                try {
                    if (navigator.storage && typeof navigator.storage.persist === 'function') {
                        const isPersisted = await navigator.storage.persist();
                        console.log(`[AutoBackup] Storage Persistence granted: ${isPersisted}`);
                    }
                } catch (e) {
                    console.warn("[AutoBackup] Storage persistence check failed:", e);
                }
            },

            scheduleBackup(delayMs = 3000) {
                if (this._backupTimer) clearTimeout(this._backupTimer);
                this._backupTimer = setTimeout(() => {
                    this.performAutoBackup().catch(err => {
                        console.warn("[AutoBackup] Background backup task error (fail-soft):", err);
                    });
                }, delayMs);
            },

            async performAutoBackup() {
                if (this._isBackupRunning) return;
                this._isBackupRunning = true;
                try {
                    const stories = await DBService.getAllStories();
                    if (!stories || stories.length === 0) {
                        this._isBackupRunning = false;
                        return;
                    }

                    const narrativePromises = stories.flatMap(s => (s.narratives || []).map(nStub => DBService.getNarrative(nStub.id)));
                    const narrativesRaw = await Promise.all(narrativePromises);
                    const narratives = narrativesRaw.filter(Boolean);
                    const folders = await DBService.getAllFolders();

                    const payload = UTILITY.buildBackupPayload(stories, narratives, folders);

                    // 1. Desktop Mode (Electron native file backup)
                    if (window.electronBridge && window.electronBridge.backup && typeof window.electronBridge.backup.saveNative === 'function') {
                        await window.electronBridge.backup.saveNative(payload);
                    }

                    // 2. Web Mode (localStorage lightweight backup)
                    try {
                        const cleanPayload = UTILITY.sanitizeBackupForLocalStorage(payload, 2000000);
                        if (cleanPayload) {
                            localStorage.setItem('ellipsis_emergency_backup', JSON.stringify(cleanPayload));
                        }
                    } catch (e) {
                        console.warn("[AutoBackup] localStorage write skipped:", e);
                    }
                } catch (err) {
                    console.warn("[AutoBackup] Auto backup failed (fail-soft):", err);
                } finally {
                    this._isBackupRunning = false;
                }
            },

            async getLatestBackup() {
                // 1. Check Electron Native File Backup
                if (window.electronBridge && window.electronBridge.backup && typeof window.electronBridge.backup.loadNative === 'function') {
                    const nativeRes = await window.electronBridge.backup.loadNative();
                    if (nativeRes && nativeRes.success && nativeRes.data) {
                        const validated = UTILITY.validateBackupData(nativeRes.data);
                        if (validated.valid) return nativeRes.data;
                    }
                }

                // 2. Check localStorage Emergency Backup
                try {
                    const raw = localStorage.getItem('ellipsis_emergency_backup');
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        const validated = UTILITY.validateBackupData(parsed);
                        if (validated.valid) return parsed;
                    }
                } catch (e) { }

                return null;
            },

            async autoRecoverIfMissing(currentStories, currentNarratives) {
                try {
                    const backup = await this.getLatestBackup();
                    if (!backup) return false;

                    const shouldRecover = UTILITY.isBackupNewerOrRicher(backup, currentStories, currentNarratives);
                    if (!shouldRecover) return false;

                    console.log("[AutoBackup] Primary DB empty/corrupted. Performing automatic seamless recovery...");

                    let restoredCount = 0;
                    if (backup.stories && Array.isArray(backup.stories)) {
                        for (const story of backup.stories) {
                            await DBService.saveStory(story);
                            restoredCount++;
                        }
                    }
                    if (backup.narratives && Array.isArray(backup.narratives)) {
                        for (const narrative of backup.narratives) {
                            await DBService.saveNarrative(narrative);
                        }
                    }
                    if (backup.folders && Array.isArray(backup.folders)) {
                        for (const folder of backup.folders) {
                            await DBService.saveFolder(folder);
                        }
                    }

                    if (restoredCount > 0) {
                        setTimeout(() => {
                            if (window.UIManager && typeof UIManager.showNotification === 'function') {
                                UIManager.showNotification(`✨ Library Auto-Restored: Successfully recovered ${restoredCount} stories from backup.`, 'success');
                            }
                        }, 1000);
                        return true;
                    }
                } catch (e) {
                    console.error("[AutoBackup] Auto-recovery exception:", e);
                }
                return false;
            }
        };
