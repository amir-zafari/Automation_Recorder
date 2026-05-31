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

// ─── Refresh actions list from storage ───────────────────────────────────────
function refreshActionsList() {
  chrome.storage.local.get(['recordedActions'], (result) => {
    const actions = result.recordedActions || [];
    document.getElementById('actionsCount').textContent = actions.length;
    renderActions(actions);
  });
}

// ─── Action type meta ────────────────────────────────────────────────────────
const ACTION_TYPES   = ['click', 'input', 'keyboard', 'wait', 'navigate', 'manual'];
const ACTION_LABELS  = { click:'کلیک', input:'تایپ', keyboard:'کلید', wait:'انتظار', navigate:'برو', manual:'دستی' };

// ─── Render ───────────────────────────────────────────────────────────────────
function renderActions(actions) {
  const list = document.getElementById('actionsList');

  if (actions.length === 0) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:#555;">هنوز اکشنی ضبط نشده</div>';
    return;
  }

  list.innerHTML = '';
  list.appendChild(makeInsertBtn(0));

  actions.forEach((action, idx) => {
    const item = document.createElement('div');
    item.className = 'action-item';

    // ── Move ↑↓ ──
    const moveWrap = document.createElement('div');
    moveWrap.style.cssText = 'display:flex;flex-direction:column;gap:1px;flex-shrink:0;';
    const upBtn = document.createElement('button');
    upBtn.className = 'move-btn';
    upBtn.textContent = '▲';
    upBtn.disabled = idx === 0;
    upBtn.title = 'بالاتر';
    upBtn.addEventListener('click', () => moveAction(idx, -1));
    const dnBtn = document.createElement('button');
    dnBtn.className = 'move-btn';
    dnBtn.textContent = '▼';
    dnBtn.disabled = idx === actions.length - 1;
    dnBtn.title = 'پایین‌تر';
    dnBtn.addEventListener('click', () => moveAction(idx, 1));
    moveWrap.appendChild(upBtn);
    moveWrap.appendChild(dnBtn);
    item.appendChild(moveWrap);

    // ── Type selector ──
    const typeSelect = document.createElement('select');
    typeSelect.className = 'type-select';
    ACTION_TYPES.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = ACTION_LABELS[t] || t;
      if (t === action.type) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener('change', () => changeActionType(idx, typeSelect.value));
    item.appendChild(typeSelect);

    // ── Description (editable) ──
    const desc = document.createElement('input');
    desc.className = 'action-desc-input';
    desc.value = action.description || action.url || '';
    desc.placeholder = 'توضیح';
    desc.title = action.xpath || action.url || '';
    desc.addEventListener('change', () => updateActionField(idx, 'description', desc.value));
    item.appendChild(desc);

    // ── Value area (type-specific) ──
    const valNode = buildValueArea(action, idx);
    if (valNode) item.appendChild(valNode);

    // ── Delete ──
    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.textContent = '×';
    delBtn.title = 'حذف';
    delBtn.addEventListener('click', () => deleteAction(idx));
    item.appendChild(delBtn);

    list.appendChild(item);
    list.appendChild(makeInsertBtn(idx + 1));
  });
}

// Build the right input widget for each action type
function buildValueArea(action, idx) {
  const t = action.type;

  if (t === 'wait') {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'action-value-input';
    inp.style.width = '58px';
    inp.min = '0.1'; inp.step = '0.5';
    inp.value = action.seconds != null ? action.seconds : 1;
    inp.title = 'ثانیه';
    inp.addEventListener('change', () =>
      updateActionField(idx, 'seconds', parseFloat(inp.value) || 1));
    return inp;
  }

  if (t === 'navigate') {
    const inp = document.createElement('input');
    inp.className = 'action-value-input';
    inp.style.width = '110px';
    inp.value = action.url || '';
    inp.placeholder = 'https://...';
    inp.addEventListener('change', () => updateActionField(idx, 'url', inp.value));
    return inp;
  }

  if (t === 'keyboard') {
    const inp = document.createElement('input');
    inp.className = 'action-value-input';
    inp.style.width = '72px';
    inp.value = action.key || 'Enter';
    inp.placeholder = 'Enter';
    inp.title = 'کلید: Enter, Tab, Escape, …';
    inp.addEventListener('change', () => updateActionField(idx, 'key', inp.value));
    return inp;
  }

  if (t === 'input' || t === 'click') {
    const inp = document.createElement('input');
    inp.className = 'action-value-input';
    inp.value = action.value || '';
    inp.placeholder = t === 'click' ? 'متن (اختیاری)' : '{1} یا متن';
    inp.title = '{1},{2} = متغیر اکسل';
    inp.addEventListener('change', () => updateActionField(idx, 'value', inp.value));
    return inp;
  }

  if (t === 'manual') {
    const chip = document.createElement('span');
    chip.style.cssText = 'background:#e67e2233;color:#e67e22;padding:2px 8px;border-radius:4px;font-size:10px;white-space:nowrap;flex-shrink:0;';
    chip.textContent = action.captcha ? 'کپچا' : '{ASK}';
    return chip;
  }

  return null;
}

// Small "+" row inserted between action items
function makeInsertBtn(atIndex) {
  const row = document.createElement('div');
  row.className = 'insert-row';
  const btn = document.createElement('button');
  btn.className = 'insert-btn';
  btn.textContent = '+ اکشن جدید';
  btn.title = `اضافه کردن اکشن در موقعیت ${atIndex + 1}`;
  btn.addEventListener('click', () => insertAction(atIndex));
  row.appendChild(btn);
  return row;
}

// ─── Mutation helpers ─────────────────────────────────────────────────────────
function insertAction(atIndex) {
  chrome.storage.local.get(['recordedActions'], (result) => {
    const actions = result.recordedActions || [];
    actions.splice(atIndex, 0, {
      type: 'wait',
      seconds: 1,
      description: 'انتظار',
    });
    chrome.storage.local.set({ recordedActions: actions }, refreshActionsList);
  });
}

function moveAction(idx, dir) {
  chrome.storage.local.get(['recordedActions'], (result) => {
    const actions = result.recordedActions || [];
    const target = idx + dir;
    if (target < 0 || target >= actions.length) return;
    [actions[idx], actions[target]] = [actions[target], actions[idx]];
    chrome.storage.local.set({ recordedActions: actions }, refreshActionsList);
  });
}

function changeActionType(idx, newType) {
  chrome.storage.local.get(['recordedActions'], (result) => {
    const actions = result.recordedActions || [];
    if (!actions[idx]) return;
    const old = actions[idx];
    const updated = {
      type: newType,
      xpath: old.xpath || '',
      description: old.description || '',
    };
    if (newType === 'wait')     updated.seconds  = old.seconds  || 1;
    if (newType === 'keyboard') updated.key      = old.key      || 'Enter';
    if (newType === 'navigate') updated.url      = old.url      || '';
    if (newType === 'input' || newType === 'click') updated.value = old.value || '';
    if (newType === 'manual')   updated.value    = '{ASK}';
    actions[idx] = updated;
    chrome.storage.local.set({ recordedActions: actions }, refreshActionsList);
  });
}

function updateActionField(idx, field, value) {
  chrome.storage.local.get(['recordedActions'], (result) => {
    const actions = result.recordedActions || [];
    if (actions[idx]) {
      actions[idx][field] = value;
      chrome.storage.local.set({ recordedActions: actions });
    }
  });
}

function deleteAction(idx) {
  chrome.storage.local.get(['recordedActions'], (result) => {
    const actions = result.recordedActions || [];
    actions.splice(idx, 1);
    chrome.storage.local.set({ recordedActions: actions }, refreshActionsList);
  });
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
