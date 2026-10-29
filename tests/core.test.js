'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeText, buildFingerprint, similarity, createRegistry } = require('../core.js');

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

test('stats counts scanned and duplicate posts; reset clears them', () => {
  const registry = createRegistry();
  registry.classify(post({ postId: '1' }));
  registry.classify(post({ postId: '2', groupKey: 'g2' }));
  assert.deepEqual(registry.stats(), { scanned: 2, duplicates: 1 });

  registry.reset();
  assert.deepEqual(registry.stats(), { scanned: 0, duplicates: 0 });
});
