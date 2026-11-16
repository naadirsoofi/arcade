// ---- Game rules (pure: no DOM, also run by the fairness test) ----

// Speed depends only on how far the runner has come, so the roof builder knows the exact pace at every gap.
const PACE = { base: 250, max: 480, gain: 0.0096 };
// A held jump floats under floatGravity for up to maxHold seconds, then falls under gravity.
const JUMP = { launch: 560, floatGravity: 1100, gravity: 2800, maxHold: 0.3, dive: 1800, coyote: 0.08, buffer: 0.12 };
const BODY = { half: 9, stand: 44, duck: 20 };
// ledge: how far below a roof top the feet may be and still scramble up. edge: overhang that still counts as roof.
const ROOF = { low: 70, high: 190, maxRise: 48, maxDrop: 70, ledge: 12, edge: 6, first: 760 };
const SIGN = { bottom: 30, top: 150 };
const OBSTACLES = [
    { kind: 'crate', w: 26, h: 26 },
    { kind: 'vent', w: 42, h: 22 },
    { kind: 'pipe', w: 16, h: 34 }
];
const GAP_SHARE = { min: 0.3, max: 0.62 };
// Seconds of clear running kept after every landing, so there is time to see the next thing and respond.
const REACT = 0.25;
const MIN_SLIDE = 0.45;
const MAX_STEP = 1 / 120;
const LETTER = { reach: 18, points: 25 };
const START = { x: 120, top: 110 };
const UNITS_PER_METRE = 10;
const GENERATE = { ahead: 2000, behind: 600 };
const FLOOR = -60;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const between = (low, high) => low + Math.random() * (high - low);

const speedAt = (x) => Math.min(PACE.max, PACE.base + x * PACE.gain);

// Seconds a fully held jump stays in the air before coming back down to a landing `rise` above the takeoff.
const flight = (rise) => {
    const hold = JUMP.maxHold;
    const height = JUMP.launch * hold - 0.5 * JUMP.floatGravity * hold * hold;
    const speed = JUMP.launch - JUMP.floatGravity * hold;
    return hold + (speed + Math.sqrt(speed * speed + 2 * JUMP.gravity * (height - rise))) / JUMP.gravity;
};

const hazardCount = (x) => {
    const roll = Math.random();
    if (x < 1500) return roll < 0.45 ? 1 : 0;
    if (roll < 0.25) return 0;
    return roll < 0.75 ? 1 : 2;
};

// Builds the next roof so that everything on it can be cleared at the speed the runner will have there:
// the gap is well inside a full jump, the first hazard sits beyond the deepest possible landing plus reaction
// time, and the same clear stretch follows every hazard.
const addRoof = (world) => {
    const last = world.roofs[world.roofs.length - 1];
    const edge = last.x + last.w;
    const speed = speedAt(edge);
    const top = Math.round(clamp(last.top + between(-ROOF.maxDrop, ROOF.maxRise), ROOF.low, ROOF.high));
    const rise = top - last.top;
    const gap = Math.round(speed * flight(Math.max(rise, 0)) * between(GAP_SHARE.min, GAP_SHARE.max));
    const x = edge + gap;
    const landing = speed * (flight(rise) + JUMP.coyote + REACT) - gap;
    const spacing = speed * (flight(0) + REACT);
    const roof = { x, top, w: 0, hazards: [], letters: [] };

    if (Math.random() < 0.5) {
        roof.letters.push({ x: edge + gap / 2, y: Math.max(last.top, top) + 50, taken: false });
    }
    let cursor = landing;
    for (let n = hazardCount(x); n > 0; n--) {
        const at = Math.round(x + cursor + between(0, 80));
        if (Math.random() < 0.36) {
            const w = Math.round(between(46, 90));
            roof.hazards.push({ kind: 'sign', x: at, w, h: 0 });
            if (Math.random() < 0.4) roof.letters.push({ x: at + w / 2, y: top + 11, taken: false });
            cursor = at - x + w + spacing;
        } else {
            const shape = OBSTACLES[Math.floor(Math.random() * OBSTACLES.length)];
            roof.hazards.push({ kind: shape.kind, x: at, w: shape.w, h: shape.h });
            if (Math.random() < 0.45) roof.letters.push({ x: at + shape.w / 2, y: top + shape.h + 46, taken: false });
            cursor = at - x + shape.w + spacing;
        }
    }
    roof.w = Math.round(cursor + between(60, 220));
    world.roofs.push(roof);
};

const extend = (world) => {
    while (true) {
        const last = world.roofs[world.roofs.length - 1];
        if (last.x + last.w > world.x + GENERATE.ahead) break;
        addRoof(world);
    }
    while (world.roofs[0].x + world.roofs[0].w < world.x - GENERATE.behind) world.roofs.shift();
};

const newWorld = () => {
    const world = {
        status: 'running', cause: '', x: START.x, y: START.top, vy: 0,
        grounded: true, floating: false, hold: 0, jumpHeld: false, buffer: 0, coyote: 0,
        duckHeld: false, ducking: false, slide: 0,
        roofs: [{ x: 0, top: START.top, w: ROOF.first, hazards: [], letters: [] }],
        letters: 0, events: []
    };
    extend(world);
    return world;
};

const metres = (world) => Math.floor((world.x - START.x) / UNITS_PER_METRE);
const scoreOf = (world) => metres(world) + world.letters * LETTER.points;

const pressJump = (world) => {
    world.jumpHeld = true;
    world.buffer = JUMP.buffer;
};

const releaseJump = (world) => {
    world.jumpHeld = false;
};

// Down on a roof is a slide. Down in the air is a dive straight back to the roof, which then slides.
const setDuck = (world, on) => {
    if (on && !world.duckHeld) {
        world.slide = MIN_SLIDE;
        world.buffer = 0;
        if (!world.grounded) {
            world.vy = Math.min(world.vy, -JUMP.dive);
            world.floating = false;
        }
    }
    world.duckHeld = on;
};

const roofUnder = (world) => world.roofs.find((roof) => world.x >= roof.x - ROOF.edge && world.x <= roof.x + roof.w + ROOF.edge);

const overlaps = (world, hazard, slack) => world.x + BODY.half - slack > hazard.x && world.x - BODY.half + slack < hazard.x + hazard.w;

const underSign = (world) => world.roofs.some((roof) => roof.hazards.some((hazard) => hazard.kind === 'sign' && overlaps(world, hazard, 0)));

const land = (world, roof) => {
    world.y = roof.top;
    world.vy = 0;
    world.grounded = true;
    world.floating = false;
    world.events.push({ type: 'land' });
};

const stop = (world, status, cause, vy) => {
    world.status = status;
    world.cause = cause;
    world.vy = vy;
    world.grounded = false;
    world.ducking = false;
    world.events.push({ type: status });
};

const tick = (world, dt) => {
    if (world.status !== 'running') {
        world.vy -= JUMP.gravity * dt;
        world.y += world.vy * dt;
        return;
    }
    world.x += speedAt(world.x) * dt;
    extend(world);

    const sheltered = world.ducking && underSign(world);
    world.buffer = Math.max(0, world.buffer - dt);
    world.coyote = world.grounded ? JUMP.coyote : Math.max(0, world.coyote - dt);
    if (world.buffer > 0 && world.coyote > 0 && !sheltered) {
        world.vy = JUMP.launch;
        world.grounded = false;
        world.floating = true;
        world.ducking = false;
        world.hold = 0;
        world.buffer = 0;
        world.coyote = 0;
        world.slide = 0;
        world.events.push({ type: 'jump' });
    }

    if (world.grounded) {
        world.slide = Math.max(0, world.slide - dt);
        // Nobody stands up into a billboard: a slide lasts until the sign has passed.
        world.ducking = world.duckHeld || world.slide > 0 || sheltered;
        if (!roofUnder(world)) {
            world.grounded = false;
            world.floating = false;
            world.ducking = false;
        }
    } else {
        world.hold += dt;
        if (!world.jumpHeld || world.hold >= JUMP.maxHold || world.vy <= 0) world.floating = false;
        const before = world.y;
        world.vy -= (world.floating ? JUMP.floatGravity : JUMP.gravity) * dt;
        world.y += world.vy * dt;
        const roof = roofUnder(world);
        if (roof && world.vy <= 0 && before >= roof.top && world.y <= roof.top) {
            land(world, roof);
            world.ducking = world.duckHeld;
        }
    }

    // The front of the runner meeting the side of a building: a near miss scrambles up, anything lower falls.
    const front = world.x + BODY.half;
    const wall = world.roofs.find((roof) => front > roof.x && front < roof.x + roof.w);
    if (wall && world.y < wall.top && world.vy <= 0) {
        if (world.y >= wall.top - ROOF.ledge) {
            world.x = Math.max(world.x, wall.x - ROOF.edge);
            land(world, wall);
        } else stop(world, 'fallen', 'wall', Math.min(world.vy, 0));
    } else if (wall && world.y < wall.top - ROOF.ledge) {
        stop(world, 'fallen', 'wall', 0);
    } else if (world.y < FLOOR) {
        stop(world, 'fallen', 'gap', world.vy);
    }
    if (world.status !== 'running') return;

    const height = world.ducking ? BODY.duck : BODY.stand;
    world.roofs.forEach((roof) => {
        roof.hazards.forEach((hazard) => {
            if (world.status !== 'running' || !overlaps(world, hazard, 1)) return;
            const hit = hazard.kind === 'sign'
                ? world.y + height > roof.top + SIGN.bottom && world.y < roof.top + SIGN.top
                : world.y < roof.top + hazard.h - 2;
            if (hit) stop(world, 'crashed', hazard.kind, 300);
        });
        roof.letters.forEach((letter) => {
            if (letter.taken) return;
            const dx = letter.x - clamp(letter.x, world.x - BODY.half, world.x + BODY.half);
            const dy = letter.y - clamp(letter.y, world.y, world.y + height);
            if (dx * dx + dy * dy > LETTER.reach * LETTER.reach) return;
            letter.taken = true;
            world.letters++;
            world.events.push({ type: 'letter' });
        });
    });
};

// Moves in steps short enough that nothing can be skipped over, however long the frame was.
const stepWorld = (world, seconds) => {
    const steps = Math.max(1, Math.ceil(seconds / MAX_STEP));
    for (let step = 0; step < steps; step++) tick(world, seconds / steps);
};

// ---- End of game rules ----

const STORE = { best: 'arcade.rooftop-run.best', far: 'arcade.rooftop-run.distance' };
const VIEW = { minWidth: 480, minHeight: 380, maxScale: 1.5, runnerAt: 0.2 };
const SLIDE_PX = 22;
const END_DELAY_MS = 850;
const PAINT = {
    sky: '#7cc4ff', sun: '#fff3c4', cloud: '#eaf6ff', far: '#62adf0', near: '#3f8ad6',
    ledge: '#f6e6c6', ledgeShade: '#d9c39a', lit: '#ffd75e',
    runner: '#14263d', skin: '#f3cfa6', scarf: '#ffd75e', bag: '#ff5c5c',
    crate: '#9a6532', crateLine: '#5e3a17', vent: '#e3e9ee', ventLine: '#55626e', pipe: '#2f3b47', pipeCap: '#e2674a',
    sign: '#ff5c8a', signLine: '#fff0f5', post: '#3a4652',
    paper: '#ffffff', seal: '#e2674a', dust: '#f6e6c6'
};
const BUILDINGS = [
    { wall: '#c9583e', pane: '#a8432c' },
    { wall: '#2a7f86', pane: '#1f656b' },
    { wall: '#7a55a0', pane: '#614283' },
    { wall: '#c98f2b', pane: '#a67320' }
];
const CAUSES = {
    gap: 'You missed the jump',
    wall: 'You came up short of the next roof',
    crate: 'A crate tripped you up',
    vent: 'A vent tripped you up',
    pipe: 'A pipe tripped you up',
    sign: 'You ran into a billboard'
};

const root = document.getElementById('game');
const board = document.getElementById('board');
const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');
const hud = {
    score: document.getElementById('score'),
    letters: document.getElementById('letters'),
    best: document.getElementById('best')
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
let farthest = readNumber(STORE.far);
let world = newWorld();
// unit is canvas pixels per world unit. view is the visible area in world units, base is where height 0 sits.
let unit = 1;
const view = { w: VIEW.minWidth, h: VIEW.minHeight, base: VIEW.minHeight };
let lastFrame = 0;
let clock = 0;
let finger = null;
let dust = [];
// The Letters count lights up until this moment on the game clock.
let letterGlow = 0;
let endTimer = null;

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
    const score = scoreOf(world);
    setText(hud.score, score);
    setText(hud.letters, world.letters);
    hud.letters.parentElement.dataset.tone = clock < letterGlow ? 'got' : 'plain';
    setText(hud.best, Math.max(best, score));
};

const showStartBest = () => {
    document.getElementById('start-best').textContent = best ? `Best score ${best}, longest run ${farthest} m.` : '';
};

const showEnd = () => {
    const score = scoreOf(world);
    const distance = metres(world);
    const newBest = score > best;
    if (newBest) {
        best = score;
        writeNumber(STORE.best, best);
    }
    if (distance > farthest) {
        farthest = distance;
        writeNumber(STORE.far, farthest);
    }
    document.getElementById('end-reason').textContent = `${CAUSES[world.cause]} after ${distance} m.`;
    document.getElementById('end-note').textContent = newBest ? 'New best score.' : '';
    document.getElementById('end-score').textContent = score;
    document.getElementById('end-best').textContent = best;
    document.getElementById('end-distance').textContent = `${distance} m`;
    document.getElementById('end-far').textContent = `${farthest} m`;
    setState('over');
    againButton.focus();
};

const startGame = () => {
    clearTimeout(endTimer);
    world = newWorld();
    dust = [];
    letterGlow = 0;
    clock = 0;
    finger = null;
    syncHud();
    setState('playing');
    document.activeElement?.blur();
};

const letGo = () => {
    releaseJump(world);
    setDuck(world, false);
    finger = null;
};

const pause = () => {
    if (root.dataset.state !== 'playing') return;
    letGo();
    setState('paused');
    resumeButton.focus();
};

const resume = () => {
    if (root.dataset.state !== 'paused') return;
    setState('playing');
    document.activeElement?.blur();
};

const puff = (x, y, count, spread) => {
    if (reducedMotion.matches) return;
    for (let n = 0; n < count; n++) {
        dust.push({ x, y, vx: -40 - Math.random() * spread, vy: 20 + Math.random() * 60, age: 0 });
    }
};

const handleEvents = () => {
    world.events.forEach((event) => {
        if (event.type === 'land' || event.type === 'jump') puff(world.x, world.y, 4, 60);
        if (event.type === 'crashed') puff(world.x + BODY.half, world.y + 16, 8, 140);
        if (event.type === 'letter') letterGlow = clock + 0.5;
    });
    world.events.length = 0;
};

const sizeCanvas = () => {
    const width = board.clientWidth;
    const height = board.clientHeight;
    if (width < 10 || height < 10) return;
    const ratio = window.devicePixelRatio || 1;
    const scale = Math.min(width / VIEW.minWidth, height / VIEW.minHeight, VIEW.maxScale);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    unit = scale * ratio;
    view.w = width / scale;
    view.h = height / scale;
    // On a tall screen the roofs sit near the middle instead of hugging the bottom edge.
    view.base = view.h - Math.max(0, (view.h - 400) * 0.45);
    render();
};

// A steady pseudo-random number for a position, so scenery never changes between frames.
const hash = (n) => {
    const value = Math.sin(n * 127.1) * 43758.5453;
    return value - Math.floor(value);
};

const disc = (x, y, radius, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
};

const block = (x, y, w, h, radius, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
};

const stroke = (points, width, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach(([x, y], index) => {
        if (index) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
    });
    ctx.stroke();
};

const drawSky = (camera) => {
    ctx.fillStyle = PAINT.sky;
    ctx.fillRect(0, 0, view.w, view.h);
    disc(view.w * 0.78, view.base * 0.28, 30, PAINT.sun);
    const drift = camera * 0.04;
    const pitch = 170;
    for (let n = Math.floor(drift / pitch) - 1; n * pitch - drift < view.w; n++) {
        const x = n * pitch - drift + hash(n) * 80;
        const y = 34 + hash(n + 0.5) * (view.base - 290);
        const w = 70 + hash(n + 0.25) * 50;
        block(x, y, w, 16, 8, PAINT.cloud);
        block(x + w * 0.22, y - 10, w * 0.5, 16, 8, PAINT.cloud);
    }
};

const drawSkyline = (camera, pace, pitch, low, high, color) => {
    const drift = camera * pace;
    ctx.fillStyle = color;
    for (let n = Math.floor(drift / pitch) - 1; n * pitch - drift < view.w; n++) {
        const tall = low + hash(n * 1.7 + pitch) * (high - low);
        const wide = pitch * (0.62 + hash(n * 2.3 + pitch) * 0.38);
        ctx.fillRect(n * pitch - drift, view.base - tall, wide + 1, view.h);
        // A water tank or a stair head on some of them.
        if (hash(n * 3.1 + pitch) > 0.55) ctx.fillRect(n * pitch - drift + wide * 0.2, view.base - tall - 14, wide * 0.3, 14);
    }
};

const drawHazard = (hazard, left, top) => {
    if (hazard.kind === 'sign') {
        const boardTop = top - SIGN.top;
        const boardHeight = SIGN.top - SIGN.bottom;
        ctx.fillStyle = PAINT.post;
        ctx.fillRect(left + 3, boardTop + 6, 4, SIGN.top - 6);
        ctx.fillRect(left + hazard.w - 7, boardTop + 6, 4, SIGN.top - 6);
        block(left, boardTop, hazard.w, boardHeight, 4, PAINT.sign);
        block(left + 6, boardTop + 8, hazard.w - 12, 8, 3, PAINT.signLine);
        block(left + 6, boardTop + 24, (hazard.w - 12) * 0.6, 8, 3, PAINT.signLine);
        // Chevrons along the bottom edge point at the way through.
        for (let x = left + 9; x + 10 <= left + hazard.w - 5; x += 16) {
            stroke([[x, top - SIGN.bottom - 16], [x + 5, top - SIGN.bottom - 9], [x + 10, top - SIGN.bottom - 16]], 2.5, PAINT.signLine);
        }
    } else if (hazard.kind === 'crate') {
        block(left, top - hazard.h, hazard.w, hazard.h, 3, PAINT.crate);
        stroke([[left + 5, top - hazard.h + 5], [left + hazard.w - 5, top - 5]], 2.5, PAINT.crateLine);
        stroke([[left + hazard.w - 5, top - hazard.h + 5], [left + 5, top - 5]], 2.5, PAINT.crateLine);
    } else if (hazard.kind === 'vent') {
        block(left, top - hazard.h, hazard.w, hazard.h, 4, PAINT.vent);
        for (let y = top - hazard.h + 6; y < top - 3; y += 6) stroke([[left + 6, y], [left + hazard.w - 6, y]], 2, PAINT.ventLine);
    } else {
        ctx.fillStyle = PAINT.pipe;
        ctx.fillRect(left + 3, top - hazard.h + 6, hazard.w - 6, hazard.h - 6);
        block(left, top - hazard.h, hazard.w, 8, 3, PAINT.pipeCap);
    }
};

const drawRoof = (roof, camera) => {
    const left = roof.x - camera;
    if (left > view.w + 10 || left + roof.w < -10) return;
    const top = view.base - roof.top;
    const style = BUILDINGS[Math.floor(hash(roof.x) * BUILDINGS.length)];
    ctx.fillStyle = style.wall;
    ctx.fillRect(left, top, roof.w, view.h - top);
    for (let x = 14; x + 12 <= roof.w - 12; x += 26) {
        for (let y = 24; top + y < view.h; y += 30) {
            ctx.fillStyle = hash(roof.x + x * 7.3 + y * 3.1) > 0.68 ? PAINT.lit : style.pane;
            ctx.fillRect(left + x, top + y, 12, 17);
        }
    }
    ctx.fillStyle = PAINT.ledgeShade;
    ctx.fillRect(left - 3, top + 6, roof.w + 6, 4);
    ctx.fillStyle = PAINT.ledge;
    ctx.fillRect(left - 3, top, roof.w + 6, 7);
    roof.hazards.forEach((hazard) => drawHazard(hazard, hazard.x - camera, top));
    roof.letters.forEach((letter) => {
        if (letter.taken) return;
        const bob = reducedMotion.matches ? 0 : Math.sin(clock * 4 + letter.x) * 3;
        const x = letter.x - camera;
        const y = view.base - letter.y + bob;
        block(x - 11, y - 8, 22, 16, 3, PAINT.paper);
        stroke([[x - 9, y - 6], [x, y + 1], [x + 9, y - 6]], 2, PAINT.seal);
    });
};

// Drawn around the feet at 0, 0 with y pointing down, so every pose shares one origin.
const drawRunner = () => {
    const stride = Math.sin(world.x * 0.05);
    if (world.status !== 'running') {
        ctx.translate(0, -22);
        ctx.rotate(reducedMotion.matches ? -0.6 : clock * -9);
        ctx.translate(0, 22);
    }
    if (world.ducking) {
        stroke([[-13, -6], [-22, -2]], 5, PAINT.runner);
        stroke([[-10, -5], [-17, -9]], 5, PAINT.runner);
        block(-15, -15, 26, 12, 6, PAINT.runner);
        ctx.fillStyle = PAINT.scarf;
        ctx.beginPath();
        ctx.moveTo(6, -14);
        ctx.lineTo(-10, -19);
        ctx.lineTo(-7, -13);
        ctx.fill();
        disc(12, -12, 6.5, PAINT.skin);
        block(-9, -17, 9, 7, 2, PAINT.bag);
        return;
    }
    if (world.grounded) {
        stroke([[0, -18], [stride * 10, -1]], 5, PAINT.runner);
        stroke([[0, -18], [-stride * 10, -1]], 5, PAINT.runner);
    } else {
        stroke([[0, -18], [9, -10], [5, -3]], 5, PAINT.runner);
        stroke([[0, -18], [-9, -11], [-13, -4]], 5, PAINT.runner);
    }
    block(-7, -37, 14, 22, 6, PAINT.runner);
    block(-13, -34, 8, 11, 2, PAINT.bag);
    const wave = reducedMotion.matches ? 0 : Math.sin(clock * 14) * 2;
    ctx.fillStyle = PAINT.scarf;
    ctx.beginPath();
    ctx.moveTo(4, -33);
    ctx.lineTo(-19, -37 + wave);
    ctx.lineTo(-16, -29 + wave);
    ctx.fill();
    block(-6, -35, 12, 5, 2, PAINT.scarf);
    disc(1, -39, 6.5, PAINT.skin);
    const reachY = world.grounded ? -22 : -36;
    stroke([[0, -30], [(world.grounded ? -stride : 1) * 9, reachY]], 4, PAINT.skin);
};

const render = () => {
    ctx.setTransform(unit, 0, 0, unit, 0, 0);
    const lead = Math.max(70, view.w * VIEW.runnerAt);
    const camera = world.x - lead;
    drawSky(camera);
    drawSkyline(camera, 0.12, 96, 150, 320 + Math.max(0, view.h - 430) * 0.5, PAINT.far);
    drawSkyline(camera, 0.3, 132, 40, 180, PAINT.near);
    world.roofs.forEach((roof) => drawRoof(roof, camera));
    dust.forEach((speck) => {
        ctx.fillStyle = PAINT.dust;
        ctx.fillRect(speck.x - camera - 2, view.base - speck.y - 2, 4, 4);
    });
    ctx.translate(lead, view.base - world.y);
    drawRunner();
};

const frame = (now) => {
    const seconds = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const state = root.dataset.state;
    if (state === 'playing' || state === 'ending') {
        clock += seconds;
        stepWorld(world, seconds);
        if (world.status === 'running' && world.ducking && world.grounded) puff(world.x - 12, world.y, Math.random() < 0.3 ? 1 : 0, 40);
        handleEvents();
        syncHud();
        if (state === 'playing' && world.status !== 'running') {
            root.dataset.state = 'ending';
            endTimer = setTimeout(showEnd, END_DELAY_MS);
        }
        dust.forEach((speck) => {
            speck.age += seconds;
            speck.x += speck.vx * seconds;
            speck.y += speck.vy * seconds;
        });
        dust = dust.filter((speck) => speck.age < 0.35);
    }
    render();
    requestAnimationFrame(frame);
};

// One finger does everything: touching down jumps, sliding down ducks, sliding back up jumps again, no lifting needed.
root.addEventListener('pointerdown', (event) => {
    if (root.dataset.state !== 'playing' || event.target.closest('button, a')) return;
    event.preventDefault();
    finger = { id: event.pointerId, anchor: event.clientY, ducking: false };
    root.setPointerCapture(event.pointerId);
    pressJump(world);
});

root.addEventListener('pointermove', (event) => {
    if (!finger || finger.id !== event.pointerId || root.dataset.state !== 'playing') return;
    const travel = event.clientY - finger.anchor;
    if (!finger.ducking && travel >= SLIDE_PX) {
        finger.ducking = true;
        finger.anchor = event.clientY;
        releaseJump(world);
        setDuck(world, true);
    } else if (finger.ducking && travel <= -SLIDE_PX) {
        finger.ducking = false;
        finger.anchor = event.clientY;
        setDuck(world, false);
        pressJump(world);
    } else if (finger.ducking ? travel > 0 : travel < 0) {
        // The anchor follows the finger in the direction it already went, so a turn is measured from the far point.
        finger.anchor = event.clientY;
    }
});

const liftFinger = (event) => {
    if (finger && finger.id === event.pointerId) letGo();
};

root.addEventListener('pointerup', liftFinger);
root.addEventListener('pointercancel', liftFinger);

window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const state = root.dataset.state;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const jump = key === ' ' || key === 'ArrowUp' || key === 'w';
    const duck = key === 'ArrowDown' || key === 's';
    if (state === 'playing' || state === 'ending') {
        if (jump || duck) {
            event.preventDefault();
            if (event.repeat || state === 'ending') return;
            if (jump) pressJump(world);
            else setDuck(world, true);
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
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === ' ' || key === 'ArrowUp' || key === 'w') releaseJump(world);
    if (key === 'ArrowDown' || key === 's') setDuck(world, false);
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
