// Pure level generator for Dot Garden. Loaded by index.html with a script tag and by Node tests with require().
(() => {
    const MIN_LENGTH = 3;
    const CANDIDATES = 12;

    const mulberry32 = (seed) => {
        let a = seed >>> 0;
        return () => {
            a = (a + 0x6d2b79f5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    };

    // Gardens grow from 5x5 to 8x8, with more pairs as they grow. From level 19 on the pair count cycles 7, 8, 9.
    const settings = (level) => {
        if (level <= 4) return { size: 5, pairs: level <= 2 ? 4 : 5 };
        if (level <= 10) return { size: 6, pairs: level <= 7 ? 5 : 6 };
        if (level <= 18) return { size: 7, pairs: 6 + Math.floor((level - 11) / 3) };
        return { size: 8, pairs: 7 + ((level - 19) % 3) };
    };

    const neighbors = (size, cell) => {
        const row = Math.floor(cell / size);
        const col = cell % size;
        const list = [];
        if (row > 0) list.push(cell - size);
        if (col < size - 1) list.push(cell + 1);
        if (row < size - 1) list.push(cell + size);
        if (col > 0) list.push(cell - 1);
        return list;
    };

    const pick = (list, rng) => list[Math.floor(rng() * list.length)];

    // One path through every cell: start from a back-and-forth snake, then shuffle it with backbite moves
    // (join an end to a neighbor further along the path and reverse the loop that closes).
    const windingPath = (size, rng) => {
        let path = [];
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                path.push(row * size + (row % 2 ? size - 1 - col : col));
            }
        }
        for (let move = 0; move < size * size * 12; move++) {
            if (rng() < 0.5) path.reverse();
            const end = path[path.length - 1];
            const target = pick(neighbors(size, end).filter((cell) => cell !== path[path.length - 2]), rng);
            const at = path.indexOf(target);
            path = path.slice(0, at + 1).concat(path.slice(at + 1).reverse());
        }
        return path;
    };

    // Lets path ends take cells from the ends of neighboring paths, so flowers of different pairs
    // do not always sit side by side. No path drops below the minimum length or folds back on itself.
    const trade = (size, paths, rng) => {
        const owner = new Array(size * size);
        paths.forEach((path, index) => path.forEach((cell) => { owner[cell] = index; }));
        for (let move = 0; move < size * size * 8; move++) {
            const taker = Math.floor(rng() * paths.length);
            const path = paths[taker];
            const atHead = rng() < 0.5;
            const end = atHead ? path[0] : path[path.length - 1];
            const choices = neighbors(size, end).filter((cell) => {
                const other = paths[owner[cell]];
                if (owner[cell] === taker || other.length <= MIN_LENGTH) return false;
                if (cell !== other[0] && cell !== other[other.length - 1]) return false;
                return !neighbors(size, cell).some((next) => next !== end && owner[next] === taker);
            });
            if (!choices.length) continue;
            const cell = pick(choices, rng);
            const giver = paths[owner[cell]];
            if (cell === giver[0]) giver.shift();
            else giver.pop();
            if (atHead) path.unshift(cell);
            else path.push(cell);
            owner[cell] = taker;
        }
    };

    // Counts places where a path runs alongside itself. Fewer folds make a cleaner looking garden.
    const countFolds = (size, paths) => {
        let folds = 0;
        paths.forEach((path) => {
            const order = new Map(path.map((cell, index) => [cell, index]));
            path.forEach((cell, index) => {
                neighbors(size, cell).forEach((next) => {
                    if (order.has(next) && order.get(next) > index + 1) folds++;
                });
            });
        });
        return folds;
    };

    const build = (size, pairs, rng) => {
        const whole = windingPath(size, rng);
        const lengths = new Array(pairs).fill(MIN_LENGTH);
        for (let spare = whole.length - pairs * MIN_LENGTH; spare > 0; spare--) {
            lengths[Math.floor(rng() * pairs)]++;
        }
        let from = 0;
        const paths = lengths.map((length) => {
            from += length;
            return whole.slice(from - length, from);
        });
        trade(size, paths, rng);
        for (let index = paths.length - 1; index > 0; index--) {
            const swap = Math.floor(rng() * (index + 1));
            [paths[index], paths[swap]] = [paths[swap], paths[index]];
        }
        return paths;
    };

    // Level N is always the same garden: every candidate is seeded from the level number alone.
    // The paths fill the whole grid, so drawing them back in is a solution. Only their two ends are shown as flowers.
    const generate = (level) => {
        const { size, pairs } = settings(level);
        let best = null;
        let bestFolds = Infinity;
        for (let attempt = 0; attempt < CANDIDATES || !best; attempt++) {
            const seed = (Math.imul(level, 0x9e3779b1) ^ Math.imul(attempt + 1, 0x85ebca6b)) >>> 0;
            const paths = build(size, pairs, mulberry32(seed));
            // A pair whose two flowers touch reads as already linked, so skip that garden.
            const touching = paths.some((path) => neighbors(size, path[0]).includes(path[path.length - 1]));
            const folds = countFolds(size, paths);
            if (!touching && folds < bestFolds) {
                best = paths;
                bestFolds = folds;
            }
        }
        return { level, size, paths: best };
    };

    const api = { generate };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.GardenLevels = api;
    }
})();
