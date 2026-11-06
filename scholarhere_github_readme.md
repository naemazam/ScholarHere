<div align="center">

  <a href="https://scholarhere.vercel.app">
    <img src="https://scholarhere.vercel.app/logo.png" alt="ScholarHere Logo" width="90" height="90">
  </a>

  <h1 align="center">ScholarHere · Terminal v4.0.0</h1>

  <p align="center">
    <strong>Read any Google Scholar profile the way a referee would.</strong>
    <br />
    A local-first research-intelligence terminal injected straight into Google Scholar profiles — featuring lead <i>h</i>-index, citation inequality (Gini), CORE-A* venue tiers, co-author networks, OpenAlex verification, and one-click exports.
    <br />
    <br />
    <a href="https://scholarhere.vercel.app"><strong>🌐 Live Interactive Demo</strong></a>
    ·
    <a href="https://github.com/naemazam/ScholarHere/archive/refs/heads/main.zip"><strong>⬇️ Download Extension (.zip)</strong></a>
    ·
    <a href="https://github.com/naemazam/ScholarHere/issues"><strong>🐛 Report Bug / Request Feature</strong></a>
  </p>

  <!-- Badges -->
  <p align="center">
    <a href="https://scholarhere.vercel.app">
      <img src="https://img.shields.io/badge/Website-scholarhere.vercel.app-0A66C2?style=for-the-badge&logo=vercel&logoColor=white" alt="Website" />
    </a>
    <img src="https://img.shields.io/badge/Version-v4.0.0-10B981?style=for-the-badge" alt="Version 4.0.0" />
    <img src="https://img.shields.io/badge/Manifest-V3-F59E0B?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Manifest V3" />
    <img src="https://img.shields.io/badge/API-OpenAlex-6366F1?style=for-the-badge" alt="OpenAlex API" />
    <a href="https://github.com/naemazam/ScholarHere/blob/main/LICENSE">
      <img src="https://img.shields.io/badge/License-MIT-EC4899?style=for-the-badge" alt="MIT License" />
    </a>
  </p>
</div>

<hr />

## ⚡ What is ScholarHere?

Raw citation counts reward volume and massive consortium collaborations, often obscuring who actually led the research. **ScholarHere** injects a clean, zero-configuration bibliometric terminal directly above any Google Scholar profile (`scholar.google.*/citations*`).

It computes everything **locally in your browser**—no accounts, no external tracking servers, and zero setup required.

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 🎓 ScholarHere TERMINAL v4.0                  [Deep Scan] [Verify OpenAlex] [Export]   │
├──────────────┬──────────────┬──────────────┬──────────────┬──────────────┬─────────────┤
│ LEADERSHIP   │ LEAD h-INDEX │ FRACTIONAL   │ CITE VELOCITY│ TOP VENUES   │ CITE GINI   │
│ 67% (1st/PI) │ 8 / 12 (67%) │ 4.9 (1/N)    │ 125 cites/yr │ 8 CORE-A*    │ 0.31        │
├──────────────┴──────────────┴──────────────┴──────────────┴──────────────┴─────────────┤
│ [6] Overview  [7] Metric Evidence  [8] Attribution Audit  [9] Co-Authors  [10] Compare │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Six Indices Google Scholar Doesn't Show You

ScholarHere computes six foundational metrics directly from the profile DOM (and enriches them via OpenAlex):

| # | Index | Tag | Formula | What It Reveals |
| :-: | :--- | :---: | :--- | :--- |
| **1** | **Leadership Share** | `1ST + LAST` | $\frac{\text{first\_author} + \text{last\_author}}{N}$ | How often the scholar sits in a leading position—first author (did the work) or last author (ran the lab). Middle positions are excluded. |
| **2** | **Lead $h$-index** | `INDEPENDENT` | $h(\text{citations} \mid \text{first} \lor \text{last})$ | Standard $h$-index computed *only* over papers the scholar led, paired with overall $h$-index retention %. Separates independent impact from big-consortium co-authorship. |
| **3** | **Fractional Credit** | `1/N CREDIT` | $\sum \frac{1}{\text{authors\_per\_paper}}$ | Each paper is worth $1/N$ where $N$ is the author count (solo = $1.0$, 10 authors = $0.1$). Truncated `...` lists are scored conservatively until resolved via OpenAlex. |
| **4** | **Citation Velocity** | `ANNUAL` | $\frac{\sum \text{citations}}{\text{career\_years}}$ | Average citations accrued per active year, making a 5-year early career and a 30-year senior career comparable at a glance. |
| **5** | **Top Venues** | `A* / ELITE` | $\text{count}(\text{venue} \in \text{TIER\_1})$ | Papers published in CORE-A* or flagship venues (NeurIPS, CVPR, ACL, SIGCOMM, USENIX, CCS, IEEE TIFS, Nature, Science, NEJM, etc.). |
| **6** | **Citation Gini** | `CONCENTRATION` | $\frac{\sum_{i=1}^{n} (2i - n - 1) x_i}{n \sum_{i=1}^{n} x_i}$ | Inequality of citations across papers, paired with the % held by the top 3 works. Near $0$ = even impact across career; near $1$ = a single hit paper carries the profile. |

---

## 🖥️ Terminal Field Guide

### 🛠️ Toolbar Commands
Located in the top header of the injected terminal, acting across the entire profile:
* **🔍 Deep Scan All:** Automatically clicks Google Scholar's *"Show more"* button every $650\text{ ms}$ until the entire career bibliography is loaded, then recomputes all metrics accurately.
* **🌐 Verify via OpenAlex:** Queries `api.openalex.org` for the top papers to attach DOIs, Open-Access PDFs, abstracts, and complete author lists—replacing truncated `...` lists for exact fractional credit and role auditing.
* **📌 Pin to Compare:** Saves the current scholar's computed metrics in local storage so you can open another profile and benchmark them side-by-side.
* **🌓 Light / Dark Mode:** Toggles between sleek dark and crisp light themes, persisted across sessions.
* **📥 Export CSV:** Downloads `ScholarHere_<lastname>.csv` containing *Title, Year, Role, Author_Position, Total_Authors, Fractional_Share_Pct, Citations, Velocity_Per_Yr, Venue_Tier,* and *Venue*.

### 🗂️ Six Interactive Views (Tabs)
1. **Overview:** The headline read—6 core indices, an **Authorship Position Distribution** bar (First, Last/PI, Solo, Middle), a **12-Year Publication Rhythm** histogram, and live filter pills to search/filter the paper list in place.
2. **Metric Evidence Explorer:** Proof for the $h$-index. Ranks papers and flags each as `IN h-CORE` (with citation surplus) or `NEEDS +x FOR h+1`. Filter by *h-Core & Threshold*, *Lead-Author Evidence Only*, or *Fastest Velocity* ($\ge 8\text{ cites/yr}$).
3. **Author Attribution Audit:** Per-paper breakdown of slot position, role classification, fractional credit ($1/N$), and verification status (`VERIFIED DOM`, `PARTIAL LIST`, `TRUNCATED (HIDDEN)`, or `RESOLVED VIA OPENALEX`).
4. **Co-Authors:** Maps the top 12 recurring collaborators ranked by joint papers, showing combined and average citations per joint work (ideal for spotting lab structures or conflicts of interest).
5. **Compare:** Side-by-side delta comparison between the currently viewed scholar and your pinned benchmark scholar.
6. **Outreach & Audit Summary:** Auto-drafts a personalized academic inquiry email or generates a plain-text **Bibliometric Audit Brief** ready to copy into committee or peer-review notes.

### 🏷️ Inline Paper Badges
Injected directly underneath every paper row inside the native Google Scholar table:
* `1ST AUTHOR (1/3)` / `LAST / PI (2/2)` / `SOLO` / `CO-AUTHOR`
* `CORE-A* / TOP VENUE` / `INDEXED JOURNAL` / `PREPRINT`
* `35.7/yr` — High-velocity indicator for rapidly accruing papers.
* **Inspect · BibTeX:** One-click drawer for abstracts, DOI links, Open-Access PDFs, and instant BibTeX citation copying.

---

## 🚀 Installation (60 Seconds)

ScholarHere works out of the box on **Chrome, Edge, Brave, Arc**, and any Chromium-based browser. You can also follow the interactive checklist at [**scholarhere.vercel.app/#install**](https://scholarhere.vercel.app/#install).

1. **Download the Extension:**
   * Click here to [**Download the latest `.zip` from GitHub**](https://github.com/naemazam/ScholarHere/archive/refs/heads/main.zip), or clone this repository:
     ```bash
     git clone https://github.com/naemazam/ScholarHere.git
     ```
2. **Unzip the Folder:** Extract `ScholarHere-main.zip` to a permanent folder on your computer.
3. **Open Extensions Page:** Navigate to `chrome://extensions` (or `edge://extensions` / `brave://extensions`) in your browser address bar.
4. **Enable Developer Mode:** Toggle the **Developer mode** switch in the top-right corner.
5. **Load Unpacked:** Click **Load unpacked** (top-left) and select the extracted `ScholarHere` folder.
6. **Open Google Scholar:** Visit any profile page (e.g., `https://scholar.google.com/citations?user=...`) and watch the terminal appear automatically!

---

## 🔒 Privacy & Architecture

ScholarHere is built with a strict **local-first, zero-telemetry** philosophy:

| Aspect | Detail |
| :--- | :--- |
| **Runs On** | `scholar.google.com` and regional domains (`.co.uk`, `.ca`, `.com.au`, `.co.in`, `.com.bd`) — `/citations` pages only. |
| **External Network Calls** | **None by default.** Connects to `api.openalex.org` *only* when you explicitly click **"Verify via OpenAlex"** or **"Inspect"**. |
| **Permissions** | `storage` (to save Dark/Light theme and 1 pinned scholar locally) + host access to `api.openalex.org`. |
| **Data Collection** | **Zero.** No analytics, no tracking pixels, no user accounts, and no backend servers of our own. |

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Whether you want to expand the **CORE-A* / Elite Venue** heuristics dictionary, refine author-disambiguation logic, or add new bibliometric visualizations:

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingMetric`)
3. Commit your Changes (`git commit -m 'Add AmazingMetric to terminal'`)
4. Push to the Branch (`git push origin feature/AmazingMetric`)
5. Open a Pull Request

---

## 📄 License & Credits

* **Developed by:** **ResearchSec** ([Dr. Naem Azam Chowdhury](https://github.com/naemazam))
* **License:** Distributed under the **MIT License**. See [`LICENSE`](https://github.com/naemazam/ScholarHere/blob/main/LICENSE) for more information.
* **Disclaimer:** *ScholarHere is an independent open-source project and is not affiliated with or endorsed by Google or OpenAlex.*

<div align="center">
  <br />
  <a href="https://scholarhere.vercel.app"><strong>✨ Try the Live Demo at scholarhere.vercel.app →</strong></a>
</div>