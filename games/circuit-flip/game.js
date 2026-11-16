(() => {
    const { DIRS, generate, rotate, wireCount, joined, flow } = window.CircuitLevels;

    const SIZES = [5, 7, 9];
    const STORE = 'arcade.circuit-flip.';
    const ARROWS = { ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowDown: [1, 0], ArrowLeft: [0, -1] };
    // The win screen waits this long before it takes input, so the key that made the last move cannot dismiss it.
    const END_DELAY = 650;

    const SOURCE_MARKUP = '<rect class="source" x="27" y="27" width="46" height="46" rx="10"/><path class="bolt" d="M54 33 41 53h9l-3 14 13-20h-9z"/>';
    const BULB_MARKUP = '<circle class="bulb-ring" cx="50" cy="50" r="30"/><circle class="bulb" cx="50" cy="50" r="21"/><path class="filament" d="M40 55l5-10 5 10 5-10 5 10"/>';

    const byId = (id) => document.getElementById(id);
    const root = byId('game');
    const play = document.querySelector('.play');
    const board = byId('board');
    const sizeButtons = [...document.querySelectorAll('.size')];
    const againButton = byId('again-btn');
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
            localStorage.setItem(STORE + key, String(value));
        } catch {
            // Storage is blocked: keep playing without saving.
        }
    };

    const bestFor = (size) => {
        const value = Number(load(`best.${size}`));
        return Number.isFinite(value) && value > 0 ? value : null;
    };

    const formatTime = (ms) => {
        const seconds = Math.floor(ms / 1000);
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };

    let size = SIZES.includes(Number(load('size'))) ? Number(load('size')) : SIZES[0];
    let puzzle = null;
    let cells = [];
    let turns = [];
    let moves = 0;
    let cursor = 0;
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

    const tileName = (index) => {
        if (index === puzzle.source) return 'power source';
        const mask = puzzle.start[index];
        const wires = wireCount(mask);
        if (wires === 1) return 'bulb';
        if (wires === 3) return 'T junction';
        return mask === 5 || mask === 10 ? 'straight wire' : 'corner wire';
    };

    const tileMarkup = (index) => {
        const wires = DIRS.filter((dir) => puzzle.start[index] & dir.bit)
            .map((dir) => `<line x1="50" y1="50" x2="${50 + dir.dc * 50}" y2="${50 + dir.dr * 50}"/>`)
            .join('');
        const leaks = DIRS
            .map((dir) => `<circle class="leak dot-${dir.name}" cx="${50 + dir.dc * 43}" cy="${50 + dir.dr * 43}" r="7"/>`)
            .join('');
        let node = '';
        if (index === puzzle.source) node = SOURCE_MARKUP;
        else if (puzzle.bulbs.includes(index)) node = BULB_MARKUP;
        return `<svg class="wires" viewBox="0 0 100 100" aria-hidden="true">${wires}</svg>`
            + `<svg viewBox="0 0 100 100" aria-hidden="true">${leaks}${node}</svg>`;
    };

    const buildBoard = () => {
        board.style.setProperty('--n', puzzle.size);
        cells = puzzle.start.map((mask, index) => {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'cell';
            cell.tabIndex = index === cursor ? 0 : -1;
            cell.dataset.index = index;
            cell.style.setProperty('--turns', 0);
            cell.setAttribute('aria-label',
                `Row ${Math.floor(index / puzzle.size) + 1}, column ${(index % puzzle.size) + 1}, ${tileName(index)}`);
            cell.innerHTML = tileMarkup(index);
            return cell;
        });
        board.replaceChildren(...cells);
    };

    // Recolors the board from the current rotations and returns true when every bulb is lit.
    const refresh = () => {
        const masks = puzzle.start.map((mask, index) => rotate(mask, turns[index]));
        const lit = flow(masks, puzzle.size, puzzle.source);
        cells.forEach((cell, index) => {
            cell.classList.toggle('lit', lit[index]);
            DIRS.forEach((dir) => {
                const loose = lit[index] && (masks[index] & dir.bit) !== 0 && joined(masks, puzzle.size, index, dir) < 0;
                cell.classList.toggle(`leak-${dir.name}`, loose);
            });
        });
        const litBulbs = puzzle.bulbs.filter((index) => lit[index]).length;
        byId('bulbs').textContent = `${litBulbs}/${puzzle.bulbs.length}`;
        byId('moves').textContent = moves;
        return litBulbs === puzzle.bulbs.length;
    };

    const showTime = () => {
        byId('time').textContent = formatTime(elapsed());
    };

    const startPuzzle = (seed) => {
        puzzle = generate(size, seed);
        turns = new Array(puzzle.start.length).fill(0);
        moves = 0;
        cursor = puzzle.source;
        buildBoard();
        refresh();
        const best = bestFor(size);
        byId('best').textContent = best === null ? 'None' : formatTime(best);
        byId('status').textContent = `Puzzle ${seed}, ${size} x ${size}`;
        banked = 0;
        runningSince = null;
        setState('playing');
        runClock();
        showTime();
    };

    const startNew = () => startPuzzle(10000 + Math.floor(Math.random() * 90000));

    const showStart = () => {
        stopClock();
        sizeButtons.forEach((button) => {
            const buttonSize = Number(button.dataset.size);
            const best = bestFor(buttonSize);
            button.setAttribute('aria-pressed', String(buttonSize === size));
            button.querySelector('[data-best]').textContent = best === null ? 'Unsolved' : `Best ${formatTime(best)}`;
        });
        setState('ready');
    };

    const win = () => {
        stopClock();
        const time = Math.round(elapsed());
        const previous = bestFor(size);
        const isBest = previous === null || time < previous;
        if (isBest) save(`best.${size}`, time);

        const nextSize = SIZES[(SIZES.indexOf(size) + 1) % SIZES.length];
        nextButton.dataset.size = nextSize;
        nextButton.textContent = nextSize > size ? `Next size: ${nextSize} x ${nextSize}` : `Back to ${nextSize} x ${nextSize}`;
        byId('end-badge').hidden = !isBest;
        byId('end-note').textContent = `All ${puzzle.bulbs.length} bulbs lit on the ${size} x ${size} board.`;
        byId('end-time').textContent = formatTime(time);
        byId('end-moves').textContent = moves;
        byId('end-best').textContent = formatTime(isBest ? time : previous);
        byId('best').textContent = byId('end-best').textContent;

        endReadyAt = performance.now() + END_DELAY;
        setState('over');
        setTimeout(() => {
            if (root.dataset.state === 'over') againButton.focus();
        }, END_DELAY);
    };

    const setCursor = (index) => {
        cells[cursor].tabIndex = -1;
        cursor = index;
        cells[cursor].tabIndex = 0;
    };

    const rotateTile = (index) => {
        if (root.dataset.state !== 'playing') return;
        turns[index]++;
        moves++;
        cells[index].style.setProperty('--turns', turns[index]);
        setCursor(index);
        if (refresh()) win();
    };

    const moveCursor = ([rowStep, colStep]) => {
        // The first arrow press only shows the cursor where it already is.
        if (document.activeElement === cells[cursor]) {
            const row = Math.min(puzzle.size - 1, Math.max(0, Math.floor(cursor / puzzle.size) + rowStep));
            const col = Math.min(puzzle.size - 1, Math.max(0, (cursor % puzzle.size) + colStep));
            setCursor(row * puzzle.size + col);
        }
        cells[cursor].focus();
    };

    const chooseSize = (newSize) => {
        size = newSize;
        save('size', size);
    };

    board.addEventListener('click', (event) => {
        const cell = event.target.closest('.cell');
        if (cell) rotateTile(Number(cell.dataset.index));
    });

    sizeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            chooseSize(Number(button.dataset.size));
            showStart();
        });
    });

    byId('start-btn').addEventListener('click', startNew);
    byId('new-btn').addEventListener('click', startNew);
    byId('restart-btn').addEventListener('click', () => startPuzzle(puzzle.seed));
    byId('sizes-btn').addEventListener('click', showStart);
    byId('end-sizes-btn').addEventListener('click', showStart);
    againButton.addEventListener('click', startNew);
    nextButton.addEventListener('click', () => {
        chooseSize(Number(nextButton.dataset.size));
        startNew();
    });

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const state = root.dataset.state;
        const confirm = event.key === 'Enter' || event.key === ' ';
        const onControl = event.target.closest('button, a') !== null;

        if (state === 'playing' && ARROWS[event.key]) {
            event.preventDefault();
            moveCursor(ARROWS[event.key]);
        } else if (state === 'playing' && confirm && !onControl) {
            event.preventDefault();
            cells[cursor].focus();
            rotateTile(cursor);
        } else if (state === 'over' && confirm && performance.now() < endReadyAt) {
            event.preventDefault();
        } else if (state !== 'playing' && confirm && !onControl) {
            event.preventDefault();
            startNew();
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
