(function () {
  'use strict';

  const {
    highestPrice,
    compareNewest,
    isEnded,
    isExcluded,
    readSettings,
    dedupeRecords,
    missingInfo,
    scrapedFacts,
    productName,
    reparseFromSample,
    applyManual,
    parseAmount,
    postIdFromLink,
  } = globalThis.AuctionCore;

  const STORAGE_KEY = 'auctions';
  const GROUPS_KEY = 'auctionGroups';
  const DEFAULT_GROUPS = ['316605308060947', '426208205081'];
  const HIDE_ENDED_KEY = 'auctionsHideEnded';
  const SORT_KEY = 'auctionsSort';
  const AUTO_SWEEP_KEY = 'auctionsAutoSweep';
  const SWEEP_STATUS_KEY = 'auctionSweepStatus';
  const SAMPLES_KEY = 'auctionSamples';
  const FINISHED_KEY = 'auctionFinished';
  const MISSING_LABELS = { link: 'link bài', content: 'chưa đọc đủ bài (Xem thêm)', deadline: 'hạn kết thúc', price: 'giá' };
  const SAMPLE_PREVIEW_LIMIT = 1500;
  const EXCERPT_LIMIT = 160;
  const MAX_AGE_KEY = 'auctionMaxAgeDays';
  const SKIP_LOCKED_KEY = 'auctionSkipLocked';
  const SOON_MS = 3 * 60 * 60 * 1000;
  const REFRESH_MS = 30 * 1000;
  const MINUTE_MS = 60 * 1000;
  const HOUR_MS = 60 * MINUTE_MS;
  const DAY_MS = 24 * HOUR_MS;

  const nodes = {
    rows: document.getElementById('rows'),
    empty: document.getElementById('empty'),
    summary: document.getElementById('summary'),
    hideEnded: document.getElementById('hideEnded'),
    groupsInput: document.getElementById('groupsInput'),
    groupLinks: document.getElementById('groupLinks'),
    sweepStatus: document.getElementById('sweepStatus'),
    sweepNow: document.getElementById('sweepNow'),
    sweepStop: document.getElementById('sweepStop'),
    autoSweep: document.getElementById('autoSweep'),
    sort: document.getElementById('sort'),
    maxAgeDays: document.getElementById('maxAgeDays'),
    skipLocked: document.getElementById('skipLocked'),
    samplesSection: document.getElementById('samplesSection'),
    samplesCount: document.getElementById('samplesCount'),
    samples: document.getElementById('samples'),
    copyStatus: document.getElementById('copyStatus'),
    editor: document.getElementById('editor'),
    editorForm: document.getElementById('editorForm'),
    editorTitle: document.getElementById('editorTitle'),
    editorLinkField: document.getElementById('editorLinkField'),
    editorLink: document.getElementById('editorLink'),
    editorDeadline: document.getElementById('editorDeadline'),
    editorPrice: document.getElementById('editorPrice'),
    editorStartPrice: document.getElementById('editorStartPrice'),
    editorBuyNow: document.getElementById('editorBuyNow'),
    editorProduct: document.getElementById('editorProduct'),
    editorDone: document.getElementById('editorDone'),
    editorError: document.getElementById('editorError'),
  };
  // Khoá bài đang mở trong hộp nhập tay.
  let editingKey = null;
  let samples = [];
  let records = [];
  let settings = readSettings({});

  const moneyFormat = new Intl.NumberFormat('vi-VN');
  const dateFormat = new Intl.DateTimeFormat('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  function readFlag(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value === '1';
    } catch (_error) {
      return fallback;
    }
  }

  function writeFlag(key, value) {
    try {
      localStorage.setItem(key, value ? '1' : '0');
    } catch (_error) {
      // Không lưu được thì chỉ mất lựa chọn khi mở lại trang.
    }
  }

  function formatMoney(value) {
    return Number.isFinite(value) ? `${moneyFormat.format(value)} ₫` : '';
  }

  function formatCountdown(ms) {
    if (ms <= 0) return 'Đã kết thúc';
    if (ms < HOUR_MS) return `Còn ${Math.ceil(ms / MINUTE_MS)} phút`;
    if (ms < DAY_MS) return `Còn ${Math.floor(ms / HOUR_MS)} giờ ${Math.floor((ms % HOUR_MS) / MINUTE_MS)} phút`;
    return `Còn ${Math.floor(ms / DAY_MS)} ngày ${Math.floor((ms % DAY_MS) / HOUR_MS)} giờ`;
  }

  // Đang diễn ra (hạn gần nhất trước) -> không đọc được hạn -> đã kết thúc (mới kết thúc trước).
  function compareByDeadline(now) {
    const rank = (record) => (isEnded(record, now) ? 2 : record.deadlineAt ? 0 : 1);
    return (a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      if (rank(a) === 0) return a.deadlineAt - b.deadlineAt;
      if (rank(a) === 2) return (b.deadlineAt || 0) - (a.deadlineAt || 0);
      return b.updatedAt - a.updatedAt;
    };
  }

  function compareRecords(now) {
    return nodes.sort.value === 'deadline' ? compareByDeadline(now) : compareNewest;
  }

  function readSort() {
    try {
      return localStorage.getItem(SORT_KEY) || 'deadline';
    } catch (_error) {
      return 'deadline';
    }
  }

  function writeSort(value) {
    try {
      localStorage.setItem(SORT_KEY, value);
    } catch (_error) {
      // Không lưu được thì chỉ mất lựa chọn khi mở lại trang.
    }
  }

  function cell(className) {
    const td = document.createElement('td');
    if (className) td.className = className;
    return td;
  }

  function sub(text) {
    const span = document.createElement('span');
    span.className = 'sub';
    span.textContent = text;
    return span;
  }

  function formatAgo(ms) {
    if (ms < HOUR_MS) return `${Math.max(1, Math.round(ms / MINUTE_MS))} phút trước`;
    if (ms < DAY_MS) return `${Math.round(ms / HOUR_MS)} giờ trước`;
    return `${Math.round(ms / DAY_MS)} ngày trước`;
  }

  function whenCell(record, now) {
    const td = cell('when');
    if (record.boughtOut || record.unavailable || record.done) {
      const sold = document.createElement('span');
      sold.className = 'sold';
      sold.textContent = record.boughtOut
        ? 'Đã có người mua đứt'
        : record.unavailable
          ? 'Bài đã bị xoá hoặc ẩn'
          : 'Đã đánh dấu xong';
      td.append(sold);
      if (record.deadlineAt) td.append(sub(`Hạn: ${dateFormat.format(record.deadlineAt)}`));
      return td;
    }
    if (!record.deadlineAt) {
      td.textContent = 'Không đọc được hạn';
      td.append(
        sub(record.truncated ? 'Mới đọc được phần đầu bài (Xem thêm), hạn có thể nằm ở phần sau' : 'Mở bài để xem, hoặc bấm Nhập tay')
      );
      return td;
    }
    td.textContent = `${record.deadlineApproximate ? '≈ ' : ''}${dateFormat.format(record.deadlineAt)}`;
    const countdown = sub(formatCountdown(record.deadlineAt - now));
    countdown.classList.add('countdown');
    td.append(countdown);
    if (record.deadlineRaw) td.title = record.deadlineRaw;
    return td;
  }

  function lotEntries(record) {
    return Object.entries(record.lots || {}).sort(([a], [b]) => Number(a) - Number(b));
  }

  // Bài nhiều món: mỗi suất một dòng "S1: 50.000 ₫ · 2 lượt — tên món".
  function lotsPriceCell(td, record) {
    const entries = lotEntries(record);
    td.textContent = `${entries.length} suất`;
    entries.forEach(([lot, info]) => {
      const price = info.highestBid ? `${formatMoney(info.highestBid)} · ${info.bidCount} lượt` : 'chưa có giá';
      td.append(sub(`S${lot}: ${price}${info.title ? ` — ${info.title}` : ''}`));
    });
  }

  function priceCell(record) {
    const td = cell('price');
    const highest = highestPrice(record);
    if (lotEntries(record).length > 0 && !record.boughtOut) {
      lotsPriceCell(td, record);
    } else if (record.manual && record.manual.price) {
      td.textContent = formatMoney(highest);
      td.append(sub('Nhập tay'));
      // Quét được giá cao hơn giá nhập tay: có thể đã có người trả thêm.
      if (record.scannedPrice > highest) td.append(sub(`Quét thấy: ${formatMoney(record.scannedPrice)}`));
    } else if (highest) {
      td.textContent = formatMoney(highest);
      td.append(sub(record.bidCount ? `${record.bidCount} lượt trả giá đã thấy` : 'Theo giá ghi trong bài'));
    } else if (record.startPrice != null) {
      td.textContent = formatMoney(record.startPrice);
      td.append(sub('Giá khởi điểm, chưa thấy ai trả'));
    } else {
      td.textContent = '—';
    }
    if (record.buyNowPrice) td.append(sub(`Mua ngay: ${formatMoney(record.buyNowPrice)}`));
    td.append(
      sub(
        record.deepScannedAt
          ? `Kiểm tra qua link ${formatAgo(Date.now() - record.deepScannedAt)}`
          : 'Chưa mở link bài để kiểm tra'
      )
    );
    return td;
  }

  function postCell(record) {
    const td = cell();
    const link = document.createElement('a');
    link.href = record.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = record.title || `Bài ${record.postId}`;
    td.append(link);
    if (!record.postId) td.append(sub('Chưa lấy được link bài: link mở tìm kiếm trong nhóm'));
    const byline = [record.authorName, record.postedAt ? `đăng ${formatAgo(Date.now() - record.postedAt)}` : '']
      .filter(Boolean)
      .join(' · ');
    if (byline) td.append(sub(byline));
    return td;
  }

  function productCell(record) {
    const td = productNameCell(record);
    // Mỗi tình trạng một dòng, hiện đủ không cắt.
    String(record.condition || '')
      .split(' | ')
      .filter(Boolean)
      .forEach((condition) => td.append(sub(`Tình trạng: ${condition}`)));
    return td;
  }

  function productNameCell(record) {
    const td = cell('product');
    if (record.product) {
      td.textContent = record.product;
      return td;
    }
    if (!record.truncated) {
      td.textContent = '—';
      return td;
    }
    // Bài mới đọc được phần đầu: vẫn liệt kê những gì đọc được, đánh dấu là tạm để không nhầm với tên chắc chắn.
    const guess = productName(record.text || '');
    if (guess) {
      td.textContent = guess;
      td.classList.add('provisional');
      td.append(sub('Tạm đoán từ phần đầu bài, có thể chưa đúng'));
    } else {
      td.textContent = '—';
    }
    const excerpt = String(record.text || '').replace(/\s+/g, ' ').trim();
    if (excerpt) td.append(sub(`Đọc được: ${excerpt.slice(0, EXCERPT_LIMIT)}${excerpt.length > EXCERPT_LIMIT ? '…' : ''}`));
    return td;
  }

  function renderRow(record, now) {
    const tr = document.createElement('tr');
    if (isEnded(record, now)) tr.className = 'ended';
    else if (record.deadlineAt && record.deadlineAt - now < SOON_MS) tr.className = 'soon';
    const group = cell();
    group.textContent = record.groupName || record.groupKey;
    tr.append(whenCell(record, now), priceCell(record), productCell(record), postCell(record), group, editCell(record));
    return tr;
  }

  function editButton(record, className) {
    const button = document.createElement('button');
    button.type = 'button';
    if (className) button.className = className;
    // Còn thiếu thông tin thì nhắc nhập tay; đã nhập rồi thì cho sửa.
    button.textContent = record.manual ? 'Sửa nhập tay' : 'Nhập tay';
    if (!record.manual && missingInfo(record).length > 0) button.classList.add('primary');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      openEditor(record.key);
    });
    return button;
  }

  function editCell(record) {
    const td = cell('edit');
    td.append(editButton(record));
    if (record.manual) td.append(sub('Có thông tin nhập tay'));
    return td;
  }

  function render() {
    const now = Date.now();
    const hideEnded = nodes.hideEnded.checked;
    // Bài bị bỏ qua theo cài đặt vẫn được giữ trong máy: đổi cài đặt là hiện lại.
    const included = records.filter((record) => !isExcluded(record, settings, now, records));
    const visible = included
      .filter((record) => !(hideEnded && isEnded(record, now)))
      .sort(compareRecords(now));
    nodes.rows.replaceChildren(...visible.map((record) => renderRow(record, now)));
    nodes.empty.hidden = visible.length > 0;

    const running = included.filter((record) => record.deadlineAt && !isEnded(record, now)).length;
    const skipped = records.length - included.length;
    const skippedText = skipped ? ` · ẩn ${skipped} bài (khoá bình luận / quá ${settings.maxAgeDays} ngày)` : '';
    nodes.summary.textContent = `${included.length} bài · ${running} bài đang diễn ra${skippedText}`;
  }

  function renderGroups(groups) {
    nodes.groupsInput.value = groups.join('\n');
    nodes.groupLinks.replaceChildren(
      ...groups.map((group) => {
        const link = document.createElement('a');
        link.href = `https://www.facebook.com/groups/${encodeURIComponent(group)}/`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = `Mở nhóm ${group}`;
        return link;
      })
    );
  }

  // Nhận cả link nhóm dán vào lẫn id/tên trần.
  function parseGroups(text) {
    const groups = text
      .split(/\s+/)
      .map((line) => {
        const match = line.match(/\/groups\/([^/?#]+)/);
        return (match ? match[1] : line).trim();
      })
      .filter(Boolean);
    return [...new Set(groups)];
  }

  function toCsvField(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportCsv() {
    const now = Date.now();
    const header = ['Kết thúc', 'Ước lượng', 'Giá cao nhất', 'Lượt trả giá', 'Giá khởi điểm', 'Mua ngay', 'Sản phẩm', 'Tình trạng', 'Bài', 'Người đăng', 'Nhóm', 'Link'];
    const lines = [...records].sort(compareRecords(now)).map((record) =>
      [
        record.deadlineAt ? dateFormat.format(record.deadlineAt) : '',
        record.deadlineApproximate ? 'có' : '',
        lotEntries(record).length
          ? lotEntries(record)
              .map(([lot, info]) => `S${lot} ${info.highestBid || 0}`)
              .join('; ')
          : highestPrice(record) || '',
        record.bidCount || 0,
        record.startPrice ?? '',
        record.buyNowPrice || '',
        record.product,
        record.condition,
        record.title,
        record.authorName,
        record.groupName || record.groupKey,
        record.url,
      ].map(toCsvField).join(',')
    );
    // BOM để Excel đọc đúng tiếng Việt.
    const blob = new Blob([`﻿${[header.join(','), ...lines].join('\n')}`], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `dau-gia-${new Date(now).toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function missingText(record, sample) {
    const missing = missingInfo(record).map((item) => MISSING_LABELS[item]);
    if (sample.unreadComments.length) missing.push(`${sample.unreadComments.length} comment chưa đọc được`);
    return missing.join(', ');
  }

  // Các thông tin đã đọc được của bài (một dòng mỗi mục) để thấy ngay mà không phải bung bài ra.
  function sampleFacts(record, sample) {
    const facts = scrapedFacts(record, sample.text, sample.capturedAt);
    const lines = [];
    if (facts.product) lines.push(`Sản phẩm: ${facts.product}${facts.isProductProvisional ? ' (tạm đoán từ phần đầu bài)' : ''}`);
    facts.conditions.forEach((condition) => lines.push(`Tình trạng: ${condition}`));
    if (facts.lotCount > 0) lines.push(`Bài nhiều món: ${facts.lotCount} suất`);
    if (facts.deadlineAt) lines.push(`Hạn: ${facts.deadlineApproximate ? '≈ ' : ''}${dateFormat.format(facts.deadlineAt)}`);
    if (facts.startPrice != null) lines.push(`Giá khởi điểm: ${formatMoney(facts.startPrice)}`);
    if (facts.price) lines.push(`Giá hiện tại: ${formatMoney(facts.price)}${facts.bidCount ? ` (${facts.bidCount} lượt trả giá)` : ''}`);
    if (facts.buyNowPrice) lines.push(`Mua ngay: ${formatMoney(facts.buyNowPrice)}`);
    if (facts.boughtOut) lines.push('Đã có người mua đứt');
    const byline = [facts.authorName, facts.groupName].filter(Boolean).join(' · ');
    if (byline) lines.push(`Đăng bởi: ${byline}`);
    return lines;
  }

  function renderSamples(byKey) {
    nodes.samplesSection.hidden = samples.length === 0;
    nodes.samplesCount.textContent = String(samples.length);
    nodes.samples.replaceChildren(
      ...samples.map((sample) => {
        const record = byKey[sample.key] || { postId: '' };
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = sample.title || sample.url;
        const missing = document.createElement('span');
        missing.className = 'missing';
        missing.textContent = ` — thiếu: ${missingText(record, sample) || 'không'}`;
        // Link nằm ngay trên dòng tóm tắt để mở bài mà không cần bung ra.
        const link = document.createElement('a');
        link.className = 'sample-link';
        link.href = sample.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Mở bài';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'sample-delete danger';
        remove.textContent = 'Xóa';
        remove.addEventListener('click', (event) => {
          // Không để cú bấm bung/thu gọn bài.
          event.preventDefault();
          deleteSample(sample.key);
        });
        summary.append(missing, link);
        if (record.key) summary.append(editButton(record, 'sample-edit'));
        summary.append(remove);
        const facts = sampleFacts(record, sample);
        if (facts.length) {
          const list = document.createElement('div');
          list.className = 'sample-facts';
          facts.forEach((line) => list.append(sub(line)));
          summary.append(list);
        }

        const content = document.createElement('pre');
        content.textContent = sample.text.slice(0, SAMPLE_PREVIEW_LIMIT) || '(không đọc được nội dung bài)';
        details.append(summary, content);

        if (sample.unreadComments.length) {
          details.append(sub('Comment có số chưa đọc được thành giá:'));
          const list = document.createElement('ul');
          sample.unreadComments.forEach((comment) => {
            const item = document.createElement('li');
            item.textContent = comment;
            list.append(item);
          });
          details.append(list);
        }
        return details;
      })
    );
  }

  function sampleReport() {
    const byKey = Object.fromEntries(records.map((record) => [record.key, record]));
    return samples
      .map((sample) =>
        [
          `=== ${sample.title || '(không có tiêu đề)'}`,
          sample.url,
          `Thiếu: ${missingText(byKey[sample.key] || { postId: '' }, sample) || 'không'}`,
          ...sampleFacts(byKey[sample.key] || { postId: '' }, sample).map((line) => `Đọc được — ${line}`),
          `Số comment đã đọc: ${sample.commentCount}`,
          ...(sample.picked ? [`Bài chính: ${sample.picked} (${sample.postRoots} khối)`] : []),
          '--- Nội dung bài:',
          sample.text,
          ...(sample.unreadComments.length
            ? ['--- Comment có số chưa đọc được:', ...sample.unreadComments.map((comment) => `- ${comment}`)]
            : []),
        ].join('\n')
      )
      .join('\n\n');
  }

  // Bản ghi hiển thị = bản đã lưu, gộp trùng, đọc lại mẫu nội dung bằng bộ đọc hiện tại,
  // rồi phủ thông tin nhập tay.
  function loadRecords() {
    chrome.storage.local.get([STORAGE_KEY, SAMPLES_KEY], (stored) => {
      if (chrome.runtime.lastError) return;
      const saved = stored[SAMPLES_KEY] || {};
      const byKey = dedupeRecords(stored[STORAGE_KEY] || {});
      Object.keys(byKey).forEach((key) => {
        byKey[key] = applyManual(reparseFromSample(byKey[key], saved[key]));
      });
      records = Object.values(byKey);
      samples = Object.values(saved).sort((a, b) => b.capturedAt - a.capturedAt);
      renderSamples(byKey);
      render();
    });
  }

  document.getElementById('copySamples').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(sampleReport());
      nodes.copyStatus.textContent = `Đã copy ${samples.length} bài.`;
    } catch (_error) {
      nodes.copyStatus.textContent = 'Không copy được, hãy mở từng bài và copy tay.';
    }
  });

  function deleteSample(key) {
    chrome.storage.local.get(SAMPLES_KEY, (stored) => {
      if (chrome.runtime.lastError) return;
      const saved = { ...(stored[SAMPLES_KEY] || {}) };
      delete saved[key];
      chrome.storage.local.set({ [SAMPLES_KEY]: saved });
    });
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  // Giá trị cho ô datetime-local (giờ máy).
  function toLocalInput(ms) {
    if (!ms) return '';
    const date = new Date(ms);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function moneyInput(value) {
    return value == null ? '' : moneyFormat.format(value);
  }

  // Ô trống = dùng thông tin quét được; ô có chữ mà không đọc được thành giá thì báo lỗi.
  function readMoney(input, label, errors) {
    const text = input.value.trim();
    if (!text) return null;
    const amount = parseAmount(text);
    if (amount === null) errors.push(`Không hiểu ${label}: "${text}"`);
    return amount;
  }

  function openEditor(key) {
    const record = records.find((item) => item.key === key);
    if (!record) return;
    const manual = record.manual || {};
    editingKey = key;
    nodes.editorTitle.textContent = record.title || record.url;
    nodes.editorLinkField.hidden = Boolean(record.postId);
    nodes.editorLink.value = '';
    nodes.editorDeadline.value = toLocalInput(manual.deadlineAt);
    // Gợi ý thông tin quét được để người dùng biết ô trống sẽ dùng gì.
    nodes.editorDeadline.title = record.deadlineAt && !manual.deadlineAt ? `Quét được: ${dateFormat.format(record.deadlineAt)}` : '';
    nodes.editorPrice.value = moneyInput(manual.price);
    nodes.editorPrice.placeholder = highestPrice(record) && !manual.price ? `Quét được: ${formatMoney(highestPrice(record))}` : 'vd: 250k, 1tr2';
    nodes.editorStartPrice.value = moneyInput(manual.startPrice);
    nodes.editorBuyNow.value = moneyInput(manual.buyNowPrice);
    nodes.editorProduct.value = manual.product || '';
    nodes.editorProduct.placeholder = record.product || '';
    nodes.editorDone.checked = Boolean(manual.done);
    nodes.editorError.textContent = '';
    nodes.editor.showModal();
  }

  function closeEditor() {
    editingKey = null;
    nodes.editor.close();
  }

  function readEditor() {
    const errors = [];
    const manual = {};
    const deadline = nodes.editorDeadline.value ? new Date(nodes.editorDeadline.value).getTime() : null;
    if (Number.isFinite(deadline)) manual.deadlineAt = deadline;
    const price = readMoney(nodes.editorPrice, 'giá cao nhất', errors);
    if (price) manual.price = price;
    const startPrice = readMoney(nodes.editorStartPrice, 'giá khởi điểm', errors);
    if (startPrice !== null) manual.startPrice = startPrice;
    const buyNow = readMoney(nodes.editorBuyNow, 'giá mua ngay', errors);
    if (buyNow) manual.buyNowPrice = buyNow;
    const product = nodes.editorProduct.value.trim();
    if (product) manual.product = product;
    if (nodes.editorDone.checked) manual.done = true;

    let postId = '';
    const link = nodes.editorLinkField.hidden ? '' : nodes.editorLink.value.trim();
    if (link) {
      postId = postIdFromLink(link);
      if (!postId) errors.push('Link không có id bài (cần dạng …/posts/123… hoặc …/permalink/123…)');
    }
    return { errors, manual, postId };
  }

  /**
   * Ghi thông tin nhập tay vào bản ghi (trường manual). Có link thì chuyển bản ghi sang khoá
   * theo id bài, như khi quét đọc được link. Bài đánh dấu xong được ghi vào danh sách đã xong
   * để lượt quét sau bỏ qua; bỏ đánh dấu thì gỡ ra.
   */
  function saveManual(key, manual, postId) {
    chrome.storage.local.get([STORAGE_KEY, SAMPLES_KEY, FINISHED_KEY], (stored) => {
      if (chrome.runtime.lastError) return;
      // Gộp trùng như lúc hiển thị để khoá đang sửa khớp với bản ghi đã lưu.
      const all = dedupeRecords(stored[STORAGE_KEY] || {});
      const samples = { ...(stored[SAMPLES_KEY] || {}) };
      const finished = { ...(stored[FINISHED_KEY] || {}) };
      const record = all[key];
      if (!record) return;

      const hasManual = Object.keys(manual).length > 0;
      let nextKey = key;
      let next = { ...record, updatedAt: Date.now() };
      if (postId) {
        nextKey = `${record.groupKey}:${postId}`;
        delete all[key];
        next = {
          ...(all[nextKey] || next),
          key: nextKey,
          postId,
          url: `https://www.facebook.com/groups/${record.groupKey}/posts/${postId}/`,
        };
        if (samples[key]) {
          samples[nextKey] = { ...samples[key], key: nextKey, url: next.url };
          delete samples[key];
        }
      }
      if (hasManual) next.manual = manual;
      else delete next.manual;
      all[nextKey] = next;
      if (manual.done) finished[nextKey] = Date.now();
      else {
        delete finished[key];
        delete finished[nextKey];
      }
      chrome.storage.local.set({ [STORAGE_KEY]: all, [SAMPLES_KEY]: samples, [FINISHED_KEY]: finished });
    });
  }

  nodes.editorForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!editingKey) return;
    const { errors, manual, postId } = readEditor();
    if (errors.length > 0) {
      nodes.editorError.textContent = errors.join('. ');
      return;
    }
    saveManual(editingKey, manual, postId);
    closeEditor();
  });
  document.getElementById('editorReset').addEventListener('click', () => {
    if (editingKey) saveManual(editingKey, {}, '');
    closeEditor();
  });
  document.getElementById('editorCancel').addEventListener('click', closeEditor);
  nodes.editor.addEventListener('close', () => {
    editingKey = null;
  });

  document.getElementById('clearSamples').addEventListener('click', () => {
    if (window.confirm('Xóa toàn bộ mẫu nội dung đã lưu?')) chrome.storage.local.remove(SAMPLES_KEY);
  });

  const timeFormat = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' });

  function renderSweepStatus(status) {
    const running = Boolean(status && status.running);
    nodes.sweepNow.hidden = running;
    nodes.sweepStop.hidden = !running;
    if (running) {
      nodes.sweepStatus.textContent = `${status.phase || 'Đang quét…'} (cửa sổ quét sẽ tự đóng)`;
    } else if (status && status.finishedAt) {
      const outcome = status.result === 'stopped' ? 'Đã dừng quét' : 'Quét xong';
      nodes.sweepStatus.textContent = `${outcome} lúc ${timeFormat.format(status.finishedAt)}`;
    } else {
      nodes.sweepStatus.textContent = '';
    }
  }

  function startSweep(force) {
    chrome.runtime.sendMessage({ type: 'startAuctionSweep', force }, () => void chrome.runtime.lastError);
  }

  nodes.sort.value = readSort();
  nodes.sort.addEventListener('change', () => {
    writeSort(nodes.sort.value);
    render();
  });

  nodes.hideEnded.checked = readFlag(HIDE_ENDED_KEY, false);
  nodes.hideEnded.addEventListener('change', () => {
    writeFlag(HIDE_ENDED_KEY, nodes.hideEnded.checked);
    render();
  });

  nodes.autoSweep.checked = readFlag(AUTO_SWEEP_KEY, false);
  nodes.autoSweep.addEventListener('change', () => writeFlag(AUTO_SWEEP_KEY, nodes.autoSweep.checked));
  nodes.sweepNow.addEventListener('click', () => startSweep(true));
  nodes.sweepStop.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'stopAuctionSweep' }, () => void chrome.runtime.lastError);
  });

  chrome.storage.local.get(SWEEP_STATUS_KEY, (stored) => {
    renderSweepStatus(!chrome.runtime.lastError && stored[SWEEP_STATUS_KEY]);
  });
  // Background tự bỏ qua nếu vừa quét xong trong 10 phút hoặc đang quét.
  if (nodes.autoSweep.checked) startSweep(false);

  document.getElementById('exportCsv').addEventListener('click', exportCsv);

  document.getElementById('clearData').addEventListener('click', () => {
    if (!window.confirm('Xóa toàn bộ bài đấu giá đã quét, mẫu nội dung và danh sách bài đã xong?')) return;
    // Xóa cả mốc lượt quét trước để lần mở danh sách sau quét lại ngay (trừ khi đang quét).
    chrome.storage.local.get(SWEEP_STATUS_KEY, (stored) => {
      const status = !chrome.runtime.lastError && stored[SWEEP_STATUS_KEY];
      const keys = [STORAGE_KEY, SAMPLES_KEY, FINISHED_KEY, ...(status && status.running ? [] : [SWEEP_STATUS_KEY])];
      chrome.storage.local.remove(keys);
    });
  });

  document.getElementById('saveGroups').addEventListener('click', () => {
    const groups = parseGroups(nodes.groupsInput.value);
    chrome.storage.sync.set({ [GROUPS_KEY]: groups.length > 0 ? groups : DEFAULT_GROUPS });
  });

  function applySettings(stored) {
    settings = readSettings(stored);
    nodes.maxAgeDays.value = settings.maxAgeDays;
    nodes.skipLocked.checked = settings.skipLockedComments;
    render();
  }

  nodes.maxAgeDays.addEventListener('change', () => {
    const days = Math.round(Number(nodes.maxAgeDays.value));
    if (Number.isFinite(days) && days > 0) chrome.storage.sync.set({ [MAX_AGE_KEY]: days });
    else nodes.maxAgeDays.value = settings.maxAgeDays;
  });
  nodes.skipLocked.addEventListener('change', () => {
    chrome.storage.sync.set({ [SKIP_LOCKED_KEY]: nodes.skipLocked.checked });
  });

  chrome.storage.sync.get([GROUPS_KEY, MAX_AGE_KEY, SKIP_LOCKED_KEY], (stored) => {
    if (chrome.runtime.lastError) return;
    const groups = stored[GROUPS_KEY];
    renderGroups(Array.isArray(groups) && groups.length > 0 ? groups : DEFAULT_GROUPS);
    applySettings(stored);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes[STORAGE_KEY] || changes[SAMPLES_KEY])) loadRecords();
    if (area === 'local' && changes[SWEEP_STATUS_KEY]) renderSweepStatus(changes[SWEEP_STATUS_KEY].newValue);
    if (area === 'sync' && (changes[MAX_AGE_KEY] || changes[SKIP_LOCKED_KEY])) {
      chrome.storage.sync.get([MAX_AGE_KEY, SKIP_LOCKED_KEY], (stored) => {
        if (!chrome.runtime.lastError) applySettings(stored);
      });
    }
    if (area === 'sync' && changes[GROUPS_KEY]) {
      const groups = changes[GROUPS_KEY].newValue;
      renderGroups(Array.isArray(groups) && groups.length > 0 ? groups : DEFAULT_GROUPS);
    }
  });

  setInterval(render, REFRESH_MS);
  loadRecords();
})();
