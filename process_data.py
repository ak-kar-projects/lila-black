"""
LILA BLACK — Player Journey Data Preprocessor
==============================================
Run this script once to convert all parquet files into data.js,
which the visualization tool (index.html) reads directly.

Setup:
    pip install pyarrow pandas

Usage:
    python process_data.py

    By default, looks for player_data/ folder in the same directory.
    Override with: python process_data.py --data ./path/to/player_data

Output:
    data.js  (place this next to index.html)
"""

import os
import sys
import json
import math
import argparse
import re
from collections import defaultdict

try:
    import pyarrow as pa
    import pyarrow.parquet as pq
    import pandas as pd
except ImportError:
    print("\n❌  Missing dependencies. Please run:")
    print("       pip install pyarrow pandas\n")
    sys.exit(1)

# ─── Map Configuration ────────────────────────────────────────────────────────

MAP_CONFIGS = {
    "AmbroseValley": {"scale": 900,  "origin_x": -370, "origin_z": -473},
    "GrandRift":     {"scale": 581,  "origin_x": -290, "origin_z": -290},
    "Lockdown":      {"scale": 1000, "origin_x": -500, "origin_z": -500},
}

IMAGE_SIZE = 1024  # all minimaps are 1024x1024

def world_to_pixel(x, z, map_id):
    cfg = MAP_CONFIGS.get(map_id)
    if not cfg:
        return None, None
    u = (x - cfg["origin_x"]) / cfg["scale"]
    v = (z - cfg["origin_z"]) / cfg["scale"]
    px = u * IMAGE_SIZE
    py = (1 - v) * IMAGE_SIZE
    return round(px, 1), round(py, 1)

# ─── Event Classification ─────────────────────────────────────────────────────

POSITION_EVENTS    = {"Position", "BotPosition"}
KILL_EVENTS        = {"Kill", "BotKill"}
DEATH_EVENTS       = {"Killed", "BotKilled"}
STORM_EVENTS       = {"KilledByStorm"}
LOOT_EVENTS        = {"Loot"}
ALL_COMBAT_EVENTS  = KILL_EVENTS | DEATH_EVENTS | STORM_EVENTS | LOOT_EVENTS

DATE_FOLDERS = ["February_10", "February_11", "February_12", "February_13", "February_14"]

def is_human(user_id):
    """UUID user_ids = human players. Short numeric ids = bots."""
    uid = str(user_id)
    return bool(re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-', uid, re.IGNORECASE))

# ─── Heatmap Grid ─────────────────────────────────────────────────────────────

GRID_SIZE = 48  # 48×48 cells per map

def pixel_to_cell(px, py):
    col = min(int(px / IMAGE_SIZE * GRID_SIZE), GRID_SIZE - 1)
    row = min(int(py / IMAGE_SIZE * GRID_SIZE), GRID_SIZE - 1)
    return max(0, col), max(0, row)

def make_grid():
    return [[0] * GRID_SIZE for _ in range(GRID_SIZE)]

# ─── Main Processing ──────────────────────────────────────────────────────────

def process(data_root):
    print(f"\n🎮  LILA BLACK — Data Preprocessor")
    print(f"📁  Scanning: {os.path.abspath(data_root)}\n")

    # Aggregated output structures
    matches_index   = {}   # match_id → {map, date, players, bots, duration_ms, event_counts}
    event_markers   = []   # list of {match_id, map, date, player_type, event, px, py, ts}
    
    # Heatmaps: map_id → layer → grid
    heatmaps = {m: {
        "traffic_human": make_grid(),
        "traffic_bot":   make_grid(),
        "kills":         make_grid(),
        "deaths":        make_grid(),
        "storm":         make_grid(),
        "loot":          make_grid(),
    } for m in MAP_CONFIGS}

    # Tracks: match_id → player_id → [{px, py, ts}]  (sampled)
    tracks = defaultdict(lambda: defaultdict(list))

    total_files = 0
    skipped     = 0
    TRACK_SAMPLE_RATE = 4  # keep every Nth position event

    for date_folder in DATE_FOLDERS:
        folder_path = os.path.join(data_root, date_folder)
        if not os.path.isdir(folder_path):
            print(f"  ⚠️  Folder not found, skipping: {date_folder}")
            continue

        files = os.listdir(folder_path)
        print(f"  📅  {date_folder}: {len(files)} files")

        for fname in files:
            fpath = os.path.join(folder_path, fname)
            total_files += 1

            try:
                table = pq.read_table(fpath)
                df    = table.to_pandas()
            except Exception as e:
                skipped += 1
                continue

            if df.empty:
                skipped += 1
                continue

            # Decode event bytes
            df['event'] = df['event'].apply(
                lambda x: x.decode('utf-8') if isinstance(x, bytes) else str(x)
            )

            # The column is typed timestamp[ms] but the stored int64 values
            # are Unix timestamps in SECONDS (~1.77e9 = Feb 2026).
            # pyarrow cast(int64) gives the raw stored seconds directly.
            # Multiply by 1000 to work in milliseconds for the JS timeline.
            raw_sec = table.column('ts').cast(pa.int64()).to_pylist()
            df['ts'] = [int(v * 1000) if v is not None else 0 for v in raw_sec]

            # Basic metadata from first row
            row0    = df.iloc[0]
            user_id = str(row0['user_id'])
            match_id_full = str(row0['match_id'])
            # strip .nakama-0 suffix for cleaner keys
            match_id = match_id_full.replace('.nakama-0', '')
            map_id   = str(row0['map_id'])
            human    = is_human(user_id)
            player_type = "human" if human else "bot"

            if map_id not in MAP_CONFIGS:
                skipped += 1
                continue

            # ── Update match index ─────────────────────────────────────────
            if match_id not in matches_index:
                matches_index[match_id] = {
                    "match_id":   match_id,
                    "map":        map_id,
                    "date":       date_folder.replace("_", " "),
                    "humans":     0,
                    "bots":       0,
                    "duration_ms": 0,
                    "event_counts": defaultdict(int),
                }

            mi = matches_index[match_id]
            if human:
                mi["humans"] += 1
            else:
                mi["bots"]   += 1

            # Update duration (max - min of absolute ms timestamps)
            if len(df) > 1:
                dur = int(df['ts'].max() - df['ts'].min())
                if dur > mi["duration_ms"]:
                    mi["duration_ms"] = dur

            for ev in df['event']:
                mi["event_counts"][ev] += 1

            # ── Process rows ───────────────────────────────────────────────
            pos_counter = 0
            for _, row in df.iterrows():
                event = row['event']
                x     = float(row['x'])
                z     = float(row['z'])
                ts    = int(row['ts'])

                px, py = world_to_pixel(x, z, map_id)
                if px is None:
                    continue

                # Clamp to image bounds
                px = max(0, min(IMAGE_SIZE - 1, px))
                py = max(0, min(IMAGE_SIZE - 1, py))

                col, row_idx = pixel_to_cell(px, py)

                # ── Position / movement ─────────────────────────────────
                if event in POSITION_EVENTS:
                    layer = "traffic_human" if human else "traffic_bot"
                    heatmaps[map_id][layer][row_idx][col] += 1

                    # Sampled tracks for timeline playback
                    pos_counter += 1
                    if pos_counter % TRACK_SAMPLE_RATE == 0:
                        tracks[match_id][user_id].append({
                            "px": round(px, 1),
                            "py": round(py, 1),
                            "ts": ts,
                        })

                # ── Combat / loot events ────────────────────────────────
                else:
                    if event in KILL_EVENTS:
                        heatmaps[map_id]["kills"][row_idx][col] += 1
                    elif event in DEATH_EVENTS:
                        heatmaps[map_id]["deaths"][row_idx][col] += 1
                    elif event in STORM_EVENTS:
                        heatmaps[map_id]["storm"][row_idx][col] += 1
                    elif event in LOOT_EVENTS:
                        heatmaps[map_id]["loot"][row_idx][col] += 1

                    event_markers.append({
                        "match_id":    match_id,
                        "map":         map_id,
                        "date":        date_folder.replace("_", " "),
                        "player_type": player_type,
                        "event":       event,
                        "px":          round(px, 1),
                        "py":          round(py, 1),
                        "ts":          ts,
                    })

    print(f"\n  ✅  Processed {total_files - skipped} / {total_files} files")
    print(f"  📍  Event markers: {len(event_markers):,}")
    print(f"  🎯  Unique matches: {len(matches_index):,}")

    # ── Normalize heatmaps to 0-1 range ───────────────────────────────────────
    for map_id, layers in heatmaps.items():
        for layer, grid in layers.items():
            flat   = [v for row in grid for v in row]
            maxval = max(flat) if flat else 1
            if maxval == 0:
                maxval = 1
            heatmaps[map_id][layer] = [
                [round(v / maxval, 4) for v in row]
                for row in grid
            ]

    # ── Convert tracks to sorted lists ────────────────────────────────────────
    tracks_out = {}
    for match_id, players in tracks.items():
        tracks_out[match_id] = {}
        for uid, pts in players.items():
            pts.sort(key=lambda p: p['ts'])
            tracks_out[match_id][uid] = pts

    # ── Finalize matches index ─────────────────────────────────────────────────
    matches_final = []
    for mid, mi in matches_index.items():
        ec = dict(mi["event_counts"])
        matches_final.append({
            "match_id":    mi["match_id"],
            "map":         mi["map"],
            "date":        mi["date"],
            "humans":      mi["humans"],
            "bots":        mi["bots"],
            "duration_ms": mi["duration_ms"],
            "kills":       ec.get("Kill", 0) + ec.get("BotKill", 0),
            "deaths":      ec.get("Killed", 0) + ec.get("BotKilled", 0),
            "storm_deaths":ec.get("KilledByStorm", 0),
            "loots":       ec.get("Loot", 0),
        })
    matches_final.sort(key=lambda m: (m["date"], m["match_id"]))

    # ── Write output ───────────────────────────────────────────────────────────
    output = {
        "meta": {
            "generated_at": str(pd.Timestamp.now()),
            "total_matches": len(matches_final),
            "total_markers": len(event_markers),
            "grid_size": GRID_SIZE,
            "image_size": IMAGE_SIZE,
            "map_configs": MAP_CONFIGS,
        },
        "matches":  matches_final,
        "markers":  event_markers,
        "heatmaps": heatmaps,
        "tracks":   tracks_out,
    }

    out_path = "data.js"
    print(f"\n💾  Writing {out_path}...")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("// Auto-generated by process_data.py — do not edit manually\n")
        f.write("window.LILA_DATA = ")
        json.dump(output, f, separators=(',', ':'))
        f.write(";\n")

    size_mb = os.path.getsize(out_path) / 1_000_000
    print(f"✅  Done! data.js written ({size_mb:.1f} MB)")
    print(f"\n📌  Next step: open index.html in your browser\n")


# ─── Entry Point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LILA BLACK data preprocessor")
    parser.add_argument("--data", default="player_data",
                        help="Path to the player_data folder (default: ./player_data)")
    args = parser.parse_args()

    if not os.path.isdir(args.data):
        print(f"\n❌  Folder not found: {args.data}")
        print(f"    Run from the same directory as player_data/, or use --data /path/to/player_data\n")
        sys.exit(1)

    process(args.data)
