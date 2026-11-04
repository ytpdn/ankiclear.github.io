    const STORAGE_CONFIG = 'ankiMatchConfig';
    const STORAGE_STAT = 'ankiMatchDailyStat';
    const STORAGE_SESSION = 'ankiMatchSession';
    const STORAGE_ONBOARDING = 'ankiMatchOnboardingSeen';
    const SESSION_QUEUE_VERSION = 2;
    const WORD_LIST_PAGE_SIZE = 300;
    const ACCENT_THEMES = ['blue', 'rose', 'lilac', 'sky', 'lemon', 'custom'];
    const ACCENT_COLORS = {
        blue: '#4776c9', rose: '#a84460', lilac: '#8648a2', sky: '#306e9e', lemon: '#74670e'
    };
    const validColor = color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
    const validBackgroundImage = value => value === '' ||
        (typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/i.test(value));

    let config = {
        dailyLimit: 20,
        groupSize: 'auto',
        shuffleMode: true,
        initialized: false,
        bankName: '未导入词库',
        accentTheme: 'blue',
        accentColor: '#bee4ff',
        backgroundImage: '',
        layoutMode: 'two-column',
        allowSameColumn: false,
        customRows: 4,
        customColumns: 4,
        wordRangeStart: 1,
        wordRangeEnd: 0,
        interfaceOpacity: 1,
        masterVolume: 1
    };
    let dailyStat = { date: '', target: 20, learnedIds: [] };
    let todayQueue = [];
    let toastTimer = null;
    let sessionActive = false;
    let settingsDraft = null;
    let wordErrorCounts = {};
    let wordListSortKey = 'name';
    let wordListSortDirection = 'asc';
    let wordListOnlyWrong = false;
    let wordListSearchQuery = '';
    let sessionMode = 'daily';
    let wrongReviewTotal = 0;
    let wrongReviewCompletedIds = new Set();
    let retryPendingIds = new Set();
    let groupWrongIds = new Set();
    let currentCompanionIds = new Set();
    let recentGroupWordIds = [];
    let onboardingPageIndex = 0;
    let onboardingTimers = [];
    let onboardingTransitioning = false;
    let confirmAction = null;
    let xlsxImportDraft = null;
    let loadingDepth = 1;
    let wordListVisibleLimit = WORD_LIST_PAGE_SIZE;
    let wordListEditMode = false;
    let editingWordId = null;
    let editingWordOriginalFront = '';
    let editingWordOriginalPhonetic = '';
    let ocrImportDraft = null;
    let timerEnabled = false;
    let sessionStartedAt = null;
    let timerInterval = null;
    let lastSessionElapsedMs = null;

    const els = {};
    const getTodayStr = () => new Date().toDateString();

    const getWordsInSelectedRange = () => {
        const words = DataModule.getWords();
        const start = Math.max(1, Math.min(words.length || 1, Number(config.wordRangeStart) || 1));
        const configuredEnd = Number(config.wordRangeEnd) || words.length;
        const end = Math.max(start, Math.min(words.length, configuredEnd));
        return words.slice(start - 1, end);
    };

    const getDailyLearnedCount = () => {
        const rangeIds = new Set(getWordsInSelectedRange().map(word => word.id));
        return dailyStat.learnedIds.filter(id => rangeIds.has(id)).length;
    };

    const getEffectiveDailyTarget = () => {
        const rangeWords = getWordsInSelectedRange();
        const rangeSize = rangeWords.length;
        if (config.dailyLimit === 0) {
            const learnedSet = new Set(dailyStat.learnedIds);
            const learnedCount = rangeWords.filter(word => learnedSet.has(word.id)).length;
            const now = Date.now();
            const learnableCount = rangeWords.filter(word =>
                !learnedSet.has(word.id) && (word.dueDate <= now || !word.lastReview)).length;
            return learnedCount + learnableCount;
        }
        const configuredTarget = Number(dailyStat.target) > 0 ? Number(dailyStat.target) : config.dailyLimit;
        return Math.min(configuredTarget, rangeSize);
    };

    const formatElapsedTime = milliseconds => {
        const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const pair = value => String(value).padStart(2, '0');
        return hours > 0 ? `${pair(hours)}:${pair(minutes)}:${pair(seconds)}` : `${pair(minutes)}:${pair(seconds)}`;
    };

    const updateSessionTimerDisplay = () => {
        if (!els.sessionTimer || !els.sessionTimerValue) return;
        els.sessionTimer.hidden = !timerEnabled || !sessionStartedAt;
        if (!els.sessionTimer.hidden) {
            els.sessionTimerValue.textContent = formatElapsedTime(Date.now() - sessionStartedAt);
        }
    };

    const startSessionTimer = (enabled, startedAt = Date.now()) => {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        timerEnabled = !!enabled;
        sessionStartedAt = timerEnabled ? (Number(startedAt) || Date.now()) : null;
        lastSessionElapsedMs = null;
        updateSessionTimerDisplay();
        if (timerEnabled) timerInterval = setInterval(updateSessionTimerDisplay, 1000);
    };

    const stopSessionTimer = (completed = false) => {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        const elapsed = timerEnabled && sessionStartedAt ? Date.now() - sessionStartedAt : null;
        lastSessionElapsedMs = completed ? elapsed : null;
        timerEnabled = false;
        sessionStartedAt = null;
        updateSessionTimerDisplay();
        return elapsed;
    };
    const ONBOARDING_PAGES = [
        { title: '欢迎使用', lines: ['Anki单词消消乐'] },
        { title: '初次见面', lines: ['先做自我介绍'] },
        {
            title: '我能帮你',
            lines: ['记忆你的专属词汇表', '以匹配的方式记忆单词', '自动规划复习任务', '检查单词掌握程度']
        },
        {
            title: '我的特点',
            lines: ['支持导入 XLSX、CSV、TSV、TXT 格式的词汇表', '支持自定义页面图片', '随时导入导出学习进度']
        }
    ];

    // 防抖函数
    const debounce = (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    };

    const showLoading = (message = '正在加载…') => {
        loadingDepth += 1;
        if (!els.loadingOverlay) return;
        els.loadingMessage.textContent = message;
        els.loadingOverlay.hidden = false;
        els.loadingOverlay.classList.remove('is-hidden');
    };

    const hideLoading = (force = false) => {
        loadingDepth = force ? 0 : Math.max(0, loadingDepth - 1);
        if (loadingDepth > 0 || !els.loadingOverlay) return;
        els.loadingOverlay.classList.add('is-hidden');
        setTimeout(() => {
            if (loadingDepth === 0) els.loadingOverlay.hidden = true;
        }, 240);
    };

    // ---------- DOM 缓存 ----------
    const cacheElements = () => {
        els.loadingOverlay = document.getElementById('loadingOverlay');
        els.loadingMessage = document.getElementById('loadingMessage');

        els.infoBar = document.getElementById('infoBar');
        els.infoProgress = document.getElementById('infoProgress');
        els.infoProgressLabel = document.getElementById('infoProgressLabel');
        els.infoEstimate = document.getElementById('infoEstimate');
        els.infoDays = document.getElementById('infoDays');
        els.backHomeBtn = document.getElementById('backHomeBtn');
        els.sessionTimer = document.getElementById('sessionTimer');
        els.sessionTimerValue = document.getElementById('sessionTimerValue');

        els.welcomeOverlay = document.getElementById('welcomeOverlay');
        els.welcomeBankInfo = document.getElementById('welcomeBankInfo');
        els.welcomeDailyLimit = document.getElementById('welcomeDailyLimit');
        els.welcomePreview = document.getElementById('welcomePreview');
        els.welcomeFileInput = document.getElementById('welcomeFileInput');
        els.welcomeOcrImageInput = document.getElementById('welcomeOcrImageInput');
        els.welcomeOcrCameraInput = document.getElementById('welcomeOcrCameraInput');
        els.welcomeJsonInput = document.getElementById('welcomeJsonInput');
        els.startGameBtn = document.getElementById('startGameBtn');

        els.homeOverlay = document.getElementById('homeOverlay');
        els.homeBookName = document.getElementById('homeBookName');
        els.homeBookDays = document.getElementById('homeBookDays');
        els.homeTodayProgress = document.getElementById('homeTodayProgress');
        els.homeTotalProgress = document.getElementById('homeTotalProgress');
        els.todayRingPath = document.getElementById('todayRingPath');
        els.totalRingPath = document.getElementById('totalRingPath');
        els.homeMessage = document.getElementById('homeMessage');
        els.homeStartBtn = document.getElementById('homeStartBtn');
        els.homeBonusBtn = document.getElementById('homeBonusBtn');
        els.timerEnabledCheckbox = document.getElementById('timerEnabledCheckbox');
        els.homeSessionTime = document.getElementById('homeSessionTime');
        els.openRangeSelectionBtn = document.getElementById('openRangeSelectionBtn');
        els.homeRangeSummary = document.getElementById('homeRangeSummary');

        els.openWordListBtn = document.getElementById('openWordListBtn');
        els.wordListOverlay = document.getElementById('wordListOverlay');
        els.closeWordListBtn = document.getElementById('closeWordListBtn');
        els.wrongOnlyCheckbox = document.getElementById('wrongOnlyCheckbox');
        els.wordSortKey = document.getElementById('wordSortKey');
        els.wordSortDirection = document.getElementById('wordSortDirection');
        els.wordSortDirectionLabel = document.getElementById('wordSortDirectionLabel');
        els.wordSortDirectionIcon = document.getElementById('wordSortDirectionIcon');
        els.wordListScroll = document.getElementById('wordListScroll');
        els.wordList = document.getElementById('wordList');
        els.wordListEmpty = document.getElementById('wordListEmpty');
        els.wordListLoadMore = document.getElementById('wordListLoadMore');
        els.wordListCount = document.getElementById('wordListCount');
        els.wordListLoadMoreBtn = document.getElementById('wordListLoadMoreBtn');
        els.wordSearchInput = document.getElementById('wordSearchInput');
        els.reviewAllWrongBtn = document.getElementById('reviewAllWrongBtn');
        els.exportVocabularyBtn = document.getElementById('exportVocabularyBtn');
        els.openAddVocabularyBtn = document.getElementById('openAddVocabularyBtn');
        els.toggleWordEditBtn = document.getElementById('toggleWordEditBtn');
        els.backgroundImageInput = document.getElementById('backgroundImageInput');
        els.clearBackgroundBtn = document.getElementById('clearBackgroundBtn');
        els.backgroundImageStatus = document.getElementById('backgroundImageStatus');
        els.shuffleModeCheckbox = document.getElementById('shuffleModeCheckbox');
        els.layoutModeSelect = document.getElementById('layoutModeSelect');
        els.allowSameColumnCheckbox = document.getElementById('allowSameColumnCheckbox');
        els.customLayoutOptions = document.getElementById('customLayoutOptions');
        els.customRowsInput = document.getElementById('customRowsInput');
        els.customColumnsInput = document.getElementById('customColumnsInput');
        els.interfaceOpacityRange = document.getElementById('interfaceOpacityRange');
        els.interfaceOpacityValue = document.getElementById('interfaceOpacityValue');
        els.masterVolumeRange = document.getElementById('masterVolumeRange');
        els.masterVolumeValue = document.getElementById('masterVolumeValue');
        els.settingsOcrImageInput = document.getElementById('settingsOcrImageInput');
        els.settingsOcrCameraInput = document.getElementById('settingsOcrCameraInput');
        els.settingsAddVocabularyEntry = document.getElementById('settingsAddVocabularyEntry');
        els.openSettingsAddVocabularyBtn = document.getElementById('openSettingsAddVocabularyBtn');

        els.onboardingOverlay = document.getElementById('onboardingOverlay');
        els.onboardingTitle = document.getElementById('onboardingTitle');
        els.onboardingLines = document.getElementById('onboardingLines');
        els.onboardingNextBtn = document.getElementById('onboardingNextBtn');
        els.onboardingCloseBtn = document.getElementById('onboardingCloseBtn');

        els.confirmModal = document.getElementById('confirmModal');
        els.confirmModalTitle = document.getElementById('confirmModalTitle');
        els.confirmModalMessage = document.getElementById('confirmModalMessage');
        els.confirmActionBtn = document.getElementById('confirmActionBtn');
        els.cancelConfirmBtn = document.getElementById('cancelConfirmBtn');
        els.closeConfirmModalBtn = document.getElementById('closeConfirmModalBtn');

        els.xlsxImportModal = document.getElementById('xlsxImportModal');
        els.closeXlsxImportBtn = document.getElementById('closeXlsxImportBtn');
        els.cancelXlsxImportBtn = document.getElementById('cancelXlsxImportBtn');
        els.confirmXlsxImportBtn = document.getElementById('confirmXlsxImportBtn');
        els.xlsxSheetSelect = document.getElementById('xlsxSheetSelect');
        els.xlsxStartRow = document.getElementById('xlsxStartRow');
        els.xlsxFrontColumn = document.getElementById('xlsxFrontColumn');
        els.xlsxBackColumn = document.getElementById('xlsxBackColumn');
        els.xlsxImportSummary = document.getElementById('xlsxImportSummary');
        els.xlsxPreviewBody = document.getElementById('xlsxPreviewBody');
        els.xlsxPreviewNote = document.getElementById('xlsxPreviewNote');
        els.xlsxImportTitle = document.getElementById('xlsxImportTitle');
        els.xlsxImportSubtitle = document.getElementById('xlsxImportSubtitle');

        els.addVocabularyModal = document.getElementById('addVocabularyModal');
        els.closeAddVocabularyBtn = document.getElementById('closeAddVocabularyBtn');
        els.manualWordFrontInput = document.getElementById('manualWordFrontInput');
        els.manualWordBackInput = document.getElementById('manualWordBackInput');
        els.confirmManualAddBtn = document.getElementById('confirmManualAddBtn');
        els.addVocabularyFileInput = document.getElementById('addVocabularyFileInput');
        els.addVocabularyOcrImageInput = document.getElementById('addVocabularyOcrImageInput');
        els.addVocabularyOcrCameraInput = document.getElementById('addVocabularyOcrCameraInput');

        els.ocrPreviewModal = document.getElementById('ocrPreviewModal');
        els.closeOcrPreviewBtn = document.getElementById('closeOcrPreviewBtn');
        els.cancelOcrPreviewBtn = document.getElementById('cancelOcrPreviewBtn');
        els.confirmOcrImportBtn = document.getElementById('confirmOcrImportBtn');
        els.ocrPreviewTitle = document.getElementById('ocrPreviewTitle');
        els.ocrRecognizedText = document.getElementById('ocrRecognizedText');
        els.ocrPreviewSummary = document.getElementById('ocrPreviewSummary');
        els.ocrPairPreview = document.getElementById('ocrPairPreview');

        els.editWordModal = document.getElementById('editWordModal');
        els.closeEditWordBtn = document.getElementById('closeEditWordBtn');
        els.cancelEditWordBtn = document.getElementById('cancelEditWordBtn');
        els.confirmEditWordBtn = document.getElementById('confirmEditWordBtn');
        els.editWordFrontInput = document.getElementById('editWordFrontInput');
        els.editWordBackInput = document.getElementById('editWordBackInput');
        els.editWordPhoneticInput = document.getElementById('editWordPhoneticInput');

        els.rangeSelectionModal = document.getElementById('rangeSelectionModal');
        els.closeRangeSelectionBtn = document.getElementById('closeRangeSelectionBtn');
        els.rangeSelectionStartInput = document.getElementById('rangeSelectionStartInput');
        els.rangeSelectionEndInput = document.getElementById('rangeSelectionEndInput');
        els.rangeSelectionSummary = document.getElementById('rangeSelectionSummary');
        els.resetRangeSelectionBtn = document.getElementById('resetRangeSelectionBtn');
        els.confirmRangeSelectionBtn = document.getElementById('confirmRangeSelectionBtn');
        els.customLayoutRecommendation = document.getElementById('customLayoutRecommendation');
    };

    // ---------- 配置持久化 ----------
    const loadConfig = () => {
        try {
            const saved = localStorage.getItem(STORAGE_CONFIG);
            if (saved) config = { ...config, ...JSON.parse(saved) };
        } catch (e) { }
        if (!Number.isFinite(config.dailyLimit) || (config.dailyLimit !== 0 && config.dailyLimit < 5)) config.dailyLimit = 20;
        if (config.dailyLimit > 500) config.dailyLimit = 500;
        if (!config.groupSize) config.groupSize = 'auto';
        if (typeof config.shuffleMode !== 'boolean') config.shuffleMode = true;
        if (!['two-column', 'custom'].includes(config.layoutMode)) config.layoutMode = 'two-column';
        if (typeof config.allowSameColumn !== 'boolean') config.allowSameColumn = false;
        config.customRows = Math.max(2, Math.min(10, parseInt(config.customRows) || 4));
        config.customColumns = Math.max(2, Math.min(10, parseInt(config.customColumns) || 4));
        if ((config.customRows * config.customColumns) % 2 !== 0) {
            config.customColumns += config.customColumns < 10 ? 1 : -1;
        }
        config.wordRangeStart = Math.max(1, parseInt(config.wordRangeStart) || 1);
        config.wordRangeEnd = Math.max(0, parseInt(config.wordRangeEnd) || 0);
        config.interfaceOpacity = Math.max(0.2, Math.min(1, Number(config.interfaceOpacity) || 1));
        config.masterVolume = Math.max(0, Math.min(1, Number(config.masterVolume)));
        if (!Number.isFinite(config.masterVolume)) config.masterVolume = 1;
        if (!config.bankName) config.bankName = '未导入词库';
        if (!ACCENT_THEMES.includes(config.accentTheme)) {
            config.accentTheme = 'blue';
        }
        if (!validColor(config.accentColor)) config.accentColor = '#bee4ff';
        if (!validBackgroundImage(config.backgroundImage)) config.backgroundImage = '';
    };
    const saveConfig = () => {
        try {
            const persistedConfig = { ...config };
            if (!StorageModule.getStatus().fallbackMode) delete persistedConfig.backgroundImage;
            localStorage.setItem(STORAGE_CONFIG, JSON.stringify(persistedConfig));
            return true;
        } catch (e) {
            return false;
        }
    };

    const loadDailyStat = () => {
        try {
            const saved = localStorage.getItem(STORAGE_STAT);
            if (saved) {
                const stat = JSON.parse(saved);
                if (stat.date === getTodayStr()) { dailyStat = stat; return; }
            }
        } catch (e) { }
        dailyStat = { date: getTodayStr(), target: config.dailyLimit, learnedIds: [] };
    };
    const saveDailyStat = () => localStorage.setItem(STORAGE_STAT, JSON.stringify(dailyStat));

    const loadWordErrorCounts = async () => {
        try {
            const saved = await StorageModule.getValue('wordErrorCounts');
            wordErrorCounts = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
        } catch (e) {
            wordErrorCounts = {};
        }
    };

    const saveWordErrorCounts = async () => {
        try {
            await StorageModule.setValue('wordErrorCounts', wordErrorCounts);
            return true;
        } catch (e) {
            return false;
        }
    };

    const clearWordErrorCounts = async () => {
        wordErrorCounts = {};
        try {
            await StorageModule.setValue('wordErrorCounts', {});
            return true;
        } catch (e) {
            return false;
        }
    };

    const recordWordError = (wordId) => {
        wordErrorCounts[wordId] = (Number(wordErrorCounts[wordId]) || 0) + 1;
        saveWordErrorCounts();
    };

    // ---------- 会话快照 ----------
    const saveSessionState = () => {
        if (!sessionActive) { clearSessionState(); return; }
        try {
            localStorage.setItem(STORAGE_SESSION, JSON.stringify({
                date: getTodayStr(),
                queuePlanVersion: SESSION_QUEUE_VERSION,
                sessionActive: true,
                sessionMode,
                wrongReviewTotal,
                wrongReviewCompletedIds: Array.from(wrongReviewCompletedIds),
                retryPendingIds: Array.from(retryPendingIds),
                groupWrongIds: Array.from(groupWrongIds),
                currentCompanionIds: Array.from(currentCompanionIds),
                recentGroupWordIds,
                todayQueueIds: todayQueue.map(w => w.id),
                timerEnabled,
                sessionStartedAt,
                gameSnapshot: GameModule.getSnapshot()
            }));
        } catch (e) { }
    };
    const clearSessionState = () => {
        try { localStorage.removeItem(STORAGE_SESSION); } catch (e) { }
    };

    const tryRestoreSession = () => {
        let saved = null;
        try { saved = localStorage.getItem(STORAGE_SESSION); } catch (e) { return false; }
        if (!saved) return false;

        let state = null;
        try { state = JSON.parse(saved); } catch (e) { clearSessionState(); return false; }
        if (!state || state.date !== getTodayStr() || !state.sessionActive) {
            clearSessionState(); return false;
        }
        if (state.queuePlanVersion !== SESSION_QUEUE_VERSION) {
            clearSessionState();
            return false;
        }

        const allWords = DataModule.getWords();
        if (allWords.length === 0) { clearSessionState(); return false; }

        const map = new Map(allWords.map(w => [w.id, w]));
        todayQueue = (state.todayQueueIds || []).map(id => map.get(id)).filter(Boolean);
        sessionMode = state.sessionMode === 'wrong' ? 'wrong' : 'daily';
        wrongReviewTotal = sessionMode === 'wrong' ? Number(state.wrongReviewTotal) || 0 : 0;
        wrongReviewCompletedIds = new Set(
            sessionMode === 'wrong' && Array.isArray(state.wrongReviewCompletedIds)
                ? state.wrongReviewCompletedIds.filter(id => map.has(id))
                : []
        );
        retryPendingIds = new Set(
            Array.isArray(state.retryPendingIds)
                ? state.retryPendingIds.filter(id => map.has(id))
                : []
        );
        groupWrongIds = new Set(
            Array.isArray(state.groupWrongIds)
                ? state.groupWrongIds.filter(id => map.has(id))
                : []
        );
        currentCompanionIds = new Set(
            Array.isArray(state.currentCompanionIds)
                ? state.currentCompanionIds.filter(id => map.has(id))
                : []
        );
        recentGroupWordIds = Array.isArray(state.recentGroupWordIds)
            ? state.recentGroupWordIds.filter(id => map.has(id))
            : [];

        sessionActive = true;
        startSessionTimer(!!state.timerEnabled, state.sessionStartedAt);
        if (els.timerEnabledCheckbox) els.timerEnabledCheckbox.checked = !!state.timerEnabled;
        els.welcomeOverlay.classList.remove('show');
        els.homeOverlay.classList.remove('show');
        els.infoBar.style.display = 'flex';
        if (els.backHomeBtn) els.backHomeBtn.style.display = '';

        if (sessionMode === 'daily' && dailyStat.date === getTodayStr() &&
            getDailyLearnedCount() >= getEffectiveDailyTarget() &&
            getDailyLearnedCount() > 0) {
            showHomeScreen();
            return true;
        }

        const snapshot = state.gameSnapshot;
        const snapshotCards = snapshot?.layoutMode === 'custom'
            ? snapshot.customCards
            : snapshot?.leftCards;
        const hasValidSnapshot = snapshot &&
            Array.isArray(snapshot.currentGroupIds) && snapshot.currentGroupIds.length > 0 &&
            Array.isArray(snapshotCards) && snapshotCards.length > 0 &&
            snapshot.currentGroupIds.every(id => map.has(id));

        if (!hasValidSnapshot) {
            if (todayQueue.length > 0) loadNextGroup();
            else if (sessionMode === 'wrong') finishWrongReview();
            else startSession();
            return true;
        }

        const snapshotCompleted = snapshot.layoutMode === 'custom'
            ? snapshot.customCards.every(c => c.matched)
            : snapshot.leftCards.every(c => c.matched) && snapshot.rightCards.every(c => c.matched);

        if (snapshotCompleted) {
            rememberCompletedGroup(snapshot.currentGroupIds);
            updateInfoBar();
            loadNextGroup();
            return true;
        }

        GameModule.restoreSnapshot(snapshot, allWords);
        updateInfoBar();
        return true;
    };

