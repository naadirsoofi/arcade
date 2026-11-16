// Four Fall rules and the computer player. Runs unchanged in the page, in a Web Worker and in Node.
(function (root) {
    'use strict';

    const COLS = 7, ROWS = 6, CELLS = COLS * ROWS;
    // Cells are numbered column by column from the bottom: cell = column * 6 + row. The players are 1 (first) and -1.
    const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

    // Every run of four cells on the board, for scoring unfinished positions.
    const WINDOWS = [];
    for (let col = 0; col < COLS; col++) {
        for (let row = 0; row < ROWS; row++) {
            DIRECTIONS.forEach(([dc, dr]) => {
                const endCol = col + 3 * dc, endRow = row + 3 * dr;
                if (endCol >= COLS || endRow < 0 || endRow >= ROWS) return;
                WINDOWS.push([0, 1, 2, 3].map((step) => (col + step * dc) * ROWS + row + step * dr));
            });
        }
    }

    const play = (pos, col) => {
        pos.cells[col * ROWS + pos.heights[col]] = pos.side;
        pos.heights[col]++;
        pos.moves.push(col);
        pos.side = -pos.side;
    };

    const undo = (pos) => {
        const col = pos.moves.pop();
        pos.heights[col]--;
        pos.cells[col * ROWS + pos.heights[col]] = 0;
        pos.side = -pos.side;
    };

    // A game is its list of columns, written as digits 0 to 6.
    const create = (moves = '') => {
        const pos = { cells: new Int8Array(CELLS), heights: new Int8Array(COLS), side: 1, moves: [] };
        for (const digit of moves) play(pos, Number(digit));
        return pos;
    };

    const canPlay = (pos, col) => pos.heights[col] < ROWS;

    // Discs of one player in a straight line through a cell, counting the cell itself (which may still be empty).
    const runLength = (cells, col, row, who, dc, dr) => {
        let count = 1;
        for (let sign = -1; sign <= 1; sign += 2) {
            let c = col + dc * sign, r = row + dr * sign;
            while (c >= 0 && c < COLS && r >= 0 && r < ROWS && cells[c * ROWS + r] === who) {
                count++;
                c += dc * sign;
                r += dr * sign;
            }
        }
        return count;
    };

    const wouldWin = (pos, col, who) => {
        const row = pos.heights[col];
        for (let i = 0; i < 4; i++) {
            if (runLength(pos.cells, col, row, who, DIRECTIONS[i][0], DIRECTIONS[i][1]) >= 4) return true;
        }
        return false;
    };

    // The game ends when the last disc completed a line of four or more, or when the board is full.
    const status = (pos) => {
        if (!pos.moves.length) return { over: false, winner: 0, line: [] };
        const col = pos.moves[pos.moves.length - 1], row = pos.heights[col] - 1;
        const who = -pos.side, cells = pos.cells;
        const line = new Set();
        DIRECTIONS.forEach(([dc, dr]) => {
            if (runLength(cells, col, row, who, dc, dr) < 4) return;
            line.add(col * ROWS + row);
            for (let sign = -1; sign <= 1; sign += 2) {
                let c = col + dc * sign, r = row + dr * sign;
                while (c >= 0 && c < COLS && r >= 0 && r < ROWS && cells[c * ROWS + r] === who) {
                    line.add(c * ROWS + r);
                    c += dc * sign;
                    r += dr * sign;
                }
            }
        });
        if (line.size) return { over: true, winner: who, line: [...line] };
        return { over: pos.moves.length === CELLS, winner: 0, line: [] };
    };

    // ---- Search ----

    const WIN = 10000, INFINITE = 20000;
    const ORDER = [3, 2, 4, 1, 5, 0, 6];
    let pos = null, deadline = 0, nodes = 0, stopped = false;

    // Score for the first player: open runs of four count for whoever alone has discs in them, and the middle column helps.
    const evaluate = () => {
        const cells = pos.cells;
        let score = 0;
        for (let i = 0; i < WINDOWS.length; i++) {
            const run = WINDOWS[i];
            const sum = cells[run[0]] + cells[run[1]] + cells[run[2]] + cells[run[3]];
            const filled = Math.abs(cells[run[0]]) + Math.abs(cells[run[1]]) + Math.abs(cells[run[2]]) + Math.abs(cells[run[3]]);
            // Only runs holding a single player's discs matter: there the sum equals the count.
            if (filled === 0 || Math.abs(sum) !== filled) continue;
            const worth = filled === 3 ? 40 : filled === 2 ? 8 : 1;
            score += sum > 0 ? worth : -worth;
        }
        for (let row = 0; row < ROWS; row++) score += 4 * cells[3 * ROWS + row];
        return score;
    };

    const search = (depth, alpha, beta, ply) => {
        if ((++nodes & 1023) === 0 && Date.now() >= deadline) stopped = true;
        if (stopped) return 0;
        if (pos.moves.length === CELLS) return 0;
        const side = pos.side;
        let threats = 0, mustBlock = -1;
        for (let col = 0; col < COLS; col++) {
            if (pos.heights[col] >= ROWS) continue;
            if (wouldWin(pos, col, side)) return WIN - ply;
            if (wouldWin(pos, col, -side)) { threats++; mustBlock = col; }
        }
        if (threats > 1) return -(WIN - ply - 1);
        if (threats === 1) {
            // A forced block costs no depth.
            play(pos, mustBlock);
            const score = -search(depth, -beta, -alpha, ply + 1);
            undo(pos);
            return score;
        }
        if (depth <= 0) return evaluate() * side;
        let best = -INFINITE;
        for (let i = 0; i < COLS; i++) {
            const col = ORDER[i];
            if (pos.heights[col] >= ROWS) continue;
            play(pos, col);
            const score = -search(depth - 1, -beta, -alpha, ply + 1);
            undo(pos);
            if (stopped) return 0;
            if (score > best) {
                best = score;
                if (score > alpha) alpha = score;
                if (alpha >= beta) break;
            }
        }
        return best;
    };

    // Easy looks two plies ahead, wobbles its scores and sometimes drops at random. Medium looks five plies ahead.
    // Hard searches as deep as its time allows.
    const LEVELS = {
        easy: { maxDepth: 2, timeMs: 200, noise: 30, blunder: 0.25 },
        medium: { maxDepth: 5, timeMs: 400, noise: 5, blunder: 0 },
        hard: { maxDepth: CELLS, timeMs: 700, noise: 0, blunder: 0 }
    };

    const bestMove = (position, level, timeMs) => {
        const options = LEVELS[level];
        // Middle columns first, with a coin flip between mirror columns for variety.
        const entries = ORDER.filter((col) => canPlay(position, col))
            .map((col) => ({ col, score: 0, order: Math.abs(col - 3) + Math.random() * 0.5 }));
        if (entries.length < 2) return entries.length ? entries[0].col : -1;
        if (Math.random() < options.blunder) return entries[Math.floor(Math.random() * entries.length)].col;
        // Take a win when there is one. Failing that, any column the opponent could win in has to be filled now.
        const urgent = entries.find((entry) => wouldWin(position, entry.col, position.side))
            || entries.find((entry) => wouldWin(position, entry.col, -position.side));
        if (urgent) return urgent.col;
        entries.sort((a, b) => a.order - b.order);
        pos = position;
        nodes = 0;
        stopped = false;
        deadline = Date.now() + (timeMs || options.timeMs);
        let best = entries[0].col;
        const deepest = Math.min(options.maxDepth, CELLS - pos.moves.length);
        for (let depth = 1; depth <= deepest; depth++) {
            let alpha = -INFINITE, leader = -1;
            const scores = [];
            for (const entry of entries) {
                play(pos, entry.col);
                // With noise every column needs its true score, so the window stays fully open.
                const score = -search(depth - 1, -INFINITE, options.noise ? INFINITE : -alpha, 1);
                undo(pos);
                if (stopped) break;
                scores.push(score);
                if (score > alpha) { alpha = score; leader = entry.col; }
            }
            if (stopped) {
                // The previous best column was searched first, so a leader from an unfinished pass is still at least as good.
                if (leader >= 0 && !options.noise) best = leader;
                break;
            }
            entries.forEach((entry, i) => { entry.score = scores[i]; });
            entries.sort((a, b) => b.score - a.score);
            best = entries[0].col;
            // Stop once the result is settled: a forced win, a forced loss, or every other column losing.
            if (Math.abs(alpha) > WIN - 100 || entries[1].score < -WIN + 100) break;
        }
        if (options.noise) {
            let top = -Infinity;
            for (const entry of entries) {
                const wobble = Math.abs(entry.score) > WIN - 100 ? 0 : (Math.random() * 2 - 1) * options.noise;
                if (entry.score + wobble > top) { top = entry.score + wobble; best = entry.col; }
            }
        }
        return best;
    };

    const api = { COLS, ROWS, create, play, undo, canPlay, status, bestMove };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
        root.onmessage = ({ data }) => {
            root.postMessage({ id: data.id, col: bestMove(create(data.moves), data.level) });
        };
    } else {
        root.FourFallEngine = api;
    }
})(typeof self !== 'undefined' ? self : globalThis);
