/* ============================================================================
   GATI SECTOR DASHBOARD  —  render engine.
   ----------------------------------------------------------------------------
   A faithful port of the original single-file healthcare dashboard's full
   analysis (all six tabs), driven by the CSV-built DATA model from
   data-loader.js and GENERALISED so any sector renders identically:
     • role groups come from DATA.roleGroups (top ISCO-3), not hardcoded codes
     • cross-tab, trend and role deep-dives build from those groups
     • employer-sector colours fall back to a palette for non-health sectors
     • the About/Methods and Qualifications tabs load per-sector HTML from
       /content (see sector.staticTabs); absent → tab simply doesn't appear
   Tabs 1-4 (Overview, Roles, Regional, Explorer) are 100% data-driven.
   ============================================================================ */

/* ======= APP STATE ======================================================== */
var APP = { filterState:'ALL', filterIsic:'ALL', filterGenuine:true, filterClearCat:true, filterClearOcc:true,
            activeTab:'overview', activeRole:null,
            leafletMap:null, mapInit:false,
            sector:null, region:null };
var DATA = null;

/* ======= PALETTE / PLOTLY BASE ==========================================
   The palette, the Plotly base layout and the export control now live in
   chart-kit.js so that every chart is styled and exportable the same way.
   C is kept as a thin alias onto that palette so existing call sites read
   naturally.                                                                */
var C = { teal:PAL.teal, tealD:PAL.tealD, tealL:'#E9F4F4', gold:PAL.gold,
          textD:PAL.ink, textM:PAL.mid, textL:PAL.soft, border:PAL.line,
          coral:PAL.alert, teal2:PAL.tealL,
          emp:[PAL.teal, PAL.tealL, PAL.tealLL, PAL.gold, PAL.goldL, PAL.tealD] };
var ISIC_PALETTE = CAT;
var _isicColMap = {};
function isicColor(name){
  if (typeof ISIC_COLORS !== 'undefined' && ISIC_COLORS[name]) return ISIC_COLORS[name];
  if (!(name in _isicColMap)){
    var used = Object.keys(_isicColMap).length;
    _isicColMap[name] = ISIC_PALETTE[used % ISIC_PALETTE.length];
  }
  return _isicColMap[name];
}

/* ISCO-2 major-group names for the weekly-trend legend (fallback: "ISCO NN"). */
var ISCO2_NAMES = {
  14:'Hospitality & Retail Managers', 21:'Science & Engineering', 22:'Health Professionals',
  23:'Teaching Professionals', 24:'Business & Admin Professionals', 25:'ICT Professionals',
  26:'Legal, Social & Cultural', 31:'Science & Engineering Technicians',
  32:'Health Associate Professionals', 33:'Business & Admin Associates',
  34:'Legal, Social & Cultural Associates', 35:'ICT Technicians',
  41:'General & Keyboard Clerks', 42:'Customer-Service Clerks',
  43:'Numerical & Material-Recording Clerks', 44:'Other Clerical Support',
  51:'Personal Service Workers', 52:'Sales Workers', 53:'Personal Care Workers',
  54:'Protective Services', 71:'Building & Related Trades', 72:'Metal & Machinery Trades',
  73:'Handicraft & Printing', 74:'Electrical & Electronic Trades',
  75:'Food-Processing & Craft', 81:'Stationary Plant & Machine Operators',
  82:'Assemblers', 83:'Drivers & Mobile-Plant Operators',
  91:'Cleaners & Helpers', 92:'Agricultural Labourers',
  93:'Labourers (Mining, Construction, Transport)', 94:'Food-Preparation Assistants',
  95:'Street & Related Sales', 96:'Refuse & Other Elementary Workers' };
var TREND_COLS = [PAL.teal, PAL.gold, PAL.tealD, PAL.slate, PAL.tealL];

/* pc / base are aliases onto chart-kit's shared config (see chart-kit.js). */
var pc   = plotCfg;
var base = plotBase;
var fmt = function(n){ return Number(n).toLocaleString('en-US'); };
var pct = function(n,d){ return d>0 ? (n/d*100).toFixed(1) : '0.0'; };
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* part-time-ish indices, derived once from the sector's employment lookup. */
var PT_IDX = {};
function computePartTime(){
  PT_IDX = {};
  (DATA.lookup.empTypes||[]).forEach(function(l,i){
    if (l==='Part-time' || l==='Full-time or Part-time') PT_IDX[i]=true;
  });
}

/* ======= BOOT ============================================================= */
function qs(k){ return new URLSearchParams(location.search).get(k); }

window.addEventListener('load', function(){
  var id = qs('sector') || (typeof SECTORS!=='undefined' && SECTORS[0] && SECTORS[0].id) || 'healthcare';
  var sector = (typeof getSector==='function' && getSector(id)) || null;
  if (!sector){ showError({kind:'network', message:'No sector "'+id+'" is configured in sectors.js.'}, ''); return; }
  APP.sector = sector;
  APP.region = (typeof regionFor==='function') ? regionFor(sector) : null;

  /* header + switcher + footer chrome */
  document.getElementById('hdr-t1').textContent = sector.label + ' Demand Intelligence';
  document.getElementById('hdr-t2').textContent =
    (APP.region ? APP.region.label : 'Germany') + ' · ' + (sector.source || 'StepStone Germany');
  document.getElementById('map-head').textContent = sector.label + ' Vacancies Across ' + (APP.region? APP.region.label : 'Germany');
  document.getElementById('foot-sector').textContent = sector.label;
  applyCatTerms();
  document.title = 'GATI · ' + sector.label + ' Demand Intelligence';
  buildSwitcher(sector.id);

  loadSectorData(sector.id)
    .then(function(built){ DATA = built; initDashboard(); })
    .catch(function(err){ showError(err, csvUrlFor(sector)); });
});

function buildSwitcher(activeId){
  var sel = document.getElementById('hdr-switch');
  if (!sel || typeof SECTORS==='undefined') return;
  sel.innerHTML = SECTORS.map(function(s){
    return '<option value="'+s.id+'"'+(s.id===activeId?' selected':'')+'>'+esc(s.label)+'</option>';
  }).join('');
}
function switchSector(id){ location.href = 'dashboard.html?sector=' + encodeURIComponent(id); }

function showError(err, url){
  var kind = (err && err.kind) || 'network';
  var d = (err && err.diag) || {};
  url = url || d.url || '(unknown)';
  var title, body;

  if (kind === 'http'){
    title = 'CSV not found at that path (HTTP ' + (d.status || '404') + ')';
    body =
      '<p>The dashboard fetched <code>'+esc(url)+'</code> and the server returned '+
      '<b>HTTP '+esc(String(d.status||404))+'</b> — so the file isn\'t at that exact path in your published site. '+
      'The data loading code is fine; the file just isn\'t reachable there. Most common causes, in order:</p>'+
      '<ol style="text-align:left;font-size:12px;color:#3D6060;line-height:1.9;margin:10px 0 0;padding-left:20px">'+
      '<li><b>The CSV is git-ignored.</b> Many repos have <code>*.csv</code> in <code>.gitignore</code>, so it exists locally but was never pushed. Run <code>git check-ignore '+esc(url)+'</code> — if it prints the path, that\'s it. Force-add with <code>git add -f '+esc(url)+'</code>.</li>'+
      '<li><b>Filename / case mismatch.</b> GitHub Pages is case-sensitive. It must be exactly <code>'+esc(url)+'</code> (lowercase, matching the sector <code>id</code>) — not <code>Hospitality.csv</code> or <code>hospitality_final.csv</code>.</li>'+
      '<li><b>Wrong folder.</b> It must sit in <code>/data</code> at the repo root, next to <code>dashboard.html</code>.</li>'+
      '<li><b>Not committed / not deployed yet.</b> Confirm it\'s in the latest commit and the Pages build finished.</li>'+
      '</ol>';
  } else if (kind === 'empty' && d.missing && d.missing.length){
    title = 'CSV loaded, but required columns are missing';
    body =
      '<p>The file at <code>'+esc(url)+'</code> parsed ('+esc(String(d.parsedRows||0))+' rows, delimiter '+
      '<code>'+esc(d.delimiter||',')+'</code>), but these expected columns were not found:</p>'+
      '<p style="margin:8px 0"><b style="color:#D94F3D">'+d.missing.map(esc).join(', ')+'</b></p>'+
      '<p style="font-size:12px;color:#3D6060">Columns detected in your file: <span style="color:#7A9C9C">'+
      (d.headers||[]).slice(0,24).map(esc).join(', ')+(d.headers&&d.headers.length>24?' …':'')+'</span></p>'+
      '<p style="font-size:12px;color:#3D6060;margin-top:8px">Column names are matched case-insensitively and ignore spaces/underscores, so the issue is a genuinely different (or absent) column — re-export from the classifier so it includes '+
      '<code>ISCO_3</code>, <code>ISCO_4</code>, <code>ISCO_4_name</code>, <code>State</code>, and <code>Employer_Category</code>.</p>';
  } else if (kind === 'empty'){
    title = 'CSV loaded, but no rows survived classification';
    body =
      '<p>The file at <code>'+esc(url)+'</code> parsed ('+esc(String(d.parsedRows||0))+' rows, delimiter '+
      '<code>'+esc(d.delimiter||',')+'</code>), but every row was dropped as <i>Out of Scope</i> / <i>CLASSIFICATION_FAILED</i> or had an empty <code>ISCO_4</code>. '+
      'Check that the file is the classifier\'s <b>final</b> output, not the raw scrape.</p>';
  } else {
    title = 'Could not load sector data';
    body =
      '<p>Fetching <code>'+esc(url)+'</code> failed at the network level. '+
      'If you are opening the file directly from disk (<code>file://</code>), the browser blocks it — publish to GitHub Pages or serve over http. '+
      'Otherwise it may be a transient network error.</p>'+
      '<p style="font-size:12px;color:#7A9C9C;margin-top:8px">'+esc(String(err&&err.message||err))+'</p>';
  }

  var s = document.getElementById('db-status');
  s.innerHTML =
    '<div class="status-card" style="max-width:640px;text-align:left">'+
      '<h2 style="color:#D94F3D">'+esc(title)+'</h2>'+ body +
      '<p style="margin-top:14px"><a href="index.html" style="color:#1A7B7A;font-weight:600;text-decoration:none">&larr; Back to all dashboards</a></p>'+
    '</div>';
  s.hidden = false;
  document.querySelectorAll('.tab-panel').forEach(function(p){ p.hidden = true; p.classList.remove('active'); });
}

/* ======= INIT ============================================================= */
function initDashboard(){
  computePartTime();
  populateFilters();
  buildRoleTab();
  buildStaticTabs();
  document.getElementById('db-status').hidden = true;
  document.querySelectorAll('.tab-panel').forEach(function(p){ p.hidden = false; });
  fillDataBanner();
  renderAll();
  renderExplorer();
}

function populateFilters(){
  var st = document.getElementById('flt-state');
  st.innerHTML = '<option value="ALL">All States</option>' +
    DATA.lookup.states.map(function(s){ return '<option value="'+esc(s)+'">'+esc(s)+'</option>'; }).join('');
  var ic = document.getElementById('flt-isic');
  ic.innerHTML = '<option value="ALL">All Employer Types</option>' +
    DATA.lookup.isic.map(function(s){ return '<option value="'+esc(s)+'">'+esc(s)+'</option>'; }).join('');
  document.getElementById('flt-genuine').checked = APP.filterGenuine;
  var fc=document.getElementById('flt-clearcat'); if(fc) fc.checked = !!APP.filterClearCat;
  var fo=document.getElementById('flt-clearocc'); if(fo) fo.checked = !!APP.filterClearOcc;
}

function fillDataBanner(){
  var m = DATA.meta, s = APP.sector;
  var items = [
    ['Source', s.source || 'StepStone Germany'],
    ['Period', m.dateRange || '—'],
    ['Postings Loaded', fmt(m.scraped)],
    ['In-scope '+s.label+' Postings', fmt(m.total)]
  ];
  document.getElementById('data-banner').innerHTML = items.map(function(it,i){
    return (i? '<span class="db-sep">|</span>' : '') +
      '<div class="db-item"><span class="db-label">'+esc(it[0])+'</span><span class="db-val">'+esc(it[1])+'</span></div>';
  }).join('');
}

/* ======= DATA HELPERS ===================================================== */
function getRows(){
  var si = APP.filterState!=='ALL' ? DATA.lookup.states.indexOf(APP.filterState) : -999;
  var ii = APP.filterIsic!=='ALL'  ? DATA.lookup.isic.indexOf(APP.filterIsic)   : -999;
  /* index of the "Unclassified" ISCO-4 bucket, if present (-1 if none) */
  var unclIx = DATA.lookup.isco4 ? DATA.lookup.isco4.indexOf('Unclassified') : -1;
  return DATA.rows.filter(function(r){
    if (si!==-999 && r[0]!==si) return false;
    if (ii!==-999 && r[1]!==ii) return false;
    if (APP.filterGenuine && r[6]===1) return false;
    if (APP.filterClearCat && r[8]===0) return false;
    if (APP.filterClearOcc && unclIx!==-1 && r[4]===unclIx) return false;
    return true;
  });
}
function applyFilters(){
  APP.filterState   = document.getElementById('flt-state').value;
  APP.filterIsic    = document.getElementById('flt-isic').value;
  APP.filterGenuine  = document.getElementById('flt-genuine').checked;
  var _fc = document.getElementById('flt-clearcat');
  APP.filterClearCat = _fc ? _fc.checked : true;
  var _fo = document.getElementById('flt-clearocc');
  APP.filterClearOcc = _fo ? _fo.checked : true;
  EXP_PAGE = 0;
  renderAll();
}

/* ======= TAB SWITCHING ==================================================== */
function showTab(id, btn){
  document.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.remove('active'); });
  document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.remove('active'); });
  var panel = document.getElementById('tab-'+id);
  if (panel) panel.classList.add('active');
  if (btn) btn.classList.add('active');
  APP.activeTab = id;
  var rows = getRows();
  if (id==='roles')      renderRoleTab(rows, APP.activeRole);
  if (id==='regional'){  renderStateBar(rows); renderStateTable(rows); initMap(); }
  if (id==='explorer')   renderExplorer();
  if (id==='classify')   renderClassifications(rows);
  if (id==='context')    renderMarketContext(rows);
  if (id==='tiers')      renderTiers();

  /* Run the heavy requirements extractor lazily — only when the user opens
     a tab that needs it, and only once. This keeps the initial dashboard
     load fast (previously it ran twice over the whole dataset at load). */
  if (panel){
    if (panel.getAttribute('data-needs-quals')==='1'){
      panel.removeAttribute('data-needs-quals');
      setTimeout(function(){ populateQualsExtract(panel); }, 30);
    }
    if (panel.getAttribute('data-needs-visa')==='1'){
      panel.removeAttribute('data-needs-visa');
      setTimeout(function(){ populateVisaExtract(panel); }, 30);
    }
  }
}

/* ======= RENDER ALL ======================================================= */
function renderAll(){
  var rows = getRows();
  document.getElementById('filter-count').textContent = fmt(rows.length) + ' postings';
  updateKPIs(rows); renderAlert(rows);
  renderTop10(rows); renderCrossTab(rows);
  renderTrend(rows); renderIsicBar(rows); renderOverviewRegions(rows);
  if (APP.activeTab==='roles')      renderRoleTab(rows, APP.activeRole);
  if (APP.activeTab==='regional'){  renderStateBar(rows); renderStateTable(rows); }
  if (APP.activeTab==='explorer')   renderExplorer();
  if (APP.activeTab==='classify')   renderClassifications(rows);
  if (APP.activeTab==='context')    renderMarketContext(rows);
  if (APP.activeTab==='tiers')      renderTiers();
}


/* ---- sector-dependent category terminology ------------------------------- */
function catC(){  return (APP.sector && APP.sector.catLabel) || 'Employer Sector'; }
function catL(){  return catC().toLowerCase(); }
function catPC(){ return (APP.sector && APP.sector.catLabelPlural) || (catC()+'s'); }
function catPL(){ return catPC().toLowerCase(); }
/* Rewrite the static HTML copy ("employer sector") to this sector's term. */
function applyCatTerms(){
  if (catL() === 'employer sector') return;
  var sel = '.card-head, .card-sub, .insight-box, .sub-btn, .note-box, footer, .tab-btn';
  document.querySelectorAll(sel).forEach(function(el){
    if (/employer sector/i.test(el.innerHTML)){
      el.innerHTML = el.innerHTML
        .replace(/Employer Sectors/g, catPC()).replace(/employer sectors/g, catPL())
        .replace(/Employer Sector/g,  catC()).replace(/employer sector/g,  catL());
    }
  });
}

/* ======= KPIs ============================================================= */
function kpi(id,val,lbl,sub){
  var el=document.getElementById(id);
  if(el) el.innerHTML='<span class="kpi-val">'+val+'</span><span class="kpi-lbl">'+lbl+'</span><span class="kpi-sub">'+sub+'</span>';
}
function updateKPIs(rows){
  var total = rows.length;
  var lead  = DATA.roleGroups[0];
  var leadN = lead ? rows.filter(function(r){ return r[4]===lead.idx; }).length : 0;
  var pt    = rows.filter(function(r){ return PT_IDX[r[5]]; }).length;
  var stc={}; rows.forEach(function(r){ if(r[0]>=0){ var s=DATA.lookup.states[r[0]]; stc[s]=(stc[s]||0)+1; } });
  var top3 = Object.keys(stc).map(function(k){return [k,stc[k]];}).sort(function(a,b){return b[1]-a[1];}).slice(0,3);
  var top3n = top3.reduce(function(s,e){return s+e[1];},0);
  var top3p = total>0 ? Math.round(top3n/total*100) : 0;
  var topSt = top3[0] ? top3[0][0] : 'N/A';
  var wk = DATA.meta.weeks || 1;
  kpi('kpi-total', fmt(total), APP.sector.label+' Postings', 'Approx. '+fmt(Math.round(total/Math.max(wk,1)))+' new postings per week');
  kpi('kpi-lead', pct(leadN,total)+'%', (lead? lead.name : 'Lead'), fmt(leadN)+' postings \u2014 the largest ISCO-4 occupation');
  kpi('kpi-parttime', pct(pt,total)+'%', 'Open to Part-time', 'Accept flexible or part-time arrangements');
  kpi('kpi-geo', top3p+'%', 'Demand in Top 3 States', 'Led by '+topSt+': geographic concentration of demand');
}

/* ============================================================================
   hBar — the shared horizontal bar chart.
   Every bar chart in the dashboard is drawn through this so that labelling,
   colour, hover and export behave identically everywhere. Labels wrap across
   lines instead of being cut off; the untouched full name, the count and the
   share all appear in the tooltip.
     items: [{ label, code?, count, color? }]
   ============================================================================ */
function hBar(id, items, opts){
  opts = opts || {};
  var el = document.getElementById(id);
  if (!el) return;
  if (!items.length){
    el.innerHTML = '<p class="chart-empty">There is no data for this selection.</p>';
    return;
  }
  var total = (opts.total != null) ? opts.total
            : items.reduce(function(s,d){ return s + d.count; }, 0);
  var asPct = opts.pct !== false;
  var s = items.slice().sort(function(a,b){ return a.count - b.count; });   /* ascending: biggest ends on top */
  var vals = s.map(function(d){ return asPct ? +(d.count/Math.max(total,1)*100).toFixed(1) : d.count; });
  var maxV = Math.max.apply(null, vals) || 1;

  /* Size the container to the data. Two competing needs:
     (1) many items with wrapped labels need enough height to not overlap;
     (2) FEW items must not produce giant slab-like bars when a small region
         is selected. We give each row a target band and cap total height so
         bar thickness stays in a sensible range regardless of item count. */
  var wrapped = s.map(function(d){ return codeLabel(d.code, d.label, opts.wrap || 26); });
  var lines = wrapped.reduce(function(a,w){ return a + w.split('<br>').length; }, 0);
  var BAND = 46;                                   /* target vertical band per bar */
  var contentH = lines * 19 + s.length * 14 + 60;  /* room for wrapped labels */
  var bandH    = s.length * BAND + 50;             /* room that keeps bars slim */
  /* use whichever is larger so labels never overlap, but cap so a 2-bar chart
     doesn't stretch a bar to fill 300px of height */
  var h = Math.max(opts.minH || 160, Math.min(Math.max(contentH, bandH), 620));
  el.style.height = h + 'px';

  drawChart(id, [{
    type:'bar', orientation:'h',
    y: wrapped,
    x: vals,
    customdata: s.map(function(d){
      return [ (d.code ? d.code + ' · ' : '') + d.label, d.count,
               total ? +(d.count/total*100).toFixed(1) : 0 ];
    }),
    marker:{ color: opts.color || s.map(function(d){ return d.color || PAL.teal; }),
             line:{ width:0 } },
    text: s.map(function(d,i){ return asPct ? vals[i] + '%' : fmt(d.count); }),
    textposition:'outside', textfont:{ size:10, color:PAL.mid }, cliponaxis:false,
    hovertemplate:'<b>%{customdata[0]}</b><br>' +
                  '%{customdata[1]:,} postings<br>' +
                  '%{customdata[2]:.1f}% of ' + (opts.ofWhat || 'postings') +
                  '<extra></extra>'
  }], {
    xaxis: axV({ showticklabels:false, range:[0, maxV * 1.18] }),
    yaxis: axC({ tickfont:{ size: opts.tick || 10, color:PAL.mid } }),
    bargap: s.length <= 3 ? 0.62 : (s.length <= 5 ? 0.5 : (s.length <= 8 ? 0.38 : 0.28)),
    margin:{ l:8, r: opts.rightPad || 56, t:10, b:8 }
  }, {
    title: opts.title || id,
    cols: ['Code','Name','Postings','Share of ' + (opts.ofWhat || 'postings') + ' (%)'],
    rows: s.slice().reverse().map(function(d){
      return [ d.code || '', d.label, d.count, total ? +(d.count/total*100).toFixed(1) : 0 ];
    })
  });
}

function renderAlert(rows){
  var total=rows.length, ic={}, isicc={};
  rows.forEach(function(r){ var l=DATA.lookup.isco4[r[4]]; if(l&&l!=='Other') ic[l]=(ic[l]||0)+1; });
  rows.forEach(function(r){ if(r[1]>=0){ var c=DATA.lookup.isic[r[1]]; isicc[c]=(isicc[c]||0)+1; } });
  var tr = topKeyOf(ic)||'N/A', te = topKeyOf(isicc)||'N/A';
  var el=document.getElementById('ov-alert');
  if(el) el.innerHTML='<b>Key finding:</b> Germany\'s '+esc(APP.sector.label.toLowerCase())+
    ' sector posted <b>'+fmt(total)+' vacancies</b> over the '+esc(DATA.meta.dateRange||'collection')+' window. '+
    'Most-advertised occupation: <b>'+esc(tr)+'</b>. Largest hiring sector: <b>'+esc(te)+'</b>. '+
    'All figures reflect the current header filters (state, employer type, duplicate Job IDs, unclear categories).';
}
function topKeyOf(o){ var b=null,n=-1; for(var k in o) if(o[k]>n){n=o[k];b=k;} return b; }

/* ======= TOP 10 =========================================================== */
function renderTop10(rows){
  var total=rows.length, c={};
  rows.forEach(function(r){ var l=DATA.lookup.isco4[r[4]]; if(l&&l!=='Other') c[l]=(c[l]||0)+1; });
  var items=Object.keys(c).map(function(k){
    return { label:k, code:(DATA.isco4CodeByName&&DATA.isco4CodeByName[k])||'', count:c[k] };
  }).sort(function(a,b){return b.count-a.count;}).slice(0,10);
  hBar('chart-top10', items, { total:total, color:PAL.teal, wrap:48,
       ofWhat:'postings', title:'Top 10 occupations by demand share' });
}

/* ======= EMPLOYER BAR ===================================================== */
function renderIsicBar(rows){
  var total=rows.length, c={};
  rows.forEach(function(r){ if(r[1]>=0){ var cat=DATA.lookup.isic[r[1]]; c[cat]=(c[cat]||0)+1; } });
  var items=Object.keys(c).map(function(k){ return { label:k, count:c[k], color:isicColor(k) }; })
    .sort(function(a,b){ return b.count-a.count; }).slice(0,10);
  hBar('chart-isic', items, { total:total, wrap:48,
       ofWhat:'postings', title:'Top 10 '+catPL()+' by postings' });
}

/* ======= OVERVIEW REGIONS ================================================= */
function renderOverviewRegions(rows){
  var total=rows.length, c={};
  rows.forEach(function(r){ if(r[0]>=0){ var st=DATA.lookup.states[r[0]]; c[st]=(c[st]||0)+1; } });
  var ranked=rankOf(c,total).slice(0,10);
  pareto('ov-region-pareto', ranked, total, 'Regions ranked by posting volume');
}

/* ======= CROSS-TAB ======================================================== */
function renderCrossTab(rows){
  /* Percentage grid: rows are the leading ISCO-4 occupations, columns the top
     employer sectors; each cell shows what share of that occupation's postings
     the sector accounts for. Sized generously so nothing is cramped. */
  var grps = DATA.roleGroups.map(function(g){ return { code:g.code, idx:g.idx, name:g.name }; });
  var matrix={}, totals={}, catCount={};
  grps.forEach(function(g){ matrix[g.code]={}; totals[g.code]=0; });
  rows.forEach(function(r){
    if(r[1]<0) return;
    var g=grps.find(function(x){return x.idx===r[4];}); if(!g) return;
    var cat=DATA.lookup.isic[r[1]];
    matrix[g.code][cat]=(matrix[g.code][cat]||0)+1;
    totals[g.code]++;
    catCount[cat]=(catCount[cat]||0)+1;
  });
  var cats=Object.keys(catCount).sort(function(a,b){ return catCount[b]-catCount[a]; }).slice(0,8);

  var el=document.getElementById('chart-cross');
  /* Keep cells a sensible height whether there are 2 rows or 6: floor stops a
     tiny selection from collapsing, ceiling stops it stretching absurdly. */
  if(el) el.style.height = Math.min(560, Math.max(300, grps.length * 64 + 190)) + 'px';
  var order=grps.slice().reverse();
  var z=order.map(function(g){ return cats.map(function(c){
        var n=matrix[g.code][c]||0;
        return totals[g.code] ? +(n/totals[g.code]*100).toFixed(1) : 0; }); });
  var custom=order.map(function(g){ return cats.map(function(c){
        var n=matrix[g.code][c]||0;
        var pc=totals[g.code] ? +(n/totals[g.code]*100).toFixed(1) : 0;
        return [g.name, c, n, pc]; }); });
  var txt=z.map(function(row){ return row.map(function(v){ return v>=1 ? v+'%' : ''; }); });

  drawChart('chart-cross', [{
    type:'heatmap', z:z,
    x:cats.map(function(c){ return wrapLabel(c,16); }),
    y:order.map(function(g){ return wrapLabel(g.name,24); }),
    customdata:custom, colorscale:SEQ, xgap:4, ygap:4,
    text:txt, texttemplate:'%{text}', textfont:{size:11, color:'#123'},
    hovertemplate:'<b>%{customdata[0]}</b><br>%{customdata[1]}<br>%{customdata[2]:,} postings \u00b7 %{customdata[3]}% of this occupation<extra></extra>',
    colorbar:{title:{text:'% of occupation',font:{size:9}},thickness:10,len:0.8,tickfont:{size:9},outlinewidth:0}
  }], {
    xaxis:{tickangle:0,tickfont:{size:10,color:'#2A3535'},fixedrange:true,automargin:true},
    yaxis:{automargin:true,tickfont:{size:10.5,color:'#2A3535'},fixedrange:true},
    margin:{l:8,r:8,t:10,b:8}
  },
  {title:catC()+' by workforce group (% of occupation)',
   cols:['Occupation'].concat(cats),
   rows:grps.map(function(g){ return [g.name].concat(cats.map(function(c){
     var n=matrix[g.code][c]||0;
     return totals[g.code] ? +(n/totals[g.code]*100).toFixed(1) : 0; })); })});
}
function wrapName(n){
  var w=n.split(' '); if(w.length<2) return n;
  var mid=Math.ceil(w.length/2);
  return w.slice(0,mid).join(' ')+'<br>'+w.slice(mid).join(' ');
}

/* ======= TREND CHART ====================================================== */
function renderTrend(rows){
  var wl=DATA.lookup.weekLabels;
  var el=document.getElementById('chart-trend');
  if(!wl.length){ if(el) el.innerHTML='<p class="chart-empty">No dated postings are available, so a weekly trend cannot be drawn.</p>'; return; }
  /* top ISCO-2 groups present (up to 5) */
  var c2={}; rows.forEach(function(r){ if(r[2]>0) c2[r[2]]=(c2[r[2]]||0)+1; });
  var groups=Object.keys(c2).map(function(k){return parseInt(k,10);})
    .sort(function(a,b){return c2[b]-c2[a];}).slice(0,5);
  var series={};
  var traces=groups.map(function(i2,gi){
    var y=Array(wl.length).fill(0);
    rows.forEach(function(r){ if(r[2]===i2 && r[7]>=0) y[r[7]]++; });
    var nm=(typeof ISCO2_NAMES!=='undefined'&&ISCO2_NAMES[i2])||(typeof ISCO2_OFFICIAL!=='undefined'&&ISCO2_OFFICIAL[i2])||('Group '+i2);
    series[nm]=y;
    var col=TREND_COLS[gi%TREND_COLS.length];
    return {x:wl,y:y,type:'scatter',mode:'lines+markers',name:nm,
      line:{color:col,width:2.5,shape:'spline'},marker:{color:col,size:5},
      fill:'tozeroy',fillcolor:col+'14',
      customdata:wl.map(function(w,wi){ return [nm, w, y[wi]]; }),
      hovertemplate:'<b>'+nm+'</b>: %{y:,d} postings<extra></extra>'};
  });
  drawChart('chart-trend',traces,{
    hovermode:'x unified',
    showlegend:true,
    xaxis:{showgrid:false,tickfont:{size:10,color:PAL.mid},fixedrange:true,showspikes:true,
           spikethickness:1,spikedash:'dot',spikecolor:PAL.soft,spikemode:'across'},
    yaxis:axV({title:{text:'Postings per week',font:{size:10,color:PAL.soft}},zeroline:true,zerolinecolor:PAL.line}),
    legend:{orientation:'h',y:-0.34,font:{size:9.5,color:PAL.mid},bgcolor:'rgba(0,0,0,0)'},
    margin:{l:48,r:8,t:12,b:84}},
    {title:'Weekly posting volume by workforce group',
     cols:['Week starting'].concat(Object.keys(series)),
     rows:wl.map(function(w,i){ return [w].concat(Object.keys(series).map(function(k){return series[k][i];})); })});
}

/* ======= ROLE TAB (dynamic) =============================================== */
function buildRoleTab(){
  var nav=document.getElementById('role-sub-nav');
  var wrap=document.getElementById('role-panels');
  nav.innerHTML=''; wrap.innerHTML='';
  DATA.roleGroups.forEach(function(g,i){
    var b=document.createElement('button');
    b.className='sub-btn'+(i===0?' active':'');
    b.textContent=g.name;
    b.onclick=function(){ showRole(g.code,b); };
    nav.appendChild(b);

    var p=document.createElement('div');
    p.className='sub-panel'+(i===0?' active':'');
    p.id='role-panel-'+g.code;
    p.innerHTML=
      '<div class="insight-box" id="role-insight-'+g.code+'"></div>'+
      '<div class="kpi-row">'+
        '<div class="kpi-card"><div class="kpi-accent" style="background:#1A7B7A"></div><div class="kpi-body" id="rk1-'+g.code+'"></div></div>'+
        '<div class="kpi-card"><div class="kpi-accent" style="background:#2D9B9A"></div><div class="kpi-body" id="rk2-'+g.code+'"></div></div>'+
        '<div class="kpi-card"><div class="kpi-accent" style="background:#D4940A"></div><div class="kpi-body" id="rk3-'+g.code+'"></div></div>'+
        '<div class="kpi-card"><div class="kpi-accent" style="background:#0F5B5A"></div><div class="kpi-body" id="rk4-'+g.code+'"></div></div>'+
      '</div>'+
      '<div class="grid-2" style="grid-template-columns:3fr 2fr">'+
        '<div class="card card-t"><div class="card-head">Top Advertised Job Titles</div>'+
          '<div class="card-sub">This occupation is a single four-digit ISCO-08 unit group \u2014 the most specific level of the classification. The bars below show the job titles employers actually advertise inside it, as a % of the occupation\u2019s postings.</div>'+
          '<div class="card-body"><div id="rc-top-'+g.code+'"></div></div></div>'+
        '<div class="card card-g"><div class="card-head">Contract Type</div>'+
          '<div class="card-sub">Distribution of employment arrangements</div>'+
          '<div class="card-body"><div id="rc-emp-'+g.code+'"></div></div>'+
          '<div class="card-head" style="margin-top:4px">'+catPC()+'</div>'+
          '<div class="card-sub">Which '+catPL()+' advertise for this occupation</div>'+
          '<div class="card-body"><div id="rc-isic-'+g.code+'"></div></div></div>'+
      '</div>'+
      '<div class="card card-b"><div class="card-head">Top Hiring Companies</div>'+
        '<div class="card-sub">Employers with the most openings (all states). Colour indicates '+catL()+'.</div>'+
        '<div class="card-body"><div id="rc-cos-'+g.code+'" style="height:330px"></div></div></div>'+
      '<div class="card card-g" style="margin-top:14px"><div class="card-head">Top 10 Employers &amp; Top 10 '+catPC()+'</div>'+
        '<div class="card-sub">Leading hiring organisations within each '+catL()+' for this occupation</div>'+
        '<div class="tbl-wrap" id="rc-empbysec-'+g.code+'"></div></div>';
    wrap.appendChild(p);
  });
  APP.activeRole = DATA.roleGroups.length ? DATA.roleGroups[0].code : null;
}

function showRole(code, btn){
  document.querySelectorAll('#tab-roles .sub-btn').forEach(function(b){ b.classList.remove('active'); });
  document.querySelectorAll('#tab-roles .sub-panel').forEach(function(p){ p.classList.remove('active'); });
  if(btn) btn.classList.add('active');
  var p=document.getElementById('role-panel-'+code); if(p) p.classList.add('active');
  APP.activeRole=code;
  renderRoleTab(getRows(), code);
}

function renderRoleTab(rows, code){
  if(code==null) return;
  var g = DATA.roleGroups.find(function(x){return x.code===code;}); if(!g) return;
  var sub=rows.filter(function(r){return r[4]===g.idx;}), tot=sub.length, allTot=rows.length;
  var meta=(typeof ROLE_META!=='undefined' && ROLE_META[code]) ? ROLE_META[code] : null;

  var el=document.getElementById('role-insight-'+code);
  if(el) el.innerHTML='<b>'+esc(g.name)+'</b> — <b>'+fmt(tot)+' postings</b> ('+pct(tot,allTot)+'% of all '+
    esc(APP.sector.label.toLowerCase())+' demand). '+(meta?meta.desc:'');

  var pt=sub.filter(function(r){return PT_IDX[r[5]];}).length;
  var isicc={}; sub.forEach(function(r){ if(r[1]>=0){ var c=DATA.lookup.isic[r[1]]; isicc[c]=(isicc[c]||0)+1; } });
  var topEmp=topKeyOf(isicc)||'N/A';
  var stc={}; sub.forEach(function(r){ if(r[0]>=0){ var s=DATA.lookup.states[r[0]]; stc[s]=(stc[s]||0)+1; } });
  var topSt=topKeyOf(stc)||'N/A';
  kpi('rk1-'+code, pct(tot,allTot)+'%','Share of All Postings', fmt(tot)+' of '+fmt(allTot)+' total postings');
  kpi('rk2-'+code, pct(pt,tot)+'%','Open to Part-time','Flexible or part-time arrangements accepted');
  kpi('rk3-'+code, topEmp,'Top '+catC(),'Largest '+catL()+' for this occupation');
  kpi('rk4-'+code, topSt,'Top State','Highest posting volume state for this group');

  /* Advertised job titles inside this ISCO-4 occupation */
  ensureIdx();
  var tc={}; sub.forEach(function(r){
    var t=(DATA.raw.title[_rowToIdx.get(r)]||'').trim();
    if(t && t!=='\u2014') tc[t]=(tc[t]||0)+1;
  });
  var items4=Object.keys(tc).map(function(k){ return { label:k, count:tc[k] }; })
    .sort(function(a,b){return b.count-a.count;}).slice(0,10);
  hBar('rc-top-'+code, items4, { total:tot, color:g.color, wrap:30,
       ofWhat:'postings in this occupation', title:g.name+' \u2014 top advertised titles' });

  /* Contract type */
  var ec={}; sub.forEach(function(r){ ec[r[5]]=(ec[r[5]]||0)+1; });
  var itemsE=DATA.lookup.empTypes.map(function(l,i){
    return { label:l, count:ec[i]||0, color:C.emp[i%C.emp.length] };
  }).filter(function(d){return d.count>0;});
  hBar('rc-emp-'+code, itemsE, { total:tot, wrap:22,
       ofWhat:'postings in this occupation', title:g.name+' \u2014 contract type' });

  /* Employer sectors */
  var itemsS=Object.keys(isicc).map(function(k){
    return { label:k, count:isicc[k], color:isicColor(k) };
  }).sort(function(a,b){ return b.count-a.count; }).slice(0,10);
  hBar('rc-isic-'+code, itemsS, { total:tot, wrap:24,
       ofWhat:'postings in this occupation', title:g.name+' \u2014 '+catPL() });

  /* Top companies (pre-computed) */
  var cos=(DATA.companies[String(code)]||[]).slice(0,15).map(function(d){
    return { label:d.name, count:d.count, color:isicColor(d.isic) };
  });
  hBar('rc-cos-'+code, cos, { total:tot, pct:false, wrap:26, tick:9.5,
       ofWhat:'postings in this group', title:g.name+' — top employers' });

  renderEmployersBySector(code);
}

function renderEmployersBySector(code){
  var el=document.getElementById('rc-empbysec-'+code); if(!el) return;
  var bySector=(DATA.sectorEmployers && DATA.sectorEmployers[String(code)]) || {};
  var cos=(DATA.companies[String(code)]||[]);
  if(!cos.length && !Object.keys(bySector).length){
    el.innerHTML='<p style="padding:12px;color:#7A9C9C;font-size:11px">No employer data available.</p>'; return;
  }

  /* Table A \u2014 the ten most active employers for this occupation, flat. */
  var html='<div class="card-head" style="padding-left:0;font-size:12px">Top 10 Employers</div>'+
    '<table class="data-tbl" style="margin-bottom:16px"><thead><tr>'+
    '<th style="width:28px;text-align:center">#</th><th>Employer</th><th>'+catC()+'</th>'+
    '<th style="text-align:right">Postings</th></tr></thead><tbody>';
  cos.slice(0,10).forEach(function(e,i){
    html+='<tr><td style="color:#7A9C9C;font-size:10px;text-align:center">'+(i+1)+'</td>'+
      '<td><b>'+esc(e.name)+'</b></td><td style="color:'+isicColor(e.isic)+'">'+esc(e.isic||'\u2014')+'</td>'+
      '<td class="cnt" style="text-align:right">'+fmt(e.count)+'</td></tr>';
  });
  html+='</tbody></table>';

  /* Table B \u2014 the ten largest sectors for this occupation, three employers each. */
  var sectors=Object.keys(bySector).filter(function(s2){ return bySector[s2]&&bySector[s2].length>0; })
    .sort(function(a,b){
      var sa=bySector[a].reduce(function(x,e){return x+e.count;},0);
      var sb=bySector[b].reduce(function(x,e){return x+e.count;},0);
      return sb-sa;
    }).slice(0,10);
  html+='<div class="card-head" style="padding-left:0;font-size:12px">Top 10 '+catPC()+' \u00b7 leading employers in each</div>'+
    '<table class="data-tbl"><thead><tr>'+
    '<th style="width:36%">'+catC()+'</th><th style="width:28px;text-align:center">#</th>'+
    '<th>Employer</th><th style="text-align:right">Postings</th></tr></thead><tbody>';
  sectors.forEach(function(sector){
    var emps=(bySector[sector]||[]).slice(0,3), col=isicColor(sector);
    emps.forEach(function(e,i){
      html+='<tr>';
      if(i===0) html+='<td rowspan="'+emps.length+'" style="font-weight:600;color:'+col+';vertical-align:middle;border-left:3px solid '+col+'">'+esc(sector)+'</td>';
      html+='<td style="color:#7A9C9C;font-size:10px;text-align:center">'+(i+1)+'</td>'+
        '<td>'+esc(e.name)+'</td><td class="cnt" style="text-align:right">'+fmt(e.count)+'</td></tr>';
    });
  });
  el.innerHTML=html+'</tbody></table>';
}

/* ======= MAP ============================================================== */
var geoJSON=null;
function initMap(){
  if(APP.mapInit) return; APP.mapInit=true;
  if(!APP.region || !APP.region.geojson){ document.getElementById('geo-insight').textContent='No map configured for this region.'; return; }
  fetch(APP.region.geojson).then(function(r){return r.json();})
    .then(function(d){ geoJSON=d; renderMap(); })
    .catch(function(){ document.getElementById('geo-insight').textContent='Map unavailable offline. Use the bar chart and table below.'; });
}
function renderMap(){
  if(!geoJSON) return;
  if(APP.leafletMap){ APP.leafletMap.remove(); APP.leafletMap=null; }
  var reg=APP.region, nameMap=reg.nameMap||{};
  APP.leafletMap=L.map('geo-map',{zoomControl:false}).setView(reg.center||[51.2,10.4], reg.zoom||5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    {attribution:'&copy; CartoDB',opacity:0.55}).addTo(APP.leafletMap);
  var geo=DATA.stateGeo;
  var maxHC=Math.max.apply(null, Object.keys(geo).map(function(k){return geo[k].hc;}).concat([1]));
  function getCol(hc){ var t=hc/maxHC;
    return 'rgb('+Math.round(229-t*214)+','+Math.round(242-t*151)+','+Math.round(242-t*152)+')'; }
  L.geoJSON(geoJSON,{
    style:function(f){ var en=nameMap[f.properties.name], d=en&&geo[en];
      return {fillColor:d?getCol(d.hc):'#F0F4F4',fillOpacity:0.85,color:'white',weight:1.5}; },
    onEachFeature:function(f,layer){
      var en=nameMap[f.properties.name], d=en&&geo[en];
      if(d){
        var rh=d.topRoles.map(function(r,i){return '<div style="margin-bottom:2px">'+(i+1)+'. '+esc(r)+'</div>';}).join('');
        layer.bindTooltip(
          '<div style="font-family:Outfit,sans-serif;min-width:210px">'+
          '<div style="font-size:14px;font-weight:700;color:#0F5B5A;border-bottom:2px solid #D4940A;padding-bottom:5px;margin-bottom:8px">'+esc(en)+'</div>'+
          '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:#3D6060">Vacancies</span><b style="color:#1A7B7A;font-size:15px">'+d.hc.toLocaleString('en-US')+'</b></div>'+
          '<div style="font-size:9px;font-weight:700;color:#7A9C9C;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Top Roles</div>'+rh+
          '<div style="font-size:9px;font-weight:700;color:#7A9C9C;text-transform:uppercase;margin:8px 0 3px">Top '+catC()+'</div>'+
          '<div style="color:#D4940A;font-weight:600">'+esc(d.topEmp)+'</div></div>',
          {sticky:false,direction:'auto'});
        layer.on('mouseover',function(){ this.setStyle({weight:3,color:'#D4940A',fillOpacity:0.95}); });
        layer.on('mouseout', function(){ this.setStyle({weight:1.5,color:'white',fillOpacity:0.85}); });
        /* click pins the same info with a Copy button (shared card from chart-kit) */
        layer.on('click', function(ev){
          if (typeof showCopyCard === 'function'){
            var lines=[en, d.hc.toLocaleString('en-US')+' postings',
                       'Top roles: '+d.topRoles.join('; '),
                       'Top '+catL()+': '+d.topEmp];
            showCopyCard(lines, ev.originalEvent);
            if (ev.originalEvent) ev.originalEvent.stopPropagation();
          }
        });
      }
    }
  }).addTo(APP.leafletMap);
  var leg=L.control({position:'bottomright'});
  leg.onAdd=function(){ var d=L.DomUtil.create('div');
    d.style.cssText='background:white;padding:10px 14px;border-radius:8px;font-family:Outfit,sans-serif;font-size:11px;border:1px solid #D4E5E5;box-shadow:0 2px 8px rgba(15,46,46,.1)';
    d.innerHTML='<b style="color:#0F2E2E">Vacancies</b><br><div style="display:flex;align-items:center;gap:6px;margin-top:6px"><div style="width:80px;height:12px;background:linear-gradient(to right,#E5F2F2,#0F5B5A);border-radius:2px"></div></div><div style="display:flex;justify-content:space-between;width:80px;font-size:9px;color:#7A9C9C;margin-top:2px"><span>Low</span><span>High</span></div>';
    return d; };
  leg.addTo(APP.leafletMap);
  var el=document.getElementById('geo-insight');
  var tot=Object.keys(geo).reduce(function(s,k){return s+geo[k].hc;},0);
  var top=Object.keys(geo).map(function(k){return [k,geo[k].hc];}).sort(function(a,b){return b[1]-a[1];})[0];
  if(el&&top) el.innerHTML='<b>Geographic coverage:</b> '+fmt(tot)+' postings have state-level location data across '+
    Object.keys(geo).length+' '+(reg.unit||'regions')+'. <b>Hover each state</b> to view top roles and leading '+catL()+'. Leading state: <b>'+esc(top[0])+'</b> with '+fmt(top[1])+' openings.';
}

/* ======= STATE BAR & TABLE ================================================ */
function renderStateBar(rows){
  var c={}; rows.forEach(function(r){ if(r[0]>=0){ var s=DATA.lookup.states[r[0]]; c[s]=(c[s]||0)+1; } });
  var tot=rows.length;
  var items=Object.keys(c).map(function(k){ return { label:k, count:c[k] }; });
  hBar('chart-states', items, { total:tot, color:PAL.teal, wrap:22,
       ofWhat:'postings', title:'States ranked by demand' });
}
function renderStateTable(rows){
  var sc={}, si2={};
  rows.forEach(function(r){
    if(r[0]<0) return;
    var s=DATA.lookup.states[r[0]]; sc[s]=(sc[s]||0)+1;
    if(r[1]>=0){ if(!si2[s]) si2[s]={}; var ic=DATA.lookup.isic[r[1]]; si2[s][ic]=(si2[s][ic]||0)+1; }
  });
  var tot=rows.length, sorted=Object.keys(sc).map(function(k){return [k,sc[k]];}).sort(function(a,b){return b[1]-a[1];});
  var html='<table class="data-tbl"><thead><tr><th>State</th><th>Postings</th><th>% of Total</th><th>Top '+catC()+'</th></tr></thead><tbody>';
  sorted.forEach(function(pair){
    var s=pair[0], n=pair[1];
    var te=si2[s]?topKeyOf(si2[s]):'N/A';
    html+='<tr><td><b>'+esc(s)+'</b></td><td class="cnt">'+fmt(n)+'</td><td>'+pct(n,tot)+'%</td><td>'+esc(te)+'</td></tr>';
  });
  document.getElementById('state-table').innerHTML=html+'</tbody></table>';
}

/* ======= DATA EXPLORER ==================================================== */
var EXP_PAGE=0, EXP_SEARCH='', EXP_PS=50, _rowToIdx=null;

/* Maps a row array back to its index so the raw text columns can be read. */
function ensureIdx(){
  if(!_rowToIdx){ _rowToIdx=new Map(); DATA.rows.forEach(function(r,i){ _rowToIdx.set(r,i); }); }
}


/* ---- ISIC Rev.4 reference guide: what businesses each category includes.
   Keyed by 4-digit ISIC code; based on the official explanatory notes. ------ */
var ISIC_GUIDE = {
 '55':'Hotels, motels, inns, guesthouses, hostels, holiday and other short-stay accommodation, camping grounds',
 '56':'Restaurants, cafés, bars, pubs, fast food, event catering, canteens and contract catering',
 '47':'All retail: supermarkets, food shops, bakery and butcher counters, department and specialised stores',
 '46':'Wholesalers of food, beverages, household goods and other merchandise supplying the trade',
 '45':'Car and motorcycle dealers, vehicle workshops and repair, parts retail',
 '10':'Food manufacturing: bakeries, meat and dairy processing, confectionery, prepared meals',
 '11':'Beverage producers: breweries, wineries, soft drinks and mineral waters',
 '88':'Non-residential social work: visiting care, day-care and home help for the elderly and disabled, family services',
 '87':'Residential care homes and nursing facilities with accommodation',
 '86':'Hospitals, medical and dental practices, physiotherapy, laboratories, ambulance services',
 '85':'Schools, universities, vocational training, tutoring and educational support',
 '84':'Public administration: municipal and government bodies, social security institutions',
 '63':'Information services including web portals, job boards and data processing/hosting',
 '62':'Software development, IT consultancy and computer facilities management',
 '61':'Telecommunications operators',
 '58':'Publishers of newspapers, journals, books and software',
 '78':'Employment services: temporary work agencies (Zeitarbeit), recruitment and placement firms',
 '71':'Architecture and engineering offices, technical testing and inspection',
 '70':'Company head offices and management consultancy',
 '69':'Law firms, accountants, auditors and tax advisers',
 '68':'Real estate: property management, letting, estate agencies',
 '64':'Banks and other financial institutions',
 '65':'Insurance and pension funding companies',
 '66':'Financial brokerage, fund management and other auxiliary financial services',
 '41':'Building construction companies and property developers',
 '42':'Civil engineering: roads, railways, utility networks',
 '43':'Specialised construction trades: electrical, plumbing, joinery, finishing, roofing',
 '49':'Land transport: rail, bus, tram, taxi, road haulage and pipelines',
 '52':'Warehousing, logistics hubs and support services for transportation',
 '53':'Postal and courier services',
 '35':'Electricity, gas, steam and air-conditioning utilities',
 '38':'Waste collection, treatment, disposal and recycling',
 '93':'Sports facilities, gyms, amusement parks and recreation services',
 '90':'Theatres, performing arts and entertainment production',
 '91':'Libraries, archives, museums and cultural institutions',
 '92':'Gambling and betting operators',
 '94':'Membership organisations: chambers, unions, religious and civic bodies',
 '81':'Facility services: cleaning, building support, landscaping',
 '82':'Office administrative and business support services, call centres',
 '79':'Travel agencies, tour operators and reservation services',
 '80':'Security and investigation services',
 '96':'Other personal services: hairdressing, laundry, wellness',
 '95':'Repair of computers and personal and household goods',
 '77':'Rental and leasing of vehicles, machinery and goods',
 '72':'Scientific research and development institutes',
 '73':'Advertising agencies and market research',
 '74':'Design, photography, translation and other professional services',
 '75':'Veterinary practices'
};

function renderIsicGuide(){
  var el=document.getElementById('explorer-isic-guide'); if(!el) return;
  var rows=getRows(), c={};
  rows.forEach(function(r){ if(r[1]>=0){ var n=DATA.lookup.isic[r[1]]; c[n]=(c[n]||0)+1; } });
  var names=Object.keys(c).sort(function(a,b){ return c[b]-c[a]; });
  var html='<table class="data-tbl"><thead><tr><th>Employer Sector</th><th>Postings</th><th style="min-width:280px">Includes</th></tr></thead><tbody>';
  names.forEach(function(name){
    var code=(DATA.isicCodeByName&&DATA.isicCodeByName[name])||'';   /* internal lookup only, never displayed */
    var desc=(code&&ISIC_GUIDE[String(code)])||'\u2014';
    html+='<tr><td><b>'+esc(name)+'</b></td>'+
      '<td class="cnt">'+fmt(c[name])+'</td><td style="font-size:11px;color:#3A4A4A">'+esc(desc)+'</td></tr>';
  });
  el.innerHTML=html+'</tbody></table>';
}

function renderExplorer(){
  /* The Data Explorer carries only the full posting-level table; the summary
     views live in the Classifications tab. */
  renderFullTable();
}

function renderSummaries(){
  /* Occupation summary at the four-digit ISCO-4 level, respecting active filters. */
  var rows=getRows(), agg={};
  rows.forEach(function(r){
    if (r[4]<0) return;
    var name=DATA.lookup.isco4[r[4]];
    var a=agg[name]=agg[name]||{count:0,pt:0,emps:{},states:{}};
    a.count++;
    var et=DATA.lookup.empTypes[r[5]]||'';
    if (/part-time/i.test(et)) a.pt++;
    if (r[1]>=0){ var e=DATA.lookup.isic[r[1]]; a.emps[e]=(a.emps[e]||0)+1; }
    if (r[0]>=0){ var st=DATA.lookup.states[r[0]]; a.states[st]=(a.states[st]||0)+1; }
  });
  function topK(o){ var b=null,n=-1; for(var k in o){ if(o[k]>n){n=o[k];b=k;} } return b||'\u2014'; }
  var names=Object.keys(agg).sort(function(a,b){ return agg[b].count-agg[a].count; });
  var html='<table class="data-tbl"><thead><tr><th>Occupation (ISCO-4)</th><th>Code</th><th>Total Postings</th><th>% Open to Part-time</th><th>Top '+catC()+'</th><th>Top State</th></tr></thead><tbody>';
  names.forEach(function(name){
    var a=agg[name];
    var ptPct=a.count?+(a.pt/a.count*100).toFixed(1):0;
    var code=(DATA.isco4CodeByName&&DATA.isco4CodeByName[name])||'\u2014';
    html+='<tr><td><b>'+esc(name)+'</b></td><td><span class="badge">'+esc(String(code))+'</span></td><td class="cnt">'+fmt(a.count)+'</td><td class="'+(ptPct>60?'gld':'')+'">'+ptPct+'%</td><td>'+esc(topK(a.emps))+'</td><td>'+esc(topK(a.states))+'</td></tr>';
  });
  document.getElementById('explorer-table').innerHTML=html+'</tbody></table>';

}

function renderSectorSummary(){
  var rows=getRows();
  function topK(o){ var b=null,n=-1; for(var k in o){ if(o[k]>n){n=o[k];b=k;} } return b||'\u2014'; }
  /* Employer sector summary at the ISIC-2 level. */
  var sAgg={};
  rows.forEach(function(r){
    if (r[1]<0) return;
    var name=DATA.lookup.isic[r[1]];
    var a=sAgg[name]=sAgg[name]||{count:0,pt:0,occ:{},states:{}};
    a.count++;
    var et=DATA.lookup.empTypes[r[5]]||'';
    if (/part-time/i.test(et)) a.pt++;
    if (r[4]>=0){ var o=DATA.lookup.isco4[r[4]]; a.occ[o]=(a.occ[o]||0)+1; }
    if (r[0]>=0){ var st=DATA.lookup.states[r[0]]; a.states[st]=(a.states[st]||0)+1; }
  });
  var sNames=Object.keys(sAgg).sort(function(a,b){ return sAgg[b].count-sAgg[a].count; });
  var el2=document.getElementById('explorer-isic-table');
  if (el2){
    var h2='<table class="data-tbl"><thead><tr><th>Employer Sector</th><th>ISIC-2 Code</th><th>Total Postings</th><th>% Open to Part-time</th><th>Top Occupation (ISCO-4)</th><th>Top State</th></tr></thead><tbody>';
    sNames.forEach(function(name){
      var a=sAgg[name];
      var ptPct=a.count?+(a.pt/a.count*100).toFixed(1):0;
      var code=(DATA.isicCodeByName&&DATA.isicCodeByName[name])||'\u2014';
      h2+='<tr><td><b>'+esc(name)+'</b></td><td><span class="badge badge-g">'+esc(String(code))+'</span></td><td class="cnt">'+fmt(a.count)+'</td><td class="'+(ptPct>60?'gld':'')+'">'+ptPct+'%</td><td>'+esc(topK(a.occ))+'</td><td>'+esc(topK(a.states))+'</td></tr>';
    });
    el2.innerHTML=h2+'</tbody></table>';
  }
}
function explorerSearch(){ EXP_SEARCH=document.getElementById('exp-search').value.toLowerCase(); EXP_PAGE=0; renderFullTable(); }

function renderFullTable(){
  ensureIdx();
  var rows=getRows();
  var R=DATA.raw;
  var decoded=rows.map(function(r){
    var i=_rowToIdx.get(r);
    return {
      title:R.title[i]||'', date:R.date[i]||'', company:R.company[i]||'',
      empCat:R.empCat[i]||'', salary:R.salary[i]||'', desc:R.desc[i]||'',
      req:R.req[i]||'', benefits:R.benefits[i]||'', workType:R.workType[i]||'', url:R.url[i]||'',
      state:r[0]>=0?DATA.lookup.states[r[0]]:'',
      isic:r[1]>=0?DATA.lookup.isic[r[1]]:'',
      grp:(typeof ISCO3_NAMES!=='undefined'&&ISCO3_NAMES[r[3]])||(r[3]?'ISCO '+r[3]:''),
      occ:(r[4]>=0?DATA.lookup.isco4[r[4]]:null)||'Other',
      empType:DATA.lookup.empTypes[r[5]]||''
    };
  });
  if(EXP_SEARCH){
    var q=EXP_SEARCH;
    decoded=decoded.filter(function(d){
      return d.title.toLowerCase().indexOf(q)>=0 || d.state.toLowerCase().indexOf(q)>=0 ||
        d.grp.toLowerCase().indexOf(q)>=0 || d.occ.toLowerCase().indexOf(q)>=0 ||
        d.company.toLowerCase().indexOf(q)>=0 || d.isic.toLowerCase().indexOf(q)>=0 ||
        d.desc.toLowerCase().indexOf(q)>=0 || d.empCat.toLowerCase().indexOf(q)>=0;
    });
  }
  var total=decoded.length, totalPages=Math.max(1,Math.ceil(total/EXP_PS));
  EXP_PAGE=Math.min(EXP_PAGE,totalPages-1);
  var page=decoded.slice(EXP_PAGE*EXP_PS,(EXP_PAGE+1)*EXP_PS);

  var html='<table class="data-tbl" style="min-width:1800px"><thead><tr>'+
    '<th style="min-width:30px">#</th><th style="min-width:200px">Job Title</th>'+
    '<th style="min-width:90px">Date Posted</th><th style="min-width:140px">Company</th>'+
    '<th style="min-width:130px">State</th><th style="min-width:160px">Occupation (ISCO-4)</th>'+
    '<th style="min-width:170px">Occupation (ISCO-4)</th><th style="min-width:150px">'+catC()+'</th>'+
    '<th style="min-width:120px">Listing Type</th><th style="min-width:130px">Contract Type</th>'+
    '<th style="min-width:80px">Salary</th><th style="min-width:80px">Work Type</th>'+
    '<th style="min-width:300px">Description</th><th style="min-width:220px">Requirements</th>'+
    '<th style="min-width:200px">Benefits</th><th style="min-width:60px">URL</th></tr></thead><tbody>';
  page.forEach(function(d,i){
    var rowNum=EXP_PAGE*EXP_PS+i+1;
    html+='<tr>'+
      '<td style="color:#7A9C9C;font-size:10px;white-space:nowrap">'+rowNum+'</td>'+
      '<td><b style="font-size:11px;color:#0F2E2E">'+esc(d.title)+'</b></td>'+
      '<td style="white-space:nowrap;font-size:10px">'+esc(d.date)+'</td>'+
      '<td style="font-size:10px">'+esc(d.company)+'</td>'+
      '<td style="font-size:10px"><b>'+esc(d.state)+'</b></td>'+
      '<td style="color:#1A7B7A;font-size:10px">'+esc(d.occ)+'</td>'+
      '<td style="font-size:10px">'+esc(d.grp)+'</td>'+
      '<td style="font-size:10px">'+esc(d.isic)+'</td>'+
      '<td style="font-size:10px;color:#7A9C9C">'+esc(d.empCat)+'</td>'+
      '<td style="font-size:10px;white-space:nowrap">'+esc(d.empType)+'</td>'+
      '<td style="font-size:10px;color:#D4940A">'+esc(d.salary)+'</td>'+
      '<td style="font-size:10px;white-space:nowrap">'+esc(d.workType)+'</td>'+
      '<td class="desc-cell"><div class="clampy" title="'+esc(d.desc)+'">'+esc(d.desc)+'</div></td>'+
      '<td class="desc-cell"><div class="clampy" title="'+esc(d.req)+'">'+esc(d.req)+'</div></td>'+
      '<td class="desc-cell"><div class="clampy" title="'+esc(d.benefits)+'">'+esc(d.benefits)+'</div></td>'+
      '<td class="link-cell">'+(d.url?'<a href="'+esc(d.url)+'" target="_blank" rel="noopener">View</a>':'')+'</td>'+
      '</tr>';
  });
  document.getElementById('explorer-full').innerHTML=html+'</tbody></table>';

  var navEl=document.getElementById('explorer-nav');
  var btnOn='padding:5px 12px;border:1px solid #D4E5E5;border-radius:6px;background:#fff;font-family:Outfit,sans-serif;font-size:11px;cursor:pointer;color:#1A7B7A;font-weight:600';
  var btnOff='padding:5px 12px;border:1px solid #D4E5E5;border-radius:6px;background:#F2F6F6;font-family:Outfit,sans-serif;font-size:11px;cursor:default;color:#B0C8C8';
  window._expTotalPages=totalPages;
  navEl.innerHTML=
    '<button style="'+(EXP_PAGE===0?btnOff:btnOn)+'" '+(EXP_PAGE===0?'disabled':'')+' onclick="EXP_PAGE=Math.max(0,EXP_PAGE-1);renderFullTable()">Prev</button>'+
    '<span style="color:#3D6060">Page <b>'+(EXP_PAGE+1)+'</b> of <b>'+totalPages+'</b> · <b>'+fmt(total)+'</b> matching postings</span>'+
    '<button style="'+(EXP_PAGE>=totalPages-1?btnOff:btnOn)+'" '+(EXP_PAGE>=totalPages-1?'disabled':'')+' onclick="EXP_PAGE=Math.min(window._expTotalPages-1,EXP_PAGE+1);renderFullTable()">Next</button>';
}

/* ======= CLASSIFICATIONS (ISCO-4 occupations + ISIC-2 sectors, national + regional) === */
var CLS_VIEW='national';
function showClassView(v, btn){
  CLS_VIEW=v;
  document.querySelectorAll('#tab-classify .sub-btn').forEach(function(b){ b.classList.remove('active'); });
  if(btn) btn.classList.add('active');
  ['national','sectors','region'].forEach(function(id){
    var el=document.getElementById('cv-'+id);
    if(el) el.classList.toggle('active', v===id);
  });
  renderClassifications(getRows());
}

function isco3Name(c){ return (typeof ISCO3_NAMES!=='undefined'&&ISCO3_NAMES[c])||(typeof ISCO3_OFFICIAL!=='undefined'&&ISCO3_OFFICIAL[c])||''; }

function renderClassifications(rows){
  if (CLS_VIEW==='national')      renderClassNational(rows);
  else if (CLS_VIEW==='sectors')  renderClassSectors(rows);
  else                            renderClassRegional(rows);
}

function renderClassSectors(rows){
  var total = rows.length;
  /* full employer-sector listing at ISIC-2, mirroring the ISCO-4 treatment */
  var cS={};
  rows.forEach(function(r){ if(r[1]>=0){ var n=DATA.lookup.isic[r[1]]; cS[n]=(cS[n]||0)+1; } });
  var tS=Object.keys(cS).map(function(n){
    return { code:(DATA.isicCodeByName&&DATA.isicCodeByName[n])||'', name:n, count:cS[n] };
  }).sort(function(a,b){ return b.count-a.count; });
  hBar('sector-chart', tS.slice(0,12).map(function(d){ return { label:d.name, count:d.count }; }),
       { total:total, color:C.teal, wrap:40, ofWhat:'postings',
         title:'Employer sectors (ISIC-2) ranked by postings' });
  var hS='<table class="data-tbl"><thead><tr><th>ISIC-2</th><th>Employer Sector</th><th>Postings</th><th>Share</th></tr></thead><tbody>';
  tS.forEach(function(d){
    hS+='<tr><td>'+(d.code?'<span class="badge badge-g">'+esc(String(d.code))+'</span>':'\u2014')+'</td>'+
        '<td><b>'+esc(d.name)+'</b></td><td class="cnt">'+fmt(d.count)+'</td>'+
        '<td class="num">'+pct(d.count,total)+'%</td></tr>';
  });
  document.getElementById('sector-table').innerHTML=hS+'</tbody></table>';
  renderSectorSummary();
  renderIsicGuide();

  /* headline chips for the sector view reuse the shared KPI row? no \u2014 this view has none */
}

function renderClassNational(rows){
  renderSummaries();
  var total = rows.length;

  var c4 = {}, meta4 = {};
  rows.forEach(function(r){
    var nm = r[4]>=0 ? DATA.lookup.isco4[r[4]] : null; if(!nm) return;
    c4[nm] = (c4[nm]||0)+1;
    if(!meta4[nm]) meta4[nm] = { code:(DATA.isco4CodeByName&&DATA.isco4CodeByName[nm])||'' };
  });
  var t4 = Object.keys(c4).map(function(nm){
    return { code:meta4[nm].code, name:nm, count:c4[nm] };
  }).sort(function(a,b){return b.count-a.count;});
  classBar('isco4-chart', t4.slice(0,12), total, C.gold);
  classTable('isco4-table', t4, total, ['ISCO-4','Unit Group','Postings','Share']);

  /* headline classification counts */
  kpi('cls-k1', fmt(t4.length), 'ISCO-4 Unit Groups Found', 'Distinct four-digit occupations identified in the current selection');
  var _secN={}; rows.forEach(function(r){ if(r[1]>=0) _secN[DATA.lookup.isic[r[1]]]=1; });
  kpi('cls-k2', fmt(Object.keys(_secN).length), 'Employer Sectors Found', 'Distinct ISIC-2 employer sectors \u2014 full listing in the Employer Sectors sub-tab');
  kpi('cls-k3', fmt(total), 'Postings Classified', 'Every posting in the selection carries both ISCO levels');
  var top1 = t4[0];
  kpi('cls-k4', top1 ? top1.name : '\u2014', 'Largest Unit Group', top1 ? fmt(top1.count)+' postings \u2014 '+pct(top1.count,total)+'% of the selection' : '');
}

/* ---- regional classification -------------------------------------------- */
function renderClassRegional(rows){
  /* aggregate at the ISCO-4 level: state -> occ -> count, and occ -> state -> count */
  var byState={}, byOcc={}, stateTot={}, occTot={};
  rows.forEach(function(r){
    if(r[0]<0 || r[4]<0) return;
    var st=DATA.lookup.states[r[0]], occ=DATA.lookup.isco4[r[4]];
    (byState[st]=byState[st]||{})[occ]=(byState[st][occ]||0)+1;
    (byOcc[occ]=byOcc[occ]||{})[st]=(byOcc[occ][st]||0)+1;
    stateTot[st]=(stateTot[st]||0)+1;
    occTot[occ]=(occTot[occ]||0)+1;
  });
  var grand=rows.length||1;
  var states=Object.keys(stateTot).sort(function(a,b){return stateTot[b]-stateTot[a];});

  /* Table A — every state with volume, national share, and its top-3 ISCO-4 occupations */
  var elA=document.getElementById('cls-region-table');
  if(!states.length){
    elA.innerHTML='<p class="chart-empty">There is no regional data for this selection.</p>';
  } else {
    var h='<table class="data-tbl"><thead><tr><th>State</th><th>Postings</th><th>National Share</th>'+
          '<th>1st Occupation (ISCO-4)</th><th>2nd</th><th>3rd</th></tr></thead><tbody>';
    states.forEach(function(st){
      var dist=byState[st]||{};
      var top3=Object.keys(dist).sort(function(a,b){return dist[b]-dist[a];}).slice(0,3);
      var cells=[0,1,2].map(function(i){
        if(!top3[i]) return '<td>\u2014</td>';
        var o=top3[i], n=dist[o], sh=stateTot[st]?(n/stateTot[st]*100).toFixed(1):0;
        var code=(DATA.isco4CodeByName&&DATA.isco4CodeByName[o])||'';
        return '<td>'+(code?'<span class="badge badge-g">'+esc(String(code))+'</span> ':'')+esc(o)+
               '<span class="soft"> \u2014 '+fmt(n)+' ('+sh+'%)</span></td>';
      }).join('');
      h+='<tr><td><b>'+esc(st)+'</b></td><td class="cnt">'+fmt(stateTot[st])+'</td>'+
         '<td class="num">'+pct(stateTot[st],grand)+'%</td>'+cells+'</tr>';
    });
    elA.innerHTML=h+'</tbody></table>';
  }

  /* Table B — regional concentration per ISCO-4 occupation */
  var conc=Object.keys(occTot).map(function(o){
    var dist=byOcc[o]||{}, top=null, n=-1;
    for(var st in dist) if(dist[st]>n){ n=dist[st]; top=st; }
    return { name:o, code:(DATA.isco4CodeByName&&DATA.isco4CodeByName[o])||'\u2014',
             total:occTot[o], topState:top||'\u2014', topN:Math.max(n,0),
             share: occTot[o] ? +(Math.max(n,0)/occTot[o]*100).toFixed(1) : 0,
             nStates:Object.keys(dist).length };
  }).sort(function(a,b){return b.total-a.total;}).slice(0,15);

  var h2='<table class="data-tbl"><thead><tr><th>ISCO-4</th><th>Occupation</th><th>Postings</th><th>States Present</th><th>Top State</th><th>Top-State Share</th></tr></thead><tbody>';
  conc.forEach(function(d){
    h2+='<tr><td><span class="badge">'+esc(String(d.code))+'</span></td><td><b>'+esc(d.name)+'</b></td>'+
       '<td class="cnt">'+fmt(d.total)+'</td><td>'+d.nStates+'</td><td>'+esc(d.topState)+'</td>'+
       '<td class="'+(d.share>=50?'gld':'')+'">'+d.share+'%</td></tr>';
  });
  document.getElementById('cls-conc-table').innerHTML=h2+'</tbody></table>';

  /* region profile selector */
  var sel=document.getElementById('cls-state');
  if(sel && sel.dataset.filled!=='1'){
    sel.innerHTML=DATA.lookup.states.map(function(s){return '<option value="'+esc(s)+'">'+esc(s)+'</option>';}).join('');
    sel.dataset.filled='1';
  }
  renderRegionProfile();
}

function renderRegionProfile(){
  var sel=document.getElementById('cls-state'); if(!sel) return;
  var st=sel.value || DATA.lookup.states[0];
  var si=DATA.lookup.states.indexOf(st);
  var rows=getRows().filter(function(r){ return r[0]===si; });
  var total=rows.length;

  var c4={},m4={};
  rows.forEach(function(r){
    var nm=r[4]>=0?DATA.lookup.isco4[r[4]]:null; if(!nm) return;
    c4[nm]=(c4[nm]||0)+1;
    if(!m4[nm]) m4[nm]={code:(DATA.isco4CodeByName&&DATA.isco4CodeByName[nm])||''};
  });
  var t4=Object.keys(c4).map(function(nm){ return {code:m4[nm].code,name:nm,count:c4[nm]}; })
    .sort(function(a,b){return b.count-a.count;});

  if(!total){
    var msg='<p style="padding:12px;color:#7A9C9C;font-size:11px">No postings for '+esc(st)+' under the current filters.</p>';
    document.getElementById('cls-rp-isco4').innerHTML=msg;
    return;
  }
  classTable('cls-rp-isco4', t4, total, ['ISCO-4','Unit Group','Postings','Share of '+st]);
}

function classBar(id, arr, total, col){
  hBar(id, arr.map(function(d){ return { label:d.name, code:d.code, count:d.count }; }),
       { total:total, color:col, wrap:26, ofWhat:'postings',
         title:'ISCO-4 unit groups' });
}
function classTable(id, arr, total, heads){
  var html='<table class="data-tbl"><thead><tr>'+heads.map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+
    '</tr></thead><tbody>';
  arr.forEach(function(d){
    html+='<tr><td><span class="badge badge-g">'+esc(String(d.code||'—'))+'</span></td>'+
      '<td><b>'+esc(d.name)+'</b></td><td class="cnt">'+fmt(d.count)+'</td>'+
      '<td class="num">'+pct(d.count,total)+'%</td></tr>';
  });
  document.getElementById(id).innerHTML=html+'</tbody></table>';
}

/* ============================================================================
   MARKET CONTEXT — smart connections between top states, top ISCO-4 occupations,
   and demand shares. Shows the actual structure of the market.
   ============================================================================ */
function renderMarketContext(rows){
  if (!rows.length){ 
    document.querySelectorAll('#tab-context .card-body, #tab-context .tbl-wrap').forEach(function(el){
      el.innerHTML = '<p class="chart-empty">There is no data for this selection.</p>';
    });
    return;
  }
  
  var total = rows.length;
  
  /* Build base data: state -> occupation -> count, and occ -> state -> count */
  var byStateOcc = {}, byOccState = {}, stateTot = {}, occTot = {};
  rows.forEach(function(r){
    if (r[0]<0 || r[4]<0) return;
    var st = DATA.lookup.states[r[0]], occ = DATA.lookup.isco4[r[4]];
    if (!st || !occ) return;
    (byStateOcc[st]=byStateOcc[st]||{})[occ] = ((byStateOcc[st]||{})[occ]||0) + 1;
    (byOccState[occ]=byOccState[occ]||{})[st] = ((byOccState[occ]||{})[st]||0) + 1;
    stateTot[st] = (stateTot[st]||0) + 1;
    occTot[occ] = (occTot[occ]||0) + 1;
  });
  
  var states = Object.keys(stateTot).sort(function(a,b){ return stateTot[b]-stateTot[a]; }).slice(0,12);
  var occs = Object.keys(occTot).sort(function(a,b){ return occTot[b]-occTot[a]; }).slice(0,10);
  
  /* 1. States and their occupations — horizontal stacked, with an "All other
        occupations" remainder so every state's bar equals its true total. */
  var HOVER_DARK={bgcolor:'#111827', bordercolor:'#111827', font:{color:'#FFFFFF', size:12, family:'Outfit'}};
  var el1 = document.getElementById('ctx-state-occ');
  if (!states.length || !occs.length){
    el1.innerHTML = '<p class="chart-empty">Not enough data.</p>';
  } else {
    el1.style.height = Math.max(320, states.length * 34 + 150) + 'px';
    var yStates = states.slice().reverse();
    var traces = occs.map(function(occ, i){
      return { type:'bar', orientation:'h', name:occ, y:yStates,
        x: yStates.map(function(st){ return (byStateOcc[st]||{})[occ]||0; }),
        customdata: yStates.map(function(st){
          var n=(byStateOcc[st]||{})[occ]||0;
          return [st, occ, n, stateTot[st]?+(n/stateTot[st]*100).toFixed(1):0]; }),
        marker:{ color: CAT[i % CAT.length] },
        hoverlabel: HOVER_DARK,
        hovertemplate:'<b>%{customdata[0]}</b><br>%{customdata[1]}<br>%{customdata[2]:,} postings \u00b7 %{customdata[3]}% of this state<extra></extra>'
      };
    });
    traces.push({ type:'bar', orientation:'h', name:'All other occupations', y:yStates,
      x: yStates.map(function(st){
           var known = occs.reduce(function(a,o){ return a + ((byStateOcc[st]||{})[o]||0); }, 0);
           return Math.max(0, (stateTot[st]||0) - known); }),
      customdata: yStates.map(function(st){
           var known = occs.reduce(function(a,o){ return a + ((byStateOcc[st]||{})[o]||0); }, 0);
           var n = Math.max(0, (stateTot[st]||0) - known);
           return [st, 'All other occupations', n, stateTot[st]?+(n/stateTot[st]*100).toFixed(1):0]; }),
      marker:{ color:'#C9D8D8' },
      hoverlabel: HOVER_DARK,
      hovertemplate:'<b>%{customdata[0]}</b><br>%{customdata[1]}<br>%{customdata[2]:,} postings \u00b7 %{customdata[3]}% of this state<extra></extra>' });
    drawChart('ctx-state-occ', traces, {
      barmode:'stack', showlegend:true,
      yaxis:axC({ tickfont:{size:10, color:PAL.mid} }),
      xaxis:axV({ title:{text:'Postings', font:{size:10, color:PAL.soft}} }),
      legend:{orientation:'h', y:-0.16, font:{size:9, color:PAL.mid}},
      margin:{l:8, r:16, t:10, b:60}
    }, { title:'State demand by occupation',
         cols:['State'].concat(occs).concat(['All other occupations','State total']),
         rows:states.map(function(st){
           var known = occs.map(function(o){ return (byStateOcc[st]||{})[o]||0; });
           var sum = known.reduce(function(a,b){return a+b;},0);
           return [st].concat(known).concat([Math.max(0,(stateTot[st]||0)-sum), stateTot[st]||0]); }) });
  }

  /* 2. Occupations and where they sit — horizontal stacked with "All other states". */
  var el2 = document.getElementById('ctx-occ-states');
  if (!occs.length){
    el2.innerHTML = '<p class="chart-empty">Not enough data.</p>';
  } else {
    var topStates = states.slice(0,6);
    el2.style.height = Math.max(320, occs.length * 46 + 150) + 'px';
    var yOccs = occs.slice().reverse().map(function(o){ return wrapLabel(o, 26); });
    var occOrder = occs.slice().reverse();
    var traces2 = topStates.map(function(st, i){
      return { type:'bar', orientation:'h', name:st, y:yOccs,
        x: occOrder.map(function(occ){ return (byOccState[occ]||{})[st]||0; }),
        customdata: occOrder.map(function(occ){
          var n=(byOccState[occ]||{})[st]||0;
          return [occ, st, n, occTot[occ]?+(n/occTot[occ]*100).toFixed(1):0]; }),
        marker:{ color: CAT[i % CAT.length] },
        hoverlabel: HOVER_DARK,
        hovertemplate:'<b>%{customdata[0]}</b><br>%{customdata[1]}<br>%{customdata[2]:,} postings \u00b7 %{customdata[3]}% of this occupation<extra></extra>'
      };
    });
    traces2.push({ type:'bar', orientation:'h', name:'All other states', y:yOccs,
      x: occOrder.map(function(occ){
           var known = topStates.reduce(function(a,st){ return a + ((byOccState[occ]||{})[st]||0); }, 0);
           return Math.max(0, (occTot[occ]||0) - known); }),
      customdata: occOrder.map(function(occ){
           var known = topStates.reduce(function(a,st){ return a + ((byOccState[occ]||{})[st]||0); }, 0);
           var n = Math.max(0, (occTot[occ]||0) - known);
           return [occ, 'All other states', n, occTot[occ]?+(n/occTot[occ]*100).toFixed(1):0]; }),
      marker:{ color:'#C9D8D8' },
      hoverlabel: HOVER_DARK,
      hovertemplate:'<b>%{customdata[0]}</b><br>%{customdata[1]}<br>%{customdata[2]:,} postings \u00b7 %{customdata[3]}% of this occupation<extra></extra>' });
    drawChart('ctx-occ-states', traces2, {
      barmode:'stack', showlegend:true,
      yaxis:axC({ tickfont:{size:9.5, color:PAL.mid} }),
      xaxis:axV({ title:{text:'Postings', font:{size:10, color:PAL.soft}} }),
      legend:{orientation:'h', y:-0.16, font:{size:9, color:PAL.mid}},
      margin:{l:8, r:16, t:10, b:60}
    }, { title:'Occupation demand by state',
         cols:['Occupation'].concat(topStates).concat(['All other states','Total']),
         rows:occs.map(function(o){
           var known = topStates.map(function(st){ return (byOccState[o]||{})[st]||0; });
           var sum = known.reduce(function(a,b){return a+b;},0);
           return [o].concat(known).concat([Math.max(0,(occTot[o]||0)-sum), occTot[o]||0]); }) });
  }
  
  /* 3. State x Occupation heatmap matrix */
  var el3 = document.getElementById('ctx-matrix');
  if (!states.length || !occs.length){
    el3.innerHTML = '<p class="chart-empty">Not enough data.</p>';
  } else {
    el3.style.height = Math.max(420, states.length * 40 + 170) + 'px';
    var z = states.map(function(st){
      return occs.map(function(occ){ return (byStateOcc[st]||{})[occ]||0; });
    });
    var custom = states.map(function(st){
      return occs.map(function(occ){
        var n=(byStateOcc[st]||{})[occ]||0;
        return [st, occ, n, stateTot[st]?+(n/stateTot[st]*100).toFixed(1):0];
      });
    });
    drawChart('ctx-matrix', [{
      type:'heatmap', z:z, x:occs.map(function(o){ return wrapLabel(o,14); }), y:states,
      customdata:custom,
      colorscale:SEQ, xgap:3, ygap:3,
      hoverlabel:{bgcolor:'#111827', bordercolor:'#111827', font:{color:'#FFFFFF', size:12, family:'Outfit'}},
      hovertemplate:'<b>%{customdata[0]}</b><br>%{customdata[1]}<br>%{customdata[2]:,} postings \u00b7 %{customdata[3]}% of this state<extra></extra>',
      colorbar:{title:{text:'Postings',font:{size:9}},thickness:10,len:0.8,tickfont:{size:9},outlinewidth:0}
    }], {
      xaxis:{side:'top',tickangle:0,tickfont:{size:8.5,color:PAL.mid},fixedrange:true,automargin:true},
      yaxis:{automargin:true,tickfont:{size:10,color:PAL.mid},fixedrange:true},
      margin:{l:8,r:8,t:10,b:8}
    }, { title:'Market matrix: states × occupations',
         cols:['State'].concat(occs),
         rows:states.map(function(st,i){ return [st].concat(z[i]); }) });
  }
  
  /* 4. Summary table */
  var h = '<table class="data-tbl"><thead><tr><th>Rank</th><th>State</th><th>Postings</th><th>Share</th>'+
          '<th>Leading ISCO-4 occupation</th><th>Leading '+catL()+'</th></tr></thead><tbody>';
  states.forEach(function(st, i){
    var stOccs = byStateOcc[st] || {};
    var topOcc = Object.keys(stOccs).sort(function(a,b){ return stOccs[b]-stOccs[a]; })[0] || '—';
    var stRo = rows.filter(function(r){ return r[0]>=0 && DATA.lookup.states[r[0]]===st; });
    var leadSec = leadBy(stRo, function(r){ return r[1]>=0 ? DATA.lookup.isic[r[1]] : null; });
    h += '<tr><td class="num">'+(i+1)+'</td><td><b>'+esc(st)+'</b></td>'+
         '<td class="cnt">'+fmt(stateTot[st])+'</td><td class="num">'+pct(stateTot[st],total).toFixed(1)+'%</td>'+
         '<td>'+esc(topOcc)+'</td>'+
         '<td>'+esc(leadSec)+'</td></tr>';
  });
  document.getElementById('ctx-summary-table').innerHTML = h + '</tbody></table>';
}

/* ============================================================================
   TOP TIERS — ranked "top 10 / 20" analysis, split across five sub-views
   so that no single page has to carry everything.
   ============================================================================ */
var TIER_N = 10, TIER_VIEW = 'occ';

function setTierN(n, btn){
  TIER_N = n;
  document.querySelectorAll('#tier-n button').forEach(function(b){ b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  renderTiers();
}
function showTierView(v, btn){
  TIER_VIEW = v;
  document.querySelectorAll('#tab-tiers .sub-tab-nav .sub-btn').forEach(function(b){ b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  ['occ','title','region','employer','sector'].forEach(function(k){
    var el = document.getElementById('tv-'+k);
    if (el) el.classList.toggle('active', k===v);
  });
  renderTiers();
}

/* Rank a map of label -> count into a sorted, share array. */
function rankOf(counts, total){
  var arr = Object.keys(counts).map(function(k){ return { label:k, count:counts[k] }; })
              .sort(function(a,b){ return b.count - a.count; });
  arr.forEach(function(d){
    d.share = total ? +(d.count/total*100).toFixed(2) : 0;
  });
  return arr;
}
/* Given rows, return the most common decoded value for a set of row indices. */
function leadBy(rowsSubset, pick){
  var c = {};
  rowsSubset.forEach(function(r){ var v = pick(r); if (v) c[v] = (c[v]||0)+1; });
  return topKeyOf(c) || '—';
}

function renderTiers(){
  if (!DATA) return;
  var rows = getRows();
  var el = document.getElementById('tier-intro');
  if (el) el.innerHTML =
    'This tab ranks the '+esc(APP.sector.label.toLowerCase())+' market from the top down, so that the entries worth acting on '+
    'sit at the front. The six views below cover the standardised occupations, the job titles employers actually advertise, '+
    'the regions, the named employers, the '+catPL()+', and the ISIC-2 sector listing with official codes. All of them are computed from the '+fmt(rows.length)+
    ' postings currently passing the header filters, and every chart and table can be exported.';

  if (TIER_VIEW==='occ')      tierOccupations(rows);
  if (TIER_VIEW==='title')    tierTitles(rows);
  if (TIER_VIEW==='region')   tierRegions(rows);
  if (TIER_VIEW==='employer') tierEmployers(rows);
  if (TIER_VIEW==='sector')   tierSectors(rows);
}

/* ---- 6. ISIC-2 sectors with their codes --------------------------------- */

/* ---- 1. Occupations (ISCO-4) --------------------------------------------- */
function tierOccupations(rows){
  var total = rows.length, c = {};
  rows.forEach(function(r){ var l = r[4]>=0 ? DATA.lookup.isco4[r[4]] : null; if (l) c[l] = (c[l]||0)+1; });
  var ranked = rankOf(c, total);
  var top = ranked.slice(0, TIER_N);

  var top10n = ranked.slice(0,10).reduce(function(s,d){ return s+d.count; },0);
  kpi('tocc-k1', fmt(ranked.length), 'Distinct Occupations', 'Four-digit ISCO-08 unit groups found in the current selection');
  kpi('tocc-k2', ranked[0] ? ranked[0].label : '—', 'Leading Occupation', ranked[0] ? fmt(ranked[0].count)+' postings — '+ranked[0].share.toFixed(1)+'% of demand' : '');
  kpi('tocc-k3', pct(top10n,total)+'%', 'Share Held by the Top 10', fmt(top10n)+' of '+fmt(total)+' postings sit in the ten largest occupations');
  kpi('tocc-k4', fmt(total), 'Postings in Selection', 'Classified postings passing the current header filters');

  hBar('tier-occ-bar', top.map(function(d){
    return { label:d.label, code:(DATA.isco4CodeByName&&DATA.isco4CodeByName[d.label])||'', count:d.count };
  }), { total:total, color:PAL.teal, wrap:30, ofWhat:'postings',
        title:'Top '+TIER_N+' occupations (ISCO-4)' });

  /* occupation x employer sector stacked bars */
  var byOcc = {};
  rows.forEach(function(r){ var l = r[4]>=0 ? DATA.lookup.isco4[r[4]] : null; if (!l) return; (byOcc[l]=byOcc[l]||[]).push(r); });
  var secCount = {};
  rows.forEach(function(r){ if (r[1]>=0){ var s=DATA.lookup.isic[r[1]]; secCount[s]=(secCount[s]||0)+1; } });
  var topSecs = Object.keys(secCount).sort(function(a,b){ return secCount[b]-secCount[a]; }).slice(0,7);
  var elOS = document.getElementById('tier-occ-sector');
  if (elOS){
    var occNames = top.map(function(d){ return d.label; }).reverse();
    elOS.style.height = Math.min(560, Math.max(300, occNames.length * 54 + 190)) + 'px';
    var zOS = occNames.map(function(o){
      var sub = byOcc[o]||[];
      return topSecs.map(function(sec){
        var n = sub.filter(function(r){ return r[1]>=0 && DATA.lookup.isic[r[1]]===sec; }).length;
        return sub.length ? +(n/sub.length*100).toFixed(1) : 0; });
    });
    var cOS = occNames.map(function(o){
      var sub = byOcc[o]||[];
      return topSecs.map(function(sec){
        var n = sub.filter(function(r){ return r[1]>=0 && DATA.lookup.isic[r[1]]===sec; }).length;
        var pc = sub.length ? +(n/sub.length*100).toFixed(1) : 0;
        return [o, sec, n, pc]; });
    });
    drawChart('tier-occ-sector', [{
      type:'heatmap', z:zOS,
      x:topSecs.map(function(c){ return wrapLabel(c,16); }),
      y:occNames.map(function(o){ return wrapLabel(o,26); }),
      customdata:cOS, colorscale:SEQ, xgap:4, ygap:4,
      text:zOS.map(function(row){ return row.map(function(v){ return v>=1 ? v+'%' : ''; }); }),
      texttemplate:'%{text}', textfont:{size:10.5, color:'#123'},
      hovertemplate:'<b>%{customdata[0]}</b><br>%{customdata[1]}<br>%{customdata[2]:,} postings \u00b7 %{customdata[3]}% of this occupation<extra></extra>',
      colorbar:{title:{text:'% of occupation',font:{size:9}},thickness:10,len:0.8,tickfont:{size:9},outlinewidth:0}
    }], {
      xaxis:{tickangle:0,tickfont:{size:9.5,color:'#2A3535'},fixedrange:true,automargin:true},
      yaxis:{automargin:true,tickfont:{size:10,color:'#2A3535'},fixedrange:true},
      margin:{l:8,r:8,t:10,b:8}
    }, { title:'Top occupations by '+catL()+' (% of occupation)',
         cols:['Occupation'].concat(topSecs),
         rows: top.map(function(d,ri){
           var sub = byOcc[d.label]||[];
           return [d.label].concat(topSecs.map(function(sec){
             var n = sub.filter(function(r){ return r[1]>=0 && DATA.lookup.isic[r[1]]===sec; }).length;
             return sub.length ? +(n/sub.length*100).toFixed(1) : 0; })); }) });
  }
  var h = '<table class="data-tbl"><thead><tr><th>Rank</th><th>ISCO-4</th><th>Occupation</th>'+
          '<th>Postings</th><th>Share</th><th>Leading '+catL()+'</th><th>Leading region</th></tr></thead><tbody>';
  top.forEach(function(d, i){
    var sub = byOcc[d.label] || [];
    var code = (DATA.isco4CodeByName&&DATA.isco4CodeByName[d.label]) || '—';
    h += '<tr><td class="num">'+(i+1)+'</td>'+
         '<td><span class="badge">'+esc(String(code))+'</span></td>'+
         '<td><b>'+esc(d.label)+'</b></td>'+
         '<td class="cnt">'+fmt(d.count)+'</td><td class="num">'+d.share.toFixed(1)+'%</td>'+
         '<td>'+esc(leadBy(sub, function(r){ return r[1]>=0 ? DATA.lookup.isic[r[1]] : null; }))+'</td>'+
         '<td>'+esc(leadBy(sub, function(r){ return r[0]>=0 ? DATA.lookup.states[r[0]] : null; }))+'</td></tr>';
  });
  document.getElementById('tier-occ-table').innerHTML = h + '</tbody></table>';
}

/* ---- 2. Advertised job titles -------------------------------------------- */
function tierTitles(rows){
  ensureIdx();
  var total = rows.length, c = {}, byTitle = {};
  rows.forEach(function(r){
    var t = (DATA.raw.title[_rowToIdx.get(r)] || '').trim();
    if (!t || t==='—') return;
    c[t] = (c[t]||0)+1;
    (byTitle[t]=byTitle[t]||[]).push(r);
  });
  var ranked = rankOf(c, total), top = ranked.slice(0, TIER_N);

  var named = ranked.reduce(function(s,d){ return s+d.count; },0);
  kpi('ttit-k1', fmt(ranked.length), 'Distinct Advertised Titles', 'Unique job titles as written by employers, after cleaning');
  kpi('ttit-k2', ranked[0] ? ranked[0].label : '—', 'Most Common Title', ranked[0] ? fmt(ranked[0].count)+' postings — '+ranked[0].share.toFixed(1)+'% of the selection' : '');
  var top10t = ranked.slice(0,10).reduce(function(s,d){ return s+d.count; },0);
  kpi('ttit-k3', pct(top10t,total)+'%', 'Share Held by the Top 10 Titles', fmt(top10t)+' postings use one of the ten most common titles');
  kpi('ttit-k4', fmt(named), 'Postings with a Usable Title', pct(named,total)+'% of the current selection carries a non-empty title');

  /* Charts removed per review \u2014 the Role Analysis tab covers titles per
     occupation. The KPI strip above and the full ranked table below remain. */

  var h = '<table class="data-tbl"><thead><tr><th>Rank</th><th>Advertised job title</th><th>Postings</th><th>Share</th>'+
          '<th>Classified as (ISCO-4)</th><th>Leading '+catL()+'</th></tr></thead><tbody>';
  top.forEach(function(d, i){
    var sub = byTitle[d.label] || [];
    var occ = leadBy(sub, function(r){ return r[4]>=0 ? DATA.lookup.isco4[r[4]] : null; });
    var code = (DATA.isco4CodeByName&&DATA.isco4CodeByName[occ]) || '';
    h += '<tr><td class="num">'+(i+1)+'</td><td><b>'+esc(d.label)+'</b></td>'+
         '<td class="cnt">'+fmt(d.count)+'</td><td class="num">'+d.share.toFixed(1)+'%</td>'+
         '<td>'+(code?'<span class="badge badge-g">'+esc(String(code))+'</span> ':'')+esc(occ)+'</td>'+
         '<td>'+esc(leadBy(sub, function(r){ return r[1]>=0 ? DATA.lookup.isic[r[1]] : null; }))+'</td></tr>';
  });
  document.getElementById('tier-title-table').innerHTML = h + '</tbody></table>';
}

/* ---- 3. Regions ----------------------------------------------------------- */
function tierRegions(rows){
  var total = rows.length, c = {}, byState = {};
  rows.forEach(function(r){
    if (r[0]<0) return;
    var s = DATA.lookup.states[r[0]];
    c[s] = (c[s]||0)+1;
    (byState[s]=byState[s]||[]).push(r);
  });
  var ranked = rankOf(c, total), top = ranked.slice(0, TIER_N);

  var located = ranked.reduce(function(s2,d){ return s2+d.count; },0);
  var top3 = ranked.slice(0,3).reduce(function(s2,d){ return s2+d.count; },0);
  kpi('treg-k1', fmt(ranked.length), 'Regions with Demand', 'German federal states carrying at least one posting in the selection');
  kpi('treg-k2', ranked[0] ? ranked[0].label : '—', 'Leading Region', ranked[0] ? fmt(ranked[0].count)+' postings — '+ranked[0].share.toFixed(1)+'% of demand' : '');
  kpi('treg-k3', pct(top3,total)+'%', 'Share Held by the Top 3 Regions', fmt(top3)+' postings are concentrated in just three states');
  kpi('treg-k4', fmt(located), 'Postings with a Location', pct(located,total)+'% of the current selection names a federal state');

  pareto('tier-region-pareto', top, total, 'Regions ranked by share');

  /* grouped bars: leading occupations inside each leading region */
  var topStates = top.slice(0, 8).map(function(d){ return d.label; });
  var occCount = {};
  rows.forEach(function(r){ var l = r[4]>=0 ? DATA.lookup.isco4[r[4]] : null; if (l) occCount[l]=(occCount[l]||0)+1; });
  var topOccs = Object.keys(occCount).sort(function(a,b){ return occCount[b]-occCount[a]; }).slice(0,5);
  var el = document.getElementById('tier-region-mix');
  if (!topStates.length || !topOccs.length){
    el.innerHTML = '<p class="chart-empty">There is no regional data for this selection.</p>';
  } else {
    var traces = topOccs.map(function(occ, i){
      return { type:'bar', name:occ,
        x: topStates,
        y: topStates.map(function(st){
             return (byState[st]||[]).filter(function(r){ return r[4]>=0 && DATA.lookup.isco4[r[4]]===occ; }).length; }),
        customdata: topStates.map(function(st){
             var n=(byState[st]||[]).filter(function(r){ return r[4]>=0 && DATA.lookup.isco4[r[4]]===occ; }).length;
             var t=(byState[st]||[]).length;
             return [st, occ, n, t?+(n/t*100).toFixed(1):0]; }),
        marker:{ color: CAT[i % CAT.length] },
        hovertemplate:'<b>%{customdata[0]}</b><br>%{customdata[1]}<br>%{customdata[2]:,} postings \u00b7 %{customdata[3]}% of this state<extra></extra>' };
    });
    drawChart('tier-region-mix', traces, {
      barmode:'group', showlegend:true,
      bargap: topStates.length <= 2 ? 0.5 : 0.2,
      bargroupgap: 0.08,
      xaxis:axC({tickangle:0}),
      yaxis:axV({title:{text:'Postings',font:{size:10,color:PAL.soft}}}),
      legend:{orientation:'h',y:-0.28,font:{size:9.5,color:PAL.mid}},
      margin:{l:48,r:8,t:10,b:96}
    }, { title:'Leading occupations within the top regions',
         cols:['Region'].concat(topOccs),
         rows: topStates.map(function(st){
           return [st].concat(topOccs.map(function(occ){
             return (byState[st]||[]).filter(function(r){ return r[4]>=0 && DATA.lookup.isco4[r[4]]===occ; }).length; })); }) });
  }

  var h = '<table class="data-tbl"><thead><tr><th>Rank</th><th>Region</th><th>Postings</th><th>Share</th>'+
          '<th>Leading occupation</th><th>Leading '+catL()+'</th></tr></thead><tbody>';
  top.forEach(function(d, i){
    var sub = byState[d.label] || [];
    h += '<tr><td class="num">'+(i+1)+'</td><td><b>'+esc(d.label)+'</b></td>'+
         '<td class="cnt">'+fmt(d.count)+'</td><td class="num">'+d.share.toFixed(1)+'%</td>'+
         '<td>'+esc(leadBy(sub, function(r){ return r[4]>=0 ? DATA.lookup.isco4[r[4]] : null; }))+'</td>'+
         '<td>'+esc(leadBy(sub, function(r){ return r[1]>=0 ? DATA.lookup.isic[r[1]] : null; }))+'</td></tr>';
  });
  document.getElementById('tier-region-table').innerHTML = h + '</tbody></table>';
}

/* ---- 4. Employers --------------------------------------------------------- */
function tierEmployers(rows){
  ensureIdx();
  var total = rows.length, c = {}, byCo = {};
  rows.forEach(function(r){
    var n = (DATA.raw.company[_rowToIdx.get(r)] || '').trim();
    if (!n || n==='—') return;
    c[n] = (c[n]||0)+1;
    (byCo[n]=byCo[n]||[]).push(r);
  });
  var ranked = rankOf(c, total), top = ranked.slice(0, TIER_N);

  var top10e = ranked.slice(0,10).reduce(function(s2,d){ return s2+d.count; },0);
  ensureIdx();
  var staffN = rows.filter(function(r){ return /recruitment agency|job aggregator/i.test(DATA.raw.empCat[_rowToIdx.get(r)]||''); }).length;
  kpi('temp-k1', fmt(ranked.length), 'Distinct Employers', 'Companies advertising at least one posting in the selection');
  kpi('temp-k2', ranked[0] ? ranked[0].label : '—', 'Most Active Employer', ranked[0] ? fmt(ranked[0].count)+' postings — '+ranked[0].share.toFixed(1)+'% of the selection' : '');
  kpi('temp-k3', pct(top10e,total)+'%', 'Share of the 10 Largest Employers', fmt(top10e)+' postings come from the ten most active companies');
  kpi('temp-k4', pct(staffN,total)+'%', 'Advertised via Agencies', fmt(staffN)+' postings were listed by recruitment agencies or aggregators');

  hBar('tier-emp-bar', top.map(function(d){
    var sub = byCo[d.label] || [];
    var sec = leadBy(sub, function(r){ return r[1]>=0 ? DATA.lookup.isic[r[1]] : null; });
    return { label:d.label, count:d.count, color:isicColor(sec) };
  }), { total:total, pct:false, wrap:30, ofWhat:'postings',
        title:'Top '+TIER_N+' employers by postings' });

  var h = '<table class="data-tbl"><thead><tr><th>Rank</th><th>Employer</th><th>Postings</th><th>Share</th>'+
          '<th>Employer sector</th><th>Leading occupation</th><th>Leading region</th></tr></thead><tbody>';
  top.forEach(function(d, i){
    var sub = byCo[d.label] || [];
    h += '<tr><td class="num">'+(i+1)+'</td><td><b>'+esc(d.label)+'</b></td>'+
         '<td class="cnt">'+fmt(d.count)+'</td><td class="num">'+d.share.toFixed(1)+'%</td>'+
         '<td>'+esc(leadBy(sub, function(r){ return r[1]>=0 ? DATA.lookup.isic[r[1]] : null; }))+'</td>'+
         '<td>'+esc(leadBy(sub, function(r){ return r[4]>=0 ? DATA.lookup.isco4[r[4]] : null; }))+'</td>'+
         '<td>'+esc(leadBy(sub, function(r){ return r[0]>=0 ? DATA.lookup.states[r[0]] : null; }))+'</td></tr>';
  });
  document.getElementById('tier-emp-table').innerHTML = h + '</tbody></table>';
}

/* ---- 5. Employer sectors -------------------------------------------------- */
function tierSectors(rows){
  ensureIdx();
  var total = rows.length, c = {}, bySec = {};
  rows.forEach(function(r){
    if (r[1]<0) return;
    var s = DATA.lookup.isic[r[1]];
    c[s] = (c[s]||0)+1;
    (bySec[s]=bySec[s]||[]).push(r);
  });
  var ranked = rankOf(c, total), top = ranked.slice(0, TIER_N);

  var coBySec = {};
  rows.forEach(function(r){
    if (r[1]<0) return;
    var sec2 = DATA.lookup.isic[r[1]];
    var co = (DATA.raw.company[_rowToIdx.get(r)] || '').trim();
    if (co && co!=='—') (coBySec[sec2]=coBySec[sec2]||{})[co]=1;
  });
  var allCos = {};
  Object.keys(coBySec).forEach(function(sec2){ Object.keys(coBySec[sec2]).forEach(function(co){ allCos[co]=1; }); });
  kpi('tsec-k1', fmt(ranked.length), catPC()+' Identified', 'Distinct '+catPL()+' present in the current selection');
  kpi('tsec-k2', ranked[0] ? ranked[0].label : '—', 'Leading Sector', ranked[0] ? fmt(ranked[0].count)+' postings — '+ranked[0].share.toFixed(1)+'% of demand' : '');
  var top3s = ranked.slice(0,3).reduce(function(s2,d){ return s2+d.count; },0);
  kpi('tsec-k3', pct(top3s,total)+'%', 'Share Held by the Top 3 Sectors', fmt(top3s)+' postings sit in the three largest sectors');
  kpi('tsec-k4', fmt(Object.keys(allCos).length), 'Employers Across All Sectors', 'Distinct companies mapped into the sector classification');

  hBar('tier-sector-bar', top.map(function(d){
    return { label:d.label, count:d.count, color:isicColor(d.label) };
  }), { total:total, wrap:26, ofWhat:'postings',
        title:catPC()+' ranked by postings' });

  /* sector x region, row-normalised */
  var secs = top.slice(0, 10).map(function(d){ return d.label; });
  var stateTot = {};
  rows.forEach(function(r){ if (r[0]>=0) stateTot[DATA.lookup.states[r[0]]] = 1; });
  var states = Object.keys(stateTot);
  var el = document.getElementById('tier-sector-geo');
  if (!secs.length || !states.length){
    el.innerHTML = '<p class="chart-empty">There is no regional data for this selection.</p>';
  } else {
    var z = secs.map(function(s){
      var sub = bySec[s] || [];
      return states.map(function(st){
        var n = sub.filter(function(r){ return r[0]>=0 && DATA.lookup.states[r[0]]===st; }).length;
        return sub.length ? +(n/sub.length*100).toFixed(1) : 0;
      });
    });
    var custG = secs.map(function(s2){
      var sub = bySec[s2] || [];
      return states.map(function(st){
        var n = sub.filter(function(r){ return r[0]>=0 && DATA.lookup.states[r[0]]===st; }).length;
        return [s2, st, n, sub.length ? +(n/sub.length*100).toFixed(1) : 0];
      });
    });
    /* size the heatmap to its row count so cells stay legible for a small
       region (few sectors) without stretching into huge bands */
    el.style.height = Math.min(560, Math.max(280, secs.length * 40 + 150)) + 'px';
    drawChart('tier-sector-geo', [{
      type:'heatmap', z:z, x:states, y:secs.map(function(s){ return wrapLabel(s, 22); }),
      customdata:custG,
      colorscale:SEQ, xgap:3, ygap:3,
      hovertemplate:'<b>%{customdata[0]}</b><br>%{customdata[1]}<br>%{customdata[2]:,} postings \u00b7 %{customdata[3]}% of this sector<extra></extra>',
      colorbar:{title:{text:'% of sector',font:{size:9}},thickness:10,len:0.8,tickfont:{size:9},outlinewidth:0}
    }], {
      xaxis:{tickangle:-30,tickfont:{size:9,color:PAL.mid},fixedrange:true,automargin:true},
      yaxis:{automargin:true,tickfont:{size:9,color:PAL.mid},fixedrange:true},
      margin:{l:8,r:8,t:10,b:8}
    }, { title:catC()+' by region', cols:[catC()].concat(states),
         rows: secs.map(function(s,i){ return [s].concat(z[i]); }) });
  }

  var h = '<table class="data-tbl"><thead><tr><th>Rank</th><th>'+catC()+'</th><th>Postings</th><th>Share</th>'+
          '<th>Distinct employers</th><th>Leading occupation</th><th>Leading region</th></tr></thead><tbody>';
  top.forEach(function(d, i){
    var sub = bySec[d.label] || [];
    var cos = {};
    sub.forEach(function(r){ var n = DATA.raw.company[_rowToIdx.get(r)]; if (n && n!=='—') cos[n]=1; });
    h += '<tr><td class="num">'+(i+1)+'</td><td><b>'+esc(d.label)+'</b></td>'+
         '<td class="cnt">'+fmt(d.count)+'</td><td class="num">'+d.share.toFixed(1)+'%</td>'+
         '<td class="num">'+fmt(Object.keys(cos).length)+'</td>'+
         '<td>'+esc(leadBy(sub, function(r){ return r[4]>=0 ? DATA.lookup.isco4[r[4]] : null; }))+'</td>'+
         '<td>'+esc(leadBy(sub, function(r){ return r[0]>=0 ? DATA.lookup.states[r[0]] : null; }))+'</td></tr>';
  });
  document.getElementById('tier-sector-table').innerHTML = h + '</tbody></table>';
}

/* ---- shared Pareto (bars only, ranked) ------------------------------- */
function pareto(id, ranked, total, title){
  var el = document.getElementById(id);
  if (!el) return;
  if (!ranked.length){ el.innerHTML = '<p class="chart-empty">There is no data for this selection.</p>'; return; }
  /* Labels sit horizontally under the columns, wrapped over lines and in a
     readable dark font; automargin guarantees they are never cut off. With
     many columns the wrap narrows so neighbouring labels cannot collide. */
  var w = ranked.length > 12 ? 10 : 14;
  var labels = ranked.map(function(d){ return wrapLabel(d.label, w); });
  drawChart(id, [{
    type:'bar', name:'Postings', x:labels, y:ranked.map(function(d){ return d.count; }),
    marker:{ color:PAL.teal, line:{width:0} },
    customdata:ranked.map(function(d){ return [d.label, d.count, d.share]; }),
    hovertemplate:'<b>%{customdata[0]}</b><br>%{customdata[1]:,} postings<br>%{customdata[2]:.1f}% of all<extra></extra>'
  }], {
    showlegend:false,
    xaxis:axC({ tickangle:0, tickfont:{ size: ranked.length > 12 ? 9.5 : 10.5, color:'#2A3535' } }),
    yaxis:axV({ title:{ text:'Postings', font:{ size:10, color:PAL.soft } } }),
    margin:{ l:50, r:12, t:10, b:10 }
  }, { title:title, cols:['Rank','Name','Postings','Share (%)'],
       rows: ranked.map(function(d,i){ return [i+1, d.label, d.count, d.share]; }) });
}

/* ======= STATIC (per-sector) TABS ======================================== */
function buildStaticTabs(){
  var tabs=(APP.sector.staticTabs||[]);
  if(!tabs.length) return;
  var nav=document.getElementById('tab-nav');
  var mount=document.getElementById('static-tabs');
  tabs.forEach(function(t){
    var btn=document.createElement('button');
    btn.className='tab-btn'; btn.textContent=t.label;
    btn.onclick=function(){ showTab(t.id,btn); };
    nav.appendChild(btn);

    var sec=document.createElement('section');
    sec.id='tab-'+t.id; sec.className='tab-panel';
    sec.innerHTML='<div class="insight-box">Loading…</div>';
    mount.appendChild(sec);

    fetch(t.file).then(function(r){ if(!r.ok) throw new Error(r.status); return r.text(); })
      .then(function(html){
        sec.innerHTML=html;
        /* Populate sector glossary immediately (cheap), but DEFER the heavy
           requirements extractor until the user actually opens the tab —
           running it at load froze the whole dashboard. Mark what's pending. */
        populateAboutSectors(sec);
        if (sec.querySelector('#quals-extract')) sec.setAttribute('data-needs-quals','1');
        if (sec.querySelector('#visa-extract'))  sec.setAttribute('data-needs-visa','1');
      })
      .catch(function(){ sec.innerHTML='<div class="alert-box">Could not load <code>'+esc(t.file)+'</code>. If testing locally, serve over http.</div>'; });
  });
}

/* Run the unified requirements extractor and render visa + job requirement
   classifications for the top 10 ISCO-4 occupations into the Quals tab. */
function populateQualsExtract(scope){
  var host=(scope||document).querySelector('#quals-extract');
  if(!host || !DATA || typeof REQX==='undefined') return;
  ensureIdx();
  REQX.run(DATA, ensureIdx, _rowToIdx,
    function(pctDone){
      var p=(scope||document).querySelector('#quals-extract-pct');
      if(p) p.textContent=pctDone+'%';
    },
    function(res){
      var out='';
      res.top10.forEach(function(occ){
        var a=res.agg[occ]; if(!a || !a.total) return;
        function topTags(o,n){
          return Object.keys(o).sort(function(x,y){ return o[y]-o[x]; }).slice(0,n)
            .map(function(t){ return { t:t, n:o[t], p:+(o[t]/a.total*100).toFixed(1) }; });
        }
        var visa=topTags(a.visa,5), job=topTags(a.job,8);
        out+='<div style="padding:12px 14px;border-top:1px solid #E4EEEE">'+
          '<div style="font-weight:700;color:#0F5B5A;font-size:13px">'+esc(occ)+
          ' <span style="color:#7A9C9C;font-weight:400">\u00b7 '+fmt(a.total)+' postings \u00b7 '+
          (+(a.anyVisa/a.total*100).toFixed(1))+'% carry a visa / work-authorisation signal</span></div>';
        if(visa.length){
          out+='<div style="margin-top:6px;font-size:11px"><span style="font-weight:700;color:#C98A0B">Visa &amp; legal-status signals:</span> '+
            visa.map(function(d){ return esc(d.t)+' <span style="color:#7A9C9C">('+d.p+'%)</span>'; }).join(' \u00b7 ')+'</div>';
        }
        out+='<div style="margin-top:4px;font-size:11px"><span style="font-weight:700;color:#1A7B7A">Job-specific requirements:</span> '+
          (job.length? job.map(function(d){ return esc(d.t)+' <span style="color:#7A9C9C">('+d.p+'%)</span>'; }).join(' \u00b7 ') : '\u2014')+
          '</div></div>';
      });
      host.innerHTML=out || '<div style="padding:14px;color:#7A9C9C;font-size:12px">No classified postings in the dataset.</div>';
    });
}

/* Dedicated Visa & Work-Authorization tab: same extractor, visa dimension only,
   surfaced prominently with a share bar per occupation. */
function populateVisaExtract(scope){
  var host=(scope||document).querySelector('#visa-extract');
  if(!host || !DATA || typeof REQX==='undefined') return;
  ensureIdx();
  REQX.run(DATA, ensureIdx, _rowToIdx,
    function(pctDone){
      var p=(scope||document).querySelector('#visa-extract-pct');
      if(p) p.textContent=pctDone+'%';
    },
    function(res){
      var out='<table class="data-tbl"><thead><tr>'+
        '<th>Occupation (ISCO-4)</th><th style="text-align:right">Postings</th>'+
        '<th style="width:180px">Visa / work-authorization signal</th>'+
        '<th>Signals stated by employers (share of the occupation)</th></tr></thead><tbody>';
      res.top10.forEach(function(occ){
        var a=res.agg[occ]; if(!a || !a.total) return;
        var vpct=+(a.anyVisa/a.total*100).toFixed(1);
        var visa=Object.keys(a.visa).sort(function(x,y){ return a.visa[y]-a.visa[x]; }).slice(0,6)
          .map(function(t){ return { t:t, n:a.visa[t], p:+(a.visa[t]/a.total*100).toFixed(1) }; });
        var barW=Math.max(2, Math.min(100, vpct));
        out+='<tr><td><b>'+esc(occ)+'</b></td>'+
          '<td class="cnt" style="text-align:right">'+fmt(a.total)+'</td>'+
          '<td><div style="display:flex;align-items:center;gap:7px">'+
            '<div style="flex:1;height:8px;border-radius:5px;background:#EAF1F1;overflow:hidden">'+
              '<div style="height:100%;width:'+barW+'%;background:linear-gradient(90deg,#C98A0B,#D4940A)"></div></div>'+
            '<span style="font-weight:700;color:#C98A0B;font-size:11px;min-width:38px;text-align:right">'+vpct+'%</span></div></td>'+
          '<td style="font-size:11px">'+
            (visa.length? visa.map(function(d){ return esc(d.t)+' <span style="color:#7A9C9C">('+d.p+'%)</span>'; }).join(' \u00b7 ')
                        : '<span style="color:#7A9C9C">No visa or work-authorization signal detected in this occupation\u2019s postings.</span>')+
          '</td></tr>';
      });
      out+='</tbody></table>';
      out+='<div style="padding:12px 14px;font-size:11px;color:#7A9C9C;border-top:1px solid #E4EEEE">'+
        'A low signal share is expected and meaningful: German employers rarely spell out visa sponsorship in job ads even where demand is acute, which is precisely the recruitment-infrastructure gap GATI works to close. Counts reflect postings passing the current header filters.</div>';
      host.innerHTML=out;
    });
}

/* Fill the About & Methods sector glossary straight from the loaded dataset:
   sector names from Employer_Category, ISIC-2 codes where present, counts,
   and the reference-guide description for each. Nothing is hardcoded. */
function populateAboutSectors(scope){
  var host=(scope||document).querySelector('#about-sector-gloss');
  if(!host || !DATA) return;
  var rows=getRows(), c={};
  rows.forEach(function(r){ if(r[1]>=0){ var n=DATA.lookup.isic[r[1]]; c[n]=(c[n]||0)+1; } });
  var names=Object.keys(c).sort(function(a,b){ return c[b]-c[a]; }).slice(0,10);
  if(!names.length){ host.innerHTML='<div class="gloss-desc" style="padding:10px 14px">No sector data in the current selection.</div>'; return; }
  var out='';
  names.forEach(function(name){
    var code=(DATA.isicCodeByName&&DATA.isicCodeByName[name])||'';
    var desc=(code&&typeof ISIC_GUIDE!=='undefined'&&ISIC_GUIDE[String(code)])||'';
    out+='<div class="gloss-block">'+
      (code?'<span class="gloss-code gloss-gold">'+esc(String(code))+'</span>':'')+
      '<span class="gloss-name">'+esc(name)+' <span style="color:#7A9C9C;font-weight:400">\u00b7 '+fmt(c[name])+' postings</span></span>'+
      (desc?'<div class="gloss-desc">'+esc(desc)+'</div>':'')+
    '</div>';
  });
  host.innerHTML=out;
}

/* Sub-tab switcher used by injected Qualifications content (onclick="showQualsRole(...)"). */
function showQualsRole(code, btn){
  var scope=document.getElementById('tab-quals'); if(!scope) return;
  scope.querySelectorAll('.sub-btn').forEach(function(b){ b.classList.remove('active'); });
  scope.querySelectorAll('.sub-panel').forEach(function(p){ p.classList.remove('active'); });
  if(btn) btn.classList.add('active');
  var p=document.getElementById('qpanel-'+code); if(p) p.classList.add('active');
}
