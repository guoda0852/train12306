// 12306 查询 API Worker
// 基于 Joooook/12306-mcp (MIT) 的查询原理改写
// 接口:
//   GET /api/stations?q=北京            车站联想
//   GET /api/tickets?from=深圳北&to=北京西&date=2026-10-08   直达余票
//   GET /api/suggest?from=深圳&to=北京&date=2026-10-08       自动路线建议(直达+换乘,结合余票)

const API_BASE = 'https://kyfw.12306.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 由构建脚本注入: [[code,name,city,pinyin], ...]
//__STATIONS_INJECT__

const byCode = new Map();
const byName = new Map();
const byCity = new Map();
for (const [code, name, city, pinyin] of STATIONS) {
  byCode.set(code, { code, name, city, pinyin });
  if (!byName.has(name)) byName.set(name, { code, name, city, pinyin });
  if (!byCity.has(city)) byCity.set(city, []);
  byCity.get(city).push({ code, name, city, pinyin });
}

function resolveStation(input) {
  if (!input) return null;
  input = input.trim();
  if (/^[A-Z]{3}$/.test(input) && byCode.has(input)) return byCode.get(input);
  const noZhan = input.endsWith('站') ? input.slice(0, -1) : input;
  if (byName.has(noZhan)) return byName.get(noZhan);
  if (byName.has(input)) return byName.get(input);
  // 城市名 -> 同名车站优先,否则该城市第一个站
  if (byCity.has(noZhan)) {
    const list = byCity.get(noZhan);
    return list.find(s => s.name === noZhan) || list[0];
  }
  return null;
}

// ---- 12306 底层 ----
let cookieCache = { value: '', ts: 0 };
async function getCookie() {
  if (Date.now() - cookieCache.ts < 5 * 60 * 1000 && cookieCache.value) return cookieCache.value;
  const r = await fetch(`${API_BASE}/otn/leftTicket/init`, { headers: { 'User-Agent': UA } });
  const setCookies = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  const jar = {};
  for (const c of setCookies) {
    const kv = c.split(';')[0].split('=');
    if (kv.length >= 2) jar[kv[0].trim()] = kv.slice(1).join('=').trim();
  }
  const str = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  cookieCache = { value: str, ts: Date.now() };
  return str;
}

let ticketPathCache = { value: '', ts: 0 };
async function getTicketPath() {
  if (Date.now() - ticketPathCache.ts < 3600 * 1000 && ticketPathCache.value) return ticketPathCache.value;
  try {
    const r = await fetch(`${API_BASE}/otn/leftTicket/init`, { headers: { 'User-Agent': UA } });
    const html = await r.text();
    const m = html.match(/var CLeftTicketUrl = '(.+?)'/);
    const p = m ? m[1] : 'leftTicket/queryG';
    ticketPathCache = { value: p, ts: Date.now() };
    return p;
  } catch { return 'leftTicket/queryG'; }
}

const SEAT_LABELS = [
  ['swz_num', '商务座'], ['tz_num', '特等座'], ['zy_num', '一等座'], ['ze_num', '二等座'],
  ['gr_num', '高级软卧'], ['rw_num', '软卧'], ['srrb_num', '动卧'], ['yw_num', '硬卧'],
  ['rz_num', '软座'], ['yz_num', '硬座'], ['wz_num', '无座'],
];
// leftTicket 返回 '|' 分隔,字段顺序见 12306-mcp TicketDataKeys
const F = {
  train_no: 2, code: 3, from: 6, to: 7, start: 8, arrive: 9, duration: 10,
  canBuy: 11, date: 13, gg: 21, gr: 22, qt: 23, rw: 24, rz: 25, tz: 26,
  wz: 27, yb: 28, yw: 29, yz: 30, ze: 31, zy: 32, swz: 33, srrb: 34,
  seatTypes: 35, trainClass: 21 - 21, // 占位
};
const SEAT_IDX = { swz_num: 33, tz_num: 26, zy_num: 32, ze_num: 31, gr_num: 22, rw_num: 24, srrb_num: 34, yw_num: 29, rz_num: 25, yz_num: 30, wz_num: 27 };

function hasSeatVal(v) {
  return v && v !== '--' && v !== '无' && v !== '*' && v !== '0';
}

function parseTrainRow(row) {
  const c = row.split('|');
  const seats = {};
  let anySeat = false;
  for (const [key, label] of SEAT_LABELS) {
    const v = c[SEAT_IDX[key]] || '';
    seats[label] = v;
    if (hasSeatVal(v)) anySeat = true;
  }
  const fromSt = byCode.get(c[F.from]);
  const toSt = byCode.get(c[F.to]);
  return {
    train_no: c[F.train_no],
    code: c[F.code],
    from: fromSt ? fromSt.name : c[F.from],
    to: toSt ? toSt.name : c[F.to],
    start_time: c[F.start],
    arrive_time: c[F.arrive],
    duration: c[F.duration],
    date: c[F.date],
    can_buy: c[F.canBuy] === 'Y',
    has_seat: anySeat,
    seats,
  };
}

async function fetchDirect(date, fromCode, toCode) {
  const cookie = await getCookie();
  const path = await getTicketPath();
  const url = `${API_BASE}/otn/${path}?leftTicketDTO.train_date=${date}&leftTicketDTO.from_station=${fromCode}&leftTicketDTO.to_station=${toCode}&purpose_codes=ADULT`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': cookie, 'Referer': 'https://www.12306.cn/index/' } });
  const j = await r.json();
  if (!j || j.status !== true || !j.data || !Array.isArray(j.data.result)) {
    throw new Error('12306直达查询失败: ' + (j && (j.messages || j.validateMessages) || 'unknown'));
  }
  return j.data.result.map(parseTrainRow);
}

function parseLeg(leg) {
  // 换乘 fullList 每段:键名不固定,做兼容提取
  const pick = (...keys) => { for (const k of keys) if (leg[k]) return leg[k]; return ''; };
  const code = pick('station_train_code', 'train_code', 'stationTrainCode');
  const start = pick('start_time', 'startTime');
  const arrive = pick('arrive_time', 'arriveTime');
  const fromCode = pick('from_station_telecode', 'fromStationTelecode');
  const toCode = pick('to_station_telecode', 'toStationTelecode');
  const seats = {};
  let anySeat = false;
  for (const [key, label] of SEAT_LABELS) {
    const v = leg[key] || '';
    seats[label] = v;
    if (hasSeatVal(v)) anySeat = true;
  }
  return {
    code,
    from: (byCode.get(fromCode) || {}).name || fromCode,
    to: (byCode.get(toCode) || {}).name || toCode,
    start_time: start, arrive_time: arrive,
    has_seat: anySeat, seats,
  };
}

async function fetchTransfers(date, fromCode, toCode, maxPages = 2) {
  const cookie = await getCookie();
  const out = [];
  let resultIndex = 0;
  for (let p = 0; p < maxPages; p++) {
    const url = `${API_BASE}/lcquery/queryG?train_date=${date}&from_station_telecode=${fromCode}&to_station_telecode=${toCode}&middle_station=&result_index=${resultIndex}&can_query=Y&isShowWZ=N&purpose_codes=00&channel=E`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': cookie, 'Referer': 'https://www.12306.cn/index/' } });
    const j = await r.json();
    if (!j || typeof j.data === 'string' || !j.data || !Array.isArray(j.data.middleList)) break;
    for (const m of j.data.middleList) {
      const legs = (m.fullList || []).map(parseLeg);
      const allSeat = legs.length > 0 && legs.every(l => l.has_seat);
      // 同站换乘:以前段到达站==后段出发站为准,API 的 same_station 字段不可靠
      const sameStation = legs.length >= 2
        ? legs[0].to !== '' && legs[0].to === legs[1].from
        : (m.same_station === 1 || m.same_station === '1');
      out.push({
        middle: m.middle_station_name,
        same_station: sameStation,
        start_time: m.start_time,
        arrive_time: m.arrive_time,
        arrive_date: m.arrive_date,
        total_duration: m.all_lishi,
        total_minutes: m.all_lishi_minutes,
        wait_time: m.wait_time,
        wait_minutes: m.wait_time_minutes,
        legs,
        has_seat: allSeat,
      });
    }
    resultIndex = j.data.result_index;
    if (!j.data.middleList.length) break;
  }
  return out;
}

// ---- 路由 ----
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
function err(msg, status = 400) { return json({ error: msg }, status); }

function validDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(d + 'T00:00:00+08:00').getTime();
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // 12306 预售期约15天
  return t >= today.getTime() && t <= today.getTime() + 15 * 86486400;
}

export default {
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      }});
    }
    try {
      if (url.pathname === '/api/stations') {
        const q = (url.searchParams.get('q') || '').trim().toLowerCase();
        if (!q) return json([]);
        const res = [];
        for (const [code, name, city, pinyin] of STATIONS) {
          if (name.includes(q) || pinyin.startsWith(q) || code.toLowerCase().startsWith(q) || city.includes(q)) {
            res.push({ code, name, city });
            if (res.length >= 20) break;
          }
        }
        return json(res);
      }

      if (url.pathname === '/api/tickets' || url.pathname === '/api/suggest') {
        const from = resolveStation(url.searchParams.get('from'));
        const to = resolveStation(url.searchParams.get('to'));
        const date = url.searchParams.get('date');
        if (!from) return err('出发地无法识别: ' + url.searchParams.get('from'));
        if (!to) return err('目的地无法识别: ' + url.searchParams.get('to'));
        if (!validDate(date)) return err('日期无效,需为今天起15天内,格式 yyyy-MM-dd');

        const direct = await fetchDirect(date, from.code, to.code);
        direct.sort((a, b) => (b.has_seat - a.has_seat) || a.start_time.localeCompare(b.start_time));

        if (url.pathname === '/api/tickets') {
          return json({ date, from: from.name, to: to.name, count: direct.length, trains: direct });
        }

        // suggest: 直达 + 换乘,结合余票排序
        let transfers = [];
        try { transfers = await fetchTransfers(date, from.code, to.code); } catch (e) { /* 换乘查询失败则只返回直达 */ }
        transfers = transfers.filter(t => (t.wait_minutes || 0) >= 5 || t.legs.length === 1);
        transfers.sort((a, b) => (b.has_seat - a.has_seat) || ((a.total_minutes || 9999) - (b.total_minutes || 9999)));

        const recommended = [];
        for (const t of direct) {
          if (t.has_seat && recommended.length < 5) recommended.push({ type: 'direct', ...t });
        }
        for (const t of transfers) {
          if (recommended.length >= 10) break;
          if (t.has_seat) recommended.push({ type: 'transfer', ...t });
        }
        // 兜底:无票时也给时间最短的方案
        if (!recommended.length) {
          for (const t of direct.slice(0, 3)) recommended.push({ type: 'direct', ...t });
          for (const t of transfers.slice(0, 3)) recommended.push({ type: 'transfer', ...t });
        }
        return json({
          date, from: from.name, to: to.name,
          direct_count: direct.length, transfer_count: transfers.length,
          recommended,
          direct: direct.slice(0, 50),
          transfers: transfers.slice(0, 20),
        });
      }

      if (url.pathname === '/' || url.pathname === '/api') {
        return json({
          name: '12306 查询 API',
          usage: '/api/tickets?from=深圳北&to=北京西&date=2026-10-08',
          suggest: '/api/suggest?from=深圳&to=北京&date=2026-10-08',
          stations: '/api/stations?q=北京',
          credit: '查询原理基于 Joooook/12306-mcp (MIT),数据来自12306公开查询接口,仅供出行参考',
        });
      }
      return err('not found', 404);
    } catch (e) {
      return err('查询出错: ' + (e.message || e), 502);
    }
  },
};
