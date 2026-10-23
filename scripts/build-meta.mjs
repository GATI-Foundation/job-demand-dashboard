/* ============================================================================
   build-meta.mjs
   Scans data/<sector>.csv and writes data/<sector>.meta.json — a tiny summary
   (total postings, date range, #states, top occupation, build date) that the
   landing page reads so it can show live counts WITHOUT downloading full CSVs.

   Run locally:   node scripts/build-meta.mjs
   In CI:         invoked by .github/workflows/deploy.yml before the Pages deploy.

   No dependencies — includes a small RFC-4180 CSV parser so embedded commas,
   quotes and newlines in Description/Requirements fields are handled correctly.
   ============================================================================ */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* --- RFC-4180 CSV parse --- */
function parseCSV(text) {
  const rows = []; let field = "", rec = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') { inQ = true; }
    else if (ch === ",") { rec.push(field); field = ""; }
    else if (ch === "\n") { rec.push(field); rows.push(rec); rec = []; field = ""; }
    else if (ch === "\r") { /* handled by \n */ }
    else field += ch;
  }
  if (field.length || rec.length) { rec.push(field); rows.push(rec); }
  return rows;
}
function toObjects(rows) {
  const hdr = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.length > 1).map((r) => {
    const o = {}; hdr.forEach((h, i) => (o[h] = (r[i] ?? "").trim())); return o;
  });
}
function fmtRange(min, max) {
  if (!min || !max) return "—";
  const a = min.getDate() + " " + MON[min.getMonth()], b = max.getDate() + " " + MON[max.getMonth()];
  return min.getFullYear() === max.getFullYear()
    ? a + " – " + b + " " + max.getFullYear()
    : a + " " + min.getFullYear() + " – " + b + " " + max.getFullYear();
}

function buildMeta(sector, csvText) {
  const recs = toObjects(parseCSV(csvText));
  let total = 0, states = new Set(), occ = {}, dates = [];
  for (const r of recs) {
    const scope = r.Scope_Category || "", cat = r.Job_Category || "", isco4 = r.ISCO_4 || "";
    if (scope === "Out of Scope" || cat === "Out of Scope" || cat === "CLASSIFICATION_FAILED" || !isco4) continue;
    total++;
    if (r.State) states.add(r.State);
    const nm = r.ISCO_4_name || r.ISCO_Occupation_Title || ("ISCO " + isco4);
    occ[nm] = (occ[nm] || 0) + 1;
    const d = r.Date_Posted ? new Date(r.Date_Posted) : null;
    if (d && !isNaN(d)) dates.push(d);
  }
  const min = dates.length ? new Date(Math.min(...dates)) : null;
  const max = dates.length ? new Date(Math.max(...dates)) : null;
  const topOcc = Object.keys(occ).sort((a, b) => occ[b] - occ[a])[0] || null;
  return {
    sector,
    total,
    states: states.size,
    dateRange: fmtRange(min, max),
    topOccupation: topOcc,
    updated: new Date().toISOString().slice(0, 10)
  };
}

/* --- run over every data/*.csv --- */
const csvs = readdirSync(DATA_DIR).filter((f) => f.toLowerCase().endsWith(".csv"));
if (!csvs.length) { console.log("No CSVs in data/ — nothing to do."); process.exit(0); }

for (const file of csvs) {
  const sector = file.replace(/\.csv$/i, "");
  try {
    const meta = buildMeta(sector, readFileSync(join(DATA_DIR, file), "utf8"));
    writeFileSync(join(DATA_DIR, sector + ".meta.json"), JSON.stringify(meta, null, 2) + "\n");
    console.log(`✓ ${sector}.meta.json  —  ${meta.total} postings, ${meta.states} states, ${meta.dateRange}`);
  } catch (e) {
    console.error(`✗ ${file}: ${e.message}`);
  }
}
