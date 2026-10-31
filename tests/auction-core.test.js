'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAuctionPost,
  parseAmount,
  parseBid,
  parseDeadline,
  parseAuctionPost,
  highestPrice,
  textKey,
  compareNewest,
} = require('../auction-core.js');

// Thứ 5, 31/10/2024 10:00 giờ máy.
const REFERENCE = new Date(2024, 9, 31, 10, 0).getTime();

function at(year, month, day, hour, minute = 0) {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

test('isAuctionPost recognises Vietnamese and English auction posts', () => {
  assert.equal(isAuctionPost('ĐẤU GIÁ mô hình Kamen Rider, giá khởi điểm 100k'), true);
  assert.equal(isAuctionPost('Auction: Gundam RG, start 200k'), true);
  assert.equal(isAuctionPost('Bước giá 10k, kết thúc 21h'), true);
  assert.equal(isAuctionPost('Pass lại mô hình giá 300k'), false);
});

test('isAuctionPost recognises short-hand auction posts', () => {
  assert.equal(isAuctionPost('ĐG Figuarts W, start 100k step 10k'), true);
  assert.equal(isAuctionPost('Auc RG Zaku, bước 20k'), true);
  assert.equal(isAuctionPost('Khởi điểm 50k'), true);
});

test('textKey is stable between the truncated and the expanded text', () => {
  const head = 'Đấu giá Kamen Rider W Figuarts bản Nhật, hộp đẹp, đầy đủ phụ kiện, tay thay thế và đế trưng bày, ';
  const truncated = `${head}còn mới… Xem thêm`;
  const full = `${head}còn mới 99%\nGiá khởi điểm 200k\nKết thúc 21h 2/11`;
  assert.equal(textKey(truncated), textKey(full));
  assert.notEqual(textKey(full), textKey('Đấu giá Gundam RG Zaku II bản Nhật'));
});

test('compareNewest orders by post id, newest first, then by first seen', () => {
  const records = [
    { postId: '1000000000000002', firstSeenAt: 1 },
    { postId: '', firstSeenAt: 5 },
    { postId: '1000000000000010', firstSeenAt: 1 },
  ];
  assert.deepEqual(
    [...records].sort(compareNewest).map((record) => record.postId),
    ['1000000000000010', '1000000000000002', '']
  );
});

test('parseAmount reads common Vietnamese money formats', () => {
  assert.equal(parseAmount('150k'), 150000);
  assert.equal(parseAmount('150K'), 150000);
  assert.equal(parseAmount('1tr2'), 1200000);
  assert.equal(parseAmount('1tr250'), 1250000);
  assert.equal(parseAmount('1m5'), 1500000);
  assert.equal(parseAmount('1.5tr'), 1500000);
  assert.equal(parseAmount('1,5 triệu'), 1500000);
  assert.equal(parseAmount('2 củ'), 2000000);
  assert.equal(parseAmount('1.200.000'), 1200000);
  assert.equal(parseAmount('1.200.000đ'), 1200000);
  assert.equal(parseAmount('250'), 250000);
  assert.equal(parseAmount('3 lít'), 300000);
  assert.equal(parseAmount('500 nghìn'), 500000);
  assert.equal(parseAmount('không có số'), null);
});

test('parseBid accepts short bid comments', () => {
  assert.equal(parseBid('250k'), 250000);
  assert.equal(parseBid('theo 300'), 300000);
  assert.equal(parseBid('1tr2 ạ'), 1200000);
  assert.equal(parseBid('Bid 450k'), 450000);
  assert.equal(parseBid('Giá hiện tại 500k'), 500000);
});

test('parseBid rejects chatter, phone numbers, increments and step prices', () => {
  assert.equal(parseBid('+10k'), null);
  assert.equal(parseBid('0901 234 567'), null);
  assert.equal(parseBid('bước giá 10k'), null);
  assert.equal(parseBid('ship 30k'), null);
  assert.equal(parseBid('200k với 300k'), null);
  assert.equal(parseBid('món này đẹp quá mà tiếc là hết tiền rồi 200k thôi'), null);
  assert.equal(parseBid('đẹp quá'), null);
});

test('parseDeadline reads time and date after the end keyword', () => {
  assert.equal(parseDeadline('Kết thúc: 21h30 ngày 2/11', REFERENCE).at, at(2024, 11, 2, 21, 30));
  assert.equal(parseDeadline('KẾT THÚC 22H 01/11/2024', REFERENCE).at, at(2024, 11, 1, 22));
  assert.equal(parseDeadline('End: 9pm 3/11', REFERENCE).at, at(2024, 11, 3, 21));
  assert.equal(parseDeadline('Chốt phiên 20:00 thứ 7', REFERENCE).at, at(2024, 11, 2, 20));
  assert.equal(parseDeadline('Kết thúc 9h tối mai', REFERENCE).at, at(2024, 11, 1, 21));
  assert.equal(parseDeadline('kết thúc 21.30 31/10', REFERENCE).at, at(2024, 10, 31, 23, 59));
  assert.equal(parseDeadline('Kết thúc ngày 5 tháng 11 lúc 20h', REFERENCE).at, at(2024, 11, 5, 20));
  assert.equal(parseDeadline('Hết giờ: 10 giờ tối thứ bảy', REFERENCE).at, at(2024, 11, 2, 22));
});

test('parseDeadline infers next year for early-month dates seen in December', () => {
  const december = new Date(2024, 11, 30, 10).getTime();
  assert.equal(parseDeadline('Kết thúc 21h 2/1', december).at, at(2025, 1, 2, 21));
});

test('parseDeadline marks guesses as approximate', () => {
  const timeOnly = parseDeadline('Kết thúc 21h', REFERENCE);
  assert.equal(timeOnly.at, at(2024, 10, 31, 21));
  assert.equal(timeOnly.approximate, true);

  const dateOnly = parseDeadline('Kết thúc ngày 3/11', REFERENCE);
  assert.equal(dateOnly.at, at(2024, 11, 3, 23, 59));
  assert.equal(dateOnly.approximate, true);

  assert.equal(parseDeadline('Kết thúc 21h 2/11', REFERENCE).approximate, false);
});

test('parseDeadline returns null without an end keyword or time', () => {
  assert.equal(parseDeadline('Mô hình đẹp, giá 200k', REFERENCE), null);
  assert.equal(parseDeadline('Kết thúc sớm nha mọi người', REFERENCE), null);
});

test('parseDeadline keeps the original wording', () => {
  assert.match(parseDeadline('Giá 100k\nKết thúc: 21h30 2/11\nShip COD', REFERENCE).raw, /^Kết thúc: 21h30 2\/11/);
});

test('parseAuctionPost extracts title and prices', () => {
  const post = parseAuctionPost(
    'Đấu giá Kamen Rider W Figuarts\nGiá khởi điểm: 200k\nBước giá: 20k\nMua ngay: 1tr5\nKết thúc 21h 2/11',
    REFERENCE
  );
  assert.equal(post.title, 'Đấu giá Kamen Rider W Figuarts');
  assert.equal(post.startPrice, 200000);
  assert.equal(post.buyNowPrice, 1500000);
  assert.equal(post.currentPrice, null);
  assert.equal(post.deadline.at, at(2024, 11, 2, 21));
});

test('highestPrice prefers the larger of comment bids and stated current price', () => {
  assert.equal(highestPrice({ highestBid: 300000, currentPrice: 250000 }), 300000);
  assert.equal(highestPrice({ highestBid: null, currentPrice: 250000 }), 250000);
  assert.equal(highestPrice({}), null);
});

const { parsePostTime, isOlderThan, isExcluded, readSettings } = require('../auction-core.js');

test('parsePostTime reads relative Facebook timestamps', () => {
  assert.equal(parsePostTime('Vừa xong', REFERENCE), REFERENCE);
  assert.equal(parsePostTime('15 phút', REFERENCE), REFERENCE - 15 * 60 * 1000);
  assert.equal(parsePostTime('3 giờ', REFERENCE), REFERENCE - 3 * 60 * 60 * 1000);
  assert.equal(parsePostTime('2 ngày', REFERENCE), REFERENCE - 2 * 24 * 60 * 60 * 1000);
  assert.equal(parsePostTime('1 tuần', REFERENCE), REFERENCE - 7 * 24 * 60 * 60 * 1000);
  assert.equal(parsePostTime('5h', REFERENCE), REFERENCE - 5 * 60 * 60 * 1000);
  assert.equal(parsePostTime('3d', REFERENCE), REFERENCE - 3 * 24 * 60 * 60 * 1000);
});

test('parsePostTime reads dated Facebook timestamps', () => {
  assert.equal(parsePostTime('Hôm qua lúc 10:20', REFERENCE), at(2024, 10, 30, 10, 20));
  assert.equal(parsePostTime('3 tháng 10 lúc 09:00', REFERENCE), at(2024, 10, 3, 9, 0));
  assert.equal(parsePostTime('3 Tháng 12, 2023', REFERENCE), at(2023, 12, 3, 0, 0));
  assert.equal(parsePostTime('25 tháng 12', REFERENCE), at(2023, 12, 25, 0, 0));
  assert.equal(parsePostTime('October 3 at 9:30 PM', REFERENCE), at(2024, 10, 3, 21, 30));
});

test('parsePostTime ignores post text', () => {
  assert.equal(parsePostTime('Đấu giá kết thúc sau 3 ngày nữa', REFERENCE), null);
  assert.equal(parsePostTime('Kamen Rider', REFERENCE), null);
  assert.equal(parsePostTime('', REFERENCE), null);
});

test('isOlderThan uses the posted time when known', () => {
  assert.equal(isOlderThan({ postedAt: 100 }, 200), true);
  assert.equal(isOlderThan({ postedAt: 300 }, 200), false);
});

test('isOlderThan bounds unknown posts by first sighting and newer ids', () => {
  const cutoff = 1000;
  assert.equal(isOlderThan({ firstSeenAt: 900 }, cutoff), true);
  assert.equal(isOlderThan({ firstSeenAt: 5000 }, cutoff), false);

  const anchors = [{ postId: '500', postedAt: 800 }, { postId: '100', postedAt: 5000 }];
  assert.equal(isOlderThan({ postId: '400', firstSeenAt: 9000 }, cutoff, anchors), true);
  assert.equal(isOlderThan({ postId: '600', firstSeenAt: 9000 }, cutoff, anchors), false);
});

test('isExcluded applies locked comments and maximum age settings', () => {
  const now = REFERENCE;
  const day = 24 * 60 * 60 * 1000;
  const settings = readSettings({});
  assert.deepEqual(settings, { maxAgeDays: 5, skipLockedComments: true });

  assert.equal(isExcluded({ postedAt: now - day, commentsLocked: true }, settings, now), true);
  assert.equal(isExcluded({ postedAt: now - day }, settings, now), false);
  assert.equal(isExcluded({ postedAt: now - 6 * day }, settings, now), true);

  const relaxed = readSettings({ auctionMaxAgeDays: 10, auctionSkipLocked: false });
  assert.equal(isExcluded({ postedAt: now - 6 * day, commentsLocked: true }, relaxed, now), false);
});

const { isBuyoutComment, isEnded } = require('../auction-core.js');

test('parseBid reads many Vietnamese bid styles', () => {
  const cases = {
    '3m1': 3100000,
    '3M1': 3100000,
    '3m15': 3150000,
    '3m150': 3150000,
    '3m': 3000000,
    '3tr1': 3100000,
    '3 tr 1': 3100000,
    '3tr100k': 3100000,
    '3tr 100k': 3100000,
    '3 triệu 100 nghìn': 3100000,
    '3 triệu 1 trăm': 3100000,
    '3 triệu': 3000000,
    '3 củ 1': 3100000,
    '3c1': 3100000,
    '3.1tr': 3100000,
    '3,1 triệu': 3100000,
    '3.1': 3100000,
    '3.100': 3100000,
    '3100': 3100000,
    '3.100.000': 3100000,
    '3.100.000đ': 3100000,
    '3100000': 3100000,
    '5 trăm': 500000,
    '5 trăm 5': 550000,
    '550k': 550000,
    '550K': 550000,
    '550 ngàn': 550000,
    '550': 550000,
    '5 lít': 500000,
    '5 lít 5': 550000,
    'b 550': 550000,
    'Bid: 550k': 550000,
    'bid 3m1 nha': 3100000,
    'em theo 3m1 ạ': 3100000,
    'Mình trả 3m1 nhé shop': 3100000,
    'theo 1m2': 1200000,
    'đặt 600k': 600000,
    '600 chốt': 600000,
    'lên 3 lít rưỡi': 350000,
    '1tr rưỡi': 1500000,
    '1 trăm rưỡi': 150000,
    '2 củ rưỡi': 2500000,
    '3m1 🔥🔥': 3100000,
    '3m1!!!': 3100000,
  };
  for (const [comment, expected] of Object.entries(cases)) {
    assert.equal(parseBid(comment), expected, comment);
  }
});

test('parseBid rejects ambiguous or non-bid numbers', () => {
  for (const comment of ['1k2', '3 cái', '2 cm', 'ship 30k', '+100', 'giá bao nhiêu 300k?', '3m1 hay 3m2']) {
    assert.equal(parseBid(comment), null, comment);
  }
});

test('isBuyoutComment recognises "đứt" comments but not questions', () => {
  for (const comment of ['Đứt', 'đứt ạ', 'Em đứt', 'mua đứt', 'Đứt nhé shop', 'chốt đứt']) {
    assert.equal(isBuyoutComment(comment), true, comment);
  }
  for (const comment of ['Ai đứt chưa?', 'sao không ai đứt', 'đẹp quá', '300k']) {
    assert.equal(isBuyoutComment(comment), false, comment);
  }
});

test('parseAuctionPost reads the "Đứt" buy-now label and sold notices', () => {
  const open = parseAuctionPost('Đấu giá RG Zaku\nKhởi điểm 100k\nĐứt: 2tr\nKết thúc 21h 2/11', REFERENCE);
  assert.equal(open.buyNowPrice, 2000000);
  assert.equal(open.soldOut, false);

  const sold = parseAuctionPost('ĐÃ ĐỨT - Đấu giá RG Zaku\nĐứt: 2tr', REFERENCE);
  assert.equal(sold.soldOut, true);
});

test('a bought-out auction is ended and priced at the buy-now price', () => {
  const record = { boughtOut: true, buyNowPrice: 2000000, highestBid: 500000, deadlineAt: REFERENCE + 1e9 };
  assert.equal(isEnded(record, REFERENCE), true);
  assert.equal(highestPrice(record), 2000000);
  assert.equal(isEnded({ deadlineAt: REFERENCE + 1e9 }, REFERENCE), false);
});

const { dedupeRecords } = require('../auction-core.js');

function rec(key, overrides) {
  return { key, groupKey: 'g', postId: '', textKey: 'abc', firstSeenAt: 10, updatedAt: 10, ...overrides };
}

test('dedupeRecords merges a placeholder into the record with the real post id', () => {
  const merged = dedupeRecords({
    'g:tabc': rec('g:tabc', { textKey: undefined, highestBid: 500000, bidCount: 3, firstSeenAt: 5 }),
    'g:123': rec('g:123', { postId: '123', highestBid: 300000, bidCount: 1, textLength: 200, title: 'Đấu giá A' }),
  });
  assert.deepEqual(Object.keys(merged), ['g:123']);
  assert.equal(merged['g:123'].highestBid, 500000);
  assert.equal(merged['g:123'].bidCount, 3);
  assert.equal(merged['g:123'].firstSeenAt, 5);
  assert.equal(merged['g:123'].title, 'Đấu giá A');
});

test('dedupeRecords merges pfbid and numeric records of the same post', () => {
  const merged = dedupeRecords({
    'g:pfbid0x': rec('g:pfbid0x', { postId: 'pfbid0x', boughtOut: true }),
    'g:123': rec('g:123', { postId: '123' }),
  });
  assert.deepEqual(Object.keys(merged), ['g:123']);
  assert.equal(merged['g:123'].boughtOut, true);
});

test('dedupeRecords keeps different numeric posts that share a template', () => {
  const merged = dedupeRecords({
    'g:1': rec('g:1', { postId: '1' }),
    'g:2': rec('g:2', { postId: '2' }),
    'h:3': rec('h:3', { postId: '3', groupKey: 'h' }),
  });
  assert.deepEqual(Object.keys(merged).sort(), ['g:1', 'g:2', 'h:3']);
});

test('unavailable posts count as ended', () => {
  assert.equal(isEnded({ unavailable: true, deadlineAt: REFERENCE + 1e9 }, REFERENCE), true);
});

const { parseLotBid, parseLots, mergeLots, lotsFromBids } = require('../auction-core.js');

const MULTI_LOT_POST = `Bid scan, gậy aba đỏ, book dcd
S1 gậy aba đỏ trạng như video mình ko bao lên chưa test
S2 book dcd ko biết hàng gì như video có hở và khá xấu. Card ko biết hàng gì luôn có 2 lá bị cong
S3 scan ooo hàng gì cũng ko biết ae coi video nha. Lên pin còn scan thì ko biết sao ko có âm
Mọi thứ ko bao gì nữa do mình chỉ biết nhiêu đó thôi
Mỗi s đều đầu 0 nhảy tròn chục
End 22h 2/11
Tỉa dồn 5p lúc 21h50
Win trả ship. Gdtg qua admin ckf cod cọc
Bịp ăn phốt mn cân nhắc`;

test('a multi-lot "Bid ... End 22h 2/11" post is an auction with its deadline and lots', () => {
  assert.equal(isAuctionPost(MULTI_LOT_POST), true);
  const post = parseAuctionPost(MULTI_LOT_POST, REFERENCE);
  assert.equal(post.title, 'Bid scan, gậy aba đỏ, book dcd');
  assert.equal(post.deadline.at, at(2024, 11, 2, 22));
  assert.equal(post.deadline.approximate, false);
  assert.deepEqual(Object.keys(post.lots), ['1', '2', '3']);
  assert.match(post.lots['1'], /^gậy aba đỏ/);
  assert.match(post.lots['3'], /^scan ooo/);
});

test('parseLotBid reads bids that name the lot', () => {
  const cases = {
    'S1 20': ['1', 20000],
    's2 30k': ['2', 30000],
    'S3: 1tr': ['3', 1000000],
    'S1=50': ['1', 50000],
    's1-70': ['1', 70000],
    'S2 80k nha': ['2', 80000],
    'sp1 50 ạ': ['1', 50000],
    'Suất 2 120k': ['2', 120000],
    'slot 3 1m2': ['3', 1200000],
    '#2 60': ['2', 60000],
    'S01 40': ['1', 40000],
    'theo s3 90k': ['3', 90000],
    '50k': ['', 50000],
    '3m1': ['', 3100000],
  };
  for (const [comment, [lot, amount]] of Object.entries(cases)) {
    assert.deepEqual(parseLotBid(comment), { lot, amount }, comment);
  }
});

test('parseLotBid rejects comments naming several lots or no price', () => {
  for (const comment of ['s1 s2 50k', 'S1 đẹp quá', 's3 bao nhiêu?', 'ship s1 30k']) {
    assert.equal(parseLotBid(comment), null, comment);
  }
});

test('parseLots needs at least two lot lines', () => {
  assert.deepEqual(parseLots('Đấu giá\nS1 mô hình A'), {});
});

test('lotsFromBids and mergeLots keep the highest price per lot', () => {
  const lots = lotsFromBids([
    { lot: '1', amount: 20000 },
    { lot: '1', amount: 50000 },
    { lot: '2', amount: 30000 },
    { lot: '', amount: 999000 },
  ]);
  assert.deepEqual(lots, { 1: { highestBid: 50000, bidCount: 2 }, 2: { highestBid: 30000, bidCount: 1 } });
  const merged = mergeLots({ 1: { title: 'gậy', highestBid: 70000, bidCount: 1 } }, lots);
  assert.deepEqual(merged['1'], { title: 'gậy', highestBid: 70000, bidCount: 2 });
});

const { missingInfo, unreadComments, reparseFromSample } = require('../auction-core.js');

test('missingInfo lists what could not be read', () => {
  assert.deepEqual(missingInfo({ postId: '', title: 'x' }), ['link', 'deadline', 'price']);
  assert.deepEqual(missingInfo({ postId: '1', deadlineAt: 1, startPrice: 100000 }), []);
  assert.deepEqual(missingInfo({ postId: '1', deadlineAt: 1, lots: { 1: { highestBid: 20000 } } }), []);
  assert.deepEqual(missingInfo({ postId: '1', boughtOut: true }), []);
});

test('unreadComments keeps numeric comments that are not understood as bids', () => {
  assert.deepEqual(unreadComments(['250k', 'đẹp quá', 'x2 nha', 'Đứt', 'lên 3 lít rưỡi', '2 3 4']), ['x2 nha', '2 3 4']);
});

test('reparseFromSample fills missing info from a saved sample with the current parser', () => {
  const record = { key: 'g:1', postId: '1', firstSeenAt: REFERENCE, highestBid: 50000 };
  const sample = { text: MULTI_LOT_POST, unreadComments: ['S1 80', 'S3: 120k'], capturedAt: REFERENCE };
  const next = reparseFromSample(record, sample);
  assert.equal(next.deadlineAt, at(2024, 11, 2, 22));
  assert.equal(next.lots['1'].highestBid, 80000);
  assert.equal(next.lots['3'].highestBid, 120000);
  assert.equal(next.highestBid, 120000);
  assert.deepEqual(missingInfo(next), []);
});

test('reparseFromSample never overwrites information already read', () => {
  const record = { postId: '1', deadlineAt: 123, startPrice: 999000 };
  const next = reparseFromSample(record, { text: 'Đấu giá, khởi điểm 100k, kết thúc 21h 2/11' });
  assert.equal(next.deadlineAt, 123);
  assert.equal(next.startPrice, 999000);
});
