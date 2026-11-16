(() => {
    const { X, O, DRAWN, winLine, status, classicChoose, bigCreate, bigMoves, bigPlay, bigChoose } = window.TicEngine;

    const STORE = 'arcade.tic-tac-toe.';
    // Pause before the computer answers, so its move does not land on top of yours.
    const THINK_MS = { classic: 450, big: 250 };
    // The end screen waits this long before it takes input, so the key that made the last move cannot dismiss it.
    const END_DELAY = 900;
    const OPTIONS = {
        mode: ['classic', 'big'],
        opponent: ['cpu', 'duo'],
        level: ['0', '1', '2'],
        first: ['you', 'cpu']
    };
    const MARKS = {
        [X]: '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        [O]: '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/></svg>'
    };
    const NAMES = { [X]: 'X', [O]: 'O' };
    const STEPS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

    const byId = (id) => document.getElementById(id);
    const root = byId('game');
    const play = document.querySelector('.play');
    const board = byId('board');
    const turnLine = byId('turn');
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

    const loadJson = (key) => {
        try {
            const parsed = JSON.parse(load(key));
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    };

    const savedSettings = loadJson('settings');
    const settings = {};
    Object.entries(OPTIONS).forEach(([name, values]) => {
        settings[name] = values.includes(savedSettings[name]) ? savedSettings[name] : values[0];
    });

    const tallies = loadJson('tally');
    // Wins for the first side, wins for the second side, draws: kept apart for each mode and kind of opponent.
    const tally = () => {
        const key = `${settings.mode}.${settings.opponent}`;
        const saved = tallies[key];
        if (!Array.isArray(saved) || saved.length !== 3) tallies[key] = [0, 0, 0];
        return tallies[key];
    };

    let game = null;
    let cells = [];
    let cursor = 0;
    let human = X;
    let round = 0;
    let endReadyAt = 0;

    const isBig = () => settings.mode === 'big';
    const side = () => (isBig() ? 9 : 3);
    const againstComputer = () => settings.opponent === 'cpu';
    const computerToMove = () => againstComputer() && game.turn !== human;

    const legalMoves = () => {
        if (game.result) return [];
        return isBig() ? bigMoves(game) : game.cells.map((value, index) => (value === 0 ? index : -1)).filter((index) => index >= 0);
    };

    const applyMove = (index) => {
        if (isBig()) {
            bigPlay(game, index);
            return;
        }
        game.cells[index] = game.turn;
        game.result = status(game.cells);
        game.turn = 3 - game.turn;
        game.last = index;
    };

    // Square number for a row and column on screen. Big Board squares are numbered small board first.
    const squareAt = (row, col) => {
        if (!isBig()) return row * 3 + col;
        return (Math.floor(row / 3) * 3 + Math.floor(col / 3)) * 9 + (row % 3) * 3 + (col % 3);
    };

    const buildBoard = () => {
        board.className = `board ${settings.mode}`;
        cells = [];
        const makeCell = (index) => {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'cell';
            cell.tabIndex = -1;
            cell.dataset.index = index;
            cells[index] = cell;
            return cell;
        };
        if (isBig()) {
            const smalls = [];
            for (let small = 0; small < 9; small++) {
                const box = document.createElement('div');
                box.className = 'small';
                for (let square = 0; square < 9; square++) box.append(makeCell(small * 9 + square));
                const claim = document.createElement('div');
                claim.className = 'claim';
                box.append(claim);
                smalls.push(box);
            }
            board.replaceChildren(...smalls);
        } else {
            board.replaceChildren(...[...Array(9).keys()].map(makeCell));
        }
        for (let row = 0; row < side(); row++) {
            for (let col = 0; col < side(); col++) {
                const cell = cells[squareAt(row, col)];
                cell.dataset.row = row;
                cell.dataset.col = col;
            }
        }
        cursor = squareAt(Math.floor(side() / 2), Math.floor(side() / 2));
        cells[cursor].tabIndex = 0;
    };

    const describeTurn = () => {
        const mark = MARKS[game.turn];
        if (computerToMove()) return `${mark}<span>Computer is thinking</span>`;
        const who = againstComputer() ? 'Your turn' : `${NAMES[game.turn]} to play`;
        if (!isBig()) return `${mark}<span>${who}</span>`;
        return `${mark}<span>${who}: ${game.next >= 0 ? 'the lit board' : 'any open board'}</span>`;
    };

    const paint = () => {
        const legal = new Set(legalMoves());
        const line = isBig() ? null : winLine(game.cells);
        cells.forEach((cell, index) => {
            const value = game.cells[index];
            if (cell.dataset.mark !== String(value)) {
                cell.dataset.mark = value;
                cell.innerHTML = value ? MARKS[value] : '';
            }
            cell.classList.toggle('x', value === X);
            cell.classList.toggle('o', value === O);
            cell.classList.toggle('last', index === game.last);
            cell.classList.toggle('win', Boolean(line && line.includes(index)));
            cell.classList.toggle('open', legal.has(index));
            const place = isBig()
                ? `Board ${Math.floor(index / 9) + 1}, square ${(index % 9) + 1}`
                : `Row ${Number(cell.dataset.row) + 1}, column ${Number(cell.dataset.col) + 1}`;
            cell.setAttribute('aria-label', `${place}: ${value ? NAMES[value] : 'empty'}${legal.has(index) ? '' : ', not playable'}`);
        });
        if (isBig()) {
            const bigLine = winLine(game.boards) || [];
            [...board.children].forEach((box, small) => {
                const owner = game.boards[small];
                box.classList.toggle('live', owner === 0 && !game.result && (game.next < 0 || game.next === small));
                box.classList.toggle('won-x', owner === X);
                box.classList.toggle('won-o', owner === O);
                box.classList.toggle('drawn', owner === DRAWN);
                box.classList.toggle('line', bigLine.includes(small));
                const claim = box.lastElementChild;
                if (claim.dataset.owner !== String(owner)) {
                    claim.dataset.owner = owner;
                    claim.innerHTML = MARKS[owner] || '';
                }
            });
        }
        if (!game.result) {
            turnLine.className = `turn ${game.turn === X ? 'x' : 'o'}`;
            turnLine.innerHTML = describeTurn();
        }
    };

    const showTally = (prefix) => {
        const [first, second, draws] = tally();
        const cpu = againstComputer();
        byId(`${prefix}-a-label`).textContent = cpu ? 'You' : 'X wins';
        byId(`${prefix}-b-label`).textContent = cpu ? 'Computer' : 'O wins';
        byId(`${prefix}-a`).textContent = first;
        byId(`${prefix}-b`).textContent = second;
        byId(`${prefix}-d`).textContent = draws;
    };

    const setState = (state) => {
        root.dataset.state = state;
        play.inert = state === 'over' && !root.dataset.peek;
    };

    const showStart = () => {
        round++;
        delete root.dataset.peek;
        root.dataset.mode = settings.mode;
        document.querySelectorAll('.seg').forEach((group) => {
            const name = group.dataset.option;
            group.hidden = (name === 'level' || name === 'first') && !againstComputer();
            group.querySelectorAll('button').forEach((button) => {
                button.setAttribute('aria-pressed', String(button.dataset.value === settings[name]));
            });
        });
        byId('top-level').textContent = isBig() ? 'Hard' : 'Unbeatable';
        const [first, second, draws] = tally();
        const label = `${isBig() ? 'Big Board' : 'Classic'}, ${againstComputer() ? 'vs computer' : 'two players'}`;
        byId('start-tally').textContent = againstComputer()
            ? `${label}: ${first} won, ${second} lost, ${draws} drawn.`
            : `${label}: X ${first}, O ${second}, ${draws} drawn.`;
        setState('ready');
    };

    const finish = () => {
        const counts = tally();
        const result = game.result;
        let title = 'A draw';
        let outcome = 'draw';
        if (result === DRAWN) {
            counts[2]++;
        } else if (againstComputer()) {
            const won = result === human;
            counts[won ? 0 : 1]++;
            title = won ? 'You win' : 'Computer wins';
            outcome = won ? 'won' : 'lost';
        } else {
            counts[result === X ? 0 : 1]++;
            title = `${NAMES[result]} wins`;
            outcome = 'won';
        }
        save('tally', JSON.stringify(tallies));
        showTally('tally');
        showTally('end');
        root.dataset.result = outcome;
        turnLine.className = `turn ${outcome}`;
        turnLine.textContent = title;
        byId('end-title').textContent = title;
        const levelName = byId('top-level').parentElement.children[Number(settings.level)].textContent;
        byId('end-note').textContent = `${isBig() ? 'Big Board' : 'Classic'}, ${againstComputer() ? `computer on ${levelName}` : 'two players'}.`;
        endReadyAt = performance.now() + END_DELAY;
        setState('over');
        const mine = round;
        setTimeout(() => {
            if (round === mine && root.dataset.state === 'over' && !root.dataset.peek) againButton.focus();
        }, END_DELAY);
    };

    const computerMove = () => {
        const index = isBig()
            ? bigChoose(game, Number(settings.level))
            : classicChoose(game.cells, game.turn, Number(settings.level));
        applyMove(index);
        paint();
        afterMove();
    };

    // The computer starts thinking only after the move just made has been painted.
    const afterMove = () => {
        if (game.result) {
            finish();
            return;
        }
        if (!computerToMove()) return;
        const mine = round;
        requestAnimationFrame(() => {
            setTimeout(() => {
                if (round === mine && root.dataset.state === 'playing') computerMove();
            }, THINK_MS[settings.mode]);
        });
    };

    const startGame = () => {
        round++;
        delete root.dataset.peek;
        delete root.dataset.result;
        root.dataset.mode = settings.mode;
        game = isBig() ? bigCreate() : { cells: new Array(9).fill(0), turn: X, result: 0, last: -1 };
        human = settings.first === 'you' ? X : O;
        buildBoard();
        showTally('tally');
        setState('playing');
        paint();
        cells[cursor].focus({ preventScroll: true });
        afterMove();
    };

    const moveCursor = (to) => {
        cells[cursor].tabIndex = -1;
        cursor = to;
        cells[cursor].tabIndex = 0;
        cells[cursor].focus({ preventScroll: true });
    };

    // A square that cannot be played gives a short shake and says why.
    const refuse = (cell, reason) => {
        turnLine.querySelector('span').textContent = reason;
        cell.classList.remove('refused');
        // Reading the size restarts the animation when the class goes straight back on.
        cell.getBoundingClientRect();
        cell.classList.add('refused');
    };

    // Clicks, taps and Enter or Space on a focused square all arrive here.
    board.addEventListener('click', (event) => {
        const cell = event.target.closest('.cell');
        if (!cell || root.dataset.state !== 'playing') return;
        const index = Number(cell.dataset.index);
        moveCursor(index);
        if (computerToMove()) return;
        if (!legalMoves().includes(index)) {
            if (game.cells[index]) refuse(cell, 'That square is taken');
            else refuse(cell, game.next >= 0 ? 'Play in the lit board' : 'That board is finished');
            return;
        }
        applyMove(index);
        paint();
        afterMove();
    });

    document.querySelectorAll('.seg button').forEach((button) => {
        button.addEventListener('click', () => {
            settings[button.parentElement.dataset.option] = button.dataset.value;
            save('settings', JSON.stringify(settings));
            showStart();
        });
    });

    byId('start-btn').addEventListener('click', startGame);
    byId('restart-btn').addEventListener('click', startGame);
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
                const row = Number(cells[cursor].dataset.row) + step[0];
                const col = Number(cells[cursor].dataset.col) + step[1];
                const inside = row >= 0 && row < side() && col >= 0 && col < side();
                moveCursor(inside ? squareAt(row, col) : cursor);
            } else if (confirm && !onControl) {
                event.preventDefault();
                cells[cursor].click();
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

    showStart();
})();
