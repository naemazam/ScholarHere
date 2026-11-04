(function () {
  "use strict";

  const CURRENT_YEAR = new Date().getFullYear();
  const OFFICIAL_SITE = "https://scholarhere.vercel.app/";
  const GITHUB_RAW_LOGO = "https://raw.githubusercontent.com/naemazam/ScholarHere/main/SHlogo.png";

  const IS_ORCID = window.location.hostname.includes("orcid.org");

  let openAlexCache = {};
  let orcidRecordsCache = null;
  let orcidSyncInProgress = false;
  let activeOrcidId = null;

  let activeTab = "overview";
  let evidenceFilter = "ALL_HCORE";
  let isDarkMode = localStorage.getItem("sh_theme") === "dark";

  function getLogoUrl() {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
        return chrome.runtime.getURL("SHlogo.png");
      }
    } catch (_) {}
    return GITHUB_RAW_LOGO;
  }

  function extractOrcidId() {
    const match = window.location.pathname.match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i);
    return match ? match[1].toUpperCase() : null;
  }

  const STOP_WORDS = new Set([
    "a","an","the","and","or","of","for","in","on","to","with","by","at","from",
    "using","based","via","towards","into","over","under","study","analysis",
    "approach","method","system","systems","model","models","new","novel",
    "review","survey","application","applications","framework","data","learning",
    "network","networks","design","performance","evaluation","detection","paper"
  ]);

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
    if (v.includes("arxiv") || v.includes("biorxiv") || v.includes("medrxiv") || v.includes("ssrn") || v.includes("preprint")) {
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
    if (!IS_ORCID) {
      const nameEl = document.getElementById("gsc_prf_in");
      const affEl = document.querySelector(".gsc_prf_il");
      const fullName = nameEl ? nameEl.textContent.trim() : "Unknown Scholar";
      const affiliation = affEl ? affEl.textContent.trim() : "";
      const clean = fullName.toLowerCase().replace(/[^a-z\s-]/g, "").split(/\s+/).filter(Boolean);
      const lastName = clean.length ? clean[clean.length - 1] : "";
      const firstInitial = clean.length ? clean[0][0] : "";
      return { fullName, affiliation, lastName, firstInitial, orcid: null };
    }

    // ORCID Profile Identity Extraction
    const orcidId = extractOrcidId();
    const nameEl = document.querySelector("h1.orc-font-heading, .full-name, h1");
    let fullName = nameEl ? nameEl.textContent.trim() : "";
    if (!fullName || fullName.includes("0000-")) {
      fullName = (document.title || "").split("(")[0].split("|")[0].split("-")[0].trim() || `ORCID ${orcidId}`;
    }
    const affEl = document.querySelector("app-affiliation-stack .title, .affiliation-data");
    const affiliation = affEl ? affEl.textContent.trim() : `ORCID ${orcidId}`;

    const clean = fullName.toLowerCase().replace(/[^a-z\s-]/g, "").split(/\s+/).filter(Boolean);
    const lastName = clean.length ? clean[clean.length - 1] : "";
    const firstInitial = clean.length ? clean[0][0] : "";
    return { fullName, affiliation, lastName, firstInitial, orcid: orcidId };
  }

  function isTargetAuthor(authorStr, identity) {
    if (!authorStr || !identity.lastName) return false;
    const clean = authorStr.toLowerCase().replace(/[^a-z\s-]/g, "").trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (!parts.includes(identity.lastName)) return false;
    if (identity.firstInitial && parts[0]) {
      return parts[0].startsWith(identity.firstInitial) || parts[0] === identity.lastName;
    }
    return true;
  }

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

  function generateBibTeX(p) {
    const firstAuthorLast = (p.authors[0] || "author").split(/\s+/).pop().replace(/[^a-zA-Z]/g, "").toLowerCase();
    const firstWord = (p.title.split(/\s+/)[0] || "work").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const key = `${firstAuthorLast}${p.year || "nd"}${firstWord}`;
    return `@article{${key},\n  title={${p.title}},\n  author={${p.authors.join(" and ")}},\n  journal={${p.venue || "Preprint"}},\n  year={${p.year || CURRENT_YEAR}}\n}`;
  }

  function reconstructAbstract(invertedIndex) {
    if (!invertedIndex) return null;
    const words = [];
    Object.entries(invertedIndex).forEach(([word, positions]) => {
      positions.forEach((pos) => {
        words[pos] = word;
      });
    });
    return words.filter(Boolean).join(" ");
  }

  async function inspectSinglePaper(title, tdElement, btn) {
    const existing = tdElement.querySelector(".sh-abstract-drawer");
    if (existing) {
      existing.remove();
      btn.textContent = "Inspect";
      return;
    }
    btn.textContent = "Loading...";
    const key = title.toLowerCase();
    if (!openAlexCache[key]) {
      try {
        const res = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(title)}&per-page=1`);
        if (res.ok) {
          const data = await res.json();
          const work = data.results && data.results[0];
          if (work) {
            openAlexCache[key] = {
              doi: work.doi || null,
              oaUrl: (work.open_access && work.open_access.oa_url) || null,
              abstract: reconstructAbstract(work.abstract_inverted_index),
              type: work.type || "article",
              fullAuthors: (work.authorships || []).map((a) => a.author && a.author.display_name).filter(Boolean)
            };
          }
        }
      } catch (_) {}
    }

    const info = openAlexCache[key];
    const drawer = document.createElement("div");
    drawer.className = "sh-abstract-drawer";
    if (info && (info.abstract || info.doi || info.oaUrl)) {
      drawer.innerHTML = `
        <div style="font-weight:700;margin-bottom:4px;display:flex;justify-content:space-between;">
          <span>ScholarHere OpenAlex Evidence (${(info.type || "work").toUpperCase()})</span>
          <span>
            ${info.doi ? `<a href="${info.doi}" target="_blank" style="color:#2563eb;margin-right:8px;">DOI ↗</a>` : ""}
            ${info.oaUrl ? `<a href="${info.oaUrl}" target="_blank" style="color:#059669;font-weight:700;">Open PDF ↗</a>` : ""}
          </span>
        </div>
        <div>${info.abstract ? info.abstract : "No abstract indexed in OpenAlex for this record."}</div>
      `;
    } else {
      drawer.textContent = "No additional OpenAlex metadata found for this paper title.";
    }
    tdElement.appendChild(drawer);
    btn.textContent = "Hide";
  }

  // Automatic ORCID Dual-API Sync (OpenAlex ORCID Index + ORCID Public v3.0 Registry)
  async function syncOrcidProfileData(orcidId) {
    if (!orcidId || orcidSyncInProgress) return;
    orcidSyncInProgress = true;
    const recordsMap = new Map();

    try {
      // 1. Query OpenAlex by exact ORCID iD (gives citations, full authorships, exact author_position, venue, OA PDF)
      const oaRes = await fetch(
        `https://api.openalex.org/works?filter=authorships.author.orcid:${orcidId}&per-page=200&sort=cited_by_count:desc`
      );
      if (oaRes.ok) {
        const oaData = await oaRes.json();
        (oaData.results || []).forEach((w) => {
          const title = (w.title || w.display_name || "").trim();
          if (!title) return;
          const normTitle = title.toLowerCase();
          const authorships = w.authorships || [];
          const fullAuthors = authorships.map((a) => (a.author && a.author.display_name) || a.raw_author_name).filter(Boolean);

          // Find exact authorship entry matching this ORCID iD
          const targetIdx = authorships.findIndex((a) => {
            const aOrcid = (a.author && a.author.orcid) || a.raw_orcid || "";
            return aOrcid.toUpperCase().includes(orcidId);
          });

          const venue =
            (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) ||
            w.type ||
            "";
          const oaUrl = (w.open_access && w.open_access.oa_url) || null;
          const doi = w.doi || null;

          openAlexCache[normTitle] = {
            doi,
            oaUrl,
            abstract: reconstructAbstract(w.abstract_inverted_index),
            type: w.type || "article",
            fullAuthors
          };

          recordsMap.set(normTitle, {
            title,
            authors: fullAuthors,
            exactPos: targetIdx !== -1 ? targetIdx + 1 : null,
            venue,
            year: w.publication_year || 0,
            citations: w.cited_by_count || 0,
            doi,
            oaUrl
          });
        });
      }
    } catch (_) {}

    try {
      // 2. Also query ORCID Public API v3.0 /works to catch any unindexed or brand-new works on their ORCID page
      const orcidRes = await fetch(`https://pub.orcid.org/v3.0/${orcidId}/works`, {
        headers: { Accept: "application/json" }
      });
      if (orcidRes.ok) {
        const orcidJson = await orcidRes.json();
        const groups = orcidJson.group || [];
        groups.forEach((g) => {
          const summary = g["work-summary"] && g["work-summary"][0];
          if (!summary) return;
          const title =
            summary.title && summary.title.title && summary.title.title.value
              ? summary.title.title.value.trim()
              : "";
          if (!title) return;
          const normTitle = title.toLowerCase();
          if (recordsMap.has(normTitle)) return;

          const year =
            summary["publication-date"] &&
            summary["publication-date"].year &&
            summary["publication-date"].year.value
              ? parseInt(summary["publication-date"].year.value, 10)
              : 0;
          const venue =
            summary["journal-title"] && summary["journal-title"].value
              ? summary["journal-title"].value
              : summary.type || "";

          let doi = null;
          const extIds =
            (summary["external-ids"] && summary["external-ids"]["external-id"]) || [];
          extIds.forEach((eid) => {
            if (eid["external-id-type"] === "doi" && eid["external-id-value"]) {
              doi = `https://doi.org/${eid["external-id-value"]}`;
            }
          });

          recordsMap.set(normTitle, {
            title,
            authors: [],
            exactPos: null,
            venue,
            year,
            citations: 0,
            doi,
            oaUrl: null
          });
        });
      }
    } catch (_) {}

    orcidRecordsCache = Array.from(recordsMap.values());
    orcidSyncInProgress = false;
    renderTerminal();
  }

  // Decorate ORCID Angular work cards on the page and wire them for live filtering
  function annotateOrcidDOMCards(papersByNormTitle) {
    const cards = Array.from(document.querySelectorAll("app-work-stack, app-work"));
    cards.forEach((card) => {
      const titleEl = card.querySelector("h4, .work-title, [id^='cy-work-title']");
      if (!titleEl) return;
      const title = titleEl.textContent.trim();
      const p = papersByNormTitle.get(title.toLowerCase());
      if (!p) return;

      card.dataset.shRole = p.role;
      card.dataset.shTier = p.venueTier;
      card.dataset.shVel = p.velocity >= 8 ? "HIGH" : "NORM";
      card.dataset.shSearch = `${p.title} ${p.authors.join(" ")} ${p.venue}`.toLowerCase();

      let metaBar = card.querySelector(".sh-row-meta");
      if (!metaBar) {
        metaBar = document.createElement("div");
        metaBar.className = "sh-row-meta";
        metaBar.style.padding = "4px 12px 6px 12px";
        card.appendChild(metaBar);
      }

      const posLabel = p.authorPos ? `${p.authorPos}/${p.authorCount}` : `?/${p.authorCount}`;
      const roleTag =
        p.role === "SOLO" ? `<span class="sh-tag sh-tag-solo">SOLO (1/1)</span>` :
        p.role === "FIRST" ? `<span class="sh-tag sh-tag-first">1ST AUTHOR (${posLabel})</span>` :
        p.role === "LAST" ? `<span class="sh-tag sh-tag-last">LAST / PI (${posLabel})</span>` :
        `<span class="sh-tag sh-tag-mid">CO-AUTHOR (${posLabel})</span>`;

      const citeBadge = `<span class="sh-tag sh-tag-solo">${p.citations} CITES</span>`;
      const venueInfo = classifyVenue(p.venue);
      const venueBadge = venueInfo.label ? `<span class="sh-tag sh-tag-elite">${venueInfo.label}</span>` : "";
      const velBadge = p.velocity >= 8 ? `<span class="sh-tag sh-tag-vel">${p.velocity.toFixed(1)}/yr</span>` : "";

      const oaCached = openAlexCache[title.toLowerCase()];
      const oaBadge = oaCached && oaCached.oaUrl
        ? `<a href="${oaCached.oaUrl}" target="_blank" class="sh-tag sh-tag-oa">OPEN PDF ↗</a>`
        : "";
      const doiBadge = oaCached && oaCached.doi
        ? `<a href="${oaCached.doi}" target="_blank" class="sh-mini-link">DOI ↗</a>`
        : "";

      metaBar.innerHTML = `
        <div class="sh-tag-list">
          ${roleTag}
          ${citeBadge}
          ${venueBadge}
          ${velBadge}
          ${oaBadge}
        </div>
        <div class="sh-tag-list">
          ${doiBadge}
          <button class="sh-mini-link sh-inspect-btn">Inspect</button>
          <button class="sh-mini-link sh-copy-bib">BibTeX</button>
        </div>
      `;

      const bibBtn = metaBar.querySelector(".sh-copy-bib");
      if (bibBtn) {
        bibBtn.onclick = (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(generateBibTeX(p));
          bibBtn.textContent = "COPIED";
          setTimeout(() => { bibBtn.textContent = "BibTeX"; }, 1200);
        };
      }

      const inspectBtn = metaBar.querySelector(".sh-inspect-btn");
      if (inspectBtn) {
        inspectBtn.onclick = (e) => {
          e.stopPropagation();
          inspectSinglePaper(p.title, card, inspectBtn);
        };
      }
    });
  }

  function analyzeProfile() {
    const identity = getScholarIdentity();

    let firstCount = 0, lastCount = 0, soloCount = 0, midCount = 0;
    let tier1Count = 0, preprintCount = 0;
    let truncatedCount = 0;
    let fractionalCreditSum = 0;
    let totalAuthorCountSum = 0;
    let teamSolo = 0, teamSmall = 0, teamMed = 0, teamLarge = 0;

    let totalCitations = 0;
    let leadCitationsSum = 0;
    const allCites = [], leadCites = [];
    const yearBuckets = {};
    const coauthorMap = {};
    const wordFreq = {};
    const papers = [];
    let minYear = CURRENT_YEAR, maxYear = 1900;

    if (IS_ORCID) {
      // Build source list from ORCID + OpenAlex cache, or fallback to visible ORCID DOM cards while syncing
      let sourceRecords = orcidRecordsCache || [];
      if (sourceRecords.length === 0) {
        const domCards = Array.from(document.querySelectorAll("app-work-stack, app-work"));
        sourceRecords = domCards.map((c) => {
          const tEl = c.querySelector("h4, .work-title");
          const text = c.textContent || "";
          const yrMatch = text.match(/\b(19[7-9]\d|20[0-2]\d)\b/);
          return tEl
            ? {
                title: tEl.textContent.trim(),
                authors: [identity.fullName],
                exactPos: 1,
                venue: "",
                year: yrMatch ? parseInt(yrMatch[1], 10) : 0,
                citations: 0
              }
            : null;
        }).filter(Boolean);
      }

      const papersByNormTitle = new Map();

      sourceRecords.forEach((rec, idx) => {
        const title = rec.title;
        const year = rec.year || 0;
        const citations = rec.citations || 0;
        const venueRaw = rec.venue || "";
        const cleanAuthors = rec.authors && rec.authors.length ? rec.authors : [identity.fullName];
        const authorCount = Math.max(1, cleanAuthors.length);

        let authorPos = rec.exactPos;
        if (!authorPos) {
          const mIdx = cleanAuthors.findIndex((a) => isTargetAuthor(a, identity));
          authorPos = mIdx !== -1 ? mIdx + 1 : 1;
        }

        if (year > 1950 && year <= CURRENT_YEAR) {
          if (year < minYear) minYear = year;
          if (year > maxYear) maxYear = year;
          yearBuckets[year] = (yearBuckets[year] || 0) + 1;
        }

        let role = "MID";
        if (authorCount === 1) {
          role = "SOLO";
          soloCount++;
        } else if (authorPos === 1) {
          role = "FIRST";
          firstCount++;
        } else if (authorPos === authorCount) {
          role = "LAST";
          lastCount++;
        } else {
          role = "MID";
          midCount++;
        }

        totalAuthorCountSum += authorCount;
        const fracCredit = 1 / authorCount;
        fractionalCreditSum += fracCredit;

        if (authorCount === 1) teamSolo++;
        else if (authorCount <= 4) teamSmall++;
        else if (authorCount <= 8) teamMed++;
        else teamLarge++;

        cleanAuthors.forEach((a, aIdx) => {
          if (aIdx + 1 === authorPos || isTargetAuthor(a, identity)) return;
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
        if (role !== "MID") {
          leadCites.push(citations);
          leadCitationsSum += citations;
        }

        const age = year ? Math.max(1, CURRENT_YEAR - year + 1) : 1;
        const velocity = citations / age;

        title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/).forEach((w) => {
          if (w.length > 3 && !STOP_WORDS.has(w)) {
            wordFreq[w] = (wordFreq[w] || 0) + 1;
          }
        });

        const paperObj = {
          idx,
          title,
          authors: cleanAuthors,
          authorPos,
          authorCount,
          isTruncated: false,
          resolvedByOA: Boolean(orcidRecordsCache),
          auditStatus: "VERIFIED",
          fracCredit: Number((fracCredit * 100).toFixed(1)),
          venue: venueRaw,
          venueTier: venueInfo.tier,
          year,
          citations,
          velocity: Number(velocity.toFixed(1)),
          role
        };

        papers.push(paperObj);
        papersByNormTitle.set(title.toLowerCase(), paperObj);
      });

      annotateOrcidDOMCards(papersByNormTitle);
    } else {
      // GOOGLE SCHOLAR DOM ENGINE (Exact v4.0 Logic)
      const rows = Array.from(document.querySelectorAll("#gsc_a_b .gsc_a_tr"));

      rows.forEach((row, idx) => {
        const titleEl = row.querySelector(".gsc_a_at");
        const grayEls = row.querySelectorAll(".gs_gray");
        const citeEl = row.querySelector(".gsc_a_ac");
        const yearEl = row.querySelector(".gsc_a_hc");

        if (!titleEl) return;

        const title = titleEl.textContent.trim();
        const oaCached = openAlexCache[title.toLowerCase()];
        const authorsRaw = grayEls[0] ? grayEls[0].textContent.trim() : "";
        const venueRaw = grayEls[1] ? grayEls[1].textContent.trim() : "";
        const citations = parseInt((citeEl && citeEl.textContent.trim()) || "0", 10) || 0;
        const year = parseInt((yearEl && yearEl.textContent.trim()) || "0", 10) || 0;

        if (year > 1950 && year <= CURRENT_YEAR) {
          if (year < minYear) minYear = year;
          if (year > maxYear) maxYear = year;
          yearBuckets[year] = (yearBuckets[year] || 0) + 1;
        }

        let authors = authorsRaw.split(",").map((a) => a.trim()).filter(Boolean);
        let isTruncated = authors.includes("...");
        let resolvedByOA = false;

        if (isTruncated && oaCached && oaCached.fullAuthors && oaCached.fullAuthors.length > 0) {
          authors = oaCached.fullAuthors;
          isTruncated = false;
          resolvedByOA = true;
        }

        const cleanAuthors = authors.filter((a) => a !== "...");
        const authorCount = Math.max(1, cleanAuthors.length);
        const matchedIdx = cleanAuthors.findIndex((a) => isTargetAuthor(a, identity));
        const authorPos = matchedIdx !== -1 ? matchedIdx + 1 : null;

        let role = "MID";
        let auditStatus = "VERIFIED";

        if (!isTruncated && cleanAuthors.length === 1 && isTargetAuthor(cleanAuthors[0], identity)) {
          role = "SOLO";
          soloCount++;
        } else if (cleanAuthors.length > 0 && isTargetAuthor(cleanAuthors[0], identity)) {
          role = "FIRST";
          firstCount++;
        } else if (!isTruncated && cleanAuthors.length > 1 && isTargetAuthor(cleanAuthors[cleanAuthors.length - 1], identity)) {
          role = "LAST";
          lastCount++;
        } else {
          role = "MID";
          midCount++;
          if (isTruncated && matchedIdx === -1) {
            auditStatus = "TRUNCATED_HIDDEN";
          } else if (isTruncated) {
            auditStatus = "TRUNCATED_LIST";
          }
        }

        if (isTruncated) truncatedCount++;

        totalAuthorCountSum += authorCount;
        const fracCredit = 1 / (isTruncated ? Math.max(authorCount + 2, 6) : authorCount);
        fractionalCreditSum += fracCredit;

        if (authorCount === 1 && !isTruncated) teamSolo++;
        else if (authorCount <= 4 && !isTruncated) teamSmall++;
        else if (authorCount <= 8 && !isTruncated) teamMed++;
        else teamLarge++;

        cleanAuthors.forEach((a) => {
          if (isTargetAuthor(a, identity)) return;
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
        if (role !== "MID") {
          leadCites.push(citations);
          leadCitationsSum += citations;
        }

        const age = year ? Math.max(1, CURRENT_YEAR - year + 1) : 1;
        const velocity = citations / age;

        title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/).forEach((w) => {
          if (w.length > 3 && !STOP_WORDS.has(w)) {
            wordFreq[w] = (wordFreq[w] || 0) + 1;
          }
        });

        const paperObj = {
          idx,
          title,
          authors: cleanAuthors,
          authorPos,
          authorCount,
          isTruncated,
          resolvedByOA,
          auditStatus,
          fracCredit: Number((fracCredit * 100).toFixed(1)),
          venue: venueRaw,
          venueTier: venueInfo.tier,
          year,
          citations,
          velocity: Number(velocity.toFixed(1)),
          role
        };
        papers.push(paperObj);

        row.dataset.shRole = role;
        row.dataset.shTier = venueInfo.tier;
        row.dataset.shYear = String(year || 0);
        row.dataset.shVel = velocity >= 10 ? "HIGH" : "NORM";
        row.dataset.shSearch = `${title} ${authorsRaw} ${venueRaw}`.toLowerCase();

        const td = row.querySelector(".gsc_a_t");
        let metaBar = row.querySelector(".sh-row-meta");
        if (!metaBar) {
          metaBar = document.createElement("div");
          metaBar.className = "sh-row-meta";
          if (td) td.appendChild(metaBar);
        }

        const posLabel = authorPos ? `${authorPos}/${isTruncated ? authorCount + "+" : authorCount}` : `?/${authorCount}+`;
        const roleTag =
          role === "SOLO" ? `<span class="sh-tag sh-tag-solo">SOLO (1/1)</span>` :
          role === "FIRST" ? `<span class="sh-tag sh-tag-first">1ST AUTHOR (${posLabel})</span>` :
          role === "LAST" ? `<span class="sh-tag sh-tag-last">LAST / PI (${posLabel})</span>` :
          `<span class="sh-tag sh-tag-mid">CO-AUTHOR (${posLabel})</span>`;

        const venueBadge = venueInfo.label
          ? `<span class="sh-tag sh-tag-elite">${venueInfo.label}</span>`
          : "";

        const velBadge = velocity >= 8
          ? `<span class="sh-tag sh-tag-vel">${velocity.toFixed(1)}/yr</span>`
          : "";

        const oaBadge = oaCached && oaCached.oaUrl
          ? `<a href="${oaCached.oaUrl}" target="_blank" class="sh-tag sh-tag-oa">OPEN PDF ↗</a>`
          : "";
        const doiBadge = oaCached && oaCached.doi
          ? `<a href="${oaCached.doi}" target="_blank" class="sh-mini-link">DOI ↗</a>`
          : "";

        metaBar.innerHTML = `
          <div class="sh-tag-list">
            ${roleTag}
            ${venueBadge}
            ${velBadge}
            ${oaBadge}
          </div>
          <div class="sh-tag-list">
            ${doiBadge}
            <button class="sh-mini-link sh-inspect-btn">Inspect</button>
            <button class="sh-mini-link sh-copy-bib">BibTeX</button>
          </div>
        `;

        const bibBtn = metaBar.querySelector(".sh-copy-bib");
        if (bibBtn) {
          bibBtn.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(generateBibTeX(paperObj));
            bibBtn.textContent = "COPIED";
            setTimeout(() => { bibBtn.textContent = "BibTeX"; }, 1200);
          };
        }

        const inspectBtn = metaBar.querySelector(".sh-inspect-btn");
        if (inspectBtn && td) {
          inspectBtn.onclick = (e) => {
            e.stopPropagation();
            inspectSinglePaper(title, td, inspectBtn);
          };
        }
      });
    }

    const total = papers.length || 1;
    const leadTotal = firstCount + lastCount + soloCount;
    const leadRatio = Math.round((leadTotal / total) * 100);
    const overallH = calcHIndex(allCites);
    const leadH = calcHIndex(leadCites);
    const careerYears = maxYear >= minYear ? Math.max(1, CURRENT_YEAR - minYear + 1) : 1;
    const citesPerYear = Math.round(totalCitations / careerYears);
    const papersPerYear = (papers.length / careerYears).toFixed(1);
    const gini = computeGini(allCites).toFixed(2);

    const sortedByCites = [...papers].sort((a, b) => b.citations - a.citations);
    const top3Cites = sortedByCites.slice(0, 3).reduce((acc, p) => acc + p.citations, 0);
    const paretoTop3Pct = totalCitations > 0 ? Math.round((top3Cites / totalCitations) * 100) : 0;
    const leadCiteSharePct = totalCitations > 0 ? Math.round((leadCitationsSum / totalCitations) * 100) : 0;

    const nextHTarget = overallH + 1;
    const candidatePaper = sortedByCites[overallH];
    const citesNeededForNextH = candidatePaper ? Math.max(1, nextHTarget - candidatePaper.citations) : nextHTarget;

    const topCoauthors = Object.values(coauthorMap)
      .sort((a, b) => b.count - a.count || b.citations - a.citations)
      .slice(0, 12);

    const topKeywords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([w, c]) => ({ word: w, count: c }));

    return {
      identity,
      totalPapers: papers.length,
      totalCitations,
      leadCitationsSum,
      leadCiteSharePct,
      paretoTop3Pct,
      citesNeededForNextH,
      firstCount,
      lastCount,
      soloCount,
      midCount,
      tier1Count,
      preprintCount,
      truncatedCount,
      fractionalCreditTotal: fractionalCreditSum.toFixed(1),
      effectiveCreditPct: Math.round((fractionalCreditSum / total) * 100),
      avgTeamSize: (totalAuthorCountSum / total).toFixed(1),
      teamSolo,
      teamSmall,
      teamMed,
      teamLarge,
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
      papers,
      sortedByCites
    };
  }

  function triggerDeepScan(btn) {
    if (IS_ORCID) {
      const orcidId = extractOrcidId();
      btn.textContent = "Syncing ORCID + OpenAlex...";
      orcidRecordsCache = null;
      syncOrcidProfileData(orcidId);
      return;
    }
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

  async function enrichWithOpenAlex(stats, btn) {
    if (IS_ORCID) {
      triggerDeepScan(btn);
      return;
    }
    btn.textContent = "Syncing OpenAlex...";
    const targetPapers = stats.papers.slice(0, 20);
    for (const p of targetPapers) {
      const key = p.title.toLowerCase();
      if (openAlexCache[key] && openAlexCache[key].fullAuthors) continue;
      try {
        const res = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(p.title)}&per-page=1`);
        if (!res.ok) continue;
        const data = await res.json();
        const work = data.results && data.results[0];
        if (work) {
          openAlexCache[key] = {
            doi: work.doi || null,
            oaUrl: (work.open_access && work.open_access.oa_url) || null,
            abstract: reconstructAbstract(work.abstract_inverted_index),
            type: work.type || "article",
            fullAuthors: (work.authorships || []).map((a) => a.author && a.author.display_name).filter(Boolean)
          };
        }
      } catch (_) {}
    }
    renderTerminal();
  }

  function exportCSV(stats) {
    const headers = ["Title", "Year", "Role", "Author_Position", "Total_Authors", "Fractional_Share_Pct", "Citations", "Velocity_Per_Yr", "Venue_Tier", "Venue"];
    const rows = stats.papers.map((p) => [
      `"${p.title.replace(/"/g, '""')}"`,
      p.year,
      p.role,
      p.authorPos || "Truncated",
      p.authorCount,
      p.fracCredit,
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
    a.download = `ScholarHere_${stats.identity.lastName || "audit"}.csv`;
    a.click();
  }

  function locateMountTarget() {
    if (!IS_ORCID) {
      const gsHost = document.getElementById("gsc_art");
      return gsHost ? { parent: gsHost.parentNode, before: gsHost } : null;
    }
    // Mount directly above the Works section on ORCID profile pages
    const orcidWorks =
      document.querySelector("app-works, #cy-works, .work-list, main .container") ||
      document.querySelector("main");
    if (orcidWorks) {
      return { parent: orcidWorks.parentNode, before: orcidWorks };
    }
    return null;
  }

  function renderTerminal() {
    if (IS_ORCID) {
      const orcidId = extractOrcidId();
      if (!orcidId) return;
      if (activeOrcidId !== orcidId) {
        activeOrcidId = orcidId;
        orcidRecordsCache = null;
        syncOrcidProfileData(orcidId);
      }
    }

    const mount = locateMountTarget();
    if (!mount || !mount.parent) return;

    const stats = analyzeProfile();
    if (stats.totalPapers === 0 && !IS_ORCID) return;

    let term = document.getElementById("sh-terminal");
    if (!term) {
      term = document.createElement("div");
      term.id = "sh-terminal";
      mount.parent.insertBefore(term, mount.before);
    }

    if (isDarkMode) term.classList.add("sh-dark");
    else term.classList.remove("sh-dark");

    const total = stats.totalPapers || 1;
    const pFirst = Math.round((stats.firstCount / total) * 100);
    const pLast = Math.round((stats.lastCount / total) * 100);
    const pSolo = Math.round((stats.soloCount / total) * 100);
    const pMid = Math.max(0, 100 - pFirst - pLast - pSolo);

    const years = [];
    for (let y = CURRENT_YEAR - 11; y <= CURRENT_YEAR; y++) years.push(y);
    const maxYrCount = Math.max(1, ...years.map((y) => stats.yearBuckets[y] || 0));
    const sparkHTML = years.map((y) => {
      const c = stats.yearBuckets[y] || 0;
      const hPct = Math.round((c / maxYrCount) * 100);
      return `
        <div class="sh-spark-col" title="${y}: ${c} papers">
          <div class="sh-spark-bar" style="height:${Math.max(4, hPct)}%"></div>
          <span class="sh-spark-yr">${String(y).slice(2)}</span>
        </div>
      `;
    }).join("");

    let pinned = null;
    try {
      pinned = JSON.parse(localStorage.getItem("sh_pinned_scholar") || "null");
    } catch (_) {}

    const logoSrc = getLogoUrl();

    const evidenceList = stats.sortedByCites.filter((p, index) => {
      const rank = index + 1;
      if (evidenceFilter === "ALL_HCORE") return rank <= Math.max(stats.overallH + 3, 10);
      if (evidenceFilter === "LEAD_CORE") return p.role !== "MID";
      if (evidenceFilter === "HIGH_VEL") return p.velocity >= 8;
      return true;
    }).slice(0, 25);

    term.innerHTML = `
      <div class="sh-topbar">
        <a href="${OFFICIAL_SITE}" target="_blank" class="sh-brand" title="ScholarHere Official Platform">
          <img src="${logoSrc}" onerror="this.src='${GITHUB_RAW_LOGO}'" alt="ScholarHere" class="sh-logo" />
          <div>
            <div class="sh-brand-name">
              ScholarHere
              <span class="sh-badge-pro">TERMINAL v4.5</span>
              ${IS_ORCID ? `<span class="sh-badge-orcid">ORCID iD: ${stats.identity.orcid}</span>` : ""}
            </div>
            <div class="sh-status">${orcidSyncInProgress ? "SYNCING ORCID + OPENALEX METRICS..." : `N=${stats.totalPapers} PAPERS • SPAN ${stats.minYear}–${CURRENT_YEAR} (${stats.careerYears}Y)`}</div>
          </div>
        </a>
        <div class="sh-toolbar">
          <button class="sh-cmd-btn" id="sh-deep-scan" title="Load all works">${IS_ORCID ? "Re-Sync ORCID" : "Deep Scan All"}</button>
          <button class="sh-cmd-btn" id="sh-enrich-oa" title="Verify DOIs, PDFs & full author lists via OpenAlex">Verify via OpenAlex</button>
          <button class="sh-cmd-btn" id="sh-pin-compare">${pinned && pinned.identity.fullName === stats.identity.fullName ? "Pinned ✓" : "Pin to Compare"}</button>
          <button class="sh-cmd-btn" id="sh-theme-toggle" title="Switch Light/Dark Theme">${isDarkMode ? "☀ Light" : "☾ Dark"}</button>
          <button class="sh-cmd-btn primary" id="sh-export-csv">Export CSV</button>
        </div>
      </div>

      <div class="sh-tabs">
        <div class="sh-tab-list">
          <button class="sh-tab ${activeTab === "overview" ? "active" : ""}" data-tab="overview">Overview</button>
          <button class="sh-tab ${activeTab === "evidence" ? "active" : ""}" data-tab="evidence">Metric Evidence Explorer</button>
          <button class="sh-tab ${activeTab === "attribution" ? "active" : ""}" data-tab="attribution">Author Attribution Audit</button>
          <button class="sh-tab ${activeTab === "network" ? "active" : ""}" data-tab="network">Co-Authors (${stats.topCoauthors.length})</button>
          <button class="sh-tab ${activeTab === "compare" ? "active" : ""}" data-tab="compare">Compare ${pinned ? `vs. ${pinned.identity.lastName}` : ""}</button>
          <button class="sh-tab ${activeTab === "outreach" ? "active" : ""}" data-tab="outreach">Outreach</button>
        </div>
        <a href="${OFFICIAL_SITE}" target="_blank" class="sh-about-btn" title="Learn more about ScholarHere">About Us ↗</a>
      </div>

      <!-- TAB 1: OVERVIEW -->
      <div class="sh-panel ${activeTab === "overview" ? "active" : ""}" data-panel="overview">
        <div class="sh-kpi-grid">
          <div class="sh-kpi-cell">
            <div class="sh-kpi-label"><span>LEADERSHIP</span><span>1ST+LAST</span></div>
            <div class="sh-kpi-val">${stats.leadRatio}%</div>
            <div class="sh-kpi-sub">${stats.firstCount + stats.soloCount + stats.lastCount} of ${stats.totalPapers} works</div>
          </div>
          <div class="sh-kpi-cell">
            <div class="sh-kpi-label"><span>LEAD h-INDEX</span><span>INDEP.</span></div>
            <div class="sh-kpi-val">${stats.leadH} <span style="font-size:12px;color:#64748b;font-weight:400;">/ ${stats.overallH}</span></div>
            <div class="sh-kpi-sub">${stats.overallH ? Math.round((stats.leadH / stats.overallH) * 100) : 0}% h-index retention</div>
          </div>
          <div class="sh-kpi-cell">
            <div class="sh-kpi-label"><span>FRACTIONAL</span><span>1/N CREDIT</span></div>
            <div class="sh-kpi-val">${stats.fractionalCreditTotal}</div>
            <div class="sh-kpi-sub">${stats.effectiveCreditPct}% effective share</div>
          </div>
          <div class="sh-kpi-cell">
            <div class="sh-kpi-label"><span>CITE VELOCITY</span><span>ANNUAL</span></div>
            <div class="sh-kpi-val">${stats.citesPerYear}</div>
            <div class="sh-kpi-sub">cites/yr (${stats.papersPerYear} papers/yr)</div>
          </div>
          <div class="sh-kpi-cell">
            <div class="sh-kpi-label"><span>TOP VENUES</span><span>A* / ELITE</span></div>
            <div class="sh-kpi-val">${stats.tier1Count}</div>
            <div class="sh-kpi-sub">${Math.round((stats.tier1Count / total) * 100)}% top-tier • ${stats.preprintCount} preprints</div>
          </div>
          <div class="sh-kpi-cell">
            <div class="sh-kpi-label"><span>CITE GINI</span><span>CONCENTRATION</span></div>
            <div class="sh-kpi-val">${stats.gini}</div>
            <div class="sh-kpi-sub">Top 3 papers = ${stats.paretoTop3Pct}% cites</div>
          </div>
        </div>

        <div class="sh-split">
          <div class="sh-box">
            <div class="sh-box-title">
              <span>Authorship Position Distribution</span>
              <span class="sh-mono-num">N=${stats.totalPapers}</span>
            </div>
            <div class="sh-seg-bar">
              <div class="sh-seg-1" style="width:${pFirst}%"></div>
              <div class="sh-seg-2" style="width:${pLast}%"></div>
              <div class="sh-seg-3" style="width:${pSolo}%"></div>
              <div class="sh-seg-4" style="width:${pMid}%"></div>
            </div>
            <div class="sh-legend">
              <div class="sh-legend-item"><span><i class="sh-dot sh-seg-1"></i>First Author</span><span class="sh-mono-num">${stats.firstCount} (${pFirst}%)</span></div>
              <div class="sh-legend-item"><span><i class="sh-dot sh-seg-2"></i>Last / PI</span><span class="sh-mono-num">${stats.lastCount} (${pLast}%)</span></div>
              <div class="sh-legend-item"><span><i class="sh-dot sh-seg-3"></i>Solo Author</span><span class="sh-mono-num">${stats.soloCount} (${pSolo}%)</span></div>
              <div class="sh-legend-item"><span><i class="sh-dot sh-seg-4"></i>Middle Co-Author</span><span class="sh-mono-num">${stats.midCount} (${pMid}%)</span></div>
            </div>
          </div>

          <div class="sh-box">
            <div class="sh-box-title">
              <span>12-Year Publication Rhythm (${CURRENT_YEAR - 11}–${CURRENT_YEAR})</span>
              <span class="sh-mono-num">PEAK ${maxYrCount}/YR</span>
            </div>
            <div class="sh-sparkline">${sparkHTML}</div>
          </div>
        </div>

        <div class="sh-filter-strip">
          <div class="sh-pill-group">
            <button class="sh-filter-pill active" data-f="ALL">ALL (${stats.totalPapers})</button>
            <button class="sh-filter-pill" data-f="FIRST">1ST / SOLO (${stats.firstCount + stats.soloCount})</button>
            <button class="sh-filter-pill" data-f="LAST">LAST / PI (${stats.lastCount})</button>
            <button class="sh-filter-pill" data-f="TIER_1">TOP VENUE (${stats.tier1Count})</button>
            <button class="sh-filter-pill" data-f="HIGH_VEL">HIGH VELOCITY</button>
          </div>
          <input type="text" class="sh-search-input" id="sh-live-search" placeholder="Filter table by keyword, co-author, venue..." />
        </div>
      </div>

      <!-- TAB 2: METRIC EVIDENCE EXPLORER -->
      <div class="sh-panel ${activeTab === "evidence" ? "active" : ""}" data-panel="evidence">
        <div class="sh-kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 12px;">
          <div class="sh-kpi-cell">
            <div class="sh-kpi-label"><span>h-CORE SIZE</span><span>VERIFIED</span></div>
            <div class="sh-kpi-val">h = ${stats.overallH}</div>
            <div class="sh-kpi-sub">Top ${stats.overallH} papers have ≥ ${stats.overallH} cites</div>
          </div>
          <div class="sh-kpi-cell">
            <div class="sh-kpi-label"><span>LEAD h-CORE</span><span>1ST/LAST/SOLO</span></div>
            <div class="sh-kpi-val">h = ${stats.leadH}</div>
            <div class="sh-kpi-sub">Drop of -${stats.overallH - stats.leadH} when excluding Mid-Author</div>
          </div>
          <div class="sh-kpi-cell">
            <div class="sh-kpi-label"><span>LEAD CITATION SHARE</span><span>IMPACT</span></div>
            <div class="sh-kpi-val">${stats.leadCiteSharePct}%</div>
            <div class="sh-kpi-sub">${stats.leadCitationsSum} of ${stats.totalCitations} total citations</div>
          </div>
          <div class="sh-kpi-cell">
            <div class="sh-kpi-label"><span>NEXT h-INDEX TARGET</span><span>h = ${stats.overallH + 1}</span></div>
            <div class="sh-kpi-val">+${stats.citesNeededForNextH} cites</div>
            <div class="sh-kpi-sub">Needed on Rank #${stats.overallH + 1} paper</div>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--sh-text-secondary);">Citation Rank & h-Core Proof Ledger</span>
          <div class="sh-pill-group">
            <button class="sh-filter-pill ${evidenceFilter === "ALL_HCORE" ? "active" : ""}" data-ev="ALL_HCORE">h-Core & Threshold (Top ${stats.overallH + 3})</button>
            <button class="sh-filter-pill ${evidenceFilter === "LEAD_CORE" ? "active" : ""}" data-ev="LEAD_CORE">Lead-Author Evidence Only</button>
            <button class="sh-filter-pill ${evidenceFilter === "HIGH_VEL" ? "active" : ""}" data-ev="HIGH_VEL">Fastest Velocity (≥8/yr)</button>
          </div>
        </div>

        <div class="sh-table-wrap">
          <table class="sh-data-table">
            <thead>
              <tr>
                <th>Cite Rank</th>
                <th>Publication Title</th>
                <th>Role</th>
                <th>Year</th>
                <th>Citations</th>
                <th>Velocity</th>
                <th>h-Core Proof Status</th>
              </tr>
            </thead>
            <tbody>
              ${evidenceList.map((p) => {
                const rank = stats.sortedByCites.indexOf(p) + 1;
                const inHCore = stats.overallH > 0 && rank <= stats.overallH;
                const delta = p.citations - stats.overallH;
                const badge = inHCore
                  ? `<span class="sh-status-tag sh-st-ok">IN h-CORE (+${delta} surplus)</span>`
                  : `<span class="sh-status-tag sh-st-warn">NEEDS +${Math.max(1, stats.overallH + 1 - p.citations)} FOR h=${stats.overallH + 1}</span>`;
                return `
                  <tr>
                    <td class="sh-mono-num">#${rank}</td>
                    <td style="font-weight:600;max-width:340px;">${p.title}</td>
                    <td><span class="sh-status-tag ${p.role === "MID" ? "sh-st-info" : "sh-st-ok"}">${p.role}</span></td>
                    <td class="sh-mono-num">${p.year || "—"}</td>
                    <td class="sh-mono-num" style="font-weight:700;">${p.citations}</td>
                    <td class="sh-mono-num">${p.velocity}/yr</td>
                    <td>${badge}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <!-- TAB 3: AUTHOR ATTRIBUTION AUDIT -->
      <div class="sh-panel ${activeTab === "attribution" ? "active" : ""}" data-panel="attribution">
        <div class="sh-kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 12px;">
          <div class="sh-kpi-cell">
            <div class="sh-kpi-label"><span>FRACTIONAL OUTPUT</span><span>1/N SUM</span></div>
            <div class="sh-kpi-val">${stats.fractionalCreditTotal} <span style="font-size:11px;color:#64748b;">papers</span></div>
            <div class="sh-kpi-sub">vs. ${stats.totalPapers} raw paper count (${stats.effectiveCreditPct}%)</div>
          </div>
          <div class="sh-kpi-cell">
            <div class="sh-kpi-label"><span>AVG TEAM SIZE</span><span>CO-AUTHORS</span></div>
            <div class="sh-kpi-val">${stats.avgTeamSize}</div>
            <div class="sh-kpi-sub">Solo: ${stats.teamSolo} • 2–4: ${stats.teamSmall} • 5+: ${stats.teamMed + stats.teamLarge}</div>
          </div>
          <div class="sh-kpi-cell">
            <div class="sh-kpi-label"><span>TRUNCATED BY "..."</span><span>AMBIGUOUS</span></div>
            <div class="sh-kpi-val">${stats.truncatedCount}</div>
            <div class="sh-kpi-sub">${stats.truncatedCount > 0 ? "Click Verify via OpenAlex to resolve" : "100% full author lists verified"}</div>
          </div>
          <div class="sh-kpi-cell">
            <div class="sh-kpi-label"><span>PRIMARY EXECUTION</span><span>1ST + SOLO</span></div>
            <div class="sh-kpi-val">${stats.firstCount + stats.soloCount}</div>
            <div class="sh-kpi-sub">${pFirst + pSolo}% hands-on primary authorship</div>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--sh-text-secondary);">Per-Paper Authorship & Credit Attribution Ledger</span>
          <button class="sh-cmd-btn" id="sh-audit-resolve">Resolve Truncated "..." Lists via OpenAlex</button>
        </div>

        <div class="sh-table-wrap">
          <table class="sh-data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Publication Title</th>
                <th>Slot Position</th>
                <th>Role Classification</th>
                <th>Fractional Credit</th>
                <th>Attribution Audit Status</th>
              </tr>
            </thead>
            <tbody>
              ${stats.papers.map((p, i) => {
                const posText = p.authorPos
                  ? `Pos ${p.authorPos} of ${p.isTruncated ? p.authorCount + "+" : p.authorCount}`
                  : `Hidden (> ${p.authorCount} authors)`;
                const statusBadge = p.resolvedByOA
                  ? `<span class="sh-status-tag sh-st-ok">VERIFIED VIA OPENALEX</span>`
                  : p.auditStatus === "TRUNCATED_HIDDEN"
                  ? `<span class="sh-status-tag sh-st-danger">TRUNCATED "..." (HIDDEN MID/LAST)</span>`
                  : p.auditStatus === "TRUNCATED_LIST"
                  ? `<span class="sh-status-tag sh-st-warn">PARTIAL LIST ("...")</span>`
                  : `<span class="sh-status-tag sh-st-ok">VERIFIED DOM</span>`;
                return `
                  <tr>
                    <td class="sh-mono-num">${i + 1}</td>
                    <td style="font-weight:600;max-width:320px;">${p.title}</td>
                    <td class="sh-mono-num">${posText}</td>
                    <td><span class="sh-status-tag ${p.role === "MID" ? "sh-st-info" : "sh-st-ok"}">${p.role}</span></td>
                    <td class="sh-mono-num">${p.fracCredit}%</td>
                    <td>${statusBadge}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <!-- TAB 4: CO-AUTHOR MATRIX -->
      <div class="sh-panel ${activeTab === "network" ? "active" : ""}" data-panel="network">
        <div class="sh-table-wrap">
          <table class="sh-data-table">
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
                  <td class="sh-mono-num">#${i + 1}</td>
                  <td style="font-weight:600;">${c.name}</td>
                  <td class="sh-mono-num">${c.count}</td>
                  <td class="sh-mono-num">${c.citations}</td>
                  <td class="sh-mono-num">${Math.round(c.citations / c.count)}</td>
                </tr>
              `).join("") || `<tr><td colspan="5">No recurring co-authors detected.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <!-- TAB 5: COMPARE -->
      <div class="sh-panel ${activeTab === "compare" ? "active" : ""}" data-panel="compare">
        ${!pinned ? `
          <div style="padding:14px;color:var(--sh-text-secondary);">
            Click <strong>"Pin to Compare"</strong> in the top toolbar on any Google Scholar or ORCID profile, then open a second scholar's profile to benchmark them side-by-side.
          </div>
        ` : `
          <table class="sh-data-table">
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
                <td class="sh-mono-num">${stats.leadRatio}%</td>
                <td class="sh-mono-num">${pinned.leadRatio}%</td>
                <td class="sh-mono-num">${stats.leadRatio - pinned.leadRatio >= 0 ? "+" : ""}${stats.leadRatio - pinned.leadRatio}%</td>
              </tr>
              <tr>
                <td>Lead-Only h-index</td>
                <td class="sh-mono-num">${stats.leadH}</td>
                <td class="sh-mono-num">${pinned.leadH}</td>
                <td class="sh-mono-num">${stats.leadH - pinned.leadH >= 0 ? "+" : ""}${stats.leadH - pinned.leadH}</td>
              </tr>
              <tr>
                <td>Fractional Paper Credit (1/N)</td>
                <td class="sh-mono-num">${stats.fractionalCreditTotal}</td>
                <td class="sh-mono-num">${pinned.fractionalCreditTotal || "—"}</td>
                <td class="sh-mono-num">${pinned.fractionalCreditTotal ? (stats.fractionalCreditTotal - pinned.fractionalCreditTotal).toFixed(1) : "—"}</td>
              </tr>
              <tr>
                <td>Citation Velocity (Citations / Yr)</td>
                <td class="sh-mono-num">${stats.citesPerYear}</td>
                <td class="sh-mono-num">${pinned.citesPerYear}</td>
                <td class="sh-mono-num">${stats.citesPerYear - pinned.citesPerYear >= 0 ? "+" : ""}${stats.citesPerYear - pinned.citesPerYear}</td>
              </tr>
              <tr>
                <td>Top-Tier Venue Count</td>
                <td class="sh-mono-num">${stats.tier1Count}</td>
                <td class="sh-mono-num">${pinned.tier1Count}</td>
                <td class="sh-mono-num">${stats.tier1Count - pinned.tier1Count >= 0 ? "+" : ""}${stats.tier1Count - pinned.tier1Count}</td>
              </tr>
            </tbody>
          </table>
        `}
      </div>

      <!-- TAB 6: OUTREACH & REPORT -->
      <div class="sh-panel ${activeTab === "outreach" ? "active" : ""}" data-panel="outreach">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:11.5px;color:var(--sh-text-secondary);font-weight:600;">Academic Inquiry & Audit Summary Generator</span>
          <div style="display:flex;gap:6px;">
            <button class="sh-cmd-btn" id="sh-switch-summary">Generate Audit Summary</button>
            <button class="sh-cmd-btn primary" id="sh-copy-email">Copy Text</button>
          </div>
        </div>
        <textarea id="sh-email-box" style="width:100%;height:135px;font-family:var(--sh-mono);font-size:11.5px;padding:10px;background:var(--sh-bg);color:var(--sh-text);border:1px solid var(--sh-border-strong);border-radius:4px;box-sizing:border-box;">Subject: Research Collaboration / Prospective Supervision Inquiry — ${stats.topKeywords.slice(0, 3).map((k) => k.word).join(", ")}

Dear ${stats.identity.fullName},

I have been reviewing your recent publications at ${stats.identity.affiliation || "your institution"}, particularly "${stats.papers[0] ? stats.papers[0].title : "your recent work"}" (${stats.papers[0] ? stats.papers[0].year : CURRENT_YEAR}).

My current research focuses on ${stats.topKeywords.slice(0, 4).map((k) => k.word).join(", ")}, and I am reaching out to inquire regarding potential research collaboration or supervision opportunities in your group.

Best regards,
[Your Name]</textarea>
      </div>
    `;

    // Bind Navigation Tabs
    term.querySelectorAll(".sh-tab").forEach((t) => {
      t.onclick = () => {
        activeTab = t.dataset.tab;
        renderTerminal();
      };
    });

    // Bind Evidence Filter Pills
    term.querySelectorAll("[data-ev]").forEach((btn) => {
      btn.onclick = () => {
        evidenceFilter = btn.dataset.ev;
        renderTerminal();
      };
    });

    // Bind Toolbar Actions
    term.querySelector("#sh-deep-scan").onclick = (e) => triggerDeepScan(e.target);
    term.querySelector("#sh-enrich-oa").onclick = (e) => enrichWithOpenAlex(stats, e.target);
    const resolveBtn = term.querySelector("#sh-audit-resolve");
    if (resolveBtn) {
      resolveBtn.onclick = (e) => enrichWithOpenAlex(stats, e.target);
    }
    term.querySelector("#sh-export-csv").onclick = () => exportCSV(stats);
    term.querySelector("#sh-pin-compare").onclick = (e) => {
      localStorage.setItem("sh_pinned_scholar", JSON.stringify(stats));
      e.target.textContent = "Pinned ✓";
    };
    term.querySelector("#sh-theme-toggle").onclick = () => {
      isDarkMode = !isDarkMode;
      localStorage.setItem("sh_theme", isDarkMode ? "dark" : "light");
      renderTerminal();
    };

    const switchSummaryBtn = term.querySelector("#sh-switch-summary");
    if (switchSummaryBtn) {
      switchSummaryBtn.onclick = () => {
        const box = term.querySelector("#sh-email-box");
        box.value =
`ScholarHere Bibliometric Audit — ${stats.identity.fullName}${stats.identity.orcid ? ` (ORCID: ${stats.identity.orcid})` : ""}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Leadership Ratio: ${stats.leadRatio}% (${stats.firstCount + stats.soloCount} 1st/Solo | ${stats.lastCount} Last/PI)
• Lead-Only h-index: ${stats.leadH} (Overall h-index: ${stats.overallH} | Lead Cite Share: ${stats.leadCiteSharePct}%)
• Fractional Paper Credit (1/N): ${stats.fractionalCreditTotal} (${stats.effectiveCreditPct}% effective share)
• Annual Velocity: ${stats.citesPerYear} citations/yr (${stats.papersPerYear} papers/yr)
• Top-Tier Venues: ${stats.tier1Count} papers | Citation Gini: ${stats.gini}
• Core Domains: ${stats.topKeywords.map((k) => "#" + k.word).join(" ")}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Audited via ScholarHere Terminal`;
      };
    }

    const copyEmailBtn = term.querySelector("#sh-copy-email");
    if (copyEmailBtn) {
      copyEmailBtn.onclick = () => {
        const box = term.querySelector("#sh-email-box");
        navigator.clipboard.writeText(box.value);
        copyEmailBtn.textContent = "Copied ✓";
        setTimeout(() => { copyEmailBtn.textContent = "Copy Text"; }, 1400);
      };
    }

    // Bind Live Table Filters on Overview Tab (Works on Google Scholar rows & ORCID work cards)
    const applyRowFilter = (mode, query) => {
      const q = (query || "").toLowerCase().trim();
      const selector = IS_ORCID ? "app-work-stack[data-sh-role], app-work[data-sh-role]" : "#gsc_a_b .gsc_a_tr";
      document.querySelectorAll(selector).forEach((row) => {
        let matchMode = true;
        if (mode === "FIRST") matchMode = row.dataset.shRole === "FIRST" || row.dataset.shRole === "SOLO";
        else if (mode === "LAST") matchMode = row.dataset.shRole === "LAST";
        else if (mode === "TIER_1") matchMode = row.dataset.shTier === "TIER_1";
        else if (mode === "HIGH_VEL") matchMode = row.dataset.shVel === "HIGH";

        const matchQuery = !q || (row.dataset.shSearch && row.dataset.shSearch.includes(q));
        row.style.display = matchMode && matchQuery ? "" : "none";
      });
    };

    let currentFilterMode = "ALL";
    const searchInput = term.querySelector("#sh-live-search");

    term.querySelectorAll("[data-f]").forEach((pill) => {
      pill.onclick = () => {
        term.querySelectorAll("[data-f]").forEach((p) => p.classList.remove("active"));
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

  // Initial Boot
  renderTerminal();

  if (!IS_ORCID) {
    const tbody = document.getElementById("gsc_a_b");
    if (tbody) {
      const observer = new MutationObserver(() => renderTerminal());
      observer.observe(tbody, { childList: true });
    }
  } else {
    // Watch ORCID Angular app so the terminal mounts right as `app-works` finishes rendering
    let orcidTimer = null;
    const orcidObserver = new MutationObserver((mutations) => {
      const external = mutations.some(
        (m) => !m.target.closest || !m.target.closest("#sh-terminal, .sh-row-meta, .sh-abstract-drawer")
      );
      if (external) {
        clearTimeout(orcidTimer);
        orcidTimer = setTimeout(() => renderTerminal(), 500);
      }
    });
    orcidObserver.observe(document.body, { childList: true, subtree: true });
  }
})();