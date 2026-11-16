(() => {
    const KEY_ROWS = ['1234', 'QWER', 'ASDF', 'ZXCV'];
    const SPRINT_MS = 30000;
    const MISS_PENALTY_MS = 1000;
    const REACTION_TARGETS = 10;
    const DELAY_MIN_MS = 900;
    const DELAY_MAX_MS = 2600;
    // Nobody reacts this fast: a hit sooner than this was a guess, so it counts as a false start.
    const ANTICIPATION_MS = 100;
    const COUNTDOWN_STEP_MS = 550;
    const COUNTDOWN_STEPS = 3;
    const MAX_FRAME_MS = 100;
    const FLASH_MS = 180;
    const FLOAT_MS = 700;
    // The end screen ignores input this long, so a tap or key meant for the round cannot skip it.
    const END_GUARD_MS = 700;
    const KEY_BEST_SPRINT = 'arcade.reflex-grid.bestSprint';
    const KEY_BEST_AVERAGE = 'arcade.reflex-grid.bestAverage';
    const KEY_HITS = 'arcade.reflex-grid.hits';
    const KEY_MODE = 'arcade.reflex-grid.mode';

    const $ = (id) => document.getElementById(id);
    const app = $('app');
    const board = $('board');
    const grid = $('grid');
    const countdownEl = $('countdown');
    const statusEl = $('status');
    const firstLabel = $('first-label');
    const firstValue = $('first-value');
    const secondLabel = $('second-label');
    const secondValue = $('second-value');
    const lastValue = $('last-value');
    const pauseBtn = $('pause-btn');
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

    const savedNumber = (key) => {
        const value = load(key, null);
        return Number.isFinite(value) ? value : null;
    };

    let state = 'ready';
    let mode = load(KEY_MODE, 'sprint') === 'reaction' ? 'reaction' : 'sprint';
    let phase = 'countdown';
    let litIndex = -1;
    let litAt = 0;
    let lastFrame = 0;
    let countdownLeft = 0;
    let timeLeft = SPRINT_MS;
    let delayLeft = 0;
    let endedAt = 0;
    let times = [];
    let misses = 0;
    let falseStarts = 0;
    let bestSprint = savedNumber(KEY_BEST_SPRINT);
    let bestAverage = savedNumber(KEY_BEST_AVERAGE);
    let lifetimeHits = savedNumber(KEY_HITS) ?? 0;

    // Pads are laid out like the keyboard rows, and each one maps to a physical key code.
    const padByCode = new Map();
    const pads = KEY_ROWS.flatMap((row, rowIndex) => [...row].map((label, colIndex) => {
        const pad = document.createElement('button');
        pad.type = 'button';
        pad.className = 'pad';
        pad.setAttribute('aria-label', `Row ${rowIndex + 1}, column ${colIndex + 1}, key ${label}`);
        const hint = document.createElement('span');
        hint.className = 'key';
        hint.textContent = label;
        pad.appendChild(hint);
        grid.appendChild(pad);
        padByCode.set(/\d/.test(label) ? `Digit${label}` : `Key${label}`, rowIndex * 4 + colIndex);
        return pad;
    }));

    const average = (list) => Math.round(list.reduce((sum, value) => sum + value, 0) / list.length);
    const ms = (value) => `${value} ms`;

    const setState = (next) => {
        state = next;
        app.dataset.state = next;
        Object.entries(screens).forEach(([name, screen]) => { screen.hidden = name !== next; });
        board.inert = next !== 'playing';
        pauseBtn.hidden = next !== 'playing';
    };

    const setStatus = (text, tone = '') => {
        statusEl.textContent = text;
        statusEl.className = `status ${tone}`;
    };

    const setMode = (next) => {
        mode = next;
        app.dataset.mode = next;
        save(KEY_MODE, next);
        modeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === next)));
    };

    const renderRecords = () => {
        $('best-sprint').textContent = bestSprint === null ? 'None yet' : `${bestSprint} hits`;
        $('best-average').textContent = bestAverage === null ? 'None yet' : ms(bestAverage);
        $('lifetime').textContent = lifetimeHits.toLocaleString('en-US');
    };

    const renderHud = () => {
        if (mode === 'sprint') {
            firstValue.textContent = (timeLeft / 1000).toFixed(1);
            secondValue.textContent = times.length;
        } else {
            firstValue.textContent = `${Math.min(times.length + 1, REACTION_TARGETS)}/${REACTION_TARGETS}`;
            secondValue.textContent = times.length > 0 ? ms(average(times)) : ms(0);
        }
    };

    const clearPad = () => {
        if (litIndex >= 0) pads[litIndex].classList.remove('lit');
        litIndex = -1;
    };

    const lightPad = (avoid = -1) => {
        let next = Math.floor(Math.random() * pads.length);
        while (next === avoid) next = Math.floor(Math.random() * pads.length);
        litIndex = next;
        pads[next].classList.remove('hit', 'miss');
        pads[next].classList.add('lit');
        litAt = performance.now();
        phase = 'lit';
    };

    // Reaction mode: the next pad lights only after a random wait.
    const armTarget = () => {
        delayLeft = DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS);
        phase = 'waiting';
    };

    const beginCountdown = () => {
        phase = 'countdown';
        countdownLeft = COUNTDOWN_STEP_MS * COUNTDOWN_STEPS;
        countdownEl.textContent = COUNTDOWN_STEPS;
        countdownEl.hidden = false;
        setStatus('Get ready');
    };

    const feedback = (pad, label, tone) => {
        pad.classList.remove('hit', 'miss');
        pad.classList.add(tone);
        setTimeout(() => pad.classList.remove(tone), FLASH_MS);
        const bubble = document.createElement('span');
        bubble.className = `float ${tone}`;
        bubble.textContent = label;
        pad.appendChild(bubble);
        setTimeout(() => bubble.remove(), FLOAT_MS);
    };

    const recordHit = (pad, reaction) => {
        times.push(reaction);
        lifetimeHits++;
        lastValue.textContent = ms(reaction);
        feedback(pad, ms(reaction), 'hit');
        setStatus(ms(reaction), 'good');
        renderHud();
    };

    const endRound = () => {
        clearPad();
        save(KEY_HITS, lifetimeHits);
        const rows = [];
        let isBest;
        if (mode === 'sprint') {
            isBest = times.length > 0 && (bestSprint === null || times.length > bestSprint);
            if (isBest) {
                bestSprint = times.length;
                save(KEY_BEST_SPRINT, bestSprint);
            }
            $('end-title').textContent = 'Sprint over';
            $('end-value').textContent = times.length;
            $('end-unit').textContent = times.length === 1 ? 'hit' : 'hits';
            rows.push(['Average reaction', times.length > 0 ? ms(average(times)) : 'No hits']);
            rows.push(['Fastest hit', times.length > 0 ? ms(Math.min(...times)) : 'No hits']);
            rows.push(['Wrong pads', misses]);
            rows.push(['Best Sprint', bestSprint === null ? 'None yet' : `${bestSprint} hits`]);
        } else {
            const result = average(times);
            isBest = bestAverage === null || result < bestAverage;
            if (isBest) {
                bestAverage = result;
                save(KEY_BEST_AVERAGE, bestAverage);
            }
            $('end-title').textContent = 'Average reaction';
            $('end-value').textContent = result;
            $('end-unit').textContent = 'ms';
            rows.push(['Fastest hit', ms(Math.min(...times))]);
            rows.push(['False starts', falseStarts]);
            rows.push(['Best average', ms(bestAverage)]);
        }
        rows.push(['Lifetime hits', lifetimeHits.toLocaleString('en-US')]);

        const list = $('end-rows');
        list.textContent = '';
        rows.forEach(([label, value]) => {
            const row = document.createElement('div');
            const term = document.createElement('dt');
            const detail = document.createElement('dd');
            term.textContent = label;
            detail.textContent = value;
            row.append(term, detail);
            list.appendChild(row);
        });
        $('new-best').hidden = !isBest;
        renderRecords();
        endedAt = performance.now();
        setState('over');
        $('again-btn').focus();
    };

    const press = (index) => {
        if (state !== 'playing' || phase === 'countdown') return;
        const pad = pads[index];
        const reaction = Math.round(performance.now() - litAt);

        if (mode === 'sprint') {
            if (index === litIndex) {
                clearPad();
                recordHit(pad, reaction);
                lightPad(index);
            } else {
                misses++;
                timeLeft = Math.max(0, timeLeft - MISS_PENALTY_MS);
                feedback(pad, '-1 s', 'miss');
                setStatus('Wrong pad: 1 second lost', 'bad');
            }
            return;
        }

        if (phase === 'waiting' || (index === litIndex && reaction < ANTICIPATION_MS)) {
            falseStarts++;
            clearPad();
            feedback(pad, 'Too soon', 'miss');
            setStatus('False start. Wait for the light.', 'bad');
            armTarget();
        } else if (index !== litIndex) {
            feedback(pad, 'Wrong', 'miss');
            setStatus('Wrong pad. The clock is still running.', 'bad');
        } else {
            clearPad();
            recordHit(pad, reaction);
            if (times.length === REACTION_TARGETS) {
                endRound();
            } else {
                armTarget();
            }
        }
    };

    const endScreenIsFresh = () => performance.now() - endedAt < END_GUARD_MS;

    const frame = (now) => {
        if (state !== 'playing') return;
        const delta = Math.min(now - lastFrame, MAX_FRAME_MS);
        lastFrame = now;

        if (phase === 'countdown') {
            countdownLeft -= delta;
            if (countdownLeft > 0) {
                countdownEl.textContent = Math.ceil(countdownLeft / COUNTDOWN_STEP_MS);
            } else {
                countdownEl.hidden = true;
                if (mode === 'sprint') {
                    setStatus('Hit the lit pad');
                    lightPad();
                } else {
                    setStatus('Wait for the light');
                    armTarget();
                }
            }
        } else if (mode === 'sprint') {
            timeLeft = Math.max(0, timeLeft - delta);
            renderHud();
            if (timeLeft === 0) {
                endRound();
                return;
            }
        } else if (phase === 'waiting') {
            delayLeft -= delta;
            if (delayLeft <= 0) lightPad();
        }
        requestAnimationFrame(frame);
    };

    const runLoop = () => {
        lastFrame = performance.now();
        requestAnimationFrame(frame);
    };

    const startRound = () => {
        clearPad();
        times = [];
        misses = 0;
        falseStarts = 0;
        timeLeft = SPRINT_MS;
        firstLabel.textContent = mode === 'sprint' ? 'Time' : 'Target';
        secondLabel.textContent = mode === 'sprint' ? 'Hits' : 'Average';
        lastValue.textContent = ms(0);
        renderHud();
        setState('playing');
        beginCountdown();
        runLoop();
    };

    // Pausing hides the lit pad, so a pause can never be used to line up the next hit.
    const pause = () => {
        if (state !== 'playing') return;
        clearPad();
        countdownEl.hidden = true;
        setState('paused');
        $('resume-btn').focus();
    };

    const resume = () => {
        if (state !== 'paused') return;
        setState('playing');
        beginCountdown();
        runLoop();
    };

    const showStart = () => {
        setState('ready');
        $('start-btn').focus();
    };

    pads.forEach((pad, index) => {
        pad.addEventListener('pointerdown', (event) => {
            if (event.button === 0) press(index);
        });
        // Keyboard activation of a focused pad (Enter or Space) arrives as a click with no pointer.
        pad.addEventListener('click', (event) => {
            if (event.detail === 0) press(index);
        });
    });
    grid.addEventListener('contextmenu', (event) => event.preventDefault());

    modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
    pauseBtn.addEventListener('click', pause);
    $('start-btn').addEventListener('click', startRound);
    $('again-btn').addEventListener('click', () => {
        if (!endScreenIsFresh()) startRound();
    });
    $('resume-btn').addEventListener('click', resume);
    $('mode-btn').addEventListener('click', () => {
        if (!endScreenIsFresh()) showStart();
    });

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const pauseKey = event.key === 'Escape' || event.key.toLowerCase() === 'p';

        if (state === 'playing') {
            if (pauseKey) {
                pause();
            } else if (!event.repeat && padByCode.has(event.code)) {
                event.preventDefault();
                press(padByCode.get(event.code));
            }
            return;
        }

        const confirm = event.key === 'Enter' || event.key === ' ';
        // A focused button or link handles Enter and Space itself.
        if (confirm && (event.repeat || event.target.closest('button, a'))) return;

        if (state === 'paused' && (confirm || pauseKey)) {
            event.preventDefault();
            resume();
        } else if (state === 'ready' && confirm) {
            event.preventDefault();
            startRound();
        } else if (state === 'ready' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            setMode(mode === 'sprint' ? 'reaction' : 'sprint');
        } else if (state === 'over' && confirm && !endScreenIsFresh()) {
            event.preventDefault();
            startRound();
        }
    });

    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) pause();
    });
    // Hits from a round that was left unfinished still count toward the lifetime total.
    window.addEventListener('pagehide', () => save(KEY_HITS, lifetimeHits));

    setMode(mode);
    renderRecords();
    setState('ready');
})();
