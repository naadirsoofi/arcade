// Chess rules and the computer player. Runs unchanged in the page, in a Web Worker and in Node.
(function (root) {
    'use strict';

    const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
    const WHITE = 1, BLACK = -1;
    const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

    // The board is 16 squares wide so that any index with a bit of 0x88 set is off the board.
    const KNIGHT_STEPS = [-33, -31, -18, -14, 14, 18, 31, 33];
    const DIAGONALS = [-17, -15, 15, 17];
    const STRAIGHTS = [-16, -1, 1, 16];
    const ALL_STEPS = [-17, -16, -15, -1, 1, 15, 16, 17];

    // A move is one integer: from (7 bits), to (7 bits), promotion piece (3 bits), flag (3 bits).
    const FLAG_DOUBLE = 1, FLAG_EP = 2, FLAG_CASTLE_K = 3, FLAG_CASTLE_Q = 4;
    const encode = (from, to, promo, flag) => from | (to << 7) | (promo << 14) | (flag << 17);

    // Castling rights: 1 white short, 2 white long, 4 black short, 8 black long.
    const CASTLE_KEEP = new Int8Array(128).fill(15);
    CASTLE_KEEP[0] = 13; CASTLE_KEEP[4] = 12; CASTLE_KEEP[7] = 14;
    CASTLE_KEEP[112] = 7; CASTLE_KEEP[116] = 3; CASTLE_KEEP[119] = 11;

    // Position hashing. A fixed seed keeps the keys identical in the page and in the worker.
    let seed = 0x2f6b5e17;
    const random32 = () => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return seed | 0;
    };
    const randomKeys = (count) => Int32Array.from({ length: count }, random32);
    const PIECE_LO = randomKeys(13 * 128), PIECE_HI = randomKeys(13 * 128);
    const CASTLE_LO = randomKeys(16), CASTLE_HI = randomKeys(16);
    const EP_LO = randomKeys(8), EP_HI = randomKeys(8);
    const SIDE_LO = random32(), SIDE_HI = random32();

    const to64 = (sq) => (sq >> 4) * 8 + (sq & 7);
    const to88 = (index) => ((index >> 3) << 4) | (index & 7);
    const squareName = (sq) => 'abcdefgh'[sq & 7] + ((sq >> 4) + 1);

    const computeHash = (pos) => {
        let lo = CASTLE_LO[pos.castle], hi = CASTLE_HI[pos.castle];
        for (let sq = 0; sq < 120; sq++) {
            const piece = pos.board[sq];
            if (piece) {
                lo ^= PIECE_LO[(piece + 6) * 128 + sq];
                hi ^= PIECE_HI[(piece + 6) * 128 + sq];
            }
        }
        if (pos.ep >= 0) { lo ^= EP_LO[pos.ep & 7]; hi ^= EP_HI[pos.ep & 7]; }
        if (pos.side === BLACK) { lo ^= SIDE_LO; hi ^= SIDE_HI; }
        pos.lo = lo;
        pos.hi = hi;
    };

    const create = (fen = START_FEN) => {
        const [rows, turn, castling = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/);
        const pos = {
            board: new Int8Array(128), side: turn === 'b' ? BLACK : WHITE, castle: 0, ep: -1,
            half: Number(half), full: Number(full), kings: [0, 0], lo: 0, hi: 0, stack: []
        };
        const board = pos.board;
        let sq = 112;
        for (const ch of rows) {
            if (ch === '/') sq -= 24;
            else if (ch >= '1' && ch <= '8') sq += Number(ch);
            else {
                const type = 'pnbrqk'.indexOf(ch.toLowerCase()) + 1;
                const piece = ch === ch.toLowerCase() ? -type : type;
                board[sq] = piece;
                if (type === KING) pos.kings[piece > 0 ? 0 : 1] = sq;
                sq++;
            }
        }
        if (castling.includes('K') && board[4] === KING && board[7] === ROOK) pos.castle |= 1;
        if (castling.includes('Q') && board[4] === KING && board[0] === ROOK) pos.castle |= 2;
        if (castling.includes('k') && board[116] === -KING && board[119] === -ROOK) pos.castle |= 4;
        if (castling.includes('q') && board[116] === -KING && board[112] === -ROOK) pos.castle |= 8;
        if (ep !== '-') {
            const target = (Number(ep[1]) - 1) * 16 + 'abcdefgh'.indexOf(ep[0]);
            const pawn = PAWN * pos.side;
            const left = target - 17 * pos.side, right = target - 15 * pos.side;
            if ((!(left & 0x88) && board[left] === pawn) || (!(right & 0x88) && board[right] === pawn)) pos.ep = target;
        }
        computeHash(pos);
        return pos;
    };

    const toFen = (pos) => {
        const rows = [];
        for (let rank = 7; rank >= 0; rank--) {
            let row = '', gap = 0;
            for (let file = 0; file < 8; file++) {
                const piece = pos.board[rank * 16 + file];
                if (!piece) { gap++; continue; }
                if (gap) { row += gap; gap = 0; }
                const letter = 'pnbrqk'[Math.abs(piece) - 1];
                row += piece > 0 ? letter.toUpperCase() : letter;
            }
            rows.push(row + (gap || ''));
        }
        const rights = ['K', 'Q', 'k', 'q'].filter((_, bit) => pos.castle & (1 << bit)).join('') || '-';
        const ep = pos.ep >= 0 ? squareName(pos.ep) : '-';
        return `${rows.join('/')} ${pos.side === WHITE ? 'w' : 'b'} ${rights} ${ep} ${pos.half} ${pos.full}`;
    };

    const attacked = (pos, sq, by) => {
        const board = pos.board;
        let from = sq - 15 * by;
        if (!(from & 0x88) && board[from] === PAWN * by) return true;
        from = sq - 17 * by;
        if (!(from & 0x88) && board[from] === PAWN * by) return true;
        const knight = KNIGHT * by, king = KING * by, bishop = BISHOP * by, rook = ROOK * by, queen = QUEEN * by;
        for (let i = 0; i < 8; i++) {
            from = sq + KNIGHT_STEPS[i];
            if (!(from & 0x88) && board[from] === knight) return true;
            from = sq + ALL_STEPS[i];
            if (!(from & 0x88) && board[from] === king) return true;
        }
        for (let i = 0; i < 4; i++) {
            let step = DIAGONALS[i];
            for (from = sq + step; !(from & 0x88); from += step) {
                const piece = board[from];
                if (piece) {
                    if (piece === bishop || piece === queen) return true;
                    break;
                }
            }
            step = STRAIGHTS[i];
            for (from = sq + step; !(from & 0x88); from += step) {
                const piece = board[from];
                if (piece) {
                    if (piece === rook || piece === queen) return true;
                    break;
                }
            }
        }
        return false;
    };

    const inCheck = (pos) => attacked(pos, pos.kings[pos.side === WHITE ? 0 : 1], -pos.side);

    // Every move that obeys how the pieces move. Moves that leave the mover's king attacked are filtered later.
    const generate = (pos, capturesOnly) => {
        const moves = [];
        const board = pos.board, side = pos.side;
        const forward = 16 * side;
        const startRank = side === WHITE ? 1 : 6, lastRank = side === WHITE ? 6 : 1;
        for (let from = 0; from < 120; from++) {
            if (from & 0x88) { from += 7; continue; }
            const type = board[from] * side;
            if (type <= 0) continue;
            if (type === PAWN) {
                const promotes = (from >> 4) === lastRank;
                let to = from + forward;
                if (!board[to]) {
                    if (promotes) {
                        moves.push(encode(from, to, QUEEN, 0));
                        if (!capturesOnly) moves.push(encode(from, to, ROOK, 0), encode(from, to, BISHOP, 0), encode(from, to, KNIGHT, 0));
                    } else if (!capturesOnly) {
                        moves.push(encode(from, to, 0, 0));
                        if ((from >> 4) === startRank && !board[to + forward]) moves.push(encode(from, to + forward, 0, FLAG_DOUBLE));
                    }
                }
                for (let dx = -1; dx <= 1; dx += 2) {
                    to = from + forward + dx;
                    if (to & 0x88) continue;
                    if (board[to] * side < 0) {
                        if (promotes) {
                            moves.push(encode(from, to, QUEEN, 0));
                            if (!capturesOnly) moves.push(encode(from, to, ROOK, 0), encode(from, to, BISHOP, 0), encode(from, to, KNIGHT, 0));
                        } else moves.push(encode(from, to, 0, 0));
                    } else if (to === pos.ep) moves.push(encode(from, to, 0, FLAG_EP));
                }
            } else if (type === KNIGHT || type === KING) {
                const steps = type === KNIGHT ? KNIGHT_STEPS : ALL_STEPS;
                for (let i = 0; i < 8; i++) {
                    const to = from + steps[i];
                    if (to & 0x88) continue;
                    const target = board[to] * side;
                    if (target > 0 || (capturesOnly && !target)) continue;
                    moves.push(encode(from, to, 0, 0));
                }
            } else {
                const steps = type === BISHOP ? DIAGONALS : type === ROOK ? STRAIGHTS : ALL_STEPS;
                for (let i = 0; i < steps.length; i++) {
                    const step = steps[i];
                    for (let to = from + step; !(to & 0x88); to += step) {
                        const target = board[to] * side;
                        if (target > 0) break;
                        if (target < 0) { moves.push(encode(from, to, 0, 0)); break; }
                        if (!capturesOnly) moves.push(encode(from, to, 0, 0));
                    }
                }
            }
        }
        if (!capturesOnly) {
            // The king may not castle out of check or across an attacked square. Landing in check is filtered later.
            const home = side === WHITE ? 4 : 116;
            const short = side === WHITE ? 1 : 4, long = side === WHITE ? 2 : 8;
            if ((pos.castle & short) && !board[home + 1] && !board[home + 2]
                && !attacked(pos, home, -side) && !attacked(pos, home + 1, -side)) {
                moves.push(encode(home, home + 2, 0, FLAG_CASTLE_K));
            }
            if ((pos.castle & long) && !board[home - 1] && !board[home - 2] && !board[home - 3]
                && !attacked(pos, home, -side) && !attacked(pos, home - 1, -side)) {
                moves.push(encode(home, home - 2, 0, FLAG_CASTLE_Q));
            }
        }
        return moves;
    };

    // The undo stack keeps seven numbers per move: move, captured piece, castling rights, en passant square,
    // halfmove clock and the two hash halves of the position before the move.
    const makeMove = (pos, move) => {
        const board = pos.board;
        const from = move & 127, to = (move >> 7) & 127, promo = (move >> 14) & 7, flag = (move >> 17) & 7;
        const side = pos.side, piece = board[from];
        const captureSq = flag === FLAG_EP ? to - 16 * side : to;
        const captured = board[captureSq];
        pos.stack.push(move, captured, pos.castle, pos.ep, pos.half, pos.lo, pos.hi);
        let lo = pos.lo ^ SIDE_LO, hi = pos.hi ^ SIDE_HI;
        let key = (piece + 6) * 128 + from;
        lo ^= PIECE_LO[key]; hi ^= PIECE_HI[key];
        if (captured) {
            key = (captured + 6) * 128 + captureSq;
            lo ^= PIECE_LO[key]; hi ^= PIECE_HI[key];
            board[captureSq] = 0;
        }
        const placed = promo ? promo * side : piece;
        board[from] = 0;
        board[to] = placed;
        key = (placed + 6) * 128 + to;
        lo ^= PIECE_LO[key]; hi ^= PIECE_HI[key];
        if (flag === FLAG_CASTLE_K || flag === FLAG_CASTLE_Q) {
            const rookFrom = flag === FLAG_CASTLE_K ? to + 1 : to - 2;
            const rookTo = flag === FLAG_CASTLE_K ? to - 1 : to + 1;
            const rook = ROOK * side;
            board[rookFrom] = 0;
            board[rookTo] = rook;
            lo ^= PIECE_LO[(rook + 6) * 128 + rookFrom] ^ PIECE_LO[(rook + 6) * 128 + rookTo];
            hi ^= PIECE_HI[(rook + 6) * 128 + rookFrom] ^ PIECE_HI[(rook + 6) * 128 + rookTo];
        }
        if (piece === KING * side) pos.kings[side === WHITE ? 0 : 1] = to;
        if (pos.ep >= 0) { lo ^= EP_LO[pos.ep & 7]; hi ^= EP_HI[pos.ep & 7]; }
        pos.ep = -1;
        if (flag === FLAG_DOUBLE) {
            // The en passant square only counts when a pawn stands ready to capture, so repeated positions compare correctly.
            const enemyPawn = -PAWN * side;
            if ((!((to - 1) & 0x88) && board[to - 1] === enemyPawn) || (!((to + 1) & 0x88) && board[to + 1] === enemyPawn)) {
                pos.ep = from + 16 * side;
                lo ^= EP_LO[to & 7]; hi ^= EP_HI[to & 7];
            }
        }
        const castle = pos.castle & CASTLE_KEEP[from] & CASTLE_KEEP[to];
        if (castle !== pos.castle) {
            lo ^= CASTLE_LO[pos.castle] ^ CASTLE_LO[castle];
            hi ^= CASTLE_HI[pos.castle] ^ CASTLE_HI[castle];
            pos.castle = castle;
        }
        pos.half = captured || piece === PAWN * side ? 0 : pos.half + 1;
        if (side === BLACK) pos.full++;
        pos.side = -side;
        pos.lo = lo;
        pos.hi = hi;
    };

    const undoMove = (pos) => {
        const board = pos.board, stack = pos.stack;
        pos.hi = stack.pop();
        pos.lo = stack.pop();
        pos.half = stack.pop();
        pos.ep = stack.pop();
        pos.castle = stack.pop();
        const captured = stack.pop(), move = stack.pop();
        const from = move & 127, to = (move >> 7) & 127, promo = (move >> 14) & 7, flag = (move >> 17) & 7;
        const side = -pos.side;
        pos.side = side;
        if (side === BLACK) pos.full--;
        const piece = promo ? PAWN * side : board[to];
        board[from] = piece;
        board[to] = 0;
        board[flag === FLAG_EP ? to - 16 * side : to] = captured;
        if (flag === FLAG_CASTLE_K || flag === FLAG_CASTLE_Q) {
            board[flag === FLAG_CASTLE_K ? to + 1 : to - 2] = ROOK * side;
            board[flag === FLAG_CASTLE_K ? to - 1 : to + 1] = 0;
        }
        if (piece === KING * side) pos.kings[side === WHITE ? 0 : 1] = from;
    };

    const legalMoves = (pos) => {
        const side = pos.side, kingIndex = side === WHITE ? 0 : 1;
        return generate(pos, false).filter((move) => {
            makeMove(pos, move);
            const safe = !attacked(pos, pos.kings[kingIndex], -side);
            undoMove(pos);
            return safe;
        });
    };

    // How many times the current position has stood on the board, counting now.
    const repetitions = (pos) => {
        const stack = pos.stack;
        const oldest = Math.max(0, stack.length - 7 * pos.half);
        let count = 1;
        for (let i = stack.length - 14; i >= oldest; i -= 14) {
            if (stack[i + 5] === pos.lo && stack[i + 6] === pos.hi) count++;
        }
        return count;
    };

    // No pawns, rooks or queens, and at most one minor piece or only bishops that share a square color.
    const insufficientMaterial = (pos) => {
        let knights = 0, bishops = 0, bishopColors = 0;
        for (let sq = 0; sq < 120; sq++) {
            if (sq & 0x88) continue;
            const type = Math.abs(pos.board[sq]);
            if (type === PAWN || type === ROOK || type === QUEEN) return false;
            if (type === KNIGHT) knights++;
            if (type === BISHOP) {
                bishops++;
                bishopColors |= ((sq >> 4) + sq) & 1 ? 1 : 2;
            }
        }
        return knights + bishops <= 1 || (knights === 0 && bishopColors !== 3);
    };

    const status = (pos) => {
        if (!legalMoves(pos).length) {
            return inCheck(pos)
                ? { over: true, reason: 'checkmate', winner: -pos.side }
                : { over: true, reason: 'stalemate', winner: 0 };
        }
        if (insufficientMaterial(pos)) return { over: true, reason: 'material', winner: 0 };
        if (repetitions(pos) >= 3) return { over: true, reason: 'repetition', winner: 0 };
        if (pos.half >= 100) return { over: true, reason: 'fifty', winner: 0 };
        return { over: false, reason: '', winner: 0 };
    };

    // What a move does, in 0 to 63 square numbers (a1 is 0, h8 is 63), for the page to draw.
    const describe = (pos, move) => {
        const from = move & 127, to = (move >> 7) & 127, flag = (move >> 17) & 7;
        const info = {
            from: to64(from), to: to64(to), promo: (move >> 14) & 7,
            captured: flag === FLAG_EP ? -PAWN * pos.side : pos.board[to], rookFrom: -1, rookTo: -1
        };
        if (flag === FLAG_CASTLE_K) { info.rookFrom = to64(to + 1); info.rookTo = to64(to - 1); }
        if (flag === FLAG_CASTLE_Q) { info.rookFrom = to64(to - 2); info.rookTo = to64(to + 1); }
        return info;
    };

    const pieces = (pos) => Array.from({ length: 64 }, (_, index) => pos.board[to88(index)]);

    // Standard algebraic notation for a legal move, worked out before the move is made.
    const san = (pos, move) => {
        const from = move & 127, to = (move >> 7) & 127, promo = (move >> 14) & 7, flag = (move >> 17) & 7;
        const type = Math.abs(pos.board[from]);
        const letters = ' PNBRQK';
        let text;
        if (flag === FLAG_CASTLE_K) text = 'O-O';
        else if (flag === FLAG_CASTLE_Q) text = 'O-O-O';
        else {
            const takes = pos.board[to] !== 0 || flag === FLAG_EP;
            if (type === PAWN) {
                text = (takes ? `${'abcdefgh'[from & 7]}x` : '') + squareName(to) + (promo ? `=${letters[promo]}` : '');
            } else {
                const rivals = legalMoves(pos)
                    .filter((other) => other !== move && ((other >> 7) & 127) === to && Math.abs(pos.board[other & 127]) === type)
                    .map((other) => other & 127);
                let origin = '';
                if (rivals.length) {
                    if (!rivals.some((sq) => (sq & 7) === (from & 7))) origin = 'abcdefgh'[from & 7];
                    else if (!rivals.some((sq) => (sq >> 4) === (from >> 4))) origin = String((from >> 4) + 1);
                    else origin = squareName(from);
                }
                text = letters[type] + origin + (takes ? 'x' : '') + squareName(to);
            }
        }
        makeMove(pos, move);
        if (inCheck(pos)) text += legalMoves(pos).length ? '+' : '#';
        undoMove(pos);
        return text;
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

    // ---- Evaluation ----

    // Piece values plus a bonus for where the piece stands, from white's side of the board,
    // once for the middlegame and once for the endgame.
    const buildTables = () => {
        const middle = [], ending = [];
        for (let type = PAWN; type <= KING; type++) {
            middle[type] = new Int16Array(64);
            ending[type] = new Int16Array(64);
        }
        const pawnMiddle = [0, 0, 2, 6, 12, 22, 40, 0], pawnEnding = [0, 4, 8, 16, 30, 55, 90, 0];
        const pawnCentre = [0, -14, 6, 16, 8, 0, 0, 0];
        const rookFile = [0, 0, 4, 8, 8, 4, 0, 0];
        const kingHome = [14, 26, 10, -10, -4, -10, 26, 14];
        for (let rank = 0; rank < 8; rank++) {
            for (let file = 0; file < 8; file++) {
                const index = rank * 8 + file;
                const centre = Math.min(file, 7 - file) + Math.min(rank, 7 - rank);
                const midFile = file === 3 || file === 4;
                middle[PAWN][index] = 100 + pawnMiddle[rank] + (midFile ? pawnCentre[rank] : 0);
                ending[PAWN][index] = 100 + pawnEnding[rank];
                middle[KNIGHT][index] = 320 + centre * 9 - 30;
                ending[KNIGHT][index] = 320 + centre * 6 - 20;
                middle[BISHOP][index] = 330 + centre * 4 - 10 - (rank === 0 ? 8 : 0);
                ending[BISHOP][index] = 330 + centre * 3 - 8;
                middle[ROOK][index] = 500 + rookFile[file] + (rank === 6 ? 16 : 0);
                ending[ROOK][index] = 510 + (rank === 6 ? 10 : 0);
                middle[QUEEN][index] = 900 + centre * 2 - 6;
                ending[QUEEN][index] = 920 + centre * 4 - 12;
                middle[KING][index] = rank === 0 ? kingHome[file] : rank === 1 ? -18 : -40;
                ending[KING][index] = centre * 10 - 30;
            }
        }
        return { middle, ending };
    };
    const TABLES = buildTables();
    const PHASE = [0, 0, 1, 1, 2, 4, 0];
    const PASSED = [0, 5, 10, 20, 35, 60, 100, 0];

    const whitePawns = [], blackPawns = [], whiteRooks = [], blackRooks = [];
    const whiteOnFile = new Int8Array(8), blackOnFile = new Int8Array(8);
    const whiteRearmost = new Int8Array(8), blackRearmost = new Int8Array(8);

    // Pawn structure for one side: passed, doubled and isolated pawns. Ranks are counted from that side's own back row.
    const pawnScore = (pawns, ownOnFile, theirRearmost, white) => {
        let score = 0;
        for (let i = 0; i < pawns.length; i++) {
            const file = pawns[i] & 7;
            const rank = white ? pawns[i] >> 4 : 7 - (pawns[i] >> 4);
            let passed = true;
            for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f++) {
                if (theirRearmost[f] > rank) passed = false;
            }
            if (passed) score += PASSED[rank];
            if (!(file > 0 && ownOnFile[file - 1]) && !(file < 7 && ownOnFile[file + 1])) score -= 10;
            if (ownOnFile[file] > 1) score -= 8;
        }
        return score;
    };

    // Score in hundredths of a pawn from the point of view of the side to move.
    const evaluate = (pos) => {
        const board = pos.board;
        let middle = 0, ending = 0, phase = 0, material = 0, whiteBishops = 0, blackBishops = 0;
        whitePawns.length = blackPawns.length = whiteRooks.length = blackRooks.length = 0;
        whiteOnFile.fill(0); blackOnFile.fill(0);
        // Per file, the rank of the pawn nearest its own back row, counted from the opponent's back row.
        whiteRearmost.fill(-1); blackRearmost.fill(-1);
        for (let sq = 0; sq < 120; sq++) {
            if (sq & 0x88) { sq += 7; continue; }
            const piece = board[sq];
            if (!piece) continue;
            const file = sq & 7, rank = sq >> 4;
            if (piece > 0) {
                const index = rank * 8 + file;
                middle += TABLES.middle[piece][index];
                ending += TABLES.ending[piece][index];
                phase += PHASE[piece];
                if (piece === PAWN) {
                    whitePawns.push(sq);
                    whiteOnFile[file]++;
                    if (7 - rank > whiteRearmost[file]) whiteRearmost[file] = 7 - rank;
                    material += 100;
                } else if (piece !== KING) {
                    material += piece === QUEEN ? 900 : piece === ROOK ? 500 : 320;
                    if (piece === ROOK) whiteRooks.push(sq);
                    if (piece === BISHOP) whiteBishops++;
                }
            } else {
                const type = -piece, index = (7 - rank) * 8 + file;
                middle -= TABLES.middle[type][index];
                ending -= TABLES.ending[type][index];
                phase += PHASE[type];
                if (type === PAWN) {
                    blackPawns.push(sq);
                    blackOnFile[file]++;
                    if (rank > blackRearmost[file]) blackRearmost[file] = rank;
                    material -= 100;
                } else if (type !== KING) {
                    material -= type === QUEEN ? 900 : type === ROOK ? 500 : 320;
                    if (type === ROOK) blackRooks.push(sq);
                    if (type === BISHOP) blackBishops++;
                }
            }
        }
        const structure = pawnScore(whitePawns, whiteOnFile, blackRearmost, true)
            - pawnScore(blackPawns, blackOnFile, whiteRearmost, false);
        middle += structure >> 1;
        ending += structure;
        let extras = (whiteBishops > 1 ? 30 : 0) - (blackBishops > 1 ? 30 : 0);
        for (let i = 0; i < whiteRooks.length; i++) {
            const file = whiteRooks[i] & 7;
            if (!whiteOnFile[file]) extras += blackOnFile[file] ? 8 : 16;
        }
        for (let i = 0; i < blackRooks.length; i++) {
            const file = blackRooks[i] & 7;
            if (!blackOnFile[file]) extras -= whiteOnFile[file] ? 8 : 16;
        }
        // When clearly ahead, drive the other king to the edge and bring the kings together, which is what forces mate.
        if (material >= 300 || material <= -300) {
            const loser = pos.kings[material > 0 ? 1 : 0], winner = pos.kings[material > 0 ? 0 : 1];
            const edge = (Math.abs(2 * (loser & 7) - 7) + Math.abs(2 * (loser >> 4) - 7)) / 2 - 1;
            const apart = Math.abs((loser & 7) - (winner & 7)) + Math.abs((loser >> 4) - (winner >> 4));
            const push = 6 * edge + 3 * (14 - apart);
            ending += material > 0 ? push : -push;
        }
        if (phase > 24) phase = 24;
        const score = Math.round((middle * phase + ending * (24 - phase)) / 24) + extras;
        return pos.side === WHITE ? score : -score;
    };

    // ---- Search ----

    const MATE = 30000, INFINITE = 32000, MAX_PLY = 64;
    const TT_SIZE = 1 << 18;
    const EXACT = 1, LOWER = 2, UPPER = 3;
    let ttLo = null, ttHi, ttMove, ttScore, ttDepth, ttFlag;
    const killers = new Int32Array(MAX_PLY * 2 + 4);
    const historyScores = new Int32Array(2 * 128 * 128);
    let pos = null, deadline = 0, nodes = 0, stopped = false;

    const ensureTable = () => {
        if (ttLo) return;
        ttLo = new Int32Array(TT_SIZE);
        ttHi = new Int32Array(TT_SIZE);
        ttMove = new Int32Array(TT_SIZE);
        ttScore = new Int16Array(TT_SIZE);
        ttDepth = new Int8Array(TT_SIZE);
        ttFlag = new Int8Array(TT_SIZE);
    };

    const tick = () => {
        if ((++nodes & 2047) === 0 && Date.now() >= deadline) stopped = true;
    };

    const isQuiet = (move) => !pos.board[(move >> 7) & 127] && !((move >> 14) & 7) && ((move >> 17) & 7) !== FLAG_EP;

    // Higher is searched first: the remembered best move, then captures by most valuable victim, then moves that refuted siblings.
    const orderScore = (move, hashMove, ply) => {
        if (move === hashMove) return 1000000;
        const from = move & 127, to = (move >> 7) & 127;
        const victim = ((move >> 17) & 7) === FLAG_EP ? PAWN : Math.abs(pos.board[to]);
        if (victim) return 20000 + victim * 16 - Math.abs(pos.board[from]);
        if ((move >> 14) & 7) return 19000 + ((move >> 14) & 7);
        if (move === killers[ply * 2]) return 18000;
        if (move === killers[ply * 2 + 1]) return 17000;
        return Math.min(16000, historyScores[(pos.side === WHITE ? 0 : 16384) + from * 128 + to]);
    };

    // Moves the best remaining move to position start.
    const pickNext = (moves, scores, start) => {
        let best = start;
        for (let i = start + 1; i < moves.length; i++) if (scores[i] > scores[best]) best = i;
        if (best !== start) {
            const move = moves[start], score = scores[start];
            moves[start] = moves[best]; scores[start] = scores[best];
            moves[best] = move; scores[best] = score;
        }
        return moves[start];
    };

    // Plays out captures until the position is calm so that the search never stops in the middle of an exchange.
    const quiesce = (alpha, beta, ply) => {
        tick();
        if (stopped) return 0;
        const stand = evaluate(pos);
        if (stand >= beta) return beta;
        if (stand > alpha) alpha = stand;
        if (ply >= MAX_PLY) return alpha;
        const side = pos.side, kingIndex = side === WHITE ? 0 : 1;
        const moves = generate(pos, true);
        const scores = moves.map((move) => orderScore(move, 0, ply));
        for (let i = 0; i < moves.length; i++) {
            const move = pickNext(moves, scores, i);
            makeMove(pos, move);
            if (attacked(pos, pos.kings[kingIndex], -side)) { undoMove(pos); continue; }
            const score = -quiesce(-beta, -alpha, ply + 1);
            undoMove(pos);
            if (stopped) return 0;
            if (score >= beta) return beta;
            if (score > alpha) alpha = score;
        }
        return alpha;
    };

    const hasPieces = (side) => {
        for (let sq = 0; sq < 120; sq++) {
            if (sq & 0x88) continue;
            const type = pos.board[sq] * side;
            if (type > PAWN && type < KING) return true;
        }
        return false;
    };

    const search = (depth, alpha, beta, ply, canPass) => {
        tick();
        if (stopped) return 0;
        if (pos.half >= 100 || repetitions(pos) > 1) return 0;
        const side = pos.side, kingIndex = side === WHITE ? 0 : 1;
        const checked = attacked(pos, pos.kings[kingIndex], -side);
        if (checked) depth++;
        if (depth <= 0) return quiesce(alpha, beta, ply);
        if (ply >= MAX_PLY) return evaluate(pos);

        const slot = pos.lo & (TT_SIZE - 1);
        let hashMove = 0;
        if (ttLo[slot] === pos.lo && ttHi[slot] === pos.hi) {
            hashMove = ttMove[slot];
            if (ttDepth[slot] >= depth) {
                let stored = ttScore[slot];
                if (stored > MATE - 1000) stored -= ply;
                else if (stored < -MATE + 1000) stored += ply;
                if (ttFlag[slot] === EXACT) return stored;
                if (ttFlag[slot] === LOWER && stored >= beta) return stored;
                if (ttFlag[slot] === UPPER && stored <= alpha) return stored;
            }
        }

        // If passing the turn still leaves the opponent unable to get below beta, the position is good enough to cut.
        if (canPass && !checked && depth >= 3 && beta < MATE - 1000 && hasPieces(side) && evaluate(pos) >= beta) {
            pos.stack.push(0, 0, pos.castle, pos.ep, pos.half, pos.lo, pos.hi);
            if (pos.ep >= 0) { pos.lo ^= EP_LO[pos.ep & 7]; pos.hi ^= EP_HI[pos.ep & 7]; }
            pos.ep = -1;
            pos.half = 0;
            pos.side = -side;
            pos.lo ^= SIDE_LO; pos.hi ^= SIDE_HI;
            const score = -search(depth - 3, -beta, -beta + 1, ply + 1, false);
            pos.side = side;
            pos.hi = pos.stack.pop(); pos.lo = pos.stack.pop(); pos.half = pos.stack.pop(); pos.ep = pos.stack.pop();
            pos.stack.length -= 3;
            if (stopped) return 0;
            if (score >= beta) return beta;
        }

        const moves = generate(pos, false);
        const scores = moves.map((move) => orderScore(move, hashMove, ply));
        let best = -INFINITE, bestMove = 0, flag = UPPER, legal = 0;
        for (let i = 0; i < moves.length; i++) {
            const move = pickNext(moves, scores, i);
            const quiet = isQuiet(move);
            makeMove(pos, move);
            if (attacked(pos, pos.kings[kingIndex], -side)) { undoMove(pos); continue; }
            legal++;
            let score;
            if (legal === 1) score = -search(depth - 1, -beta, -alpha, ply + 1, true);
            else {
                // Late quiet moves are tried one ply shallower with a zero-width window, and searched fully only if they surprise.
                const reduction = depth >= 3 && legal > 4 && quiet && !checked ? 1 : 0;
                score = -search(depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, true);
                if (score > alpha && (reduction || score < beta)) score = -search(depth - 1, -beta, -alpha, ply + 1, true);
            }
            undoMove(pos);
            if (stopped) return 0;
            if (score > best) {
                best = score;
                bestMove = move;
                if (score > alpha) {
                    alpha = score;
                    flag = EXACT;
                    if (score >= beta) {
                        flag = LOWER;
                        if (quiet) {
                            if (killers[ply * 2] !== move) {
                                killers[ply * 2 + 1] = killers[ply * 2];
                                killers[ply * 2] = move;
                            }
                            historyScores[(side === WHITE ? 0 : 16384) + (move & 127) * 128 + ((move >> 7) & 127)] += depth * depth;
                        }
                        break;
                    }
                }
            }
        }
        if (!legal) return checked ? -MATE + ply : 0;

        ttLo[slot] = pos.lo;
        ttHi[slot] = pos.hi;
        ttMove[slot] = bestMove;
        ttScore[slot] = best > MATE - 1000 ? best + ply : best < -MATE + 1000 ? best - ply : best;
        ttDepth[slot] = depth;
        ttFlag[slot] = flag;
        return best;
    };

    // Easy looks one move ahead, wobbles its scores and sometimes plays at random. Medium looks three plies ahead.
    // Hard searches as deep as its time allows.
    const LEVELS = {
        easy: { maxDepth: 1, timeMs: 300, noise: 120, blunder: 0.25 },
        medium: { maxDepth: 3, timeMs: 600, noise: 12, blunder: 0 },
        hard: { maxDepth: 40, timeMs: 900, noise: 0, blunder: 0 }
    };

    const bestMove = (position, level, timeMs) => {
        const options = LEVELS[level];
        const entries = legalMoves(position).map((move) => ({ move, score: 0, order: Math.random() }));
        if (entries.length < 2) return entries.length ? entries[0].move : 0;
        if (Math.random() < options.blunder) return entries[Math.floor(Math.random() * entries.length)].move;
        // A random first ordering gives variety between games when several moves score the same.
        entries.sort((a, b) => a.order - b.order);
        ensureTable();
        pos = position;
        nodes = 0;
        stopped = false;
        deadline = Date.now() + (timeMs || options.timeMs);
        killers.fill(0);
        historyScores.fill(0);
        let best = entries[0].move;
        for (let depth = 1; depth <= options.maxDepth; depth++) {
            let alpha = -INFINITE, leader = 0;
            const scores = [];
            for (const entry of entries) {
                makeMove(pos, entry.move);
                // With noise every move needs its true score, so the window stays fully open.
                const score = -search(depth - 1, -INFINITE, options.noise ? INFINITE : -alpha, 1, true);
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
            if (alpha > MATE - 1000) break;
        }
        if (options.noise) {
            let top = -Infinity;
            for (const entry of entries) {
                const wobble = Math.abs(entry.score) > MATE - 1000 ? 0 : (Math.random() * 2 - 1) * options.noise;
                if (entry.score + wobble > top) { top = entry.score + wobble; best = entry.move; }
            }
        }
        return best;
    };

    const api = {
        WHITE, BLACK, START_FEN, create, toFen, legalMoves, makeMove, undoMove, inCheck, status, describe, pieces, san,
        perft, bestMove,
        turn: (pos) => pos.side,
        kingSquare: (pos, side) => to64(pos.kings[side === WHITE ? 0 : 1])
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
        // As a worker: rebuild the game from its moves (so repetitions are known) and answer with a move.
        root.onmessage = ({ data }) => {
            const game = create(data.fen);
            data.moves.forEach((move) => makeMove(game, move));
            root.postMessage({ id: data.id, move: bestMove(game, data.level) });
        };
    } else {
        root.ChessEngine = api;
    }
})(typeof self !== 'undefined' ? self : globalThis);
