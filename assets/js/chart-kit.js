/* ============================================================================
   CHART KIT — shared chart styling, labelling and export for every chart.
   ----------------------------------------------------------------------------
   Loaded before dashboard.js. It owns:
     • PAL / SEQ / plotBase / plotCfg — one professional palette and one Plotly
       base layout, so every chart in the dashboard looks like the same product.
     • wrapLabel()  — wraps a long axis label across lines at word boundaries.
       Nothing is ever cut off with an ellipsis; the full string is also placed
       in the hover tooltip.
     • drawChart(id, traces, layout, meta) — renders the chart AND attaches the
       export control to it. Every chart in the dashboard goes through this, so
       no chart can ship without a working download button.
     • exportChart(id, fmt) — PNG (2x), SVG (vector), or CSV of the numbers
       actually plotted.
   ============================================================================ */

/* ---- palette ------------------------------------------------------------- *
   Anchored on the GATI brand (deep teal + gold). Ordered so that neighbouring
   series stay distinguishable, including for the most common form of colour
   blindness, and so no chart mixes an off-brand hue.                          */
var PAL = {
  ink:'#0F2E2E', mid:'#3D6060', soft:'#7A9C9C', line:'#DCE9E9', grid:'#EDF4F4',
  teal:'#1A7B7A', tealD:'#0F5B5A', tealDD:'#0A3E3D', tealL:'#5FB3B2', tealLL:'#A9D6D5',
  gold:'#C98A0B', goldL:'#E5B04A', goldD:'#8F6207',
  slate:'#5B7C8D', plum:'#7D5A76', sage:'#6E8F6B', clay:'#B5714E',
  alert:'#C0432F'
};

/* Categorical series colours, in assignment order. */
var CAT = [PAL.teal, PAL.gold, PAL.tealD, PAL.slate, PAL.tealL,
           PAL.goldL, PAL.plum, PAL.sage, PAL.clay, PAL.tealDD];

/* Sequential ramp for heatmaps: light neutral -> deep brand teal. */
var SEQ = [[0,'#F7FBFB'],[0.25,'#D8ECEB'],[0.5,'#93CBCA'],[0.75,'#3D9291'],[1,'#0F5B5A']];

var plotCfg = { displayModeBar:false, responsive:true };

var plotBase = {
  paper_bgcolor:'rgba(0,0,0,0)',
  plot_bgcolor:'rgba(0,0,0,0)',
  font:{ family:"'Outfit',sans-serif", color:PAL.mid, size:11 },
  margin:{ l:8, r:8, t:10, b:8 },
  hoverlabel:{ bgcolor:'#111827', bordercolor:'#111827', align:'left', namelength:-1,
               font:{ family:"'Outfit',sans-serif", size:13.5, color:'#FFFFFF' } },
  hovermode:'closest',
  showlegend:false
};

/* Axis presets — used everywhere so gridlines/ticks never drift chart to chart. */
function axV(extra){   /* value axis (numbers) */
  return Object.assign({ showgrid:true, gridcolor:PAL.grid, zeroline:false,
    tickfont:{size:10, color:PAL.soft}, fixedrange:true }, extra||{});
}
function axC(extra){   /* category axis (labels) */
  return Object.assign({ showgrid:false, automargin:true,
    tickfont:{size:11, color:'#2A3535'}, fixedrange:true }, extra||{});
}

/* ---- labels --------------------------------------------------------------
   Wrap on spaces so a long occupation name stays fully readable across two or
   three lines instead of being cut with "…". The untouched original string is
   what goes into the tooltip.                                                 */
function wrapLabel(text, width){
  width = width || 26;
  var words = String(text == null ? '' : text).split(/\s+/);
  var lines = [], cur = '';
  words.forEach(function(w){
    if (!cur) { cur = w; return; }
    if ((cur + ' ' + w).length <= width) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  });
  if (cur) lines.push(cur);
  return lines.join('<br>');
}
/* Code + wrapped name — only show the name, not the code. */
function codeLabel(code, name, width){
  return wrapLabel(name, width);
}

/* ============================================================================
   drawChart — the only way charts get rendered in this dashboard.
   meta = { title, cols:[...], rows:[[...], ...] }  ->  powers the CSV export.
   ============================================================================ */
function drawChart(id, traces, layout, meta){
  var el = document.getElementById(id);
  if (!el) return;
  Plotly.react(el, traces, Object.assign({}, plotBase, layout || {}), plotCfg);
  el._chartMeta = meta || deriveMeta(id, traces);
  mountChartTools(el, id);
  attachCopyOnClick(el);
}

/* ---- click-to-copy for hover info ----------------------------------------
   Native Plotly hover tooltips cannot contain buttons, so clicking a point
   pins the same information in a card with a clear Copy button.             */
function linesFromPoint(pt){
  var lines = [];
  if (pt.customdata && pt.customdata.length){
    var cd = pt.customdata;
    lines.push(String(cd[0]));
    if (cd.length > 1) lines.push(String(cd[1]));
    if (cd.length > 2) lines.push(Number(cd[2]).toLocaleString() + ' postings' +
                                  (cd.length > 3 ? ' \u00b7 ' + cd[3] + '%' : ''));
  } else {
    var lab = stripTags(String(pt.orientation === 'h' ? pt.y : pt.x));
    var val = pt.orientation === 'h' ? pt.x : (pt.z != null ? pt.z : pt.y);
    if (pt.data && pt.data.name) lines.push(pt.data.name);
    lines.push(lab);
    if (val != null && val !== lab) lines.push(Number(val).toLocaleString());
  }
  return lines.filter(Boolean);
}
function linesFromEvent(ev){
  if (!ev || !ev.points || !ev.points.length) return [];
  if (ev.points.length > 1){
    /* several traces at one x (e.g. the weekly trend): one combined card */
    var head = stripTags(String(ev.points[0].x));
    var lines = [head];
    ev.points.forEach(function(pt){
      var nm = (pt.data && pt.data.name) ? pt.data.name : '';
      lines.push((nm ? nm + ': ' : '') + Number(pt.y != null ? pt.y : pt.x).toLocaleString() + ' postings');
    });
    return lines;
  }
  return linesFromPoint(ev.points[0]);
}

/* Native Plotly hover boxes render INSIDE the chart's SVG, so they get
   squeezed and clipped at the edges. We hide them and draw our own HTML
   card at document level instead \u2014 it can never be cut off. */
(function(){
  var st = document.createElement('style');
  st.textContent = '.js-plotly-plot .hoverlayer{display:none!important}';
  document.head.appendChild(st);
})();

var _hoverCard = null, _hoverMove = null;
function showHoverCard(lines, mouseEv){
  if (!lines.length) return;
  if (!_hoverCard){
    _hoverCard = document.createElement('div');
    _hoverCard.id = 'hover-card';
    _hoverCard.style.cssText = 'position:fixed;z-index:9998;background:#111827;color:#FFFFFF;'+
      'border-radius:9px;box-shadow:0 6px 18px rgba(0,0,0,.3);padding:10px 14px;'+
      'font:500 13px Outfit,sans-serif;line-height:1.5;max-width:340px;pointer-events:none;display:none';
    document.body.appendChild(_hoverCard);
  }
  _hoverCard.innerHTML = lines.map(function(l, i){
    return '<div'+(i===0?' style="font-weight:700"':'')+'></div>';
  }).join('');
  Array.prototype.forEach.call(_hoverCard.children, function(d, i){ d.textContent = lines[i]; });
  _hoverCard.style.display = 'block';
  positionHoverCard(mouseEv);
  if (!_hoverMove){
    _hoverMove = function(e){ if (_hoverCard.style.display !== 'none') positionHoverCard(e); };
    document.addEventListener('mousemove', _hoverMove);
  }
}
function positionHoverCard(e){
  if (!e || !_hoverCard) return;
  var x = e.clientX, y = e.clientY, w = _hoverCard.offsetWidth, hgt = _hoverCard.offsetHeight;
  var left = x + 14, top = y + 14;
  if (left + w > window.innerWidth - 8)  left = x - w - 14;
  if (top + hgt > window.innerHeight - 8) top = y - hgt - 14;
  _hoverCard.style.left = Math.max(4, left) + 'px';
  _hoverCard.style.top  = Math.max(4, top) + 'px';
}
function hideHoverCard(){ if (_hoverCard) _hoverCard.style.display = 'none'; }

function attachCopyOnClick(el){
  if (el._copyBound || typeof el.on !== 'function') return;
  el._copyBound = true;
  el.on('plotly_hover',  function(ev){ showHoverCard(linesFromEvent(ev), ev.event); });
  el.on('plotly_unhover', hideHoverCard);
  el.addEventListener('mouseleave', hideHoverCard);
  el.on('plotly_click', function(ev){
    hideHoverCard();
    var lines = linesFromEvent(ev);
    if (lines.length) showCopyCard(lines, ev.event);
  });
}
function showCopyCard(lines, mouseEv){
  var card = document.getElementById('copy-card');
  if (!card){
    card = document.createElement('div');
    card.id = 'copy-card';
    card.style.cssText = 'position:fixed;z-index:9999;background:#111827;color:#FFFFFF;'+
      'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35);padding:14px 16px;'+
      'font:500 13.5px Outfit,sans-serif;line-height:1.55;max-width:340px;min-width:200px';
    document.body.appendChild(card);
    document.addEventListener('click', function(e){
      if (card.style.display !== 'none' && !card.contains(e.target)) card.style.display = 'none';
    }, true);
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') card.style.display = 'none'; });
  }
  var text = lines.join('\n');
  card.innerHTML = '';
  var body = document.createElement('div');
  lines.forEach(function(l, i){
    var d = document.createElement('div');
    if (i === 0) d.style.fontWeight = '700';
    d.textContent = l;
    body.appendChild(d);
  });
  card.appendChild(body);
  var btn = document.createElement('button');
  btn.textContent = '\u29c9 Copy';
  btn.style.cssText = 'margin-top:10px;display:inline-block;background:#C98A0B;color:#111827;'+
    'border:0;border-radius:7px;padding:6px 14px;font:700 12.5px Outfit,sans-serif;cursor:pointer';
  btn.onclick = function(e){
    e.stopPropagation();
    var done = function(){ btn.textContent = '\u2713 Copied'; setTimeout(function(){ card.style.display='none'; }, 700); };
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done, function(){ fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  };
  card.appendChild(btn);
  var x = (mouseEv && mouseEv.clientX || 200), y = (mouseEv && mouseEv.clientY || 200);
  card.style.display = 'block';
  card.style.left = Math.min(x + 12, window.innerWidth - 360) + 'px';
  card.style.top  = Math.min(y + 12, window.innerHeight - 160) + 'px';
}
function fallbackCopy(text){
  var ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch(e){}
  document.body.removeChild(ta);
}

/* Fallback CSV data if a caller didn't supply meta: read it off the traces. */
function deriveMeta(id, traces){
  var t = traces && traces[0];
  if (!t) return { title:id, cols:['label'], rows:[] };
  if (t.type === 'heatmap'){
    var cols = ['row'].concat((t.x || []).map(stripTags));
    var rows = (t.y || []).map(function(yv, i){
      return [stripTags(yv)].concat((t.z && t.z[i]) || []);
    });
    return { title:id, cols:cols, rows:rows };
  }
  var horiz = t.orientation === 'h';
  var labels = (horiz ? t.y : t.x) || [];
  var values = (horiz ? t.x : t.y) || [];
  return { title:id, cols:['label','value'],
           rows: labels.map(function(l, i){ return [stripTags(l), values[i]]; }) };
}
function stripTags(s){ return String(s == null ? '' : s).replace(/<br>/g, ' ').replace(/<[^>]+>/g, '').trim(); }

/* ---- export control ------------------------------------------------------ */
function mountChartTools(el, id){
  var host = el.parentNode;
  if (!host) return;
  if (!host.classList.contains('chart-host')){
    var w = document.createElement('div');
    w.className = 'chart-host';
    host.insertBefore(w, el);
    w.appendChild(el);
    host = w;
  }
  if (host.querySelector('.chart-tools')) return;   /* already mounted */

  var tools = document.createElement('div');
  tools.className = 'chart-tools';
  tools.innerHTML =
    '<button type="button" class="chart-btn" aria-haspopup="true" aria-expanded="false" ' +
      'title="Download this chart as an image, or export the numbers behind it">' +
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6v8.2M4.6 6.6L8 10l3.4-3.4M2.4 12.3v1.2a.9.9 0 0 0 .9.9h9.4a.9.9 0 0 0 .9-.9v-1.2"/></svg>' +
      '<span>Export</span>' +
    '</button>' +
    '<div class="chart-menu" role="menu" hidden>' +
      '<button type="button" role="menuitem" data-fmt="png">Download as a PNG image</button>' +
      '<button type="button" role="menuitem" data-fmt="svg">Download as an SVG vector</button>' +
      '<button type="button" role="menuitem" data-fmt="csv">Export the numbers as CSV</button>' +
    '</div>';
  host.appendChild(tools);

  var btn = tools.querySelector('.chart-btn');
  var menu = tools.querySelector('.chart-menu');
  btn.addEventListener('click', function(ev){
    ev.stopPropagation();
    var open = !menu.hidden;
    closeAllChartMenus();
    menu.hidden = open;
    btn.setAttribute('aria-expanded', String(!open));
  });
  menu.querySelectorAll('button').forEach(function(b){
    b.addEventListener('click', function(ev){
      ev.stopPropagation();
      closeAllChartMenus();
      exportChart(id, b.dataset.fmt);
    });
  });
}
function closeAllChartMenus(){
  document.querySelectorAll('.chart-menu').forEach(function(m){ m.hidden = true; });
  document.querySelectorAll('.chart-btn').forEach(function(b){ b.setAttribute('aria-expanded','false'); });
}
document.addEventListener('click', closeAllChartMenus);
document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeAllChartMenus(); });

/* ---- the exports themselves ---------------------------------------------- */
function exportChart(id, fmt){
  var el = document.getElementById(id);
  if (!el) return;
  var meta = el._chartMeta || { title:id, cols:[], rows:[] };
  var name = safeName([
    (typeof APP !== 'undefined' && APP.sector ? APP.sector.label : 'GATI'),
    meta.title || id,
    new Date().toISOString().slice(0,10)
  ].join(' - '));

  if (fmt === 'csv'){
    var lines = [meta.cols.map(csvCell).join(',')]
      .concat(meta.rows.map(function(r){ return r.map(csvCell).join(','); }));
    downloadBlob(lines.join('\r\n'), name + '.csv', 'text/csv;charset=utf-8;');
    return;
  }
  var rect = el.getBoundingClientRect();
  Plotly.downloadImage(el, {
    format: fmt,                       /* 'png' | 'svg' */
    filename: name,
    width: Math.max(Math.round(rect.width), 640),
    height: Math.max(Math.round(rect.height), 360),
    scale: fmt === 'png' ? 2 : 1       /* 2x so PNGs are slide-ready */
  });
}
function csvCell(v){
  var s = stripTags(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function safeName(s){ return String(s).replace(/[^\w .()-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function downloadBlob(text, filename, mime){
  var blob = new Blob(['\uFEFF' + text], { type: mime });   /* BOM: Excel-friendly */
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 0);
}
