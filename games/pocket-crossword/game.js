(() => {
    const PUZZLES = window.POCKET_CROSSWORD_PUZZLES;
    const SIZE = 5;
    const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
    const TICK_MS = 250;
    const SAVE_EVERY_MS = 5000;
    const CLEAR_ARM_MS = 3000;
    const DAY_MS = 86400000;
    // The end screen ignores input this long, so the last typed letter cannot skip it.
    const END_GUARD_MS = 700;
    const KEY_SOLVED = 'arcade.pocket-crossword.solved';
    const KEY_PROGRESS = 'arcade.pocket-crossword.progress';
    const KEY_CURRENT = 'arcade.pocket-crossword.current';
    const BACKSPACE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z"/><path d="M12 9.5l5 5"/><path d="M17 9.5l-5 5"/></svg>';
    const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

    const $ = (id) => document.getElementById(id);
    const app = $('app');
    const play = $('play');
    const gridEl = $('grid');
    const msgEl = $('msg');
    const clearBtn = $('clear-btn');
    const screens = { ready: $('start-screen'), list: $('list-screen'), over: $('end-screen') };

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

    const asRecord = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
    // solved: puzzle index to best time in ms. progress: puzzle index to the unfinished grid.
    const solved = asRecord(load(KEY_SOLVED, {}));
    const progress = asRecord(load(KEY_PROGRESS, {}));

    let state = 'ready';
    let puzzle = null;
    let letters = [];
    let shown = new Set();
    let wrong = new Set();
    let active = 0;
    let dir = 'across';
    let elapsed = 0;
    let checks = 0;
    let reveals = 0;
    let cellEls = [];
    let ticker = 0;
    let lastTick = 0;
    let lastSave = 0;
    let endedAt = 0;
    let clearTimer = 0;

    // The local calendar day picks the puzzle, so it changes at midnight where the player is.
    const todayIndex = () => {
        const now = new Date();
        return Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / DAY_MS) % PUZZLES.length;
    };

    const formatTime = (ms) => {
        const seconds = Math.floor(ms / 1000);
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };

    const solvedCount = () => PUZZLES.filter((_, index) => solved[index] > 0).length;
    const isStarted = (index) => /[A-Z]/.test(progress[index]?.letters ?? '');

    // The first unsolved puzzle at or after the given one, wrapping around. All solved: the given one.
    const nextUnsolved = (from) => {
        for (let step = 0; step < PUZZLES.length; step++) {
            const index = (from + step) % PUZZLES.length;
            if (!(solved[index] > 0)) return index;
        }
        return from % PUZZLES.length;
    };

    // Works out the answer runs and their numbers from the five rows.
    const build = (index) => {
        const { rows, clues } = PUZZLES[index];
        const white = (row, col) => row >= 0 && row < SIZE && col >= 0 && col < SIZE && rows[row][col] !== '#';
        const cells = [];
        for (let row = 0; row < SIZE; row++) {
            for (let col = 0; col < SIZE; col++) {
                cells.push(white(row, col) ? { index: row * SIZE + col, answer: rows[row][col], number: 0, across: null, down: null } : null);
            }
        }
        const across = [];
        const down = [];
        let number = 0;
        const addSlot = (list, slotDir, row, col, rowStep, colStep) => {
            const slot = { dir: slotDir, number, cells: [], answer: '' };
            for (let r = row, c = col; white(r, c); r += rowStep, c += colStep) {
                slot.cells.push(r * SIZE + c);
                slot.answer += rows[r][c];
                cells[r * SIZE + c][slotDir] = slot;
            }
            slot.clue = clues[slot.answer];
            list.push(slot);
        };
        for (let row = 0; row < SIZE; row++) {
            for (let col = 0; col < SIZE; col++) {
                if (!white(row, col)) continue;
                const startsAcross = !white(row, col - 1) && white(row, col + 1);
                const startsDown = !white(row - 1, col) && white(row + 1, col);
                if (!startsAcross && !startsDown) continue;
                number += 1;
                cells[row * SIZE + col].number = number;
                if (startsAcross) addSlot(across, 'across', row, col, 0, 1);
                if (startsDown) addSlot(down, 'down', row, col, 1, 0);
            }
        }
        return { index, cells, order: [...across, ...down] };
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

    const otherDir = () => (dir === 'across' ? 'down' : 'across');
    const currentSlot = () => puzzle.cells[active][dir];

    const render = () => {
        const slot = currentSlot();
        puzzle.cells.forEach((cell, index) => {
            if (!cell) return;
            const element = cellEls[index];
            element.querySelector('.letter').textContent = letters[index];
            element.classList.toggle('active', index === active);
            element.classList.toggle('in-word', index !== active && slot.cells.includes(index));
            element.classList.toggle('wrong', wrong.has(index));
            element.classList.toggle('shown', shown.has(index));
        });
        $('clue-label').textContent = `${slot.number} ${slot.dir === 'across' ? 'Across' : 'Down'}`;
        $('clue-text').textContent = slot.clue;
        puzzle.order.forEach((entry) => {
            entry.item.classList.toggle('current', entry === slot);
            entry.item.classList.toggle('done', entry.cells.every((index) => letters[index]));
        });
    };

    const saveProgress = () => {
        progress[puzzle.index] = {
            letters: puzzle.cells.map((cell, index) => (cell ? letters[index] || '.' : '#')).join(''),
            shown: [...shown],
            ms: Math.round(elapsed),
            checks,
            reveals
        };
        save(KEY_PROGRESS, progress);
        lastSave = performance.now();
    };

    const tick = () => {
        const now = performance.now();
        if (!document.hidden) elapsed += Math.min(now - lastTick, 1000);
        lastTick = now;
        $('time').textContent = formatTime(elapsed);
        if (now - lastSave >= SAVE_EVERY_MS) saveProgress();
    };

    const disarmClear = () => {
        clearTimeout(clearTimer);
        clearBtn.classList.remove('armed');
        clearBtn.innerHTML = 'Clear <br>grid';
    };

    const stopClock = () => {
        clearInterval(ticker);
        disarmClear();
    };

    const helpText = () => {
        const parts = [];
        if (checks > 0) parts.push(checks === 1 ? '1 check' : `${checks} checks`);
        if (reveals > 0) parts.push(reveals === 1 ? '1 letter shown' : `${reveals} letters shown`);
        return parts.join(', ') || 'None';
    };

    const renderRecord = () => {
        const text = `Solved ${solvedCount()} of ${PUZZLES.length} puzzles.`;
        $('start-record').textContent = text;
        $('list-record').textContent = `${text} The ringed one is today's.`;
        const target = nextUnsolved(todayIndex());
        const isToday = target === todayIndex();
        const verb = isStarted(target) ? 'Continue' : 'Play';
        $('start-btn').textContent = isToday ? `${verb} today's puzzle` : `${verb} puzzle ${target + 1}`;
    };

    const finish = () => {
        stopClock();
        const time = Math.round(elapsed);
        const previous = solved[puzzle.index] > 0 ? solved[puzzle.index] : 0;
        const isBest = previous === 0 || time < previous;
        if (isBest) solved[puzzle.index] = time;
        delete progress[puzzle.index];
        save(KEY_SOLVED, solved);
        save(KEY_PROGRESS, progress);
        save(KEY_CURRENT, null);

        const upNext = nextUnsolved(puzzle.index + 1);
        $('end-title').textContent = `Puzzle ${puzzle.index + 1} solved!`;
        $('end-time').textContent = formatTime(time);
        $('end-best').textContent = formatTime(solved[puzzle.index]);
        $('end-help').textContent = helpText();
        $('end-count').textContent = `${solvedCount()} of ${PUZZLES.length}`;
        $('end-next').textContent = solvedCount() === PUZZLES.length
            ? 'Every puzzle is solved. Play again to replay them in order.'
            : `Play again goes on to puzzle ${upNext + 1}.`;
        $('new-best').hidden = !(isBest && previous > 0);
        endedAt = performance.now();
        setState('over');
        $('again-btn').focus();
    };

    const afterChange = () => {
        saveProgress();
        render();
        const whites = puzzle.cells.filter(Boolean);
        if (!whites.every((cell) => letters[cell.index])) return;
        if (whites.every((cell) => letters[cell.index] === cell.answer)) {
            finish();
        } else {
            setMessage('All filled in, but something is off. Try Check.', 'bad');
        }
    };

    const goToSlot = (slot) => {
        dir = slot.dir;
        active = slot.cells.find((index) => !letters[index]) ?? slot.cells[0];
    };

    // Moves to the next or previous clue, across clues first and then down, wrapping around.
    const jumpClue = (step, needsGap) => {
        const { order } = puzzle;
        let at = order.indexOf(currentSlot());
        for (let i = 0; i < order.length; i++) {
            at = (at + step + order.length) % order.length;
            if (!needsGap || order[at].cells.some((index) => !letters[index])) {
                goToSlot(order[at]);
                return;
            }
        }
    };

    const selectCell = (index) => {
        const cell = puzzle.cells[index];
        if (!cell) return;
        if (index === active) {
            if (cell[otherDir()]) dir = otherDir();
        } else {
            active = index;
            if (!cell[dir]) dir = otherDir();
        }
        setMessage('', '');
        render();
    };

    const setLetter = (index, letter) => {
        if (shown.has(index)) return;
        letters[index] = letter;
        wrong.delete(index);
        if (letter) {
            const element = cellEls[index];
            element.classList.remove('pop');
            void element.offsetWidth;
            element.classList.add('pop');
        }
    };

    const typeLetter = (letter) => {
        setMessage('', '');
        setLetter(active, letter);
        const slot = currentSlot();
        const at = slot.cells.indexOf(active);
        if (at < slot.cells.length - 1) {
            active = slot.cells[at + 1];
        } else if (slot.cells.every((index) => letters[index])) {
            jumpClue(1, true);
        }
        afterChange();
    };

    const backspace = () => {
        setMessage('', '');
        if (letters[active] && !shown.has(active)) {
            setLetter(active, '');
        } else {
            const slot = currentSlot();
            const at = slot.cells.indexOf(active);
            if (at > 0) {
                active = slot.cells[at - 1];
                setLetter(active, '');
            }
        }
        afterChange();
    };

    const moveBy = (rowStep, colStep) => {
        let row = Math.floor(active / SIZE) + rowStep;
        let col = (active % SIZE) + colStep;
        const inside = () => row >= 0 && row < SIZE && col >= 0 && col < SIZE;
        while (inside() && !puzzle.cells[row * SIZE + col]) {
            row += rowStep;
            col += colStep;
        }
        if (inside()) active = row * SIZE + col;
        const axis = colStep !== 0 ? 'across' : 'down';
        if (puzzle.cells[active][axis]) dir = axis;
        else if (!puzzle.cells[active][dir]) dir = otherDir();
        setMessage('', '');
        render();
    };

    const checkLetters = () => {
        checks += 1;
        wrong = new Set(puzzle.cells.filter((cell) => cell && letters[cell.index] && letters[cell.index] !== cell.answer).map((cell) => cell.index));
        saveProgress();
        render();
        if (wrong.size === 0) setMessage('No wrong letters so far', 'good');
        else setMessage(wrong.size === 1 ? '1 wrong letter marked' : `${wrong.size} wrong letters marked`, 'bad');
    };

    const revealCells = (indexes) => {
        setMessage('', '');
        indexes.filter((index) => !shown.has(index)).forEach((index) => {
            letters[index] = puzzle.cells[index].answer;
            wrong.delete(index);
            shown.add(index);
            reveals += 1;
        });
        afterChange();
    };

    // Clearing wipes real work, so the button asks for a second press.
    const clearGrid = () => {
        if (!clearBtn.classList.contains('armed')) {
            clearBtn.classList.add('armed');
            clearBtn.innerHTML = 'Press <br>again';
            clearTimer = setTimeout(disarmClear, CLEAR_ARM_MS);
            return;
        }
        disarmClear();
        letters = letters.map(() => '');
        shown = new Set();
        wrong = new Set();
        goToSlot(puzzle.order[0]);
        saveProgress();
        render();
        setMessage('Grid cleared', '');
    };

    const buildBoard = () => {
        gridEl.textContent = '';
        cellEls = puzzle.cells.map((cell, index) => {
            const element = document.createElement('div');
            element.className = cell ? 'cell' : 'cell block';
            if (cell) {
                element.dataset.index = index;
                if (cell.number) {
                    const number = document.createElement('span');
                    number.className = 'num';
                    number.textContent = cell.number;
                    element.appendChild(number);
                }
                const letter = document.createElement('span');
                letter.className = 'letter';
                element.appendChild(letter);
            }
            gridEl.appendChild(element);
            return element;
        });

        $('across-list').textContent = '';
        $('down-list').textContent = '';
        puzzle.order.forEach((slot) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'clue-item';
            const number = document.createElement('strong');
            number.textContent = slot.number;
            item.append(number, ` ${slot.clue}`);
            item.addEventListener('click', () => {
                goToSlot(slot);
                render();
                gridEl.focus({ preventScroll: true });
            });
            slot.item = item;
            const line = document.createElement('li');
            line.appendChild(item);
            $(`${slot.dir}-list`).appendChild(line);
        });
    };

    const openPuzzle = (index) => {
        puzzle = build(index);
        const saved = progress[index];
        const usable = saved && typeof saved.letters === 'string' && saved.letters.length === SIZE * SIZE;
        letters = puzzle.cells.map((cell, at) => (cell && usable && /[A-Z]/.test(saved.letters[at]) ? saved.letters[at] : ''));
        shown = new Set(usable && Array.isArray(saved.shown) ? saved.shown.filter((at) => puzzle.cells[at] && letters[at] === puzzle.cells[at].answer) : []);
        wrong = new Set();
        elapsed = usable && saved.ms > 0 ? saved.ms : 0;
        checks = usable && saved.checks > 0 ? saved.checks : 0;
        reveals = usable && saved.reveals > 0 ? saved.reveals : 0;

        buildBoard();
        goToSlot(puzzle.order.find((slot) => slot.cells.some((at) => !letters[at])) ?? puzzle.order[0]);
        $('puzzle-name').textContent = `Puzzle ${index + 1}`;
        $('today-tag').hidden = index !== todayIndex();
        $('time').textContent = formatTime(elapsed);
        setMessage('', '');
        save(KEY_CURRENT, index);
        saveProgress();
        setState('playing');
        render();
        gridEl.focus({ preventScroll: true });

        stopClock();
        lastTick = performance.now();
        lastSave = lastTick;
        ticker = setInterval(tick, TICK_MS);
    };

    const openList = () => {
        if (state === 'playing') {
            stopClock();
            saveProgress();
            save(KEY_CURRENT, null);
        }
        renderRecord();
        const list = $('puzzle-list');
        list.textContent = '';
        PUZZLES.forEach((_, index) => {
            const pick = document.createElement('button');
            pick.type = 'button';
            pick.className = 'pick';
            const number = document.createElement('b');
            number.textContent = index + 1;
            const status = document.createElement('small');
            let label = `Puzzle ${index + 1}`;
            if (solved[index] > 0) {
                pick.classList.add('solved');
                status.textContent = formatTime(solved[index]);
                label += `, solved in ${formatTime(solved[index])}`;
            } else if (isStarted(index)) {
                pick.classList.add('started');
                status.textContent = 'Begun';
                label += ', begun';
            } else {
                status.textContent = 'New';
                label += ', not solved';
            }
            if (index === todayIndex()) {
                pick.classList.add('today');
                label += ', today\'s puzzle';
            }
            pick.setAttribute('aria-label', label);
            pick.append(number, status);
            pick.addEventListener('click', () => openPuzzle(index));
            const line = document.createElement('li');
            line.appendChild(pick);
            list.appendChild(line);
        });
        setState('list');
        list.children[todayIndex()].firstChild.focus();
    };

    const openStart = () => {
        renderRecord();
        setState('ready');
        $('start-btn').focus();
    };

    const playAgain = () => {
        if (performance.now() - endedAt >= END_GUARD_MS) openPuzzle(nextUnsolved(puzzle.index + 1));
    };

    // After a mouse or touch press, hand focus back to the grid so the keys keep their game meaning.
    const onPress = (id, action) => {
        $(id).addEventListener('click', (event) => {
            // These tools can still be reached with Tab while a card covers the grid.
            if (state !== 'playing') return;
            action();
            if (event.detail > 0 && state === 'playing') gridEl.focus({ preventScroll: true });
        });
    };

    KEY_ROWS.forEach((rowLetters, rowIndex) => {
        const row = document.createElement('div');
        row.className = 'key-row';
        [...rowLetters].forEach((letter) => {
            const key = document.createElement('button');
            key.type = 'button';
            key.className = 'key';
            key.textContent = letter;
            key.addEventListener('click', () => typeLetter(letter));
            row.appendChild(key);
        });
        if (rowIndex === KEY_ROWS.length - 1) {
            const erase = document.createElement('button');
            erase.type = 'button';
            erase.className = 'key wide';
            erase.setAttribute('aria-label', 'Backspace');
            erase.innerHTML = BACKSPACE_ICON;
            erase.addEventListener('click', backspace);
            row.appendChild(erase);
        }
        $('keys').appendChild(row);
    });

    gridEl.addEventListener('click', (event) => {
        const cell = event.target.closest('.cell');
        if (cell?.dataset.index) selectCell(Number(cell.dataset.index));
    });

    onPress('prev-btn', () => { jumpClue(-1, false); render(); });
    onPress('next-btn', () => { jumpClue(1, false); render(); });
    onPress('check-btn', checkLetters);
    onPress('reveal-letter-btn', () => revealCells([active]));
    onPress('reveal-word-btn', () => revealCells(currentSlot().cells));
    onPress('clear-btn', clearGrid);
    $('list-btn').addEventListener('click', openList);
    $('browse-btn').addEventListener('click', openList);
    $('end-list-btn').addEventListener('click', openList);
    $('list-back-btn').addEventListener('click', openStart);
    $('start-btn').addEventListener('click', () => openPuzzle(nextUnsolved(todayIndex())));
    $('again-btn').addEventListener('click', playAgain);

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const confirm = event.key === 'Enter' || event.key === ' ';
        const onControl = event.target.closest('button, a');

        if (state === 'playing') {
            if (/^[a-z]$/i.test(event.key)) {
                typeLetter(event.key.toUpperCase());
            } else if (event.key === 'Backspace') {
                event.preventDefault();
                backspace();
            } else if (event.key === 'Delete') {
                setLetter(active, '');
                afterChange();
            } else if (ARROWS[event.key]) {
                event.preventDefault();
                moveBy(...ARROWS[event.key]);
            } else if (event.key === 'Tab' && !onControl) {
                event.preventDefault();
                jumpClue(event.shiftKey ? -1 : 1, false);
                render();
            } else if (event.key === 'Escape') {
                // Keyboard path to the tool buttons and back.
                if (onControl) gridEl.focus({ preventScroll: true });
                else $('check-btn').focus();
            } else if (confirm && !onControl) {
                event.preventDefault();
                if (event.key === ' ') selectCell(active);
                else {
                    jumpClue(1, false);
                    render();
                }
            }
            return;
        }

        // A focused button or link handles Enter and Space itself.
        if (!confirm || onControl || event.repeat) return;
        if (state === 'ready') {
            event.preventDefault();
            openPuzzle(nextUnsolved(todayIndex()));
        } else if (state === 'over') {
            event.preventDefault();
            playAgain();
        }
    });

    document.addEventListener('visibilitychange', () => {
        lastTick = performance.now();
        if (document.hidden && state === 'playing') saveProgress();
    });
    window.addEventListener('pagehide', () => {
        if (state === 'playing') saveProgress();
    });

    // A puzzle that was open when the page closed comes straight back.
    const current = load(KEY_CURRENT, null);
    if (Number.isInteger(current) && current >= 0 && current < PUZZLES.length && progress[current]) {
        renderRecord();
        openPuzzle(current);
    } else {
        renderRecord();
        setState('ready');
    }
})();
