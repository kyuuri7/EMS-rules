// ------------------------------------------------------------------
// 文字モーション & スクロール連動の「ぼやっと表示」エンジン
// index.html / editor.html の両方で共通利用します。
// 使い方は README の「文字モーション」を参照。基本さわらなくてOK。
// ------------------------------------------------------------------
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) document.documentElement.classList.add('fx-on');

  // スクロールで画面に入ったら1回だけ再生する対象
  const SEL = '.fx-blur,.fx-rise,.fx-chars,.fx-type,.fx-underline,.pledge-head,.pledge-lead,.pledge-list>li,.pledge-foot,[data-reveal]';
  // 行頭に来てほしくない文字は直前の文字にくっつける（禁則処理）
  const KINSOKU = '、。，．・」』）］】〉》！？!?,.…ー～〜ぁぃぅぇぉっゃゅょァィゥェォッャュョ';

  function mk(ch, i) {
    const s = document.createElement('span');
    s.className = 'fx-c';
    s.style.setProperty('--ci', i);
    s.setAttribute('aria-hidden', 'true');
    s.textContent = ch;
    return s;
  }

  // 文字を1文字ずつ <span class="fx-c"> に分解
  function split(el) {
    if (el.dataset.fxSplit) return;
    el.dataset.fxSplit = '1';
    el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
    let i = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const text = node.nodeValue;
      if (!text.trim()) return;
      const frag = document.createDocumentFragment();
      let last = null;
      text.split(/([A-Za-z0-9]+)/).forEach(part => {
        if (!part) return;
        if (/^[A-Za-z0-9]+$/.test(part)) {          // 英数字は単語単位で改行させない
          const w = document.createElement('span');
          w.className = 'fx-w';
          for (const ch of part) w.appendChild(mk(ch, i++));
          frag.appendChild(w);
          last = w.lastChild;
          return;
        }
        for (const ch of part) {
          if (/\s/.test(ch)) { frag.appendChild(document.createTextNode(ch)); last = null; }
          else if (last && KINSOKU.includes(ch)) { last.textContent += ch; }
          else { last = mk(ch, i++); frag.appendChild(last); }
        }
      });
      node.replaceWith(frag);
    });
  }

  // root の中のモーションを有効化。opts.instant=true なら演出なしで即表示（検索ハイライト・エディタ入力中用）
  function apply(root, opts) {
    root = root || document;
    opts = opts || {};
    const els = [...root.querySelectorAll(SEL)];
    if (root.matches && root.matches(SEL)) els.unshift(root);
    root.querySelectorAll('.fx-wave').forEach(split);
    els.forEach(el => { if (el.matches('.fx-chars,.fx-type')) split(el); });

    if (opts.instant || reduce || !('IntersectionObserver' in window)) {
      els.forEach(el => { el.classList.add('is-in'); if (opts.instant) el.classList.add('fx-instant'); });
      return;
    }
    const io = new IntersectionObserver(entries => {
      // 同時に見えた要素は、上から順に少しずつ遅らせて「順々に」出す
      entries.filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        .forEach((e, k) => {
          const el = e.target;
          if (!el.style.getPropertyValue('--d')) {
            el.style.setProperty('--d', (k * (el.matches('li') ? 0.42 : 0.14)).toFixed(2) + 's');
          }
          el.classList.add('is-in');
          io.unobserve(el);
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    els.forEach(el => io.observe(el));
  }

  // ------------------------------------------------------------
  // 数字のオドメーター演出（車両価格などの桁がパラパラめくれる）
  // 対象要素のテキストを桁ごとの <span class="odometer-digit"> に
  // 分解し、スクロールで画面に入ったタイミングで 0→目的の桁へ
  // 縦にロールさせる。数字以外の文字（$ や , など）はそのまま残す。
  // ------------------------------------------------------------
  const ODOMETER_SEL = '.car-price-tag';

  function buildOdometer(el) {
    if (el.dataset.odoBuilt) return;
    el.dataset.odoBuilt = '1';
    const text = el.textContent;
    el.setAttribute('aria-label', text);
    el.textContent = '';
    el.classList.add('odometer');
    for (const ch of text) {
      if (/[0-9]/.test(ch)) {
        const digit = document.createElement('span');
        digit.className = 'odometer-digit';
        const strip = document.createElement('span');
        strip.className = 'odometer-strip';
        for (let n = 0; n <= 9; n++) {
          const s = document.createElement('span');
          s.textContent = String(n);
          strip.appendChild(s);
        }
        strip.dataset.target = ch;
        digit.appendChild(strip);
        el.appendChild(digit);
      } else {
        el.appendChild(document.createTextNode(ch));
      }
    }
  }

  function playOdometer(el) {
    const strips = [...el.querySelectorAll('.odometer-strip')];
    strips.forEach((strip, i) => {
      setTimeout(() => {
        strip.style.transform = `translateY(-${strip.dataset.target}em)`;
      }, i * 55);
    });
  }

  function resetOdometer(el) {
    el.querySelectorAll('.odometer-strip').forEach(strip => { strip.style.transform = 'translateY(0)'; });
  }

  let odometerObserver = null;
  function initOdometers(root, opts) {
    root = root || document;
    opts = opts || {};
    const els = [...root.querySelectorAll(ODOMETER_SEL)];
    if (!els.length) return;
    els.forEach(buildOdometer);

    if (opts.instant || reduce || !('IntersectionObserver' in window)) {
      els.forEach(el => { resetOdometer(el); playOdometer(el); });
      return;
    }
    els.forEach(el => resetOdometer(el));
    if (!odometerObserver) {
      odometerObserver = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (!e.isIntersecting) return;
          playOdometer(e.target);
          odometerObserver.unobserve(e.target);
        });
      }, { threshold: 0.4 });
    }
    els.forEach(el => odometerObserver.observe(el));
  }

  window.EMSFX = { apply, initOdometers };
})();
