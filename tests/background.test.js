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
  };
  const chrome = {
    storage: {
      session: {
        get: async (key) => ({ [key]: state.store[key] }),
        set: async (values) => Object.assign(state.store, values),
      },
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
    },
    runtime: { onMessage: { addListener: (fn) => { state.onMessage = fn; } } },
  };
  const context = vm.createContext({ chrome, console, URL });
  context.importScripts = (file) =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context);
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
