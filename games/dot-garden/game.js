(() => {
    const { generate } = window.GardenLevels;

    const STORE = 'arcade.dot-garden.';
    const SVG_NS = 'http://www.w3.org/2000/svg';
    // The win screen waits this long before it takes input, so the key that made the last move cannot dismiss it.
    const END_DELAY = 650;
    const ARROWS = { ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowDown: [1, 0], ArrowLeft: [0, -1] };

    // One line shape per pair, drawn in a 24 by 24 box.
    const GLYPHS = [
        { name: 'tulip', art: '<path d="M12 21v-7"/><path d="M7 5l2.5 3L12 4l2.5 4L17 5v4a5 5 0 0 1-10 0z"/>' },
        { name: 'leaf', art: '<path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14z"/><path d="M5 19l8-8"/>' },
        { name: 'daisy', art: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2.1 2.1M15.9 15.9L18 18M18 6l-2.1 2.1M8.1 15.9L6 18"/>' },
        { name: 'clover', art: '<circle cx="12" cy="7.5" r="3.2"/><circle cx="7.6" cy="13.5" r="3.2"/><circle cx="16.4" cy="13.5" r="3.2"/><path d="M12 14v6.5"/>' },
        { name: 'bud', art: '<path d="M12 3.5c4 4.2 6 7.4 6 10.5a6 6 0 0 1-12 0c0-3.1 2-6.3 6-10.5z"/>' },
        { name: 'sprout', art: '<path d="M12 20.5V11"/><path d="M12 12c0-4-3-6.5-7.5-6.5 0 4 3 6.5 7.5 6.5z"/><path d="M12 14c0-3 2.5-5 7-5 0 3-2.5 5-7 5z"/>' },
        { name: 'mushroom', art: '<path d="M4.5 12a7.5 7.5 0 0 1 15 0z"/><path d="M10 12v6a2 2 0 0 0 4 0v-6"/>' },
        { name: 'star', art: '<path d="M12 3.5l2.5 5.3 5.8.7-4.3 4 1.1 5.7-5.1-2.8-5.1 2.8 1.1-5.7-4.3-4 5.8-.7z"/>' },
        { name: 'seed', art: '<path d="M12 3.5l7 8.5-7 8.5-7-8.5z"/><path d="M12 9.5v5"/>' }
    ];

    const byId = (id) => document.getElementById(id);
    const root = byId('game');
    const play = document.querySelector('.play');
    const board = byId('board');
    const chips = byId('chips');
    const status = byId('status');
    const nextButton = byId('next-btn');

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

    const loadBestTimes = () => {
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

    const svg = (tag, attributes = {}) => {
        const element = document.createElementNS(SVG_NS, tag);
        Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
        return element;
    };

    // highest is the furthest level unlocked, picked is the one shown on the start screen.
    let highest = Math.max(1, Math.floor(Number(load('level'))) || 1);
    let picked = highest;
    const bestTimes = loadBestTimes();

    let level = null;
    let size = 0;
    let flowerAt = [];
    let trails = [];
    let owner = [];
    let active = -1;
    let keyboardHold = false;
    let mayRestart = false;
    let cursor = 0;
    let moves = 0;
    let before = '';
    let lastPointerCell = -1;
    let endReadyAt = 0;

    let plots = [];
    let lines = [];
    let flowers = [];
    let chipItems = [];
    let cursorBox = null;

    // Play time only counts while the tab is visible.
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

    const setState = (state) => {
        root.dataset.state = state;
        play.inert = state === 'over';
    };

    const isLinked = (pair) => {
        const trail = trails[pair];
        return trail.length > 1 && flowerAt[trail[trail.length - 1]] === pair;
    };

    const claimCells = () => {
        owner.fill(-1);
        trails.forEach((trail, pair) => trail.forEach((cell) => { owner[cell] = pair; }));
    };

    const point = (cell) => `${(cell % size) + 0.5},${Math.floor(cell / size) + 0.5}`;

    const render = () => {
        const linked = trails.filter((trail, pair) => isLinked(pair)).length;
        const filled = owner.filter((pair) => pair >= 0 && trails[pair].length > 1).length;
        const bare = owner.length - filled;

        plots.forEach((plot, cell) => {
            const pair = owner[cell];
            if (pair >= 0 && trails[pair].length > 1) plot.dataset.pair = pair;
            else delete plot.dataset.pair;
        });
        lines.forEach((line, pair) => {
            line.setAttribute('points', trails[pair].length > 1 ? trails[pair].map(point).join(' ') : '');
            line.classList.toggle('held', pair === active);
        });
        flowers.forEach((flower) => flower.classList.toggle('linked', isLinked(Number(flower.dataset.pair))));
        chipItems.forEach((chip, pair) => {
            chip.classList.toggle('linked', isLinked(pair));
            chip.setAttribute('aria-label', `${GLYPHS[pair].name}: ${isLinked(pair) ? 'linked' : 'not linked'}`);
        });
        cursorBox.setAttribute('x', (cursor % size) + 0.04);
        cursorBox.setAttribute('y', Math.floor(cursor / size) + 0.04);
        cursorBox.classList.toggle('holding', keyboardHold);

        byId('pairs').textContent = `${linked}/${trails.length}`;
        byId('filled').textContent = `${Math.floor((filled / owner.length) * 100)}%`;
        byId('moves').textContent = moves;

        const allLinkedButBare = linked === trails.length && bare > 0;
        status.classList.toggle('warn', allLinkedButBare);
        if (keyboardHold) {
            status.textContent = 'Drawing: arrows extend the path, Space or Enter drops it.';
        } else if (allLinkedButBare) {
            status.textContent = `Every pair is linked, but ${bare} ${bare === 1 ? 'plot is' : 'plots are'} still bare.`;
        } else if (linked === 0 && filled === 0) {
            status.textContent = 'Drag from a flower to its match.';
        } else {
            status.textContent = `${linked} of ${trails.length} pairs linked, ${bare} ${bare === 1 ? 'plot' : 'plots'} to fill.`;
        }
        return linked === trails.length && bare === 0;
    };

    const showTime = () => {
        byId('time').textContent = formatTime(elapsed());
    };

    const buildBoard = () => {
        board.setAttribute('viewBox', `0 0 ${size} ${size}`);
        board.classList.remove('bloom', 'keys');
        plots = flowerAt.map((pair, cell) => svg('rect', {
            class: 'plot', x: (cell % size) + 0.04, y: Math.floor(cell / size) + 0.04, width: 0.92, height: 0.92, rx: 0.13
        }));
        lines = level.paths.map((path, pair) => svg('polyline', { class: 'trail', 'data-pair': pair }));
        flowers = [];
        level.paths.forEach((path, pair) => {
            [path[0], path[path.length - 1]].forEach((cell) => {
                const flower = svg('g', {
                    class: 'flower', 'data-pair': pair,
                    transform: `translate(${(cell % size) + 0.5} ${Math.floor(cell / size) + 0.5})`
                });
                flower.dataset.cell = cell;
                flower.innerHTML = `<circle r="0.37"/><g transform="translate(-0.27 -0.27) scale(0.0225)">${GLYPHS[pair].art}</g>`;
                flowers.push(flower);
            });
        });
        cursorBox = svg('rect', { class: 'cursor', width: 0.92, height: 0.92, rx: 0.13 });
        board.replaceChildren(...plots, ...lines, ...flowers, cursorBox);

        chipItems = level.paths.map((path, pair) => {
            const chip = document.createElement('li');
            chip.className = 'chip';
            chip.dataset.pair = pair;
            chip.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[pair].art}</svg>`;
            return chip;
        });
        chips.replaceChildren(...chipItems);
    };

    const resetLevel = () => {
        trails = level.paths.map(() => []);
        owner = new Array(size * size).fill(-1);
        active = -1;
        keyboardHold = false;
        moves = 0;
        cursor = level.paths[0][0];
        board.classList.remove('bloom');
        render();
        banked = 0;
        runningSince = null;
        runClock();
        showTime();
    };

    const startLevel = (number) => {
        level = generate(number);
        size = level.size;
        flowerAt = new Array(size * size).fill(-1);
        level.paths.forEach((path, pair) => {
            flowerAt[path[0]] = pair;
            flowerAt[path[path.length - 1]] = pair;
        });
        buildBoard();
        byId('level').textContent = number;
        setState('playing');
        resetLevel();
    };

    const showStart = () => {
        stopClock();
        const preview = generate(picked);
        byId('pick-level').textContent = picked;
        byId('pick-size').textContent = `${preview.size} x ${preview.size}, ${preview.paths.length} pairs`;
        byId('start-btn').textContent = `Play level ${picked}`;
        byId('level-down').disabled = picked <= 1;
        byId('level-up').disabled = picked >= highest;
        const best = bestTimes[picked];
        byId('reach').textContent = `Highest level reached: ${highest}.`
            + (best ? ` Best time on level ${picked}: ${formatTime(best)}.` : '');
        setState('ready');
    };

    const pickLevel = (number) => {
        picked = Math.min(highest, Math.max(1, number));
        showStart();
    };

    const win = () => {
        stopClock();
        const number = level.level;
        const time = Math.round(elapsed());
        const previous = bestTimes[number];
        const isBest = !previous || time < previous;
        if (isBest) {
            bestTimes[number] = time;
            save('best', JSON.stringify(bestTimes));
        }
        if (number + 1 > highest) {
            highest = number + 1;
            save('level', String(highest));
        }
        picked = number + 1;

        board.classList.add('bloom');
        byId('end-badge').hidden = !(previous && isBest);
        byId('end-note').textContent = `Level ${number} complete. Highest level reached: ${highest}.`;
        byId('end-time').textContent = formatTime(time);
        byId('end-moves').textContent = moves;
        byId('end-best').textContent = formatTime(bestTimes[number]);

        endReadyAt = performance.now() + END_DELAY;
        setState('over');
        setTimeout(() => {
            if (root.dataset.state === 'over') nextButton.focus();
        }, END_DELAY);
    };

    // Picks up a path at any of its cells and keeps it up to there. Picking up the flower an unfinished path
    // grows from, or a flower with no path, starts that pair over from the flower.
    const pickUp = (cell) => {
        const flower = flowerAt[cell];
        const pair = flower >= 0 ? flower : owner[cell];
        if (pair < 0) return false;
        before = JSON.stringify(trails);
        const trail = trails[pair];
        // A linked path can be held by either flower, so make the held one its end.
        if (isLinked(pair) && trail[0] === cell) trail.reverse();
        const at = trail.indexOf(cell);
        if (at > 0) trail.length = at + 1;
        else trails[pair] = [cell];
        active = pair;
        mayRestart = isLinked(pair);
        claimCells();
        render();
        return true;
    };

    const refuse = (cell) => {
        const flower = flowers.find((entry) => Number(entry.dataset.cell) === cell);
        flower.classList.add('refused');
        setTimeout(() => flower.classList.remove('refused'), 300);
    };

    // Moves the held path end into a neighboring cell. Returns false when the step is not allowed.
    const step = (cell) => {
        const trail = trails[active];
        const at = trail.indexOf(cell);
        if (at >= 0) {
            trail.length = at + 1;
        } else {
            const flower = flowerAt[cell];
            if (flower >= 0 && flower !== active) {
                refuse(cell);
                return false;
            }
            if (isLinked(active)) {
                // A path stops at its match. Only a linked path that was just picked up by its end flower
                // may leave it, and that starts the pair over from that flower.
                if (!mayRestart) return false;
                trail.splice(0, trail.length - 1);
            }
            const other = owner[cell];
            if (other >= 0) {
                // Drawing over another path cuts it back to just before this cell.
                const cut = trails[other];
                cut.length = cut.indexOf(cell);
                if (cut.length < 2) cut.length = 0;
            }
            trail.push(cell);
        }
        mayRestart = false;
        claimCells();
        return true;
    };

    // Follows the pointer one cell at a time, so a fast drag cannot skip cells.
    const drawToward = (target) => {
        const trail = trails[active];
        if (trail.includes(target)) {
            step(target);
        } else {
            for (let guard = size * 2; guard > 0; guard--) {
                const end = trail[trail.length - 1];
                if (end === target) break;
                const rowGap = Math.floor(target / size) - Math.floor(end / size);
                const colGap = (target % size) - (end % size);
                const next = Math.abs(colGap) >= Math.abs(rowGap) ? end + Math.sign(colGap) : end + Math.sign(rowGap) * size;
                if (!step(next)) break;
            }
        }
        render();
    };

    const drop = () => {
        if (active < 0) return;
        if (trails[active].length < 2) trails[active] = [];
        active = -1;
        keyboardHold = false;
        claimCells();
        if (JSON.stringify(trails) !== before) moves++;
        if (render()) win();
    };

    const cellAt = (event) => {
        const box = board.getBoundingClientRect();
        const col = Math.min(size - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * size)));
        const row = Math.min(size - 1, Math.max(0, Math.floor(((event.clientY - box.top) / box.height) * size)));
        return row * size + col;
    };

    board.addEventListener('pointerdown', (event) => {
        if (root.dataset.state !== 'playing' || !event.isPrimary) return;
        event.preventDefault();
        board.classList.remove('keys');
        drop();
        if (root.dataset.state !== 'playing') return;
        const cell = cellAt(event);
        if (pickUp(cell)) {
            cursor = cell;
            lastPointerCell = cell;
            board.setPointerCapture(event.pointerId);
        }
    });

    board.addEventListener('pointermove', (event) => {
        if (active < 0 || keyboardHold) return;
        const cell = cellAt(event);
        if (cell === lastPointerCell) return;
        lastPointerCell = cell;
        drawToward(cell);
    });

    const endPointerDrag = () => {
        if (!keyboardHold) drop();
    };
    board.addEventListener('pointerup', endPointerDrag);
    board.addEventListener('pointercancel', endPointerDrag);

    const handlePlayKey = (event, key, confirm, onControl) => {
        // Keys wait while a pointer drag is in progress.
        if (active >= 0 && !keyboardHold) return;
        if (ARROWS[key]) {
            event.preventDefault();
            board.classList.add('keys');
            const [rowStep, colStep] = ARROWS[key];
            const row = Math.floor(cursor / size) + rowStep;
            const col = (cursor % size) + colStep;
            if (row < 0 || col < 0 || row >= size || col >= size) return;
            const next = row * size + col;
            if (!keyboardHold) {
                cursor = next;
                render();
            } else if (step(next)) {
                cursor = next;
                if (isLinked(active)) drop();
                else render();
            }
        } else if (confirm && !onControl) {
            event.preventDefault();
            board.classList.add('keys');
            if (keyboardHold) {
                drop();
            } else if (pickUp(cursor)) {
                keyboardHold = true;
                render();
            } else {
                status.textContent = 'Nothing to pick up here. Move to a flower or a path.';
            }
        } else if (key === 'Escape' && keyboardHold) {
            drop();
        } else if (key === 'r') {
            resetLevel();
        }
    };

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const state = root.dataset.state;
        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        const confirm = key === 'Enter' || key === ' ';
        const onControl = event.target.closest('button, a') !== null;

        if (state === 'playing') {
            handlePlayKey(event, key, confirm, onControl);
        } else if (state === 'ready') {
            if (key === 'ArrowLeft' || key === 'ArrowRight') {
                event.preventDefault();
                pickLevel(picked + (key === 'ArrowRight' ? 1 : -1));
            } else if (confirm && !onControl) {
                event.preventDefault();
                startLevel(picked);
            }
        } else if (confirm && (performance.now() < endReadyAt || !onControl)) {
            event.preventDefault();
            if (performance.now() >= endReadyAt) startLevel(level.level + 1);
        }
    });

    byId('restart-btn').addEventListener('click', resetLevel);
    byId('levels-btn').addEventListener('click', showStart);
    byId('end-levels-btn').addEventListener('click', showStart);
    byId('level-down').addEventListener('click', () => pickLevel(picked - 1));
    byId('level-up').addEventListener('click', () => pickLevel(picked + 1));
    byId('start-btn').addEventListener('click', () => startLevel(picked));
    byId('again-btn').addEventListener('click', () => startLevel(level.level));
    nextButton.addEventListener('click', () => startLevel(level.level + 1));

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopClock();
        else if (root.dataset.state === 'playing') runClock();
    });

    setInterval(() => {
        if (root.dataset.state === 'playing') showTime();
    }, 250);

    showStart();
})();
