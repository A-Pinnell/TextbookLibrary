import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.54/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.54/pdf.worker.min.mjs";

const $ = id => document.getElementById(id);

// Set to 1 to allow administrators to open local PDFs and drag/drop PDFs.
// Set to 0 for a public/read-only view that only shows PDFs listed in pdfs.json.
const AdminView = 0;

// Audio assets. Place these files in the matching folders beside viewer.html.
const soundFiles = {
  highlight: "sfx/highlight.wav",
  popup: "sfx/Popup.wav",
  arrow: "sfx/ArrowButton.wav",
  select: "sfx/QuizSelect.wav",
  pageFlip: "sfx/PageFlip.wav"
};

const soundCache = {};
let soundsMuted = localStorage.getItem("pdfViewerSoundsMuted") === "true";
let musicMuted = localStorage.getItem("pdfViewerMusicMuted") === "true";

Object.entries(soundFiles).forEach(([name, path]) => {
  const audio = new Audio(path);
  audio.preload = "auto";
  soundCache[name] = audio;
});

const pdfMusic = new Audio("music/PDF.wav");
pdfMusic.loop = true;
pdfMusic.volume = 0.45;

function playSound(name) {
  if (soundsMuted || !soundCache[name]) return;

  // PageFlip is a single reusable audio instance. Every page-button press
  // stops the previous flip immediately, resets it to the beginning, and
  // starts exactly one fresh playback. This keeps rapid left/right presses
  // from stacking sounds or getting stuck waiting for an old playback.
  if (name === "pageFlip") {
    const sound = soundCache[name];
    sound.pause();
    sound.currentTime = 0;
    const playAttempt = sound.play();
    if (playAttempt && typeof playAttempt.catch === "function") {
      playAttempt.catch(() => {});
    }
    return;
  }

  const sound = soundCache[name].cloneNode();
  sound.currentTime = 0;
  sound.play().catch(() => {});
}

function startPdfMusic() {
  if (musicMuted) return;
  pdfMusic.play().catch(() => {});
}

function stopPdfMusic() {
  pdfMusic.pause();
  pdfMusic.currentTime = 0;
}

const stage = $("dropZone");
const emptyState = $("emptyState");
const pageContainer = $("pageContainer");
const loading = $("loading");
const toast = $("toast");

let pdfDoc = null;
let currentPage = 1;
let scale = 1;
let currentUrl = null;
let renderToken = 0;
let searchMatches = [];
let searchIndex = -1;
let searchTerm = "";
let searchScanned = new Set();
let searchEnabled = true;
let libraryEntries = new Map();

function updateAudioButtons() {
  const soundButton = $("soundToggle");
  const musicButton = $("musicToggle");
  if (!soundButton || !musicButton) return;

  soundButton.textContent = soundsMuted ? "🔇" : "🔊";
  soundButton.classList.toggle("muted", soundsMuted);
  soundButton.setAttribute("aria-label", soundsMuted ? "Unmute sound effects" : "Mute sound effects");
  soundButton.setAttribute("aria-pressed", String(soundsMuted));

  musicButton.textContent = musicMuted ? "♩" : "♫";
  musicButton.classList.toggle("muted", musicMuted);
  musicButton.setAttribute("aria-label", musicMuted ? "Unmute music" : "Mute music");
  musicButton.setAttribute("aria-pressed", String(musicMuted));
}

function applyAdminView() {
  const adminOnlyElements = [
    document.querySelector(".upload-button"),
    document.querySelector(".hint"),
    document.querySelector(".stage-open")
  ];

  adminOnlyElements.forEach(element => {
    if (element) {
      // Use display directly as well as the hidden attribute so site CSS
      // cannot accidentally override the AdminView setting.
      element.hidden = AdminView === 0;
      element.style.display = AdminView === 0 ? "none" : "";
    }
  });

  // Disable the actual file inputs too, so AdminView=0 cannot open a
  // local PDF even if the UI is manipulated manually.
  $("filePicker").disabled = AdminView === 0;
  $("stagePicker").disabled = AdminView === 0;

  document.body.classList.toggle("admin-view", AdminView === 1);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3500);
}

function setLoading(value) {
  loading.classList.toggle("show", value);
}

function updateControls() {
  const pageInput = $("pageNum");
  if (pageInput) {
    pageInput.value = pdfDoc ? currentPage : 0;
    pageInput.disabled = false;
    pageInput.max = pdfDoc ? pdfDoc.numPages : 0;
  }
  $("pageCount").textContent = pdfDoc ? pdfDoc.numPages : 0;
  $("prevPage").disabled = !pdfDoc || currentPage <= 1;
  $("nextPage").disabled = !pdfDoc || currentPage >= pdfDoc.numPages;
  $("zoomOut").disabled = !pdfDoc;
  $("zoomIn").disabled = !pdfDoc;
  $("fitBtn").disabled = !pdfDoc;
  $("newTabBtn").disabled = !currentUrl;
  $("zoomValue").textContent = `${Math.round(scale * 100)}%`;
}



async function renderCurrentPage() {
  if (!pdfDoc) return;

  const token = ++renderToken;
  const pageNumber = Math.max(1, Math.min(pdfDoc.numPages, currentPage));

  pageContainer.innerHTML = "";
  pageContainer.hidden = false;
  emptyState.hidden = true;

  try {
    // Only fetch/render the page the user actually requested. A 700-page
    // textbook therefore creates one canvas instead of 700 canvases at load.
    const page = await pdfDoc.getPage(pageNumber);
    if (token !== renderToken) return;

    const viewport = page.getViewport({ scale });
    const wrapper = document.createElement("div");
    wrapper.className = "pdf-page";
    wrapper.dataset.page = pageNumber;

    const label = document.createElement("div");
    label.className = "page-label";
    label.textContent = `PAGE ${pageNumber}`;

    const pageContent = document.createElement("div");
    pageContent.className = "pdf-page-content";

    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page-canvas";
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    textLayer.style.setProperty("--scale-factor", viewport.scale);

    pageContent.append(canvas, textLayer);
    wrapper.append(label, pageContent);
    pageContainer.appendChild(wrapper);

    await page.render({
      canvasContext: canvas.getContext("2d"),
      viewport
    }).promise;

    if (token !== renderToken) return;

    const textContent = await page.getTextContent();
    if (token !== renderToken) return;

    const TextLayer = pdfjsLib.TextLayer;
    if (TextLayer) {
      const textLayerRender = new TextLayer({
        textContentSource: textContent,
        container: textLayer,
        viewport
      });
      await textLayerRender.render();
    } else {
      textLayer.textContent = textContent.items.map(item => item.str).join(" ");
    }

    if (token === renderToken) {
      updateControls();
      highlightSearchPage(pageNumber);
    }
  } catch (error) {
    if (token !== renderToken) return;
    console.error("Page render error:", error);
    showToast(`Could not render page ${pageNumber}.`);
  }
}

/*
 * PDFs are loaded as bytes so both local files and content/ PDFs work
 * without relying on PDF.js to fetch the document itself.
 */
async function openPdfBytes(bytes, name, browserUrl = null, courseCode = "LOCAL PDF", enableSearch = true) {
  setLoading(true);

  try {
    pdfDoc = await pdfjsLib.getDocument({
      data: new Uint8Array(bytes)
    }).promise;

    currentUrl = browserUrl;
    currentPage = 1;
    scale = 1;
    searchMatches = [];
    searchIndex = -1;
    searchTerm = "";
    searchScanned = new Set();
    searchEnabled = enableSearch;
    updateSearchControls();
    $("fileTitle").textContent = name;
    $("fileCourse").textContent = courseCode || "NO COURSE CODE";
    playSound("popup");
    startPdfMusic();

    updateControls();

    currentPage = 1;
    await renderCurrentPage();
    updateControls();
  } catch (error) {
    console.error("PDF error:", error);
    renderToken++;
      pdfDoc = null;
    currentUrl = null;
    pageContainer.innerHTML = "";
    pageContainer.hidden = true;
    emptyState.hidden = false;
    updateControls();
    showToast("This PDF could not be opened. Check that it is a valid PDF.");
  } finally {
    setLoading(false);
  }
}

function updateSearchControls() {
  const searchControls = document.querySelector(".search-controls");
  const input = $("searchInput");
  const prev = $("searchPrev");
  const next = $("searchNext");
  const count = $("searchCount");
  const hasMatch = searchIndex >= 0 && searchMatches.length > 0;

  if (searchControls) {
    searchControls.hidden = !searchEnabled;
    searchControls.style.display = searchEnabled ? "flex" : "none";
  }

  input.disabled = !searchEnabled || !pdfDoc;
  prev.disabled = !searchEnabled || !pdfDoc || !input.value.trim();
  next.disabled = !searchEnabled || !pdfDoc || !input.value.trim();
  count.textContent = searchEnabled && hasMatch ? `Page ${searchMatches[searchIndex]}` : "0 / 0";
}

function clearSearchHighlights() {
  pageContainer.querySelectorAll(".search-hit").forEach(hit => {
    hit.classList.remove("search-hit");
    hit.classList.remove("search-hit-current");
  });
}

async function pageContainsSearchTerm(pageNumber, query) {
  if (!pdfDoc) return false;
  const page = await pdfDoc.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const text = textContent.items.map(item => item.str || "").join(" ").toLocaleLowerCase();
  return text.includes(query);
}

function highlightSearchPage(pageNumber) {
  clearSearchHighlights();
  const page = pageContainer.querySelector(`[data-page="${pageNumber}"]`);
  if (!page) return;

  const input = $("searchInput").value.trim().toLocaleLowerCase();
  if (!input) return;

  page.querySelectorAll(".textLayer span").forEach(span => {
    const text = span.textContent || "";
    if (text.toLocaleLowerCase().includes(input)) {
      span.classList.add("search-hit");
    }
  });

  const first = page.querySelector(".search-hit");
  if (first) first.classList.add("search-hit-current");
}

async function findNextMatch(direction = 1, startPage = null) {
  if (!pdfDoc || !searchEnabled) return;

  const query = $("searchInput").value.trim().toLocaleLowerCase();
  if (!query) return;

  // If the search term changed, start a fresh search from the current page.
  if (query !== searchTerm) {
    searchTerm = query;
    searchMatches = [];
    searchIndex = -1;
    searchScanned = new Set();
    clearSearchHighlights();
  }

  const totalPages = pdfDoc.numPages;
  let pageNumber;

  if (startPage !== null) {
    pageNumber = startPage;
  } else if (searchIndex >= 0 && searchMatches.length) {
    pageNumber = searchMatches[searchIndex] + direction;
  } else {
    pageNumber = currentPage;
  }

  // Search only until the next matching page is found. Nothing is scanned
  // ahead of time, so large PDFs do not need to be searched all at once.
  for (let checked = 0; checked < totalPages; checked++) {
    if (pageNumber > totalPages) pageNumber = 1;
    if (pageNumber < 1) pageNumber = totalPages;

    if (!searchScanned.has(pageNumber)) {
      searchScanned.add(pageNumber);
      if (await pageContainsSearchTerm(pageNumber, query)) {
        const existing = searchMatches.indexOf(pageNumber);
        if (existing === -1) searchMatches.push(pageNumber);
        searchIndex = searchMatches.indexOf(pageNumber);
        scrollToPage(pageNumber);
        highlightSearchPage(pageNumber);
        updateSearchControls();
        return;
      }
    } else if (searchMatches.includes(pageNumber)) {
      searchIndex = searchMatches.indexOf(pageNumber);
      scrollToPage(pageNumber);
      highlightSearchPage(pageNumber);
      updateSearchControls();
      return;
    }

    pageNumber += direction;
  }

  // We reached the end without finding another result. Wrap around once.
  searchScanned.clear();
  updateSearchControls();
}

async function findInPdf(term) {
  if (!pdfDoc || !searchEnabled) return;

  const query = term.trim().toLocaleLowerCase();
  searchTerm = query;
  searchMatches = [];
  searchIndex = -1;
  searchScanned = new Set();
  clearSearchHighlights();

  if (!query) {
    updateSearchControls();
    return;
  }

  await findNextMatch(1, currentPage);
}

function goToSearchMatch(direction) {
  if (!pdfDoc || !$("searchInput").value.trim()) return;
  findNextMatch(direction);
}

async function openLocalFile(file) {
  if (AdminView === 0) return;
  if (!file) return;

  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    showToast("Please choose a PDF file.");
    return;
  }

  try {
    const bytes = await file.arrayBuffer();

    if (currentUrl && currentUrl.startsWith("blob:")) {
      URL.revokeObjectURL(currentUrl);
    }

    const browserUrl = URL.createObjectURL(file);
    await openPdfBytes(bytes, file.name, browserUrl, "LOCAL PDF", true);
  } catch (error) {
    console.error(error);
    showToast("Could not read that file.");
  }
}

async function openPdfUrl(browserUrl, name, courseCode = "NO COURSE CODE", enableSearch = true) {
  setLoading(true);

  try {
    pdfDoc = await pdfjsLib.getDocument({
      url: browserUrl,
      disableAutoFetch: false,
      disableStream: false
    }).promise;

    currentUrl = browserUrl;
    currentPage = 1;
    scale = 1;
    searchMatches = [];
    searchIndex = -1;
    searchTerm = "";
    searchScanned = new Set();
    searchEnabled = enableSearch;
    updateSearchControls();
    $("fileTitle").textContent = name;
    $("fileCourse").textContent = courseCode || "NO COURSE CODE";
    updateControls();
    playSound("popup");
    startPdfMusic();

    currentPage = 1;
    await renderCurrentPage();
    updateControls();
  } catch (error) {
    console.error("PDF URL error:", error);
    renderToken++;
      pdfDoc = null;
    currentUrl = null;
    pageContainer.innerHTML = "";
    pageContainer.hidden = true;
    emptyState.hidden = false;
    updateControls();
    throw error;
  } finally {
    setLoading(false);
  }
}

async function openWebsitePdf(path, title, courseCode = "NO COURSE CODE", enableSearch = true) {
  setLoading(true);

  try {
    const response = await fetch(path, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const bytes = await response.arrayBuffer();
    const browserUrl = new URL(path, document.baseURI).href;

    await openPdfBytes(bytes, title, browserUrl, courseCode, enableSearch);
  } catch (error) {
    console.error("Website PDF error:", error);
    setLoading(false);
    showToast(
      "The PDF could not be loaded. Make sure the site is being run through a web server and that the filename matches pdfs.json."
    );
  }
}

async function fitToWidth() {
  if (!pdfDoc) return;

  const page = await pdfDoc.getPage(currentPage);
  const baseViewport = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(250, stage.clientWidth - 90);

  scale = Math.min(
    2.5,
    Math.max(0.35, availableWidth / baseViewport.width)
  );

  await renderCurrentPage();
}

async function scrollToPage(pageNumber, smooth = false) {
  if (!pdfDoc) return;

  const targetPage = Math.max(1, Math.min(pdfDoc.numPages, Number(pageNumber) || 1));
  currentPage = targetPage;
  updateControls();
  await renderCurrentPage();

  // The viewer contains only the requested page, so there is no large
  // scrollable DOM to maintain for a 700-page document.
  stage.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
}

$("prevPage").addEventListener("click", () => {
  if (!pdfDoc || currentPage <= 1) return;
  playSound("pageFlip");
  scrollToPage(currentPage - 1, false);
});

$("nextPage").addEventListener("click", () => {
  if (!pdfDoc || currentPage >= pdfDoc.numPages) return;
  playSound("pageFlip");
  scrollToPage(currentPage + 1, false);
});


const pageInput = $("pageNum");

function jumpFromPageInput() {
  if (!pdfDoc || !pageInput) return;

  const raw = pageInput.value.trim();
  let target = Number.parseInt(raw, 10);

  if (!Number.isFinite(target)) {
    target = currentPage;
  } else {
    target = Math.max(1, Math.min(pdfDoc.numPages, target));
  }

  pageInput.value = target;
  if (target !== currentPage) playSound("pageFlip");
  scrollToPage(target, false);
}

pageInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    jumpFromPageInput();
    pageInput.blur();
  }
});

pageInput.addEventListener("change", jumpFromPageInput);
pageInput.addEventListener("blur", jumpFromPageInput);


$("zoomOut").addEventListener("click", async () => {
  if (!pdfDoc) return;
  const page = currentPage;
  scale = Math.max(0.35, scale - 0.1);
  currentPage = page;
  await renderCurrentPage();
  updateControls();
});

$("zoomIn").addEventListener("click", async () => {
  if (!pdfDoc) return;
  const page = currentPage;
  scale = Math.min(3, scale + 0.1);
  currentPage = page;
  await renderCurrentPage();
  updateControls();
});

$("fitBtn").addEventListener("click", async () => {
  const page = currentPage;
  await fitToWidth();
  scrollToPage(page);
});

$("newTabBtn").addEventListener("click", () => {
  if (currentUrl) window.open(currentUrl, "_blank", "noopener");
});

$("soundToggle").addEventListener("click", () => {
  soundsMuted = !soundsMuted;
  localStorage.setItem("pdfViewerSoundsMuted", String(soundsMuted));
  updateAudioButtons();
});

$("musicToggle").addEventListener("click", () => {
  musicMuted = !musicMuted;
  localStorage.setItem("pdfViewerMusicMuted", String(musicMuted));
  if (musicMuted) stopPdfMusic();
  else startPdfMusic();
  updateAudioButtons();
});

document.addEventListener("keydown", event => {
  if (event.key.toLowerCase() === "m") {
    if (event.target.matches("input, textarea, select")) return;
    event.preventDefault();
    const muted = !(soundsMuted && musicMuted);
    soundsMuted = muted;
    musicMuted = muted;
    localStorage.setItem("pdfViewerSoundsMuted", String(muted));
    localStorage.setItem("pdfViewerMusicMuted", String(muted));
    if (muted) stopPdfMusic();
    else startPdfMusic();
    updateAudioButtons();
    return;
  }

  if (!pdfDoc || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (currentPage > 1) {
      playSound("pageFlip");
      scrollToPage(currentPage - 1, false);
    }
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    if (currentPage < pdfDoc.numPages) {
      playSound("pageFlip");
      scrollToPage(currentPage + 1, false);
    }
  }
});

$("filePicker").addEventListener("change", event => {
  openLocalFile(event.target.files[0]);
  event.target.value = "";
});

$("stagePicker").addEventListener("change", event => {
  openLocalFile(event.target.files[0]);
  event.target.value = "";
});

["dragenter", "dragover"].forEach(type => {
  window.addEventListener(type, event => {
    event.preventDefault();
    event.stopPropagation();
    stage.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach(type => {
  window.addEventListener(type, event => {
    event.preventDefault();
    event.stopPropagation();
    stage.classList.remove("dragover");
  });
});

window.addEventListener("drop", event => {
  if (AdminView === 0) return;

  const files = Array.from(event.dataTransfer?.files || []);
  const pdf = files.find(file =>
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );

  if (pdf) {
    openLocalFile(pdf);
  } else if (files.length) {
    showToast("Drop a PDF file.");
  }
});

async function loadManifest() {
  const list = $("pdfList");

  try {
    const response = await fetch("pdfs.json", { cache: "no-store" });

    if (!response.ok) throw new Error("pdfs.json was not found");

    const entries = await response.json();
    if (!Array.isArray(entries)) throw new Error("pdfs.json must contain an array");

    list.innerHTML = "";

    if (entries.length === 0) {
      list.innerHTML = '<div class="empty">No PDFs have been added to the content list.</div>';
      return;
    }

    for (const entry of entries) {
      if (!entry.file) continue;

      const item = document.createElement("button");
      item.className = "pdf-item";

      const title = entry.title || entry.file;
      const courseCode = entry.courseCode || "NO COURSE CODE";
      const filename = entry.file;
      const enableSearch = entry.searchable !== false;
      const path = entry.file.startsWith("content/") ? entry.file : `content/${entry.file}`;
      const browserUrl = new URL(path, document.baseURI).href;
      item.innerHTML = `
        <span class="pdf-course">${escapeHtml(courseCode)}</span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(filename)}</small>
      `;

      libraryEntries.set(browserUrl, entry);

      item.addEventListener("click", async () => {
        document.querySelectorAll(".pdf-item").forEach(button => button.classList.remove("active"));
        item.classList.add("active");

        await openWebsitePdf(path, title, courseCode, enableSearch);
      });

      list.appendChild(item);
    }

    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "back-menu-button";
    backButton.textContent = "← BACK TO MENU";
    backButton.addEventListener("click", () => {
      playSound("arrow");
      window.location.href = "https://www.google.com";
    });
    list.appendChild(backButton);

    const requested = new URLSearchParams(location.search).get("file");

    if (requested) {
      const found = entries.find(entry =>
        entry.file === requested || `content/${entry.file}` === requested
      );

      const path = requested.startsWith("content/") ? requested : `content/${requested}`;
      await openWebsitePdf(
        path,
        found?.title || requested.split("/").pop(),
        found?.courseCode || "NO COURSE CODE",
        found?.searchable !== false
      );
    }
  } catch (error) {
    console.error(error);

    list.innerHTML = `
      <div class="empty">
        <strong>PDF list unavailable</strong><br><br>
        Make sure <code>pdfs.json</code> is beside this page.
        <br><br>
        If you opened the HTML directly with <code>file://</code>,
        use a local web server instead.
      </div>
    `;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}

$("searchInput").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    if (event.shiftKey) goToSearchMatch(-1);
    else findInPdf(event.target.value);
  }
});

$("searchPrev").addEventListener("click", () => { playSound("arrow"); goToSearchMatch(-1); });
$("searchNext").addEventListener("click", () => { playSound("arrow"); goToSearchMatch(1); });

$("refreshBtn").addEventListener("click", () => { playSound("select"); loadManifest(); });

window.addEventListener("resize", () => {
  if (pdfDoc) {
    const page = currentPage;
    clearTimeout(window.resizeTimer);
    window.resizeTimer = setTimeout(async () => {
      await fitToWidth();
      scrollToPage(page);
    }, 150);
  }
});

// Use the same general interaction pattern as the supplied quiz site's sounds:
// buttons get a light hover sound, while important actions get dedicated SFX.
document.addEventListener("pointerover", event => {
  const button = event.target.closest("button, .upload-button, .stage-open, .pdf-item");
  if (button && !button.contains(event.relatedTarget)) playSound("highlight");
});

// Browsers normally require a user gesture before music can start.
document.addEventListener("pointerdown", startPdfMusic, { once: true });
document.addEventListener("keydown", event => {
  if (event.target.tagName !== "INPUT") startPdfMusic();
}, { once: true });

// The main building sits above the global sky, so clone the stars into the
// night-sky header as well. This keeps them visible behind the title instead
// of hiding them underneath the viewer panels.
const skyStars = document.querySelector(".star-field");
const siteHeader = document.querySelector("header");
if (skyStars && siteHeader) {
  const headerStars = skyStars.cloneNode(true);
  headerStars.classList.add("header-stars");
  siteHeader.prepend(headerStars);
}

updateControls();
updateAudioButtons();
applyAdminView();
loadManifest();
