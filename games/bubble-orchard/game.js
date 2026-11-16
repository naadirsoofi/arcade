// ---- Game rules (pure: no DOM, also run by the logic test) ----

// Every row holds the same number of cells. Odd rows sit half a bubble to the right, which makes the hex packing.
const GRID = { cols: 8, rows: 13, radius: 20 };
const DIAMETER = GRID.radius * 2;
const ROW_HEIGHT = GRID.radius * Math.sqrt(3);
const FIELD = { w: GRID.cols * DIAMETER + GRID.radius, h: 530, top: 14 };
const LAUNCH = { x: FIELD.w / 2, y: 484, speed: 1100, maxAngle: 1.36, step: 4 };
// A bubble this many rows below the canopy has reached the launcher line.
const DEADLINE = 12;
// Slightly under a full diameter, so a shot can slip through a gap it visibly fits.
const TOUCH = DIAMETER * 0.86;
const POINTS = { pop: 10, extra: 10, fall: 20, clear: 250 };
const KIND_COUNT = 7;

const levelSetup = (level) => ({
    kinds: Math.min(KIND_COUNT, level < 3 ? 3 + level : level < 6 ? 6 : 7),
    rows: Math.min(8, 4 + Math.ceil(level / 2)),
    dropEvery: Math.max(5, 9 - Math.floor(level / 2))
});

const cellX = (row, col) => GRID.radius + col * DIAMETER + (row % 2 ? GRID.radius : 0);
const canopyY = (world) => FIELD.top + world.drop * ROW_HEIGHT;
const cellY = (world, row) => canopyY(world) + GRID.radius + row * ROW_HEIGHT;

const neighbours = (row, col) => {
    const shift = row % 2 ? 0 : -1;
    return [
        [row, col - 1], [row, col + 1],
        [row - 1, col + shift], [row - 1, col + shift + 1],
        [row + 1, col + shift], [row + 1, col + shift + 1]
    ].filter(([r, c]) => r >= 0 && r < GRID.rows && c >= 0 && c < GRID.cols);
};

const eachBubble = (world, visit) => {
    world.grid.forEach((line, row) => {
        line.forEach((kind, col) => {
            if (kind !== null) visit(row, col, kind);
        });
    });
};

const kindsOnBoard = (world) => {
    const found = new Set();
    eachBubble(world, (row, col, kind) => found.add(kind));
    return [...found].sort((a, b) => a - b);
};

// The launcher only ever loads a kind that is still up in the canopy.
const pickKind = (world) => {
    const kinds = kindsOnBoard(world);
    return kinds[Math.floor(Math.random() * kinds.length)];
};

const fillLevel = (world) => {
    const setup = levelSetup(world.level);
    world.grid = Array.from({ length: GRID.rows }, () => Array(GRID.cols).fill(null));
    for (let row = 0; row < setup.rows; row++) {
        for (let col = 0; col < GRID.cols; col++) {
            // Often copy a neighbour, so the canopy starts with small clusters to aim for.
            const near = neighbours(row, col).map(([r, c]) => world.grid[r][c]).filter((kind) => kind !== null);
            world.grid[row][col] = near.length && Math.random() < 0.4
                ? near[Math.floor(Math.random() * near.length)]
                : Math.floor(Math.random() * setup.kinds);
        }
    }
    world.drop = 0;
    world.shots = 0;
    world.shot = null;
    world.current = pickKind(world);
    world.next = pickKind(world);
    world.status = 'aiming';
};

const newWorld = () => {
    const world = { level: 1, score: 0, events: [] };
    fillLevel(world);
    return world;
};

const shotsUntilDrop = (world) => {
    const every = levelSetup(world.level).dropEvery;
    return every - (world.shots % every);
};

const clampAngle = (angle) => Math.min(LAUNCH.maxAngle, Math.max(-LAUNCH.maxAngle, angle));

const touches = (world, x, y) => {
    if (y <= canopyY(world) + GRID.radius) return true;
    let hit = false;
    eachBubble(world, (row, col) => {
        const dx = cellX(row, col) - x;
        const dy = cellY(world, row) - y;
        if (dx * dx + dy * dy < TOUCH * TOUCH) hit = true;
    });
    return hit;
};

// Moves a shot one short step, bouncing off the side walls. Returns 'stuck', 'bounced' or 'moving'.
const moveShot = (world, shot, distance) => {
    shot.x += shot.dx * distance;
    shot.y += shot.dy * distance;
    let bounced = false;
    if (shot.x < GRID.radius) {
        shot.x = 2 * GRID.radius - shot.x;
        shot.dx = -shot.dx;
        bounced = true;
    } else if (shot.x > FIELD.w - GRID.radius) {
        shot.x = 2 * (FIELD.w - GRID.radius) - shot.x;
        shot.dx = -shot.dx;
        bounced = true;
    }
    if (touches(world, shot.x, shot.y)) return 'stuck';
    return bounced ? 'bounced' : 'moving';
};

// The empty cell nearest to where the shot stopped that hangs from the canopy or from another bubble.
const snapCell = (world, x, y) => {
    let best = null;
    let nearest = Infinity;
    const lastRow = Math.min(GRID.rows - 1, DEADLINE - world.drop);
    for (let row = 0; row <= lastRow; row++) {
        for (let col = 0; col < GRID.cols; col++) {
            if (world.grid[row][col] !== null) continue;
            if (row > 0 && !neighbours(row, col).some(([r, c]) => world.grid[r][c] !== null)) continue;
            const dx = cellX(row, col) - x;
            const dy = cellY(world, row) - y;
            if (dx * dx + dy * dy < nearest) {
                nearest = dx * dx + dy * dy;
                best = [row, col];
            }
        }
    }
    return best;
};

// Every cell linked to the start cell through touching bubbles that pass the test.
const linked = (world, starts, test) => {
    const seen = new Set(starts.map(([row, col]) => row * GRID.cols + col));
    const queue = [...starts];
    for (let at = 0; at < queue.length; at++) {
        neighbours(queue[at][0], queue[at][1]).forEach(([row, col]) => {
            const kind = world.grid[row][col];
            if (kind === null || !test(kind) || seen.has(row * GRID.cols + col)) return;
            seen.add(row * GRID.cols + col);
            queue.push([row, col]);
        });
    }
    return queue;
};

const hanging = (world) => {
    const roots = [];
    world.grid[0].forEach((kind, col) => {
        if (kind !== null) roots.push([0, col]);
    });
    const held = new Set(linked(world, roots, () => true).map(([row, col]) => row * GRID.cols + col));
    const loose = [];
    eachBubble(world, (row, col) => {
        if (!held.has(row * GRID.cols + col)) loose.push([row, col]);
    });
    return loose;
};

const remove = (world, cells, type) => {
    cells.forEach(([row, col]) => {
        world.events.push({ type, x: cellX(row, col), y: cellY(world, row), kind: world.grid[row][col] });
        world.grid[row][col] = null;
    });
};

const settle = (world) => {
    const { x, y, kind } = world.shot;
    const [row, col] = snapCell(world, x, y);
    world.grid[row][col] = kind;
    world.shot = null;
    world.shots++;
    world.events.push({ type: 'stick', row, col });

    const group = linked(world, [[row, col]], (other) => other === kind);
    if (group.length >= 3) {
        remove(world, group, 'pop');
        const loose = hanging(world);
        remove(world, loose, 'fall');
        const gained = POINTS.pop * group.length + POINTS.extra * (group.length - 3) + POINTS.fall * loose.length;
        world.score += gained;
        world.events.push({ type: 'score', popped: group.length, fell: loose.length, gained });
    }

    const kinds = kindsOnBoard(world);
    if (!kinds.length) {
        world.score += POINTS.clear;
        world.status = 'cleared';
        return;
    }
    if (world.shots % levelSetup(world.level).dropEvery === 0) {
        world.drop++;
        world.events.push({ type: 'drop' });
    }
    let lowest = 0;
    eachBubble(world, (bubbleRow) => {
        lowest = Math.max(lowest, bubbleRow);
    });
    if (lowest + world.drop >= DEADLINE) {
        world.status = 'lost';
        return;
    }
    if (!kinds.includes(world.current)) world.current = pickKind(world);
    if (!kinds.includes(world.next)) world.next = pickKind(world);
    world.status = 'aiming';
};

const fire = (world, angle) => {
    if (world.status !== 'aiming') return;
    const aim = clampAngle(angle);
    world.shot = { x: LAUNCH.x, y: LAUNCH.y, dx: Math.sin(aim), dy: -Math.cos(aim), kind: world.current, owed: 0 };
    world.current = world.next;
    world.next = pickKind(world);
    world.status = 'flying';
};

const swapNext = (world) => {
    if (world.status !== 'aiming') return;
    [world.current, world.next] = [world.next, world.current];
};

const nextLevel = (world) => {
    world.level++;
    fillLevel(world);
};

const stepWorld = (world, seconds) => {
    if (world.status !== 'flying') return;
    // The shot always moves in whole steps of the same length, so it lands exactly where the aim guide says
    // whatever the frame rate. owed is the distance not yet travelled.
    world.shot.owed += LAUNCH.speed * seconds;
    while (world.shot.owed >= LAUNCH.step) {
        world.shot.owed -= LAUNCH.step;
        if (moveShot(world, world.shot, LAUNCH.step) === 'stuck') {
            settle(world);
            return;
        }
    }
};

// The path a shot would take at this angle: the launcher, the first bounce, and where it stops
// (a bubble, the canopy, or the second wall). cell is where it would settle, when the path reaches one.
const tracePath = (world, angle) => {
    const aim = clampAngle(angle);
    const ghost = { x: LAUNCH.x, y: LAUNCH.y, dx: Math.sin(aim), dy: -Math.cos(aim) };
    const points = [[ghost.x, ghost.y]];
    let bounces = 0;
    while (true) {
        const result = moveShot(world, ghost, LAUNCH.step);
        if (result === 'stuck') {
            points.push([ghost.x, ghost.y]);
            return { points, cell: snapCell(world, ghost.x, ghost.y) };
        }
        if (result === 'bounced') {
            points.push([ghost.x, ghost.y]);
            bounces++;
            if (bounces === 2) return { points, cell: null };
        }
    }
};

// ---- End of game rules ----

const STORE = { best: 'arcade.bubble-orchard.best', level: 'arcade.bubble-orchard.level' };
const MAX_SCALE = 1.45;
const END_DELAY_MS = 900;
const LEVEL_PAUSE_MS = 1500;
const NEXT = { x: 46, y: 490, radius: 15, zone: 32 };
const TURN = { slow: 0.5, fast: 1.7, rampAfter: 0.25 };
const PAINT = {
    field: '#fffdf7', stripe: '#f8f3e6', floor: '#efe8d6', ink: '#2a2140', muted: '#5d5478',
    leaf: '#2f7d4b', leafLight: '#58a86c', leafDark: '#25683d', branch: '#7a5230',
    deadline: '#b93a32', aim: '#6a55d8', ring: '#6a55d8', wash: '#ece7ff', white: '#ffffff'
};
// Every kind has its own colour and its own glyph, so colour is never the only clue.
const FRUIT = [
    { name: 'cherry', fill: '#e5484d', rim: '#b62d33', glyph: '#ffffff' },
    { name: 'lemon', fill: '#f4c531', rim: '#c79a12', glyph: '#4a3600' },
    { name: 'pear', fill: '#4fb06a', rim: '#34884d', glyph: '#ffffff' },
    { name: 'plum', fill: '#8b6cf0', rim: '#6548c9', glyph: '#ffffff' },
    { name: 'orange', fill: '#f28a2e', rim: '#c46715', glyph: '#4a2300' },
    { name: 'blueberry', fill: '#3d8fe0', rim: '#2468b3', glyph: '#ffffff' },
    { name: 'peach', fill: '#f285b5', rim: '#c95a8d', glyph: '#5a1233' }
];

const root = document.getElementById('game');
const board = document.getElementById('board');
const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');
const notice = document.getElementById('notice');
const hud = {
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    level: document.getElementById('level'),
    drop: document.getElementById('drop')
};
const screens = {
    ready: document.getElementById('start-screen'),
    over: document.getElementById('end-screen')
};
const startButton = document.getElementById('start');
const againButton = document.getElementById('again');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const readNumber = (key) => {
    try {
        return Number(localStorage.getItem(key)) || 0;
    } catch {
        return 0;
    }
};

const writeNumber = (key, value) => {
    try {
        localStorage.setItem(key, String(value));
    } catch {
        // Storage is blocked: the record lasts for this visit only.
    }
};

let best = readNumber(STORE.best);
let furthest = readNumber(STORE.level);
let world = newWorld();
// scale is CSS pixels per field unit (for pointer positions), unit is canvas pixels per field unit (for drawing).
let scale = 1;
let unit = 1;
let lastFrame = 0;
let aim = 0;
let press = null;
let turning = { dir: 0, held: 0 };
let shownDrop = 0;
let pops = [];
let fallers = [];
let banner = null;
let timer = null;

const setState = (state) => {
    root.dataset.state = state;
    Object.entries(screens).forEach(([name, screen]) => {
        screen.hidden = name !== state;
    });
};

const setText = (element, value) => {
    const text = String(value);
    if (element.textContent !== text) element.textContent = text;
};

const say = (text, tone) => {
    notice.textContent = text;
    notice.dataset.tone = tone;
};

const syncHud = () => {
    const left = shotsUntilDrop(world);
    setText(hud.score, world.score);
    setText(hud.best, Math.max(best, world.score));
    setText(hud.level, world.level);
    setText(hud.drop, left);
    hud.drop.parentElement.dataset.tone = left === 1 ? 'warn' : 'plain';
};

const showStartBest = () => {
    document.getElementById('start-best').textContent = best ? `Best score ${best}, best level ${furthest}.` : '';
};

const showEnd = () => {
    const newBest = world.score > best;
    if (newBest) {
        best = world.score;
        writeNumber(STORE.best, best);
    }
    if (world.level > furthest) {
        furthest = world.level;
        writeNumber(STORE.level, furthest);
    }
    document.getElementById('end-reason').textContent = `The fruit reached the launcher on level ${world.level}.`;
    document.getElementById('end-note').textContent = newBest ? 'New best score.' : '';
    document.getElementById('end-score').textContent = world.score;
    document.getElementById('end-best').textContent = best;
    document.getElementById('end-level').textContent = world.level;
    document.getElementById('end-furthest').textContent = furthest;
    setState('over');
    againButton.focus();
};

const startGame = () => {
    clearTimeout(timer);
    world = newWorld();
    aim = 0;
    press = null;
    turning = { dir: 0, held: 0 };
    shownDrop = 0;
    pops = [];
    fallers = [];
    banner = null;
    syncHud();
    say(`Level 1: ${levelSetup(1).kinds} kinds of fruit.`, 'plain');
    setState('playing');
    document.activeElement?.blur();
};

const startNextLevel = () => {
    nextLevel(world);
    shownDrop = 0;
    banner = null;
    syncHud();
    say(`Level ${world.level}: ${levelSetup(world.level).kinds} kinds of fruit.`, 'plain');
};

const handleEvents = () => {
    world.events.forEach((event) => {
        if (event.type === 'score') {
            const parts = [`${event.popped} popped`];
            if (event.fell) parts.push(`${event.fell} dropped`);
            say(`${parts.join(', ')}: +${event.gained}`, 'good');
        }
        if (event.type === 'drop') say('The canopy dropped a row.', 'warn');
        if (reducedMotion.matches) return;
        if (event.type === 'pop') pops.push({ x: event.x, y: event.y, kind: event.kind, age: 0 });
        // A fruit that lands without popping gets a ring, so it is clear where it settled.
        if (event.type === 'stick' && world.grid[event.row][event.col] !== null) {
            pops.push({ x: cellX(event.row, event.col), y: cellY(world, event.row), kind: null, age: 0 });
        }
        if (event.type === 'fall') fallers.push({ x: event.x, y: event.y, kind: event.kind, vx: (Math.random() - 0.5) * 80, vy: -60 - Math.random() * 80 });
    });
    world.events.length = 0;
    if (world.status === 'cleared' && !banner) {
        banner = `Level ${world.level} cleared`;
        say(`Canopy cleared: +${POINTS.clear}`, 'good');
        timer = setTimeout(startNextLevel, LEVEL_PAUSE_MS);
    }
    if (world.status === 'lost' && root.dataset.state === 'playing') {
        root.dataset.state = 'ending';
        timer = setTimeout(showEnd, END_DELAY_MS);
    }
};

const sizeCanvas = () => {
    const frame = 6;
    const fit = Math.min((board.clientWidth - frame) / FIELD.w, (board.clientHeight - frame) / FIELD.h, MAX_SCALE);
    if (fit <= 0.1) return;
    const width = Math.floor(FIELD.w * fit);
    const height = Math.floor(FIELD.h * fit);
    const ratio = window.devicePixelRatio || 1;
    scale = width / FIELD.w;
    canvas.style.width = `${width + frame}px`;
    canvas.style.height = `${height + frame}px`;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    unit = canvas.width / FIELD.w;
    render();
};

const disc = (x, y, radius, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
};

// Glyphs are drawn inside a circle of radius 1 around 0, 0.
const GLYPHS = {
    cherry: () => {
        ctx.beginPath();
        ctx.arc(-0.3, 0.28, 0.25, 0, Math.PI * 2);
        ctx.arc(0.34, 0.2, 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-0.3, 0.08);
        ctx.lineTo(0.02, -0.5);
        ctx.lineTo(0.34, 0);
        ctx.stroke();
    },
    lemon: () => {
        ctx.beginPath();
        ctx.moveTo(-0.56, 0);
        ctx.quadraticCurveTo(0, -0.62, 0.56, 0);
        ctx.quadraticCurveTo(0, 0.62, -0.56, 0);
        ctx.fill();
    },
    pear: () => {
        ctx.beginPath();
        ctx.arc(0, 0.2, 0.36, 0, Math.PI * 2);
        ctx.arc(0, -0.2, 0.23, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, -0.4);
        ctx.lineTo(0.12, -0.6);
        ctx.stroke();
    },
    plum: () => {
        ctx.beginPath();
        ctx.arc(0, 0, 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 0.1, 0, Math.PI * 2);
        ctx.fill();
    },
    orange: () => {
        ctx.beginPath();
        for (let spoke = 0; spoke < 3; spoke++) {
            const angle = (spoke / 3) * Math.PI;
            ctx.moveTo(Math.cos(angle) * 0.52, Math.sin(angle) * 0.52);
            ctx.lineTo(-Math.cos(angle) * 0.52, -Math.sin(angle) * 0.52);
        }
        ctx.stroke();
    },
    blueberry: () => {
        ctx.beginPath();
        for (let point = 0; point < 10; point++) {
            const angle = (point / 10) * Math.PI * 2 - Math.PI / 2;
            const reach = point % 2 ? 0.24 : 0.56;
            ctx.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
        }
        ctx.closePath();
        ctx.fill();
    },
    peach: () => {
        ctx.beginPath();
        ctx.moveTo(0, 0.5);
        ctx.bezierCurveTo(-0.7, 0, -0.42, -0.56, 0, -0.2);
        ctx.bezierCurveTo(0.42, -0.56, 0.7, 0, 0, 0.5);
        ctx.fill();
    }
};

const drawFruit = (kind, x, y, radius) => {
    const fruit = FRUIT[kind];
    disc(x, y, radius - 0.5, fruit.rim);
    disc(x, y, radius - 2.5, fruit.fill);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(radius, radius);
    ctx.fillStyle = fruit.glyph;
    ctx.strokeStyle = fruit.glyph;
    ctx.lineWidth = 0.15;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    GLYPHS[fruit.name]();
    ctx.restore();
};

const drawCanopy = (bottom) => {
    ctx.fillStyle = PAINT.leaf;
    ctx.fillRect(0, 0, FIELD.w, bottom - 4);
    for (let x = 0; x <= FIELD.w; x += 20) {
        disc(x, bottom - 6, 11, x % 40 ? PAINT.leafLight : PAINT.leaf);
    }
    ctx.fillStyle = PAINT.branch;
    ctx.fillRect(0, 0, FIELD.w, Math.min(5, bottom - 6));
    // Leaf veins stop the canopy reading as a flat block once it has dropped a few rows.
    ctx.strokeStyle = PAINT.leafDark;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let line = 0; 22 + line * 26 < bottom - 18; line++) {
        const y = 22 + line * 26;
        for (let x = line % 2 ? 24 : 44; x < FIELD.w; x += 40) {
            ctx.beginPath();
            ctx.moveTo(x - 7, y + 5);
            ctx.lineTo(x, y - 3);
            ctx.lineTo(x + 7, y + 5);
            ctx.stroke();
        }
    }
};

const drawAim = () => {
    const { points, cell } = tracePath(world, aim);
    ctx.strokeStyle = PAINT.aim;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.setLineDash([1, 11]);
    ctx.beginPath();
    points.forEach(([x, y], index) => {
        if (index) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    if (cell) {
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cellX(cell[0], cell[1]), cellY(world, cell[0]), GRID.radius - 3, 0, Math.PI * 2);
        ctx.stroke();
    }
};

const drawLauncher = () => {
    ctx.fillStyle = PAINT.floor;
    ctx.fillRect(0, 512, FIELD.w, FIELD.h - 512);
    disc(LAUNCH.x, LAUNCH.y, GRID.radius + 7, PAINT.wash);
    ctx.strokeStyle = PAINT.ring;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(LAUNCH.x, LAUNCH.y, GRID.radius + 6, 0, Math.PI * 2);
    ctx.stroke();
    drawFruit(world.current, LAUNCH.x, LAUNCH.y, GRID.radius);

    disc(NEXT.x, NEXT.y, NEXT.radius + 6, PAINT.wash);
    drawFruit(world.next, NEXT.x, NEXT.y, NEXT.radius);
    // Two arrows between the next fruit and the launcher: tap the next fruit to swap.
    ctx.strokeStyle = PAINT.ink;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(80, 484);
    ctx.lineTo(104, 484);
    ctx.lineTo(99, 479);
    ctx.moveTo(104, 496);
    ctx.lineTo(80, 496);
    ctx.lineTo(85, 501);
    ctx.stroke();
    ctx.fillStyle = PAINT.muted;
    ctx.font = '800 16px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Next', NEXT.x, 520);
};

const render = () => {
    ctx.setTransform(unit, 0, 0, unit, 0, 0);
    ctx.fillStyle = PAINT.field;
    ctx.fillRect(0, 0, FIELD.w, FIELD.h);
    ctx.fillStyle = PAINT.stripe;
    for (let x = 0; x < FIELD.w; x += 68) ctx.fillRect(x, 0, 34, FIELD.h);

    const deadlineY = FIELD.top + DEADLINE * ROW_HEIGHT + 4;
    ctx.strokeStyle = PAINT.deadline;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.moveTo(6, deadlineY);
    ctx.lineTo(FIELD.w - 6, deadlineY);
    ctx.stroke();
    ctx.setLineDash([]);

    // While the canopy slides down, the bubbles ride with it.
    const slide = (shownDrop - world.drop) * ROW_HEIGHT;
    drawCanopy(canopyY(world) + slide);
    if (world.status === 'aiming' && root.dataset.state === 'playing') drawAim();
    eachBubble(world, (row, col, kind) => drawFruit(kind, cellX(row, col), cellY(world, row) + slide, GRID.radius));

    pops.forEach((pop) => {
        const life = pop.age / 0.22;
        if (pop.kind !== null) drawFruit(pop.kind, pop.x, pop.y, GRID.radius * (1 - life * 0.7));
        ctx.strokeStyle = pop.kind === null ? PAINT.aim : FRUIT[pop.kind].rim;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(pop.x, pop.y, GRID.radius * (0.9 + life * 0.6), 0, Math.PI * 2);
        ctx.stroke();
    });
    fallers.forEach((faller) => drawFruit(faller.kind, faller.x, faller.y, GRID.radius));

    drawLauncher();
    if (world.shot) drawFruit(world.shot.kind, world.shot.x, world.shot.y, GRID.radius);

    if (banner) {
        ctx.fillStyle = PAINT.white;
        ctx.strokeStyle = PAINT.ink;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(40, 205, FIELD.w - 80, 92, 20);
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = PAINT.aim;
        ctx.font = '900 28px Nunito, system-ui, sans-serif';
        ctx.fillText(banner, FIELD.w / 2, 238);
        ctx.fillStyle = PAINT.ink;
        ctx.font = '700 17px Nunito, system-ui, sans-serif';
        ctx.fillText(`Level ${world.level + 1} is next`, FIELD.w / 2, 270);
    }
};

const frame = (now) => {
    const seconds = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const state = root.dataset.state;
    if (state === 'playing') {
        if (turning.dir) {
            turning.held += seconds;
            const rate = turning.held > TURN.rampAfter ? TURN.fast : TURN.slow;
            aim = clampAngle(aim + turning.dir * rate * seconds);
        }
        stepWorld(world, seconds);
        handleEvents();
        syncHud();
    }
    if (state === 'playing' || state === 'ending') {
        shownDrop = reducedMotion.matches ? world.drop : Math.min(world.drop, shownDrop + seconds * 5);
        pops.forEach((pop) => {
            pop.age += seconds;
        });
        pops = pops.filter((pop) => pop.age < 0.22);
        fallers.forEach((faller) => {
            faller.vy += 1500 * seconds;
            faller.x += faller.vx * seconds;
            faller.y += faller.vy * seconds;
        });
        fallers = fallers.filter((faller) => faller.y < FIELD.h + GRID.radius);
    }
    render();
    requestAnimationFrame(frame);
};

const fieldPoint = (event) => {
    const box = canvas.getBoundingClientRect();
    return { x: (event.clientX - box.left - 3) / scale, y: (event.clientY - box.top - 3) / scale };
};

// Aims the launcher at a point on the field. A point level with or below the launcher gives the widest angle on that side.
const aimAt = (point) => {
    const dx = point.x - LAUNCH.x;
    const dy = LAUNCH.y - point.y;
    aim = dy < 8 ? Math.sign(dx) * LAUNCH.maxAngle : clampAngle(Math.atan2(dx, dy));
};

const shoot = () => {
    if (root.dataset.state !== 'playing') return;
    fire(world, aim);
};

root.addEventListener('pointerdown', (event) => {
    if (root.dataset.state !== 'playing' || event.target.closest('button, a')) return;
    event.preventDefault();
    const point = fieldPoint(event);
    const onNext = Math.hypot(point.x - NEXT.x, point.y - NEXT.y) <= NEXT.zone;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, onNext, moved: false };
    root.setPointerCapture(event.pointerId);
    if (!onNext) aimAt(point);
});

root.addEventListener('pointermove', (event) => {
    if (root.dataset.state !== 'playing') return;
    if (press && press.id === event.pointerId) {
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) press.moved = true;
        // A press on the next fruit only becomes an aim once the finger slides away from it.
        if (press.moved || !press.onNext) aimAt(fieldPoint(event));
    } else if (!press && event.pointerType === 'mouse') {
        aimAt(fieldPoint(event));
    }
});

root.addEventListener('pointerup', (event) => {
    if (!press || press.id !== event.pointerId) return;
    if (press.onNext && !press.moved) swapNext(world);
    else shoot();
    press = null;
});

root.addEventListener('pointercancel', () => {
    press = null;
});

const KEY_TURNS = { ArrowLeft: -1, a: -1, ArrowRight: 1, d: 1 };

window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const state = root.dataset.state;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (state === 'playing' || state === 'ending') {
        if (KEY_TURNS[key]) {
            event.preventDefault();
            if (turning.dir !== KEY_TURNS[key]) turning = { dir: KEY_TURNS[key], held: 0 };
            return;
        }
        if (key === ' ' || key === 'ArrowUp' || key === 'w') {
            event.preventDefault();
            if (!event.repeat) shoot();
            return;
        }
        if (key === 'ArrowDown' || key === 's' || key === 'x') {
            event.preventDefault();
            if (!event.repeat && state === 'playing') swapNext(world);
            return;
        }
    }
    const onControl = document.activeElement?.closest('button, a');
    if ((key === 'Enter' || key === ' ') && !onControl && (state === 'ready' || state === 'over')) {
        event.preventDefault();
        startGame();
    }
});

window.addEventListener('keyup', (event) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (KEY_TURNS[key] === turning.dir) turning = { dir: 0, held: 0 };
});

window.addEventListener('blur', () => {
    turning = { dir: 0, held: 0 };
});

startButton.addEventListener('click', startGame);
againButton.addEventListener('click', startGame);

hud.best.textContent = best;
syncHud();
showStartBest();
setState('ready');
startButton.focus();
new ResizeObserver(sizeCanvas).observe(board);
requestAnimationFrame(frame);
