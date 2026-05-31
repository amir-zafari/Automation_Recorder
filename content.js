// Web Automation Recorder - Content Script
// Runs on every page (declared in manifest) so recording survives navigation.
// Guarded so a second injection (executeScript fallback) is a harmless no-op.

if (!window.__autoRecorderLoaded__) {
  window.__autoRecorderLoaded__ = true;

  let isRecording = false;
  let listenersAttached = false;

  const CAPTCHA_HINTS = [
    'captcha', 'کد امنیتی', 'کد تصویر', 'security code', 'verification',
    'verify', 'کد تایید', 'کد تأیید', 'robot',
  ];

  // ─── XPath ──────────────────────────────────────────────────────────────────
  function getXPath(el) {
    if (!el || el === document.body) return '//body';

    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
      return `//*[@id="${el.id}"]`;
    }
    if (el.name) {
      return `//${el.tagName.toLowerCase()}[@name="${el.name}"]`;
    }
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria && aria.length < 60) {
      return `//*[@aria-label="${aria.replace(/"/g, '')}"]`;
    }

    const parts = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
      const tag = node.tagName.toLowerCase();
      if (node.id && /^[a-zA-Z][\w-]*$/.test(node.id)) {
        parts.unshift(`*[@id="${node.id}"]`);
        return '//' + parts.join('/');
      }
      let idx = 1;
      let sib = node.previousElementSibling;
      while (sib) {
        if (sib.tagName === node.tagName) idx++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(idx > 1 ? `${tag}[${idx}]` : tag);
      node = node.parentElement;
    }
    return '//' + parts.join('/');
  }

  // Climb to the nearest *clickable* ancestor, so clicking an <svg>/icon inside
  // a button records the button (which is what actually triggers the handler).
  function getClickable(el) {
    let node = el;
    for (let i = 0; i < 5 && node && node !== document.body; i++) {
      const tag = node.tagName ? node.tagName.toLowerCase() : '';
      const role = node.getAttribute && node.getAttribute('role');
      if (['button', 'a', 'summary'].includes(tag)) return node;
      if (role === 'button' || role === 'link' || role === 'tab') return node;
      if (tag === 'input' && ['submit', 'button'].includes(node.type)) return node;
      node = node.parentElement;
    }
    return el;
  }

  function getElementDescription(el) {
    return (
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      el.name ||
      el.id ||
      el.innerText?.trim().substring(0, 40) ||
      el.tagName.toLowerCase()
    );
  }

  // ─── CAPTCHA detection ────────────────────────────────────────────────────────
  function isCaptchaField(el) {
    const hay = [
      el.id, el.name, el.getAttribute('placeholder'),
      el.getAttribute('aria-label'), el.className,
    ].join(' ').toLowerCase();
    if (CAPTCHA_HINTS.some(h => hay.includes(h))) return true;

    // a CAPTCHA image sitting near the field is a strong signal
    const scope = el.closest('form, div, section') || document.body;
    const img = scope.querySelector && scope.querySelector('img[src*="captcha"], img[alt*="captcha"], canvas');
    return !!img && CAPTCHA_HINTS.some(h => hay.includes(h.substring(0, 4)));
  }

  // ─── Recording storage (step derived from array length — no drift) ────────────
  function saveAction(action) {
    chrome.storage.local.get(['recordedActions'], (result) => {
      const actions = result.recordedActions || [];
      actions.push({ ...action, step: actions.length + 1 });
      chrome.storage.local.set({ recordedActions: actions });
    });
  }

  function recordNavigateIfNew() {
    const url = location.href;
    chrome.storage.local.get(['lastRecordedUrl'], ({ lastRecordedUrl }) => {
      if (lastRecordedUrl && lastRecordedUrl !== url) {
        saveAction({ type: 'navigate', url, description: 'برو به ' + url });
      }
      chrome.storage.local.set({ lastRecordedUrl: url });
    });
  }

  // ─── Event handlers ───────────────────────────────────────────────────────────
  function handleClick(e) {
    if (!isRecording) return;
    if (e.target.id === '__rec_indicator__') return;

    const el = getClickable(e.target);
    const tag = el.tagName.toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return; // typing handled by blur

    saveAction({
      type: 'click',
      xpath: getXPath(el),
      description: getElementDescription(el),
      tag,
    });
  }

  function isEditableEl(el) {
    const tag = el.tagName.toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return true;
    if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') return true;
    let p = el.parentElement;
    for (let i = 0; i < 3 && p && p !== document.body; i++) {
      const ce = p.getAttribute('contenteditable');
      if (ce === 'true' || ce === '') return true;
      p = p.parentElement;
    }
    return false;
  }

  function getContentEditableRoot(el) {
    let node = el;
    while (node && node !== document.body) {
      if (node.getAttribute('contenteditable') === 'true' || node.getAttribute('contenteditable') === '') {
        return node;
      }
      node = node.parentElement;
    }
    return el;
  }

  function handleBlur(e) {
    if (!isRecording) return;
    const el = e.target;
    const tag = el.tagName.toLowerCase();
    if (el.type === 'submit' || el.type === 'button') return;
    if (!isEditableEl(el)) return;

    const isStandardInput = ['input', 'textarea', 'select'].includes(tag);
    const targetEl = isStandardInput ? el : getContentEditableRoot(el);

    // CAPTCHA: never store the typed code (it changes every load). Mark manual.
    if (isStandardInput && isCaptchaField(el)) {
      saveAction({
        type: 'manual',
        xpath: getXPath(el),
        value: '{ASK}',
        captcha: true,
        description: 'کد امنیتی (ورود دستی هنگام اجرا)',
      });
      return;
    }

    const value = isStandardInput
      ? (el.value || '')
      : (targetEl.innerText?.trim() || targetEl.textContent?.trim() || '');
    if (!value) return;

    saveAction({
      type: 'input',
      xpath: getXPath(targetEl),
      value,
      tag: targetEl.tagName.toLowerCase(),
      isContentEditable: !isStandardInput,
      description: getElementDescription(targetEl),
    });
  }

  function handleKeydown(e) {
    if (!isRecording) return;
    const triggerKeys = ['Enter', 'Tab', 'Escape', 'F1', 'F2', 'F5'];
    if (!triggerKeys.includes(e.key)) return;
    saveAction({
      type: 'keyboard',
      xpath: getXPath(e.target),
      key: e.key,
      description: `Press ${e.key}`,
    });
  }

  // ─── Recording lifecycle ──────────────────────────────────────────────────────
  function attachListeners() {
    if (listenersAttached) return;
    document.addEventListener('click', handleClick, true);
    document.addEventListener('blur', handleBlur, true);
    document.addEventListener('keydown', handleKeydown, true);
    listenersAttached = true;
  }

  function detachListeners() {
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('blur', handleBlur, true);
    document.removeEventListener('keydown', handleKeydown, true);
    listenersAttached = false;
  }

  function showIndicator() {
    if (document.getElementById('__rec_indicator__')) return;
    const ind = document.createElement('div');
    ind.id = '__rec_indicator__';
    ind.style.cssText = [
      'position:fixed', 'top:12px', 'right:12px', 'background:#e53935',
      'color:#fff', 'padding:6px 14px', 'border-radius:20px', 'z-index:2147483647',
      'font:bold 13px sans-serif', 'box-shadow:0 2px 8px rgba(0,0,0,.4)', 'pointer-events:none',
    ].join(';');
    ind.textContent = '⏺ REC';
    document.body.appendChild(ind);
  }

  function hideIndicator() {
    const ind = document.getElementById('__rec_indicator__');
    if (ind) ind.remove();
  }

  function beginRecording({ fresh }) {
    isRecording = true;
    attachListeners();
    showIndicator();
    if (fresh) {
      chrome.storage.local.set({ recordedActions: [], lastRecordedUrl: location.href });
    } else {
      recordNavigateIfNew(); // resumed after a navigation → log the new page
    }
  }

  function endRecording() {
    isRecording = false;
    detachListeners();
    hideIndicator();
  }

  // Resume automatically if this page loaded while a recording is active and
  // this is the tab the user started recording in.
  chrome.storage.local.get(['isRecording'], ({ isRecording: rec }) => {
    if (!rec) return;
    chrome.runtime.sendMessage({ action: 'isRecordingTab' }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.yes) beginRecording({ fresh: false });
    });
  });

  // ─── Page snapshot for AI mode ────────────────────────────────────────────────
  function getSimplifiedHTML() {
    const interesting = document.querySelectorAll(
      'form, input, textarea, select, button, a[href], label, h1, h2, h3, [role="button"], [role="textbox"]'
    );
    const parts = [`<!-- URL: ${window.location.href} -->`];
    interesting.forEach(el => {
      const clone = el.cloneNode(false);
      if (['button', 'a', 'label', 'h1', 'h2', 'h3'].includes(el.tagName.toLowerCase())) {
        clone.textContent = el.innerText?.trim().substring(0, 80) || '';
      }
      parts.push(clone.outerHTML);
    });
    return parts.join('\n').substring(0, 12000);
  }

  function dumpStorage(store) {
    const out = {};
    try {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        out[k] = store.getItem(k);
      }
    } catch (_) { /* storage may be blocked */ }
    return out;
  }

  // ─── Messages ───────────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'startRecording') {
      beginRecording({ fresh: true });
      sendResponse({ ok: true });
    } else if (msg.action === 'stopRecording') {
      endRecording();
      sendResponse({ ok: true });
    } else if (msg.action === 'getStorage') {
      sendResponse({
        origin: location.origin,
        local: dumpStorage(window.localStorage),
        session: dumpStorage(window.sessionStorage),
      });
    } else if (msg.action === 'getPageInfo') {
      sendResponse({ html: getSimplifiedHTML(), url: location.href, title: document.title });
    } else if (msg.action === 'ping') {
      sendResponse({ ok: true });
    }
    return true;
  });
}
