// Rules for Thistle Field. Loaded by index.html with a script tag and by Node tests with require().
(() => {
    // Boards are stored tall (at most 9 columns) so they fit a phone. Wide screens show them turned on their side.
    const SIZES = {
        small: { cols: 8, rows: 8, thistles: 9 },
        medium: { cols: 9, rows: 11, thistles: 16 },
        large: { cols: 9, rows: 13, thistles: 24 }
    };

    const neighbours = (game, index) => {
        const row = Math.floor(index / game.cols);
        const col = index % game.cols;
        const list = [];
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const r = row + dr;
                const c = col + dc;
                if ((dr || dc) && r >= 0 && r < game.rows && c >= 0 && c < game.cols) list.push(r * game.cols + c);
            }
        }
        return list;
    };

    const create = ({ cols, rows, thistles }) => {
        const blank = (value) => new Array(cols * rows).fill(value);
        return {
            cols,
            rows,
            thistles,
            planted: false,
            thistle: blank(false),
            clue: blank(0),
            open: blank(false),
            marked: blank(false),
            opened: 0,
            struck: -1,
            status: 'playing'
        };
    };

    // Thistles go in on the first uncover, never on that tile or beside it, so the first tile always opens an area.
    const plant = (game, first, random) => {
        const blocked = new Set([first, ...neighbours(game, first)]);
        const free = game.thistle.map((_, index) => index).filter((index) => !blocked.has(index));
        for (let placed = 0; placed < game.thistles; placed++) {
            const pick = placed + Math.floor(random() * (free.length - placed));
            [free[placed], free[pick]] = [free[pick], free[placed]];
            game.thistle[free[placed]] = true;
        }
        game.clue = game.thistle.map((_, index) => neighbours(game, index).filter((near) => game.thistle[near]).length);
        game.planted = true;
    };

    // Opens a safe tile and, through every zero it reaches, the whole empty area around it. A wrong mark in the way is dropped.
    const openFrom = (game, start) => {
        const opened = [];
        const stack = [start];
        while (stack.length) {
            const index = stack.pop();
            if (game.open[index]) continue;
            game.open[index] = true;
            game.marked[index] = false;
            opened.push(index);
            if (game.clue[index] === 0) stack.push(...neighbours(game, index));
        }
        game.opened += opened.length;
        return opened;
    };

    const settle = (game) => {
        if (game.status === 'playing' && game.opened === game.cols * game.rows - game.thistles) game.status = 'won';
    };

    const uncover = (game, index, random = Math.random) => {
        if (game.status !== 'playing' || game.open[index] || game.marked[index]) return [];
        if (!game.planted) plant(game, index, random);
        if (game.thistle[index]) {
            game.status = 'lost';
            game.struck = index;
            return [];
        }
        const opened = openFrom(game, index);
        settle(game);
        return opened;
    };

    // On an uncovered number whose marks are complete, uncovers the rest of its neighbours.
    const uncoverAround = (game, index) => {
        if (game.status !== 'playing' || !game.open[index] || game.clue[index] === 0) return [];
        const near = neighbours(game, index);
        if (near.filter((spot) => game.marked[spot]).length !== game.clue[index]) return [];
        const targets = near.filter((spot) => !game.open[spot] && !game.marked[spot]);
        const hit = targets.find((spot) => game.thistle[spot]);
        if (hit !== undefined) {
            game.status = 'lost';
            game.struck = hit;
            return [];
        }
        const opened = targets.flatMap((spot) => openFrom(game, spot));
        settle(game);
        return opened;
    };

    const toggleMark = (game, index) => {
        if (game.status !== 'playing' || game.open[index]) return false;
        game.marked[index] = !game.marked[index];
        return true;
    };

    const thistlesLeft = (game) => game.thistles - game.marked.filter(Boolean).length;

    const api = { SIZES, create, uncover, uncoverAround, toggleMark, thistlesLeft };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.ThistleEngine = api;
    }
})();
