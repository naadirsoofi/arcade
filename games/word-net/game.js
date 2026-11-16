(() => {
    const { COLS, ROWS, THEMES, pickWords, generate, lineCells, matchLine } = window.WordNetCore;
    const HINT_PENALTY_MS = 15000;
    const HINT_SHOW_MS = 1900;
    const MISS_SHOW_MS = 450;
    const TICK_MS = 250;
    // The end screen ignores input this long, so the last slide or key press cannot skip it.
    const END_GUARD_MS = 700;
    const KEY_BEST = 'arcade.word-net.best';
    const KEY_SETTINGS = 'arcade.word-net.settings';
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const UNIT = 10;
    const MARK_COLORS = ['#ffb199', '#8fd0ff', '#ffd966', '#8ee6b3', '#d0b3ff', '#ffaecb', '#7fded8', '#c3e384', '#b3c2ff', '#f7c08a'];
    const LEVELS = {
        easy: { name: 'Easy', note: 'Words run across and down.' },
        medium: { name: 'Medium', note: 'Words run across, down and diagonally.' },
        hard: { name: 'Hard', note: 'Words run in all eight directions, some backward.' }
    };
    // Compass steps in screen order, starting east and turning clockwise, as [row step, column step].
    const STEPS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
    const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

    const $ = (id) => document.getElementById(id);
    const app = $('app');
    const play = $('play');
    const gridEl = $('grid');
    const wordsEl = $('words');
    const msgEl = $('msg');
    const timeEl = $('time');
    const foundEl = $('found');
    const themeSelect = $('theme-select');
    const levelButtons = [...document.querySelectorAll('.level')];
    const screens = { ready: $('start-screen'), over: $('end-screen') };

    const load = (key, fallback) => {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch {
            return fallback;
        }
    };

    const save = (key, value) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch {
            // Storage is blocked: the game still works, it just forgets.
        }
    };

    const savedSettings = load(KEY_SETTINGS, {}) ?? {};
    const settings = {
        theme: THEMES.some((theme) => theme.id === savedSettings.theme) ? savedSettings.theme : 'random',
        level: savedSettings.level in LEVELS ? savedSettings.level : 'easy'
    };
    const best = { ...(load(KEY_BEST, {}) ?? {}) };

    let state = 'ready';
    let round = null;
    let cells = [];
    let marks = null;
    let liveLine = null;
    let anchor = null;
    let cursor = { row: 0, col: 0 };
    let drag = null;
    let ticker = 0;
    let lastTick = 0;
    let endedAt = 0;
    let hintTimer = 0;

    const formatTime = (ms) => {
        const seconds = Math.floor(ms / 1000);
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };

    const setState = (next) => {
        state = next;
        app.dataset.state = next;
        Object.entries(screens).forEach(([name, screen]) => { screen.hidden = name !== next; });
        play.inert = next !== 'playing';
    };

    const setMessage = (text, tone) => {
        msgEl.textContent = text;
        msgEl.className = `msg ${tone}`;
    };

    const sameCell = (a, b) => a.row === b.row && a.col === b.col;

    const makeLine = (from, to, className) => {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', from.col * UNIT + UNIT / 2);
        line.setAttribute('y1', from.row * UNIT + UNIT / 2);
        line.setAttribute('x2', to.col * UNIT + UNIT / 2);
        line.setAttribute('y2', to.row * UNIT + UNIT / 2);
        if (className) line.setAttribute('class', className);
        return line;
    };

    // Shows the line being picked: a live slide, or the stretch from the first picked letter to the key cursor.
    const renderSelection = () => {
        cells.flat().forEach((cell) => cell.classList.remove('anchor', 'cursor'));
        liveLine?.remove();
        liveLine = null;
        if (state !== 'playing') return;

        let from = null;
        let to = null;
        if (drag) {
            from = drag.start;
            to = drag.end;
        } else if (anchor) {
            from = anchor;
            to = gridEl.classList.contains('keys') && lineCells(anchor.row, anchor.col, cursor.row, cursor.col) ? cursor : anchor;
        }
        if (from) {
            cells[from.row][from.col].classList.add('anchor');
            if (!sameCell(from, to)) {
                liveLine = makeLine(from, to, 'live');
                marks.appendChild(liveLine);
            }
        }
        cells[cursor.row][cursor.col].classList.add('cursor');
    };

    const renderTime = () => {
        timeEl.textContent = formatTime(round.elapsed);
    };

    const tick = () => {
        const now = performance.now();
        if (!document.hidden) round.elapsed += Math.min(now - lastTick, 1000);
        lastTick = now;
        renderTime();
    };

    const stopClock = () => {
        clearInterval(ticker);
        clearTimeout(hintTimer);
    };

    const finish = () => {
        stopClock();
        const level = settings.level;
        const isBest = !(best[level] > 0) || round.elapsed < best[level];
        if (isBest) {
            best[level] = Math.round(round.elapsed);
            save(KEY_BEST, best);
        }
        $('end-time').textContent = formatTime(round.elapsed);
        $('end-theme').textContent = round.theme.name;
        $('end-hints').textContent = round.hints;
        $('end-best-label').textContent = `Best time on ${LEVELS[level].name}`;
        $('end-best').textContent = formatTime(best[level]);
        $('new-best').hidden = !isBest;
        endedAt = performance.now();
        setState('over');
        renderSelection();
        $('again-btn').focus();
    };

    const markFound = (entry, from, to) => {
        entry.found = true;
        entry.item.classList.add('found');
        entry.item.style.background = entry.color;
        const line = makeLine(from, to);
        line.setAttribute('stroke', entry.color);
        marks.insertBefore(line, marks.firstChild);
        const left = round.entries.filter((other) => !other.found).length;
        foundEl.textContent = `${round.entries.length - left}/${round.entries.length}`;
        setMessage(`Caught ${entry.word}`, 'good');
        if (left === 0) finish();
    };

    // Tries the line between two cells. Returns whether the cells lined up at all.
    const tryLine = (from, to) => {
        if (!lineCells(from.row, from.col, to.row, to.col)) return false;
        const remaining = round.entries.filter((entry) => !entry.found).map((entry) => entry.word);
        const word = matchLine(round.grid, from.row, from.col, to.row, to.col, remaining);
        if (word) {
            markFound(round.entries.find((entry) => entry.word === word), from, to);
        } else {
            const miss = makeLine(from, to, 'miss');
            marks.appendChild(miss);
            setTimeout(() => miss.remove(), MISS_SHOW_MS);
            setMessage('No listed word there', 'bad');
        }
        return true;
    };

    // Tap and key picking: the first pick marks a word's first letter, the second its last.
    const pickCell = (cell) => {
        if (!anchor) {
            anchor = cell;
            setMessage('Now pick the last letter', '');
        } else if (sameCell(anchor, cell)) {
            anchor = null;
            setMessage('', '');
        } else if (tryLine(anchor, cell)) {
            anchor = null;
        } else {
            anchor = cell;
        }
        renderSelection();
    };

    const pointerSpot = (event) => {
        const box = gridEl.getBoundingClientRect();
        return {
            x: ((event.clientX - box.left) / box.width) * COLS,
            y: ((event.clientY - box.top) / box.height) * ROWS
        };
    };

    const inside = (row, col) => row >= 0 && row < ROWS && col >= 0 && col < COLS;

    // Snaps the pointer to the nearest of the eight straight lines out of the start cell.
    const snapEnd = (start, spot) => {
        const rowGap = spot.y - (start.row + 0.5);
        const colGap = spot.x - (start.col + 0.5);
        if (Math.hypot(rowGap, colGap) < 0.5) return start;
        const [rowStep, colStep] = STEPS[(Math.round(Math.atan2(rowGap, colGap) / (Math.PI / 4)) + 8) % 8];
        let steps = Math.round((rowGap * rowStep + colGap * colStep) / (rowStep * rowStep + colStep * colStep));
        while (steps > 0 && !inside(start.row + rowStep * steps, start.col + colStep * steps)) steps--;
        return { row: start.row + rowStep * steps, col: start.col + colStep * steps };
    };

    gridEl.addEventListener('pointerdown', (event) => {
        if (state !== 'playing' || drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
        event.preventDefault();
        const spot = pointerSpot(event);
        const start = { row: Math.floor(spot.y), col: Math.floor(spot.x) };
        if (!inside(start.row, start.col)) return;
        drag = { id: event.pointerId, start, end: start };
        gridEl.setPointerCapture(event.pointerId);
        gridEl.classList.remove('keys');
        renderSelection();
    });

    gridEl.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const end = snapEnd(drag.start, pointerSpot(event));
        if (sameCell(end, drag.end)) return;
        drag.end = end;
        renderSelection();
    });

    gridEl.addEventListener('pointerup', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const { start, end } = drag;
        drag = null;
        if (sameCell(start, end)) {
            pickCell(start);
            return;
        }
        anchor = null;
        tryLine(start, end);
        renderSelection();
    });

    gridEl.addEventListener('pointercancel', () => {
        drag = null;
        renderSelection();
    });

    const useHint = () => {
        // The Hint button can still be reached with Tab while a card covers the board.
        if (state !== 'playing') return;
        const waiting = round.entries.filter((entry) => !entry.found);
        const entry = waiting[Math.floor(Math.random() * waiting.length)];
        const spot = round.placements.find((placement) => placement.word === entry.word);
        round.hints += 1;
        round.elapsed += HINT_PENALTY_MS;
        renderTime();
        setMessage(`${entry.word} starts at the marked letter`, '');
        clearTimeout(hintTimer);
        cells.flat().forEach((cell) => cell.classList.remove('hinted'));
        const cell = cells[spot.row][spot.col];
        cell.classList.add('hinted');
        hintTimer = setTimeout(() => cell.classList.remove('hinted'), HINT_SHOW_MS);
    };

    const buildGrid = () => {
        gridEl.textContent = '';
        marks = document.createElementNS(SVG_NS, 'svg');
        marks.setAttribute('class', 'marks');
        marks.setAttribute('viewBox', `0 0 ${COLS * UNIT} ${ROWS * UNIT}`);
        marks.setAttribute('aria-hidden', 'true');
        gridEl.appendChild(marks);
        cells = round.grid.map((line) => line.map((letter) => {
            const cell = document.createElement('span');
            cell.className = 'cell';
            cell.textContent = letter;
            gridEl.appendChild(cell);
            return cell;
        }));
    };

    const startRound = () => {
        const theme = settings.theme === 'random'
            ? THEMES[Math.floor(Math.random() * THEMES.length)]
            : THEMES.find((entry) => entry.id === settings.theme);
        const words = pickWords(theme, Math.random);
        const { grid, placements } = generate(words, settings.level);

        wordsEl.textContent = '';
        const entries = [...words].sort().map((word, index) => {
            const item = document.createElement('li');
            item.textContent = word;
            wordsEl.appendChild(item);
            return { word, item, color: MARK_COLORS[index], found: false };
        });
        round = { theme, grid, placements, entries, elapsed: 0, hints: 0 };

        anchor = null;
        drag = null;
        cursor = { row: 0, col: 0 };
        gridEl.classList.remove('keys');
        buildGrid();
        $('theme-name').textContent = theme.name;
        foundEl.textContent = `0/${entries.length}`;
        setMessage('', '');
        renderTime();
        setState('playing');
        renderSelection();
        gridEl.focus({ preventScroll: true });

        stopClock();
        lastTick = performance.now();
        ticker = setInterval(tick, TICK_MS);
    };

    const openMenu = () => {
        stopClock();
        setState('ready');
        $('start-btn').focus();
    };

    const renderSettings = () => {
        themeSelect.value = settings.theme;
        levelButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.level === settings.level)));
        const level = LEVELS[settings.level];
        const record = best[settings.level] > 0 ? `Best time: ${formatTime(best[settings.level])}.` : 'No best time yet.';
        $('level-note').textContent = `${level.note} ${record}`;
    };

    // After a mouse or touch press, hand focus back to the grid so the keys keep their game meaning.
    const releaseFocus = (event) => {
        if (event.detail > 0) gridEl.focus({ preventScroll: true });
    };

    themeSelect.append(new Option('Random theme', 'random'), ...THEMES.map((theme) => new Option(theme.name, theme.id)));
    themeSelect.addEventListener('change', () => {
        settings.theme = themeSelect.value;
        save(KEY_SETTINGS, settings);
    });
    levelButtons.forEach((button) => button.addEventListener('click', () => {
        settings.level = button.dataset.level;
        save(KEY_SETTINGS, settings);
        renderSettings();
    }));

    $('start-btn').addEventListener('click', startRound);
    $('again-btn').addEventListener('click', () => {
        if (performance.now() - endedAt >= END_GUARD_MS) startRound();
    });
    $('change-btn').addEventListener('click', () => {
        renderSettings();
        openMenu();
    });
    $('menu-btn').addEventListener('click', () => {
        renderSettings();
        openMenu();
    });
    $('hint-btn').addEventListener('click', (event) => {
        useHint();
        releaseFocus(event);
    });

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const confirm = event.key === 'Enter' || event.key === ' ';
        const onControl = event.target.closest('button, a, select');

        if (state === 'playing') {
            if (ARROWS[event.key]) {
                event.preventDefault();
                const [rowStep, colStep] = ARROWS[event.key];
                cursor = {
                    row: Math.min(ROWS - 1, Math.max(0, cursor.row + rowStep)),
                    col: Math.min(COLS - 1, Math.max(0, cursor.col + colStep))
                };
                gridEl.classList.add('keys');
                renderSelection();
            } else if (confirm && !onControl) {
                event.preventDefault();
                if (event.repeat) return;
                gridEl.classList.add('keys');
                pickCell(cursor);
            } else if (event.key === 'Escape') {
                anchor = null;
                setMessage('', '');
                renderSelection();
            } else if (event.key.toLowerCase() === 'h') {
                useHint();
            }
            return;
        }

        // A focused button, link or list handles Enter and Space itself.
        if (!confirm || onControl || event.repeat) return;
        if (state === 'ready') {
            event.preventDefault();
            startRound();
        } else if (performance.now() - endedAt >= END_GUARD_MS) {
            event.preventDefault();
            startRound();
        }
    });

    document.addEventListener('visibilitychange', () => {
        lastTick = performance.now();
    });

    renderSettings();
    setState('ready');
})();
