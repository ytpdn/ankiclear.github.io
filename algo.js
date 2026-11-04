// ==========================================
// algo.js - FSRS-6 间隔重复算法（精简集成版）
// 参考：
//   - FSRS-6 官方默认权重（21 个参数）
//   - DSR 模型：Difficulty / Stability / Retrievability
//   - 幂律遗忘曲线 R(t, S) = (1 + factor * t / S)^(-decay)
// ==========================================

const AlgoModule = (() => {
    // FSRS-6 默认权重（来源：py-fsrs / fsrs-rs 6.x）
    const W = [
        0.212, 1.2931, 2.3065, 8.2956,   // w0-w3: 初始稳定性（Again/Hard/Good/Easy）
        6.4133, 0.8334, 3.0194, 0.001,    // w4-w7: 初始难度与难度更新
        1.8722, 0.1666, 0.796, 1.4835,    // w8-w11: 稳定性增长、失败恢复
        0.0614, 0.2629, 1.6483, 0.6014,   // w12-w15: 失败稳定性、Hard 惩罚
        1.8729, 0.5425, 0.0912, 0.0658,   // w16-w19: Easy 奖励、短时稳定性
        0.1542                           // w20: 遗忘曲线衰减率
    ];

    const CONFIG = {
        desiredRetention: 0.90,
        maximumInterval: 36500,
        minimumStability: 0.1,
        shortTermMinutes: { correct: 10, wrong: 1 }
    };

    // ---------- 工具函数 ----------
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    const daysBetween = (a, b) => Math.max(0, (b - a) / (24 * 60 * 60 * 1000));

    const forgettingCurve = (elapsedDays, stability) => {
        if (stability <= 0) return 0;
        const factor = Math.pow(0.9, -1 / W[20]) - 1;
        return Math.pow(1 + factor * elapsedDays / stability, -W[20]);
    };

    const nextInterval = (stability, desiredRetention = CONFIG.desiredRetention) => {
        const factor = Math.pow(0.9, -1 / W[20]) - 1;
        const interval = (stability / factor) * (Math.pow(desiredRetention, -1 / W[20]) - 1);
        return clamp(Math.round(interval), 1, CONFIG.maximumInterval);
    };

    const initialStability = (grade) => {
        const idx = clamp(Math.round(grade), 1, 4) - 1;
        return Math.max(CONFIG.minimumStability, W[idx]);
    };

    const initialDifficulty = (grade) => {
        const d = W[4] - Math.exp(W[5] * (grade - 1)) + 1;
        return clamp(d, 1, 10);
    };

    // 均值回归目标：官方使用 D0(4)（Easy 的初始难度）
    const D0_EASY = initialDifficulty(4);

    /**
     * 难度更新（含线性阻尼 + 均值回归，贴近 FSRS-6 官方）
     * D' = D + ΔD · (10 - D) / 9
     * D'' = w7 · D0(4) + (1 - w7) · D'
     */
    const nextDifficulty = (D, grade) => {
        const deltaD = -W[6] * (grade - 3);
        const damped = D + deltaD * (10 - D) / 9;
        const regressed = W[7] * D0_EASY + (1 - W[7]) * damped;
        return clamp(regressed, 1, 10);
    };

    // 成功复习稳定性更新
    const stabilityAfterSuccess = (S, D, R, grade) => {
        const hardPenalty = grade === 2 ? W[15] : 1;
        const easyBonus = grade === 4 ? W[16] : 1;

        const growth = Math.exp(W[8])
            * (11 - D)
            * Math.pow(S, -W[9])
            * (Math.exp(W[10] * (1 - R)) - 1)
            * hardPenalty
            * easyBonus;

        return Math.max(CONFIG.minimumStability, S * (1 + growth));
    };

    // 失败复习稳定性更新
    const stabilityAfterLapse = (S, D, R) => {
        const newS = W[11]
            * Math.pow(D, -W[12])
            * (Math.pow(S + 1, W[13]) - 1)
            * Math.exp(W[14] * (1 - R));

        return Math.max(CONFIG.minimumStability, Math.min(S, newS));
    };

    /**
     * 短时稳定性（同日复习）
     * S' = S · e^(w17 · (G - 3 + w18)) · S^(-w19)
     */
    const shortTermStability = (S, grade) => {
        const s = clamp(Number.isFinite(S) ? S : CONFIG.minimumStability,
            CONFIG.minimumStability, CONFIG.maximumInterval);
        const candidate = s
            * Math.exp(W[17] * (grade - 3 + W[18]))
            * Math.pow(s, -W[19]);

        // FSRS-6 safeguard: a successful same-day review (Good/Easy) must
        // never reduce stability. Again may reduce it as intended.
        const guarded = grade >= 3 ? Math.max(s, candidate) : candidate;
        return clamp(guarded, CONFIG.minimumStability, CONFIG.maximumInterval);
    };

    // ---------- 核心更新函数 ----------
    const updateCard = (card, isCorrect, options = {}) => {
        const now = Date.now();
        const graduateToDays = options.graduateToDays === true;

        // 兼容旧数据
        let S = card.stability != null
            ? card.stability
            : (card.state === 'new' ? 0 : Math.max(CONFIG.minimumStability, card.interval || 1));
        let D = card.difficulty != null ? card.difficulty : D0_EASY;
        let lastReview = card.lastReview || null;
        let state = card.state || 'new';

        // 二元评价：Good / Again
        const grade = isCorrect ? 3 : 1;

        // ---------- 新卡首次评价 ----------
        if (state === 'new' || lastReview == null) {
            S = initialStability(grade);
            D = initialDifficulty(grade);
            state = isCorrect ? 'learning' : 'relearning';

            const dueDate = now + (isCorrect
                ? CONFIG.shortTermMinutes.correct
                : CONFIG.shortTermMinutes.wrong) * 60 * 1000;

            return {
                ...card,
                stability: S,
                difficulty: D,
                state,
                dueDate,
                lastReview: now,
                interval: 0,
                ease: card.ease || 2.5,
                stepIndex: 0
            };
        }

        // ---------- 已有复习历史 ----------
        const elapsedDays = daysBetween(lastReview, now);
        const R = forgettingCurve(elapsedDays, S);

        // 同日复习（elapsedDays < 1）：使用短时稳定性
        if (elapsedDays < 1) {
            const newS = shortTermStability(S, grade);
            const newD = nextDifficulty(D, grade);
            const intervalDays = isCorrect && graduateToDays ? nextInterval(newS) : 0;
            const dueDate = intervalDays > 0
                ? now + intervalDays * 24 * 60 * 60 * 1000
                : now + (isCorrect
                    ? CONFIG.shortTermMinutes.correct
                    : CONFIG.shortTermMinutes.wrong) * 60 * 1000;

            return {
                ...card,
                stability: newS,
                difficulty: newD,
                state: intervalDays > 0 ? 'review' : (isCorrect ? 'learning' : 'relearning'),
                dueDate,
                lastReview: now,
                interval: intervalDays > 0 ? intervalDays : (card.interval || 0)
            };
        }

        // ---------- 跨日复习：完整 FSRS 更新 ----------
        let newS, newD;

        if (isCorrect) {
            newD = nextDifficulty(D, grade);
            newS = stabilityAfterSuccess(S, D, R, grade);
            state = 'review';
        } else {
            newD = nextDifficulty(D, grade);
            newS = stabilityAfterLapse(S, D, R);
            state = 'relearning';
        }

        const intervalDays = nextInterval(newS);
        const dueDate = now + intervalDays * 24 * 60 * 60 * 1000;

        return {
            ...card,
            stability: newS,
            difficulty: newD,
            state,
            dueDate,
            lastReview: now,
            interval: intervalDays,
            ease: card.ease || 2.5,
            stepIndex: 0
        };
    };

    return { updateCard };
})();
