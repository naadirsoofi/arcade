// Pure puzzle generator for Circuit Flip. Loaded by index.html with a script tag and by Node tests with require().
(() => {
    // A tile is a bit mask of the sides its wires reach. Rotating clockwise shifts the mask one bit left.
    const DIRS = [
        { name: 'n', bit: 1, opposite: 4, dr: -1, dc: 0 },
        { name: 'e', bit: 2, opposite: 8, dr: 0, dc: 1 },
        { name: 's', bit: 4, opposite: 1, dr: 1, dc: 0 },
        { name: 'w', bit: 8, opposite: 2, dr: 0, dc: -1 }
    ];
    const MAX_BRANCHES = 3;

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

    const rotate = (mask, turns) => {
        let result = mask;
        for (let turn = 0; turn < (turns & 3); turn++) {
            result = ((result << 1) & 15) | (result >> 3);
        }
        return result;
    };

    const wireCount = (mask) => DIRS.filter((dir) => mask & dir.bit).length;

    const neighbor = (size, index, dir) => {
        const row = Math.floor(index / size) + dir.dr;
        const col = (index % size) + dir.dc;
        return row < 0 || col < 0 || row >= size || col >= size ? -1 : row * size + col;
    };

    // The tile a wire end joins, or -1 when that end is loose (board edge, or the next tile has no wire facing back).
    const joined = (masks, size, index, dir) => {
        if (!(masks[index] & dir.bit)) return -1;
        const next = neighbor(size, index, dir);
        return next >= 0 && masks[next] & dir.opposite ? next : -1;
    };

    // Which tiles are powered: everything reachable from the source through joined wires.
    const flow = (masks, size, source) => {
        const lit = new Array(masks.length).fill(false);
        const queue = [source];
        lit[source] = true;
        while (queue.length) {
            const index = queue.pop();
            DIRS.forEach((dir) => {
                const next = joined(masks, size, index, dir);
                if (next >= 0 && !lit[next]) {
                    lit[next] = true;
                    queue.push(next);
                }
            });
        }
        return lit;
    };

    // Grows a random spanning tree where no tile has more than three wires (so there are no cross tiles).
    // Mostly extends the newest branch for long runs, sometimes an older one for side branches.
    // Returns null in the rare case the branch limit walls off a tile, and the caller tries again.
    const growTree = (size, source, rng) => {
        const masks = new Array(size * size).fill(0);
        const active = [source];
        let reached = 1;
        while (active.length) {
            const pick = rng() < 0.6 ? active.length - 1 : Math.floor(rng() * active.length);
            const index = active[pick];
            const open = DIRS.filter((dir) => {
                const next = neighbor(size, index, dir);
                return next >= 0 && next !== source && masks[next] === 0;
            });
            if (!open.length || wireCount(masks[index]) >= MAX_BRANCHES) {
                active.splice(pick, 1);
                continue;
            }
            const dir = open[Math.floor(rng() * open.length)];
            const next = neighbor(size, index, dir);
            masks[index] |= dir.bit;
            masks[next] |= dir.opposite;
            active.push(next);
            reached++;
        }
        return reached === masks.length ? masks : null;
    };

    const generate = (size, seed) => {
        const rng = mulberry32(seed);
        let solution = null;
        let source = 0;
        while (!solution) {
            source = Math.floor(rng() * size * size);
            solution = growTree(size, source, rng);
        }
        const bulbs = [];
        solution.forEach((mask, index) => {
            if (index !== source && wireCount(mask) === 1) bulbs.push(index);
        });

        // Scramble until the puzzle does not start with every bulb already lit.
        let start;
        let lit;
        do {
            start = solution.map((mask) => rotate(mask, Math.floor(rng() * 4)));
            lit = flow(start, size, source);
        } while (bulbs.every((index) => lit[index]));

        return { size, seed, source, bulbs, solution, start };
    };

    const api = { DIRS, generate, rotate, wireCount, joined, flow };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.CircuitLevels = api;
    }
})();
