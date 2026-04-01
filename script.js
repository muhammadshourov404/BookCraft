/* ============================================================
   BookCraft — script.js
   সম্পূর্ণ লজিক: State, Firebase, Storage, Editor, PDF
   ============================================================ */

/* ============ FIREBASE CONFIG ============
   Firebase সেটআপের পরে এখানে আপনার config বসান।
   এখনই কাজ করবে — localStorage দিয়ে।
   ================================================ */
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

/* ============ STATE ============ */
let state = {
  books: [],
  currentBookId: null,
  currentChapterId: null,
  unsaved: false
};

let db = null;
let autoSaveTimer = null;
let deleteTargetId = null;

/* ============ FIREBASE INIT ============ */
function initFirebase() {
  try {
    if (FIREBASE_CONFIG.apiKey === "YOUR_API_KEY") return;
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
    console.log("✅ Firebase সংযুক্ত");
  } catch (e) {
    console.warn("Firebase সংযুক্ত নয়, localStorage ব্যবহার করা হচ্ছে।", e);
  }
}

/* ============ DEVICE ID ============ */
function getDeviceId() {
  let id = localStorage.getItem("bc_device_id");
  if (!id) {
    id = "dev_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
    localStorage.setItem("bc_device_id", id);
  }
  return id;
}

/* ============ STORAGE ============ */
async function loadBooks() {
  if (db) {
    try {
      const snap = await db.collection("bookcraft").doc(getDeviceId()).get();
      if (snap.exists) {
        state.books = JSON.parse(snap.data().books || "[]");
        return;
      }
    } catch (e) {
      console.warn("Firebase load error:", e);
    }
  }
  const raw = localStorage.getItem("bc_books");
  state.books = raw ? JSON.parse(raw) : [];
}

async function saveBooks(silent = false) {
  const serialized = JSON.stringify(state.books);
  localStorage.setItem("bc_books", serialized);

  if (db) {
    try {
      await db.collection("bookcraft").doc(getDeviceId()).set({
        books: serialized,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.warn("Firebase save error:", e);
    }
  }

  if (!silent) {
    setAutoSaveLabel("saved");
    showToast("✓ সেভ হয়েছে");
  }
  state.unsaved = false;
}

/* ============ HELPERS ============ */
function genId() {
  return "_" + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

function wordCount(html) {
  const text = html.replace(/<[^>]*>/g, " ").trim();
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function toBengaliNumber(n) {
  const map = { "0":"০","1":"১","2":"২","3":"৩","4":"৪","5":"৫","6":"৬","7":"৭","8":"৮","9":"৯" };
  return String(n).replace(/[0-9]/g, d => map[d]);
}

function showToast(msg, duration = 2200) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = "none"; }, duration);
}

function setAutoSaveLabel(status) {
  const el = document.getElementById("autosave-label");
  if (!el) return;
  if (status === "saved") {
    el.textContent = "● সেভ হয়েছে";
    el.className = "autosave-label saved";
  } else if (status === "saving") {
    el.textContent = "● সেভ হচ্ছে...";
    el.className = "autosave-label saving";
  } else {
    el.textContent = "● সেভ হয়নি";
    el.className = "autosave-label";
  }
}

/* ============ GET CURRENT BOOK ============ */
function getCurrentBook() {
  return state.books.find(b => b.id === state.currentBookId) || null;
}

function getCurrentChapter() {
  const book = getCurrentBook();
  if (!book) return null;
  return book.chapters.find(c => c.id === state.currentChapterId) || null;
}

/* ============ DASHBOARD ============ */
function renderDashboard() {
  const grid = document.getElementById("books-grid");
  const empty = document.getElementById("empty-state");

  if (state.books.length === 0) {
    grid.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  grid.innerHTML = state.books
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(book => {
      const totalWords = (book.chapters || []).reduce((s, c) => s + wordCount(c.content || ""), 0);
      const pages = Math.max(1, Math.ceil(totalWords / 250));
      const chCount = (book.chapters || []).length;
      const genreHtml = book.genre
        ? `<span class="book-card-genre">${book.genre}</span>`
        : "";
      return `
        <div class="book-card" onclick="openBook('${book.id}')">
          <div class="book-card-actions" onclick="event.stopPropagation()">
            <button class="card-action-btn" onclick="openBook('${book.id}')" title="খুলুন">✏</button>
            <button class="card-action-btn danger" onclick="askDelete('${book.id}')" title="মুছুন">🗑</button>
          </div>
          ${genreHtml}
          <div class="book-card-title">${book.title || "শিরোনামহীন বই"}</div>
          ${book.author ? `<div class="book-card-author">— ${book.author}</div>` : ""}
          <div class="book-card-meta">
            <span>${toBengaliNumber(chCount)} অধ্যায়</span>
            <span>${toBengaliNumber(totalWords)} শব্দ</span>
            <span>~${toBengaliNumber(pages)} পৃষ্ঠা</span>
          </div>
        </div>`;
    }).join("");
}

/* ============ OPEN BOOK ============ */
function openBook(bookId) {
  state.currentBookId = bookId;
  state.currentChapterId = null;

  const book = getCurrentBook();
  if (!book) return;

  // Populate editor fields
  document.getElementById("input-book-title").value = book.title || "";
  document.getElementById("input-author").value     = book.author || "";
  document.getElementById("input-subtitle").value   = book.subtitle || "";
  document.getElementById("input-genre").value      = book.genre || "";

  // Switch view
  document.getElementById("view-dashboard").classList.remove("active");
  document.getElementById("view-editor").classList.add("active");

  renderChaptersList();
  updateStats();

  // Select first chapter if exists
  if (book.chapters && book.chapters.length > 0) {
    selectChapter(book.chapters[0].id);
  } else {
    showNoChapterMsg(true);
  }
}

/* ============ CHAPTERS ============ */
function renderChaptersList() {
  const book = getCurrentBook();
  const list = document.getElementById("chapters-list");
  if (!book || !book.chapters || book.chapters.length === 0) {
    list.innerHTML = `<div style="font-size:0.78rem;color:var(--ink-3);padding:4px 2px">কোনো অধ্যায় নেই।</div>`;
    return;
  }

  list.innerHTML = book.chapters.map((ch, i) => `
    <div class="ch-item ${ch.id === state.currentChapterId ? "active" : ""}"
         onclick="selectChapter('${ch.id}')">
      <span class="ch-num">${toBengaliNumber(i + 1)}</span>
      <span class="ch-name">${ch.title || `অধ্যায় ${i + 1}`}</span>
      <button class="ch-del" onclick="event.stopPropagation();deleteChapter('${ch.id}')" title="মুছুন">✕</button>
    </div>
  `).join("");
}

function selectChapter(chapterId) {
  // Save current chapter first
  saveCurrentChapterToState();

  state.currentChapterId = chapterId;
  const ch = getCurrentChapter();
  if (!ch) return;

  document.getElementById("input-chapter-title").value = ch.title || "";
  document.getElementById("editor-content").innerHTML   = ch.content || "";

  showNoChapterMsg(false);
  renderChaptersList();
  updateWordCount();
  setAutoSaveLabel("saved");

  // Focus editor
  setTimeout(() => document.getElementById("editor-content").focus(), 50);
}

function showNoChapterMsg(show) {
  document.getElementById("no-chapter-msg").style.display    = show ? "flex" : "none";
  document.getElementById("chapter-editor-wrap").style.display = show ? "none" : "flex";
  document.getElementById("format-toolbar").style.display      = show ? "none" : "flex";
}

function saveCurrentChapterToState() {
  if (!state.currentChapterId) return;
  const book = getCurrentBook();
  if (!book) return;
  const ch = book.chapters.find(c => c.id === state.currentChapterId);
  if (!ch) return;

  ch.title   = document.getElementById("input-chapter-title").value.trim();
  ch.content = document.getElementById("editor-content").innerHTML;
  book.updatedAt = Date.now();
}

function addChapter() {
  const book = getCurrentBook();
  if (!book) return;

  // Save current before adding
  saveCurrentChapterToState();

  const chNum = (book.chapters || []).length + 1;
  const ch = {
    id:      genId(),
    title:   `অধ্যায় ${chNum}`,
    content: "",
    order:   chNum - 1
  };

  book.chapters.push(ch);
  book.updatedAt = Date.now();

  renderChaptersList();
  updateStats();
  triggerAutoSave();
  selectChapter(ch.id);
}

function deleteChapter(chId) {
  const book = getCurrentBook();
  if (!book) return;

  if (book.chapters.length === 1) {
    showToast("⚠ অন্তত একটি অধ্যায় থাকতে হবে।");
    return;
  }

  book.chapters = book.chapters.filter(c => c.id !== chId);
  book.updatedAt = Date.now();

  if (state.currentChapterId === chId) {
    state.currentChapterId = null;
    selectChapter(book.chapters[0].id);
  }

  renderChaptersList();
  updateStats();
  triggerAutoSave();
}

/* ============ STATS ============ */
function updateStats() {
  const book = getCurrentBook();
  if (!book) return;

  const totalWords = (book.chapters || []).reduce((s, c) => s + wordCount(c.content || ""), 0);
  const pages = Math.max(book.chapters.length > 0 ? 1 : 0, Math.ceil(totalWords / 250));

  document.getElementById("total-words").textContent    = toBengaliNumber(totalWords);
  document.getElementById("total-chapters").textContent = toBengaliNumber(book.chapters.length);
  document.getElementById("total-pages").textContent    = toBengaliNumber(pages);
}

function updateWordCount() {
  const content = document.getElementById("editor-content");
  const count = wordCount(content.innerHTML);
  document.getElementById("ch-word-count").textContent = toBengaliNumber(count) + " শব্দ";
  updateStats();
}

/* ============ AUTO SAVE ============ */
function triggerAutoSave() {
  state.unsaved = true;
  setAutoSaveLabel("saving");
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    saveCurrentChapterToState();
    await saveBooks(true);
    setAutoSaveLabel("saved");
    state.unsaved = false;
  }, 2000);
}

/* ============ FORMATTING TOOLBAR ============ */
function initToolbar() {
  document.querySelectorAll(".fmt-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const cmd = btn.dataset.cmd;
      if (cmd === "h2" || cmd === "h3" || cmd === "p") {
        document.execCommand("formatBlock", false, cmd);
      } else {
        document.execCommand(cmd, false, null);
      }
      document.getElementById("editor-content").focus();
      updateToolbarState();
    });
  });

  document.getElementById("font-size-sel").addEventListener("change", function () {
    document.execCommand("fontSize", false, "7");
    const spans = document.querySelectorAll('#editor-content span[style*="font-size"]');
    spans.forEach(s => { s.style.fontSize = this.value + "px"; });
    document.getElementById("editor-content").focus();
  });
}

function updateToolbarState() {
  const cmds = ["bold", "italic", "underline", "insertUnorderedList", "justifyLeft", "justifyCenter", "justifyRight"];
  cmds.forEach(cmd => {
    const btn = document.querySelector(`.fmt-btn[data-cmd="${cmd}"]`);
    if (btn) btn.classList.toggle("active", document.queryCommandState(cmd));
  });
}

/* ============ BOOK PREVIEW ============ */
function buildBookPreviewHTML(book) {
  const chapters = book.chapters || [];

  // Title Page
  const titlePage = `
    <div class="book-page title-page">
      ${book.genre ? `<div class="tp-genre">${book.genre}</div>` : ""}
      <h1 class="tp-title">${book.title || "শিরোনামহীন বই"}</h1>
      <div class="tp-ornament">✦ ✦ ✦</div>
      ${book.subtitle ? `<div class="tp-subtitle">${book.subtitle}</div>` : ""}
      <div style="flex:1"></div>
      ${book.author ? `
        <div>
          <div class="tp-author-label">লেখক</div>
          <div class="tp-author">${book.author}</div>
        </div>` : ""}
    </div>`;

  // TOC Page
  const tocEntries = chapters.map((ch, i) => `
    <div class="toc-entry">
      <span class="toc-ch-num">অধ্যায় ${i + 1}</span>
      <span class="toc-ch-name">${ch.title || `অধ্যায় ${i + 1}`}</span>
    </div>`).join("");

  const tocPage = chapters.length > 0 ? `
    <div class="book-page">
      <div class="toc-page-title">সূচিপত্র</div>
      <div>${tocEntries}</div>
    </div>` : "";

  // Chapter Pages
  const chapterPages = chapters.map((ch, i) => {
    const cleanContent = cleanContentForBook(ch.content || "");
    return `
      <div class="book-page">
        <div class="chapter-header">
          <div class="ch-num-label">অধ্যায় ${i + 1}</div>
          <div class="ch-title-display">${ch.title || `অধ্যায় ${i + 1}`}</div>
        </div>
        <div class="chapter-body">${cleanContent}</div>
        <div class="book-page-num">${i + 3}</div>
      </div>`;
  }).join("");

  return `<div class="book-preview-root">${titlePage}${tocPage}${chapterPages}</div>`;
}

function cleanContentForBook(html) {
  // Wrap bare text nodes in <p> tags for better book formatting
  let clean = html
    .replace(/<div>/gi, "<p>")
    .replace(/<\/div>/gi, "</p>")
    .replace(/<br\s*\/?>/gi, "</p><p>")
    .replace(/<p><\/p>/gi, "")
    .replace(/<p>\s*<\/p>/gi, "");

  // If no block tags at all, wrap everything in <p>
  if (!/<(p|h[1-6]|ul|ol|blockquote)/i.test(clean)) {
    clean = "<p>" + clean + "</p>";
  }

  return clean;
}

/* ============ SHOW PREVIEW ============ */
function showPreview() {
  saveCurrentChapterToState();
  const book = getCurrentBook();
  if (!book) return;

  const container = document.getElementById("book-preview-content");
  container.innerHTML = buildBookPreviewHTML(book);
  document.getElementById("preview-modal").style.display = "flex";
}

/* ============ EXPORT PDF ============ */
async function exportPDF() {
  saveCurrentChapterToState();
  const book = getCurrentBook();
  if (!book) return;

  showToast("⏳ PDF তৈরি হচ্ছে...", 8000);

  // Build a standalone HTML for pdf rendering
  const previewHTML = buildBookPreviewHTML(book);

  const fontLink = `<link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600&family=Noto+Serif+Bengali:wght@400;500;600;700&display=swap" rel="stylesheet">`;

  // Inline styles for the PDF
  const pdfStyles = `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: white; }
      .book-preview-root { font-family: 'Noto Serif Bengali', serif; color: #1a1a1a; background: white; width: 100%; }
      .book-page { padding: 55px 65px; min-height: 1050px; position: relative; page-break-after: always; }
      .book-page:last-child { page-break-after: avoid; }
      .title-page { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
      .tp-genre { font-family: 'Hind Siliguri',sans-serif; font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.2em; color: #8B7355; margin-bottom: 60px; }
      .tp-title { font-family: 'Noto Serif Bengali',serif; font-size: 2.2rem; font-weight: 700; line-height: 1.25; color: #1a1a1a; margin-bottom: 16px; }
      .tp-ornament { font-size: 1.1rem; color: #8B7355; margin: 18px 0; }
      .tp-subtitle { font-family: 'Noto Serif Bengali',serif; font-size: 1rem; color: #5A3E28; font-style: italic; margin-bottom: 80px; }
      .tp-author { font-family: 'Noto Serif Bengali',serif; font-size: 1.1rem; font-weight: 500; color: #2B1A0E; }
      .tp-author-label { font-family: 'Hind Siliguri',sans-serif; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.12em; color: #8B7355; margin-bottom: 4px; }
      .toc-page-title { font-family: 'Noto Serif Bengali',serif; font-size: 1.3rem; font-weight: 600; text-align: center; margin-bottom: 36px; padding-bottom: 12px; border-bottom: 1px solid #D6CAAE; }
      .toc-entry { display: flex; gap: 8px; padding: 8px 0; border-bottom: 1px dotted #D6CAAE; }
      .toc-ch-num { font-family: 'Hind Siliguri',sans-serif; font-size: 0.72rem; font-weight: 600; color: #8B7355; width: 60px; flex-shrink: 0; }
      .toc-ch-name { font-family: 'Noto Serif Bengali',serif; font-size: 0.9rem; color: #2B1A0E; }
      .chapter-header { text-align: center; margin-bottom: 32px; padding-bottom: 16px; border-bottom: 1px solid #D6CAAE; }
      .ch-num-label { font-family: 'Hind Siliguri',sans-serif; font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.15em; color: #8B7355; margin-bottom: 6px; }
      .ch-title-display { font-family: 'Noto Serif Bengali',serif; font-size: 1.4rem; font-weight: 600; color: #1a1a1a; }
      .chapter-body { font-family: 'Noto Serif Bengali',serif; font-size: 0.95rem; line-height: 2; color: #2B1A0E; text-align: justify; }
      .chapter-body p { margin-bottom: 1em; text-indent: 1.5em; }
      .chapter-body p:first-child { text-indent: 0; }
      .chapter-body h2 { font-size: 1.15rem; font-weight: 600; margin: 1.4em 0 0.5em; text-align: center; text-indent: 0; }
      .chapter-body h3 { font-size: 1rem; font-weight: 600; margin: 1em 0 0.4em; text-indent: 0; }
      .chapter-body ul, .chapter-body ol { padding-left: 2em; margin-bottom: 1em; }
      .book-page-num { position: absolute; bottom: 22px; width: calc(100% - 130px); left: 65px; text-align: center; font-family: 'Hind Siliguri',sans-serif; font-size: 0.72rem; color: #8B7355; }
    </style>`;

  // Create a temp div
  const wrapper = document.createElement("div");
  wrapper.innerHTML = previewHTML;
  wrapper.style.cssText = "position:fixed;left:-9999px;top:0;width:794px;background:white;";
  document.body.appendChild(wrapper);

  // Inject font
  const fontEl = document.createElement("link");
  fontEl.rel  = "stylesheet";
  fontEl.href = "https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600&family=Noto+Serif+Bengali:wght@400;500;600;700&display=swap";
  document.head.appendChild(fontEl);

  // Wait for fonts
  await document.fonts.ready;
  await new Promise(r => setTimeout(r, 1200));

  const safeTitle = (book.title || "book").replace(/[^a-zA-Z0-9\u0980-\u09FF\s]/g, "").trim() || "book";

  try {
    await html2pdf()
      .set({
        margin:       [10, 10, 10, 10],
        filename:     safeTitle + ".pdf",
        image:        { type: "jpeg", quality: 0.97 },
        html2canvas:  { scale: 2, useCORS: true, allowTaint: true, logging: false },
        jsPDF:        { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak:    { mode: ["css", "legacy"], before: ".book-page" }
      })
      .from(wrapper)
      .save();
    showToast("✅ PDF ডাউনলোড শুরু হয়েছে!");
  } catch (err) {
    console.error("PDF error:", err);
    showToast("❌ PDF তৈরিতে সমস্যা। প্রিন্ট ব্যবহার করুন।", 4000);
  }

  document.body.removeChild(wrapper);
}

/* ============ NEW BOOK MODAL ============ */
function showNewBookModal() {
  document.getElementById("new-book-modal").style.display = "flex";
  setTimeout(() => document.getElementById("new-title").focus(), 100);
}

function hideNewBookModal() {
  document.getElementById("new-book-modal").style.display = "none";
  document.getElementById("new-title").value   = "";
  document.getElementById("new-author").value  = "";
  document.getElementById("new-subtitle").value = "";
  document.getElementById("new-genre").value   = "";
}

async function createNewBook() {
  const title  = document.getElementById("new-title").value.trim();
  const author = document.getElementById("new-author").value.trim();

  if (!title) { showToast("⚠ বইয়ের শিরোনাম দিন।"); return; }
  if (!author) { showToast("⚠ লেখকের নাম দিন।"); return; }

  const book = {
    id:        genId(),
    title,
    author,
    subtitle:  document.getElementById("new-subtitle").value.trim(),
    genre:     document.getElementById("new-genre").value,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    chapters: [{
      id:      genId(),
      title:   "প্রথম অধ্যায়",
      content: "",
      order:   0
    }]
  };

  state.books.push(book);
  await saveBooks(true);
  hideNewBookModal();
  openBook(book.id);
}

/* ============ DELETE BOOK ============ */
function askDelete(bookId) {
  deleteTargetId = bookId;
  document.getElementById("delete-modal").style.display = "flex";
}

async function confirmDelete() {
  if (!deleteTargetId) return;
  state.books = state.books.filter(b => b.id !== deleteTargetId);
  await saveBooks(true);
  deleteTargetId = null;
  document.getElementById("delete-modal").style.display = "none";
  renderDashboard();
  showToast("🗑 বই মুছে ফেলা হয়েছে।");
}

/* ============ BACK TO DASHBOARD ============ */
function backToDashboard() {
  if (state.unsaved) {
    saveCurrentChapterToState();
    saveBooks(true);
  }
  state.currentBookId    = null;
  state.currentChapterId = null;

  document.getElementById("view-editor").classList.remove("active");
  document.getElementById("view-dashboard").classList.add("active");
  renderDashboard();
}

/* ============ BOOK INFO INPUTS ============ */
function syncBookInfo() {
  const book = getCurrentBook();
  if (!book) return;
  book.title    = document.getElementById("input-book-title").value;
  book.author   = document.getElementById("input-author").value;
  book.subtitle = document.getElementById("input-subtitle").value;
  book.genre    = document.getElementById("input-genre").value;
  book.updatedAt = Date.now();
}

/* ============ EVENT LISTENERS ============ */
function bindEvents() {

  // Dashboard
  document.getElementById("btn-new-book").addEventListener("click", showNewBookModal);

  // New book modal
  document.getElementById("btn-close-new-book").addEventListener("click", hideNewBookModal);
  document.getElementById("btn-create-book").addEventListener("click", createNewBook);
  document.getElementById("new-title").addEventListener("keydown", e => { if (e.key === "Enter") createNewBook(); });

  // Editor nav
  document.getElementById("btn-back").addEventListener("click", backToDashboard);

  document.getElementById("btn-save").addEventListener("click", async () => {
    saveCurrentChapterToState();
    syncBookInfo();
    await saveBooks();
  });

  document.getElementById("btn-preview").addEventListener("click", () => {
    syncBookInfo();
    showPreview();
  });

  document.getElementById("btn-export-pdf").addEventListener("click", () => {
    syncBookInfo();
    exportPDF();
  });

  // Preview modal
  document.getElementById("btn-close-preview").addEventListener("click", () => {
    document.getElementById("preview-modal").style.display = "none";
  });

  document.getElementById("btn-print-pdf").addEventListener("click", () => {
    // Print using browser print dialog
    const book = getCurrentBook();
    if (!book) return;
    const previewHTML = buildBookPreviewHTML(book);
    const win = window.open("", "_blank");
    win.document.write(`
      <!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600&family=Noto+Serif+Bengali:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: white; }
        @page { size: A4; margin: 0; }
        @media print { .book-page { page-break-after: always; } }
        .book-preview-root { font-family: 'Noto Serif Bengali', serif; color: #1a1a1a; background: white; }
        .book-page { padding: 55px 65px; min-height: 1050px; position: relative; }
        .title-page { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
        .tp-genre { font-family: 'Hind Siliguri',sans-serif; font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.2em; color: #8B7355; margin-bottom: 60px; }
        .tp-title { font-size: 2.2rem; font-weight: 700; margin-bottom: 16px; }
        .tp-ornament { font-size: 1.1rem; color: #8B7355; margin: 18px 0; }
        .tp-subtitle { font-size: 1rem; color: #5A3E28; font-style: italic; margin-bottom: 80px; }
        .tp-author { font-size: 1.1rem; font-weight: 500; }
        .tp-author-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.12em; color: #8B7355; margin-bottom: 4px; }
        .toc-page-title { font-size: 1.3rem; font-weight: 600; text-align: center; margin-bottom: 36px; padding-bottom: 12px; border-bottom: 1px solid #D6CAAE; }
        .toc-entry { display: flex; gap: 8px; padding: 8px 0; border-bottom: 1px dotted #D6CAAE; }
        .toc-ch-num { font-size: 0.72rem; font-weight: 600; color: #8B7355; width: 60px; flex-shrink: 0; }
        .toc-ch-name { font-size: 0.9rem; }
        .chapter-header { text-align: center; margin-bottom: 32px; padding-bottom: 16px; border-bottom: 1px solid #D6CAAE; }
        .ch-num-label { font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.15em; color: #8B7355; margin-bottom: 6px; }
        .ch-title-display { font-size: 1.4rem; font-weight: 600; }
        .chapter-body { font-size: 0.95rem; line-height: 2; color: #2B1A0E; text-align: justify; }
        .chapter-body p { margin-bottom: 1em; text-indent: 1.5em; }
        .chapter-body p:first-child { text-indent: 0; }
        .chapter-body h2 { font-size: 1.15rem; font-weight: 600; margin: 1.4em 0 0.5em; text-align: center; text-indent: 0; }
        .chapter-body ul, .chapter-body ol { padding-left: 2em; margin-bottom: 1em; }
        .book-page-num { position: absolute; bottom: 22px; width: calc(100% - 130px); left: 65px; text-align: center; font-size: 0.72rem; color: #8B7355; }
      </style>
      </head><body>${previewHTML}</body></html>`);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 1200);
  });

  // Preview backdrop close
  document.getElementById("preview-modal").addEventListener("click", function(e) {
    if (e.target === this) this.style.display = "none";
  });

  // New book backdrop close
  document.getElementById("new-book-modal").addEventListener("click", function(e) {
    if (e.target === this) hideNewBookModal();
  });

  // Delete modal
  document.getElementById("btn-close-delete").addEventListener("click", () => {
    document.getElementById("delete-modal").style.display = "none";
    deleteTargetId = null;
  });
  document.getElementById("btn-cancel-delete").addEventListener("click", () => {
    document.getElementById("delete-modal").style.display = "none";
    deleteTargetId = null;
  });
  document.getElementById("btn-confirm-delete").addEventListener("click", confirmDelete);

  // Delete modal backdrop
  document.getElementById("delete-modal").addEventListener("click", function(e) {
    if (e.target === this) { this.style.display = "none"; deleteTargetId = null; }
  });

  // Add chapter
  document.getElementById("btn-add-chapter").addEventListener("click", addChapter);

  // Chapter title input
  document.getElementById("input-chapter-title").addEventListener("input", function () {
    const ch = getCurrentChapter();
    if (ch) {
      ch.title = this.value;
      renderChaptersList();
    }
    triggerAutoSave();
  });

  // Editor content
  const editorEl = document.getElementById("editor-content");

  editorEl.addEventListener("input", () => {
    updateWordCount();
    triggerAutoSave();
  });

  editorEl.addEventListener("keyup", updateToolbarState);
  editorEl.addEventListener("mouseup", updateToolbarState);

  editorEl.addEventListener("keydown", e => {
    if (e.key === "Tab") {
      e.preventDefault();
      document.execCommand("insertText", false, "\u00A0\u00A0\u00A0\u00A0");
    }
  });

  // Paste — strip external formatting, keep text
  editorEl.addEventListener("paste", e => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text/plain");
    // Paste as paragraphs
    const paragraphs = text.split(/\n+/).filter(p => p.trim());
    const html = paragraphs.map(p => `<p>${p.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>`).join("");
    document.execCommand("insertHTML", false, html || text);
    updateWordCount();
    triggerAutoSave();
  });

  // Book info inputs — sync + autosave
  ["input-book-title","input-author","input-subtitle","input-genre"].forEach(id => {
    document.getElementById(id).addEventListener("input", () => {
      syncBookInfo();
      triggerAutoSave();
    });
  });

  // Mobile sidebar toggle
  document.getElementById("sidebar-toggle").addEventListener("click", () => {
    const inner = document.getElementById("sidebar-inner");
    inner.classList.toggle("open");
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      saveCurrentChapterToState();
      syncBookInfo();
      saveBooks();
    }
  });
}

/* ============ INIT ============ */
async function init() {
  initFirebase();
  await loadBooks();
  renderDashboard();
  bindEvents();
  initToolbar();
  console.log("✅ BookCraft চালু হয়েছে");
}

document.addEventListener("DOMContentLoaded", init);
