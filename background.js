const OLLAMA_URL = 'http://localhost:11434/api/generate';
const MODEL = 'aya-expanse:8b';

const AI_SYSTEM_PROMPT = `You are a web automation expert. Given a webpage's HTML structure and a user request, output ONLY a valid JSON object — no explanation, no markdown, no code block.

JSON structure:
{
  "actions": [
    {"type": "click",    "xpath": "...", "description": "..."},
    {"type": "input",    "xpath": "...", "value": "text or {1}", "description": "..."},
    {"type": "keyboard", "xpath": "...", "key": "Return|Tab|Escape", "description": "..."},
    {"type": "wait",     "seconds": 2,   "description": "..."}
  ],
  "variables": ["{1}", "{2}"],
  "explanation": "brief plan summary"
}

Rules:
- Use {1}, {2}, {3}... for dynamic values (from Excel) — user-specific data like names, emails, IDs
- Use literal text for fixed values that never change
- Generate valid XPaths for the given HTML
- Output ONLY the JSON object, nothing else`;

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

  // ─── Get cookies for current tab ────────────────────────────────────────────
  if (request.action === 'getCookies') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab) { sendResponse({ cookies: [] }); return; }

      const url = new URL(tab.url);
      chrome.cookies.getAll({ domain: url.hostname }, (cookies) => {
        sendResponse({ cookies, url: tab.url });
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

  // ─── Inject + start recording ───────────────────────────────────────────────
  if (request.action === 'startRecording') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        await chrome.tabs.sendMessage(tab.id, { action: 'startRecording' });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    });
    return true;
  }

  // ─── Stop recording ─────────────────────────────────────────────────────────
  if (request.action === 'stopRecording') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'stopRecording' });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    });
    return true;
  }

  // ─── Get page info for AI mode ──────────────────────────────────────────────
  if (request.action === 'getPageInfo') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
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
      body: JSON.stringify({ model: MODEL, prompt, stream: false })
    });
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    const data = await res.json();
    return { success: true, response: data.response || JSON.stringify(data) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
