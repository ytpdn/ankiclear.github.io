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
        const wordText = document.createElement('span');
        wordText.textContent = word.front;
        wordCell.appendChild(wordText);
        if (String(word.phonetic || '').trim()) {
            const phonetic = document.createElement('small');
            phonetic.className = 'word-phonetic';
            phonetic.textContent = `/${word.phonetic}/`;
            phonetic.title = word.phoneticSource === 'heuristic' ? '本地规则自动生成的美式音标，可在编辑词汇表中修正' : '美式 IPA';
            wordCell.appendChild(phonetic);
        }

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
        if (wordListEditMode) {
            const editButton = document.createElement('button');
            editButton.type = 'button';
            editButton.className = 'word-edit-btn';
            editButton.textContent = '编辑';
            editButton.setAttribute('aria-label', `编辑单词 ${word.front}`);
            editButton.addEventListener('click', () => requestEditWord(word));
            actionCell.appendChild(editButton);
        }
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

    const requestEditWord = (word) => {
        editingWordId = word.id;
        editingWordOriginalFront = word.front;
        editingWordOriginalPhonetic = word.phonetic || '';
        els.editWordFrontInput.value = word.front;
        els.editWordBackInput.value = word.back;
        els.editWordPhoneticInput.value = word.phonetic || '';
        els.editWordModal.classList.add('show');
        setTimeout(() => {
            els.editWordFrontInput.focus();
            els.editWordFrontInput.select();
        }, 50);
    };

    const closeEditWordModal = () => {
        els.editWordModal.classList.remove('show');
        editingWordId = null;
        editingWordOriginalFront = '';
        editingWordOriginalPhonetic = '';
    };

    const confirmEditWord = async () => {
        if (!editingWordId) return;
        const nextFront = els.editWordFrontInput.value;
        const frontChanged = DataModule.normalizeEnglishKey(nextFront) !== DataModule.normalizeEnglishKey(editingWordOriginalFront);
        const enteredPhonetic = els.editWordPhoneticInput.value;
        const phoneticForSave = frontChanged && enteredPhonetic === editingWordOriginalPhonetic ? '' : enteredPhonetic;
        const result = await DataModule.editWord(
            editingWordId,
            nextFront,
            els.editWordBackInput.value,
            phoneticForSave
        );
        if (!result.success) {
            const messages = {
                invalid: '请填写有效的英文单词和释义',
                'missing-meaning': '释义不能为“无”',
                duplicate: '词库中已存在相同的英文单词',
                storage: '保存失败，请检查本地存储空间'
            };
            showToast(messages[result.error] || '无法修改这个词');
            return;
        }
        const editedFront = result.word.front;
        if (!String(result.word.phonetic || '').trim()) {
            await PhoneticModule.refreshWordPhonetic(result.word.id);
        }
        closeEditWordModal();
        renderWordList();
        showToast(`已保存“${editedFront}”`);
    };

    const toggleWordListEditMode = () => {
        wordListEditMode = !wordListEditMode;
        els.toggleWordEditBtn.textContent = wordListEditMode ? '退出编辑' : '编辑词汇表';
        els.toggleWordEditBtn.setAttribute('aria-pressed', String(wordListEditMode));
        renderWordList();
    };

    const requestDeleteWord = (word) => {
        openConfirmModal({
            title: '删除词汇',
            message: `确定删除“${word.front} — ${word.back}”吗？该词的学习进度和错误次数也会一并删除。`,
            confirmText: '确认删除',
            onConfirm: async () => {
                if (!await DataModule.removeWord(word.id)) return;
                delete wordErrorCounts[word.id];
                await saveWordErrorCounts();
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
        const allWordsInBankOrder = DataModule.getWords();
        const orderById = new Map(allWordsInBankOrder.map((word, index) => [word.id, index]));
        let words = allWordsInBankOrder.filter(word => {
            if (wordListOnlyWrong && (Number(wordErrorCounts[word.id]) || 0) === 0) return false;
            if (!searchQuery) return true;
            const searchableText = `${word.front} ${word.back}`.normalize('NFKC').toLocaleLowerCase();
            return searchableText.includes(searchQuery);
        });

        words.sort((a, b) => {
            let result;
            if (wordListSortKey === 'order') {
                result = (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0);
            } else if (wordListSortKey === 'errors') {
                result = (Number(wordErrorCounts[a.id]) || 0) - (Number(wordErrorCounts[b.id]) || 0);
                if (result === 0) result = collator.compare(a.front, b.front);
            } else {
                result = collator.compare(a.front, b.front);
                if (result === 0) result = collator.compare(a.back, b.back);
            }
            return wordListSortDirection === 'asc' ? result : -result;
        });

        const totalCount = words.length;
        const visibleWords = words.slice(0, wordListVisibleLimit);
        els.wordList.replaceChildren();
        els.wordListEmpty.hidden = totalCount > 0;
        const fragment = document.createDocumentFragment();
        let currentLetter = null;

        visibleWords.forEach(word => {
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
        const visibleCount = visibleWords.length;
        els.wordListLoadMore.hidden = visibleCount === 0 || visibleCount >= totalCount;
        els.wordListCount.textContent = `已显示 ${visibleCount} / ${totalCount}`;
        const descending = wordListSortDirection === 'desc';
        els.wordSortDirectionLabel.textContent = descending ? '倒序' : '正序';
        els.wordSortDirectionIcon.classList.toggle('descending', descending);
        els.wordSortDirection.setAttribute('aria-pressed', String(wordListSortDirection === 'desc'));
        const wrongCount = DataModule.getWords().filter(word =>
            (Number(wordErrorCounts[word.id]) || 0) > 0).length;
        els.reviewAllWrongBtn.disabled = wrongCount === 0;
        els.reviewAllWrongBtn.title = wrongCount > 0 ? `复习 ${wrongCount} 个错词` : '当前没有错词';
        els.toggleWordEditBtn.textContent = wordListEditMode ? '退出编辑' : '编辑词汇表';
        els.toggleWordEditBtn.setAttribute('aria-pressed', String(wordListEditMode));
    };

    const openWordList = () => {
        document.body.classList.remove('home-view');
        els.homeOverlay.classList.remove('show');
        els.infoBar.style.display = 'none';
        if (els.backHomeBtn) els.backHomeBtn.style.display = 'none';
        els.wordListOverlay.classList.add('show');
        wordListEditMode = false;
        wordListVisibleLimit = WORD_LIST_PAGE_SIZE;
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
        startSessionTimer(els.timerEnabledCheckbox.checked);
        startSession();
    };

    const handleHomeBonus = () => {
        dailyStat.target += 10;
        saveDailyStat();
        updateInfoBar();
        els.homeOverlay.classList.remove('show');
        els.infoBar.style.display = 'flex';
        if (els.backHomeBtn) els.backHomeBtn.style.display = '';
        startSessionTimer(els.timerEnabledCheckbox.checked);
        startSession();
    };

    const startWrongReview = () => {
        stopSessionTimer(false);
        const wrongWords = getWordsInSelectedRange()
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

