// Word Net themes, grid generator and word matcher. No DOM in here, so the same code is proven in Node.
(() => {
    const COLS = 10;
    const ROWS = 10;

    const THEMES = [
        { id: 'kitchen', name: 'Kitchen', words: ['SPOON', 'FORK', 'KNIFE', 'PLATE', 'KETTLE', 'OVEN', 'WHISK', 'APRON', 'TOASTER', 'BLENDER', 'SKILLET', 'LADLE', 'GRATER', 'TEAPOT'] },
        { id: 'ocean', name: 'Ocean', words: ['WHALE', 'SHARK', 'CORAL', 'SQUID', 'DOLPHIN', 'TURTLE', 'OCTOPUS', 'SEAL', 'CRAB', 'JELLYFISH', 'STARFISH', 'LOBSTER', 'TIDE', 'REEF', 'KELP'] },
        { id: 'garden', name: 'Garden', words: ['TULIP', 'DAISY', 'ROSE', 'SHOVEL', 'SEEDS', 'HEDGE', 'BUTTERFLY', 'SPROUT', 'COMPOST', 'TROWEL', 'PETAL', 'WORM', 'LADYBUG', 'FENCE'] },
        { id: 'space', name: 'Space', words: ['PLANET', 'COMET', 'ROCKET', 'ORBIT', 'GALAXY', 'METEOR', 'MOON', 'SATELLITE', 'STAR', 'NEBULA', 'ECLIPSE', 'ASTEROID', 'GRAVITY', 'TELESCOPE'] },
        { id: 'weather', name: 'Weather', words: ['STORM', 'CLOUD', 'THUNDER', 'BREEZE', 'FROST', 'RAINBOW', 'DRIZZLE', 'HAIL', 'SLEET', 'SUNNY', 'FOGGY', 'TORNADO', 'BLIZZARD', 'HUMID'] },
        { id: 'farm', name: 'Farm', words: ['TRACTOR', 'BARN', 'HORSE', 'CHICKEN', 'GOAT', 'SHEEP', 'MEADOW', 'HAY', 'ROOSTER', 'DONKEY', 'PASTURE', 'ORCHARD', 'SCARECROW', 'CALF'] },
        { id: 'music', name: 'Music', words: ['GUITAR', 'PIANO', 'DRUMS', 'VIOLIN', 'FLUTE', 'TRUMPET', 'CHOIR', 'MELODY', 'RHYTHM', 'BANJO', 'CELLO', 'HARP', 'CHORUS', 'TEMPO'] },
        { id: 'sports', name: 'Sports', words: ['SOCCER', 'TENNIS', 'HOCKEY', 'CRICKET', 'RUGBY', 'BOXING', 'SKIING', 'ROWING', 'KARATE', 'ARCHERY', 'GOLF', 'SURFING', 'CYCLING', 'FENCING'] },
        { id: 'breakfast', name: 'Breakfast', words: ['PANCAKE', 'WAFFLE', 'TOAST', 'CEREAL', 'GRANOLA', 'OMELET', 'YOGURT', 'MUFFIN', 'BAGEL', 'HONEY', 'BUTTER', 'SYRUP', 'JUICE', 'OATMEAL'] },
        { id: 'camping', name: 'Camping', words: ['TENT', 'LANTERN', 'COMPASS', 'BACKPACK', 'TRAIL', 'CANOE', 'HAMMOCK', 'BONFIRE', 'FOREST', 'HIKING', 'STREAM', 'BLANKET', 'THERMOS', 'SUNRISE'] },
        { id: 'colors', name: 'Colors', words: ['SCARLET', 'VIOLET', 'INDIGO', 'CRIMSON', 'TURQUOISE', 'MAROON', 'AMBER', 'IVORY', 'TEAL', 'MAGENTA', 'ORANGE', 'YELLOW', 'PURPLE', 'SILVER'] },
        { id: 'town', name: 'Around Town', words: ['LIBRARY', 'BAKERY', 'MARKET', 'SCHOOL', 'MUSEUM', 'STATION', 'BRIDGE', 'PARK', 'CINEMA', 'HOSPITAL', 'FOUNTAIN', 'SIDEWALK', 'CAFE', 'PLAZA'] },
        { id: 'jungle', name: 'Jungle', words: ['TIGER', 'PARROT', 'MONKEY', 'JAGUAR', 'PYTHON', 'TOUCAN', 'GORILLA', 'SLOTH', 'LEMUR', 'PANTHER', 'IGUANA', 'TAPIR', 'MACAW', 'ANTEATER'] },
        { id: 'tools', name: 'Toolbox', words: ['HAMMER', 'WRENCH', 'PLIERS', 'CHISEL', 'LADDER', 'DRILL', 'SANDPAPER', 'SCREW', 'NAILS', 'TAPE', 'RULER', 'CLAMP', 'HANDSAW', 'BOLT'] }
    ];

    // [row step, column step]. Easy reads across and down, medium adds the two forward diagonals,
    // hard adds the four reversed directions.
    const FORWARD = [[0, 1], [1, 0]];
    const DIAGONAL = [[1, 1], [-1, 1]];
    const REVERSED = [[0, -1], [-1, 0], [-1, -1], [1, -1]];
    const DIRECTIONS = {
        easy: FORWARD,
        medium: [...FORWARD, ...DIAGONAL],
        hard: [...FORWARD, ...DIAGONAL, ...REVERSED]
    };
    const ALL_DIRECTIONS = DIRECTIONS.hard;

    // Filler letters lean toward common ones so the grid reads like real text.
    const FILLER = 'AAABCDEEEEFGHIIKLMNNOOOPRRSSTTUWY';
    // Short rude words that random filler must never spell.
    const BLOCKED = ['ASS', 'DAMN', 'HELL', 'CRAP', 'SEX', 'POOP', 'BUTT', 'FART', 'TURD', 'SLUT', 'DICK', 'COCK', 'SHIT', 'FUCK', 'PISS', 'TIT', 'FAG', 'CUM', 'NIG'];

    const reverse = (text) => [...text].reverse().join('');

    const shuffled = (list, random) => {
        const copy = [...list];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    };

    // Picks 8 to 10 words, never two where one hides inside the other (in either reading direction).
    const pickWords = (theme, random) => {
        const count = 8 + Math.floor(random() * 3);
        const picked = [];
        for (const word of shuffled(theme.words, random)) {
            const clash = picked.some((other) => {
                const [short, long] = word.length <= other.length ? [word, other] : [other, word];
                return long.includes(short) || long.includes(reverse(short));
            });
            if (!clash) picked.push(word);
            if (picked.length === count) break;
        }
        return picked;
    };

    const inside = (row, col) => row >= 0 && row < ROWS && col >= 0 && col < COLS;

    const readLine = (grid, row, col, dr, dc, length) => {
        let text = '';
        for (let i = 0; i < length; i++) {
            const r = row + dr * i;
            const c = col + dc * i;
            if (!inside(r, c)) return null;
            text += grid[r][c];
        }
        return text;
    };

    // Every place (start cell and direction) where the word can be read in the grid.
    const occurrences = (grid, word) => {
        const found = [];
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                if (grid[row][col] !== word[0]) continue;
                for (const [dr, dc] of ALL_DIRECTIONS) {
                    if (readLine(grid, row, col, dr, dc, word.length) === word) found.push({ row, col, dr, dc });
                }
            }
        }
        return found;
    };

    const blockedCount = (grid) => BLOCKED.reduce((sum, word) => sum + occurrences(grid, word).length, 0);

    const tryPlace = (cells, word, directions, random) => {
        for (let attempt = 0; attempt < 200; attempt++) {
            const [dr, dc] = directions[Math.floor(random() * directions.length)];
            const row = Math.floor(random() * ROWS);
            const col = Math.floor(random() * COLS);
            const endRow = row + dr * (word.length - 1);
            const endCol = col + dc * (word.length - 1);
            if (!inside(endRow, endCol)) continue;
            let fits = true;
            for (let i = 0; i < word.length && fits; i++) {
                const cell = cells[row + dr * i][col + dc * i];
                fits = cell === '' || cell === word[i];
            }
            if (!fits) continue;
            for (let i = 0; i < word.length; i++) cells[row + dr * i][col + dc * i] = word[i];
            return { word, row, col, dr, dc };
        }
        return null;
    };

    // Builds a grid where every word sits exactly once, in a direction the difficulty allows.
    const generate = (words, difficulty, random = Math.random) => {
        const directions = DIRECTIONS[difficulty];
        const longestFirst = [...words].sort((a, b) => b.length - a.length);
        for (;;) {
            const cells = Array.from({ length: ROWS }, () => Array(COLS).fill(''));
            const placements = [];
            for (const word of longestFirst) {
                const placed = tryPlace(cells, word, directions, random);
                if (!placed) break;
                placements.push(placed);
            }
            if (placements.length < words.length) continue;

            // A listed word may contain a blocked one (COMPASS), so only the filler is held to the count.
            const blockedBefore = blockedCount(cells);
            const grid = cells.map((line) => line.map((cell) => cell || FILLER[Math.floor(random() * FILLER.length)]));
            const single = words.every((word) => occurrences(grid, word).length === 1);
            if (single && blockedCount(grid) === blockedBefore) return { grid, placements };
        }
    };

    // The cells on a straight line between two cells, or null when they do not line up.
    const lineCells = (row1, col1, row2, col2) => {
        const rowGap = row2 - row1;
        const colGap = col2 - col1;
        if (rowGap !== 0 && colGap !== 0 && Math.abs(rowGap) !== Math.abs(colGap)) return null;
        const length = Math.max(Math.abs(rowGap), Math.abs(colGap));
        const cells = [];
        for (let i = 0; i <= length; i++) {
            cells.push([row1 + Math.sign(rowGap) * i, col1 + Math.sign(colGap) * i]);
        }
        return cells;
    };

    // The one matcher the game uses for slides, taps and keys: a line counts when it spells
    // a remaining word forward or backward, wherever in the grid that happens to be.
    const matchLine = (grid, row1, col1, row2, col2, remaining) => {
        const cells = lineCells(row1, col1, row2, col2);
        if (!cells || cells.length < 2) return null;
        const text = cells.map(([row, col]) => grid[row][col]).join('');
        const backward = reverse(text);
        return remaining.find((word) => word === text || word === backward) ?? null;
    };

    window.WordNetCore = { COLS, ROWS, THEMES, pickWords, generate, lineCells, matchLine };
})();
