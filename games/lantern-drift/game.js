// Lantern Drift: steer a paper lantern down a night river, dodge what is in the water, keep the light fed.

const BEST_KEY = 'arcade.lantern-drift.best';
const MUTE_KEY = 'arcade.lantern-drift.muted';

// World units. x runs across the river from its middle, y is distance travelled downstream.
const TAU = Math.PI * 2;
const CHANNEL = 180;         // half width of the water
const LANTERN_R = 14;
const STEER_SPEED = 270;     // sideways speed from keys or a held side
const STEER_ACCEL = 1700;
const DRAG_SPEED = 480;      // sideways speed limit while following a drag
const DRAG_START = 12;       // screen pixels a pointer moves before a hold becomes a drag
const START_SPEED = 150;
const TOP_SPEED = 340;
const FULL_LEVEL = 9000;     // distance where the difficulty ramp tops out
const LIGHT_DRAIN = 0.06;    // light lost per second
const FIREFLY_LIGHT = 0.3;
const FIREFLY_SCORE = 10;
const LOW_LIGHT = 0.25;
const UNITS_PER_METRE = 10;
const MARK_EVERY = 250;      // metres between distance call-outs
const GENERATE_AHEAD = 1000;
const END_PAUSE = 0.6;       // seconds the crash stays on screen before the end panel
const RESTART_LOCK = 0.45;   // seconds before the end screen accepts Play again
const LANTERN_AT = 0.76;     // lantern position down the screen

// The same scene is painted three times: unlit, then inside the outer and inner light rings.
const PALETTES = {
    dark: {
        land: '#081a1c', bush: '#0c2623', shore: '#0f2e2a', water: '#0b2230', ripple: '#12303f',
        rock: '#21404f', rockTop: '#294b5a', log: '#2c2f2a', logEnd: '#383b33',
        reed: '#10322c', stalk: '#1a463b', reedHead: '#24493a'
    },
    mid: {
        land: '#102c28', bush: '#173f35', shore: '#1c4d3f', water: '#114152', ripple: '#1c586c',
        rock: '#4b6672', rockTop: '#607d89', log: '#5b4630', logEnd: '#785b3c',
        reed: '#1b5f4c', stalk: '#2f8a6c', reedHead: '#7a682f'
    },
    lit: {
        land: '#1a443a', bush: '#256650', shore: '#32805c', water: '#176178', ripple: '#2e879c',
        rock: '#8a9fa9', rockTop: '#b5c6cd', log: '#8c6439', logEnd: '#bd8e52',
        reed: '#278f6b', stalk: '#58cc99', reedHead: '#d6ac4e'
    }
};

const COLORS = {
    halo: 'rgba(255, 194, 71, 0.2)',
    base: '#5b3d22',
    paper: '#ffcf70',
    paperOut: '#7d6a4a',
    frame: '#b4662a',
    flame: '#fff6d0',
    firefly: '#eaff9a',
    fireflyGlow: 'rgba(214, 255, 120, 0.24)',
    splash: '#bfe9ee',
    popup: '#f4ecd8'
};

const END_TITLES = {
    rock: 'Snagged on a rock',
    log: 'Hit a drifting log',
    reeds: 'Caught in the reeds',
    dark: 'The light went out'
};

const root = document.getElementById('game');
const stage = document.getElementById('stage');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const lightEl = document.getElementById('light');
const lightFillEl = document.getElementById('light-fill');
const startPanel = document.getElementById('start-panel');
const pausePanel = document.getElementById('pause-panel');
const overPanel = document.getElementById('over-panel');
const startBtn = document.getElementById('start');
const resumeBtn = document.getElementById('resume');
const againBtn = document.getElementById('again');
const pauseBtn = document.getElementById('pause');
const muteBtn = document.getElementById('mute');
const overTitleEl = document.getElementById('over-title');
const finalScoreEl = document.getElementById('final-score');
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

let dist = 0;
let lantern = { x: 0, vx: 0 };
let light = 1;
let caught = 0;
let obstacles = [];     // rocks, reed beds and logs, in the order they come downstream
let fireflies = [];
let gen = null;         // where the next row goes and where its safe gap sits
let ending = null;      // { reason, time } between the crash and the end panel
let nextMark = MARK_EVERY;
let popups = [];
let sparks = [];
let shake = 0;
let clock = 0;
let overAt = 0;
let lastFrame = 0;
let shownScore = -1;

const steer = { left: false, right: false };
let pointer = null;     // { id, startX, side, dragging, lanternX, targetX }

const view = { w: 0, h: 0, scale: 1 };

const speedAt = (y) => Math.min(START_SPEED + y * 0.02, TOP_SPEED);
const score = () => Math.floor(dist / UNITS_PER_METRE) + caught * FIREFLY_SCORE;

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

// River generation
//
// Obstacles come in rows. Every row leaves a gap around gen.lane, and the lane only moves between
// rows by what the lantern can cover in the water between them, so the river is always passable.

const makeRock = (x, y, r) => ({
    kind: 'rock', x, y, r,
    from: y - r,
    to: y + r,
    shape: Array.from({ length: 8 }, (_, i) => ({ angle: (i / 8) * TAU + rand(-0.2, 0.2), reach: rand(0.82, 1.06) }))
});

// A reed bed is half an ellipse growing out of one bank.
const makeReeds = (side, reach, y, half) => {
    const tufts = [];
    const wanted = Math.round((reach * half) / 420);
    while (tufts.length < wanted) {
        const across = rand(0, 1);
        const along = rand(-1, 1);
        if (across * across + along * along < 0.82) {
            tufts.push({ x: side * (CHANNEL - across * reach), y: y + along * half });
        }
    }
    tufts.sort((a, b) => b.y - a.y);
    return { kind: 'reeds', side, reach, y, half, tufts, from: y - half, to: y + half };
};

const makeLog = (passX, y, len, angle, startX) => ({
    kind: 'log', passX, y, len, angle,
    thick: 24,
    // Sideways drift is tied to distance travelled, so the log is exactly at passX when the lantern reaches it.
    drift: (passX - startX) / GENERATE_AHEAD,
    from: y - 40,
    to: y + 40
});

const logX = (log, lanternY) => {
    const limit = CHANNEL - (log.len / 2) * Math.cos(log.angle);
    return clamp(log.passX + log.drift * (lanternY - log.y), -limit, limit);
};

const rockRow = (y, lane, gapHalf, level) => {
    const count = 1 + Math.floor(rand(0, 1 + level * 2.4));
    const placed = [];
    for (let i = 0; i < count; i++) {
        const r = rand(17, 30);
        for (let attempt = 0; attempt < 8; attempt++) {
            // The first rock hugs the gap so the row always asks for a decision.
            const side = Math.random() < 0.5 ? -1 : 1;
            const clear = gapHalf + r + (i === 0 ? rand(0, 16) : rand(10, 150));
            const x = lane + side * clear;
            // No slivers of water that look passable but are not: a rock either sits against
            // the bank or leaves room for the lantern, and the same goes between two rocks.
            const room = 2 * LANTERN_R + 18;
            const toBank = CHANNEL - Math.abs(x) - r;
            const fits = toBank > -r * 0.5 && (toBank < 6 || toBank > room)
                && placed.every((other) => Math.abs(other.x - x) > other.r + r + room);
            if (fits) {
                placed.push(makeRock(x, y + rand(30, 60), r));
                break;
            }
        }
    }
    return placed;
};

const reedRow = (y, lane, gapHalf, level) => {
    const half = rand(70, 120);
    const room = { '-1': lane - gapHalf + CHANNEL, 1: CHANNEL - lane - gapHalf };
    const both = level > 0.3 && Math.random() < 0.4;
    const first = room[1] > room[-1] ? 1 : -1;
    const sides = both ? [first, -first] : [first];
    return sides
        .filter((side) => room[side] >= 50)
        .map((side) => makeReeds(side, Math.min(room[side], 215), y + half, half));
};

const logRow = (y, lane, gapHalf) => {
    const side = lane > 0 ? -1 : 1;
    const room = CHANNEL - gapHalf - 8 + (side < 0 ? lane : -lane);
    const angle = rand(-0.3, 0.3);
    const len = Math.min(rand(100, 150), (room - 24) / Math.cos(angle));
    if (len < 70) return [];
    const reach = (len / 2) * Math.cos(angle) + 12;
    const passX = lane + side * (gapHalf + 8 + reach + rand(0, room - reach * 2));
    const limit = CHANNEL - reach;
    const startX = clamp(passX + rand(-200, 200), -limit, limit);
    return [makeLog(passX, y + 40, len, angle, startX)];
};

const addRow = () => {
    const level = clamp(gen.y / FULL_LEVEL, 0, 1);
    const gapHalf = lerp(62, 46, level);
    const spacing = lerp(250, 170, level) * rand(0.85, 1.2);
    const y = gen.y + spacing;
    // Half of what the lantern could cover in the open water before this row.
    const maxShift = 0.5 * STEER_SPEED * (spacing / speedAt(y));
    const edge = CHANNEL - gapHalf - 6;
    const lane = clamp(gen.lane + rand(-1, 1) * maxShift, -edge, edge);

    const pick = Math.random();
    let row = [];
    if (gen.rows >= 3 && pick < 0.3) row = reedRow(y, lane, gapHalf, level);
    else if (gen.rows >= 5 && pick < 0.3 + lerp(0.15, 0.3, level)) row = logRow(y, lane, gapHalf);
    if (!row.length) row = rockRow(y, lane, gapHalf, level);
    obstacles.push(...row);

    // Fireflies sit in the open water before the row, on or near the way through.
    if (y - 40 > gen.nextFly) {
        const along = rand(0.25, 0.75);
        const x = clamp(lerp(gen.lane, lane, along) + rand(-36, 36), -CHANNEL + 24, CHANNEL - 24);
        fireflies.push({ x, y: lerp(gen.y, y, along) + 10, phase: rand(0, TAU) });
        gen.nextFly = y + speedAt(y) * rand(1.2, 2);
    }

    gen.y = row.reduce((end, item) => Math.max(end, item.to), y);
    gen.lane = lane;
    gen.rows++;
};

// Collision

const hitsRock = (rock, x, y) => Math.hypot(x - rock.x, y - rock.y) < rock.r * 0.9 + LANTERN_R * 0.8;

const hitsReeds = (bed, x, y) => {
    const across = (x - bed.side * CHANNEL) / (bed.reach + LANTERN_R * 0.6);
    const along = (y - bed.y) / (bed.half + LANTERN_R * 0.6);
    return across * across + along * along < 1;
};

const hitsLog = (log, x, y) => {
    const span = (log.len - log.thick) / 2;
    const ax = Math.cos(log.angle);
    const ay = Math.sin(log.angle);
    const dx = x - logX(log, y);
    const dy = y - log.y;
    const along = clamp(dx * ax + dy * ay, -span, span);
    return Math.hypot(dx - ax * along, dy - ay * along) < log.thick / 2 + LANTERN_R * 0.8;
};

const HIT_TESTS = { rock: hitsRock, reeds: hitsReeds, log: hitsLog };

// The obstacle a lantern at this spot would be touching, if any.
const obstacleAt = (x, y) => obstacles.find((item) => y > item.from - LANTERN_R && y < item.to + LANTERN_R
    && HIT_TESTS[item.kind](item, x, y));

// HUD and screens

const showScore = () => {
    const now = score();
    if (now === shownScore) return;
    shownScore = now;
    scoreEl.textContent = now;
    bestEl.textContent = Math.max(best, now);
};

const showLight = () => {
    lightFillEl.style.transform = `scaleX(${light.toFixed(3)})`;
    lightEl.classList.toggle('low', light < LOW_LIGHT);
};

const setState = (next) => {
    state = next;
    root.dataset.state = next;
    startPanel.hidden = next !== 'ready';
    pausePanel.hidden = next !== 'paused';
    overPanel.hidden = next !== 'over';
    pauseBtn.disabled = next === 'ready' || next === 'over';
};

const dropControls = () => {
    steer.left = false;
    steer.right = false;
    pointer = null;
};

const resetRun = () => {
    dist = 0;
    lantern = { x: 0, vx: 0 };
    light = 1;
    caught = 0;
    obstacles = [];
    fireflies = [];
    gen = { y: 260, lane: 0, rows: 0, nextFly: 300 };
    ending = null;
    nextMark = MARK_EVERY;
    popups = [];
    sparks = [];
    shake = 0;
    dropControls();
    showScore();
    showLight();
};

const startGame = () => {
    if (state !== 'ready' && state !== 'over') return;
    if (state === 'over' && clock - overAt < RESTART_LOCK) return;
    ensureAudio();
    resetRun();
    setState('playing');
    tone(330, 495, 0.14, 'triangle');
};

const pause = () => {
    if (state !== 'playing') return;
    dropControls();
    setState('paused');
    resumeBtn.focus();
};

const resume = () => {
    if (state !== 'paused') return;
    setState('playing');
};

const endRun = () => {
    const total = score();
    const isBest = total > best;
    if (isBest) {
        best = total;
        writeStore(BEST_KEY, String(best));
    }
    overAt = clock;
    overTitleEl.textContent = END_TITLES[ending.reason];
    finalScoreEl.textContent = total;
    const metres = Math.floor(dist / UNITS_PER_METRE);
    finalDetailEl.textContent = `${metres} m downstream, ${caught} ${caught === 1 ? 'firefly' : 'fireflies'} caught`;
    finalBestEl.textContent = best;
    newBestEl.hidden = !isBest;
    showScore();
    setState('over');
    againBtn.focus();
};

// Play

// Popups ride along with the lantern, a set distance ahead of it, so the scroll never carries them off.
const addPopup = (text, x, ahead, color) => popups.push({ text, x, ahead, color, age: 0 });

const finish = (reason) => {
    ending = { reason, time: 0 };
    dropControls();
    lantern.vx = 0;
    if (reason === 'dark') {
        tone(300, 110, 0.5, 'sine', 0.07);
        return;
    }
    if (!reducedMotion.matches) {
        shake = 1;
        for (let i = 0; i < 12; i++) {
            const angle = rand(0, TAU);
            const speed = rand(50, 160);
            sparks.push({
                x: lantern.x, y: dist, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                age: 0, life: rand(0.3, 0.6), color: COLORS.splash
            });
        }
    }
    tone(190, 60, 0.4, 'sawtooth', 0.07);
};

const catchFirefly = (fly) => {
    caught++;
    light = Math.min(1, light + FIREFLY_LIGHT);
    addPopup(`+${FIREFLY_SCORE}`, fly.x, 44, COLORS.firefly);
    if (!reducedMotion.matches) {
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * TAU;
            sparks.push({
                x: fly.x, y: fly.y, vx: Math.cos(angle) * 70, vy: Math.sin(angle) * 70,
                age: 0, life: 0.35, color: COLORS.firefly
            });
        }
    }
    tone(880, 880, 0.07, 'sine', 0.06);
    tone(1320, 1320, 0.12, 'sine', 0.05, 0.06);
};

// Where a firefly is right now: it wanders a little around its spot.
const flyAt = (fly) => {
    if (reducedMotion.matches) return fly;
    return { x: fly.x + Math.sin(clock * 1.9 + fly.phase) * 7, y: fly.y + Math.cos(clock * 1.4 + fly.phase) * 5 };
};

const steerLantern = (dt) => {
    if (pointer && pointer.dragging) {
        lantern.vx = clamp((pointer.targetX - lantern.x) * 16, -DRAG_SPEED, DRAG_SPEED);
    } else {
        const held = pointer ? pointer.side : (steer.right ? 1 : 0) - (steer.left ? 1 : 0);
        const wanted = held * STEER_SPEED;
        const change = STEER_ACCEL * dt;
        lantern.vx += clamp(wanted - lantern.vx, -change, change);
    }
    const limit = CHANNEL - LANTERN_R - 2;
    lantern.x = clamp(lantern.x + lantern.vx * dt, -limit, limit);
    if (Math.abs(lantern.x) === limit) lantern.vx = 0;
};

const play = (dt) => {
    steerLantern(dt);
    dist += speedAt(dist) * dt;
    const before = light;
    light = Math.max(0, light - LIGHT_DRAIN * dt);
    if (before >= LOW_LIGHT && light < LOW_LIGHT) tone(520, 390, 0.25, 'triangle', 0.06);

    while (gen.y < dist + GENERATE_AHEAD) addRow();
    obstacles = obstacles.filter((item) => item.to > dist - 400);

    fireflies = fireflies.filter((fly) => {
        const at = flyAt(fly);
        if (Math.hypot(at.x - lantern.x, at.y - dist) < LANTERN_R + 15) {
            catchFirefly(fly);
            return false;
        }
        return fly.y > dist - 400;
    });

    const metres = Math.floor(dist / UNITS_PER_METRE);
    if (metres >= nextMark) {
        addPopup(`${nextMark} m`, lantern.x, 80, COLORS.popup);
        nextMark += MARK_EVERY;
    }

    const struck = obstacleAt(lantern.x, dist);
    if (struck) finish(struck.kind);
    else if (light <= 0) finish('dark');
    showScore();
    showLight();
};

const update = (dt) => {
    clock += dt;
    if (state === 'ready') {
        // The river idles past behind the start panel.
        dist += 50 * dt;
    } else if (state === 'playing') {
        if (ending) {
            ending.time += dt;
            if (ending.time >= END_PAUSE) endRun();
        } else {
            play(dt);
        }
    }

    shake = Math.max(0, shake - dt * 3.5);
    for (const popup of popups) popup.age += dt;
    popups = popups.filter((popup) => popup.age < 1);
    for (const spark of sparks) {
        spark.age += dt;
        spark.x += spark.vx * dt;
        spark.y += spark.vy * dt;
    }
    sparks = sparks.filter((spark) => spark.age < spark.life);
};

// Drawing

const cellNoise = (i, j, k) => {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const lightRadius = () => {
    const flicker = reducedMotion.matches ? 1 : 1 + Math.sin(clock * 9) * 0.012;
    const fade = ending && ending.reason === 'dark' ? 1 - ending.time / END_PAUSE : 1;
    return (80 + 170 * light ** 0.8) * flicker * fade;
};

const drawRock = (rock, palette) => {
    const outline = (scale, shiftX, shiftY) => {
        ctx.beginPath();
        for (const point of rock.shape) {
            ctx.lineTo(
                rock.x + shiftX + Math.cos(point.angle) * rock.r * point.reach * scale,
                rock.y + shiftY + Math.sin(point.angle) * rock.r * point.reach * scale
            );
        }
        ctx.closePath();
    };
    ctx.strokeStyle = palette.ripple;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(rock.x, rock.y, rock.r + 6, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = palette.rock;
    outline(1, 0, 0);
    ctx.fill();
    ctx.fillStyle = palette.rockTop;
    outline(0.55, -rock.r * 0.14, rock.r * 0.16);
    ctx.fill();
};

const drawReeds = (bed, palette) => {
    ctx.fillStyle = palette.reed;
    ctx.beginPath();
    // Only the half of the ellipse that lies in the water.
    const turn = bed.side < 0 ? -Math.PI / 2 : Math.PI / 2;
    ctx.ellipse(bed.side * CHANNEL, bed.y, bed.reach, bed.half, 0, turn, turn + Math.PI);
    ctx.fill();
    // Each tuft is a pair of cattails: a thin stalk with a fat head.
    ctx.lineCap = 'round';
    for (const tuft of bed.tufts) {
        ctx.strokeStyle = palette.stalk;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tuft.x - 4, tuft.y - 7);
        ctx.lineTo(tuft.x - 4, tuft.y + 4);
        ctx.moveTo(tuft.x + 4, tuft.y - 7);
        ctx.lineTo(tuft.x + 4, tuft.y - 1);
        ctx.stroke();
        ctx.strokeStyle = palette.reedHead;
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        ctx.moveTo(tuft.x - 4, tuft.y + 5);
        ctx.lineTo(tuft.x - 4, tuft.y + 11);
        ctx.moveTo(tuft.x + 4, tuft.y);
        ctx.lineTo(tuft.x + 4, tuft.y + 5);
        ctx.stroke();
    }
    ctx.lineCap = 'butt';
};

const drawLog = (log, palette) => {
    const span = (log.len - log.thick) / 2;
    ctx.save();
    ctx.translate(logX(log, dist), log.y);
    ctx.rotate(log.angle);
    ctx.lineCap = 'round';
    ctx.strokeStyle = palette.log;
    ctx.lineWidth = log.thick;
    ctx.beginPath();
    ctx.moveTo(-span, 0);
    ctx.lineTo(span, 0);
    ctx.stroke();
    ctx.strokeStyle = palette.logEnd;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-span * 0.7, 4);
    ctx.lineTo(-span * 0.1, 4);
    ctx.moveTo(span * 0.05, -4);
    ctx.lineTo(span * 0.6, -4);
    ctx.stroke();
    ctx.fillStyle = palette.logEnd;
    ctx.beginPath();
    ctx.arc(span, 0, log.thick / 2 - 4, 0, TAU);
    ctx.fill();
    ctx.lineCap = 'butt';
    ctx.restore();
};

const DRAWERS = { rock: drawRock, reeds: drawReeds, log: drawLog };

// Paints land, water and obstacles between world heights low and high in one palette.
const drawScene = (palette, low, high, halfWidth) => {
    ctx.fillStyle = palette.land;
    ctx.fillRect(-halfWidth, low, halfWidth * 2, high - low);
    ctx.fillStyle = palette.shore;
    ctx.fillRect(-CHANNEL - 8, low, CHANNEL * 2 + 16, high - low);
    ctx.fillStyle = palette.water;
    ctx.fillRect(-CHANNEL, low, CHANNEL * 2, high - low);

    // Bushes on the banks, placed from a hash so they hold still as the river scrolls.
    ctx.fillStyle = palette.bush;
    const columns = Math.ceil((halfWidth - CHANNEL) / 80);
    for (let j = Math.floor(low / 80) - 1; j <= Math.floor(high / 80); j++) {
        for (let i = 0; i < columns; i++) {
            for (const side of [-1, 1]) {
                const x = side * (CHANNEL + 26 + (i + cellNoise(i, j, side)) * 80);
                const y = (j + cellNoise(i, j, side + 5)) * 80;
                const r = 14 + cellNoise(i, j, side + 9) * 16;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, TAU);
                ctx.moveTo(x + r * 1.6, y - r * 0.3);
                ctx.arc(x + r * 0.9, y - r * 0.3, r * 0.7, 0, TAU);
                ctx.fill();
            }
        }
    }

    // Ripples slip past a little slower than the banks, which reads as moving water.
    ctx.strokeStyle = palette.ripple;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const slip = dist * 0.25;
    ctx.beginPath();
    for (let j = Math.floor((low - slip) / 64) - 1; j <= Math.floor((high - slip) / 64); j++) {
        for (let k = 0; k < 3; k++) {
            const x = (cellNoise(j, k, 1) * 2 - 1) * (CHANNEL - 30);
            const y = (j + cellNoise(j, k, 2)) * 64 + slip;
            const length = 8 + cellNoise(j, k, 3) * 12;
            ctx.moveTo(x - length, y);
            ctx.lineTo(x + length, y);
        }
    }
    ctx.stroke();
    ctx.lineCap = 'butt';

    for (const item of obstacles) {
        if (item.to > low - 20 && item.from < high + 20) DRAWERS[item.kind](item, palette);
    }
};

const drawLantern = () => {
    const out = ending !== null;
    const lean = clamp(lantern.vx / STEER_SPEED, -1, 1) * 0.22 + (out && ending.reason !== 'dark' ? 0.5 : 0);
    const bob = reducedMotion.matches ? 1 : 1 + Math.sin(clock * 3) * 0.03;
    ctx.save();
    ctx.translate(lantern.x, dist);
    if (!out) {
        ctx.fillStyle = COLORS.halo;
        ctx.beginPath();
        ctx.arc(0, 0, 30, 0, TAU);
        ctx.fill();
    }
    ctx.rotate(-lean);
    ctx.scale(bob, bob);
    ctx.fillStyle = COLORS.base;
    ctx.beginPath();
    ctx.roundRect(-LANTERN_R, -LANTERN_R, LANTERN_R * 2, LANTERN_R * 2, 5);
    ctx.fill();
    ctx.fillStyle = out ? COLORS.paperOut : COLORS.paper;
    ctx.beginPath();
    ctx.roundRect(-10, -10, 20, 20, 3);
    ctx.fill();
    ctx.strokeStyle = COLORS.frame;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(10, 0);
    ctx.moveTo(0, -10);
    ctx.lineTo(0, 10);
    ctx.stroke();
    if (!out) {
        ctx.fillStyle = COLORS.flame;
        ctx.beginPath();
        ctx.arc(0, 0, 2.5 + light * 3, 0, TAU);
        ctx.fill();
    }
    ctx.restore();
};

const draw = () => {
    const lanternY = view.h * LANTERN_AT;
    const low = dist - (view.h - lanternY) / view.scale - 10;
    const high = dist + lanternY / view.scale + 10;
    const halfWidth = view.w / 2 / view.scale + 10;
    const jolt = shake * 6;

    ctx.save();
    ctx.translate(view.w / 2 + rand(-jolt, jolt), lanternY + rand(-jolt, jolt));
    ctx.scale(view.scale, -view.scale);
    ctx.translate(0, -dist);

    drawScene(PALETTES.dark, low, high, halfWidth);
    // The light is two solid rings around the lantern: the same scene again in brighter colors.
    const radius = lightRadius();
    for (const [palette, reach] of [[PALETTES.mid, radius], [PALETTES.lit, radius * 0.6]]) {
        if (reach <= 1) continue;
        ctx.save();
        ctx.beginPath();
        ctx.arc(lantern.x, dist, reach, 0, TAU);
        ctx.clip();
        drawScene(palette, Math.max(low, dist - reach), Math.min(high, dist + reach), halfWidth);
        ctx.restore();
    }

    for (const fly of fireflies) {
        if (fly.y < low || fly.y > high) continue;
        const at = flyAt(fly);
        const pulse = reducedMotion.matches ? 1 : 1 + Math.sin(clock * 5 + fly.phase) * 0.2;
        ctx.fillStyle = COLORS.fireflyGlow;
        ctx.beginPath();
        ctx.arc(at.x, at.y, 12 * pulse, 0, TAU);
        ctx.fill();
        ctx.fillStyle = COLORS.firefly;
        ctx.beginPath();
        ctx.arc(at.x, at.y, 4, 0, TAU);
        ctx.fill();
    }

    for (const spark of sparks) {
        const left = 1 - spark.age / spark.life;
        ctx.globalAlpha = left;
        ctx.fillStyle = spark.color;
        ctx.beginPath();
        ctx.arc(spark.x, spark.y, 1 + left * 3, 0, TAU);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawLantern();
    ctx.restore();

    ctx.font = '800 20px "Outfit", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const popup of popups) {
        const rise = reducedMotion.matches ? 0 : popup.age * 30;
        const x = clamp(view.w / 2 + popup.x * view.scale, 40, view.w - 40);
        const y = lanternY - popup.ahead * view.scale - rise;
        ctx.globalAlpha = clamp((1 - popup.age) / 0.3, 0, 1);
        ctx.fillStyle = popup.color;
        ctx.fillText(popup.text, x, y);
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
    view.scale = Math.min(view.w / 420, view.h / 640);
    canvas.width = Math.round(view.w * ratio);
    canvas.height = Math.round(view.h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
};

// Input

const isGoKey = (event) => event.code === 'Space' || event.code === 'Enter';
const isPauseKey = (event) => event.code === 'KeyP' || event.code === 'Escape';

const steerKey = (event) => {
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') return 'left';
    if (event.code === 'ArrowRight' || event.code === 'KeyD') return 'right';
    return null;
};

window.addEventListener('keydown', (event) => {
    if (state === 'playing') {
        const side = steerKey(event);
        if (side) {
            event.preventDefault();
            if (!ending) steer[side] = true;
        } else if (isPauseKey(event) && !event.repeat) {
            pause();
        }
        return;
    }
    if (event.repeat) return;
    if (state === 'paused') {
        if (isPauseKey(event) || (isGoKey(event) && !event.target.closest('a, button'))) {
            event.preventDefault();
            resume();
        }
    } else if (isGoKey(event) && !event.target.closest('a, button')) {
        event.preventDefault();
        startGame();
    }
});

window.addEventListener('keyup', (event) => {
    const side = steerKey(event);
    if (side) steer[side] = false;
});

canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (state !== 'playing' || ending || pointer) return;
    canvas.setPointerCapture(event.pointerId);
    pointer = {
        id: event.pointerId,
        startX: event.clientX,
        side: event.clientX < view.w / 2 ? -1 : 1,
        dragging: false,
        lanternX: 0,
        targetX: 0
    };
});

canvas.addEventListener('pointermove', (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    if (!pointer.dragging) {
        if (Math.abs(event.clientX - pointer.startX) <= DRAG_START) return;
        // The drag starts from where the finger and the lantern are now, so a hold that
        // turns into a drag never yanks the lantern back.
        pointer.dragging = true;
        pointer.startX = event.clientX;
        pointer.lanternX = lantern.x;
    }
    pointer.targetX = pointer.lanternX + (event.clientX - pointer.startX) / view.scale;
});

const releasePointer = (event) => {
    if (pointer && event.pointerId === pointer.id) pointer = null;
};

canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);

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
