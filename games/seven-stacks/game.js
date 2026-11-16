(() => {
    const { suitOf, rankOf, isRed, newGame, canMove, move, drawStock, undo, isWon, bestTarget, hint, finishPlan } = window.StacksEngine;

    const STORE = 'arcade.seven-stacks.';
    const FLY_MS = 180;
    const FINISH_STEP_MS = 90;
    const HINT_MS = 1600;
    const DRAG_SLOP = 6;
    // The end screen waits this long before it takes input, so the key that made the last move cannot dismiss it.
    const END_DELAY = 700;
    const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const RANK_NAMES = ['Ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King'];
    const SUIT_NAMES = ['spades', 'hearts', 'clubs', 'diamonds'];
    const PILES = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];
    const FOUNDATIONS = ['f0', 'f1', 'f2', 'f3'];
    const TOP_ROW = ['s', 'w', ...FOUNDATIONS];
    // Where the keyboard cursor lands when it changes row.
    const ABOVE = ['s', 'w', 'w', 'f0', 'f1', 'f2', 'f3'];
    const BELOW = { s: 't0', w: 't1', f0: 't3', f1: 't4', f2: 't5', f3: 't6' };

    const byId = (id) => document.getElementById(id);
    const root = byId('game');
    const play = document.querySelector('.play');
    const table = byId('table');
    const pilesRow = byId('piles');
    const finishButton = byId('finish-btn');
    const againButton = byId('again-btn');
    const statusLine = byId('status');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const slots = {};
    document.querySelectorAll('.slot').forEach((slot) => {
        slots[slot.dataset.place] = slot;
    });

    const load = (key) => {
        try {
            return localStorage.getItem(STORE + key);
        } catch {
            return null;
        }
    };

    const save = (key, value) => {
        try {
            localStorage.setItem(STORE + key, value);
        } catch {
            // Storage is blocked: keep playing without saving.
        }
    };

    const loadJson = (key) => {
        try {
            return JSON.parse(load(key));
        } catch {
            return null;
        }
    };

    const formatTime = (ms) => {
        const seconds = Math.floor(ms / 1000);
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };

    const cardName = (card) => `${RANK_NAMES[rankOf(card)]} of ${SUIT_NAMES[suitOf(card)]}`;

    // A saved deal is only trusted when all 52 cards are there exactly once.
    const validGame = (saved) => {
        try {
            const cards = [...saved.stock, ...saved.waste, ...saved.foundations.flat(), ...saved.tableau.flatMap((pile) => pile.cards)];
            return cards.length === 52 && new Set(cards).size === 52 && cards.every((card) => Number.isInteger(card) && card >= 0 && card < 52)
                && saved.tableau.length === 7 && Array.isArray(saved.history) && (saved.draw === 1 || saved.draw === 3);
        } catch {
            return false;
        }
    };

    const savedStats = loadJson('stats') || {};
    const stats = {
        played: Number(savedStats.played) || 0,
        wins: Number(savedStats.wins) || 0,
        best: Number(savedStats.best) || 0
    };
    let drawSetting = load('draw') === '3' ? 3 : 1;

    let game = null;
    // A deal counts as played once its first move is made.
    let counted = false;
    let busy = false;
    let drag = null;
    let held = null;
    let cursor = { place: 't0', depth: 1 };
    let cursorShown = false;
    let flyTimer = 0;
    let hintTimer = 0;
    let endReadyAt = 0;

    // Play time runs from the first move and only while the table is on screen.
    let banked = 0;
    let runningSince = null;
    const elapsed = () => banked + (runningSince === null ? 0 : performance.now() - runningSince);
    const stopClock = () => {
        banked = elapsed();
        runningSince = null;
    };
    const runClock = () => {
        if (runningSince === null && !document.hidden && counted) runningSince = performance.now();
    };

    const cardEls = Array.from({ length: 52 }, (_, card) => {
        const el = document.createElement('div');
        const suit = suitOf(card);
        el.className = `card ${isRed(card) ? 'red' : 'black'}${rankOf(card) > 9 ? ' court' : ''}`;
        el.dataset.card = card;
        el.innerHTML = `<div class="face"><b class="rank">${RANKS[rankOf(card)]}</b>`
            + `<svg class="pip corner" aria-hidden="true"><use href="#suit-${suit}"/></svg>`
            + `<svg class="pip centre" aria-hidden="true"><use href="#suit-${suit}"/></svg></div><div class="back"></div>`;
        return el;
    });

    FOUNDATIONS.forEach((place, suit) => {
        slots[place].innerHTML = `<svg class="pip ghost" aria-hidden="true"><use href="#suit-${suit}"/></svg>`;
    });
    slots.s.innerHTML = '<svg class="turn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4.5v4.6h4.6"/></svg>';

    const stackOf = (place) => {
        if (place === 's') return game.stock;
        if (place === 'w') return game.waste;
        const index = Number(place.slice(1));
        return place[0] === 'f' ? game.foundations[index] : game.tableau[index].cards;
    };

    const faceUpCount = (place) => {
        if (place[0] !== 't') return Math.min(stackOf(place).length, 1);
        const pile = game.tableau[Number(place.slice(1))];
        return pile.cards.length - pile.down;
    };

    const persist = () => {
        save('game', JSON.stringify({ game, elapsed: Math.round(elapsed()), counted }));
    };

    /* Drawing the table */

    // Spreads a tableau pile downward. Long piles squeeze their fan so the last card stays on screen:
    // face-down cards close up first, then the face-up run.
    const pileOffsets = (pile, cardHeight, headHeight, room) => {
        const ups = pile.cards.length - pile.down;
        let downStep = Math.max(6, cardHeight * 0.12);
        let upStep = Math.max(headHeight, cardHeight * 0.28);
        const height = () => pile.down * downStep + (ups - 1) * upStep + cardHeight;
        if (height() > room && pile.down) downStep = Math.max(4, (room - cardHeight - (ups - 1) * upStep) / pile.down);
        if (height() > room && ups > 1) upStep = Math.max(headHeight * 0.6, (room - cardHeight - pile.down * downStep) / (ups - 1));
        const offsets = [];
        let top = 0;
        pile.cards.forEach((_, index) => {
            offsets.push(top);
            top += index < pile.down ? downStep : upStep;
        });
        return offsets;
    };

    const setCard = (el, slot, left, top, faceDown) => {
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.classList.toggle('down', faceDown);
        el.classList.remove('tucked');
        slot.append(el);
    };

    const showCursor = () => {
        document.querySelectorAll('.cursor, .held').forEach((el) => el.classList.remove('cursor', 'held'));
        if (held) {
            const stack = stackOf(held.from);
            stack.slice(stack.length - held.count).forEach((card) => cardEls[card].classList.add('held'));
        }
        if (!cursorShown) return;
        const stack = stackOf(cursor.place);
        const target = stack.length ? cardEls[stack[stack.length - cursor.depth]] : slots[cursor.place];
        target.classList.add('cursor');
    };

    const describeCursor = () => {
        const { place, depth } = cursor;
        const stack = stackOf(place);
        const names = { s: 'Stock', w: 'Waste' };
        const where = names[place] || (place[0] === 'f' ? `Foundation, ${SUIT_NAMES[Number(place[1])]}` : `Pile ${Number(place[1]) + 1}`);
        if (place === 's') return `${where}: ${stack.length} cards. Enter draws.`;
        if (!stack.length) return `${where}: empty.`;
        const card = cardName(stack[stack.length - depth]);
        return depth > 1 ? `${where}: ${card} and ${depth - 1} more on top.` : `${where}: ${card}.`;
    };

    const render = (animate = true) => {
        const first = animate && !reducedMotion.matches
            ? new Map(cardEls.map((el) => [el, el.getBoundingClientRect()]))
            : null;
        cardEls.forEach((el) => {
            el.style.transform = '';
            el.classList.remove('dragging', 'returning', 'hint');
        });
        Object.values(slots).forEach((slot) => slot.classList.remove('hint'));
        clearTimeout(hintTimer);

        const slotBox = slots.t0.getBoundingClientRect();
        const cardWidth = slotBox.width;
        const cardHeight = slotBox.height;
        const headHeight = Math.min(cardWidth * 0.36, 22) * 1.1 + 4;
        const room = pilesRow.clientHeight;

        game.stock.forEach((card) => setCard(cardEls[card], slots.s, 0, 0, true));
        // With draw three the last three waste cards are fanned sideways, and only the top one can be played.
        // A card tucked under the fan shows its suit below its rank, where it stays visible.
        const fanned = game.draw === 3 ? 3 : 1;
        game.waste.forEach((card, index) => {
            const shift = Math.max(0, index - (game.waste.length - fanned));
            setCard(cardEls[card], slots.w, shift * cardWidth * 0.36, 0, false);
            cardEls[card].classList.toggle('tucked', fanned === 3 && index < game.waste.length - 1);
        });
        game.foundations.forEach((stack, suit) => {
            stack.forEach((card) => setCard(cardEls[card], slots[FOUNDATIONS[suit]], 0, 0, false));
        });
        game.tableau.forEach((pile, index) => {
            const offsets = pileOffsets(pile, cardHeight, headHeight, room);
            pile.cards.forEach((card, position) => setCard(cardEls[card], slots[PILES[index]], 0, offsets[position], position < pile.down));
        });

        slots.s.classList.toggle('spent', !game.stock.length && !game.waste.length);
        byId('moves').textContent = game.moves;
        byId('draw-mode').textContent = game.draw;
        cursor.depth = Math.min(cursor.depth, Math.max(1, faceUpCount(cursor.place)));
        showCursor();

        if (!first) return;
        const flying = cardEls.filter((el) => {
            const from = first.get(el);
            const to = el.getBoundingClientRect();
            const dx = from.left - to.left;
            const dy = from.top - to.top;
            if (!from.width || (Math.abs(dx) < 1 && Math.abs(dy) < 1)) return false;
            el.classList.add('flying');
            el.style.transition = 'none';
            el.style.transform = `translate(${dx}px, ${dy}px)`;
            return true;
        });
        if (!flying.length) return;
        // Reading the layout commits the start positions before the cards are released to fly home.
        table.getBoundingClientRect();
        flying.forEach((el) => {
            el.style.transition = '';
            el.style.transform = '';
        });
        clearTimeout(flyTimer);
        flyTimer = setTimeout(() => cardEls.forEach((el) => el.classList.remove('flying')), FLY_MS + 40);
    };

    const showTime = () => {
        byId('time').textContent = formatTime(elapsed());
    };

    /* Screens */

    const setState = (state) => {
        root.dataset.state = state;
        play.inert = state === 'over';
    };

    const showStart = () => {
        stopClock();
        if (game) persist();
        document.querySelectorAll('.seg button').forEach((button) => {
            button.setAttribute('aria-pressed', String(Number(button.dataset.draw) === drawSetting));
        });
        const inProgress = Boolean(game) && !isWon(game);
        byId('resume-btn').hidden = !inProgress;
        byId('deal-btn').textContent = inProgress ? 'Deal a new game' : 'Deal';
        byId('start-stats').textContent = stats.played
            ? `Won ${stats.wins} of ${stats.played} played.${stats.best ? ` Best time ${formatTime(stats.best)}.` : ''}`
            : 'No games played yet.';
        setState('ready');
    };

    const showTable = () => {
        setState('playing');
        finishButton.hidden = finishPlan(game) === null;
        render(false);
        showTime();
        runClock();
    };

    const deal = () => {
        game = newGame(drawSetting);
        counted = false;
        banked = 0;
        runningSince = null;
        busy = false;
        held = null;
        cursor = { place: 't0', depth: 1 };
        persist();
        showTable();
        statusLine.textContent = `New deal, draw ${game.draw}.`;
    };

    const win = () => {
        stopClock();
        const time = Math.round(elapsed());
        const previous = stats.best;
        const isRecord = !previous || time < previous;
        stats.wins++;
        if (isRecord) stats.best = time;
        save('stats', JSON.stringify(stats));
        persist();
        byId('end-badge').hidden = !(isRecord && previous);
        byId('end-note').textContent = `Won ${stats.wins} of ${stats.played} played, draw ${game.draw}.`;
        byId('end-time').textContent = formatTime(time);
        byId('end-moves').textContent = game.moves;
        byId('end-best').textContent = formatTime(stats.best);
        statusLine.textContent = 'You won. All four suits are built.';
        endReadyAt = performance.now() + END_DELAY;
        setState('over');
        setTimeout(() => {
            if (root.dataset.state === 'over') againButton.focus();
        }, END_DELAY);
    };

    /* Actions */

    // Everything that changes the deal goes through here: the clock, the saved game and the table all follow.
    const commit = (message) => {
        if (!counted) {
            counted = true;
            stats.played++;
            save('stats', JSON.stringify(stats));
        }
        runClock();
        held = null;
        persist();
        render();
        if (message) statusLine.textContent = message;
        if (isWon(game)) {
            finishButton.hidden = true;
            win();
        } else if (!busy && finishButton.hidden !== (finishPlan(game) === null)) {
            // The finish button takes room from the piles, so their fans are laid out again.
            finishButton.hidden = !finishButton.hidden;
            render(false);
        }
    };

    const refuse = (el) => {
        el.classList.remove('refused');
        // Reading the size restarts the animation when the class goes straight back on.
        el.getBoundingClientRect();
        el.classList.add('refused');
    };

    const drawCards = () => {
        if (drawStock(game)) commit(game.waste.length ? `Drew ${cardName(game.waste[game.waste.length - 1])}.` : 'Stock turned over.');
        else refuse(slots.s);
    };

    const placeCards = (from, to, count) => {
        const stack = stackOf(from);
        const lead = stack[stack.length - count];
        if (!move(game, from, to, count)) return false;
        const where = to[0] === 'f' ? 'its foundation' : `pile ${Number(to[1]) + 1}`;
        commit(`${cardName(lead)} to ${where}.`);
        return true;
    };

    const undoLast = () => {
        if (root.dataset.state !== 'playing' || busy) return;
        if (undo(game)) commit('Move undone.');
        else statusLine.textContent = 'Nothing to undo.';
    };

    const showHint = () => {
        if (root.dataset.state !== 'playing' || busy) return;
        const step = hint(game);
        const marked = [];
        if (!step) {
            statusLine.textContent = 'No move found. Try undo or a new deal.';
            refuse(byId('hint-btn'));
            return;
        }
        if (step.draw) {
            marked.push(slots.s, ...game.stock.slice(-1).map((card) => cardEls[card]));
            statusLine.textContent = 'Hint: draw from the stock.';
        } else {
            const stack = stackOf(step.from);
            const target = stackOf(step.to);
            marked.push(...stack.slice(stack.length - step.count).map((card) => cardEls[card]));
            marked.push(target.length ? cardEls[target[target.length - 1]] : slots[step.to]);
            statusLine.textContent = `Hint: ${cardName(stack[stack.length - step.count])} to ${step.to[0] === 'f' ? 'its foundation' : `pile ${Number(step.to[1]) + 1}`}.`;
        }
        clearTimeout(hintTimer);
        document.querySelectorAll('.hint').forEach((el) => el.classList.remove('hint'));
        marked.forEach((el) => el.classList.add('hint'));
        hintTimer = setTimeout(() => marked.forEach((el) => el.classList.remove('hint')), HINT_MS);
    };

    // Plays the finishing steps one by one. The plan was already played out on a copy, so it cannot get stuck.
    const finish = () => {
        const plan = root.dataset.state === 'playing' && !busy ? finishPlan(game) : null;
        if (!plan) return;
        busy = true;
        finishButton.hidden = true;
        const stepMs = reducedMotion.matches ? 0 : FINISH_STEP_MS;
        const next = () => {
            if (root.dataset.state !== 'playing') {
                busy = false;
                return;
            }
            const step = plan.shift();
            if (step.draw) drawStock(game);
            else move(game, step.from, step.to, step.count);
            if (!plan.length) busy = false;
            commit('');
            if (plan.length) setTimeout(next, stepMs);
        };
        next();
    };

    /* Mouse and touch: drag a card or a run, or tap */

    const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

    // The legal place the dragged cards cover most. Any foundation stands for the card's own suit.
    const dropTarget = () => {
        const stack = stackOf(drag.from);
        const lead = stack[stack.length - drag.count];
        const box = cardEls[lead].getBoundingClientRect();
        let best = null;
        let bestArea = 0;
        [...FOUNDATIONS, ...PILES].forEach((place) => {
            const to = place[0] === 'f' ? `f${suitOf(lead)}` : place;
            if (!canMove(game, drag.from, to, drag.count)) return;
            const slot = slots[place];
            const area = Math.max(overlap(box, slot.getBoundingClientRect()), overlap(box, (slot.lastElementChild || slot).getBoundingClientRect()));
            if (area > bestArea) {
                best = to;
                bestArea = area;
            }
        });
        return best;
    };

    const endDrag = (drop) => {
        const { from, count, els, moved } = drag;
        const target = drop && moved ? dropTarget() : null;
        drag = null;
        if (target) {
            placeCards(from, target, count);
        } else if (moved) {
            els.forEach((el) => {
                el.classList.remove('dragging');
                el.classList.add('returning');
                el.style.transform = '';
            });
            setTimeout(() => els.forEach((el) => el.classList.remove('returning')), FLY_MS + 40);
        } else if (drop) {
            // A tap sends the card, or the run from that card down, to the best legal place.
            const to = from[0] === 'f' ? null : bestTarget(game, from, count);
            if (!to || !placeCards(from, to, count)) refuse(els[0]);
        }
    };

    table.addEventListener('pointerdown', (event) => {
        if (root.dataset.state !== 'playing' || busy || drag || event.button > 0) return;
        const slot = event.target.closest('.slot');
        if (!slot) return;
        event.preventDefault();
        table.focus({ preventScroll: true });
        cursorShown = false;
        held = null;
        showCursor();
        const place = slot.dataset.place;
        if (place === 's') {
            drawCards();
            return;
        }
        const cardEl = event.target.closest('.card');
        if (!cardEl || cardEl.classList.contains('down')) return;
        const stack = stackOf(place);
        const count = stack.length - stack.indexOf(Number(cardEl.dataset.card));
        if (place[0] !== 't' && count !== 1) return;
        drag = {
            id: event.pointerId,
            from: place,
            count,
            els: stack.slice(stack.length - count).map((card) => cardEls[card]),
            x: event.clientX,
            y: event.clientY,
            moved: false
        };
        table.setPointerCapture(event.pointerId);
    });

    table.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (!drag.moved) {
            if (Math.hypot(dx, dy) < DRAG_SLOP) return;
            drag.moved = true;
            drag.els.forEach((el) => el.classList.add('dragging'));
        }
        drag.els.forEach((el) => {
            el.style.transform = `translate(${dx}px, ${dy}px)`;
        });
    });

    table.addEventListener('pointerup', (event) => {
        if (drag && event.pointerId === drag.id) endDrag(true);
    });

    table.addEventListener('pointercancel', (event) => {
        if (drag && event.pointerId === drag.id) endDrag(false);
    });

    /* Keyboard: arrows move between piles, Enter or Space picks up and places */

    table.addEventListener('focus', () => {
        if (!table.matches(':focus-visible')) return;
        cursorShown = true;
        showCursor();
    });

    const moveCursor = (key) => {
        const { place } = cursor;
        const onTop = TOP_ROW.includes(place);
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
            const row = onTop ? TOP_ROW : PILES;
            const next = row[row.indexOf(place) + (key === 'ArrowRight' ? 1 : -1)];
            if (next) cursor = { place: next, depth: 1 };
        } else if (key === 'ArrowUp') {
            // Up first reaches deeper into a face-up run, then leaves for the top row.
            if (!onTop && !held && cursor.depth < faceUpCount(place)) cursor.depth++;
            else if (!onTop) cursor = { place: ABOVE[Number(place[1])], depth: 1 };
        } else if (onTop) {
            cursor = { place: BELOW[place], depth: 1 };
        } else if (cursor.depth > 1) {
            cursor.depth--;
        }
        cursorShown = true;
        showCursor();
        statusLine.textContent = describeCursor();
    };

    const activate = () => {
        cursorShown = true;
        const { place, depth } = cursor;
        const stack = stackOf(place);
        const target = stack.length ? cardEls[stack[stack.length - 1]] : slots[place];
        if (place === 's') {
            drawCards();
        } else if (!held) {
            if (!stack.length) {
                refuse(target);
            } else {
                held = { from: place, count: depth };
                statusLine.textContent = `Picked up ${cardName(stack[stack.length - depth])}. Move to a pile and press Enter to place.`;
            }
        } else if (held.from === place) {
            held = null;
            statusLine.textContent = 'Put back.';
        } else {
            const from = stackOf(held.from);
            const lead = from[from.length - held.count];
            const to = place[0] === 'f' ? `f${suitOf(lead)}` : place;
            if (placeCards(held.from, to, held.count)) {
                cursor.depth = 1;
            } else {
                refuse(target);
                statusLine.textContent = `${cardName(lead)} cannot go there.`;
            }
        }
        showCursor();
    };

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const state = root.dataset.state;
        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        const confirm = key === 'Enter' || key === ' ';
        const onControl = event.target.closest('button, a') !== null;

        if (state === 'playing') {
            if (busy) return;
            if (key.startsWith('Arrow')) {
                event.preventDefault();
                moveCursor(key);
            } else if (confirm && !onControl) {
                event.preventDefault();
                activate();
            } else if (key === 'Escape' && held) {
                held = null;
                showCursor();
            } else if (key === 'z' || key === 'u') {
                undoLast();
            } else if (key === 'h') {
                showHint();
            } else if (key === 'd') {
                drawCards();
            }
        } else if (state === 'ready') {
            if (confirm && !onControl) {
                event.preventDefault();
                deal();
            }
        } else if (confirm && (performance.now() < endReadyAt || !onControl)) {
            event.preventDefault();
            if (performance.now() >= endReadyAt) deal();
        }
    });

    byId('deal-btn').addEventListener('click', deal);
    byId('resume-btn').addEventListener('click', showTable);
    byId('new-btn').addEventListener('click', showStart);
    byId('end-menu-btn').addEventListener('click', showStart);
    byId('undo-btn').addEventListener('click', undoLast);
    byId('hint-btn').addEventListener('click', showHint);
    finishButton.addEventListener('click', finish);
    againButton.addEventListener('click', deal);

    document.querySelectorAll('.seg button').forEach((button) => {
        button.addEventListener('click', () => {
            drawSetting = Number(button.dataset.draw);
            save('draw', String(drawSetting));
            showStart();
        });
    });

    window.addEventListener('resize', () => {
        if (root.dataset.state === 'playing') render(false);
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopClock();
            if (game && root.dataset.state === 'playing') persist();
        } else if (root.dataset.state === 'playing') {
            runClock();
        }
    });

    window.addEventListener('pagehide', () => {
        if (game && root.dataset.state === 'playing') persist();
    });

    setInterval(() => {
        if (root.dataset.state === 'playing') showTime();
    }, 250);

    // A deal in progress comes straight back after a refresh.
    const saved = loadJson('game');
    if (saved && validGame(saved.game) && !isWon(saved.game)) {
        game = saved.game;
        counted = Boolean(saved.counted);
        banked = Number(saved.elapsed) || 0;
        showTable();
    } else {
        showStart();
    }
})();
