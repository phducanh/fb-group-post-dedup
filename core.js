(function (root) {
  'use strict';

  const SHINGLE_SIZE = 3;
  const MIN_SHINGLES_FOR_FUZZY = 5;
  // Bài bị cắt "Xem thêm" thường chỉ còn vài chữ nên ngưỡng tối thiểu phải thấp.
  const MIN_TEXT_LENGTH = 10;
  // Khi không chắc cùng người đăng, văn bản ngắn quá dễ trùng nhầm ("còn hàng ạ").
  const MIN_TEXT_LENGTH_WITHOUT_AUTHOR_MATCH = 20;
  const UNKNOWN_AUTHOR_MIN_THRESHOLD = 0.95;
  const IDENTITY_PREFIX_LENGTH = 200;
  const FNV_OFFSET_BASIS = 0x811c9dc5;
  const FNV_PRIME = 0x01000193;

  // aria-label của comment: "Bình luận dưới tên X…", "Phản hồi bình luận của X…",
  // "Comment by X…", "Reply by X…". Bài viết không bắt đầu bằng các cụm này.
  const COMMENT_LABEL_PATTERN = /^(bình luận|phản hồi|comment|reply)/i;

  const FACEBOOK_HOST_PATTERN = /(^|\.)facebook\.com$/i;
  const GROUP_USER_PATH = /^\/groups\/[^/]+\/user\/(\d+)\/?$/;
  const PROFILE_ID_PATH = '/profile.php';

  // Nút xác nhận trong hộp thoại chặn của Facebook (không khớp "Hủy"/"Cancel").
  const CONFIRM_BUTTON_PATTERN = /^(chặn|block|xác nhận|confirm)$/i;
  const DEFAULT_POLL_MS = 50;

  const DEFAULT_OPTIONS = Object.freeze({
    threshold: 0.85,
    sameAuthorOnly: true,
  });

  const PERSIST_DEFAULTS = Object.freeze({
    ttlMs: 24 * 60 * 60 * 1000,
    maxEntries: 500,
  });

  function normalizeText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\b(xem them|see more)\s*$/, '')
      .trim();
  }

  function isCommentLabel(label) {
    return COMMENT_LABEL_PATTERN.test(String(label || '').trim());
  }

  // Facebook bỏ qua element.click() trên menu và hộp thoại; cần chuỗi sự kiện chuột
  // đầy đủ như người dùng thật.
  const CLICK_SEQUENCE = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

  function realisticClick(node) {
    const rect = node.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    };
    CLICK_SEQUENCE.forEach((type) => {
      const EventType = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      node.dispatchEvent(new EventType(type, init));
    });
  }

  // So tên không phân biệt hoa thường, dấu và dạng Unicode (NFC/NFD).
  function matchesName(text, name) {
    if (!name) return true;
    return normalizeText(text).includes(normalizeText(name));
  }

  // Thăm dò find() cho tới khi có kết quả hoặc hết thời gian; trả về null nếu hết giờ.
  function waitFor(find, timeoutMs, pollMs = DEFAULT_POLL_MS) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        const found = find();
        if (found || Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          resolve(found || null);
        }
      }, pollMs);
    });
  }

  // Link tác giả comment -> URL trang cá nhân sạch (bỏ tham số theo dõi). Chỉ nhận
  // host facebook.com; trả về '' nếu không dựng được.
  function toProfileUrl(href, baseUrl) {
    if (!href) return '';
    let url;
    try {
      url = new URL(href, baseUrl);
    } catch (_error) {
      return '';
    }
    if (!FACEBOOK_HOST_PATTERN.test(url.hostname)) return '';

    const groupUser = url.pathname.match(GROUP_USER_PATH);
    if (groupUser) return `${url.origin}${PROFILE_ID_PATH}?id=${groupUser[1]}`;

    if (url.pathname === PROFILE_ID_PATH) {
      const id = url.searchParams.get('id');
      return id ? `${url.origin}${PROFILE_ID_PATH}?id=${id}` : '';
    }
    return url.pathname === '/' ? '' : `${url.origin}${url.pathname}`;
  }

  // FNV-1a 32-bit. Chỉ cần ổn định và gọn để lưu; không dùng cho bảo mật.
  function hashString(value) {
    let hash = FNV_OFFSET_BASIS;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, FNV_PRIME);
    }
    return hash >>> 0;
  }

  function buildShingles(normalized) {
    const words = normalized.split(' ').filter(Boolean);
    if (words.length === 0) return new Set();
    if (words.length <= SHINGLE_SIZE) return new Set([hashString(words.join(' '))]);

    const shingles = new Set();
    for (let i = 0; i <= words.length - SHINGLE_SIZE; i += 1) {
      shingles.add(hashString(words.slice(i, i + SHINGLE_SIZE).join(' ')));
    }
    return shingles;
  }

  // Fingerprint chỉ giữ hash nên lưu xuống máy được mà không lộ nội dung bài.
  function buildFingerprint(text) {
    const normalized = normalizeText(text);
    return {
      length: normalized.length,
      digest: hashString(normalized),
      prefixDigest: hashString(normalized.slice(0, IDENTITY_PREFIX_LENGTH)),
      shingles: buildShingles(normalized),
    };
  }

  // Overlap coefficient: so khớp được cả khi một bản bị cắt ngắn ("Xem thêm").
  function similarity(a, b) {
    if (!a.length || !b.length) return 0;
    if (a.length === b.length && a.digest === b.digest) return 1;

    const [smaller, larger] =
      a.shingles.size <= b.shingles.size ? [a, b] : [b, a];
    if (smaller.shingles.size < MIN_SHINGLES_FOR_FUZZY) return 0;

    let shared = 0;
    smaller.shingles.forEach((shingle) => {
      if (larger.shingles.has(shingle)) shared += 1;
    });
    return shared / smaller.shingles.size;
  }

  function isDuplicateOf(original, candidate, fingerprint, options) {
    const bothAuthorsKnown = Boolean(original.authorKey && candidate.authorKey);
    if (
      options.sameAuthorOnly &&
      bothAuthorsKnown &&
      original.authorKey !== candidate.authorKey
    ) {
      return false;
    }

    const isAuthorConfirmed = options.sameAuthorOnly && bothAuthorsKnown;
    if (!isAuthorConfirmed && fingerprint.length < MIN_TEXT_LENGTH_WITHOUT_AUTHOR_MATCH) {
      return false;
    }

    const needsStrictMatch = options.sameAuthorOnly && !bothAuthorsKnown;
    const threshold = needsStrictMatch
      ? Math.max(options.threshold, UNKNOWN_AUTHOR_MIN_THRESHOLD)
      : options.threshold;

    return similarity(original.fingerprint, fingerprint) >= threshold;
  }

  function identityOf(post, fingerprint) {
    if (post.postId) return `id:${post.postId}`;
    return `tx:${post.groupKey || ''}|${post.authorKey || ''}|${fingerprint.prefixDigest}`;
  }

  function summarize(entry) {
    return {
      authorName: entry.authorName || '',
      groupName: entry.groupName || '',
      postId: entry.postId || '',
    };
  }

  function serializeEntry(entry) {
    return {
      identity: entry.identity,
      postId: entry.postId || '',
      authorKey: entry.authorKey || '',
      authorName: entry.authorName || '',
      groupKey: entry.groupKey || '',
      groupName: entry.groupName || '',
      seenAt: entry.seenAt,
      length: entry.fingerprint.length,
      digest: entry.fingerprint.digest,
      shingles: [...entry.fingerprint.shingles],
    };
  }

  // Dữ liệu đọc từ storage là input bên ngoài: kiểm tra hình dạng trước khi dùng.
  function isValidSavedEntry(saved) {
    return (
      saved !== null &&
      typeof saved === 'object' &&
      typeof saved.identity === 'string' &&
      Number.isFinite(saved.seenAt) &&
      Number.isFinite(saved.length) &&
      Number.isFinite(saved.digest) &&
      Array.isArray(saved.shingles) &&
      saved.shingles.every(Number.isFinite)
    );
  }

  function deserializeEntry(saved) {
    return {
      identity: saved.identity,
      postId: String(saved.postId || ''),
      authorKey: String(saved.authorKey || ''),
      authorName: String(saved.authorName || ''),
      groupKey: String(saved.groupKey || ''),
      groupName: String(saved.groupName || ''),
      seenAt: saved.seenAt,
      fingerprint: {
        length: saved.length,
        digest: saved.digest,
        prefixDigest: 0,
        shingles: new Set(saved.shingles),
      },
    };
  }

  /**
   * Registry ghi nhớ các bài đã thấy. Cùng một bài bị React render lại (cùng
   * postId hoặc cùng nhóm+tác giả+nội dung) luôn trả về kết quả cũ, nên không
   * bao giờ tự coi mình là bản trùng. Bài gốc có thể snapshot()/restore() để
   * nhớ giữa các lần mở trang (chỉ lưu hash, có hạn dùng).
   *
   * post: { postId, authorKey, authorName, groupKey, groupName, text }
   * trả về null (không đủ nội dung để so) hoặc
   *   { status: 'new' | 'duplicate', original: {authorName, groupName, postId} | null }
   */
  function createRegistry({ now = Date.now } = {}) {
    let results = new Map();
    let originals = [];
    let restoredCount = 0;

    function classify(post, rawOptions) {
      const options = { ...DEFAULT_OPTIONS, ...rawOptions };
      const fingerprint = buildFingerprint(post.text);
      if (fingerprint.length < MIN_TEXT_LENGTH) return null;

      const identity = identityOf(post, fingerprint);
      const known = results.get(identity);
      if (known) return known;

      const original = originals.find((entry) =>
        isDuplicateOf(entry, post, fingerprint, options)
      );

      if (original) {
        const result = { status: 'duplicate', original: summarize(original) };
        results = new Map(results).set(identity, result);
        return result;
      }

      const entry = {
        postId: post.postId,
        authorKey: post.authorKey,
        authorName: post.authorName,
        groupKey: post.groupKey,
        groupName: post.groupName,
        identity,
        fingerprint,
        seenAt: now(),
      };
      originals = [...originals, entry];
      const result = { status: 'new', original: null };
      results = new Map(results).set(identity, result);
      return result;
    }

    function snapshot(rawOptions) {
      const { ttlMs, maxEntries } = { ...PERSIST_DEFAULTS, ...rawOptions };
      const cutoff = now() - ttlMs;
      return originals
        .filter((entry) => entry.seenAt >= cutoff)
        .slice(-maxEntries)
        .map(serializeEntry);
    }

    function restore(saved, rawOptions) {
      if (!Array.isArray(saved)) return;
      const { ttlMs } = { ...PERSIST_DEFAULTS, ...rawOptions };
      const cutoff = now() - ttlMs;

      const fresh = saved
        .filter(isValidSavedEntry)
        .filter((entry) => entry.seenAt >= cutoff && !results.has(entry.identity))
        .map(deserializeEntry);

      // Bản đã lưu là bản cũ hơn nên xếp trước các bài thấy trong phiên này.
      originals = [...fresh, ...originals];
      const restoredResults = fresh.map((entry) => [
        entry.identity,
        { status: 'new', original: null },
      ]);
      results = new Map([...results, ...restoredResults]);
      restoredCount += fresh.length;
    }

    function stats() {
      let duplicates = 0;
      results.forEach((result) => {
        if (result.status === 'duplicate') duplicates += 1;
      });
      return { scanned: results.size - restoredCount, duplicates };
    }

    function reset() {
      results = new Map();
      originals = [];
      restoredCount = 0;
    }

    return { classify, snapshot, restore, stats, reset };
  }

  const api = {
    DEFAULT_OPTIONS,
    PERSIST_DEFAULTS,
    normalizeText,
    buildFingerprint,
    similarity,
    createRegistry,
    isCommentLabel,
    toProfileUrl,
    waitFor,
    realisticClick,
    matchesName,
    CONFIRM_BUTTON_PATTERN,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.DedupCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
