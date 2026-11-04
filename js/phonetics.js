// ---------- 本地美式 IPA ----------
const PhoneticModule = (() => {
    let dictionaryPromise = null;

    const arpabetToIpa = {
        AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ',
        B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', EH: 'ɛ', ER: 'ɝ', EY: 'eɪ',
        F: 'f', G: 'ɡ', HH: 'h', IH: 'ɪ', IY: 'i', JH: 'dʒ', K: 'k',
        L: 'l', M: 'm', N: 'n', NG: 'ŋ', OW: 'oʊ', OY: 'ɔɪ', P: 'p',
        R: 'r', S: 's', SH: 'ʃ', T: 't', TH: 'θ', UH: 'ʊ', UW: 'u',
        V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ'
    };

    const normalizeKey = value => String(value || '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('en');

    const convertArpabet = pronunciation => String(pronunciation || '')
        .trim()
        .split(/\s+/)
        .map(token => arpabetToIpa[token.replace(/[012]$/, '')] || '')
        .join('')
        .replace(/ɝ/g, 'ɜr');

    const loadDictionary = () => {
        if (dictionaryPromise) return dictionaryPromise;
        dictionaryPromise = fetch('vendor/us-arpabet-dictionary.json')
            .then(response => {
                if (!response.ok) throw new Error('phonetic-dictionary-unavailable');
                return response.json();
            })
            .catch(error => {
                console.warn('本地音标词典未加载', error);
                return {};
            });
        return dictionaryPromise;
    };

    const heuristicIpa = rawWord => {
        let word = normalizeKey(rawWord).replace(/[^a-z']/g, '');
        if (!word || !/[a-z]/.test(word)) return '';
        word = word
            .replace(/^kn/, 'n').replace(/^wr/, 'r').replace(/^ps/, 's')
            .replace(/tion$/g, 'ʃən').replace(/sion$/g, 'ʒən')
            .replace(/ture$/g, 'tʃər').replace(/dge/g, 'dʒ').replace(/tch/g, 'tʃ')
            .replace(/ch/g, 'tʃ').replace(/sh/g, 'ʃ').replace(/th/g, 'θ')
            .replace(/ph/g, 'f').replace(/ng/g, 'ŋ').replace(/qu/g, 'kw')
            .replace(/igh/g, 'aɪ').replace(/air/g, 'er').replace(/ear/g, 'ɪr')
            .replace(/ee|ea/g, 'i').replace(/oo/g, 'u').replace(/ou|ow/g, 'aʊ')
            .replace(/ai|ay|a_e/g, 'eɪ').replace(/oi|oy/g, 'ɔɪ')
            .replace(/oa|o_e/g, 'oʊ').replace(/i_e/g, 'aɪ').replace(/u_e/g, 'ju')
            .replace(/er|ir|ur/g, 'ɜr');

        word = word.replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
            .replace(/g(?=[eiy])/g, 'dʒ').replace(/x/g, 'ks')
            .replace(/a/g, 'æ').replace(/e/g, 'ɛ').replace(/i/g, 'ɪ')
            .replace(/o/g, 'ɑ').replace(/u/g, 'ʌ')
            .replace(/j/g, 'dʒ').replace(/y/g, 'j');
        return word.replace(/e$/g, '').replace(/(.)\1+/g, '$1');
    };

    const getUsIpa = async value => {
        const key = normalizeKey(value);
        if (!key || !/[a-z]/.test(key)) return { ipa: '', source: '' };
        const dictionary = await loadDictionary();
        if (dictionary[key]) return { ipa: convertArpabet(dictionary[key]), source: 'dictionary' };

        const parts = key.split(/([\s-]+)/);
        const resolved = [];
        let allFound = true;
        parts.forEach(part => {
            if (/^[\s-]+$/.test(part)) {
                resolved.push(part.includes('-') ? '–' : ' ');
                return;
            }
            if (dictionary[part]) resolved.push(convertArpabet(dictionary[part]));
            else {
                allFound = false;
                resolved.push(heuristicIpa(part));
            }
        });
        const ipa = resolved.join('').trim();
        return { ipa, source: allFound ? 'dictionary' : 'heuristic' };
    };

    const fillMissingPhonetics = async () => {
        const words = DataModule.getWords();
        const updates = [];
        for (const word of words) {
            if (String(word.phonetic || '').trim()) continue;
            const result = await getUsIpa(word.front);
            if (result.ipa) updates.push({ ...word, phonetic: result.ipa, phoneticSource: result.source });
        }
        if (updates.length) await DataModule.putWordUpdates(updates);
        return updates.length;
    };

    const refreshWordPhonetic = async wordId => {
        const word = DataModule.getWords().find(item => item.id === wordId);
        if (!word) return null;
        const result = await getUsIpa(word.front);
        const updated = { ...word, phonetic: result.ipa, phoneticSource: result.source };
        if (!await DataModule.putWordUpdates([updated])) return null;
        return updated;
    };

    return { fillMissingPhonetics, refreshWordPhonetic, normalizeKey };
})();
