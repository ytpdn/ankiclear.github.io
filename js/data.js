// ==========================================
// 1. 数据层 (DataModule)
// ==========================================
const DataModule = (() => {
    let wordBank = [];
    let wordIndexById = new Map();
    let saveTimer = null;
    let pendingWordUpdates = new Map();
    const generateId = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

    const rebuildIndex = () => {
        wordIndexById = new Map(wordBank.map((word, index) => [word.id, index]));
    };

    const createWord = (front, back) => ({
        id: generateId(), front, back, phonetic: '', phoneticSource: '',
        ease: 2.5, interval: 0, dueDate: Date.now(),
        stability: null, difficulty: null,
        state: 'new', stepIndex: 0, lastReview: null
    });

    const normalizeWord = word => {
        const normalized = { ...createWord(word.front, word.back), ...word };
        if (typeof normalized.id !== 'string' || !normalized.id) normalized.id = generateId();
        return normalized;
    };

    const normalizeWords = words => {
        const usedIds = new Set();
        return words.map(word => {
            const normalized = normalizeWord(word);
            while (usedIds.has(normalized.id)) normalized.id = generateId();
            usedIds.add(normalized.id);
            return normalized;
        });
    };

    const load = async () => {
        try {
            const savedWords = await StorageModule.getWords();
            wordBank = Array.isArray(savedWords)
                ? normalizeWords(savedWords.filter(word =>
                    word && typeof word.front === 'string' && typeof word.back === 'string'))
                : [];
        } catch (error) {
            wordBank = [];
        }
        rebuildIndex();
    };

    const cancelScheduledSave = () => {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
    };

    const flush = async () => {
        cancelScheduledSave();
        if (pendingWordUpdates.size === 0) return true;
        const updates = Array.from(pendingWordUpdates.values());
        pendingWordUpdates = new Map();
        try {
            await StorageModule.putWords(updates, wordBank);
            return true;
        } catch (error) {
            updates.forEach(word => pendingWordUpdates.set(word.id, word));
            return false;
        }
    };

    const save = async () => {
        cancelScheduledSave();
        pendingWordUpdates.clear();
        try {
            await StorageModule.replaceWords(wordBank);
            return true;
        } catch (error) {
            return false;
        }
    };

    const scheduleSave = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            flush();
        }, 400);
    };

    const reset = async () => {
        const previousWords = wordBank;
        const previousIndex = wordIndexById;
        wordBank = wordBank.map(w => createWord(w.front, w.back));
        rebuildIndex();
        if (await save()) return true;
        wordBank = previousWords;
        wordIndexById = previousIndex;
        return false;
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
    const strongAdPattern = /(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|关注(?:微信|公众号)|微信公众号|扫码|加群|资料(?:领取|下载)|版权所有|侵权(?:联系|删除)|淘宝|网店|更多资料|点击链接|(?:微信|QQ|电话|手机|联系)[：:\s]*[A-Za-z0-9_-]{4,})/i;
    const phonePattern = /(?:^|\D)1[3-9]\d{9}(?:\D|$)/;
    const cleanCell = value => String(value || '')
        .replace(/^\uFEFF/, '')
        .replace(/\u00a0/g, ' ')
        .replace(/<[^>]+>/g, '')
        .trim();
    const normalizeEnglishKey = value => cleanCell(value)
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('en');
    const isMissingMeaning = value => /^无[。.!！]?$/.test(cleanCell(value));

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

    const classifyVocabularyPair = (front, back) => {
        if (!front || !back) return { accepted: false };
        if (isMissingMeaning(back)) return { accepted: false, reason: '释义为“无”' };
        if (strongAdPattern.test(`${front} ${back}`) || phonePattern.test(`${front} ${back}`)) {
            return { accepted: false };
        }
        if (!containsLatin(front)) return { accepted: false };
        if (!containsHan(back) && !containsLatin(back)) return { accepted: false };
        if (/https?:\/\/|www\.|@/.test(front)) return { accepted: false };
        if (front.length > 160 || front.includes('\n') || back.length > 4000) {
            return { accepted: false };
        }
        const tokenCount = front.split(/\s+/).filter(Boolean).length;
        if (tokenCount > 16) return { accepted: false };
        const visibleCharacters = front.replace(/\s/g, '').length;
        const latinCharacters = (front.match(/[A-Za-z]/g) || []).length;
        if (visibleCharacters > 0 && latinCharacters / visibleCharacters < 0.35) {
            return { accepted: false };
        }
        return { accepted: true, confidence: containsHan(back) ? 'high' : 'medium' };
    };

    const parseVocabularyText = (text) => {
        const records = splitLogicalRecords(String(text || ''));
        const words = [];
        const invalidRecords = [];
        const seen = new Set();
        let duplicateCount = 0;
        let headerCount = 0;
        let highConfidenceCount = 0;
        let mediumConfidenceCount = 0;

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
            const classification = classifyVocabularyPair(front, back);
            if (!classification.accepted) {
                invalidRecords.push(index + 1);
                return;
            }

            const duplicateKey = normalizeEnglishKey(front);
            if (seen.has(duplicateKey)) {
                duplicateCount += 1;
                return;
            }
            seen.add(duplicateKey);
            words.push(createWord(front, back));
            if (classification.confidence === 'high') highConfidenceCount += 1;
            else mediumConfidenceCount += 1;
        });

        return {
            words,
            invalidRecords,
            duplicateCount,
            headerCount,
            highConfidenceCount,
            mediumConfidenceCount
        };
    };

    const createWordsFromPairs = (pairs) => {
        const words = [];
        const seen = new Set();
        (Array.isArray(pairs) ? pairs : []).forEach(pair => {
            const front = cleanCell(pair?.front ?? pair?.[0]);
            const back = cleanCell(pair?.back ?? pair?.[1]);
            if (!front || !back) return;
            if (isMissingMeaning(back)) return;
            const duplicateKey = normalizeEnglishKey(front);
            if (seen.has(duplicateKey)) return;
            seen.add(duplicateKey);
            words.push(createWord(front, back));
        });
        return words;
    };

    const appendWords = async (newWords) => {
        const previousWords = wordBank;
        const previousIndex = wordIndexById;
        const seen = new Set(wordBank.map(word => normalizeEnglishKey(word.front)));
        const accepted = [];
        let duplicateCount = 0;
        let ignoredCount = 0;

        (Array.isArray(newWords) ? newWords : []).forEach(word => {
            const front = cleanCell(word?.front);
            const back = cleanCell(word?.back);
            const key = normalizeEnglishKey(front);
            if (!front || !back || !containsLatin(front) || isMissingMeaning(back)) {
                ignoredCount += 1;
                return;
            }
            if (seen.has(key)) {
                duplicateCount += 1;
                return;
            }
            seen.add(key);
            accepted.push(createWord(front, back));
        });

        if (accepted.length === 0) {
            return { success: true, addedCount: 0, duplicateCount, ignoredCount };
        }
        cancelScheduledSave();
        pendingWordUpdates.clear();
        wordBank = [...wordBank, ...accepted];
        rebuildIndex();
        if (await save()) {
            return { success: true, addedCount: accepted.length, duplicateCount, ignoredCount };
        }
        wordBank = previousWords;
        wordIndexById = previousIndex;
        return { success: false, addedCount: 0, duplicateCount, ignoredCount };
    };

    const editWord = async (wordId, frontValue, backValue, phoneticValue) => {
        const front = cleanCell(frontValue);
        const back = cleanCell(backValue);
        if (!front || !back || !containsLatin(front)) return { success: false, error: 'invalid' };
        if (isMissingMeaning(back)) return { success: false, error: 'missing-meaning' };
        const duplicateKey = normalizeEnglishKey(front);
        const duplicate = wordBank.some(word => word.id !== wordId &&
            normalizeEnglishKey(word.front) === duplicateKey);
        if (duplicate) return { success: false, error: 'duplicate' };
        const index = wordIndexById.get(wordId);
        if (index === undefined) return { success: false, error: 'not-found' };
        const previousWord = wordBank[index];
        const frontChanged = normalizeEnglishKey(previousWord.front) !== normalizeEnglishKey(front);
        const hasPhoneticValue = typeof phoneticValue === 'string';
        const updatedWord = {
            ...previousWord,
            front,
            back,
            phonetic: hasPhoneticValue ? cleanCell(phoneticValue) : (frontChanged ? '' : previousWord.phonetic || ''),
            phoneticSource: hasPhoneticValue ? (cleanCell(phoneticValue) ? 'manual' : '') :
                (frontChanged ? '' : previousWord.phoneticSource || '')
        };
        wordBank[index] = updatedWord;
        try {
            await StorageModule.putWords([updatedWord], wordBank);
            pendingWordUpdates.delete(wordId);
            return { success: true, word: updatedWord };
        } catch (error) {
            wordBank[index] = previousWord;
            return { success: false, error: 'storage' };
        }
    };

    const putWordUpdates = async (updates) => {
        const safeUpdates = (Array.isArray(updates) ? updates : [])
            .filter(word => word && typeof word.id === 'string' && wordIndexById.has(word.id));
        if (safeUpdates.length === 0) return true;
        const previous = new Map();
        safeUpdates.forEach(word => {
            const index = wordIndexById.get(word.id);
            previous.set(word.id, wordBank[index]);
            wordBank[index] = { ...wordBank[index], ...word };
        });
        try {
            await StorageModule.putWords(safeUpdates, wordBank);
            safeUpdates.forEach(word => pendingWordUpdates.delete(word.id));
            return true;
        } catch (error) {
            previous.forEach((word, id) => { wordBank[wordIndexById.get(id)] = word; });
            return false;
        }
    };

    const updateWordState = (updatedWord) => {
        const idx = wordIndexById.get(updatedWord.id);
        if (idx !== undefined) {
            wordBank[idx] = updatedWord;
            pendingWordUpdates.set(updatedWord.id, updatedWord);
            scheduleSave();
        }
    };

    return {
        load, save, flush, reset, parseVocabularyText, createWordsFromPairs,
        appendWords, editWord, putWordUpdates, normalizeEnglishKey, isMissingMeaning, updateWordState,
        setWordBank: async (newWords) => {
            const previousWords = wordBank;
            const previousIndex = wordIndexById;
            cancelScheduledSave();
            pendingWordUpdates.clear();
            wordBank = normalizeWords(newWords);
            rebuildIndex();
            if (await save()) return true;
            wordBank = previousWords;
            wordIndexById = previousIndex;
            return false;
        },
        removeWord: async (wordId) => {
            const previousWords = wordBank;
            const previousIndex = wordIndexById;
            const originalLength = wordBank.length;
            wordBank = wordBank.filter(word => word.id !== wordId);
            if (wordBank.length === originalLength) return false;
            rebuildIndex();
            pendingWordUpdates.delete(wordId);
            try {
                await StorageModule.deleteWord(wordId, wordBank);
            } catch (error) {
                wordBank = previousWords;
                wordIndexById = previousIndex;
                return false;
            }
            return true;
        },
        getWords: () => wordBank
    };
})();
