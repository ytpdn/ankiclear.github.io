    // ---------- 返回首页 ----------
    const returnToHome = (completed = false) => {
        stopSessionTimer(completed === true);
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

        const remaining = Math.max(0, getEffectiveDailyTarget() - getDailyLearnedCount());
        if (remaining === 0) { returnToHome(getEffectiveDailyTarget() > 0); return; }

        const allWords = getWordsInSelectedRange();
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
        if (config.layoutMode === 'custom') {
            return Math.max(2, Math.floor(config.customRows * config.customColumns / 2));
        }
        if (config.groupSize === 'auto') {
            return calcAutoGroupSize();
        }
        const size = parseInt(config.groupSize);
        return isNaN(size) ? calcAutoGroupSize() : size;
    };

    const rememberCompletedGroup = (wordIds = []) => {
        const validIds = new Set(getWordsInSelectedRange().map(word => word.id));
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
            else if (getDailyLearnedCount() >= getEffectiveDailyTarget()) returnToHome(true);
            else startSession();
            return;
        }

        const groupSize = getGroupSize();
        let currentGroup = todayQueue.splice(0, groupSize);
        groupWrongIds = new Set();
        currentCompanionIds = new Set();
        const allWords = getWordsInSelectedRange();
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
        DataModule.flush();
        rememberCompletedGroup(GameModule.getSnapshot().currentGroupIds);
        updateInfoBar();
        if (sessionMode === 'wrong') {
            if (todayQueue.length === 0) finishWrongReview();
            else {
                AudioModule.play('switch');
                loadNextGroup();
            }
        } else if (getDailyLearnedCount() >= getEffectiveDailyTarget()) {
            returnToHome(true);
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
        els.infoProgress.textContent = `${getDailyLearnedCount()} / ${getEffectiveDailyTarget()}`;
        const unlearned = getUnlearnedCount();
        const days = unlearned === 0 ? 0 : (config.dailyLimit === 0 ? 1 : Math.ceil(unlearned / config.dailyLimit));
        els.infoDays.textContent = String(days);
    };

