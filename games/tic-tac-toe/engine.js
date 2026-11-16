// Rules and computer players for Tic Tac Toe. Loaded by index.html with a script tag and by Node tests with require().
(() => {
    const X = 1;
    const O = 2;
    const DRAWN = 3;
    const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    const HARD_MS = 400;

    const pick = (list, random) => list[Math.floor(random() * list.length)];

    // The three squares of a finished line in the nine squares starting at offset, or null.
    const winLine = (grid, offset = 0) => LINES.find(([a, b, c]) => {
        const owner = grid[offset + a];
        return (owner === X || owner === O) && owner === grid[offset + b] && owner === grid[offset + c];
    }) || null;

    // 0 while open, X or O for a win, DRAWN when full with no line.
    const status = (grid, offset = 0) => {
        const line = winLine(grid, offset);
        if (line) return grid[offset + line[0]];
        for (let i = 0; i < 9; i++) {
            if (grid[offset + i] === 0) return 0;
        }
        return DRAWN;
    };

    const emptySquares = (board) => board.map((value, index) => (value === 0 ? index : -1)).filter((index) => index >= 0);

    /* Classic 3x3 */

    const memo = new Map();

    // Value of the position for the player about to move: positive wins, and a quicker win is worth more.
    const classicValue = (board, player) => {
        const key = board.join('') + player;
        if (memo.has(key)) return memo.get(key);
        const empties = emptySquares(board);
        const state = status(board);
        let value = 0;
        if (state === X || state === O) {
            value = (state === player ? 1 : -1) * (empties.length + 1);
        } else if (state === 0) {
            value = -Infinity;
            empties.forEach((index) => {
                board[index] = player;
                value = Math.max(value, -classicValue(board, 3 - player));
                board[index] = 0;
            });
        }
        memo.set(key, value);
        return value;
    };

    // Every move that keeps the best result a perfect player can get.
    const classicBestMoves = (board, player) => {
        const scored = emptySquares(board).map((index) => {
            board[index] = player;
            const value = -classicValue(board, 3 - player);
            board[index] = 0;
            return { index, value };
        });
        const top = Math.max(...scored.map((entry) => entry.value));
        return scored.filter((entry) => entry.value === top).map((entry) => entry.index);
    };

    const finishingMove = (board, player) => emptySquares(board).find((index) => {
        board[index] = player;
        const wins = status(board) === player;
        board[index] = 0;
        return wins;
    });

    // Level 0 plays at random, level 1 takes a win and blocks one, level 2 never loses.
    const classicChoose = (board, player, level, random = Math.random) => {
        if (level === 2) return pick(classicBestMoves(board, player), random);
        if (level === 1) {
            const move = finishingMove(board, player) ?? finishingMove(board, 3 - player);
            if (move !== undefined) return move;
        }
        return pick(emptySquares(board), random);
    };

    /* Big Board: nine small boards. Square number = small board * 9 + square inside it. */

    const bigCreate = () => ({
        cells: new Array(81).fill(0),
        boards: new Array(9).fill(0),
        next: -1,
        turn: X,
        result: 0,
        last: -1
    });

    const bigMoves = (game) => {
        if (game.result) return [];
        const moves = [];
        for (let board = 0; board < 9; board++) {
            if (game.boards[board] !== 0 || (game.next >= 0 && game.next !== board)) continue;
            for (let square = 0; square < 9; square++) {
                if (game.cells[board * 9 + square] === 0) moves.push(board * 9 + square);
            }
        }
        return moves;
    };

    // Plays one square. The square's place inside its small board names the board the opponent must play in next,
    // unless that board is finished, which leaves the opponent a free choice.
    const bigPlay = (game, index) => {
        const board = Math.floor(index / 9);
        if (game.result || game.cells[index] !== 0 || game.boards[board] !== 0 || (game.next >= 0 && game.next !== board)) {
            return false;
        }
        game.cells[index] = game.turn;
        game.boards[board] = status(game.cells, board * 9);
        game.result = status(game.boards);
        game.next = game.boards[index % 9] === 0 ? index % 9 : -1;
        game.turn = 3 - game.turn;
        game.last = index;
        return true;
    };

    const SQUARE_WORTH = [3, 2, 3, 2, 4, 2, 3, 2, 3];
    const SMALL_LINE = [0, 1, 3];
    const BIG_LINE = [0, 15, 70];
    const BOARD_WORTH = 10;
    const WIN = 100000;

    const lineWorth = (grid, offset, worth) => {
        let total = 0;
        for (const [a, b, c] of LINES) {
            let mine = 0;
            let theirs = 0;
            let dead = false;
            for (const square of [grid[offset + a], grid[offset + b], grid[offset + c]]) {
                if (square === X) mine++;
                else if (square === O) theirs++;
                else if (square === DRAWN) dead = true;
            }
            if (dead || (mine && theirs)) continue;
            total += worth[mine] - worth[theirs];
        }
        return total;
    };

    // How good the position looks for X.
    const evaluate = (game) => {
        let score = lineWorth(game.boards, 0, BIG_LINE);
        for (let board = 0; board < 9; board++) {
            const owner = game.boards[board];
            if (owner === X) score += BOARD_WORTH * SQUARE_WORTH[board];
            else if (owner === O) score -= BOARD_WORTH * SQUARE_WORTH[board];
            else if (owner === 0) score += lineWorth(game.cells, board * 9, SMALL_LINE) * SQUARE_WORTH[board];
        }
        return score;
    };

    const search = (game, depth, alpha, beta, ply, clock) => {
        if (game.result === X || game.result === O) return -(WIN - ply);
        if (game.result === DRAWN) return 0;
        if (depth === 0) return game.turn === X ? evaluate(game) : -evaluate(game);
        if (++clock.nodes % 256 === 0 && Date.now() > clock.deadline) clock.expired = true;
        if (clock.expired) return 0;

        let best = -Infinity;
        for (const index of bigMoves(game)) {
            const board = Math.floor(index / 9);
            const saved = { next: game.next, last: game.last };
            bigPlay(game, index);
            const value = -search(game, depth - 1, -beta, -alpha, ply + 1, clock);
            game.cells[index] = 0;
            game.boards[board] = 0;
            game.result = 0;
            game.turn = 3 - game.turn;
            game.next = saved.next;
            game.last = saved.last;
            if (clock.expired) return 0;
            if (value > best) best = value;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break;
        }
        return best;
    };

    // Looks ahead to maxDepth, deepening one step at a time, and keeps the last answer finished inside the time budget.
    const searchMove = (game, maxDepth, budgetMs, random) => {
        const clock = { nodes: 0, deadline: Date.now() + budgetMs, expired: false };
        const work = { ...game, cells: game.cells.slice(), boards: game.boards.slice() };
        // A random starting order varies the choice between equally good moves.
        let moves = bigMoves(work).map((index) => ({ index, value: 0, order: random() })).sort((a, b) => a.order - b.order);
        let choice = moves[0].index;
        for (let depth = 1; depth <= maxDepth; depth++) {
            let alpha = -Infinity;
            for (const move of moves) {
                const board = Math.floor(move.index / 9);
                const saved = { next: work.next, last: work.last };
                bigPlay(work, move.index);
                move.value = -search(work, depth - 1, -Infinity, -alpha, 1, clock);
                work.cells[move.index] = 0;
                work.boards[board] = 0;
                work.result = 0;
                work.turn = 3 - work.turn;
                work.next = saved.next;
                work.last = saved.last;
                if (clock.expired) return choice;
                if (move.value > alpha) alpha = move.value;
            }
            moves = moves.slice().sort((a, b) => b.value - a.value);
            choice = moves[0].index;
            if (Math.abs(moves[0].value) > WIN - 100) break;
        }
        return choice;
    };

    const EASY_GRAB_CHANCE = 0.4;
    const MEDIUM_SLIP_CHANCE = 0.15;

    // Level 0 mostly plays at random, level 1 looks two moves ahead and slips now and then, level 2 searches until the time budget.
    const bigChoose = (game, level, random = Math.random, budgetMs = HARD_MS) => {
        const moves = bigMoves(game);
        if (level === 2) return searchMove(game, 40, budgetMs, random);
        if (level === 1) return random() < MEDIUM_SLIP_CHANCE ? pick(moves, random) : searchMove(game, 2, budgetMs, random);
        const grabs = moves.filter((index) => {
            const offset = Math.floor(index / 9) * 9;
            game.cells[index] = game.turn;
            const wins = winLine(game.cells, offset) !== null;
            game.cells[index] = 0;
            return wins;
        });
        return grabs.length && random() < EASY_GRAB_CHANCE ? pick(grabs, random) : pick(moves, random);
    };

    const api = {
        X, O, DRAWN, HARD_MS, winLine, status, emptySquares,
        classicBestMoves, classicChoose, bigCreate, bigMoves, bigPlay, bigChoose
    };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.TicEngine = api;
    }
})();
