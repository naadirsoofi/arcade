(() => {
    'use strict';

    const E = window.CheckersEngine;
    const $ = (id) => document.getElementById(id);
    const root = $('game');
    const boardEl = $('board'), squaresEl = $('squares'), piecesEl = $('pieces');
    const statusEl = $('status'), startScreen = $('start-screen'), endScreen = $('end-screen');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const CROWN = '<path class="crown" d="M33 58l-4-22 11 9 10-15 10 15 11-9-4 22z"/>';
    const pieceSvg = (piece) => '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="edge" cx="50" cy="55" r="39"/>'
        + `<circle class="top" cx="50" cy="47" r="39"/><circle class="ring" cx="50" cy="47" r="27"/>${Math.abs(piece) === 2 ? CROWN : ''}</svg>`;
    const colorClass = (piece) => (piece > 0 ? 'red' : 'black');
    const colorName = (side) => (side === E.RED ? 'Red' : 'Black');
    const LEVEL_NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

    const load = (key) => {
        try {
            return JSON.parse(localStorage.getItem(`arcade.checkers.${key}`));
        } catch {
            return null;
        }
    };
    const save = (key, value) => {
        try {
            localStorage.setItem(`arcade.checkers.${key}`, JSON.stringify(value));
        } catch { /* storage is blocked: play on without saving */ }
    };

    const settings = { mode: 'computer', level: 'medium', ...load('settings') };
    const stats = load('stats') || {};

    let pos = E.create();
    let game = { mode: settings.mode, level: settings.level, counted: false };
    let started = false;
    let history = [];            // the moves played, as engine move objects
    let cells = [], legal = [];  // the board and the legal moves of the current position
    let outcome = { over: false, winner: 0, reason: '' };
    let menuOpen = true, endShown = false;
    // A chain of jumps is made one hop at a time: route holds the squares landed on so far.
    let selected = -1, route = [], cursor = 42, cursorShown = false;
    let thinking = false, requestId = 0, askedAt = 0;
    let drag = null;

    // ---- Board drawing ----

    const slot = (sq) => `translate(${(sq & 7) * 100}%, ${(sq >> 3) * 100}%)`;
    const squareEl = (sq) => squaresEl.children[sq];
    const pieceEl = (sq) => piecesEl.querySelector(`[data-sq="${sq}"]:not(.ghost)`);
    const pieceHtml = (piece, sq, extra) => `<div class="piece ${colorClass(piece)}${extra}" data-sq="${sq}" style="transform: ${slot(sq)}">${pieceSvg(piece)}</div>`;

    const isComputerTurn = () => game.mode === 'computer' && E.turn(pos) === E.BLACK;
    const canMove = () => !menuOpen && !outcome.over && !thinking && !isComputerTurn();

    // The legal moves that begin with the selected piece and the hops made so far.
    const candidates = () => (selected < 0 ? []
        : legal.filter((move) => move.from === selected && route.every((sq, i) => move.path[i] === sq)));
    const nextHops = () => candidates().map((move) => move.path[route.length]);
    const standing = () => (route.length ? route[route.length - 1] : selected);

    // Redraws every piece. A slide is { path, captures }: the moved piece travels along the path, hop by hop,
    // while the pieces it jumped fade out.
    const renderPieces = (slide) => {
        const view = cells.slice();
        const jumped = new Set();
        if (route.length) {
            view[standing()] = view[selected];
            view[selected] = 0;
            candidates()[0].captures.slice(0, route.length).forEach((sq) => jumped.add(sq));
        }
        const forced = canMove() && legal.length && legal[0].captures.length;
        const mustJump = new Set(forced ? (route.length ? [standing()] : legal.map((move) => move.from)) : []);
        piecesEl.innerHTML = view.map((piece, sq) => (piece
            ? pieceHtml(piece, sq, (jumped.has(sq) ? ' jumped' : '') + (mustJump.has(sq) ? ' must' : ''))
            : '')).join('');
        if (!slide || reducedMotion.matches) return;
        const hops = slide.path.length - 1;
        if (hops > 0) {
            pieceEl(slide.path[hops]).animate(slide.path.map((sq) => ({ transform: slot(sq) })), { duration: 220 * hops, easing: 'ease-in-out' });
        }
        slide.captures.forEach(([sq, piece]) => {
            piecesEl.insertAdjacentHTML('afterbegin', pieceHtml(piece, sq, ' ghost'));
            const ghost = piecesEl.firstElementChild;
            ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: Math.max(260, 220 * hops), easing: 'ease-in' }).onfinish = () => ghost.remove();
        });
    };

    const renderMarks = () => {
        const last = history[history.length - 1];
        const lastSquares = last ? [last.from, ...last.path] : [];
        const hops = canMove() ? nextHops() : [];
        for (let sq = 0; sq < 64; sq++) {
            const list = squareEl(sq).classList;
            list.toggle('last', lastSquares.includes(sq));
            list.toggle('selected', sq === standing());
            list.toggle('target', hops.includes(sq));
            list.toggle('cursor', cursorShown && sq === cursor);
            list.toggle('drop', Boolean(drag) && drag.over === sq && hops.includes(sq));
        }
    };

    // ---- Panel ----

    const outcomeText = () => {
        if (outcome.winner === 0) return { title: 'Draw', note: 'Forty moves each went by without a capture or a crowning.' };
        const loser = colorName(-outcome.winner);
        const note = outcome.reason === 'captured' ? `Every ${loser} piece has been captured.` : `${loser} has no legal move left.`;
        if (game.mode === 'pair') return { title: `${colorName(outcome.winner)} wins`, note };
        return { title: outcome.winner === E.RED ? 'You win' : 'Computer wins', note };
    };

    const statusText = () => {
        if (outcome.over) return outcomeText().title;
        if (thinking) return 'Computer is thinking';
        if (route.length) return 'Keep jumping';
        const mover = game.mode === 'pair' ? colorName(E.turn(pos)) : 'You';
        if (legal[0].captures.length) return `${mover} must jump`;
        return game.mode === 'pair' ? `${mover} to move` : 'Your move';
    };

    const renderSeat = (seat, side) => {
        const own = cells.filter((piece) => piece * side > 0);
        const kings = own.filter((piece) => Math.abs(piece) === 2).length;
        const name = game.mode === 'pair' ? colorName(side) : side === E.RED ? 'You' : `Computer (${LEVEL_NAMES[game.level]})`;
        seat.querySelector('.name').textContent = name;
        seat.querySelector('.tally').innerHTML = `<i class="mini ${colorClass(side)}">${pieceSvg(side)}</i><b>${own.length}</b> left`
            + (kings ? `, ${kings} ${kings === 1 ? 'king' : 'kings'}` : '');
        seat.classList.toggle('active', !outcome.over && E.turn(pos) === side);
    };

    const undoCount = () => (game.mode === 'computer' && E.turn(pos) === E.RED ? 2 : 1);

    const renderPanel = () => {
        statusEl.textContent = statusText();
        renderSeat($('seat-top'), E.BLACK);
        renderSeat($('seat-bottom'), E.RED);
        $('undo').disabled = !route.length && history.length < undoCount();
        root.dataset.state = menuOpen ? 'ready' : outcome.over ? 'over' : 'playing';
        root.dataset.turn = E.turn(pos) === E.RED ? 'red' : 'black';
        root.dataset.thinking = String(thinking);
        root.dataset.position = E.toText(pos);
        startScreen.hidden = !menuOpen;
        endScreen.hidden = menuOpen || !endShown;
    };

    // Reads the position again after any change to it.
    const sync = () => {
        cells = E.pieces(pos);
        legal = E.legalMoves(pos);
        outcome = E.status(pos);
    };

    const renderAll = (slide) => {
        renderPieces(slide);
        renderMarks();
        renderPanel();
    };

    const persist = () => {
        save('game', { mode: game.mode, level: game.level, counted: game.counted, moves: history.map(E.moveKey) });
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
            if (outcome.winner === E.RED) {
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
        const cheer = game.mode === 'pair' || outcome.winner === E.RED;
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
        const hadRoute = route.length > 0;
        selected = sq;
        route = [];
        if (hadRoute) renderPieces(null);
        renderMarks();
        renderPanel();
    };

    const afterMove = (slide) => {
        sync();
        renderAll(slide);
        persist();
        if (outcome.over) {
            recordResult();
            persist();
            // A short pause lets the final move be seen before the result covers the board.
            const id = requestId;
            setTimeout(() => { if (id === requestId && outcome.over) showEnd(); }, 900);
        } else if (isComputerTurn()) askComputer();
    };

    const commit = (move, slide) => {
        history.push(move);
        E.makeMove(pos, move);
        selected = -1;
        route = [];
        afterMove(slide);
    };

    // Moves the selected piece one hop. The move is played once its whole path has been walked.
    const hop = (to, animate) => {
        const from = standing();
        route.push(to);
        const options = candidates();
        const complete = options.find((move) => move.path.length === route.length);
        const path = animate ? [from, to] : [to];
        if (complete) {
            const last = complete.captures[route.length - 1];
            commit(complete, { path, captures: last === undefined ? [] : [[last, cells[last]]] });
        } else {
            renderAll({ path, captures: [] });
        }
    };

    // A tap or Enter on a square: hop there, pick a piece up, or put it down (which also abandons a chain in progress).
    const act = (sq) => {
        if (selected >= 0 && nextHops().includes(sq)) hop(sq, true);
        else if (!route.length && sq !== selected && legal.some((move) => move.from === sq)) select(sq);
        else select(-1);
    };

    // ---- Computer ----

    let worker = null;
    try {
        worker = new Worker('engine.js');
    } catch {
        worker = null;
    }

    const answer = (id, key) => {
        const wait = Math.max(0, 450 - (performance.now() - askedAt));
        setTimeout(() => {
            if (id !== requestId) return;
            thinking = false;
            const move = legal.find((candidate) => E.moveKey(candidate) === key);
            commit(move, { path: [move.from, ...move.path], captures: move.captures.map((sq) => [sq, cells[sq]]) });
        }, wait);
    };

    // Without a worker the search runs here, on a short time cap, after the frame has painted.
    const thinkHere = (id) => setTimeout(() => {
        if (id === requestId) answer(id, E.moveKey(E.bestMove(pos, game.level, 300)));
    }, 30);

    if (worker) {
        worker.onmessage = ({ data }) => answer(data.id, data.key);
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
            if (worker) worker.postMessage({ id, start: E.START, moves: history.map(E.moveKey), level: game.level });
            else thinkHere(id);
        });
    };

    // ---- Game flow ----

    // Undo first abandons a chain in progress. Against the computer it takes back the reply as well.
    const undo = () => {
        if (route.length) {
            select(-1);
            return;
        }
        const count = undoCount();
        if (history.length < count) return;
        requestId++;
        thinking = false;
        for (let i = 0; i < count; i++) {
            E.undoMove(pos);
            history.pop();
        }
        selected = -1;
        endShown = false;
        sync();
        renderAll(null);
        persist();
    };

    const startGame = () => {
        game = { mode: settings.mode, level: settings.level, counted: false };
        started = true;
        pos = E.create();
        history = [];
        requestId++;
        thinking = false;
        menuOpen = false;
        endShown = false;
        selected = -1;
        route = [];
        cursor = 42;
        sync();
        renderAll(null);
        persist();
        boardEl.focus({ preventScroll: true });
    };

    const renderOptions = () => {
        document.querySelectorAll('.choice').forEach((button) => {
            button.setAttribute('aria-pressed', String(settings[button.dataset.option] === button.dataset.value));
        });
        $('level-option').hidden = settings.mode === 'pair';
    };

    const openMenu = () => {
        menuOpen = true;
        $('resume').hidden = !started;
        renderOptions();
        renderAll(null);
        $('start').focus();
    };

    const closeMenu = () => {
        menuOpen = false;
        renderAll(null);
        boardEl.focus({ preventScroll: true });
    };

    const restore = () => {
        const saved = load('game');
        if (!saved || !Array.isArray(saved.moves) || !saved.moves.length) return false;
        const replay = E.create();
        const played = [];
        for (const key of saved.moves) {
            const move = E.legalMoves(replay).find((candidate) => E.moveKey(candidate) === key);
            if (!move) return false;
            played.push(move);
            E.makeMove(replay, move);
        }
        game = {
            mode: saved.mode === 'pair' ? 'pair' : 'computer',
            level: LEVEL_NAMES[saved.level] ? saved.level : 'medium',
            counted: Boolean(saved.counted)
        };
        pos = replay;
        history = played;
        started = true;
        menuOpen = false;
        return true;
    };

    // ---- Pointer input: drag a piece, or tap a piece and then a square ----

    const squareAt = (x, y) => {
        const box = boardEl.getBoundingClientRect();
        const col = Math.floor(((x - box.left) / box.width) * 8), row = Math.floor(((y - box.top) / box.height) * 8);
        return col < 0 || col > 7 || row < 0 || row > 7 ? -1 : row * 8 + col;
    };

    const followFinger = () => {
        const box = boardEl.getBoundingClientRect();
        const size = box.width / 8;
        // Under a finger the piece rides a little higher so it stays in view.
        const lift = drag.touch ? size * 0.6 : 0;
        drag.el.classList.add('dragging');
        drag.el.style.transform = `translate(${drag.x - box.left - size / 2}px, ${drag.y - box.top - size / 2 - lift}px)`;
    };

    const endDrag = () => {
        if (!drag) return;
        if (boardEl.hasPointerCapture(drag.id)) boardEl.releasePointerCapture(drag.id);
        drag = null;
    };

    boardEl.addEventListener('pointerdown', (event) => {
        if (!event.isPrimary || event.button !== 0 || !canMove()) return;
        const sq = squareAt(event.clientX, event.clientY);
        if (sq < 0) return;
        event.preventDefault();
        boardEl.focus({ preventScroll: true });
        cursor = sq;
        cursorShown = false;
        if (selected >= 0 && nextHops().includes(sq)) {
            hop(sq, true);
            return;
        }
        const resuming = route.length > 0 && sq === standing();
        if (!resuming && (route.length || !legal.some((move) => move.from === sq))) {
            select(-1);
            return;
        }
        const wasSelected = selected === sq;
        if (!resuming) select(sq);
        drag = {
            id: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
            el: pieceEl(sq), touch: event.pointerType !== 'mouse', moved: false, over: sq, wasSelected
        };
        boardEl.setPointerCapture(event.pointerId);
    });

    boardEl.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
        drag.moved = true;
        drag.x = event.clientX;
        drag.y = event.clientY;
        drag.over = squareAt(drag.x, drag.y);
        // Sliding over the landing square of a jump that has more jumps after it makes that hop at once,
        // so a whole chain can be played in one slide without lifting.
        if (nextHops().includes(drag.over)) {
            const longer = candidates().filter((move) => move.path[route.length] === drag.over)
                .every((move) => move.path.length > route.length + 1);
            if (longer) {
                route.push(drag.over);
                renderPieces(null);
                renderPanel();
                drag.el = pieceEl(drag.over);
            }
        }
        followFinger();
        renderMarks();
    });

    boardEl.addEventListener('pointerup', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const { moved, wasSelected } = drag;
        const to = squareAt(event.clientX, event.clientY);
        endDrag();
        if (!moved) {
            if (wasSelected) select(-1);
        } else if (nextHops().includes(to)) {
            hop(to, false);
        } else {
            // Dropped somewhere it cannot go: the piece returns to where it stands.
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

    // ---- Keyboard: the cursor walks the dark squares only ----

    const moveCursor = (key) => {
        let row = cursor >> 3, index = (cursor & 7) >> 1;
        if (key === 'ArrowUp') row = Math.max(0, row - 1);
        if (key === 'ArrowDown') row = Math.min(7, row + 1);
        if (key === 'ArrowLeft') index = Math.max(0, index - 1);
        if (key === 'ArrowRight') index = Math.min(3, index + 1);
        cursor = row * 8 + index * 2 + (row % 2 ? 0 : 1);
    };

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const confirm = event.key === 'Enter' || event.key === ' ';
        const onControl = Boolean(event.target.closest('button, a'));
        if (menuOpen || (outcome.over && endShown)) {
            if (confirm && !onControl) {
                event.preventDefault();
                startGame();
            }
            return;
        }
        if (event.key.startsWith('Arrow')) {
            event.preventDefault();
            moveCursor(event.key);
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

    for (let sq = 0; sq < 64; sq++) {
        const square = document.createElement('div');
        square.className = `sq ${((sq >> 3) + sq) & 1 ? 'dark' : 'light'}`;
        squaresEl.append(square);
    }
    const resumed = restore();
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
