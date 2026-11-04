// IndexedDB 数据层：大数据异步存储，小型配置仍保留在 localStorage。
const StorageModule = (() => {
    const DB_NAME = 'ankiMatchDB';
    const DB_VERSION = 1;
    const WORD_STORE = 'words';
    const META_STORE = 'metadata';
    const MIGRATION_VERSION = 1;
    const FALLBACK_META_KEY = 'ankiMatchFallbackData';
    const LEGACY_WORDS_KEY = 'ankiMatchData';
    const LEGACY_ERRORS_KEY = 'ankiMatchWordErrors';
    const CONFIG_KEY = 'ankiMatchConfig';

    let database = null;
    let fallbackMode = false;
    let initializationError = null;

    const parseJson = (value, fallback) => {
        try { return value ? JSON.parse(value) : fallback; }
        catch (error) { return fallback; }
    };

    const wrapWord = (word, order) => ({ id: word.id, order, value: word });

    const unwrapWords = records => records
        .map((record, index) => ({
            order: Number.isFinite(record?.order) ? record.order : index,
            word: record?.value && typeof record.value === 'object' ? record.value : record
        }))
        .sort((a, b) => a.order - b.order)
        .map(item => item.word);

    const requestResult = request => new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('indexeddb-request-failed'));
    });

    const transactionResult = transaction => new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => reject(transaction.error || new Error('indexeddb-transaction-failed'));
        transaction.onabort = () => reject(transaction.error || new Error('indexeddb-transaction-aborted'));
    });

    const openDatabase = () => new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('indexeddb-unavailable'));
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(WORD_STORE)) {
                db.createObjectStore(WORD_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => db.close();
            resolve(db);
        };
        request.onerror = () => reject(request.error || new Error('indexeddb-open-failed'));
        request.onblocked = () => reject(new Error('indexeddb-blocked'));
    });

    const readFallbackMeta = () => {
        const value = parseJson(localStorage.getItem(FALLBACK_META_KEY), {});
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    };

    const writeFallbackMeta = value => {
        localStorage.setItem(FALLBACK_META_KEY, JSON.stringify(value));
        return true;
    };

    const getMetadataFromDb = async key => {
        const transaction = database.transaction(META_STORE, 'readonly');
        const record = await requestResult(transaction.objectStore(META_STORE).get(key));
        return record ? record.value : undefined;
    };

    const cleanupLegacyLocalStorage = () => {
        try {
            localStorage.removeItem(LEGACY_WORDS_KEY);
            localStorage.removeItem(LEGACY_ERRORS_KEY);
            const savedConfig = parseJson(localStorage.getItem(CONFIG_KEY), null);
            if (savedConfig && typeof savedConfig === 'object' && 'backgroundImage' in savedConfig) {
                delete savedConfig.backgroundImage;
                localStorage.setItem(CONFIG_KEY, JSON.stringify(savedConfig));
            }
        } catch (error) { }
    };

    const migrateLegacyData = async () => {
        const migratedVersion = Number(await getMetadataFromDb('migrationVersion')) || 0;
        if (migratedVersion >= MIGRATION_VERSION) {
            cleanupLegacyLocalStorage();
            return;
        }

        const legacyWords = parseJson(localStorage.getItem(LEGACY_WORDS_KEY), []);
        const legacyErrors = parseJson(localStorage.getItem(LEGACY_ERRORS_KEY), {});
        const legacyConfig = parseJson(localStorage.getItem(CONFIG_KEY), {});
        const existingWordCount = await requestResult(
            database.transaction(WORD_STORE, 'readonly').objectStore(WORD_STORE).count()
        );
        const existingErrors = await getMetadataFromDb('wordErrorCounts');
        const existingBackground = await getMetadataFromDb('backgroundImage');

        const transaction = database.transaction([WORD_STORE, META_STORE], 'readwrite');
        const wordStore = transaction.objectStore(WORD_STORE);
        const metadataStore = transaction.objectStore(META_STORE);

        if (existingWordCount === 0 && Array.isArray(legacyWords)) {
            const usedIds = new Set();
            legacyWords.forEach((word, index) => {
                if (!word || typeof word.front !== 'string' || typeof word.back !== 'string') return;
                const safeWord = { ...word };
                if (typeof safeWord.id !== 'string' || !safeWord.id || usedIds.has(safeWord.id)) {
                    safeWord.id = `legacy-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2)}`;
                }
                usedIds.add(safeWord.id);
                wordStore.put(wrapWord(safeWord, index));
            });
        }
        if (existingErrors === undefined && legacyErrors && typeof legacyErrors === 'object' && !Array.isArray(legacyErrors)) {
            metadataStore.put({ key: 'wordErrorCounts', value: legacyErrors });
        }
        if (existingBackground === undefined && typeof legacyConfig.backgroundImage === 'string') {
            metadataStore.put({ key: 'backgroundImage', value: legacyConfig.backgroundImage });
        }
        metadataStore.put({ key: 'migrationVersion', value: MIGRATION_VERSION });

        await transactionResult(transaction);
        cleanupLegacyLocalStorage();
    };

    const initialize = async () => {
        try {
            database = await openDatabase();
            await migrateLegacyData();
            fallbackMode = false;
            initializationError = null;
        } catch (error) {
            if (database) database.close();
            database = null;
            fallbackMode = true;
            initializationError = error;
            console.warn('IndexedDB 不可用，已回退到 localStorage。', error);
        }
        return { usingIndexedDB: !fallbackMode, error: initializationError };
    };

    const getWords = async () => {
        if (fallbackMode || !database) {
            const words = parseJson(localStorage.getItem(LEGACY_WORDS_KEY), []);
            return Array.isArray(words) ? words : [];
        }
        const transaction = database.transaction(WORD_STORE, 'readonly');
        const records = await requestResult(transaction.objectStore(WORD_STORE).getAll());
        return Array.isArray(records) ? unwrapWords(records) : [];
    };

    const replaceWords = async words => {
        if (fallbackMode || !database) {
            localStorage.setItem(LEGACY_WORDS_KEY, JSON.stringify(words));
            return true;
        }
        const transaction = database.transaction(WORD_STORE, 'readwrite');
        const store = transaction.objectStore(WORD_STORE);
        store.clear();
        words.forEach((word, index) => store.put(wrapWord(word, index)));
        return transactionResult(transaction);
    };

    const putWords = async (words, fallbackWords) => {
        if (!Array.isArray(words) || words.length === 0) return true;
        if (fallbackMode || !database) {
            localStorage.setItem(LEGACY_WORDS_KEY, JSON.stringify(fallbackWords || words));
            return true;
        }
        const transaction = database.transaction(WORD_STORE, 'readwrite');
        const store = transaction.objectStore(WORD_STORE);
        const orderById = new Map((fallbackWords || words).map((word, index) => [word.id, index]));
        words.forEach(word => store.put(wrapWord(word, orderById.get(word.id) ?? 0)));
        return transactionResult(transaction);
    };

    const deleteWord = async (wordId, fallbackWords) => {
        if (fallbackMode || !database) {
            localStorage.setItem(LEGACY_WORDS_KEY, JSON.stringify(fallbackWords || []));
            return true;
        }
        const transaction = database.transaction(WORD_STORE, 'readwrite');
        transaction.objectStore(WORD_STORE).delete(wordId);
        return transactionResult(transaction);
    };

    const getValue = async key => {
        if (fallbackMode || !database) {
            const fallbackData = readFallbackMeta();
            if (Object.prototype.hasOwnProperty.call(fallbackData, key)) return fallbackData[key];
            if (key === 'wordErrorCounts') {
                return parseJson(localStorage.getItem(LEGACY_ERRORS_KEY), {});
            }
            if (key === 'backgroundImage') {
                const savedConfig = parseJson(localStorage.getItem(CONFIG_KEY), {});
                return typeof savedConfig.backgroundImage === 'string' ? savedConfig.backgroundImage : '';
            }
            return undefined;
        }
        return getMetadataFromDb(key);
    };

    const setValue = async (key, value) => {
        if (fallbackMode || !database) {
            if (key === 'wordErrorCounts') {
                localStorage.setItem(LEGACY_ERRORS_KEY, JSON.stringify(value));
                return true;
            }
            if (key === 'backgroundImage') {
                const savedConfig = parseJson(localStorage.getItem(CONFIG_KEY), {});
                savedConfig.backgroundImage = value;
                localStorage.setItem(CONFIG_KEY, JSON.stringify(savedConfig));
                return true;
            }
            const fallbackData = readFallbackMeta();
            fallbackData[key] = value;
            return writeFallbackMeta(fallbackData);
        }
        const transaction = database.transaction(META_STORE, 'readwrite');
        transaction.objectStore(META_STORE).put({ key, value });
        return transactionResult(transaction);
    };

    const removeValue = async key => {
        if (fallbackMode || !database) {
            if (key === 'wordErrorCounts') {
                localStorage.removeItem(LEGACY_ERRORS_KEY);
                return true;
            }
            if (key === 'backgroundImage') {
                const savedConfig = parseJson(localStorage.getItem(CONFIG_KEY), {});
                delete savedConfig.backgroundImage;
                localStorage.setItem(CONFIG_KEY, JSON.stringify(savedConfig));
                return true;
            }
            const fallbackData = readFallbackMeta();
            delete fallbackData[key];
            return writeFallbackMeta(fallbackData);
        }
        const transaction = database.transaction(META_STORE, 'readwrite');
        transaction.objectStore(META_STORE).delete(key);
        return transactionResult(transaction);
    };

    const clearAll = async () => {
        if (fallbackMode || !database) {
            localStorage.removeItem(LEGACY_WORDS_KEY);
            localStorage.removeItem(LEGACY_ERRORS_KEY);
            localStorage.removeItem(FALLBACK_META_KEY);
            return true;
        }
        const transaction = database.transaction([WORD_STORE, META_STORE], 'readwrite');
        transaction.objectStore(WORD_STORE).clear();
        transaction.objectStore(META_STORE).clear();
        return transactionResult(transaction);
    };

    const getStatus = () => ({
        usingIndexedDB: !!database && !fallbackMode,
        fallbackMode,
        error: initializationError
    });

    return {
        initialize,
        getWords,
        replaceWords,
        putWords,
        deleteWord,
        getValue,
        setValue,
        removeValue,
        clearAll,
        getStatus
    };
})();
