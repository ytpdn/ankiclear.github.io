    // ---------- 统计 ----------
    const isWordMastered = word => word.state === 'review';
    const getUnlearnedCount = () => getWordsInSelectedRange().filter(word => !isWordMastered(word)).length;
    const hasLearnableWords = () => {
        if (getWordsInSelectedRange().length === 0) return false;
        const remaining = Math.max(0, getEffectiveDailyTarget() - getDailyLearnedCount());
        if (remaining <= 0) return false;
        const now = Date.now();
        const learnedSet = new Set(dailyStat.learnedIds);
        const allWords = getWordsInSelectedRange();
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
        startSessionTimer(false);
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
        updateHomeRangeDisplay();
        const learned = getDailyLearnedCount();
        const target = getEffectiveDailyTarget();
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
        const learnedWords = allWords.filter(isWordMastered).length;
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
        const unlearnedCount = getUnlearnedCount();
        const daysLeft = unlearnedCount === 0 ? 0 :
            (config.dailyLimit === 0 ? 1 : Math.ceil(unlearnedCount / config.dailyLimit));
        els.homeBookDays.textContent = daysLeft === 0 ? '已完成本轮' : `剩余${daysLeft}天`;
        els.homeSessionTime.hidden = lastSessionElapsedMs === null;
        els.homeSessionTime.textContent = lastSessionElapsedMs === null
            ? ''
            : `本轮用时：${formatElapsedTime(lastSessionElapsedMs)}`;

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

