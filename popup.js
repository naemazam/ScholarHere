(function () {
  "use strict";

  const setupView = document.getElementById("setup-view");
  const profileView = document.getElementById("profile-view");
  const urlInput = document.getElementById("scholar-url-input");
  const saveBtn = document.getElementById("btn-save-url");
  const editBtn = document.getElementById("btn-edit-url");
  const refreshBtn = document.getElementById("btn-refresh");
  const errorEl = document.getElementById("setup-error");
  const statusEl = document.getElementById("p-status");

  // Accepts full URLs, URLs without https://, or a raw 12-char Google Scholar user ID
  function normalizeScholarUrl(raw) {
    if (!raw) return null;
    const str = raw.trim();
    const matchUser = str.match(/[?&]user=([a-zA-Z0-9_-]+)/);
    if (matchUser && matchUser[1]) {
      return `https://scholar.google.com/citations?user=${encodeURIComponent(matchUser[1])}&hl=en`;
    }
    if (/^[a-zA-Z0-9_-]{10,16}$/.test(str)) {
      return `https://scholar.google.com/citations?user=${encodeURIComponent(str)}&hl=en`;
    }
    try {
      const withProto = /^https?:\/\//i.test(str) ? str : `https://${str}`;
      const u = new URL(withProto);
      const user = u.searchParams.get("user");
      if (!user) return null;
      return `${u.origin}/citations?user=${encodeURIComponent(user)}&hl=en`;
    } catch (_) {
      return null;
    }
  }

  function showSetup(existingUrl) {
    setupView.style.display = "block";
    profileView.style.display = "none";
    editBtn.style.display = "none";
    errorEl.style.display = "none";
    if (existingUrl) urlInput.value = existingUrl;
  }

  function renderSnapshot(snap) {
    setupView.style.display = "none";
    profileView.style.display = "block";
    editBtn.style.display = "inline-block";

    document.getElementById("p-name").textContent = snap.name || "My Scholar Profile";
    document.getElementById("p-aff").textContent = snap.affiliation || "Google Scholar";
    document.getElementById("p-cites").textContent = (snap.citations || 0).toLocaleString();
    document.getElementById("p-hindex").textContent = snap.hIndex || 0;
    document.getElementById("p-i10").textContent = snap.i10Index || 0;
    document.getElementById("p-h5").textContent = `5y h: ${snap.hIndex5y || 0}`;
    document.getElementById("p-cites5").textContent = `5y: ${(snap.citations5y || 0).toLocaleString()}`;
    document.getElementById("link-my-profile").href = snap.url;

    const prev = snap.previousCitations ?? snap.citations ?? 0;
    const diff = (snap.citations || 0) - prev;
    const deltaEl = document.getElementById("p-delta");
    if (diff > 0) {
      deltaEl.textContent = `+${diff}`;
      deltaEl.className = "delta-pill delta-up";
    } else {
      deltaEl.textContent = `+0`;
      deltaEl.className = "delta-pill delta-same";
    }

    document.getElementById("p-prev-cites").textContent = `Last: ${prev.toLocaleString()}`;
  }

  async function fetchLiveScholarStats(url, prevSnap) {
    if (statusEl) statusEl.textContent = "SYNCING";

    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Fetch failed");
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");

      const nameEl = doc.getElementById("gsc_prf_in");
      const affEl = doc.querySelector(".gsc_prf_il");
      const statCells = Array.from(doc.querySelectorAll("#gsc_rsb_st td.gsc_rsb_std"));

      if (!nameEl && statCells.length === 0) {
        throw new Error("Profile DOM not found");
      }

      const parseNum = (el) => parseInt((el && el.textContent.replace(/,/g, "").trim()) || "0", 10) || 0;

      const citations = parseNum(statCells[0]);
      const citations5y = parseNum(statCells[1]);
      const hIndex = parseNum(statCells[2]);
      const hIndex5y = parseNum(statCells[3]);
      const i10Index = parseNum(statCells[4]);

      let previousCitations = citations;
      if (prevSnap && typeof prevSnap.citations === "number") {
        previousCitations = prevSnap.citations !== citations
          ? prevSnap.citations
          : (prevSnap.previousCitations ?? citations);
      }

      const newSnap = {
        url,
        name: nameEl ? nameEl.textContent.trim() : "Researcher",
        affiliation: affEl ? affEl.textContent.trim() : "",
        citations,
        citations5y,
        hIndex,
        hIndex5y,
        i10Index,
        previousCitations,
        updatedAt: Date.now()
      };

      chrome.storage.local.set({ sh_user_profile: newSnap });
      renderSnapshot(newSnap);
      if (statusEl) statusEl.textContent = "LIVE ✓";
    } catch (_) {
      if (statusEl) statusEl.textContent = "ACTIVE";
    }
  }

  // Initialize Popup
  chrome.storage.local.get(["sh_user_profile"], (res) => {
    const snap = res.sh_user_profile;
    if (!snap || !snap.url) {
      showSetup("");
    } else {
      renderSnapshot(snap);
      fetchLiveScholarStats(snap.url, snap);
    }
  });

  saveBtn.addEventListener("click", async () => {
    const cleanUrl = normalizeScholarUrl(urlInput.value);
    if (!cleanUrl) {
      errorEl.style.display = "block";
      return;
    }
    errorEl.style.display = "none";
    saveBtn.textContent = "Syncing Profile...";
    const initialSnap = { url: cleanUrl, name: "Loading...", citations: 0, previousCitations: 0 };
    chrome.storage.local.set({ sh_user_profile: initialSnap }, async () => {
      renderSnapshot(initialSnap);
      await fetchLiveScholarStats(cleanUrl, null);
      saveBtn.textContent = "Save My Profile";
    });
  });

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveBtn.click();
  });

  editBtn.addEventListener("click", () => {
    chrome.storage.local.get(["sh_user_profile"], (res) => {
      showSetup(res.sh_user_profile ? res.sh_user_profile.url : "");
    });
  });

  refreshBtn.addEventListener("click", () => {
    chrome.storage.local.get(["sh_user_profile"], (res) => {
      if (res.sh_user_profile && res.sh_user_profile.url) {
        fetchLiveScholarStats(res.sh_user_profile.url, res.sh_user_profile);
      }
    });
  });
})();