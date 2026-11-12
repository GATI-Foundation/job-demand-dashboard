/* ============================================================
   GATI dashboard · URL state
   Loaded AFTER dashboard.js. Does not modify dashboard.js.

   What it does
   1. Keeps the current tab, sub-tab, State / Employer-type filters
      (and any data-quality toggle that has been switched OFF) in the
      URL hash, e.g.
        dashboard.html?sector=healthcare#tab=regional&state=Bayern
      -> shareable links, working Back/Forward, survives refresh.
   2. Switching sector in the header keeps those filters and the tab.

   The hash is used (not ?query) so it can never interfere with the
   ?sector= parsing already done in dashboard.js / sectors.js.
   ============================================================ */
(function () {
  'use strict';

  var DEF = { tab: 'overview', tv: 'occ', cv: 'national', n: '10' };
  var TOGGLES = [['flt-genuine', 'dup'], ['flt-clearcat', 'cat'], ['flt-clearocc', 'occ']];
  var restored = false;   // true once the first restore from the URL has run
  var busy = false;       // true while we are applying the URL to the page

  function $(id) { return document.getElementById(id); }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---------- read the current UI -> hash string ---------- */
  function activeTab() {
    var p = q('section.tab-panel.active') || q('.tab-panel.active');
    return p && p.id ? p.id.replace(/^tab-/, '') : DEF.tab;
  }
  function activeSub(panelSel, prefix) {
    var p = q(panelSel + ' .sub-panel.active');
    return p && p.id ? p.id.replace(prefix, '') : null;
  }
  function activeTierN() {
    var b = q('#tier-n button.active');
    return b ? b.textContent.trim() : DEF.n;
  }
  function readUI() {
    var p = new URLSearchParams();
    var tab = activeTab();
    if (tab !== DEF.tab) p.set('tab', tab);
    if (tab === 'tiers') {
      var tv = activeSub('#tab-tiers', 'tv-');
      if (tv && tv !== DEF.tv) p.set('tv', tv);
      var n = activeTierN();
      if (n && n !== DEF.n) p.set('n', n);
    }
    if (tab === 'classify') {
      var cv = activeSub('#tab-classify', 'cv-');
      if (cv && cv !== DEF.cv) p.set('cv', cv);
    }
    var st = $('flt-state'), ic = $('flt-isic');
    if (st && st.value && st.value !== 'ALL') p.set('state', st.value);
    if (ic && ic.value && ic.value !== 'ALL') p.set('isic', ic.value);
    TOGGLES.forEach(function (t) {
      var el = $(t[0]);
      if (el && !el.checked) p.set(t[1], '0');   // only non-default is stored
    });
    return p.toString();
  }

  /* ---------- write hash (push for navigation, replace for filters) ---------- */
  function sync(push) {
    if (!restored || busy) return;
    var h = readUI();
    if (h === location.hash.replace(/^#/, '')) return;
    var url = location.pathname + location.search + (h ? '#' + h : '');
    try { (push ? history.pushState : history.replaceState).call(history, null, '', url); } catch (e) {}
  }

  /* ---------- apply hash -> UI (by clicking the real controls) ---------- */
  function fire(el) { el.dispatchEvent(new Event('change', { bubbles: true })); }

  function clickByOnclick(scopeSel, re) {
    var btn = qa(scopeSel).filter(function (b) { return re.test(b.getAttribute('onclick') || ''); })[0];
    if (!btn) return false;
    if (!btn.classList.contains('active')) btn.click();
    return true;
  }

  function applyHash() {
    var p = new URLSearchParams(location.hash.replace(/^#/, ''));
    busy = true;
    try {
      /* 1. filters: set everything, then fire ONE change so applyFilters() runs once */
      var changed = null;
      function setSel(id, want) {
        var el = $(id); if (!el) return;
        var ok = qa('option', el).some(function (o) { return o.value === want; });
        if (ok && el.value !== want) { el.value = want; changed = changed || el; }
      }
      setSel('flt-state', p.get('state') || 'ALL');
      setSel('flt-isic', p.get('isic') || 'ALL');
      TOGGLES.forEach(function (t) {
        var el = $(t[0]); if (!el) return;
        var want = p.get(t[1]) !== '0';
        if (el.checked !== want) { el.checked = want; changed = changed || el; }
      });
      if (changed) fire(changed);

      /* 2. tab */
      var tab = p.get('tab') || DEF.tab;
      var re = new RegExp("showTab\\(\\s*['\"]" + tab.replace(/[^\w-]/g, '') + "['\"]");
      clickByOnclick('#tab-nav .tab-btn', re);

      /* 3. sub-tabs */
      if (tab === 'tiers') {
        var tv = (p.get('tv') || DEF.tv).replace(/[^\w-]/g, '');
        clickByOnclick('#tab-tiers .sub-btn', new RegExp("showTierView\\(\\s*['\"]" + tv + "['\"]"));
        var n = (p.get('n') || DEF.n).replace(/\D/g, '');
        clickByOnclick('#tier-n button', new RegExp('setTierN\\(\\s*' + n + '\\b'));
      }
      if (tab === 'classify') {
        var cv = (p.get('cv') || DEF.cv).replace(/[^\w-]/g, '');
        clickByOnclick('#tab-classify .sub-btn', new RegExp("showClassView\\(\\s*['\"]" + cv + "['\"]"));
      }
    } finally { busy = false; }
  }

  /* ---------- user actions -> URL ---------- */
  document.addEventListener('click', function (e) {
    if (busy) return;
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#tab-nav .tab-btn, .sub-btn, #tier-n button')) {
      setTimeout(function () { sync(true); }, 0);          // after the page's own handler ran
    }
  });
  document.addEventListener('change', function (e) {
    if (busy) return;
    var t = e.target;
    if (t && /^(flt-state|flt-isic|flt-genuine|flt-clearcat|flt-clearocc)$/.test(t.id)) {
      setTimeout(function () { sync(false); }, 0);
    }
  });
  window.addEventListener('popstate', function () {
    if (restored) applyHash();
  });

  /* ---------- sector switch: keep tab + filters ---------- */
  var sw = $('hdr-switch');
  if (sw) {
    sw.onchange = function () {
      var s = new URLSearchParams(location.search);
      s.set('sector', sw.value);
      var h = readUI();
      location.href = location.pathname + '?' + s.toString() + (h ? '#' + h : '');
    };
  }

  /* ---------- wait for the data, then restore once ---------- */
  var tries = 0, seenAt = 0;
  function dataReady() {
    var st = $('flt-state');
    if (!st || st.options.length < 2) return false;
    if (!seenAt) seenAt = Date.now();
    var ds = $('db-status');
    if (ds) {
      var cs = getComputedStyle(ds);
      var shown = cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && ds.offsetHeight > 0;
      if (shown && Date.now() - seenAt < 3000) return false;   // fallback: stop waiting after 3s
    }
    return true;
  }
  var timer = setInterval(function () {
    tries++;
    if (dataReady()) {
      clearInterval(timer);
      setTimeout(function () {
        if (location.hash.replace(/^#/, '')) applyHash();
        restored = true;
      }, 150);
    } else if (tries > 200) {           // ~40 s: give up quietly, still enable syncing
      clearInterval(timer);
      restored = true;
    }
  }, 200);
})();
