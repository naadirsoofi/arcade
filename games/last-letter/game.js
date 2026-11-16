(() => {
    const CATEGORIES = window.LAST_LETTER_CATEGORIES;
    const CHANCES = 7;
    const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
    const RECENT_LIMIT = 120;
    // The board stays in view this long after the last guess, so the final letter or lantern is seen.
    const END_DELAY_MS = 900;
    // The end screen ignores input this long, so a key meant for the round cannot skip it.
    const END_GUARD_MS = 700;
    const KEY_STATS = 'arcade.last-letter.stats';
    const KEY_CATEGORY = 'arcade.last-letter.category';
    const KEY_RECENT = 'arcade.last-letter.recent';
    const LANTERN = '<svg class="lantern" viewBox="0 0 36 58" aria-hidden="true"><path d="M18 1v7"/><path d="M12 9h12v4H12z"/><rect class="glass" x="6" y="13" width="24" height="32" rx="10"/><path class="flame" d="M18 22c3 4 4.5 6.5 4.5 9a4.5 4.5 0 0 1-9 0c0-2.5 1.5-5 4.5-9z"/><path d="M13 45h10v4H13z"/><path d="M18 49v7"/></svg>';

    const $ = (id) => document.getElementById(id);
    const app = $('app');
    const play = $('play');
    const wordEl = $('word');
    const msgEl = $('msg');
    const keysEl = $('keys');
    const hintBtn = $('hint-btn');
    const lanternsEl = $('lanterns');
    const categorySelect = $('category-select');
    const screens = { ready: $('start-screen'), over: $('end-screen') };

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

    const savedStats = load(KEY_STATS, {}) ?? {};
    const count = (value) => (Number.isInteger(value) && value > 0 ? value : 0);
    const stats = {
        streak: count(savedStats.streak),
        best: count(savedStats.best),
        played: count(savedStats.played),
        won: count(savedStats.won)
    };
    const savedCategory = load(KEY_CATEGORY, 'random');
    let categoryId = CATEGORIES.some((category) => category.id === savedCategory) ? savedCategory : 'random';

    let state = 'ready';
    let answer = '';
    let guessed = new Set();
    let lit = CHANCES;
    let tiles = [];
    let endTimer = 0;
    let endShownAt = 0;
    const keys = new Map();

    const setState = (next) => {
        state = next;
        app.dataset.state = next;
        screens.ready.hidden = next !== 'ready';
        screens.over.hidden = true;
        play.inert = next !== 'playing';
    };

    const setMessage = (text, tone) => {
        msgEl.textContent = text;
        msgEl.className = `msg ${tone}`;
    };

    const restartAnimation = (element, name) => {
        element.classList.remove(name);
        void element.getBoundingClientRect();
        element.classList.add(name);
    };

    const fillLanterns = (holder, litCount) => {
        holder.innerHTML = LANTERN.repeat(CHANCES);
        [...holder.children].forEach((lantern, index) => lantern.classList.toggle('out', index >= litCount));
    };

    const renderLanterns = () => {
        [...lanternsEl.children].forEach((lantern, index) => lantern.classList.toggle('out', index >= lit));
        lanternsEl.setAttribute('aria-label', `${lit} of ${CHANCES} lanterns lit`);
        app.dataset.lit = lit;
        $('chances').textContent = ['All the lanterns are out', 'Last lantern: 1 chance left'][lit] ?? `${lit} chances left`;
        hintBtn.disabled = lit < 2;
    };

    const renderRecord = () => {
        $('start-record').textContent = stats.played === 0
            ? 'No words played yet.'
            : `Streak ${stats.streak}, best ${stats.best}, won ${stats.won} of ${stats.played}.`;
    };

    const lettersLeft = () => [...new Set(answer.replace(/[^A-Z]/g, ''))].filter((letter) => !guessed.has(letter));

    const reveal = (letter) => {
        tiles.filter((tile) => tile.letter === letter).forEach((tile) => {
            tile.element.textContent = letter;
            tile.element.classList.add('shown');
            restartAnimation(tile.element, 'fresh');
        });
        keys.get(letter).classList.add('right');
    };

    const loseLantern = () => {
        lit -= 1;
        renderLanterns();
        restartAnimation(lanternsEl.children[lit], 'puff');
    };

    const showEnd = (won) => {
        fillLanterns($('end-lanterns'), lit);
        $('end-title').textContent = won ? 'You got it!' : 'Lights out';
        $('end-note').textContent = won
            ? `Solved with ${lit} of ${CHANCES} lanterns still lit. The word was`
            : 'The last lantern went dark. The word was';
        $('end-word').textContent = answer;
        $('end-streak').textContent = stats.streak;
        $('end-best').textContent = stats.best;
        $('end-total').textContent = `${stats.won} of ${stats.played}`;
        screens.over.hidden = false;
        endShownAt = performance.now();
        $('again-btn').focus();
    };

    const endRound = (won) => {
        stats.played += 1;
        if (won) {
            stats.won += 1;
            stats.streak += 1;
            stats.best = Math.max(stats.best, stats.streak);
            setMessage('You found the word!', 'good');
        } else {
            stats.streak = 0;
            tiles.filter((tile) => !guessed.has(tile.letter)).forEach((tile) => {
                tile.element.textContent = tile.letter;
                tile.element.classList.add('missed');
            });
            setMessage('Out of lanterns', 'bad');
        }
        save(KEY_STATS, stats);
        app.classList.toggle('won', won);
        app.classList.toggle('lost', !won);
        setState('over');
        endTimer = setTimeout(() => showEnd(won), END_DELAY_MS);
    };

    const guess = (letter) => {
        // The letter keys can still be reached with Tab while a card covers them.
        if (state !== 'playing') return;
        if (guessed.has(letter)) {
            setMessage(`You already tried ${letter}`, '');
            return;
        }
        guessed.add(letter);
        keys.get(letter).disabled = true;
        if (answer.includes(letter)) {
            reveal(letter);
            const times = tiles.filter((tile) => tile.letter === letter).length;
            setMessage(times === 1 ? `Yes, one ${letter}` : `Yes, ${times} of ${letter}`, 'good');
            if (lettersLeft().length === 0) endRound(true);
        } else {
            keys.get(letter).classList.add('wrong');
            loseLantern();
            setMessage(`No ${letter} in this one`, 'bad');
            if (lit === 0) endRound(false);
        }
    };

    // Shows one missing letter at the price of a lantern. Never spends the last lantern.
    const useHint = () => {
        if (state !== 'playing' || lit < 2) return;
        const left = lettersLeft();
        const letter = left[Math.floor(Math.random() * left.length)];
        guessed.add(letter);
        keys.get(letter).disabled = true;
        loseLantern();
        reveal(letter);
        setMessage(`Hint: the word has ${letter}`, '');
        if (lettersLeft().length === 0) endRound(true);
    };

    const pickEntry = () => {
        const category = categoryId === 'random'
            ? CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)]
            : CATEGORIES.find((entry) => entry.id === categoryId);
        const saved = load(KEY_RECENT, []);
        const recent = Array.isArray(saved) ? saved : [];
        const fresh = category.words.filter((word) => !recent.includes(word));
        const pool = fresh.length > 0 ? fresh : category.words;
        const word = pool[Math.floor(Math.random() * pool.length)];
        save(KEY_RECENT, [...recent, word].slice(-RECENT_LIMIT));
        return { category, word };
    };

    const startRound = () => {
        clearTimeout(endTimer);
        const { category, word } = pickEntry();
        answer = word.toUpperCase();
        guessed = new Set();
        lit = CHANCES;

        // One unbreakable group per word, so a long phrase only ever wraps at its spaces.
        wordEl.textContent = '';
        tiles = [];
        answer.split(' ').forEach((part) => {
            const token = document.createElement('span');
            token.className = 'token';
            [...part].forEach((character) => {
                const element = document.createElement('span');
                if (/[A-Z]/.test(character)) {
                    element.className = 'tile';
                    tiles.push({ letter: character, element });
                } else {
                    element.className = 'punct';
                    element.textContent = character;
                }
                token.appendChild(element);
            });
            wordEl.appendChild(token);
        });

        keys.forEach((key) => {
            key.disabled = false;
            key.classList.remove('right', 'wrong');
        });
        $('category-name').textContent = category.name;
        $('streak').textContent = stats.streak;
        app.classList.remove('won', 'lost');
        setMessage('', '');
        renderLanterns();
        setState('playing');
    };

    const endScreenReady = () => !screens.over.hidden && performance.now() - endShownAt >= END_GUARD_MS;

    KEY_ROWS.forEach((letters) => {
        const row = document.createElement('div');
        row.className = 'key-row';
        [...letters].forEach((letter) => {
            const key = document.createElement('button');
            key.type = 'button';
            key.className = 'key';
            key.textContent = letter;
            key.addEventListener('click', () => guess(letter));
            keys.set(letter, key);
            row.appendChild(key);
        });
        keysEl.appendChild(row);
    });

    categorySelect.append(new Option('Random category', 'random'), ...CATEGORIES.map((category) => new Option(category.name, category.id)));
    categorySelect.value = categoryId;
    categorySelect.addEventListener('change', () => {
        categoryId = categorySelect.value;
        save(KEY_CATEGORY, categoryId);
    });

    hintBtn.addEventListener('click', (event) => {
        useHint();
        // After a mouse or touch press, drop focus so the keys keep their game meaning.
        if (event.detail > 0) hintBtn.blur();
    });
    $('start-btn').addEventListener('click', startRound);
    $('again-btn').addEventListener('click', () => {
        if (endScreenReady()) startRound();
    });
    $('change-btn').addEventListener('click', () => {
        renderRecord();
        setState('ready');
        $('start-btn').focus();
    });

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        if (state === 'playing') {
            if (/^[a-z]$/i.test(event.key)) {
                guess(event.key.toUpperCase());
            } else if (event.key === '/' || event.key === '?') {
                event.preventDefault();
                useHint();
            }
            return;
        }

        const confirm = event.key === 'Enter' || event.key === ' ';
        // A focused button, link or list handles Enter and Space itself.
        if (!confirm || event.repeat || event.target.closest('button, a, select')) return;
        if (state === 'ready' || endScreenReady()) {
            event.preventDefault();
            startRound();
        }
    });

    fillLanterns(lanternsEl, CHANCES);
    fillLanterns($('start-lanterns'), CHANCES);
    renderRecord();
    setState('ready');
})();
