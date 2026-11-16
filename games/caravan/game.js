const COLS = 15;
const ROWS = 17;
const MAX_CELL = 44;
const START_ROCKS = 6;
const MAX_ROCKS = 16;
const DATES_PER_ROCK = 3;
const OASIS_EVERY = 4;
const OASIS_MIN_CAMELS = 6;
const OASIS_MS = 9000;
const POINTS_PER_CAMEL = 2;
const SWIPE_MIN = 22;
const TRADE_CAMELS = 3;
const TRADE_BONUS = 40;
const END_DELAY_MS = 650;
const STORE = { best: 'arcade.caravan.best', longest: 'arcade.caravan.longest' };
const DIRS = {
    up: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }
};
const KEY_DIRS = {
    ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', ArrowLeft: 'left',
    w: 'up', d: 'right', s: 'down', a: 'left'
};
const PAINT = {
    sand: '#edcf97', sandAlt: '#e9c88c', dune: '#dcb878', shade: '#d3aa69',
    camel: '#b8773a', outline: '#5b3212', rope: '#7a4a22',
    lead: '#7a5cf0', flag: '#fff6e0', blankets: ['#e2574a', '#1f9c8f', '#fff3d6'],
    date: '#8c2f2a', dateLight: '#b5503f', leaf: '#4c8a3a',
    rock: '#6b5d80', rockLight: '#9082a8',
    pond: '#36b3bf', pondLight: '#7ad6dc', palm: '#2e8f5a', trunk: '#8a5a2b', timer: '#0f6f78',
    text: '#4a2508', crash: '#d62f2f'
};
const REASONS = {
    edge: 'The caravan wandered off the edge of the map.',
    rock: 'The lead camel walked straight into a rock.',
    train: 'The caravan tangled up in its own train.'
};

const root = document.getElementById('game');
const board = document.getElementById('board');
const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const camelsEl = document.getElementById('camels');
const noticeEl = document.getElementById('notice');
const screens = {
    ready: document.getElementById('start-screen'),
    paused: document.getElementById('pause-screen'),
    over: document.getElementById('end-screen')
};
const startButton = document.getElementById('start');
const resumeButton = document.getElementById('resume');
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
let longest = readNumber(STORE.longest);
let cell = 22;
let run = null;
let lastFrame = 0;
let swipe = null;
let endTimer = null;

// Fixed scatter of dune ripples so the sand looks the same every frame.
const ripples = Array.from({ length: 30 }, (_, index) => ({
    x: ((index * 37 + 11) % 149) / 149 * COLS,
    y: ((index * 53 + 29) % 167) / 167 * ROWS,
    w: 0.5 + ((index * 17) % 5) / 10
}));

const setState = (state) => {
    root.dataset.state = state;
    Object.entries(screens).forEach(([name, screen]) => {
        screen.hidden = name !== state;
    });
};

const notice = (text, tone = 'info') => {
    noticeEl.textContent = text;
    noticeEl.dataset.tone = tone;
};

const updateHud = () => {
    scoreEl.textContent = run.score;
    bestEl.textContent = Math.max(best, run.score);
    camelsEl.textContent = run.camels.length + run.grow;
};

const stepInterval = () => Math.max(95, 210 - (run.camels.length - 3) * 7);

const isCamel = (x, y) => run.camels.some((camel) => camel.x === x && camel.y === y);

const headDistance = (x, y) => Math.abs(x - run.camels[0].x) + Math.abs(y - run.camels[0].y);

// Picks a random empty cell that also passes the given test, or null when none does.
const pickCell = (test) => {
    const options = [];
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const taken = run.rocks.has(y * COLS + x) || isCamel(x, y)
                || (run.date && run.date.x === x && run.date.y === y)
                || (run.oasis && run.oasis.x === x && run.oasis.y === y);
            if (!taken && test(x, y)) options.push({ x, y });
        }
    }
    return options.length ? options[Math.floor(Math.random() * options.length)] : null;
};

// Rocks stay off the border and never touch each other, so they can never wall off part of the map.
// They also never appear in the lead camel's current row or column, or close to it.
const addRock = () => {
    const head = run.camels[0];
    const spot = pickCell((x, y) => {
        if (x < 1 || y < 1 || x > COLS - 2 || y > ROWS - 2) return false;
        if (x === head.x || y === head.y || headDistance(x, y) < 5) return false;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (run.rocks.has((y + dy) * COLS + x + dx)) return false;
            }
        }
        return true;
    });
    if (spot) run.rocks.add(spot.y * COLS + spot.x);
};

const placeDate = () => {
    run.date = pickCell((x, y) => headDistance(x, y) >= 3) ?? pickCell(() => true);
};

const openOasis = () => {
    const spot = pickCell((x, y) => headDistance(x, y) >= 5 && headDistance(x, y) <= 14);
    if (!spot) return;
    run.oasis = { ...spot, left: OASIS_MS };
    run.sinceOasis = 0;
    notice(`Oasis open: trade ${TRADE_CAMELS} camels for ${TRADE_BONUS} points.`, 'warn');
};

const addEffect = (x, y, text) => {
    run.effects.push({ x, y, text, age: 0 });
};

const collectDate = () => {
    const points = POINTS_PER_CAMEL * run.camels.length;
    run.score += points;
    run.grow++;
    run.dates++;
    run.sinceOasis++;
    run.longest = Math.max(run.longest, run.camels.length + run.grow);
    addEffect(run.date.x, run.date.y, `+${points}`);
    placeDate();
    if (run.dates % DATES_PER_ROCK === 0 && run.rocks.size < MAX_ROCKS) addRock();
    if (!run.oasis && run.sinceOasis >= OASIS_EVERY && run.camels.length + run.grow >= OASIS_MIN_CAMELS) openOasis();
};

const trade = () => {
    run.camels.splice(-TRADE_CAMELS).forEach((camel) => addEffect(camel.x, camel.y, ''));
    run.score += TRADE_BONUS;
    addEffect(run.oasis.x, run.oasis.y, `+${TRADE_BONUS}`);
    run.oasis = null;
    notice(`Traded ${TRADE_CAMELS} camels for ${TRADE_BONUS} points.`, 'good');
};

const showEnd = () => {
    const newBest = run.score > best;
    const newLongest = run.longest > longest;
    if (newBest) {
        best = run.score;
        writeNumber(STORE.best, best);
    }
    if (newLongest) {
        longest = run.longest;
        writeNumber(STORE.longest, longest);
    }
    document.getElementById('end-reason').textContent = REASONS[run.crash.reason];
    document.getElementById('end-note').textContent = newBest
        ? 'New best score.'
        : (newLongest && run.score > 0 ? 'Your longest caravan yet.' : '');
    document.getElementById('end-score').textContent = run.score;
    document.getElementById('end-best').textContent = best;
    document.getElementById('end-length').textContent = run.longest;
    document.getElementById('end-longest').textContent = longest;
    setState('over');
    againButton.focus();
};

const crash = (reason, x, y) => {
    const head = run.camels[0];
    run.crash = { reason, x: (head.x + x) / 2, y: (head.y + y) / 2, age: 0 };
    run.progress = 1;
    notice('');
    root.dataset.state = 'crashed';
    endTimer = setTimeout(showEnd, END_DELAY_MS);
};

const step = () => {
    if (run.turns.length) run.dir = run.turns.shift();
    const head = run.camels[0];
    const tail = run.camels[run.camels.length - 1];
    const x = head.x + run.dir.x;
    const y = head.y + run.dir.y;
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return crash('edge', x, y);
    if (run.rocks.has(y * COLS + x)) return crash('rock', x, y);
    // The tail cell is safe to enter because the tail moves on in the same step, unless the train is growing.
    if (run.camels.some((camel) => camel.x === x && camel.y === y && (camel !== tail || run.grow > 0))) {
        return crash('train', x, y);
    }
    const added = run.grow > 0 ? { ...tail, px: tail.x, py: tail.y } : null;
    for (let index = run.camels.length - 1; index > 0; index--) {
        const camel = run.camels[index];
        const ahead = run.camels[index - 1];
        camel.px = camel.x;
        camel.py = camel.y;
        camel.x = ahead.x;
        camel.y = ahead.y;
        if (camel.x !== camel.px) camel.facing = camel.x - camel.px;
    }
    head.px = head.x;
    head.py = head.y;
    head.x = x;
    head.y = y;
    if (run.dir.x) head.facing = run.dir.x;
    if (added) {
        run.camels.push(added);
        run.grow--;
    }
    if (run.date && x === run.date.x && y === run.date.y) collectDate();
    if (run.oasis && x === run.oasis.x && y === run.oasis.y) trade();
    updateHud();
    return true;
};

const update = (delta) => {
    run.clock += delta;
    while (run.clock >= stepInterval()) {
        run.clock -= stepInterval();
        if (!step()) return;
    }
    run.progress = run.clock / stepInterval();
    if (run.oasis) {
        run.oasis.left -= delta;
        if (run.oasis.left <= 0) {
            run.oasis = null;
            notice('The oasis dried up.');
        }
    }
};

const queueTurn = (name) => {
    if (root.dataset.state !== 'playing') return;
    const dir = DIRS[name];
    const last = run.turns.length ? run.turns[run.turns.length - 1] : run.dir;
    // Ignore repeats and straight reversals, measured against the last turn already queued.
    if (dir === last || (dir.x === -last.x && dir.y === -last.y) || run.turns.length >= 2) return;
    run.turns.push(dir);
};

const startRun = () => {
    clearTimeout(endTimer);
    const y = Math.floor(ROWS / 2);
    run = {
        camels: [4, 3, 2].map((x) => ({ x, y, px: x, py: y, facing: 1 })),
        dir: DIRS.right, turns: [], grow: 0, clock: 0, progress: 1,
        score: 0, longest: 3, dates: 0, sinceOasis: 0,
        rocks: new Set(), date: null, oasis: null, effects: [], crash: null
    };
    for (let count = 0; count < START_ROCKS; count++) addRock();
    placeDate();
    notice('Gather the dates.');
    updateHud();
    setState('playing');
    document.activeElement?.blur();
};

const pause = () => {
    if (root.dataset.state !== 'playing') return;
    setState('paused');
    resumeButton.focus();
};

const resume = () => {
    if (root.dataset.state !== 'paused') return;
    setState('playing');
    document.activeElement?.blur();
};

const sizeCanvas = () => {
    const frame = 8;
    cell = Math.floor(Math.min((board.clientWidth - frame) / COLS, (board.clientHeight - frame) / ROWS, MAX_CELL));
    if (cell < 4) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.style.width = `${COLS * cell + frame}px`;
    canvas.style.height = `${ROWS * cell + frame}px`;
    canvas.width = Math.round(COLS * cell * ratio);
    canvas.height = Math.round(ROWS * cell * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    render();
};

const ellipse = (x, y, rx, ry, fill, stroke) => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.stroke();
    }
};

const polygon = (points, fill) => {
    ctx.beginPath();
    points.forEach(([x, y], index) => (index ? ctx.lineTo(x * cell, y * cell) : ctx.moveTo(x * cell, y * cell)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
};

const drawSand = () => {
    ctx.fillStyle = PAINT.sand;
    ctx.fillRect(0, 0, COLS * cell, ROWS * cell);
    ctx.fillStyle = PAINT.sandAlt;
    for (let y = 0; y < ROWS; y++) {
        for (let x = y % 2; x < COLS; x += 2) ctx.fillRect(x * cell, y * cell, cell, cell);
    }
    ctx.strokeStyle = PAINT.dune;
    ctx.lineWidth = Math.max(1.5, cell * 0.07);
    ctx.lineCap = 'round';
    ripples.forEach((ripple) => {
        ctx.beginPath();
        ctx.arc(ripple.x * cell, ripple.y * cell + ripple.w * cell, ripple.w * cell, Math.PI * 1.3, Math.PI * 1.7);
        ctx.stroke();
    });
};

const drawRock = (x, y) => {
    ctx.save();
    ctx.translate((x + 0.5) * cell, (y + 0.5) * cell);
    if ((x + y) % 2) ctx.scale(-1, 1);
    ellipse(0, cell * 0.3, cell * 0.42, cell * 0.12, PAINT.shade);
    polygon([[-0.36, 0.3], [-0.42, -0.04], [-0.16, -0.38], [0.2, -0.32], [0.42, 0.02], [0.32, 0.32]], PAINT.rock);
    polygon([[-0.16, -0.38], [0.2, -0.32], [0.06, -0.04], [-0.22, -0.06]], PAINT.rockLight);
    ctx.restore();
};

const drawDate = (x, y, time) => {
    const bob = reducedMotion.matches ? 0 : Math.sin(time / 260) * cell * 0.04;
    ctx.save();
    ctx.translate((x + 0.5) * cell, (y + 0.5) * cell + bob);
    ctx.lineWidth = Math.max(1.5, cell * 0.08);
    ctx.lineCap = 'round';
    ctx.strokeStyle = PAINT.leaf;
    ctx.beginPath();
    ctx.moveTo(0, -cell * 0.12);
    ctx.lineTo(0, -cell * 0.36);
    ctx.lineTo(cell * 0.2, -cell * 0.3);
    ctx.stroke();
    [[-0.17, 0], [0.17, 0], [0, 0.2]].forEach(([dx, dy]) => {
        ellipse(dx * cell, dy * cell, cell * 0.15, cell * 0.19, PAINT.date);
        ellipse((dx - 0.04) * cell, (dy - 0.06) * cell, cell * 0.05, cell * 0.07, PAINT.dateLight);
    });
    ctx.restore();
};

const drawOasis = (oasis, time) => {
    const cx = (oasis.x + 0.5) * cell;
    const cy = (oasis.y + 0.5) * cell;
    // Blink for the last two seconds so the deadline is hard to miss.
    const closing = oasis.left < 2000 && !reducedMotion.matches && Math.floor(time / 160) % 2 === 0;
    ellipse(cx, cy, cell * 0.4, cell * 0.36, closing ? PAINT.pondLight : PAINT.pond);
    ellipse(cx - cell * 0.08, cy + cell * 0.06, cell * 0.2, cell * 0.14, PAINT.pondLight);
    ctx.lineCap = 'round';
    ctx.strokeStyle = PAINT.trunk;
    ctx.lineWidth = Math.max(2, cell * 0.1);
    ctx.beginPath();
    ctx.moveTo(cx + cell * 0.14, cy + cell * 0.12);
    ctx.lineTo(cx + cell * 0.2, cy - cell * 0.2);
    ctx.stroke();
    ctx.strokeStyle = PAINT.palm;
    ctx.beginPath();
    [-2.6, -1.9, -1.2, -0.5, 0.3].forEach((angle) => {
        ctx.moveTo(cx + cell * 0.2, cy - cell * 0.2);
        ctx.lineTo(cx + cell * 0.2 + Math.cos(angle) * cell * 0.26, cy - cell * 0.2 + Math.sin(angle) * cell * 0.26);
    });
    ctx.stroke();
    ctx.strokeStyle = PAINT.timer;
    ctx.lineWidth = Math.max(2.5, cell * 0.09);
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.46, -Math.PI / 2, -Math.PI / 2 + (oasis.left / OASIS_MS) * Math.PI * 2);
    ctx.stroke();
};

// Side view camel, drawn facing right in cell units and flipped to face left: legs, neck, head, body, hump, blanket.
const drawCamel = (x, y, facing, blanket, lead, stride) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing * cell * 1.2, cell * 1.2);
    ctx.lineCap = 'round';
    ctx.strokeStyle = PAINT.outline;
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    [[-0.2, 1], [-0.1, -1], [0.1, 1], [0.2, -1]].forEach(([legX, swing]) => {
        ctx.moveTo(legX, 0.1);
        ctx.lineTo(legX + swing * stride, 0.38);
    });
    ctx.stroke();
    ctx.strokeStyle = PAINT.camel;
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.moveTo(0.22, 0);
    ctx.lineTo(0.34, -0.24);
    ctx.stroke();
    ellipse(0.39, -0.27, 0.11, 0.075, PAINT.camel);
    ellipse(0, 0.03, 0.3, 0.17, PAINT.camel);
    ellipse(-0.04, -0.12, 0.16, 0.14, PAINT.camel);
    ctx.fillStyle = blanket;
    ctx.beginPath();
    ctx.moveTo(-0.17, 0.1);
    ctx.lineTo(-0.17, -0.14);
    ctx.quadraticCurveTo(-0.04, -0.34, 0.09, -0.14);
    ctx.lineTo(0.09, 0.1);
    ctx.closePath();
    ctx.fill();
    if (lead) {
        ctx.strokeStyle = PAINT.outline;
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        ctx.moveTo(-0.04, -0.24);
        ctx.lineTo(-0.04, -0.47);
        ctx.stroke();
        ctx.fillStyle = PAINT.flag;
        ctx.beginPath();
        ctx.moveTo(-0.04, -0.47);
        ctx.lineTo(-0.26, -0.4);
        ctx.lineTo(-0.04, -0.33);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
};

const drawEffects = () => {
    ctx.font = `800 ${Math.max(16, Math.round(cell * 0.6))}px Outfit, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    run.effects.forEach((effect) => {
        const life = effect.age / 900;
        const cx = (effect.x + 0.5) * cell;
        const cy = (effect.y + 0.5) * cell;
        if (effect.text) {
            const rise = reducedMotion.matches ? cell : cell * (0.8 + life * 0.7);
            const tx = Math.min(Math.max(cx, cell), (COLS - 1) * cell);
            ctx.fillStyle = PAINT.text;
            ctx.fillText(effect.text, tx, Math.max(cell * 0.6, cy - rise));
        } else if (!reducedMotion.matches) {
            // Dust ring where a traded camel left the train.
            ctx.strokeStyle = PAINT.outline;
            ctx.lineWidth = Math.max(1.5, cell * 0.06);
            ctx.beginPath();
            ctx.arc(cx, cy, cell * (0.2 + life * 0.4), 0, Math.PI * 2);
            ctx.stroke();
        }
    });
};

const render = (time = 0) => {
    if (!run) {
        drawSand();
        return;
    }
    ctx.save();
    if (run.crash && run.crash.age < 300 && !reducedMotion.matches) {
        ctx.translate(Math.sin(run.crash.age / 18) * cell * 0.12, 0);
    }
    drawSand();
    if (run.oasis) drawOasis(run.oasis, time);
    if (run.date) drawDate(run.date.x, run.date.y, time);
    run.rocks.forEach((index) => drawRock(index % COLS, Math.floor(index / COLS)));

    const spots = run.camels.map((camel) => ({
        x: (camel.px + (camel.x - camel.px) * run.progress + 0.5) * cell,
        y: (camel.py + (camel.y - camel.py) * run.progress + 0.5) * cell,
        facing: camel.facing
    }));
    ctx.strokeStyle = PAINT.rope;
    ctx.lineWidth = Math.max(1.5, cell * 0.06);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    spots.forEach((spot, index) => (index ? ctx.lineTo(spot.x, spot.y) : ctx.moveTo(spot.x, spot.y)));
    ctx.stroke();
    for (let index = spots.length - 1; index >= 0; index--) {
        const blanket = index ? PAINT.blankets[(index - 1) % PAINT.blankets.length] : PAINT.lead;
        const stride = reducedMotion.matches ? 0 : Math.sin((run.progress + index * 0.5) * Math.PI * 2) * 0.05;
        drawCamel(spots[index].x, spots[index].y, spots[index].facing, blanket, index === 0, stride);
    }
    drawEffects();

    if (run.crash) {
        const cx = (run.crash.x + 0.5) * cell;
        const cy = (run.crash.y + 0.5) * cell;
        const arm = cell * 0.26;
        ctx.strokeStyle = PAINT.crash;
        ctx.lineWidth = Math.max(3, cell * 0.14);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - arm, cy - arm);
        ctx.lineTo(cx + arm, cy + arm);
        ctx.moveTo(cx + arm, cy - arm);
        ctx.lineTo(cx - arm, cy + arm);
        ctx.stroke();
    }
    ctx.restore();
};

const frame = (now) => {
    const delta = Math.min(100, now - lastFrame);
    lastFrame = now;
    if (run) {
        if (root.dataset.state === 'playing') update(delta);
        if (root.dataset.state !== 'paused') {
            run.effects.forEach((effect) => {
                effect.age += delta;
            });
            run.effects = run.effects.filter((effect) => effect.age < 900);
            if (run.crash) run.crash.age += delta;
        }
    }
    render(now);
    requestAnimationFrame(frame);
};

// Steering works from anywhere on the play screen, not just the map.
root.addEventListener('pointerdown', (event) => {
    if (root.dataset.state !== 'playing' || event.target.closest('button:not(.arrow), a')) return;
    event.preventDefault();
    const arrow = event.target.closest('.arrow')?.dataset.dir;
    if (arrow && event.pointerType === 'mouse') {
        queueTurn(arrow);
        return;
    }
    // A finger that lands on an arrow button may be starting a swipe, so the button waits for the release.
    swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, arrow, turned: false };
    if (!arrow) root.setPointerCapture(event.pointerId);
});

root.addEventListener('pointermove', (event) => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    if (Math.hypot(dx, dy) < SWIPE_MIN) return;
    queueTurn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    swipe.turned = true;
    // Restart from here so one long drag can chain several turns.
    swipe.x = event.clientX;
    swipe.y = event.clientY;
});

const endSwipe = (event) => {
    if (swipe && event.pointerId === swipe.id) swipe = null;
};

root.addEventListener('pointerup', (event) => {
    if (swipe && event.pointerId === swipe.id && swipe.arrow && !swipe.turned) queueTurn(swipe.arrow);
    endSwipe(event);
});
root.addEventListener('pointercancel', endSwipe);

document.querySelectorAll('.arrow').forEach((button) => {
    const name = button.dataset.dir;
    // Presses are handled with the swipes above. Keyboard activation arrives as a click with no pointer behind it.
    button.addEventListener('click', (event) => {
        if (event.detail === 0) queueTurn(name);
    });
    button.addEventListener('contextmenu', (event) => event.preventDefault());
});

window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const state = root.dataset.state;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (KEY_DIRS[key] && (state === 'playing' || state === 'crashed')) {
        event.preventDefault();
        queueTurn(KEY_DIRS[key]);
        return;
    }
    if (key === 'p' || key === 'Escape') {
        if (state === 'playing') pause();
        else resume();
        return;
    }
    const onControl = document.activeElement?.closest('button, a');
    if ((key === 'Enter' || key === ' ') && !onControl) {
        event.preventDefault();
        if (state === 'ready') startRun();
        if (state === 'paused') resume();
        if (state === 'over') startRun();
    }
});

window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
});

startButton.addEventListener('click', startRun);
againButton.addEventListener('click', startRun);
resumeButton.addEventListener('click', resume);
document.getElementById('pause').addEventListener('click', pause);

bestEl.textContent = best;
setState('ready');
startButton.focus();
new ResizeObserver(sizeCanvas).observe(board);
requestAnimationFrame(frame);
