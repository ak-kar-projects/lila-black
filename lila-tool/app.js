// =============================================================================
// LILA BLACK — Visualization Engine  (app.js)
// Sections: Constants · State · Canvas · Boot · UI · Filters · Render ·
//           Heatmap · Markers · Tracks · Timeline · Tooltip · Events
// =============================================================================

// ── Constants ─────────────────────────────────────────────────────────────────
// LILA BLACK — Visualization Engine
// ═══════════════════════════════════════════════════════════════════════════

const MAP_IMAGES = {
  AmbroseValley: 'AmbroseValley_Minimap.png',
  GrandRift:     'GrandRift_Minimap.png',
  Lockdown:      'Lockdown_Minimap.jpg',
};

const MAP_COLORS = {
  AmbroseValley: '#3b82f6',
  GrandRift:     '#f59e0b',
  Lockdown:      '#a855f7',
};

const EVENT_COLORS = {
  Kill:         '#ef4444',
  BotKill:      '#f87171',
  Killed:       '#fb923c',
  BotKilled:    '#fbbf24',
  KilledByStorm:'#a855f7',
  Loot:         '#22d3ee',
};

const HEATMAP_COLORS = {
  traffic_human: [[59,130,246],  [99,179,237], [191,219,254]],
  traffic_bot:   [[16,185,129],  [52,211,153], [167,243,208]],
  kills:         [[239,68,68],   [252,165,165],[254,226,226]],
  deaths:        [[249,115,22],  [253,186,116],[255,237,213]],
  storm:         [[168,85,247],  [216,180,254],[243,232,255]],
  loot:          [[34,211,238],  [103,232,249],[207,250,254]],
};

// ── State ─────────────────────────────────────────────────────────────────
let DATA        = null;
let currentMap  = 'AmbroseValley';
let currentMatch= 'all';
let currentDate = 'all';
let hmLayer     = 'none';
let hmOpacity   = 0.65;
let showKill    = true, showDeath = true, showStorm = true, showLoot = true;
let showHuman   = true, showBot   = true;

// Timeline state
let tlActive    = false;
let tlPlaying   = false;
let tlProgress  = 0;   // 0-1
let tlMatchData = null; // {minTs, maxTs, markers, tracks}
let tlAnimId    = null;
let tlSpeed     = 1;
let tlLastTime  = 0;
let SPEEDS      = [0.5, 1, 2, 5];

// Canvas
let cvSize      = 700;
const GRID      = 1024;

// ── Canvas elements ────────────────────────────────────────────────────────
const mapImg      = document.getElementById('map-img');
const cvHeatmap   = document.getElementById('cv-heatmap');
const cvMarkers   = document.getElementById('cv-markers');
const cvTracks    = document.getElementById('cv-tracks');
const cvInteract  = document.getElementById('cv-interact');
const ctxHeatmap  = cvHeatmap.getContext('2d');
const ctxMarkers  = cvMarkers.getContext('2d');
const ctxTracks   = cvTracks.getContext('2d');

// ── Boot ───────────────────────────────────────────────────────────────────
function init() {
  if (!window.LILA_DATA) {
    document.getElementById('no-data-banner').style.display = 'block';
    showDemo();
    return;
  }
  DATA = window.LILA_DATA;
  populateUI();
  sizeCanvases();
  setMap('AmbroseValley');
  bindEvents();
}

function showDemo() {
  document.getElementById('stat-matches').textContent = 'NO DATA';
  document.getElementById('stat-players').textContent = 'Run process_data.py';
}

// ── Populate UI from data ──────────────────────────────────────────────────
function populateUI() {
  const m = DATA.matches;

  // Top stats
  const totalHumans = m.reduce((s,x) => s + x.humans, 0);
  const totalKills  = m.reduce((s,x) => s + x.kills, 0);
  document.getElementById('stat-matches').textContent = DATA.meta.total_matches.toLocaleString();
  document.getElementById('stat-players').textContent = totalHumans.toLocaleString();
  document.getElementById('stat-kills').textContent   = totalKills.toLocaleString();
  document.getElementById('stat-events').textContent  = DATA.meta.total_markers.toLocaleString();

  // Map counts
  ['AmbroseValley','GrandRift','Lockdown'].forEach(map => {
    const cnt = m.filter(x => x.map === map).length;
    document.getElementById('mc-' + map).textContent = cnt;
  });

  rebuildMatchDropdown();
  updateEventCounts();
}

function rebuildMatchDropdown() {
  const sel = document.getElementById('filter-match');
  const prev = sel.value;
  sel.innerHTML = '<option value="all">All matches (aggregated)</option>';
  
  let filtered = DATA.matches.filter(m =>
    m.map === currentMap &&
    (currentDate === 'all' || m.date === currentDate)
  );

  // Sort: mixed matches (humans + bots) first, then by date
  filtered.sort((a, b) => {
    const aMixed = a.humans > 0 && a.bots > 0 ? 0 : 1;
    const bMixed = b.humans > 0 && b.bots > 0 ? 0 : 1;
    if (aMixed !== bMixed) return aMixed - bMixed;
    return a.date.localeCompare(b.date);
  });

  // Group header for mixed matches
  const mixedCount = filtered.filter(m => m.humans > 0 && m.bots > 0).length;
  if (mixedCount > 0) {
    const grp1 = document.createElement('optgroup');
    grp1.label = `★ Rich matches (humans + bots) — ${mixedCount}`;
    filtered.filter(m => m.humans > 0 && m.bots > 0).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.match_id;
      const dur = formatDuration(m.duration_ms);
      opt.textContent = `${m.date} · ${m.humans}H ${m.bots}B · ${dur}`;
      grp1.appendChild(opt);
    });
    sel.appendChild(grp1);

    const grp2 = document.createElement('optgroup');
    grp2.label = `Human-only matches — ${filtered.length - mixedCount}`;
    filtered.filter(m => !(m.humans > 0 && m.bots > 0)).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.match_id;
      const dur = formatDuration(m.duration_ms);
      opt.textContent = `${m.date} · ${m.humans}H · ${dur}`;
      grp2.appendChild(opt);
    });
    sel.appendChild(grp2);
  } else {
    filtered.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.match_id;
      const dur = formatDuration(m.duration_ms);
      opt.textContent = `${m.date} · ${m.humans}H ${m.bots}B · ${dur}`;
      sel.appendChild(opt);
    });
  }

  // Restore selection if still valid
  if (prev !== 'all' && filtered.find(m => m.match_id === prev)) {
    sel.value = prev;
  } else {
    sel.value = 'all';
    currentMatch = 'all';
  }
}

function formatDuration(ms) {
  if (!ms) return '?';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}

function updateEventCounts() {
  const markers = filteredMarkers();
  const kills  = markers.filter(m => m.event==='Kill'||m.event==='BotKill').length;
  const deaths = markers.filter(m => m.event==='Killed'||m.event==='BotKilled').length;
  const storm  = markers.filter(m => m.event==='KilledByStorm').length;
  const loot   = markers.filter(m => m.event==='Loot').length;
  document.getElementById('cnt-kill').textContent  = kills.toLocaleString();
  document.getElementById('cnt-death').textContent = deaths.toLocaleString();
  document.getElementById('cnt-storm').textContent = storm.toLocaleString();
  document.getElementById('cnt-loot').textContent  = loot.toLocaleString();
}

// ── Filtering ──────────────────────────────────────────────────────────────
function filteredMarkers() {
  if (!DATA) return [];
  return DATA.markers.filter(m => {
    if (m.map !== currentMap) return false;
    if (currentDate !== 'all' && m.date !== currentDate) return false;
    if (currentMatch !== 'all' && m.match_id !== currentMatch) return false;
    if (!showHuman && m.player_type === 'human') return false;
    if (!showBot   && m.player_type === 'bot')   return false;
    const ev = m.event;
    if (!showKill  && (ev==='Kill'||ev==='BotKill'))   return false;
    if (!showDeath && (ev==='Killed'||ev==='BotKilled')) return false;
    if (!showStorm && ev==='KilledByStorm') return false;
    if (!showLoot  && ev==='Loot') return false;
    return true;
  });
}

// ── Canvas sizing ──────────────────────────────────────────────────────────
function sizeCanvases() {
  const wrap = document.getElementById('canvas-wrap');
  const w    = wrap.clientWidth  - 24;
  const h    = wrap.clientHeight - 24;
  cvSize     = Math.min(w, h, 900);
  
  const container = document.getElementById('canvas-container');
  container.style.width  = cvSize + 'px';
  container.style.height = cvSize + 'px';

  [cvHeatmap, cvMarkers, cvTracks, cvInteract].forEach(cv => {
    cv.width  = cvSize;
    cv.height = cvSize;
    cv.style.width  = cvSize + 'px';
    cv.style.height = cvSize + 'px';
  });
}

// ── Map switching ──────────────────────────────────────────────────────────
function setMap(map) {
  currentMap   = map;
  currentMatch = 'all';
  document.getElementById('filter-match').value = 'all';

  document.querySelectorAll('.map-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.map === map);
  });

  mapImg.src = MAP_IMAGES[map];
  mapImg.onload = () => renderAll();
  if (mapImg.complete) renderAll();

  rebuildMatchDropdown();
  hideTl();
}

// ── Render pipeline ────────────────────────────────────────────────────────
function renderAll() {
  renderHeatmap();
  renderMarkers();
  if (tlActive) renderTracks(tlProgress);
  else clearTracks();
  updateEventCounts();
}

// ── Heatmap ────────────────────────────────────────────────────────────────
function renderHeatmap() {
  ctxHeatmap.clearRect(0, 0, cvSize, cvSize);
  if (hmLayer === 'none' || !DATA) return;

  const grid = DATA.heatmaps[currentMap]?.[hmLayer];
  if (!grid) return;

  const GRID_N  = DATA.meta.grid_size;
  const cellSz  = cvSize / GRID_N;
  const colors  = HEATMAP_COLORS[hmLayer] || [[255,255,255]];

  // Draw grid cells
  const offCanvas = document.createElement('canvas');
  offCanvas.width  = cvSize;
  offCanvas.height = cvSize;
  const offCtx = offCanvas.getContext('2d');

  for (let r = 0; r < GRID_N; r++) {
    for (let c = 0; c < GRID_N; c++) {
      const v = grid[r][c];
      if (v < 0.01) continue;

      // Color interpolation
      let [R,G,B] = interpColor(colors, v);
      offCtx.fillStyle = `rgba(${R},${G},${B},${v * 0.9})`;
      offCtx.fillRect(c * cellSz, r * cellSz, cellSz + 0.5, cellSz + 0.5);
    }
  }

  // Apply blur for smooth heatmap look
  ctxHeatmap.filter = `blur(${Math.round(cellSz * 0.8)}px)`;
  ctxHeatmap.globalAlpha = hmOpacity;
  ctxHeatmap.drawImage(offCanvas, 0, 0);
  ctxHeatmap.filter = 'none';
  ctxHeatmap.globalAlpha = 1;
}

function interpColor(stops, t) {
  if (stops.length === 1) return stops[0];
  const seg = 1 / (stops.length - 1);
  const i   = Math.min(Math.floor(t / seg), stops.length - 2);
  const lt  = (t - i * seg) / seg;
  const a   = stops[i], b = stops[i+1];
  return [
    Math.round(a[0] + (b[0]-a[0]) * lt),
    Math.round(a[1] + (b[1]-a[1]) * lt),
    Math.round(a[2] + (b[2]-a[2]) * lt),
  ];
}

// ── Markers ────────────────────────────────────────────────────────────────
let markerCache = [];

function renderMarkers() {
  ctxMarkers.clearRect(0, 0, cvSize, cvSize);
  if (!DATA) return;

  markerCache = filteredMarkers();
  const scale = cvSize / GRID;

  markerCache.forEach(m => {
    const x = m.px * scale;
    const y = m.py * scale;
    const color = EVENT_COLORS[m.event] || '#fff';
    const isBot = m.player_type === 'bot';

    ctxMarkers.save();

    if (m.event === 'Loot') {
      // Diamond
      const s = isBot ? 3.5 : 4.5;
      ctxMarkers.translate(x, y);
      ctxMarkers.rotate(Math.PI/4);
      ctxMarkers.fillStyle = color;
      ctxMarkers.globalAlpha = isBot ? 0.55 : 0.8;
      ctxMarkers.fillRect(-s/2, -s/2, s, s);
    } else {
      // Circle
      const r = isBot ? 3 : 4.5;
      ctxMarkers.beginPath();
      ctxMarkers.arc(x, y, r, 0, Math.PI*2);
      ctxMarkers.fillStyle = color;
      ctxMarkers.globalAlpha = isBot ? 0.5 : 0.85;
      ctxMarkers.fill();

      // Glow ring for human events
      if (!isBot && (m.event === 'Kill' || m.event === 'KilledByStorm')) {
        ctxMarkers.beginPath();
        ctxMarkers.arc(x, y, r + 2, 0, Math.PI*2);
        ctxMarkers.strokeStyle = color;
        ctxMarkers.lineWidth = 1;
        ctxMarkers.globalAlpha = 0.3;
        ctxMarkers.stroke();
      }
    }
    ctxMarkers.restore();
  });
}

// ── Tracks ─────────────────────────────────────────────────────────────────
function clearTracks() {
  ctxTracks.clearRect(0, 0, cvSize, cvSize);
}

function renderTracks(progress) {
  ctxTracks.clearRect(0, 0, cvSize, cvSize);
  if (!tlMatchData || !DATA) return;

  const { minTs, maxTs, tracks } = tlMatchData;
  const tsAt = minTs + (maxTs - minTs) * progress;
  const scale = cvSize / GRID;

  Object.entries(tracks).forEach(([uid, pts]) => {
    if (!pts || pts.length === 0) return;

    // Determine if human or bot
    const isHuman = /^[0-9a-f]{8}-/i.test(uid);
    if (!showHuman && isHuman) return;
    if (!showBot   && !isHuman) return;

    const color = isHuman ? '59,130,246' : '16,185,129';

    // Points up to current time
    const visible = pts.filter(p => p.ts <= tsAt);
    if (visible.length < 2) {
      // Draw just a dot if at start
      if (visible.length === 1) {
        const p = visible[0];
        ctxTracks.beginPath();
        ctxTracks.arc(p.px * scale, p.py * scale, 4, 0, Math.PI*2);
        ctxTracks.fillStyle = `rgba(${color},0.8)`;
        ctxTracks.fill();
      }
      return;
    }

    // Draw trail (fade older parts)
    const maxTrail = Math.min(visible.length, 60);
    const trail    = visible.slice(-maxTrail);

    for (let i = 1; i < trail.length; i++) {
      const a    = trail[i-1];
      const b    = trail[i];
      const fade = i / trail.length;
      ctxTracks.beginPath();
      ctxTracks.moveTo(a.px * scale, a.py * scale);
      ctxTracks.lineTo(b.px * scale, b.py * scale);
      ctxTracks.strokeStyle = `rgba(${color},${fade * 0.6})`;
      ctxTracks.lineWidth = isHuman ? 1.5 : 1;
      ctxTracks.stroke();
    }

    // Current head dot
    const head = trail[trail.length - 1];
    ctxTracks.beginPath();
    ctxTracks.arc(head.px * scale, head.py * scale, isHuman ? 5 : 3.5, 0, Math.PI*2);
    ctxTracks.fillStyle = `rgba(${color},1)`;
    ctxTracks.fill();
    ctxTracks.strokeStyle = '#fff';
    ctxTracks.lineWidth = 1;
    ctxTracks.stroke();
  });
}

// ── Timeline ───────────────────────────────────────────────────────────────
function activateTl(matchId) {
  if (!DATA || !DATA.tracks[matchId]) { hideTl(); return; }

  const tracks = DATA.tracks[matchId];
  let minTs = Infinity, maxTs = -Infinity;

  // Find global min/max across ALL players in the match
  // (tracks store absolute ms since epoch — normalize here so all players align)
  Object.values(tracks).forEach(pts => {
    pts.forEach(p => {
      if (typeof p.ts === 'number' && isFinite(p.ts)) {
        minTs = Math.min(minTs, p.ts);
        maxTs = Math.max(maxTs, p.ts);
      }
    });
  });

  if (!isFinite(minTs) || !isFinite(maxTs) || maxTs <= minTs) {
    console.warn('Timeline: could not determine valid time range for', matchId);
    hideTl(); return;
  }

  tlMatchData = { minTs, maxTs, tracks };
  tlActive    = true;
  tlProgress  = 0;
  tlPlaying   = false;

  document.getElementById('timeline').classList.add('visible');
  document.getElementById('tl-scrubber').value = 0;
  updateTlTime(0);

  const humanCount = Object.keys(tracks).filter(u => /^[0-9a-f]{8}-/i.test(u)).length;
  const botCount   = Object.keys(tracks).length - humanCount;
  document.getElementById('tl-players').textContent =
    `${humanCount} human${humanCount!==1?'s':''} · ${botCount} bot${botCount!==1?'s':''} in this match`;

  renderTracks(0);
}

function hideTl() {
  tlActive  = false;
  tlPlaying = false;
  if (tlAnimId) { cancelAnimationFrame(tlAnimId); tlAnimId = null; }
  document.getElementById('timeline').classList.remove('visible');
  document.getElementById('tl-icon-play').style.display   = '';
  document.getElementById('tl-icon-pause').style.display  = 'none';
  clearTracks();
}

function updateTlTime(progress) {
  if (!tlMatchData) return;
  const elapsed = (tlMatchData.maxTs - tlMatchData.minTs) * progress;
  const secs    = Math.floor(elapsed / 1000);
  document.getElementById('tl-time').textContent = `${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`;
}

function tlTick(now) {
  if (!tlPlaying) return;
  const dt = now - tlLastTime;
  tlLastTime = now;

  const dur = tlMatchData.maxTs - tlMatchData.minTs;
  tlProgress = Math.min(1, tlProgress + (dt * tlSpeed) / dur);

  document.getElementById('tl-scrubber').value = Math.round(tlProgress * 1000);
  updateTlTime(tlProgress);
  renderTracks(tlProgress);

  if (tlProgress >= 1) {
    tlPlaying = false;
    document.getElementById('tl-icon-play').style.display  = '';
    document.getElementById('tl-icon-pause').style.display = 'none';
    return;
  }
  tlAnimId = requestAnimationFrame(tlTick);
}

// ── Tooltip ────────────────────────────────────────────────────────────────
function findNearestMarker(mouseX, mouseY) {
  const scale  = cvSize / GRID;
  const canvas = cvInteract.getBoundingClientRect();
  const cx = (mouseX - canvas.left) / scale;
  const cy = (mouseY - canvas.top)  / scale;
  const RADIUS_SQ = (12 / scale) ** 2;

  let best = null, bestDist = Infinity;
  markerCache.forEach(m => {
    const dx = m.px - cx, dy = m.py - cy;
    const d  = dx*dx + dy*dy;
    if (d < RADIUS_SQ && d < bestDist) { bestDist = d; best = m; }
  });
  return best;
}

// ── Match info panel ────────────────────────────────────────────────────────
function showMatchInfo(matchId) {
  if (!DATA || matchId === 'all') {
    document.getElementById('match-info').style.display = 'none';
    return;
  }
  const m = DATA.matches.find(x => x.match_id === matchId);
  if (!m) return;
  document.getElementById('match-info').style.display = 'block';
  document.getElementById('mi-id').textContent    = matchId.slice(0,8) + '…';
  document.getElementById('mi-humans').textContent = m.humans;
  document.getElementById('mi-bots').textContent   = m.bots;
  document.getElementById('mi-dur').textContent    = formatDuration(m.duration_ms);
  document.getElementById('mi-kills').textContent  = m.kills;
  document.getElementById('mi-storm').textContent  = m.storm_deaths;
}

// ── Event Bindings ─────────────────────────────────────────────────────────
function bindEvents() {

  // Map tabs
  document.querySelectorAll('.map-tab').forEach(t => {
    t.addEventListener('click', () => { setMap(t.dataset.map); });
  });

  // Date filter
  document.getElementById('filter-date').addEventListener('change', e => {
    currentDate  = e.target.value;
    currentMatch = 'all';
    rebuildMatchDropdown();
    renderAll();
  });

  // Match filter
  document.getElementById('filter-match').addEventListener('change', e => {
    currentMatch = e.target.value;
    showMatchInfo(currentMatch);
    if (currentMatch !== 'all') activateTl(currentMatch);
    else hideTl();
    renderAll();
  });

  // Event toggles
  document.getElementById('tog-kill').addEventListener('change',  e => { showKill  = e.target.checked; renderAll(); });
  document.getElementById('tog-death').addEventListener('change', e => { showDeath = e.target.checked; renderAll(); });
  document.getElementById('tog-storm').addEventListener('change', e => { showStorm = e.target.checked; renderAll(); });
  document.getElementById('tog-loot').addEventListener('change',  e => { showLoot  = e.target.checked; renderAll(); });
  document.getElementById('tog-human').addEventListener('change', e => { showHuman = e.target.checked; renderAll(); });
  document.getElementById('tog-bot').addEventListener('change',   e => { showBot   = e.target.checked; renderAll(); });

  // Heatmap layer
  document.querySelectorAll('.hm-btn, .hm-none-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.hm-btn, .hm-none-btn').forEach(b => {
        b.classList.remove('active');
        if (b.classList.contains('hm-btn')) b.style.borderColor = 'transparent';
      });
      btn.classList.add('active');
      if (btn.classList.contains('hm-btn')) btn.style.borderColor = '';
      hmLayer = btn.dataset.hm;
      renderHeatmap();
    });
  });

  // Heatmap opacity
  const opSlider = document.getElementById('hm-opacity');
  opSlider.addEventListener('input', e => {
    hmOpacity = e.target.value / 100;
    document.getElementById('hm-opacity-val').textContent = e.target.value + '%';
    renderHeatmap();
  });

  // Timeline play/pause
  document.getElementById('tl-play').addEventListener('click', () => {
    if (!tlActive) return;
    tlPlaying = !tlPlaying;
    document.getElementById('tl-icon-play').style.display  = tlPlaying ? 'none' : '';
    document.getElementById('tl-icon-pause').style.display = tlPlaying ? ''     : 'none';
    if (tlPlaying) {
      if (tlProgress >= 1) { tlProgress = 0; }
      tlLastTime = performance.now();
      tlAnimId   = requestAnimationFrame(tlTick);
    }
  });

  // Timeline scrubber
  document.getElementById('tl-scrubber').addEventListener('input', e => {
    tlProgress = e.target.value / 1000;
    updateTlTime(tlProgress);
    renderTracks(tlProgress);
  });

  // Speed toggle
  document.getElementById('tl-speed').addEventListener('click', () => {
    const i   = SPEEDS.indexOf(tlSpeed);
    tlSpeed   = SPEEDS[(i + 1) % SPEEDS.length];
    document.getElementById('tl-speed').textContent = tlSpeed + '×';
  });

  // Hover tooltip
  cvInteract.addEventListener('mousemove', e => {
    const tt = document.getElementById('tooltip');
    const m  = findNearestMarker(e.clientX, e.clientY);
    if (!m) { tt.style.display = 'none'; return; }

    const elapsed = m.ts ? Math.floor(m.ts / 1000) : null;
    const timeStr = elapsed !== null
      ? `${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`
      : '—';

    tt.innerHTML = `
      <div class="tt-event" style="color:${EVENT_COLORS[m.event]||'#fff'}">${m.event}</div>
      <div class="tt-row"><span class="tt-lbl">Player:</span> ${m.player_type}</div>
      <div class="tt-row"><span class="tt-lbl">Match time:</span> ${timeStr}</div>
      <div class="tt-row"><span class="tt-lbl">Date:</span> ${m.date}</div>
    `;
    tt.style.display = 'block';
    tt.style.left    = (e.clientX + 12) + 'px';
    tt.style.top     = (e.clientY - 10) + 'px';

    // Keep tooltip in viewport
    const rect = tt.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8)  tt.style.left = (e.clientX - rect.width - 12) + 'px';
    if (rect.bottom > window.innerHeight - 8) tt.style.top = (e.clientY - rect.height + 10) + 'px';
  });

  cvInteract.addEventListener('mouseleave', () => {
    document.getElementById('tooltip').style.display = 'none';
  });

  // Resize
  window.addEventListener('resize', () => {
    sizeCanvases();
    renderAll();
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);
