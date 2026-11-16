// Tower Tilt: drop swinging blocks, keep what overlaps, and stop the tower tipping over.

const BEST_KEY = 'arcade.tower-tilt.best';
const MUTE_KEY = 'arcade.tower-tilt.muted';

// World units, y pointing up, x measured from the centre of the site.
const BLOCK_H = 46;
const BASE_W = 190;
const TOP_SPACE = 440;      // from the tower top to the top of the view
const PIVOT_UP = 400;       // crane pivot above the tower top
const CABLE = 250;
const SWING = 0.556;        // swing half angle in radians: the block travels 132 units either side
const GRAVITY = 3000;
const REGROW = 8;           // width won back by each perfect drop in a streak
const MIN_KEEP = 4;         // a thinner overlap than this counts as a miss
const LEAN_MAX = 0.19;      // lean in radians when the tilt reaches its limit
const TILT_GAIN = 0.8;       // tilt added by a drop that is off by its whole width
const TILT_WARN = 0.65;
const TOPPLE_TIME = 0.9;
const RESTART_LOCK = 0.45;  // seconds before the end screen accepts Play again
const CLOUD_SPAN = 1000;
const HUD_CLEAR = 82;        // screen pixels kept free above the crane for the score row

const COLORS = {
    ink: '#1d2433',
    paper: '#fff7e0',
    skyLow: [207, 234, 245],
    skyHigh: [150, 178, 240],
    cloud: '#ffffff',
    sun: '#ffd24a',
    grass: '#74c47c',
    grassEdge: '#4d9d5c',
    trolley: '#ffd24a',
    good: '#17734d',
    bad: '#c2331f'
};

const FOUNDATION = { body: '#a3adc4', glass: '#5d6a88' };

const BLOCK_COLORS = [
    { body: '#ffd24a', glass: '#b3820a' },
    { body: '#ff6b5e', glass: '#a8322a' },
    { body: '#3fd0c9', glass: '#1c7f7a' },
    { body: '#a393ff', glass: '#5a4abf' }
];

const CLOUDS = [
    { x: -0.75, y: 60, size: 1.1 },
    { x: 0.6, y: 190, size: 0.8 },
    { x: -0.3, y: 340, size: 0.7 },
    { x: 0.85, y: 470, size: 1.2 },
    { x: -0.9, y: 600, size: 0.9 },
    { x: 0.25, y: 730, size: 1 },
    { x: -0.55, y: 880, size: 0.75 }
];

const root = document.getElementById('game');
const stage = document.getElementById('stage');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const needleEl = document.getElementById('needle');
const tiltLabelEl = document.getElementById('tilt-label');
const startPanel = document.getElementById('start-panel');
const pausePanel = document.getElementById('pause-panel');
const overPanel = document.getElementById('over-panel');
const startBtn = document.getElementById('start');
const resumeBtn = document.getElementById('resume');
const againBtn = document.getElementById('again');
const pauseBtn = document.getElementById('pause');
const muteBtn = document.getElementById('mute');
const finalScoreEl = document.getElementById('final-score');
const finalUnitEl = document.getElementById('final-unit');
const finalDetailEl = document.getElementById('final-detail');
const finalBestEl = document.getElementById('final-best');
const newBestEl = document.getElementById('new-best');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const rand = (min, max) => min + Math.random() * (max - min);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const readStore = (key) => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const writeStore = (key, value) => {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Storage is blocked: the game still plays, it just forgets.
    }
};

let state = 'ready';
let best = Number(readStore(BEST_KEY)) || 0;
let muted = readStore(MUTE_KEY) === '1';
let audio = null;

let blocks = [];      // { cx, w, color }, foundation first; cx runs along the tower's own axis
let hook = null;      // { phase, block, turned, pop }
let falling = null;   // the dropped block until it lands or leaves the view
let debris = [];
let popups = [];
let tilt = 0;         // -1 to 1; the tower goes over at either end
let tiltShown = 0;
let streak = 0;
let perfects = 0;
let cam = BLOCK_H;    // eased height of the tower top
let topple = null;    // { dir, reason, time } while the tower is going over
let flash = 0;
let shake = 0;
let clock = 0;
let overAt = 0;
let lastFrame = 0;

const view = { w: 0, h: 0, scale: 1 };

const floors = () => blocks.length - 1;
const swingRate = () => 1.75 + Math.min(floors(), 50) * 0.035;

// Sound: short WebAudio tones, created on the first user gesture.

const ensureAudio = () => {
    if (muted) return;
    if (!audio) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        audio = new AudioContextClass();
    }
    if (audio.state === 'suspended') audio.resume();
};

const tone = (from, to, duration, type = 'sine', volume = 0.07, delay = 0) => {
    if (muted || !audio) return;
    const start = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.linearRampToValueAtTime(to, start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.linearRampToValueAtTime(0, start + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
};

const showMute = () => {
    muteBtn.setAttribute('aria-pressed', String(muted));
    muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
};

// Tower geometry

// Lean of the top of the tower in radians, positive to the right: steady lean plus a slow sway.
const lean = () => {
    const sway = (0.012 + 0.05 * Math.abs(tiltShown) + 0.0004 * Math.min(floors(), 50)) * Math.sin(clock * 1.7);
    const fall = topple && !reducedMotion.matches ? topple.dir * 1.25 * (topple.time / TOPPLE_TIME) ** 2 : 0;
    return tiltShown * LEAN_MAX + sway + fall;
};

// The top floors bend like a reed: each row leans a little more than the one below it.
// Returns the bent rows plus the point and angle of the surface the next block lands on.
const layout = () => {
    const top = lean();
    const first = Math.max(0, blocks.length - 11);
    const rows = [];
    let x = 0;
    let y = first * BLOCK_H;
    let angle = 0;
    for (let j = first; j < blocks.length; j++) {
        const byHeight = clamp(((j + 0.5) * BLOCK_H - (cam - 380)) / 260, 0, 1);
        angle = top * Math.min(byHeight, j / 3);
        rows.push({ block: blocks[j], x, y, angle });
        x += Math.sin(angle) * BLOCK_H;
        y += Math.cos(angle) * BLOCK_H;
    }
    return { first, rows, x, y, angle };
};

const hookAt = () => {
    const angle = SWING * Math.sin(hook.phase);
    const pivotY = cam + PIVOT_UP;
    return { angle, pivotY, x: Math.sin(angle) * CABLE, y: pivotY - Math.cos(angle) * CABLE };
};

const toScreen = (x, y) => ({
    x: view.w / 2 + x * view.scale,
    y: HUD_CLEAR + (cam + TOP_SPACE - y) * view.scale
});

// Lowest world height that is still on screen.
const viewFloor = () => cam + TOP_SPACE - (view.h - HUD_CLEAR) / view.scale;

// HUD and screens

const showScore = () => {
    scoreEl.textContent = floors();
    bestEl.textContent = Math.max(best, floors());
};

const showTilt = () => {
    needleEl.style.left = `calc(${50 + clamp(tiltShown, -1, 1) * 50}% - 4px)`;
    // One label above the gauge: a lean warning beats a perfect streak, which beats the plain name.
    const warn = Math.abs(tilt) >= TILT_WARN;
    const onStreak = !warn && streak >= 2;
    const text = warn ? 'Leaning' : onStreak ? `Perfect x${streak}` : 'Tilt';
    if (tiltLabelEl.textContent !== text) tiltLabelEl.textContent = text;
    tiltLabelEl.classList.toggle('warn', warn);
    tiltLabelEl.classList.toggle('streak', onStreak);
};

const setState = (next) => {
    state = next;
    root.dataset.state = next;
    startPanel.hidden = next !== 'ready';
    pausePanel.hidden = next !== 'paused';
    overPanel.hidden = next !== 'over';
    pauseBtn.disabled = next === 'ready' || next === 'over';
};

const resetRun = () => {
    blocks = [{ cx: 0, w: BASE_W, color: FOUNDATION }];
    hook = { phase: -Math.PI / 2, block: { w: BASE_W, color: BLOCK_COLORS[0] }, turned: false, pop: 0 };
    falling = null;
    debris = [];
    popups = [];
    tilt = 0;
    tiltShown = 0;
    streak = 0;
    perfects = 0;
    cam = BLOCK_H;
    topple = null;
    flash = 0;
    shake = 0;
    showScore();
    showTilt();
};

const startGame = () => {
    if (state !== 'ready' && state !== 'over') return;
    if (state === 'over' && clock - overAt < RESTART_LOCK) return;
    ensureAudio();
    resetRun();
    setState('playing');
    tone(330, 495, 0.12, 'triangle');
};

const pause = () => {
    if (state !== 'playing') return;
    setState('paused');
    resumeBtn.focus();
};

const resume = () => {
    if (state !== 'paused') return;
    setState('playing');
};

const endRun = () => {
    const total = floors();
    const isBest = total > best;
    if (isBest) {
        best = total;
        writeStore(BEST_KEY, String(best));
    }
    overAt = clock;
    finalScoreEl.textContent = total;
    finalUnitEl.textContent = total === 1 ? 'floor' : 'floors';
    const cause = topple.reason === 'miss' ? 'The block missed the tower.' : 'The tower leaned too far.';
    finalDetailEl.textContent = `${cause} ${perfects} perfect ${perfects === 1 ? 'drop' : 'drops'}.`;
    finalBestEl.textContent = best;
    newBestEl.hidden = !isBest;
    showScore();
    setState('over');
    againBtn.focus();
};

// Play

const drop = () => {
    if (state !== 'playing' || !hook.block || topple) return;
    const at = hookAt();
    // A hanging block leans with its cable: angles here are positive to the right, like the tower's.
    falling = { ...hook.block, x: at.x, y: at.y, vx: 0, vy: 0, angle: -at.angle, spin: 0, missed: false };
    hook.block = null;
    hook.turned = false;
    tone(520, 400, 0.06, 'triangle', 0.04);
};

const addPopup = (text, x, y, color) => popups.push({ text, x, y, color, age: 0 });

const startTopple = (dir, reason) => {
    topple = { dir, reason, time: 0 };
    streak = 0;
    if (!reducedMotion.matches) shake = 1;
    tone(260, 50, 0.8, 'sawtooth', 0.06);
};

const land = (local, surface) => {
    const below = blocks[blocks.length - 1];
    const { w, color } = falling;
    const offset = local - below.cx;
    const side = Math.sign(offset) || 1;
    const over = Math.abs(offset);

    if (w - over < MIN_KEEP) {
        falling.missed = true;
        falling.vx = side * 70;
        falling.spin = side * 2.4;
        startTopple(side, 'miss');
        return;
    }

    falling = null;
    const popupY = surface.y + BLOCK_H * 1.6;
    // A perfect drop may be off by a tenth of the block, within 5 to 8 units.
    if (over <= clamp(w * 0.1, 5, 8)) {
        streak++;
        perfects++;
        const grown = streak >= 2 ? Math.min(BASE_W, w + REGROW) : w;
        blocks.push({ cx: below.cx, w: grown, color });
        tilt *= 0.7;
        if (!reducedMotion.matches) flash = 1;
        const praise = streak >= 2 ? `Perfect x${streak}` : 'Perfect';
        addPopup(grown > w ? `${praise}, wider` : praise, surface.x, popupY, COLORS.good);
        const pitch = 620 * (1 + Math.min(streak, 10) * 0.07);
        tone(pitch, pitch, 0.09, 'sine', 0.08);
        tone(pitch * 1.5, pitch * 1.5, 0.14, 'sine', 0.06, 0.08);
    } else {
        streak = 0;
        blocks.push({ cx: below.cx + offset / 2, w: w - over, color });
        tilt += (offset / w) * TILT_GAIN;
        // The overhang drops away from the point where it was cut.
        const along = below.cx + offset / 2 + (side * w) / 2;
        const cos = Math.cos(surface.angle);
        const sin = Math.sin(surface.angle);
        const cutX = surface.x + cos * along + sin * BLOCK_H / 2;
        const cutY = surface.y - sin * along + cos * BLOCK_H / 2;
        debris.push({
            x: cutX, y: cutY,
            vx: side * rand(50, 90), vy: 0,
            angle: surface.angle, spin: side * rand(1.5, 3),
            w: over, color
        });
        addPopup(`-${Math.round(over)}`, cutX, cutY + BLOCK_H, COLORS.bad);
        tone(520, 300, 0.07, 'square', 0.03);
    }
    tone(150, 90, 0.12, 'triangle', 0.1);
    if (!reducedMotion.matches) shake = Math.max(shake, 0.25);
    showScore();
    if (Math.abs(tilt) >= 1) startTopple(Math.sign(tilt), 'tilt');
};

const stepFalling = (dt, surface) => {
    falling.vy -= GRAVITY * dt;
    falling.x += falling.vx * dt;
    falling.y += falling.vy * dt;
    if (falling.missed) {
        falling.angle += falling.spin * dt;
        return;
    }
    falling.angle += (surface.angle - falling.angle) * (1 - Math.exp(-dt * 14));
    const relX = falling.x - surface.x;
    const relY = falling.y - BLOCK_H / 2 - surface.y;
    const cos = Math.cos(surface.angle);
    const sin = Math.sin(surface.angle);
    // Height of the block's underside above the tilted top surface.
    if (relX * sin + relY * cos > 0) return;
    land(relX * cos - relY * sin, surface);
};

const stepHook = (dt) => {
    const before = Math.cos(hook.phase);
    hook.phase += swingRate() * dt;
    hook.pop = Math.max(0, hook.pop - dt * 6);
    if (hook.block) return;
    // The empty hook picks up the next block once it has swung out to a turn and the last one has landed.
    if (before * Math.cos(hook.phase) <= 0) hook.turned = true;
    if (hook.turned && !falling && !topple && state === 'playing') {
        const top = blocks[blocks.length - 1];
        hook.block = { w: top.w, color: BLOCK_COLORS[floors() % BLOCK_COLORS.length] };
        hook.pop = 1;
    }
};

const update = (dt) => {
    clock += dt;
    cam += (blocks.length * BLOCK_H - cam) * (1 - Math.exp(-dt * 6));
    tiltShown += (tilt - tiltShown) * (1 - Math.exp(-dt * 5));

    if (state !== 'over') stepHook(dt);
    if (state === 'playing') {
        if (falling) stepFalling(dt, layout());
        if (topple) {
            topple.time += dt;
            if (topple.time >= (reducedMotion.matches ? 0.3 : TOPPLE_TIME)) endRun();
        }
    }

    const viewBottom = viewFloor();
    if (falling && falling.y < viewBottom - 200) falling = null;
    for (const piece of debris) {
        piece.vy -= GRAVITY * 0.6 * dt;
        piece.x += piece.vx * dt;
        piece.y += piece.vy * dt;
        piece.angle += piece.spin * dt;
    }
    debris = debris.filter((piece) => piece.y > viewBottom - 200);
    for (const popup of popups) popup.age += dt;
    popups = popups.filter((popup) => popup.age < 1);
    flash = Math.max(0, flash - dt * 3);
    shake = Math.max(0, shake - dt * 3.5);
    showTilt();
};

// Drawing

const drawBlock = (cx, y, w, color) => {
    ctx.fillStyle = color.body;
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.rect(cx - w / 2, y, w, BLOCK_H);
    ctx.fill();
    ctx.stroke();
    const windows = Math.floor((w - 12) / 26);
    if (windows < 1) return;
    ctx.fillStyle = color.glass;
    const start = cx - (windows * 26 - 10) / 2;
    for (let i = 0; i < windows; i++) ctx.fillRect(start + i * 26, y + 12, 16, 22);
};

// Draws a loose block (hanging, falling or cut off) around its own centre.
const drawLoose = (x, y, angle, w, color, grow = 1) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-angle);
    ctx.scale(grow, grow);
    drawBlock(0, -BLOCK_H / 2, w, color);
    ctx.restore();
};

const drawSky = () => {
    const height = clamp(floors() / 60, 0, 1);
    const [r, g, b] = COLORS.skyLow.map((low, i) => Math.round(lerp(low, COLORS.skyHigh[i], height)));
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(0, 0, view.w, view.h);

    ctx.fillStyle = COLORS.sun;
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(view.w * 0.14, HUD_CLEAR + (view.h - HUD_CLEAR) * 0.28, 30 * view.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = COLORS.cloud;
    CLOUDS.forEach((cloud, i) => {
        const unit = view.scale * cloud.size;
        const drift = reducedMotion.matches ? 0 : Math.sin(clock * 0.12 + i * 1.7) * 24 * view.scale;
        const x = view.w / 2 + cloud.x * (view.w / 2) + drift;
        const y = HUD_CLEAR + (((cloud.y + cam * 0.35) % CLOUD_SPAN) - 100) * view.scale;
        ctx.beginPath();
        ctx.roundRect(x - 62 * unit, y - 16 * unit, 124 * unit, 34 * unit, 17 * unit);
        ctx.moveTo(x + 2 * unit, y - 16 * unit);
        ctx.arc(x - 22 * unit, y - 16 * unit, 24 * unit, 0, Math.PI * 2);
        ctx.moveTo(x + 47 * unit, y - 22 * unit);
        ctx.arc(x + 16 * unit, y - 22 * unit, 31 * unit, 0, Math.PI * 2);
        ctx.fill();
    });
};

const drawCrane = (halfWidth) => {
    const at = hookAt();
    const low = at.pivotY + 8;
    const high = at.pivotY + 30;
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-halfWidth, low);
    ctx.lineTo(halfWidth, low);
    ctx.moveTo(-halfWidth, high);
    ctx.lineTo(halfWidth, high);
    const bays = Math.ceil(halfWidth / 22);
    ctx.moveTo(-bays * 22, low);
    for (let i = -bays + 1; i <= bays; i++) ctx.lineTo(i * 22, (i + bays) % 2 ? high : low);
    ctx.stroke();

    // Cable to the top of the block, or to a bare hook while the next block is on its way.
    const reach = CABLE - BLOCK_H / 2;
    const endX = Math.sin(at.angle) * reach;
    const endY = at.pivotY - Math.cos(at.angle) * reach;
    ctx.beginPath();
    ctx.moveTo(0, at.pivotY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    ctx.fillStyle = COLORS.trolley;
    ctx.beginPath();
    ctx.rect(-24, at.pivotY - 8, 48, 18);
    ctx.fill();
    ctx.stroke();

    if (hook.block) {
        drawLoose(at.x, at.y, -at.angle, hook.block.w, hook.block.color, 1 - hook.pop * 0.25);
    }
    ctx.fillStyle = COLORS.ink;
    ctx.beginPath();
    ctx.arc(endX, endY, 5, 0, Math.PI * 2);
    ctx.fill();
};

const draw = () => {
    drawSky();

    const jolt = shake * 6;
    const halfWidth = view.w / 2 / view.scale + 10;
    const viewBottom = viewFloor();
    ctx.save();
    ctx.translate(view.w / 2 + rand(-jolt, jolt), HUD_CLEAR + (cam + TOP_SPACE) * view.scale + rand(-jolt, jolt));
    ctx.scale(view.scale, -view.scale);

    if (viewBottom < 0) {
        ctx.fillStyle = COLORS.grass;
        ctx.fillRect(-halfWidth, viewBottom - 20, halfWidth * 2, 20 - viewBottom);
        ctx.fillStyle = COLORS.grassEdge;
        ctx.fillRect(-halfWidth, -10, halfWidth * 2, 10);
    }

    const tower = layout();
    const lowest = Math.max(0, Math.floor(viewBottom / BLOCK_H) - 1);
    for (let j = lowest; j < tower.first; j++) drawBlock(blocks[j].cx, j * BLOCK_H, blocks[j].w, blocks[j].color);
    for (const row of tower.rows) {
        ctx.save();
        ctx.translate(row.x, row.y);
        ctx.rotate(-row.angle);
        drawBlock(row.block.cx, 0, row.block.w, row.block.color);
        if (flash > 0 && row === tower.rows[tower.rows.length - 1]) {
            const spread = (1 - flash) * 26;
            ctx.globalAlpha = flash;
            ctx.strokeStyle = COLORS.paper;
            ctx.lineWidth = 5;
            ctx.strokeRect(row.block.cx - row.block.w / 2 - spread, -spread, row.block.w + spread * 2, BLOCK_H + spread * 2);
            ctx.globalAlpha = 1;
        }
        ctx.restore();
    }

    for (const piece of debris) drawLoose(piece.x, piece.y, piece.angle, piece.w, piece.color);
    if (falling) drawLoose(falling.x, falling.y, falling.angle, falling.w, falling.color);
    drawCrane(halfWidth);
    ctx.restore();

    ctx.font = '800 20px "Outfit", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.paper;
    for (const popup of popups) {
        const at = toScreen(popup.x, popup.y);
        const rise = reducedMotion.matches ? 0 : popup.age * 30;
        const x = clamp(at.x, 70, view.w - 70);
        ctx.globalAlpha = clamp((1 - popup.age) / 0.3, 0, 1);
        ctx.strokeText(popup.text, x, at.y - rise);
        ctx.fillStyle = popup.color;
        ctx.fillText(popup.text, x, at.y - rise);
    }
    ctx.globalAlpha = 1;
};

const frame = (now) => {
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    if (state !== 'paused') update(dt);
    draw();
    requestAnimationFrame(frame);
};

const resize = () => {
    const ratio = window.devicePixelRatio || 1;
    view.w = stage.clientWidth;
    view.h = stage.clientHeight;
    view.scale = Math.min(view.w / 470, (view.h - HUD_CLEAR) / 700);
    canvas.width = Math.round(view.w * ratio);
    canvas.height = Math.round(view.h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
};

// Input

const isGoKey = (event) => event.code === 'Space' || event.code === 'Enter';
const isPauseKey = (event) => event.code === 'KeyP' || event.code === 'Escape';

window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (state === 'playing') {
        if (isGoKey(event)) {
            event.preventDefault();
            drop();
        } else if (isPauseKey(event)) {
            pause();
        }
    } else if (state === 'paused') {
        if (isPauseKey(event) || (isGoKey(event) && !event.target.closest('a, button'))) {
            event.preventDefault();
            resume();
        }
    } else if (isGoKey(event) && !event.target.closest('a, button')) {
        event.preventDefault();
        startGame();
    }
});

// Space clicks a focused button on key up: keep that from firing a toolbar button mid-run.
window.addEventListener('keyup', (event) => {
    if (state === 'playing' && isGoKey(event)) event.preventDefault();
});

canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    drop();
});

startBtn.addEventListener('click', startGame);
againBtn.addEventListener('click', startGame);
resumeBtn.addEventListener('click', resume);
pauseBtn.addEventListener('click', () => (state === 'paused' ? resume() : pause()));

muteBtn.addEventListener('click', () => {
    muted = !muted;
    writeStore(MUTE_KEY, muted ? '1' : '0');
    showMute();
    ensureAudio();
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
});
window.addEventListener('blur', pause);

new ResizeObserver(resize).observe(stage);

showMute();
resetRun();
setState('ready');
resize();
startBtn.focus();
requestAnimationFrame((now) => {
    lastFrame = now;
    frame(now);
});
