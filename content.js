(function () {
  'use strict';

  if (globalThis.__fbFeedDedupLoaded) return;
  globalThis.__fbFeedDedupLoaded = true;

  const { DEFAULT_OPTIONS, createRegistry } = globalThis.DedupCore;

  const MAX_EXTRACT_ATTEMPTS = 60;
  const DIAGNOSE_MAX_ARTICLES = 12;
  const DIAGNOSE_TEXT_PREVIEW = 40;
  const ARTICLE_SELECTOR = '[role="article"]';
  // Trang Feeds (sk=h_chr) không dùng role="article"; mỗi bài là một wrapper
  // data-virtualized, còn bài ngoài màn hình bị Facebook làm rỗng (="true").
  const ROOT_SELECTOR = `${ARTICLE_SELECTOR}, [data-virtualized]`;
  const NESTED_ARTICLE_DEPTH = 2;
  const MESSAGE_SELECTORS = [
    '[data-ad-rendering-role="story_message"]',
    '[data-ad-comet-preview="message"]',
    '[data-ad-preview="message"]',
  ];
  const RESERVED_PATHS = new Set([
    'groups', 'watch', 'hashtag', 'photo', 'photos', 'video', 'videos', 'reel',
    'reels', 'events', 'marketplace', 'gaming', 'pages', 'stories', 'share',
    'permalink.php', 'story.php', 'login', 'friends', 'bookmarks', 'ads',
  ]);
  const POST_ID_PATTERNS = [
    /\/groups\/[^/]+\/(?:posts|permalink)\/(\d+)/,
    /\/posts\/([\w-]+)/,
    /\/permalink\/(\d+)/,
    /\/(?:videos|reel)\/(\d+)/,
  ];
  const GROUP_PATH = /^\/groups\/([^/]+)\/?$/;
  const GROUP_USER_PATH = /^\/groups\/[^/]+\/user\/(\d+)\/?$/;
  const PROFILE_PATH = /^\/([A-Za-z0-9.]+)\/?$/;

  const SEEN_STORAGE_KEY = 'seenPosts';
  const PERSIST_DEBOUNCE_MS = 1000;

  const settings = {
    ...DEFAULT_OPTIONS,
    enabled: true,
    mode: 'collapse',
    rememberSeen: true,
  };
  const registry = createRegistry();
  let handled = new WeakSet();
  const attempts = new WeakMap();
  const verified = new WeakSet();
  const signatures = new WeakMap();
  let scanFrame = null;
  let persistTimer = null;
  // Chỉ quét sau khi đã nạp xong bài đã nhớ, để không phân loại thiếu dữ liệu.
  let isReady = false;

  function parseUrl(anchor) {
    try {
      return new URL(anchor.href, location.origin);
    } catch (_error) {
      return null;
    }
  }

  // Số role="article" bao quanh node (tính trong root). >= 2 nghĩa là comment.
  function articleDepth(node, root) {
    let depth = 0;
    let article = node.closest(ARTICLE_SELECTOR);
    while (article && root.contains(article)) {
      depth += 1;
      article = article.parentElement && article.parentElement.closest(ARTICLE_SELECTOR);
    }
    return depth;
  }

  function isOwnNode(node, root) {
    return articleDepth(node, root) < NESTED_ARTICLE_DEPTH;
  }

  function ownLinks(root) {
    return [...root.querySelectorAll('a[href]')].filter((link) => isOwnNode(link, root));
  }

  function extractPostId(root) {
    for (const link of root.querySelectorAll('a[href]')) {
      const url = parseUrl(link);
      if (!url) continue;
      const storyFbid = url.searchParams.get('story_fbid');
      if (storyFbid) return storyFbid;
      const photoSet = (url.searchParams.get('set') || '').match(/^pcb\.(\d+)/);
      if (photoSet) return photoSet[1];
      for (const pattern of POST_ID_PATTERNS) {
        const match = url.pathname.match(pattern);
        if (match) return match[1];
      }
    }
    return '';
  }

  function extractAuthor(links) {
    let key = '';
    let name = '';

    for (const link of links) {
      const url = parseUrl(link);
      const match = url && url.pathname.match(GROUP_USER_PATH);
      if (!match) continue;
      key = key || `u:${match[1]}`;
      name = name || link.textContent.trim();
    }
    if (key) return { authorKey: key, authorName: name };

    for (const link of links) {
      if (!link.closest('h2, h3, h4, strong')) continue;
      const url = parseUrl(link);
      if (!url || !link.textContent.trim()) continue;

      const profileId = url.pathname === '/profile.php' && url.searchParams.get('id');
      const username = (url.pathname.match(PROFILE_PATH) || [])[1];
      if (profileId) return { authorKey: `p:${profileId}`, authorName: link.textContent.trim() };
      if (username && !RESERVED_PATHS.has(username.toLowerCase())) {
        return { authorKey: `n:${username.toLowerCase()}`, authorName: link.textContent.trim() };
      }
    }
    return { authorKey: '', authorName: '' };
  }

  function extractGroup(links) {
    for (const link of links) {
      const url = parseUrl(link);
      const match = url && url.pathname.match(GROUP_PATH);
      if (match && link.textContent.trim()) {
        return { groupKey: match[1], groupName: link.textContent.trim() };
      }
    }
    const pageGroup = location.pathname.match(/^\/groups\/([^/]+)/);
    return { groupKey: pageGroup ? pageGroup[1] : '', groupName: '' };
  }

  function extractText(root) {
    for (const selector of MESSAGE_SELECTORS) {
      const node = [...root.querySelectorAll(selector)].find(
        (candidate) => isOwnNode(candidate, root) && candidate.innerText.trim()
      );
      if (node) return node.innerText;
    }

    let longest = '';
    root.querySelectorAll('div[dir="auto"]').forEach((node) => {
      if (!isOwnNode(node, root)) return;
      const text = node.innerText || '';
      if (text.length > longest.length) longest = text;
    });
    return longest;
  }

  function extractPost(root) {
    const links = ownLinks(root);
    return {
      postId: extractPostId(root),
      ...extractAuthor(links),
      ...extractGroup(links),
      text: extractText(root),
    };
  }

  function topLevelArticles() {
    return [...document.querySelectorAll(ROOT_SELECTOR)].filter(
      (root) => !root.parentElement.closest(ROOT_SELECTOR)
    );
  }

  function isVirtualized(root) {
    return root.getAttribute('data-virtualized') === 'true';
  }

  function describeOriginal(original) {
    const author = original.authorName || 'cùng người đăng';
    const group = original.groupName ? ` ở nhóm "${original.groupName}"` : '';
    return `Bài trùng nội dung của ${author}, đã xem trước đó${group}`;
  }

  function buildBanner(article, original) {
    const banner = document.createElement('div');
    banner.className = 'dedup-banner';

    const text = document.createElement('span');
    text.className = 'dedup-banner__text';
    text.textContent = describeOriginal(original);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'dedup-banner__toggle';
    toggle.textContent = 'Hiện bài';
    toggle.addEventListener('click', () => {
      const isHidden = article.style.display === 'none';
      article.style.display = isHidden ? '' : 'none';
      toggle.textContent = isHidden ? 'Ẩn bài' : 'Hiện bài';
    });

    banner.append(text, toggle);
    return banner;
  }

  function markDuplicate(article, original) {
    signatures.set(article, signatureOf(article));
    verified.add(article);
    article.dataset.dedupState = 'duplicate';
    article.style.display = 'none';
    if (settings.mode === 'collapse') {
      const banner = buildBanner(article, original);
      banner.dataset.dedupBanner = '1';
      article.before(banner);
    }
  }

  function restoreAll() {
    document.querySelectorAll('[data-dedup-banner]').forEach((node) => node.remove());
    document.querySelectorAll('[data-dedup-state]').forEach((article) => {
      article.style.display = '';
      delete article.dataset.dedupState;
    });
  }

  function processArticle(article) {
    const tries = (attempts.get(article) || 0) + 1;
    attempts.set(article, tries);

    const result = registry.classify(extractPost(article), settings);
    if (!result) {
      if (tries >= MAX_EXTRACT_ATTEMPTS) handled.add(article);
      return;
    }

    handled.add(article);
    if (result.status === 'duplicate') {
      markDuplicate(article, result.original);
      return;
    }
    schedulePersist();
  }

  // Trả wrapper về trạng thái ban đầu để được phân loại lại.
  function releaseRoot(root) {
    if (!handled.has(root) && !root.dataset.dedupState) return;
    const banner = root.previousElementSibling;
    if (banner && banner.dataset.dedupBanner) banner.remove();
    root.style.display = '';
    delete root.dataset.dedupState;
    handled.delete(root);
    verified.delete(root);
    attempts.delete(root);
  }

  // Chữ ký nhẹ (post id | tác giả | nhóm) lấy từ link, không phụ thuộc innerText
  // nên đọc được cả khi wrapper đang display:none.
  function signatureOf(root) {
    const links = ownLinks(root);
    const parts = [extractPostId(root), extractAuthor(links).authorKey, extractGroup(links).groupKey];
    return parts.some(Boolean) ? parts.join('|') : '';
  }

  // Facebook làm rỗng bài ngoài màn hình rồi đổ lại nội dung. Bài trùng giữ nguyên
  // trạng thái ẩn (không đổi chiều cao => không giật layout); khi nội dung về lại
  // chỉ cần chắc wrapper vẫn là đúng bài đó, nếu bị dùng cho bài khác thì trả lại.
  function verifyDuplicate(root) {
    const signature = signatureOf(root);
    if (!signature) return;
    if (signature === signatures.get(root)) {
      verified.add(root);
      return;
    }
    releaseRoot(root);
  }

  function persistNow() {
    persistTimer = null;
    if (!isReady) return;
    if (!settings.rememberSeen) {
      chrome.storage.local.remove(SEEN_STORAGE_KEY);
      return;
    }
    chrome.storage.local.set({ [SEEN_STORAGE_KEY]: registry.snapshot() }, () => {
      // Hết dung lượng thì vẫn lọc bình thường bằng bộ nhớ của trang.
      void chrome.runtime.lastError;
    });
  }

  function schedulePersist() {
    if (persistTimer !== null) return;
    persistTimer = setTimeout(persistNow, PERSIST_DEBOUNCE_MS);
  }

  function loadSeen(onDone) {
    if (!settings.rememberSeen) return onDone();
    chrome.storage.local.get(SEEN_STORAGE_KEY, (stored) => {
      if (!chrome.runtime.lastError) registry.restore(stored[SEEN_STORAGE_KEY]);
      onDone();
    });
  }

  function scan() {
    scanFrame = null;
    if (!settings.enabled || !isReady) return;
    topLevelArticles().forEach((root) => {
      if (isVirtualized(root)) {
        verified.delete(root);
        return;
      }
      if (!handled.has(root)) return processArticle(root);
      if (root.dataset.dedupState && !verified.has(root)) verifyDuplicate(root);
    });
  }

  // requestAnimationFrame chạy trước lần vẽ kế tiếp nên bài trùng bị ẩn trước khi
  // kịp hiện ra (tránh nháy rồi co lại).
  function scheduleScan() {
    if (scanFrame !== null) return;
    scanFrame = requestAnimationFrame(scan);
  }

  function resetAndRescan() {
    persistNow();
    isReady = false;
    restoreAll();
    registry.reset();
    handled = new WeakSet();
    loadSeen(() => {
      isReady = true;
      scheduleScan();
    });
  }

  function applySettings(stored) {
    Object.assign(settings, stored);
    resetAndRescan();
  }

  function loadSettings() {
    chrome.storage.sync.get(null, (stored) => {
      if (chrome.runtime.lastError) return;
      applySettings(stored);
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    // Popup bấm "Xóa dữ liệu đã nhớ": bỏ luôn bản đang giữ trong bộ nhớ.
    const seenChange = changes[SEEN_STORAGE_KEY];
    if (area === 'local' && seenChange && seenChange.newValue === undefined) {
      resetAndRescan();
      return;
    }
    if (area !== 'sync') return;
    const updates = Object.fromEntries(
      Object.entries(changes).map(([key, change]) => [key, change.newValue])
    );
    applySettings(updates);
  });

  function diagnose() {
    const articles = topLevelArticles();
    return {
      url: location.href,
      enabled: settings.enabled,
      settings: {
        mode: settings.mode,
        threshold: settings.threshold,
        sameAuthorOnly: settings.sameAuthorOnly,
      },
      counts: {
        roleArticle: document.querySelectorAll(ARTICLE_SELECTOR).length,
        topLevelArticle: articles.length,
        roleFeed: document.querySelectorAll('[role="feed"]').length,
        feedUnit: document.querySelectorAll('[data-pagelet^="FeedUnit"]').length,
        storyMessage: document.querySelectorAll(MESSAGE_SELECTORS.join(',')).length,
      },
      stats: registry.stats(),
      articles: articles.slice(0, DIAGNOSE_MAX_ARTICLES).map((article) => {
        const post = extractPost(article);
        return {
          handled: handled.has(article),
          attempts: attempts.get(article) || 0,
          state: article.dataset.dedupState || '',
          postId: post.postId,
          authorKey: post.authorKey,
          authorName: post.authorName,
          groupKey: post.groupKey,
          groupName: post.groupName,
          textLength: post.text.length,
          textPreview: post.text.slice(0, DIAGNOSE_TEXT_PREVIEW),
        };
      }),
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return;
    if (message.type === 'getStats') sendResponse(registry.stats());
    if (message.type === 'diagnose') sendResponse(diagnose());
  });

  new MutationObserver(scheduleScan).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-virtualized'],
  });

  loadSettings();
})();
