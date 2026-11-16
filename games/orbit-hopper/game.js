// Orbit Hopper: let go of a spinning planet and land inside the next planet's capture ring.

const BEST_KEY = 'arcade.orbit-hopper.best';
const MUTE_KEY = 'arcade.orbit-hopper.muted';

const TAU = Math.PI * 2;
const UP = -Math.PI / 2;
const LAUNCH_SPEED = 520;   // world units per second
const HOP_OFFSET = 13;      // hopper centre above the planet surface
const LAND_TIME = 0.16;
const MAX_FLIGHT = 640;     // world units flown before a hopper with nothing ahead is lost
const RESTART_LOCK = 0.45;  // seconds before the end screen accepts Play again
const FULL_LEVEL = 32;      // planet index where the difficulty ramp tops out

const COLORS = {
    bg: '#151233',
    starA: '#c6c0ee',
    starB: '#ffd24a',
    orbit: '#3d3485',
    ringFar: '#6a5fc0',
    ringNext: '#ff6b5e',
    hopper: '#f6f1e7',
    visor: '#151233',
    feet: '#ff6b5e',
    aim: '#f6f1e7',
    quick: '#ffd24a',
    success: '#8fe3b0',
    shade: 'rgba(21, 18, 51, 0.28)'
};

const PLANET_COLORS = [
    { body: '#3fd0c9', mark: '#279f99' },
    { body: '#ffd24a', mark: '#dda526' },
    { body: '#a393ff', mark: '#7a68de' },
    { body: '#ff6b5e', mark: '#d4463a' },
    { body: '#8fe3b0', mark: '#5cb884' },
    { body: '#7cc4ff', mark: '#4a97dc' }
];

const root = document.getElementById('game');
const stage = document.getElementById('stage');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const streakEl = document.getElementById('streak');
const startPanel = document.getElementById('start-panel');
const pausePanel = document.getElementById('pause-panel');
const overPanel = document.getElementById('over-panel');
const startBtn = document.getElementById('start');
const resumeBtn = document.getElementById('resume');
const againBtn = document.getElementById('again');
const pauseBtn = document.getElementById('pause');
const muteBtn = document.getElementById('mute');
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

let planets = [];
let hopper = null;
let score = 0;
let bonusTotal = 0;
let streak = 0;
let clock = 0;
let overAt = 0;
let shake = 0;
let lastFrame = 0;
let trailTimer = 0;
let popups = [];
let pulses = [];
let sparks = [];

// centre: how far down the screen the camera's focus sits (lower on tall screens, to show more of the way ahead).
const view = { w: 0, h: 0, scale: 1, centre: 0.54 };
const camera = { x: 0, y: 0 };

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

// Planet chain

// Angle range of the orbit from which a release crosses a ring of radius capR at distance dist.
const releaseWindow = (orbitR, capR, dist) =>
    Math.acos(clamp((orbitR - capR) / dist, -1, 1)) - Math.acos(clamp((orbitR + capR) / dist, -1, 1));

// Orbit angle at which a release flies straight through the target's centre.
const releaseAngle = (from, target) => {
    const dist = Math.hypot(target.x - from.x, target.y - from.y);
    const toTarget = Math.atan2(target.y - from.y, target.x - from.x);
    return toTarget - Math.sign(from.spin) * Math.acos((from.r + HOP_OFFSET) / dist);
};

const makeCraters = (r) => Array.from({ length: 3 }, (_, i) => ({
    angle: (i * TAU) / 3 + rand(-0.5, 0.5),
    dist: r * rand(0.25, 0.62),
    size: r * rand(0.14, 0.26)
}));

const makePlanet = (index, x, y, r, cap, spin, heading, drift) => ({
    index, x, y, r, cap, spin, heading, drift,
    baseX: x,
    baseY: y,
    rot: rand(0, TAU),
    bump: 0,
    color: PLANET_COLORS[index % PLANET_COLORS.length],
    craters: makeCraters(r)
});

const addPlanet = () => {
    const prev = planets[planets.length - 1];
    const index = prev.index + 1;
    const level = clamp(index / FULL_LEVEL, 0, 1);
    const gentle = index <= 3;

    const r = gentle ? 38 : rand(24, 46);
    const speed = gentle ? 1.9 : lerp(1.9, 3.5, level) * rand(0.85, 1.15);
    const spin = speed * (index > 1 && Math.random() < 0.5 ? -1 : 1);
    const drift = index >= 12 && Math.random() < lerp(0.15, 0.45, level)
        ? { angle: rand(0, TAU), amp: rand(14, 28), rate: rand(1, 1.5), phase: rand(0, TAU) }
        : null;

    // The ring must stay clear of the launch orbit, and the release window from the previous
    // planet must stay long enough to hit: pull the planet closer first, then widen its ring.
    const orbitR = prev.r + HOP_OFFSET;
    const sway = (drift ? drift.amp : 0) + (prev.drift ? prev.drift.amp : 0);
    const neededWindow = lerp(0.36, 0.15, level) * Math.abs(prev.spin);
    let cap = r + lerp(50, 22, level);
    let extra = rand(20, 110);
    const distance = () => orbitR + cap + 44 + sway + extra;
    const hittable = () => {
        const reach = distance() + sway;
        // A drifting target moves while the hopper is in flight, which eats into its ring.
        const lead = drift ? (drift.amp * drift.rate * reach) / LAUNCH_SPEED : 0;
        return releaseWindow(orbitR, cap - lead, reach) >= neededWindow;
    };
    while (!hittable()) {
        if (extra > 0) extra = Math.max(0, extra - 10);
        else cap += 4;
    }
    const dist = distance();

    // Turns stay under 52 degrees and the chain keeps climbing, so a flight never crosses an older planet.
    const turn = index === 1 ? rand(-0.4, 0.4) : rand(-0.9, 0.9);
    const heading = clamp(prev.heading + turn, UP - 1, UP + 1);
    planets.push(makePlanet(
        index,
        prev.baseX + Math.cos(heading) * dist,
        prev.baseY + Math.sin(heading) * dist,
        r, cap, spin, heading, drift
    ));
};

const nextPlanet = (planet) => planets.find((other) => other.index === planet.index + 1);

const placeHopper = () => {
    const { planet } = hopper;
    const radius = hopper.mode === 'land'
        ? lerp(hopper.landFrom, planet.r + HOP_OFFSET, hopper.landT / LAND_TIME)
        : planet.r + HOP_OFFSET;
    hopper.x = planet.x + Math.cos(hopper.angle) * radius;
    hopper.y = planet.y + Math.sin(hopper.angle) * radius;
};

const resetRun = () => {
    const first = makePlanet(0, 0, 0, 40, 0, 1.9, UP, null);
    planets = [first];
    while (planets.length < 4) addPlanet();
    hopper = {
        mode: 'orbit',
        planet: first,
        // The first clean release comes round about a second and a half after the start.
        angle: releaseAngle(first, planets[1]) - first.spin * 1.5,
        lap: 0,
        quick: false,
        landFrom: 0,
        landT: 0,
        flown: 0,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0
    };
    placeHopper();
    score = 0;
    bonusTotal = 0;
    streak = 0;
    shake = 0;
    popups = [];
    pulses = [];
    sparks = [];
    const target = cameraTarget();
    camera.x = target.x;
    camera.y = target.y;
    showScore();
};

const cameraTarget = () => {
    const from = hopper.planet;
    const to = nextPlanet(from);
    return { x: (from.baseX + to.baseX) / 2, y: (from.baseY + to.baseY) / 2 };
};

// HUD and screens

const showScore = () => {
    scoreEl.textContent = score;
    bestEl.textContent = Math.max(best, score);
    streakEl.hidden = streak < 2;
    streakEl.textContent = `Quick x${streak}`;
};

const setState = (next) => {
    state = next;
    root.dataset.state = next;
    startPanel.hidden = next !== 'ready';
    pausePanel.hidden = next !== 'paused';
    overPanel.hidden = next !== 'over';
    pauseBtn.disabled = next === 'ready' || next === 'over';
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
    const isBest = score > best;
    if (isBest) {
        best = score;
        writeStore(BEST_KEY, String(best));
    }
    overAt = clock;
    finalScoreEl.textContent = score;
    const reached = hopper.planet.index;
    finalDetailEl.textContent =
        `${reached} ${reached === 1 ? 'planet' : 'planets'} reached, +${bonusTotal} quick bonus`;
    finalBestEl.textContent = best;
    newBestEl.hidden = !isBest || score === 0;
    showScore();
    setState('over');
    againBtn.focus();
    if (!reducedMotion.matches) shake = 1;
    tone(220, 70, 0.45, 'sawtooth', 0.06);
};

// Play

const release = () => {
    const { planet } = hopper;
    const side = Math.sign(planet.spin);
    hopper.mode = 'fly';
    hopper.quick = hopper.lap <= TAU;
    hopper.flown = 0;
    hopper.vx = -Math.sin(hopper.angle) * side * LAUNCH_SPEED;
    hopper.vy = Math.cos(hopper.angle) * side * LAUNCH_SPEED;
    tone(420, 640, 0.09, 'triangle', 0.05);
};

// Popups anchor to a world point and sit a fixed number of screen pixels above it.
const addPopup = (text, planet, lift, color) =>
    popups.push({ text, x: planet.x, y: planet.y - planet.r - HOP_OFFSET, lift, color, age: 0 });

const land = (planet) => {
    const gained = planet.index - hopper.planet.index;
    streak = hopper.quick ? streak + 1 : 0;
    const bonus = streak >= 2 ? 1 : 0;
    score += gained + bonus;
    bonusTotal += bonus;

    hopper.mode = 'land';
    hopper.planet = planet;
    hopper.landFrom = Math.hypot(hopper.x - planet.x, hopper.y - planet.y);
    hopper.landT = 0;
    hopper.angle = Math.atan2(hopper.y - planet.y, hopper.x - planet.x);
    hopper.lap = 0;

    planet.bump = 1;
    while (planets[planets.length - 1].index < planet.index + 3) addPlanet();
    planets = planets.filter((other) => other.index >= planet.index - 2);

    addPopup(`+${gained + bonus}`, planet, 26, COLORS.hopper);
    if (bonus) addPopup(`Quick x${streak}`, planet, 50, COLORS.quick);
    if (!reducedMotion.matches) {
        pulses.push({ planet, age: 0 });
        for (let i = 0; i < 10; i++) {
            const angle = rand(0, TAU);
            const speed = rand(60, 170);
            sparks.push({
                x: hopper.x, y: hopper.y,
                vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                age: 0, life: rand(0.3, 0.55), color: planet.color.body
            });
        }
    }
    const pitch = 520 * (1 + Math.min(streak, 8) * 0.08);
    tone(pitch, pitch, 0.08, 'sine', 0.08);
    tone(pitch * 1.5, pitch * 1.5, 0.12, 'sine', 0.07, 0.07);
    showScore();
};

const toScreen = (x, y) => ({
    x: view.w / 2 + (x - camera.x) * view.scale,
    y: view.h * view.centre + (y - camera.y) * view.scale
});

const offScreen = () => {
    const margin = 40;
    const at = toScreen(hopper.x, hopper.y);
    return at.x < -margin || at.x > view.w + margin || at.y < -margin || at.y > view.h + margin;
};

// True while the flight line still crosses the ring of a planet ahead, so a hopper that is
// briefly off screen or on a long skip is not written off early.
const onCourse = () => planets.some((planet) => {
    if (planet.index <= hopper.planet.index) return false;
    const dx = planet.x - hopper.x;
    const dy = planet.y - hopper.y;
    const ahead = dx * hopper.vx + dy * hopper.vy;
    const wide = Math.abs(dx * hopper.vy - dy * hopper.vx) / LAUNCH_SPEED;
    return ahead > 0 && wide < planet.cap + (planet.drift ? planet.drift.amp : 0);
});

const fly = (dt) => {
    // Two sub-steps keep a fast hopper from skipping across a thin slice of ring.
    for (let step = 0; step < 2; step++) {
        hopper.x += hopper.vx * dt * 0.5;
        hopper.y += hopper.vy * dt * 0.5;
        const caught = planets.find((planet) =>
            planet.index > hopper.planet.index
            && Math.hypot(hopper.x - planet.x, hopper.y - planet.y) <= planet.cap);
        if (caught) {
            land(caught);
            return;
        }
    }
    hopper.flown += LAUNCH_SPEED * dt;
    if (!reducedMotion.matches) {
        trailTimer -= dt;
        if (trailTimer <= 0) {
            trailTimer = 0.025;
            sparks.push({ x: hopper.x, y: hopper.y, vx: 0, vy: 0, age: 0, life: 0.4, color: COLORS.feet });
        }
    }
    if ((hopper.flown > MAX_FLIGHT || offScreen()) && !onCourse()) endRun();
};

const update = (dt) => {
    clock += dt;
    for (const planet of planets) {
        planet.rot += planet.spin * dt;
        planet.bump = Math.max(0, planet.bump - dt * 4);
        if (planet.drift) {
            const offset = Math.sin(planet.drift.phase + clock * planet.drift.rate) * planet.drift.amp;
            planet.x = planet.baseX + Math.cos(planet.drift.angle) * offset;
            planet.y = planet.baseY + Math.sin(planet.drift.angle) * offset;
        }
    }

    if (hopper.mode === 'fly') {
        if (state === 'playing') fly(dt);
    } else {
        const turned = hopper.planet.spin * dt;
        hopper.angle += turned;
        hopper.lap += Math.abs(turned);
        if (hopper.mode === 'land') {
            hopper.landT += dt;
            if (hopper.landT >= LAND_TIME) hopper.mode = 'orbit';
        }
        placeHopper();
    }

    const target = cameraTarget();
    const ease = 1 - Math.exp(-dt * 4.5);
    camera.x += (target.x - camera.x) * ease;
    camera.y += (target.y - camera.y) * ease;

    shake = Math.max(0, shake - dt * 3.5);
    for (const popup of popups) popup.age += dt;
    popups = popups.filter((popup) => popup.age < 0.9);
    for (const pulse of pulses) pulse.age += dt;
    pulses = pulses.filter((pulse) => pulse.age < 0.45);
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

const drawStars = () => {
    // Stars live on a slower layer than the planets, laid out from a hash so they never pop.
    const cell = 130;
    const offsetX = camera.x * view.scale * 0.3;
    const offsetY = camera.y * view.scale * 0.3;
    const firstI = Math.floor((offsetX - view.w / 2) / cell);
    const lastI = Math.floor((offsetX + view.w / 2) / cell);
    const firstJ = Math.floor((offsetY - view.h / 2) / cell);
    const lastJ = Math.floor((offsetY + view.h / 2) / cell);
    for (let i = firstI; i <= lastI; i++) {
        for (let j = firstJ; j <= lastJ; j++) {
            for (let k = 0; k < 2; k++) {
                const x = (i + cellNoise(i, j, k)) * cell - offsetX + view.w / 2;
                const y = (j + cellNoise(i, j, k + 7)) * cell - offsetY + view.h / 2;
                const kind = cellNoise(i, j, k + 13);
                const size = kind > 0.85 ? 4 : 2;
                ctx.fillStyle = kind > 0.7 ? COLORS.starB : COLORS.starA;
                ctx.globalAlpha = 0.35 + kind * 0.5;
                ctx.fillRect(Math.round(x), Math.round(y), size, size);
            }
        }
    }
    ctx.globalAlpha = 1;
};

const circle = (x, y, r) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
};

const drawPlanet = (planet) => {
    const current = hopper.planet;
    const ahead = planet.index > current.index;
    const isNext = planet.index === current.index + 1;
    const spinDir = Math.sign(planet.spin);

    if (ahead) {
        ctx.setLineDash([11, 9]);
        ctx.lineDashOffset = reducedMotion.matches ? 0 : -clock * 16 * spinDir;
        ctx.lineWidth = isNext ? 3.5 : 2;
        ctx.strokeStyle = isNext ? COLORS.ringNext : COLORS.ringFar;
        circle(planet.x, planet.y, planet.cap);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    const r = planet.r * (1 + planet.bump * 0.1);
    ctx.fillStyle = planet.color.body;
    circle(planet.x, planet.y, r);
    ctx.fill();

    ctx.save();
    circle(planet.x, planet.y, r);
    ctx.clip();
    ctx.fillStyle = planet.color.mark;
    for (const crater of planet.craters) {
        const angle = planet.rot + crater.angle;
        circle(planet.x + Math.cos(angle) * crater.dist, planet.y + Math.sin(angle) * crater.dist, crater.size);
        ctx.fill();
    }
    // Fixed shadow on the lower right, so the spin reads from the craters alone.
    ctx.fillStyle = COLORS.shade;
    ctx.beginPath();
    ctx.rect(planet.x - r, planet.y - r, r * 2, r * 2);
    ctx.arc(planet.x - r * 0.3, planet.y - r * 0.3, r * 1.02, 0, TAU);
    ctx.fill('evenodd');
    ctx.restore();

    if (planet === current) {
        const orbitR = planet.r + HOP_OFFSET;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = COLORS.orbit;
        circle(planet.x, planet.y, orbitR);
        ctx.stroke();
        // What is left of the first lap: leave before it runs out for the quick bonus.
        if (state !== 'over' && hopper.mode !== 'fly' && hopper.lap < TAU) {
            ctx.lineWidth = 3.5;
            ctx.lineCap = 'round';
            ctx.strokeStyle = COLORS.quick;
            ctx.beginPath();
            ctx.arc(planet.x, planet.y, orbitR, hopper.angle, hopper.angle + spinDir * (TAU - hopper.lap), spinDir < 0);
            ctx.stroke();
            ctx.lineCap = 'butt';
        }
    }
};

const drawHopper = () => {
    const side = Math.sign(hopper.planet.spin);
    if (hopper.mode === 'orbit' && state !== 'over') {
        const tx = -Math.sin(hopper.angle) * side;
        const ty = Math.cos(hopper.angle) * side;
        const from = 16;
        const to = 72;
        ctx.strokeStyle = COLORS.aim;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.setLineDash([7, 7]);
        ctx.beginPath();
        ctx.moveTo(hopper.x + tx * from, hopper.y + ty * from);
        ctx.lineTo(hopper.x + tx * to, hopper.y + ty * to);
        ctx.stroke();
        ctx.setLineDash([]);
        const tipX = hopper.x + tx * (to + 8);
        const tipY = hopper.y + ty * (to + 8);
        ctx.beginPath();
        ctx.moveTo(tipX - tx * 9 - ty * 6, tipY - ty * 9 + tx * 6);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(tipX - tx * 9 + ty * 6, tipY - ty * 9 - tx * 6);
        ctx.stroke();
        ctx.lineCap = 'butt';
    }

    // Local frame: +x runs along the planet's spin, +y points at the planet.
    ctx.save();
    ctx.translate(hopper.x, hopper.y);
    ctx.rotate(hopper.angle + Math.PI / 2);
    ctx.fillStyle = COLORS.feet;
    circle(-5, 9, 3.6);
    ctx.fill();
    circle(5, 9, 3.6);
    ctx.fill();
    ctx.fillStyle = COLORS.hopper;
    circle(0, 0, 10);
    ctx.fill();
    ctx.fillStyle = COLORS.visor;
    ctx.beginPath();
    ctx.ellipse(side * 4, -1.5, 4.5, 3.4, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = COLORS.hopper;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-side * 2, -9);
    ctx.lineTo(-side * 5, -15);
    ctx.stroke();
    ctx.fillStyle = COLORS.quick;
    circle(-side * 5, -16, 2.6);
    ctx.fill();
    ctx.restore();
};

const draw = () => {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, view.w, view.h);
    drawStars();

    const jolt = shake * 7;
    ctx.save();
    ctx.translate(view.w / 2 + rand(-jolt, jolt), view.h * view.centre + rand(-jolt, jolt));
    ctx.scale(view.scale, view.scale);
    ctx.translate(-camera.x, -camera.y);

    for (const pulse of pulses) {
        ctx.globalAlpha = 1 - pulse.age / 0.45;
        ctx.strokeStyle = COLORS.success;
        ctx.lineWidth = 4;
        circle(pulse.planet.x, pulse.planet.y, pulse.planet.cap + pulse.age * 90);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const planet of planets) drawPlanet(planet);

    for (const spark of sparks) {
        const left = 1 - spark.age / spark.life;
        ctx.globalAlpha = left;
        ctx.fillStyle = spark.color;
        circle(spark.x, spark.y, 1 + left * 3);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (state !== 'over') drawHopper();
    ctx.restore();

    ctx.font = '800 20px "Outfit", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const popup of popups) {
        const rise = reducedMotion.matches ? 0 : popup.age * 34;
        const at = toScreen(popup.x, popup.y);
        ctx.globalAlpha = clamp((0.9 - popup.age) / 0.3, 0, 1);
        ctx.fillStyle = popup.color;
        ctx.fillText(popup.text, at.x, at.y - popup.lift - rise);
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
    view.scale = Math.min(view.w / 480, view.h / 600);
    view.centre = view.h > view.w ? 0.62 : 0.54;
    canvas.width = Math.round(view.w * ratio);
    canvas.height = Math.round(view.h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
};

// Input

const isGoKey = (event) => event.code === 'Space' || event.code === 'Enter';
const isPauseKey = (event) => event.code === 'KeyP' || event.code === 'Escape';

const letGo = () => {
    if (state === 'playing' && hopper.mode === 'orbit') release();
};

window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (state === 'playing') {
        if (isGoKey(event)) {
            event.preventDefault();
            letGo();
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
    letGo();
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
