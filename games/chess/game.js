(() => {
    'use strict';

    const E = window.ChessEngine;
    const $ = (id) => document.getElementById(id);
    const root = $('game');
    const boardEl = $('board'), squaresEl = $('squares'), piecesEl = $('pieces'), promotionEl = $('promotion');
    const statusEl = $('status'), announceEl = $('announce'), movesEl = $('moves');
    const startScreen = $('start-screen'), endScreen = $('end-screen');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Piece drawings on a 100 by 100 grid, indexed by piece type (1 pawn, 2 knight, 3 bishop, 4 rook, 5 queen, 6 king).
    const BASE = '<rect x="22" y="76" width="56" height="12" rx="5"/>';
    const STEM = '<path d="M40 62h20c1 6 5 10 11 14H29c6-4 10-8 11-14z"/>';
    const COLLAR = '<rect x="31" y="54" width="38" height="8" rx="4"/>';
    const ART = [
        '',
        `<path d="M41 46h18l-2 6c3 9 8 16 14 24H29c6-8 11-15 14-24z"/><circle cx="50" cy="32" r="13"/>${BASE}`,
        `<path d="M30 76c0-16 6-24 14-31l-12 5-8-9 16-19 3-12 8 8c15 3 22 22 20 58z"/><circle class="dot" cx="42" cy="29" r="2.8"/><path class="line" d="M58 31c4 9 5 19 4 30"/>${BASE}`,
        `<circle cx="50" cy="12" r="5"/><path d="M50 17c12 9 18 22 12 37H38c-6-15 0-28 12-37z"/><path class="line" d="M56 28l-9 13"/>${COLLAR}${STEM}${BASE}`,
        `<path d="M28 16h10v8h7v-8h10v8h7v-8h10v20H28z"/><path d="M34 36h32l5 40H29z"/>${BASE}`,
        `<path d="M24 28l10 26h32l10-26-13 14-13-22-13 22z"/><circle cx="24" cy="25" r="4.5"/><circle cx="50" cy="17" r="4.5"/><circle cx="76" cy="25" r="4.5"/>${COLLAR}${STEM}${BASE}`,
        `<path d="M46 6h8v7h7v8h-7v9h-8v-9h-7v-8h7z"/><path d="M30 34c12-6 28-6 40 0l-5 20H35z"/>${COLLAR}${STEM}${BASE}`
    ];
    const PIECE_NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
    const PIECE_POINTS = [0, 1, 3, 3, 5, 9, 0];
    const LEVEL_NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
    const pieceSvg = (piece) => `<svg viewBox="0 0 100 100" aria-hidden="true">${ART[Math.abs(piece)]}</svg>`;
    const colorClass = (piece) => (piece > 0 ? 'white' : 'black');
    const colorName = (side) => (side === E.WHITE ? 'White' : 'Black');

    const load = (key) => {
        try {
            return JSON.parse(localStorage.getItem(`arcade.chess.${key}`));
        } catch {
            return null;
        }
    };
    const save = (key, value) => {
        try {
            localStorage.setItem(`arcade.chess.${key}`, JSON.stringify(value));
        } catch { /* storage is blocked: play on without saving */ }
    };

    const settings = { mode: 'computer', level: 'medium', side: 'white', ...load('settings') };
    const stats = load('stats') || {};

    let pos = E.create();
    let game = { mode: settings.mode, level: settings.level, human: settings.side === 'black' ? E.BLACK : E.WHITE, counted: false };
    let started = false;
    let history = [];            // one entry per move played: what the engine says it does, plus its notation
    let cells = [], legal = [];  // the board and the legal moves of the current position
    let outcome = { over: false, reason: '', winner: 0 };
    let flipped = false, menuOpen = true, endShown = false;
    let selected = -1, targets = [], cursor = 12, cursorShown = false;
    let thinking = false, requestId = 0, askedAt = 0;
    let drag = null, promotion = null;

    // ---- Board drawing ----

    const rowOf = (sq) => (flipped ? sq >> 3 : 7 - (sq >> 3));
    const colOf = (sq) => (flipped ? 7 - (sq & 7) : sq & 7);
    const slot = (sq) => `translate(${colOf(sq) * 100}%, ${rowOf(sq) * 100}%)`;
    const squareEl = (sq) => squaresEl.children[sq];
    const pieceEl = (sq) => piecesEl.querySelector(`[data-sq="${sq}"]`);

    const buildBoard = () => {
        for (let sq = 0; sq < 64; sq++) {
            const square = document.createElement('div');
            square.className = `sq ${((sq >> 3) + sq) & 1 ? 'light' : 'dark'}`;
            squaresEl.append(square);
        }
        for (let i = 0; i < 8; i++) {
            $('ranks').append(document.createElement('span'));
            $('files').append(document.createElement('span'));
        }
    };

    const layoutBoard = () => {
        for (let sq = 0; sq < 64; sq++) {
            squareEl(sq).style.gridArea = `${rowOf(sq) + 1} / ${colOf(sq) + 1}`;
        }
        for (let i = 0; i < 8; i++) {
            $('ranks').children[i].textContent = flipped ? i + 1 : 8 - i;
            $('files').children[i].textContent = 'abcdefgh'[flipped ? 7 - i : i];
        }
    };

    // Redraws every piece. When a move was just played, the moved piece (and a castling rook) slides in from its old square.
    const renderPieces = (slide) => {
        piecesEl.innerHTML = cells.map((piece, sq) => (piece
            ? `<div class="piece ${colorClass(piece)}" data-sq="${sq}" style="transform: ${slot(sq)}">${pieceSvg(piece)}</div>`
            : '')).join('');
        if (!slide || reducedMotion.matches) return;
        [[slide.from, slide.to], [slide.rookFrom, slide.rookTo]].forEach(([from, to]) => {
            if (from < 0) return;
            pieceEl(to).animate([{ transform: slot(from) }, { transform: slot(to) }], { duration: 180, easing: 'ease-out' });
        });
    };

    const renderMarks = () => {
        const last = history[history.length - 1];
        const checked = E.inCheck(pos) ? E.kingSquare(pos, E.turn(pos)) : -1;
        for (let sq = 0; sq < 64; sq++) {
            const target = targets.find((entry) => entry.to === sq);
            const list = squareEl(sq).classList;
            list.toggle('last', Boolean(last) && (last.from === sq || last.to === sq));
            list.toggle('selected', sq === selected);
            list.toggle('target', Boolean(target) && !target.captured);
            list.toggle('capture', Boolean(target) && Boolean(target.captured));
            list.toggle('check', sq === checked);
            list.toggle('cursor', cursorShown && sq === cursor);
            list.toggle('drop', Boolean(drag) && drag.over === sq && Boolean(target));
        }
    };

    // ---- Panel: status, seats, move list ----

    const isComputerTurn = () => game.mode === 'computer' && E.turn(pos) !== game.human;

    const outcomeText = () => {
        const moves = Math.ceil(history.length / 2);
        if (outcome.reason === 'checkmate') {
            const title = game.mode === 'pair' ? `${colorName(outcome.winner)} wins`
                : outcome.winner === game.human ? 'You win' : 'Computer wins';
            return { title, note: `Checkmate in ${moves} ${moves === 1 ? 'move' : 'moves'}.` };
        }
        const notes = {
            stalemate: `Stalemate: ${colorName(E.turn(pos))} has no legal move and is not in check.`,
            material: 'Neither side has enough pieces left to give checkmate.',
            repetition: 'The same position came up three times.',
            fifty: 'Fifty moves passed without a capture or a pawn move.'
        };
        return { title: 'Draw', note: notes[outcome.reason] };
    };

    const SHORT_RESULT = {
        stalemate: 'Draw by stalemate', material: 'Draw, not enough pieces',
        repetition: 'Draw by repetition', fifty: 'Draw by the fifty-move rule'
    };

    const statusText = () => {
        if (outcome.over) return SHORT_RESULT[outcome.reason] || `Checkmate. ${outcomeText().title}`;
        if (thinking) return 'Computer is thinking';
        const check = E.inCheck(pos) ? 'Check. ' : '';
        if (game.mode === 'pair') return `${check}${colorName(E.turn(pos))} to move`;
        return `${check}Your move`;
    };

    const seatName = (side) => {
        if (game.mode === 'pair') return colorName(side);
        return side === game.human ? `You (${colorName(side)})` : `Computer (${LEVEL_NAMES[game.level]})`;
    };

    const renderSeat = (seat, side, lead) => {
        const taken = history.map((entry) => entry.captured).filter((piece) => piece * side < 0)
            .sort((a, b) => PIECE_POINTS[Math.abs(b)] - PIECE_POINTS[Math.abs(a)]);
        seat.querySelector('.name').textContent = seatName(side);
        seat.querySelector('.taken').innerHTML = taken.map((piece) => `<i class="mini ${colorClass(piece)}">${pieceSvg(piece)}</i>`).join('')
            + (lead * side > 0 ? `<b class="lead">+${Math.abs(lead)}</b>` : '');
        seat.classList.toggle('active', !outcome.over && E.turn(pos) === side);
    };

    const renderPanel = () => {
        statusEl.textContent = statusText();
        const lead = cells.reduce((sum, piece) => sum + Math.sign(piece) * PIECE_POINTS[Math.abs(piece)], 0);
        const top = flipped ? E.WHITE : E.BLACK;
        renderSeat($('seat-top'), top, lead);
        renderSeat($('seat-bottom'), -top, lead);

        let html = '';
        for (let i = 0; i < history.length; i += 2) {
            const reply = history[i + 1] ? `<span>${history[i + 1].san}</span>` : '';
            html += `<li><b>${i / 2 + 1}.</b><span>${history[i].san}</span>${reply}</li>`;
        }
        movesEl.innerHTML = html || '<li class="empty">No moves yet</li>';
        if (history.length) movesEl.lastElementChild.lastElementChild.classList.add('latest');
        movesEl.scrollLeft = movesEl.scrollWidth;
        movesEl.scrollTop = movesEl.scrollHeight;

        $('undo').disabled = history.length < undoCount();
        root.dataset.state = menuOpen ? 'ready' : outcome.over ? 'over' : 'playing';
        root.dataset.turn = E.turn(pos) === E.WHITE ? 'white' : 'black';
        root.dataset.thinking = String(thinking);
        root.dataset.fen = E.toFen(pos);
        startScreen.hidden = !menuOpen;
        endScreen.hidden = menuOpen || !endShown;
    };

    // Reads the position again after any change to it.
    const sync = () => {
        cells = E.pieces(pos);
        legal = E.legalMoves(pos).map((move) => ({ move, ...E.describe(pos, move) }));
        outcome = E.status(pos);
    };

    const renderAll = (slide) => {
        renderPieces(slide);
        renderMarks();
        renderPanel();
    };

    const persist = () => {
        save('game', {
            mode: game.mode, level: game.level, human: game.human, counted: game.counted, flipped,
            moves: history.map((entry) => entry.move)
        });
    };

    // ---- End of game ----

    const levelStats = () => {
        stats[game.level] = { wins: 0, draws: 0, losses: 0, best: 0, ...stats[game.level] };
        return stats[game.level];
    };

    const recordResult = () => {
        if (game.counted) return;
        game.counted = true;
        if (game.mode === 'pair') {
            stats.pair = { games: 0, ...stats.pair };
            stats.pair.games++;
        } else {
            const record = levelStats();
            const moves = Math.ceil(history.length / 2);
            if (outcome.winner === game.human) {
                record.wins++;
                if (!record.best || moves < record.best) record.best = moves;
            } else if (outcome.winner === 0) record.draws++;
            else record.losses++;
        }
        save('stats', stats);
    };

    const showEnd = () => {
        const { title, note } = outcomeText();
        $('end-eyebrow').textContent = game.mode === 'pair' ? 'Two players' : `Against the computer, ${LEVEL_NAMES[game.level]}`;
        $('end-title').textContent = title;
        $('end-note').textContent = note;
        const cheer = game.mode === 'pair' || outcome.winner === game.human;
        $('end-card').dataset.result = outcome.winner === 0 ? 'draw' : cheer ? 'win' : 'loss';
        let rows;
        if (game.mode === 'pair') {
            rows = [['Games finished', stats.pair ? stats.pair.games : 0]];
        } else {
            const record = levelStats();
            rows = [['Wins', record.wins], ['Draws', record.draws], ['Losses', record.losses],
                ['Quickest win', record.best ? `${record.best} moves` : 'None yet']];
        }
        $('results').innerHTML = rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
        endShown = true;
        renderPanel();
        if (!menuOpen) $('again').focus();
    };

    // ---- Playing moves ----

    const select = (sq) => {
        selected = sq;
        targets = sq < 0 ? [] : legal.filter((entry) => entry.from === sq);
        renderMarks();
    };

    const afterMove = (slide) => {
        sync();
        renderAll(slide);
        persist();
        const last = history[history.length - 1];
        if (last) announceEl.textContent = `${colorName(-E.turn(pos))} played ${last.san}`;
        if (outcome.over) {
            recordResult();
            persist();
            // A short pause lets the final move be seen before the result covers the board.
            const id = requestId;
            setTimeout(() => { if (id === requestId && outcome.over) showEnd(); }, 700);
        } else if (isComputerTurn()) askComputer();
    };

    const commit = (entry, slide) => {
        history.push({ ...entry, san: E.san(pos, entry.move) });
        E.makeMove(pos, entry.move);
        selected = -1;
        targets = [];
        afterMove(slide ? entry : null);
    };

    const closePromotion = () => {
        promotion = null;
        promotionEl.hidden = true;
        promotionEl.innerHTML = '';
    };

    const openPromotion = (options, slide) => {
        promotion = { options, slide };
        const side = E.turn(pos);
        promotionEl.innerHTML = '<p>Promote to</p>' + [5, 4, 3, 2].map((type) => `<button class="promo ${colorClass(side)}" type="button" data-type="${type}" aria-label="${PIECE_NAMES[type]}">${pieceSvg(type)}</button>`).join('')
            + '<button class="btn" type="button" data-type="0">Cancel</button>';
        promotionEl.hidden = false;
        promotionEl.querySelector('button').focus();
    };

    const attempt = (from, to, slide) => {
        const options = targets.filter((entry) => entry.to === to);
        if (options.length > 1) openPromotion(options, slide);
        else commit(options[0], slide);
    };

    const canMove = () => !menuOpen && !outcome.over && !thinking && !promotion && !isComputerTurn();

    // A tap or Enter on a square: move the selected piece there, or pick up or put down a piece.
    const act = (sq) => {
        if (selected >= 0 && targets.some((entry) => entry.to === sq)) attempt(selected, sq, true);
        else if (sq !== selected && cells[sq] * E.turn(pos) > 0) select(sq);
        else select(-1);
    };

    // ---- Computer ----

    let worker = null;
    try {
        worker = new Worker('engine.js');
    } catch {
        worker = null;
    }

    const answer = (id, move) => {
        const wait = Math.max(0, 450 - (performance.now() - askedAt));
        setTimeout(() => {
            if (id !== requestId) return;
            thinking = false;
            commit(legal.find((entry) => entry.move === move), true);
        }, wait);
    };

    // Without a worker the search runs here, on a short time cap, after the frame has painted.
    const thinkHere = (id) => setTimeout(() => {
        if (id === requestId) answer(id, E.bestMove(pos, game.level, 300));
    }, 30);

    if (worker) {
        worker.onmessage = ({ data }) => answer(data.id, data.move);
        worker.onerror = (event) => {
            event.preventDefault();
            worker = null;
            if (thinking) thinkHere(requestId);
        };
    }

    const askComputer = () => {
        thinking = true;
        askedAt = performance.now();
        const id = ++requestId;
        renderPanel();
        // Wait for the player's move to be painted before the search starts.
        requestAnimationFrame(() => {
            if (id !== requestId) return;
            if (worker) worker.postMessage({ id, fen: E.START_FEN, moves: history.map((entry) => entry.move), level: game.level });
            else thinkHere(id);
        });
    };

    // ---- Game flow ----

    // Against the computer an undo takes back the reply as well, so it is the player's turn again.
    const undoCount = () => (game.mode === 'computer' && E.turn(pos) === game.human ? 2 : 1);

    const undo = () => {
        const count = undoCount();
        if (history.length < count || promotion) return;
        requestId++;
        thinking = false;
        for (let i = 0; i < count; i++) {
            E.undoMove(pos);
            history.pop();
        }
        selected = -1;
        targets = [];
        endShown = false;
        sync();
        renderAll(null);
        persist();
        if (isComputerTurn()) askComputer();
    };

    const startGame = () => {
        game = { mode: settings.mode, level: settings.level, human: settings.side === 'black' ? E.BLACK : E.WHITE, counted: false };
        started = true;
        pos = E.create();
        history = [];
        flipped = game.mode === 'computer' && game.human === E.BLACK;
        requestId++;
        thinking = false;
        menuOpen = false;
        endShown = false;
        selected = -1;
        targets = [];
        cursor = flipped ? 52 : 12;
        closePromotion();
        layoutBoard();
        sync();
        renderAll(null);
        persist();
        boardEl.focus({ preventScroll: true });
        if (isComputerTurn()) askComputer();
    };

    const renderOptions = () => {
        document.querySelectorAll('.choice').forEach((button) => {
            button.setAttribute('aria-pressed', String(settings[button.dataset.option] === button.dataset.value));
        });
        $('level-option').hidden = settings.mode === 'pair';
        $('side-option').hidden = settings.mode === 'pair';
    };

    const openMenu = () => {
        menuOpen = true;
        $('resume').hidden = !started;
        renderOptions();
        renderPanel();
        $('start').focus();
    };

    const closeMenu = () => {
        menuOpen = false;
        renderPanel();
        boardEl.focus({ preventScroll: true });
    };

    const restore = () => {
        const saved = load('game');
        if (!saved || !Array.isArray(saved.moves) || !saved.moves.length) return false;
        const replay = E.create();
        const played = [];
        for (const move of saved.moves) {
            const entry = E.legalMoves(replay).map((candidate) => ({ move: candidate, ...E.describe(replay, candidate) }))
                .find((candidate) => candidate.move === move);
            if (!entry) return false;
            played.push({ ...entry, san: E.san(replay, move) });
            E.makeMove(replay, move);
        }
        game = {
            mode: saved.mode === 'pair' ? 'pair' : 'computer',
            level: ['easy', 'medium', 'hard'].includes(saved.level) ? saved.level : 'medium',
            human: saved.human === E.BLACK ? E.BLACK : E.WHITE,
            counted: Boolean(saved.counted)
        };
        pos = replay;
        history = played;
        flipped = Boolean(saved.flipped);
        started = true;
        menuOpen = false;
        cursor = flipped ? 52 : 12;
        return true;
    };

    // ---- Pointer input: drag a piece, or tap a piece and then a square ----

    const squareAt = (x, y) => {
        const box = boardEl.getBoundingClientRect();
        const col = Math.floor(((x - box.left) / box.width) * 8), row = Math.floor(((y - box.top) / box.height) * 8);
        if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
        return flipped ? row * 8 + 7 - col : (7 - row) * 8 + col;
    };

    const moveDragged = (event) => {
        const box = boardEl.getBoundingClientRect();
        const size = box.width / 8;
        // Under a finger the piece rides a little higher so it stays in view.
        const lift = event.pointerType === 'mouse' ? 0 : size * 0.6;
        drag.el.style.transform = `translate(${event.clientX - box.left - size / 2}px, ${event.clientY - box.top - size / 2 - lift}px)`;
        drag.over = squareAt(event.clientX, event.clientY);
        renderMarks();
    };

    const endDrag = () => {
        if (!drag) return;
        if (boardEl.hasPointerCapture(drag.id)) boardEl.releasePointerCapture(drag.id);
        drag = null;
    };

    boardEl.addEventListener('pointerdown', (event) => {
        if (!event.isPrimary || event.button !== 0 || event.target.closest('.promotion') || !canMove()) return;
        const sq = squareAt(event.clientX, event.clientY);
        if (sq < 0) return;
        event.preventDefault();
        boardEl.focus({ preventScroll: true });
        cursor = sq;
        cursorShown = false;
        if (selected >= 0 && targets.some((entry) => entry.to === sq)) {
            attempt(selected, sq, true);
            return;
        }
        if (cells[sq] * E.turn(pos) <= 0) {
            select(-1);
            return;
        }
        const wasSelected = selected === sq;
        select(sq);
        drag = { id: event.pointerId, sq, x: event.clientX, y: event.clientY, el: pieceEl(sq), moved: false, over: sq, wasSelected };
        boardEl.setPointerCapture(event.pointerId);
    });

    boardEl.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
        drag.moved = true;
        drag.el.classList.add('dragging');
        moveDragged(event);
    });

    boardEl.addEventListener('pointerup', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const { sq, moved, wasSelected } = drag;
        const to = squareAt(event.clientX, event.clientY);
        endDrag();
        if (!moved) {
            if (wasSelected) select(-1);
            return;
        }
        if (targets.some((entry) => entry.to === to)) attempt(sq, to, false);
        if (selected === sq) {
            // Dropped somewhere it cannot go, or waiting on a promotion choice: the piece returns to its square.
            renderPieces(null);
            renderMarks();
        }
    });

    boardEl.addEventListener('pointercancel', () => {
        if (!drag) return;
        endDrag();
        renderPieces(null);
        renderMarks();
    });

    promotionEl.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button || !promotion) return;
        const { options, slide } = promotion;
        const entry = options.find((option) => option.promo === Number(button.dataset.type));
        closePromotion();
        boardEl.focus({ preventScroll: true });
        if (entry) commit(entry, slide);
        else select(-1);
    });

    // ---- Keyboard ----

    const STEPS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const confirm = event.key === 'Enter' || event.key === ' ';
        const onControl = Boolean(event.target.closest('button, a'));
        if (promotion) {
            const buttons = [...promotionEl.querySelectorAll('button')];
            const index = buttons.indexOf(document.activeElement);
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                buttons[(index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length].focus();
            } else if (event.key === 'Escape') {
                closePromotion();
                select(-1);
                boardEl.focus({ preventScroll: true });
            }
            return;
        }
        if (menuOpen || (outcome.over && endShown)) {
            if (confirm && !onControl) {
                event.preventDefault();
                startGame();
            }
            return;
        }
        if (STEPS[event.key]) {
            event.preventDefault();
            const [dx, dy] = STEPS[event.key];
            const col = Math.min(7, Math.max(0, colOf(cursor) + dx)), row = Math.min(7, Math.max(0, rowOf(cursor) + dy));
            cursor = flipped ? row * 8 + 7 - col : (7 - row) * 8 + col;
            cursorShown = true;
            // Moving the cursor means the board is in use, so Enter and Space should act on it, not on a button clicked earlier.
            boardEl.focus({ preventScroll: true });
            renderMarks();
        } else if (confirm && !onControl) {
            event.preventDefault();
            cursorShown = true;
            if (canMove()) act(cursor);
            else renderMarks();
        } else if (event.key === 'Escape') {
            select(-1);
        }
    });

    // ---- Buttons ----

    $('undo').addEventListener('click', undo);
    $('flip').addEventListener('click', () => {
        flipped = !flipped;
        layoutBoard();
        renderAll(null);
        persist();
    });
    $('new').addEventListener('click', openMenu);
    $('start').addEventListener('click', startGame);
    $('resume').addEventListener('click', closeMenu);
    $('again').addEventListener('click', startGame);
    $('review').addEventListener('click', () => {
        endShown = false;
        renderPanel();
        $('new').focus();
    });
    document.querySelectorAll('.choice').forEach((button) => {
        button.addEventListener('click', () => {
            settings[button.dataset.option] = button.dataset.value;
            save('settings', settings);
            renderOptions();
        });
    });

    // ---- Start ----

    buildBoard();
    const resumed = restore();
    layoutBoard();
    sync();
    renderOptions();
    renderAll(null);
    if (!resumed) {
        $('start').focus();
    } else if (outcome.over) {
        showEnd();
    } else {
        boardEl.focus({ preventScroll: true });
        if (isComputerTurn()) askComputer();
    }
})();
