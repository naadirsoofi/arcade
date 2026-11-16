// ---- Game rules (pure: no DOM, also run by the physics test) ----

const FIELD = { w: 360, h: 520 };
const BRICK = { cols: 10, w: 33, h: 16, gap: 2, left: 6, top: 52 };
const PADDLE = { y: 470, h: 10, w: 64, wide: 96, speed: 560, maxAngle: 1.05 };
// minRise and minDrift are the smallest vertical and horizontal share of the ball's direction,
// so it can never settle into a flat or a straight up and down loop.
const BALL = { r: 5, speed: 330, levelGain: 0.04, maxStep: 3, minRise: 0.26, minDrift: 0.1 };
const TOKEN = { r: 9, fall: 110 };
const SECONDS = { wide: 12, slow: 8, stale: 8 };
const SLOW_FACTOR = 0.7;
const MAX_BALLS = 3;
const START_LIVES = 3;
const POINTS = { soil: 10, sprout: 5, bloom: 25, special: 15, token: 20, spareBee: 50, clear: 50, life: 100 };
const PLOTS = { S: 'soil', D: 'seed', X: 'stone', W: 'water', B: 'bee', Z: 'snail' };

// S soil, D seed plot (two hits), X stone edging, W watering can, B bee, Z snail, dot empty.
const LEVELS = [
    { name: 'First Furrows', rows: [
        'SSSSSSSSSS',
        'SSWSSSSBSS',
        'DDDDDDDDDD',
        'SSSSSSSSSS'
    ] },
    { name: 'Garden Path', rows: [
        'DSSS..SSSD',
        'SSS..SSSSS',
        'SS..SSSBSS',
        'SX..XSSSSS',
        'SS..SSZSSS',
        'SSS..SSSSS',
        'DSSS..SSSD'
    ] },
    { name: 'Raised Beds', rows: [
        'XSSS..SSSX',
        'SDDS..SDDS',
        'SDWS..SBDS',
        'SSSX..XSSS',
        '..........',
        'SSSX..XSSS',
        'SDDS..SDDS',
        'SDDS..SZDS',
        'XSSS..SSSX'
    ] },
    { name: 'Trellis', rows: [
        'S.S.S.S.S.',
        '.D.D.D.D.D',
        'S.S.W.S.S.',
        '.D.D.D.D.D',
        'S.S.S.B.S.',
        '.D.D.D.D.D',
        'S.S.S.S.S.'
    ] },
    { name: 'Sunflower', rows: [
        '...DDDD...',
        '..DSSSSD..',
        '.DSSBWSSD.',
        '..DSSSSD..',
        '...DDDD...',
        '....SS....',
        '.SS.SS.SS.',
        '..SSSSSS..',
        '....SS....'
    ] },
    { name: 'Lily Pond', rows: [
        '.SSSSSSSS.',
        'SSX....XSS',
        'SX.DZBD.XS',
        'SX.DDDD.XS',
        'SSX....XSS',
        '.SSSSSSSS.'
    ] },
    { name: 'Hedgerows', rows: [
        'SSSSWSSSSS',
        'XX......XX',
        'SSSSSSSSSS',
        '...XXXX...',
        'SDSDSSDSDS',
        'XX......XX',
        'SSSSBSSSSS'
    ] },
    { name: 'Greenhouse', rows: [
        '....XX....',
        '...XDDX...',
        '..XDWBDX..',
        '..DDDDDD..',
        'SSSSSSSSSS',
        'S.SS..SS.S',
        'S.SD..DS.S',
        'SSSSZSSSSS'
    ] },
    { name: 'Butterfly', rows: [
        'DD......DD',
        'DSD....DSD',
        'DSSD..DSSD',
        'DSBSXXSWSD',
        'DSSD..DSSD',
        'DSD....DSD',
        'DD......DD'
    ] },
    { name: 'Harvest Fair', rows: [
        'DSDSDSDSDS',
        'SXSSSSSSXS',
        'DSWDSSDBSD',
        'SSDXSSXDSS',
        'DSSSZSSSSD',
        'SXSDSSDSXS',
        'DSDSDSDSDS'
    ] }
];

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

const resetBalls = (world) => {
    world.tokens = [];
    world.wide = 0;
    world.slow = 0;
    world.paddle.w = PADDLE.w;
    world.balls = [{ x: world.paddle.x, y: PADDLE.y - BALL.r, dx: 0, dy: -1, held: true, stale: 0, lost: false }];
};

const loadLevel = (world, index) => {
    world.level = index;
    world.rows = LEVELS[index].rows.length;
    world.bricks = [];
    world.left = 0;
    LEVELS[index].rows.forEach((line, row) => {
        [...line].forEach((mark, col) => {
            const type = PLOTS[mark];
            world.bricks.push(type ? {
                type,
                hits: type === 'seed' ? 2 : 1,
                x: BRICK.left + col * (BRICK.w + BRICK.gap),
                y: BRICK.top + row * (BRICK.h + BRICK.gap),
                index: row * BRICK.cols + col
            } : null);
            if (type && type !== 'stone') world.left++;
        });
    });
    resetBalls(world);
};

const newWorld = () => {
    const world = { status: 'playing', score: 0, lives: START_LIVES, paddle: { x: FIELD.w / 2, w: PADDLE.w }, events: [] };
    loadLevel(world, 0);
    return world;
};

const movePaddle = (world, x) => {
    const half = world.paddle.w / 2;
    world.paddle.x = clamp(x, half, FIELD.w - half);
    world.balls.forEach((ball) => {
        if (ball.held) ball.x = world.paddle.x;
    });
};

const launch = (world) => {
    world.balls.forEach((ball) => {
        if (!ball.held) return;
        const angle = (0.15 + Math.random() * 0.45) * (Math.random() < 0.5 ? -1 : 1);
        ball.dx = Math.sin(angle);
        ball.dy = -Math.cos(angle);
        ball.held = false;
    });
};

// Called after every bounce. Keeps the direction away from flat and from straight up and down, and turns a ball
// that has gone too long without touching the plank or a plot, so no loop can last.
const steady = (ball) => {
    if (ball.stale > SECONDS.stale) {
        const turn = (0.25 + Math.random() * 0.4) * (Math.random() < 0.5 ? -1 : 1);
        const { dx, dy } = ball;
        ball.dx = dx * Math.cos(turn) - dy * Math.sin(turn);
        ball.dy = dx * Math.sin(turn) + dy * Math.cos(turn);
        ball.stale = SECONDS.stale / 2;
    }
    if (Math.abs(ball.dy) < BALL.minRise) ball.dy = ball.dy < 0 ? -BALL.minRise : BALL.minRise;
    if (Math.abs(ball.dx) < BALL.minDrift) ball.dx = (ball.dx || Math.random() - 0.5) < 0 ? -BALL.minDrift : BALL.minDrift;
    const length = Math.hypot(ball.dx, ball.dy);
    ball.dx /= length;
    ball.dy /= length;
};

// The plot the ball overlaps most deeply, with the offset from the plot's nearest point to the ball centre.
const touchedPlot = (world, ball) => {
    const pitchX = BRICK.w + BRICK.gap;
    const pitchY = BRICK.h + BRICK.gap;
    const firstCol = Math.max(0, Math.floor((ball.x - BALL.r - BRICK.left) / pitchX));
    const lastCol = Math.min(BRICK.cols - 1, Math.floor((ball.x + BALL.r - BRICK.left) / pitchX));
    const firstRow = Math.max(0, Math.floor((ball.y - BALL.r - BRICK.top) / pitchY));
    const lastRow = Math.min(world.rows - 1, Math.floor((ball.y + BALL.r - BRICK.top) / pitchY));
    let found = null;
    let nearest = BALL.r * BALL.r;
    for (let row = firstRow; row <= lastRow; row++) {
        for (let col = firstCol; col <= lastCol; col++) {
            const plot = world.bricks[row * BRICK.cols + col];
            if (!plot) continue;
            const dx = ball.x - clamp(ball.x, plot.x, plot.x + BRICK.w);
            const dy = ball.y - clamp(ball.y, plot.y, plot.y + BRICK.h);
            const gap = dx * dx + dy * dy;
            if (gap < nearest) {
                nearest = gap;
                found = { plot, dx, dy };
            }
        }
    }
    return found;
};

const bounceOffPlot = (ball, { plot, dx, dy }) => {
    if (dx === 0 && dy === 0) {
        // The centre is inside the plot: leave through the nearest face.
        const exits = [
            { depth: ball.x - plot.x, apply: () => { ball.x = plot.x - BALL.r; ball.dx = -Math.abs(ball.dx); } },
            { depth: plot.x + BRICK.w - ball.x, apply: () => { ball.x = plot.x + BRICK.w + BALL.r; ball.dx = Math.abs(ball.dx); } },
            { depth: ball.y - plot.y, apply: () => { ball.y = plot.y - BALL.r; ball.dy = -Math.abs(ball.dy); } },
            { depth: plot.y + BRICK.h - ball.y, apply: () => { ball.y = plot.y + BRICK.h + BALL.r; ball.dy = Math.abs(ball.dy); } }
        ];
        exits.sort((a, b) => a.depth - b.depth)[0].apply();
    } else if (Math.abs(dx) > Math.abs(dy)) {
        ball.x = clamp(ball.x, plot.x, plot.x + BRICK.w) + Math.sign(dx) * BALL.r;
        ball.dx = Math.sign(dx) * Math.abs(ball.dx);
    } else {
        ball.y = clamp(ball.y, plot.y, plot.y + BRICK.h) + Math.sign(dy) * BALL.r;
        ball.dy = Math.sign(dy) * Math.abs(ball.dy);
    }
};

const damagePlot = (world, ball, plot) => {
    if (plot.type === 'stone') return;
    const x = plot.x + BRICK.w / 2;
    const y = plot.y + BRICK.h / 2;
    ball.stale = 0;
    plot.hits--;
    if (plot.hits > 0) {
        world.score += POINTS.sprout;
        world.events.push({ type: 'sprout', x, y });
        return;
    }
    world.bricks[plot.index] = null;
    world.left--;
    if (plot.type === 'soil') world.score += POINTS.soil;
    else if (plot.type === 'seed') world.score += POINTS.bloom;
    else {
        world.score += POINTS.special;
        world.tokens.push({ kind: plot.type, x, y });
    }
    world.events.push({ type: 'clear', kind: plot.type, x, y });
};

// Moves one ball a short distance (never more than BALL.maxStep, so it cannot skip over a plot or the plank).
const moveBall = (world, ball, distance) => {
    ball.x += ball.dx * distance;
    ball.y += ball.dy * distance;
    let bounced = false;
    if (ball.x < BALL.r) {
        ball.x = BALL.r;
        ball.dx = Math.abs(ball.dx);
        bounced = true;
    } else if (ball.x > FIELD.w - BALL.r) {
        ball.x = FIELD.w - BALL.r;
        ball.dx = -Math.abs(ball.dx);
        bounced = true;
    }
    if (ball.y < BALL.r) {
        ball.y = BALL.r;
        ball.dy = Math.abs(ball.dy);
        bounced = true;
    } else if (ball.y - BALL.r > FIELD.h) {
        ball.lost = true;
        return;
    }
    const reach = world.paddle.w / 2 + BALL.r;
    const onPlank = ball.dy > 0 && ball.y + BALL.r >= PADDLE.y && ball.y - BALL.r <= PADDLE.y + PADDLE.h
        && Math.abs(ball.x - world.paddle.x) <= reach;
    if (onPlank) {
        // Where the ball lands on the plank sets the angle: centre goes straight up, the ends go wide.
        const angle = clamp((ball.x - world.paddle.x) / (world.paddle.w / 2), -1, 1) * PADDLE.maxAngle;
        ball.dx = Math.sin(angle);
        ball.dy = -Math.cos(angle);
        ball.y = PADDLE.y - BALL.r;
        ball.stale = 0;
        bounced = true;
    }
    const touched = touchedPlot(world, ball);
    if (touched) {
        bounceOffPlot(ball, touched);
        damagePlot(world, ball, touched.plot);
        bounced = true;
    }
    if (bounced) steady(ball);
};

const catchToken = (world, token) => {
    world.score += POINTS.token;
    world.events.push({ type: 'catch', kind: token.kind, x: token.x, y: PADDLE.y });
    if (token.kind === 'water') {
        world.wide = SECONDS.wide;
        world.paddle.w = PADDLE.wide;
        movePaddle(world, world.paddle.x);
    } else if (token.kind === 'snail') {
        world.slow = SECONDS.slow;
    } else if (world.balls.length < MAX_BALLS) {
        const source = world.balls[0];
        world.balls.push({ ...source, dx: -source.dx, dy: -Math.abs(source.dy), stale: 0 });
    } else {
        world.score += POINTS.spareBee;
    }
};

const stepWorld = (world, seconds) => {
    if (world.status !== 'playing') return;
    world.wide = Math.max(0, world.wide - seconds);
    world.slow = Math.max(0, world.slow - seconds);
    if (!world.wide) world.paddle.w = PADDLE.w;
    const travel = BALL.speed * (1 + BALL.levelGain * world.level) * (world.slow ? SLOW_FACTOR : 1) * seconds;
    const steps = Math.ceil(travel / BALL.maxStep);
    world.balls.forEach((ball) => {
        if (ball.held) return;
        ball.stale += seconds;
        for (let step = 0; step < steps && !ball.lost && world.left > 0; step++) moveBall(world, ball, travel / steps);
    });
    if (world.left === 0) {
        world.score += POINTS.clear * (world.level + 1);
        if (world.level === LEVELS.length - 1) {
            world.score += POINTS.life * world.lives;
            world.status = 'won';
        } else {
            loadLevel(world, world.level + 1);
        }
        return;
    }
    world.balls = world.balls.filter((ball) => !ball.lost);
    if (!world.balls.length) {
        world.lives--;
        if (world.lives === 0) world.status = 'lost';
        else resetBalls(world);
        return;
    }
    world.tokens = world.tokens.filter((token) => {
        token.y += TOKEN.fall * seconds;
        const caught = token.y + TOKEN.r >= PADDLE.y && token.y - TOKEN.r <= PADDLE.y + PADDLE.h
            && Math.abs(token.x - world.paddle.x) <= world.paddle.w / 2 + TOKEN.r;
        if (caught) catchToken(world, token);
        return !caught && token.y - TOKEN.r < FIELD.h;
    });
};

// ---- End of game rules ----

const STORE = { best: 'arcade.brick-garden.best', level: 'arcade.brick-garden.level' };
const MAX_SCALE = 1.6;
const END_DELAY_MS = 650;
const PAINT = {
    lawn: '#17352b', lawnAlt: '#1a3b30', ink: '#effaf2', hint: '#b6d4c4',
    soil: '#8b5e3c', soilDark: '#6c4527', soilDeep: '#4f3220', turf: '#5fae6e', loam: '#6f4a30', loamDark: '#573823',
    seed: '#f3e2b3', sprout: '#8fe3b0',
    stone: '#77838f', stoneLight: '#a3adb8',
    water: '#7cc4ff', bee: '#ffd75e', snail: '#c9a2ff', glyph: '#0a1a15',
    plank: '#e8b56a', plankEnd: '#b9824a', ball: '#fff8e1', ballEdge: '#0a1a15',
    petal: '#ff9dbb', heart: '#ffd75e'
};
const KEY_SIDES = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
const TOKEN_NAMES = { water: 'Watering can', bee: 'Bee', snail: 'Snail' };

const root = document.getElementById('game');
const board = document.getElementById('board');
const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const hud = {
    level: document.getElementById('level'),
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    lives: document.getElementById('lives')
};
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
let furthest = readNumber(STORE.level);
let world = null;
let scale = 1;
let unit = 1;
let lastFrame = 0;
let pointer = null;
let crumbs = [];
let blooms = [];
let caughtNote = null;
let endTimer = null;
const keysDown = { left: false, right: false };

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

const syncHud = () => {
    setText(hud.level, world.level + 1);
    setText(hud.score, world.score);
    setText(hud.best, Math.max(best, world.score));
    setText(hud.lives, world.lives);
    const boosts = [];
    if (world.wide) boosts.push(`Wide plank ${Math.ceil(world.wide)}s`);
    if (world.slow) boosts.push(`Slow ball ${Math.ceil(world.slow)}s`);
    if (world.balls.length > 1) boosts.push(`${world.balls.length} balls`);
    if (caughtNote && caughtNote.until > lastFrame) boosts.unshift(caughtNote.text);
    setText(statusEl, boosts.length ? boosts.join(', ') : `Level ${world.level + 1}: ${LEVELS[world.level].name}`);
    statusEl.dataset.tone = boosts.length ? 'boost' : 'plain';
};

const showStartBest = () => {
    document.getElementById('start-best').textContent = best
        ? `Best score ${best}, furthest level ${furthest}.`
        : '';
};

const showEnd = () => {
    const won = world.status === 'won';
    const reached = world.level + 1;
    const newBest = world.score > best;
    if (newBest) {
        best = world.score;
        writeNumber(STORE.best, best);
    }
    if (reached > furthest) {
        furthest = reached;
        writeNumber(STORE.level, furthest);
    }
    document.getElementById('end-title').textContent = won ? 'Full bloom' : 'Garden over';
    const reason = document.getElementById('end-reason');
    reason.textContent = won
        ? `You cleared all ${LEVELS.length} gardens.`
        : `The last ball rolled away on level ${reached}, ${LEVELS[world.level].name}.`;
    reason.classList.toggle('won', won);
    document.getElementById('end-note').textContent = newBest ? 'New best score.' : '';
    document.getElementById('end-score').textContent = world.score;
    document.getElementById('end-best').textContent = best;
    document.getElementById('end-level').textContent = reached;
    document.getElementById('end-furthest').textContent = furthest;
    setState('over');
    againButton.focus();
};

const startGame = () => {
    clearTimeout(endTimer);
    world = newWorld();
    crumbs = [];
    blooms = [];
    caughtNote = null;
    keysDown.left = false;
    keysDown.right = false;
    syncHud();
    setState('playing');
    document.activeElement?.blur();
};

const pause = () => {
    if (root.dataset.state !== 'playing') return;
    keysDown.left = false;
    keysDown.right = false;
    setState('paused');
    resumeButton.focus();
};

const resume = () => {
    if (root.dataset.state !== 'paused') return;
    setState('playing');
    document.activeElement?.blur();
};

const scatter = (x, y, color, count) => {
    for (let n = 0; n < count; n++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 30 + Math.random() * 70;
        crumbs.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 40, age: 0, color });
    }
};

const handleEvents = () => {
    world.events.forEach((event) => {
        if (event.type === 'catch') {
            caughtNote = { text: `${TOKEN_NAMES[event.kind]} caught`, until: lastFrame + 1500 };
        }
        if (event.type === 'clear' && event.kind === 'seed') blooms.push({ x: event.x, y: event.y, age: 0 });
        if (reducedMotion.matches) return;
        if (event.type === 'clear') scatter(event.x, event.y, event.kind === 'seed' ? PAINT.petal : PAINT.soil, 6);
        if (event.type === 'sprout') scatter(event.x, event.y, PAINT.sprout, 3);
        if (event.type === 'catch') scatter(event.x, event.y, PAINT[event.kind], 8);
    });
    world.events.length = 0;
};

// scale is CSS pixels per field unit (for pointer positions), unit is canvas pixels per field unit (for drawing).
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

const block = (x, y, w, h, radius, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
};

const disc = (x, y, radius, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
};

// Small glyphs for the three things to catch, centred on x, y and about 10 units wide.
// under is the colour behind the glyph, used for the bee's stripes.
const drawGlyph = (kind, x, y, color, under) => {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    if (kind === 'water') {
        ctx.beginPath();
        ctx.moveTo(x, y - 5.5);
        ctx.lineTo(x + 3.2, y + 0.4);
        ctx.arc(x, y + 1.2, 3.3, -0.25, Math.PI + 0.25);
        ctx.closePath();
        ctx.fill();
    } else if (kind === 'bee') {
        ctx.beginPath();
        ctx.ellipse(x - 1.5, y - 3.2, 2.6, 1.9, -0.4, 0, Math.PI * 2);
        ctx.ellipse(x + 2, y - 3.2, 2.2, 1.6, 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x, y + 1, 5.2, 3.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = under;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        [-1.8, 1.4].forEach((offset) => {
            ctx.moveTo(x + offset, y - 1.6);
            ctx.lineTo(x + offset, y + 3.6);
        });
        ctx.stroke();
    } else {
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(x + 0.5, y - 0.5, 3.6, Math.PI * 0.5, Math.PI * 2.3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 5, y + 4);
        ctx.lineTo(x + 5.5, y + 4);
        ctx.lineTo(x + 5.5, y + 1);
        ctx.stroke();
    }
};

const drawPlot = (plot) => {
    const { x, y } = plot;
    const cx = x + BRICK.w / 2;
    const cy = y + BRICK.h / 2;
    ctx.lineCap = 'round';
    if (plot.type === 'stone') {
        block(x, y, BRICK.w, BRICK.h, 3, PAINT.stone);
        block(x + 2, y + 2, 13, 5, 2, PAINT.stoneLight);
        block(x + 17, y + 2, 14, 5, 2, PAINT.stoneLight);
        block(x + 2, y + 9, 8, 5, 2, PAINT.stoneLight);
        block(x + 12, y + 9, 19, 5, 2, PAINT.stoneLight);
    } else if (plot.type === 'soil') {
        // Soil with a strip of turf along the top.
        block(x, y, BRICK.w, BRICK.h, 3, PAINT.soil);
        block(x, y, BRICK.w, 5, [3, 3, 0, 0], PAINT.turf);
        ctx.strokeStyle = PAINT.soilDark;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 5, y + 8.5);
        ctx.lineTo(x + BRICK.w - 11, y + 8.5);
        ctx.moveTo(x + 11, y + 12.5);
        ctx.lineTo(x + BRICK.w - 5, y + 12.5);
        ctx.stroke();
    } else if (plot.type === 'seed') {
        // Tilled loam: three seeds at first, a sprout after the first hit.
        block(x, y, BRICK.w, BRICK.h, 3, PAINT.loam);
        ctx.strokeStyle = PAINT.loamDark;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 4, y + 13);
        ctx.lineTo(x + BRICK.w - 4, y + 13);
        ctx.stroke();
        if (plot.hits === 2) {
            [-9, 0, 9].forEach((offset) => disc(cx + offset, cy - 1, 2.4, PAINT.seed));
        } else {
            ctx.strokeStyle = PAINT.sprout;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx, y + 12.5);
            ctx.lineTo(cx, y + 5);
            ctx.stroke();
            ctx.fillStyle = PAINT.sprout;
            [-1, 1].forEach((side) => {
                ctx.beginPath();
                ctx.ellipse(cx + side * 4.2, y + 4.5, 4.2, 2.3, side * -0.5, 0, Math.PI * 2);
                ctx.fill();
            });
        }
    } else {
        block(x, y, BRICK.w, BRICK.h, 3, PAINT[plot.type]);
        block(x + 2, y + 2, BRICK.w - 4, BRICK.h - 4, 2, PAINT.soilDeep);
        drawGlyph(plot.type, cx, cy, PAINT[plot.type], PAINT.soilDeep);
    }
};

const drawBloom = (bloom) => {
    const size = reducedMotion.matches ? 1 : 0.6 + (bloom.age / 0.45) * 0.6;
    for (let petal = 0; petal < 5; petal++) {
        const angle = (petal / 5) * Math.PI * 2 - Math.PI / 2;
        disc(bloom.x + Math.cos(angle) * 5.5 * size, bloom.y + Math.sin(angle) * 5.5 * size, 4 * size, PAINT.petal);
    }
    disc(bloom.x, bloom.y, 3.2 * size, PAINT.heart);
};

const drawBanner = () => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PAINT.ink;
    ctx.font = '800 26px Outfit, system-ui, sans-serif';
    ctx.fillText(`Level ${world.level + 1}`, FIELD.w / 2, 318);
    ctx.font = '700 19px Outfit, system-ui, sans-serif';
    ctx.fillStyle = PAINT.sprout;
    ctx.fillText(LEVELS[world.level].name, FIELD.w / 2, 346);
    ctx.font = '500 18px Outfit, system-ui, sans-serif';
    ctx.fillStyle = PAINT.hint;
    ctx.fillText('Space, click or tap to launch', FIELD.w / 2, 384);
};

const render = () => {
    ctx.setTransform(unit, 0, 0, unit, 0, 0);
    ctx.fillStyle = PAINT.lawn;
    ctx.fillRect(0, 0, FIELD.w, FIELD.h);
    ctx.fillStyle = PAINT.lawnAlt;
    for (let stripe = 0; stripe < FIELD.w; stripe += 72) ctx.fillRect(stripe, 0, 36, FIELD.h);
    if (!world) return;

    world.bricks.forEach((plot) => {
        if (plot) drawPlot(plot);
    });
    blooms.forEach(drawBloom);

    world.tokens.forEach((token) => {
        disc(token.x, token.y, TOKEN.r, PAINT[token.kind]);
        drawGlyph(token.kind, token.x, token.y, PAINT.glyph, PAINT[token.kind]);
    });

    const { x, w } = world.paddle;
    block(x - w / 2, PADDLE.y, w, PADDLE.h, 4, PAINT.plank);
    block(x - w / 2, PADDLE.y, 9, PADDLE.h, 4, world.wide ? PAINT.water : PAINT.plankEnd);
    block(x + w / 2 - 9, PADDLE.y, 9, PADDLE.h, 4, world.wide ? PAINT.water : PAINT.plankEnd);

    world.balls.forEach((ball) => {
        disc(ball.x, ball.y, BALL.r + 1, PAINT.ballEdge);
        disc(ball.x, ball.y, BALL.r, PAINT.ball);
    });

    crumbs.forEach((crumb) => {
        ctx.fillStyle = crumb.color;
        ctx.fillRect(crumb.x - 1.5, crumb.y - 1.5, 3, 3);
    });

    if (world.status === 'playing' && world.balls.some((ball) => ball.held)) drawBanner();
};

const frame = (now) => {
    const seconds = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (world && root.dataset.state === 'playing') {
        const side = (keysDown.right ? 1 : 0) - (keysDown.left ? 1 : 0);
        if (side) movePaddle(world, world.paddle.x + side * PADDLE.speed * seconds);
        stepWorld(world, seconds);
        handleEvents();
        syncHud();
        if (world.status !== 'playing') {
            root.dataset.state = 'ending';
            endTimer = setTimeout(showEnd, END_DELAY_MS);
        }
    }
    if (world && root.dataset.state !== 'paused') {
        crumbs.forEach((crumb) => {
            crumb.age += seconds;
            crumb.vy += 260 * seconds;
            crumb.x += crumb.vx * seconds;
            crumb.y += crumb.vy * seconds;
        });
        crumbs = crumbs.filter((crumb) => crumb.age < 0.5);
        blooms.forEach((bloom) => {
            bloom.age += seconds;
        });
        blooms = blooms.filter((bloom) => bloom.age < 0.45);
    }
    render();
    requestAnimationFrame(frame);
};

const pointerX = (event) => (event.clientX - canvas.getBoundingClientRect().left - 3) / scale;

board.addEventListener('pointerdown', (event) => {
    if (root.dataset.state !== 'playing') return;
    event.preventDefault();
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
    board.setPointerCapture(event.pointerId);
    movePaddle(world, pointerX(event));
});

board.addEventListener('pointermove', (event) => {
    if (root.dataset.state !== 'playing') return;
    const held = pointer && pointer.id === event.pointerId;
    if (held && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 12) pointer.dragged = true;
    if (held || event.pointerType === 'mouse') movePaddle(world, pointerX(event));
});

board.addEventListener('pointerup', (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    // A press that did not travel is a tap or click: launch the waiting ball.
    if (!pointer.dragged && root.dataset.state === 'playing') launch(world);
    pointer = null;
});

board.addEventListener('pointercancel', () => {
    pointer = null;
});

window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const state = root.dataset.state;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (state === 'playing' || state === 'ending') {
        if (KEY_SIDES[key]) {
            event.preventDefault();
            keysDown[KEY_SIDES[key]] = state === 'playing';
            return;
        }
        if (key === ' ') {
            event.preventDefault();
            if (state === 'playing') launch(world);
            return;
        }
    }
    if (key === 'p' || key === 'Escape') {
        if (state === 'playing') pause();
        else resume();
        return;
    }
    const onControl = document.activeElement?.closest('button, a');
    if ((key === 'Enter' || key === ' ') && !onControl) {
        event.preventDefault();
        if (state === 'ready' || state === 'over') startGame();
        if (state === 'paused') resume();
    }
});

window.addEventListener('keyup', (event) => {
    const side = KEY_SIDES[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (side) keysDown[side] = false;
});

window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
});

startButton.addEventListener('click', startGame);
againButton.addEventListener('click', startGame);
resumeButton.addEventListener('click', resume);
document.getElementById('pause').addEventListener('click', pause);

hud.best.textContent = best;
showStartBest();
setState('ready');
startButton.focus();
new ResizeObserver(sizeCanvas).observe(board);
requestAnimationFrame(frame);
