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

// ─── Helpers ───────────────────────────────────────────────────────────────────
function dumpStorageSize(storage) {
  if (!storage) return 0;
  return Object.keys(storage.local || {}).length + Object.keys(storage.session || {}).length;
}

async function ensureContentScript(tabId) {
  // Manifest already injects content.js on every page, but a tab opened before
  // the extension loaded won't have it — inject as a guard-safe fallback.
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (_) { /* restricted page (chrome://, web store) */ }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // ─── Simple chat ────────────────────────────────────────────────────────────
  if (request.action === 'chat') {
    callOllama(request.text).then(sendResponse);
    return true;
  }

  // ─── AI automation planning ─────────────────────────────────────────────────
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

  // ─── Is the asking content script in the tab we're recording? ───────────────
  if (request.action === 'isRecordingTab') {
    chrome.storage.local.get(['recordingTabId'], ({ recordingTabId }) => {
      sendResponse({ yes: !!sender.tab && sender.tab.id === recordingTabId });
    });
    return true;
  }

  // ─── Get cookies (and storage) for current tab ──────────────────────────────
  if (request.action === 'getCookies') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab) { sendResponse({ cookies: [] }); return; }
      const host = safeHost(tab.url);
      const cookies = host ? await chrome.cookies.getAll({ domain: host }) : [];
      let storage = null;
      try {
        await ensureContentScript(tab.id);
        storage = await chrome.tabs.sendMessage(tab.id, { action: 'getStorage' });
      } catch (_) { /* ignore */ }
      await chrome.storage.local.set({
        capturedCookies: cookies,
        capturedStorage: storage ? [storage] : [],
        capturedUrl: tab.url,
      });
      sendResponse({ cookies, url: tab.url, storageCount: dumpStorageSize(storage) });
    });
    return true;
  }

  // ─── Latest captured session for export ─────────────────────────────────────
  if (request.action === 'getSessionData') {
    chrome.storage.local.get(['capturedCookies', 'capturedStorage', 'capturedUrl'], (d) => {
      sendResponse({
        cookies: d.capturedCookies || [],
        storage: d.capturedStorage || [],
        url: d.capturedUrl || '',
      });
    });
    return true;
  }

  // ─── Get current tab URL ────────────────────────────────────────────────────
  if (request.action === 'getTabInfo') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      sendResponse({ url: tab?.url || '', title: tab?.title || '' });
    });
    return true;
  }

  // ─── Start recording ────────────────────────────────────────────────────────
  if (request.action === 'startRecording') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      try {
        await chrome.storage.local.set({
          isRecording: true,
          recordedActions: [],
          recordingTabId: tab.id,
          recordingStartUrl: tab.url,
          lastRecordedUrl: tab.url,
        });
        await ensureContentScript(tab.id);
        await chrome.tabs.sendMessage(tab.id, { action: 'startRecording' });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    });
    return true;
  }

  // ─── Stop recording (capture cookies + storage of the recording tab) ────────
  if (request.action === 'stopRecording') {
    chrome.storage.local.get(['recordingTabId'], async ({ recordingTabId }) => {
      let storage = null, url = '';
      try {
        const tab = await chrome.tabs.get(recordingTabId);
        url = tab?.url || '';
        storage = await chrome.tabs.sendMessage(recordingTabId, { action: 'getStorage' });
      } catch (_) { /* tab gone */ }

      const host = safeHost(url);
      const cookies = host ? await chrome.cookies.getAll({ domain: host }) : [];

      await chrome.storage.local.set({
        isRecording: false,
        capturedCookies: cookies,
        capturedStorage: storage ? [storage] : [],
        capturedUrl: url,
      });
      try { await chrome.tabs.sendMessage(recordingTabId, { action: 'stopRecording' }); } catch (_) {}
      sendResponse({ ok: true, cookies: cookies.length, storageCount: dumpStorageSize(storage) });
    });
    return true;
  }

  // ─── Get page info for AI mode ──────────────────────────────────────────────
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

function safeHost(url) {
  try { return new URL(url).hostname; } catch (_) { return ''; }
}

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
