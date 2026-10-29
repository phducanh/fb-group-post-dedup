(function () {
  'use strict';

  const DEFAULTS = {
    enabled: true,
    mode: 'collapse',
    threshold: 0.85,
    sameAuthorOnly: true,
    rememberSeen: true,
  };
  const SEEN_STORAGE_KEY = 'seenPosts';

  const fields = {
    enabled: document.getElementById('enabled'),
    sameAuthorOnly: document.getElementById('sameAuthorOnly'),
    rememberSeen: document.getElementById('rememberSeen'),
    mode: document.getElementById('mode'),
    threshold: document.getElementById('threshold'),
  };
  const thresholdValue = document.getElementById('thresholdValue');
  const statsNode = document.getElementById('stats');

  function formatThreshold(value) {
    return `${Math.round(Number(value) * 100)}%`;
  }

  function render(settings) {
    fields.enabled.checked = settings.enabled;
    fields.sameAuthorOnly.checked = settings.sameAuthorOnly;
    fields.rememberSeen.checked = settings.rememberSeen;
    fields.mode.value = settings.mode;
    fields.threshold.value = settings.threshold;
    thresholdValue.textContent = formatThreshold(settings.threshold);
  }

  function save(partial) {
    chrome.storage.sync.set(partial);
  }

  function bindFields() {
    fields.enabled.addEventListener('change', () =>
      save({ enabled: fields.enabled.checked })
    );
    fields.sameAuthorOnly.addEventListener('change', () =>
      save({ sameAuthorOnly: fields.sameAuthorOnly.checked })
    );
    fields.rememberSeen.addEventListener('change', () =>
      save({ rememberSeen: fields.rememberSeen.checked })
    );
    fields.mode.addEventListener('change', () => save({ mode: fields.mode.value }));
    fields.threshold.addEventListener('input', () => {
      thresholdValue.textContent = formatThreshold(fields.threshold.value);
    });
    fields.threshold.addEventListener('change', () =>
      save({ threshold: Number(fields.threshold.value) })
    );
  }

  function showStats(stats) {
    statsNode.textContent = stats
      ? `Đã quét ${stats.scanned} bài, lọc ${stats.duplicates} bài trùng.`
      : 'Mở trang Facebook để xem thống kê.';
  }

  function loadStats() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || tab.id === undefined) return showStats(null);
      chrome.tabs.sendMessage(tab.id, { type: 'getStats' }, (stats) => {
        showStats(chrome.runtime.lastError ? null : stats);
      });
    });
  }

  function showReport(text) {
    const report = document.getElementById('report');
    report.hidden = false;
    report.value = text;
    report.select();
    navigator.clipboard.writeText(text).catch(() => {});
  }

  function runDiagnose() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || tab.id === undefined) return showReport('Không tìm thấy tab đang mở.');
      chrome.tabs.sendMessage(tab.id, { type: 'diagnose' }, (data) => {
        if (chrome.runtime.lastError || !data) {
          return showReport(
            'Content script chưa chạy trên tab này. Reload extension ở chrome://extensions rồi reload trang Facebook.'
          );
        }
        showReport(JSON.stringify(data, null, 2));
      });
    });
  }

  function clearSeen() {
    chrome.storage.local.remove(SEEN_STORAGE_KEY, () => {
      statsNode.textContent = 'Đã xóa dữ liệu đã nhớ. Reload trang Facebook để quét lại.';
    });
  }

  document.getElementById('diagnose').addEventListener('click', runDiagnose);
  document.getElementById('clearSeen').addEventListener('click', clearSeen);

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    render({ ...DEFAULTS, ...stored });
    bindFields();
    loadStats();
  });
})();
