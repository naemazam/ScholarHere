(function () {
  "use strict";

  const CURRENT_YEAR = new Date().getFullYear();
  let openAlexCache = {};
  let activeTab = "overview";

  const STOP_WORDS = new Set([
    "a","an","the","and","or","of","for","in","on","to","with","by","at","from",
    "using","based","via","towards","into","over","under","study","analysis",
    "approach","method","system","systems","model","models","new","novel",
    "review","survey","application","applications","framework","data","learning",
    "network","networks","design","performance","evaluation","detection","paper"
  ]);

  // Venue Tier Classifier (CORE A* / SJR Q1 heuristics)
  const ELITE_VENUES = [
    "ieee","acm","usenix","ndss","ccs","neurips","nips","icml","iclr","cvpr",
    "iccv","eccv","aaai","ijcai","acl","emnlp","naacl","sigcomm","sigmod",
    "vldb","kdd","www","chi","uist","osdi","sosp","nsdi","infocom","raid",
    "nature","science","cell","lancet","nejm","pnas","jama","bmj","nar"
  ];
  const INDEXED_PUBLISHERS = [
    "elsevier","springer","wiley","oxford","cambridge","taylor","mdpi",
    "frontiers","plos","iop","aps","acs","rsc","transactions","journal"
  ];

  function classifyVenue(venueStr) {
    const v = (venueStr || "").toLowerCase();
    if (!v) return { tier: "UNKNOWN", label: null };
    if (v.includes("arxiv") || v.includes("biorxiv") || v.includes("medrxiv") || v.includes("ssrn")) {
      return { tier: "PREPRINT", label: "PREPRINT" };
    }
    for (const kw of ELITE_VENUES) {
      if (new RegExp(`\\b${kw}\\b`, "i").test(v)) {
        return { tier: "TIER_1", label: "CORE-A* / TOP VENUE" };
      }
    }
    for (const kw of INDEXED_PUBLISHERS) {
      if (v.includes(kw)) {
        return { tier: "INDEXED", label: "INDEXED JOURNAL" };
      }
    }
    return { tier: "OTHER", label: null };
  }

  function getScholarIdentity() {
    const nameEl = document.getElementById("gsc_prf_in");
    const affEl = document.querySelector(".gsc_prf_il");
    const fullName = nameEl ? nameEl.textContent.trim() : "Unknown Scholar";
    const affiliation = affEl ? affEl.textContent.trim() : "";
    const clean = fullName.toLowerCase().replace(/[^a-z\s-]/g, "").split(/\s+/).filter(Boolean);
    const lastName = clean.length ? clean[clean.length - 1] : "";
    const firstInitial = clean.length ? clean[0][0] : "";
    return { fullName, affiliation, lastName, firstInitial };
  }

  function isTargetAuthor(authorStr, identity) {
    if (!authorStr || !identity.lastName) return false;
    const clean = authorStr.toLowerCase().replace(/[^a-z\s-]/g, "").trim();
    const parts = clean.split(/\s+/);
    if (!parts.includes(identity.lastName)) return false;
    if (identity.firstInitial && parts[0]) {
      return parts[0].startsWith(identity.firstInitial) || parts[0] === identity.lastName;
    }
    return true;
  }

  // Gini Coefficient of Citations (0 = equal impact across papers, 1 = extreme 1-hit wonder)
  function computeGini(values) {
    const arr = values.filter((x) => x >= 0).sort((a, b) => a - b);
    const n = arr.length;
    if (n === 0) return 0;
    const sum = arr.reduce((a, b) => a + b, 0);
    if (sum === 0) return 0;
    let accum = 0;
    for (let i = 0; i < n; i++) {
      accum += (2 * (i + 1) - n - 1) * arr[i];
    }
    return accum / (n * sum);
  }

  function calcHIndex(cites) {
    const sorted = [...cites].sort((a, b) => b - a);
    let h = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] >= i + 1) h = i + 1;
      else break;
    }
    return h;
  }

  // Generate clean BibTeX entry from parsed row
  function generateBibTeX(p) {
    const firstAuthorLast = (p.authors[0] || "author").split(/\s+/).pop().replace(/[^a-zA-Z]/g, "").toLowerCase();
    const firstWord = (p.title.split(/\s+/)[0] || "work").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const key = `${firstAuthorLast}${p.year || "nd"}${firstWord}`;
    return `@article{${key},\n  title={${p.title}},\n  author={${p.authors.join(" and ")}},\n  journal={${p.venue || "arXiv / Preprint"}},\n  year={${p.year || CURRENT_YEAR}}\n}`;
  }

  // Parse DOM & annotate rows
  function analyzeProfile() {
    const identity = getScholarIdentity();
    const rows = Array.from(document.querySelectorAll("#gsc_a_b .gsc_a_tr"));

    let firstCount = 0, lastCount = 0, soloCount = 0, midCount = 0;
    let tier1Count = 0, preprintCount = 0;
    let totalCitations = 0;
    const allCites = [], leadCites = [];
    const yearBuckets = {};
    const coauthorMap = {};
    const wordFreq = {};
    const papers = [];
    let minYear = CURRENT_YEAR, maxYear = 1900;

    rows.forEach((row, idx) => {
      const titleEl = row.querySelector(".gsc_a_at");
      const grayEls = row.querySelectorAll(".gs_gray");
      const citeEl = row.querySelector(".gsc_a_ac");
      const yearEl = row.querySelector(".gsc_a_hc");

      if (!titleEl) return;

      const title = titleEl.textContent.trim();
      const authorsRaw = grayEls[0] ? grayEls[0].textContent.trim() : "";
      const venueRaw = grayEls[1] ? grayEls[1].textContent.trim() : "";
      const citations = parseInt((citeEl && citeEl.textContent.trim()) || "0", 10) || 0;
      const year = parseInt((yearEl && yearEl.textContent.trim()) || "0", 10) || 0;

      if (year > 1950 && year <= CURRENT_YEAR) {
        if (year < minYear) minYear = year;
        if (year > maxYear) maxYear = year;
        yearBuckets[year] = (yearBuckets[year] || 0) + 1;
      }

      const authors = authorsRaw.split(",").map((a) => a.trim()).filter(Boolean);
      const isTruncated = authors.includes("...");

      let role = "MID";
      if (authors.length === 1 && isTargetAuthor(authors[0], identity)) {
        role = "SOLO";
        soloCount++;
      } else if (authors.length > 0 && isTargetAuthor(authors[0], identity)) {
        role = "FIRST";
        firstCount++;
      } else if (!isTruncated && authors.length > 1 && isTargetAuthor(authors[authors.length - 1], identity)) {
        role = "LAST";
        lastCount++;
      } else {
        role = "MID";
        midCount++;
      }

      // Co-author network aggregation
      authors.forEach((a) => {
        if (a === "..." || isTargetAuthor(a, identity)) return;
        const norm = a.trim();
        if (!coauthorMap[norm]) {
          coauthorMap[norm] = { name: norm, count: 0, citations: 0 };
        }
        coauthorMap[norm].count += 1;
        coauthorMap[norm].citations += citations;
      });

      const venueInfo = classifyVenue(venueRaw);
      if (venueInfo.tier === "TIER_1") tier1Count++;
      if (venueInfo.tier === "PREPRINT") preprintCount++;

      totalCitations += citations;
      allCites.push(citations);
      if (role !== "MID") leadCites.push(citations);

      const age = year ? Math.max(1, CURRENT_YEAR - year + 1) : 1;
      const velocity = citations / age;

      // Extract domain terms
      title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/).forEach((w) => {
        if (w.length > 3 && !STOP_WORDS.has(w)) {
          wordFreq[w] = (wordFreq[w] || 0) + 1;
        }
      });

      const paperObj = {
        idx,
        title,
        authors,
        venue: venueRaw,
        venueTier: venueInfo.tier,
        year,
        citations,
        velocity: Number(velocity.toFixed(1)),
        role
      };
      papers.push(paperObj);

      // Set attributes for instant filtering
      row.dataset.spRole = role;
      row.dataset.spTier = venueInfo.tier;
      row.dataset.spYear = String(year || 0);
      row.dataset.spVel = velocity >= 10 ? "HIGH" : "NORM";
      row.dataset.spSearch = `${title} ${authorsRaw} ${venueRaw}`.toLowerCase();

      // Render crisp inline annotations
      let metaBar = row.querySelector(".sp-row-meta");
      if (!metaBar) {
        metaBar = document.createElement("div");
        metaBar.className = "sp-row-meta";
        const td = row.querySelector(".gsc_a_t");
        if (td) td.appendChild(metaBar);
      }

      const roleTag =
        role === "SOLO" ? `<span class="sp-tag sp-tag-solo">SOLO</span>` :
        role === "FIRST" ? `<span class="sp-tag sp-tag-first">1ST AUTHOR</span>` :
        role === "LAST" ? `<span class="sp-tag sp-tag-last">LAST / PI</span>` :
        `<span class="sp-tag sp-tag-mid">CO-AUTHOR (#${authors.findIndex((a) => isTargetAuthor(a, identity)) + 1 || "?"})</span>`;

      const venueBadge = venueInfo.label
        ? `<span class="sp-tag sp-tag-elite">${venueInfo.label}</span>`
        : "";

      const velBadge = velocity >= 8
        ? `<span class="sp-tag sp-tag-vel">${velocity.toFixed(1)}/yr</span>`
        : "";

      const oaData = openAlexCache[title.toLowerCase()];
      const oaBadge = oaData && oaData.oaUrl
        ? `<a href="${oaData.oaUrl}" target="_blank" class="sp-tag sp-tag-oa">OPEN PDF ↗</a>`
        : "";
      const doiBadge = oaData && oaData.doi
        ? `<a href="${oaData.doi}" target="_blank" class="sp-mini-link">DOI ↗</a>`
        : "";

      metaBar.innerHTML = `
        <div class="sp-tag-list">
          ${roleTag}
          ${venueBadge}
          ${velBadge}
          ${oaBadge}
        </div>
        <div class="sp-tag-list">
          ${doiBadge}
          <button class="sp-mini-link sp-copy-bib" data-idx="${idx}">BibTeX</button>
        </div>
      `;

      const bibBtn = metaBar.querySelector(".sp-copy-bib");
      if (bibBtn) {
        bibBtn.onclick = (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(generateBibTeX(paperObj));
          bibBtn.textContent = "COPIED";
          setTimeout(() => { bibBtn.textContent = "BibTeX"; }, 1200);
        };
      }
    });

    const total = rows.length || 1;
    const leadTotal = firstCount + lastCount + soloCount;
    const leadRatio = Math.round((leadTotal / total) * 100);
    const overallH = calcHIndex(allCites);
    const leadH = calcHIndex(leadCites);
    const careerYears = maxYear >= minYear ? Math.max(1, CURRENT_YEAR - minYear + 1) : 1;
    const citesPerYear = Math.round(totalCitations / careerYears);
    const papersPerYear = (rows.length / careerYears).toFixed(1);
    const gini = computeGini(allCites).toFixed(2);

    const topCoauthors = Object.values(coauthorMap)
      .sort((a, b) => b.count - a.count || b.citations - a.citations)
      .slice(0, 10);

    const topKeywords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([w, c]) => ({ word: w, count: c }));

    return {
      identity,
      totalPapers: rows.length,
      totalCitations,
      firstCount,
      lastCount,
      soloCount,
      midCount,
      tier1Count,
      preprintCount,
      leadRatio,
      overallH,
      leadH,
      careerYears,
      minYear: minYear <= CURRENT_YEAR ? minYear : CURRENT_YEAR,
      citesPerYear,
      papersPerYear,
      gini,
      yearBuckets,
      topCoauthors,
      topKeywords,
      papers
    };
  }

  // Trigger Google Scholar's "Show More" automatically to load full career profile
  function triggerDeepScan(btn) {
    const moreBtn = document.getElementById("gsc_bpf_more");
    if (!moreBtn || moreBtn.disabled) {
      btn.textContent = "All Papers Loaded";
      return;
    }
    btn.textContent = "Scanning DOM...";
    const interval = setInterval(() => {
      const b = document.getElementById("gsc_bpf_more");
      if (!b || b.disabled) {
        clearInterval(interval);
        btn.textContent = "Full Profile Loaded";
        renderTerminal();
      } else {
        b.click();
      }
    }, 650);
  }

  // Enrich top papers with OpenAlex free API (no API key needed)
  async function enrichWithOpenAlex(stats, btn) {
    btn.textContent = "Querying OpenAlex...";
    const topSlice = stats.papers.slice(0, 15);
    for (const p of topSlice) {
      const key = p.title.toLowerCase();
      if (openAlexCache[key]) continue;
      try {
        const res = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(p.title)}&per-page=1`);
        if (!res.ok) continue;
        const data = await res.json();
        const work = data.results && data.results[0];
        if (work) {
          openAlexCache[key] = {
            doi: work.doi || null,
            oaUrl: (work.open_access && work.open_access.oa_url) || null
          };
        }
      } catch (_) {}
    }
    renderTerminal();
  }

  // Export analyzed papers to CSV
  function exportCSV(stats) {
    const headers = ["Title", "Year", "Role", "Citations", "Velocity_Per_Yr", "Venue_Tier", "Venue"];
    const rows = stats.papers.map((p) => [
      `"${p.title.replace(/"/g, '""')}"`,
      p.year,
      p.role,
      p.citations,
      p.velocity,
      p.venueTier,
      `"${(p.venue || "").replace(/"/g, '""')}"`
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${stats.identity.lastName || "scholar"}_bibliometrics.csv`;
    a.click();
  }

  function renderTerminal() {
    const host = document.getElementById("gsc_art");
    if (!host) return;

    const stats = analyzeProfile();
    if (stats.totalPapers === 0) return;

    let term = document.getElementById("sp-terminal");
    if (!term) {
      term = document.createElement("div");
      term.id = "sp-terminal";
      host.parentNode.insertBefore(term, host);
    }

    const total = stats.totalPapers || 1;
    const pFirst = Math.round((stats.firstCount / total) * 100);
    const pLast = Math.round((stats.lastCount / total) * 100);
    const pSolo = Math.round((stats.soloCount / total) * 100);
    const pMid = Math.max(0, 100 - pFirst - pLast - pSolo);

    // Build 12-Year Sparkline HTML
    const years = [];
    for (let y = CURRENT_YEAR - 11; y <= CURRENT_YEAR; y++) years.push(y);
    const maxYrCount = Math.max(1, ...years.map((y) => stats.yearBuckets[y] || 0));
    const sparkHTML = years.map((y) => {
      const c = stats.yearBuckets[y] || 0;
      const hPct = Math.round((c / maxYrCount) * 100);
      return `
        <div class="sp-spark-col" title="${y}: ${c} papers">
          <div class="sp-spark-bar" style="height:${ Math.max(4, hPct) }%"></div>
          <span class="sp-spark-yr">${String(y).slice(2)}</span>
        </div>
      `;
    }).join("");

    // Check pinned scholar for comparison
    let pinned = null;
    try {
      pinned = JSON.parse(localStorage.getItem("sp_pinned_scholar") || "null");
    } catch (_) {}

    term.innerHTML = `
      <div class="sp-topbar">
        <div class="sp-topbar-left">
          <span class="sp-mark">SCHOLARPULSE // PRO</span>
          <span class="sp-status">N=${stats.totalPapers} PAPERS • SPAN ${stats.minYear}–${CURRENT_YEAR} (${stats.careerYears}Y)</span>
        </div>
        <div class="sp-toolbar">
          <button class="sp-cmd-btn" id="sp-deep-scan" title="Auto-click Show More to load entire career">Deep Scan All</button>
          <button class="sp-cmd-btn" id="sp-enrich-oa" title="Fetch Open-Access PDFs & DOIs from OpenAlex">Fetch DOIs / PDFs</button>
          <button class="sp-cmd-btn" id="sp-pin-compare">${pinned && pinned.identity.fullName === stats.identity.fullName ? "Pinned ✓" : "Pin to Compare"}</button>
          <button class="sp-cmd-btn primary" id="sp-export-csv">Export CSV</button>
        </div>
      </div>

      <div class="sp-tabs">
        <button class="sp-tab ${activeTab === "overview" ? "active" : ""}" data-tab="overview">Bibliometric Overview</button>
        <button class="sp-tab ${activeTab === "network" ? "active" : ""}" data-tab="network">Co-Author Matrix (${stats.topCoauthors.length})</button>
        <button class="sp-tab ${activeTab === "compare" ? "active" : ""}" data-tab="compare">Benchmark / Compare ${pinned ? `vs. ${pinned.identity.lastName}` : ""}</button>
        <button class="sp-tab ${activeTab === "outreach" ? "active" : ""}" data-tab="outreach">Cold Outreach Generator</button>
      </div>

      <!-- TAB 1: OVERVIEW -->
      <div class="sp-panel ${activeTab === "overview" ? "active" : ""}" data-panel="overview">
        <div class="sp-kpi-grid">
          <div class="sp-kpi-cell">
            <div class="sp-kpi-label"><span>LEADERSHIP</span><span>1ST+LAST</span></div>
            <div class="sp-kpi-val">${stats.leadRatio}%</div>
            <div class="sp-kpi-sub">${stats.firstCount + stats.soloCount + stats.lastCount} of ${stats.totalPapers} works</div>
          </div>
          <div class="sp-kpi-cell">
            <div class="sp-kpi-label"><span>LEAD h-INDEX</span><span>INDEP.</span></div>
            <div class="sp-kpi-val">${stats.leadH} <span style="font-size:12px;color:#64748b;font-weight:400;">/ ${stats.overallH}</span></div>
            <div class="sp-kpi-sub">${stats.overallH ? Math.round((stats.leadH / stats.overallH) * 100) : 0}% ratio to total h</div>
          </div>
          <div class="sp-kpi-cell">
            <div class="sp-kpi-label"><span>CITE VELOCITY</span><span>ANNUAL</span></div>
            <div class="sp-kpi-val">${stats.citesPerYear}</div>
            <div class="sp-kpi-sub">cites/yr (${stats.papersPerYear} papers/yr)</div>
          </div>
          <div class="sp-kpi-cell">
            <div class="sp-kpi-label"><span>TOP VENUES</span><span>A* / ELITE</span></div>
            <div class="sp-kpi-val">${stats.tier1Count}</div>
            <div class="sp-kpi-sub">${Math.round((stats.tier1Count / total) * 100)}% top-tier • ${stats.preprintCount} preprints</div>
          </div>
          <div class="sp-kpi-cell">
            <div class="sp-kpi-label"><span>CITE GINI</span><span>SPREAD</span></div>
            <div class="sp-kpi-val">${stats.gini}</div>
            <div class="sp-kpi-sub">${stats.gini > 0.75 ? "Concentrated (1-2 hits)" : "Broad citation base"}</div>
          </div>
          <div class="sp-kpi-cell">
            <div class="sp-kpi-label"><span>1ST AUTHOR</span><span>PRIMARY</span></div>
            <div class="sp-kpi-val">${stats.firstCount + stats.soloCount}</div>
            <div class="sp-kpi-sub">${pFirst + pSolo}% primary execution</div>
          </div>
        </div>

        <div class="sp-split">
          <div class="sp-box">
            <div class="sp-box-title">
              <span>Authorship Position Distribution</span>
              <span class="sp-mono-num">N=${stats.totalPapers}</span>
            </div>
            <div class="sp-seg-bar">
              <div class="sp-seg-1" style="width:${pFirst}%"></div>
              <div class="sp-seg-2" style="width:${pLast}%"></div>
              <div class="sp-seg-3" style="width:${pSolo}%"></div>
              <div class="sp-seg-4" style="width:${pMid}%"></div>
            </div>
            <div class="sp-legend">
              <div class="sp-legend-item"><span><i class="sp-dot sp-seg-1"></i>First Author</span><span class="sp-mono-num">${stats.firstCount} (${pFirst}%)</span></div>
              <div class="sp-legend-item"><span><i class="sp-dot sp-seg-2"></i>Last / PI</span><span class="sp-mono-num">${stats.lastCount} (${pLast}%)</span></div>
              <div class="sp-legend-item"><span><i class="sp-dot sp-seg-3"></i>Solo Author</span><span class="sp-mono-num">${stats.soloCount} (${pSolo}%)</span></div>
              <div class="sp-legend-item"><span><i class="sp-dot sp-seg-4"></i>Middle Co-Author</span><span class="sp-mono-num">${stats.midCount} (${pMid}%)</span></div>
            </div>
          </div>

          <div class="sp-box">
            <div class="sp-box-title">
              <span>12-Year Publication Rhythm (${CURRENT_YEAR - 11}–${CURRENT_YEAR})</span>
              <span class="sp-mono-num">MAX ${maxYrCount}/YR</span>
            </div>
            <div class="sp-sparkline">${sparkHTML}</div>
          </div>
        </div>

        <div class="sp-filter-strip">
          <div class="sp-pill-group">
            <button class="sp-filter-pill active" data-f="ALL">ALL (${stats.totalPapers})</button>
            <button class="sp-filter-pill" data-f="FIRST">1ST / SOLO (${stats.firstCount + stats.soloCount})</button>
            <button class="sp-filter-pill" data-f="LAST">LAST / PI (${stats.lastCount})</button>
            <button class="sp-filter-pill" data-f="TIER_1">TOP VENUE (${stats.tier1Count})</button>
            <button class="sp-filter-pill" data-f="HIGH_VEL">HIGH VELOCITY</button>
          </div>
          <input type="text" class="sp-search-input" id="sp-live-search" placeholder="Filter by keyword, co-author, venue..." />
        </div>
      </div>

      <!-- TAB 2: CO-AUTHOR MATRIX -->
      <div class="sp-panel ${activeTab === "network" ? "active" : ""}" data-panel="network">
        <table class="sp-data-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Collaborator Name</th>
              <th>Joint Papers</th>
              <th>Combined Citations</th>
              <th>Avg Citations / Joint Work</th>
            </tr>
          </thead>
          <tbody>
            ${stats.topCoauthors.map((c, i) => `
              <tr>
                <td class="sp-mono-num">#${i + 1}</td>
                <td style="font-weight:600;">${c.name}</td>
                <td class="sp-mono-num">${c.count}</td>
                <td class="sp-mono-num">${c.citations}</td>
                <td class="sp-mono-num">${Math.round(c.citations / c.count)}</td>
              </tr>
            `).join("") || `<tr><td colspan="5">No recurring co-authors detected.</td></tr>`}
          </tbody>
        </table>
      </div>

      <!-- TAB 3: BENCHMARK / COMPARE -->
      <div class="sp-panel ${activeTab === "compare" ? "active" : ""}" data-panel="compare">
        ${!pinned ? `
          <div style="padding:16px;color:var(--sp-text-secondary);">
            Click <strong>"Pin to Compare"</strong> in the top toolbar on any scholar's profile, then open a second scholar's profile to view a side-by-side metric comparison.
          </div>
        ` : `
          <table class="sp-data-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>${stats.identity.fullName} (Current)</th>
                <th>${pinned.identity.fullName} (Pinned)</th>
                <th>Delta</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Leadership Ratio (1st + Last)</td>
                <td class="sp-mono-num">${stats.leadRatio}%</td>
                <td class="sp-mono-num">${pinned.leadRatio}%</td>
                <td class="sp-mono-num">${stats.leadRatio - pinned.leadRatio >= 0 ? "+" : ""}${stats.leadRatio - pinned.leadRatio}%</td>
              </tr>
              <tr>
                <td>Lead-Only h-index</td>
                <td class="sp-mono-num">${stats.leadH}</td>
                <td class="sp-mono-num">${pinned.leadH}</td>
                <td class="sp-mono-num">${stats.leadH - pinned.leadH >= 0 ? "+" : ""}${stats.leadH - pinned.leadH}</td>
              </tr>
              <tr>
                <td>Overall Analyzed h-index</td>
                <td class="sp-mono-num">${stats.overallH}</td>
                <td class="sp-mono-num">${pinned.overallH}</td>
                <td class="sp-mono-num">${stats.overallH - pinned.overallH >= 0 ? "+" : ""}${stats.overallH - pinned.overallH}</td>
              </tr>
              <tr>
                <td>Citation Velocity (Citations / Yr)</td>
                <td class="sp-mono-num">${stats.citesPerYear}</td>
                <td class="sp-mono-num">${pinned.citesPerYear}</td>
                <td class="sp-mono-num">${stats.citesPerYear - pinned.citesPerYear >= 0 ? "+" : ""}${stats.citesPerYear - pinned.citesPerYear}</td>
              </tr>
              <tr>
                <td>Top-Tier Venue Count</td>
                <td class="sp-mono-num">${stats.tier1Count}</td>
                <td class="sp-mono-num">${pinned.tier1Count}</td>
                <td class="sp-mono-num">${stats.tier1Count - pinned.tier1Count >= 0 ? "+" : ""}${stats.tier1Count - pinned.tier1Count}</td>
              </tr>
            </tbody>
          </table>
        `}
      </div>

      <!-- TAB 4: OUTREACH GENERATOR -->
      <div class="sp-panel ${activeTab === "outreach" ? "active" : ""}" data-panel="outreach">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:11.5px;color:var(--sp-text-secondary);font-weight:600;">Structured Academic Inquiry Template (Auto-Populated from Profile Data)</span>
          <button class="sp-cmd-btn primary" id="sp-copy-email">Copy Text</button>
        </div>
        <textarea id="sp-email-box" style="width:100%;height:130px;font-family:var(--sp-mono);font-size:11.5px;padding:10px;border:1px solid var(--sp-border-strong);border-radius:4px;box-sizing:border-box;">Subject: Research Collaboration / Prospective Supervision Inquiry — ${stats.topKeywords.slice(0, 3).map((k) => k.word).join(", ")}

Dear ${stats.identity.fullName},

I have been reviewing your recent publications at ${stats.identity.affiliation || "your institution"}, particularly "${stats.papers[0] ? stats.papers[0].title : "your recent work"}" (${stats.papers[0] ? stats.papers[0].year : CURRENT_YEAR}).

My current technical work focuses on ${stats.topKeywords.slice(0, 4).map((k) => k.word).join(", ")}, and I am reaching out to inquire regarding potential research collaboration or supervision opportunities in your group.

Thank you for your time and consideration.

Best regards,
[Your Name]</textarea>
      </div>
    `;

    // Bind Tabs
    term.querySelectorAll(".sp-tab").forEach((t) => {
      t.onclick = () => {
        activeTab = t.dataset.tab;
        renderTerminal();
      };
    });

    // Bind Toolbar Actions
    term.querySelector("#sp-deep-scan").onclick = (e) => triggerDeepScan(e.target);
    term.querySelector("#sp-enrich-oa").onclick = (e) => enrichWithOpenAlex(stats, e.target);
    term.querySelector("#sp-export-csv").onclick = () => exportCSV(stats);
    term.querySelector("#sp-pin-compare").onclick = (e) => {
      localStorage.setItem("sp_pinned_scholar", JSON.stringify(stats));
      e.target.textContent = "Pinned ✓";
    };

    const copyEmailBtn = term.querySelector("#sp-copy-email");
    if (copyEmailBtn) {
      copyEmailBtn.onclick = () => {
        const box = term.querySelector("#sp-email-box");
        navigator.clipboard.writeText(box.value);
        copyEmailBtn.textContent = "Copied ✓";
        setTimeout(() => { copyEmailBtn.textContent = "Copy Text"; }, 1400);
      };
    }

    // Bind Live Table Filters
    const applyRowFilter = (mode, query) => {
      const q = (query || "").toLowerCase().trim();
      document.querySelectorAll("#gsc_a_b .gsc_a_tr").forEach((row) => {
        let matchMode = true;
        if (mode === "FIRST") matchMode = row.dataset.spRole === "FIRST" || row.dataset.spRole === "SOLO";
        else if (mode === "LAST") matchMode = row.dataset.spRole === "LAST";
        else if (mode === "TIER_1") matchMode = row.dataset.spTier === "TIER_1";
        else if (mode === "HIGH_VEL") matchMode = row.dataset.spVel === "HIGH";

        const matchQuery = !q || (row.dataset.spSearch && row.dataset.spSearch.includes(q));
        row.style.display = matchMode && matchQuery ? "" : "none";
      });
    };

    let currentFilterMode = "ALL";
    const searchInput = term.querySelector("#sp-live-search");

    term.querySelectorAll(".sp-filter-pill").forEach((pill) => {
      pill.onclick = () => {
        term.querySelectorAll(".sp-filter-pill").forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        currentFilterMode = pill.dataset.f;
        applyRowFilter(currentFilterMode, searchInput ? searchInput.value : "");
      };
    });

    if (searchInput) {
      searchInput.oninput = (e) => {
        applyRowFilter(currentFilterMode, e.target.value);
      };
    }
  }

  renderTerminal();

  const tbody = document.getElementById("gsc_a_b");
  if (tbody) {
    const observer = new MutationObserver(() => renderTerminal());
    observer.observe(tbody, { childList: true });
  }
})();