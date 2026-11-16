(() => {
    const { ICE, ROCK, DIRS, generate, slide } = window.IceLevels;

    const STORE = 'arcade.ice-trail.';
    const STEP_MS = 55;
    const SWIPE_MIN = 24;
    const QUEUE_MAX = 2;
    // The win screen waits this long before it takes input, so the key that made the last move cannot dismiss it.
    const END_DELAY = 600;
    const KEYS = {
        ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', ArrowLeft: 'left',
        w: 'up', d: 'right', s: 'down', a: 'left'
    };

    const byId = (id) => document.getElementById(id);
    const root = byId('game');
    const play = document.querySelector('.play');
    const board = byId('board');
    const stage = byId('stage');
    const nextButton = byId('next-btn');
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

    const loadFewest = () => {
        try {
            const parsed = JSON.parse(load('fewest'));
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    };

    const formatTime = (ms) => {
        const seconds = Math.floor(ms / 1000);
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };

    // highest is the furthest level unlocked, picked is the one shown on the start screen.
    let highest = Math.max(1, Math.floor(Number(load('level'))) || 1);
    let picked = highest;
    const fewest = loadFewest();

    let level = null;
    let cells = [];
    let token = null;
    let marked = [];
    let position = 0;
    let moves = 0;
    let undoStack = [];
    let queue = [];
    let sliding = false;
    let slideTimer = 0;
    let swipeFrom = null;
    let endReadyAt = 0;

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

    const isIce = (index) => level.cells[index] === ICE;
    const iceLeft = () => level.iceCount - marked.filter(Boolean).length;

    const placeToken = (duration) => {
        token.style.transitionDuration = `${duration}ms`;
        token.style.transform = `translate(${(position % level.cols) * 100}%, ${Math.floor(position / level.cols) * 100}%)`;
    };

    const showCounts = () => {
        const left = iceLeft();
        byId('moves').textContent = moves;
        byId('left').textContent = left;
        byId('status').textContent = left === 1 ? '1 tile left' : `${left} tiles left`;
    };

    const showTime = () => {
        byId('time').textContent = formatTime(elapsed());
    };

    const resetLevel = () => {
        marked = level.cells.map(() => false);
        marked[level.start] = true;
        position = level.start;
        moves = 0;
        undoStack = [];
        queue = [];
        sliding = false;
        clearTimeout(slideTimer);
        board.classList.remove('cleared');
        cells.forEach((cell, index) => {
            cell.style.transitionDelay = '0ms';
            cell.classList.toggle('marked', marked[index]);
        });
        placeToken(0);
        showCounts();
        banked = 0;
        runningSince = null;
        runClock();
        showTime();
    };

    const startLevel = (number) => {
        level = generate(number);
        board.style.setProperty('--cols', level.cols);
        board.style.setProperty('--rows', level.rows);
        cells = level.cells.map((kind) => {
            const cell = document.createElement('div');
            let name = 'wall';
            if (kind === ICE) name = 'ice';
            else if (kind === ROCK) name = 'rock';
            cell.className = `cell ${name}`;
            return cell;
        });
        token = document.createElement('div');
        token.className = 'token';
        board.replaceChildren(...cells, token);
        byId('level').textContent = number;
        setState('playing');
        resetLevel();
    };

    const showStart = () => {
        stopClock();
        byId('pick-level').textContent = picked;
        byId('start-btn').textContent = `Play level ${picked}`;
        byId('level-down').disabled = picked <= 1;
        byId('level-up').disabled = picked >= highest;
        const record = fewest[picked];
        byId('reach').textContent = `Highest level reached: ${highest}.`
            + (record ? ` Fewest moves on level ${picked}: ${record}.` : '');
        setState('ready');
    };

    const pickLevel = (number) => {
        picked = Math.min(highest, Math.max(1, number));
        showStart();
    };

    const win = () => {
        stopClock();
        board.classList.add('cleared');
        const number = level.level;
        const previous = fewest[number];
        const isRecord = !previous || moves < previous;
        if (isRecord) {
            fewest[number] = moves;
            save('fewest', JSON.stringify(fewest));
        }
        if (number + 1 > highest) {
            highest = number + 1;
            save('level', String(highest));
        }
        picked = number + 1;

        byId('end-badge').hidden = !(previous && isRecord);
        byId('end-title').textContent = `Level ${number} cleared`;
        byId('end-note').textContent = `Highest level reached: ${highest}.`;
        byId('end-moves').textContent = moves;
        byId('end-time').textContent = formatTime(elapsed());
        byId('end-best').textContent = fewest[number];

        endReadyAt = performance.now() + END_DELAY;
        setState('over');
        setTimeout(() => {
            if (root.dataset.state === 'over') nextButton.focus();
        }, END_DELAY);
    };

    // A blocked slide nudges the token toward the wall and flashes it.
    const bump = (dir) => {
        byId('status').textContent = `Blocked: cannot slide ${dir.name}`;
        if (reducedMotion.matches) return;
        token.style.setProperty('--bump-x', dir.dc);
        token.style.setProperty('--bump-y', dir.dr);
        token.classList.remove('bump');
        // Reading the size restarts the animation when the class goes straight back on.
        token.getBoundingClientRect();
        token.classList.add('bump');
    };

    const move = (name) => {
        if (root.dataset.state !== 'playing') return;
        if (sliding) {
            if (queue.length < QUEUE_MAX) queue.push(name);
            return;
        }
        const dir = DIRS.find((entry) => entry.name === name);
        const path = slide(level.cols, level.rows, position, dir, isIce);
        if (!path.length) {
            bump(dir);
            return;
        }
        const stepMs = reducedMotion.matches ? 0 : STEP_MS;
        const fresh = path.filter((index) => !marked[index]);
        undoStack.push({ from: position, fresh });
        path.forEach((index, step) => {
            if (marked[index]) return;
            marked[index] = true;
            cells[index].style.transitionDelay = `${step * stepMs}ms`;
            cells[index].classList.add('marked');
        });
        position = path[path.length - 1];
        moves++;
        token.classList.remove('bump');
        placeToken(path.length * stepMs);
        showCounts();

        sliding = true;
        slideTimer = setTimeout(() => {
            sliding = false;
            if (iceLeft() === 0) win();
            else if (queue.length) move(queue.shift());
        }, path.length * stepMs);
    };

    const undo = () => {
        if (root.dataset.state !== 'playing' || sliding || !undoStack.length) return;
        const last = undoStack.pop();
        last.fresh.forEach((index) => {
            marked[index] = false;
            cells[index].style.transitionDelay = '0ms';
            cells[index].classList.remove('marked');
        });
        position = last.from;
        moves--;
        placeToken(reducedMotion.matches ? 0 : 90);
        showCounts();
    };

    const restart = () => {
        if (root.dataset.state === 'playing') resetLevel();
    };

    document.querySelectorAll('.arrow').forEach((button) => {
        button.addEventListener('click', () => move(button.dataset.dir));
    });

    byId('undo-btn').addEventListener('click', undo);
    byId('restart-btn').addEventListener('click', restart);
    byId('levels-btn').addEventListener('click', showStart);
    byId('end-levels-btn').addEventListener('click', showStart);
    byId('level-down').addEventListener('click', () => pickLevel(picked - 1));
    byId('level-up').addEventListener('click', () => pickLevel(picked + 1));
    byId('start-btn').addEventListener('click', () => startLevel(picked));
    byId('again-btn').addEventListener('click', () => startLevel(level.level));
    nextButton.addEventListener('click', () => startLevel(level.level + 1));

    stage.addEventListener('pointerdown', (event) => {
        swipeFrom = { x: event.clientX, y: event.clientY };
    });

    stage.addEventListener('pointerup', (event) => {
        if (!swipeFrom) return;
        const dx = event.clientX - swipeFrom.x;
        const dy = event.clientY - swipeFrom.y;
        swipeFrom = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
        if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
        else move(dy > 0 ? 'down' : 'up');
    });

    stage.addEventListener('pointercancel', () => {
        swipeFrom = null;
    });

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const state = root.dataset.state;
        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        const confirm = key === 'Enter' || key === ' ';
        const onControl = event.target.closest('button, a') !== null;

        if (state === 'playing') {
            if (KEYS[key]) {
                event.preventDefault();
                if (!event.repeat) move(KEYS[key]);
            } else if (key === 'z') {
                undo();
            } else if (key === 'r') {
                restart();
            }
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

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopClock();
        else if (root.dataset.state === 'playing') runClock();
    });

    setInterval(() => {
        if (root.dataset.state === 'playing') showTime();
    }, 250);

    showStart();
})();
