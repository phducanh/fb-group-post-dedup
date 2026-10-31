'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN_TAB = 7;
const PROFILE = 'https://web.facebook.com/profile.php?id=123';

// Object tạo trong vm có prototype khác realm; so sánh qua JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadBackground() {
  const state = {
    store: {},
    created: [],
    removed: [],
    updated: [],
    sent: [],
    onMessage: null,
    onRemoved: null,
    onUpdated: null,
    onWindowRemoved: null,
    onAlarm: null,
    local: {},
    sync: {},
    windows: [],
    removedWindows: [],
    alarms: [],
  };
  const area = (bucket) => ({
    get: async (keys) =>
      Object.fromEntries([].concat(keys).map((key) => [key, bucket[key]])),
    set: async (values) => Object.assign(bucket, values),
    remove: async (key) => {
      delete bucket[key];
    },
  });
  const chrome = {
    storage: {
      session: area(state.store),
      local: area(state.local),
      sync: area(state.sync),
    },
    windows: {
      create: async (options) => {
        state.windows.push(options);
        return { id: 500, tabs: [{ id: 501 }] };
      },
      remove: async (id) => state.removedWindows.push(id),
      onRemoved: { addListener: (fn) => { state.onWindowRemoved = fn; } },
    },
    alarms: {
      create: async (name, info) => state.alarms.push([name, info]),
      clear: async () => true,
      onAlarm: { addListener: (fn) => { state.onAlarm = fn; } },
    },
    tabs: {
      create: async (options) => {
        state.created.push(options);
        return { id: 100 + state.created.length };
      },
      remove: async (id) => state.removed.push(id),
      update: async (id, props) => state.updated.push([id, props]),
      sendMessage: async (id, message) => state.sent.push([id, message]),
      onRemoved: { addListener: (fn) => { state.onRemoved = fn; } },
      onUpdated: { addListener: (fn) => { state.onUpdated = fn; } },
    },
    runtime: {
      onMessage: { addListener: (fn) => { state.onMessage = fn; } },
      getURL: (file) => `chrome-extension://id/${file}`,
    },
  };
  const context = vm.createContext({ chrome, console, URL, setTimeout });
  context.importScripts = (...files) =>
    files.forEach((file) => vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context));
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), context);

  const send = (message, tabId) =>
    new Promise((resolve) => {
      state.onMessage(message, { tab: tabId === undefined ? undefined : { id: tabId } }, resolve);
    });
  return { state, send };
}

async function startedBlock() {
  const env = loadBackground();
  await env.send({ type: 'startProfileBlock', url: PROFILE, requestId: 'req-1' }, ORIGIN_TAB);
  return { ...env, blockTab: 101 };
}

test('startProfileBlock opens an inactive tab on the clean profile url', async () => {
  const { state, send } = loadBackground();
  const reply = await send(
    { type: 'startProfileBlock', url: `${PROFILE}&__cft__=x`, requestId: 'req-1' },
    ORIGIN_TAB
  );

  assert.equal(reply.ok, true);
  assert.deepEqual(plain(state.created), [{ url: `${PROFILE}#dedup-block`, active: false }]);
});

test('startProfileBlock refuses non-facebook urls and missing sender tabs', async () => {
  const { state, send } = loadBackground();
  const external = await send(
    { type: 'startProfileBlock', url: 'https://evil.example.com/x', requestId: 'r' },
    ORIGIN_TAB
  );
  const noTab = await send({ type: 'startProfileBlock', url: PROFILE, requestId: 'r' });

  assert.equal(external.ok, false);
  assert.equal(noTab.ok, false);
  assert.equal(state.created.length, 0);
});

test('profileBlockHello says run only for the tab the extension opened', async () => {
  const { send, blockTab } = await startedBlock();

  assert.equal((await send({ type: 'profileBlockHello' }, blockTab)).run, true);
  assert.equal((await send({ type: 'profileBlockHello' }, 999)).run, false);
  assert.equal((await send({ type: 'profileBlockHello' })).run, false);
});

test('profileBlockDone success reports to the origin tab and closes the block tab', async () => {
  const { state, send, blockTab } = await startedBlock();
  const reply = await send({ type: 'profileBlockDone', ok: true, message: 'Đã chặn' }, blockTab);

  assert.equal(reply.ok, true);
  assert.deepEqual(plain(state.sent), [
    [ORIGIN_TAB, { type: 'blockResult', requestId: 'req-1', ok: true, message: 'Đã chặn' }],
  ]);
  assert.deepEqual(plain(state.removed), [blockTab]);
  assert.equal((await send({ type: 'profileBlockHello' }, blockTab)).run, false);
});

test('profileBlockDone failure keeps the tab and brings it to the front', async () => {
  const { state, send, blockTab } = await startedBlock();
  await send({ type: 'profileBlockDone', ok: false, message: 'Không thấy menu' }, blockTab);

  assert.equal(state.sent[0][1].ok, false);
  assert.deepEqual(plain(state.removed), []);
  assert.deepEqual(plain(state.updated), [[blockTab, { active: true }]]);
});

test('profileBlockDone from an unknown tab is ignored', async () => {
  const { state, send } = await startedBlock();
  const reply = await send({ type: 'profileBlockDone', ok: true, message: 'x' }, 999);

  assert.equal(reply.ok, false);
  assert.equal(state.sent.length, 0);
  assert.equal(state.removed.length, 0);
});

test('closing the block tab forgets the pending request', async () => {
  const { state, send, blockTab } = await startedBlock();
  await state.onRemoved(blockTab);

  assert.equal((await send({ type: 'profileBlockHello' }, blockTab)).run, false);
});

const SWEEP_TAB = 501;
const GROUP_A = '316605308060947';
const GROUP_B = '426208205081';

function auction(postId, overrides) {
  return {
    key: `${GROUP_A}:${postId}`,
    groupKey: GROUP_A,
    postId,
    url: `https://www.facebook.com/groups/${GROUP_A}/posts/${postId}/`,
    updatedAt: Date.now(),
    deadlineAt: Date.now() + 60 * 60 * 1000,
    ...overrides,
  };
}

async function stepDone(env) {
  await env.send({ type: 'auctionSweepStepDone' }, SWEEP_TAB);
}

async function pageLoaded(env) {
  await env.state.onUpdated(SWEEP_TAB, { status: 'complete' });
}

test('startAuctionSweep opens one window on the first tracked group, sorted by newest', async () => {
  const env = loadBackground();
  const reply = await env.send({ type: 'startAuctionSweep' });

  assert.equal(reply.running, true);
  assert.equal(env.state.windows.length, 1);
  assert.equal(env.state.windows[0].url, `https://www.facebook.com/groups/${GROUP_A}/?sorting_setting=CHRONOLOGICAL`);
  assert.equal(env.state.local.auctionSweepStatus.running, true);

  await env.send({ type: 'startAuctionSweep' });
  assert.equal(env.state.windows.length, 1);
});

test('a recent finished sweep is reused unless forced', async () => {
  const env = loadBackground();
  env.state.local.auctionSweepStatus = { running: false, finishedAt: Date.now() - 60 * 1000 };

  assert.equal((await env.send({ type: 'startAuctionSweep' })).skipped, true);
  assert.equal(env.state.windows.length, 0);
  await env.send({ type: 'startAuctionSweep', force: true });
  assert.equal(env.state.windows.length, 1);
});

function byKey(...records) {
  return Object.fromEntries(records.map((record) => [record.key, record]));
}

test('sweep refreshes known auctions by link, then finds new posts in each group, then reads only the new ones', async () => {
  const env = loadBackground();
  const now = Date.now();
  env.state.local.auctions = byKey(
    auction('1', { deadlineAt: now + 60 * 1000 }),
    auction('2', { deadlineAt: now + 5 * 60 * 60 * 1000 }),
    auction('3', { deepScannedAt: now - 60 * 1000 }),
    auction('4', { deadlineAt: now - 2 * 60 * 60 * 1000, deepScannedAt: now - 60 * 1000 }),
    { ...auction('5'), groupKey: 'someone-else' },
    auction('6', { boughtOut: true }),
    auction('7', { commentsLocked: true }),
    auction('0', { postedAt: now - 6 * 24 * 60 * 60 * 1000 }),
    auction('8', { unavailable: true })
  );
  await env.send({ type: 'startAuctionSweep' });

  // 1) Bài đã có, mở thẳng link: hạn gần nhất trước.
  assert.equal(env.state.windows[0].url, auction('1').url);
  await pageLoaded(env);
  assert.equal(env.state.sent.at(-1)[1].kind, 'known');
  await pageLoaded(env);
  assert.equal(env.state.sent.length, 1);
  await stepDone(env);
  assert.equal(env.state.updated.at(-1)[1].url, auction('2').url);
  await pageLoaded(env);
  await stepDone(env);

  // 2) Quét nhóm tìm bài mới, kèm id các bài đã có để bỏ qua.
  assert.match(env.state.updated.at(-1)[1].url, new RegExp(`/groups/${GROUP_A}/`));
  await pageLoaded(env);
  const groupRun = plain(env.state.sent.at(-1)[1]);
  assert.equal(groupRun.mode, 'group');
  assert.deepEqual([...groupRun.knownIds].sort(), ['0', '1', '2', '3', '4', '6', '7', '8']);
  env.state.local.auctions[auction('9').key] = auction('9');
  await stepDone(env);
  assert.match(env.state.updated.at(-1)[1].url, new RegExp(`/groups/${GROUP_B}/`));
  await pageLoaded(env);
  await stepDone(env);

  // 3) Chỉ mở bài mới tìm thấy; bài đã mở ở bước 1 không mở lại.
  assert.equal(env.state.updated.at(-1)[1].url, auction('9').url);
  await pageLoaded(env);
  assert.equal(env.state.sent.at(-1)[1].kind, 'new');
  await stepDone(env);

  assert.deepEqual(plain(env.state.removedWindows), [500]);
  assert.equal(env.state.local.auctionSweepStatus.running, false);
  assert.equal(env.state.local.auctionSweepStatus.result, 'done');
});

test('a post whose link shows "content unavailable" is marked unavailable', async () => {
  const env = loadBackground();
  env.state.local.auctions = byKey(auction('1'));
  await env.send({ type: 'startAuctionSweep' });
  await pageLoaded(env);
  await env.send({ type: 'auctionSweepStepDone', unavailable: true }, SWEEP_TAB);

  assert.equal(env.state.local.auctions[auction('1').key].unavailable, true);
});

test('posts without a link are looked up with the group search before scanning groups', async () => {
  const env = loadBackground();
  const searchUrl = `https://www.facebook.com/groups/${GROUP_A}/search/?q=abc`;
  env.state.local.auctions = byKey({ ...auction('', { textKey: 'abc' }), key: `${GROUP_A}:tabc`, url: searchUrl });
  await env.send({ type: 'startAuctionSweep' });

  assert.equal(env.state.windows[0].url, searchUrl);
  await pageLoaded(env);
  assert.equal(env.state.sent.at(-1)[1].mode, 'search');
  await stepDone(env);
  assert.match(env.state.updated.at(-1)[1].url, new RegExp(`/groups/${GROUP_A}/\\?sorting`));
});

test('saved content samples are re-read with the current parser when a sweep starts', async () => {
  const env = loadBackground();
  const record = auction('1', { deadlineAt: null, firstSeenAt: Date.now() });
  env.state.local.auctions = byKey(record);
  env.state.local.auctionSamples = {
    [record.key]: { key: record.key, text: 'Bid gậy\nEnd 22h 2/11', unreadComments: ['S1 20'], capturedAt: Date.now() },
  };
  await env.send({ type: 'startAuctionSweep' });

  assert.ok(env.state.local.auctions[record.key].deadlineAt > 0);
});

test('duplicate records of the same post are merged when a sweep starts', async () => {
  const env = loadBackground();
  env.state.local.auctions = byKey(
    { ...auction('', { textKey: 'abc', highestBid: 900000 }), key: `${GROUP_A}:tabc` },
    auction('1', { textKey: 'abc', highestBid: 500000 })
  );
  await env.send({ type: 'startAuctionSweep' });

  assert.deepEqual(Object.keys(env.state.local.auctions), [auction('1').key]);
  assert.equal(env.state.local.auctions[auction('1').key].highestBid, 900000);
});

test('step reports from other tabs are ignored', async () => {
  const env = loadBackground();
  await env.send({ type: 'startAuctionSweep' });
  await pageLoaded(env);

  assert.equal((await env.send({ type: 'auctionSweepStepDone' }, 999)).ok, false);
  assert.equal(env.state.updated.length, 0);
});

test('closing the sweep window stops the sweep', async () => {
  const env = loadBackground();
  await env.send({ type: 'startAuctionSweep' });
  await env.state.onWindowRemoved(500);

  assert.equal(env.state.local.auctionSweepStatus.result, 'stopped');
  assert.equal((await env.send({ type: 'startAuctionSweep', force: true })).running, true);
  assert.equal(env.state.windows.length, 2);
});

test('the watchdog alarm skips a stuck step', async () => {
  const env = loadBackground();
  await env.send({ type: 'startAuctionSweep' });
  await pageLoaded(env);
  await env.state.onAlarm({ name: 'auctionSweepWatchdog' });

  assert.match(env.state.updated.at(-1)[1].url, new RegExp(`/groups/${GROUP_B}/`));
});
