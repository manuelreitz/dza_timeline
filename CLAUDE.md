# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

This is a single-file prototype — all HTML, CSS, JavaScript and inline SVG live in `index.html`. Serve it with any local web server (e.g. VS Code Live Server or `python3 -m http.server`). Do **not** open via `file://` — `fetch('data.csv')` requires HTTP.

There are no build steps, no package manager, no tests.

## Architecture

### index.html — single source of truth

**SVG chart** (`viewBox="0 0 2105.52 1155"`, `overflow: visible`)
The chart is an inline SVG. Key coordinate constants in JS:
- `YEAR_CX` — x-center per year (2021–2026)
- `valueToCy(n)` — converts employee count to SVG y (0-line at y=968.54)
- `PX_PER_UNIT ≈ 6.297` px per employee
- Grid x range: 79.12 – 2049.70; left/right padding in HTML = 3.76%

**Data flow**
`init()` fetches `data.csv` → `parseCSV()` → `renderChart()` which writes into `<g id="data-layer">`. The growth cone uses external tangent geometry (`buildConePath`). Fallback CSV is hardcoded in the script for `file://` use.

**SVG layers (top to bottom in DOM = front to back visually)**
Phase circles → hover indicator line → data-layer (cone + circles) → event markers → timeline/year/phase labels group (`translate(0,90)`)

**Phase circles** sit at `cx=107.38, cy=1083.19` (timeline origin + 90 px shift). They use `overflow: visible` on the SVG to extend below the viewBox.

**Event markers** (`<g class="event-marker" data-photo-index="N">`) — 5 markers linking SVG positions to `photoData` indices. Each wraps line + two circles + text + transparent hit rect. Click sets `pinned=true` and activates the corresponding photo frame.

**Photo strip** (HTML, below SVG)
44 frames generated from `photoData` array. Accordion behaviour: `flex:7` active / `flex:0.3` others. Strip has fixed `height:400px; overflow:hidden` — never resizes. Random per-frame base height via CSS custom property `--base-h`.

**Caption** uses `opacity:0/1` + `pointer-events:none/auto` (never `display:none`) so it always occupies layout space. Hover zone detection uses `document.mousemove` + `getBoundingClientRect()` to avoid reflow-triggered false `mouseleave` events. `pinned` flag keeps strip open after marker click until user hovers a frame.

**Hover indicator line** (`#hover-indicator` group in SVG): shown when a frame is active, x-position derived from `dateToX()` which parses German month names from `photoData[i].date`.

### data.csv

Employee counts per year (2021–2026). Loaded at runtime; changes here update the chart automatically.

### vorlagen/

Design reference SVGs (not loaded at runtime). Used during development to extract font sizes, layout dimensions, and SVG paths.

### images/

10 JPEG test images (01–10.jpeg). The live photo data (`photoData[].img`) points directly to `https://deutscheszentrumastrophysik.de/...` image URLs.
