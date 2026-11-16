// Rules for Bloom Merge. Loaded by index.html with a script tag and by Node tests with require().
(() => {
    const EMPTY = 0;
    const STONE = -1;
    const GARDENS = {
        4: { size: 4, goal: 10, maxStones: 2 },
        5: { size: 5, goal: 12, maxStones: 3 }
    };
    const STONE_CHANCE = 0.07;
    const STONE_FREE_MOVES = 6;
    const SPROUT_CHANCE = 0.1;
    const MERGE_POINTS = 10;
    const STONE_POINTS = 30;

    // For each direction, every line of the board listed from the edge the tiles slide toward.
    const lines = (size, dir) => {
        const all = [];
        for (let a = 0; a < size; a++) {
            const line = [];
            for (let b = 0; b < size; b++) {
                if (dir === 'left') line.push(a * size + b);
                else if (dir === 'right') line.push(a * size + (size - 1 - b));
                else if (dir === 'up') line.push(b * size + a);
                else line.push((size - 1 - b) * size + a);
            }
            all.push(line);
        }
        return all;
    };

    // Slides every tile as far as it goes. Two equal plants that meet grow one stage, and a tile grows at most once per move.
    const slide = (cells, size, dir) => {
        const next = new Array(cells.length).fill(EMPTY);
        const slides = [];
        const merges = [];
        lines(size, dir).forEach((line) => {
            let filled = 0;
            let canGrow = false;
            line.forEach((from) => {
                const value = cells[from];
                if (value === EMPTY) return;
                const ahead = line[filled - 1];
                if (canGrow && value > 0 && next[ahead] === value) {
                    next[ahead] = value + 1;
                    canGrow = false;
                    slides.push({ from, to: ahead });
                    merges.push({ at: ahead, stage: value + 1 });
                } else {
                    next[line[filled]] = value;
                    slides.push({ from, to: line[filled] });
                    canGrow = true;
                    filled++;
                }
            });
        });
        const changed = slides.some((entry) => entry.from !== entry.to);
        return { cells: next, slides, merges, changed };
    };

    const beside = (size, index) => {
        const row = Math.floor(index / size);
        const col = index % size;
        const list = [];
        if (row > 0) list.push(index - size);
        if (row < size - 1) list.push(index + size);
        if (col > 0) list.push(index - 1);
        if (col < size - 1) list.push(index + 1);
        return list;
    };

    const emptyCells = (cells) => cells.map((value, index) => (value === EMPTY ? index : -1)).filter((index) => index >= 0);

    const spawn = (game, random) => {
        const free = emptyCells(game.cells);
        if (!free.length) return null;
        const at = free[Math.floor(random() * free.length)];
        const stones = game.cells.filter((value) => value === STONE).length;
        const stoneAllowed = game.moves >= STONE_FREE_MOVES && stones < GARDENS[game.size].maxStones;
        let value = 1;
        if (stoneAllowed && random() < STONE_CHANCE) value = STONE;
        else if (random() < SPROUT_CHANCE) value = 2;
        game.cells[at] = value;
        return { at, value };
    };

    const create = (size, random = Math.random) => {
        const game = { size, cells: new Array(size * size).fill(EMPTY), score: 0, moves: 0, top: 1, previous: null };
        spawn(game, random);
        spawn(game, random);
        game.top = Math.max(...game.cells);
        return game;
    };

    // Returns null and leaves the game untouched when the slide changes nothing.
    const move = (game, dir, random = Math.random) => {
        const result = slide(game.cells, game.size, dir);
        if (!result.changed) return null;
        game.previous = { cells: game.cells, score: game.score, moves: game.moves, top: game.top };
        game.cells = result.cells;

        // A merge clears any stone directly beside the grown plant.
        const cleared = [];
        result.merges.forEach((merge) => {
            beside(game.size, merge.at).forEach((index) => {
                if (game.cells[index] === STONE) {
                    game.cells[index] = EMPTY;
                    cleared.push(index);
                }
            });
        });

        const gained = result.merges.reduce((sum, merge) => sum + merge.stage * MERGE_POINTS, 0) + cleared.length * STONE_POINTS;
        game.score += gained;
        game.moves++;
        const spawned = spawn(game, random);
        game.top = Math.max(game.top, ...game.cells);
        return { slides: result.slides, merges: result.merges, cleared, spawned, gained };
    };

    const canMove = (game) => {
        const { cells, size } = game;
        return cells.some((value, index) => {
            if (value === EMPTY) return true;
            if (value === STONE) return false;
            const col = index % size;
            return (col < size - 1 && cells[index + 1] === value) || cells[index + size] === value;
        });
    };

    const undo = (game) => {
        if (!game.previous) return false;
        Object.assign(game, game.previous, { previous: null });
        return true;
    };

    const api = { STONE, GARDENS, slide, create, move, canMove, undo };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.BloomEngine = api;
    }
})();
