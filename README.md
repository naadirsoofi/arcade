# Arcade

Original browser games by Naadir Soofi, linked from the [Playground](https://naadirsoofi.com/playground.html).

Plain HTML, CSS and JavaScript. No build step.

## Layout

- `index.html`, `styles.css`, `script.js`: the hub page that lists the games
- `games.js`: the list of games shown on the hub
- `games/<slug>/`: one folder per game, each with its own `index.html`

## Adding a game

1. Create `games/<slug>/index.html` (plus its own CSS and JS in the same folder).
2. Add an entry to `games.js`: `{ slug, title, blurb, tag, accent }`.

## Local preview

```
python -m http.server 5535
```

Then open http://localhost:5535/. Never use port 3000.

## Rules

- Original games only, each with its own look.
- No emoji (single-stroke SVG line icons instead), no gradients, no em dashes.
- Works at phone width (375px) and by keyboard, with zero console errors.
