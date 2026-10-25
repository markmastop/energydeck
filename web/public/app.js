import { initializeDetails } from './details.js';
import { priceWindow, priceQuarter, priceTime } from './charts.js';
import { dayComparison } from './display.js';
import { createLiveUpdates } from './live.js';
import { batteryPlanView, planClock } from './battery-plan.js';

const $ = id => document.getElementById(id);
const translations = await fetch('/translations.json').then(response => response.json());
let language;
try { language = localStorage.getItem('energydeck-language'); } catch { /* Storage can be disabled in private browsers. */ }
if (!translations[language]) language = navigator.language.startsWith('nl') ? 'nl' : 'en';
let data = null, selected = 'today', busy = false, loginBusy = false, authGeneration = 0;
let liveRevision = 0;
const live = createLiveUpdates({
  onDashboard(next) { liveRevision++; data = next; showDashboard(); render(); },
  onUnavailable() { liveRevision++; unavailable(); },
  onUnauthorized: showLogin,
  checkSession: () => api('/api/session'),
});
const t = key => translations[language][key] || key;
const format = (value, decimals = 1) => typeof value === 'number' && Number.isFinite(value)
  ? new Intl.NumberFormat(language === 'nl' ? 'nl-NL' : 'en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value) : '—';
const text = (id, value) => { $(id).textContent = value; };
const time = value => new Intl.DateTimeFormat(language === 'nl' ? 'nl-NL' : 'en-GB', {
  timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(value));
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
  live.stop();
  authGeneration++;
  data = null;
  details.reset();
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
    credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(path === '/api/sonos/command' ? 180000 : 45000) });
}
function unavailable() {
  // Do not keep old live readings visible after a failed connection.
  const blank = { power: null, today: null, percentage: null, connected: null, charging: null, fault: null, rate: null, canStart: false };
  data = { grid: blank, solar: blank, battery: blank, charger: blank, gas: blank, rooms: [], climate: { demand: 'unknown', mode: null },
    prices: { today: null, tomorrow: null }, status: 'offline', updatedAt: null, errors: [] };
  render();
}
async function refresh() {
  if (busy || loginBusy) return;
  busy = true;
  const generation = authGeneration;
  const revision = liveRevision;
  $('refresh').disabled = true;
  try {
    const response = await api('/api/dashboard');
    if (generation !== authGeneration) return;
    if (response.status === 401) { showLogin(); return; }
    if (!response.ok) throw new Error('request');
    const next = await response.json();
    if (generation !== authGeneration) return;
    // A slower REST response must not overwrite a more recent pushed snapshot.
    if (revision !== liveRevision) return;
    data = next;
    showDashboard(); render();
    if (!document.hidden) live.start();
  } catch {
    if (generation !== authGeneration || revision !== liveRevision) return;
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
  const quarter = today ? priceQuarter(today, now) : 0;
  text('price-now', format(today?.values[quarter]));
  const periodTime = q => priceTime(today.start + q * 900000, today.values.length !== 96);
  text('price-period', today ? `${periodTime(quarter)} – ${periodTime(quarter + 1)} · ${t('currentQuarter')}` : t('unavailable'));
  text('price-source', priceSource(today));
  text('electricity-day', format(data.grid.today));
  text('solar-day', format(data.solar.today));
  text('gas-day', format(data.gas.today, 2));
  text('battery-level', data.battery.percentage === null ? '—' : `${format(data.battery.percentage, 0)}%`);
  $('battery-progress').value = data.battery.percentage ?? 0;
  text('battery-power', data.battery.power === null ? '—' : `${format(Math.abs(data.battery.power), 0)} W`);
  text('battery-status', t(data.battery.power === null ? 'unavailable' : data.battery.power < -25 ? 'charging' : data.battery.power > 25 ? 'discharging' : 'standby'));
  const view = batteryPlanView(data.battery.plan, now), plan = view.plan;
  text('battery-energy', plan && data.battery.percentage !== null ? `${format(plan.capacityKwh * data.battery.percentage / 100)} / ${format(plan.capacityKwh)} kWh` : '—');
  text('battery-goal', plan?.enabled ? `${t('batteryGoal')} ${planClock(plan.deadlineMinute)}` : '—');
  text('battery-plan-status', `${t(view.label).replace('{time}', planClock(plan?.deadlineMinute ?? null))}${view.label === 'batteryPlanSolar' && plan?.startMinute !== null ? ` ${planClock(plan.startMinute)}` : ''}`);
  if (plan?.enabled && plan.sunMinutes !== null) {
    const sunshine = t('batterySunForecast').replace('{minutes}', format(plan.sunMinutes, 0)).replace('{hours}', format(plan.sunWindowMinutes / 60));
    text('battery-plan-status', `${$('battery-plan-status').textContent} · ${sunshine}`);
  }
  text('battery-plan-rate', plan?.enabled ? `${t('batteryPlanRate')} ${format(plan.topUpW / 1000)} kW` : '');
  $('battery-sunshine').title = t('batterySunTimeline');
  $('battery-sunshine').replaceChildren(...(plan?.enabled ? view.sunshine : []).map(period => {
    const segment = document.createElement('span');
    segment.style.left = `${period.left}%`;
    segment.style.width = `${period.width}%`;
    segment.style.opacity = String((45 + period.fraction * 210) / 255);
    return segment;
  }));
  $('battery-timeline').hidden = !plan?.enabled;
  if (plan?.enabled) {
    const start = view.start ?? 100;
    $('battery-solar-window').style.width = `${start}%`;
    $('battery-topup-window').style.left = `${start}%`;
    $('battery-topup-window').style.width = `${100 - start}%`;
    $('battery-now-marker').style.left = `${view.now}%`;
    text('battery-reserve-time', planClock(plan.reserveMinute));
    text('battery-start-time', plan.startMinute === null ? '' : `${t('batteryPlanStart')} ${planClock(plan.startMinute)}`);
    text('battery-deadline-time', planClock(plan.deadlineMinute));
    $('battery-timeline').setAttribute('aria-label', t('batteryPlanTimeline').replace('{reserve}', planClock(plan.reserveMinute)).replace('{start}', planClock(plan.startMinute)).replace('{deadline}', planClock(plan.deadlineMinute)) + (view.sunshine.length ? ` ${t('batterySunTimeline')}` : ''));
  }
  const charger = data.charger;
  const chargeState = charger.connected === false ? 'disconnected' : charger.fault === true ? 'fault' :
    charger.connected !== true || charger.charging === null || charger.fault !== false ? 'unavailable' : charger.charging ? 'charging' : charger.complete ? 'chargeComplete' : 'connected';
  text('charger-status', t(chargeState));
  text('charger-power', chargeState === 'charging' ? `${format(charger.power / 1000, 1)} kW` : t(chargeState === 'connected' ? 'chargeWaiting' : chargeState === 'chargeComplete' ? 'vehicleReady' : chargeState === 'disconnected' ? 'connectVehicle' : chargeState === 'fault' ? 'checkCharger' : 'retryShortly'));
  $('rooms').replaceChildren();
  if (!data.rooms.length) {
    const p = document.createElement('p'); p.className = 'empty'; p.textContent = t(data.status === 'offline' ? 'unavailable' : 'noRooms'); $('rooms').append(p);
  }
  data.rooms.forEach(room => {
    const node = document.createElement('div');
    node.className = `room${data.climate?.mode && data.climate?.demand !== 'off' && room.temperature !== null && room.target !== null && room.target - room.temperature > .05 ? ' heating' : ''}`;
    const name = document.createElement('span'); name.textContent = room.name;
    const measured = document.createElement('strong'); measured.textContent = room.temperature === null ? '—' : `${format(room.temperature)}°`;
    const target = document.createElement('small'); target.textContent = `${t('target')} ${room.target === null ? '—' : `${format(room.target)} °C`}`;
    node.append(name, measured, target); $('rooms').append(node);
  });
  text('updated', data.updatedAt ? `${t('updated')} ${time(data.updatedAt)} · EnergyDeck` : 'EnergyDeck');
  drawChart(today, quarter);
  details.dashboard(data);
}
function svgNode(tag, attributes, label) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (label !== undefined) node.textContent = label;
  return node;
}
function drawChart(today, quarter) {
  const chart = $('price-chart'); chart.replaceChildren();
  const chartWidth = Math.max(280, chart.clientWidth || 720);
  chart.setAttribute('viewBox', `0 0 ${chartWidth} 190`);
  $('today').setAttribute('aria-pressed', String(selected === 'today'));
  $('tomorrow').setAttribute('aria-pressed', String(selected === 'tomorrow'));
  const tomorrowDate = new Date(`${localDate(new Date())}T12:00:00Z`);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrow = data.prices.tomorrow?.date === tomorrowDate.toISOString().slice(0, 10) ? data.prices.tomorrow : null;
  const comparison = dayComparison(today, tomorrow);
  $('tomorrow-comparison').hidden = !comparison;
  $('tomorrow-comparison').className = `tomorrow-comparison ${comparison?.label || ''}`;
  text('tomorrow-comparison', comparison ? `${t(comparison.label)}${comparison.label === 'tomorrowEqual' ? '' : ` · ${comparison.difference > 0 ? '+' : '−'}${format(Math.abs(comparison.difference))} ct ${t('average').toLowerCase()}`}` : '');
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
  const window = priceWindow(day, selected === 'today' ? tomorrow : null, quarter);
  text('price-min', format(window.minimum)); text('price-avg', format(window.average)); text('price-max', format(window.maximum));
  const withOffset = day.values.length !== 96 || window.offset && tomorrow.values.length !== 96;
  const windowTime = q => {
    const stamp = window.start + q * 900000;
    return `${priceTime(stamp, withOffset)}${window.offset && stamp >= day.end ? ` ${t('tomorrow')}` : ''}`;
  };
  text('cheapest-period', `${windowTime(window.cheapest)} – ${windowTime(window.cheapest + 12)}`);
  if (window.offset) text('chart-date', `${t('today')} 12:00 → ${t('tomorrow')} 12:00`);
  if (window.offset && (tomorrow.cached || tomorrow.source !== 'homey')) { $('chart-warning').hidden = false; text('chart-warning', t('priceWarning')); }
  const low = Math.min(0, window.minimum), high = Math.max(1, window.maximum), range = high - low;
  const y = value => 154 - (value - low) / range * 140;
  const left = 32, width = chartWidth - left - 4, step = width / window.values.length;
  [high, (high + low) / 2, low].forEach(value => {
    chart.append(svgNode('line', { x1: left, y1: y(value), x2: chartWidth, y2: y(value), class: 'chart-grid' }),
      svgNode('text', { x: 0, y: y(value) + 3 }, format(value, 0)));
  });
  chart.append(svgNode('line', { x1: left, y1: y(0), x2: chartWidth, y2: y(0), class: 'zero-line' }));
  window.values.forEach((value, i) => {
    const height = Math.max(1, Math.abs(y(value) - y(0)));
    const rect = svgNode('rect', { x: left + i * step, y: value >= 0 ? y(value) : y(0), width: Math.max(1, step - .8), height, rx: 1,
      class: `price-bar ${value <= window.minimum + (window.maximum - window.minimum) * .33 ? 'low-price' : value >= window.minimum + Math.max(.001, window.maximum - window.minimum) * .66 ? 'high-price' : 'mid-price'} ${i >= window.cheapest && i < window.cheapest + 12 ? 'cheap-bar' : ''} ${selected === 'today' && i + window.offset === quarter ? 'current-bar' : ''}` });
    rect.append(svgNode('title', {}, `${windowTime(i)} · ${format(value)} ct/kWh`)); chart.append(rect);
  });
  [0, .25, .5, .75, 1].forEach(fraction => chart.append(svgNode('text', {
    x: left + fraction * width, y: 180, 'text-anchor': fraction === 1 ? 'end' : fraction === 0 ? 'start' : 'middle',
  }, priceTime(window.start + Math.round(fraction * window.values.length) * 900000))));
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
const details = initializeDetails({ api, t, format, time, svgNode, onUnauthorized: showLogin, onRefresh: refresh });
translate();
await refresh();
setInterval(() => { if (data && !document.hidden && !live.connected) refresh(); }, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) live.stop();
  else if (data) refresh();
});
window.addEventListener('pagehide', () => live.stop());
window.addEventListener('pageshow', () => { if (data && !document.hidden) live.start(); });
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (data) render(); }, 150); });
