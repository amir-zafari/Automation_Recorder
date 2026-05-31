// ─── State ───────────────────────────────────────────────────────────────────
let isRecording = false;
let capturedCookies = [];
let capturedUrl = '';
let aiPlanActions = null; // actions parsed from AI response

// ─── Tab switching ────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ─── Init: get current tab URL ────────────────────────────────────────────────
chrome.runtime.sendMessage({ action: 'getTabInfo' }, (res) => {
  if (res?.url) {
    capturedUrl = res.url;
    document.getElementById('currentUrl').textContent = res.url;
    document.getElementById('headerUrl').textContent = res.url;
  }
});

// Poll for recorded actions when recording
let pollInterval = null;

function startPolling() {
  pollInterval = setInterval(refreshActionsList, 600);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

// ─── Get Cookies ─────────────────────────────────────────────────────────────
document.getElementById('getCookiesBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'getCookies' }, (res) => {
    capturedCookies = res?.cookies || [];
    capturedUrl = res?.url || capturedUrl;
    const el = document.getElementById('cookieStatus');
    const sc = res?.storageCount || 0;
    if (capturedCookies.length > 0 || sc > 0) {
      el.innerHTML = `<span class="cookies-count">✓ ${capturedCookies.length} کوکی + ${sc} سشن</span>`;
    } else {
      el.textContent = 'کوکی پیدا نشد';
    }
  });
});

// ─── Start Recording ──────────────────────────────────────────────────────────
document.getElementById('startRecBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'startRecording' }, (res) => {
    if (res?.ok) {
      isRecording = true;
      document.getElementById('startRecBtn').disabled = true;
      document.getElementById('stopRecBtn').disabled = false;
      showStatus('recStatus', '⏺ در حال ضبط... روی عناصر صفحه کلیک کنید', 'info');
      startPolling();
    } else {
      showStatus('recStatus', '❌ خطا: ' + (res?.error || 'نامشخص'), 'err');
    }
  });
});

// ─── Stop Recording ───────────────────────────────────────────────────────────
document.getElementById('stopRecBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'stopRecording' }, (res) => {
    isRecording = false;
    stopPolling();
    document.getElementById('startRecBtn').disabled = false;
    document.getElementById('stopRecBtn').disabled = true;
    refreshActionsList();
    const c = res?.cookies || 0, s = res?.storageCount || 0;
    showStatus('recStatus', `✓ ضبط متوقف شد — ${c} کوکی و ${s} آیتم سشن ذخیره شد`, 'ok');
  });
});

// ─── Clear Actions ────────────────────────────────────────────────────────────
document.getElementById('clearActionsBtn').addEventListener('click', () => {
  chrome.storage.local.set({ recordedActions: [] }, () => {
    refreshActionsList();
    showStatus('recStatus', '🗑 اکشن‌ها پاک شدند', 'info');
  });
});

// ─── Custom select (prevents Chrome extension popup from closing) ─────────────
// Native <select> opens an OS-level dropdown that steals focus from the popup
// window, causing Chrome to immediately close it. This custom version stays
// entirely within the DOM so no focus is ever lost.
//
// options  : [[value, label], ...]
// current  : currently selected value
// onChange : called with the new value when user picks an option
// width    : CSS width for the trigger button (default '68px')
function mkCustomSelect(options, current, onChange, width = '68px') {
  const wrap = document.createElement('div');
  wrap.className = 'cs-wrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cs-btn';
  btn.style.width = width;

  const lbl = document.createElement('span');
  lbl.className = 'cs-lbl';
  lbl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;';
  const initLabel = (options.find(([v]) => v === current) || options[0] || [])[1] || current;
  lbl.textContent = initLabel;

  const arr = document.createElement('span');
  arr.className = 'cs-arr';
  arr.textContent = '▾';

  btn.appendChild(lbl);
  btn.appendChild(arr);

  const menu = document.createElement('div');
  menu.className = 'cs-menu';

  const close = () => menu.classList.remove('open');

  options.forEach(([value, label]) => {
    const opt = document.createElement('div');
    opt.className = 'cs-opt' + (value === current ? ' cs-selected' : '');
    opt.textContent = label;

    opt.addEventListener('mousedown', (e) => {
      e.preventDefault();           // ← key: keeps popup focused
      e.stopPropagation();
      menu.querySelectorAll('.cs-opt').forEach(o => o.classList.remove('cs-selected'));
      opt.classList.add('cs-selected');
      lbl.textContent = label;
      close();
      onChange(value);
    });
    menu.appendChild(opt);
  });

  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();             // ← key: keeps popup focused
    e.stopPropagation();
    const wasOpen = menu.classList.contains('open');
    // Close any other open menus first
    document.querySelectorAll('.cs-menu.open').forEach(m => m.classList.remove('open'));
    if (!wasOpen) menu.classList.add('open');
  });

  // Click outside → close
  document.addEventListener('mousedown', (e) => {
    if (!wrap.contains(e.target)) close();
  }, true);

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  return wrap;
}

// ─── Action type meta ────────────────────────────────────────────────────────
const ACTION_TYPES  = ['click','input','keyboard','wait','navigate','manual','view','condition'];
const ACTION_LABELS = {
  click:'کلیک', input:'تایپ', keyboard:'کلید', wait:'انتظار',
  navigate:'برو', manual:'دستی', view:'ویو', condition:'شرط',
};
const CONDITION_OPS = [
  ['==','برابر است با'], ['!=','برابر نیست با'],
  ['contains','شامل'], ['not_contains','شامل نیست'],
  ['starts_with','شروع با'], ['ends_with','پایان با'],
  ['>','بزرگتر از'], ['<','کوچکتر از'], ['>=','≥'], ['<=','≤'],
];

// ─── Refresh actions list from storage ───────────────────────────────────────
function refreshActionsList() {
  chrome.storage.local.get(['recordedActions'], (result) => {
    const actions = result.recordedActions || [];
    document.getElementById('actionsCount').textContent = actions.length;
    const list = document.getElementById('actionsList');
    const mainSave = (updated) =>
      chrome.storage.local.set({ recordedActions: updated }, refreshActionsList);
    renderActionsInto(list, actions, mainSave, 0);
  });
}

// ─── Core recursive renderer ──────────────────────────────────────────────────
// save(updatedArray) persists changes; nestLevel controls indent/styling.
function renderActionsInto(container, actions, save, nestLevel) {
  container.innerHTML = '';

  if (!actions.length) {
    if (nestLevel === 0)
      container.innerHTML = '<div style="padding:20px;text-align:center;color:#555;">هنوز اکشنی ضبط نشده</div>';
    container.appendChild(mkInsBtn(0, actions, save));
    return;
  }

  container.appendChild(mkInsBtn(0, actions, save));

  actions.forEach((action, idx) => {
    container.appendChild(mkActionRow(action, idx, actions, save, nestLevel));

    // condition: render then/else sub-lists right below the row
    if (action.type === 'condition')
      container.appendChild(mkCondBlocks(action, idx, actions, save, nestLevel));

    container.appendChild(mkInsBtn(idx + 1, actions, save));
  });
}

// ─── Action row ───────────────────────────────────────────────────────────────
function mkActionRow(action, idx, actions, save, nestLevel) {
  const item = document.createElement('div');
  item.className = nestLevel > 0 ? 'action-item action-item-nested' : 'action-item';

  // ↑↓ move
  const moveWrap = document.createElement('div');
  moveWrap.style.cssText = 'display:flex;flex-direction:column;gap:1px;flex-shrink:0;';
  const mkMv = (txt, dir) => {
    const b = document.createElement('button');
    b.className = 'move-btn';
    b.textContent = txt;
    b.disabled = dir < 0 ? idx === 0 : idx === actions.length - 1;
    b.title = dir < 0 ? 'بالاتر' : 'پایین‌تر';
    b.addEventListener('click', () => {
      const t = idx + dir;
      if (t < 0 || t >= actions.length) return;
      const a = [...actions];
      [a[idx], a[t]] = [a[t], a[idx]];
      save(a);
    });
    return b;
  };
  moveWrap.appendChild(mkMv('▲', -1));
  moveWrap.appendChild(mkMv('▼',  1));
  item.appendChild(moveWrap);

  // type selector — custom (native <select> closes Chrome popup)
  const tSel = mkCustomSelect(
    ACTION_TYPES.map(t => [t, ACTION_LABELS[t] || t]),
    action.type,
    (newType) => { const a = [...actions]; a[idx] = applyTypeChange(a[idx], newType); save(a); }
  );
  item.appendChild(tSel);

  // description + value (condition uses its own layout)
  if (action.type === 'condition') {
    item.appendChild(mkCondHeader(action, idx, actions, save));
  } else {
    const desc = document.createElement('input');
    desc.className = 'action-desc-input';
    desc.value = action.description || action.url || '';
    desc.placeholder = 'توضیح';
    desc.title = action.xpath || '';
    desc.addEventListener('change', () => {
      const a = [...actions];
      a[idx] = { ...a[idx], description: desc.value };
      save(a);
    });
    item.appendChild(desc);

    const val = mkValueArea(action, idx, actions, save);
    if (val) item.appendChild(val);
  }

  // delete
  const del = document.createElement('button');
  del.className = 'del-btn';
  del.textContent = '×';
  del.title = 'حذف';
  del.addEventListener('click', () => save(actions.filter((_, i) => i !== idx)));
  item.appendChild(del);

  return item;
}

// ─── Value widget per type ────────────────────────────────────────────────────
function mkValueArea(action, idx, actions, save) {
  const upd = (field, val) => {
    const a = [...actions];
    a[idx] = { ...a[idx], [field]: val };
    save(a);
  };
  const inp = (field, placeholder, style) => {
    const el = document.createElement('input');
    el.className = 'action-value-input';
    el.value = action[field] || '';
    el.placeholder = placeholder;
    if (style) Object.assign(el.style, style);
    el.addEventListener('change', () => upd(field, el.value));
    return el;
  };

  const t = action.type;
  if (t === 'wait') {
    const el = document.createElement('input');
    el.type = 'number'; el.className = 'action-value-input';
    el.min = '0.1'; el.step = '0.5';
    el.value = action.seconds != null ? action.seconds : 1;
    el.title = 'ثانیه'; el.style.width = '58px';
    el.addEventListener('change', () => upd('seconds', parseFloat(el.value) || 1));
    return el;
  }
  if (t === 'navigate') return inp('url', 'https://...', { width: '110px' });
  if (t === 'keyboard') {
    const el = inp('key', 'Enter', { width: '72px' });
    el.value = action.key || 'Enter';
    el.title = 'Enter | Tab | Escape | F1…';
    return el;
  }
  if (t === 'input' || t === 'click')
    return inp('value', t === 'click' ? 'متن (اختیاری)' : '{1} یا متن');
  if (t === 'view') {
    const el = inp('variable', '{view1}', { width: '82px' });
    el.value = action.variable || '{view1}';
    el.title = 'نام متغیر — در شرط‌ها استفاده می‌شود';
    return el;
  }
  if (t === 'manual') {
    const chip = document.createElement('span');
    chip.style.cssText = 'background:#e67e2233;color:#e67e22;padding:2px 8px;border-radius:4px;font-size:10px;white-space:nowrap;flex-shrink:0;';
    chip.textContent = action.captcha ? 'کپچا' : '{ASK}';
    return chip;
  }
  return null;
}

// ─── Condition header (inline if/op/value row) ────────────────────────────────
function mkCondHeader(action, idx, actions, save) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:3px;flex:1;min-width:0;flex-wrap:wrap;';

  const lbl = document.createElement('span');
  lbl.style.cssText = 'color:#f9ca24;font-size:10px;white-space:nowrap;flex-shrink:0;';
  lbl.textContent = 'اگر:';
  wrap.appendChild(lbl);

  const mkCI = (field, ph, w) => {
    const el = document.createElement('input');
    el.className = 'action-value-input';
    el.style.width = w; el.value = action[field] || ''; el.placeholder = ph;
    el.addEventListener('change', () => {
      const a = [...actions]; a[idx] = { ...a[idx], [field]: el.value }; save(a);
    });
    return el;
  };

  wrap.appendChild(mkCI('left', '{view1}', '68px'));

  const opSel = mkCustomSelect(
    CONDITION_OPS,
    action.operator || '==',
    (newOp) => { const a = [...actions]; a[idx] = { ...a[idx], operator: newOp }; save(a); },
    '100px'
  );
  wrap.appendChild(opSel);

  wrap.appendChild(mkCI('right', 'مقدار', '68px'));
  return wrap;
}

// ─── Condition then/else expandable sub-lists ─────────────────────────────────
function mkCondBlocks(action, idx, actions, save, nestLevel) {
  const outer = document.createElement('div');
  outer.className = 'cond-blocks';

  ['then', 'else'].forEach(branch => {
    const isElse   = branch === 'else';
    const color    = isElse ? '#e94560' : '#2ecc71';
    const labelTxt = isElse ? 'وگرنه' : 'آنگاه';

    const block = document.createElement('div');
    block.className = 'cond-branch';

    const subActs = action[branch] || [];

    const toggle = document.createElement('button');
    toggle.className = 'expand-btn';
    toggle.style.color = color;
    toggle.style.borderColor = color + '55';

    const subWrap = document.createElement('div');
    subWrap.className = 'cond-sub';
    subWrap.style.display = 'none';

    const makeSave = () => (updatedSub) => {
      const a = [...actions];
      a[idx] = { ...a[idx], [branch]: updatedSub };
      save(a);                                  // persists to storage & re-renders parent
    };

    const refreshToggleLabel = (count) => {
      const open = subWrap.style.display !== 'none';
      toggle.textContent = `${open ? '▼' : '▶'} ${labelTxt} (${count} اکشن)`;
    };

    // Initial render
    renderActionsInto(subWrap, subActs, makeSave(), nestLevel + 1);
    refreshToggleLabel(subActs.length);

    toggle.addEventListener('click', () => {
      const nowOpen = subWrap.style.display !== 'none';
      subWrap.style.display = nowOpen ? 'none' : 'block';
      // count current sub-actions from saved data
      chrome.storage.local.get(['recordedActions'], (r) => {
        const root = r.recordedActions || [];
        const cur  = (root[idx] || {})[branch] || [];
        refreshToggleLabel(cur.length);
      });
    });

    block.appendChild(toggle);
    block.appendChild(subWrap);
    outer.appendChild(block);
  });

  return outer;
}

// ─── Insert button ────────────────────────────────────────────────────────────
function mkInsBtn(atIdx, actions, save) {
  const row = document.createElement('div');
  row.className = 'insert-row';
  const btn = document.createElement('button');
  btn.className = 'insert-btn';
  btn.textContent = '+ اکشن جدید';
  btn.addEventListener('click', () => {
    const a = [...actions];
    a.splice(atIdx, 0, { type: 'wait', seconds: 1, description: 'انتظار' });
    save(a);
  });
  row.appendChild(btn);
  return row;
}

// ─── Type change defaults ─────────────────────────────────────────────────────
function applyTypeChange(old, newType) {
  const u = { type: newType, xpath: old.xpath || '', description: old.description || '' };
  if (newType === 'wait')      u.seconds  = old.seconds  || 1;
  if (newType === 'keyboard')  u.key      = old.key      || 'Enter';
  if (newType === 'navigate')  u.url      = old.url      || '';
  if (newType === 'input' || newType === 'click') u.value = old.value || '';
  if (newType === 'manual')    u.value    = '{ASK}';
  if (newType === 'view')      u.variable = old.variable || '{view1}';
  if (newType === 'condition') {
    u.left = old.left || ''; u.operator = old.operator || '=='; u.right = old.right || '';
    u.then = old.then || []; u.else = old.else || [];
  }
  return u;
}

// ─── Export JSON (Record mode) ────────────────────────────────────────────────
document.getElementById('exportBtn').addEventListener('click', () => {
  chrome.storage.local.get(['recordedActions'], async (result) => {
    const actions = result.recordedActions || [];
    if (actions.length === 0) {
      showStatus('recStatus', '⚠ هیچ اکشنی برای خروجی وجود ندارد', 'err');
      return;
    }
    await exportRecipe(actions);
    showStatus('recStatus', '💾 فایل automation_recipe.json ساخته شد', 'ok');
  });
});

// ─── Preview ──────────────────────────────────────────────────────────────────
document.getElementById('previewBtn').addEventListener('click', () => {
  chrome.storage.local.get(['recordedActions'], async (result) => {
    const actions = result.recordedActions || [];
    const session = await fetchSession();
    const cookies = session.cookies?.length ? session.cookies : capturedCookies;
    const recipe = buildRecipe(capturedUrl || session.startUrl || session.url || '', cookies, session.storage || [], actions, session.stages);
    const win = window.open('', '_blank', 'width=700,height=600');
    win.document.write(`<pre style="background:#1a1a2e;color:#e0e0e0;padding:20px;font-size:12px;white-space:pre-wrap;word-break:break-all;">${JSON.stringify(recipe, null, 2)}</pre>`);
  });
});

// ─── AI Tab ───────────────────────────────────────────────────────────────────
document.getElementById('aiAnalyzeBtn').addEventListener('click', async () => {
  const userRequest = document.getElementById('aiRequest').value.trim();
  if (!userRequest) {
    showStatus('aiStatus', '⚠ لطفاً درخواست خود را بنویسید', 'err');
    return;
  }

  const btn = document.getElementById('aiAnalyzeBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> در حال آنالیز...';
  showStatus('aiStatus', 'صفحه را دریافت می‌کنم...', 'info');
  document.getElementById('aiExportSection').style.display = 'none';
  document.getElementById('aiResponse').style.display = 'none';

  // Step 1: get page info
  chrome.runtime.sendMessage({ action: 'getPageInfo' }, (pageInfo) => {
    if (!pageInfo?.html) {
      showStatus('aiStatus', '❌ نتوانستم صفحه را بخوانم. مطمئن شوید اسکریپت بارگذاری شده.', 'err');
      btn.disabled = false;
      btn.textContent = '🔍 آنالیز صفحه + تولید برنامه';
      return;
    }

    showStatus('aiStatus', 'در حال ارسال به Ollama...', 'info');

    // Step 2: send to AI
    chrome.runtime.sendMessage({
      action: 'aiPlan',
      url: pageInfo.url,
      title: pageInfo.title,
      html: pageInfo.html,
      userRequest
    }, (res) => {
      btn.disabled = false;
      btn.textContent = '🔍 آنالیز صفحه + تولید برنامه';

      if (!res?.success) {
        showStatus('aiStatus', '❌ خطا از Ollama: ' + (res?.error || 'نامشخص'), 'err');
        return;
      }

      // Try to parse JSON from response
      const parsed = tryParseActions(res.response);
      const responseEl = document.getElementById('aiResponse');
      responseEl.style.display = 'block';

      if (parsed) {
        aiPlanActions = parsed.actions || [];
        const varList = parsed.variables?.join(', ') || '—';
        responseEl.textContent =
          `✓ برنامه تولید شد:\n` +
          `${aiPlanActions.length} اکشن | متغیرها: ${varList}\n\n` +
          (parsed.explanation ? `توضیح: ${parsed.explanation}\n\n` : '') +
          `--- اکشن‌ها ---\n` +
          aiPlanActions.map((a, i) =>
            `${i + 1}. [${a.type}] ${a.description || ''} ${a.value ? '→ ' + a.value : ''}`
          ).join('\n');
        showStatus('aiStatus', `✓ ${aiPlanActions.length} اکشن تولید شد`, 'ok');
        document.getElementById('aiExportSection').style.display = 'flex';
      } else {
        // Show raw response
        aiPlanActions = null;
        responseEl.textContent = res.response;
        showStatus('aiStatus', '⚠ پاسخ JSON نبود — متن خام نمایش داده شد', 'err');
      }
    });
  });
});

document.getElementById('aiExportBtn').addEventListener('click', async () => {
  if (!aiPlanActions) return;
  await exportRecipe(aiPlanActions);
  showStatus('aiStatus', '💾 فایل automation_recipe.json ساخته شد', 'ok');
});

// ─── Chat Tab ─────────────────────────────────────────────────────────────────
document.getElementById('chatSendBtn').addEventListener('click', sendChat);
document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

function sendChat() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  addChatMsg('کاربر', text, '#3498db');
  input.value = '';

  chrome.runtime.sendMessage({ action: 'chat', text }, (res) => {
    if (res?.success) {
      addChatMsg('AI', res.response, '#2ecc71');
    } else {
      addChatMsg('خطا', res?.error || 'نامشخص', '#e94560');
    }
  });
}

function addChatMsg(sender, text, color) {
  const history = document.getElementById('chatHistory');
  const msg = document.createElement('div');
  msg.style.cssText = 'margin-bottom:10px;';
  msg.innerHTML = `<span style="color:${color};font-weight:bold;">${sender}:</span> <span style="color:#ccc;">${text}</span>`;
  history.appendChild(msg);
  history.scrollTop = history.scrollHeight;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showStatus(id, msg, type) {
  const el = document.getElementById(id);
  el.className = 'status ' + type;
  el.textContent = msg;
  if (type === 'ok' || type === 'info') {
    setTimeout(() => { el.className = 'status'; }, 4000);
  }
}

function tryParseActions(text) {
  // Try direct parse
  try { return JSON.parse(text); } catch (_) {}
  // Try extracting JSON object from text
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (_) {}
  }
  return null;
}

function fetchSession() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'getSessionData' }, (res) => resolve(res || {}));
  });
}

function buildRecipe(url, cookies, storage, actions, stages) {
  const vars = new Set();
  actions.forEach(a => {
    if (a.value) {
      const found = a.value.match(/\{\d+\}/g); // only {1},{2}... — {ASK} is excluded
      if (found) found.forEach(v => vars.add(v));
    }
  });

  return {
    version: '1.2',
    generated_at: new Date().toISOString(),
    url,
    cookies: (cookies || []).map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      secure: c.secure || false,
      httpOnly: c.httpOnly || false,
      ...(c.expirationDate ? { expiry: Math.round(c.expirationDate) } : {})
    })),
    storage: storage || [],
    stages: (stages || []).map(s => ({
      index: s.index,
      name: s.name,
      url: s.url,
      action_index: s.action_index,
      cookies: (s.cookies || []).map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        secure: c.secure || false,
        httpOnly: c.httpOnly || false,
        ...(c.expirationDate ? { expiry: Math.round(c.expirationDate) } : {})
      })),
      storage: s.storage || [],
    })),
    actions: actions.map((a, i) => ({ ...a, step: i + 1 })), // renumber (fixes gaps)
    variables: [...vars]
  };
}

async function exportRecipe(actions) {
  const session = await fetchSession();
  const cookies = session.cookies?.length ? session.cookies : capturedCookies;
  const storage = session.storage || [];
  const url = capturedUrl || session.startUrl || session.url || '';
  const recipe = buildRecipe(url, cookies, storage, actions, session.stages);

  const json = JSON.stringify(recipe, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = 'automation_recipe.json';
  a.click();
  URL.revokeObjectURL(blobUrl);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
refreshActionsList();

// Restore recording state if popup was closed and reopened mid-recording
chrome.storage.local.get(['isRecording'], ({ isRecording: rec }) => {
  if (rec) {
    isRecording = true;
    document.getElementById('startRecBtn').disabled = true;
    document.getElementById('stopRecBtn').disabled = false;
    showStatus('recStatus', '⏺ در حال ضبط... روی عناصر صفحه کلیک کنید', 'info');
    startPolling();
  }
});
