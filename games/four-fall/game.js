(() => {
    'use strict';

    const E = window.FourFallEngine;
    const $ = (id) => document.getElementById(id);
    const root = $('game'), stageEl = $('stage'), wellEl = $('well'), discsEl = $('discs');
    const previewEl = $('preview'), beamEl = $('beam'), landingEl = $('landing');
    const statusEl = $('status'), startScreen = $('start-screen'), endScreen = $('end-screen');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    // The two players' discs differ in shape as well as color: Gold carries a ring, Rose a diamond.
    const MARKS = {
        a: '<circle class="body" cx="50" cy="50" r="45"/><circle class="mark" cx="50" cy="50" r="19"/>',
        b: '<circle class="body" cx="50" cy="50" r="45"/><path class="mark" d="M50 28l22 22-22 22-22-22z"/>'
    };
    const discSvg = (token) => `<svg viewBox="0 0 100 100" aria-hidden="true">${MARKS[token]}</svg>`;
    const LEVEL_NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

    const load = (key) => {
        try {
            return JSON.parse(localStorage.getItem(`arcade.four-fall.${key}`));
        } catch {
            return null;
        }
    };
    const save = (key, value) => {
        try {
            localStorage.setItem(`arcade.four-fall.${key}`, JSON.stringify(value));
        } catch { /* storage is blocked: play on without saving */ }
    };

    const settings = { mode: 'computer', level: 'medium', first: 'you', ...load('settings') };
    const scores = load('score') || {};

    // A round remembers who it is between and which disc (a is Gold, b is Rose) moves first.
    let round = { mode: settings.mode, level: settings.level, first: 'a', counted: false };
    let pos = E.create();
    let outcome = { over: false, winner: 0, line: [] };
    let started = false, menuOpen = true, endShown = false;
    let column = 3, previewX = null, aim = null;
    let thinking = false, requestId = 0, askedAt = 0;

    const tokenOf = (side) => ((side === 1) === (round.first === 'a') ? 'a' : 'b');
    const turnToken = () => tokenOf(pos.side);
    const isComputerTurn = () => round.mode === 'computer' && turnToken() === 'b';
    const canDrop = () => !menuOpen && !outcome.over && !thinking && !isComputerTurn();
    const nameOf = (token) => {
        if (round.mode === 'pair') return token === 'a' ? 'Gold' : 'Rose';
        return token === 'a' ? 'You' : 'Computer';
    };
    const scoreKey = () => (round.mode === 'pair' ? 'pair' : round.level);
    const tally = () => {
        scores[scoreKey()] = { a: 0, b: 0, draws: 0, streak: 0, best: 0, ...scores[scoreKey()] };
        return scores[scoreKey()];
    };

    // ---- Drawing ----

    const buildFront = () => {
        let path = 'M26 0h648a26 26 0 0 1 26 26v548a26 26 0 0 1-26 26H26a26 26 0 0 1-26-26V26A26 26 0 0 1 26 0z';
        for (let col = 0; col < E.COLS; col++) {
            for (let row = 0; row < E.ROWS; row++) {
                path += `M${col * 100 + 12} ${row * 100 + 50}a38 38 0 1 0 76 0a38 38 0 1 0-76 0z`;
            }
        }
        $('front').innerHTML = `<path fill-rule="evenodd" d="${path}"/>`;
    };

    const cellSize = () => wellEl.clientWidth / E.COLS;
    const place = (col, row) => `left: ${(col * 100) / E.COLS}%; top: ${((E.ROWS - 1 - row) * 100) / E.ROWS}%`;

    // Redraws the discs. The one just dropped falls from above the board and settles with a small bounce.
    const renderDiscs = (dropped) => {
        let html = '';
        for (let cell = 0; cell < E.COLS * E.ROWS; cell++) {
            const side = pos.cells[cell];
            if (!side) continue;
            const win = outcome.line.includes(cell) ? ' win' : '';
            html += `<i class="disc ${tokenOf(side)}${win}" data-cell="${cell}" style="${place(Math.floor(cell / E.ROWS), cell % E.ROWS)}">${discSvg(tokenOf(side))}</i>`;
        }
        discsEl.innerHTML = html;
        discsEl.classList.toggle('decided', outcome.line.length > 0);
        // The winning discs sit behind the board front, so their highlight rings are drawn over it.
        $('halos').innerHTML = outcome.line.map((cell) => `<i class="halo" style="${place(Math.floor(cell / E.ROWS), cell % E.ROWS)}"></i>`).join('');
        if (dropped === undefined || reducedMotion.matches) return;
        const rows = E.ROWS - (dropped % E.ROWS), size = cellSize();
        discsEl.querySelector(`[data-cell="${dropped}"]`).animate([
            { transform: `translateY(${-rows * size}px)`, easing: 'cubic-bezier(0.45, 0, 0.9, 0.55)' },
            { transform: 'translateY(0)', offset: 0.76, easing: 'ease-out' },
            { transform: `translateY(${-size * 0.09}px)`, offset: 0.89, easing: 'ease-in' },
            { transform: 'translateY(0)' }
        ], { duration: 170 + 70 * rows });
    };

    // The preview disc above the board, the lit column under it and the ring where the disc would land.
    const renderAim = () => {
        const show = canDrop();
        const open = show && E.canPlay(pos, column);
        previewEl.hidden = !show;
        beamEl.hidden = !open;
        landingEl.hidden = !open;
        root.dataset.column = String(column);
        if (!show) return;
        const size = cellSize();
        previewEl.className = `disc preview ${turnToken()}${open ? '' : ' blocked'}`;
        previewEl.innerHTML = discSvg(turnToken());
        previewEl.style.transform = `translateX(${previewX === null ? column * size : previewX}px)`;
        beamEl.style.left = `${(column * 100) / E.COLS}%`;
        if (open) landingEl.style.cssText = place(column, pos.heights[column]);
    };

    const outcomeText = () => {
        if (outcome.winner === 0) return { title: 'Draw', note: 'The board filled up with no four in a row.' };
        const token = tokenOf(outcome.winner);
        const title = round.mode === 'pair' ? `${nameOf(token)} wins` : token === 'a' ? 'You win' : 'Computer wins';
        return { title, note: `Four in a row with disc ${pos.moves.length} of the round.` };
    };

    const statusText = () => {
        if (outcome.over) return outcomeText().title;
        if (thinking) return 'Computer is thinking';
        return round.mode === 'pair' ? `${nameOf(turnToken())} to drop` : 'Your turn';
    };

    // Against the computer an undo takes back its reply as well, so it is the player's turn again.
    const undoCount = () => (round.mode === 'computer' && turnToken() === 'a' ? 2 : 1);

    const renderPanel = () => {
        const score = tally();
        ['a', 'b'].forEach((token) => {
            const seat = $(`seat-${token}`);
            const label = token === 'b' && round.mode === 'computer' ? `Computer (${LEVEL_NAMES[round.level]})` : nameOf(token);
            seat.querySelector('.name').textContent = label;
            seat.querySelector('.points').textContent = score[token];
            seat.classList.toggle('active', !outcome.over && turnToken() === token);
        });
        statusEl.textContent = statusText();
        $('undo').disabled = outcome.over || pos.moves.length < undoCount();
        root.dataset.state = menuOpen ? 'ready' : outcome.over ? 'over' : 'playing';
        root.dataset.turn = turnToken();
        root.dataset.thinking = String(thinking);
        root.dataset.moves = pos.moves.join('');
        startScreen.hidden = !menuOpen;
        endScreen.hidden = menuOpen || !endShown;
    };

    const renderAll = (dropped) => {
        renderDiscs(dropped);
        renderPanel();
        renderAim();
    };

    const persist = () => {
        save('round', { mode: round.mode, level: round.level, first: round.first, counted: round.counted, moves: pos.moves.join('') });
    };

    // ---- End of a round ----

    const recordResult = () => {
        if (round.counted) return;
        round.counted = true;
        const score = tally();
        if (outcome.winner === 0) score.draws++;
        else score[tokenOf(outcome.winner)]++;
        score.streak = outcome.winner !== 0 && tokenOf(outcome.winner) === 'a' ? score.streak + 1 : 0;
        score.best = Math.max(score.best, score.streak);
        save('score', scores);
    };

    const showEnd = () => {
        const { title, note } = outcomeText();
        const score = tally();
        $('end-eyebrow').textContent = round.mode === 'pair' ? 'Two players' : `Against the computer, ${LEVEL_NAMES[round.level]}`;
        $('end-title').textContent = title;
        $('end-note').textContent = note;
        const cheer = round.mode === 'pair' || tokenOf(outcome.winner) === 'a';
        $('end-card').dataset.result = outcome.winner === 0 ? 'draw' : cheer ? 'win' : 'loss';
        const rows = [[nameOf('a'), score.a], [nameOf('b'), score.b], ['Draws', score.draws]];
        if (round.mode === 'computer') rows.push(['Best win streak', score.best]);
        $('results').innerHTML = rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
        endShown = true;
        renderPanel();
        if (!menuOpen) $('again').focus();
    };

    // ---- Playing ----

    const afterMove = (dropped) => {
        outcome = E.status(pos);
        if (outcome.over) recordResult();
        renderAll(dropped);
        persist();
        if (outcome.over) {
            // A pause lets the winning four be seen before the result covers the board.
            const id = requestId;
            setTimeout(() => { if (id === requestId && outcome.over) showEnd(); }, 1200);
        } else if (isComputerTurn()) askComputer();
    };

    const playColumn = (col) => {
        const cell = col * E.ROWS + pos.heights[col];
        E.play(pos, col);
        afterMove(cell);
    };

    const drop = (col) => {
        if (!canDrop()) return;
        column = col;
        previewX = null;
        if (E.canPlay(pos, col)) playColumn(col);
        else renderAim();
    };

    // ---- Computer ----

    let worker = null;
    try {
        worker = new Worker('engine.js');
    } catch {
        worker = null;
    }

    const answer = (id, col) => {
        const wait = Math.max(0, 500 - (performance.now() - askedAt));
        setTimeout(() => {
            if (id !== requestId) return;
            thinking = false;
            playColumn(col);
        }, wait);
    };

    // Without a worker the search runs here, on a short time cap, after the frame has painted.
    const thinkHere = (id) => setTimeout(() => {
        if (id === requestId) answer(id, E.bestMove(pos, round.level, 250));
    }, 30);

    if (worker) {
        worker.onmessage = ({ data }) => answer(data.id, data.col);
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
        renderAim();
        // Wait for the player's disc to be painted before the search starts.
        requestAnimationFrame(() => {
            if (id !== requestId) return;
            if (worker) worker.postMessage({ id, moves: pos.moves.join(''), level: round.level });
            else thinkHere(id);
        });
    };

    // ---- Game flow ----

    const undo = () => {
        const count = undoCount();
        if (outcome.over || pos.moves.length < count) return;
        requestId++;
        thinking = false;
        for (let i = 0; i < count; i++) E.undo(pos);
        afterMove();
    };

    const startRound = () => {
        // Two players take turns to start. Against the computer the menu choice decides.
        const swapped = started && round.mode === 'pair' && settings.mode === 'pair' && round.first === 'a';
        const first = settings.mode === 'pair' ? (swapped ? 'b' : 'a') : settings.first === 'you' ? 'a' : 'b';
        round = { mode: settings.mode, level: settings.level, first, counted: false };
        started = true;
        pos = E.create();
        requestId++;
        thinking = false;
        menuOpen = false;
        endShown = false;
        column = 3;
        previewX = null;
        stageEl.focus({ preventScroll: true });
        afterMove();
    };

    const renderOptions = () => {
        document.querySelectorAll('.choice').forEach((button) => {
            button.setAttribute('aria-pressed', String(settings[button.dataset.option] === button.dataset.value));
        });
        $('level-option').hidden = settings.mode === 'pair';
        $('first-option').hidden = settings.mode === 'pair';
    };

    const openMenu = () => {
        menuOpen = true;
        $('resume').hidden = !started;
        renderOptions();
        renderAll();
        $('start').focus();
    };

    const closeMenu = () => {
        menuOpen = false;
        renderAll();
        stageEl.focus({ preventScroll: true });
    };

    const restore = () => {
        const saved = load('round');
        if (!saved || typeof saved.moves !== 'string' || !/^[0-6]+$/.test(saved.moves)) return false;
        const replay = E.create();
        for (const digit of saved.moves) {
            if (E.status(replay).over || !E.canPlay(replay, Number(digit))) return false;
            E.play(replay, Number(digit));
        }
        round = {
            mode: saved.mode === 'pair' ? 'pair' : 'computer',
            level: LEVEL_NAMES[saved.level] ? saved.level : 'medium',
            first: saved.first === 'b' ? 'b' : 'a',
            counted: Boolean(saved.counted)
        };
        pos = replay;
        started = true;
        menuOpen = false;
        return true;
    };

    // ---- Pointer input ----
    // Touch: a finger down anywhere on the play screen aims, sliding moves the preview, lifting drops.
    // Mouse: moving over the board aims, a click drops.

    const aimAt = (x) => {
        const box = wellEl.getBoundingClientRect();
        const size = box.width / E.COLS;
        column = Math.min(E.COLS - 1, Math.max(0, Math.floor((x - box.left) / size)));
        previewX = Math.min(box.width - size, Math.max(0, x - box.left - size / 2));
        renderAim();
    };

    root.addEventListener('pointerdown', (event) => {
        if (!event.isPrimary || event.button !== 0 || !canDrop()) return;
        if (event.target.closest('button, a')) return;
        if (event.pointerType === 'mouse' && !event.target.closest('#stage')) return;
        event.preventDefault();
        stageEl.focus({ preventScroll: true });
        aim = event.pointerId;
        root.setPointerCapture(event.pointerId);
        aimAt(event.clientX);
    });

    root.addEventListener('pointermove', (event) => {
        if (aim === event.pointerId) aimAt(event.clientX);
        else if (aim === null && event.pointerType === 'mouse' && canDrop() && event.target.closest('#stage')) aimAt(event.clientX);
    });

    root.addEventListener('pointerup', (event) => {
        if (aim !== event.pointerId) return;
        aim = null;
        aimAt(event.clientX);
        drop(column);
    });

    root.addEventListener('pointercancel', (event) => {
        if (aim !== event.pointerId) return;
        aim = null;
        previewX = null;
        renderAim();
    });

    // ---- Keyboard ----

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const confirm = event.key === 'Enter' || event.key === ' ';
        const onControl = Boolean(event.target.closest('button, a'));
        if (menuOpen || (outcome.over && endShown)) {
            if (confirm && !onControl) {
                event.preventDefault();
                startRound();
            }
            return;
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            column = Math.min(E.COLS - 1, Math.max(0, column + (event.key === 'ArrowRight' ? 1 : -1)));
            previewX = null;
            // Aiming means the board is in use, so Enter and Space should drop, not press a button clicked earlier.
            stageEl.focus({ preventScroll: true });
            renderAim();
        } else if (event.key === 'ArrowDown' || (confirm && !onControl)) {
            event.preventDefault();
            drop(column);
        } else if (event.key >= '1' && event.key <= '7') {
            drop(Number(event.key) - 1);
        }
    });

    // ---- Buttons ----

    $('undo').addEventListener('click', undo);
    $('new').addEventListener('click', openMenu);
    $('start').addEventListener('click', startRound);
    $('resume').addEventListener('click', closeMenu);
    $('again').addEventListener('click', startRound);
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
    window.addEventListener('resize', renderAim);

    // ---- Start ----

    buildFront();
    document.querySelectorAll('.chip').forEach((chip) => { chip.innerHTML = discSvg(chip.classList.contains('a') ? 'a' : 'b'); });
    const resumed = restore();
    outcome = E.status(pos);
    renderOptions();
    renderAll();
    if (!resumed) {
        $('start').focus();
    } else if (outcome.over) {
        showEnd();
    } else {
        stageEl.focus({ preventScroll: true });
        if (isComputerTurn()) askComputer();
    }
})();
