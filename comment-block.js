(function () {
  'use strict';

  if (globalThis.__groupPostDedupBlockLoaded) return;
  globalThis.__groupPostDedupBlockLoaded = true;

  const { isCommentLabel, toProfileUrl, waitFor, realisticClick, matchesName, CONFIRM_BUTTON_PATTERN } =
    globalThis.DedupCore;

  const ARTICLE_SELECTOR = '[role="article"]';
  // Menu "..." của comment người khác. Comment của chính mình có nhãn khác
  // ("Chỉnh sửa hoặc xóa…") nên tự động không có nút chặn.
  const MENU_BUTTON_SELECTOR =
    '[role="button"][aria-label^="Ẩn hoặc báo cáo"], [role="button"][aria-label^="Hide or report"]';
  const BLOCK_ITEM_PATTERN = /^(chặn|block)\s/i;
  const BUTTON_CLASS = 'dedup-block-btn';
  const BUTTON_ATTR = 'data-dedup-block';
  const BLOCKING_CLASS = 'dedup-blocking';
  const LABEL_DEFAULT = 'Chặn';
  const MENU_WAIT_MS = 2000;
  const CONFIRM_WAIT_MS = 2500;
  const DIALOG_CLOSE_WAIT_MS = 2500;
  const FEEDBACK_MS = 2500;

  const settings = { showBlockButton: true, blockWithoutConfirm: true };
  const pendingProfileBlocks = new Map();
  let scanFrame = null;

  function authorLinkOf(article) {
    return [...article.querySelectorAll('a[href]')].find((a) => a.textContent.trim()) || null;
  }

  function authorNameOf(article) {
    const link = authorLinkOf(article);
    return link ? link.textContent.trim() : '';
  }

  // Menu vừa mở từ nút "..." của chính comment này nên mục "Chặn" trong đó là của người
  // đó. Ưu tiên mục khớp tên (không phân biệt dấu/dạng Unicode); nếu tên lệch (huy hiệu,
  // biệt danh...) mà chỉ có đúng một mục Chặn thì dùng mục đó.
  function findBlockItem(name) {
    const items = [...document.querySelectorAll('[role="menuitem"]')].filter((item) =>
      BLOCK_ITEM_PATTERN.test(item.innerText.trim())
    );
    return items.find((item) => matchesName(item.innerText, name)) || (items.length === 1 ? items[0] : null);
  }

  // Hộp thoại xác nhận chặn là hộp thoại riêng ("Chặn <tên>? … Hủy | Xác nhận"), không
  // chứa comment. Loại hộp thoại bài viết (chứa cả các nút "Chặn" của extension) để không
  // bấm nhầm người khác.
  function findConfirmDialog(article, name) {
    return (
      [...document.querySelectorAll('[role="dialog"]')].find(
        (node) =>
          !node.contains(article) &&
          BLOCK_ITEM_PATTERN.test(node.innerText.trim()) &&
          matchesName(node.innerText, name)
      ) || null
    );
  }

  function findConfirmButton(article, name) {
    const dialog = findConfirmDialog(article, name);
    if (!dialog) return null;
    return (
      [...dialog.querySelectorAll('[role="button"], button')].find(
        (node) => !node.hasAttribute(BUTTON_ATTR) && CONFIRM_BUTTON_PATTERN.test(node.innerText.trim())
      ) || null
    );
  }

  function showFeedback(button, message) {
    button.textContent = message;
    setTimeout(() => {
      button.textContent = LABEL_DEFAULT;
    }, FEEDBACK_MS);
  }

  // Menu comment không có mục Chặn (ví dụ quyền quản trị viên, hoặc Facebook đổi menu):
  // nhờ background mở trang cá nhân ở tab nền; profile-block.js ở tab đó tự bấm
  // "..." > "Chặn" > xác nhận rồi background đóng tab và báo kết quả về nút này.
  function blockViaProfile(article, button, name) {
    const link = authorLinkOf(article);
    const profileUrl = link ? toProfileUrl(link.getAttribute('href'), location.href) : '';
    if (!profileUrl) return showFeedback(button, 'Không thấy mục Chặn');

    const confirmed =
      settings.blockWithoutConfirm ||
      window.confirm(`Menu comment không có mục "Chặn" cho ${name || 'người này'}.\n\nChặn qua trang cá nhân của họ?`);
    if (!confirmed) return;

    const requestId = crypto.randomUUID();
    pendingProfileBlocks.set(requestId, button);
    showFeedback(button, 'Đang chặn…');
    chrome.runtime.sendMessage({ type: 'startProfileBlock', url: profileUrl, requestId }, (reply) => {
      if (!chrome.runtime.lastError && reply && reply.ok) return;
      pendingProfileBlocks.delete(requestId);
      showFeedback(button, 'Không mở được tab chặn');
    });
  }

  // Mở menu comment, bấm mục "Chặn <tên>" rồi bấm "Xác nhận" của hộp thoại Facebook.
  // Menu và hộp thoại được ẩn (trong suốt) trong lúc chạy nên người dùng chỉ thấy kết quả.
  async function runInPageBlock(article, button, name) {
    const menuButton = article.querySelector(MENU_BUTTON_SELECTOR);
    if (!menuButton) return showFeedback(button, 'Không thấy menu');

    menuButton.click();
    const item = await waitFor(() => findBlockItem(name), MENU_WAIT_MS);
    if (!item) {
      menuButton.click();
      return blockViaProfile(article, button, name);
    }
    realisticClick(item);

    const confirmButton = await waitFor(() => findConfirmButton(article, name), CONFIRM_WAIT_MS);
    if (!confirmButton) return showFeedback(button, 'Chưa thấy hộp xác nhận');
    realisticClick(confirmButton);

    const closed = await waitFor(() => !findConfirmDialog(article, name), DIALOG_CLOSE_WAIT_MS);
    showFeedback(button, closed ? 'Đã chặn' : 'Đã bấm xác nhận');
  }

  // Mặc định bấm là chặn luôn; tắt "blockWithoutConfirm" để hỏi lại trước khi chặn.
  async function onBlockClick(article, button) {
    const name = authorNameOf(article);
    const confirmed =
      settings.blockWithoutConfirm ||
      window.confirm(`Chặn ${name || 'người này'} trên Facebook?`);
    if (!confirmed) return;

    document.documentElement.classList.add(BLOCKING_CLASS);
    try {
      await runInPageBlock(article, button, name);
    } finally {
      document.documentElement.classList.remove(BLOCKING_CLASS);
    }
  }

  function buildButton(article) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.setAttribute(BUTTON_ATTR, '1');
    button.textContent = LABEL_DEFAULT;
    button.title = 'Chặn người này trên Facebook';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onBlockClick(article, button);
    });
    return button;
  }

  function addButton(article) {
    const menuButton = article.querySelector(MENU_BUTTON_SELECTOR);
    if (!menuButton || article.querySelector(`[${BUTTON_ATTR}]`)) return;

    const actions = [...article.querySelectorAll('[role="button"]')].filter(
      (node) => node !== menuButton
    );
    const anchor = actions[actions.length - 1] || menuButton;
    anchor.after(buildButton(article));
  }

  function removeAllButtons() {
    document.querySelectorAll(`[${BUTTON_ATTR}]`).forEach((node) => node.remove());
  }

  function scan() {
    scanFrame = null;
    if (!settings.showBlockButton) return;
    document.querySelectorAll(ARTICLE_SELECTOR).forEach((article) => {
      if (isCommentLabel(article.getAttribute('aria-label'))) addButton(article);
    });
  }

  function scheduleScan() {
    if (scanFrame !== null) return;
    scanFrame = requestAnimationFrame(scan);
  }

  // Chỉ giữ vài từ đầu của nhãn để báo cáo chẩn đoán không chứa tên người.
  function leadingWords(label, count) {
    return label.trim().split(/\s+/).slice(0, count).join(' ');
  }

  function uniqueLimited(values, limit) {
    return [...new Set(values)].slice(0, limit);
  }

  function diagnoseComments() {
    const articles = [...document.querySelectorAll(ARTICLE_SELECTOR)];
    const comments = articles.filter((a) => isCommentLabel(a.getAttribute('aria-label')));
    const buttonLabels = [...document.querySelectorAll('[role="button"][aria-label]')]
      .map((node) => node.getAttribute('aria-label'))
      .filter((label) => /bình luận|comment/i.test(label));

    return {
      showBlockButton: settings.showBlockButton,
      articleCount: articles.length,
      commentArticles: comments.length,
      commentsWithMenuButton: comments.filter((a) => a.querySelector(MENU_BUTTON_SELECTOR)).length,
      blockButtons: document.querySelectorAll(`[${BUTTON_ATTR}]`).length,
      articleLabels: uniqueLimited(
        articles.map((a) => leadingWords(a.getAttribute('aria-label') || '(none)', 3)),
        8
      ),
      commentButtonLabels: uniqueLimited(
        buttonLabels.map((label) => leadingWords(label, 5)),
        10
      ),
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return;
    if (message.type === 'diagnoseComments') sendResponse(diagnoseComments());
    if (message.type === 'blockResult') {
      const button = pendingProfileBlocks.get(message.requestId);
      pendingProfileBlocks.delete(message.requestId);
      if (button) showFeedback(button, message.ok ? 'Đã chặn' : message.message || 'Chặn thất bại');
    }
  });

  function applySettings(stored) {
    if (typeof stored.showBlockButton === 'boolean') {
      settings.showBlockButton = stored.showBlockButton;
    }
    if (typeof stored.blockWithoutConfirm === 'boolean') {
      settings.blockWithoutConfirm = stored.blockWithoutConfirm;
    }
    if (settings.showBlockButton) scheduleScan();
    else removeAllButtons();
  }

  chrome.storage.sync.get({ showBlockButton: true, blockWithoutConfirm: true }, (stored) => {
    if (!chrome.runtime.lastError) applySettings(stored);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const updates = {};
    ['showBlockButton', 'blockWithoutConfirm'].forEach((key) => {
      if (changes[key]) updates[key] = changes[key].newValue;
    });
    if (Object.keys(updates).length > 0) applySettings(updates);
  });

  new MutationObserver(scheduleScan).observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
