    // ---------- 每日学习量变更 ----------
    const applyDailyLimitChange = (newLimit) => {
        config.dailyLimit = newLimit;
        saveConfig();

        if (newLimit === 0) {
            dailyStat.target = Math.max(getWordsInSelectedRange().length, getDailyLearnedCount());
            saveDailyStat();
        } else if (newLimit > dailyStat.target) {
            dailyStat.target = newLimit;
            saveDailyStat();
        }

        updateInfoBar();

        if (els.homeOverlay.classList.contains('show')) {
            updateHomeScreen();
        }
    };

    // ---------- 下拉框同步 ----------
    const syncGroupSizeSelect = (value = config.groupSize) => {
        const select = document.getElementById('groupSizeSelect');
        if (!select) return;
        const customOpt = select.querySelector('option[value="custom"]');
        const autoOpt = select.querySelector('option[value="auto"]');
        const v = String(value);
        const opt = select.querySelector(`option[value="${v}"]`);

        const currentAutoSize = calcAutoGroupSize();
        if (autoOpt) {
            autoOpt.textContent = `适应屏幕(${currentAutoSize}个)`;
        }

        if (opt && v !== 'custom') {
            select.value = v;
            if (customOpt) customOpt.textContent = '自定义';
        } else {
            select.value = 'custom';
            if (customOpt) customOpt.textContent = `自定义 (${value})`;
        }
    };

    const syncDailyLimitSelect = (value = config.dailyLimit) => {
        const select = document.getElementById('dailyLimitSelect');
        if (!select) return;
        const customOpt = select.querySelector('option[value="custom"]');
        const v = String(value);
        const opt = select.querySelector(`option[value="${v}"]`);
        if (opt && v !== 'custom') {
            select.value = v;
            if (customOpt) customOpt.textContent = '自定义';
        } else {
            select.value = 'custom';
            if (customOpt) customOpt.textContent = `自定义 (${value})`;
        }
    };

    const syncLayoutSettings = () => {
        if (!settingsDraft) return;
        const customMode = settingsDraft.layoutMode === 'custom';
        els.layoutModeSelect.value = settingsDraft.layoutMode;
        els.customLayoutOptions.hidden = !customMode;
        document.getElementById('twoColumnGroupSizeRow').hidden = customMode;
        document.getElementById('twoColumnSameColumnRow').hidden = customMode;
        els.allowSameColumnCheckbox.checked = settingsDraft.allowSameColumn;
        els.customRowsInput.value = String(settingsDraft.customRows);
        els.customColumnsInput.value = String(settingsDraft.customColumns);
        const totalSlots = settingsDraft.customRows * settingsDraft.customColumns;
        document.getElementById('customLayoutHint').textContent = totalSlots % 2 === 0
            ? `共 ${totalSlots} 个格子，可显示 ${totalSlots / 2} 个单词`
            : '总格数必须为偶数（请调整行数或列数）';
        if (els.customLayoutRecommendation) {
            // The game board is capped at 1040px.  Basing this on the whole viewport
            // used to recommend too many narrow columns on wide screens, making long
            // Chinese definitions unreadable.
            const isPhone = window.innerWidth < 600;
            const availableWidth = Math.min(1040, Math.max(260, window.innerWidth - (isPhone ? 40 : 80)));
            const availableHeight = Math.max(240, Math.min(620, window.innerHeight - 290));
            const minCardWidth = isPhone ? 118 : 190;
            const minCardHeight = isPhone ? 82 : 104;
            const gap = isPhone ? 10 : 14;
            const maxColumns = isPhone ? 2 : 4;
            let columns = Math.max(2, Math.min(maxColumns, Math.floor((availableWidth + gap) / (minCardWidth + gap))));
            let rows = Math.max(2, Math.min(5, Math.floor((availableHeight + gap) / (minCardHeight + gap))));
            if ((rows * columns) % 2 !== 0) rows = rows < 5 ? rows + 1 : rows - 1;
            els.customLayoutRecommendation.textContent = `当前屏幕推荐：${rows} 行 × ${columns} 列（可显示 ${rows * columns / 2} 个单词）`;
        }
    };

    const getSelectedRangeBounds = () => {
        const words = DataModule.getWords();
        const total = words.length;
        const start = total > 0 ? Math.max(1, Math.min(total, Number(config.wordRangeStart) || 1)) : 1;
        const configuredEnd = Number(config.wordRangeEnd) || total;
        const end = total > 0 ? Math.max(start, Math.min(total, configuredEnd)) : 1;
        return { words, total, start, end };
    };

    const updateHomeRangeDisplay = () => {
        if (!els.homeRangeSummary || !els.homeStartBtn) return;
        const { words, total, start, end } = getSelectedRangeBounds();
        if (total === 0) {
            els.homeRangeSummary.textContent = '本轮：暂无词汇';
            els.homeStartBtn.classList.remove('range-selected');
            return;
        }
        const selected = start !== 1 || end !== total;
        els.homeRangeSummary.textContent = selected
            ? `本轮：第 ${start}—${end} 词（${words[start - 1].front} → ${words[end - 1].front}）`
            : `本轮：全词库（共 ${total} 词）`;
        els.homeStartBtn.classList.toggle('range-selected', selected);
    };

    const resolveRangeValue = value => {
        const { words, total } = getSelectedRangeBounds();
        const raw = String(value || '').trim();
        if (!raw || total === 0) return null;
        if (/^\d+$/.test(raw)) {
            const position = Number(raw);
            return position >= 1 && position <= total ? position : null;
        }
        const key = DataModule.normalizeEnglishKey(raw);
        const index = words.findIndex(word => DataModule.normalizeEnglishKey(word.front) === key);
        return index >= 0 ? index + 1 : null;
    };

    const renderRangeSelectionPreview = () => {
        const { words, total } = getSelectedRangeBounds();
        if (total === 0) {
            els.rangeSelectionSummary.textContent = '当前词库为空';
            return null;
        }
        const start = resolveRangeValue(els.rangeSelectionStartInput.value);
        const end = resolveRangeValue(els.rangeSelectionEndInput.value);
        if (!start || !end) {
            els.rangeSelectionSummary.textContent = '请输入有效的词库序号或完整英文单词';
            return null;
        }
        if (start > end) {
            els.rangeSelectionSummary.textContent = '起点不能在终点之后';
            return null;
        }
        els.rangeSelectionSummary.textContent = `第 ${start} 个：${words[start - 1].front}　→　第 ${end} 个：${words[end - 1].front}（共 ${end - start + 1} 个）`;
        return { start, end };
    };

    const openRangeSelection = () => {
        const { total, start, end } = getSelectedRangeBounds();
        if (total === 0) { showToast('请先导入词库'); return; }
        els.rangeSelectionStartInput.value = String(start);
        els.rangeSelectionEndInput.value = String(end);
        renderRangeSelectionPreview();
        els.rangeSelectionModal.classList.add('show');
        setTimeout(() => { els.rangeSelectionStartInput.focus(); els.rangeSelectionStartInput.select(); }, 50);
    };

    const closeRangeSelection = () => els.rangeSelectionModal.classList.remove('show');

    const confirmRangeSelection = () => {
        const selection = renderRangeSelectionPreview();
        if (!selection) return;
        const { total } = getSelectedRangeBounds();
        config.wordRangeStart = selection.start;
        config.wordRangeEnd = selection.start === 1 && selection.end === total ? 0 : selection.end;
        saveConfig();
        if (config.dailyLimit === 0) {
            dailyStat.target = Math.max(getWordsInSelectedRange().length, getDailyLearnedCount());
            saveDailyStat();
        }
        updateHomeRangeDisplay();
        updateHomeScreen();
        closeRangeSelection();
        showToast('本轮词库范围已更新');
    };

    const resetRangeSelection = () => {
        const { total } = getSelectedRangeBounds();
        if (total === 0) return;
        config.wordRangeStart = 1;
        config.wordRangeEnd = 0;
        saveConfig();
        updateHomeRangeDisplay();
        updateHomeScreen();
        closeRangeSelection();
        showToast('已恢复使用全词库');
    };

    const syncAppearanceSettings = () => {
        if (!settingsDraft) return;
        const opacityPercent = Math.round(settingsDraft.interfaceOpacity * 100);
        const volumePercent = Math.round(settingsDraft.masterVolume * 100);
        els.interfaceOpacityRange.value = String(opacityPercent);
        els.interfaceOpacityValue.textContent = `${opacityPercent}%`;
        els.masterVolumeRange.value = String(volumePercent);
        els.masterVolumeValue.textContent = `${volumePercent}%`;
    };

    // ---------- 窗口大小变化监听 ----------
    const handleResize = debounce(() => {
        const newAutoSize = calcAutoGroupSize();
        syncGroupSizeSelect(settingsDraft ? settingsDraft.groupSize : config.groupSize);
        if (settingsDraft && settingsDraft.layoutMode === 'custom') syncLayoutSettings();

        if (sessionActive && config.layoutMode === 'two-column' && config.groupSize === 'auto') {
            const snapshot = GameModule.getSnapshot();
            const isUntouched = snapshot.leftCards.every(c => !c.matched) &&
                snapshot.rightCards.every(c => !c.matched);

            if (isUntouched && snapshot.currentGroupIds.length !== newAutoSize) {
                const currentGroupWords = snapshot.currentGroupIds
                    .map(id => DataModule.getWords().find(w => w.id === id))
                    .filter(word => word && !currentCompanionIds.has(word.id));

                const returningIds = new Set(currentGroupWords.map(word => word.id));
                todayQueue = todayQueue.filter(word => !returningIds.has(word.id));
                todayQueue.unshift(...currentGroupWords);
                loadNextGroup();
            }
        }
    }, 250);

    // ---------- 设置弹窗 ----------
    const openSettings = () => {
        settingsDraft = {
            groupSize: config.groupSize,
            dailyLimit: config.dailyLimit,
            shuffleMode: config.shuffleMode,
            accentTheme: config.accentTheme,
            accentColor: config.accentColor,
            backgroundImage: config.backgroundImage,
            layoutMode: config.layoutMode,
            allowSameColumn: config.allowSameColumn,
            customRows: config.customRows,
            customColumns: config.customColumns,
            interfaceOpacity: config.interfaceOpacity,
            masterVolume: config.masterVolume
        };
        syncGroupSizeSelect(settingsDraft.groupSize);
        syncDailyLimitSelect(settingsDraft.dailyLimit);
        syncLayoutSettings();
        syncAppearanceSettings();
        els.settingsAddVocabularyEntry.hidden = DataModule.getWords().length === 0;
        els.shuffleModeCheckbox.checked = settingsDraft.shuffleMode;
        setAccentTheme(settingsDraft.accentTheme, settingsDraft.accentColor);
        setBackgroundImage(settingsDraft.backgroundImage);
        document.getElementById('settingsModal').classList.add('show');
    };
    const closeSettings = () => {
        setAccentTheme(config.accentTheme, config.accentColor);
        setBackgroundImage(config.backgroundImage);
        setInterfaceOpacity(config.interfaceOpacity);
        AudioModule.setVolume(config.masterVolume);
        settingsDraft = null;
        document.getElementById('settingsModal').classList.remove('show');
        syncGroupSizeSelect(config.groupSize);
        syncDailyLimitSelect(config.dailyLimit);
        els.shuffleModeCheckbox.checked = config.shuffleMode;
    };
    const confirmSettings = async () => {
        if (!settingsDraft) { closeSettings(); return; }
        const newGroup = settingsDraft.groupSize;
        const newLimit = settingsDraft.dailyLimit;
        const newShuffleMode = settingsDraft.shuffleMode;
        const newAccentTheme = settingsDraft.accentTheme;
        const newBackgroundImage = settingsDraft.backgroundImage;
        const newLayoutMode = settingsDraft.layoutMode;
        const newAllowSameColumn = settingsDraft.allowSameColumn;
        const newRows = Math.max(2, Math.min(10, parseInt(settingsDraft.customRows) || 4));
        const newColumns = Math.max(2, Math.min(10, parseInt(settingsDraft.customColumns) || 4));
        if (newLayoutMode === 'custom' && (newRows * newColumns) % 2 !== 0) {
            showToast('自定义布局的总格数必须为偶数');
            return;
        }
        const newInterfaceOpacity = settingsDraft.interfaceOpacity;
        const newMasterVolume = settingsDraft.masterVolume;
        const previousBackgroundImage = config.backgroundImage;
        const groupChanged = newGroup !== config.groupSize;
        const limitChanged = newLimit !== config.dailyLimit;
        const shuffleChanged = newShuffleMode !== config.shuffleMode;
        const accentChanged = newAccentTheme !== config.accentTheme ||
            (newAccentTheme === 'custom' && settingsDraft.accentColor !== config.accentColor);
        const backgroundChanged = newBackgroundImage !== config.backgroundImage;
        const layoutChanged = newLayoutMode !== config.layoutMode ||
            newAllowSameColumn !== config.allowSameColumn ||
            newRows !== config.customRows || newColumns !== config.customColumns;
        const opacityChanged = newInterfaceOpacity !== config.interfaceOpacity;
        const volumeChanged = newMasterVolume !== config.masterVolume;

        config.groupSize = newGroup;
        config.shuffleMode = newShuffleMode;
        config.accentTheme = newAccentTheme;
        config.accentColor = settingsDraft.accentColor;
        config.backgroundImage = newBackgroundImage;
        config.layoutMode = newLayoutMode;
        config.allowSameColumn = newAllowSameColumn;
        config.customRows = newRows;
        config.customColumns = newColumns;
        config.interfaceOpacity = newInterfaceOpacity;
        config.masterVolume = newMasterVolume;
        if (!saveConfig()) {
            config.backgroundImage = previousBackgroundImage;
            settingsDraft.backgroundImage = previousBackgroundImage;
            saveConfig();
            setBackgroundImage(previousBackgroundImage);
            showToast('背景图片存储失败，请选择尺寸更小的图片');
            return;
        }
        if (backgroundChanged) {
            try {
                await StorageModule.setValue('backgroundImage', newBackgroundImage);
            } catch (error) {
                config.backgroundImage = previousBackgroundImage;
                settingsDraft.backgroundImage = previousBackgroundImage;
                setBackgroundImage(previousBackgroundImage);
                showToast('背景图片存储失败，请选择尺寸更小的图片');
                return;
            }
        }
        if (limitChanged) applyDailyLimitChange(newLimit);
        setAccentTheme(config.accentTheme);
        setBackgroundImage(config.backgroundImage);
        setInterfaceOpacity(config.interfaceOpacity);
        AudioModule.setVolume(config.masterVolume);
        closeSettings();

        if (groupChanged || limitChanged || shuffleChanged || accentChanged || backgroundChanged ||
            layoutChanged || opacityChanged || volumeChanged) showToast('设置已保存');
    };

    // ---------- 自定义弹窗 ----------
    const openCustomModal = ({ title, label, min, max, defaultValue, onConfirm }) => {
        const modal = document.getElementById('customModal');
        const titleEl = document.getElementById('customModalTitle');
        const labelEl = document.getElementById('customModalLabel');
        const input = document.getElementById('customModalInput');
        const confirmBtn = document.getElementById('confirmCustomBtn');
        const cancelBtn = document.getElementById('cancelCustomBtn');
        const closeBtn = document.getElementById('closeCustomModalBtn');

        titleEl.textContent = title;
        labelEl.textContent = label;
        input.min = min; input.max = max;
        input.value = defaultValue;

        modal.classList.add('show');
        setTimeout(() => { input.focus(); input.select(); }, 50);

        const cleanup = () => {
            modal.classList.remove('show');
            confirmBtn.removeEventListener('click', confirmHandler);
            cancelBtn.removeEventListener('click', cancelHandler);
            closeBtn.removeEventListener('click', cancelHandler);
            modal.removeEventListener('click', backdropHandler);
            input.onkeydown = null;
        };
        const confirmHandler = () => {
            let val = parseInt(input.value);
            if (isNaN(val)) val = defaultValue;
            if (val < min) val = min;
            if (val > max) val = max;
            cleanup(); onConfirm(val);
        };
        const cancelHandler = () => { cleanup(); onConfirm(null); };
        const backdropHandler = (e) => { if (e.target === modal) cancelHandler(); };

        confirmBtn.addEventListener('click', confirmHandler);
        cancelBtn.addEventListener('click', cancelHandler);
        closeBtn.addEventListener('click', cancelHandler);
        modal.addEventListener('click', backdropHandler);
        input.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); confirmHandler(); }
            if (e.key === 'Escape') { e.preventDefault(); cancelHandler(); }
        };
    };

    // ---------- 统一确认弹窗 ----------
    const closeConfirmModal = () => {
        els.confirmModal.classList.remove('show');
        confirmAction = null;
    };

    const openConfirmModal = ({ title, message, confirmText = '确认', onConfirm }) => {
        els.confirmModalTitle.textContent = title;
        els.confirmModalMessage.textContent = message;
        els.confirmActionBtn.textContent = confirmText;
        confirmAction = onConfirm;
        els.confirmModal.classList.add('show');
    };

