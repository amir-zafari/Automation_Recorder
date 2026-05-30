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
    if (capturedCookies.length > 0) {
      el.innerHTML = `<span class="cookies-count">✓ ${capturedCookies.length} کوکی</span>`;
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
  chrome.runtime.sendMessage({ action: 'stopRecording' }, () => {
    isRecording = false;
    stopPolling();
    document.getElementById('startRecBtn').disabled = false;
    document.getElementById('stopRecBtn').disabled = true;
    refreshActionsList();
    showStatus('recStatus', '✓ ضبط متوقف شد', 'ok');
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

function renderActions(actions) {
  const list = document.getElementById('actionsList');

  if (actions.length === 0) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:#555;">هنوز اکشنی ضبط نشده</div>';
    return;
  }

  list.innerHTML = '';
  actions.forEach((action, idx) => {
    const item = document.createElement('div');
    item.className = 'action-item';

    const badge = document.createElement('span');
    badge.className = `action-badge badge-${action.type}`;
    badge.textContent = action.type === 'keyboard' ? '⌨ key' : action.type;

    const desc = document.createElement('span');
    desc.className = 'action-desc';
    desc.title = action.xpath || '';
    desc.textContent = action.description || action.xpath?.substring(0, 30) || '';

    item.appendChild(badge);
    item.appendChild(desc);

    // فیلد مقدار برای click و input — کاربر میتونه متن یا {1} وارد کنه
    if (action.type === 'input' || action.type === 'click') {
      const valInput = document.createElement('input');
      valInput.className = 'action-value-input';
      valInput.value = action.value || '';
      valInput.placeholder = action.type === 'click' ? 'متن تایپ (اختیاری)' : '{1} یا متن ثابت';
      valInput.title = 'اگر پر کنی، بعد از کلیک این متن تایپ میشه\n{1}، {2} = متغیر از اکسل';
      valInput.addEventListener('change', () => {
        updateActionValue(idx, valInput.value, action.type);
      });
      item.appendChild(valInput);
    } else if (action.type === 'keyboard') {
      const keySpan = document.createElement('span');
      keySpan.style.cssText = 'background:#9b59b633;color:#9b59b6;padding:2px 8px;border-radius:4px;font-size:10px;';
      keySpan.textContent = action.key;
      item.appendChild(keySpan);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.textContent = '×';
    delBtn.title = 'حذف';
    delBtn.addEventListener('click', () => deleteAction(idx));

    item.appendChild(delBtn);
    list.appendChild(item);
  });
}

function updateActionValue(idx, newValue, currentType) {
  chrome.storage.local.get(['recordedActions'], (result) => {
    const actions = result.recordedActions || [];
    if (actions[idx]) {
      actions[idx].value = newValue;
      // اگه روی یه click مقدار گذاشتن، نوعش رو عوض نکن — python خودش handle میکنه
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
  chrome.storage.local.get(['recordedActions'], (result) => {
    const actions = result.recordedActions || [];
    if (actions.length === 0) {
      showStatus('recStatus', '⚠ هیچ اکشنی برای خروجی وجود ندارد', 'err');
      return;
    }
    exportRecipe(capturedUrl, capturedCookies, actions);
  });
});

// ─── Preview ──────────────────────────────────────────────────────────────────
document.getElementById('previewBtn').addEventListener('click', () => {
  chrome.storage.local.get(['recordedActions'], (result) => {
    const actions = result.recordedActions || [];
    const recipe = buildRecipe(capturedUrl, capturedCookies, actions);
    const win = window.open('', '_blank', 'width=600,height=500');
    win.document.write(`<pre style="background:#1a1a2e;color:#e0e0e0;padding:20px;font-size:12px;">${JSON.stringify(recipe, null, 2)}</pre>`);
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

document.getElementById('aiExportBtn').addEventListener('click', () => {
  if (!aiPlanActions) return;
  exportRecipe(capturedUrl, capturedCookies, aiPlanActions);
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

function buildRecipe(url, cookies, actions) {
  const vars = new Set();
  actions.forEach(a => {
    if (a.value) {
      const found = a.value.match(/\{\d+\}/g);
      if (found) found.forEach(v => vars.add(v));
    }
  });

  return {
    version: '1.0',
    generated_at: new Date().toISOString(),
    url,
    cookies: cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      secure: c.secure || false,
      httpOnly: c.httpOnly || false,
      ...(c.expirationDate ? { expiry: Math.round(c.expirationDate) } : {})
    })),
    actions: actions.map((a, i) => ({ step: i + 1, ...a })),
    variables: [...vars]
  };
}

function exportRecipe(url, cookies, actions) {
  const recipe = buildRecipe(url, cookies, actions);
  const json = JSON.stringify(recipe, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = 'automation_recipe.json';
  a.click();
  URL.revokeObjectURL(blobUrl);
}

// Init
refreshActionsList();
