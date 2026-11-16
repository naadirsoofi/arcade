(() => {
    // One tone per pad: G3, B3, D4, G4, B4. Any order of these sounds pleasant.
    const PADS = [
        { name: 'triangle', tone: 196.0 },
        { name: 'circle', tone: 246.94 },
        { name: 'square', tone: 293.66 },
        { name: 'plus', tone: 392.0 },
        { name: 'zigzag', tone: 493.88 }
    ];
    const MODE_NAMES = { classic: 'Classic', reverse: 'Reverse' };
    const STEP_START_MS = 640;
    const STEP_MIN_MS = 280;
    const STEP_SPEEDUP = 0.95;
    // Share of each step the pad stays lit, the rest is the gap before the next one.
    const LIT_SHARE = 0.62;
    const LEAD_MS = 700;
    const WON_MS = 750;
    const LOST_MS = 1300;
    const PRESS_FLASH_MS = 220;
    const MAX_FRAME_MS = 100;
    // The end screen ignores input this long, so a tap or key meant for the run cannot skip it.
    const END_GUARD_MS = 700;
    const KEY_BEST = { classic: 'arcade.signal-chain.best.classic', reverse: 'arcade.signal-chain.best.reverse' };
    const KEY_MODE = 'arcade.signal-chain.mode';
    const KEY_MUTED = 'arcade.signal-chain.muted';

    const $ = (id) => document.getElementById(id);
    const app = $('app');
    const board = $('board');
    const statusEl = $('status');
    const progressEl = $('progress');
    const muteBtn = $('mute-btn');
    const pauseBtn = $('pause-btn');
    const padEls = [...document.querySelectorAll('.pad')];
    const modeButtons = [...document.querySelectorAll('.mode')];
    const screens = { ready: $('start-screen'), paused: $('pause-screen'), over: $('end-screen') };

    const load = (key, fallback) => {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch {
            return fallback;
        }
    };

    const save = (key, value) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch {
            // Storage is blocked: the game still works, it just forgets.
        }
    };

    const savedRound = (key) => {
        const value = load(key, 0);
        return Number.isInteger(value) && value > 0 ? value : 0;
    };

    let state = 'ready';
    let mode = load(KEY_MODE, 'classic') === 'reverse' ? 'reverse' : 'classic';
    let muted = load(KEY_MUTED, false) === true;
    let best = { classic: savedRound(KEY_BEST.classic), reverse: savedRound(KEY_BEST.reverse) };
    let phase = 'idle';
    let phaseTime = 0;
    let lastFrame = 0;
    let chain = [];
    let entered = 0;
    let stepMs = STEP_START_MS;
    let shownStep = -1;
    let endedAt = 0;
    let audio = null;
    const flashTimers = padEls.map(() => 0);

    // Sound: created on the first user gesture, and never needed to play the game.
    const wakeAudio = () => {
        if (muted) return;
        try {
            audio ??= new AudioContext();
            if (audio.state === 'suspended') audio.resume();
        } catch {
            audio = null;
        }
    };

    const playTone = (frequency, durationMs, wave = 'triangle') => {
        if (muted || !audio || audio.state !== 'running') return;
        const start = audio.currentTime;
        const end = start + durationMs / 1000;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = wave;
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.2, start + 0.015);
        gain.gain.setValueAtTime(0.2, Math.max(start + 0.015, end - 0.06));
        gain.gain.linearRampToValueAtTime(0, end);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(end);
    };

    const setState = (next) => {
        state = next;
        app.dataset.state = next;
        Object.entries(screens).forEach(([name, screen]) => { screen.hidden = name !== next; });
        board.inert = next !== 'playing';
        pauseBtn.hidden = next !== 'playing';
    };

    const setPhase = (next, status) => {
        phase = next;
        phaseTime = 0;
        app.dataset.phase = next;
        if (status) statusEl.textContent = status;
    };

    const setMode = (next) => {
        mode = next;
        app.dataset.mode = next;
        save(KEY_MODE, next);
        modeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === next)));
    };

    const setMuted = (next) => {
        muted = next;
        save(KEY_MUTED, next);
        muteBtn.setAttribute('aria-pressed', String(next));
        muteBtn.setAttribute('aria-label', next ? 'Unmute sound' : 'Mute sound');
    };

    const bestText = (value) => (value > 0 ? `round ${value}` : 'no runs yet');

    const renderBests = () => {
        $('best-classic').textContent = bestText(best.classic);
        $('best-reverse').textContent = bestText(best.reverse);
    };

    const renderProgress = () => {
        progressEl.textContent = '';
        chain.forEach((_, index) => {
            const dot = document.createElement('i');
            if (index < entered) dot.className = 'done';
            progressEl.appendChild(dot);
        });
    };

    const clearPads = () => {
        flashTimers.forEach((timer) => clearTimeout(timer));
        padEls.forEach((pad) => pad.classList.remove('lit', 'wrong'));
    };

    const lightOnly = (index) => {
        padEls.forEach((pad, padIndex) => pad.classList.toggle('lit', padIndex === index));
    };

    // Never the same pad three times running, which reads as a stuck light.
    const nextLink = () => {
        const last = chain.length - 1;
        let pick = Math.floor(Math.random() * PADS.length);
        while (last >= 1 && pick === chain[last] && pick === chain[last - 1]) {
            pick = Math.floor(Math.random() * PADS.length);
        }
        return pick;
    };

    const beginRound = () => {
        chain.push(nextLink());
        entered = 0;
        stepMs = Math.max(STEP_MIN_MS, STEP_START_MS * STEP_SPEEDUP ** (chain.length - 1));
        shownStep = -1;
        $('round').textContent = chain.length;
        renderProgress();
        setPhase('lead', 'Watch the chain');
    };

    const endRun = () => {
        const round = chain.length;
        const isBest = round > best[mode];
        if (isBest) {
            best[mode] = round;
            save(KEY_BEST[mode], round);
        }
        clearPads();
        $('end-round').textContent = round;
        $('end-chain').textContent = round === 2 ? '1 link' : `${round - 1} links`;
        $('end-mode').textContent = MODE_NAMES[mode];
        $('end-best-label').textContent = `Best in ${MODE_NAMES[mode]}`;
        $('end-best').textContent = `Round ${best[mode]}`;
        // A first run that breaks on round 1 is not much of a record to celebrate.
        $('new-best').hidden = !(isBest && round > 1);
        renderBests();
        setPhase('idle');
        endedAt = performance.now();
        setState('over');
        $('again-btn').focus();
    };

    const endScreenIsFresh = () => performance.now() - endedAt < END_GUARD_MS;

    const showChain = () => {
        const step = Math.floor(phaseTime / stepMs);
        if (step >= chain.length) {
            lightOnly(-1);
            setPhase('input', mode === 'reverse' ? 'Your turn: repeat it backwards' : 'Your turn: repeat it');
            return;
        }
        const litNow = phaseTime - step * stepMs < stepMs * LIT_SHARE;
        const wanted = litNow ? step : -1;
        if (wanted === shownStep) return;
        shownStep = wanted;
        lightOnly(litNow ? chain[step] : -1);
        if (litNow) playTone(PADS[chain[step]].tone, stepMs * LIT_SHARE);
    };

    const frame = (now) => {
        if (state !== 'playing') return;
        phaseTime += Math.min(now - lastFrame, MAX_FRAME_MS);
        lastFrame = now;

        if (phase === 'lead' && phaseTime >= LEAD_MS) {
            setPhase('show');
        } else if (phase === 'show') {
            showChain();
        } else if (phase === 'won' && phaseTime >= WON_MS) {
            beginRound();
        } else if (phase === 'lost' && phaseTime >= LOST_MS) {
            endRun();
            return;
        }
        requestAnimationFrame(frame);
    };

    const runLoop = () => {
        lastFrame = performance.now();
        requestAnimationFrame(frame);
    };

    const press = (index) => {
        if (state !== 'playing' || phase !== 'input') return;
        const expected = mode === 'reverse' ? chain[chain.length - 1 - entered] : chain[entered];

        if (index !== expected) {
            clearPads();
            padEls[index].classList.add('wrong');
            padEls[expected].classList.add('lit');
            playTone(110, 450, 'sawtooth');
            setPhase('lost', `Wrong pad. It was the ${PADS[expected].name}.`);
            return;
        }

        entered++;
        const pad = padEls[index];
        pad.classList.add('lit');
        clearTimeout(flashTimers[index]);
        flashTimers[index] = setTimeout(() => pad.classList.remove('lit'), PRESS_FLASH_MS);
        playTone(PADS[index].tone, PRESS_FLASH_MS);
        renderProgress();
        if (entered === chain.length) setPhase('won', 'Chain complete');
    };

    const startRun = () => {
        wakeAudio();
        clearPads();
        chain = [];
        $('mode-name').textContent = MODE_NAMES[mode];
        $('best').textContent = best[mode] > 0 ? `Round ${best[mode]}` : 'None';
        setState('playing');
        beginRound();
        runLoop();
    };

    const pause = () => {
        if (state !== 'playing') return;
        setState('paused');
        $('resume-btn').focus();
    };

    // A chain that was interrupted while playing is shown again from its first link.
    const resume = () => {
        if (state !== 'paused') return;
        if (phase === 'lead' || phase === 'show') {
            lightOnly(-1);
            shownStep = -1;
            setPhase('lead');
        }
        setState('playing');
        runLoop();
    };

    const showStart = () => {
        setState('ready');
        $('start-btn').focus();
    };

    padEls.forEach((pad, index) => {
        pad.addEventListener('pointerdown', (event) => {
            if (event.button === 0) press(index);
        });
        // Keyboard activation of a focused pad (Enter or Space) arrives as a click with no pointer.
        pad.addEventListener('click', (event) => {
            if (event.detail === 0) press(index);
        });
    });
    $('pads').addEventListener('contextmenu', (event) => event.preventDefault());

    modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
    muteBtn.addEventListener('click', () => {
        setMuted(!muted);
        wakeAudio();
    });
    pauseBtn.addEventListener('click', pause);
    $('start-btn').addEventListener('click', startRun);
    $('again-btn').addEventListener('click', () => {
        if (!endScreenIsFresh()) startRun();
    });
    $('resume-btn').addEventListener('click', resume);
    $('mode-btn').addEventListener('click', () => {
        if (!endScreenIsFresh()) showStart();
    });

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const key = event.key.toLowerCase();
        const pauseKey = key === 'escape' || key === 'p';

        if (key === 'm' && !event.repeat) {
            setMuted(!muted);
            wakeAudio();
            return;
        }

        if (state === 'playing') {
            if (pauseKey) {
                pause();
            } else if (!event.repeat && /^[1-5]$/.test(key)) {
                press(Number(key) - 1);
            }
            return;
        }

        const confirm = key === 'enter' || key === ' ';
        // A focused button or link handles Enter and Space itself.
        if (confirm && (event.repeat || event.target.closest('button, a'))) return;

        if (state === 'paused' && (confirm || pauseKey)) {
            event.preventDefault();
            resume();
        } else if (state === 'ready' && confirm) {
            event.preventDefault();
            startRun();
        } else if (state === 'ready' && (key === 'arrowleft' || key === 'arrowright')) {
            setMode(mode === 'classic' ? 'reverse' : 'classic');
        } else if (state === 'over' && confirm && !endScreenIsFresh()) {
            event.preventDefault();
            startRun();
        }
    });

    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) pause();
    });

    setMode(mode);
    setMuted(muted);
    renderBests();
    setState('ready');
})();
