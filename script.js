const games = window.ARCADE_GAMES;
const grid = document.getElementById('game-grid');

const addText = (parent, tagName, text, className) => {
    const el = document.createElement(tagName);
    el.textContent = text;
    if (className) el.className = className;
    parent.appendChild(el);
};

games.forEach((game) => {
    const card = document.createElement('a');
    card.className = 'card';
    card.href = `games/${game.slug}/`;
    card.style.setProperty('--accent', `var(--${game.accent})`);
    addText(card, 'h2', game.title);
    addText(card, 'p', game.blurb);
    addText(card, 'span', game.tag, 'tag');
    grid.appendChild(card);
});

document.getElementById('empty').hidden = games.length > 0;
document.getElementById('game-count').textContent =
    games.length === 1 ? '1 game' : games.length > 1 ? `${games.length} games` : '';
