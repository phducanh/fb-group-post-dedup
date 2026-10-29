'use strict';

// Service worker: mở tab nền để chặn qua trang cá nhân (khi menu comment không có mục
// "Chặn"), xác nhận đúng tab đó với profile-block.js, đóng tab và báo kết quả về tab gốc.
importScripts('core.js');

const { toProfileUrl } = globalThis.DedupCore;

const STORAGE_KEY = 'blockTabs';
const BLOCK_HASH = '#dedup-block';
const MAX_MESSAGE_LENGTH = 120;

async function readEntries() {
  const stored = await chrome.storage.session.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || {};
}

async function writeEntries(entries) {
  await chrome.storage.session.set({ [STORAGE_KEY]: entries });
}

async function removeEntry(tabId) {
  const { [tabId]: _removed, ...rest } = await readEntries();
  await writeEntries(rest);
}

async function startProfileBlock(message, sender) {
  const originTabId = sender.tab ? sender.tab.id : undefined;
  const rawUrl = String(message.url || '');
  const profileUrl = toProfileUrl(rawUrl, rawUrl);
  if (originTabId === undefined || !profileUrl) return { ok: false };

  const tab = await chrome.tabs.create({ url: `${profileUrl}${BLOCK_HASH}`, active: false });
  const entries = await readEntries();
  await writeEntries({
    ...entries,
    [tab.id]: { originTabId, requestId: String(message.requestId || '') },
  });
  return { ok: true };
}

// Chỉ tab do chính extension mở (có trong danh sách) mới được phép tự chặn. Đây là kiểm
// tra thật; #dedup-block trên URL chỉ là gợi ý để không đánh thức service worker.
async function profileBlockHello(sender) {
  if (!sender.tab) return { run: false };
  const entries = await readEntries();
  return { run: Boolean(entries[sender.tab.id]) };
}

async function profileBlockDone(message, sender) {
  if (!sender.tab) return { ok: false };
  const tabId = sender.tab.id;
  const entry = (await readEntries())[tabId];
  if (!entry) return { ok: false };

  await removeEntry(tabId);
  const ok = Boolean(message.ok);
  try {
    await chrome.tabs.sendMessage(entry.originTabId, {
      type: 'blockResult',
      requestId: entry.requestId,
      ok,
      message: String(message.message || '').slice(0, MAX_MESSAGE_LENGTH),
    });
  } catch (_error) {
    // Tab gốc đã đóng: không còn nơi để báo kết quả.
  }

  if (ok) await chrome.tabs.remove(tabId);
  else await chrome.tabs.update(tabId, { active: true });
  return { ok: true };
}

async function handleMessage(message, sender) {
  switch (message && message.type) {
    case 'startProfileBlock':
      return startProfileBlock(message, sender);
    case 'profileBlockHello':
      return profileBlockHello(sender);
    case 'profileBlockDone':
      return profileBlockDone(message, sender);
    default:
      return { ok: false };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => removeEntry(tabId));
