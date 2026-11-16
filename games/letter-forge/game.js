(() => {
    const PUZZLES = window.LETTER_FORGE_PUZZLES;
    const ROUND_MS = 60000;
    const LAST_SECONDS_MS = 10000;
    const MAX_FRAME_MS = 250;
    const MIN_LENGTH = 3;
    const POINTS = { 3: 10, 4: 20, 5: 40, 6: 70, 7: 110 };
    const FULL_BONUS = 150;
    const RECENT_LIMIT = 60;
    const FLASH_MS = 600;
    // The end screen ignores input this long, so a tap or key meant for the round cannot skip it.
    const END_GUARD_MS = 700;
    const KEY_BEST = 'arcade.letter-forge.best';
    const KEY_RECENT = 'arcade.letter-forge.recent';

    const $ = (id) => document.getElementById(id);
    const app = $('app');
    const board = $('board');
    const timeEl = $('time');
    const timeFill = $('timefill');
    const scoreEl = $('score');
    const countEl = $('count');
    const entryEl = $('entry');
    const msgEl = $('msg');
    const tilesEl = $('tiles');
    const foundEl = $('found');
    const foundEmpty = $('found-empty');
    const pauseBtn = $('pause-btn');
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

    let state = 'ready';
    let tiles = [];
    let picked = [];
    let validWords = new Set();
    let found = [];
    let score = 0;
    let remaining = ROUND_MS;
    let lastFrame = 0;
    let endedAt = 0;
    let flash = null;
    let flashTimer = 0;
    let best = Number(load(KEY_BEST, 0)) || 0;

    const shuffled = (list) => {
        const copy = [...list];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    };

    const setState = (next) => {
        state = next;
        app.dataset.state = next;
        Object.entries(screens).forEach(([name, screen]) => { screen.hidden = name !== next; });
        board.inert = next !== 'playing';
        pauseBtn.hidden = next !== 'playing';
    };

    const setMessage = (text, tone) => {
        msgEl.textContent = text;
        msgEl.className = `msg ${tone}`;
    };

    const restartAnimation = (element, name) => {
        element.classList.remove(name);
        void element.offsetWidth;
        element.classList.add(name);
    };

    const renderEntry = () => {
        entryEl.className = 'entry';
        if (picked.length > 0) {
            entryEl.textContent = picked.map((tile) => tile.letter).join('');
        } else if (flash) {
            entryEl.textContent = flash.word;
            entryEl.classList.add(flash.tone);
        } else {
            entryEl.textContent = 'Type or tap letters';
            entryEl.classList.add('empty');
        }
        tiles.forEach((tile) => {
            const used = picked.includes(tile);
            tile.button.classList.toggle('used', used);
            tile.button.setAttribute('aria-pressed', String(used));
        });
    };

    const clearFlash = () => {
        clearTimeout(flashTimer);
        flash = null;
    };

    // Shows the submitted word in green or red for a moment after the entry is cleared.
    const showFlash = (word, tone) => {
        clearFlash();
        flash = { word, tone };
        flashTimer = setTimeout(() => {
            flash = null;
            renderEntry();
        }, FLASH_MS);
    };

    const renderClock = () => {
        timeEl.textContent = Math.ceil(remaining / 1000);
        timeFill.style.transform = `scaleX(${remaining / ROUND_MS})`;
        app.classList.toggle('last-seconds', remaining <= LAST_SECONDS_MS);
    };

    const reject = (reason) => {
        setMessage(reason, 'bad');
        restartAnimation(entryEl, 'shake');
    };

    const toggleTile = (tile) => {
        clearFlash();
        if (picked.includes(tile)) {
            picked = picked.filter((other) => other !== tile);
        } else {
            picked.push(tile);
        }
        setMessage('', '');
        renderEntry();
    };

    const typeLetter = (letter) => {
        const free = tiles.find((tile) => tile.letter === letter && !picked.includes(tile));
        if (free) {
            toggleTile(free);
            return;
        }
        const onRack = tiles.some((tile) => tile.letter === letter);
        const name = letter.toUpperCase();
        reject(onRack ? `No ${name} tile left to use` : `${name} is not one of your letters`);
    };

    const removeLast = () => {
        clearFlash();
        picked.pop();
        setMessage('', '');
        renderEntry();
    };

    const shuffleTiles = () => {
        tiles = shuffled(tiles);
        tiles.forEach((tile) => tilesEl.appendChild(tile.button));
    };

    const addFoundChip = (word, points) => {
        const chip = document.createElement('li');
        const gain = document.createElement('b');
        gain.textContent = `+${points}`;
        chip.append(word, ' ', gain);
        chip.classList.add('fresh');
        if (word.length === tiles.length) chip.classList.add('full');
        foundEl.prepend(chip);
        foundEl.scrollTop = 0;
        foundEmpty.hidden = true;
    };

    const submitWord = () => {
        const word = picked.map((tile) => tile.letter).join('');
        const shown = word.toUpperCase();
        if (word.length === 0) {
            reject('Pick some letters first');
            return;
        }
        if (word.length < MIN_LENGTH) {
            reject(`Too short: words need ${MIN_LENGTH} or more letters`);
            return;
        }

        picked = [];
        if (found.includes(word)) {
            showFlash(word, 'bad');
            renderEntry();
            reject(`Already found ${shown}`);
            return;
        }
        if (!validWords.has(word)) {
            showFlash(word, 'bad');
            renderEntry();
            reject(`${shown} is not in the word list`);
            return;
        }

        const usesAll = word.length === tiles.length;
        const points = POINTS[word.length] + (usesAll ? FULL_BONUS : 0);
        found.push(word);
        score += points;
        scoreEl.textContent = score;
        countEl.textContent = found.length;
        addFoundChip(word, points);
        showFlash(word, 'good');
        renderEntry();
        setMessage(usesAll ? `All seven tiles! ${shown} +${points}` : `${shown} +${points}`, 'good');
        restartAnimation(entryEl, 'pop');
    };

    const endRound = () => {
        const isBest = score > best;
        if (isBest) {
            best = score;
            save(KEY_BEST, best);
        }
        const longest = found.reduce((longestSoFar, word) => (word.length > longestSoFar.length ? word : longestSoFar), '');
        $('end-score').textContent = score;
        $('end-count').textContent = found.length;
        $('end-longest').textContent = longest || 'None';
        $('end-best').textContent = best;
        $('new-best').hidden = !isBest;
        endedAt = performance.now();
        setState('over');
        $('again-btn').focus();
    };

    const endScreenIsFresh = () => performance.now() - endedAt < END_GUARD_MS;

    const frame = (now) => {
        if (state !== 'playing') return;
        remaining = Math.max(0, remaining - Math.min(now - lastFrame, MAX_FRAME_MS));
        lastFrame = now;
        renderClock();
        if (remaining === 0) {
            endRound();
            return;
        }
        requestAnimationFrame(frame);
    };

    const runClock = () => {
        lastFrame = performance.now();
        requestAnimationFrame(frame);
    };

    // After a mouse or touch press, hand focus back to the page so Space and Enter keep their game meaning.
    const releaseFocus = (event) => {
        if (event.detail > 0) event.currentTarget.blur();
    };

    const pickPuzzle = () => {
        const saved = load(KEY_RECENT, []);
        const recent = Array.isArray(saved) ? saved : [];
        const fresh = PUZZLES.filter((puzzle) => !recent.includes(puzzle.letters));
        const pool = fresh.length > 0 ? fresh : PUZZLES;
        const puzzle = pool[Math.floor(Math.random() * pool.length)];
        save(KEY_RECENT, [...recent, puzzle.letters].slice(-RECENT_LIMIT));
        return puzzle;
    };

    const startRound = () => {
        const puzzle = pickPuzzle();
        validWords = new Set(puzzle.words.split(' '));

        // Never deal the tiles in an order that spells the seven-letter word.
        let order = shuffled([...puzzle.letters]);
        while (order.join('') === puzzle.letters) order = shuffled(order);

        tilesEl.textContent = '';
        tiles = order.map((letter) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tile';
            button.textContent = letter;
            const tile = { letter, button };
            button.addEventListener('click', (event) => {
                toggleTile(tile);
                releaseFocus(event);
            });
            tilesEl.appendChild(button);
            return tile;
        });

        clearFlash();
        picked = [];
        found = [];
        score = 0;
        remaining = ROUND_MS;
        scoreEl.textContent = '0';
        countEl.textContent = '0';
        foundEl.textContent = '';
        foundEmpty.hidden = false;
        setMessage('', '');
        renderEntry();
        renderClock();
        setState('playing');
        runClock();
    };

    const pause = () => {
        if (state !== 'playing') return;
        setState('paused');
        $('resume-btn').focus();
    };

    const resume = () => {
        if (state !== 'paused') return;
        setState('playing');
        runClock();
    };

    const onPress = (id, action) => {
        $(id).addEventListener('click', (event) => {
            action();
            releaseFocus(event);
        });
    };

    onPress('shuffle', shuffleTiles);
    onPress('delete', removeLast);
    onPress('submit', submitWord);
    pauseBtn.addEventListener('click', pause);
    $('start-btn').addEventListener('click', startRound);
    $('again-btn').addEventListener('click', () => {
        if (!endScreenIsFresh()) startRound();
    });
    $('resume-btn').addEventListener('click', resume);

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const confirm = event.key === 'Enter' || event.key === ' ';
        // A focused button or link handles Enter and Space itself.
        if (confirm && (event.repeat || event.target.closest('button, a'))) return;

        if (state === 'playing') {
            if (event.key === 'Escape') {
                pause();
            } else if (event.key === 'Backspace') {
                event.preventDefault();
                removeLast();
            } else if (event.key === 'Enter') {
                submitWord();
            } else if (event.key === ' ') {
                event.preventDefault();
                shuffleTiles();
            } else if (/^[a-z]$/i.test(event.key)) {
                typeLetter(event.key.toLowerCase());
            }
            return;
        }

        if (state === 'paused' && (confirm || event.key === 'Escape')) {
            event.preventDefault();
            resume();
        } else if (state === 'ready' && confirm) {
            event.preventDefault();
            startRound();
        } else if (state === 'over' && confirm && !endScreenIsFresh()) {
            event.preventDefault();
            startRound();
        }
    });

    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) pause();
    });

    $('start-best').textContent = best;
    setState('ready');
})();
