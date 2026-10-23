/* ============================================================================
   ROLE META  —  optional editorial copy per ISCO-3 role group.
   ----------------------------------------------------------------------------
   The dashboard always shows a data-derived insight line (share %, top employer
   sector, top state) for every role group. Where a code appears in ROLE_META,
   its `desc` (sourced editorial context) is appended after that line so the
   healthcare depth from the original dashboard is preserved verbatim. Add
   entries here as other corridors are researched; unknown codes simply show the
   data line alone. Purely additive — safe to extend.
   ============================================================================ */

var ROLE_META = {
  /* ---- Healthcare (verbatim from the original dashboard) ---- */
  222:{desc:'Registered nurses and midwives (ISCO 222). Germany\'s single largest vacancy category: 1 in 4 healthcare ads is for a nurse. <b>BA Engpassberuf</b>: average vacancy duration approximately 246 days vs. approximately 50 days nationally. Only 44 unemployed nurses per 100 open posts. Demand concentrated in residential care, hospitals, and medical practices.'},
  325:{desc:'Medical assistants (MFA), dental assistants (ZFA), ambulance workers, and physiotherapy technicians (ISCO 325). Vocational-track roles forming the outpatient backbone. <b>BA Engpassberuf</b>: high demand across medical and dental practices. CEDEFOP identifies associate health professionals as a key replacement-demand shortage group through 2030.'},
  226:{desc:'Physiotherapists, pharmacists, dentists, speech therapists, and dieticians (ISCO 226). Degree-level specialists. <b>BA Engpassberuf</b>: strong demand in outpatient and rehabilitation settings. CEDEFOP 2023 Skills Forecast identifies health professionals among Germany\'s highest-shortage occupational groups.'},
  532:{desc:'Healthcare and elderly-care assistants and home-care workers (ISCO 532). Vocational entry-level. <b>BA Engpassberuf (Altenpflege)</b>: vacancy duration reaches approximately 286 days — the longest of any healthcare category. Almost entirely concentrated in residential and long-term care. BA projects a 37% rise in long-term-care demand by 2055.'},
  221:{desc:'Generalist and specialist medical practitioners (ISCO 221). <b>BA Engpassberuf</b>: fifth-largest group by posting volume. Spread across hospitals, mental-health and rehabilitation facilities, and medical practices. Rural GP shortage is a separately documented structural gap in BA regional analyses.'},
  321:{desc:'Radiographers, laboratory technicians, pharmacy technicians and dental technicians (ISCO 321). Vocational-track medical and pharmaceutical technicians supporting diagnostics and dispensing.'},
  322:{desc:'Basic nursing care delivered under supervision (ISCO 322). Vocational-track nursing and midwifery associates.'}

  /* ---- Other sectors: add researched blurbs here as corridors mature ----
     e.g.  512:{desc:'Cooks (ISCO 512) — ...'},  */
};
