// ---- Maze generation (pure, also loaded by the solvability test) ----

// Columns and rows for each weekday, Monday first.
const SIZES = [[8, 10], [9, 11], [10, 12], [11, 14], [12, 15], [14, 17], [16, 20]];

// Each cell stores the directions that are open as a bit mask.
const DIRS = {
    up: { dx: 0, dy: -1, bit: 1, back: 4 },
    right: { dx: 1, dy: 0, bit: 2, back: 8 },
    down: { dx: 0, dy: 1, bit: 4, back: 1 },
    left: { dx: -1, dy: 0, bit: 8, back: 2 }
};

const mulberry32 = (seed) => {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

// Growing tree: usually extends the newest cell (long corridors), sometimes a random one (more branches).
// Every cell is joined to the tree exactly once, so there is exactly one path between any two cells.
const generateMaze = (cols, rows, seed) => {
    const random = mulberry32(seed);
    const cells = new Uint8Array(cols * rows);
    const joined = new Uint8Array(cols * rows);
    const steps = Object.values(DIRS);
    const active = [0];
    joined[0] = 1;
    while (active.length) {
        const pick = random() < 0.75 ? active.length - 1 : Math.floor(random() * active.length);
        const index = active[pick];
        const x = index % cols;
        const y = (index - x) / cols;
        const options = steps.filter((step) => {
            const nx = x + step.dx;
            const ny = y + step.dy;
            return nx >= 0 && ny >= 0 && nx < cols && ny < rows && !joined[ny * cols + nx];
        });
        if (!options.length) {
            active.splice(pick, 1);
            continue;
        }
        const step = options[Math.floor(random() * options.length)];
        const next = (y + step.dy) * cols + x + step.dx;
        cells[index] |= step.bit;
        cells[next] |= step.back;
        joined[next] = 1;
        active.push(next);
    }
    return { cols, rows, cells };
};

// Steps on the only route from the top left cell to the bottom right cell.
const routeLength = ({ cols, cells }) => {
    const distance = new Int32Array(cells.length).fill(-1);
    const queue = [0];
    distance[0] = 0;
    for (let head = 0; distance[cells.length - 1] < 0; head++) {
        const index = queue[head];
        Object.values(DIRS).forEach((dir) => {
            const next = index + dir.dy * cols + dir.dx;
            if (cells[index] & dir.bit && distance[next] < 0) {
                distance[next] = distance[index] + 1;
                queue.push(next);
            }
        });
    }
    return distance[cells.length - 1];
};

// A seed names five candidate mazes and the one with the longest route wins, so no maze is a straight dash.
const mazeForSeed = (cols, rows, seed) => {
    let best = null;
    for (let variant = 0; variant < 5; variant++) {
        const maze = generateMaze(cols, rows, seed * 8 + variant);
        maze.route = routeLength(maze);
        if (!best || maze.route > best.route) best = maze;
    }
    return best;
};

const dateKey = (date) =>
    `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;

const mazeForDate = (date) => mazeForSeed(...SIZES[(date.getDay() + 6) % 7], Number(dateKey(date)));

// ---- End of maze generation ----

const STORE_KEY = 'arcade.daily-maze.days';
const STEP_MS = 70;
const HOLD_DELAY_MS = 180;
const MAX_CELL = 40;
const KEY_DIRS = {
    ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', ArrowLeft: 'left',
    w: 'up', d: 'right', s: 'down', a: 'left'
};
const PAINT = {
    board: '#fffaf0', wall: '#1c2333', trail: '#ffc4ba', token: '#ff6b5e',
    goal: '#12877f', solvedTrail: '#a6ded7', start: '#d9cdb6'
};

const root = document.getElementById('game');
const board = document.getElementById('board');
const canvas = document.getElementById('maze');
const ctx = canvas.getContext('2d');
const timeEl = document.getElementById('time');
const movesEl = document.getElementById('moves');
const captionEl = document.getElementById('caption');
const startScreen = document.getElementById('start-screen');
const endScreen = document.getElementById('end-screen');
const startButton = document.getElementById('start');
const againButton = document.getElementById('again');
const copyButton = document.getElementById('copy');
const switchButton = document.getElementById('switch');
const copyStatus = document.getElementById('copy-status');
const copyText = document.getElementById('copy-text');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const today = new Date();
const todayKey = dateKey(today);
const todayLabel = today.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

const loadDays = () => {
    try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY));
        return saved && typeof saved === 'object' ? saved : {};
    } catch {
        return {};
    }
};

const days = loadDays();

const saveDays = () => {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(days));
    } catch {
        // Storage is blocked: the result still counts for this visit.
    }
};

let game = null;
let cell = 20;
let wall = 2;
let runTimer = null;
let heldKey = null;
let pointer = null;
let endShownAt = 0;

const pad2 = (value) => String(value).padStart(2, '0');

const formatTime = (ms) => {
    const hundredths = Math.floor(ms / 10);
    return `${Math.floor(hundredths / 6000)}:${pad2(Math.floor(hundredths / 100) % 60)}.${pad2(hundredths % 100)}`;
};

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// Consecutive completed days ending today, or ending yesterday while today is still open.
const currentStreak = () => {
    const cursor = new Date(today);
    if (!days[todayKey]) cursor.setDate(cursor.getDate() - 1);
    let count = 0;
    while (days[dateKey(cursor)]) {
        count++;
        cursor.setDate(cursor.getDate() - 1);
    }
    return count;
};

const sizeCanvas = () => {
    const { cols, rows } = game.maze;
    wall = Math.min(board.clientWidth / cols, board.clientHeight / rows) >= 28 ? 3 : 2;
    cell = Math.floor(Math.min((board.clientWidth - wall) / cols, (board.clientHeight - wall) / rows, MAX_CELL));
    if (cell < 4) return;
    const width = cols * cell + wall;
    const height = rows * cell + wall;
    const ratio = window.devicePixelRatio || 1;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw(performance.now());
};

const draw = (now) => {
    const { cols, rows, cells } = game.maze;
    const center = (index) => (index + 0.5) * cell;
    ctx.save();
    ctx.fillStyle = PAINT.board;
    ctx.fillRect(0, 0, cols * cell + wall, rows * cell + wall);
    ctx.translate(wall / 2, wall / 2);

    ctx.strokeStyle = game.solved ? PAINT.solvedTrail : PAINT.trail;
    ctx.lineWidth = cell * 0.38;
    ctx.lineCap = 'round';
    ctx.beginPath();
    game.edges.forEach((edge) => {
        const from = Math.floor(edge / cells.length);
        const to = edge % cells.length;
        ctx.moveTo(center(from % cols), center(Math.floor(from / cols)));
        ctx.lineTo(center(to % cols), center(Math.floor(to / cols)));
    });
    ctx.stroke();

    ctx.strokeStyle = PAINT.start;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center(0), center(0), cell * 0.3, 0, Math.PI * 2);
    ctx.stroke();

    // Goal flag in the bottom right cell.
    const gx = (cols - 1) * cell;
    const gy = (rows - 1) * cell;
    ctx.fillStyle = PAINT.goal;
    ctx.strokeStyle = PAINT.goal;
    ctx.lineWidth = Math.max(2, cell * 0.09);
    ctx.beginPath();
    ctx.moveTo(gx + cell * 0.32, gy + cell * 0.82);
    ctx.lineTo(gx + cell * 0.32, gy + cell * 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gx + cell * 0.32, gy + cell * 0.18);
    ctx.lineTo(gx + cell * 0.8, gy + cell * 0.36);
    ctx.lineTo(gx + cell * 0.32, gy + cell * 0.56);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = PAINT.wall;
    ctx.lineWidth = wall;
    ctx.lineCap = 'square';
    ctx.beginPath();
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const open = cells[y * cols + x];
            if (!(open & DIRS.up.bit)) {
                ctx.moveTo(x * cell, y * cell);
                ctx.lineTo((x + 1) * cell, y * cell);
            }
            if (!(open & DIRS.left.bit)) {
                ctx.moveTo(x * cell, y * cell);
                ctx.lineTo(x * cell, (y + 1) * cell);
            }
        }
    }
    ctx.moveTo(0, rows * cell);
    ctx.lineTo(cols * cell, rows * cell);
    ctx.lineTo(cols * cell, 0);
    ctx.stroke();

    const glide = reducedMotion.matches ? 1 : Math.min(1, (now - game.movedAt) / STEP_MS);
    const tx = game.fromX + (game.x - game.fromX) * glide;
    const ty = game.fromY + (game.y - game.fromY) * glide;
    ctx.fillStyle = PAINT.token;
    ctx.strokeStyle = PAINT.wall;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center(tx), center(ty), cell * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
};

const stopRun = () => {
    clearTimeout(runTimer);
    runTimer = null;
};

const resetRun = () => {
    stopRun();
    Object.assign(game, {
        x: 0, y: 0, fromX: 0, fromY: 0, movedAt: 0,
        moves: 0, edges: new Set(), startedAt: null, solved: false
    });
    timeEl.textContent = formatTime(0);
    movesEl.textContent = '0';
    draw(performance.now());
};

const loadMaze = (mode) => {
    const seed = mode === 'daily' ? Number(todayKey) : Math.floor(Math.random() * 900000) + 100000;
    const maze = mode === 'daily'
        ? mazeForDate(today)
        : mazeForSeed(...SIZES[Math.floor(Math.random() * SIZES.length)], seed);
    game = { mode, seed, maze };
    root.dataset.mode = mode;
    root.dataset.seed = seed;
    captionEl.textContent = `${mode === 'daily' ? todayLabel : `Practice ${seed}`}, ${maze.cols} by ${maze.rows}`;
    resetRun();
    sizeCanvas();
};

const setPhase = (phase) => {
    root.dataset.state = phase;
    startScreen.hidden = phase !== 'ready';
    endScreen.hidden = phase !== 'over';
};

const play = (mode) => {
    if (!game || game.mode !== mode || mode === 'practice') loadMaze(mode);
    else resetRun();
    setPhase('playing');
    document.activeElement?.blur();
};

const resultText = () => {
    const entry = days[todayKey];
    const { cols, rows } = game.maze;
    const iso = `${todayKey.slice(0, 4)}-${todayKey.slice(4, 6)}-${todayKey.slice(6)}`;
    return [
        `Daily Maze ${iso}`,
        `${today.toLocaleDateString('en-US', { weekday: 'long' })}, ${cols} by ${rows}`,
        `Time ${formatTime(entry.best)}, ${plural(entry.moves, 'move')}`,
        `Streak: ${plural(currentStreak(), 'day')}`
    ].join('\n');
};

// run is the attempt that just finished, or null when showing a result saved earlier today.
const showEnd = (run) => {
    const daily = game.mode === 'daily';
    const entry = days[todayKey];
    const rows = [];
    let title = 'Maze solved';
    let note = '';
    if (!daily) {
        title = 'Practice solved';
        note = 'Practice runs do not change your daily record or streak.';
        rows.push(['Time', formatTime(run.time)], ['Moves', run.moves],
            ['Today\'s best', entry ? formatTime(entry.best) : 'Not yet'], ['Streak', plural(currentStreak(), 'day')]);
    } else if (run) {
        if (entry.runs === 1) note = 'A new maze arrives tomorrow.';
        else note = run.best ? 'New best for today.' : 'Today\'s best still stands.';
        rows.push(['Time', formatTime(run.time)], ['Moves', run.moves],
            ['Today\'s best', formatTime(entry.best)], ['Streak', plural(currentStreak(), 'day')]);
    } else {
        title = 'Solved today';
        note = 'Your result is saved. Run it again to beat your time.';
        rows.push(['Best time', formatTime(entry.best)], ['Moves', entry.moves],
            ['Runs today', entry.runs], ['Streak', plural(currentStreak(), 'day')]);
    }
    document.getElementById('end-eyebrow').textContent = captionEl.textContent;
    document.getElementById('end-title').textContent = title;
    const noteEl = document.getElementById('end-note');
    noteEl.textContent = note;
    noteEl.hidden = !note;
    noteEl.classList.toggle('plain', !daily || !run);
    document.getElementById('results').innerHTML =
        rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
    againButton.textContent = daily ? 'Run it again' : 'New practice maze';
    switchButton.textContent = daily ? 'Practice maze' : 'Today\'s maze';
    copyButton.hidden = !daily;
    copyStatus.textContent = '';
    copyText.hidden = true;
    endShownAt = performance.now();
    setPhase('over');
    againButton.focus();
};

const showHome = () => {
    if (!game || game.mode !== 'daily') loadMaze('daily');
    else resetRun();
    if (days[todayKey]) {
        showEnd(null);
        return;
    }
    const streak = currentStreak();
    document.getElementById('start-eyebrow').textContent = captionEl.textContent;
    const streakEl = document.getElementById('start-streak');
    streakEl.textContent = `Streak: ${plural(streak, 'day')}. Solve today's maze to keep it going.`;
    streakEl.hidden = streak === 0;
    setPhase('ready');
    startButton.focus();
};

const finish = (now) => {
    stopRun();
    game.solved = true;
    const run = { time: Math.max(10, Math.round(now - game.startedAt)), moves: game.moves, best: false };
    timeEl.textContent = formatTime(run.time);
    draw(now + STEP_MS);
    if (game.mode === 'daily') {
        const entry = days[todayKey] ?? { best: Infinity, moves: 0, runs: 0 };
        entry.runs++;
        if (run.time < entry.best) {
            entry.best = run.time;
            entry.moves = run.moves;
            run.best = true;
        }
        days[todayKey] = entry;
        saveDays();
    }
    showEnd(run);
};

const step = (name) => {
    if (root.dataset.state !== 'playing') return false;
    const dir = DIRS[name];
    const { cols, cells } = game.maze;
    const from = game.y * cols + game.x;
    if (!(cells[from] & dir.bit)) return false;
    const now = performance.now();
    if (game.startedAt === null) game.startedAt = now;
    game.fromX = game.x;
    game.fromY = game.y;
    game.x += dir.dx;
    game.y += dir.dy;
    game.movedAt = now;
    game.moves++;
    const to = game.y * cols + game.x;
    game.edges.add(Math.min(from, to) * cells.length + Math.max(from, to));
    movesEl.textContent = game.moves;
    if (to === cells.length - 1) finish(now);
    return true;
};

const atJunction = () => {
    const open = game.maze.cells[game.y * game.maze.cols + game.x];
    return Object.values(DIRS).filter((dir) => open & dir.bit).length > 2;
};

// Takes one step now, then keeps going in the same direction until a wall or a junction.
const startRun = (name, delay) => {
    stopRun();
    if (!step(name)) return;
    const keepGoing = () => {
        runTimer = null;
        if (atJunction() || !step(name)) return;
        runTimer = setTimeout(keepGoing, STEP_MS);
    };
    runTimer = setTimeout(keepGoing, delay);
};

const boardPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left - wall / 2) / cell, y: (event.clientY - rect.top - wall / 2) / cell };
};

// Pulls the token toward the pointer one open cell at a time.
const dragToken = (point) => {
    for (let guard = 0; guard < 60; guard++) {
        const dx = point.x - (game.x + 0.5);
        const dy = point.y - (game.y + 0.5);
        const horizontal = dx > 0 ? 'right' : 'left';
        const vertical = dy > 0 ? 'down' : 'up';
        const wantX = Math.abs(dx) > 0.6;
        const wantY = Math.abs(dy) > 0.6;
        const order = Math.abs(dx) > Math.abs(dy)
            ? [wantX && horizontal, wantY && vertical]
            : [wantY && vertical, wantX && horizontal];
        if (!order.some((name) => name && step(name))) return;
    }
};

board.addEventListener('pointerdown', (event) => {
    if (root.dataset.state !== 'playing') return;
    event.preventDefault();
    stopRun();
    const point = boardPoint(event);
    const nearToken = Math.hypot(point.x - (game.x + 0.5), point.y - (game.y + 0.5)) <= 1.3;
    pointer = { id: event.pointerId, drag: nearToken, x: event.clientX, y: event.clientY, swiped: false };
    board.setPointerCapture(event.pointerId);
});

board.addEventListener('pointermove', (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    if (pointer.drag) {
        dragToken(boardPoint(event));
        return;
    }
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (pointer.swiped || Math.hypot(dx, dy) < 24) return;
    pointer.swiped = true;
    const name = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    startRun(name, STEP_MS);
});

const endPointer = (event) => {
    if (pointer && event.pointerId === pointer.id) pointer = null;
};

board.addEventListener('pointerup', endPointer);
board.addEventListener('pointercancel', endPointer);

document.querySelectorAll('.arrow').forEach((button) => {
    const name = button.dataset.dir;
    button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        startRun(name, HOLD_DELAY_MS);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => button.addEventListener(type, stopRun));
    // Keyboard activation arrives as a click with no pointer behind it.
    button.addEventListener('click', (event) => {
        if (event.detail === 0) step(name);
    });
    button.addEventListener('contextmenu', (event) => event.preventDefault());
});

window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const state = root.dataset.state;
    const name = KEY_DIRS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (state === 'playing' && name) {
        event.preventDefault();
        if (event.repeat) return;
        heldKey = event.key;
        startRun(name, HOLD_DELAY_MS);
        return;
    }
    const onControl = document.activeElement?.closest('button, a, textarea');
    if ((event.key === 'Enter' || event.key === ' ') && !onControl) {
        event.preventDefault();
        if (state === 'ready') startButton.click();
        if (state === 'over' && performance.now() - endShownAt > 300) againButton.click();
    }
});

window.addEventListener('keyup', (event) => {
    if (event.key === heldKey) {
        heldKey = null;
        stopRun();
    }
});

window.addEventListener('blur', stopRun);

startButton.addEventListener('click', () => play('daily'));
document.getElementById('start-practice').addEventListener('click', () => play('practice'));
againButton.addEventListener('click', () => play(game.mode));
switchButton.addEventListener('click', () => {
    if (game.mode === 'daily') play('practice');
    else showHome();
});
document.getElementById('restart').addEventListener('click', () => {
    if (root.dataset.state === 'playing') resetRun();
});
document.getElementById('menu').addEventListener('click', showHome);

copyButton.addEventListener('click', async () => {
    const text = resultText();
    copyText.hidden = true;
    try {
        await navigator.clipboard.writeText(text);
        copyStatus.textContent = 'Result copied to the clipboard.';
        copyStatus.classList.remove('failed');
    } catch {
        copyStatus.textContent = 'Copying is not available here. Select the text below and copy it yourself.';
        copyStatus.classList.add('failed');
        copyText.value = text;
        copyText.hidden = false;
        copyText.select();
    }
});

const frame = (now) => {
    if (root.dataset.state === 'playing') {
        if (game.startedAt !== null) timeEl.textContent = formatTime(now - game.startedAt);
        draw(now);
    }
    requestAnimationFrame(frame);
};

showHome();
new ResizeObserver(sizeCanvas).observe(board);
requestAnimationFrame(frame);
