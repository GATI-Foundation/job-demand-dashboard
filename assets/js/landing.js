/* ============================================================================
   Landing page — build sector cards from SECTORS (assets/js/sectors.js) and
   fill each with LIVE counts computed directly from data/<country>/<sector>.csv.

   The count is always read from the real CSV, so it can never go stale when the
   data changes — no build step, no cached JSON. Counting is a single fast,
   quote-aware pass over the downloaded file (rows can span multiple lines
   because descriptions contain embedded newlines), which runs in well under a
   second even on the largest sheets. If a sector's CSV isn't present, the card
   simply shows a "add data" note instead of a count.
   ============================================================================ */

(function () {
  var grid = document.getElementById("sector-grid");
  if (!grid || typeof SECTORS === "undefined") return;

  var fmt = function (n) { return Number(n).toLocaleString("en-US"); };

  SECTORS.forEach(function (s) {
    var card = document.createElement("article");
    card.className = "sector-card";
    card.setAttribute("role", "listitem");
    card.style.setProperty("--card-accent", s.accent || "var(--teal)");

    card.innerHTML =
      '<div class="sector-card__top">' +
        '<span class="sector-card__icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24"><path d="' + s.icon + '"/></svg>' +
        '</span>' +
        '<span class="chip sector-card__scope">' + s.scope + '</span>' +
      '</div>' +
      '<div>' +
        '<h3>' + s.label + '</h3>' +
        '<p class="sector-card__tagline">' + s.tagline + '</p>' +
      '</div>' +
      '<div class="sector-card__stat is-loading" id="stat-' + s.id + '">' +
        '<span class="skeleton"></span></div>' +
      '<span class="sector-card__cta">Open dashboard <span class="arw" aria-hidden="true">&rarr;</span></span>' +
      '<a class="sector-card__link" href="dashboard.html?sector=' + encodeURIComponent(s.id) + '">Open the ' + s.label + ' dashboard</a>';

    grid.appendChild(card);

    /* Numbers are computed from the REAL CSV every time, so the card can never
       go stale when the data changes. On a static host the only cost is the
       network download of the file; the counting itself is a single fast pass.
       The pass is quote-aware: CSV descriptions contain embedded newlines
       inside quoted fields, so a row only ends at a newline that falls OUTSIDE
       an open quote. (Naive newline counting over-counts massively here.) */
    (function (sec) {
      function tidyDate(d){ return String(d).replace(/\s*00:00:00\s*$/, "").trim().replace(/^"|"$/g, ""); }

      function paint(n, dMin, dMax){
        var el = document.getElementById("stat-" + sec.id);
        if (!el) return;
        el.classList.remove("is-loading");
        if (!n) {
          el.classList.add("is-empty");
          el.innerHTML = '<span class="stat-pending">Add data/' + sec.id + '.csv to see counts</span>';
          return;
        }
        el.innerHTML =
          '<span class="stat-num mono">' + fmt(n) + '</span>' +
          '<span class="stat-unit">postings</span>' +
          (dMin && dMax ? '<span class="stat-sep">\u00b7</span>' +
            '<span class="stat-range">' + tidyDate(dMin) + ' to ' + tidyDate(dMax) + '</span>' : '');
      }

      function countCsv(text){
        /* trim trailing blank lines so they don't count as a row */
        var end = text.length;
        while (end > 0 && (text[end-1] === "\n" || text[end-1] === "\r")) end--;
        text = text.slice(0, end);
        if (!text) return { n: 0 };

        /* header row has no embedded newlines: read up to first unquoted \n.
           Headers never contain quotes in these files, so a plain search is safe. */
        var hEnd = text.indexOf("\n");
        if (hEnd === -1) return { n: 0 };
        var header = text.slice(0, hEnd).replace(/\r$/, "");
        var cols = header.split(",").map(function(c){ return c.replace(/^"|"$/g, "").trim(); });
        var dIdx = cols.indexOf("Date_Posted");
        if (dIdx === -1) dIdx = cols.indexOf("Date_Scraped");

        /* Count rows by scanning for the NEXT newline that sits outside any
           open quote. We jump between quotes and newlines with indexOf (bulk,
           fast) rather than inspecting every character. A row boundary is a
           newline encountered while not inside a quoted field. */
        var n = 0, dMin = null, dMax = null;
        var i = hEnd + 1, N = text.length, rowStart = i, inQ = false;
        while (i < N){
          var nextQ = text.indexOf('"', i);
          var nextNL = text.indexOf("\n", i);
          if (nextNL === -1) nextNL = N;

          if (!inQ && (nextQ === -1 || nextNL < nextQ)){
            /* a real row boundary */
            if (nextNL > rowStart){
              n++;
              if (dIdx >= 0){
                var line = text.slice(rowStart, nextNL);
                var d = nthField(line, dIdx);
                if (d){ if (!dMin || d < dMin) dMin = d; if (!dMax || d > dMax) dMax = d; }
              }
            }
            rowStart = nextNL + 1;
            i = nextNL + 1;
          } else {
            /* toggle quote state and continue from just past the quote */
            inQ = !inQ;
            i = nextQ + 1;
          }
        }
        if (rowStart < N){   /* final row with no trailing newline */
          n++;
          if (dIdx >= 0){
            var lastD = nthField(text.slice(rowStart, N), dIdx);
            if (lastD){ if (!dMin || lastD < dMin) dMin = lastD; if (!dMax || lastD > dMax) dMax = lastD; }
          }
        }
        return { n: n, dMin: dMin, dMax: dMax };
      }

      /* return the value of field #idx from one already-isolated CSV line */
      function nthField(line, idx){
        var out = "", cur = "", q = false, f = 0;
        for (var i = 0; i < line.length; i++){
          var c = line[i];
          if (c === '"'){ if (q && line[i+1] === '"'){ cur += '"'; i++; } else q = !q; }
          else if (c === "," && !q){ if (f === idx){ out = cur; break; } f++; cur = ""; }
          else cur += c;
        }
        if (f === idx && !out) out = cur;
        return out.replace(/\r$/, "").replace(/^"|"$/g, "").trim();
      }

      /* ---- fast path: cache the count against the file's real identity -----
         A tiny HEAD request returns Content-Length + Last-Modified (a few
         bytes, instant). We key a localStorage cache on that signature, so:
           • first ever view: download once, count, store the result;
           • every later view: the signature matches → paint instantly, no
             megabyte download at all;
           • the moment the CSV changes, its size/date changes, the signature
             no longer matches, and we recount automatically.
         This keeps the number 100% live (never a hand-maintained file) while
         costing a full download only when the data has actually changed. */
      var CACHE_KEY = "gati:cardcount:" + GATI_COUNTRY + ":" + sec.id;

      function readCache(){
        try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); }
        catch (e) { return null; }
      }
      function writeCache(sig, r){
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ sig: sig, n: r.n, dMin: r.dMin, dMax: r.dMax })); }
        catch (e) { /* storage full or blocked — counting still works, just uncached */ }
      }
      /* Everything below is fire-and-forget and time-boxed: a stalled network
         request can NEVER hang the page or block the card's "Open dashboard"
         link. If a count hasn't arrived within 5s we just show a neutral state
         and move on. The <a> link works immediately regardless. */
      var settled = false;
      function safePaint(n, dMin, dMax){ if(settled) return; settled = true; paint(n, dMin, dMax); }
      function paintUnknown(){
        if(settled) return; settled = true;
        var el = document.getElementById("stat-" + sec.id);
        if(!el) return;
        el.classList.remove("is-loading");
        el.innerHTML = '<span class="stat-unit" style="color:#7A9C9C">Open to view details</span>';
      }
      var killTimer = setTimeout(paintUnknown, 5000);

      function withTimeout(promise){
        return Promise.race([
          promise,
          new Promise(function(_, rej){ setTimeout(function(){ rej(new Error("timeout")); }, 4500); })
        ]);
      }

      function downloadAndCount(sig){
        withTimeout(fetch(csvUrlFor(sec)))
          .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
          .then(function (text) {
            var r = countCsv(text);
            if (sig) writeCache(sig, r);
            clearTimeout(killTimer); safePaint(r.n, r.dMin, r.dMax);
          })
          .catch(function () { clearTimeout(killTimer); paintUnknown(); });
      }

      /* HEAD first to get a cheap signature; if the server doesn't allow HEAD
         or omits the headers, we simply fall back to a live full count. */
      withTimeout(fetch(csvUrlFor(sec), { method: "HEAD" }))
        .then(function (r) {
          if (!r.ok) throw new Error(r.status);
          var sig = (r.headers.get("Last-Modified") || "") + "|" + (r.headers.get("Content-Length") || "");
          if (sig === "|") { downloadAndCount(null); return; }   /* no usable headers */
          var cached = readCache();
          if (cached && cached.sig === sig && cached.n) {
            clearTimeout(killTimer); safePaint(cached.n, cached.dMin, cached.dMax);   /* instant */
          } else {
            downloadAndCount(sig);                                /* first time / changed */
          }
        })
        .catch(function () { downloadAndCount(null); });          /* HEAD unsupported → live count */
    })(s);
  });
})();
