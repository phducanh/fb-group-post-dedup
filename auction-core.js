(function (root) {
  'use strict';

  // Tách bài đấu giá: hạn kết thúc, giá khởi điểm/hiện tại trong bài và giá trả trong comment.
  // Hàm thuần (không đụng DOM) để test được bằng node.

  const DAY_MS = 24 * 60 * 60 * 1000;
  // dd/mm không ghi năm: lùi về năm trước/sang năm sau nếu lệch xa ngày tham chiếu.
  const PAST_TOLERANCE_MS = 60 * DAY_MS;
  const FUTURE_TOLERANCE_MS = 300 * DAY_MS;
  const DEADLINE_WINDOW = 70;
  // Giá không kèm đơn vị dưới ngưỡng này được hiểu là nghìn đồng ("250" = 250k).
  const BARE_THOUSANDS_LIMIT = 10000;
  const MAX_BID_COMMENT_LENGTH = 50;
  const MAX_BID_EXTRA_WORDS = 6;
  // Dưới mức này không phải giá trả thật ("3 cái" bị đọc thành 3.000đ).
  const MIN_BID = 10000;
  // Số trần có phần lẻ dưới ngưỡng này hiểu là triệu ("3.1" = 3,1 triệu).
  const BARE_MILLIONS_LIMIT = 100;
  const TITLE_MAX_LENGTH = 100;
  const LOT_TITLE_MAX_LENGTH = 60;
  // Nhãn suất trong bài nhiều món: "S1", "SP2", "Suất 3", "Slot 1", "Lot 2", "Món 1", "#3".
  // Không dùng "m" (trùng đơn vị triệu: "3m1").
  const LOT_PREFIX = String.raw`(?:suat|slot|lot|mon|sp|so|s|#)`;
  const LOT_IN_COMMENT_PATTERN = new RegExp(
    String.raw`(?:^|[^a-z0-9])${LOT_PREFIX}\s*\.?\s*(\d{1,2})(?!\d)(?!\s*(?:k|tr|trieu|cu|c|m|nghin|ngan|ng|lit|tram)(?![a-z]))`,
    'g'
  );
  const LOT_LINE_PATTERN = new RegExp(String.raw`^\s*${LOT_PREFIX}\s*\.?\s*(\d{1,2})(?!\d)\s*[:.\-)]?\s*`);
  // Bài nhiều món phải có ít nhất chừng này suất (một dòng "S1" lẻ có thể là chuyện khác).
  const MIN_LOTS = 2;
  // Đoạn đầu bài đủ ổn định giữa bản bị cắt "Xem thêm" và bản đầy đủ.
  const TEXT_KEY_LENGTH = 80;
  const FNV_OFFSET_BASIS = 0x811c9dc5;
  const FNV_PRIME = 0x01000193;

  const AUCTION_PATTERN =
    /\b(dau gia|auction|auc|buoc gia|buoc nhay|buoc|gia khoi (diem|dau)|khoi diem|gkd|bid|dg|phien|start|step|chot phien|ket thuc phien)\b/;
  // Từ khoá mạnh trước; "kt" còn là viết tắt của "kích thước" nên chỉ dùng khi không có gì khác.
  const DEADLINE_KEYWORDS = [
    /(ket thuc|ket phien|dong phien|het phien|het han|het gio|chot phien|chot gia|chot|deadline|ends?|ending|close[sd]?|closing|finish(es)?|thoi gian dau|thoi han)\b/g,
    /\b(kt|time)\b/g,
  ];
  const START_PRICE_PATTERN =
    /(gia khoi diem|khoi diem|gia khoi dau|gkd|gia start|starting bid|starting price|start price|start|gia mo|mo gia|gia goc)\s*[:\-=]?\s*/g;
  const CURRENT_PRICE_PATTERN =
    /(gia hien tai|hien tai|gia cao nhat|cao nhat|top bid|current bid|current price|current|dang o muc|gia dang)\s*[:\-=]?\s*/g;
  const BUY_NOW_PATTERN = /(gia mua ngay|mua ngay|gia mua dut|mua dut|gia dut|\bdut\b|\bbin\b|buy now)\s*[:\-=]?\s*/g;
  // "Đứt" trong comment = có người mua đứt (mua ngay). Câu hỏi kiểu "ai đứt chưa?" thì không tính.
  const BUYOUT_COMMENT_PATTERN = /\b(dut|mua dut|chot dut)\b/;
  const QUESTION_PATTERN = /[?]|\b(chua|khong|ko|sao|nhi|ai)\b/;
  // Người bán ghi trong bài là đã có người mua đứt / đã bán (khác nhãn giá "Đứt: 2tr").
  const POST_SOLD_PATTERN = /\b(da dut|dut roi|da co (nguoi|ng) dut|co (nguoi|ng) dut|da ban|sold out|sold)\b/;

  // số [đơn vị [phần sau [đơn vị phần sau]]]: "350", "350k", "3m1", "3tr100k", "3 triệu 1 trăm".
  const MONEY_PATTERN =
    /(\d+(?:[.,]\d+)*)\s*(?:(trieu|tr|cu|c|m|nghin|ngan|ng|k|lit|tram|vnd|d)(?![a-z])(?:\s*(\d{1,3}|ruoi)(?!\d)\s*(nghin|ngan|k|tram)?(?![a-z]))?)?(?![\d.,]*\d)/g;
  const UNIT_MULTIPLIERS = {
    trieu: 1e6, tr: 1e6, cu: 1e6, c: 1e6, m: 1e6,
    nghin: 1e3, ngan: 1e3, ng: 1e3, k: 1e3,
    lit: 1e5, tram: 1e5,
    vnd: 1, d: 1,
  };
  // Đơn vị lớn cho phép viết phần lẻ ngay sau: "1tr2" = 1,2 triệu, "3m1" = 3,1 triệu,
  // "1m250" = 1,25 triệu, "5 trăm 5" = 550 nghìn.
  const UNITS_WITH_TAIL = new Set(['trieu', 'tr', 'cu', 'c', 'm', 'lit', 'tram']);
  const PHONE_PATTERN = /\d{9,}/;
  // Comment kiểu "+10k" là tăng thêm so với giá trước, không phải giá tuyệt đối.
  const RELATIVE_BID_PATTERN = /^[+]/;
  const NOT_A_BID_PATTERN = /\b(buoc|ship|phi|cod|size|cm|nam|tuoi|sdt|zalo)\b/;

  const TIME_PATTERN =
    /\b(\d{1,2})\s*(?:gio|h|g|:)(?![a-z])(\d{2})?(?![\d/])\s*(?:p|phut)?(?![a-z])\s*(sang|trua|chieu|toi|dem|am|pm)?/;
  const AMPM_PATTERN = /\b(\d{1,2})\s*(am|pm)\b/;
  const DATE_PATTERN = /\b(\d{1,2})\s*[/\-.]\s*(\d{1,2})(?:\s*[/\-.]\s*(\d{2,4}))?(?!\d)/;
  const DATE_WORDS_PATTERN = /\b(?:ngay\s*)?(\d{1,2})\s*thang\s*(\d{1,2})(?:\s*nam\s*(\d{4}))?/;
  const WEEKDAY_PATTERN =
    /\b(thu\s*(2|3|4|5|6|7|hai|ba|tu|nam|sau|bay)|t([2-7])|chu nhat|cn|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/;
  const WEEKDAYS = {
    2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6,
    hai: 1, ba: 2, tu: 3, nam: 4, sau: 5, bay: 6,
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0,
  };
  const RELATIVE_DAYS = [
    [/\b(ngay kia|ngay mot)\b/, 2],
    [/\b(ngay mai|toi mai|sang mai|trua mai|chieu mai|dem mai|mai)\b/, 1],
    [/\b(hom nay|toi nay|dem nay|trua nay|chieu nay|sang nay|today|tonight)\b/, 0],
  ];

  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd');
  }

  function isAuctionPost(text) {
    return AUCTION_PATTERN.test(normalize(text));
  }

  function toNumber(raw) {
    if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) return Number(raw.replace(/[.,]/g, ''));
    return Number(raw.replace(',', '.'));
  }

  function amountFromMatch(match) {
    const [, rawNumber, unit, tail, tailUnit] = match;
    const value = toNumber(rawNumber);
    if (!Number.isFinite(value)) return null;
    if (!unit) {
      if (!Number.isInteger(value)) return value < BARE_MILLIONS_LIMIT ? Math.round(value * 1e6) : null;
      return value < BARE_THOUSANDS_LIMIT ? value * 1e3 : value;
    }

    const multiplier = UNIT_MULTIPLIERS[unit];
    if (!tail) return Math.round(value * multiplier);
    // "3 lít rưỡi" = 3,5 lít, "1tr rưỡi" = 1,5 triệu.
    if (tail === 'ruoi') return UNITS_WITH_TAIL.has(unit) ? Math.round((value + 0.5) * multiplier) : null;
    // "3tr100k", "3 triệu 1 trăm": phần sau có đơn vị riêng thì cộng thẳng.
    if (tailUnit) return Math.round(value * multiplier + Number(tail) * UNIT_MULTIPLIERS[tailUnit]);
    // "1k2" không rõ nghĩa: bỏ.
    if (!UNITS_WITH_TAIL.has(unit)) return null;
    return Math.round((value + Number(`0.${tail}`)) * multiplier);
  }

  // Một số tiền viết kiểu Việt Nam -> đồng. Trả về null nếu không đọc được.
  function parseAmount(text) {
    const match = new RegExp(MONEY_PATTERN.source).exec(normalize(text).trim());
    return match ? amountFromMatch(match) : null;
  }

  function moneyMatches(normalized) {
    return [...normalized.matchAll(MONEY_PATTERN)];
  }

  // Comment trả giá thường rất ngắn: "250k", "theo 300", "1tr2 ạ". Comment dài, có số điện
  // thoại, hay có nhiều hơn một con số thì bỏ qua để không lấy nhầm.
  function parseBid(comment) {
    const normalized = normalize(comment).trim();
    if (!normalized || normalized.length > MAX_BID_COMMENT_LENGTH) return null;
    if (PHONE_PATTERN.test(normalized.replace(/[\s.]/g, ''))) return null;
    if (RELATIVE_BID_PATTERN.test(normalized) || NOT_A_BID_PATTERN.test(normalized)) return null;
    if (QUESTION_PATTERN.test(normalized) && /[?]/.test(normalized)) return null;

    const matches = moneyMatches(normalized);
    if (matches.length !== 1) return null;
    const rest = normalized.replace(matches[0][0], ' ');
    if (/\d/.test(rest)) return null;
    const words = rest.split(/[^a-z]+/).filter(Boolean);
    if (words.length > MAX_BID_EXTRA_WORDS) return null;

    const amount = amountFromMatch(matches[0]);
    return amount && amount >= MIN_BID ? amount : null;
  }

  /**
   * Giá trả kèm suất trong bài nhiều món: "S1 20", "s2: 30k", "S3=1tr", "sp1 50 ạ".
   * Comment không ghi suất trả về lot ''. Trả về { lot, amount } hoặc null.
   */
  function parseLotBid(comment) {
    const normalized = normalize(comment).trim();
    const lots = [...normalized.matchAll(LOT_IN_COMMENT_PATTERN)];
    if (lots.length > 1) return null;
    if (lots.length === 0) {
      const amount = parseBid(normalized);
      return amount ? { lot: '', amount } : null;
    }
    const rest = normalized.slice(0, lots[0].index) + ' ' + normalized.slice(lots[0].index + lots[0][0].length);
    const amount = parseBid(rest.replace(/^[\s:=\-.,]+/, ''));
    return amount ? { lot: String(Number(lots[0][1])), amount } : null;
  }

  // Các suất liệt kê trong bài: mỗi dòng bắt đầu bằng nhãn suất. { '1': 'tên món', ... }
  function parseLots(text) {
    const lots = {};
    String(text || '')
      .normalize('NFC')
      .split('\n')
      .forEach((line) => {
        const match = normalize(line).match(LOT_LINE_PATTERN);
        if (!match) return;
        const lot = String(Number(match[1]));
        if (!lots[lot]) lots[lot] = line.slice(match[0].length).trim().slice(0, LOT_TITLE_MAX_LENGTH);
      });
    return Object.keys(lots).length >= MIN_LOTS ? lots : {};
  }

  // Gộp giá theo suất: lấy giá và số lượt trả giá lớn nhất của mỗi suất, tên món nếu có.
  function mergeLots(...sources) {
    const merged = {};
    sources.filter(Boolean).forEach((lots) => {
      Object.entries(lots).forEach(([lot, info]) => {
        const current = merged[lot] || {};
        merged[lot] = {
          title: info.title || current.title || '',
          highestBid: Math.max(current.highestBid || 0, info.highestBid || 0) || null,
          bidCount: Math.max(current.bidCount || 0, info.bidCount || 0),
        };
      });
    });
    return merged;
  }

  // Giá theo suất từ các comment: { '1': { highestBid, bidCount }, ... } (bỏ comment không ghi suất).
  function lotsFromBids(lotBids) {
    const lots = {};
    lotBids.forEach(({ lot, amount }) => {
      if (!lot) return;
      const current = lots[lot] || { highestBid: 0, bidCount: 0 };
      lots[lot] = { highestBid: Math.max(current.highestBid, amount), bidCount: current.bidCount + 1 };
    });
    return lots;
  }

  function isBuyoutComment(comment) {
    const normalized = normalize(comment).trim();
    if (!normalized || normalized.length > MAX_BID_COMMENT_LENGTH) return false;
    return BUYOUT_COMMENT_PATTERN.test(normalized) && !QUESTION_PATTERN.test(normalized);
  }

  function priceAfter(normalized, pattern) {
    for (const match of normalized.matchAll(pattern)) {
      const rest = normalized.slice(match.index + match[0].length);
      const money = new RegExp(`^${MONEY_PATTERN.source}`).exec(rest);
      const amount = money && amountFromMatch(money);
      if (amount) return amount;
    }
    return null;
  }

  function parseTime(segment) {
    let hour;
    let minute = 0;
    let period = '';
    const match = segment.match(TIME_PATTERN);
    const ampm = segment.match(AMPM_PATTERN);
    if (match) {
      hour = Number(match[1]);
      minute = match[2] ? Number(match[2]) : 0;
      period = match[3] || '';
    } else if (ampm) {
      hour = Number(ampm[1]);
      period = ampm[2];
    } else {
      // "tối nay", "trưa mai" không ghi giờ: không đoán.
      return null;
    }

    if (['pm', 'chieu', 'toi'].includes(period) && hour < 12) hour += 12;
    if (period === 'dem' && hour >= 6 && hour < 12) hour += 12;
    if (['am', 'sang'].includes(period) && hour === 12) hour = 0;
    if (hour === 24 && minute === 0) return { hour: 23, minute: 59 };
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }

  function inferYear(day, month, reference) {
    const year = new Date(reference).getFullYear();
    const candidate = new Date(year, month - 1, day).getTime();
    if (candidate < reference - PAST_TOLERANCE_MS) return year + 1;
    if (candidate > reference + FUTURE_TOLERANCE_MS) return year - 1;
    return year;
  }

  function validDate(day, month, year) {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(year, month - 1, day);
    return date.getMonth() === month - 1 ? { day, month, year } : null;
  }

  function fullYear(raw) {
    if (!raw) return null;
    const year = Number(raw);
    return raw.length === 2 ? 2000 + year : year;
  }

  function startOfDay(ms) {
    const date = new Date(ms);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  function parseDate(segment, reference) {
    const matches = [
      ...segment.matchAll(new RegExp(DATE_WORDS_PATTERN.source, 'g')),
      ...segment.matchAll(new RegExp(DATE_PATTERN.source, 'g')),
    ];
    for (const match of matches) {
      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = fullYear(match[3]) || inferYear(day, month, reference);
      const date = validDate(day, month, year);
      if (date) return date;
    }

    for (const [pattern, offset] of RELATIVE_DAYS) {
      const relative = segment.match(pattern);
      if (relative) return dayParts(startOfDay(reference) + offset * DAY_MS);
    }

    const weekday = segment.match(WEEKDAY_PATTERN);
    if (weekday) {
      const key = weekday[2] || weekday[3] || weekday[1];
      const target = key === 'chu nhat' || key === 'cn' ? 0 : WEEKDAYS[key];
      if (target !== undefined) {
        const today = new Date(reference).getDay();
        const offset = (target - today + 7) % 7;
        return dayParts(startOfDay(reference) + offset * DAY_MS);
      }
    }
    return null;
  }

  function dayParts(ms) {
    const date = new Date(ms);
    return { day: date.getDate(), month: date.getMonth() + 1, year: date.getFullYear() };
  }

  // Ngày giờ trong đoạn "21.30" dễ bị đọc nhầm thành ngày 21/30; validDate loại các ca đó.
  function deadlineFromSegment(segment, reference) {
    const withoutTime = segment.replace(TIME_PATTERN, ' ');
    const time = parseTime(segment);
    const date = parseDate(time ? withoutTime : segment, reference);
    if (!time && !date) return null;

    let approximate = false;
    let day = date;
    if (!day) {
      // Chỉ có giờ: hiểu là hôm nay, hoặc ngày mai nếu giờ đó đã qua.
      approximate = true;
      day = dayParts(reference);
      const today = new Date(day.year, day.month - 1, day.day, time.hour, time.minute).getTime();
      if (today < reference) day = dayParts(today + DAY_MS);
    }
    const { hour, minute } = time || { hour: 23, minute: 59 };
    if (!time) approximate = true;
    return {
      at: new Date(day.year, day.month - 1, day.day, hour, minute).getTime(),
      approximate,
    };
  }

  /**
   * Hạn kết thúc phiên đấu giá trong nội dung bài.
   * reference: mốc thời gian để hiểu "tối nay", "thứ 7", "31/10" (không ghi năm).
   * trả về { at: ms, approximate: boolean, raw: string } hoặc null.
   */
  function parseDeadline(text, reference = Date.now()) {
    const original = String(text || '').normalize('NFC');
    const normalized = normalize(original);
    for (const keywords of DEADLINE_KEYWORDS) {
      for (const match of normalized.matchAll(new RegExp(keywords.source, 'g'))) {
        const start = match.index + match[0].length;
        const segment = normalized.slice(start, start + DEADLINE_WINDOW);
        const found = deadlineFromSegment(segment, reference);
        if (found) {
          const raw = original.slice(match.index, start + DEADLINE_WINDOW).split('\n').slice(0, 2).join(' ');
          return { ...found, raw: raw.trim() };
        }
      }
    }
    return null;
  }

  function titleOf(text) {
    const line = String(text || '')
      .split('\n')
      .map((part) => part.trim())
      .find(Boolean);
    return line ? line.slice(0, TITLE_MAX_LENGTH) : '';
  }

  // Khoá tạm cho bài chưa lấy được id (link thời gian của Facebook vẫn là "#").
  function textKey(text) {
    const head = normalize(text)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .slice(0, TEXT_KEY_LENGTH);
    let hash = FNV_OFFSET_BASIS;
    for (let i = 0; i < head.length; i += 1) {
      hash ^= head.charCodeAt(i);
      hash = Math.imul(hash, FNV_PRIME);
    }
    return (hash >>> 0).toString(36);
  }

  // So độ mới theo id bài (id Facebook tăng dần theo thời gian); bài chưa có id dùng lúc thấy lần đầu.
  function compareNewest(a, b) {
    const idA = /^\d+$/.test(a.postId || '') ? BigInt(a.postId) : null;
    const idB = /^\d+$/.test(b.postId || '') ? BigInt(b.postId) : null;
    if (idA !== null && idB !== null && idA !== idB) return idA > idB ? -1 : 1;
    if (idA !== null && idB === null) return -1;
    if (idA === null && idB !== null) return 1;
    return (b.firstSeenAt || 0) - (a.firstSeenAt || 0);
  }

  function parseAuctionPost(text, reference) {
    const normalized = normalize(text);
    return {
      title: titleOf(text),
      deadline: parseDeadline(text, reference),
      startPrice: priceAfter(normalized, START_PRICE_PATTERN),
      currentPrice: priceAfter(normalized, CURRENT_PRICE_PATTERN),
      buyNowPrice: priceAfter(normalized, BUY_NOW_PATTERN),
      soldOut: POST_SOLD_PATTERN.test(normalized),
      lots: parseLots(text),
    };
  }

  // Giá trả cao nhất nhìn thấy được: lấy max giữa comment và "giá hiện tại" ghi trong bài.
  // Đã có người mua đứt thì giá là giá mua đứt (nếu bài có ghi).
  function highestPrice(record) {
    const buyout = record.boughtOut ? record.buyNowPrice : null;
    const candidates = [record.highestBid, record.currentPrice, buyout].filter((value) => value > 0);
    return candidates.length ? Math.max(...candidates) : null;
  }

  const MINUTE_MS = 60 * 1000;
  const HOUR_MS = 60 * MINUTE_MS;
  const RELATIVE_AGE_UNITS = [
    [/^(phut|ph|p|m|min|mins|minute|minutes)$/, MINUTE_MS],
    [/^(gio|g|h|hr|hrs|hour|hours)$/, HOUR_MS],
    [/^(ngay|d|day|days)$/, DAY_MS],
    [/^(tuan|w|wk|wks|week|weeks)$/, 7 * DAY_MS],
    [/^(nam|y|yr|yrs|year|years)$/, 365 * DAY_MS],
  ];
  const MONTH_NAMES = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
    jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  const CLOCK_SUFFIX = String.raw`(?:,?\s*(?:luc|at)\s*(\d{1,2}):(\d{2})\s*(am|pm|sa|ch)?)?`;
  const JUST_NOW_PATTERN = /^(vua xong|just now|bay gio)$/;
  const RELATIVE_AGE_PATTERN = /^(\d+)\s*([a-z]+)$/;
  const YESTERDAY_PATTERN = new RegExp(`^(?:hom qua|yesterday)${CLOCK_SUFFIX}$`);
  const VI_DATE_PATTERN = new RegExp(String.raw`^(\d{1,2})\s*thang\s*(\d{1,2})(?:,?\s*(\d{4}))?${CLOCK_SUFFIX}$`);
  const EN_DATE_PATTERN = new RegExp(String.raw`^([a-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?${CLOCK_SUFFIX}$`);

  function clockOf(hourText, minuteText, period) {
    if (hourText === undefined) return { hour: 0, minute: 0 };
    let hour = Number(hourText);
    if ((period === 'pm' || period === 'ch') && hour < 12) hour += 12;
    if ((period === 'am' || period === 'sa') && hour === 12) hour = 0;
    return { hour, minute: Number(minuteText) };
  }

  // Ngày đăng không ghi năm mà rơi vào tương lai thì là năm trước.
  function datedPost(day, month, yearText, clock, now) {
    const thisYear = new Date(now).getFullYear();
    const build = (year) => new Date(year, month - 1, day, clock.hour, clock.minute).getTime();
    if (yearText) return build(Number(yearText));
    const candidate = build(thisYear);
    return candidate > now + DAY_MS ? build(thisYear - 1) : candidate;
  }

  /**
   * Thời điểm đăng bài từ nhãn thời gian của Facebook: "3 giờ", "2 ngày", "15 phút",
   * "Hôm qua lúc 10:20", "3 tháng 11 lúc 09:00", "3 tháng 11, 2023", "November 3 at 9:00 AM".
   * Cả chuỗi phải là nhãn thời gian (không dò trong nội dung bài). Trả về ms hoặc null.
   */
  function parsePostTime(label, now = Date.now()) {
    const text = normalize(label).replace(/[·•]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    if (JUST_NOW_PATTERN.test(text)) return now;

    const relative = text.match(RELATIVE_AGE_PATTERN);
    if (relative) {
      const unit = RELATIVE_AGE_UNITS.find(([pattern]) => pattern.test(relative[2]));
      return unit ? now - Number(relative[1]) * unit[1] : null;
    }

    const yesterday = text.match(YESTERDAY_PATTERN);
    if (yesterday) {
      const { day, month, year } = dayParts(startOfDay(now) - DAY_MS);
      const clock = clockOf(yesterday[1], yesterday[2], yesterday[3]);
      return new Date(year, month - 1, day, clock.hour, clock.minute).getTime();
    }

    const vi = text.match(VI_DATE_PATTERN);
    if (vi && validDate(Number(vi[1]), Number(vi[2]), 2000)) {
      return datedPost(Number(vi[1]), Number(vi[2]), vi[3], clockOf(vi[4], vi[5], vi[6]), now);
    }

    const en = text.match(EN_DATE_PATTERN);
    if (en && MONTH_NAMES[en[1]]) {
      return datedPost(Number(en[2]), MONTH_NAMES[en[1]], en[3], clockOf(en[4], en[5], en[6]), now);
    }
    return null;
  }

  function numericId(record) {
    return /^\d+$/.test(record.postId || '') ? BigInt(record.postId) : null;
  }

  /**
   * Bài đăng trước mốc cutoff chưa? Có ngày đăng thì so trực tiếp. Không có thì dùng hai
   * cận chắc chắn: bài được đăng trước lần đầu extension thấy nó, và trước mọi bài có id lớn
   * hơn (id Facebook tăng theo thời gian) đã biết ngày đăng. Không chắc thì coi là chưa quá hạn.
   */
  function isOlderThan(record, cutoff, anchors = []) {
    if (record.postedAt) return record.postedAt < cutoff;
    let latestPossible = record.firstSeenAt || Infinity;
    const id = numericId(record);
    if (id !== null) {
      anchors.forEach((anchor) => {
        const anchorId = numericId(anchor);
        if (anchor.postedAt && anchorId !== null && anchorId > id) {
          latestPossible = Math.min(latestPossible, anchor.postedAt);
        }
      });
    }
    return latestPossible < cutoff;
  }

  const DEFAULT_SETTINGS = Object.freeze({ maxAgeDays: 5, skipLockedComments: true });

  function readSettings(stored) {
    const days = Number(stored && stored.auctionMaxAgeDays);
    const skip = stored && stored.auctionSkipLocked;
    return {
      maxAgeDays: Number.isFinite(days) && days > 0 ? days : DEFAULT_SETTINGS.maxAgeDays,
      skipLockedComments: typeof skip === 'boolean' ? skip : DEFAULT_SETTINGS.skipLockedComments,
    };
  }

  // Bài bị bỏ qua theo cài đặt: khoá bình luận, hoặc đăng quá số ngày tối đa.
  // Đã kết thúc: có người mua đứt, bài đã bị xoá/ẩn, hoặc đã qua hạn.
  function isEnded(record, now) {
    if (record.boughtOut || record.unavailable) return true;
    return Boolean(record.deadlineAt) && record.deadlineAt <= now;
  }

  function isNumericPostId(record) {
    return /^\d+$/.test(record.postId || '');
  }

  // Bản tạm (chưa có id) mang textKey trong khoá: "<nhóm>:t<textKey>".
  function textKeyOf(record) {
    if (record.textKey) return record.textKey;
    const match = /:t(\w+)$/.exec(record.key || '');
    return match ? match[1] : '';
  }

  const TEXT_FIELDS = [
    'title', 'textLength', 'deadlineAt', 'deadlineRaw', 'deadlineApproximate',
    'startPrice', 'currentPrice', 'buyNowPrice',
  ];

  function maxOrNull(...values) {
    const present = values.filter((value) => value > 0);
    return present.length ? Math.max(...present) : null;
  }

  // Gộp hai bản ghi của cùng một bài: giữ khoá/link của bản có id số, nội dung của bản đọc
  // được dài hơn, giá và lượt trả giá lớn nhất, trạng thái "đã kết thúc" nếu bản nào có.
  function combineRecords(a, b) {
    const score = (record) => (isNumericPostId(record) ? 2 : record.postId ? 1 : 0);
    const [keep, drop] = score(b) > score(a) ? [b, a] : [a, b];
    const richer = (keep.textLength || 0) >= (drop.textLength || 0) ? keep : drop;
    const merged = { ...drop, ...keep };
    TEXT_FIELDS.forEach((field) => {
      merged[field] = richer[field];
    });
    return {
      ...merged,
      textKey: textKeyOf(keep) || textKeyOf(drop),
      firstSeenAt: Math.min(keep.firstSeenAt || Infinity, drop.firstSeenAt || Infinity) || keep.firstSeenAt,
      updatedAt: Math.max(keep.updatedAt || 0, drop.updatedAt || 0),
      highestBid: maxOrNull(keep.highestBid, drop.highestBid),
      bidCount: Math.max(keep.bidCount || 0, drop.bidCount || 0),
      deepScannedAt: maxOrNull(keep.deepScannedAt, drop.deepScannedAt),
      postedAt: keep.postedAt || drop.postedAt || null,
      boughtOut: Boolean(keep.boughtOut || drop.boughtOut),
      lots: mergeLots(drop.lots, keep.lots),
    };
  }

  /**
   * Gộp các bản ghi trùng của cùng một bài: cùng nhóm, cùng đầu bài (textKey), và ít nhất
   * một bản không có id số (bản tạm hoặc id dạng pfbid). Hai id số khác nhau luôn là hai bài
   * khác nhau, vì người bán hay dùng chung một mẫu bài cho nhiều món.
   * records: { key: record } -> { key: record }
   */
  function dedupeRecords(records) {
    const result = {};
    const loose = new Map();
    Object.values(records || {}).forEach((record) => {
      const twinKey = `${record.groupKey}|${textKeyOf(record)}`;
      const canMerge = Boolean(textKeyOf(record));
      const twin = canMerge ? loose.get(twinKey) : null;
      if (twin && (!isNumericPostId(twin) || !isNumericPostId(record))) {
        delete result[twin.key];
        const merged = combineRecords(twin, record);
        result[merged.key] = merged;
        loose.set(twinKey, merged);
        return;
      }
      result[record.key] = record;
      // Bản có id số chỉ làm đích gộp cho bản tạm/pfbid; nhớ bản đầu tiên của mỗi đầu bài.
      if (canMerge && (!twin || !isNumericPostId(record))) loose.set(twinKey, record);
    });
    return result;
  }

  function isExcluded(record, settings, now, anchors) {
    if (settings.skipLockedComments && record.commentsLocked) return true;
    return isOlderThan(record, now - settings.maxAgeDays * DAY_MS, anchors);
  }

  const PRICE_FIELDS = ['startPrice', 'currentPrice', 'buyNowPrice'];
  // Comment có con số mà không đọc được thành giá: có thể là kiểu trả giá chưa hỗ trợ.
  const MAX_UNREAD_COMMENTS = 20;

  function hasLotPrice(record) {
    return Object.values(record.lots || {}).some((lot) => lot.highestBid > 0);
  }

  /**
   * Thông tin còn thiếu của một bài: 'link' (chưa có id bài), 'deadline' (chưa đọc được hạn),
   * 'price' (không có giá nào). Bài đã có người mua đứt hoặc đã bị xoá thì không cần hạn/giá.
   */
  function missingInfo(record) {
    const missing = [];
    if (!record.postId) missing.push('link');
    if (record.boughtOut || record.unavailable) return missing;
    if (!record.deadlineAt) missing.push('deadline');
    const hasPrice = highestPrice(record) || record.startPrice || hasLotPrice(record);
    if (!hasPrice) missing.push('price');
    return missing;
  }

  function unreadComments(comments) {
    return comments
      .map((comment) => String(comment || '').trim())
      .filter((comment) => /\d/.test(comment) && !parseLotBid(comment) && !isBuyoutComment(comment))
      .slice(0, MAX_UNREAD_COMMENTS);
  }

  /**
   * Đọc lại mẫu nội dung đã lưu (nội dung bài + comment chưa đọc được) bằng bộ đọc hiện tại,
   * chỉ điền thông tin còn thiếu. Dùng sau khi cập nhật extension để sửa bài cũ không cần mở lại.
   */
  function reparseFromSample(record, sample) {
    if (!sample || !sample.text) return record;
    const parsed = parseAuctionPost(sample.text, record.firstSeenAt || sample.capturedAt);
    const next = { ...record };
    if (!next.deadlineAt && parsed.deadline) {
      next.deadlineAt = parsed.deadline.at;
      next.deadlineRaw = parsed.deadline.raw;
      next.deadlineApproximate = parsed.deadline.approximate;
    }
    PRICE_FIELDS.forEach((field) => {
      if (!next[field] && parsed[field]) next[field] = parsed[field];
    });
    if (parsed.soldOut) next.boughtOut = true;
    if ((sample.unreadComments || []).some(isBuyoutComment)) next.boughtOut = true;

    const lotBids = (sample.unreadComments || []).map(parseLotBid).filter(Boolean);
    const titles = Object.fromEntries(Object.entries(parsed.lots).map(([lot, title]) => [lot, { title }]));
    const lots = mergeLots(next.lots, titles, lotsFromBids(lotBids));
    if (Object.keys(lots).length > 0) next.lots = lots;
    const highest = maxOrNull(next.highestBid, ...lotBids.map((bid) => bid.amount));
    if (highest) next.highestBid = highest;
    return next;
  }

  const api = {
    normalize,
    isAuctionPost,
    parseAmount,
    parseBid,
    parseLotBid,
    parseLots,
    mergeLots,
    lotsFromBids,
    isBuyoutComment,
    parseDeadline,
    parseAuctionPost,
    highestPrice,
    textKey,
    compareNewest,
    parsePostTime,
    isOlderThan,
    isExcluded,
    isEnded,
    dedupeRecords,
    missingInfo,
    unreadComments,
    reparseFromSample,
    readSettings,
    DEFAULT_SETTINGS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.AuctionCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
