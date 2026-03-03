// =============================================================================
// LILA BLACK — Map Analysis Engine  (analytics.js)
// Sections: Config · Data computation · Metrics table · Minimap canvases ·
//           Zone bars · Hover tooltip · Tab switching
// =============================================================================

(function() {
  var TIPS = {
    'Matches in dataset':            'Total matches recorded on this map across Feb 10–14.',
    'Avg humans per match':          'Average number of human players per match. Low = mostly bot-only matches.',
    'Solo-match rate':               '% of matches with only 1 human player. High solo rate limits PvP.',
    'Map zones used':                '% of the 48×48 grid cells with at least one human position event.',
    'Unvisited zones':               '% of grid cells with zero human traffic — dead space on the map.',
    '80% of traffic in (% of map)':  'How many cells account for 80% of all human movement. Lower = more concentrated.',
    'Top 5 zones carry':             '% of all human movement in just the top 5 busiest grid cells.',
    'Human/bot zone overlap':        'Jaccard overlap: zones visited by humans vs bots. Low = bots are in wrong areas.',
    'Top 3 zones kill share':        '% of all kills in just the top 3 kill zones. High = fights are clustered.',
    'PvP kills':                     'Human-vs-human kill events only. Near-zero means almost no player combat.',
    'Storm deaths':                  'Players eliminated by storm. Indicates whether storm pressure is working.',
    'Loot/kill zone overlap (top 5)':'How many top-5 loot zones are also top-5 kill zones. High = looting is dangerous.',
    'Safe loot zones (no kills)':    'Of top 20 loot zones, how many had zero kills — safe areas to loot.'
  };

  var MAPS     = ['AmbroseValley','GrandRift','Lockdown'];
  var MAP_IMGS = { AmbroseValley:'AmbroseValley_Minimap.png', GrandRift:'GrandRift_Minimap.png', Lockdown:'Lockdown_Minimap.jpg' };
  var MAP_CLS  = { AmbroseValley:'av', GrandRift:'gr', Lockdown:'lk' };
  var MAP_COL  = { AmbroseValley:[59,130,246], GrandRift:[245,158,11], Lockdown:[168,85,247] };
  var MAP_NAMES= { AmbroseValley:'AMBROSE VALLEY', GrandRift:'GRAND RIFT', Lockdown:'LOCKDOWN' };
  var CV_IDS   = { AmbroseValley:'ma-cv-av', GrandRift:'ma-cv-gr', Lockdown:'ma-cv-lk' };
  var WRAP_IDS = { AmbroseValley:'ma-wrap-av', GrandRift:'ma-wrap-gr', Lockdown:'ma-wrap-lk' };
  var HOVER_IDS= { AmbroseValley:'ma-hover-av', GrandRift:'ma-hover-gr', Lockdown:'ma-hover-lk' };

  var activeMetric = 'overlap';
  var mapData = {};
  var loadedImgs = {};
  var N = 48;

  function showAnalyticsError(msg) {
    var tbody = document.getElementById('ma-tbody');
    var zones = document.getElementById('ma-zones-content');
    var errHtml = '<tr><td colspan="4" style="padding:16px;color:#ef4444;font-family:monospace">⚠ ' + msg + '</td></tr>';
    if (tbody) tbody.innerHTML = errHtml;
    if (zones) zones.innerHTML = '<div style="color:#ef4444;font-size:12px;padding:8px">⚠ ' + msg + '</div>';
  }

  function build() {
    if (!window.LILA_DATA) { setTimeout(build, 300); return; }
    var D = window.LILA_DATA;

    // Validate expected data shape before touching it
    if (!D.meta || !D.heatmaps || !D.matches || !D.markers) {
      showAnalyticsError('data.js is missing expected fields (meta / heatmaps / matches / markers).');
      return;
    }

    N = D.meta.grid_size;

    try {

    // ── compute per-map data ──
    MAPS.forEach(function(id) {
      var hm = D.heatmaps[id];
      var ms = D.matches.filter(function(m){ return m.map===id; });
      if (!hm || !ms.length) { mapData[id] = null; return; }

      var fH=[].concat.apply([],hm.traffic_human);
      var fB=[].concat.apply([],hm.traffic_bot);
      var fK=[].concat.apply([],hm.kills);
      var fL=[].concat.apply([],hm.loot);
      var T=N*N;

      var used=fH.filter(function(v){return v>0;}).length;
      var unv =fH.filter(function(v){return v===0;}).length;
      var sH  =fH.slice().sort(function(a,b){return b-a;});
      var tot =sH.reduce(function(a,b){return a+b;},0)||1;
      var c=0,c80=0; for(var i=0;i<sH.length;i++){c+=sH[i];c80++;if(c/tot>=0.8)break;}
      var hSet={},bSet={};
      fH.forEach(function(v,i){if(v>0)hSet[i]=1;});
      fB.forEach(function(v,i){if(v>0)bSet[i]=1;});
      var uni=Object.keys(hSet).concat(Object.keys(bSet).filter(function(k){return !hSet[k];})).length;
      var int2=Object.keys(hSet).filter(function(k){return bSet[k];}).length;
      var sK=fK.slice().sort(function(a,b){return b-a;});
      var tK=sK.reduce(function(a,b){return a+b;},0)||1;

      function topN(arr,n){return arr.map(function(v,i){return{v:v,i:i};}).sort(function(a,b){return b.v-a.v;}).slice(0,n);}
      var t5L=topN(fL,5), t5K=topN(fK,5);
      var t5Lidx=t5L.map(function(x){return x.i;}), t5Kidx=t5K.map(function(x){return x.i;});
      var lko=t5Lidx.filter(function(i){return t5Kidx.indexOf(i)>=0;}).length;
      var t20L=topN(fL,20).map(function(x){return x.i;});
      var safe=t20L.filter(function(i){return fK[i]===0;}).length;
      var pvp=D.markers.filter(function(m){return m.map===id&&m.event==='Kill';}).length;
      var storm=ms.reduce(function(s,m){return s+m.storm_deaths;},0);
      var avgH=(ms.reduce(function(s,m){return s+m.humans;},0)/ms.length).toFixed(1);
      var solo=Math.round(ms.filter(function(m){return m.humans<=1;}).length/ms.length*100);

      // dead zones: visited but < 10% of avg nonzero
      var nz=fH.filter(function(v){return v>0;});
      var avgNZ=nz.length?nz.reduce(function(a,b){return a+b;},0)/nz.length:1;
      var deadZones=fH.map(function(v,i){return{v:v,i:i};})
        .filter(function(x){return x.v>0&&x.v<avgNZ*0.1;})
        .sort(function(a,b){return a.v-b.v;}).slice(0,5);

      // overlap zones: where both human and bot active, ranked by human traffic
      var overlapZones=Object.keys(hSet).filter(function(k){return bSet[k];})
        .map(function(k){return{i:parseInt(k),v:fH[parseInt(k)]};})
        .sort(function(a,b){return b.v-a.v;}).slice(0,5);

      // loot/kill overlap zones
      var lkZones=t5L.filter(function(x){return t5Kidx.indexOf(x.i)>=0;});

      mapData[id] = {
        stats:{ matches:ms.length, zonesUsed:Math.round(used/T*100), unvisited:Math.round(unv/T*100),
          t80:Math.round(c80/T*100), top5pct:Math.round(sH.slice(0,5).reduce(function(a,b){return a+b;},0)/tot*100),
          hbo:uni>0?Math.round(int2/uni*100):0, top3K:Math.round(sK.slice(0,3).reduce(function(a,b){return a+b;},0)/tK*100),
          lko:lko, safe:safe, pvp:pvp, storm:storm, avgH:parseFloat(avgH), solo:solo },
        zones:{ overlap:overlapZones, kills:t5K, dead:deadZones, loot:lkZones },
        gridH:fH, gridK:fK, top5traffic:topN(fH,5)
      };
    });

    } catch (err) {
      showAnalyticsError('Failed to compute analytics: ' + (err && err.message ? err.message : String(err)));
      console.error('[analytics.js] build() error:', err);
      return;
    }

    buildTable();
    loadMinimapsAndDraw();
    bindTabs();
    renderZoneBars(activeMetric);
  }

  // ── metrics table ──
  function buildTable() {
    try {
    var rows=[
      {sec:'Overview'},
      {l:'Matches in dataset',    v:function(x){return x.matches;}},
      {l:'Avg humans per match',  v:function(x){return x.avgH;},   c:function(x){return x.avgH<1.5?'ma-bad':x.avgH<3?'ma-warn':'ma-good';}},
      {l:'Solo-match rate',       v:function(x){return x.solo+'%';},c:function(x){return x.solo>80?'ma-bad':x.solo>60?'ma-warn':'ma-good';}},
      {sec:'Traffic & Flow'},
      {l:'Map zones used',              v:function(x){return x.zonesUsed+'%';}},
      {l:'Unvisited zones',             v:function(x){return x.unvisited+'%';},c:function(x){return x.unvisited>50?'ma-bad':x.unvisited>35?'ma-warn':'';}},
      {l:'80% of traffic in (% of map)',v:function(x){return x.t80+'%';}},
      {l:'Top 5 zones carry',           v:function(x){return x.top5pct+'%';}, c:function(x){return x.top5pct>40?'ma-warn':'';}},
      {sec:'Combat'},
      {l:'Human/bot zone overlap', v:function(x){return x.hbo+'%';}, c:function(x){return x.hbo<35?'ma-bad':x.hbo<60?'ma-warn':'ma-good';}},
      {l:'Top 3 zones kill share', v:function(x){return x.top3K+'%';},c:function(x){return x.top3K>45?'ma-bad':x.top3K>35?'ma-warn':'';}},
      {l:'PvP kills',              v:function(x){return x.pvp;},     c:function(x){return x.pvp===0?'ma-bad':x.pvp<5?'ma-warn':'ma-good';}},
      {l:'Storm deaths',           v:function(x){return x.storm;}},
      {sec:'Loot & Economy'},
      {l:'Loot/kill zone overlap (top 5)',v:function(x){return x.lko+'/5';},c:function(x){return x.lko>=4?'ma-bad':x.lko>=3?'ma-warn':'ma-good';}},
      {l:'Safe loot zones (no kills)',    v:function(x){return x.safe;},    c:function(x){return x.safe<=4?'ma-bad':x.safe<=8?'ma-warn':'ma-good';}},
    ];
    var h='';
    rows.forEach(function(r){
      if(r.sec){h+='<tr class="ma-sec"><td colspan="4">'+r.sec+'</td></tr>';return;}
      var tip=TIPS[r.l]||'';
      var lbl=tip?'<span class="ma-tip">'+r.l+'<i class="ma-tip-icon">i</i><span class="ma-tip-box">'+tip+'</span></span>':r.l;
      h+='<tr><td>'+lbl+'</td>';
      MAPS.forEach(function(m){
        var x=mapData[m]?mapData[m].stats:null;
        var val=x?r.v(x):'—', cls=(x&&r.c)?r.c(x):'';
        h+='<td class="ma-num '+cls+'">'+val+'</td>';
      });
      h+='</tr>';
    });
      document.getElementById('ma-tbody').innerHTML=h;
    } catch(err) { console.warn('[analytics.js] buildTable error:', err); }
  }

  // ── load minimap images then draw canvases ──
  function loadMinimapsAndDraw() {
    var loaded=0;
    MAPS.forEach(function(id){
      var img=new Image();
      img.onload=function(){
        loadedImgs[id]=img;
        loaded++;
        if(loaded===MAPS.length) drawAllCanvases(activeMetric);
      };
      img.onerror=function(){
        loadedImgs[id]=null; loaded++;
        if(loaded===MAPS.length) drawAllCanvases(activeMetric);
      };
      img.src=MAP_IMGS[id];
    });
  }

  function drawAllCanvases(metric) {
    MAPS.forEach(function(id){ drawCanvas(id, metric); });
  }

  function drawCanvas(id, metric) {
    var d=mapData[id]; if(!d) return;
    var cv=document.getElementById(CV_IDS[id]); if(!cv) return;
    var ctx;
    try { ctx=cv.getContext('2d'); } catch(e) { console.warn('[analytics.js] Canvas unavailable for', id, e); return; }
    try {
    var sz=cv.width, cs=sz/N;
    var rgb=MAP_COL[id];

    // background
    ctx.fillStyle='#0a0c14';
    ctx.fillRect(0,0,sz,sz);

    // minimap image
    if(loadedImgs[id]){
      ctx.globalAlpha=0.35;
      ctx.drawImage(loadedImgs[id],0,0,sz,sz);
      ctx.globalAlpha=1;
    }

    // human traffic heatmap
    for(var i=0;i<N;i++){
      for(var j=0;j<N;j++){
        var idx=i*N+j;
        var val=d.gridH[idx]||0;
        if(val>0){
          ctx.fillStyle='rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+','+(0.05+val*0.65)+')';
          ctx.fillRect(j*cs,i*cs,cs,cs);
        }
        var kval=d.gridK[idx]||0;
        if(kval>0.2){
          ctx.fillStyle='rgba(239,68,68,'+(kval*0.4)+')';
          ctx.fillRect(j*cs,i*cs,cs,cs);
        }
      }
    }

    // grid lines
    ctx.strokeStyle='rgba(255,255,255,0.07)';
    ctx.lineWidth=0.5;
    for(var x=0;x<=N;x++){
      ctx.beginPath();ctx.moveTo(x*cs,0);ctx.lineTo(x*cs,sz);ctx.stroke();
    }
    for(var y=0;y<=N;y++){
      ctx.beginPath();ctx.moveTo(0,y*cs);ctx.lineTo(sz,y*cs);ctx.stroke();
    }

    // highlight active metric zones
    var zones=d.zones[metric]||[];
    zones.forEach(function(z,rank){
      var row=Math.floor(z.i/N), col=z.i%N;
      // filled highlight
      ctx.fillStyle='rgba(255,255,255,'+(0.12-rank*0.015)+')';
      ctx.fillRect(col*cs,row*cs,cs,cs);
      // border
      ctx.strokeStyle='rgba(255,255,255,'+(0.9-rank*0.12)+')';
      ctx.lineWidth=1.5;
      ctx.strokeRect(col*cs+0.75,row*cs+0.75,cs-1.5,cs-1.5);
      // rank number inside cell
      ctx.fillStyle='rgba(255,255,255,0.9)';
      ctx.font='bold '+(cs*0.38)+'px monospace';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(rank+1, col*cs+cs/2, row*cs+cs/2);
    });
    } catch(err) {
      console.warn('[analytics.js] drawCanvas error for', id, ':', err);
    }
  }

  // ── hover tooltip on canvas ──
  function bindCanvasHover(id) {
    var wrap=document.getElementById(WRAP_IDS[id]);
    var cv=document.getElementById(CV_IDS[id]);
    var tip=document.getElementById(HOVER_IDS[id]);
    if(!wrap||!cv||!tip) return;
    wrap.addEventListener('mousemove',function(e){
      var rect=cv.getBoundingClientRect();
      var scaleX=N/rect.width;
      var col=Math.floor((e.clientX-rect.left)*scaleX);
      var row=Math.floor((e.clientY-rect.top)*scaleX);
      col=Math.max(0,Math.min(N-1,col));
      row=Math.max(0,Math.min(N-1,row));
      tip.textContent='C'+col+' / R'+row;
      tip.style.display='block';
      // position relative to wrap
      var wRect=wrap.getBoundingClientRect();
      var tx=e.clientX-wRect.left+8;
      var ty=e.clientY-wRect.top-24;
      if(tx+90>wRect.width) tx=e.clientX-wRect.left-90;
      tip.style.left=tx+'px';
      tip.style.top=ty+'px';
    });
    wrap.addEventListener('mouseleave',function(){tip.style.display='none';});
  }

  // ── zone bars ──
  function renderZoneBars(metric) {
    try {
    var metricColors={overlap:null,kills:'#ef4444',dead:'#6b7280',loot:'#f59e0b'};
    // find global max value across all maps for this metric (for relative bar %)
    var globalMax=0;
    MAPS.forEach(function(id){
      var d=mapData[id]; if(!d) return;
      var z=d.zones[metric];
      if(z&&z.length) globalMax=Math.max(globalMax,z[0].v);
    });

    var h='<div class="ma-zones-grid">';
    MAPS.forEach(function(id){
      var d=mapData[id];
      var cls=MAP_CLS[id];
      var rgb=MAP_COL[id];
      var barCol=metricColors[metric]||('rgb('+rgb[0]+','+rgb[1]+','+rgb[2]+')');
      var zones=d?d.zones[metric]:[];
      var localMax=zones.length?zones[0].v:1;

      h+='<div class="ma-zone-card"><div class="ma-zone-card-title '+cls+'">'+MAP_NAMES[id]+'</div>';
      if(!zones||!zones.length){
        h+='<div style="color:var(--muted);font-size:11px;padding:4px 0">No data</div>';
      } else {
        zones.forEach(function(z,i){
          var pct=globalMax>0?Math.round(z.v/globalMax*100):0;
          var dispPct=localMax>0?Math.round(z.v/localMax*100):0;
          var row=Math.floor(z.i/N), col=z.i%N;
          h+='<div class="ma-zone-row">';
          h+='<span class="ma-zone-rank">'+(i+1)+'.</span>';
          h+='<span class="ma-zone-label">C'+col+' / R'+row+'</span>';
          h+='<div class="ma-zone-bar-wrap"><div class="ma-zone-bar" style="width:'+pct+'%;background:'+barCol+'"></div></div>';
          h+='<span class="ma-zone-pct">'+dispPct+'%</span>';
          h+='</div>';
        });
      }
      h+='</div>';
    });
    h+='</div>';
      document.getElementById('ma-zones-content').innerHTML=h;
    } catch(err) { console.warn('[analytics.js] renderZoneBars error:', err); }
  }

  // ── tabs ──
  function bindTabs() {
    MAPS.forEach(function(id){ bindCanvasHover(id); });
    var tabs=document.querySelectorAll('.ma-tab');
    tabs.forEach(function(tab){
      tab.addEventListener('click',function(){
        tabs.forEach(function(t){t.classList.remove('active');});
        tab.classList.add('active');
        activeMetric=tab.dataset.metric;
        drawAllCanvases(activeMetric);
        renderZoneBars(activeMetric);
      });
    });
  }

  build();
})();
