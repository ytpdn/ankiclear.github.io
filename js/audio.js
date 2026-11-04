// ==========================================
// 2. 音效层 (AudioModule)
// ==========================================
const AudioModule = (() => {
    const sources = {
        click: 'audio/audio-click.mp3',
        correct: 'audio/audio-correct.mp3',
        wrong: 'audio/audio-wrong.mp3',
        switch: 'audio/audio-pageswitch.mp3'
    };
    const players = {};
    let masterVolume = 1;

    const getPlayer = (name) => {
        if (!sources[name]) return null;
        if (!players[name]) {
            const player = new Audio(sources[name]);
            player.preload = 'auto';
            player.volume = masterVolume;
            players[name] = player;
        }
        return players[name];
    };

    const play = (name) => {
        const player = getPlayer(name);
        if (!player) return;
        try {
            player.pause();
            player.currentTime = 0;
            const promise = player.play();
            if (promise && typeof promise.catch === 'function') promise.catch(() => { });
        } catch (e) { }
    };

    const bindGlobalButtonSound = () => {
        document.addEventListener('click', event => {
            const button = event.target.closest && event.target.closest('button');
            if (button && !button.disabled) play('click');
        }, true);
    };

    const preload = () => Object.keys(sources).forEach(getPlayer);

    const setVolume = (value) => {
        const numericValue = Number(value);
        masterVolume = Number.isFinite(numericValue)
            ? Math.max(0, Math.min(1, numericValue))
            : 1;
        Object.values(players).forEach(player => { player.volume = masterVolume; });
    };

    return { play, preload, bindGlobalButtonSound, setVolume };
})();
