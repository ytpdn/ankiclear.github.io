    // ---------- 词库导入 ----------
    const MAX_TEXT_IMPORT_BYTES = 10 * 1024 * 1024;
    const MAX_OCR_IMAGE_BYTES = 20 * 1024 * 1024;
    let ocrWorkerPromise = null;

    const commitWordBankImport = async (newWords, fileName, message) => {
        if (!await DataModule.setWordBank(newWords)) {
            showToast('本地存储空间不足，请先移除自定义背景或缩小词库');
            return false;
        }
        await clearWordErrorCounts();
        clearSessionState();
        config.bankName = fileName || '我的词库';
        config.wordRangeStart = 1;
        config.wordRangeEnd = 0;
        saveConfig();
        updateHomeRangeDisplay();
        dailyStat = { date: getTodayStr(), target: config.dailyLimit, learnedIds: [] };
        saveDailyStat();
        await PhoneticModule.fillMissingPhonetics();
        closeSettings();

        if (els.welcomeOverlay.classList.contains('show')) updateWelcomePreview();
        else showWelcomeScreen();
        showToast(message || `成功导入 ${newWords.length} 个单词`);
        return true;
    };

    const commitWordBankAppend = async (newWords, message = '') => {
        const result = await DataModule.appendWords(newWords);
        if (!result.success) {
            showToast('本地存储空间不足，无法添加词汇');
            return false;
        }
        const notices = [];
        if (result.duplicateCount > 0) notices.push(`重复 ${result.duplicateCount} 条`);
        if (result.ignoredCount > 0) notices.push(`无效 ${result.ignoredCount} 条`);
        if (result.addedCount === 0) {
            showToast(notices.length ? `没有添加新词（已忽略${notices.join('，')}）` : '没有可添加的新词');
            return false;
        }
        if (els.wordListOverlay.classList.contains('show')) renderWordList();
        if (els.homeOverlay.classList.contains('show')) updateHomeScreen();
        if (els.welcomeOverlay.classList.contains('show')) updateWelcomePreview();
        await PhoneticModule.fillMissingPhonetics();
        if (els.wordListOverlay.classList.contains('show')) renderWordList();
        const suffix = notices.length ? `（已忽略${notices.join('，')}）` : '';
        showToast(message || `成功添加 ${result.addedCount} 个单词${suffix}`);
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

    const handleXlsxImportFile = async (file, mode = 'replace') => {
        try {
            const data = await readFileArrayBuffer(file);
            const workbook = await XLSXImportModule.readWorkbook(data);
            const overview = XLSXImportModule.analyzeWorkbook(workbook);
            const totalAccepted = overview.analyses.reduce(
                (total, analysis) => total + analysis.accepted.length,
                0
            );
            const highConfidenceCount = overview.analyses.reduce(
                (total, analysis) => total + analysis.accepted.length - analysis.mediumConfidenceCount,
                0
            );
            if (totalAccepted === 0) throw new Error('xlsx-no-vocabulary');
            if (highConfidenceCount === 0) throw new Error('xlsx-no-chinese-vocabulary');
            xlsxImportDraft = {
                fileName: file.name.replace(/\.[^/.]+$/, '') || '我的词库',
                workbook,
                overview,
                analysis: null,
                sheetIndex: overview.recommendedSheetIndex,
                mode
            };
            els.xlsxImportTitle.textContent = mode === 'append' ? '预览要添加的 XLSX 词汇' : '预览 XLSX 词汇表';
            els.xlsxImportSubtitle.textContent = mode === 'append'
                ? '确认后只追加新词，并自动忽略词库中已有的英文单词'
                : '请核对自动识别结果，确认后才会覆盖当前词库';
            els.confirmXlsxImportBtn.textContent = mode === 'append' ? '确认添加' : '确认导入';
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
                'xlsx-engine-missing': 'XLSX 读取组件未加载',
                'xlsx-no-vocabulary': '未在 XLSX 中识别到有效词汇，已取消导入',
                'xlsx-no-chinese-vocabulary': '未识别到中英文词汇，已取消导入'
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

    const handleImportFile = async (file, mode = 'replace') => {
        if (!file) return;
        const fileName = String(file.name || '');
        if (/\.xlsx$/i.test(file.name || '')) {
            showLoading('正在读取 XLSX 词汇表…');
            try {
                await handleXlsxImportFile(file, mode);
            } finally {
                hideLoading();
            }
            return;
        }
        if (!/\.(csv|tsv|txt)$/i.test(fileName)) {
            showToast('仅支持 XLSX、CSV、TSV、TXT 词汇表');
            return;
        }
        if (Number(file.size) > MAX_TEXT_IMPORT_BYTES) {
            showToast('文本词汇表超过 10MB，请缩小文件后重试');
            return;
        }
        showLoading('正在识别词汇表…');
        try {
            const text = await decodeVocabularyFile(file);
            const result = DataModule.parseVocabularyText(text);
            const newWords = result.words;
            if (newWords.length > 0 && result.highConfidenceCount > 0) {
                const bankName = file.name.replace(/\.[^/.]+$/, "");
                const notices = [];
                if (result.invalidRecords.length > 0) notices.push(`忽略 ${result.invalidRecords.length} 行`);
                if (result.duplicateCount > 0) notices.push(`去重 ${result.duplicateCount} 条`);
                if (mode === 'append') {
                    await commitWordBankAppend(newWords);
                } else {
                    await commitWordBankImport(
                        newWords,
                        bankName,
                        `成功导入 ${newWords.length} 个单词${notices.length ? `（${notices.join('，')}）` : ''}`
                    );
                }
            } else {
                showToast('未识别到有效的中英文词汇，已取消导入');
            }
        } catch (error) {
            showToast('文件读取失败，请检查文件编码或格式');
        } finally {
            hideLoading();
        }
    };

    const openAddVocabularyModal = () => {
        if (DataModule.getWords().length === 0) {
            showToast('请先导入词库');
            return;
        }
        if (document.getElementById('settingsModal').classList.contains('show')) closeSettings();
        els.manualWordFrontInput.value = '';
        els.manualWordBackInput.value = '';
        els.addVocabularyModal.classList.add('show');
        setTimeout(() => els.manualWordFrontInput.focus(), 50);
    };

    const closeAddVocabularyModal = () => {
        els.addVocabularyModal.classList.remove('show');
    };

    const addManualWord = async () => {
        const front = els.manualWordFrontInput.value.trim();
        const back = els.manualWordBackInput.value.trim();
        if (!front || !back || !/[A-Za-z]/.test(front)) {
            showToast('请填写有效的英文单词和释义');
            return;
        }
        if (DataModule.isMissingMeaning(back)) {
            showToast('释义不能为“无”');
            return;
        }
        const added = await commitWordBankAppend([{ front, back }]);
        if (added) {
            els.manualWordFrontInput.value = '';
            els.manualWordBackInput.value = '';
            els.manualWordFrontInput.focus();
        }
    };

    const getOcrWorker = () => {
        if (ocrWorkerPromise) return ocrWorkerPromise;
        if (typeof Tesseract === 'undefined') return Promise.reject(new Error('ocr-engine-missing'));
        ocrWorkerPromise = Tesseract.createWorker(['eng', 'chi_sim'], 1, {
            workerPath: 'vendor/tesseract/worker.min.js',
            corePath: 'vendor/tesseract/core',
            langPath: 'vendor/tesseract/lang-data',
            logger: event => {
                if (!els.loadingMessage) return;
                const statusMap = {
                    'loading tesseract core': '正在加载 OCR 引擎…',
                    'loading language traineddata': '正在加载中英文识别数据…',
                    'initializing api': '正在初始化 OCR…',
                    'recognizing text': '正在识别图片文字…'
                };
                const progress = Number.isFinite(event.progress) ? ` ${Math.round(event.progress * 100)}%` : '';
                els.loadingMessage.textContent = `${statusMap[event.status] || '正在处理图片…'}${progress}`;
            },
            errorHandler: error => console.error('OCR worker error', error)
        }).catch(error => {
            ocrWorkerPromise = null;
            throw error;
        });
        return ocrWorkerPromise;
    };

    const renderOcrPreview = () => {
        const result = DataModule.parseVocabularyText(els.ocrRecognizedText.value);
        const notices = [`识别到 ${result.words.length} 个有效词汇`];
        if (result.duplicateCount > 0) notices.push(`重复英文 ${result.duplicateCount} 条`);
        if (result.invalidRecords.length > 0) notices.push(`待修改或忽略 ${result.invalidRecords.length} 行`);
        els.ocrPreviewSummary.textContent = notices.join('；');
        els.ocrPairPreview.replaceChildren();
        result.words.slice(0, 80).forEach(word => {
            const row = document.createElement('div');
            row.className = 'ocr-preview-row';
            const front = document.createElement('span');
            front.textContent = word.front;
            const back = document.createElement('span');
            back.textContent = word.back;
            row.append(front, back);
            els.ocrPairPreview.appendChild(row);
        });
        if (result.words.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'ocr-preview-empty';
            empty.textContent = '暂未解析出“英文 + 释义”，请在左侧修改识别文本';
            els.ocrPairPreview.appendChild(empty);
        }
        els.confirmOcrImportBtn.disabled = result.words.length === 0;
        return result;
    };

    const openOcrPreview = (text, fileName, mode) => {
        ocrImportDraft = { fileName, mode };
        els.ocrPreviewTitle.textContent = mode === 'append' ? '核对 OCR 添加内容' : '核对 OCR 导入内容';
        els.confirmOcrImportBtn.textContent = mode === 'append' ? '确认添加' : '确认导入';
        els.ocrRecognizedText.value = String(text || '').trim();
        renderOcrPreview();
        els.ocrPreviewModal.classList.add('show');
    };

    const closeOcrPreview = () => {
        els.ocrPreviewModal.classList.remove('show');
        ocrImportDraft = null;
    };

    const handleOcrImageImport = async (file, mode = 'replace') => {
        if (!file) return;
        if (!String(file.type || '').startsWith('image/')) {
            showToast('请选择图片文件');
            return;
        }
        if (Number(file.size) > MAX_OCR_IMAGE_BYTES) {
            showToast('图片超过 20MB，请压缩后重试');
            return;
        }
        closeAddVocabularyModal();
        showLoading('正在初始化 OCR…');
        try {
            const worker = await getOcrWorker();
            const result = await worker.recognize(file);
            const text = String(result?.data?.text || '').trim();
            if (!text) {
                showToast('图片中没有识别到文字');
                return;
            }
            const name = String(file.name || 'OCR词库').replace(/\.[^/.]+$/, '') || 'OCR词库';
            openOcrPreview(text, name, mode);
        } catch (error) {
            console.error('OCR 识别失败', error);
            showToast('OCR 识别失败，请换一张更清晰的图片重试');
        } finally {
            hideLoading();
        }
    };

    const confirmOcrImport = async () => {
        if (!ocrImportDraft) return;
        const draft = { ...ocrImportDraft };
        const result = renderOcrPreview();
        if (result.words.length === 0) return;
        closeOcrPreview();
        if (draft.mode === 'append') {
            await commitWordBankAppend(result.words);
        } else {
            await commitWordBankImport(result.words, draft.fileName,
                `成功通过 OCR 导入 ${result.words.length} 个单词`);
        }
    };

    const getBackupFileName = () => {
        const safeBankName = String(config.bankName || '我的词库')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .trim() || '我的词库';
        return `${safeBankName}_backup_${new Date().toISOString().slice(0, 10)}.json`;
    };

    const restoreJsonBackup = async (imported, importedWords) => {
        showLoading('正在恢复学习记录…');
        if (!await DataModule.setWordBank(importedWords)) {
            hideLoading();
            showToast('本地存储空间不足，无法恢复此学习记录');
            return;
        }
        const storedWords = DataModule.getWords();
        if (!Array.isArray(imported) && imported.wordErrorCounts &&
            typeof imported.wordErrorCounts === 'object' && !Array.isArray(imported.wordErrorCounts)) {
            wordErrorCounts = {};
            Object.entries(imported.wordErrorCounts).forEach(([id, count]) => {
                const safeCount = Math.max(0, Math.floor(Number(count) || 0));
                if (safeCount > 0) wordErrorCounts[id] = safeCount;
            });
            await saveWordErrorCounts();
        } else {
            await clearWordErrorCounts();
        }
        clearSessionState();
        const importedWordIds = new Set(storedWords.map(word => word.id));
        const importedDailyStat = !Array.isArray(imported) ? imported.dailyStat : null;
        dailyStat = importedDailyStat && typeof importedDailyStat === 'object' &&
            Array.isArray(importedDailyStat.learnedIds)
            ? {
                date: typeof importedDailyStat.date === 'string' ? importedDailyStat.date : getTodayStr(),
                target: Math.max(1, Number(importedDailyStat.target) || config.dailyLimit),
                learnedIds: importedDailyStat.learnedIds.filter(id => importedWordIds.has(id))
            }
            : { date: getTodayStr(), target: config.dailyLimit, learnedIds: [] };
        saveDailyStat();
        config.initialized = true;
        const backupBankName = !Array.isArray(imported)
            ? String(imported.bankName || imported.bookName || imported.book?.name || '').trim()
            : '';
        config.bankName = backupBankName || '恢复的词库';
        saveConfig();
        hideLoading();
        showToast(`已恢复“${config.bankName}”的 ${storedWords.length} 个单词`);
        setTimeout(() => location.reload(), 350);
    };

    // ---------- JSON 学习记录导入 ----------
    const handleJsonImport = (file) => {
        if (!file) return;
        showLoading('正在读取学习记录…');
        const reader = new FileReader();
        reader.onerror = () => {
            hideLoading();
            showToast('JSON 文件读取失败');
        };
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
                        typeof word.back === 'string' && word.front.trim() && word.back.trim() &&
                        !DataModule.isMissingMeaning(word.back));
                if (!isValidBackup) {
                    hideLoading();
                    showToast('文件格式错误：不是有效的学习记录');
                    return;
                }
                hideLoading();
                openConfirmModal({
                    title: '恢复学习记录',
                    message: '当前词库和学习进度将被覆盖。确定继续吗？',
                    confirmText: '确认恢复',
                    onConfirm: () => restoreJsonBackup(imported, importedWords)
                });
            } catch (err) {
                hideLoading();
                showToast('JSON 解析失败');
            }
        };
        reader.readAsText(file);
    };

