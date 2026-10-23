/* ============================================================================
   REQUIREMENTS EXTRACTOR — single unified layer for ALL datasets.
   Ported from hospitality_requirements_extractor.jsx and
   logistics_requirements_extractor.jsx: one rule engine, the union of both
   sectors' lexicons (the richer variant kept where the two versions of a rule
   differed), with the same context vetoes that kill the known false positives
   ("unlimited employment contract", EEO boilerplate, "Visa Card Gold",
   organising visas for clients as a job task).
   Runs client-side over the loaded rows and feeds the Qualifications & Skills
   tab with visa and job-requirement classifications for the top 10 ISCO-4
   occupations.
   ========================================================================== */

var REQX = (function () {

  var DIVERSITY =
    /regardless of|irrespective of|independent of|discriminat|diversity|inclusi|equal opportunit|gender identity|sexual orientation|religion or belief/i;

  var VISA_RULES = [
    { tag: "Work permit required",
      re: /\b(work(ing)?\s*(permit|permission|authoris\w+|authoriz\w+)|permit to work|permission to work|arbeitserlaubnis|arbeitsgenehmigung)\b/gi },
    { tag: "Residence permit / residence title",
      re: /\b(residence\s*(permit|title|status|card|document)|residency\s*permit|right of residence|settlement permit|permanent residen\w+|aufenthaltstitel|aufenthaltserlaubnis|niederlassungserlaubnis)\b/gi },
    { tag: "Visa requirement",
      re: /\b(visa|visas|visum)\b/gi,
      exclude: /visa\s*(card|gold|debit|credit)|credit card|sparkasse|\bptv\b|vissim|viseva|software|simulation|for (our )?(clients|customers|guests|participants|passengers|crew)|(clients|customers|guests|participants|crew|travellers|travelers)[^.;•|]{0,25}visa|study visas?|tour operator|travel (guidelines|costs|bookings|documents)|organi[sz]ation of|organi[sz]ing|appointment of|advice|advis(e|ing)|answering questions/i },
    { tag: "EU / EEA / Swiss citizenship or equivalent status",
      re: /\b(eu[- \/]?(citizen\w*|national\w*)|eu\/ewr|citizenship|nationality|staatsangeh\w+|\beea\b|\bewr\b|swiss (citizen|national))\b/gi,
      exclude: DIVERSITY },
    { tag: "EU Blue Card", re: /\b(blue\s*card|blaue\s*karte)\b/gi },
    { tag: "Unrestricted labour market access",
      re: /(unrestricted|full)\s+(and unrestricted\s+)?(access to the\s+)?(german\s+)?(labou?r market|arbeitsmarkt)|uneingeschr\w+\s*(er|en)?\s*arbeitsmarktzugang|labou?r market access/gi },
    { tag: "Legal entitlement to work in Germany/EU",
      re: /\b(entitled|eligible|authoris\w+|authoriz\w+|permitted|allowed)\s+to work\b|\bright to work\b|arbeitsberechtig\w+/gi },
    { tag: "Recognition of foreign qualification (Anerkennung)", legalOptional: true,
      re: /\banerkennung\b|\bgleichwertigkeit\b|equivalence assessment|state[- ]recogni[sz]ed?\s+(?!degree|bachelor|master|university|study|studies|programme|program\b)\w+|staatlich anerkannt|officially recogni[sz]ed[^.;•|]{0,30}(certification|qualification|licen[cs]e)|recogni[sz]\w*[^.;•|]{0,60}?(in germany|for germany|abroad|foreign|professional qualification|qualification acquired)|(qualification|degree|diploma|training|certificate|licen[cs]e)[^.;•|]{0,40}?recogni[sz]ed in germany/gi },
    { tag: "EU / international driving licence accepted or required",
      re: /\b(eu|european|international|foreign)[- ]?(driv(ing|er'?s?)\s*licen[cs]e|f[uü]hrerschein)\b/gi },
    { tag: "Visa / relocation support offered by employer",
      re: /visa\s*(support|assistance|sponsorship|help|service)|sponsorship of (a )?visa|support (with|for) (the )?(visa|residence permit|work permit)|relocation\s*(support|assistance|package|allowance|bonus|service|help)|support (with|for) relocation|help with (relocation|moving to germany|the move to germany)|assistance with (the )?(residence|work) permit|we support you with (the )?(visa|recognition)/gi },
    { tag: "Registration / status documents required",
      re: /\b(registration certificate|meldebescheinigung|freedom of movement certificate|freiz\w+gigkeitsbescheinigung|residence registration)\b/gi }
  ];

  var JOB_RULES = [
    /* driving and vehicle credentials (logistics set, richest variants) */
    { tag: "Driving licence",
      re: /\b(driv(ing|er'?s?)\s+licen[cs]e|f[uü]hrerschein|fahrerlaubnis|licence class|(class|category|klasse)\s*[abcd]e?\d?\b)/gi },
    { tag: "Professional driver qualification (Module 95 / BKrFQG)",
      re: /\b(module\s*95|(key|code|point|number|no\.?)\s*95|registered\s*95|schl\w+ssel\w*\s*95|driver cpc|berufskraftfahrer|bkrfqg|bkf[- ]?qualifi\w*|professional driver qualification)\b/gi },
    { tag: "Driver card / digital tachograph (DTCO)",
      re: /\b(driver'?s? card|fahrerkarte|tachograph|dtco)\b/gi },
    { tag: "ADR dangerous goods certificate",
      re: /\b(adr[- ]?(schein|certificate|licen[cs]e)?|dangerous goods|hazardous goods|gefahrgut|\bimdg\b|\bicao\b|dangerous goods regulation)\b/gi },
    { tag: "Forklift / industrial truck licence",
      re: /\b(fork[- ]?lift|forklift|staplerschein|industrial truck|flurf\w+)\b/gi },
    { tag: "Crane / machine / plant operator licence",
      re: /\b(crane (licen[cs]e|operator|certificate)|kranschein|excavator|baggerf\w+|loading crane|work(ing)? platform licen[cs]e)\b/gi },
    /* education and formal qualifications */
    { tag: "Completed vocational training / apprenticeship",
      re: /\b(completed\s+(vocational\s+|professional\s+|commercial\s+)?(training|apprenticeship|education)|vocational training|apprenticeship|abgeschlossene ausbildung|ausbildung als|training as (a|an)\b)/gi },
    { tag: "University degree / higher education",
      re: /\b(bachelor|master'?s? (degree|of|in)|diploma|degree in|university degree|academic (degree|studies|education)|completed studies|studies in|hochschulabschluss|studium)\b/gi },
    { tag: "Master craftsman / IHK chamber qualification",
      re: /\b(ihk\b|master craftsman|master (craft|examination|school)|meisterbrief|meisterpr\w+|chamber of (industry|commerce|crafts)|handwerkskammer)\b/gi },
    { tag: "Instructor qualification (AEVO / Ausbildereignung)",
      re: /\b(aevo|ada[- ]?schein|ausbildereignung|instructor (skills|qualification|licen[cs]e|aptitude|certificate)|trainer aptitude|train[- ]the[- ]trainer)\b/gi },
    /* languages */
    { tag: "German language skills",
      re: /\b(german\s+(language|skills|knowledge|proficiency|level)|(language|knowledge|command|skills|level)\s+(of|in)\s+german|deutschkenntnisse|(fluent|native|business|conversational|good|very good|basic)\s+german|speak german|german at (least )?[abc][12])\b/gi },
    { tag: "English language skills",
      re: /\b(english\s+(language|skills|knowledge|proficiency|level)|(knowledge|command|skills|level)\s+(of|in)\s+english|englischkenntnisse|(fluent|business|good|very good)\s+english)\b/gi },
    /* health, safety and clearances */
    { tag: "Health certificate under Infection Protection Act (§43 IfSG)",
      re: /\b(health certificate|gesundheitszeugnis|infection protection|infektionsschutz|ifsg|§\s*43|instruction (according to|after|under) the infection)\b/gi },
    { tag: "HACCP / food hygiene certification",
      re: /\b(haccp|food hygiene|food safety|hygiene (regulations|standards|guidelines|training|knowledge|certificate|skills)|lebensmittelhygiene)\b/gi },
    { tag: "Vaccination proof (e.g. measles)",
      re: /\b(vaccinat\w+|measles|masern|impfnachweis|impfschutz|immunis\w+|immuniz\w+)\b/gi },
    { tag: "Certificate of good conduct / police clearance",
      re: /\b(certificate of good conduct|good (management|leadership|conduct) certificate|police (clearance|certificate|check)|criminal record|f[uü]hrungszeugnis)\b/gi },
    { tag: "First aid certificate", re: /\b(first aid|erste[- ]hilfe|resuscitation|\bcpr\b)\b/gi },
    /* experience and availability */
    { tag: "Professional experience required",
      re: /\b(professional experience|work experience|years? of (professional )?experience|experience (in|as|with|of)|berufserfahrung|several years)\b/gi },
    { tag: "Shift / weekend / night work availability",
      re: /\b(shift (work|service|system|operation|readiness)|schicht\w*|weekend (work|shifts?|service|duty)|night (shift|work|service|duty)|on[- ]call|flexible (working )?(hours|times|working time)|willingness to work (on|at|in))\b/gi },
    { tag: "Physical fitness / manual handling",
      re: /\b(physical(ly)? (fit\w*|resilien\w*|robust|demanding|strength|capacity)|manual handling|lifting|heavy loads|k[oö]rperlich\w*|physical resilience)\b/gi },
    { tag: "MS Office / IT and systems skills",
      re: /\b(ms[- ]?office|microsoft (office|excel|word)|ms[- ]?(excel|word)|\bexcel\b|\bsap\b|datev|\berp\b|\bedv\b|it skills|pc (skills|knowledge)|computer skills|warehouse management system|\bwms\b|scanner|handheld)\b/gi },
    { tag: "Own vehicle / travel readiness",
      re: /\b(own (car|vehicle|pkw)|eigener? (pkw|fahrzeug)|willingness to travel|travel (readiness|willingness)|reisebereitschaft|be mobile)\b/gi }
  ];

  var CEFR_RE  = /\b(A1|A2|B1|B2|C1|C2)\b/g;
  var YEARS_RE = /(\d{1,2})\s*\+?\s*(?:or more\s*)?(?:years?|jahre[n]?)\b[^.;•|]{0,45}(?:experience|erfahrung)|(?:experience|erfahrung)[^.;•|]{0,45}?(\d{1,2})\s*\+?\s*(?:years?|jahre[n]?)\b/i;
  var CLASS_RE = /\b(?:class|category|klasse)\s*([ABCDE]{1,2}\d?)\b/gi;

  function collapse(v){ return (v === null || v === undefined ? "" : String(v)).replace(/\s+/g, " ").trim(); }

  function ruleFires(text, rule){
    rule.re.lastIndex = 0;
    var m;
    while ((m = rule.re.exec(text)) !== null){
      if (m[0].length === 0){ rule.re.lastIndex++; continue; }
      if (!rule.exclude) return true;
      var win = text.slice(Math.max(0, m.index - 90), m.index + m[0].length + 90);
      if (!rule.exclude.test(win)) return true;
    }
    return false;
  }

  /* Extract visa + job tags from a single posting's combined text. */
  function extractOne(text){
    var visa = [], job = [];
    if (!text) return { visa: visa, job: job };
    var i, rule, tag, m;

    for (i = 0; i < VISA_RULES.length; i++){
      rule = VISA_RULES[i];
      if (!ruleFires(text, rule)) continue;
      if (rule.legalOptional) job.push(rule.tag); else visa.push(rule.tag);
    }
    for (i = 0; i < JOB_RULES.length; i++){
      rule = JOB_RULES[i];
      if (!ruleFires(text, rule)) continue;
      tag = rule.tag;
      if (tag === "German language skills"){
        var levels = [], windows = text.match(/[^|•;]{0,90}(?:german|deutsch|language|sprach)[^|•;]{0,90}/gi) || [];
        windows.forEach(function(w){
          (w.match(CEFR_RE) || []).forEach(function(lv){
            var up = lv.toUpperCase();
            if (levels.indexOf(up) === -1) levels.push(up);
          });
        });
        if (levels.length) tag = "German language (CEFR " + levels.sort().join("/") + ")";
      }
      if (tag === "Driving licence"){
        var classes = []; CLASS_RE.lastIndex = 0;
        while ((m = CLASS_RE.exec(text)) !== null){
          var c = m[1].toUpperCase();
          if (classes.indexOf(c) === -1) classes.push(c);
        }
        if (classes.length) tag = "Driving licence (class " + classes.sort().join("/") + ")";
      }
      if (tag === "Professional experience required"){
        m = text.match(YEARS_RE);
        var yrs = m ? (m[1] || m[2]) : null;
        if (yrs) tag = "Professional experience (" + yrs + "+ years)";
      }
      job.push(tag);
    }
    return { visa: visa, job: job };
  }

  /* Run over the full loaded dataset in chunks; aggregate per top-10 ISCO-4
     occupation; cache on the DATA object so the work happens once per load. */
  function run(DATA, ensureIdx, rowToIdx, onProgress, onDone){
    if (DATA._reqx){ onDone(DATA._reqx); return; }
    ensureIdx();
    var rows = DATA.rows, R = DATA.raw, i = 0, N = rows.length;
    var occCount = {};
    rows.forEach(function(r){ if (r[4] >= 0){ var o = DATA.lookup.isco4[r[4]]; occCount[o] = (occCount[o]||0)+1; } });
    var top10 = Object.keys(occCount).sort(function(a,b){ return occCount[b]-occCount[a]; }).slice(0,10);
    var topSet = {}; top10.forEach(function(o){ topSet[o] = { total: 0, visa: {}, job: {}, anyVisa: 0 }; });

    function step(){
      var end = Math.min(i + 250, N);
      for (; i < end; i++){
        var r = rows[i];
        if (r[4] < 0) continue;
        var occ = DATA.lookup.isco4[r[4]];
        var agg = topSet[occ];
        if (!agg) continue;
        var ix = rowToIdx.get(r);
        var text = collapse(R.req[ix]) + " || " + collapse(R.desc[ix]) + " || " + collapse(R.title[ix]);
        var out = extractOne(text);
        agg.total++;
        if (out.visa.length) agg.anyVisa++;
        out.visa.forEach(function(t){ agg.visa[t] = (agg.visa[t]||0)+1; });
        out.job.forEach(function(t){ agg.job[t]  = (agg.job[t] ||0)+1; });
      }
      if (onProgress) onProgress(Math.round(i / N * 100));
      if (i < N) setTimeout(step, 0);
      else { DATA._reqx = { top10: top10, agg: topSet, counts: occCount }; onDone(DATA._reqx); }
    }
    step();
  }

  return { run: run, extractOne: extractOne };
})();
