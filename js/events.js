    // ---------- 事件绑定 ----------
    const bindEvents = () => {
        window.addEventListener('resize', handleResize);
        window.addEventListener('pagehide', () => DataModule.flush());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') DataModule.flush();
        });

        els.onboardingNextBtn.addEventListener('click', showNextOnboardingPage);
        els.onboardingCloseBtn.addEventListener('click', finishOnboarding);

        els.cancelConfirmBtn.addEventListener('click', closeConfirmModal);
        els.closeConfirmModalBtn.addEventListener('click', closeConfirmModal);
        els.confirmActionBtn.addEventListener('click', async () => {
            const action = confirmAction;
            closeConfirmModal();
            if (action) await action();
        });
        els.confirmModal.addEventListener('click', event => {
            if (event.target === els.confirmModal) closeConfirmModal();
        });

        els.closeXlsxImportBtn.addEventListener('click', closeXlsxImport);
        els.cancelXlsxImportBtn.addEventListener('click', closeXlsxImport);
        els.xlsxImportModal.addEventListener('click', event => {
            if (event.target === els.xlsxImportModal) closeXlsxImport();
        });
        els.xlsxSheetSelect.addEventListener('change', () => {
            selectXlsxSheet(Number(els.xlsxSheetSelect.value) || 0);
        });
        const refreshXlsxPreview = debounce(renderXlsxPreview, 120);
        els.xlsxStartRow.addEventListener('input', refreshXlsxPreview);
        els.xlsxFrontColumn.addEventListener('change', renderXlsxPreview);
        els.xlsxBackColumn.addEventListener('change', renderXlsxPreview);
        els.confirmXlsxImportBtn.addEventListener('click', async () => {
            const draft = xlsxImportDraft;
            if (!draft?.analysis || draft.analysis.accepted.length === 0) return;
            const newWords = DataModule.createWordsFromPairs(draft.analysis.accepted);
            const notices = [];
            if (draft.analysis.duplicateCount > 0) notices.push(`去重 ${draft.analysis.duplicateCount} 条`);
            const excludedCount = draft.analysis.rejected.length - draft.analysis.duplicateCount;
            if (excludedCount > 0) notices.push(`排除 ${excludedCount} 行`);
            closeXlsxImport();
            if (draft.mode === 'append') {
                await commitWordBankAppend(newWords);
            } else {
                await commitWordBankImport(
                    newWords,
                    draft.fileName,
                    `成功导入 ${newWords.length} 个单词${notices.length ? `（${notices.join('，')}）` : ''}`
                );
            }
        });

        els.welcomeDailyLimit.addEventListener('input', updateWelcomePreview);

        els.welcomeFileInput.addEventListener('change', async (e) => {
            await handleImportFile(e.target.files[0]);
            e.target.value = '';
        });
        els.welcomeOcrImageInput.addEventListener('change', async event => {
            await handleOcrImageImport(event.target.files[0], 'replace');
            event.target.value = '';
        });
        els.welcomeOcrCameraInput.addEventListener('change', async event => {
            await handleOcrImageImport(event.target.files[0], 'replace');
            event.target.value = '';
        });

        els.welcomeJsonInput.addEventListener('change', (e) => {
            handleJsonImport(e.target.files[0]);
            e.target.value = '';
        });

        els.startGameBtn.addEventListener('click', handleWelcomeStart);

        els.homeStartBtn.addEventListener('click', handleHomeStart);
        els.homeBonusBtn.addEventListener('click', handleHomeBonus);
        els.openRangeSelectionBtn.addEventListener('click', openRangeSelection);
        els.closeRangeSelectionBtn.addEventListener('click', closeRangeSelection);
        els.rangeSelectionModal.addEventListener('click', event => {
            if (event.target === els.rangeSelectionModal) closeRangeSelection();
        });
        els.rangeSelectionStartInput.addEventListener('input', renderRangeSelectionPreview);
        els.rangeSelectionEndInput.addEventListener('input', renderRangeSelectionPreview);
        els.resetRangeSelectionBtn.addEventListener('click', resetRangeSelection);
        els.confirmRangeSelectionBtn.addEventListener('click', confirmRangeSelection);

        els.openWordListBtn.addEventListener('click', openWordList);
        els.closeWordListBtn.addEventListener('click', closeWordList);
        els.reviewAllWrongBtn.addEventListener('click', startWrongReview);
        els.openAddVocabularyBtn.addEventListener('click', openAddVocabularyModal);
        els.toggleWordEditBtn.addEventListener('click', toggleWordListEditMode);
        els.exportVocabularyBtn.addEventListener('click', exportVocabularyAsTSV);
        els.wordListLoadMoreBtn.addEventListener('click', () => {
            const previousScrollTop = els.wordListScroll.scrollTop;
            wordListVisibleLimit += WORD_LIST_PAGE_SIZE;
            renderWordList();
            els.wordListScroll.scrollTop = previousScrollTop;
        });
        els.wordSearchInput.addEventListener('input', debounce(() => {
            wordListSearchQuery = els.wordSearchInput.value;
            wordListVisibleLimit = WORD_LIST_PAGE_SIZE;
            renderWordList();
            resetWordListScroll();
        }, 120));
        els.wrongOnlyCheckbox.addEventListener('change', () => {
            wordListOnlyWrong = els.wrongOnlyCheckbox.checked;
            wordListVisibleLimit = WORD_LIST_PAGE_SIZE;
            renderWordList();
            resetWordListScroll();
        });
        els.wordSortKey.addEventListener('change', () => {
            wordListSortKey = els.wordSortKey.value;
            wordListVisibleLimit = WORD_LIST_PAGE_SIZE;
            renderWordList();
            resetWordListScroll();
        });
        els.wordSortDirection.addEventListener('click', () => {
            wordListSortDirection = wordListSortDirection === 'asc' ? 'desc' : 'asc';
            wordListVisibleLimit = WORD_LIST_PAGE_SIZE;
            renderWordList();
            resetWordListScroll();
        });

        if (els.backHomeBtn) {
            els.backHomeBtn.addEventListener('click', returnToHome);
        }

        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const theme = btn.dataset.theme;
                setTheme(theme);
                localStorage.setItem('theme', theme);
            });
        });

        document.querySelectorAll('.accent-theme-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!settingsDraft) return;
                settingsDraft.accentTheme = btn.dataset.accentTheme;
                setAccentTheme(settingsDraft.accentTheme, settingsDraft.accentColor);
            });
        });

        document.getElementById('accentCustomColor').addEventListener('input', event => {
            if (!settingsDraft || !validColor(event.target.value)) return;
            settingsDraft.accentColor = event.target.value.toLowerCase();
            settingsDraft.accentTheme = 'custom';
            setAccentTheme('custom', settingsDraft.accentColor);
        });

        els.backgroundImageInput.addEventListener('change', async event => {
            const file = event.target.files[0];
            event.target.value = '';
            if (!file || !settingsDraft) return;
            els.backgroundImageStatus.textContent = '正在处理图片…';
            try {
                const imageData = await compressBackgroundImage(file);
                if (!settingsDraft) return;
                settingsDraft.backgroundImage = imageData;
                setBackgroundImage(imageData);
            } catch (error) {
                if (settingsDraft) setBackgroundImage(settingsDraft.backgroundImage);
                showToast('无法读取该图片，请更换图片重试');
            }
        });

        els.clearBackgroundBtn.addEventListener('click', () => {
            if (!settingsDraft) return;
            settingsDraft.backgroundImage = '';
            setBackgroundImage('');
        });

        els.interfaceOpacityRange.addEventListener('input', () => {
            if (!settingsDraft) return;
            settingsDraft.interfaceOpacity = Number(els.interfaceOpacityRange.value) / 100;
            setInterfaceOpacity(settingsDraft.interfaceOpacity);
        });

        els.masterVolumeRange.addEventListener('input', () => {
            if (!settingsDraft) return;
            settingsDraft.masterVolume = Number(els.masterVolumeRange.value) / 100;
            els.masterVolumeValue.textContent = `${els.masterVolumeRange.value}%`;
            AudioModule.setVolume(settingsDraft.masterVolume);
        });

        document.getElementById('openSettingsBtn').addEventListener('click', openSettings);
        document.getElementById('closeModalBtn').addEventListener('click', closeSettings);
        document.getElementById('closeModalBtnBottom').addEventListener('click', closeSettings);
        document.getElementById('confirmSettingsBtn').addEventListener('click', confirmSettings);
        els.openSettingsAddVocabularyBtn.addEventListener('click', openAddVocabularyModal);

        // 导入词库
        document.getElementById('fileInput').addEventListener('change', async (e) => {
            await handleImportFile(e.target.files[0]);
            e.target.value = '';
        });
        els.settingsOcrImageInput.addEventListener('change', async event => {
            await handleOcrImageImport(event.target.files[0], 'replace');
            event.target.value = '';
        });
        els.settingsOcrCameraInput.addEventListener('change', async event => {
            await handleOcrImageImport(event.target.files[0], 'replace');
            event.target.value = '';
        });

        els.closeAddVocabularyBtn.addEventListener('click', closeAddVocabularyModal);
        els.addVocabularyModal.addEventListener('click', event => {
            if (event.target === els.addVocabularyModal) closeAddVocabularyModal();
        });
        els.confirmManualAddBtn.addEventListener('click', addManualWord);
        els.manualWordBackInput.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') addManualWord();
        });
        els.addVocabularyFileInput.addEventListener('change', async event => {
            const file = event.target.files[0];
            event.target.value = '';
            closeAddVocabularyModal();
            await handleImportFile(file, 'append');
        });
        els.addVocabularyOcrImageInput.addEventListener('change', async event => {
            const file = event.target.files[0];
            event.target.value = '';
            await handleOcrImageImport(file, 'append');
        });
        els.addVocabularyOcrCameraInput.addEventListener('change', async event => {
            const file = event.target.files[0];
            event.target.value = '';
            await handleOcrImageImport(file, 'append');
        });

        els.closeOcrPreviewBtn.addEventListener('click', closeOcrPreview);
        els.cancelOcrPreviewBtn.addEventListener('click', closeOcrPreview);
        els.ocrPreviewModal.addEventListener('click', event => {
            if (event.target === els.ocrPreviewModal) closeOcrPreview();
        });
        els.ocrRecognizedText.addEventListener('input', debounce(renderOcrPreview, 180));
        els.confirmOcrImportBtn.addEventListener('click', confirmOcrImport);

        els.closeEditWordBtn.addEventListener('click', closeEditWordModal);
        els.cancelEditWordBtn.addEventListener('click', closeEditWordModal);
        els.editWordModal.addEventListener('click', event => {
            if (event.target === els.editWordModal) closeEditWordModal();
        });
        els.confirmEditWordBtn.addEventListener('click', confirmEditWord);

        // 备份为JSON
        document.getElementById('exportBtn').addEventListener('click', () => {
            const words = DataModule.getWords();
            if (words.length === 0) {
                showToast('暂无可备份的学习数据');
                return;
            }
            const backup = {
                format: 'anki-match-backup',
                version: 2,
                exportedAt: new Date().toISOString(),
                bankName: config.bankName || '我的词库',
                words,
                dailyStat,
                wordErrorCounts
            };
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const dataUrl = URL.createObjectURL(blob);
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute('href', dataUrl);
            downloadAnchor.setAttribute('download', getBackupFileName());
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
            setTimeout(() => URL.revokeObjectURL(dataUrl), 1000);
            showToast('备份成功');
        });

        // 从JSON导入数据
        document.getElementById('importJsonInput').addEventListener('change', (e) => {
            handleJsonImport(e.target.files[0]);
            e.target.value = '';
        });

        // 保留词库清除学习进度
        document.getElementById('clearProgressBtn').addEventListener('click', () => {
            openConfirmModal({
                title: '清除学习进度',
                message: '词库内容会保留，所有单词将恢复为未学习状态。确定继续吗？',
                confirmText: '确认清除',
                onConfirm: async () => {
                    showLoading('正在清除学习进度…');
                    const resetSucceeded = await DataModule.reset();
                    if (!resetSucceeded) {
                        hideLoading();
                        showToast('学习进度重置失败，请稍后重试');
                        return;
                    }
                    await clearWordErrorCounts();
                    dailyStat = { date: getTodayStr(), target: config.dailyLimit, learnedIds: [] };
                    saveDailyStat();
                    sessionActive = false;
                    clearSessionState();
                    closeSettings();
                    hideLoading();
                    showToast('学习进度已重置');
                    showHomeScreen();
                }
            });
        });

        // 清除所有数据
        document.getElementById('clearAllBtn').addEventListener('click', () => {
            openConfirmModal({
                title: '清除所有数据',
                message: '这将清空词库、学习进度和全部设置，且无法恢复。确定继续吗？',
                confirmText: '全部清除',
                onConfirm: async () => {
                    showLoading('正在清除所有数据…');
                    try {
                        await StorageModule.clearAll();
                        [
                            STORAGE_CONFIG, STORAGE_STAT, STORAGE_SESSION, STORAGE_ONBOARDING,
                            'theme', 'ankiMatchFallbackData', 'ankiMatchData', 'ankiMatchWordErrors'
                        ].forEach(key => localStorage.removeItem(key));
                        location.reload();
                    } catch (error) {
                        hideLoading();
                        showToast('数据清除失败，请稍后重试');
                    }
                }
            });
        });

        const groupSizeSelect = document.getElementById('groupSizeSelect');
        els.shuffleModeCheckbox.addEventListener('change', () => {
            if (!settingsDraft) return;
            settingsDraft.shuffleMode = els.shuffleModeCheckbox.checked;
        });

        groupSizeSelect.addEventListener('change', () => {
            if (!settingsDraft) return;
            if (groupSizeSelect.value === 'custom') {
                openCustomModal({
                    title: '自定义每组卡片数',
                    label: '每组单词数（2 - 20）',
                    min: 2, max: 20,
                    defaultValue: (settingsDraft.groupSize === 'auto' ? calcAutoGroupSize() : settingsDraft.groupSize),
                    onConfirm: (val) => {
                        if (val === null) { syncGroupSizeSelect(settingsDraft.groupSize); return; }
                        settingsDraft.groupSize = val;
                        syncGroupSizeSelect(val);
                    }
                });
            } else {
                settingsDraft.groupSize = groupSizeSelect.value;
                syncGroupSizeSelect(settingsDraft.groupSize);
            }
        });

        els.layoutModeSelect.addEventListener('change', () => {
            if (!settingsDraft) return;
            settingsDraft.layoutMode = els.layoutModeSelect.value === 'custom' ? 'custom' : 'two-column';
            syncLayoutSettings();
        });

        els.allowSameColumnCheckbox.addEventListener('change', () => {
            if (!settingsDraft) return;
            settingsDraft.allowSameColumn = els.allowSameColumnCheckbox.checked;
        });

        const updateCustomLayoutDraft = () => {
            if (!settingsDraft) return;
            settingsDraft.customRows = Math.max(2, Math.min(10, parseInt(els.customRowsInput.value) || 4));
            settingsDraft.customColumns = Math.max(2, Math.min(10, parseInt(els.customColumnsInput.value) || 4));
            els.customRowsInput.value = String(settingsDraft.customRows);
            els.customColumnsInput.value = String(settingsDraft.customColumns);
            syncLayoutSettings();
        };
        els.customRowsInput.addEventListener('change', updateCustomLayoutDraft);
        els.customColumnsInput.addEventListener('change', updateCustomLayoutDraft);

        const dailyLimitSelect = document.getElementById('dailyLimitSelect');
        dailyLimitSelect.addEventListener('change', () => {
            if (!settingsDraft) return;
            if (dailyLimitSelect.value === 'custom') {
                openCustomModal({
                    title: '自定义每日单词数',
                    label: '每日单词数（5 - 500）',
                    min: 5, max: 500,
                    defaultValue: settingsDraft.dailyLimit,
                    onConfirm: (val) => {
                        if (val === null) { syncDailyLimitSelect(settingsDraft.dailyLimit); return; }
                        settingsDraft.dailyLimit = val;
                        syncDailyLimitSelect(val);
                    }
                });
            } else {
                const val = parseInt(dailyLimitSelect.value);
                if (Number.isFinite(val)) settingsDraft.dailyLimit = val;
                syncDailyLimitSelect(settingsDraft.dailyLimit);
            }
        });
    };

    const showToast = (msg) => {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('show');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
    };

