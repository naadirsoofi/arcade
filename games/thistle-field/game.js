(() => {
    const { SIZES, create, uncover, uncoverAround, toggleMark, thistlesLeft } = window.ThistleEngine;

    const STORE = 'arcade.thistle-field.';
    const LONG_PRESS_MS = 380;
    const PRESS_SLOP = 10;
    // The end screen waits this long before it takes input, so the key that made the last move cannot dismiss it.
    const END_DELAY = 900;
    const ICONS = { mark: 'mark', thistle: 'thistle', struck: 'thistle', wrong: 'wrong' };
    const STEPS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

    const byId = (id) => document.getElementById(id);
    const root = byId('game');
    const play = document.querySelector('.play');
    const board = byId('board');
    const againButton = byId('again-btn');

    const load = (key) => {
        try {
            return localStorage.getItem(STORE + key);
        } catch {
            return null;
        }
    };

    const save = (key, value) => {
        try {
            localStorage.setItem(STORE + key, value);
        } catch {
            // Storage is blocked: keep playing without saving.
        }
    };

    const loadBest = () => {
        try {
            const parsed = JSON.parse(load('best'));
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    };

    const formatTime = (ms) => {
        const seconds = Math.floor(ms / 1000);
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };

    const best = loadBest();
    let size = SIZES[load('size')] ? load('size') : 'small';
    let game = null;
    let cells = [];
    // The engine board is tall. On a wide screen the view turns it on its side.
    let sideways = false;
    let cursor = 0;
    let press = null;
    let pressTimer = 0;
    let longPressed = false;
    let lastPointerType = 'mouse';
    let endReadyAt = 0;

    // Play time runs from the first uncover and only while the tab is visible.
    let banked = 0;
    let runningSince = null;
    const elapsed = () => banked + (runningSince === null ? 0 : performance.now() - runningSince);
    const stopClock = () => {
        banked = elapsed();
        runningSince = null;
    };
    const runClock = () => {
        if (runningSince === null && !document.hidden) runningSince = performance.now();
    };

    const viewCols = () => (sideways ? game.rows : game.cols);
    const viewRows = () => (sideways ? game.cols : game.rows);
    // Turns a position on screen into the engine's tile number.
    const tileAt = (viewRow, viewCol) => (sideways ? viewCol * game.cols + viewRow : viewRow * game.cols + viewCol);

    const kindOf = (index) => {
        if (game.open[index]) return `n${game.clue[index]}`;
        if (game.status === 'lost') {
            if (index === game.struck) return 'struck';
            if (game.thistle[index]) return game.marked[index] ? 'mark' : 'thistle';
            return game.marked[index] ? 'wrong' : 'covered';
        }
        if (game.marked[index] || (game.status === 'won' && game.thistle[index])) return 'mark';
        return 'covered';
    };

    const describe = (kind) => {
        if (kind === 'n0') return 'empty';
        if (kind[0] === 'n') return `${kind[1]} nearby`;
        return { covered: 'covered', mark: 'marked', thistle: 'thistle', struck: 'thistle you touched', wrong: 'wrong mark' }[kind];
    };

    const paint = () => {
        cells.forEach((cell) => {
            const kind = kindOf(Number(cell.dataset.index));
            if (cell.dataset.kind === kind) return;
            cell.dataset.kind = kind;
            const open = kind[0] === 'n';
            cell.className = `cell ${open ? `open ${kind}` : kind}`;
            if (ICONS[kind]) {
                cell.innerHTML = `<svg aria-hidden="true"><use href="#icon-${ICONS[kind]}"/></svg>`;
            } else if (open && kind !== 'n0') {
                cell.innerHTML = `<span>${kind[1]}</span>`;
            } else {
                cell.textContent = '';
            }
            cell.setAttribute('aria-label', `Row ${cell.dataset.row}, column ${cell.dataset.col}: ${describe(kind)}`);
        });
        byId('left').textContent = game.status === 'won' ? 0 : thistlesLeft(game);
    };

    const showTime = () => {
        byId('time').textContent = formatTime(elapsed());
    };

    const buildBoard = () => {
        sideways = window.innerWidth >= 720 && window.innerWidth > window.innerHeight;
        play.style.setProperty('--cols', viewCols());
        play.style.setProperty('--rows', viewRows());
        cells = [];
        for (let row = 0; row < viewRows(); row++) {
            for (let col = 0; col < viewCols(); col++) {
                const cell = document.createElement('button');
                cell.type = 'button';
                cell.tabIndex = -1;
                cell.dataset.index = tileAt(row, col);
                cell.dataset.row = row + 1;
                cell.dataset.col = col + 1;
                cells.push(cell);
            }
        }
        board.replaceChildren(...cells);
        cursor = Math.min(cursor, cells.length - 1);
        cells[cursor].tabIndex = 0;
        paint();
    };

    const setTool = (tool) => {
        root.dataset.tool = tool;
        document.querySelectorAll('.tool').forEach((button) => {
            button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
        });
    };

    const setState = (state) => {
        root.dataset.state = state;
        play.inert = state === 'over' && !root.dataset.peek;
    };

    const showStart = () => {
        stopClock();
        delete root.dataset.peek;
        document.querySelectorAll('.size').forEach((button) => {
            button.setAttribute('aria-pressed', String(button.dataset.size === size));
        });
        byId('start-best').textContent = best[size] ? `Best time on ${size}: ${formatTime(best[size])}` : `No best time on ${size} yet.`;
        setState('ready');
    };

    const startGame = () => {
        game = create(SIZES[size]);
        banked = 0;
        runningSince = null;
        cursor = 0;
        delete root.dataset.peek;
        delete root.dataset.result;
        setTool('uncover');
        setState('playing');
        buildBoard();
        showTime();
        byId('status').textContent = 'New meadow. Uncover any tile to begin.';
        cells[cursor].focus({ preventScroll: true });
    };

    const finish = () => {
        stopClock();
        showTime();
        const won = game.status === 'won';
        const time = elapsed();
        const previous = best[size];
        const isRecord = won && (!previous || time < previous);
        if (isRecord) {
            best[size] = Math.round(time);
            save('best', JSON.stringify(best));
        }
        root.dataset.result = game.status;
        byId('end-badge').hidden = !(isRecord && previous);
        byId('end-title').textContent = won ? 'Meadow cleared' : 'Ouch, a thistle';
        byId('end-note').textContent = won
            ? `Every safe tile on the ${size} meadow is uncovered.`
            : 'You touched a thistle. The rest are shown on the meadow.';
        byId('end-time').textContent = formatTime(time);
        byId('end-best').textContent = best[size] ? formatTime(best[size]) : 'None yet';
        byId('status').textContent = won ? 'Meadow cleared.' : 'You touched a thistle.';
        endReadyAt = performance.now() + END_DELAY;
        setState('over');
        setTimeout(() => {
            if (root.dataset.state === 'over' && !root.dataset.peek) againButton.focus();
        }, END_DELAY);
    };

    // Newly opened tiles pop in as a ripple spreading from the tile that was acted on.
    const ripple = (opened, origin) => {
        const from = cells.find((cell) => Number(cell.dataset.index) === origin);
        opened.forEach((index) => {
            const cell = cells.find((entry) => Number(entry.dataset.index) === index);
            const distance = Math.max(
                Math.abs(cell.dataset.row - from.dataset.row),
                Math.abs(cell.dataset.col - from.dataset.col)
            );
            cell.style.setProperty('--delay', `${distance * 22}ms`);
            cell.classList.add('pop');
        });
    };

    const act = (index, tool) => {
        if (root.dataset.state !== 'playing') return;
        let opened = [];
        if (game.open[index]) {
            opened = uncoverAround(game, index);
        } else if (tool === 'mark') {
            toggleMark(game, index);
        } else {
            opened = uncover(game, index);
        }
        if (game.planted) runClock();
        paint();
        ripple(opened, index);
        if (game.status !== 'playing') {
            finish();
        } else if (opened.length) {
            byId('status').textContent = `${opened.length} uncovered.`;
        }
    };

    const moveCursor = (to) => {
        cells[cursor].tabIndex = -1;
        cursor = to;
        cells[cursor].tabIndex = 0;
        cells[cursor].focus({ preventScroll: true });
    };

    const cellFrom = (event) => event.target.closest('.cell');
    const otherTool = () => (root.dataset.tool === 'mark' ? 'uncover' : 'mark');

    board.addEventListener('pointerdown', (event) => {
        const cell = cellFrom(event);
        if (!cell) return;
        lastPointerType = event.pointerType;
        longPressed = false;
        clearTimeout(pressTimer);
        if (event.pointerType === 'mouse') return;
        press = { x: event.clientX, y: event.clientY };
        pressTimer = setTimeout(() => {
            longPressed = true;
            act(Number(cell.dataset.index), otherTool());
        }, LONG_PRESS_MS);
    });

    board.addEventListener('pointermove', (event) => {
        if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > PRESS_SLOP) clearTimeout(pressTimer);
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => {
        board.addEventListener(type, () => {
            clearTimeout(pressTimer);
            press = null;
        });
    });

    // Mouse clicks, taps and Enter or Space on a focused tile all arrive here.
    board.addEventListener('click', (event) => {
        const cell = cellFrom(event);
        if (!cell) return;
        if (longPressed) {
            longPressed = false;
            return;
        }
        moveCursor(cells.indexOf(cell));
        act(Number(cell.dataset.index), root.dataset.tool);
    });

    board.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        const cell = cellFrom(event);
        // A long touch also raises this event, and the press timer has already handled it.
        if (cell && lastPointerType === 'mouse') act(Number(cell.dataset.index), 'mark');
    });

    document.querySelectorAll('.tool').forEach((button) => {
        button.addEventListener('click', () => setTool(button.dataset.tool));
    });

    document.querySelectorAll('.size').forEach((button) => {
        button.addEventListener('click', () => {
            size = button.dataset.size;
            save('size', size);
            showStart();
        });
    });

    byId('start-btn').addEventListener('click', startGame);
    byId('new-btn').addEventListener('click', startGame);
    byId('peek-again-btn').addEventListener('click', startGame);
    againButton.addEventListener('click', startGame);
    byId('menu-btn').addEventListener('click', showStart);
    byId('end-menu-btn').addEventListener('click', showStart);
    byId('peek-btn').addEventListener('click', () => {
        root.dataset.peek = 'true';
        setState('over');
        byId('peek-again-btn').focus();
    });

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const state = root.dataset.state;
        const confirm = event.key === 'Enter' || event.key === ' ';
        const onControl = event.target.closest('button, a') !== null;

        if (state === 'playing') {
            const step = STEPS[event.key];
            if (step) {
                event.preventDefault();
                const row = Math.floor(cursor / viewCols()) + step[0];
                const col = (cursor % viewCols()) + step[1];
                const inside = row >= 0 && row < viewRows() && col >= 0 && col < viewCols();
                moveCursor(inside ? row * viewCols() + col : cursor);
            } else if (event.key.toLowerCase() === 'f') {
                act(Number(cells[cursor].dataset.index), 'mark');
            } else if (confirm && !onControl) {
                event.preventDefault();
                act(Number(cells[cursor].dataset.index), root.dataset.tool);
            }
        } else if (state === 'ready') {
            if (confirm && !onControl) {
                event.preventDefault();
                startGame();
            }
        } else if (confirm && (performance.now() < endReadyAt || !onControl)) {
            event.preventDefault();
            if (performance.now() >= endReadyAt) startGame();
        }
    });

    window.addEventListener('resize', () => {
        const turned = window.innerWidth >= 720 && window.innerWidth > window.innerHeight;
        if (game && turned !== sideways) {
            cursor = 0;
            buildBoard();
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopClock();
        else if (root.dataset.state === 'playing' && game.planted) runClock();
    });

    setInterval(() => {
        if (root.dataset.state === 'playing') showTime();
    }, 250);

    showStart();
})();
