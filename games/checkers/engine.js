// English checkers rules and the computer player. Runs unchanged in the page, in a Web Worker and in Node.
(function (root) {
    'use strict';

    // Squares are numbered 0 to 63, row by row from the top. Red starts at the bottom, moves up the board and moves first.
    // Pieces: 1 red man, 2 red king, -1 black man, -2 black king.
    const RED = 1, BLACK = -1;
    const START = '.b.b.b.b/b.b.b.b./.b.b.b.b/......../......../r.r.r.r./.r.r.r.r/r.r.r.r. r 0';

    // For each square and each direction (up-left, up-right, down-left, down-right): the next square and the one beyond, or -1.
    const STEP = new Int8Array(256).fill(-1), JUMP = new Int8Array(256).fill(-1);
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([dr, dc], dir) => {
        for (let sq = 0; sq < 64; sq++) {
            const row = (sq >> 3) + dr, col = (sq & 7) + dc;
            if (row < 0 || row > 7 || col < 0 || col > 7) continue;
            STEP[sq * 4 + dir] = row * 8 + col;
            if (row + dr >= 0 && row + dr <= 7 && col + dc >= 0 && col + dc <= 7) JUMP[sq * 4 + dir] = (row + dr) * 8 + col + dc;
        }
    });

    let seed = 0x3fd24a71;
    const random32 = () => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return seed | 0;
    };
    const PIECE_LO = Int32Array.from({ length: 5 * 64 }, random32), PIECE_HI = Int32Array.from({ length: 5 * 64 }, random32);
    const SIDE_LO = random32(), SIDE_HI = random32();

    const create = (text = START) => {
        const [rows, turn = 'r', quiet = '0'] = text.trim().split(/\s+/);
        const pos = { board: new Int8Array(64), side: turn === 'b' ? BLACK : RED, quiet: Number(quiet), lo: 0, hi: 0, stack: [] };
        rows.split('/').forEach((row, r) => {
            [...row].forEach((ch, c) => { pos.board[r * 8 + c] = { r: 1, R: 2, b: -1, B: -2 }[ch] || 0; });
        });
        for (let sq = 0; sq < 64; sq++) {
            const piece = pos.board[sq];
            if (piece) { pos.lo ^= PIECE_LO[(piece + 2) * 64 + sq]; pos.hi ^= PIECE_HI[(piece + 2) * 64 + sq]; }
        }
        if (pos.side === BLACK) { pos.lo ^= SIDE_LO; pos.hi ^= SIDE_HI; }
        return pos;
    };

    const toText = (pos) => {
        const rows = [];
        for (let r = 0; r < 8; r++) {
            let row = '';
            for (let c = 0; c < 8; c++) row += 'Bb.rR'[pos.board[r * 8 + c] + 2];
            rows.push(row);
        }
        return `${rows.join('/')} ${pos.side === RED ? 'r' : 'b'} ${pos.quiet}`;
    };

    const crowns = (piece, sq) => (piece === RED && sq < 8) || (piece === BLACK && sq >= 56);

    // Follows every capture route for one piece. A route ends when no further jump exists or when a man is crowned.
    // The moving piece is lifted off the board first and jumped pieces are removed as it goes, so none is jumped twice.
    const collectJumps = (board, sq, piece, start, path, captures, out) => {
        let extended = false;
        const first = piece === BLACK ? 2 : 0, last = piece === RED ? 2 : 4;
        for (let dir = first; dir < last; dir++) {
            const land = JUMP[sq * 4 + dir];
            if (land < 0 || board[land]) continue;
            const mid = STEP[sq * 4 + dir];
            if (board[mid] * piece >= 0) continue;
            extended = true;
            const taken = board[mid];
            board[mid] = 0;
            path.push(land);
            captures.push(mid);
            if (crowns(piece, land)) out.push({ from: start, to: land, path: path.slice(), captures: captures.slice() });
            else collectJumps(board, land, piece, start, path, captures, out);
            path.pop();
            captures.pop();
            board[mid] = taken;
        }
        if (!extended && path.length) out.push({ from: start, to: sq, path: path.slice(), captures: captures.slice() });
    };

    // Captures are forced: when any jump exists, only jumps are legal.
    const legalMoves = (pos) => {
        const board = pos.board, side = pos.side;
        const jumps = [];
        for (let sq = 0; sq < 64; sq++) {
            const piece = board[sq];
            if (piece * side <= 0) continue;
            board[sq] = 0;
            collectJumps(board, sq, piece, sq, [], [], jumps);
            board[sq] = piece;
        }
        if (jumps.length) return jumps;
        const moves = [];
        for (let sq = 0; sq < 64; sq++) {
            const piece = board[sq];
            if (piece * side <= 0) continue;
            const first = piece === BLACK ? 2 : 0, last = piece === RED ? 2 : 4;
            for (let dir = first; dir < last; dir++) {
                const to = STEP[sq * 4 + dir];
                if (to >= 0 && !board[to]) moves.push({ from: sq, to, path: [to], captures: [] });
            }
        }
        return moves;
    };

    const moveKey = (move) => [move.from, ...move.path].join('-');

    const makeMove = (pos, move) => {
        const board = pos.board;
        const piece = board[move.from];
        const taken = [];
        let lo = pos.lo ^ SIDE_LO, hi = pos.hi ^ SIDE_HI;
        pos.stack.push({ move, piece, taken, quiet: pos.quiet, lo: pos.lo, hi: pos.hi });
        for (let i = 0; i < move.captures.length; i++) {
            const sq = move.captures[i], victim = board[sq];
            taken.push(victim);
            board[sq] = 0;
            lo ^= PIECE_LO[(victim + 2) * 64 + sq];
            hi ^= PIECE_HI[(victim + 2) * 64 + sq];
        }
        const crowned = crowns(piece, move.to);
        const placed = crowned ? piece * 2 : piece;
        board[move.from] = 0;
        board[move.to] = placed;
        lo ^= PIECE_LO[(piece + 2) * 64 + move.from] ^ PIECE_LO[(placed + 2) * 64 + move.to];
        hi ^= PIECE_HI[(piece + 2) * 64 + move.from] ^ PIECE_HI[(placed + 2) * 64 + move.to];
        // Counts moves since the last capture or crowning, for the forty-move draw.
        pos.quiet = taken.length || crowned ? 0 : pos.quiet + 1;
        pos.side = -pos.side;
        pos.lo = lo;
        pos.hi = hi;
    };

    const undoMove = (pos) => {
        const board = pos.board;
        const { move, piece, taken, quiet, lo, hi } = pos.stack.pop();
        board[move.to] = 0;
        board[move.from] = piece;
        for (let i = 0; i < taken.length; i++) board[move.captures[i]] = taken[i];
        pos.quiet = quiet;
        pos.side = -pos.side;
        pos.lo = lo;
        pos.hi = hi;
    };

    // A player with no legal move loses, whether out of pieces or blocked. Forty moves each without a capture or crowning is a draw.
    const status = (pos) => {
        if (!legalMoves(pos).length) {
            const hasPieces = pos.board.some((piece) => piece * pos.side > 0);
            return { over: true, winner: -pos.side, reason: hasPieces ? 'blocked' : 'captured' };
        }
        if (pos.quiet >= 80) return { over: true, winner: 0, reason: 'forty' };
        return { over: false, winner: 0, reason: '' };
    };

    const perft = (pos, depth) => {
        const moves = legalMoves(pos);
        if (depth <= 1) return moves.length;
        let total = 0;
        for (const move of moves) {
            makeMove(pos, move);
            total += perft(pos, depth - 1);
            undoMove(pos);
        }
        return total;
    };

    // ---- Search ----

    const WIN = 30000, INFINITE = 32000, MAX_PLY = 60;
    const TT_SIZE = 1 << 17;
    const EXACT = 1, LOWER = 2, UPPER = 3;
    let ttLo = null, ttHi, ttMove, ttScore, ttDepth, ttFlag;
    const historyScores = new Int32Array(64 * 64);
    let pos = null, deadline = 0, nodes = 0, stopped = false;

    const ensureTable = () => {
        if (ttLo) return;
        ttLo = new Int32Array(TT_SIZE);
        ttHi = new Int32Array(TT_SIZE);
        ttMove = new Int16Array(TT_SIZE);
        ttScore = new Int16Array(TT_SIZE);
        ttDepth = new Int8Array(TT_SIZE);
        ttFlag = new Int8Array(TT_SIZE);
    };

    // Score for the side to move: material, men that have advanced, a guarded back row and a hold on the middle.
    const evaluate = () => {
        const board = pos.board;
        let score = 0, redCount = 0, blackCount = 0, redValue = 0, blackValue = 0;
        for (let sq = 0; sq < 64; sq++) {
            const piece = board[sq];
            if (!piece) continue;
            const row = sq >> 3, col = sq & 7;
            const middle = row >= 2 && row <= 5 && col >= 2 && col <= 5;
            const edge = col === 0 || col === 7;
            if (piece > 0) {
                redCount++;
                redValue += piece === 1 ? 100 : 165;
                score += piece === 1 ? 4 * (7 - row) + (row === 7 ? 10 : 0) + (middle ? 4 : 0) : (middle ? 8 : edge ? -6 : 0);
            } else {
                blackCount++;
                blackValue += piece === -1 ? 100 : 165;
                score -= piece === -1 ? 4 * row + (row === 0 ? 10 : 0) + (middle ? 4 : 0) : (middle ? 8 : edge ? -6 : 0);
            }
        }
        const lead = redValue - blackValue;
        // Being ahead is worth more as pieces come off, which makes the leader trade down.
        score += lead + Math.round((lead * 3) / (redCount + blackCount));
        if (lead && redCount + blackCount <= 8) {
            // In a small endgame the leader should close in on what is left of the other side.
            let apart = 0;
            for (let a = 0; a < 64; a++) {
                if (board[a] * lead <= 0) continue;
                for (let b = 0; b < 64; b++) {
                    if (board[b] * lead < 0) apart += Math.max(Math.abs((a >> 3) - (b >> 3)), Math.abs((a & 7) - (b & 7)));
                }
            }
            score += lead > 0 ? -2 * apart : 2 * apart;
        }
        return pos.side === RED ? score : -score;
    };

    const search = (depth, alpha, beta, ply) => {
        if ((++nodes & 1023) === 0 && Date.now() >= deadline) stopped = true;
        if (stopped) return 0;
        if (pos.quiet >= 80) return 0;
        const moves = legalMoves(pos);
        if (!moves.length) return -WIN + ply;
        const forced = moves[0].captures.length > 0;
        // Never judge a position while a capture is waiting: follow jumps until the board is calm.
        if ((depth <= 0 && !forced) || ply >= MAX_PLY) return evaluate();
        const remaining = Math.max(depth, 0);

        const slot = pos.lo & (TT_SIZE - 1);
        let hashMove = -1;
        if (ttLo[slot] === pos.lo && ttHi[slot] === pos.hi) {
            hashMove = ttMove[slot];
            if (ttDepth[slot] >= remaining) {
                let stored = ttScore[slot];
                if (stored > WIN - 1000) stored -= ply;
                else if (stored < -WIN + 1000) stored += ply;
                if (ttFlag[slot] === EXACT) return stored;
                if (ttFlag[slot] === LOWER && stored >= beta) return stored;
                if (ttFlag[slot] === UPPER && stored <= alpha) return stored;
            }
        }

        const scores = moves.map((move) => {
            const code = move.from | (move.to << 6);
            return code === hashMove ? 1e9 : move.captures.length * 1e6 + historyScores[move.from * 64 + move.to];
        });
        // A lone legal move costs no depth, so forced lines are read to their end.
        const next = moves.length === 1 ? depth : depth - 1;
        let best = -INFINITE, bestCode = -1, flag = UPPER;
        for (let i = 0; i < moves.length; i++) {
            let pick = i;
            for (let j = i + 1; j < moves.length; j++) if (scores[j] > scores[pick]) pick = j;
            const move = moves[pick];
            moves[pick] = moves[i];
            scores[pick] = scores[i];
            makeMove(pos, move);
            const score = -search(next, -beta, -alpha, ply + 1);
            undoMove(pos);
            if (stopped) return 0;
            if (score > best) {
                best = score;
                bestCode = move.from | (move.to << 6);
                if (score > alpha) {
                    alpha = score;
                    flag = EXACT;
                    if (score >= beta) {
                        flag = LOWER;
                        if (!forced) historyScores[move.from * 64 + move.to] += remaining * remaining;
                        break;
                    }
                }
            }
        }

        ttLo[slot] = pos.lo;
        ttHi[slot] = pos.hi;
        ttMove[slot] = bestCode;
        ttScore[slot] = best > WIN - 1000 ? best + ply : best < -WIN + 1000 ? best - ply : best;
        ttDepth[slot] = remaining;
        ttFlag[slot] = flag;
        return best;
    };

    // Easy looks two plies ahead, wobbles its scores and sometimes plays at random. Medium looks five plies ahead.
    // Hard searches as deep as its time allows.
    const LEVELS = {
        easy: { maxDepth: 2, timeMs: 300, noise: 45, blunder: 0.15 },
        medium: { maxDepth: 5, timeMs: 500, noise: 6, blunder: 0 },
        hard: { maxDepth: 60, timeMs: 800, noise: 0, blunder: 0 }
    };

    const bestMove = (position, level, timeMs) => {
        const options = LEVELS[level];
        const entries = legalMoves(position).map((move) => ({ move, score: 0, order: Math.random() }));
        if (entries.length < 2) return entries.length ? entries[0].move : null;
        if (Math.random() < options.blunder) return entries[Math.floor(Math.random() * entries.length)].move;
        // A random first ordering gives variety between games when several moves score the same.
        entries.sort((a, b) => a.order - b.order);
        ensureTable();
        pos = position;
        nodes = 0;
        stopped = false;
        deadline = Date.now() + (timeMs || options.timeMs);
        historyScores.fill(0);
        let best = entries[0].move;
        for (let depth = 1; depth <= options.maxDepth; depth++) {
            let alpha = -INFINITE, leader = null;
            const scores = [];
            for (const entry of entries) {
                makeMove(pos, entry.move);
                // With noise every move needs its true score, so the window stays fully open.
                const score = -search(depth - 1, -INFINITE, options.noise ? INFINITE : -alpha, 1);
                undoMove(pos);
                if (stopped) break;
                scores.push(score);
                if (score > alpha) { alpha = score; leader = entry.move; }
            }
            if (stopped) {
                // The previous best move was searched first, so a leader from an unfinished pass is still at least as good.
                if (leader && !options.noise) best = leader;
                break;
            }
            entries.forEach((entry, i) => { entry.score = scores[i]; });
            entries.sort((a, b) => b.score - a.score);
            best = entries[0].move;
            if (Math.abs(alpha) > WIN - 1000) break;
        }
        if (options.noise) {
            let top = -Infinity;
            for (const entry of entries) {
                const wobble = Math.abs(entry.score) > WIN - 1000 ? 0 : (Math.random() * 2 - 1) * options.noise;
                if (entry.score + wobble > top) { top = entry.score + wobble; best = entry.move; }
            }
        }
        return best;
    };

    const api = {
        RED, BLACK, START, create, toText, legalMoves, moveKey, makeMove, undoMove, status, perft, bestMove,
        turn: (pos) => pos.side,
        pieces: (pos) => Array.from(pos.board)
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
        // As a worker: rebuild the game from its moves and answer with the chosen move's key.
        root.onmessage = ({ data }) => {
            const game = create(data.start);
            data.moves.forEach((key) => makeMove(game, legalMoves(game).find((move) => moveKey(move) === key)));
            root.postMessage({ id: data.id, key: moveKey(bestMove(game, data.level)) });
        };
    } else {
        root.CheckersEngine = api;
    }
})(typeof self !== 'undefined' ? self : globalThis);
