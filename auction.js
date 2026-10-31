(function () {
  'use strict';

  if (globalThis.__groupPostDedupAuctionLoaded) return;
  globalThis.__groupPostDedupAuctionLoaded = true;

  const { isCommentLabel, realisticClick, waitFor } = globalThis.DedupCore;
  const {
    isAuctionPost,
    parseLotBid,
    lotsFromBids,
    mergeLots,
    isBuyoutComment,
    parseDeadline,
    parseAuctionPost,
    textKey,
    parsePostTime,
    readSettings,
    dedupeRecords,
    missingInfo,
    unreadComments,
  } = globalThis.AuctionCore;

  const DEFAULT_GROUPS = ['316605308060947', '426208205081'];
  const GROUPS_KEY = 'auctionGroups';
  const STORAGE_KEY = 'auctions';
  const ARTICLE_SELECTOR = '[role="article"]';
  const MESSAGE_SELECTORS = [
    '[data-ad-rendering-role="story_message"]',
    '[data-ad-comet-preview="message"]',
    '[data-ad-preview="message"]',
  ].join(',');
  const POST_ID_PATTERNS = [
    /\/groups\/[^/]+\/(?:posts|permalink)\/(\d+|pfbid\w+)/,
    /\/permalink\/(\d+)/,
  ];
  // Album ảnh của bài trong nhóm: set=gm.<id bài> hoặc set=pcb.<id bài>.
  const PHOTO_SET_PATTERN = /^(?:gm|pcb)\.(\d+)/;
  const FEED_SELECTOR = '[role="feed"]';
  const GROUP_PATH = /^\/groups\/([^/?#]+)/;
  const SEE_MORE_PATTERN = /^(xem thêm|see more)$/i;
  // "Xem thêm bình luận", "Xem 5 phản hồi", "View more comments", "View 3 replies"...
  const MORE_COMMENTS_PATTERN =
    /^(xem (thêm|tất cả|\d+)\s*(bình luận|phản hồi)|xem (thêm )?\d+ (bình luận|phản hồi)|view (more|all|\d+|previous)\s*(more |previous )?(comments|replies)|\d+ (phản hồi|replies))/i;

  const SCAN_DEBOUNCE_MS = 400;
  const PERSIST_DEBOUNCE_MS = 1000;
  const MORE_COMMENTS_INTERVAL_MS = 1500;
  const MAX_MORE_COMMENTS_CLICKS = 40;
  const AUTO_SCROLL_INTERVAL_MS = 2000;
  const AUTO_SCROLL_MAX_STEPS = 60;
  const AUTO_SCROLL_MAX_IDLE_STEPS = 6;
  const MAX_RECORDS = 500;
  const KEEP_AFTER_DEADLINE_MS = 7 * 24 * 60 * 60 * 1000;
  const KEEP_UNDATED_MS = 14 * 24 * 60 * 60 * 1000;
  // Quét tự động (auction-sweep.js mở tab này và gửi từng bước).
  const SWEEP_PAGE_WAIT_MS = 20000;
  const SWEEP_SCROLL_STEPS = 30;
  const SWEEP_MAX_COMMENT_CLICKS = 80;
  const SWEEP_IDLE_CHECKS = 3;
  const SWEEP_SETTLE_MS = 1500;
  const MENU_WAIT_MS = 2000;
  const SORT_BUTTON_PATTERN = /^(phù hợp nhất|most relevant|mới nhất|newest)$/i;
  const ALL_COMMENTS_PATTERN = /^(tất cả bình luận|all comments)/i;
  const FEED_SORT_BUTTON_PATTERN = /^(phù hợp nhất|most relevant|hoạt động (gần|mới) đây|recent activity)$/i;
  const NEW_POSTS_PATTERN = /^(bài viết mới|new posts)/i;
  const MAX_EXPAND_ATTEMPTS = 3;
  const DIAGNOSE_MAX_POSTS = 15;
  const DIAGNOSE_PREVIEW = 60;
  const SETTINGS_KEYS = ['auctionMaxAgeDays', 'auctionSkipLocked'];
  const DAY_MS = 24 * 60 * 60 * 1000;
  // Nhãn thời gian nằm ở đầu bài: chỉ thử vài link đầu tiên.
  const MAX_TIME_LINKS = 12;
  // Bảng tin xếp theo bài mới: gặp chừng này bài quá số ngày thì thôi cuộn (chừa bài ghim).
  const OLD_POSTS_TO_STOP = 5;
  // Quét nhóm tìm bài mới: gặp chừng này bài đã có trong danh sách liên tiếp là đã tới phần
  // đã quét lần trước (bài cũ đã được cập nhật qua link riêng).
  const KNOWN_POSTS_TO_STOP = 5;
  // Mẫu nội dung của bài chưa đọc được hết thông tin (xem ở trang danh sách, gửi để sửa bộ đọc).
  const SAMPLES_KEY = 'auctionSamples';
  const MAX_SAMPLES = 50;
  const SAMPLE_TEXT_LIMIT = 3000;
  // Bước tìm link cho bài chưa có id: trang tìm kiếm trong nhóm chỉ cần cuộn vài lần.
  const SEARCH_SCROLL_STEPS = 3;
  const UNAVAILABLE_PATTERN =
    /(nội dung này hiện không hiển thị|nội dung này không khả dụng|bài viết này không còn|this content isn'?t available|content not found|this post is no longer available)/i;
  const LOCKED_NOTICE_PATTERN =
    /(đã tắt tính năng bình luận|tính năng bình luận đã bị tắt|đã tắt bình luận|đã khóa bình luận|đã khoá bình luận|turned off commenting|commenting (has been|is) turned off|comments (have been|are) turned off)/i;
  const LIKE_BUTTON_PATTERN = /^(thích|gỡ thích|like|remove like)$/i;
  const COMMENT_BUTTON_PATTERN = /^(bình luận|viết bình luận|comment|leave a comment)$/i;

  let trackedGroups = DEFAULT_GROUPS;
  const pending = new Map();
  const seenThisPage = new Set();
  // key -> chữ ký lần ghi gần nhất, để không ghi lại khi bài không đổi.
  const lastQueued = new Map();
  const expandAttempts = new WeakMap();
  let missingLinkCount = 0;
  let settings = readSettings({});
  const oldPosts = new WeakSet();
  let oldPostCount = 0;
  // Bước quét nhóm: id các bài đã có trong danh sách (bỏ qua, chỉ tìm bài mới).
  let sweepKnownIds = null;
  let knownRun = 0;
  const nudged = new WeakSet();
  let scanTimer = null;
  let persistTimer = null;
  let moreCommentsTimer = null;
  let moreCommentsClicks = 0;
  let lastPath = '';
  let autoScrollTimer = null;
  let panel = null;
  let autoScrollDone = null;
  let sweeping = false;

  function isComment(article) {
    return isCommentLabel(article.getAttribute('aria-label'));
  }

  function parseUrl(href) {
    try {
      return new URL(href, location.origin);
    } catch (_error) {
      return null;
    }
  }

  // Nhóm đang mở nếu nằm trong danh sách theo dõi. Nhóm có tên riêng (URL không phải id)
  // vẫn nhận ra được khi trang có link tới id của nhóm.
  function currentGroup() {
    const match = location.pathname.match(GROUP_PATH);
    if (!match) return '';
    const key = decodeURIComponent(match[1]);
    if (trackedGroups.includes(key)) return key;
    return trackedGroups.find((id) => document.querySelector(`a[href*="/groups/${id}/"]`)) || '';
  }

  function postIdFromUrl(url) {
    if (!url) return '';
    const fromQuery = url.searchParams.get('story_fbid') || url.searchParams.get('multi_permalinks');
    if (fromQuery) return fromQuery.split(',')[0];
    const photoSet = (url.searchParams.get('set') || '').match(PHOTO_SET_PATTERN);
    if (photoSet) return photoSet[1];
    for (const pattern of POST_ID_PATTERNS) {
      const match = url.pathname.match(pattern);
      if (match) return match[1];
    }
    return '';
  }

  function isPermalinkPage() {
    return Boolean(postIdFromUrl(new URL(location.href)));
  }

  // Node thuộc về bài (không nằm trong comment nào của bài). Bài có thể là role="article"
  // hoặc một khối con của role="feed" không có role="article".
  function belongsTo(node, post) {
    if (!post.contains(node)) return false;
    let article = node.closest(ARTICLE_SELECTOR);
    while (article && article !== post && post.contains(article)) {
      if (isComment(article)) return false;
      article = article.parentElement && article.parentElement.closest(ARTICLE_SELECTOR);
    }
    return true;
  }

  function postText(post) {
    const messages = [...post.querySelectorAll(MESSAGE_SELECTORS)]
      .filter((node) => belongsTo(node, post))
      .map((node) => node.innerText.trim())
      .filter(Boolean);
    if (messages.length > 0) return messages.join('\n');

    let longest = '';
    post.querySelectorAll('div[dir="auto"]').forEach((node) => {
      if (!belongsTo(node, post)) return;
      const text = node.innerText || '';
      if (text.length > longest.length) longest = text;
    });
    return longest;
  }

  function authorName(post) {
    const link = [...post.querySelectorAll('h2 a, h3 a, h4 a, strong a')].find(
      (node) => belongsTo(node, post) && node.textContent.trim()
    );
    return link ? link.textContent.trim() : '';
  }

  function groupName() {
    const heading = document.querySelector('[role="main"] h1') || document.querySelector('h1');
    return heading ? heading.textContent.trim() : '';
  }

  // Link thời gian của bài thường là "#" cho tới khi rê chuột vào; giả lập rê chuột để
  // Facebook điền link thật (lần quét sau sẽ đọc được id bài).
  function nudgeTimestampLinks(post) {
    post.querySelectorAll('a[href="#"], a:not([href])').forEach((link) => {
      if (nudged.has(link) || !belongsTo(link, post)) return;
      nudged.add(link);
      ['mouseover', 'mouseenter', 'focusin'].forEach((type) =>
        link.dispatchEvent(new MouseEvent(type, { bubbles: type !== 'mouseenter' }))
      );
    });
  }

  function postIdOf(post, isMainPost) {
    for (const link of post.querySelectorAll('a[href]')) {
      if (!belongsTo(link, post)) continue;
      const id = postIdFromUrl(parseUrl(link.getAttribute('href')));
      if (id) return id;
    }
    return isMainPost ? postIdFromUrl(new URL(location.href)) : '';
  }

  function seeMoreButtons(post) {
    return [...post.querySelectorAll('[role="button"]')].filter(
      (button) => SEE_MORE_PATTERN.test(button.innerText.trim()) && belongsTo(button, post)
    );
  }

  // Bấm "Xem thêm" của chính bài (ở bất kỳ đâu trong bài) để đọc được hạn kết thúc nằm ở
  // cuối bài. Nút còn đó ở lần quét sau nghĩa là Facebook chưa nhận cú bấm: thử lại vài lần.
  function expandPost(post) {
    seeMoreButtons(post).forEach((button) => {
      const tries = expandAttempts.get(button) || 0;
      if (tries >= MAX_EXPAND_ATTEMPTS) return;
      expandAttempts.set(button, tries + 1);
      realisticClick(button);
    });
  }

  function commentText(comment) {
    return [...comment.querySelectorAll('div[dir="auto"]')]
      .filter((node) => node.closest(ARTICLE_SELECTOR) === comment)
      .map((node) => node.innerText.trim())
      .filter(Boolean)
      .join(' ');
  }

  function isTopLevelPost(article) {
    if (isComment(article)) return false;
    const parent = article.parentElement && article.parentElement.closest(ARTICLE_SELECTOR);
    return !parent;
  }

  // Bài là role="article" ngoài cùng; ở bảng tin nhóm mới, khối con của role="feed" không
  // có role="article" thì chính khối đó là bài.
  function postRoots() {
    const articles = [...document.querySelectorAll(ARTICLE_SELECTOR)].filter(isTopLevelPost);
    const units = [...document.querySelectorAll(`${FEED_SELECTOR} > *`)].filter(
      (unit) =>
        !unit.closest(ARTICLE_SELECTOR) &&
        !articles.some((article) => unit.contains(article)) &&
        unit.textContent.trim()
    );
    return [...articles, ...units];
  }

  // Comment nằm trong bài (bảng tin) hoặc đứng ngang hàng với bài (hộp thoại/trang bài viết).
  function ownerOf(comment, posts, mainPost) {
    const container = posts.find((post) => post.contains(comment));
    if (container) return container;
    const dialog = comment.closest('[role="dialog"]');
    if (dialog) return posts.find((post) => dialog.contains(post)) || null;
    return mainPost;
  }

  function collectComments(posts, mainPost) {
    const byPost = new Map(posts.map((post) => [post, []]));
    document.querySelectorAll(ARTICLE_SELECTOR).forEach((article) => {
      if (!isComment(article)) return;
      const owner = ownerOf(article, posts, mainPost);
      if (owner && byPost.has(owner)) byPost.get(owner).push(article);
    });
    return byPost;
  }

  function labelsOf(link) {
    const labels = [link.getAttribute('aria-label'), link.innerText];
    (link.getAttribute('aria-labelledby') || '').split(/\s+/).forEach((id) => {
      const node = id && document.getElementById(id);
      if (node) labels.push(node.textContent);
    });
    return labels.filter(Boolean);
  }

  // Lúc đăng bài, đọc từ nhãn thời gian ("3 giờ", "Hôm qua lúc 10:20"...). null nếu không đọc được.
  function postTime(post) {
    const utime = post.querySelector('[data-utime]');
    if (utime && belongsTo(utime, post)) return Number(utime.getAttribute('data-utime')) * 1000;
    const links = [...post.querySelectorAll('a')].filter((link) => belongsTo(link, post)).slice(0, MAX_TIME_LINKS);
    for (const link of links) {
      for (const label of labelsOf(link)) {
        const time = parsePostTime(label);
        if (time) return time;
      }
    }
    return null;
  }

  function buttonLabel(node) {
    return (node.getAttribute('aria-label') || node.innerText || '').trim();
  }

  // Bài khoá bình luận: có dòng thông báo của Facebook, hoặc có nút Thích mà không có nút
  // Bình luận. null khi chưa biết (thanh nút chưa hiện).
  function commentsLocked(post, isMainPost) {
    const scopeText = isMainPost ? sweepScope().innerText : post.innerText;
    if (LOCKED_NOTICE_PATTERN.test(scopeText || '')) return true;
    const labels = [...post.querySelectorAll('[role="button"]')]
      .filter((button) => belongsTo(button, post))
      .map(buttonLabel);
    if (!labels.some((label) => LIKE_BUTTON_PATTERN.test(label))) return null;
    return !labels.some((label) => COMMENT_BUTTON_PATTERN.test(label));
  }

  function isAuctionText(text) {
    return Boolean(text) && (isAuctionPost(text) || Boolean(parseDeadline(text)));
  }

  function searchUrl(group, text) {
    const query = text.split('\n')[0].trim().slice(0, 60);
    return `https://www.facebook.com/groups/${group}/search/?q=${encodeURIComponent(query)}`;
  }

  // Bài chưa lấy được id vẫn được ghi (khoá tạm theo đầu bài, link tìm kiếm trong nhóm);
  // khi đọc được id thì bản tạm được thay bằng bản có link thật.
  function queueRecord(group, postId, post, comments, { postedAt, locked }) {
    const text = postText(post);
    if (!isAuctionText(text)) return false;

    const commentTexts = comments.map(commentText);
    // Bài nhiều món: comment ghi suất ("S1 20") được tính riêng cho từng suất.
    const lotBids = commentTexts.map(parseLotBid).filter(Boolean);
    const bids = lotBids.map((bid) => bid.amount);
    const lots = lotsFromBids(lotBids);
    const boughtOut = commentTexts.some(isBuyoutComment);
    const tempKey = `${group}:t${textKey(text)}`;
    const key = postId ? `${group}:${postId}` : tempKey;
    if (postId) {
      seenThisPage.delete(tempKey);
      pending.delete(tempKey);
    }
    if (settings.skipLockedComments && locked) seenThisPage.delete(key);
    else seenThisPage.add(key);
    const signature = `${text.length}|${bids.length}|${Math.max(0, ...bids)}|${Boolean(postedAt)}|${locked}|${boughtOut}|${JSON.stringify(lots)}`;
    if (lastQueued.get(key) === signature) return true;
    lastQueued.set(key, signature);

    const previous = pending.get(key) || {};
    pending.set(key, {
      key,
      groupKey: group,
      groupName: groupName() || previous.groupName || '',
      postId,
      textKey: textKey(text),
      url: postId ? `https://www.facebook.com/groups/${group}/posts/${postId}/` : searchUrl(group, text),
      authorName: authorName(post) || previous.authorName || '',
      text: text.length >= (previous.text || '').length ? text : previous.text,
      highestBid: Math.max(previous.highestBid || 0, ...bids, 0) || null,
      bidCount: Math.max(previous.bidCount || 0, bids.length),
      postedAt: postedAt || previous.postedAt || null,
      boughtOut: boughtOut || Boolean(previous.boughtOut),
      lots: mergeLots(previous.lots, lots),
      commentsLocked: locked === null ? (previous.commentsLocked ?? null) : locked,
    });
    schedulePersist();
    return true;
  }

  function mergeRecord(old, next, now) {
    const firstSeenAt = (old && old.firstSeenAt) || now;
    const merged = {
      ...old,
      key: next.key,
      groupKey: next.groupKey,
      groupName: next.groupName || (old && old.groupName) || '',
      postId: next.postId,
      url: next.url,
      textKey: next.textKey || (old && old.textKey) || '',
      authorName: next.authorName || (old && old.authorName) || '',
      firstSeenAt,
      updatedAt: now,
      highestBid: Math.max((old && old.highestBid) || 0, next.highestBid || 0) || null,
      bidCount: Math.max((old && old.bidCount) || 0, next.bidCount || 0),
      deepScannedAt: next.deep ? now : (old && old.deepScannedAt) || null,
      postedAt: next.postedAt || (old && old.postedAt) || null,
      commentsLocked: next.commentsLocked ?? (old && old.commentsLocked) ?? null,
      // Đã thấy "đứt" một lần là đã bán, không quay lại.
      boughtOut: Boolean(next.boughtOut || (old && old.boughtOut)),
      lots: mergeLots(old && old.lots, next.lots),
    };
    // Bản bị cắt "Xem thêm" ngắn hơn: chỉ cập nhật khi đọc được nội dung dài bằng/hơn trước.
    if (!old || next.text.length >= (old.textLength || 0)) {
      const parsed = parseAuctionPost(next.text, firstSeenAt);
      Object.assign(merged, {
        title: parsed.title,
        textLength: next.text.length,
        deadlineAt: parsed.deadline ? parsed.deadline.at : null,
        deadlineRaw: parsed.deadline ? parsed.deadline.raw : '',
        deadlineApproximate: parsed.deadline ? parsed.deadline.approximate : false,
        startPrice: parsed.startPrice,
        currentPrice: parsed.currentPrice,
        buyNowPrice: parsed.buyNowPrice,
      });
      if (parsed.soldOut) merged.boughtOut = true;
      // Tên món của từng suất lấy từ nội dung bài.
      const titles = Object.fromEntries(Object.entries(parsed.lots).map(([lot, title]) => [lot, { title }]));
      merged.lots = mergeLots(merged.lots, titles);
    }
    return merged;
  }

  function isWorthKeeping(record, now) {
    if (record.deadlineAt) return record.deadlineAt >= now - KEEP_AFTER_DEADLINE_MS;
    return record.updatedAt >= now - KEEP_UNDATED_MS;
  }

  function prune(records, now) {
    const kept = Object.values(records)
      .filter((record) => isWorthKeeping(record, now))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_RECORDS);
    return Object.fromEntries(kept.map((record) => [record.key, record]));
  }

  // Đọc - gộp - ghi để không đè dữ liệu của tab Facebook khác đang quét nhóm còn lại.
  function persistNow(onDone = () => {}) {
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = null;
    if (pending.size === 0) return onDone();
    const batch = [...pending.values()];
    pending.clear();
    chrome.storage.local.get(STORAGE_KEY, (stored) => {
      if (chrome.runtime.lastError) return onDone();
      const now = Date.now();
      const records = { ...(stored[STORAGE_KEY] || {}) };
      batch.forEach((next) => {
        records[next.key] = mergeRecord(records[next.key], next, now);
      });
      // Bản tạm (chưa có id) hay bản pfbid của cùng bài được gộp vào bản có id số.
      chrome.storage.local.set({ [STORAGE_KEY]: prune(dedupeRecords(records), now) }, () => {
        void chrome.runtime.lastError;
        onDone();
      });
    });
  }

  function schedulePersist() {
    if (persistTimer !== null) return;
    persistTimer = setTimeout(() => persistNow(), PERSIST_DEBOUNCE_MS);
  }

  // Trên trang bài viết / hộp thoại bài viết: mở dần các bình luận bị ẩn để thấy hết giá.
  function loadMoreComments() {
    moreCommentsTimer = null;
    if (sweeping || !currentGroup() || moreCommentsClicks >= MAX_MORE_COMMENTS_CLICKS) return;
    const scope = document.querySelector('[role="dialog"]') || (isPermalinkPage() ? document : null);
    if (!scope) return;
    const button = [...scope.querySelectorAll('[role="button"]')].find((node) =>
      MORE_COMMENTS_PATTERN.test(node.innerText.trim())
    );
    if (!button) return;
    moreCommentsClicks += 1;
    realisticClick(button);
  }

  function scheduleMoreComments() {
    if (moreCommentsTimer !== null) return;
    moreCommentsTimer = setTimeout(loadMoreComments, MORE_COMMENTS_INTERVAL_MS);
  }

  function scan() {
    scanTimer = null;
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      moreCommentsClicks = 0;
      oldPostCount = 0;
      seenThisPage.clear();
    }

    const group = currentGroup();
    if (!group) {
      stopAutoScroll();
      if (panel) panel.node.hidden = true;
      return;
    }

    const posts = postRoots();
    const mainPost = isPermalinkPage() ? posts[0] || null : null;
    const comments = collectComments(posts, mainPost);

    missingLinkCount = 0;
    const cutoff = Date.now() - settings.maxAgeDays * DAY_MS;
    let run = 0;
    posts.forEach((post) => {
      // Bài đăng quá số ngày tối đa: không đọc, chỉ đếm để biết lúc thôi cuộn.
      const postedAt = postTime(post);
      if (postedAt && postedAt < cutoff) {
        if (!oldPosts.has(post)) {
          oldPosts.add(post);
          oldPostCount += 1;
        }
        return;
      }
      const postId = postIdOf(post, post === mainPost);
      if (sweepKnownIds && postId) {
        if (sweepKnownIds.has(postId)) {
          run += 1;
          return;
        }
        run = 0;
      }
      expandPost(post);
      if (!postId) nudgeTimestampLinks(post);
      const locked = commentsLocked(post, post === mainPost);
      const queued = queueRecord(group, postId, post, comments.get(post) || [], { postedAt, locked });
      if (queued && !postId) missingLinkCount += 1;
    });
    knownRun = run;

    renderPanel();
    scheduleMoreComments();
  }

  function scheduleScan() {
    if (scanTimer !== null) return;
    scanTimer = setTimeout(scan, SCAN_DEBOUNCE_MS);
  }

  function stopAutoScroll() {
    if (autoScrollTimer === null) return;
    clearInterval(autoScrollTimer);
    autoScrollTimer = null;
    renderPanel();
    const done = autoScrollDone;
    autoScrollDone = null;
    if (done) done();
  }

  // Tự cuộn để Facebook tải thêm bài; dừng khi trang không dài thêm nữa hoặc đủ số bước.
  function startAutoScroll(maxSteps = AUTO_SCROLL_MAX_STEPS, onDone = null, shouldStop = () => false) {
    autoScrollDone = onDone;
    let steps = 0;
    let idle = 0;
    let lastHeight = 0;
    autoScrollTimer = setInterval(() => {
      const height = document.documentElement.scrollHeight;
      idle = height > lastHeight ? 0 : idle + 1;
      lastHeight = height;
      steps += 1;
      if (steps > maxSteps || idle > AUTO_SCROLL_MAX_IDLE_STEPS || shouldStop()) return stopAutoScroll();
      window.scrollBy(0, window.innerHeight * 0.9);
    }, AUTO_SCROLL_INTERVAL_MS);
    renderPanel();
  }

  function buildPanel() {
    const node = document.createElement('div');
    node.className = 'auction-panel';

    const label = document.createElement('span');
    label.className = 'auction-panel__label';

    const scrollButton = document.createElement('button');
    scrollButton.type = 'button';
    scrollButton.className = 'auction-panel__button';
    scrollButton.addEventListener('click', () => {
      if (autoScrollTimer === null) startAutoScroll();
      else stopAutoScroll();
    });

    const listButton = document.createElement('button');
    listButton.type = 'button';
    listButton.className = 'auction-panel__button auction-panel__button--primary';
    listButton.textContent = 'Xem danh sách';
    listButton.addEventListener('click', () => {
      persistNow();
      chrome.runtime.sendMessage({ type: 'openAuctions' });
    });

    node.append(label, scrollButton, listButton);
    document.body.append(node);
    return { node, label, scrollButton };
  }

  // Chỉ ghi khi đổi để không tạo mutation mới (MutationObserver sẽ quét lại liên tục).
  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  function renderPanel() {
    if (!panel) panel = buildPanel();
    if (panel.node.hidden) panel.node.hidden = false;
    const missing = missingLinkCount ? ` · ${missingLinkCount} chưa có link` : '';
    setText(panel.label, `Đấu giá: ${seenThisPage.size} bài${missing}`);
    setText(panel.scrollButton, autoScrollTimer === null ? 'Tự cuộn' : 'Dừng cuộn');
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function findButton(scope, pattern) {
    return (
      [...scope.querySelectorAll('[role="button"]')].find((node) => pattern.test(node.innerText.trim())) || null
    );
  }

  function sweepScope() {
    return document.querySelector('[role="dialog"]') || document;
  }

  function pageReady() {
    return currentGroup() && document.querySelector(`${ARTICLE_SELECTOR}, ${FEED_SELECTOR} > *`);
  }

  // Tham số sorting_setting không phải lúc nào cũng có tác dụng: chọn "Bài viết mới" ở nút
  // sắp xếp của bảng tin nhóm (nút nằm ngoài mọi bài, khác nút sắp xếp bình luận).
  async function sortFeedByNewest() {
    const button = [...document.querySelectorAll('[role="button"]')].find(
      (node) => !node.closest(ARTICLE_SELECTOR) && FEED_SORT_BUTTON_PATTERN.test(node.innerText.trim())
    );
    if (!button) return;
    realisticClick(button);
    const item = await waitFor(
      () =>
        [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="radio"]')].find(
          (node) => NEW_POSTS_PATTERN.test(node.innerText.trim())
        ),
      MENU_WAIT_MS
    );
    realisticClick(item || button);
    await delay(SWEEP_SETTLE_MS * 2);
  }

  // "Phù hợp nhất" ẩn bớt bình luận; chuyển sang "Tất cả bình luận" để thấy mọi lượt trả giá.
  async function showAllComments() {
    const sortButton = findButton(sweepScope(), SORT_BUTTON_PATTERN);
    if (!sortButton) return;
    realisticClick(sortButton);
    const item = await waitFor(
      () =>
        [...document.querySelectorAll('[role="menuitem"]')].find((node) =>
          ALL_COMMENTS_PATTERN.test(node.innerText.trim())
        ),
      MENU_WAIT_MS
    );
    realisticClick(item || sortButton);
    await delay(SWEEP_SETTLE_MS);
  }

  async function expandAllComments() {
    let clicks = 0;
    let idle = 0;
    while (clicks < SWEEP_MAX_COMMENT_CLICKS && idle < SWEEP_IDLE_CHECKS) {
      const button = findButton(sweepScope(), MORE_COMMENTS_PATTERN);
      if (button) {
        realisticClick(button);
        clicks += 1;
        idle = 0;
      } else {
        idle += 1;
      }
      await delay(MORE_COMMENTS_INTERVAL_MS);
    }
  }

  async function sweepGroup() {
    if (!(await waitFor(pageReady, SWEEP_PAGE_WAIT_MS))) return;
    await sortFeedByNewest();
    await new Promise((resolve) =>
      startAutoScroll(
        SWEEP_SCROLL_STEPS,
        resolve,
        () => oldPostCount >= OLD_POSTS_TO_STOP || knownRun >= KNOWN_POSTS_TO_STOP
      )
    );
  }

  function isUnavailable() {
    return UNAVAILABLE_PATTERN.test(document.body.innerText || '');
  }

  // Mở bài qua link để lấy trạng thái mới nhất. Trả về true nếu bài đã bị xoá/ẩn.
  async function sweepPost() {
    await waitFor(() => pageReady() || isUnavailable(), SWEEP_PAGE_WAIT_MS);
    if (!pageReady()) return isUnavailable();
    await delay(SWEEP_SETTLE_MS);
    await showAllComments();
    await expandAllComments();
    return false;
  }

  // Một bước quét: đọc hết rồi ghi xuống trước khi báo background chuyển trang. Luôn báo
  // xong (kể cả khi lỗi, ví dụ Facebook bắt đăng nhập) để phiên quét không bị treo.
  // Ảnh chụp nội dung bài vừa mở qua link: chỉ giữ khi còn thiếu thông tin hoặc có comment
  // có số mà không đọc được thành giá.
  function captureSample(step) {
    const posts = postRoots();
    const main = posts[0];
    if (!main) return null;
    const text = postText(main);
    const commentTexts = (collectComments(posts, main).get(main) || []).map(commentText);
    const parsed = parseAuctionPost(text, Date.now());
    const lotBids = commentTexts.map(parseLotBid).filter(Boolean);
    const summary = {
      postId: String(step.postId || ''),
      deadlineAt: parsed.deadline ? parsed.deadline.at : null,
      startPrice: parsed.startPrice,
      currentPrice: parsed.currentPrice,
      highestBid: Math.max(0, ...lotBids.map((bid) => bid.amount)) || null,
      lots: lotsFromBids(lotBids),
      boughtOut: parsed.soldOut || commentTexts.some(isBuyoutComment),
    };
    return {
      key: step.key,
      url: step.url,
      title: parsed.title,
      capturedAt: Date.now(),
      missing: missingInfo(summary),
      text: text.slice(0, SAMPLE_TEXT_LIMIT),
      commentCount: commentTexts.length,
      unreadComments: unreadComments(commentTexts),
    };
  }

  function saveSample(step) {
    const sample = step.key ? captureSample(step) : null;
    if (!sample) return Promise.resolve();
    return new Promise((resolve) => {
      chrome.storage.local.get(SAMPLES_KEY, (stored) => {
        if (chrome.runtime.lastError) return resolve();
        const samples = { ...(stored[SAMPLES_KEY] || {}) };
        if (sample.missing.length > 0 || sample.unreadComments.length > 0) samples[sample.key] = sample;
        else delete samples[sample.key];
        const kept = Object.values(samples)
          .sort((a, b) => b.capturedAt - a.capturedAt)
          .slice(0, MAX_SAMPLES);
        chrome.storage.local.set({ [SAMPLES_KEY]: Object.fromEntries(kept.map((item) => [item.key, item])) }, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      });
    });
  }

  // Bài chưa có id: mở trang tìm kiếm trong nhóm theo đầu bài, đọc kết quả để lấy link thật
  // (bản tạm được gộp vào bản có id khi ghi).
  async function sweepSearch() {
    if (!(await waitFor(pageReady, SWEEP_PAGE_WAIT_MS))) return;
    await new Promise((resolve) => startAutoScroll(SEARCH_SCROLL_STEPS, resolve));
  }

  async function runSweepStep(step) {
    sweeping = true;
    let unavailable = false;
    try {
      if (step.mode === 'group') {
        sweepKnownIds = new Set((step.knownIds || []).map(String));
        knownRun = 0;
        await sweepGroup();
      } else if (step.mode === 'search') {
        await sweepSearch();
      } else {
        unavailable = await sweepPost();
      }
      await delay(SWEEP_SETTLE_MS);
      lastQueued.clear();
      scan();
      if (step.mode === 'post') {
        pending.forEach((entry) => {
          if (entry.postId === String(step.postId)) entry.deep = true;
        });
      }
      await new Promise((resolve) => persistNow(resolve));
      if (step.mode === 'post' && !unavailable) await saveSample(step);
    } finally {
      sweeping = false;
      sweepKnownIds = null;
      chrome.runtime.sendMessage({ type: 'auctionSweepStepDone', unavailable }, () => void chrome.runtime.lastError);
    }
  }

  // Báo cáo chẩn đoán (popup): vì sao một bài không được nhận là bài đấu giá.
  function diagnoseAuctions() {
    const posts = postRoots();
    return {
      group: currentGroup(),
      permalink: isPermalinkPage(),
      feeds: document.querySelectorAll(FEED_SELECTOR).length,
      postRoots: posts.length,
      recorded: seenThisPage.size,
      missingLink: missingLinkCount,
      posts: posts.slice(0, DIAGNOSE_MAX_POSTS).map((post) => {
        const text = postText(post);
        return {
          isArticle: post.matches(ARTICLE_SELECTOR),
          textLength: text.length,
          preview: text.slice(0, DIAGNOSE_PREVIEW),
          isAuction: isAuctionText(text),
          hasDeadline: Boolean(parseDeadline(text)),
          seeMoreButtons: seeMoreButtons(post).length,
          postId: postIdOf(post, false),
          postedAt: postTime(post),
          commentsLocked: commentsLocked(post, false),
          messageNodes: post.querySelectorAll(MESSAGE_SELECTORS).length,
          hashLinks: post.querySelectorAll('a[href="#"], a:not([href])').length,
        };
      }),
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'diagnoseAuctions') sendResponse(diagnoseAuctions());
    if (!message || message.type !== 'auctionSweepRun') return;
    sendResponse({ ok: true });
    if (!sweeping) runSweepStep(message);
  });

  function applyGroups(value) {
    trackedGroups = Array.isArray(value) && value.length > 0 ? value.map(String) : DEFAULT_GROUPS;
    scheduleScan();
  }

  chrome.storage.sync.get([GROUPS_KEY, ...SETTINGS_KEYS], (stored) => {
    if (chrome.runtime.lastError) return;
    settings = readSettings(stored);
    applyGroups(stored[GROUPS_KEY]);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (SETTINGS_KEYS.some((key) => changes[key])) {
      chrome.storage.sync.get(SETTINGS_KEYS, (stored) => {
        if (!chrome.runtime.lastError) settings = readSettings(stored);
      });
    }
    if (changes[GROUPS_KEY]) applyGroups(changes[GROUPS_KEY].newValue);
  });

  window.addEventListener('pagehide', () => persistNow());

  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
  scheduleScan();
})();
