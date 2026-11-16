const games = window.ARCADE_GAMES;
const COLORS = ['coral', 'yellow', 'teal', 'violet', 'mint', 'sky', 'cream'];
// Tile sizes after the featured tile. The cycle fills a four column grid with no gaps.
const SIZES = ['', '', 'wide', '', '', 'wide', 'wide', '', '', 'wide', 'wide'];
const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty',
    'Twenty-one', 'Twenty-two', 'Twenty-three', 'Twenty-four', 'Twenty-five', 'Twenty-six', 'Twenty-seven', 'Twenty-eight',
    'Twenty-nine', 'Thirty'];
const ARROW = '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>';

const grid = document.getElementById('grid');
const cats = document.getElementById('cats');

const svg = (inner) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

// The featured tile, then the cycle. Trailing small tiles are widened until the last row is full.
const sizesFor = (count) => {
    const sizes = Array.from({ length: count }, (_, position) => (position === 0 ? 'hero' : SIZES[(position - 1) % SIZES.length]));
    const cells = () => sizes.reduce((sum, size) => sum + { hero: 4, wide: 2, '': 1 }[size], 0);
    while (cells() % 4 !== 0 && sizes.includes('')) sizes[sizes.lastIndexOf('')] = 'wide';
    return sizes;
};

const tile = (game, size) => {
    const hero = size === 'hero';
    const color = COLORS[games.indexOf(game) % COLORS.length];
    return `
        <a class="tile ${size}" href="games/${game.slug}/" style="--c:var(--${color})">
            <div class="top">
                <span class="tag">${game === games[0] ? 'Featured' : game.tag}</span>
                <span class="art">${svg(game.icon)}</span>
            </div>
            <div>
                <h2>${game.title}</h2>
                <p>${game.blurb}</p>
                ${hero ? `<span class="btn">Play now ${svg(ARROW)}</span>` : ''}
            </div>
        </a>`;
};

const show = (list) => {
    const sizes = sizesFor(list.length);
    grid.innerHTML = list.map((game, position) => tile(game, sizes[position])).join('');
};

const addCategory = (label, tag, pressed) => {
    const shown = tag ? games.filter((game) => game.tag === tag) : games;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cat';
    button.setAttribute('aria-pressed', pressed);
    button.innerHTML = `${label} <b>${shown.length}</b>`;
    button.addEventListener('click', () => {
        cats.querySelectorAll('.cat').forEach((cat) => cat.setAttribute('aria-pressed', cat === button));
        show(shown);
    });
    const item = document.createElement('li');
    item.appendChild(button);
    cats.appendChild(item);
};

addCategory('All games', null, true);
new Set(games.map((game) => game.tag)).forEach((tag) => addCategory(tag, tag, false));

show(games);
document.getElementById('game-total').textContent =
    `${NUMBER_WORDS[games.length] ?? games.length} ${games.length === 1 ? 'game' : 'games'}.`;
