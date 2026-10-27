// ==========================================
// 1. 数据层 (DataModule)
// ==========================================
const DataModule = (() => {
    let wordBank = [];
    const generateId = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

    const createWord = (front, back) => ({
        id: generateId(), front, back,
        ease: 2.5, interval: 0, dueDate: Date.now(),
        stability: null, difficulty: null,
        state: 'new', stepIndex: 0, lastReview: null
    });

    const load = () => {
        let saved = null;
        try { saved = localStorage.getItem('ankiMatchData'); } catch (e) { }
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                wordBank = Array.isArray(parsed) ? parsed : [];
            } catch (e) { wordBank = []; }
        } else { wordBank = []; }
        save();
    };

    const save = () => {
        try {
            localStorage.setItem('ankiMatchData', JSON.stringify(wordBank));
            return true;
        } catch (e) {
            return false;
        }
    };

    const reset = () => {
        wordBank = wordBank.map(w => createWord(w.front, w.back));
        save();
    };

    const splitLogicalRecords = (text) => {
        const records = [];
        let current = '';
        let inQuote = false;
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === '"') {
                current += char;
                if (inQuote && text[i + 1] === '"') {
                    current += text[i + 1];
                    i += 1;
                } else {
                    inQuote = !inQuote;
                }
                continue;
            }
            if (!inQuote && (char === '\n' || char === '\r')) {
                records.push(current);
                current = '';
                if (char === '\r' && text[i + 1] === '\n') i += 1;
                continue;
            }
            current += char;
        }
        if (current || text.endsWith('\n') || text.endsWith('\r')) records.push(current);
        return records;
    };

    const parseDelimitedRecord = (record, delimiter) => {
        const cells = [];
        let current = '';
        let inQuote = false;
        for (let i = 0; i < record.length; i++) {
            const char = record[i];
            if (char === '"') {
                if (inQuote && record[i + 1] === '"') {
                    current += '"';
                    i += 1;
                } else {
                    inQuote = !inQuote;
                }
            } else if (!inQuote && char === delimiter) {
                cells.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        cells.push(current);
        return cells;
    };

    const findUnquotedDelimiter = (record, delimiter) => {
        let inQuote = false;
        for (let i = 0; i < record.length; i++) {
            const char = record[i];
            if (char === '"') {
                if (inQuote && record[i + 1] === '"') i += 1;
                else inQuote = !inQuote;
            } else if (!inQuote && char === delimiter) {
                return i;
            }
        }
        return -1;
    };

    const containsHan = value => /[\u3400-\u9fff]/.test(value);
    const containsLatin = value => /[A-Za-z]/.test(value);
    const cleanCell = value => String(value || '')
        .replace(/^\uFEFF/, '')
        .replace(/\u00a0/g, ' ')
        .replace(/<[^>]+>/g, '')
        .trim();

    const splitVocabularyRecord = (record) => {
        const trimmed = record.replace(/^\uFEFF/, '').trim();
        if (!trimmed) return null;

        const tabIndex = findUnquotedDelimiter(trimmed, '\t');
        const commaCandidates = [',', '，']
            .map(delimiter => ({ delimiter, index: findUnquotedDelimiter(trimmed, delimiter) }))
            .filter(item => item.index >= 0)
            .sort((a, b) => a.index - b.index);
        const delimiter = tabIndex >= 0 ? '\t' : commaCandidates[0]?.delimiter;
        if (delimiter) {
            const cells = parseDelimitedRecord(trimmed, delimiter);
            return [cells[0], cells.slice(1).join(delimiter)];
        }

        const wideSpace = trimmed.match(/[ \u3000]{2,}/);
        if (wideSpace && wideSpace.index != null) {
            const splitAt = wideSpace.index;
            return [trimmed.slice(0, splitAt), trimmed.slice(splitAt + wideSpace[0].length)];
        }

        const firstHanIndex = trimmed.search(/[\u3400-\u9fff]/);
        if (firstHanIndex > 0) {
            return [trimmed.slice(0, firstHanIndex), trimmed.slice(firstHanIndex)];
        }

        if (firstHanIndex === 0) {
            const latinMatch = trimmed.match(/[A-Za-z]/);
            if (latinMatch && latinMatch.index > 0) {
                return [trimmed.slice(latinMatch.index), trimmed.slice(0, latinMatch.index)];
            }
        }
        return null;
    };

    const isHeaderPair = (front, back) => {
        const frontHeaders = new Set(['word', 'front', 'term', 'vocabulary', '单词', '英文', '词汇']);
        const backHeaders = new Set(['meaning', 'back', 'definition', 'translation', '释义', '中文', '翻译', '意思']);
        return frontHeaders.has(front.toLowerCase()) && backHeaders.has(back.toLowerCase());
    };

    const parseVocabularyText = (text) => {
        const records = splitLogicalRecords(String(text || ''));
        const words = [];
        const invalidRecords = [];
        const seen = new Set();
        let duplicateCount = 0;
        let headerCount = 0;

        records.forEach((record, index) => {
            if (!record.trim()) return;
            const pair = splitVocabularyRecord(record);
            if (!pair) {
                invalidRecords.push(index + 1);
                return;
            }

            let front = cleanCell(pair[0]);
            let back = cleanCell(pair[1]);
            if (containsHan(front) && !containsLatin(front) && containsLatin(back)) {
                [front, back] = [back, front];
            }
            if (!front || !back) {
                invalidRecords.push(index + 1);
                return;
            }
            if (isHeaderPair(front, back)) {
                headerCount += 1;
                return;
            }

            const duplicateKey = `${front.toLocaleLowerCase('en')}\u0000${back}`;
            if (seen.has(duplicateKey)) {
                duplicateCount += 1;
                return;
            }
            seen.add(duplicateKey);
            words.push(createWord(front, back));
        });

        return { words, invalidRecords, duplicateCount, headerCount };
    };

    const parseTSV = text => parseVocabularyText(text).words;

    const createWordsFromPairs = (pairs) => {
        const words = [];
        const seen = new Set();
        (Array.isArray(pairs) ? pairs : []).forEach(pair => {
            const front = cleanCell(pair?.front ?? pair?.[0]);
            const back = cleanCell(pair?.back ?? pair?.[1]);
            if (!front || !back) return;
            const duplicateKey = `${front.toLocaleLowerCase('en')}\u0000${back}`;
            if (seen.has(duplicateKey)) return;
            seen.add(duplicateKey);
            words.push(createWord(front, back));
        });
        return words;
    };

    const updateWordState = (updatedWord) => {
        const idx = wordBank.findIndex(w => w.id === updatedWord.id);
        if (idx !== -1) { wordBank[idx] = updatedWord; save(); }
    };

    return {
        load, save, reset, parseTSV, parseVocabularyText, createWordsFromPairs, updateWordState,
        setWordBank: (newWords) => {
            const previousWords = wordBank;
            wordBank = newWords;
            if (save()) return true;
            wordBank = previousWords;
            return false;
        },
        removeWord: (wordId) => {
            const previousWords = wordBank;
            const originalLength = wordBank.length;
            wordBank = wordBank.filter(word => word.id !== wordId);
            if (wordBank.length === originalLength) return false;
            if (!save()) {
                wordBank = previousWords;
                return false;
            }
            return true;
        },
        getWords: () => wordBank
    };
})();


// ==========================================
// 2. 音效层 (AudioModule)
// ==========================================
const AudioModule = (() => {
    const sources = {
        click: 'audio/audio-click.mp3',
        correct: 'audio/audio-correct.mp3',
        wrong: 'audio/audio-wrong.mp3',
        switch: 'audio/audio-pageswitch.mp3'
    };
    const players = {};

    const getPlayer = (name) => {
        if (!sources[name]) return null;
        if (!players[name]) {
            const player = new Audio(sources[name]);
            player.preload = 'auto';
            players[name] = player;
        }
        return players[name];
    };

    const play = (name) => {
        const player = getPlayer(name);
        if (!player) return;
        try {
            player.pause();
            player.currentTime = 0;
            const promise = player.play();
            if (promise && typeof promise.catch === 'function') promise.catch(() => { });
        } catch (e) { }
    };

    const bindGlobalButtonSound = () => {
        document.addEventListener('click', event => {
            const button = event.target.closest && event.target.closest('button');
            if (button && !button.disabled) play('click');
        }, true);
    };

    const preload = () => Object.keys(sources).forEach(getPlayer);

    return { play, preload, bindGlobalButtonSound };
})();


// ==========================================
// 3. 游戏层 (GameModule)
// ==========================================
const GameModule = (() => {
    let currentGroup = [];
    let leftCards = [];
    let rightCards = [];
    let selectedCardEl = null;
    let selectedWordObj = null;
    let onCardMatchCallback = null;
    let onGroupCompleteCallback = null;

    const board = document.getElementById('board');
    const colLeft = document.getElementById('colLeft');
    const colRight = document.getElementById('colRight');

    const init = (onMatch, onComplete) => {
        onCardMatchCallback = onMatch;
        onGroupCompleteCallback = onComplete;
    };

    const loadGroup = (groupWords) => {
        currentGroup = [...groupWords];
        selectedCardEl = null;
        selectedWordObj = null;
        leftCards = [];
        rightCards = [];

        const shuffled = [...groupWords].sort(() => 0.5 - Math.random());
        const N = shuffled.length;
        const leftChineseCount = Math.ceil(N / 2);

        for (let i = 0; i < N; i++) {
            const word = shuffled[i];
            if (i < leftChineseCount) {
                leftCards.push({ word, type: 'front', matched: false });
                rightCards.push({ word, type: 'back', matched: false });
            } else {
                leftCards.push({ word, type: 'back', matched: false });
                rightCards.push({ word, type: 'front', matched: false });
            }
        }
        leftCards.sort(() => 0.5 - Math.random());
        rightCards.sort(() => 0.5 - Math.random());
        renderBoard();
    };

    const restoreSnapshot = (snapshot, allWords) => {
        const map = new Map(allWords.map(w => [w.id, w]));
        const resolve = (c) => {
            const word = map.get(c.id);
            return word ? { word, type: c.type, matched: !!c.matched } : null;
        };
        currentGroup = (snapshot.currentGroupIds || []).map(id => map.get(id)).filter(Boolean);
        leftCards = (snapshot.leftCards || []).map(resolve).filter(Boolean);
        rightCards = (snapshot.rightCards || []).map(resolve).filter(Boolean);
        selectedCardEl = null;
        selectedWordObj = null;
        renderBoard();
    };

    const getSnapshot = () => ({
        currentGroupIds: currentGroup.map(w => w.id),
        leftCards: leftCards.map(c => ({ id: c.word.id, type: c.type, matched: !!c.matched })),
        rightCards: rightCards.map(c => ({ id: c.word.id, type: c.type, matched: !!c.matched }))
    });

    const isGroupComplete = () =>
        leftCards.length > 0 &&
        leftCards.every(c => c.matched) &&
        rightCards.every(c => c.matched);

    const reset = () => {
        currentGroup = [];
        leftCards = [];
        rightCards = [];
        selectedCardEl = null;
        selectedWordObj = null;
        colLeft.innerHTML = '';
        colRight.innerHTML = '';
    };

    const createCardEl = (word, type) => {
        const div = document.createElement('div');
        div.className = 'card';
        div.dataset.id = word.id;
        div.dataset.type = type;
        div.textContent = type === 'front' ? word.front : word.back;
        div.addEventListener('click', () => handleCardClick(div, word, type));
        return div;
    };

    const renderBoard = () => {
        colLeft.innerHTML = '';
        colRight.innerHTML = '';
        const fragLeft = document.createDocumentFragment();
        const fragRight = document.createDocumentFragment();
        leftCards.forEach(c => { if (!c.matched) fragLeft.appendChild(createCardEl(c.word, c.type)); });
        rightCards.forEach(c => { if (!c.matched) fragRight.appendChild(createCardEl(c.word, c.type)); });
        colLeft.appendChild(fragLeft);
        colRight.appendChild(fragRight);
    };

    const markMatched = (wordId) => {
        leftCards.forEach(c => { if (c.word.id === wordId) c.matched = true; });
        rightCards.forEach(c => { if (c.word.id === wordId) c.matched = true; });
    };

    const handleCardClick = (cardEl, word, type) => {
        if (cardEl.classList.contains('matched') ||
            cardEl.classList.contains('error') ||
            cardEl.classList.contains('success')) return;

        if (!selectedCardEl) {
            selectedCardEl = cardEl;
            selectedWordObj = word;
            cardEl.classList.add('selected');
            return;
        }

        if (selectedCardEl === cardEl) {
            cardEl.classList.remove('selected');
            selectedCardEl = null;
            selectedWordObj = null;
            return;
        }

        const isSameColumn = selectedCardEl.parentNode === cardEl.parentNode;
        if (isSameColumn || selectedCardEl.dataset.type === type) {
            selectedCardEl.classList.remove('selected');
            selectedCardEl = cardEl;
            selectedWordObj = word;
            cardEl.classList.add('selected');
            return;
        }

        if (selectedCardEl.dataset.id === cardEl.dataset.id) {
            AudioModule.play('correct');
            cardEl.classList.remove('selected');
            selectedCardEl.classList.remove('selected');
            cardEl.classList.add('success');
            selectedCardEl.classList.add('success');

            markMatched(word.id);
            if (onCardMatchCallback) onCardMatchCallback(word, true, { primary: true });

            const el1 = cardEl;
            const el2 = selectedCardEl;
            selectedCardEl = null;
            selectedWordObj = null;

            setTimeout(() => {
                triggerExplosion(el1);
                triggerExplosion(el2);
                el1.classList.remove('success');
                el2.classList.remove('success');
                el1.classList.add('matched');
                el2.classList.add('matched');

                setTimeout(() => {
                    el1.remove();
                    el2.remove();
                    if (isGroupComplete()) {
                        if (onGroupCompleteCallback) setTimeout(() => onGroupCompleteCallback(), 250);
                    }
                }, 400);
            }, 300);

        } else {
            AudioModule.play('wrong');
            const firstCard = selectedCardEl;
            const firstWord = selectedWordObj;
            firstCard.classList.remove('selected');
            cardEl.classList.add('error');
            firstCard.classList.add('error');

            if (onCardMatchCallback) {
                onCardMatchCallback(firstWord, false, { primary: true });
                onCardMatchCallback(word, false, { primary: false });
            }

            const correctTarget = board.querySelector(`.card[data-id="${firstCard.dataset.id}"]:not(.error)`);
            if (correctTarget) correctTarget.classList.add('highlight');

            selectedCardEl = null;
            selectedWordObj = null;

            setTimeout(() => {
                cardEl.classList.remove('error');
                firstCard.classList.remove('error');
                if (correctTarget) correctTarget.classList.remove('highlight');
            }, 800);
        }
    };

    const triggerExplosion = (element) => {
        if (!element || !element.isConnected) return;
        const rect = element.getBoundingClientRect();
        const boardRect = board.getBoundingClientRect();
        const x = rect.left - boardRect.left - board.clientLeft + board.scrollLeft + rect.width / 2;
        const y = rect.top - boardRect.top - board.clientTop + board.scrollTop + rect.height / 2;

        for (let i = 0; i < 9; i++) {
            const star = document.createElement('img');
            star.className = 'star-particle';
            star.src = 'images/icon-stars.png';
            star.alt = '';
            star.style.left = `${x}px`;
            star.style.top = `${y}px`;
            const size = Math.random() * 14 + 15;
            star.style.width = `${size}px`;
            star.style.height = `${size}px`;

            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * 56 + 24;
            star.style.setProperty('--tx', `${Math.cos(angle) * distance}px`);
            star.style.setProperty('--ty', `${Math.sin(angle) * distance}px`);

            board.appendChild(star);
            setTimeout(() => star.remove(), 650);
        }
    };

    return { init, loadGroup, reset, restoreSnapshot, getSnapshot, isGroupComplete };
})();


// ==========================================
// 4. 主控层 (App)
// ==========================================
(() => {
    const STORAGE_CONFIG = 'ankiMatchConfig';
    const STORAGE_STAT = 'ankiMatchDailyStat';
    const STORAGE_SESSION = 'ankiMatchSession';
    const STORAGE_ERRORS = 'ankiMatchWordErrors';
    const STORAGE_ONBOARDING = 'ankiMatchOnboardingSeen';
    const SESSION_QUEUE_VERSION = 2;
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
        backgroundImage: ''
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

    const els = {};
    const getTodayStr = () => new Date().toDateString();
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

    // ---------- DOM 缓存 ----------
    const cacheElements = () => {
        els.infoBar = document.getElementById('infoBar');
        els.infoProgress = document.getElementById('infoProgress');
        els.infoProgressLabel = document.getElementById('infoProgressLabel');
        els.infoEstimate = document.getElementById('infoEstimate');
        els.infoDue = document.getElementById('infoDue');
        els.infoDays = document.getElementById('infoDays');
        els.backHomeBtn = document.getElementById('backHomeBtn');

        els.welcomeOverlay = document.getElementById('welcomeOverlay');
        els.welcomeBankInfo = document.getElementById('welcomeBankInfo');
        els.welcomeDailyLimit = document.getElementById('welcomeDailyLimit');
        els.welcomePreview = document.getElementById('welcomePreview');
        els.welcomeFileInput = document.getElementById('welcomeFileInput');
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
        els.wordSearchInput = document.getElementById('wordSearchInput');
        els.reviewAllWrongBtn = document.getElementById('reviewAllWrongBtn');
        els.exportVocabularyBtn = document.getElementById('exportVocabularyBtn');
        els.backgroundImageInput = document.getElementById('backgroundImageInput');
        els.clearBackgroundBtn = document.getElementById('clearBackgroundBtn');
        els.backgroundImageStatus = document.getElementById('backgroundImageStatus');
        els.shuffleModeCheckbox = document.getElementById('shuffleModeCheckbox');

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
    };

    // ---------- 配置持久化 ----------
    const loadConfig = () => {
        try {
            const saved = localStorage.getItem(STORAGE_CONFIG);
            if (saved) config = { ...config, ...JSON.parse(saved) };
        } catch (e) { }
        if (!Number.isFinite(config.dailyLimit) || config.dailyLimit < 5) config.dailyLimit = 20;
        if (config.dailyLimit > 500) config.dailyLimit = 500;
        if (!config.groupSize) config.groupSize = 'auto';
        if (typeof config.shuffleMode !== 'boolean') config.shuffleMode = true;
        if (!config.bankName) config.bankName = '未导入词库';
        if (!ACCENT_THEMES.includes(config.accentTheme)) {
            config.accentTheme = 'blue';
        }
        if (!validColor(config.accentColor)) config.accentColor = '#bee4ff';
        if (!validBackgroundImage(config.backgroundImage)) config.backgroundImage = '';
    };
    const saveConfig = () => {
        try {
            localStorage.setItem(STORAGE_CONFIG, JSON.stringify(config));
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

    const loadWordErrorCounts = () => {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_ERRORS) || '{}');
            wordErrorCounts = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
        } catch (e) {
            wordErrorCounts = {};
        }
    };

    const saveWordErrorCounts = () => {
        try { localStorage.setItem(STORAGE_ERRORS, JSON.stringify(wordErrorCounts)); } catch (e) { }
    };

    const clearWordErrorCounts = () => {
        wordErrorCounts = {};
        try { localStorage.removeItem(STORAGE_ERRORS); } catch (e) { }
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
        els.welcomeOverlay.classList.remove('show');
        els.homeOverlay.classList.remove('show');
        els.infoBar.style.display = 'flex';
        if (els.backHomeBtn) els.backHomeBtn.style.display = '';

        if (sessionMode === 'daily' && dailyStat.date === getTodayStr() &&
            dailyStat.learnedIds.length >= dailyStat.target &&
            dailyStat.learnedIds.length > 0) {
            showHomeScreen();
            return true;
        }

        const snapshot = state.gameSnapshot;
        const hasValidSnapshot = snapshot &&
            Array.isArray(snapshot.currentGroupIds) && snapshot.currentGroupIds.length > 0 &&
            Array.isArray(snapshot.leftCards) && snapshot.leftCards.length > 0 &&
            snapshot.currentGroupIds.every(id => map.has(id));

        if (!hasValidSnapshot) {
            if (todayQueue.length > 0) loadNextGroup();
            else if (sessionMode === 'wrong') finishWrongReview();
            else startSession();
            return true;
        }

        const snapshotCompleted =
            snapshot.leftCards.length > 0 &&
            snapshot.leftCards.every(c => c.matched) &&
            snapshot.rightCards.every(c => c.matched);

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

    // ---------- 主题 ----------
    const applyTheme = () => {
        const saved = localStorage.getItem('theme');
        const isDark = saved
            ? (saved === 'dark')
            : (new Date().getHours() < 7 || new Date().getHours() >= 18);
        setTheme(isDark ? 'dark' : 'light');
    };
    const setTheme = (theme) => {
        const isDark = theme === 'dark';
        document.body.classList.toggle('dark-mode', isDark);
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });
        if (document.body.dataset.accentTheme) {
            setAccentTheme(document.body.dataset.accentTheme,
                settingsDraft ? settingsDraft.accentColor : config.accentColor);
        }
    };

    const colorLuminance = values => values.map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);

    const adjustColorForBackground = (color, darkMode) => {
        const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
        if (darkMode) {
            while (colorLuminance(rgb) < 0.35) {
                rgb.forEach((value, index) => {
                    rgb[index] = Math.min(255, Math.round(value + (255 - value) * 0.12));
                });
            }
        } else {
            while (colorLuminance(rgb) > 0.18) {
                rgb.forEach((value, index) => { rgb[index] = Math.round(value * 0.9); });
            }
        }
        return `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`;
    };

    const getHue = color => {
        const [r, g, b] = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255);
        const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
        if (!delta) return 0;
        const sector = max === r ? ((g - b) / delta) % 6
            : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
        return (sector * 60 + 360) % 360;
    };

    const setAccentTheme = (theme, color = config.accentColor) => {
        const safeTheme = ACCENT_THEMES.includes(theme) ? theme : 'blue';
        const safeColor = validColor(color) ? color.toLowerCase() : '#bee4ff';
        const isDark = document.body.classList.contains('dark-mode');
        const baseColor = safeTheme === 'custom' ? safeColor : ACCENT_COLORS[safeTheme];
        const iconColor = adjustColorForBackground(baseColor, isDark);
        document.body.dataset.accentTheme = safeTheme;
        document.body.style.setProperty('--custom-page-fill', safeColor);
        document.body.style.setProperty('--custom-primary-color', adjustColorForBackground(safeColor, false));
        document.body.style.setProperty('--custom-dark-primary-color', adjustColorForBackground(safeColor, true));
        document.body.style.setProperty('--custom-close-filter', `hue-rotate(${Math.round(getHue(iconColor) - 198)}deg)`);
        const iconFlood = document.getElementById('themeIconFlood');
        if (iconFlood) iconFlood.setAttribute('flood-color', iconColor);
        document.querySelectorAll('.accent-theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.accentTheme === safeTheme);
        });
        const customPicker = document.getElementById('accentCustomPicker');
        const customColor = document.getElementById('accentCustomColor');
        if (customPicker) customPicker.classList.toggle('active', safeTheme === 'custom');
        if (customColor) customColor.value = safeColor;
    };

    const setBackgroundImage = (imageData = '') => {
        const safeImage = validBackgroundImage(imageData) ? imageData : '';
        document.body.classList.toggle('has-custom-background', !!safeImage);
        document.body.style.setProperty(
            '--custom-background-image',
            safeImage ? `url("${safeImage}")` : 'none'
        );
        if (els.backgroundImageStatus) {
            els.backgroundImageStatus.textContent = safeImage ? '已选择自定义背景' : '未设置背景';
        }
        if (els.clearBackgroundBtn) els.clearBackgroundBtn.disabled = !safeImage;
    };

    const compressBackgroundImage = file => new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith('image/')) {
            reject(new Error('invalid-image'));
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('read-failed'));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error('decode-failed'));
            image.onload = () => {
                const maxSide = 1600;
                const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
                const width = Math.max(1, Math.round(image.width * scale));
                const height = Math.max(1, Math.round(image.height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext('2d');
                if (!context) { reject(new Error('canvas-failed')); return; }
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, width, height);
                context.drawImage(image, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.78));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });

    // ---------- 统计 ----------
    const getUnlearnedCount = () => DataModule.getWords().filter(w => !w.lastReview).length;
    const getDueCount = () => {
        const now = Date.now();
        const learnedSet = new Set(dailyStat.learnedIds);
        return DataModule.getWords()
            .filter(w => w.lastReview && w.dueDate <= now && !learnedSet.has(w.id)).length;
    };
    const hasLearnableWords = () => {
        if (DataModule.getWords().length === 0) return false;
        const remaining = Math.max(0, dailyStat.target - dailyStat.learnedIds.length);
        if (remaining <= 0) return false;
        const now = Date.now();
        const learnedSet = new Set(dailyStat.learnedIds);
        const allWords = DataModule.getWords();
        if (allWords.some(w => w.dueDate <= now && !learnedSet.has(w.id))) return true;
        return allWords.some(w => !w.lastReview && !learnedSet.has(w.id));
    };

    // ---------- 首次使用引导 ----------
    const clearOnboardingTimers = () => {
        onboardingTimers.forEach(timer => clearTimeout(timer));
        onboardingTimers = [];
    };

    const renderOnboardingPage = () => {
        clearOnboardingTimers();
        const page = ONBOARDING_PAGES[onboardingPageIndex];
        els.onboardingTitle.textContent = page.title;
        els.onboardingLines.innerHTML = '';

        page.lines.forEach((line, index) => {
            const paragraph = document.createElement('p');
            paragraph.className = 'onboarding-line';
            if (onboardingPageIndex === 0 && index === 0) {
                paragraph.classList.add('onboarding-brand-line');
            }
            paragraph.textContent = line;
            els.onboardingLines.appendChild(paragraph);
            const timer = setTimeout(() => paragraph.classList.add('visible'), (index + 1) * 1000);
            onboardingTimers.push(timer);
        });

        const isLastPage = onboardingPageIndex === ONBOARDING_PAGES.length - 1;
        els.onboardingNextBtn.setAttribute('aria-label', isLastPage ? '完成介绍' : '下一页');
        onboardingTransitioning = false;
    };

    const showOnboarding = () => {
        onboardingPageIndex = 0;
        els.onboardingOverlay.hidden = false;
        document.body.classList.add('onboarding-active');
        els.onboardingOverlay.classList.add('show');
        renderOnboardingPage();
    };

    const finishOnboarding = () => {
        clearOnboardingTimers();
        try { localStorage.setItem(STORAGE_ONBOARDING, '1'); } catch (e) { }
        els.onboardingOverlay.classList.remove('show');
        document.body.classList.remove('onboarding-active');
        setTimeout(() => { els.onboardingOverlay.hidden = true; }, 300);
    };

    const showNextOnboardingPage = () => {
        if (onboardingTransitioning) return;
        if (onboardingPageIndex >= ONBOARDING_PAGES.length - 1) {
            finishOnboarding();
            return;
        }

        onboardingTransitioning = true;
        clearOnboardingTimers();
        els.onboardingLines.querySelectorAll('.onboarding-line').forEach(line => {
            line.classList.add('leaving');
        });
        const timer = setTimeout(() => {
            onboardingPageIndex += 1;
            renderOnboardingPage();
        }, 520);
        onboardingTimers.push(timer);
    };

    const shouldShowOnboarding = () => {
        try { return !config.initialized && localStorage.getItem(STORAGE_ONBOARDING) !== '1'; }
        catch (e) { return !config.initialized; }
    };

    // ---------- 欢迎页（新用户） ----------
    const showWelcomeScreen = () => {
        sessionActive = false;
        clearSessionState();
        GameModule.reset();
        document.body.classList.remove('home-view');
        els.homeOverlay.classList.remove('show');
        els.wordListOverlay.classList.remove('show');
        els.infoBar.style.display = 'none';
        if (els.backHomeBtn) els.backHomeBtn.style.display = 'none';
        els.welcomeOverlay.classList.add('show');

        if (dailyStat.date === getTodayStr() && dailyStat.learnedIds.length > 0) {
            els.welcomeDailyLimit.value = dailyStat.target;
        } else {
            els.welcomeDailyLimit.value = config.dailyLimit;
        }
        updateWelcomePreview();
    };

    const updateWelcomePreview = () => {
        const total = DataModule.getWords().length;
        let limit = parseInt(els.welcomeDailyLimit.value);
        if (isNaN(limit) || limit < 1) limit = 20;

        els.welcomeBankInfo.textContent = `当前词库：${total} 个词`;

        if (total === 0) {
            els.welcomePreview.innerHTML = '请先添加词书';
            return;
        }

        const days = Math.max(1, Math.ceil(total / limit));
        els.welcomePreview.innerHTML =
            `共 <b>${total}</b> 个词，每日学习 <b>${limit}</b> 个，预计 <b>${days}</b> 天完成一轮`;
    };

    const handleWelcomeStart = () => {
        if (DataModule.getWords().length === 0) {
            showToast('请先添加词书');
            return;
        }

        let limit = parseInt(els.welcomeDailyLimit.value);
        if (isNaN(limit) || limit < 5) limit = 5;
        if (limit > 500) limit = 500;
        els.welcomeDailyLimit.value = limit;

        config.dailyLimit = limit;
        config.initialized = true;
        saveConfig();

        if (dailyStat.date === getTodayStr()) {
            dailyStat.target = Math.max(limit, dailyStat.learnedIds.length);
        } else {
            dailyStat = { date: getTodayStr(), target: limit, learnedIds: [] };
        }
        saveDailyStat();

        syncDailyLimitSelect();
        els.welcomeOverlay.classList.remove('show');
        els.homeOverlay.classList.remove('show');
        document.body.classList.remove('home-view');
        els.infoBar.style.display = 'flex';
        if (els.backHomeBtn) els.backHomeBtn.style.display = '';
        startSession();
    };

    // ---------- 首页（老用户） ----------
    const showHomeScreen = () => {
        sessionActive = false;
        clearSessionState();
        GameModule.reset();
        document.body.classList.add('home-view');
        els.welcomeOverlay.classList.remove('show');
        els.wordListOverlay.classList.remove('show');
        els.infoBar.style.display = 'none';
        if (els.backHomeBtn) els.backHomeBtn.style.display = 'none';
        els.homeOverlay.classList.add('show');
        updateHomeScreen();
    };

    const RING_CIRCUMFERENCE = 2 * Math.PI * 44;

    const updateHomeScreen = () => {
        const learned = dailyStat.learnedIds.length;
        const target = dailyStat.target;
        const completed = learned >= target && learned > 0;
        const available = hasLearnableWords();

        // 1. 今日进度圆环
        els.homeTodayProgress.textContent = `${learned}/${target}`;
        const todayPct = target === 0 ? 0 : Math.min(1, learned / target);
        if (els.todayRingPath) {
            if (todayPct === 0) {
                els.todayRingPath.style.opacity = '0';
            } else {
                els.todayRingPath.style.opacity = '1';
                const offset = RING_CIRCUMFERENCE * (1 - todayPct);
                els.todayRingPath.style.strokeDashoffset = String(offset);
            }
        }

        // 2. 总进度圆环
        const allWords = DataModule.getWords();
        const totalWords = allWords.length;
        const learnedWords = allWords.filter(w => w.lastReview != null || w.state !== 'new').length;
        els.homeTotalProgress.textContent = `${learnedWords}/${totalWords}`;
        const totalPct = totalWords === 0 ? 0 : Math.min(1, learnedWords / totalWords);
        if (els.totalRingPath) {
            if (totalPct === 0) {
                els.totalRingPath.style.opacity = '0';
            } else {
                els.totalRingPath.style.opacity = '1';
                const offset = RING_CIRCUMFERENCE * (1 - totalPct);
                els.totalRingPath.style.strokeDashoffset = String(offset);
            }
        }

        // 3. 词库信息与剩余天数
        els.homeBookName.textContent = config.bankName || '未导入词库';
        const unlearnedCount = allWords.filter(w => !w.lastReview).length;
        const daysLeft = unlearnedCount === 0 ? 0 : Math.ceil(unlearnedCount / config.dailyLimit);
        els.homeBookDays.textContent = daysLeft === 0 ? '已完成本轮' : `剩余${daysLeft}天`;

        // 4. 按钮与提示信息
        if (totalWords === 0) {
            els.homeMessage.textContent = '请先添加词书';
            els.homeStartBtn.style.display = '';
            els.homeBonusBtn.style.display = 'none';
            return;
        }

        if (completed) {
            // 🎉 → icon-celebrate.png
            els.homeMessage.innerHTML = '<img class="emoji-icon icon-sm original-color-icon" src="images/icon-celebrate.png" alt="🎉"> 恭喜今日任务已完成！';
            els.homeStartBtn.style.display = 'none';
            els.homeBonusBtn.style.display = '';
        } else if (!available) {
            els.homeMessage.textContent = '今日可学单词已耗尽，明天再来吧！';
            els.homeStartBtn.style.display = 'none';
            els.homeBonusBtn.style.display = 'none';
        } else {
            els.homeMessage.textContent = '';
            els.homeStartBtn.style.display = '';
            els.homeBonusBtn.style.display = 'none';
        }
    };

    const initRings = () => {
        if (els.todayRingPath) {
            els.todayRingPath.style.strokeDasharray = String(RING_CIRCUMFERENCE);
            els.todayRingPath.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
        }
        if (els.totalRingPath) {
            els.totalRingPath.style.strokeDasharray = String(RING_CIRCUMFERENCE);
            els.totalRingPath.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
        }
    };

    // ---------- 全部单词页 ----------
    const getWordInitial = (word) => {
        const first = String(word.front || '').trim().charAt(0).toUpperCase();
        return /^[A-Z]$/.test(first) ? first : '#';
    };

    const getMasteryPercent = (word, now = Date.now()) => {
        if (!word.lastReview || word.state === 'new') return 0;

        const rawStability = Number(word.stability);
        const fallbackStability = Math.max(0.1, Number(word.interval) || 0.1);
        const stability = Number.isFinite(rawStability) && rawStability > 0
            ? rawStability
            : fallbackStability;
        const elapsedDays = Math.max(0, (now - Number(word.lastReview)) / (24 * 60 * 60 * 1000));
        const decay = 0.1542;
        const factor = Math.pow(0.9, -1 / decay) - 1;
        const retrievability = Math.pow(1 + factor * elapsedDays / stability, -decay);
        const stateFactor = {
            learning: 0.7,
            relearning: 0.45,
            review: 1
        }[word.state] || 0.6;

        return Math.max(0, Math.min(100, Math.round(retrievability * stateFactor * 100)));
    };

    const createWordRow = (word, now) => {
        const row = document.createElement('div');
        row.className = 'word-row';

        const wordCell = document.createElement('div');
        wordCell.className = 'word-cell';
        wordCell.textContent = word.front;

        const meaningCell = document.createElement('div');
        meaningCell.className = 'meaning-cell';
        meaningCell.textContent = word.back;

        const errorCell = document.createElement('div');
        errorCell.className = 'error-cell';
        errorCell.textContent = String(Number(wordErrorCounts[word.id]) || 0);

        const mastery = getMasteryPercent(word, now);
        const masteryCell = document.createElement('div');
        masteryCell.className = 'mastery-cell';
        masteryCell.title = `FSRS 估算掌握程度：${mastery}%`;

        const masteryTrack = document.createElement('div');
        masteryTrack.className = 'mastery-track';
        const masteryFill = document.createElement('div');
        masteryFill.className = 'mastery-fill';
        masteryFill.style.width = `${mastery}%`;
        masteryTrack.appendChild(masteryFill);

        const masteryValue = document.createElement('span');
        masteryValue.className = 'mastery-value';
        masteryValue.textContent = `${mastery}%`;

        masteryCell.append(masteryTrack, masteryValue);

        const actionCell = document.createElement('div');
        actionCell.className = 'word-action-cell';
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'word-delete-btn';
        deleteButton.textContent = '删除';
        deleteButton.setAttribute('aria-label', `删除单词 ${word.front}`);
        deleteButton.addEventListener('click', () => requestDeleteWord(word));
        actionCell.appendChild(deleteButton);

        row.append(wordCell, meaningCell, errorCell, masteryCell, actionCell);
        return row;
    };

    const requestDeleteWord = (word) => {
        openConfirmModal({
            title: '删除词汇',
            message: `确定删除“${word.front} — ${word.back}”吗？该词的学习进度和错误次数也会一并删除。`,
            confirmText: '确认删除',
            onConfirm: () => {
                if (!DataModule.removeWord(word.id)) return;
                delete wordErrorCounts[word.id];
                saveWordErrorCounts();
                dailyStat.learnedIds = dailyStat.learnedIds.filter(id => id !== word.id);
                saveDailyStat();
                todayQueue = todayQueue.filter(item => item.id !== word.id);
                wrongReviewCompletedIds.delete(word.id);
                retryPendingIds.delete(word.id);
                groupWrongIds.delete(word.id);
                currentCompanionIds.delete(word.id);
                recentGroupWordIds = recentGroupWordIds.filter(id => id !== word.id);
                clearSessionState();
                renderWordList();
                showToast(`已删除“${word.front}”`);
            }
        });
    };

    const escapeTSVCell = (value) => {
        const text = String(value || '');
        return /[\t\r\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const exportVocabularyAsTSV = () => {
        const words = DataModule.getWords();
        if (words.length === 0) {
            showToast('暂无可导出的词汇');
            return;
        }
        const rows = [
            '单词\t中文释义',
            ...words.map(word => `${escapeTSVCell(word.front)}\t${escapeTSVCell(word.back)}`)
        ];
        const safeBankName = String(config.bankName || '我的词库')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .trim() || '我的词库';
        const blob = new Blob([`\uFEFF${rows.join('\r\n')}`], { type: 'text/tab-separated-values;charset=utf-8' });
        const dataUrl = URL.createObjectURL(blob);
        const downloadAnchor = document.createElement('a');
        downloadAnchor.href = dataUrl;
        downloadAnchor.download = `${safeBankName}_词汇表.tsv`;
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        setTimeout(() => URL.revokeObjectURL(dataUrl), 1000);
        showToast(`已导出 ${words.length} 个词汇`);
    };

    const resetWordListScroll = () => {
        els.wordListScroll.scrollTop = 0;
    };

    const renderWordList = () => {
        const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
        const now = Date.now();
        const searchQuery = String(wordListSearchQuery || '').trim().normalize('NFKC').toLocaleLowerCase();
        let words = DataModule.getWords().filter(word => {
            if (wordListOnlyWrong && (Number(wordErrorCounts[word.id]) || 0) === 0) return false;
            if (!searchQuery) return true;
            const searchableText = `${word.front} ${word.back}`.normalize('NFKC').toLocaleLowerCase();
            return searchableText.includes(searchQuery);
        });

        words.sort((a, b) => {
            let result;
            if (wordListSortKey === 'errors') {
                result = (Number(wordErrorCounts[a.id]) || 0) - (Number(wordErrorCounts[b.id]) || 0);
                if (result === 0) result = collator.compare(a.front, b.front);
            } else {
                result = collator.compare(a.front, b.front);
                if (result === 0) result = collator.compare(a.back, b.back);
            }
            return wordListSortDirection === 'asc' ? result : -result;
        });

        els.wordList.replaceChildren();
        els.wordListEmpty.hidden = words.length > 0;
        const fragment = document.createDocumentFragment();
        let currentLetter = null;

        words.forEach(word => {
            const letter = getWordInitial(word);
            if (wordListSortKey === 'name' && letter !== currentLetter) {
                currentLetter = letter;
                const heading = document.createElement('div');
                heading.className = 'letter-group-title';
                heading.dataset.letterGroup = letter;
                heading.textContent = letter;
                fragment.appendChild(heading);
            }
            fragment.appendChild(createWordRow(word, now));
        });

        els.wordList.appendChild(fragment);
        const descending = wordListSortDirection === 'desc';
        els.wordSortDirectionLabel.textContent = descending ? '倒序' : '正序';
        els.wordSortDirectionIcon.classList.toggle('descending', descending);
        els.wordSortDirection.setAttribute('aria-pressed', String(wordListSortDirection === 'desc'));
        const wrongCount = DataModule.getWords().filter(word =>
            (Number(wordErrorCounts[word.id]) || 0) > 0).length;
        els.reviewAllWrongBtn.disabled = wrongCount === 0;
        els.reviewAllWrongBtn.title = wrongCount > 0 ? `复习 ${wrongCount} 个错词` : '当前没有错词';
    };

    const openWordList = () => {
        document.body.classList.remove('home-view');
        els.homeOverlay.classList.remove('show');
        els.infoBar.style.display = 'none';
        if (els.backHomeBtn) els.backHomeBtn.style.display = 'none';
        els.wordListOverlay.classList.add('show');
        renderWordList();
        resetWordListScroll();
    };

    const closeWordList = () => {
        els.wordListOverlay.classList.remove('show');
        showHomeScreen();
    };

    const handleHomeStart = () => {
        if (DataModule.getWords().length === 0) {
            showToast('请先添加词书');
            return;
        }
        els.homeOverlay.classList.remove('show');
        els.infoBar.style.display = 'flex';
        if (els.backHomeBtn) els.backHomeBtn.style.display = '';
        startSession();
    };

    const handleHomeBonus = () => {
        dailyStat.target += 10;
        saveDailyStat();
        updateInfoBar();
        els.homeOverlay.classList.remove('show');
        els.infoBar.style.display = 'flex';
        if (els.backHomeBtn) els.backHomeBtn.style.display = '';
        startSession();
    };

    const startWrongReview = () => {
        const wrongWords = DataModule.getWords()
            .filter(word => (Number(wordErrorCounts[word.id]) || 0) > 0)
            .sort((a, b) => (Number(wordErrorCounts[b.id]) || 0) -
                (Number(wordErrorCounts[a.id]) || 0));
        if (wrongWords.length === 0) {
            showToast('当前没有错词需要复习');
            return;
        }

        sessionMode = 'wrong';
        wrongReviewTotal = wrongWords.length;
        wrongReviewCompletedIds = new Set();
        retryPendingIds = new Set();
        groupWrongIds = new Set();
        currentCompanionIds = new Set();
        recentGroupWordIds = [];
        todayQueue = [...wrongWords];
        sessionActive = true;
        document.body.classList.remove('home-view');
        els.wordListOverlay.classList.remove('show');
        els.homeOverlay.classList.remove('show');
        els.infoBar.style.display = 'flex';
        if (els.backHomeBtn) els.backHomeBtn.style.display = '';
        updateInfoBar();
        loadNextGroup();
    };

    const finishWrongReview = () => {
        const completedTotal = wrongReviewTotal;
        sessionActive = false;
        todayQueue = [];
        GameModule.reset();
        clearSessionState();
        sessionMode = 'daily';
        wrongReviewTotal = 0;
        wrongReviewCompletedIds = new Set();
        retryPendingIds = new Set();
        groupWrongIds = new Set();
        currentCompanionIds = new Set();
        recentGroupWordIds = [];
        showHomeScreen();
        showToast(`已完成 ${completedTotal} 个错词的复习`);
    };

    // ---------- 返回首页 ----------
    const returnToHome = () => {
        sessionActive = false;
        todayQueue = [];
        sessionMode = 'daily';
        wrongReviewTotal = 0;
        wrongReviewCompletedIds = new Set();
        retryPendingIds = new Set();
        groupWrongIds = new Set();
        currentCompanionIds = new Set();
        recentGroupWordIds = [];
        GameModule.reset();
        clearSessionState();
        showHomeScreen();
    };

    // ---------- 会话与队列 ----------
    const shuffledCopy = words => {
        const shuffled = [...words];
        for (let index = shuffled.length - 1; index > 0; index--) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
        }
        return shuffled;
    };

    const startSession = () => {
        document.body.classList.remove('home-view');
        sessionMode = 'daily';
        wrongReviewTotal = 0;
        wrongReviewCompletedIds = new Set();
        retryPendingIds = new Set();
        groupWrongIds = new Set();
        currentCompanionIds = new Set();
        recentGroupWordIds = [];
        sessionActive = true;
        els.infoBar.style.display = 'flex';
        if (els.backHomeBtn) els.backHomeBtn.style.display = '';
        updateInfoBar();

        const remaining = Math.max(0, dailyStat.target - dailyStat.learnedIds.length);
        if (remaining === 0) { returnToHome(); return; }

        const allWords = DataModule.getWords();
        if (allWords.length === 0) {
            showToast('请先添加词书');
            returnToHome();
            return;
        }

        const now = Date.now();
        const learnedSet = new Set(dailyStat.learnedIds);

        let pool = allWords.filter(w => w.dueDate <= now && !learnedSet.has(w.id));
        if (pool.length < remaining) {
            const newWords = allWords.filter(w =>
                !w.lastReview && !learnedSet.has(w.id) && !pool.some(p => p.id === w.id));
            pool = pool.concat(newWords);
        }

        const plannedPool = config.shuffleMode ? shuffledCopy(pool) : pool;
        todayQueue = plannedPool.slice(0, remaining);

        if (todayQueue.length === 0) { returnToHome(); return; }
        loadNextGroup();
    };

    // 自动算出不需要翻页的当前屏幕显示的数量（单词数）
    const calcAutoGroupSize = () => {
        const boardEl = document.getElementById('board');
        if (!boardEl) return 6;

        let boardHeight = boardEl.clientHeight;
        if (boardHeight <= 0) {
            boardHeight = window.innerHeight - 150;
        }

        const isMobile = window.innerWidth <= 600;
        const cardHeight = isMobile ? 70 : 80;
        const cardMarginBottom = isMobile ? 10 : 15;
        const totalCardHeight = cardHeight + cardMarginBottom;

        const paddingVertical = isMobile ? 20 : 30;
        const usableHeight = boardHeight - paddingVertical;

        let cardsPerCol = Math.floor(usableHeight / totalCardHeight);
        if (cardsPerCol < 2) cardsPerCol = 2;

        let autoSize = cardsPerCol;
        autoSize = Math.max(2, Math.min(autoSize, 15));
        return autoSize;
    };

    const getGroupSize = () => {
        if (config.groupSize === 'auto') {
            return calcAutoGroupSize();
        }
        const size = parseInt(config.groupSize);
        return isNaN(size) ? calcAutoGroupSize() : size;
    };

    const rememberCompletedGroup = (wordIds = []) => {
        const validIds = new Set(DataModule.getWords().map(word => word.id));
        recentGroupWordIds = [...new Set([
            ...wordIds.filter(id => validIds.has(id)),
            ...recentGroupWordIds.filter(id => validIds.has(id))
        ])].slice(0, Math.max(12, getGroupSize() * 3));
    };

    const mixRetryGroupWithCompanions = (currentGroup, groupSize, allWords) => {
        if (!currentGroup.some(word => retryPendingIds.has(word.id))) return currentGroup;

        const groupIds = new Set(currentGroup.map(word => word.id));
        const hasFreshWord = currentGroup.some(word => !retryPendingIds.has(word.id));

        if (!hasFreshWord && currentGroup.length >= groupSize && groupSize > 1) {
            const deferredRetry = currentGroup.pop();
            groupIds.delete(deferredRetry.id);
            todayQueue.unshift(deferredRetry);
        }

        const wordMap = new Map(allWords.map(word => [word.id, word]));
        for (const wordId of recentGroupWordIds) {
            if (currentGroup.length >= groupSize) break;
            if (groupIds.has(wordId) || retryPendingIds.has(wordId)) continue;
            const companion = wordMap.get(wordId);
            if (!companion) continue;
            currentGroup.push(companion);
            groupIds.add(wordId);
            currentCompanionIds.add(wordId);
        }
        return currentGroup;
    };

    const loadNextGroup = () => {
        if (!sessionActive) return;
        if (todayQueue.length === 0) {
            if (sessionMode === 'wrong') finishWrongReview();
            else if (dailyStat.learnedIds.length >= dailyStat.target) returnToHome();
            else startSession();
            return;
        }

        const groupSize = getGroupSize();
        let currentGroup = todayQueue.splice(0, groupSize);
        groupWrongIds = new Set();
        currentCompanionIds = new Set();
        const allWords = DataModule.getWords();
        currentGroup = mixRetryGroupWithCompanions(currentGroup, groupSize, allWords);
        const wordsToRender = currentGroup.map(w =>
            allWords.find(dbWord => dbWord.id === w.id) || w);

        GameModule.loadGroup(wordsToRender);
        saveSessionState();
    };

    // ---------- 卡片结果 ----------
    const queueWordForSessionRetry = (word) => {
        retryPendingIds.add(word.id);
        if (!todayQueue.some(queuedWord => queuedWord.id === word.id)) {
            const insertAt = Math.min(todayQueue.length, Math.max(0, getGroupSize() - 1));
            todayQueue.splice(insertAt, 0, word);
        }
    };

    const completeLearnedWord = (wordId) => {
        if (sessionMode === 'wrong') {
            wrongReviewCompletedIds.add(wordId);
        } else if (!dailyStat.learnedIds.includes(wordId)) {
            dailyStat.learnedIds.push(wordId);
            saveDailyStat();
        }
    };

    const handleCardResult = (word, isCorrect, meta = {}) => {
        const latest = DataModule.getWords().find(w => w.id === word.id) || word;
        const isPrimary = meta.primary !== false;

        if (isCorrect) {
            if (!currentCompanionIds.has(latest.id) && !groupWrongIds.has(latest.id)) {
                const isSessionRetry = retryPendingIds.has(latest.id);
                const updated = AlgoModule.updateCard(latest, true, {
                    graduateToDays: isSessionRetry
                });
                DataModule.updateWordState(updated);
                if (isSessionRetry) retryPendingIds.delete(latest.id);
                completeLearnedWord(latest.id);
            }
        } else if (isPrimary) {
            recordWordError(latest.id);
            const updated = AlgoModule.updateCard(latest, false);
            DataModule.updateWordState(updated);
            groupWrongIds.add(latest.id);
            queueWordForSessionRetry(updated);
        }

        updateInfoBar();
        saveSessionState();
    };

    const handleGroupComplete = () => {
        if (!sessionActive) return;
        rememberCompletedGroup(GameModule.getSnapshot().currentGroupIds);
        updateInfoBar();
        if (sessionMode === 'wrong') {
            if (todayQueue.length === 0) finishWrongReview();
            else {
                AudioModule.play('switch');
                loadNextGroup();
            }
        } else if (dailyStat.learnedIds.length >= dailyStat.target) {
            returnToHome();
        } else {
            if (todayQueue.length > 0 || hasLearnableWords()) {
                AudioModule.play('switch');
                loadNextGroup();
            } else {
                returnToHome();
            }
        }
    };

    // ---------- 信息栏 ----------
    const updateInfoBar = () => {
        if (sessionMode === 'wrong') {
            els.infoProgressLabel.textContent = '错词';
            els.infoProgress.textContent = `${wrongReviewCompletedIds.size} / ${wrongReviewTotal}`;
            els.infoEstimate.style.display = 'none';
            return;
        }
        els.infoProgressLabel.textContent = '今日';
        els.infoEstimate.style.display = '';
        els.infoProgress.textContent = `${dailyStat.learnedIds.length} / ${dailyStat.target}`;
        if (els.infoDue) els.infoDue.textContent = String(getDueCount());
        const unlearned = getUnlearnedCount();
        const days = unlearned === 0 ? 0 : Math.ceil(unlearned / config.dailyLimit);
        els.infoDays.textContent = String(days);
    };

    // ---------- 每日学习量变更 ----------
    const applyDailyLimitChange = (newLimit) => {
        config.dailyLimit = newLimit;
        saveConfig();

        if (newLimit > dailyStat.target) {
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

    // ---------- 窗口大小变化监听 ----------
    const handleResize = debounce(() => {
        const newAutoSize = calcAutoGroupSize();
        syncGroupSizeSelect(settingsDraft ? settingsDraft.groupSize : config.groupSize);

        if (sessionActive && config.groupSize === 'auto') {
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
            backgroundImage: config.backgroundImage
        };
        syncGroupSizeSelect(settingsDraft.groupSize);
        syncDailyLimitSelect(settingsDraft.dailyLimit);
        els.shuffleModeCheckbox.checked = settingsDraft.shuffleMode;
        setAccentTheme(settingsDraft.accentTheme, settingsDraft.accentColor);
        setBackgroundImage(settingsDraft.backgroundImage);
        document.getElementById('settingsModal').classList.add('show');
    };
    const closeSettings = () => {
        setAccentTheme(config.accentTheme, config.accentColor);
        setBackgroundImage(config.backgroundImage);
        settingsDraft = null;
        document.getElementById('settingsModal').classList.remove('show');
        syncGroupSizeSelect(config.groupSize);
        syncDailyLimitSelect(config.dailyLimit);
        els.shuffleModeCheckbox.checked = config.shuffleMode;
    };
    const confirmSettings = () => {
        if (!settingsDraft) { closeSettings(); return; }
        const newGroup = settingsDraft.groupSize;
        const newLimit = settingsDraft.dailyLimit;
        const newShuffleMode = settingsDraft.shuffleMode;
        const newAccentTheme = settingsDraft.accentTheme;
        const newBackgroundImage = settingsDraft.backgroundImage;
        const previousBackgroundImage = config.backgroundImage;
        const groupChanged = newGroup !== config.groupSize;
        const limitChanged = newLimit !== config.dailyLimit;
        const shuffleChanged = newShuffleMode !== config.shuffleMode;
        const accentChanged = newAccentTheme !== config.accentTheme ||
            (newAccentTheme === 'custom' && settingsDraft.accentColor !== config.accentColor);
        const backgroundChanged = newBackgroundImage !== config.backgroundImage;

        config.groupSize = newGroup;
        config.shuffleMode = newShuffleMode;
        config.accentTheme = newAccentTheme;
        config.accentColor = settingsDraft.accentColor;
        config.backgroundImage = newBackgroundImage;
        if (!saveConfig()) {
            config.backgroundImage = previousBackgroundImage;
            settingsDraft.backgroundImage = previousBackgroundImage;
            saveConfig();
            setBackgroundImage(previousBackgroundImage);
            showToast('背景图片存储失败，请选择尺寸更小的图片');
            return;
        }
        if (limitChanged) applyDailyLimitChange(newLimit);
        setAccentTheme(config.accentTheme);
        setBackgroundImage(config.backgroundImage);
        closeSettings();

        if (groupChanged || limitChanged || shuffleChanged || accentChanged || backgroundChanged) showToast('设置已保存');
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

    // ---------- 词库导入 ----------
    const commitWordBankImport = (newWords, fileName, message) => {
        if (!DataModule.setWordBank(newWords)) {
            showToast('本地存储空间不足，请先移除自定义背景或缩小词库');
            return false;
        }
        clearWordErrorCounts();
        clearSessionState();
        config.bankName = fileName || '我的词库';
        saveConfig();
        dailyStat = { date: getTodayStr(), target: config.dailyLimit, learnedIds: [] };
        saveDailyStat();
        closeSettings();

        if (els.welcomeOverlay.classList.contains('show')) updateWelcomePreview();
        else showWelcomeScreen();
        showToast(message || `成功导入 ${newWords.length} 个单词`);
        return true;
    };

    const readFileArrayBuffer = (file) => {
        if (file && typeof file.arrayBuffer === 'function') return file.arrayBuffer();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('read-failed'));
            reader.onload = event => resolve(event.target.result);
            reader.readAsArrayBuffer(file);
        });
    };

    const getSheetColumnCount = sheet => Math.max(
        1,
        ...sheet.rows.slice(0, 3000).map(row => row.cells.length)
    );

    const fillColumnSelect = (select, columnCount) => {
        select.replaceChildren();
        for (let index = 0; index < columnCount; index++) {
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = `${XLSXImportModule.columnName(index)} 列`;
            select.appendChild(option);
        }
    };

    const renderXlsxPreview = () => {
        if (!xlsxImportDraft) return;
        const sheetIndex = Number(els.xlsxSheetSelect.value) || 0;
        const sheet = xlsxImportDraft.workbook.sheets[sheetIndex];
        if (!sheet) return;
        const analysis = XLSXImportModule.analyzeSheet(sheet, {
            startRow: Math.max(1, Number(els.xlsxStartRow.value) || 1),
            frontColumn: Number(els.xlsxFrontColumn.value) || 0,
            backColumn: Number(els.xlsxBackColumn.value) || 0
        });
        xlsxImportDraft.sheetIndex = sheetIndex;
        xlsxImportDraft.analysis = analysis;

        const warningCount = analysis.rejected.length - analysis.duplicateCount;
        els.xlsxImportSummary.innerHTML = '';
        [
            ['可导入', analysis.accepted.length],
            ['自动去重', analysis.duplicateCount],
            ['已排除', Math.max(0, warningCount)],
            ['需留意', analysis.mediumConfidenceCount]
        ].forEach(([label, value]) => {
            const item = document.createElement('div');
            item.className = 'xlsx-summary-item';
            const number = document.createElement('strong');
            number.textContent = String(value);
            const text = document.createElement('span');
            text.textContent = label;
            item.append(number, text);
            els.xlsxImportSummary.appendChild(item);
        });

        const selectedRows = [];
        analysis.accepted.slice(0, 35).forEach(item => selectedRows.push({ ...item, status: item.confidence === '中' ? '需留意' : '导入' }));
        analysis.accepted.filter(item => item.confidence === '中').slice(0, 15)
            .forEach(item => selectedRows.push({ ...item, status: '需留意' }));
        analysis.rejected.filter(item => !item.reason.includes('重复')).slice(0, 25)
            .forEach(item => selectedRows.push({ ...item, status: '排除' }));
        analysis.rejected.filter(item => item.reason.includes('重复')).slice(0, 5)
            .forEach(item => selectedRows.push({ ...item, status: '重复' }));

        const uniqueRows = Array.from(new Map(selectedRows.map(item => [item.row, item])).values())
            .sort((a, b) => a.row - b.row);
        els.xlsxPreviewBody.replaceChildren();
        uniqueRows.forEach(item => {
            const row = document.createElement('div');
            row.className = `xlsx-preview-row status-${item.status === '导入' ? 'accepted' : item.status === '需留意' ? 'warning' : 'rejected'}`;
            const rowNumber = document.createElement('span');
            rowNumber.textContent = String(item.row);
            const front = document.createElement('span');
            front.textContent = item.front || '—';
            front.title = item.front || '';
            const back = document.createElement('span');
            back.textContent = item.back || '—';
            back.title = item.back || '';
            const status = document.createElement('span');
            status.className = 'xlsx-row-status';
            status.textContent = item.status === '排除' || item.status === '重复' ? item.reason : item.status;
            row.append(rowNumber, front, back, status);
            els.xlsxPreviewBody.appendChild(row);
        });
        els.xlsxPreviewNote.textContent = uniqueRows.length < analysis.accepted.length + analysis.rejected.length
            ? `当前显示 ${uniqueRows.length} 条代表性记录；确认后将导入全部 ${analysis.accepted.length} 条有效词汇。`
            : `当前显示全部 ${uniqueRows.length} 条记录。`;
        els.confirmXlsxImportBtn.disabled = analysis.accepted.length === 0;
    };

    const selectXlsxSheet = (sheetIndex) => {
        if (!xlsxImportDraft) return;
        const sheet = xlsxImportDraft.workbook.sheets[sheetIndex];
        if (!sheet) return;
        const automatic = XLSXImportModule.analyzeSheet(sheet);
        const columnCount = getSheetColumnCount(sheet);
        fillColumnSelect(els.xlsxFrontColumn, columnCount);
        fillColumnSelect(els.xlsxBackColumn, columnCount);
        els.xlsxStartRow.value = String(automatic.startRow);
        els.xlsxFrontColumn.value = String(automatic.frontColumn);
        els.xlsxBackColumn.value = String(automatic.backColumn);
        renderXlsxPreview();
    };

    const closeXlsxImport = () => {
        els.xlsxImportModal.classList.remove('show');
        xlsxImportDraft = null;
    };

    const handleXlsxImportFile = async (file) => {
        try {
            const data = await readFileArrayBuffer(file);
            const workbook = await XLSXImportModule.readWorkbook(data);
            const overview = XLSXImportModule.analyzeWorkbook(workbook);
            xlsxImportDraft = {
                fileName: file.name.replace(/\.[^/.]+$/, '') || '我的词库',
                workbook,
                overview,
                analysis: null,
                sheetIndex: overview.recommendedSheetIndex
            };
            els.xlsxSheetSelect.replaceChildren();
            workbook.sheets.forEach((sheet, index) => {
                const option = document.createElement('option');
                option.value = String(index);
                option.textContent = sheet.name;
                els.xlsxSheetSelect.appendChild(option);
            });
            els.xlsxSheetSelect.value = String(overview.recommendedSheetIndex);
            selectXlsxSheet(overview.recommendedSheetIndex);
            els.xlsxImportModal.classList.add('show');
        } catch (error) {
            const messages = {
                'xlsx-too-large': 'XLSX 文件超过 15MB，请缩小文件后重试',
                'xlsx-open-failed': '无法打开 XLSX，文件可能损坏、加密或格式不正确',
                'xlsx-no-visible-sheet': 'XLSX 中没有可读取的工作表',
                'xlsx-engine-missing': 'XLSX 读取组件未加载'
            };
            showToast(messages[error.message] || 'XLSX 解析失败，请更换文件重试');
        }
    };

    const decodeVocabularyFile = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('read-failed'));
        reader.onload = (event) => {
            const result = event.target.result;
            if (typeof result === 'string') {
                resolve(result);
                return;
            }
            try {
                const bytes = new Uint8Array(result);
                if (bytes[0] === 0xff && bytes[1] === 0xfe) {
                    resolve(new TextDecoder('utf-16le').decode(bytes));
                    return;
                }
                try {
                    resolve(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
                } catch (error) {
                    resolve(new TextDecoder('gb18030').decode(bytes));
                }
            } catch (error) {
                reject(error);
            }
        };
        if (typeof reader.readAsArrayBuffer === 'function' && typeof TextDecoder !== 'undefined') {
            reader.readAsArrayBuffer(file);
        } else {
            reader.readAsText(file);
        }
    });

    const handleImportFile = async (file) => {
        if (!file) return;
        if (/\.xlsx$/i.test(file.name || '')) {
            await handleXlsxImportFile(file);
            return;
        }
        try {
            const text = await decodeVocabularyFile(file);
            const result = DataModule.parseVocabularyText(text);
            const newWords = result.words;
            if (newWords.length > 0) {
                const fileName = file.name.replace(/\.[^/.]+$/, "");
                const notices = [];
                if (result.invalidRecords.length > 0) notices.push(`忽略 ${result.invalidRecords.length} 行`);
                if (result.duplicateCount > 0) notices.push(`去重 ${result.duplicateCount} 条`);
                commitWordBankImport(
                    newWords,
                    fileName,
                    `成功导入 ${newWords.length} 个单词${notices.length ? `（${notices.join('，')}）` : ''}`
                );
            } else {
                showToast('未找到有效数据，请检查词汇表内容');
            }
        } catch (error) {
            showToast('文件读取失败，请检查文件编码或格式');
        }
    };

    const getBackupFileName = () => {
        const safeBankName = String(config.bankName || '我的词库')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .trim() || '我的词库';
        return `${safeBankName}_backup_${new Date().toISOString().slice(0, 10)}.json`;
    };

    // ---------- JSON 学习记录导入 ----------
    const handleJsonImport = (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const imported = JSON.parse(event.target.result);
                const importedWords = Array.isArray(imported)
                    ? imported
                    : Array.isArray(imported?.words)
                        ? imported.words
                        : Array.isArray(imported?.book?.words) ? imported.book.words : null;
                const isValidBackup = Array.isArray(importedWords) && importedWords.length > 0 &&
                    importedWords.every(word => word && typeof word.front === 'string' &&
                        typeof word.back === 'string' && word.front.trim() && word.back.trim());
                if (!isValidBackup) {
                    showToast('文件格式错误：不是有效的学习记录');
                    return;
                }
                if (!confirm('确定导入此学习记录吗？当前词库和进度将被覆盖。')) return;

                if (!DataModule.setWordBank(importedWords)) {
                    showToast('本地存储空间不足，无法恢复此学习记录');
                    return;
                }
                if (!Array.isArray(imported) && imported.wordErrorCounts &&
                    typeof imported.wordErrorCounts === 'object' && !Array.isArray(imported.wordErrorCounts)) {
                    wordErrorCounts = {};
                    Object.entries(imported.wordErrorCounts).forEach(([id, count]) => {
                        const safeCount = Math.max(0, Math.floor(Number(count) || 0));
                        if (safeCount > 0) wordErrorCounts[id] = safeCount;
                    });
                    saveWordErrorCounts();
                } else {
                    clearWordErrorCounts();
                }
                clearSessionState();
                const importedDailyStat = !Array.isArray(imported) ? imported.dailyStat : null;
                dailyStat = importedDailyStat && typeof importedDailyStat === 'object' &&
                    Array.isArray(importedDailyStat.learnedIds)
                    ? {
                        date: typeof importedDailyStat.date === 'string' ? importedDailyStat.date : getTodayStr(),
                        target: Math.max(1, Number(importedDailyStat.target) || config.dailyLimit),
                        learnedIds: importedDailyStat.learnedIds.filter(id =>
                            importedWords.some(word => word.id === id))
                    }
                    : { date: getTodayStr(), target: config.dailyLimit, learnedIds: [] };
                saveDailyStat();
                config.initialized = true;
                const backupBankName = !Array.isArray(imported)
                    ? String(imported.bankName || imported.bookName || imported.book?.name || '').trim()
                    : '';
                config.bankName = backupBankName || '恢复的词库';
                saveConfig();
                showToast(`已恢复“${config.bankName}”的 ${importedWords.length} 个单词`);
                setTimeout(() => location.reload(), 350);
            } catch (err) {
                showToast('JSON 解析失败');
            }
        };
        reader.readAsText(file);
    };

    // ---------- 事件绑定 ----------
    const bindEvents = () => {
        window.addEventListener('resize', handleResize);

        els.onboardingNextBtn.addEventListener('click', showNextOnboardingPage);
        els.onboardingCloseBtn.addEventListener('click', finishOnboarding);

        els.cancelConfirmBtn.addEventListener('click', closeConfirmModal);
        els.closeConfirmModalBtn.addEventListener('click', closeConfirmModal);
        els.confirmActionBtn.addEventListener('click', () => {
            const action = confirmAction;
            closeConfirmModal();
            if (action) action();
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
        els.confirmXlsxImportBtn.addEventListener('click', () => {
            const draft = xlsxImportDraft;
            if (!draft?.analysis || draft.analysis.accepted.length === 0) return;
            const newWords = DataModule.createWordsFromPairs(draft.analysis.accepted);
            const notices = [];
            if (draft.analysis.duplicateCount > 0) notices.push(`去重 ${draft.analysis.duplicateCount} 条`);
            const excludedCount = draft.analysis.rejected.length - draft.analysis.duplicateCount;
            if (excludedCount > 0) notices.push(`排除 ${excludedCount} 行`);
            closeXlsxImport();
            commitWordBankImport(
                newWords,
                draft.fileName,
                `成功导入 ${newWords.length} 个单词${notices.length ? `（${notices.join('，')}）` : ''}`
            );
        });

        els.welcomeDailyLimit.addEventListener('input', updateWelcomePreview);

        els.welcomeFileInput.addEventListener('change', async (e) => {
            await handleImportFile(e.target.files[0]);
            e.target.value = '';
        });

        els.welcomeJsonInput.addEventListener('change', (e) => {
            handleJsonImport(e.target.files[0]);
            e.target.value = '';
        });

        els.startGameBtn.addEventListener('click', handleWelcomeStart);

        els.homeStartBtn.addEventListener('click', handleHomeStart);
        els.homeBonusBtn.addEventListener('click', handleHomeBonus);

        els.openWordListBtn.addEventListener('click', openWordList);
        els.closeWordListBtn.addEventListener('click', closeWordList);
        els.reviewAllWrongBtn.addEventListener('click', startWrongReview);
        els.exportVocabularyBtn.addEventListener('click', exportVocabularyAsTSV);
        els.wordSearchInput.addEventListener('input', debounce(() => {
            wordListSearchQuery = els.wordSearchInput.value;
            renderWordList();
            resetWordListScroll();
        }, 120));
        els.wrongOnlyCheckbox.addEventListener('change', () => {
            wordListOnlyWrong = els.wrongOnlyCheckbox.checked;
            renderWordList();
            resetWordListScroll();
        });
        els.wordSortKey.addEventListener('change', () => {
            wordListSortKey = els.wordSortKey.value;
            renderWordList();
            resetWordListScroll();
        });
        els.wordSortDirection.addEventListener('click', () => {
            wordListSortDirection = wordListSortDirection === 'asc' ? 'desc' : 'asc';
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

        document.getElementById('openSettingsBtn').addEventListener('click', openSettings);
        document.getElementById('closeModalBtn').addEventListener('click', closeSettings);
        document.getElementById('closeModalBtnBottom').addEventListener('click', closeSettings);
        document.getElementById('confirmSettingsBtn').addEventListener('click', confirmSettings);

        // 导入词库
        document.getElementById('fileInput').addEventListener('change', async (e) => {
            await handleImportFile(e.target.files[0]);
            e.target.value = '';
        });

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
                onConfirm: () => {
                    DataModule.reset();
                    clearWordErrorCounts();
                    dailyStat = { date: getTodayStr(), target: config.dailyLimit, learnedIds: [] };
                    saveDailyStat();
                    sessionActive = false;
                    clearSessionState();
                    closeSettings();
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
                onConfirm: () => {
                    localStorage.clear();
                    location.reload();
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

    // ---------- 初始化 ----------
    const init = () => {
        AudioModule.preload();
        AudioModule.bindGlobalButtonSound();
        cacheElements();
        loadConfig();
        applyTheme();
        setAccentTheme(config.accentTheme);
        setBackgroundImage(config.backgroundImage);
        loadDailyStat();
        DataModule.load();
        loadWordErrorCounts();

        initRings();

        syncGroupSizeSelect();
        syncDailyLimitSelect();

        bindEvents();
        GameModule.init(handleCardResult, handleGroupComplete);

        if (tryRestoreSession()) return;

        if (!config.initialized || DataModule.getWords().length === 0) {
            showWelcomeScreen();
            if (shouldShowOnboarding()) showOnboarding();
        } else {
            showHomeScreen();
        }
    };

    init();
})();
