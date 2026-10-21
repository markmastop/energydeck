const $ = id => document.getElementById(id);
const translations = await fetch('/translations.json').then(response => response.json());
let language;
try { language = localStorage.getItem('energydeck-language'); } catch { /* Storage can be disabled in private browsers. */ }
if (!translations[language]) language = navigator.language.startsWith('nl') ? 'nl' : 'en';
let data = null, selected = 'today', busy = false, loginBusy = false, authGeneration = 0;
const t = key => translations[language][key] || key;
const format = (value, decimals = 1) => typeof value === 'number' && Number.isFinite(value)
  ? new Intl.NumberFormat(language === 'nl' ? 'nl-NL' : 'en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value) : '—';
const text = (id, value) => { $(id).textContent = value; };
const time = value => new Intl.DateTimeFormat(language === 'nl' ? 'nl-NL' : 'en-GB', {
  timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(value));
const quarterTime = quarter => `${String(Math.floor(quarter / 4)).padStart(2, '0')}:${String(quarter % 4 * 15).padStart(2, '0')}`;
function localDate(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = key => parts.find(p => p.type === key).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function translate() {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach(node => { node.setAttribute('aria-label', t(node.dataset.i18nAria)); });
  text('language', language === 'nl' ? 'EN' : 'NL');
  $('language').setAttribute('aria-label', t('language'));
  if (data) render();
}
function showLogin() {
  authGeneration++;
  data = null;
  $('login').hidden = false;
  $('loading').hidden = true;
  $('dashboard').hidden = true;
  $('logout').hidden = true;
}
function showDashboard() {
  $('login').hidden = true;
  $('loading').hidden = true;
  $('dashboard').hidden = false;
  $('logout').hidden = false;
}
async function api(path, body) {
  return fetch(path, { method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(45000) });
}
function unavailable() {
  // Do not keep old live readings visible after a failed connection.
  const blank = { power: null, today: null, percentage: null, connected: null, charging: null, fault: null, rate: null };
  data = { grid: blank, solar: blank, battery: blank, charger: blank, gas: blank, rooms: [],
    prices: { today: null, tomorrow: null }, status: 'offline', updatedAt: null, errors: [] };
  render();
}
async function refresh() {
  if (busy || loginBusy) return;
  busy = true;
  const generation = authGeneration;
  $('refresh').disabled = true;
  try {
    const response = await api('/api/dashboard');
    if (generation !== authGeneration) return;
    if (response.status === 401) { showLogin(); return; }
    if (!response.ok) throw new Error('request');
    const next = await response.json();
    if (generation !== authGeneration) return;
    data = next;
    showDashboard(); render();
  } catch {
    if (generation !== authGeneration) return;
    // Keep an actionable screen even if the first request fails.
    showDashboard(); unavailable();
  } finally { busy = false; $('refresh').disabled = false; }
}
function priceSource(day) {
  if (!day) return t('unavailable');
  return day.source === 'homey' ? 'Homey' : day.source === 'epexprijzen' ? 'EpexPrijzen.nl' : t('unknownSource');
}
function render() {
  const now = new Date();
  text('date', new Intl.DateTimeFormat(language === 'nl' ? 'nl-NL' : 'en-GB', {
    timeZone: 'Europe/Amsterdam', weekday: 'long', day: 'numeric', month: 'long',
  }).format(now));
  text('connection', t(data.status));
  $('connection').className = `status ${data.status === 'offline' ? 'offline' : data.status !== 'online' ? 'warning' : ''}`;
  const notice = data.demo ? 'demoNotice' : data.status === 'partial' ? 'partialNotice' :
    data.status === 'unconfigured' ? 'unconfiguredNotice' : data.status === 'offline' ? 'offlineNotice' : null;
  $('notice').hidden = !notice;
  text('notice', notice ? t(notice) : '');
  // Browser-side expiry also prevents yesterday's "current" price after midnight.
  const today = data.prices.today?.date === localDate(now) ? data.prices.today : null;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const hour = Number(parts.find(p => p.type === 'hour').value);
  const minute = Number(parts.find(p => p.type === 'minute').value);
  const quarter = hour * 4 + Math.floor(minute / 15);
  text('price-now', format(today?.values[quarter]));
  text('price-period', today ? `${quarterTime(quarter)} – ${quarterTime(quarter + 1)} · ${t('currentQuarter')}` : t('unavailable'));
  text('price-source', priceSource(today));
  text('solar-power', format(data.solar.power === null ? null : data.solar.power / 1000, 2));
  text('grid-power', format(data.grid.power === null ? null : Math.abs(data.grid.power) / 1000, 2));
  text('grid-direction', data.grid.power === null ? t('grid') : t(data.grid.power < 0 ? 'export' : 'import'));
  text('electricity-day', format(data.grid.today));
  text('solar-day', format(data.solar.today));
  text('gas-day', format(data.gas.today, 2));
  text('battery-level', data.battery.percentage === null ? '—' : `${format(data.battery.percentage, 0)}%`);
  $('battery-progress').value = data.battery.percentage ?? 0;
  text('battery-power', data.battery.power === null ? '—' : `${format(Math.abs(data.battery.power), 0)} W`);
  text('battery-status', t(data.battery.power === null ? 'unavailable' : data.battery.power < -25 ? 'charging' : data.battery.power > 25 ? 'discharging' : 'standby'));
  text('charger-status', t(data.charger.fault === true ? 'fault' : data.charger.charging === true ? 'charging' :
    data.charger.connected === true ? 'connected' : data.charger.connected === false ? 'disconnected' : 'unavailable'));
  text('charger-power', data.charger.power === null ? '—' : `${format(data.charger.power / 1000, 2)} kW`);
  $('rooms').replaceChildren();
  if (!data.rooms.length) {
    const p = document.createElement('p'); p.className = 'empty'; p.textContent = t(data.status === 'offline' ? 'unavailable' : 'noRooms'); $('rooms').append(p);
  }
  data.rooms.forEach(room => {
    const node = document.createElement('div');
    node.className = `room${room.temperature !== null && room.target !== null && room.temperature < room.target - .1 ? ' heating' : ''}`;
    const name = document.createElement('span'); name.textContent = room.name;
    const measured = document.createElement('strong'); measured.textContent = room.temperature === null ? '—' : `${format(room.temperature)}°`;
    const target = document.createElement('small'); target.textContent = `${t('target')} ${room.target === null ? '—' : `${format(room.target)} °C`}`;
    node.append(name, measured, target); $('rooms').append(node);
  });
  text('updated', data.updatedAt ? `${t('updated')} ${time(data.updatedAt)} · EnergyDeck` : 'EnergyDeck');
  drawChart(today, quarter);
}
function svgNode(tag, attributes, label) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (label !== undefined) node.textContent = label;
  return node;
}
function drawChart(today, quarter) {
  const chart = $('price-chart'); chart.replaceChildren();
  $('today').setAttribute('aria-pressed', String(selected === 'today'));
  $('tomorrow').setAttribute('aria-pressed', String(selected === 'tomorrow'));
  const tomorrowDate = new Date(`${localDate(new Date())}T12:00:00Z`);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrow = data.prices.tomorrow?.date === tomorrowDate.toISOString().slice(0, 10) ? data.prices.tomorrow : null;
  const day = selected === 'today' ? today : tomorrow;
  $('chart-empty').hidden = !!day;
  // SVG elements do not implement HTMLElement.hidden; set the attribute for our CSS rule.
  chart.toggleAttribute('hidden', !day);
  for (const id of ['price-min', 'price-avg', 'price-max', 'cheapest-period']) text(id, '—');
  text('chart-date', day ? new Intl.DateTimeFormat(language === 'nl' ? 'nl-NL' : 'en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/Amsterdam' }).format(new Date(`${day.date}T12:00:00Z`)) : '');
  const warning = day && (day.cached || day.source !== 'homey');
  $('chart-warning').hidden = !warning;
  text('chart-warning', warning ? `${day.cached ? t('cachedPrices') : day.source === 'epexprijzen' ? t('reservePrices') : t('unknownSource')} · ${t('priceWarning')}` : '');
  if (!day) return;
  text('price-min', format(day.minimum)); text('price-avg', format(day.average)); text('price-max', format(day.maximum));
  text('cheapest-period', `${quarterTime(day.cheapest)} – ${quarterTime(day.cheapest + 12)}`);
  const low = Math.min(0, day.minimum), high = Math.max(1, day.maximum), range = high - low;
  const y = value => 154 - (value - low) / range * 140;
  const left = 36, width = 680, step = width / 96;
  [high, (high + low) / 2, low].forEach(value => {
    chart.append(svgNode('line', { x1: left, y1: y(value), x2: 720, y2: y(value), class: 'chart-grid' }),
      svgNode('text', { x: 0, y: y(value) + 3 }, format(value, 0)));
  });
  chart.append(svgNode('line', { x1: left, y1: y(0), x2: 720, y2: y(0), class: 'zero-line' }));
  day.values.forEach((value, i) => {
    const height = Math.max(1, Math.abs(y(value) - y(0)));
    const rect = svgNode('rect', { x: left + i * step, y: value >= 0 ? y(value) : y(0), width: step - 1.6, height, rx: 1,
      class: `price-bar ${value < 0 ? 'negative-bar' : ''} ${i >= day.cheapest && i < day.cheapest + 12 ? 'cheap-bar' : ''} ${selected === 'today' && i === quarter ? 'current-bar' : ''}` });
    rect.append(svgNode('title', {}, `${quarterTime(i)} · ${format(value)} ct/kWh`)); chart.append(rect);
  });
  [0, 6, 12, 18, 24].forEach(hour => chart.append(svgNode('text', {
    x: left + hour / 24 * width, y: 180, 'text-anchor': hour === 24 ? 'end' : hour === 0 ? 'start' : 'middle',
  }, `${String(hour).padStart(2, '0')}:00`)));
}
$('language').addEventListener('click', () => {
  language = language === 'nl' ? 'en' : 'nl';
  try { localStorage.setItem('energydeck-language', language); } catch { /* Preference only; never store authentication in localStorage. */ }
  translate();
});
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); if (loginBusy) return;
  loginBusy = true; $('login-button').disabled = true; text('login-button', t('loggingIn')); text('login-error', '');
  try {
    const response = await api('/api/login', { code: $('access-code').value });
    $('access-code').value = '';
    if (!response.ok) {
      const body = await response.json();
      text('login-error', t(['invalidCode', 'rateLimited', 'sessionLimit'].includes(body.error) ? body.error : 'loginFailed'));
      return;
    }
    const session = await api('/api/session');
    if (!session.ok) { text('login-error', t('cookieFailed')); return; }
    loginBusy = false; await refresh();
  } catch { text('login-error', t('loginFailed')); }
  finally { loginBusy = false; $('login-button').disabled = false; text('login-button', t('login')); }
});
$('logout').addEventListener('click', async () => {
  $('logout').disabled = true;
  try { const response = await api('/api/logout', {}); if (response.ok) { showLogin(); $('access-code').focus(); } }
  catch { text('notice', t('offlineNotice')); $('notice').hidden = false; }
  finally { $('logout').disabled = false; }
});
$('refresh').addEventListener('click', refresh);
for (const day of ['today', 'tomorrow']) $(day).addEventListener('click', () => { selected = day; if (data) render(); });
translate();
await refresh();
setInterval(() => { if (data && !document.hidden) refresh(); }, 15000);
document.addEventListener('visibilitychange', () => { if (data && !document.hidden) refresh(); });
