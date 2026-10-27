// XLSX 词库读取与识别：仅解析文本和值，不执行宏或公式。
const XLSXImportModule = (() => {
    const LIMITS = {
        maxFileSize: 15 * 1024 * 1024,
        maxSheets: 20,
        maxRowsPerSheet: 50000,
        maxColumns: 60,
        maxCellLength: 10000
    };

    const decodeXml = (value = '') => value
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(parseInt(number, 10)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/_x000D_/gi, '\r')
        .replace(/_x000A_/gi, '\n');

    const getAttributes = (source = '') => {
        const attributes = {};
        const pattern = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let match;
        while ((match = pattern.exec(source))) {
            attributes[match[1]] = decodeXml(match[2] ?? match[3] ?? '');
        }
        return attributes;
    };

    const resolveZipPath = (basePath, target) => {
        if (!target) return '';
        if (target.startsWith('/')) return target.slice(1);
        const parts = `${basePath.slice(0, basePath.lastIndexOf('/') + 1)}${target}`.split('/');
        const resolved = [];
        parts.forEach(part => {
            if (!part || part === '.') return;
            if (part === '..') resolved.pop();
            else resolved.push(part);
        });
        return resolved.join('/');
    };

    const readZipText = async (zip, path, required = false) => {
        const entry = zip.file(path);
        if (!entry) {
            if (required) throw new Error(`missing:${path}`);
            return '';
        }
        return entry.async('string');
    };

    const extractTextRuns = (xml = '') => {
        const parts = [];
        const pattern = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
        let match;
        while ((match = pattern.exec(xml))) parts.push(decodeXml(match[1]));
        return parts.join('');
    };

    const parseSharedStrings = (xml) => {
        if (!xml) return [];
        const strings = [];
        const pattern = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g;
        let match;
        while ((match = pattern.exec(xml))) strings.push(extractTextRuns(match[1]));
        return strings;
    };

    const columnIndexFromReference = (reference = '') => {
        const letters = reference.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() || '';
        let index = 0;
        for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
        return Math.max(0, index - 1);
    };

    const columnName = (index) => {
        let number = Number(index) + 1;
        let name = '';
        while (number > 0) {
            const remainder = (number - 1) % 26;
            name = String.fromCharCode(65 + remainder) + name;
            number = Math.floor((number - 1) / 26);
        }
        return name || 'A';
    };

    const parseWorksheet = (xml, sharedStrings, sheetName) => {
        const rows = [];
        const warnings = [];
        const rowPattern = /<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g;
        let rowMatch;
        let fallbackRowNumber = 0;

        while ((rowMatch = rowPattern.exec(xml))) {
            if (rows.length >= LIMITS.maxRowsPerSheet) {
                warnings.push(`工作表“${sheetName}”超过 ${LIMITS.maxRowsPerSheet} 行，后续内容未读取`);
                break;
            }
            const rowAttributes = getAttributes(rowMatch[1]);
            fallbackRowNumber += 1;
            const rowNumber = Math.max(1, Number(rowAttributes.r) || fallbackRowNumber);
            fallbackRowNumber = rowNumber;
            if (rowAttributes.hidden === '1' || rowAttributes.hidden === 'true') continue;

            const cells = [];
            const cellPattern = /<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g;
            let cellMatch;
            let fallbackColumn = 0;
            while ((cellMatch = cellPattern.exec(rowMatch[2]))) {
                const cellAttributes = getAttributes(cellMatch[1]);
                const columnIndex = cellAttributes.r
                    ? columnIndexFromReference(cellAttributes.r)
                    : fallbackColumn;
                fallbackColumn = columnIndex + 1;
                if (columnIndex >= LIMITS.maxColumns) continue;

                const type = cellAttributes.t || '';
                const cellBody = cellMatch[2];
                let value = '';
                if (type === 'inlineStr') {
                    value = extractTextRuns(cellBody);
                } else {
                    const rawValue = cellBody.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] ?? '';
                    if (type === 's') value = sharedStrings[Number(rawValue)] ?? '';
                    else if (type === 'b') value = rawValue === '1' ? 'TRUE' : 'FALSE';
                    else if (type === 'str') value = decodeXml(rawValue) || extractTextRuns(cellBody);
                    else value = decodeXml(rawValue);
                }
                value = String(value).slice(0, LIMITS.maxCellLength);
                if (value) cells[columnIndex] = value;
            }
            if (cells.some(value => String(value ?? '').trim())) rows.push({ number: rowNumber, cells });
        }
        return { name: sheetName, rows, warnings };
    };

    const readWorkbook = async (fileOrBuffer) => {
        if (typeof JSZip === 'undefined') throw new Error('xlsx-engine-missing');
        const size = Number(fileOrBuffer?.size ?? fileOrBuffer?.byteLength ?? 0);
        if (size > LIMITS.maxFileSize) throw new Error('xlsx-too-large');

        let zip;
        try {
            zip = await JSZip.loadAsync(fileOrBuffer);
        } catch (error) {
            throw new Error('xlsx-open-failed');
        }

        const workbookXml = await readZipText(zip, 'xl/workbook.xml', true);
        const relationshipsXml = await readZipText(zip, 'xl/_rels/workbook.xml.rels', true);
        const sharedStrings = parseSharedStrings(await readZipText(zip, 'xl/sharedStrings.xml'));

        const relationships = {};
        const relationshipPattern = /<(?:\w+:)?Relationship\b([^>]*)\/?\s*>/g;
        let relationshipMatch;
        while ((relationshipMatch = relationshipPattern.exec(relationshipsXml))) {
            const attributes = getAttributes(relationshipMatch[1]);
            if (attributes.Id && attributes.Target) {
                relationships[attributes.Id] = resolveZipPath('xl/workbook.xml', attributes.Target);
            }
        }

        const sheetDefinitions = [];
        const sheetPattern = /<(?:\w+:)?sheet\b([^>]*)\/?\s*>/g;
        let sheetMatch;
        while ((sheetMatch = sheetPattern.exec(workbookXml))) {
            const attributes = getAttributes(sheetMatch[1]);
            const relationshipId = attributes['r:id'];
            if (!relationshipId || !relationships[relationshipId]) continue;
            sheetDefinitions.push({
                name: attributes.name || `Sheet${sheetDefinitions.length + 1}`,
                path: relationships[relationshipId],
                hidden: attributes.state === 'hidden' || attributes.state === 'veryHidden'
            });
        }

        const visibleSheets = sheetDefinitions.filter(sheet => !sheet.hidden).slice(0, LIMITS.maxSheets);
        if (visibleSheets.length === 0) throw new Error('xlsx-no-visible-sheet');
        const sheets = [];
        const warnings = [];
        for (const definition of visibleSheets) {
            const sheetXml = await readZipText(zip, definition.path, true);
            const parsed = parseWorksheet(sheetXml, sharedStrings, definition.name);
            sheets.push(parsed);
            warnings.push(...parsed.warnings);
        }
        return { sheets, warnings };
    };

    const cleanCell = value => String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\r\n?/g, '\n')
        .trim();

    const containsHan = value => /[\u3400-\u9fff]/.test(value);
    const containsLatin = value => /[A-Za-z]/.test(value);
    const headerFront = new Set(['word', 'words', 'term', 'front', 'vocabulary', '单词', '英文', '词汇']);
    const headerBack = new Set(['meaning', 'meanings', 'definition', 'translation', 'back', '释义', '词义', '中文', '翻译', '意思']);
    const strongAdPattern = /(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|关注(?:微信|公众号)|微信公众号|扫码|加群|资料(?:领取|下载)|版权所有|侵权(?:联系|删除)|淘宝|网店|更多资料|点击链接|(?:微信|QQ|电话|手机|联系)[：:\s]*[A-Za-z0-9_-]{4,})/i;
    const phonePattern = /(?:^|\D)1[3-9]\d{9}(?:\D|$)/;

    const isHeaderPair = (front, back) =>
        headerFront.has(front.toLowerCase()) && headerBack.has(back.toLowerCase());

    const splitSingleCell = (value) => {
        const text = cleanCell(value);
        if (!text) return null;
        const delimiters = ['\t', ',', '，'];
        let bestIndex = -1;
        let bestDelimiter = '';
        delimiters.forEach(delimiter => {
            const index = text.indexOf(delimiter);
            if (index > 0 && (bestIndex < 0 || index < bestIndex)) {
                bestIndex = index;
                bestDelimiter = delimiter;
            }
        });
        if (bestIndex > 0) return [text.slice(0, bestIndex), text.slice(bestIndex + bestDelimiter.length)];

        const spaces = text.match(/[ \u3000]{2,}/);
        if (spaces?.index > 0) return [text.slice(0, spaces.index), text.slice(spaces.index + spaces[0].length)];

        const hanIndex = text.search(/[\u3400-\u9fff]/);
        if (hanIndex > 0) return [text.slice(0, hanIndex), text.slice(hanIndex)];
        if (hanIndex === 0) {
            const latin = text.match(/[A-Za-z]/);
            if (latin?.index > 0) return [text.slice(latin.index), text.slice(0, latin.index)];
        }
        return null;
    };

    const classifyPair = (frontValue, backValue) => {
        let front = cleanCell(frontValue);
        let back = cleanCell(backValue);
        if (containsHan(front) && !containsLatin(front) && containsLatin(back)) [front, back] = [back, front];
        if (!front && !back) return { accepted: false, reason: '空行', front, back };
        if (!front || !back) return { accepted: false, reason: '缺少单词或释义', front, back };
        if (isHeaderPair(front, back)) return { accepted: false, reason: '表头', front, back };
        if (strongAdPattern.test(`${front} ${back}`) || phonePattern.test(`${front} ${back}`)) {
            return { accepted: false, reason: '疑似广告或联系方式', front, back };
        }
        if (!containsLatin(front)) return { accepted: false, reason: '单词列缺少英文内容', front, back };
        if (/https?:\/\/|www\.|@/.test(front)) return { accepted: false, reason: '疑似链接或邮箱', front, back };
        if (front.length > 160 || front.includes('\n')) return { accepted: false, reason: '单词内容过长', front, back };
        if (back.length > 4000) return { accepted: false, reason: '释义内容过长', front, back };
        const tokenCount = front.split(/\s+/).filter(Boolean).length;
        if (tokenCount > 16) return { accepted: false, reason: '疑似英文句子', front, back };
        const confidence = containsHan(back) ? '高' : '中';
        return { accepted: true, reason: confidence === '高' ? '有效词汇' : '释义中没有中文，请检查', confidence, front, back };
    };

    const rowPair = (row, frontColumn, backColumn) => {
        if (frontColumn === backColumn) {
            const split = splitSingleCell(row.cells[frontColumn]);
            return split || ['', ''];
        }
        return [row.cells[frontColumn] ?? '', row.cells[backColumn] ?? ''];
    };

    const scoreColumnPair = (rows, frontColumn, backColumn) => {
        let accepted = 0;
        let highConfidence = 0;
        let populated = 0;
        rows.slice(0, 2000).forEach(row => {
            const [front, back] = rowPair(row, frontColumn, backColumn);
            if (cleanCell(front) || cleanCell(back)) populated += 1;
            const result = classifyPair(front, back);
            if (result.accepted) {
                accepted += 1;
                if (result.confidence === '高') highConfidence += 1;
            }
        });
        return accepted * 4 + highConfidence * 2 - Math.max(0, populated - accepted);
    };

    const detectColumns = (sheet) => {
        const maxColumn = Math.min(
            LIMITS.maxColumns,
            Math.max(1, ...sheet.rows.slice(0, 2000).map(row => row.cells.length))
        );
        let best = { frontColumn: 0, backColumn: maxColumn > 1 ? 1 : 0, score: -Infinity };
        for (let frontColumn = 0; frontColumn < maxColumn; frontColumn++) {
            for (let backColumn = 0; backColumn < maxColumn; backColumn++) {
                if (maxColumn > 1 && frontColumn === backColumn) continue;
                const score = scoreColumnPair(sheet.rows, frontColumn, backColumn);
                if (score > best.score) best = { frontColumn, backColumn, score };
            }
        }
        return best;
    };

    const detectStartRow = (sheet, frontColumn, backColumn) => {
        for (let index = 0; index < sheet.rows.length; index++) {
            const window = sheet.rows.slice(index, index + 5);
            const accepted = window.filter(row => {
                const [front, back] = rowPair(row, frontColumn, backColumn);
                return classifyPair(front, back).accepted;
            }).length;
            if (accepted >= Math.min(3, window.length)) return sheet.rows[index].number;
        }
        return sheet.rows[0]?.number || 1;
    };

    const analyzeSheet = (sheet, options = {}) => {
        const hasFrontColumn = Number.isInteger(options.frontColumn);
        const hasBackColumn = Number.isInteger(options.backColumn);
        const detected = hasFrontColumn && hasBackColumn ? null : detectColumns(sheet);
        const frontColumn = hasFrontColumn ? options.frontColumn : detected.frontColumn;
        const backColumn = hasBackColumn ? options.backColumn : detected.backColumn;
        const startRow = Math.max(1, Number(options.startRow) || detectStartRow(sheet, frontColumn, backColumn));
        const accepted = [];
        const rejected = [];
        const seen = new Map();
        let duplicateCount = 0;

        sheet.rows.forEach(row => {
            if (row.number < startRow) return;
            const [frontValue, backValue] = rowPair(row, frontColumn, backColumn);
            const result = classifyPair(frontValue, backValue);
            if (!result.accepted) {
                if (cleanCell(frontValue) || cleanCell(backValue)) rejected.push({ row: row.number, ...result });
                return;
            }
            const key = `${result.front.toLocaleLowerCase('en')}\u0000${result.back}`;
            if (seen.has(key)) {
                duplicateCount += 1;
                rejected.push({ row: row.number, ...result, accepted: false, reason: `与第 ${seen.get(key)} 行重复` });
                return;
            }
            seen.set(key, row.number);
            accepted.push({ row: row.number, front: result.front, back: result.back, confidence: result.confidence });
        });

        const mediumConfidenceCount = accepted.filter(item => item.confidence === '中').length;
        return {
            sheetName: sheet.name,
            startRow,
            frontColumn,
            backColumn,
            accepted,
            rejected,
            duplicateCount,
            mediumConfidenceCount,
            warnings: sheet.warnings || []
        };
    };

    const analyzeWorkbook = (workbook) => {
        const analyses = workbook.sheets.map(sheet => analyzeSheet(sheet));
        let recommendedSheetIndex = 0;
        analyses.forEach((analysis, index) => {
            if (analysis.accepted.length > analyses[recommendedSheetIndex].accepted.length) recommendedSheetIndex = index;
        });
        return { analyses, recommendedSheetIndex };
    };

    return { LIMITS, readWorkbook, analyzeSheet, analyzeWorkbook, columnName };
})();
