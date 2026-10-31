'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeText,
  buildFingerprint,
  similarity,
  createRegistry,
  isCommentLabel,
  toProfileUrl,
  matchesName,
  realisticClick,
  waitFor,
  CONFIRM_BUTTON_PATTERN,
} = require('../core.js');

const SALE_TEXT =
  'Cần bán gấp căn hộ 2 phòng ngủ quận 7, giá 2 tỷ 5, liên hệ 0901 234 567 để xem nhà';

function post(overrides) {
  return {
    postId: '',
    authorKey: 'u:1',
    authorName: 'Nguyễn A',
    groupKey: 'g1',
    groupName: 'Nhóm 1',
    text: SALE_TEXT,
    ...overrides,
  };
}

test('isCommentLabel recognises comment and reply articles in Vietnamese and English', () => {
  assert.equal(isCommentLabel('Bình luận dưới tên Phạm Tiên vào 2 giờ trước'), true);
  assert.equal(isCommentLabel('Phản hồi bình luận của Gia Bách dưới tên Thông Nguyễn'), true);
  assert.equal(isCommentLabel('Comment by Jane Doe 2 hours ago'), true);
  assert.equal(isCommentLabel('Reply by Jane Doe to John Roe\'s comment'), true);
});

test('isCommentLabel rejects post labels and empty values', () => {
  assert.equal(isCommentLabel('Bài viết của Bui Thai Hao'), false);
  assert.equal(isCommentLabel(''), false);
  assert.equal(isCommentLabel(null), false);
  assert.equal(isCommentLabel(undefined), false);
});

const FB = 'https://web.facebook.com/groups/1/posts/2/';

test('toProfileUrl turns a group member link into a profile.php link', () => {
  const href = '/groups/991161867582623/user/100002975923703/?__cft__[0]=abc&__tn__=R';
  assert.equal(
    toProfileUrl(href, FB),
    'https://web.facebook.com/profile.php?id=100002975923703'
  );
});

test('toProfileUrl keeps only the id of a profile.php link', () => {
  assert.equal(
    toProfileUrl('https://www.facebook.com/profile.php?id=55&__cft__=x', FB),
    'https://www.facebook.com/profile.php?id=55'
  );
});

test('toProfileUrl strips tracking params from a username link', () => {
  assert.equal(
    toProfileUrl('https://www.facebook.com/some.user?__cft__[0]=x', FB),
    'https://www.facebook.com/some.user'
  );
});

test('toProfileUrl rejects other hosts, the site root and invalid input', () => {
  assert.equal(toProfileUrl('https://evil.example.com/groups/1/user/2/', FB), '');
  assert.equal(toProfileUrl('https://notfacebook.com/someone', FB), '');
  assert.equal(toProfileUrl('/', FB), '');
  assert.equal(toProfileUrl('https://www.facebook.com/profile.php', FB), '');
  assert.equal(toProfileUrl('http://[bad', FB), '');
  assert.equal(toProfileUrl('', FB), '');
});

test('normalizeText strips accents, urls, punctuation and "Xem thêm"', () => {
  const result = normalizeText('Đẹp quá!!! https://x.com/abc  Xem thêm');
  assert.equal(result, 'dep qua');
});

test('similarity is 1 for identical text regardless of accents/case', () => {
  const a = buildFingerprint(SALE_TEXT);
  const b = buildFingerprint(SALE_TEXT.toUpperCase());
  assert.equal(similarity(a, b), 1);
});

test('similarity matches a truncated copy of the same text', () => {
  const full = buildFingerprint(`${SALE_TEXT}. Nhà mới sơn, nội thất đầy đủ, sổ hồng riêng`);
  const truncated = buildFingerprint(`${SALE_TEXT}... Xem thêm`);
  assert.ok(similarity(full, truncated) >= 0.85);
});

test('similarity is low for unrelated text', () => {
  const a = buildFingerprint(SALE_TEXT);
  const b = buildFingerprint('Hôm nay trời đẹp nên mình đi cà phê với bạn bè cuối tuần này nhé');
  assert.ok(similarity(a, b) < 0.3);
});

test('classify marks the second same-author post in another group as duplicate', () => {
  const registry = createRegistry();
  const first = registry.classify(post({ postId: '1' }));
  const second = registry.classify(post({ postId: '2', groupKey: 'g2', groupName: 'Nhóm 2' }));

  assert.equal(first.status, 'new');
  assert.equal(second.status, 'duplicate');
  assert.equal(second.original.groupName, 'Nhóm 1');
});

test('classify does not treat a re-rendered post (same postId) as duplicate', () => {
  const registry = createRegistry();
  registry.classify(post({ postId: '1' }));
  const again = registry.classify(post({ postId: '1' }));
  assert.equal(again.status, 'new');
});

test('classify keeps a re-rendered duplicate marked as duplicate', () => {
  const registry = createRegistry();
  registry.classify(post({ postId: '1' }));
  registry.classify(post({ postId: '2', groupKey: 'g2' }));
  const again = registry.classify(post({ postId: '2', groupKey: 'g2' }));
  assert.equal(again.status, 'duplicate');
});

test('classify re-render without postId (same group/author/text) is not a duplicate', () => {
  const registry = createRegistry();
  registry.classify(post());
  assert.equal(registry.classify(post()).status, 'new');
});

test('different authors with same text are not duplicates when sameAuthorOnly', () => {
  const registry = createRegistry();
  registry.classify(post({ postId: '1' }));
  const other = registry.classify(post({ postId: '2', authorKey: 'u:2', groupKey: 'g2' }));
  assert.equal(other.status, 'new');
});

test('different authors with same text are duplicates when sameAuthorOnly is false', () => {
  const registry = createRegistry();
  const options = { sameAuthorOnly: false };
  registry.classify(post({ postId: '1' }), options);
  const other = registry.classify(post({ postId: '2', authorKey: 'u:2', groupKey: 'g2' }), options);
  assert.equal(other.status, 'duplicate');
});

test('unknown author requires near-identical text', () => {
  const longText = Array.from({ length: 40 }, (_, i) => `tu${i}`).join(' ');
  const editedText = longText.replace('tu20', 'khac');
  const registry = createRegistry();
  registry.classify(post({ postId: '1', text: longText }));

  const knownAuthorEdit = registry.classify(
    post({ postId: '2', groupKey: 'g2', text: editedText })
  );
  const unknownAuthorEdit = registry.classify(
    post({ postId: '3', authorKey: '', groupKey: 'g3', text: editedText })
  );
  const unknownAuthorExact = registry.classify(
    post({ postId: '4', authorKey: '', groupKey: 'g4', text: longText })
  );

  assert.equal(knownAuthorEdit.status, 'duplicate');
  assert.equal(unknownAuthorEdit.status, 'new');
  assert.equal(unknownAuthorExact.status, 'duplicate');
});

test('short truncated posts from the same author in different groups are duplicates', () => {
  const text = '👉🏻 Đồ hiếm tới chơi\n👉🏻… Xem thêm';
  const registry = createRegistry();
  registry.classify(post({ postId: '1', authorKey: 'u:9', text, groupName: 'Chợ Tokusatsu' }));
  const second = registry.classify(
    post({ postId: '2', authorKey: 'u:9', text, groupKey: 'g2', groupName: 'TOKUSATSU VN' })
  );

  assert.equal(second.status, 'duplicate');
  assert.equal(second.original.groupName, 'Chợ Tokusatsu');
});

test('short text is not deduped when the author is unknown', () => {
  const text = '👉🏻 Đồ hiếm tới chơi\n👉🏻… Xem thêm';
  const registry = createRegistry();
  registry.classify(post({ postId: '1', authorKey: '', text }));
  const second = registry.classify(post({ postId: '2', authorKey: '', groupKey: 'g2', text }));

  assert.equal(second.status, 'new');
});

test('classify returns null for posts with too little text', () => {
  const registry = createRegistry();
  assert.equal(registry.classify(post({ text: 'hi' })), null);
});

const HOUR_MS = 60 * 60 * 1000;

function clockAt(start) {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

test('snapshot stores hashed fingerprints only, never the post text', () => {
  const registry = createRegistry();
  registry.classify(post({ postId: '1' }));

  const serialized = JSON.stringify(registry.snapshot());
  assert.ok(!serialized.includes('can ban'));
  assert.ok(!serialized.includes('Cần bán'));
  assert.equal(registry.snapshot().length, 1);
});

test('restored originals make a later cross-post a duplicate after "reload"', () => {
  const before = createRegistry();
  before.classify(post({ postId: '1', groupName: 'Nhóm 1' }));
  const saved = JSON.parse(JSON.stringify(before.snapshot()));

  const after = createRegistry();
  after.restore(saved);
  const crossPost = after.classify(post({ postId: '2', groupKey: 'g2', groupName: 'Nhóm 2' }));

  assert.equal(crossPost.status, 'duplicate');
  assert.equal(crossPost.original.groupName, 'Nhóm 1');
});

test('a restored original seen again is still shown, not hidden as its own duplicate', () => {
  const before = createRegistry();
  before.classify(post({ postId: '1' }));

  const after = createRegistry();
  after.restore(before.snapshot());

  assert.equal(after.classify(post({ postId: '1' })).status, 'new');
});

test('restored originals without postId are recognised by group+author+text', () => {
  const before = createRegistry();
  before.classify(post());

  const after = createRegistry();
  after.restore(before.snapshot());

  assert.equal(after.classify(post()).status, 'new');
});

test('entries older than the ttl are dropped on snapshot and restore', () => {
  const clock = clockAt(1_000_000);
  const before = createRegistry({ now: clock.now });
  before.classify(post({ postId: '1' }));
  const saved = before.snapshot();

  clock.advance(25 * HOUR_MS);
  assert.equal(before.snapshot().length, 0);

  const after = createRegistry({ now: clock.now });
  after.restore(saved);
  assert.equal(after.classify(post({ postId: '2', groupKey: 'g2' })).status, 'new');
});

test('snapshot keeps only the most recent entries up to the cap', () => {
  const clock = clockAt(1_000_000);
  const registry = createRegistry({ now: clock.now });
  for (let i = 0; i < 5; i += 1) {
    const distinctText = Array.from({ length: 12 }, (_, w) => `tu${i}x${w}`).join(' ');
    registry.classify(post({ postId: String(i), text: distinctText }));
    clock.advance(1000);
  }

  const kept = registry.snapshot({ maxEntries: 2 });
  assert.deepEqual(kept.map((entry) => entry.postId), ['3', '4']);
});

test('restore ignores malformed entries instead of throwing', () => {
  const registry = createRegistry();
  assert.doesNotThrow(() =>
    registry.restore([null, 'x', {}, { identity: 1 }, { identity: 'a', shingles: 'nope' }])
  );
  assert.doesNotThrow(() => registry.restore(undefined));
  assert.equal(registry.classify(post({ postId: '1' })).status, 'new');
});

test('restored entries do not count as scanned posts', () => {
  const before = createRegistry();
  before.classify(post({ postId: '1' }));

  const after = createRegistry();
  after.restore(before.snapshot());
  assert.deepEqual(after.stats(), { scanned: 0, duplicates: 0 });
});

test('classify results carry the identity of the post and of its original', () => {
  const registry = createRegistry();
  const first = registry.classify(post({ postId: '1' }));
  const second = registry.classify(post({ postId: '2', groupKey: 'g2' }));

  assert.equal(first.identity, 'id:1|g1|u:1');
  assert.equal(second.identity, 'id:2|g2|u:1');
  assert.equal(second.original.identity, 'id:1|g1|u:1');
});

test('shares of the same post in other groups are not mistaken for re-renders', () => {
  const registry = createRegistry();
  const shared = { postId: '99', linkedPostIds: ['99'], text: '' };
  registry.classify(post({ ...shared, text: SALE_TEXT }));
  const second = registry.classify(post({ ...shared, text: SALE_TEXT, groupKey: 'g2' }));
  assert.equal(second.status, 'duplicate');
});

test('posts linking the same shared post are duplicates even with different captions', () => {
  const registry = createRegistry();
  registry.classify(post({ postId: '1', linkedPostIds: ['1', '99'], text: 'Mọi người xem giúp em bài này nhé' }));
  const second = registry.classify(
    post({ postId: '2', linkedPostIds: ['2', '99'], groupKey: 'g2', text: 'Share cho cả nhà cùng biết với ạ' })
  );
  assert.equal(second.status, 'duplicate');
});

test('shares of the same post by different people are duplicates even when sameAuthorOnly', () => {
  const registry = createRegistry();
  registry.classify(post({ postId: '1', linkedPostIds: ['1', '99'] }));
  const other = registry.classify(
    post({ postId: '2', linkedPostIds: ['2', '99'], authorKey: 'u:2', groupKey: 'g2', text: 'khác hẳn nội dung bài trên' })
  );
  assert.equal(other.status, 'duplicate');
});

test('the same Marketplace listing in several groups is a duplicate even without text', () => {
  const registry = createRegistry();
  const first = registry.classify(post({ postId: '1', listingIds: ['555'], text: '' }));
  const second = registry.classify(post({ postId: '2', listingIds: ['555'], groupKey: 'g2', text: 'iPhone' }));
  assert.equal(first.status, 'new');
  assert.equal(second.status, 'duplicate');
});

test('posts without text or listing still wait for content', () => {
  const registry = createRegistry();
  assert.equal(registry.classify(post({ postId: '1', linkedPostIds: ['1'], text: '' })), null);
});

test('listing and linked post ids survive snapshot/restore', () => {
  const before = createRegistry();
  before.classify(post({ postId: '1', listingIds: ['555'], text: '' }));
  const after = createRegistry();
  after.restore(before.snapshot());
  assert.equal(after.classify(post({ postId: '2', listingIds: ['555'], groupKey: 'g2', text: '' })).status, 'duplicate');
});

test('a newer post supersedes the older original and the older one becomes the duplicate', () => {
  const registry = createRegistry();
  registry.classify(post({ postId: 'old', groupName: 'Nhóm cũ' }));

  const asked = [];
  const newer = registry.classify(
    post({ postId: 'new', groupKey: 'g2', groupName: 'Nhóm mới' }),
    {
      isNewerThan: (originalIdentity) => {
        asked.push(originalIdentity);
        return true;
      },
    }
  );

  assert.equal(newer.status, 'new');
  assert.equal(newer.supersedes.identity, 'id:old|g1|u:1');
  assert.deepEqual(asked, ['id:old|g1|u:1']);
  assert.equal(registry.classify(post({ postId: 'old' })).status, 'duplicate');
  assert.equal(registry.classify(post({ postId: 'old' })).original.groupName, 'Nhóm mới');
});

test('a post that is not newer stays a duplicate of the existing original', () => {
  const registry = createRegistry();
  registry.classify(post({ postId: 'old' }));
  const later = registry.classify(post({ postId: 'later', groupKey: 'g2' }), {
    isNewerThan: () => false,
  });

  assert.equal(later.status, 'duplicate');
  assert.equal(later.supersedes, undefined);
});

test('after a supersede, further copies are duplicates of the newest post', () => {
  const registry = createRegistry();
  registry.classify(post({ postId: 'old' }));
  registry.classify(post({ postId: 'new', groupKey: 'g2', groupName: 'Nhóm mới' }), {
    isNewerThan: () => true,
  });
  const third = registry.classify(post({ postId: 'third', groupKey: 'g3' }), {
    isNewerThan: () => false,
  });

  assert.equal(third.status, 'duplicate');
  assert.equal(third.original.identity, 'id:new|g2|u:1');
});

test('a re-rendered superseding post is still shown, without superseding again', () => {
  const registry = createRegistry();
  registry.classify(post({ postId: 'old' }));
  registry.classify(post({ postId: 'new', groupKey: 'g2' }), { isNewerThan: () => true });
  const again = registry.classify(post({ postId: 'new', groupKey: 'g2' }), {
    isNewerThan: () => true,
  });

  assert.equal(again.status, 'new');
  assert.equal(again.supersedes, undefined);
});

test('snapshot keeps the newest original and drops the one it superseded', () => {
  const registry = createRegistry();
  registry.classify(post({ postId: 'old' }));
  registry.classify(post({ postId: 'new', groupKey: 'g2' }), { isNewerThan: () => true });

  assert.deepEqual(registry.snapshot().map((entry) => entry.postId), ['new']);
});

test('a restored original from a previous visit is superseded by the same post seen now', () => {
  const before = createRegistry();
  before.classify(post({ postId: 'yesterday', groupName: 'Nhóm cũ' }));

  const after = createRegistry();
  after.restore(before.snapshot());
  const today = after.classify(post({ postId: 'today', groupKey: 'g2', groupName: 'Nhóm mới' }), {
    isNewerThan: () => true,
  });

  assert.equal(today.status, 'new');
  assert.equal(today.supersedes.identity, 'id:yesterday|g1|u:1');
});

test('stats counts scanned and duplicate posts; reset clears them', () => {
  const registry = createRegistry();
  registry.classify(post({ postId: '1' }));
  registry.classify(post({ postId: '2', groupKey: 'g2' }));
  assert.deepEqual(registry.stats(), { scanned: 2, duplicates: 1 });

  registry.reset();
  assert.deepEqual(registry.stats(), { scanned: 0, duplicates: 0 });
});

test('matchesName ignores accents, case and Unicode normalisation form', () => {
  assert.equal(matchesName('Chặn Phạm Tiên', 'Phạm Tiên'), true);
  assert.equal(matchesName('Chặn Phạm Tiên', 'pham tien'), true);
  const decomposed = 'Pha\u0323m Tie\u0302n'; // NFD của "Phạm Tiên"
  assert.equal(matchesName('Chặn Phạm Tiên', decomposed), true);
  assert.equal(matchesName('Chặn Phạm Tiên', 'Gia Bách'), false);
});

test('matchesName accepts any text when the name is unknown', () => {
  assert.equal(matchesName('Chặn ai đó', ''), true);
  assert.equal(matchesName('Chặn ai đó', undefined), true);
});

test('CONFIRM_BUTTON_PATTERN matches confirm labels but not cancel labels', () => {
  ['Chặn', 'Block', 'Xác nhận', 'Confirm'].forEach((label) =>
    assert.equal(CONFIRM_BUTTON_PATTERN.test(label), true, label)
  );
  ['Hủy', 'Cancel', 'Chặn người này', 'Không'].forEach((label) =>
    assert.equal(CONFIRM_BUTTON_PATTERN.test(label), false, label)
  );
});

test('waitFor resolves with the first truthy result', async () => {
  let calls = 0;
  const result = await waitFor(() => (++calls >= 3 ? 'found' : null), 1000, 5);
  assert.equal(result, 'found');
});

test('waitFor resolves null when nothing is found before the timeout', async () => {
  assert.equal(await waitFor(() => null, 30, 5), null);
});

test('realisticClick dispatches the full pointer/mouse sequence at the element centre', () => {
  const seen = [];
  class FakeEvent {
    constructor(type, init) {
      this.type = type;
      Object.assign(this, init);
    }
  }
  global.MouseEvent = FakeEvent;
  global.PointerEvent = FakeEvent;
  const node = {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 40 }),
    dispatchEvent: (event) => seen.push(event),
  };

  realisticClick(node);

  assert.deepEqual(
    seen.map((event) => event.type),
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']
  );
  assert.equal(seen[0].clientX, 60);
  assert.equal(seen[0].clientY, 40);
  assert.equal(seen.every((event) => event.bubbles === true), true);
  delete global.MouseEvent;
  delete global.PointerEvent;
});

test('the same post id in the same group is never a duplicate of itself', () => {
  const registry = createRegistry();
  registry.classify(post({ postId: '1', authorKey: 'u:1' }));
  // Trang chi tiết đọc tác giả khác dạng => identity khác, nhưng vẫn là chính bài đó.
  const detail = registry.classify(post({ postId: '1', authorKey: 'n:nguyen.a' }), { sameAuthorOnly: false });
  assert.equal(detail.status, 'new');
});

test('a duplicate opened on its detail page stays collapsed when not newer', () => {
  const registry = createRegistry();
  registry.classify(post({ postId: '1' }));
  const detail = registry.classify(post({ postId: '2', groupKey: 'g2' }), { isNewerThan: () => false });
  assert.equal(detail.status, 'duplicate');
});
