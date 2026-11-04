    // ---------- 初始化 ----------
    const init = async () => {
        AudioModule.preload();
        AudioModule.bindGlobalButtonSound();
        cacheElements();
        await StorageModule.initialize();
        loadConfig();
        const savedBackground = await StorageModule.getValue('backgroundImage');
        config.backgroundImage = validBackgroundImage(savedBackground) ? savedBackground : '';
        applyTheme();
        setAccentTheme(config.accentTheme);
        setBackgroundImage(config.backgroundImage);
        setInterfaceOpacity(config.interfaceOpacity);
        AudioModule.setVolume(config.masterVolume);
        loadDailyStat();
        await DataModule.load();
        await PhoneticModule.fillMissingPhonetics();
        await loadWordErrorCounts();
        els.timerEnabledCheckbox.checked = false;

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

    const startApp = () => {
        const run = async () => {
            try {
                await init();
                const finish = () => hideLoading(true);
                if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
                else finish();
            } catch (error) {
                console.error('应用初始化失败', error);
                const overlay = document.getElementById('loadingOverlay');
                const message = document.getElementById('loadingMessage');
                if (overlay) {
                    overlay.hidden = false;
                    overlay.classList.remove('is-hidden');
                }
                if (message) message.textContent = '加载失败，请刷新重试';
            }
        };
        run();
    };

    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => setTimeout(startApp, 0));
    } else {
        startApp();
    }
