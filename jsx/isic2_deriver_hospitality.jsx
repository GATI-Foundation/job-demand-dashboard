import React, { useState } from "react";
import Papa from "papaparse";

// ============================================================
// EMPLOYER_CATEGORY -> ISIC Rev.4 TWO-DIGIT DIVISION names  [HOSPITALITY]
// ============================================================
// Input 1: hospitality_final_final.csv  (already has Employer_ISIC_4 from the
//          previous classifier)
// Input 2: ISICRev4_NT_input_csv.csv  (the ILO sheet — has the 2-digit divisions)
//
// No API calls. ISIC is hierarchical: division = first 2 digits of the class.
//   Employer_ISIC_2   = Employer_ISIC_4.slice(0,2)
//   Employer_Category = the 2-digit DIVISION's official name from the sheet
// Employer_ISIC_4 and the confidence column are kept unchanged.
// Rows without a valid 4-digit code stay "Not specified".
// Output: hospitality_final_isic2.csv
// ============================================================

export default function Isic2DeriverHospitality() {
  const [rows, setRows] = useState(null);
  const [isic2, setIsic2] = useState(null);      // {2-digit code -> division name}
  const [status, setStatus] = useState("Upload the classified dataset and the ISIC sheet.");
  const [dlUrl, setDlUrl] = useState(null);
  const [dlRows, setDlRows] = useState(0);
  const [topCats, setTopCats] = useState([]);
  const [colOrder, setColOrder] = useState([]);
  const [stats, setStats] = useState(null);

  const loadDataset = (file) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        if (!res.meta.fields || !res.meta.fields.includes("Employer_ISIC_4")) {
          setStatus("This file has no Employer_ISIC_4 column — upload the output of the 4-digit classifier (hospitality_final_final.csv).");
          return;
        }
        setRows(res.data);
        setStatus(`Dataset loaded: ${res.data.length.toLocaleString()} rows. ` +
                  (isic2 ? "Ready — click Derive." : "Now upload the ISIC CSV."));
      },
      error: (e) => setStatus("Dataset parse error: " + e.message),
    });
  };

  const loadIsic = (file) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        const map = {};
        for (const r of res.data) {
          const code = String(r["Code"] || "").trim();
          const name = String(r["ISIC Rev. 4 label"] || "").trim();
          if (/^\d{2}$/.test(code) && name) map[code] = name;
        }
        if (Object.keys(map).length < 80) {
          setStatus(`ISIC sheet parsed but only ${Object.keys(map).length} 2-digit divisions found — check the file.`);
          return;
        }
        setIsic2(map);
        setStatus(`ISIC loaded: ${Object.keys(map).length} two-digit divisions. ` +
                  (rows ? "Ready — click Derive." : "Now upload the dataset CSV."));
      },
      error: (e) => setStatus("ISIC parse error: " + e.message),
    });
  };

  const derive = () => {
    let mapped = 0, unresolved = 0, orphan = 0;
    const out = rows.map((r) => {
      const c4 = String(r["Employer_ISIC_4"] || "").trim();
      let c2 = "", name = "Not specified";
      if (/^\d{4}$/.test(c4)) {
        c2 = c4.slice(0, 2);
        if (isic2[c2]) { name = isic2[c2]; mapped++; }
        else { c2 = ""; orphan++; }         // 4-digit present but parent missing (shouldn't happen)
      } else {
        unresolved++;
      }
      return { ...r, Employer_ISIC_2: c2, Employer_Category: name };
    });

    // summary
    const counts = {};
    for (const r of out) counts[r.Employer_Category] = (counts[r.Employer_Category] || 0) + 1;
    setTopCats(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20));
    setColOrder(out.length ? Object.keys(out[0]) : []);
    setStats({ mapped, unresolved, orphan });

    const csv = Papa.unparse(out);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    if (dlUrl) URL.revokeObjectURL(dlUrl);
    setDlUrl(URL.createObjectURL(blob));
    setDlRows(out.length);
    setStatus("Derivation done — save the CSV below.");
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 font-sans">
      <div className="max-w-3xl mx-auto space-y-5">
        <h1 className="text-2xl font-bold text-teal-300">Employer → ISIC-2 Division Names — Hospitality</h1>
        <p className="text-sm text-slate-400">
          Derives the 2-digit ISIC division from the existing Employer_ISIC_4 code and writes the division's official
          name into Employer_Category. Pure lookup against the ILO sheet — no model, no API, instant.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <label className="block bg-slate-800 rounded-xl p-4 cursor-pointer hover:bg-slate-700">
            <span className="text-sm font-semibold text-teal-200">1. Classified dataset</span>
            <p className="text-xs text-slate-400 mt-1">hospitality_final_final.csv (has Employer_ISIC_4)</p>
            <input type="file" accept=".csv" className="hidden"
                   onChange={e => e.target.files[0] && loadDataset(e.target.files[0])} />
            {rows && <p className="text-xs text-emerald-400 mt-2">✓ {rows.length.toLocaleString()} rows</p>}
          </label>
          <label className="block bg-slate-800 rounded-xl p-4 cursor-pointer hover:bg-slate-700">
            <span className="text-sm font-semibold text-teal-200">2. ISIC CSV</span>
            <p className="text-xs text-slate-400 mt-1">ISICRev4_NT_input_csv.csv</p>
            <input type="file" accept=".csv" className="hidden"
                   onChange={e => e.target.files[0] && loadIsic(e.target.files[0])} />
            {isic2 && <p className="text-xs text-emerald-400 mt-2">✓ {Object.keys(isic2).length} divisions</p>}
          </label>
        </div>

        <div className="bg-slate-800 rounded-xl p-4 text-sm">{status}</div>

        <div className="flex gap-3">
          <button onClick={derive} disabled={!rows || !isic2}
                  className="px-5 py-2 rounded-lg bg-teal-500 hover:bg-teal-400 disabled:bg-slate-700 disabled:text-slate-500 font-semibold">
            Derive ISIC-2 names
          </button>
          {dlUrl && (
            <a href={dlUrl} download="hospitality_final_isic2.csv"
               className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 font-semibold inline-block">
              ⬇ Save hospitality_final_isic2.csv ({dlRows.toLocaleString()} rows)
            </a>
          )}
        </div>

        {stats && (
          <div className="bg-slate-800 rounded-xl p-4 text-xs text-slate-300">
            mapped to a division: <span className="text-emerald-400 font-mono">{stats.mapped.toLocaleString()}</span>
            {" · "}no 4-digit code (stay Not specified): <span className="text-amber-400 font-mono">{stats.unresolved.toLocaleString()}</span>
            {stats.orphan > 0 && <>{" · "}orphan codes: <span className="text-rose-400 font-mono">{stats.orphan}</span></>}
          </div>
        )}

        {topCats.length > 0 && (
          <div className="bg-slate-800 rounded-xl p-4">
            <p className="text-sm font-semibold text-teal-200 mb-2">Top 20 Employer_Category (ISIC-2 divisions) by row count</p>
            <table className="w-full text-xs">
              <tbody>
                {topCats.map(([name, cnt], i) => (
                  <tr key={i} className="border-t border-slate-700">
                    <td className="py-1 pr-2 text-slate-500">{i + 1}.</td>
                    <td className="py-1 pr-2 text-slate-200">{name.slice(0, 60)}</td>
                    <td className="py-1 text-right font-mono text-teal-300">{cnt.toLocaleString()}</td>
                    <td className="py-1 pl-2 text-right text-slate-400">{(100 * cnt / dlRows).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {colOrder.length > 0 && (
          <div className="bg-slate-800 rounded-xl p-4">
            <p className="text-sm font-semibold text-teal-200 mb-2">Final column order ({colOrder.length} columns)</p>
            <ol className="text-xs text-slate-300 grid grid-cols-2 gap-x-6">
              {colOrder.map((c, i) => (
                <li key={i} className="py-0.5 border-t border-slate-700/60">
                  <span className="text-slate-500 font-mono mr-2">{i + 1}.</span>{c}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
