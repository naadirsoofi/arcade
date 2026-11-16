// ---- Game rules (pure: no DOM, also run by the board test) ----

const SIZE = { cols: 7, rows: 8 };
const CELLS = SIZE.cols * SIZE.rows;
const LEVELS = 20;
// A jar has no kind of its own. Every other piece is { kind: 0..kinds-1, special: '' | 'row' | 'col' }.
const JAR = -1;
// From this cascade on, new pieces are chosen so they cannot match, which guarantees every move ends.
const CASCADE_CAP = 8;
const POINTS = { piece: 10, blast: 30 };
const STAR_SHARES = [1, 1.35, 1.7];

// Three gentle levels with five spices (lots of cascades), then six. Targets rise a little faster than the moves.
const levelSpec = (level) => {
    const kinds = level <= 3 ? 5 : 6;
    const moves = 15 + Math.floor(level / 2);
    const perMove = kinds === 5 ? 45 + level * 10 : 44 + level * 1.3;
    const target = Math.round((moves * perMove) / 50) * 50;
    return { kinds, moves, target, stars: STAR_SHARES.map((share) => Math.round((target * share) / 10) * 10) };
};

const starsFor = (spec, score) => spec.stars.filter((mark) => score >= mark).length;

const rowOf = (index) => Math.floor(index / SIZE.cols);
const colOf = (index) => index % SIZE.cols;
const snapshot = (board) => board.map((cell) => ({ ...cell }));

const sameKind = (board, index, kind) => index >= 0 && index < CELLS && board[index] !== null && board[index].kind === kind;

// True when the piece at index sits in a line of three or more of its kind.
const formsRun = (board, index) => {
    const { kind } = board[index];
    if (kind === JAR) return false;
    const col = colOf(index);
    let across = 1;
    for (let c = col - 1; c >= 0 && sameKind(board, index - (col - c), kind); c--) across++;
    for (let c = col + 1; c < SIZE.cols && sameKind(board, index + (c - col), kind); c++) across++;
    let down = 1;
    for (let at = index - SIZE.cols; sameKind(board, at, kind); at -= SIZE.cols) down++;
    for (let at = index + SIZE.cols; sameKind(board, at, kind); at += SIZE.cols) down++;
    return across >= 3 || down >= 3;
};

// Every line of three or more on a full board, longest first.
const findRuns = (board) => {
    const runs = [];
    const scan = (start, step, length, across) => {
        let from = 0;
        for (let n = 1; n <= length; n++) {
            const kind = board[start + (n - 1) * step].kind;
            if (n < length && kind !== JAR && board[start + n * step].kind === kind) continue;
            if (n - from >= 3) {
                runs.push({ across, cells: Array.from({ length: n - from }, (_, k) => start + (from + k) * step) });
            }
            from = n;
        }
    };
    for (let row = 0; row < SIZE.rows; row++) scan(row * SIZE.cols, 1, SIZE.cols, true);
    for (let col = 0; col < SIZE.cols; col++) scan(col, SIZE.cols, SIZE.rows, false);
    return runs.sort((a, b) => b.cells.length - a.cells.length);
};

// A random kind that does not complete a line at index. A cell has at most four kinds ruled out, so with
// five or more kinds one always fits.
const safeKind = (board, index, kinds) => {
    const first = Math.floor(Math.random() * kinds);
    for (let n = 0; n < kinds; n++) {
        board[index] = { kind: (first + n) % kinds, special: '' };
        if (!formsRun(board, index)) break;
    }
    return board[index].kind;
};

const adjacent = (a, b) => (rowOf(a) === rowOf(b) && Math.abs(a - b) === 1) || Math.abs(a - b) === SIZE.cols;

const swapCells = (board, a, b) => {
    [board[a], board[b]] = [board[b], board[a]];
};

// A swap counts when it lines up three or more, or when either piece is a jar.
const validSwap = (board, a, b) => {
    if (!adjacent(a, b)) return false;
    if (board[a].kind === JAR || board[b].kind === JAR) return true;
    swapCells(board, a, b);
    const matches = formsRun(board, a) || formsRun(board, b);
    swapCells(board, a, b);
    return matches;
};

const findMoves = (board) => {
    const moves = [];
    for (let index = 0; index < CELLS; index++) {
        if (colOf(index) < SIZE.cols - 1 && validSwap(board, index, index + 1)) moves.push([index, index + 1]);
        if (index + SIZE.cols < CELLS && validSwap(board, index, index + SIZE.cols)) moves.push([index, index + SIZE.cols]);
    }
    return moves;
};

// A fresh board with no line already made and at least one swap available.
const newBoard = (kinds) => {
    while (true) {
        const board = Array(CELLS).fill(null);
        for (let index = 0; index < CELLS; index++) safeKind(board, index, kinds);
        if (findMoves(board).length) return board;
    }
};

// The same pieces in new places, with no line already made and at least one swap available.
const shuffleBoard = (board, kinds) => {
    for (let attempt = 0; attempt < 200; attempt++) {
        const mixed = snapshot(board);
        for (let index = CELLS - 1; index > 0; index--) {
            swapCells(mixed, index, Math.floor(Math.random() * (index + 1)));
        }
        if (!findRuns(mixed).length && findMoves(mixed).length) return mixed;
    }
    return newBoard(kinds);
};

const lineOf = (index, across) => Array.from({ length: across ? SIZE.cols : SIZE.rows }, (_, n) => (
    across ? rowOf(index) * SIZE.cols + n : n * SIZE.cols + colOf(index)
));

const cellsOfKind = (board, kind) => {
    const found = [];
    board.forEach((cell, index) => {
        if (cell.kind === kind) found.push(index);
    });
    return found;
};

const commonestKind = (board, kinds) => {
    let best = 0;
    for (let kind = 1; kind < kinds; kind++) {
        if (cellsOfKind(board, kind).length > cellsOfKind(board, best).length) best = kind;
    }
    return best;
};

// What a swapped jar clears: every piece of the kind it was swapped with, or the whole board for two jars.
const jarSwap = (board, a, b) => {
    const jars = [a, b].filter((index) => board[index].kind === JAR);
    if (!jars.length) return null;
    const cells = jars.length === 2
        ? board.map((cell, index) => index)
        : [...cellsOfKind(board, board[jars[0] === a ? b : a].kind), jars[0]];
    // The swapped jar is used up, so it must not go off a second time when it is cleared.
    jars.forEach((index) => {
        board[index].special = '';
    });
    return cells;
};

// Lets everything fall, then fills the gaps from the top. Returns how many rows each cell's piece fell.
const collapse = (board, kinds, safe) => {
    const drops = Array(CELLS).fill(0);
    const gaps = [];
    for (let col = 0; col < SIZE.cols; col++) {
        let write = SIZE.rows - 1;
        for (let row = SIZE.rows - 1; row >= 0; row--) {
            const from = row * SIZE.cols + col;
            if (board[from] === null) continue;
            const to = write * SIZE.cols + col;
            if (to !== from) {
                board[to] = board[from];
                board[from] = null;
                drops[to] = write - row;
            }
            write--;
        }
        gaps.push(write + 1);
    }
    for (let col = 0; col < SIZE.cols; col++) {
        for (let row = gaps[col] - 1; row >= 0; row--) {
            const index = row * SIZE.cols + col;
            if (safe) safeKind(board, index, kinds);
            else board[index] = { kind: Math.floor(Math.random() * kinds), special: '' };
            drops[index] = gaps[col];
        }
    }
    return drops;
};

// Plays a valid swap to the end: clears lines, sets off specials, drops and refills, and repeats while new
// lines form. Changes the board and returns one step per cascade for the screen to replay.
const playSwap = (board, a, b, kinds) => {
    swapCells(board, a, b);
    const steps = [];
    let forced = jarSwap(board, a, b);
    for (let chain = 1; ; chain++) {
        const clear = new Set(forced ?? []);
        const made = [];
        if (!forced) {
            const runs = findRuns(board);
            if (!runs.length) break;
            runs.forEach((run) => {
                run.cells.forEach((index) => clear.add(index));
                if (run.cells.length < 4) return;
                // Four in a line leaves a grinder, five or more leaves a jar, where the moved piece landed if it can.
                const moved = chain === 1 ? run.cells.find((index) => index === a || index === b) : undefined;
                const index = moved ?? run.cells[Math.floor(run.cells.length / 2)];
                if (made.some((piece) => piece.index === index)) return;
                made.push(run.cells.length >= 5
                    ? { index, kind: JAR, special: 'jar' }
                    : { index, kind: board[index].kind, special: run.across ? 'row' : 'col' });
            });
        }
        forced = null;

        const blasts = [];
        const queue = [...clear];
        for (let at = 0; at < queue.length; at++) {
            const index = queue[at];
            const { special } = board[index];
            if (!special) continue;
            blasts.push({ index, special });
            const reach = special === 'jar' ? cellsOfKind(board, commonestKind(board, kinds)) : lineOf(index, special === 'row');
            reach.forEach((target) => {
                if (clear.has(target)) return;
                clear.add(target);
                queue.push(target);
            });
        }

        made.forEach((piece) => clear.delete(piece.index));
        const cleared = [...clear];
        const points = (cleared.length * POINTS.piece + blasts.length * POINTS.blast) * chain;
        cleared.forEach((index) => {
            board[index] = null;
        });
        made.forEach((piece) => {
            board[piece.index] = { kind: piece.kind, special: piece.special };
        });
        const drops = collapse(board, kinds, chain >= CASCADE_CAP);
        steps.push({ chain, cleared, made, blasts, points, drops, after: snapshot(board) });
    }
    return steps;
};

const newGame = (level) => {
    const spec = levelSpec(level);
    return { level, spec, board: newBoard(spec.kinds), score: 0, moves: spec.moves, status: 'playing' };
};

// Plays one move of a level. Returns null for a swap that makes no match, otherwise the cascade steps and,
// when the board was left without a move, the reshuffled board.
const makeMove = (game, a, b) => {
    if (game.status !== 'playing' || !validSwap(game.board, a, b)) return null;
    const steps = playSwap(game.board, a, b, game.spec.kinds);
    game.moves--;
    steps.forEach((step) => {
        game.score += step.points;
    });
    if (game.moves === 0 || game.score >= game.spec.stars[2]) {
        game.status = game.score >= game.spec.target ? 'won' : 'lost';
        return { steps, shuffled: null };
    }
    let shuffled = null;
    if (!findMoves(game.board).length) {
        game.board = shuffleBoard(game.board, game.spec.kinds);
        shuffled = snapshot(game.board);
    }
    return { steps, shuffled };
};

// ---- End of game rules ----

const STORE = { stars: 'arcade.spice-swap.stars', best: 'arcade.spice-swap.best' };
const MAX_CELL = 74;
const TIMES = { swap: 130, clear: 190, fall: 95, shuffle: 240, notice: 750, end: 600 };
const PAINT = {
    frame: '#1b0d08', tile: '#3d241a', tileAlt: '#46291d', ink: '#fff3dc', dark: '#1b0d08',
    pick: '#ffd24a', cursor: '#fff3dc', hint: '#7fe3c4', banner: '#ffd24a',
    jar: '#fff3dc', lid: '#ffd24a', arrow: '#ffffff', stem: '#6fd16a'
};
// Every spice has its own colour and its own outline, so colour is never the only clue.
const SPICES = [
    { name: 'chili', fill: '#ff5a47', shade: '#b92c1d' },
    { name: 'mustard', fill: '#ffd24a', shade: '#b98a0c' },
    { name: 'leaf', fill: '#6fd16a', shade: '#2f8a3a' },
    { name: 'anise', fill: '#ff9838', shade: '#a8520c' },
    { name: 'salt', fill: '#bfe9ff', shade: '#5a9cc4' },
    { name: 'fig', fill: '#b68cff', shade: '#6b43c2' }
];
const KEY_STEPS = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };

const root = document.getElementById('game');
const boardBox = document.getElementById('board');
const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');
const notice = document.getElementById('notice');
const hud = {
    level: document.getElementById('level'),
    moves: document.getElementById('moves'),
    score: document.getElementById('score'),
    target: document.getElementById('target'),
    meter: document.getElementById('meter'),
    stars: [...document.querySelectorAll('#hud-stars .star')]
};
const screens = {
    ready: document.getElementById('start-screen'),
    over: document.getElementById('end-screen')
};
const startButton = document.getElementById('start');
const nextButton = document.getElementById('next');
const againButton = document.getElementById('again');
const levelDown = document.getElementById('level-down');
const levelUp = document.getElementById('level-up');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const readStore = (key, fallback) => {
    try {
        return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
        return fallback;
    }
};

const writeStore = (key, value) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Storage is blocked: progress lasts for this visit only.
    }
};

const savedStars = readStore(STORE.stars, []);
// Stars earned per level, level 1 first.
const stars = Array.from({ length: LEVELS }, (_, index) => Math.min(3, Math.max(0, Number(Array.isArray(savedStars) && savedStars[index]) || 0)));
let best = Number(readStore(STORE.best, 0)) || 0;
let chosenLevel = 1;
let game = newGame(1);
// One sprite per cell: the piece, how far it is drawn from its cell (in cells), and its size.
let sprites = [];
let cell = 48;
let busy = false;
let picked = null;
let cursor = 24;
let cursorShown = false;
let hint = null;
let drag = null;
let floats = [];
let blasts = [];
let banner = '';
let shownScore = 0;
let endTimer = null;

// Levels open one at a time: the first level without a star is the furthest one on offer.
const unlocked = () => {
    const open = stars.findIndex((count) => count === 0);
    return open < 0 ? LEVELS : open + 1;
};
const totalStars = () => stars.reduce((sum, count) => sum + count, 0);

const setState = (state) => {
    root.dataset.state = state;
    Object.entries(screens).forEach(([name, screen]) => {
        screen.hidden = name !== state;
    });
};

const say = (text, tone) => {
    notice.textContent = text;
    notice.dataset.tone = tone;
};

const paintStars = (icons, count) => {
    icons.forEach((icon, index) => icon.classList.toggle('on', index < count));
};

const syncHud = () => {
    hud.level.textContent = game.level;
    hud.moves.textContent = game.moves;
    hud.score.textContent = shownScore;
    hud.target.textContent = game.spec.target;
    hud.meter.style.width = `${Math.min(100, (shownScore / game.spec.stars[2]) * 100)}%`;
    paintStars(hud.stars, starsFor(game.spec, shownScore));
};

const spritesFrom = (cells) => cells.map((piece) => ({ kind: piece.kind, special: piece.special, dx: 0, dy: 0, scale: 1 }));

const showLevelChoice = () => {
    const spec = levelSpec(chosenLevel);
    document.getElementById('level-name').textContent = `Level ${chosenLevel}`;
    document.getElementById('level-goal').textContent = `${spec.target} points, ${spec.moves} moves`;
    paintStars([...document.querySelectorAll('#level-stars .star')], stars[chosenLevel - 1]);
    levelDown.disabled = chosenLevel === 1;
    levelUp.disabled = chosenLevel >= unlocked();
    startButton.textContent = `Play level ${chosenLevel}`;
    document.getElementById('start-best').textContent = best ? `Best score ${best}. Stars ${totalStars()} of ${LEVELS * 3}.` : '';
};

const showStart = () => {
    clearTimeout(endTimer);
    chosenLevel = Math.min(chosenLevel, unlocked());
    showLevelChoice();
    setState('ready');
    startButton.focus();
};

const startLevel = (level) => {
    clearTimeout(endTimer);
    game = newGame(level);
    chosenLevel = level;
    sprites = spritesFrom(game.board);
    busy = false;
    picked = null;
    hint = null;
    drag = null;
    floats = [];
    blasts = [];
    banner = '';
    shownScore = 0;
    syncHud();
    say(`Level ${level}: score ${game.spec.target} in ${game.spec.moves} moves.`, 'plain');
    setState('playing');
    document.activeElement?.blur();
    render();
};

const showEnd = () => {
    const won = game.status === 'won';
    const earned = starsFor(game.spec, game.score);
    const newBest = game.score > best;
    if (newBest) {
        best = game.score;
        writeStore(STORE.best, best);
    }
    if (earned > stars[game.level - 1]) {
        stars[game.level - 1] = earned;
        writeStore(STORE.stars, stars);
    }
    const hasNext = won && game.level < LEVELS;
    document.getElementById('end-title').textContent = won ? `Level ${game.level} complete` : 'Out of moves';
    const reason = document.getElementById('end-reason');
    reason.textContent = won
        ? `You scored ${game.score}, past the ${game.spec.target} needed.`
        : `You scored ${game.score} of the ${game.spec.target} needed.`;
    reason.classList.toggle('won', won);
    document.getElementById('end-note').textContent = newBest ? 'New best score.' : '';
    paintStars([...document.querySelectorAll('#end-stars .star')], earned);
    document.getElementById('end-stars').setAttribute('aria-label', `${earned} of 3 stars`);
    document.getElementById('end-score').textContent = game.score;
    document.getElementById('end-best').textContent = best;
    document.getElementById('end-level-stars').textContent = `${stars[game.level - 1]} of 3`;
    document.getElementById('end-total').textContent = `${totalStars()} of ${LEVELS * 3}`;
    nextButton.hidden = !hasNext;
    againButton.classList.toggle('primary', !hasNext);
    setState('over');
    (hasNext ? nextButton : againButton).focus();
};

const sizeCanvas = () => {
    const fit = Math.floor(Math.min(boardBox.clientWidth / SIZE.cols, boardBox.clientHeight / SIZE.rows, MAX_CELL));
    if (fit < 10) return;
    const ratio = window.devicePixelRatio || 1;
    cell = fit;
    canvas.style.width = `${cell * SIZE.cols}px`;
    canvas.style.height = `${cell * SIZE.rows}px`;
    canvas.width = Math.round(cell * SIZE.cols * ratio);
    canvas.height = Math.round(cell * SIZE.rows * ratio);
    render();
};

// Shapes are drawn inside a circle of radius 1 around 0, 0.
const SHAPES = {
    chili: (spice) => {
        ctx.beginPath();
        ctx.moveTo(0.3, -0.72);
        ctx.bezierCurveTo(1.05, -0.3, 0.6, 0.9, -0.92, 0.72);
        ctx.bezierCurveTo(-0.15, 0.42, 0.12, -0.1, -0.02, -0.52);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = PAINT.stem;
        ctx.lineWidth = 0.22;
        ctx.beginPath();
        ctx.moveTo(0.14, -0.64);
        ctx.lineTo(0.42, -0.98);
        ctx.stroke();
        ctx.strokeStyle = spice.shade;
        ctx.lineWidth = 0.1;
        ctx.beginPath();
        ctx.moveTo(0.42, -0.2);
        ctx.quadraticCurveTo(0.3, 0.42, -0.3, 0.58);
        ctx.stroke();
    },
    mustard: (spice) => {
        ctx.beginPath();
        ctx.arc(0, 0, 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = spice.shade;
        ctx.lineWidth = 0.13;
        ctx.beginPath();
        ctx.arc(0, 0, 0.42, 0, Math.PI * 2);
        ctx.stroke();
    },
    leaf: (spice) => {
        ctx.beginPath();
        ctx.moveTo(-0.84, 0.84);
        ctx.quadraticCurveTo(-0.95, -0.95, 0.84, -0.84);
        ctx.quadraticCurveTo(0.95, 0.95, -0.84, 0.84);
        ctx.fill();
        ctx.strokeStyle = spice.shade;
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        ctx.moveTo(-0.6, 0.6);
        ctx.lineTo(0.55, -0.55);
        ctx.moveTo(-0.1, 0.1);
        ctx.lineTo(-0.1, -0.38);
        ctx.moveTo(-0.1, 0.1);
        ctx.lineTo(0.38, 0.1);
        ctx.stroke();
    },
    anise: (spice) => {
        ctx.beginPath();
        for (let point = 0; point < 16; point++) {
            const angle = (point / 16) * Math.PI * 2 - Math.PI / 2;
            const reach = point % 2 ? 0.46 : 0.98;
            ctx.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = spice.shade;
        ctx.beginPath();
        ctx.arc(0, 0, 0.22, 0, Math.PI * 2);
        ctx.fill();
    },
    salt: (spice) => {
        ctx.beginPath();
        ctx.moveTo(0, -0.96);
        ctx.lineTo(0.82, 0);
        ctx.lineTo(0, 0.96);
        ctx.lineTo(-0.82, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = spice.shade;
        ctx.lineWidth = 0.1;
        ctx.beginPath();
        ctx.moveTo(-0.82, 0);
        ctx.lineTo(0.82, 0);
        ctx.moveTo(0, -0.96);
        ctx.lineTo(-0.3, 0);
        ctx.lineTo(0, 0.96);
        ctx.lineTo(0.3, 0);
        ctx.closePath();
        ctx.stroke();
    },
    fig: (spice) => {
        ctx.beginPath();
        ctx.moveTo(0, -0.98);
        ctx.bezierCurveTo(0.3, -0.5, 0.86, -0.1, 0.86, 0.32);
        ctx.bezierCurveTo(0.86, 0.9, -0.86, 0.9, -0.86, 0.32);
        ctx.bezierCurveTo(-0.86, -0.1, -0.3, -0.5, 0, -0.98);
        ctx.fill();
        ctx.strokeStyle = spice.shade;
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        ctx.arc(0, 0.3, 0.45, Math.PI * 0.15, Math.PI * 0.75);
        ctx.stroke();
    }
};

const drawJar = () => {
    ctx.fillStyle = PAINT.jar;
    ctx.beginPath();
    ctx.roundRect(-0.74, -0.52, 1.48, 1.5, 0.34);
    ctx.fill();
    ctx.fillStyle = PAINT.lid;
    ctx.beginPath();
    ctx.roundRect(-0.56, -0.98, 1.12, 0.4, 0.12);
    ctx.fill();
    const dots = [[-0.34, 0.02, SPICES[0].fill], [0.3, 0.1, SPICES[2].shade], [-0.02, 0.5, SPICES[5].shade], [0.34, 0.58, SPICES[3].fill], [-0.38, 0.6, SPICES[4].shade]];
    dots.forEach(([x, y, color]) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 0.2, 0, Math.PI * 2);
        ctx.fill();
    });
};

// A grinder sits on a bar with an arrowhead at each end, pointing along the line it will clear.
const drawArrows = (across) => {
    ctx.save();
    if (!across) ctx.rotate(Math.PI / 2);
    ctx.fillStyle = PAINT.arrow;
    ctx.fillRect(-0.95, -0.11, 1.9, 0.22);
    [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.moveTo(side * 1.27, 0);
        ctx.lineTo(side * 0.86, -0.4);
        ctx.lineTo(side * 0.86, 0.4);
        ctx.closePath();
        ctx.fill();
    });
    ctx.restore();
};

const drawPiece = (sprite, x, y) => {
    const radius = cell * 0.36 * sprite.scale;
    if (radius <= 0.5) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(radius, radius);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (sprite.kind === JAR) {
        drawJar();
    } else {
        const spice = SPICES[sprite.kind];
        if (sprite.special) {
            drawArrows(sprite.special === 'row');
            ctx.scale(0.8, 0.8);
        }
        ctx.fillStyle = spice.fill;
        SHAPES[spice.name](spice);
    }
    ctx.restore();
};

const ring = (index, color, dashed) => {
    const x = colOf(index) * cell;
    const y = rowOf(index) * cell;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash(dashed ? [6, 5] : []);
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 3, cell - 6, cell - 6, cell * 0.2);
    ctx.stroke();
    ctx.setLineDash([]);
};

const render = () => {
    const ratio = canvas.width / (cell * SIZE.cols);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = PAINT.frame;
    ctx.fillRect(0, 0, cell * SIZE.cols, cell * SIZE.rows);
    for (let index = 0; index < CELLS; index++) {
        ctx.fillStyle = (rowOf(index) + colOf(index)) % 2 ? PAINT.tileAlt : PAINT.tile;
        ctx.beginPath();
        ctx.roundRect(colOf(index) * cell + 1.5, rowOf(index) * cell + 1.5, cell - 3, cell - 3, cell * 0.16);
        ctx.fill();
    }
    blasts.forEach((blast) => {
        const thick = cell * 0.5 * (1 - blast.life);
        ctx.fillStyle = PAINT.banner;
        if (blast.special === 'row') ctx.fillRect(0, (rowOf(blast.index) + 0.5) * cell - thick / 2, cell * SIZE.cols, thick);
        if (blast.special === 'col') ctx.fillRect((colOf(blast.index) + 0.5) * cell - thick / 2, 0, thick, cell * SIZE.rows);
    });
    if (picked !== null) ring(picked, PAINT.pick, false);
    if (hint) hint.forEach((index) => ring(index, PAINT.hint, true));
    // Pieces falling in from above the board are clipped by the canvas edge.
    sprites.forEach((sprite, index) => {
        drawPiece(sprite, (colOf(index) + 0.5 + sprite.dx) * cell, (rowOf(index) + 0.5 + sprite.dy) * cell);
    });
    if (cursorShown && root.dataset.state === 'playing') ring(cursor, PAINT.cursor, picked !== cursor);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    floats.forEach((float) => {
        ctx.font = `800 ${Math.max(18, cell * 0.42)}px "Bricolage Grotesque", system-ui, sans-serif`;
        ctx.lineWidth = 5;
        ctx.strokeStyle = PAINT.dark;
        ctx.strokeText(float.text, float.x * cell, (float.y - float.life * 0.5) * cell);
        ctx.fillStyle = PAINT.ink;
        ctx.fillText(float.text, float.x * cell, (float.y - float.life * 0.5) * cell);
    });
    if (banner) {
        const width = cell * SIZE.cols;
        const middle = (cell * SIZE.rows) / 2;
        ctx.fillStyle = PAINT.banner;
        ctx.fillRect(0, middle - 34, width, 68);
        ctx.fillStyle = PAINT.dark;
        ctx.font = '800 20px "Bricolage Grotesque", system-ui, sans-serif';
        ctx.fillText(banner, width / 2, middle);
    }
};

// Runs draw(0..1) over the given time and resolves when done. With reduced motion it jumps to the end.
const tween = (ms, draw) => new Promise((resolve) => {
    if (reducedMotion.matches || ms <= 0) {
        draw(1);
        render();
        resolve();
        return;
    }
    const start = performance.now();
    const tick = (now) => {
        const progress = Math.min(1, Math.max(0, (now - start) / ms));
        draw(progress);
        render();
        if (progress < 1) requestAnimationFrame(tick);
        else resolve();
    };
    requestAnimationFrame(tick);
});

const pauseFor = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

const slide = (a, b, amount) => {
    const dx = (colOf(b) - colOf(a)) * amount;
    const dy = (rowOf(b) - rowOf(a)) * amount;
    Object.assign(sprites[a], { dx, dy });
    Object.assign(sprites[b], { dx: -dx, dy: -dy });
};

const playStep = async (step) => {
    step.made.forEach((piece) => {
        sprites[piece.index] = { kind: piece.kind, special: piece.special, dx: 0, dy: 0, scale: 1 };
    });
    const middle = step.cleared.reduce((sum, index) => [sum[0] + colOf(index) + 0.5, sum[1] + rowOf(index) + 0.5], [0, 0]);
    floats = [{ text: `+${step.points}`, x: middle[0] / step.cleared.length, y: middle[1] / step.cleared.length, life: 0 }];
    blasts = step.blasts.map((blast) => ({ ...blast, life: 0 }));
    shownScore += step.points;
    syncHud();
    const sparked = step.blasts.length ? (step.blasts.some((blast) => blast.special === 'jar') ? 'Jar opened' : 'Grinder fired') : '';
    const label = step.chain > 1 ? `Cascade x${step.chain}` : sparked || 'Match';
    say(`${label}: +${step.points}`, 'good');
    await tween(TIMES.clear, (progress) => {
        step.cleared.forEach((index) => {
            sprites[index].scale = 1 - progress;
        });
        step.made.forEach((piece) => {
            sprites[piece.index].scale = 1 + 0.3 * (1 - progress);
        });
        floats[0].life = progress;
        blasts.forEach((blast) => {
            blast.life = progress;
        });
    });
    blasts = [];
    sprites = spritesFrom(step.after);
    const deepest = Math.max(...step.drops);
    await tween(TIMES.fall * Math.sqrt(deepest), (progress) => {
        const left = 1 - progress * progress;
        sprites.forEach((sprite, index) => {
            sprite.dy = -step.drops[index] * left;
        });
    });
    floats = [];
};

const attempt = async (a, b) => {
    if (busy || root.dataset.state !== 'playing') return;
    busy = true;
    picked = null;
    hint = null;
    const valid = validSwap(game.board, a, b);
    await tween(TIMES.swap, (progress) => slide(a, b, progress));
    if (!valid) {
        await tween(TIMES.swap, (progress) => slide(a, b, 1 - progress));
        say('No match there, so they slide back.', 'warn');
    } else {
        slide(a, b, 0);
        [sprites[a], sprites[b]] = [sprites[b], sprites[a]];
        const result = makeMove(game, a, b);
        hud.moves.textContent = game.moves;
        for (const step of result.steps) await playStep(step);
        if (result.shuffled) {
            banner = 'No moves left: shuffling';
            say('No moves left. Shuffling the rack.', 'warn');
            await tween(TIMES.shuffle, (progress) => sprites.forEach((sprite) => {
                sprite.scale = 1 - progress;
            }));
            await pauseFor(TIMES.notice);
            sprites = spritesFrom(result.shuffled);
            banner = '';
            await tween(TIMES.shuffle, (progress) => sprites.forEach((sprite) => {
                sprite.scale = progress;
            }));
        }
        if (game.status !== 'playing') {
            root.dataset.state = 'ending';
            endTimer = setTimeout(showEnd, TIMES.end);
        }
    }
    busy = false;
    // A finger still on the board starts a fresh drag from where it is now, so swaps chain without lifting.
    if (drag) Object.assign(drag, { cell: cellAt(drag.lastX, drag.lastY), x: drag.lastX, y: drag.lastY, spent: false, moved: true });
    render();
};

const cellAt = (clientX, clientY) => {
    const box = canvas.getBoundingClientRect();
    const col = Math.floor((clientX - box.left) / cell);
    const row = Math.floor((clientY - box.top) / cell);
    return col >= 0 && col < SIZE.cols && row >= 0 && row < SIZE.rows ? row * SIZE.cols + col : null;
};

const neighbour = (index, [rowStep, colStep]) => {
    const row = rowOf(index) + rowStep;
    const col = colOf(index) + colStep;
    return row >= 0 && row < SIZE.rows && col >= 0 && col < SIZE.cols ? row * SIZE.cols + col : null;
};

canvas.addEventListener('pointerdown', (event) => {
    if (root.dataset.state !== 'playing') return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    cursorShown = false;
    drag = { id: event.pointerId, cell: cellAt(event.clientX, event.clientY), x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, spent: false, moved: false };
    render();
});

canvas.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (busy || drag.spent || drag.cell === null) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    // The swap fires as soon as the finger has clearly set off toward a neighbour.
    if (Math.max(Math.abs(dx), Math.abs(dy)) < Math.max(12, cell * 0.3)) return;
    const step = Math.abs(dx) > Math.abs(dy) ? [0, Math.sign(dx)] : [Math.sign(dy), 0];
    const target = neighbour(drag.cell, step);
    drag.spent = true;
    if (target !== null) attempt(drag.cell, target);
});

canvas.addEventListener('pointerup', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const { cell: tapped, spent, moved } = drag;
    drag = null;
    if (busy || spent || moved || tapped === null || root.dataset.state !== 'playing') return;
    // A tap picks a piece. A second tap on a neighbour swaps the two.
    if (picked !== null && adjacent(picked, tapped)) {
        attempt(picked, tapped);
        return;
    }
    picked = picked === tapped ? null : tapped;
    hint = null;
    render();
});

canvas.addEventListener('pointercancel', () => {
    drag = null;
});

const showHint = () => {
    if (busy || root.dataset.state !== 'playing') return;
    const moves = findMoves(game.board);
    hint = moves[Math.floor(Math.random() * moves.length)];
    say('Try swapping the two marked spices.', 'plain');
    render();
};

window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const state = root.dataset.state;
    const onControl = document.activeElement?.closest('button, a');
    const confirm = event.key === 'Enter' || event.key === ' ';
    if (state !== 'playing') {
        if (confirm && !onControl && (state === 'ready' || state === 'over')) {
            event.preventDefault();
            startLevel(state === 'over' && game.status === 'won' && game.level < LEVELS ? game.level + 1 : chosenLevel);
        }
        return;
    }
    if (KEY_STEPS[event.key]) {
        event.preventDefault();
        if (busy) return;
        cursorShown = true;
        if (picked !== null) {
            // With a piece picked, an arrow swaps it that way.
            const target = neighbour(picked, KEY_STEPS[event.key]);
            const from = picked;
            picked = null;
            if (target !== null) attempt(from, target);
        } else {
            cursor = neighbour(cursor, KEY_STEPS[event.key]) ?? cursor;
        }
        render();
    } else if (confirm && !onControl) {
        event.preventDefault();
        if (busy) return;
        cursorShown = true;
        picked = picked === null ? cursor : null;
        hint = null;
        render();
    } else if (event.key === 'Escape') {
        picked = null;
        render();
    } else if (event.key.toLowerCase() === 'h') {
        showHint();
    }
});

levelDown.addEventListener('click', () => {
    chosenLevel = Math.max(1, chosenLevel - 1);
    showLevelChoice();
});

levelUp.addEventListener('click', () => {
    chosenLevel = Math.min(unlocked(), chosenLevel + 1);
    showLevelChoice();
});

startButton.addEventListener('click', () => startLevel(chosenLevel));
nextButton.addEventListener('click', () => startLevel(game.level + 1));
againButton.addEventListener('click', () => startLevel(game.level));
document.getElementById('hint').addEventListener('click', showHint);
document.getElementById('levels').addEventListener('click', () => {
    if (!busy) showStart();
});

chosenLevel = unlocked();
sprites = spritesFrom(game.board);
syncHud();
showStart();
new ResizeObserver(sizeCanvas).observe(boardBox);
