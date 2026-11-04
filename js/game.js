// ==========================================
// 3. 游戏层 (GameModule)
// ==========================================
const GameModule = (() => {
    let currentGroup = [];
    let leftCards = [];
    let rightCards = [];
    let customCards = [];
    let currentLayoutMode = 'two-column';
    let currentAllowSameColumn = false;
    let currentCustomRows = 4;
    let currentCustomColumns = 4;
    let selectedCardEl = null;
    let selectedWordObj = null;
    let onCardMatchCallback = null;
    let onGroupCompleteCallback = null;

    const board = document.getElementById('board');
    const colLeft = document.getElementById('colLeft');
    const colRight = document.getElementById('colRight');
    const customBoardGrid = document.getElementById('customBoardGrid');

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
        customCards = [];
        currentLayoutMode = config.layoutMode === 'custom' ? 'custom' : 'two-column';
        currentAllowSameColumn = !!config.allowSameColumn;
        currentCustomRows = config.customRows;
        currentCustomColumns = config.customColumns;

        const shuffled = [...groupWords].sort(() => 0.5 - Math.random());
        const N = shuffled.length;
        if (currentLayoutMode === 'custom') {
            customCards = shuffled.flatMap(word => [
                { word, type: 'front', matched: false },
                { word, type: 'back', matched: false }
            ]).sort(() => 0.5 - Math.random());
            renderBoard();
            return;
        }

        if (currentAllowSameColumn) {
            const allCards = shuffled.flatMap(word => [
                { word, type: 'front', matched: false },
                { word, type: 'back', matched: false }
            ]).sort(() => 0.5 - Math.random());
            leftCards = allCards.slice(0, N);
            rightCards = allCards.slice(N);
            renderBoard();
            return;
        }

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
        currentLayoutMode = snapshot.layoutMode === 'custom' && Array.isArray(snapshot.customCards)
            ? 'custom'
            : 'two-column';
        currentAllowSameColumn = !!snapshot.allowSameColumn;
        currentCustomRows = Math.max(2, Number(snapshot.customRows) || config.customRows || 4);
        currentCustomColumns = Math.max(2, Number(snapshot.customColumns) || config.customColumns || 4);
        leftCards = (snapshot.leftCards || []).map(resolve).filter(Boolean);
        rightCards = (snapshot.rightCards || []).map(resolve).filter(Boolean);
        customCards = (snapshot.customCards || []).map(resolve).filter(Boolean);
        selectedCardEl = null;
        selectedWordObj = null;
        renderBoard();
    };

    const getSnapshot = () => ({
        currentGroupIds: currentGroup.map(w => w.id),
        layoutMode: currentLayoutMode,
        allowSameColumn: currentAllowSameColumn,
        customRows: currentCustomRows,
        customColumns: currentCustomColumns,
        leftCards: leftCards.map(c => ({ id: c.word.id, type: c.type, matched: !!c.matched })),
        rightCards: rightCards.map(c => ({ id: c.word.id, type: c.type, matched: !!c.matched })),
        customCards: customCards.map(c => ({ id: c.word.id, type: c.type, matched: !!c.matched }))
    });

    const isGroupComplete = () => currentLayoutMode === 'custom'
        ? customCards.length > 0 && customCards.every(c => c.matched)
        : leftCards.length > 0 && leftCards.every(c => c.matched) && rightCards.every(c => c.matched);

    const reset = () => {
        currentGroup = [];
        leftCards = [];
        rightCards = [];
        customCards = [];
        selectedCardEl = null;
        selectedWordObj = null;
        colLeft.innerHTML = '';
        colRight.innerHTML = '';
        customBoardGrid.innerHTML = '';
        customBoardGrid.hidden = true;
        colLeft.hidden = false;
        colRight.hidden = false;
        document.body.classList.remove('custom-layout-active');
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
        customBoardGrid.innerHTML = '';
        const customMode = currentLayoutMode === 'custom';
        document.body.classList.toggle('custom-layout-active', customMode);
        colLeft.hidden = customMode;
        colRight.hidden = customMode;
        customBoardGrid.hidden = !customMode;
        if (customMode) {
            customBoardGrid.style.setProperty('--custom-rows', String(currentCustomRows));
            customBoardGrid.style.setProperty('--custom-columns', String(currentCustomColumns));
            const fragment = document.createDocumentFragment();
            customCards.forEach(card => {
                const cardEl = createCardEl(card.word, card.type);
                if (card.matched) cardEl.classList.add('matched');
                fragment.appendChild(cardEl);
            });
            customBoardGrid.appendChild(fragment);
            return;
        }
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
        customCards.forEach(c => { if (c.word.id === wordId) c.matched = true; });
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

        const isDisallowedSameColumn = currentLayoutMode === 'two-column' &&
            !currentAllowSameColumn && selectedCardEl.parentNode === cardEl.parentNode;
        if (isDisallowedSameColumn || selectedCardEl.dataset.type === type) {
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
                    if (currentLayoutMode !== 'custom') {
                        el1.remove();
                        el2.remove();
                    }
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

    return { init, loadGroup, reset, restoreSnapshot, getSnapshot };
})();
