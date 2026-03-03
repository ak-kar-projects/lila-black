#  LILA BLACK — Player Journey Visualization Tool

> **Live tool:** [ak-kar-projects.github.io/lila-black](https://ak-kar-projects.github.io/lila-black)

A browser-based telemetry visualization tool built for the LILA Games APM assignment. It turns 5 days of raw production gameplay data from LILA BLACK (Feb 10–14, 2026 · 796 matches · 16,045 events) into an interactive map analysis environment for Level Designers.

---

## Opening the Tool

The live hosted version requires no setup:

**→ [ak-kar-projects.github.io/lila-black](https://ak-kar-projects.github.io/lila-black)**

Open it in Chrome or Firefox. The data (~3.9 MB) loads in a few seconds. No login, no install, no dependencies.

---

## What You Can Do

### Map View (top section)

**Switch between maps** using the three tabs on the left sidebar — Ambrose Valley (566 matches), Grand Rift (59), Lockdown (171).

**Filter by date or match** using the dropdowns. The match dropdown groups matches as *Mixed* (human + bot) or *Human-only*, and shows kill/player counts per match — so you can isolate specific sessions without knowing match IDs.

**Toggle event types** to show or hide Kills, Deaths, Storm Deaths, and Loot Pickups as distinct markers on the map. Toggle Human Players and Bots separately to isolate organic vs AI-driven behaviour.

**Heatmap overlays** — click any of the six layer buttons (Human Traffic, Bot Traffic, Kill Zones, Death Zones, Storm Deaths, Loot Density) to render a colour-ramp heatmap on the minimap. Use the opacity slider to blend it with the marker layer underneath.

**Timeline playback** — select a specific match from the dropdown, then click the Play button in the bottom bar to watch the match unfold in real time. Scrub to any point. Cycle through 0.5×, 1×, 2×, 5× speeds. Human paths render in blue, bot paths in green, with a live position dot at the head of each track.

**Hover any marker** for a tooltip showing event type, player type, match, and timestamp.

---

### Map Analysis (scroll down)

Scroll below the main map view to reach the cross-map analytics section.

**MAP ANALYSIS table** — 14 metrics across all three maps, colour-coded red/amber/green. Hover any metric name for a plain-English explanation of how it's calculated. Key findings visible immediately:
- 100% solo-match rate across all maps (avg humans per match ≈ 1) — almost no multiplayer sessions in this dataset
- 80% of all human movement is concentrated in just 10–15% of map zones
- Human/bot zone overlap is 86% on Ambrose Valley but only 58% on Grand Rift — bots are routing poorly on that map
- PvP kills near zero across all maps, confirming the dataset is mostly bot-combat sessions

**TOP ZONES BREAKDOWN** — four metric tabs (Human/Bot Overlap, Kill Share, Dead Zones, Loot/Kill Overlap) each showing the top 5 grid zones per map as bar charts with percentages. The minimap canvases above highlight which physical zones on the map those coordinates correspond to. Switch tabs to see the highlighted zones update live on all three minimaps simultaneously. Hover anywhere on a minimap to see the grid coordinate (C{col} / R{row}).

**TRAFFIC & FLOW** — the minimap canvases show the human movement heatmap rendered as a 48×48 grid overlay, with kill hotspots in red. This is the visual proof of the concentration finding: the bright zones are strikingly few.

---

## Architecture

### Two-stage pipeline

```
player_data/          ←  1,243 raw parquet files (~8 MB)
      ↓
process_data.py       ←  run once, offline
      ↓
data.js               ←  3.9 MB · sets window.LILA_DATA
      ↓
index.html + app.js + analytics.js   ←  fully static, no server needed
```

**`process_data.py`** reads all parquet files, handles every data edge case (byte-encoded event strings, Unix-second timestamps stored in a millisecond-typed column, UUID vs numeric user IDs for human/bot detection, `.nakama-0` suffix on match IDs), normalises heatmap grids to 0–1, samples position tracks at 1-in-4 for size, and writes a single `data.js` file.

**`index.html`** is a static file with no framework dependencies. Three JS files handle distinct concerns:
- `app.js` — render pipeline, filters, heatmap, markers, track playback, timeline, UI bindings
- `analytics.js` — map analysis computation, minimap canvas rendering, zone breakdown, error handling
- `data.js` — pre-computed data, loaded as a script tag

### Key data nuances handled

| Problem | How it's handled |
|---|---|
| `event` column stored as bytes | `.decode('utf-8')` check before string cast |
| `ts` column typed as `timestamp[ms]` but stores Unix **seconds** | Cast via `pyarrow` to `int64`, multiply by 1000 |
| Bot detection | UUID regex `^[0-9a-f]{8}-[0-9a-f]{4}-` separates humans from numeric bot IDs |
| Match fragmentation | `.nakama-0` suffix stripped before using `match_id` as key |
| Coordinate mapping | `pixel_y = (1 - v) * 1024` — Y-axis flip applied for all three maps with distinct scale/origin configs |
| `y` column is elevation, not 2D position | Ignored for minimap plotting; only `x` and `z` used |

### Trade-offs

- **Single HTML file → three files**: originally one 1,800-line file; refactored to separate render, filter, timeline, and analytics concerns for maintainability
- **Pre-processing over runtime**: all grid computation happens in `process_data.py`, keeping the browser fast and the hosting purely static
- **Track sampling**: every 4th position event is kept, reducing `data.js` from ~15 MB to 3.9 MB with no visible loss of route fidelity
- **No framework**: vanilla JS avoids build tooling friction for a tool that needs to run locally with zero setup; the trade-off is less structure at scale

---

## Running Locally (optional)

If you want to re-process the raw data or run the tool offline:

```bash
# 1. Install dependencies
pip install pyarrow pandas

# 2. Process the raw parquet files (place player_data/ in the same directory)
python process_data.py

# 3. Serve locally (required — browsers block local file:// JS imports)
python -m http.server 8080

# 4. Open in browser
open http://localhost:8080
```

The `process_data.py` script accepts a custom data path:
```bash
python process_data.py --data /path/to/player_data
```

---

## File Structure

```
lila-black/
├── index.html          # HTML structure + CSS
├── app.js              # Render engine, filters, timeline, UI
├── analytics.js        # Map analysis, minimap grids, zone breakdown
├── data.js             # Pre-processed telemetry (generated by process_data.py)
├── process_data.py     # One-time data pipeline (parquet → data.js)
├── AmbroseValley_Minimap.png
├── GrandRift_Minimap.png
└── Lockdown_Minimap.jpg
```

---

## Dataset

5 days of production gameplay from LILA BLACK · Feb 10–14, 2026

| | |
|---|---|
| Total files | 1,243 parquet files |
| Matches | 796 unique matches |
| Maps | Ambrose Valley, Grand Rift, Lockdown |
| Events | ~89,000 rows · 8 event types |
| Players | 339 unique human players |

---

## Updating the Tool with New Data

This section documents every file that needs to change when the player data is replaced — whether that's a new date range, new maps, or a different schema.

There are two categories of change: **always required** (any new dataset) and **only if maps change** (same schema, different maps).

---

### Always required — any new dataset

**1. `process_data.py` — update the date folders**

```python
# Line 66 — replace with the folder names in your new player_data/
DATE_FOLDERS = ["February_10", "February_11", "February_12", "February_13", "February_14"]
```

Each string must exactly match a subfolder name inside `player_data/`. Add or remove entries freely — the script skips any folder it can't find and warns you.

**2. Re-run the pipeline**

```bash
python process_data.py --data /path/to/new/player_data
```

This regenerates `data.js`. Replace the old `data.js` with the new one. Nothing else needs to change if the maps and schema are the same.

---

### Only if maps change — same schema, different maps

If the new dataset introduces different maps (new names, new scale/origin values, or new minimap images), changes are needed in four files.

---

**1. `process_data.py` — update map configs**

```python
# Lines 39–44 — one entry per map
# scale and origin values come from the game's coordinate system documentation
MAP_CONFIGS = {
    "AmbroseValley": {"scale": 900,  "origin_x": -370, "origin_z": -473},
    "GrandRift":     {"scale": 581,  "origin_x": -290, "origin_z": -290},
    "Lockdown":      {"scale": 1000, "origin_x": -500, "origin_z": -500},
}
```

Add, remove, or rename entries to match the new maps. The key (e.g. `"AmbroseValley"`) must exactly match the `map_id` values in the parquet files. `scale`, `origin_x`, and `origin_z` define how world coordinates map onto the 1024×1024 minimap image — get these from the level design team or README for the new map.

---

**2. `app.js` — update the map constants block (lines 11–21)**

Three constants at the top of the file reference maps by name:

```js
// Line 11 — filename of each map's minimap image
const MAP_IMAGES = {
  AmbroseValley: 'AmbroseValley_Minimap.png',
  GrandRift:     'GrandRift_Minimap.png',
  Lockdown:      'Lockdown_Minimap.jpg',
};

// Line 17 — accent colour used for heatmap overlay on each map
const MAP_COLORS = {
  AmbroseValley: '#3b82f6',  // blue
  GrandRift:     '#f59e0b',  // amber
  Lockdown:      '#a855f7',  // purple
};

// Line 43 — which map is shown on first load
let currentMap = 'AmbroseValley';
```

Update all three. Keys must match `MAP_CONFIGS` in `process_data.py` exactly. Pick any hex colour per map — each one is used for the heatmap overlay and UI accents for that map throughout the tool.

---

**3. `analytics.js` — update the map constants block (lines 24–31)**

The analytics section has its own parallel map config at the top of the IIFE:

```js
// Line 24 — array controls iteration order (left→right in the UI)
var MAPS = ['AmbroseValley', 'GrandRift', 'Lockdown'];

// Line 25 — minimap image filenames (must match files in the repo root)
var MAP_IMGS = {
  AmbroseValley: 'AmbroseValley_Minimap.png',
  GrandRift:     'GrandRift_Minimap.png',
  Lockdown:      'Lockdown_Minimap.jpg'
};

// Line 26 — CSS class suffix used for column colours in the analytics table
// Must match the .ma-th-{cls} rules in index.html (see below)
var MAP_CLS = { AmbroseValley: 'av', GrandRift: 'gr', Lockdown: 'lk' };

// Line 27 — RGB triplet for the heatmap overlay on each minimap canvas
// Same colour as MAP_COLORS in app.js, just expressed as [R, G, B]
var MAP_COL = {
  AmbroseValley: [59, 130, 246],   // #3b82f6
  GrandRift:     [245, 158, 11],   // #f59e0b
  Lockdown:      [168, 85, 247]    // #a855f7
};

// Line 28 — Display name shown above each minimap canvas
var MAP_NAMES = {
  AmbroseValley: 'AMBROSE VALLEY',
  GrandRift:     'GRAND RIFT',
  Lockdown:      'LOCKDOWN'
};
```

`CV_IDS`, `WRAP_IDS`, and `HOVER_IDS` on lines 29–31 are canvas element IDs that must stay in sync with `index.html` (see below). If you're keeping three maps, just update the key names. If you're changing the number of maps, you'll also need to add/remove canvas elements in `index.html`.

---

**4. `index.html` — update map tabs, table headers, and canvas elements**

This is the most structural change. There are three places inside `index.html`:

**Map selector tabs** (around line 377) — one `<div>` per map:
```html

  Ambrose Valley
  —


  Grand Rift
  —


  Lockdown
  —

```

`data-map` must match the key in `MAP_CONFIGS`. `id="mc-{MapName}"` must also match.

**Analytics table column headers** (around line 632):
```html
Ambrose Valley
Grand Rift
Lockdown
```

The `ma-th-{cls}` class drives the column accent colour. Add a matching CSS rule in the `<style>` block (around line 578) for any new suffix:
```css
.ma-th-av { color: #3b82f6 !important; }
.ma-th-gr { color: #f59e0b !important; }
.ma-th-lk { color: #a855f7 !important; }
```

**Analytics minimap canvases** (around line 648) — one block per map:
```html

  
  

```

The IDs (`ma-wrap-av`, `ma-cv-av`, `ma-hover-av`) must match the `CV_IDS`, `WRAP_IDS`, and `HOVER_IDS` objects in `analytics.js`. The suffix (`av`, `gr`, `lk`) is the same shorthand used in `MAP_CLS`.

---

### If the event schema changes

The event type names (`Kill`, `BotKill`, `Killed`, `BotKilled`, `KilledByStorm`, `Loot`, `Position`, `BotPosition`) are defined in two places:

**`process_data.py`** lines 59–64 — controls which events get written to `data.js` and which heatmap layer they feed into:
```python
POSITION_EVENTS = {"Position", "BotPosition"}
KILL_EVENTS     = {"Kill", "BotKill"}
DEATH_EVENTS    = {"Killed", "BotKilled"}
STORM_EVENTS    = {"KilledByStorm"}
LOOT_EVENTS     = {"Loot"}
```

**`app.js`** lines 23–30 — controls the colour each event type renders as on the map:
```js
const EVENT_COLORS = {
  Kill:           '#ef4444',  // red
  BotKill:        '#f97316',  // orange
  Killed:         '#6366f1',  // indigo
  BotKilled:      '#8b5cf6',  // violet
  KilledByStorm:  '#06b6d4',  // cyan
  Loot:           '#22c55e',  // green
};
```

If event names change, update both. The filter checkboxes in `index.html` (around lines 419–467) are labelled generically (Kills, Deaths, Storm Deaths, Loot) and don't need to change unless entirely new event categories are added.

---

### If the bot detection logic changes

**`process_data.py`** line 68 — the `is_human()` function:
```python
def is_human(user_id):
    """UUID user_ids = human players. Short numeric ids = bots."""
    uid = str(user_id)
    return bool(re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-', uid, re.IGNORECASE))
```

If the new dataset uses a different convention to distinguish humans from bots (e.g. a dedicated `is_bot` column, a different ID format, or a player type field), update this function. Everything downstream — heatmap layers, track colours, filter toggles — derives from this single function's return value.

---

### Summary table

| What changed | `process_data.py` | `app.js` | `analytics.js` | `index.html` | New image files |
|---|:---:|:---:|:---:|:---:|:---:|
| New date range only | ✅ `DATE_FOLDERS` | — | — | — | — |
| New map (same schema) | ✅ `MAP_CONFIGS` | ✅ constants | ✅ constants | ✅ tabs + headers + canvases | ✅ minimap PNG/JPG |
| Renamed map | ✅ `MAP_CONFIGS` key | ✅ constants | ✅ constants | ✅ `data-map` + IDs | ✅ rename file |
| New event type | ✅ event sets | ✅ `EVENT_COLORS` | — | optional new toggle | — |
| Different bot detection | ✅ `is_human()` | — | — | — | — |
| Different minimap size | ✅ `IMAGE_SIZE` | — | — | — | — |
