const OLLAMA_URL = 'http://localhost:11434/api/generate';
const MODEL = 'aya-expanse:8b';

const AI_SYSTEM_PROMPT = `You are a web automation expert. Given a webpage's HTML structure and a user request, output ONLY a valid JSON object — no explanation, no markdown, no code block.

JSON structure:
{
  "actions": [
    {"type": "click",    "xpath": "...", "description": "..."},
    {"type": "input",    "xpath": "...", "value": "text or {1}", "description": "..."},
    {"type": "manual",   "xpath": "...", "value": "{ASK}", "captcha": true, "description": "captcha / code the human types at runtime"},
    {"type": "keyboard", "xpath": "...", "key": "Return|Tab|Escape", "description": "..."},
    {"type": "navigate", "url": "https://...", "description": "..."},
    {"type": "wait",     "seconds": 2,   "description": "..."}
  ],
  "variables": ["{1}", "{2}"],
  "explanation": "brief plan summary"
}

Rules:
- Use {1}, {2}, {3}... for dynamic values (from Excel) — user-specific data like names, emails, IDs.
- Use literal text for fixed values that never change.
- For CAPTCHA / security-code / human-verification fields use {"type":"manual","value":"{ASK}","captcha":true} — never invent a code.
- Prefer XPaths based on @id, @name or @aria-label. Click the real <button>/<a>, not an inner <svg>.
- Output ONLY the JSON object, nothing else.`;

// ─── Promisified storage helpers ────────────────────────────────────────────────
function getLocal(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }
function setLocal(obj)  { return new Promise(r => chrome.storage.local.set(obj, r)); }

function safeHost(url) {
  try { return new URL(url).hostname; } catch (_) { return ''; }
}

function stageName(url, index) {
  let seg = '';
  try {
    const p = new URL(url);
    seg = p.pathname.split('/').filter(Boolean).pop() || p.hostname;
  } catch (_) {}
  return `مرحله ${index + 1} — ${seg}`;
}

function dumpStorageSize(storage) {
  if (!storage) return 0;
  return Object.keys(storage.local || {}).length + Object.keys(storage.session || {}).length;
}

async function ensureContentScript(tabId) {
  // Manifest injects content.js on every page, but a tab opened before the
  // extension loaded won't have it — inject as a guard-safe fallback.
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (_) { /* restricted page (chrome://, web store) */ }
}

async function grabStorage(tabId) {
  try {
    await ensureContentScript(tabId);
    return await chrome.tabs.sendMessage(tabId, { action: 'getStorage' });
  } catch (_) { return null; }
}

// ─── Stage recording ─────────────────────────────────────────────────────────────
// A "stage" is one page in the recorded flow. Each stage stores the cookies +
// localStorage/sessionStorage that exist ON that page, so the runner can jump
// straight to (e.g.) the logged-in page without replaying the login.
async function recordStage(tabId, url, initial = false) {
  const { recordedActions = [], stages = [] } = await getLocal(['recordedActions', 'stages']);

  let actions = recordedActions;
  if (!initial) {
    // a navigation is a stage boundary — log it in the flat action list too
    actions = recordedActions.concat([{
      step: recordedActions.length + 1,
      type: 'navigate',
      url,
      description: 'برو به ' + url,
    }]);
  }

  const host = safeHost(url);
  const cookies = host ? await chrome.cookies.getAll({ domain: host }) : [];
  const storage = await grabStorage(tabId);

  const stage = {
    index: stages.length,
    name: stageName(url, stages.length),
    url,
    cookies,
    storage: storage ? [storage] : [],
    action_index: actions.length, // the next recorded action starts this stage
  };

  await setLocal({
    recordedActions: actions,
    stages: stages.concat([stage]),
    lastStageUrl: url,
    lastRecordedUrl: url,
  });
}

// Fires on every tab update. We only act on the tab being recorded, once the
// page has fully loaded (so cookies are set), and only for a new URL.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const { isRecording, recordingTabId, lastStageUrl } =
    await getLocal(['isRecording', 'recordingTabId', 'lastStageUrl']);
  if (!isRecording || tabId !== recordingTabId) return;
  const url = tab && tab.url;
  if (!url || !/^https?:/i.test(url) || url === lastStageUrl) return;
  await recordStage(tabId, url, false);
});

// ─── Messages ────────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'chat') {
    callOllama(request.text).then(sendResponse);
    return true;
  }

  if (request.action === 'aiPlan') {
    const prompt = `${AI_SYSTEM_PROMPT}

Current URL: ${request.url}
Page Title: ${request.title}

Page HTML (interactive elements):
${request.html}

User Request: ${request.userRequest}`;
    callOllama(prompt).then(sendResponse);
    return true;
  }

  if (request.action === 'isRecordingTab') {
    getLocal(['recordingTabId']).then(({ recordingTabId }) => {
      sendResponse({ yes: !!sender.tab && sender.tab.id === recordingTabId });
    });
    return true;
  }

  // Manual cookie+storage grab for the active tab (the "دریافت کوکی" button)
  if (request.action === 'getCookies') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab) { sendResponse({ cookies: [] }); return; }
      const host = safeHost(tab.url);
      const cookies = host ? await chrome.cookies.getAll({ domain: host }) : [];
      const storage = await grabStorage(tab.id);
      await setLocal({
        capturedCookies: cookies,
        capturedStorage: storage ? [storage] : [],
        capturedUrl: tab.url,
      });
      sendResponse({ cookies, url: tab.url, storageCount: dumpStorageSize(storage) });
    });
    return true;
  }

  // Everything the recipe needs: stages, fallback cookies/storage, start URL
  if (request.action === 'getSessionData') {
    getLocal(['capturedCookies', 'capturedStorage', 'capturedUrl', 'stages', 'recordingStartUrl'])
      .then((d) => sendResponse({
        cookies: d.capturedCookies || [],
        storage: d.capturedStorage || [],
        url: d.capturedUrl || '',
        stages: d.stages || [],
        startUrl: d.recordingStartUrl || '',
      }));
    return true;
  }

  if (request.action === 'getTabInfo') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      sendResponse({ url: tab?.url || '', title: tab?.title || '' });
    });
    return true;
  }

  if (request.action === 'startRecording') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      try {
        await setLocal({
          isRecording: true,
          // recordedActions intentionally NOT reset — user uses Clear button
          stages: [],
          recordingBranch: null,
          recordingTabId: tab.id,
          recordingStartUrl: tab.url,
          lastStageUrl: tab.url,
          lastRecordedUrl: tab.url,
        });
        await ensureContentScript(tab.id);
        await chrome.tabs.sendMessage(tab.id, { action: 'startRecording' });
        await recordStage(tab.id, tab.url, true); // stage 0 (start page)
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    });
    return true;
  }

  if (request.action === 'stopRecording') {
    getLocal(['recordingTabId', 'stages']).then(async ({ recordingTabId, stages = [] }) => {
      let storage = null, url = '';
      try {
        const tab = await chrome.tabs.get(recordingTabId);
        url = tab?.url || '';
        storage = await grabStorage(recordingTabId);
      } catch (_) {}

      const host = safeHost(url);
      const cookies = host ? await chrome.cookies.getAll({ domain: host }) : [];

      // Refresh the final stage with the freshest cookies/storage.
      if (stages.length) {
        stages[stages.length - 1].cookies = cookies;
        stages[stages.length - 1].storage = storage ? [storage] : [];
      }

      await setLocal({
        isRecording: false,
        recordingBranch: null,  // always clear branch target on stop
        capturedCookies: cookies,
        capturedStorage: storage ? [storage] : [],
        capturedUrl: url,
        stages,
      });
      try { await chrome.tabs.sendMessage(recordingTabId, { action: 'stopRecording' }); } catch (_) {}
      sendResponse({ ok: true, cookies: cookies.length, storageCount: dumpStorageSize(storage), stages: stages.length });
    });
    return true;
  }

  // Forward pick-mode activation to the content script of the active/recording tab
  if (request.action === 'activatePicker') {
    getLocal(['recordingTabId']).then(async ({ recordingTabId }) => {
      let tabId = recordingTabId;
      if (!tabId) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = tabs[0]?.id;
      }
      if (!tabId) { sendResponse({ ok: false }); return; }
      await ensureContentScript(tabId);
      try {
        await chrome.tabs.sendMessage(tabId, { action: 'startPicking', target: request.target });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    });
    return true;
  }

  if (request.action === 'getPageInfo') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      try {
        await ensureContentScript(tab.id);
        const results = await chrome.tabs.sendMessage(tab.id, { action: 'getPageInfo' });
        sendResponse(results);
      } catch (e) {
        sendResponse({ html: '', url: tab?.url || '', title: tab?.title || '', error: e.message });
      }
    });
    return true;
  }
});

async function callOllama(prompt) {
  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, stream: false }),
    });
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    const data = await res.json();
    return { success: true, response: data.response || JSON.stringify(data) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
