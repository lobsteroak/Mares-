'use strict';

/* ---------------------------------------------------------------------------
 * Marés — Porto / São Félix da Marinha (4410-463)
 * Referência de marés: Espinho (Aveiro). Dados: TideCheck API.
 * A estação é resolvida uma vez (procura STATION_QUERY) e o ID fica guardado.
 * ------------------------------------------------------------------------- */

const LOCATION = {
  label: 'São Félix da Marinha · 4410-463',
  reference: 'Espinho (Aveiro)',
};

// Estação de referência de marés mais próxima do código postal 4410-463.
const STATION_QUERY = 'Espinho';

const API_BASE = 'https://tidecheck.com/api';
const TZ = 'Europe/Lisbon';

const LS_KEY = 'mares.apiKey';
const LS_CACHE = 'mares.cache';
const LS_STATION = 'mares.station';
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 h

/* ---------- helpers de tempo (sempre na hora de Lisboa) ---------- */

const hhmm = new Intl.DateTimeFormat('pt-PT', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
});
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
const weekday = new Intl.DateTimeFormat('pt-PT', {
  timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
});

function fmtTime(unix) { return hhmm.format(new Date(unix * 1000)); }
function dayKey(unix) { return ymd.format(new Date(unix * 1000)); }

function tzOffsetMs(date) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour === '24' ? 0 : p.hour, p.minute, p.second);
  return asUTC - date.getTime();
}

function startOfTodayUnix() {
  const [Y, M, D] = ymd.format(new Date()).split('-').map(Number);
  const guess = Date.UTC(Y, M - 1, D, 0, 0, 0);
  const off = tzOffsetMs(new Date(guess));
  return Math.floor((guess - off) / 1000);
}

function fmtCountdown(ms) {
  if (ms < 0) ms = 0;
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `daqui a ${m} min`;
  if (m === 0) return `daqui a ${h} h`;
  return `daqui a ${h} h ${m} min`;
}

/* ---------- elementos ---------- */

const el = (id) => document.getElementById(id);
const screens = {
  setup: el('setupScreen'),
  tide: el('tideScreen'),
  loading: el('loadingScreen'),
};

function showScreen(name) {
  Object.entries(screens).forEach(([k, node]) => {
    node.classList.toggle('hidden', k !== name);
  });
}

/* ---------- API + cache ---------- */

function getKey() { return localStorage.getItem(LS_KEY) || ''; }
function setKey(k) { localStorage.setItem(LS_KEY, k.trim()); }

function readCache() {
  try { return JSON.parse(localStorage.getItem(LS_CACHE) || 'null'); }
  catch { return null; }
}
function writeCache(data) {
  localStorage.setItem(LS_CACHE, JSON.stringify({ savedAt: Date.now(), data }));
}

async function apiGet(path, key) {
  const res = await fetch(API_BASE + path, {
    headers: { 'X-API-Key': key, 'Accept': 'application/json' },
    cache: 'no-store',
  });
  let json;
  try { json = await res.json(); } catch { json = null; }
  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || `Erro ${res.status} da API.`;
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  if (!json) throw new Error('Resposta inválida do servidor.');
  return json;
}

function cachedStation() {
  try { return JSON.parse(localStorage.getItem(LS_STATION) || 'null'); }
  catch { return null; }
}

const deaccent = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function extractStationList(data) {
  if (Array.isArray(data)) return data;
  return data.stations || data.results || data.data ||
         data.items || data.features ||
         (data.data && (data.data.stations || data.data.results)) || [];
}

function normalizeStation(s) {
  const p = s.properties || s; // suporta GeoJSON
  return {
    id: String(p.id ?? p.stationId ?? p.station_id ?? p.slug ?? ''),
    name: p.name || p.stationName || p.station_name || STATION_QUERY,
    country: p.country || p.countryName || p.country_name || p.countryCode || p.country_code || '',
  };
}

// Resolve (uma vez) a estação e guarda o ID.
async function resolveStation(key) {
  const c = cachedStation();
  if (c && c.id) return c;

  const data = await apiGet('/stations/search?q=' + encodeURIComponent(STATION_QUERY), key);
  const list = extractStationList(data).map(normalizeStation).filter((s) => s.id);

  if (!list.length) {
    const keys = Array.isArray(data) ? `array(${data.length})` : Object.keys(data || {}).join(',');
    throw new Error(`Estação "${STATION_QUERY}" não encontrada. Resposta: ${keys}`);
  }

  const q = deaccent(STATION_QUERY);
  const isPT = (s) => /portugal|^pt$/i.test(s.country);
  const pick = list.find((s) => deaccent(s.name).includes(q)) ||
               list.find(isPT) || list[0];
  const st = { id: pick.id, name: pick.name };
  localStorage.setItem(LS_STATION, JSON.stringify(st));
  return st;
}

async function fetchTideData(key) {
  const st = await resolveStation(key);
  const data = await apiGet(`/station/${encodeURIComponent(st.id)}/tides`, key);
  const raw = data.extremes || (data.tides && data.tides.extremes) || [];
  const extremes = raw.map((e) => ({
    dt: Math.floor(Date.parse(e.time || e.t || e.date) / 1000),
    height: typeof e.height === 'number' ? e.height : parseFloat(e.height),
    type: e.type,
    localDate: e.localDate,
  })).filter((e) => Number.isFinite(e.dt) && Number.isFinite(e.height))
    .sort((a, b) => a.dt - b.dt);

  if (extremes.length < 2) throw new Error('Sem dados de marés para a estação.');
  return { station: st, extremes };
}

// A TideCheck só dá os extremos (preia/baixa-mar). Sintetizamos a curva do dia
// por interpolação cosseno entre extremos consecutivos (método-padrão).
function synthesizeCurve(extremes) {
  if (!extremes || extremes.length < 2) return [];
  const start = startOfTodayUnix();
  const end = start + 24 * 3600;
  const out = [];
  for (let t = start; t <= end; t += 1800) {
    let a = null, b = null;
    for (let i = 0; i < extremes.length - 1; i++) {
      if (extremes[i].dt <= t && t <= extremes[i + 1].dt) {
        a = extremes[i]; b = extremes[i + 1]; break;
      }
    }
    if (!a) continue; // fora do intervalo coberto pelos extremos
    const f = (t - a.dt) / (b.dt - a.dt);
    const h = a.height + (b.height - a.height) * (1 - Math.cos(Math.PI * f)) / 2;
    out.push({ dt: t, height: +h.toFixed(3) });
  }
  return out;
}

/* ---------- render ---------- */

function typeLabel(t) { return /high/i.test(t) ? 'Preia-mar' : 'Baixa-mar'; }
function typeClass(t) { return /high/i.test(t) ? 'high' : 'low'; }
function typeIcon(t) { return /high/i.test(t) ? '▲' : '▼'; }

function renderNext(extremes) {
  const now = Date.now();
  const next = extremes.find((e) => e.dt * 1000 > now);
  if (!next) { el('nextType').textContent = '—'; return; }
  el('nextType').textContent = typeLabel(next.type);
  el('nextType').className = 'next-type ' + typeClass(next.type);
  el('nextTime').textContent = fmtTime(next.dt);
  el('nextCountdown').textContent = fmtCountdown(next.dt * 1000 - now);
  el('nextHeight').textContent = `altura ${next.height.toFixed(2)} m`;
}

function renderList(extremes) {
  const today = dayKey(Math.floor(Date.now() / 1000));
  const todays = extremes.filter((e) => dayKey(e.dt) === today);
  const list = todays.length ? todays : extremes.slice(0, 4);

  el('listTitle').textContent = todays.length
    ? capitalize(weekday.format(new Date()))
    : 'Próximas marés';

  const now = Date.now();
  el('tideList').innerHTML = list.map((e) => {
    const past = e.dt * 1000 < now;
    return `<li class="${past ? 'past' : ''}">
      <div class="t-left">
        <div class="tide-badge ${typeClass(e.type)}">${typeIcon(e.type)}</div>
        <div>
          <div class="t-type">${typeLabel(e.type)}</div>
          <div class="t-sub">${e.height.toFixed(2)} m</div>
        </div>
      </div>
      <div class="t-time">${fmtTime(e.dt)}</div>
    </li>`;
  }).join('');
}

function renderChart(heights, extremes) {
  const svg = el('tideChart');
  const W = 320, H = 140, padT = 16, padB = 24, padX = 6;
  const today = dayKey(Math.floor(Date.now() / 1000));
  const pts = (heights || []).filter((p) => dayKey(p.dt) === today);
  if (pts.length < 2) { svg.innerHTML = ''; el('nowHeightLabel').textContent = ''; return; }

  const t0 = pts[0].dt, t1 = pts[pts.length - 1].dt;
  const hs = pts.map((p) => p.height);
  const hMin = Math.min(...hs), hMax = Math.max(...hs);
  const span = (hMax - hMin) || 1;

  const x = (dt) => padX + ((dt - t0) / (t1 - t0)) * (W - 2 * padX);
  const y = (h) => padT + (1 - (h - hMin) / span) * (H - padT - padB);

  const line = pts.map((p) => `${x(p.dt).toFixed(1)},${y(p.height).toFixed(1)}`).join(' ');
  const area = `${padX},${H - padB} ${line} ${W - padX},${H - padB}`;

  // marcadores de preia/baixa-mar dentro do dia
  const marks = (extremes || []).filter((e) => dayKey(e.dt) === today).map((e) => {
    const cx = x(e.dt), cy = y(e.height);
    const cls = typeClass(e.type);
    const lbl = fmtTime(e.dt);
    const ty = cy < padT + 16 ? cy + 16 : cy - 8;
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.2" class="dot ${cls}"
              fill="${cls === 'high' ? '#4fc3f7' : '#80d8c3'}"/>
            <text x="${cx.toFixed(1)}" y="${ty.toFixed(1)}" class="mlabel"
              text-anchor="middle" fill="#9fc4dd" font-size="9">${lbl}</text>`;
  }).join('');

  // marcador "agora"
  const nowUnix = Date.now() / 1000;
  let nowMarker = '';
  if (nowUnix >= t0 && nowUnix <= t1) {
    const nx = x(nowUnix);
    // interpolar altura atual
    let cur = pts[0].height;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].dt >= nowUnix) {
        const a = pts[i - 1], b = pts[i];
        const f = (nowUnix - a.dt) / (b.dt - a.dt);
        cur = a.height + f * (b.height - a.height);
        break;
      }
    }
    nowMarker = `<line x1="${nx.toFixed(1)}" y1="${padT}" x2="${nx.toFixed(1)}" y2="${H - padB}"
                   stroke="#ffffff" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="3 3"/>
                 <circle cx="${nx.toFixed(1)}" cy="${y(cur).toFixed(1)}" r="4" fill="#fff"/>`;
    el('nowHeightLabel').textContent = `Agora: ~${cur.toFixed(2)} m`;
  } else {
    el('nowHeightLabel').textContent = '';
  }

  svg.innerHTML = `
    <defs>
      <linearGradient id="tideFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4fc3f7" stop-opacity="0.40"/>
        <stop offset="100%" stop-color="#4fc3f7" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <polygon points="${area}" fill="url(#tideFill)"/>
    <polyline points="${line}" fill="none" stroke="#4fc3f7" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round"/>
    ${marks}
    ${nowMarker}`;
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function banner(kind, msg) {
  const b = el('statusBanner');
  if (!msg) { b.classList.add('hidden'); return; }
  b.className = `banner ${kind}`;
  b.textContent = msg;
  b.classList.remove('hidden');
}

function renderAll(data, { stale } = {}) {
  renderNext(data.extremes);
  renderList(data.extremes);
  renderChart(synthesizeCurve(data.extremes), data.extremes);
  const footRef = el('footRef');
  if (footRef && data.station && data.station.name) {
    footRef.textContent = `Estação: ${data.station.name} · dados TideCheck`;
  }
  const cache = readCache();
  if (cache) {
    const when = fmtTime(Math.floor(cache.savedAt / 1000));
    el('updatedAt').textContent = stale
      ? `Sem ligação — dados de ${when}`
      : `Atualizado às ${when}`;
  }
  showScreen('tide');
}

/* ---------- fluxo principal ---------- */

let refreshing = false;

async function load() {
  const key = getKey();
  if (!key) { showScreen('setup'); return; }

  const cache = readCache();
  const fresh = cache && (Date.now() - cache.savedAt < CACHE_TTL_MS);

  if (cache) {
    banner(null);
    renderAll(cache.data, { stale: !navigator.onLine });
  } else {
    showScreen('loading');
  }

  if (fresh && navigator.onLine) return; // cache suficiente

  if (refreshing) return;
  refreshing = true;
  try {
    const data = await fetchTideData(key);
    writeCache(data);
    banner(null);
    renderAll(data, { stale: false });
  } catch (err) {
    const authProblem = err.status === 401 || err.status === 403 ||
      /invalid|unauthor|api.?key|forbidden/i.test(err.message);
    if (cache) {
      banner('warn', `Não atualizou: ${err.message}`);
      renderAll(cache.data, { stale: true });
    } else if (authProblem) {
      localStorage.removeItem(LS_STATION);
      showScreen('setup');
      el('keyInput').value = key;
      alertSetup(`Chave rejeitada: ${err.message}`);
    } else {
      showScreen('tide');
      banner('error', err.message);
    }
  } finally {
    refreshing = false;
  }
}

function alertSetup(msg) {
  let n = el('setupError');
  if (!n) {
    n = document.createElement('p');
    n.id = 'setupError';
    n.className = 'banner error';
    el('setupScreen').querySelector('.setup-card').prepend(n);
  }
  n.textContent = msg;
}

/* ---------- eventos ---------- */

el('saveKeyBtn').addEventListener('click', () => {
  const k = el('keyInput').value.trim();
  if (!k) { alertSetup('Cola a tua chave de API primeiro.'); return; }
  setKey(k);
  localStorage.removeItem(LS_CACHE);
  localStorage.removeItem(LS_STATION);
  showScreen('loading');
  load();
});

el('settingsBtn').addEventListener('click', () => {
  el('keyInput').value = getKey();
  showScreen('setup');
});

el('nextCard') && el('nextCard').addEventListener('click', () => {
  if (getKey()) { localStorage.removeItem(LS_CACHE); load(); }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && getKey()) load();
});
window.addEventListener('online', () => { if (getKey()) load(); });

// atualizar contagem decrescente a cada minuto
setInterval(() => {
  const cache = readCache();
  if (cache && !screens.tide.classList.contains('hidden')) renderNext(cache.data.extremes);
}, 60 * 1000);

/* ---------- service worker ---------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

load();
