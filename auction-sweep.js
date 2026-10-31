'use strict';

// Quét tự động bài đấu giá (chạy trong service worker). Mở một cửa sổ nhỏ, lần lượt mở
// từng nhóm theo dõi (auction.js tự cuộn để lấy bài), rồi từng bài còn hạn (auction.js mở
// hết bình luận để lấy giá cao nhất), xong thì đóng cửa sổ. Cửa sổ phải hiện trên màn hình:
// tab nền hay cửa sổ thu nhỏ bị Chrome ngừng vẽ nên Facebook không tải thêm bài.
// Trạng thái giữ trong storage.session vì service worker có thể bị dừng giữa chừng.
(function (root) {
  const STATE_KEY = 'auctionSweep';
  const STATUS_KEY = 'auctionSweepStatus';
  const AUCTIONS_KEY = 'auctions';
  const GROUPS_KEY = 'auctionGroups';
  const SETTINGS_KEYS = ['auctionMaxAgeDays', 'auctionSkipLocked'];
  const DEFAULT_GROUPS = ['316605308060947', '426208205081'];
  const WATCHDOG_ALARM = 'auctionSweepWatchdog';
  const STEP_TIMEOUT_MIN = { group: 4, post: 2, search: 2 };
  const SAMPLES_KEY = 'auctionSamples';
  // Bài chưa có id: tối đa chừng này lượt tìm link trong một lượt quét.
  const MAX_SEARCHES_PER_SWEEP = 10;
  const MAX_POSTS_PER_SWEEP = 40;
  // Mở danh sách lại trong khoảng này thì dùng kết quả vừa quét, không quét lại.
  const FRESH_MS = 10 * 60 * 1000;
  const ENDED_GRACE_MS = 30 * 60 * 1000;
  const SEND_RETRIES = 3;
  const SEND_RETRY_MS = 2000;
  const WINDOW_SIZE = { width: 520, height: 820 };

  async function readState() {
    const stored = await chrome.storage.session.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function writeState(state) {
    if (state) await chrome.storage.session.set({ [STATE_KEY]: state });
    else await chrome.storage.session.remove(STATE_KEY);
  }

  async function readStatus() {
    const stored = await chrome.storage.local.get(STATUS_KEY);
    return stored[STATUS_KEY] || {};
  }

  async function setStatus(status) {
    await chrome.storage.local.set({ [STATUS_KEY]: { ...status, updatedAt: Date.now() } });
  }

  async function readGroups() {
    const stored = await chrome.storage.sync.get(GROUPS_KEY);
    const groups = stored[GROUPS_KEY];
    return Array.isArray(groups) && groups.length > 0 ? groups.map(String) : DEFAULT_GROUPS;
  }

  function groupStep(group) {
    return {
      mode: 'group',
      group,
      url: `https://www.facebook.com/groups/${encodeURIComponent(group)}/?sorting_setting=CHRONOLOGICAL`,
    };
  }

  // Bài đang diễn ra (hoặc chưa đọc được hạn): đọc lại nếu lần đọc kỹ gần nhất đã cũ.
  // Bài đã kết thúc: chỉ đọc thêm một lần sau hạn để lấy giá chốt.
  function needsDeepScan(record, now) {
    const deep = record.deepScannedAt || 0;
    if (record.deadlineAt && record.deadlineAt < now - ENDED_GRACE_MS) return deep < record.deadlineAt;
    return deep < now - FRESH_MS;
  }

  function priority(record, now) {
    if (!record.deadlineAt) return [1, -record.updatedAt];
    if (record.deadlineAt < now - ENDED_GRACE_MS) return [2, -record.deadlineAt];
    return [0, record.deadlineAt];
  }

  // Bài không cần mở: chưa có id (chỉ có link tìm kiếm), đã có người mua đứt, đã bị xoá, hoặc bị bỏ qua
  // theo cài đặt (khoá bình luận, đăng quá số ngày tối đa).
  function isWorthOpening(record, groups, settings, now, records) {
    if (!record.postId || record.boughtOut || record.unavailable || !groups.includes(record.groupKey)) return false;
    return !root.AuctionCore.isExcluded(record, settings, now, records) && needsDeepScan(record, now);
  }

  // Đọc danh sách, gộp các bản ghi trùng của cùng một bài, và đọc lại mẫu nội dung đã lưu
  // của bài còn thiếu thông tin bằng bộ đọc hiện tại (ghi lại nếu có thay đổi).
  async function readRecords() {
    const stored = await chrome.storage.local.get([AUCTIONS_KEY, SAMPLES_KEY]);
    const records = stored[AUCTIONS_KEY] || {};
    const samples = stored[SAMPLES_KEY] || {};
    const { dedupeRecords, reparseFromSample } = root.AuctionCore;
    const updated = Object.fromEntries(
      Object.entries(records).map(([key, record]) => [key, reparseFromSample(record, samples[key])])
    );
    const deduped = dedupeRecords(updated);
    if (JSON.stringify(deduped) !== JSON.stringify(records)) {
      await chrome.storage.local.set({ [AUCTIONS_KEY]: deduped });
    }
    return deduped;
  }

  // Bài chưa có id (chỉ có link tìm kiếm trong nhóm): mở trang tìm kiếm để lấy link thật.
  async function searchSteps(groups, now) {
    const settings = root.AuctionCore.readSettings(await chrome.storage.sync.get(SETTINGS_KEYS));
    const records = Object.values(await readRecords());
    return records
      .filter(
        (record) =>
          !record.postId &&
          groups.includes(record.groupKey) &&
          !record.boughtOut &&
          !root.AuctionCore.isExcluded(record, settings, now, records)
      )
      .slice(0, MAX_SEARCHES_PER_SWEEP)
      .map((record) => ({ mode: 'search', kind: 'search', key: record.key, group: record.groupKey, url: record.url }));
  }

  // kind: 'known' = bài đã có trong danh sách, mở link để cập nhật trạng thái mới nhất;
  // 'new' = bài vừa tìm thấy khi quét nhóm. skipKeys: bài đã mở trong lượt quét này.
  async function postSteps(groups, now, kind, skipKeys = []) {
    const settings = root.AuctionCore.readSettings(await chrome.storage.sync.get(SETTINGS_KEYS));
    const records = Object.values(await readRecords());
    return records
      .filter((record) => !skipKeys.includes(record.key) && isWorthOpening(record, groups, settings, now, records))
      .sort((a, b) => {
        const [rankA, keyA] = priority(a, now);
        const [rankB, keyB] = priority(b, now);
        return rankA - rankB || keyA - keyB;
      })
      .slice(0, MAX_POSTS_PER_SWEEP)
      .map((record) => ({
        mode: 'post',
        kind,
        key: record.key,
        group: record.groupKey,
        postId: record.postId,
        url: record.url,
      }));
  }

  // Bước quét nhóm mang theo id các bài đã có để auction.js bỏ qua và biết lúc thôi cuộn.
  async function groupSteps(groups) {
    const records = Object.values(await readRecords());
    return groups.map((group) => ({
      ...groupStep(group),
      knownIds: records
        .filter((record) => record.groupKey === group && /^\d+$/.test(record.postId || ''))
        .map((record) => record.postId),
    }));
  }

  const PHASES = {
    known: 'Đang cập nhật bài đã có',
    search: 'Đang tìm link bài',
    group: 'Đang tìm bài mới trong nhóm',
    new: 'Đang đọc bài mới',
  };

  function describe(state) {
    const step = state.steps[state.index];
    const kind = step.mode === 'group' ? 'group' : step.kind;
    const sameKind = state.steps.filter((item) => (item.mode === 'group' ? 'group' : item.kind) === kind);
    return `${PHASES[kind]} ${sameKind.indexOf(step) + 1}/${sameKind.length}`;
  }

  async function start({ force = false } = {}) {
    const current = await readState();
    if (current && current.running) return { ok: true, running: true };
    const status = await readStatus();
    if (!force && status.finishedAt && status.finishedAt > Date.now() - FRESH_MS) {
      return { ok: true, skipped: true };
    }

    // Cập nhật bài đã có qua link trước, rồi mới quét nhóm để tìm bài mới.
    const groups = await readGroups();
    const known = await postSteps(groups, Date.now(), 'known');
    const searches = await searchSteps(groups, Date.now());
    const steps = [...known, ...searches, ...(await groupSteps(groups))];
    const win = await chrome.windows.create({
      url: steps[0].url,
      type: 'popup',
      focused: true,
      ...WINDOW_SIZE,
    });
    const state = {
      running: true,
      windowId: win.id,
      tabId: win.tabs[0].id,
      steps,
      index: 0,
      postsAdded: false,
      stepStarted: false,
      startedAt: Date.now(),
    };
    await writeState(state);
    await setStatus({ running: true, phase: 'Đang mở Facebook…', startedAt: state.startedAt });
    return { ok: true, running: true };
  }

  async function finish(result) {
    const state = await readState();
    await writeState(null);
    await chrome.alarms.clear(WATCHDOG_ALARM);
    if (state) {
      try {
        await chrome.windows.remove(state.windowId);
      } catch (_error) {
        // Người dùng đã tự đóng cửa sổ quét.
      }
    }
    await setStatus({
      running: false,
      result,
      startedAt: state ? state.startedAt : undefined,
      finishedAt: Date.now(),
    });
  }

  async function sendRun(state) {
    const step = state.steps[state.index];
    for (let attempt = 0; attempt < SEND_RETRIES; attempt += 1) {
      try {
        await chrome.tabs.sendMessage(state.tabId, { type: 'auctionSweepRun', ...step });
        return true;
      } catch (_error) {
        // Content script chưa sẵn sàng (trang vừa tải xong): thử lại sau chút.
        await new Promise((resolve) => setTimeout(resolve, SEND_RETRY_MS));
      }
    }
    return false;
  }

  async function runStep(state) {
    const step = state.steps[state.index];
    await writeState({ ...state, stepStarted: true });
    await chrome.alarms.create(WATCHDOG_ALARM, { delayInMinutes: STEP_TIMEOUT_MIN[step.mode] });
    await setStatus({ running: true, phase: describe(state), startedAt: state.startedAt });
    if (!(await sendRun(state))) await advance();
  }

  async function advance() {
    const state = await readState();
    if (!state || !state.running) return;
    await chrome.alarms.clear(WATCHDOG_ALARM);

    const steps = [...state.steps];
    let { postsAdded } = state;
    const index = state.index + 1;
    // Quét xong các nhóm mới biết bài mới nào cần đọc kỹ; bài đã mở ở đầu lượt thì bỏ qua.
    if (index >= steps.length && !postsAdded) {
      const opened = steps.filter((step) => step.mode === 'post').map((step) => step.key);
      steps.push(...(await postSteps(await readGroups(), Date.now(), 'new', opened)));
      postsAdded = true;
    }
    if (index >= steps.length) return finish('done');

    await writeState({ ...state, steps, index, postsAdded, stepStarted: false });
    try {
      await chrome.tabs.update(state.tabId, { url: steps[index].url });
    } catch (_error) {
      await finish('stopped');
    }
  }

  async function onTabUpdated(tabId, info) {
    if (info.status !== 'complete') return;
    const state = await readState();
    if (!state || !state.running || state.tabId !== tabId || state.stepStarted) return;
    await runStep(state);
  }

  // Link bài báo "nội dung không hiển thị": bài đã bị xoá hoặc ẩn, coi như đã kết thúc.
  async function markUnavailable(key) {
    const stored = (await chrome.storage.local.get(AUCTIONS_KEY))[AUCTIONS_KEY] || {};
    if (!stored[key]) return;
    const now = Date.now();
    const record = { ...stored[key], unavailable: true, deepScannedAt: now, updatedAt: now };
    await chrome.storage.local.set({ [AUCTIONS_KEY]: { ...stored, [key]: record } });
  }

  // Chỉ tab quét do extension mở mới được báo xong bước.
  async function onStepDone(sender, message = {}) {
    const state = await readState();
    if (!state || !sender.tab || sender.tab.id !== state.tabId) return { ok: false };
    const step = state.steps[state.index];
    if (message.unavailable && step && step.mode === 'post') await markUnavailable(step.key);
    await advance();
    return { ok: true };
  }

  async function onWindowRemoved(windowId) {
    const state = await readState();
    if (!state || state.windowId !== windowId) return;
    await writeState(null);
    await chrome.alarms.clear(WATCHDOG_ALARM);
    await setStatus({ running: false, result: 'stopped', startedAt: state.startedAt, finishedAt: Date.now() });
  }

  async function onAlarm(alarm) {
    if (alarm.name === WATCHDOG_ALARM) await advance();
  }

  async function stop() {
    await finish('stopped');
    return { ok: true };
  }

  root.AuctionSweep = { start, stop, onStepDone, onTabUpdated, onWindowRemoved, onAlarm, needsDeepScan };
})(globalThis);
