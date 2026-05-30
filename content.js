// Web Automation Recorder - Content Script

let isRecording = false;
let stepCounter = 0;

function getXPath(el) {
  if (!el || el === document.body) return '//body';

  // Prefer ID-based xpath (most stable)
  if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
    return `//*[@id="${el.id}"]`;
  }

  const parts = [];
  let node = el;

  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
    const tag = node.tagName.toLowerCase();
    let part = tag;

    // Prefer name attribute for inputs
    if (node.name) {
      part = `${tag}[@name="${node.name}"]`;
      parts.unshift(part);
      break;
    }

    // Count same-tag siblings to build positional xpath
    let idx = 1;
    let sib = node.previousElementSibling;
    while (sib) {
      if (sib.tagName === node.tagName) idx++;
      sib = sib.previousElementSibling;
    }

    part = idx > 1 ? `${tag}[${idx}]` : tag;
    parts.unshift(part);
    node = node.parentElement;
  }

  return '//' + parts.join('/');
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

function saveAction(action) {
  chrome.storage.local.get(['recordedActions'], (result) => {
    const actions = result.recordedActions || [];
    actions.push({ ...action, step: ++stepCounter });
    chrome.storage.local.set({ recordedActions: actions });
  });
}

function handleClick(e) {
  if (!isRecording) return;
  const el = e.target;
  const tag = el.tagName.toLowerCase();

  // Skip clicks on input/textarea/select - handled by blur
  if (['input', 'textarea', 'select'].includes(tag)) return;
  // Skip clicks on recorder indicator
  if (el.id === '__rec_indicator__') return;

  saveAction({
    type: 'click',
    xpath: getXPath(el),
    description: getElementDescription(el),
    tag
  });
}

function isEditableEl(el) {
  const tag = el.tagName.toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag)) return true;
  if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') return true;
  // بررسی parent ها تا سطح ۳ (مثل ChatGPT که <p> داخل div contenteditable هست)
  let p = el.parentElement;
  for (let i = 0; i < 3 && p && p !== document.body; i++) {
    const ce = p.getAttribute('contenteditable');
    if (ce === 'true' || ce === '') return true;
    p = p.parentElement;
  }
  return false;
}

function getContentEditableRoot(el) {
  // اگه روی <p> داخل contenteditable کلیک شده، root رو برگردون
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

  // برای contenteditable، root element رو پیدا کن
  const isStandardInput = ['input', 'textarea', 'select'].includes(tag);
  const targetEl = isStandardInput ? el : getContentEditableRoot(el);

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
    description: getElementDescription(targetEl)
  });
}

function handleKeydown(e) {
  if (!isRecording) return;
  const triggerKeys = ['Enter', 'Tab', 'Escape', 'F1', 'F2', 'F5'];
  if (!triggerKeys.includes(e.key)) return;

  const el = e.target;
  saveAction({
    type: 'keyboard',
    xpath: getXPath(el),
    key: e.key,
    description: `Press ${e.key}`
  });
}

function getSimplifiedHTML() {
  // Extract only interactive and structural elements for AI analysis
  const interesting = document.querySelectorAll(
    'form, input, textarea, select, button, a[href], label, h1, h2, h3, [role="button"], [role="textbox"]'
  );
  const parts = [`<!-- URL: ${window.location.href} -->`];
  interesting.forEach(el => {
    const clone = el.cloneNode(false);
    // Add text content for buttons/links/labels
    if (['button', 'a', 'label', 'h1', 'h2', 'h3'].includes(el.tagName.toLowerCase())) {
      clone.textContent = el.innerText?.trim().substring(0, 80) || '';
    }
    parts.push(clone.outerHTML);
  });
  return parts.join('\n').substring(0, 12000);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'startRecording') {
    isRecording = true;
    stepCounter = 0;
    chrome.storage.local.set({ recordedActions: [] });

    const ind = document.createElement('div');
    ind.id = '__rec_indicator__';
    ind.style.cssText = [
      'position:fixed', 'top:12px', 'right:12px', 'background:#e53935',
      'color:#fff', 'padding:6px 14px', 'border-radius:20px', 'z-index:2147483647',
      'font:bold 13px sans-serif', 'box-shadow:0 2px 8px rgba(0,0,0,.4)',
      'pointer-events:none'
    ].join(';');
    ind.textContent = '⏺ REC';
    document.body.appendChild(ind);

    document.addEventListener('click', handleClick, true);
    document.addEventListener('blur', handleBlur, true);
    document.addEventListener('keydown', handleKeydown, true);
    sendResponse({ ok: true });
  }

  if (msg.action === 'stopRecording') {
    isRecording = false;
    const ind = document.getElementById('__rec_indicator__');
    if (ind) ind.remove();

    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('blur', handleBlur, true);
    document.removeEventListener('keydown', handleKeydown, true);
    sendResponse({ ok: true });
  }

  if (msg.action === 'getPageInfo') {
    sendResponse({
      html: getSimplifiedHTML(),
      url: window.location.href,
      title: document.title
    });
  }

  return true;
});
