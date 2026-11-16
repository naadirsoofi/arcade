// Pure level generator for Ice Trail. Loaded by index.html with a script tag and by Node tests with require().
(() => {
    const ICE = 0;
    const SNOW = 1;
    const ROCK = 2;

    const DIRS = [
        { name: 'up', dr: -1, dc: 0, opposite: 'down' },
        { name: 'right', dr: 0, dc: 1, opposite: 'left' },
        { name: 'down', dr: 1, dc: 0, opposite: 'up' },
        { name: 'left', dr: 0, dc: -1, opposite: 'right' }
    ];

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

    // Grid size, slide count and shortest allowed solution all grow with the level, then level off.
    const settings = (level) => ({
        size: Math.min(5 + Math.floor((level - 1) / 3), 10),
        slides: Math.min(4 + level, 30),
        minMoves: Math.min(3 + Math.floor((level - 1) / 3), 7)
    });

    // The tiles crossed when sliding from a tile until something blocks the way (the start tile is not included).
    const slide = (cols, rows, from, dir, open) => {
        const path = [];
        let row = Math.floor(from / cols);
        let col = from % cols;
        for (;;) {
            row += dir.dr;
            col += dir.dc;
            if (row < 0 || col < 0 || row >= rows || col >= cols || !open(row * cols + col)) return path;
            path.push(row * cols + col);
        }
    };

    // True when some sequence of at most maxMoves slides covers all the ice.
    const solvableWithin = (level, maxMoves) => {
        const open = (index) => level.cells[index] === ICE;
        const marked = new Array(level.cells.length).fill(false);
        marked[level.start] = true;
        const search = (position, left, movesLeft) => {
            if (left === 0) return true;
            if (movesLeft === 0) return false;
            return DIRS.some((dir) => {
                const path = slide(level.cols, level.rows, position, dir, open);
                if (!path.length) return false;
                const fresh = path.filter((index) => !marked[index]);
                fresh.forEach((index) => { marked[index] = true; });
                const found = search(path[path.length - 1], left - fresh.length, movesLeft - 1);
                fresh.forEach((index) => { marked[index] = false; });
                return found;
            });
        };
        return search(level.start, level.iceCount - 1, maxMoves);
    };

    // Scatters rocks, slides a token around at random, and keeps exactly the tiles it crossed as the ice.
    // The recorded slides stop at the same rocks and edges in the finished level, so they are a solution.
    const build = (level, rng) => {
        const { size, slides, minMoves } = settings(level);
        const total = size * size;
        const rock = new Array(total).fill(false);
        const rockCount = Math.round(total * (0.1 + rng() * 0.1));
        for (let placed = 0; placed < rockCount;) {
            const index = Math.floor(rng() * total);
            if (!rock[index]) {
                rock[index] = true;
                placed++;
            }
        }
        let position = Math.floor(rng() * total);
        while (rock[position]) position = Math.floor(rng() * total);
        const begin = position;

        const open = (index) => !rock[index];
        const covered = new Array(total).fill(false);
        covered[position] = true;
        const solution = [];
        let usefulMoves = 0;
        let last = null;
        for (let step = 0; step < slides; step++) {
            const all = DIRS.map((dir) => ({ dir, path: slide(size, size, position, dir, open) }))
                .filter((option) => option.path.length);
            if (!all.length) return null;
            const forward = all.filter((option) => !last || option.dir.name !== last.opposite);
            const options = forward.length ? forward : all;
            // Slides that reach new tiles are three times as likely as ones that only retrace.
            const weights = options.map((option) => (option.path.some((index) => !covered[index]) ? 3 : 1));
            let roll = rng() * weights.reduce((sum, weight) => sum + weight, 0);
            const choice = options.find((option, index) => {
                roll -= weights[index];
                return roll < 0;
            }) || options[options.length - 1];
            solution.push(choice.dir.name);
            if (choice.path.some((index) => !covered[index])) usefulMoves = solution.length;
            choice.path.forEach((index) => { covered[index] = true; });
            position = choice.path[choice.path.length - 1];
            last = choice.dir;
        }
        // Slides after the last new tile add nothing, so the solution ends there.
        solution.length = usefulMoves;
        const iceCount = covered.filter(Boolean).length;
        if (solution.length < Math.ceil(slides * 0.7) || iceCount < Math.floor(total * 0.45)) return null;

        // Crop to the rows and columns that hold ice. Everything outside is wall anyway.
        const rowsUsed = [];
        const colsUsed = [];
        covered.forEach((isIce, index) => {
            if (isIce) {
                rowsUsed.push(Math.floor(index / size));
                colsUsed.push(index % size);
            }
        });
        const top = Math.min(...rowsUsed);
        const left = Math.min(...colsUsed);
        const rows = Math.max(...rowsUsed) - top + 1;
        const cols = Math.max(...colsUsed) - left + 1;
        const cells = [];
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const index = (row + top) * size + col + left;
                let kind = SNOW;
                if (covered[index]) kind = ICE;
                else if (rock[index]) kind = ROCK;
                cells.push(kind);
            }
        }
        const start = (Math.floor(begin / size) - top) * cols + (begin % size) - left;

        const result = { level, cols, rows, cells, start, iceCount, solution };
        return solvableWithin(result, minMoves - 1) ? null : result;
    };

    // Level N is always the same level: each attempt is seeded from the level number alone.
    const generate = (level) => {
        for (let attempt = 0; ; attempt++) {
            const seed = (Math.imul(level, 0x9e3779b1) ^ Math.imul(attempt + 1, 0x85ebca6b)) >>> 0;
            const result = build(level, mulberry32(seed));
            if (result) return result;
        }
    };

    const api = { ICE, ROCK, DIRS, generate, slide };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.IceLevels = api;
    }
})();
