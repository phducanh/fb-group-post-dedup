(function () {
  'use strict';

  // Gợi ý để không đánh thức background trên mọi trang Facebook. Quyền chạy thật do
  // background quyết định (chỉ tab do extension mở mới được).
  if (location.hash !== '#dedup-block') return;

  const { waitFor, realisticClick, CONFIRM_BUTTON_PATTERN } = globalThis.DedupCore;

  const MORE_BUTTON_PATTERN = /^(Xem thêm lựa chọn|See more options)/i;
  const BLOCK_ITEM_PATTERN = /^(chặn|block)$/i;
  const BLOCK_DIALOG_PATTERN = /^(chặn|block)\b/i;
  const PAGE_WAIT_MS = 15000;
  const MENU_WAIT_MS = 3000;
  const CONFIRM_WAIT_MS = 3000;

  function showStatus(message) {
    let node = document.getElementById('dedup-status');
    if (!node) {
      node = document.createElement('div');
      node.id = 'dedup-status';
      node.className = 'dedup-status';
      document.body.append(node);
    }
    node.textContent = message;
  }

  function findMoreButton() {
    return (
      [...document.querySelectorAll('[role="button"][aria-label]')].find((node) =>
        MORE_BUTTON_PATTERN.test(node.getAttribute('aria-label'))
      ) || null
    );
  }

  function findBlockItem() {
    return (
      [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((node) =>
        BLOCK_ITEM_PATTERN.test(node.innerText.trim())
      ) || null
    );
  }

  function findConfirmButton() {
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      if (!BLOCK_DIALOG_PATTERN.test(dialog.innerText.trim())) continue;
      const button = [...dialog.querySelectorAll('[role="button"], button')].find((node) =>
        CONFIRM_BUTTON_PATTERN.test(node.innerText.trim())
      );
      if (button) return button;
    }
    return null;
  }

  function finish(ok, message) {
    showStatus(message);
    chrome.runtime.sendMessage({ type: 'profileBlockDone', ok, message });
  }

  async function run() {
    const moreButton = await waitFor(findMoreButton, PAGE_WAIT_MS);
    if (!moreButton) return finish(false, 'Không thấy menu "..." của trang cá nhân. Hãy chặn thủ công.');
    realisticClick(moreButton);

    const blockItem = await waitFor(findBlockItem, MENU_WAIT_MS);
    if (!blockItem) return finish(false, 'Không thấy mục "Chặn" trong menu. Hãy chặn thủ công.');
    realisticClick(blockItem);

    const confirmButton = await waitFor(findConfirmButton, CONFIRM_WAIT_MS);
    if (!confirmButton) return finish(false, 'Chưa thấy hộp xác nhận của Facebook. Hãy bấm xác nhận thủ công.');
    realisticClick(confirmButton);

    finish(true, 'Đã chặn');
  }

  chrome.runtime.sendMessage({ type: 'profileBlockHello' }, (reply) => {
    if (chrome.runtime.lastError || !reply || !reply.run) return;
    history.replaceState(null, '', location.pathname + location.search);
    run();
  });
})();
