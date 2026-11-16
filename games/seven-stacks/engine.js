// Rules for Seven Stacks (Klondike solitaire). Loaded by index.html with a script tag and by Node tests with require().
//
// Cards are numbers 0 to 51: suit = floor(card / 13) (0 spades, 1 hearts, 2 clubs, 3 diamonds), rank = card % 13 (0 ace to 12 king).
// Places are short strings: 'w' the waste, 'f0' to 'f3' the foundations (one per suit), 't0' to 't6' the tableau piles.
(() => {
    const KING = 12;
    const suitOf = (card) => Math.floor(card / 13);
    const rankOf = (card) => card % 13;
    const isRed = (card) => suitOf(card) % 2 === 1;
    const pileNames = [0, 1, 2, 3, 4, 5, 6].map((index) => `t${index}`);

    const newGame = (draw, random = Math.random) => {
        const deck = Array.from({ length: 52 }, (_, card) => card);
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        const tableau = pileNames.map((_, index) => ({ cards: deck.splice(0, index + 1), down: index }));
        return { draw, stock: deck, waste: [], foundations: [[], [], [], []], tableau, moves: 0, history: [] };
    };

    const stackAt = (game, place) => {
        if (place === 'w') return game.waste;
        const index = Number(place.slice(1));
        return place[0] === 'f' ? game.foundations[index] : game.tableau[index].cards;
    };

    // The cards a move would lift: one from the waste or a foundation, or a face-up run from the end of a tableau pile.
    const liftable = (game, from, count) => {
        const stack = stackAt(game, from);
        const faceUp = from[0] === 't' ? stack.length - game.tableau[Number(from.slice(1))].down : Math.min(stack.length, 1);
        return count >= 1 && count <= faceUp ? stack.slice(-count) : null;
    };

    const accepts = (game, to, run) => {
        const lead = run[0];
        const stack = stackAt(game, to);
        if (to[0] === 'f') {
            return run.length === 1 && suitOf(lead) === Number(to.slice(1)) && rankOf(lead) === stack.length;
        }
        if (to[0] !== 't') return false;
        if (!stack.length) return rankOf(lead) === KING;
        const top = stack[stack.length - 1];
        return isRed(top) !== isRed(lead) && rankOf(top) === rankOf(lead) + 1;
    };

    const canMove = (game, from, to, count = 1) => {
        if (from === to || (from[0] === 'f' && to[0] === 'f')) return false;
        const run = liftable(game, from, count);
        return run !== null && accepts(game, to, run);
    };

    const move = (game, from, to, count = 1) => {
        if (!canMove(game, from, to, count)) return false;
        const source = stackAt(game, from);
        const run = source.splice(source.length - count, count);
        let flipped = false;
        if (from[0] === 't') {
            const pile = game.tableau[Number(from.slice(1))];
            if (pile.cards.length && pile.down === pile.cards.length) {
                pile.down--;
                flipped = true;
            }
        }
        stackAt(game, to).push(...run);
        game.moves++;
        game.history.push({ kind: 'move', from, to, count, flipped });
        return true;
    };

    // Turns cards from the stock onto the waste, or turns the waste back over when the stock is empty.
    const drawStock = (game) => {
        if (game.stock.length) {
            const count = Math.min(game.draw, game.stock.length);
            for (let i = 0; i < count; i++) game.waste.push(game.stock.pop());
            game.history.push({ kind: 'draw', count });
        } else if (game.waste.length) {
            game.stock = game.waste.reverse();
            game.waste = [];
            game.history.push({ kind: 'recycle' });
        } else {
            return false;
        }
        game.moves++;
        return true;
    };

    const undo = (game) => {
        const last = game.history.pop();
        if (!last) return null;
        if (last.kind === 'draw') {
            for (let i = 0; i < last.count; i++) game.stock.push(game.waste.pop());
        } else if (last.kind === 'recycle') {
            game.waste = game.stock.reverse();
            game.stock = [];
        } else {
            const target = stackAt(game, last.to);
            const run = target.splice(target.length - last.count, last.count);
            if (last.flipped) game.tableau[Number(last.from.slice(1))].down++;
            stackAt(game, last.from).push(...run);
        }
        game.moves--;
        return last;
    };

    const isWon = (game) => game.foundations.every((stack) => stack.length === 13);

    // The waste or tableau card that can go to its foundation right now, lowest rank first.
    const foundationMove = (game) => {
        let best = null;
        ['w', ...pileNames].forEach((from) => {
            const run = liftable(game, from, 1);
            if (!run) return;
            const to = `f${suitOf(run[0])}`;
            if (accepts(game, to, run) && (!best || rankOf(run[0]) < best.rank)) best = { from, to, count: 1, rank: rankOf(run[0]) };
        });
        return best && { from: best.from, to: best.to, count: 1 };
    };

    // Where a tapped card should go: its foundation, else a pile it fits on, else an empty pile for a king that has cards under it.
    const bestTarget = (game, from, count) => {
        const run = liftable(game, from, count);
        if (!run) return null;
        const home = `f${suitOf(run[0])}`;
        if (canMove(game, from, home, count)) return home;
        const fits = pileNames.filter((to) => canMove(game, from, to, count));
        const onCards = fits.find((to) => stackAt(game, to).length > 0);
        if (onCards) return onCards;
        const settledKing = from[0] === 't' && count === stackAt(game, from).length;
        return fits.length && !settledKing ? fits[0] : null;
    };

    // A useful next step: a card to its foundation, a run that uncovers a face-down card, a waste card onto the tableau, or a draw.
    const hint = (game) => {
        const home = foundationMove(game);
        if (home) return home;
        const piles = game.tableau;
        const covered = pileNames.filter((_, index) => piles[index].down > 0)
            .sort((a, b) => piles[Number(b.slice(1))].down - piles[Number(a.slice(1))].down);
        for (const from of covered) {
            const pile = piles[Number(from.slice(1))];
            const to = bestTarget(game, from, pile.cards.length - pile.down);
            if (to) return { from, to, count: pile.cards.length - pile.down };
        }
        const wasteTo = bestTarget(game, 'w', 1);
        if (wasteTo) return { from: 'w', to: wasteTo, count: 1 };
        return game.stock.length || game.waste.length ? { draw: true } : null;
    };

    // The steps that finish the game by only sending cards home (drawing when nothing fits), or null.
    // It is offered once every tableau card is face up, and only when playing the steps out on a copy really wins.
    const finishPlan = (game) => {
        if (isWon(game) || game.tableau.some((pile) => pile.down > 0)) return null;
        const copy = JSON.parse(JSON.stringify({ ...game, history: [] }));
        const steps = [];
        let idle = 0;
        while (!isWon(copy)) {
            const step = foundationMove(copy);
            if (step) {
                move(copy, step.from, step.to, 1);
                steps.push(step);
                idle = 0;
                continue;
            }
            // Two full trips through the stock without a card going home means the remaining cards are stuck.
            const lap = Math.ceil((copy.stock.length + copy.waste.length) / copy.draw) + 1;
            if (++idle > 2 * lap || !drawStock(copy)) return null;
            steps.push({ draw: true });
        }
        return steps;
    };

    const api = { suitOf, rankOf, isRed, newGame, canMove, move, drawStock, undo, isWon, bestTarget, hint, finishPlan };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.StacksEngine = api;
    }
})();
