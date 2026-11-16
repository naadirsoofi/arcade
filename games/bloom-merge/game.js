(() => {
    const { STONE, GARDENS, create, move, canMove, undo } = window.BloomEngine;

    const STORE = 'arcade.bloom-merge.';
    const SLIDE_MS = 110;
    // Finger travel that fires a slide: short for a new direction, longer to repeat the one just made.
    const SWIPE_MIN = 26;
    const SWIPE_REPEAT = 72;
    const QUEUE_MAX = 3;
    // End screens wait this long before they take input, so the key that made the last move cannot dismiss them.
    const END_DELAY = 700;
    const KEYS = {
        ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', ArrowLeft: 'left',
        w: 'up', d: 'right', s: 'down', a: 'left'
    };

    // One line icon per growth stage, from seed to crown. Later stages reuse the crown.
    const ICONS = [
        '<path d="M12 4.5c4.5 3.5 5 9 0 15-5-6-4.5-11.5 0-15z"/><path d="M12 10.5v4.5"/>',
        '<path d="M12 21v-9"/><path d="M12 12c0-3.5 2.5-6 6.5-6 0 3.5-2.5 6-6.5 6z"/>',
        '<path d="M12 21V11"/><path d="M12 12c0-3.5 2.5-6 6.5-6 0 3.5-2.5 6-6.5 6z"/><path d="M12 15.5c0-3-2-5-5.5-5 0 3 2 5 5.5 5z"/>',
        '<path d="M12 21.5V4"/><path d="M12 10c0-2.4 1.8-4 4.8-4 0 2.4-1.8 4-4.8 4z"/><path d="M12 14c0-2.4-1.8-4-4.8-4 0 2.4 1.8 4 4.8 4z"/><path d="M12 18c0-2.4 1.8-4 4.8-4 0 2.4-1.8 4-4.8 4z"/>',
        '<path d="M12 21.5v-10"/><path d="M12 11.5c-3.2-2.2-3.2-6 0-9 3.2 3 3.2 6.8 0 9z"/><path d="M12 17.5c0-2.4-1.8-4-4.8-4 0 2.4 1.8 4 4.8 4z"/>',
        '<path d="M12 21.5v-8"/><path d="M7 4.5c0 5.5 2 9 5 9s5-3.5 5-9l-2.5 2.5L12 4 9.5 7z"/><path d="M12 18.5c0-2.4 1.8-4 4.8-4 0 2.4-1.8 4-4.8 4z"/>',
        '<circle cx="12" cy="9" r="1.8"/><circle cx="12" cy="4.4" r="2.2"/><circle cx="16.4" cy="7.6" r="2.2"/><circle cx="14.7" cy="12.7" r="2.2"/><circle cx="9.3" cy="12.7" r="2.2"/><circle cx="7.6" cy="7.6" r="2.2"/><path d="M12 15.5v6"/>',
        '<circle cx="12" cy="9.5" r="2.4"/><path d="M12 3v2.4M16.1 9.5h2.4M5.5 9.5h2.4M14.9 6.6l1.7-1.7M9.1 6.6L7.4 4.9M14.9 12.4l1.7 1.7M9.1 12.4l-1.7 1.7M12 13.6v7.9"/>',
        '<circle cx="8" cy="7.5" r="3.2"/><circle cx="16.5" cy="11" r="3.2"/><path d="M8 7.5h.01M16.5 11h.01M8 10.7v10.8M16.5 14.2v7.3"/>',
        '<circle cx="12" cy="9.5" r="6.5"/><path d="M12 6.5a3 3 0 1 0 3 3"/><path d="M12 9.5h.01M12 16v5.5"/>',
        '<path d="M6.5 20a4 4 0 0 1-.6-7.9 5 5 0 0 1 9.6-1.9A4.9 4.9 0 0 1 17.5 20z"/><path d="M9 14.5h.01M13 11.5h.01M15 16h.01"/>',
        '<circle cx="12" cy="9" r="6.2"/><path d="M12 15.2v6.3M9 21.5h6M12 12.5l2.6-2.6"/>',
        '<path d="M4 8l4 4.5L12 6l4 6.5L20 8l-1.5 10h-13z"/><path d="M6 21h12"/>'
    ];
    const STONE_ICON = '<path d="M4.5 17l2-7.5 5-4 6.5 2.5 1.5 6.5-3 4.5H7.5z"/><path d="M11.5 5.5l1 5.5 5.5 3.5"/>';
    const SHADES = 13;

    const byId = (id) => document.getElementById(id);
    const root = byId('game');
    const play = document.querySelector('.play');
    const board = byId('board');
    const tilesBox = byId('tiles');
    const againButton = byId('again-btn');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

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

    const loadJson = (key) => {
        try {
            return JSON.parse(load(key));
        } catch {
            return null;
        }
    };

    const loadBest = () => {
        const saved = loadJson('best') || {};
        const entry = (size) => ({ score: Number(saved[size]?.score) || 0, stage: Number(saved[size]?.stage) || 0 });
        return { 4: entry(4), 5: entry(5) };
    };

    // A saved garden is only used when it has the right shape and still has a move left.
    const loadGame = (wanted) => {
        const saved = loadJson(`game.${wanted}`);
        const valid = saved && saved.size === wanted && Array.isArray(saved.cells)
            && saved.cells.length === wanted * wanted && saved.cells.every(Number.isInteger);
        return valid && canMove(saved) ? saved : null;
    };

    const best = loadBest();
    let size = GARDENS[load('size')] ? Number(load('size')) : 4;
    let game = null;
    let tiles = [];
    let busy = false;
    let queue = [];
    let swipe = null;
    // The best score on this size when the garden was opened, to tell whether this garden beat it.
    let bestAtStart = 0;
    let endReadyAt = 0;

    const face = (value) => {
        if (value === STONE) return `<div class="face"><svg viewBox="0 0 24 24" aria-hidden="true">${STONE_ICON}</svg></div>`;
        const icon = ICONS[Math.min(value, ICONS.length) - 1];
        return `<div class="face"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><b>${value}</b></div>`;
    };

    const tileClass = (value) => (value === STONE ? 'tile stone' : `tile s${((value - 1) % SHADES) + 1}`);

    const place = (tile, index) => {
        tile.style.setProperty('--x', index % size);
        tile.style.setProperty('--y', Math.floor(index / size));
    };

    const makeTile = (value, index, effect) => {
        const tile = document.createElement('div');
        tile.className = `${tileClass(value)} ${effect}`.trim();
        tile.innerHTML = face(value);
        place(tile, index);
        return tile;
    };

    // Rebuilds every tile from the game state. Cleared stones are drawn once more so they can crumble away.
    const drawTiles = (effects = {}, cleared = []) => {
        tiles = game.cells.map((value, index) => (value === 0 ? null : makeTile(value, index, effects[index] || '')));
        const ghosts = cleared.map((index) => makeTile(STONE, index, 'crumble'));
        tilesBox.replaceChildren(...ghosts, ...tiles.filter(Boolean));
    };

    const showCounts = () => {
        byId('score').textContent = game.score;
        byId('best').textContent = best[size].score;
        byId('top').textContent = game.top;
    };

    const persist = () => {
        save(`game.${size}`, JSON.stringify(game));
        const record = best[size];
        if (game.score > record.score || game.top > record.stage) {
            record.score = Math.max(record.score, game.score);
            record.stage = Math.max(record.stage, game.top);
            save('best', JSON.stringify(best));
        }
    };

    const setState = (state) => {
        root.dataset.state = state;
        play.inert = state === 'goal' || state === 'over';
    };

    const showStart = () => {
        document.querySelectorAll('.size').forEach((button) => {
            button.setAttribute('aria-pressed', String(Number(button.dataset.size) === size));
        });
        const record = best[size];
        byId('start-best').textContent = record.score
            ? `Best on ${size} x ${size}: ${record.score} points, stage ${record.stage}.`
            : `No best score on ${size} x ${size} yet.`;
        byId('start-btn').textContent = loadGame(size) ? 'Continue garden' : 'Start';
        setState('ready');
    };

    const openGarden = (fresh) => {
        game = (!fresh && loadGame(size)) || create(size);
        bestAtStart = best[size].score;
        busy = false;
        queue = [];
        root.style.setProperty('--n', size);
        byId('plots').replaceChildren(...game.cells.map(() => document.createElement('div')));
        byId('goal').textContent = ` / ${GARDENS[size].goal}`;
        drawTiles();
        persist();
        showCounts();
        byId('status').textContent = `Garden ready. Goal: stage ${GARDENS[size].goal}.`;
        setState('playing');
    };

    const showEnd = (state) => {
        const goal = state === 'goal';
        byId('end-badge').hidden = !(bestAtStart > 0 && game.score > bestAtStart);
        byId('end-title').textContent = goal ? `Stage ${GARDENS[size].goal} in bloom` : 'The garden is full';
        byId('end-note').textContent = goal
            ? 'You reached the goal. Keep going and see how far the garden grows.'
            : 'No slide can move or merge anything.';
        byId('end-score').textContent = game.score;
        byId('end-best').textContent = best[size].score;
        byId('end-top').textContent = game.top;
        againButton.textContent = goal ? 'Keep going' : 'Play again';
        byId('end-other-btn').textContent = goal ? 'New garden' : 'Undo last move';
        byId('status').textContent = byId('end-title').textContent;
        endReadyAt = performance.now() + END_DELAY;
        setState(state);
        setTimeout(() => {
            if (root.dataset.state === state) againButton.focus();
        }, END_DELAY);
    };

    // A slide that changes nothing gives the board a small push toward the wall.
    const nudge = (dir) => {
        if (reducedMotion.matches) return;
        board.classList.remove('nudge-left', 'nudge-right', 'nudge-up', 'nudge-down');
        // Reading the size restarts the animation when the class goes straight back on.
        board.getBoundingClientRect();
        board.classList.add(`nudge-${dir}`);
    };

    const slideTo = (dir) => {
        if (root.dataset.state !== 'playing') return;
        if (busy) {
            if (queue.length < QUEUE_MAX) queue.push(dir);
            return;
        }
        const topBefore = game.top;
        const result = move(game, dir);
        if (!result) {
            nudge(dir);
            return;
        }
        persist();
        showCounts();
        if (result.gained) byId('status').textContent = `Plus ${result.gained}. Score ${game.score}.`;
        result.slides.forEach(({ from, to }) => place(tiles[from], to));
        busy = true;
        setTimeout(() => {
            const effects = {};
            result.merges.forEach((merge) => {
                effects[merge.at] = 'pop';
            });
            if (result.spawned) effects[result.spawned.at] = 'appear';
            drawTiles(effects, result.cleared);
            busy = false;
            const goal = GARDENS[size].goal;
            if (topBefore < goal && game.top >= goal) {
                queue = [];
                showEnd('goal');
            } else if (!canMove(game)) {
                queue = [];
                showEnd('over');
            } else if (queue.length) {
                slideTo(queue.shift());
            }
        }, reducedMotion.matches ? 0 : SLIDE_MS);
    };

    const undoMove = () => {
        const state = root.dataset.state;
        if ((state !== 'playing' && state !== 'over') || busy || !undo(game)) return;
        queue = [];
        drawTiles();
        persist();
        showCounts();
        byId('status').textContent = 'Move undone.';
        setState('playing');
    };

    const keepGoing = () => {
        setState('playing');
        if (!canMove(game)) showEnd('over');
    };

    const primaryEndAction = () => {
        if (root.dataset.state === 'goal') keepGoing();
        else openGarden(true);
    };

    byId('start-btn').addEventListener('click', () => openGarden(false));
    byId('new-btn').addEventListener('click', () => openGarden(true));
    byId('undo-btn').addEventListener('click', undoMove);
    byId('menu-btn').addEventListener('click', showStart);
    byId('end-menu-btn').addEventListener('click', showStart);
    againButton.addEventListener('click', primaryEndAction);
    byId('end-other-btn').addEventListener('click', () => {
        if (root.dataset.state === 'goal') openGarden(true);
        else undoMove();
    });

    document.querySelectorAll('.size').forEach((button) => {
        button.addEventListener('click', () => {
            size = Number(button.dataset.size);
            save('size', String(size));
            showStart();
        });
    });

    // Slides fire as the finger moves, from anywhere on the play screen, so one touch can chain several.
    play.addEventListener('pointerdown', (event) => {
        if (root.dataset.state !== 'playing' || event.target.closest('button, a')) return;
        event.preventDefault();
        swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, last: null };
        play.setPointerCapture(event.pointerId);
    });

    play.addEventListener('pointermove', (event) => {
        if (!swipe || event.pointerId !== swipe.id) return;
        const dx = event.clientX - swipe.x;
        const dy = event.clientY - swipe.y;
        const name = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        if (Math.max(Math.abs(dx), Math.abs(dy)) < (name === swipe.last ? SWIPE_REPEAT : SWIPE_MIN)) return;
        slideTo(name);
        swipe = { id: swipe.id, x: event.clientX, y: event.clientY, last: name };
    });

    const endSwipe = (event) => {
        if (swipe && event.pointerId === swipe.id) swipe = null;
    };

    play.addEventListener('pointerup', endSwipe);
    play.addEventListener('pointercancel', endSwipe);

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const state = root.dataset.state;
        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        const confirm = key === 'Enter' || key === ' ';
        const onControl = event.target.closest('button, a') !== null;

        if (state === 'playing') {
            if (KEYS[key]) {
                event.preventDefault();
                slideTo(KEYS[key]);
            } else if (key === 'z') {
                undoMove();
            }
        } else if (state === 'ready') {
            if (confirm && !onControl) {
                event.preventDefault();
                openGarden(false);
            }
        } else if (confirm && (performance.now() < endReadyAt || !onControl)) {
            event.preventDefault();
            if (performance.now() >= endReadyAt) primaryEndAction();
        }
    });

    byId('demo').innerHTML = `<div class="${tileClass(1)}">${face(1)}</div><span>+</span><div class="${tileClass(1)}">${face(1)}</div>`
        + `<span>=</span><div class="${tileClass(2)}">${face(2)}</div>`;

    showStart();
})();
