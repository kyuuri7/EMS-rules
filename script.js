// ------------------------------------------------------------------
// らぶぐらっ！EMS ルールサイト
// ページの中身を増やしたいだけなら、この JS は基本さわらなくてOK。
// pages.json と content/*.md を編集するだけでページが増減します。
// ------------------------------------------------------------------

const navEl = document.getElementById('page-nav');
const titleEl = document.getElementById('page-title');
const bodyEl = document.getElementById('page-body');
const searchBox = document.getElementById('search-box');
const searchResultsEl = document.getElementById('search-results');
const searchHintEl = document.getElementById('search-hint');
const menuToggle = document.getElementById('menu-toggle');
const sidebarEl = document.getElementById('sidebar');
const sidebarScrimEl = document.getElementById('sidebar-scrim');
const pageTransitionEl = document.getElementById('page-transition');

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const SKELETON_HTML = `
  <div class="skeleton-wrap" aria-hidden="true">
    <div class="skeleton-line skeleton-h" style="width:38%"></div>
    <div class="skeleton-line" style="width:92%"></div>
    <div class="skeleton-line" style="width:85%"></div>
    <div class="skeleton-line" style="width:70%"></div>
    <div class="skeleton-line skeleton-h" style="width:30%; margin-top:28px;"></div>
    <div class="skeleton-line" style="width:96%"></div>
    <div class="skeleton-line" style="width:80%"></div>
  </div>
`;

let PAGES = [];
let currentRawHtml = '';
let currentPageId = null;
let pendingHighlightQuery = null; // search query to highlight after navigating from cross-page results
let isFirstLoad = true; // 初回読み込み（サイト表示直後・リロード直後）かどうか。
                         // 初回はヒーローバナーを見せたいので、見出し指定が無い限りスクロールしない。

// 見出しID → ページID の全ページ横断インデックス（「#見出しID」だけで
// 他ページの見出しにジャンプできるようにするための索引）。
// 同じIDが複数ページにまたがる場合は「最初に見つかったページ」を記録するだけなので、
// そういうページをまたいだ確実なリンクを貼りたいときは「#ページID/見出しID」形式を使う。
const HEADING_TO_PAGE = new Map();

// ---------- ハンバーガーメニュー（目次の開閉／PC・スマホ共通） ----------
function setSidebarHidden(hidden, persist = true) {
  document.body.classList.toggle('sidebar-hidden', hidden);
  menuToggle.setAttribute('aria-expanded', String(!hidden));
  if (persist) localStorage.setItem('ems-sidebar-hidden', hidden ? '1' : '0');
}

function initSidebarState() {
  const saved = localStorage.getItem('ems-sidebar-hidden');
  if (saved !== null) {
    setSidebarHidden(saved === '1', false);
    return;
  }
  // 保存された設定が無ければ、スマホはデフォルト非表示・PCはデフォルト表示
  const isMobile = window.matchMedia('(max-width: 860px)').matches;
  setSidebarHidden(isMobile, false);
}

menuToggle.addEventListener('click', () => {
  const hidden = !document.body.classList.contains('sidebar-hidden');
  setSidebarHidden(hidden);
});

// スマホでオーバーレイ表示中に外側をタップしたら閉じる
sidebarScrimEl.addEventListener('click', () => setSidebarHidden(true));

initSidebarState();

// ---------- 見出しIDの自動付与 ＆ 横断インデックスの構築 ----------

// 見出しの文字列から扱いやすいスラッグ（id用の文字列）を作る。
// 絵文字や先頭の番号記号（①②…）、記号類を取り除き、空白をハイフンに置き換える。
function slugify(text, fallback) {
  const cleaned = (text || '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/^[\s①②③④⑤⑥⑦⑧⑨⑩0-9.\-・、。]+/u, '')
    .trim()
    .replace(/["'`<>#]/g, '')
    .replace(/\s+/g, '-');
  return cleaned || fallback;
}

// Markdown を HTML に変換し、id を持たない h2/h3 に自動でユニークな id を付与する。
// 戻り値: { html, headingIds: [そのページ内で使われている見出しidの配列] }
function renderPageContent(md) {
  const html = marked.parse(md);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;

  const usedIds = new Set();
  const headings = [...wrapper.querySelectorAll('h2, h3')];
  headings.forEach((h, i) => {
    if (!h.id) {
      let base = slugify(h.textContent, `section-${i + 1}`);
      let candidate = base;
      let n = 2;
      while (usedIds.has(candidate)) candidate = `${base}-${n++}`;
      h.id = candidate;
    }
    usedIds.add(h.id);
  });

  return { html: wrapper.innerHTML, headingIds: [...usedIds] };
}

// ---------- ナビゲーション ----------
async function init() {
  const res = await fetch('pages.json');
  const list = await res.json();

  // 各ページの Markdown を先読みし、全ページ横断検索・横断リンクに使えるようにする
  PAGES = await Promise.all(list.map(async (p) => {
    try {
      const r = await fetch(p.file);
      const md = r.ok ? await r.text() : '';
      const { html, headingIds } = renderPageContent(md);
      return { ...p, raw: md, html, headingIds };
    } catch {
      return { ...p, raw: '', html: '', headingIds: [] };
    }
  }));

  // 見出しID → ページID の索引を構築（同じIDが複数ページにあれば先勝ち）
  PAGES.forEach(p => {
    p.headingIds.forEach(id => {
      if (!HEADING_TO_PAGE.has(id)) HEADING_TO_PAGE.set(id, p.id);
    });
  });

  navEl.innerHTML = '';
  PAGES.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.dataset.id = p.id;
    btn.innerHTML = `<span class="nav-index">${String(i + 1).padStart(2, '0')}</span><span>${p.title}</span>`;
    btn.addEventListener('click', () => {
      pendingHighlightQuery = null;
      navigateTo(p.id, null);
      closeSidebarOnMobile();
    });
    navEl.appendChild(btn);
  });

  window.addEventListener('hashchange', loadFromHash);
  loadFromHash();
}

function closeSidebarOnMobile() {
  if (window.matchMedia('(max-width: 860px)').matches) setSidebarHidden(true);
}

// location.hash を書き換えてページ／見出しに移動する。
// hashchange が発火しない「今と全く同じハッシュ」の場合にも対応するため、
// 実際の画面更新は resolveAndLoad() に共通化してある。
function navigateTo(pageId, headingId) {
  const hash = headingId ? `${pageId}/${headingId}` : pageId;
  if (decodeURIComponent(location.hash.replace('#', '')) === hash) {
    resolveAndLoad(hash);
  } else {
    location.hash = hash;
  }
}

// 現在のハッシュ文字列から「表示すべきページ」と「スクロール先の見出しID」を判定する。
//
// 対応する形式:
//   #ページID              → そのページの先頭を表示
//   #ページID/見出しID     → そのページを表示し、指定の見出しまでスクロール（重複IDでも確実）
//   #見出しID              → まず表示中のページの中にその見出しがあるか探す（従来のページ内目次と同じ挙動）。
//                            無ければ全ページを横断して探し、見つかったページへジャンプする。
//   該当なし               → 先頭ページを表示（不正なリンク用の最終フォールバック）
function resolveHashTarget(rawHash) {
  let raw = '';
  try {
    raw = decodeURIComponent(rawHash.replace('#', ''));
  } catch {
    raw = rawHash.replace('#', '');
  }

  if (!raw) return { page: PAGES[0], headingId: null };

  if (raw.includes('/')) {
    const [pageId, headingId] = raw.split('/');
    const page = PAGES.find(p => p.id === pageId);
    if (page) return { page, headingId: headingId || null };
  }

  const exactPage = PAGES.find(p => p.id === raw);
  if (exactPage) return { page: exactPage, headingId: null };

  // 表示中のページ内にその見出しがあれば、ページ切替せずそのページ内とみなす
  const current = PAGES.find(p => p.id === currentPageId);
  if (current && current.headingIds.includes(raw)) {
    return { page: current, headingId: raw };
  }

  // 全ページを横断して探す
  const ownerPageId = HEADING_TO_PAGE.get(raw);
  if (ownerPageId) {
    const page = PAGES.find(p => p.id === ownerPageId);
    if (page) return { page, headingId: raw };
  }

  return { page: PAGES[0], headingId: null };
}

function loadFromHash() {
  resolveAndLoad(location.hash);
}

function resolveAndLoad(rawHash) {
  const { page, headingId } = resolveHashTarget(rawHash);
  if (page) loadPage(page, headingId);
}

function scrollToHeading(headingId) {
  if (!headingId) {
    bodyEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  requestAnimationFrame(() => {
    const target = document.getElementById(headingId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.add('anchor-flash');
    setTimeout(() => target.classList.remove('anchor-flash'), 1600);
  });
}

async function loadPage(page, headingId = null) {
  // 同じページ内の見出し移動なら、ページを再読み込みせずスクロールだけ行う
  if (page.id === currentPageId) {
    scrollToHeading(headingId);
    return;
  }

  // このページ読み込みが「本当の初回表示」かどうかをここで確定させ、フラグは即座に消費する
  // （非同期処理の途中で他の遷移が走っても、初回判定が二重に効かないようにするため）。
  const wasFirstLoad = isFirstLoad;
  isFirstLoad = false;

  currentPageId = page.id;

  [...navEl.querySelectorAll('.nav-item')].forEach(btn => {
    btn.classList.toggle('active', btn.dataset.id === page.id);
  });

  // フェードアウトしてから中身を差し替える（ページ切替の演出）
  if (pageTransitionEl) pageTransitionEl.classList.remove('is-visible');

  titleEl.textContent = page.title;
  bodyEl.innerHTML = SKELETON_HTML;

  const swap = () => {
    if (pageTransitionEl) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => pageTransitionEl.classList.add('is-visible'));
      });
    }
  };

  try {
    currentRawHtml = page.html;
    bodyEl.innerHTML = currentRawHtml;
    addHeadingAnchorButtons(page.id);
    setupScrollSpy();
    swap();

    // 他ページ・検索結果からのジャンプに対応
    if (pendingHighlightQuery) {
      searchBox.value = pendingHighlightQuery;
      renderSearchResults(pendingHighlightQuery);
      requestAnimationFrame(() => {
        const mark = bodyEl.querySelector('mark');
        if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        pendingHighlightQuery = null;
      });
    } else {
      searchBox.value = '';
      searchResultsEl.innerHTML = '';
      searchResultsEl.classList.remove('open');
      searchHintEl.style.display = '';
      // 初回表示（サイトを開いた直後・リロード直後）で、かつ見出し指定が無い場合は
      // スクロールさせず、ヒーローバナーが見えた状態のままにする。
      if (!(wasFirstLoad && !headingId)) {
        scrollToHeading(headingId);
      }
    }
  } catch (err) {
    bodyEl.innerHTML = `<p>このページの読み込みに失敗しました（${page.file}）。ファイルが存在するか確認してください。</p>`;
    swap();
  }
}

// ---------- 見出しへの「リンクをコピー」ボタン ----------
// 各 h2 / h3 にホバーすると出てくる🔗ボタン。押すと「#ページID/見出しID」形式の
// リンクをクリップボードにコピーしつつ、その場でハイライト表示する。
// この形式でリンクすれば、見出しIDが他ページと重複していても確実にジャンプできるので、
// 「他のページから他のページの特定の見出しに飛びたい」ときはこのボタンで作ったリンクを使うのが一番確実。
function addHeadingAnchorButtons(pageId) {
  const headings = [...bodyEl.querySelectorAll('h2[id], h3[id]')];
  headings.forEach(h => {
    if (h.querySelector('.heading-anchor')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'heading-anchor';
    btn.setAttribute('aria-label', 'この見出しへのリンクをコピー');
    btn.title = 'この見出しへのリンクをコピー';
    btn.innerHTML = '🔗';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const hash = `${pageId}/${h.id}`;
      const url = `${location.origin}${location.pathname}#${hash}`;

      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).catch(() => {});
      }

      if (decodeURIComponent(location.hash.replace('#', '')) === hash) {
        scrollToHeading(h.id);
      } else {
        location.hash = hash;
      }
      showToast('見出しへのリンクをコピーしました');
    });
    h.appendChild(btn);
  });
}

// ---------- ちょっとした通知（トースト） ----------
let toastTimer = null;
function showToast(message) {
  let el = document.getElementById('ems-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ems-toast';
    el.className = 'ems-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2000);
}

// ---------- スクロール連動：見出しの光る左バー／ページ内目次のハイライト ----------
let scrollSpyObserver = null;

function setupScrollSpy() {
  if (scrollSpyObserver) scrollSpyObserver.disconnect();

  const headings = [...bodyEl.querySelectorAll('h2, h3')];
  const tocLinks = [...bodyEl.querySelectorAll('.page-toc a[href^="#"]')];
  if (!headings.length) return;

  scrollSpyObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      // 見出しの左バーを光らせる（一度光ったらそのまま／控えめな一度きりの演出）
      entry.target.classList.add('in-view');

      // 対応する目次チップがあればハイライト
      const id = entry.target.id;
      if (id && tocLinks.length) {
        tocLinks.forEach(a => {
          a.classList.toggle('active', a.getAttribute('href') === `#${id}`);
        });
      }
    });
  }, { rootMargin: '-10% 0px -70% 0px', threshold: 0 });

  headings.forEach(h => scrollSpyObserver.observe(h));
}

// ---------- 検索（全ページ横断） ----------
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripMarkdown(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`]/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSnippet(plainText, query, contextLen = 28) {
  const idx = plainText.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - contextLen);
  const end = Math.min(plainText.length, idx + query.length + contextLen);
  let snippet = plainText.slice(start, end);
  if (start > 0) snippet = '…' + snippet;
  if (end < plainText.length) snippet += '…';
  const re = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  return snippet.replace(re, '<mark>$1</mark>');
}

function highlightQueryInBody(query) {
  if (!query) { bodyEl.innerHTML = currentRawHtml; return; }
  const re = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = currentRawHtml;
  const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  nodes.forEach(node => {
    if (!re.test(node.nodeValue)) return;
    re.lastIndex = 0;
    const span = document.createElement('span');
    span.innerHTML = node.nodeValue.replace(re, '<mark>$1</mark>');
    node.replaceWith(span);
  });

  bodyEl.innerHTML = wrapper.innerHTML;
}

function renderSearchResults(query) {
  if (!query) {
    searchResultsEl.innerHTML = '';
    searchResultsEl.classList.remove('open');
    searchHintEl.style.display = '';
    return;
  }

  const q = query.toLowerCase();
  const matches = PAGES
    .map(p => {
      const plain = stripMarkdown(p.raw || '');
      const count = plain.toLowerCase().split(q).length - 1;
      if (count === 0) return null;
      const snippet = buildSnippet(plain, query);
      return { page: p, count, snippet };
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count);

  searchHintEl.style.display = 'none';

  if (matches.length === 0) {
    searchResultsEl.innerHTML = '<p class="search-empty">一致するページが見つかりませんでした</p>';
    searchResultsEl.classList.add('open');
    return;
  }

  searchResultsEl.innerHTML = '';
  matches.forEach(({ page, count, snippet }) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'search-result-item';
    if (page.id === currentPageId) item.classList.add('current');
    item.innerHTML = `
      <span class="search-result-title">${page.title}${page.id === currentPageId ? '（表示中）' : ''}<span class="search-result-count">${count}件</span></span>
      <span class="search-result-snippet">${snippet || ''}</span>
    `;
    item.addEventListener('click', () => {
      const query2 = searchBox.value.trim();
      if (page.id === currentPageId) {
        highlightQueryInBody(query2);
        const mark = bodyEl.querySelector('mark');
        if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        pendingHighlightQuery = query2;
        location.hash = page.id;
      }
      closeSidebarOnMobile();
    });
    searchResultsEl.appendChild(item);
  });
  searchResultsEl.classList.add('open');

  // 表示中のページも合わせてハイライトしておく
  if (currentPageId) highlightQueryInBody(query);
}

searchBox.addEventListener('input', () => {
  const q = searchBox.value.trim();
  if (!q) bodyEl.innerHTML = currentRawHtml;
  renderSearchResults(q);
});

init();

// ---------- ヒーロー背景：舞い上がる金の粒子 ----------
(function initHeroParticles() {
  if (prefersReducedMotion) return; // 動きを抑えたい設定の人には出さない
  const wrap = document.getElementById('hero-particles');
  if (!wrap) return;

  const COUNT = 14;
  for (let i = 0; i < COUNT; i++) {
    const p = document.createElement('span');
    p.className = 'hero-particle';
    const size = 2 + Math.random() * 3.5;         // 2px〜5.5px
    const left = 4 + Math.random() * 92;           // 4%〜96%
    const duration = 7 + Math.random() * 7;        // 7s〜14s
    const delay = -Math.random() * duration;       // 開始位置をばらけさせる
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.left = `${left}%`;
    p.style.animationDuration = `${duration}s`;
    p.style.animationDelay = `${delay}s`;
    wrap.appendChild(p);
  }
})();

// ---------- ページ全体の背景：記事まわりの余白に舞う金粉 ----------
// ヒーローより粒を小さく・数を絞り、ゆっくり長く漂わせることで
// 読みものの邪魔をしない上品な演出にする（カード等の不透明面には自然に隠れる）。
(function initPageParticles() {
  if (prefersReducedMotion) return;
  const wrap = document.getElementById('page-particles');
  if (!wrap) return;

  const COUNT = 24;
  for (let i = 0; i < COUNT; i++) {
    const p = document.createElement('span');
    p.className = 'page-particle';
    const size = 1.4 + Math.random() * 2.8;          // 1.4px〜4.2px
    const left = Math.random() * 100;                 // 0%〜100%
    const duration = 17 + Math.random() * 15;         // 17s〜32s（ヒーローよりゆっくり）
    const delay = -Math.random() * duration;
    const drift = `${Math.round(Math.random() * 44 - 22)}px`; // 左右へのゆらぎ
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.left = `${left}%`;
    p.style.setProperty('--drift', drift);
    p.style.animationDuration = `${duration}s`;
    p.style.animationDelay = `${delay}s`;
    wrap.appendChild(p);
  }
})();
