# Transit Builder GTA

A static 2D transit-planning game prototype inspired by the approachable feel of Mini Metro, but shaped around a real-world GTA transit map image.

The current build starts with the GTA and is designed for GitHub Pages: open `index.html` directly or publish the folder as a static site.

For a local preview with a tiny dependency-free server:

```bash
node tools/static-server.js
```

Then open `http://127.0.0.1:4173`.

## What is playable

- Inspect a schematic GTA map with TTC rapid transit, GO corridors, and UP Express.
- Pick an expansion crew and click two stations to build a new link.
- Manage a simple capital budget while coverage, ridership, and pressure update over time.
- Complete milestones for Pearson, Square One, Scarborough Centre, Richmond Hill Centre, and Billy Bishop Airport.
- Use the separate city data module as the starting point for adding future regions.

## Project Structure

```text
.
├── index.html
├── styles.css
├── assets
│   └── gta-dark-map.png
└── src
    ├── app.js
    └── cities
        └── gta.js
```

## Adding Another City

1. Copy `src/cities/gta.js` to a new file such as `src/cities/montreal.js`.
2. Keep the same city object shape: `stations`, `routes`, `suggestedLinks`, `milestones`, and `sources`.
3. Import the city in `src/app.js` and add it to the `cities` object.
4. Add an `<option>` in `index.html` for the new city id.

## Placing Station Points

Use `Place` mode in the app to calibrate the clickable game layer against the map image.

1. Choose a station in the point editor.
2. Click the exact station location on the map, or enter `X` and `Y` manually.
3. Use `Export` to generate a replacement `coordinates` block for `src/cities/gta.js`.

Your placement edits are also saved in browser storage while you work, so you can refresh the page without losing the calibration pass.

## Data Notes

This is a gameplay prototype, not an official navigation product. The GTA map image is used as the base layer, while station coordinates in `src/cities/gta.js` define the clickable game layer on top.

Useful source links are listed inside `src/cities/gta.js`.
