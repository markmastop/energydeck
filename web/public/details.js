import { initializeBatteryDetail } from './battery-detail.js';
import { sunshineFraction } from './sunshine.js';
import { lineSegments } from './charts.js';
import { createDisplayState, powerArc, createHomeCards } from './display.js';

// Detail views share the dashboard session and never send device commands while rendering.
export function initializeDetails({ api, t, format, time, svgNode, onUnauthorized, onRefresh }) {
  const $ = id => document.getElementById(id);
  const batteryDetail = initializeBatteryDetail({t,format});
  const display = createDisplayState();
  const homeCards = createHomeCards();
  let lastInteraction = Date.now();
  // Real input extends the manual choice. Polling and mouse hover do not.
  for (const event of ['pointerdown', 'click', 'keydown', 'wheel', 'touchmove'])
    document.addEventListener(event, () => { lastInteraction = Date.now(); }, { capture: true, passive: true });
  const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
  const text = (id, value) => { $(id).textContent = value; };
  const button = (label, fn, className = 'quiet', disabled = false) => {
    const element = node('button', className, label); element.type = 'button'; element.disabled = disabled; element.addEventListener('click', fn); return element;
  };
  let page = 'overview', card = 'gas', view = 'queue', dashboard = null, weather = null, history = null, sonos = null;
  let room = '', sonosError = '', message = '', commandBusy = false, generation = 0, sonosVersion = 0, explicitRoom = false;
  let weatherAt = 0, historyAt = 0, sonosAt = 0, weatherPending = false, historyPending = false, sonosPending = false;
  let queueSignature = '', queueCentered = '', queueVisible = false, queueHeight = 0;
  let queueQuietUntil = 0, queueHeld = false, queueDeferred = false, queueFollowTimer;
  let draft = null, yearTotals = false, chargeUntil = 0, chargeMessage = '', chargeBusy = false, wasPlaying = false, chargeTarget = null;
  const knownErrors = new Set(['sonosOffline', 'sonosUnconfigured', 'roomChanged', 'favoritesChanged', 'actionUnavailable', 'commandBusy', 'commandUnconfirmed', 'chargerNotReady', 'unconfigured', 'rateLimited', 'invalidGroup']);
  const errorLabel = error => t(knownErrors.has(error?.code) ? error.code : 'commandFailed');
  const dateKey = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  async function request(path, body) {
    const response = await api(path, body);
    if (response.status === 401) { onUnauthorized(); throw { code: 'unauthorized' }; }
    const result = await response.json();
    if (!response.ok) throw { code: result.error, status: response.status };
    return result;
  }
  function navigate(next, scroll = true) {
    if (!['overview', 'energy', 'sonos', 'climate', 'battery'].includes(next)) return;
    page = next;
    document.body.dataset.page = page;
    for (const name of ['overview', 'energy', 'sonos', 'climate', 'battery']) $(`page-${name}`).hidden = name !== page;
    document.querySelectorAll('#page-nav [data-open]').forEach(element => {
      if (element.dataset.open === page) element.setAttribute('aria-current', 'page'); else element.removeAttribute('aria-current');
    });
    if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
    if (dashboard) { render(); update(); onRefresh(); }
  }
  document.querySelectorAll('[data-open]').forEach(element => element.addEventListener('click', () => navigate(element.dataset.open)));
  document.querySelectorAll('[data-card]').forEach(element => element.addEventListener('click', () => {
    const next = element.dataset.card;
    // Match the ESP: choose a different compact card first; repeat the tap for details.
    if (card === next) { navigate(next === 'gas' ? 'energy' : next); return; }
    card = next; renderCards();
    if (card === 'sonos') { sonosVersion++; loadSonos(true); }
  }));
  function updateHomeCard() {
    if (page !== 'overview' || commandBusy || sonos?.busy) return;
    const rooms = sonos?.rooms || [];
    const playing = rooms.some(room => room.state === 'PLAYING');
    const stopped = rooms.length > 0 && rooms.every(room => ['STOPPED', 'PAUSED_PLAYBACK', 'NO_MEDIA_PRESENT'].includes(room.state));
    card = homeCards.update(card, playing, stopped, dashboard?.climate?.demand === 'demand', Date.now() - lastInteraction);
  }
  function renderCards() {
    for (const name of ['gas', 'sonos', 'climate']) $(`card-${name}`).hidden = name !== card;
    document.querySelectorAll('[data-card]').forEach(element => element.setAttribute('aria-pressed', String(element.dataset.card === card)));
  }
  async function loadWeather() {
    if (weatherPending || !dashboard || Date.now() - weatherAt < 300000 && weather && dateKey(weather.updatedAt) === dateKey(Date.now())) return;
    weatherPending = true; const version = generation;
    try { const result = await request('/api/weather'); if (version === generation) { weather = result; weatherAt = Date.now(); renderWeather(); } }
    catch { if (version === generation) { weather = null; renderWeather(); } }
    finally { weatherPending = false; }
  }
  async function loadHistory(force = false) {
    const sameDay = !history || Date.now() >= history.power.start && Date.now() < history.power.end;
    if (historyPending || !dashboard || !force && sameDay && Date.now() - historyAt < 240000) return;
    historyPending = true; $('history-refresh').disabled = true; const version = generation;
    if (!history) renderHistory();
    try { const result = await request('/api/history'); if (version === generation) { history = result; historyAt = Date.now(); renderHistory(); } }
    catch { if (version === generation) { history = null; renderHistory(); } }
    finally { historyPending = false; $('history-refresh').disabled = false; }
  }
  async function loadSonos(force = false) {
    if (!dashboard || commandBusy || sonosPending || !force && Date.now() - sonosAt < 10000) return;
    sonosPending = true; const version = generation, selection = sonosVersion, chosen = page === 'overview' ? '' : room;
    try {
      const result = await request(`/api/sonos?room=${encodeURIComponent(chosen)}&favorites=${page === 'sonos' && view === 'favorites' || page === 'overview' && card === 'sonos'}&queue=${page === 'sonos' && view === 'queue'}&combined=${!(page === 'sonos' && view === 'rooms')}`);
      if (version !== generation || selection !== sonosVersion) return;
      // Scope changes invalidate a grouping draft, never silently rebase its membership.
      if (draft && draft.scope !== result.scope) draft.stale = true;
      sonos = result; sonosError = ''; sonosAt = Date.now();
      room = result.player.roomId;
      const playing = result.rooms.some(room => room.state === 'PLAYING');
      const stopped = result.rooms.length && result.rooms.every(room => ['STOPPED', 'PAUSED_PLAYBACK', 'NO_MEDIA_PRESENT'].includes(room.state));
      updateHomeCard();
      const returnHome = page === 'sonos' && stopped && wasPlaying && !commandBusy && !draft;
      if (playing || stopped) wasPlaying = playing;
      if (returnHome) { homeCards.reset(); navigate('overview'); }
      renderCards();
      renderSonos();
    } catch (error) {
      if (version !== generation || selection !== sonosVersion) return;
      sonos = null; sonosError = errorLabel(error); renderSonos();
    } finally {
      sonosPending = false;
      if (selection !== sonosVersion && dashboard) loadSonos(true);
    }
  }
  function update() {
    if (!dashboard || dashboard.status === 'offline') return;
    if (page === 'overview' || page === 'climate') loadWeather();
    if (page === 'energy') loadHistory();
    if (page === 'overview' || page === 'sonos') loadSonos();
  }
  function render() {
    document.querySelector('.page-heading h1').textContent = page === 'overview' ? t('yourEnergy') : page === 'sonos' ? 'Sonos' : t(page === 'battery' ? 'batteryDetails' : page === 'energy' ? 'energy' : 'climate');
    updateHomeCard();
    if (page === 'battery') batteryDetail.render(dashboard.battery,new Date(),dashboard.prices);
    renderHeader(); renderCards(); renderTotals(); renderClimate(); renderWeather(); renderHistory(); renderSonos(); renderCharge();
  }
  function renderHeader() {
    if (!dashboard) return;
    text('clock', time(Date.now()));
    const { grid, gas, solar, battery, climate, charger } = dashboard;
    const state = display.update(dashboard);
    text('header-grid-title', t(state.gridPending || state.gridMode < 0 ? 'grid' : state.gridMode === 1 ? 'export' : 'import'));
    text('shared-grid', grid.power === null ? '—' : format(Math.abs(grid.power) / 1000));
    text('header-grid-sub', `${format(grid.today)} kWh`);
    const liveGas = state.gasMode === 1 && gas.rate !== null;
    text('header-gas-title', t(liveGas ? 'gasNow' : 'gasToday'));
    text('header-gas-value', format(liveGas ? gas.rate : gas.today, 2));
    text('header-gas-unit', liveGas ? 'm³/h' : 'm³');
    text('header-gas-sub', `${format(liveGas ? gas.today : gas.yesterday, 2)} m³`);
    text('header-gas-extra', t(liveGas ? 'today' : 'yesterday'));
    const storage = state.source === 1;
    text('header-source-title', t(storage ? 'battery' : 'solar'));
    text('header-source-value', state.source < 0 ? '—' : format(storage ? battery.percentage : solar.power / 1000, storage ? 0 : 1));
    text('header-source-unit', storage ? '%' : 'kW');
    text('header-source-sub', storage ? `${t('solarShort')} ${format(solar.power === null ? null : solar.power / 1000)} kW` : `${t('batteryShort')} ${format(battery.percentage, 0)}%`);
    text('header-source-extra', `${battery.power === null ? '' : battery.power < -25 ? '↓ ' : battery.power > 25 ? '↑ ' : ''}${format(battery.power === null ? null : Math.abs(battery.power), 0)} W`);
    const arc = (id, value, directional) => {
      const meter = $(id), amount = Math.abs(value) * (directional ? .375 : .75);
      meter.querySelector('.meter-arc').setAttribute('stroke-dasharray', `${amount} ${100 - amount}`);
      meter.querySelector('.meter-arc').setAttribute('stroke-dashoffset', directional ? value < 0 ? amount - 37.5 : -37.5 : 0);
      const zero = meter.querySelector('.meter-zero'); if (zero) zero.style.visibility = directional ? 'visible' : 'hidden';
    };
    arc('header-grid-dial', powerArc(grid.power), true);
    arc('header-gas-dial', Math.max(0, Math.min(100, (liveGas ? gas.rate : gas.today) * (liveGas ? 33.3 : 10))), false);
    arc('header-source-dial', powerArc(state.source < 0 ? null : storage ? battery.power : solar.power), storage);
    for (const [name, label] of [['heat', t(`heat${climate?.demand || 'unknown'}`)], ['car', t(charger.connected === false ? 'disconnected' : charger.connected !== true ? 'unavailable' : charger.charging ? 'charging' : 'connected')], ['battery', `${format(battery.percentage, 0)}%`]]) {
      $(`status-${name}`).className = `icon-${state[name]}`;
      text(`status-${name}-text`, label);
    }
    $('status-battery-fill').setAttribute('width', 17 * Math.max(0, Math.min(100, battery.percentage ?? 0)) / 100);
    const live = $('energy-live'); live.replaceChildren();
    const sum = [grid.power, solar.power, battery.power].every(value => typeof value === 'number' && Number.isFinite(value)) ? grid.power + solar.power + battery.power : null;
    for (const [key, value] of [['houseDemand', sum !== null && sum >= 0 ? sum : null], ['grid', grid.power], ['solar', solar.power], ['battery', battery.power], ['charger', charger.power]]) {
      const cell = node('div'); cell.append(node('span', 'muted', t(key)), node('strong', '', `${format(value === null ? null : value / 1000)} kW`)); live.append(cell);
    }
  }
  function renderTotals() {
    if (!dashboard) return;
    const period = yearTotals ? 'year' : 'today';
    text('electricity-day', format(dashboard.grid[period])); text('solar-day', format(dashboard.solar[period]));
    $('electricity-day').previousElementSibling.textContent = t(yearTotals ? 'electricityYear' : 'electricityToday');
    $('solar-day').previousElementSibling.textContent = t(yearTotals ? 'solarYear' : 'solarToday');
    $('gas-summary').replaceChildren();
    for (const key of ['today', 'month', 'year']) {
      const cell = node('div'); cell.append(node('span', 'muted', t(key)), node('strong', '', format(dashboard.gas[key], key === 'year' ? 0 : 2)), node('small', 'muted', 'm³')); $('gas-summary').append(cell);
    }
    const table = node('table', 'totals-table'); const head = node('tr');
    for (const label of ['', t('grid'), t('solar'), t('gas')]) head.append(node('th', '', label));
    const header = node('thead'); header.append(head); table.append(header);
    const body = node('tbody');
    for (const key of ['today', 'yesterday', 'month', 'year']) {
      const row = node('tr'); row.append(node('th', '', t(key)));
      for (const metric of ['grid', 'solar', 'gas']) row.append(node('td', '', `${format(dashboard[metric][key], metric === 'gas' ? 2 : 1)} ${metric === 'gas' ? 'm³' : 'kWh'}`));
      body.append(row);
    }
    table.append(body); $('energy-totals').replaceChildren(table);
    const peaks = node('p', 'muted fine-print', `${t('powerPeak')}: ${format(dashboard.grid.peak, 0)} W · ${t('solarPeak')}: ${format(dashboard.solar.peak, 0)} W`); $('energy-totals').append(peaks);
  }
  function renderClimate() {
    if (!dashboard) return;
    const climate = dashboard.climate || { demand: 'unknown', mode: null };
    text('compact-climate-status', t(`heat${climate.demand}`));
    $('compact-climate-status').className = `fine-print heat-${climate.demand}`;
    const programme = $('climate-programme'); programme.className = `programme ${climate.demand}`;
    programme.replaceChildren(node('strong', '', climate.mode ? t(`mode${climate.mode}`) : t('unavailable')), node('span', '', t(`heat${climate.demand}`)));
    $('climate-rooms').replaceChildren();
    for (const entry of dashboard.rooms) {
      const demanding = climate.demand !== 'off' && climate.mode && entry.temperature !== null && entry.target !== null && entry.target - entry.temperature > .05;
      const item = node('div', `climate-room${demanding ? ' heating' : ''}`);
      item.append(node('h3', '', entry.name), node('strong', '', `${format(entry.temperature)} °C`),
        node('small', 'muted', `${t('target')} ${format(entry.target)} °C`), node('span', 'room-demand', t(demanding ? 'heatdemand' : climate.demand === 'off' ? 'heatoff' : !climate.mode || entry.temperature === null || entry.target === null ? 'heatunknown' : 'roomAtTarget')));
      $('climate-rooms').append(item);
    }
    if (!dashboard.rooms.length) $('climate-rooms').append(node('p', 'empty', t('noRooms')));
  }
  function renderWeather() {
    const fresh = weather && Date.now() - Date.parse(weather.updatedAt) < 900000 && dateKey(weather.updatedAt) === dateKey(Date.now());
    const data = fresh ? weather : null;
    const sun = data ? `↑ ${data.sunrise ? time(data.sunrise) : '—'}  ↓ ${data.sunset ? time(data.sunset) : '—'}` : '';
    text('sun-times', sun); text('climate-sun-times', sun); text('header-sun-times', sun);
    for (const id of ['weather-overview', 'weather-climate']) {
      const container = $(id); container.replaceChildren();
      const summary = node('div', 'weather-summary');
      const current = node('div'); current.append(node('strong', '', `${format(data?.summary?.temperature)} °C`), node('span', 'muted', t(`weather${data?.summary?.condition || 'unknown'}`)));
      const outlook = node('div'); outlook.append(node('span', 'muted', `${t('inThreeHours')} ${format(data?.temperature3h)} °C`),
        node('span', 'muted', `${t('tomorrow')} ${format(data?.summary?.tomorrowMin, 0)} – ${format(data?.summary?.tomorrowMax, 0)} °C`));
      summary.append(current, outlook); container.append(summary);
      // This rolling two-hour summary is independent of rain availability.
      const sunNow = Date.now();
      const sunny = sunshineFraction(data?.sunshine, sunNow, sunNow + 7200000, sunNow);
      const sunLabel = sunny === null ? t('weatherSunUnknown') : sunny <= 0 ? t('weatherSunNone') :
        t('weatherSunMinutes').replace('{minutes}', format(Math.max(1, Math.round(sunny * 120)), 0));
      container.append(node('p', `sunshine-heading${sunny === null ? ' muted' : ''}`, sunLabel));
      const points = data?.rain?.points?.filter(point => point.time + 300000 > Date.now()) || [];
      const firstRain = points.findIndex(point => point.value >= .1);
      const label = !points.length ? t('rainUnknown') : firstRain < 0 ? t('rainDry') : firstRain === 0 ? t('rainNow') : `${t('rainAt')} ${time(points[firstRain].time)}`;
      container.append(node('p', 'rain-heading', label));
      const chartWidth = Math.max(280, container.clientWidth || 720), step = (chartWidth - 58) / 24;
      const svg = svgNode('svg', { viewBox: `0 0 ${chartWidth} 95`, role: 'img', 'aria-label': t('rainForecast'), class: 'rain-chart' });
      for (const [key, y] of [['rainHeavy', 13], ['rainModerate', 31], ['rainLight', 49]]) svg.append(svgNode('text', { x: 0, y, class: 'rain-scale' }, t(key)));
      points.forEach((point, i) => {
        const level = point.value < 2.5 ? point.value / 2.5 : point.value < 7.5 ? 1 + (point.value - 2.5) / 5 : 2 + Math.min(1, (point.value - 7.5) / 12.5);
        const height = point.value < .1 ? 2 : Math.max(3, level * 18);
        const rect = svgNode('rect', { x: 48 + i * step, y: 60 - height, width: Math.max(2, step - 3), height, rx: 3, class: point.value < .1 ? 'dry-bar' : 'rain-bar' });
        rect.append(svgNode('title', {}, `${time(point.time)} · ${format(point.value, 2)} mm/h`)); svg.append(rect);
        const sun = sunshineFraction(data?.sunshine, point.time, point.time + 300000);
        if (sun !== null && sun > 0) {
          const cap = svgNode('rect', {x:48+i*step, y:Math.max(0,60-height-3), width:Math.max(2,(step-3)*sun), height:2, rx:1, class:'sunshine-cap'});
          cap.append(svgNode('title', {}, t('rainSunCap').replace('{percent}',format(sun*100,0))));
          svg.append(cap);
        }
      });
      if (points.length) {
        svg.append(svgNode('text', { x: 48, y: 84 }, time(points[0].time)), svgNode('text', { x: chartWidth - 10, y: 84, 'text-anchor': 'end' }, time(points.at(-1).time + 300000)));
      }
      container.append(svg);
      const sources = node('p', 'weather-sources');
      for (const [title, url] of [['Buienradar', 'https://www.buienradar.nl'], ['Open-Meteo', 'https://open-meteo.com']]) {
        const a = node('a', '', title); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; sources.append(a);
      }
      container.append(sources);
    }
  }
  function renderHistory() {
    for (const type of ['power', 'gas']) {
      const svg = $(`history-${type}`); svg.replaceChildren();
      const chartWidth = Math.max(280, svg.clientWidth || 720), plotWidth = chartWidth - 46;
      svg.setAttribute('viewBox', `0 0 ${chartWidth} 200`);
      svg.setAttribute('preserveAspectRatio', 'none');
      const series = history?.[type];
      const points = series?.points || [];
      const fresh = points.length && Date.now() - points.at(-1).time <= 900000 && Date.now() >= series.start && Date.now() < series.end;
      text(`history-${type}-status`, fresh ? `${t('updated')} ${time(points.at(-1).time)} · ${t('fiveMinutes')}` : t(historyPending ? 'loading' : 'historyUnavailable'));
      if (!fresh) continue;
      const signed = type === 'power', maximum = Math.max(signed ? .5 : .1, ...points.map(point => Math.abs(point.value)));
      const x = value => 38 + (value - series.start) / (series.end - series.start) * plotWidth;
      const y = value => signed ? 88 - value / maximum * 72 : 160 - value / maximum * 144;
      for (const value of signed ? [maximum, 0, -maximum] : [maximum, maximum / 2, 0]) {
        svg.append(svgNode('line', { x1: 38, x2: chartWidth - 8, y1: y(value), y2: y(value), class: 'history-grid' }), svgNode('text', { x: 0, y: y(value) + 4 }, format(value, 1)));
      }
      const segment = (a, b) => svg.append(svgNode('line', { x1: x(a.time), x2: x(b.time), y1: y(a.value), y2: y(b.value), class: a.value < 0 || b.value < 0 ? 'history-export' : 'history-import' }));
      for (const [a, b] of lineSegments(points, signed)) segment(a, b);
      [0, .25, .5, .75, 1].forEach(fraction => svg.append(svgNode('text', { x: 38 + plotWidth * fraction, y: 188, 'text-anchor': fraction === 1 ? 'end' : 'start' }, fraction === 1 ? '24:00' : time(series.start + (series.end - series.start) * fraction))));
    }
  }
  function cover(player, compact) {
    const box = node('div', compact ? 'cover compact-cover' : 'cover');
    const fallback = node('span', 'cover-fallback', '♫'); fallback.setAttribute('aria-hidden', 'true'); box.append(fallback);
    if (/^\/(?:api\/sonos\/artwork\/[a-f0-9]{64}|stations\/[a-z0-9-]+\.jpg)$/.test(player.artwork || '')) {
      const image = node('img'); image.src = player.artwork; image.alt = ''; image.addEventListener('error', () => image.remove(), { once: true }); box.append(image);
    }
    return box;
  }
  function playerControls(player, compact = false) {
    const controls = node('div', 'player-controls');
    const transportRow = node('div', 'transport-row'), volumeRow = node('div', 'volume-row');
    const actions = player.actions || [], locked = commandBusy || sonos?.busy || Date.now() - player.updatedAt > 45000;
    const volumeUnavailable = player.volume === null || (!(page === 'sonos' && view === 'rooms') && player.volumeValues?.some(item => item.value === null));
    const control = (symbol, label, action, extra, disabled = false) => {
      const element = button(symbol, () => send(action, extra), action === 'play' || action === 'pause' ? 'transport play-button' : 'transport', locked || disabled);
      element.setAttribute('aria-busy', String(Boolean(commandBusy || sonos?.busy)));
      element.setAttribute('aria-label', t(label)); (['volume', 'mute'].includes(action) ? volumeRow : transportRow).append(element);
      return element;
    };
    if (!compact) control('⏮', 'previous', 'previous', {}, player.tv || !actions.includes('Previous'));
    const playing = player.state === 'PLAYING';
    control(playing ? 'Ⅱ' : '▶', playing ? 'pause' : 'play', playing ? 'pause' : 'play', {}, player.tv || !actions.includes(playing ? 'Pause' : 'Play'));
    if (!compact) control('⏭', 'next', 'next', {}, player.tv || !actions.includes('Next'));
    const volumeIcon = high => {
      const icon = svgNode('svg', {width:24, height:24, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', 'stroke-width':1.8, 'aria-hidden':'true'});
      icon.append(svgNode('path', {d:'M11 4 6 8H3v8h3l5 4Z', 'stroke-linejoin':'round'}));
      icon.append(svgNode('path', {d:high ? 'M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14' : 'M15 8a6 6 0 0 1 0 8', 'stroke-linecap':'round'}));
      return icon;
    };
    control('', 'volumeDown', 'volume', { delta: -2 }, volumeUnavailable).append(volumeIcon(false));
    const roomVolume = page === 'sonos' && view === 'rooms';
    const values = roomVolume ? [player.volume] : (player.volumeValues || [{ value: player.volume }]).map(item => item.value);
    const displayed = values.some(value => value === null) ? '—' : `${Math.min(...values)}%`;
    volumeRow.append(node('span', 'volume-value', `${t(roomVolume ? 'roomVolume' : 'groupVolume')} ${displayed}`));
    control('', 'volumeUp', 'volume', { delta: 2 }, volumeUnavailable).append(volumeIcon(true));
    if (!compact) {
      const mute = control('', player.mute ? 'unmute' : 'mute', 'mute', { mute: !player.mute }, player.mute === null);
      mute.setAttribute('aria-pressed', String(Boolean(player.mute)));
      const speaker = svgNode('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'aria-hidden': 'true' });
      speaker.append(svgNode('path', { d: 'M11 4 6 8H3v8h3l5 4Z', 'stroke-linejoin': 'round' }));
      speaker.append(svgNode('path', { d: player.mute ? 'm16 8 6 8m0-8-6 8' : 'M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14', 'stroke-linecap': 'round' }));
      mute.append(speaker);
    }
    controls.append(transportRow, volumeRow); return controls;
  }
  function renderPlayer(id, compact) {
    const container = $(id); container.replaceChildren();
    if (!sonos?.player) { container.append(node('p', 'empty', sonosError || t('loading'))); return; }
    const player = sonos.player, layout = node('div', compact ? 'player-layout compact-layout' : 'player-layout');
    layout.append(cover(player, compact));
    const track = node('div', 'track-details');
    track.append(button(player.group, () => { view = 'rooms'; navigate('sonos'); renderSonos(); }, 'room-heading'), node(compact ? 'h3' : 'h2', '', player.title || t('ready')),
      node('p', 'muted track-artist', player.artist || t(`state${player.state}`)), node('p', 'muted track-album', player.album || ''));
    if (compact) track.append(playerControls(player, true));
    if (!compact && sonos.queue?.known && sonos.queue.applicable) {
      const queue = sonos.queue;
      const upcoming = node('div', 'up-next');
      upcoming.append(node('span', 'up-next-caption', t('upNext')));
      if (queue.next) {
        const detail = node('div', 'up-next-track');
        detail.append(node('strong', '', queue.next.title));
        if (queue.next.artist) detail.append(node('small', 'muted', queue.next.artist));
        upcoming.append(detail);
      } else {
        const label = queue.mode?.includes('SHUFFLE') ? t('queueShuffle') : queue.current === queue.total && queue.total > 0 && queue.mode === 'NORMAL' ? t('queueEnd') : '';
        if (label) upcoming.append(node('span', 'muted', label));
      }
      if (upcoming.children.length > 1) track.append(upcoming);
    }
    layout.append(track); container.append(layout);
    if (!compact) container.append(playerControls(player));
    if (compact && player.state !== 'PLAYING') container.append(favoriteGrid(true));
    if (compact && message) container.append(node('p', 'action-message', message));
  }
  function favoriteGrid(compact = false) {
    const grid = node('div', compact ? 'favorites-grid compact-favorites' : 'favorites-grid');
    for (const favorite of sonos?.favorites || []) {
      const element = button('', () => send('favorite', { favoriteId: favorite.id }), 'favorite', commandBusy || sonos.busy);
      element.append(cover({ artwork: favorite.artwork }, true), node('span', '', favorite.title)); element.setAttribute('aria-label', `${t('playFavorite')} ${favorite.title}`); grid.append(element);
    }
    if (!sonos?.favorites?.length) grid.append(node('p', 'empty', t('favoritesUnavailable')));
    return grid;
  }
  function renderQueue() {
    const container = $('sonos-queue');
    const visible = page === 'sonos' && view === 'queue';
    const opening = visible && !queueVisible;
    queueVisible = visible;
    if (!visible) return;
    // Keep the DOM and scroll thumb stable while a touch/wheel/scrollbar gesture is active.
    if (queueHeld || Date.now() < queueQuietUntil) { queueDeferred = true; return; }
    queueDeferred = false;
    const queue = sonos?.queue;
    const signature = JSON.stringify([queue || null, t('queueCurrent')]);
    const scroll = container.scrollTop;
    const changed = queueSignature !== signature;
    if (changed) { container.replaceChildren(); queueSignature = signature; }
    const center = () => {
      const current = container.querySelector('[aria-current="true"]');
      if (!current) { queueCentered = ''; container.style.paddingBlock = ''; return; }
      const key = `${sonos.scope}:${sonos.player.roomId}:${queue.current}:${current.textContent}`;
      const height = container.clientHeight;
      const padding = Math.max(0, (height - current.offsetHeight) / 2);
      container.style.paddingBlock = `${padding}px`;
      if (opening || queueCentered !== key || queueHeight !== height) {
        // Scroll the queue card only; scrollIntoView would also move the whole page.
        container.scrollTop = Math.max(0, current.offsetTop + current.offsetHeight / 2 - height / 2);
        queueCentered = key;
      } else if (changed) container.scrollTop = scroll;
      queueHeight = height;
    };
    if (!queue?.known || !queue.applicable || !queue.total) { queueCentered = ''; container.style.paddingBlock = ''; }
    if (!changed) { center(); return; }
    if (!queue?.known) { container.append(node('p', 'empty', t(sonos ? 'queueUnavailable' : 'loading'))); return; }
    if (!queue.applicable) { container.append(node('p', 'empty', t('queueNoSource'))); return; }
    if (!queue.total) { container.append(node('p', 'empty', t('queueEmpty'))); return; }
    if (queue.mode?.includes('SHUFFLE')) container.append(node('p', 'muted fine-print', t('queueShuffle')));
    if (queue.items.length < queue.total) container.append(node('p', 'muted fine-print', t('queueLimited')));
    for (const item of queue.items) {
      const row = node('div', `queue-track${item.number === queue.current ? ' current' : ''}`);
      if (item.number === queue.current) row.setAttribute('aria-current', 'true');
      const number = node('span', 'queue-number', String(item.number));
      if (item.number === queue.current) number.append(node('small', 'queue-now', t('queueCurrent')));
      row.append(number);
      const details = node('div', 'queue-track-details');
      details.append(node('strong', '', item.title), node('small', 'muted', item.artist));
      row.append(details); container.append(row);
    }
    center();
  }
  function renderSonos() {
    renderPlayer('full-player', false); renderPlayer('compact-player', true);
    text('sonos-room-heading', sonos?.player?.group || sonos?.player?.name || t('rooms')); text('sonos-message', message || sonosError);
    for (const tab of ['queue', 'rooms', 'favorites']) $(`${tab}-tab`).setAttribute('aria-pressed', String(view === tab));
    text('queue-count', sonos?.queue?.known ? String(sonos.queue.total) : '—');
    $('sonos-queue').hidden = view !== 'queue';
    renderQueue();
    $('favorites-grid').hidden = view !== 'favorites'; $('sonos-rooms').hidden = view !== 'rooms';
    $('favorites-grid').replaceChildren(favoriteGrid());
    const container = $('sonos-rooms'); container.replaceChildren();
    if (!sonos) { container.append(node('p', 'empty', sonosError || t('loading'))); return; }
    container.append(node('p', 'muted fine-print', t('groupHelp')));
    for (const entry of sonos.rooms) {
      const row = node('div', `sonos-room${entry.id === sonos.player.roomId ? ' selected' : ''}`);
      const select = button('', () => selectRoom(entry.id), 'room-select', commandBusy);
      select.append(node('strong', '', entry.name), node('small', 'muted', t(`state${entry.state}`))); row.append(select);
      const anchor = entry.id === sonos.player.roomId;
      const checked = draft ? draft.members.has(entry.id) : entry.coordinator === sonos.rooms.find(r => r.id === sonos.player.roomId)?.coordinator;
      const label = node('label', 'group-choice');
      const input = node('input'); input.type = 'checkbox'; input.checked = checked; input.disabled = anchor || commandBusy || draft?.stale === true;
      input.setAttribute('aria-label', `${t('groupWith')} ${entry.name}`);
      input.addEventListener('change', () => {
        explicitRoom = true;
        sonos.player.volumeValues = [{ id: sonos.player.roomId, value: sonos.player.volume }];
        if (!draft) draft = { scope: sonos.scope, members: new Set(sonos.rooms.filter(r => r.coordinator === sonos.rooms.find(item => item.id === sonos.player.roomId)?.coordinator).map(r => r.id)), stale: false };
        if (input.checked) draft.members.add(entry.id); else draft.members.delete(entry.id);
        renderSonos();
      });
      label.append(input, node('span', '', t(anchor ? 'groupMain' : 'groupInclude'))); row.append(label); container.append(row);
    }
    if (draft) {
      const actions = node('div', 'group-actions');
      actions.append(button(t('applyGroup'), () => send('group', { members: [...draft.members], scope: draft.scope }), 'action-button', commandBusy || draft.stale), button(t('cancel'), () => { draft = null; renderSonos(); }, 'quiet', commandBusy)); container.append(actions);
      if (draft.stale) container.append(node('p', 'error', t('roomChanged')));
    }
  }
  function selectRoom(id) {
    if (commandBusy) return;
    explicitRoom = true;
    room = id; sonosVersion++; sonos = null; draft = null; message = ''; renderSonos(); loadSonos(true);
  }
  async function send(action, extra = {}) {
    if (!sonos?.player || commandBusy) return;
    commandBusy = true; message = t('commandSending');
    sonosVersion++;
    const version = generation;
    const body = { action, roomId: sonos.player.roomId, scope: sonos.scope, combined: ['volume', 'mute'].includes(action) ? !(page === 'sonos' && view === 'rooms') : !explicitRoom, ...extra };
    renderSonos();
    try {
      await request('/api/sonos/command', body);
      if (version !== generation) return;
      message = t('commandDone'); if (action === 'group') draft = null;
    } catch (error) { if (version === generation) message = errorLabel(error); }
    finally { commandBusy = false; if (version === generation) { sonosAt = 0; await loadSonos(true); } }
  }
  function renderCharge() {
    if (!dashboard) return;
    const charger = dashboard.charger;
    if (chargeUntil && charger.charging === chargeTarget) { chargeUntil = 0; chargeMessage = t(chargeTarget ? 'chargeStarted' : 'chargeStopped'); }
    if (chargeUntil && chargeUntil <= Date.now()) { chargeUntil = 0; chargeMessage = t('chargeTimedOut'); }
    if (charger.fault || charger.connected === false) chargeUntil = 0;
    const pending = chargeUntil > Date.now();
    $('charge-button').disabled = chargeBusy || pending || !charger.canStart || charger.connected !== true || typeof charger.charging !== 'boolean' || charger.fault !== false;
    $('charge-button').classList.toggle('charge-stop', charger.charging === true);
    text('charge-button', t(charger.charging ? 'stopCharge' : 'startCharge'));
    text('charge-message', pending ? t('chargePending') : !charger.canStart ? t('chargeUnconfigured') : chargeMessage);
  }
  $('charge-button').addEventListener('click', () => {
    chargeTarget = !dashboard.charger.charging;
    text('charge-dialog-title', t(chargeTarget ? 'startCharge' : 'stopCharge'));
    text('charge-confirm', t(chargeTarget ? 'startCharge' : 'stopCharge'));
    $('charge-dialog').querySelector('p').textContent = t(dashboard?.demo ? 'confirmChargeDemo' : chargeTarget ? 'confirmCharge' : 'confirmStopCharge');
    $('charge-dialog').showModal();
  });
  $('charge-cancel').addEventListener('click', () => $('charge-dialog').close());
  $('charge-confirm').addEventListener('click', async () => {
    if (chargeBusy || chargeUntil > Date.now()) return;
    $('charge-dialog').close(); chargeBusy = true; chargeMessage = ''; renderCharge();
    const version = generation;
    try { await request('/api/charge', { confirm: true, target: chargeTarget }); if (version === generation) chargeUntil = Date.now() + 180000; }
    catch (error) { if (version === generation) { chargeMessage = errorLabel(error); if (!error.status || error.status >= 500) chargeUntil = Date.now() + 180000; } }
    finally { chargeBusy = false; if (version === generation) { renderCharge(); onRefresh(); } }
  });
  $('history-refresh').addEventListener('click', () => loadHistory(true));
  $('totals-toggle').addEventListener('click', () => { yearTotals = !yearTotals; renderTotals(); });
  for (const id of ['electricity-day', 'solar-day']) {
    const element = $(id).closest('.stat'); element.tabIndex = 0; element.setAttribute('role', 'button');
    element.addEventListener('click', () => { yearTotals = !yearTotals; renderTotals(); });
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); yearTotals = !yearTotals; renderTotals(); } });
  }
  const queueCard = $('sonos-queue');
  const queueGesture = () => {
    queueQuietUntil = Date.now() + 900;
    clearTimeout(queueFollowTimer);
    queueFollowTimer = setTimeout(() => { if (queueDeferred && !queueHeld) renderQueue(); }, 950);
  };
  queueCard.addEventListener('pointerdown', () => { queueHeld = true; queueGesture(); }, { passive: true });
  for (const event of ['pointerup', 'pointercancel']) document.addEventListener(event, () => {
    if (queueHeld) { queueHeld = false; queueGesture(); }
  }, { passive: true });
  for (const event of ['wheel', 'touchmove', 'scroll', 'keydown']) queueCard.addEventListener(event, queueGesture, { passive: true });
  window.addEventListener('resize', () => { queueHeight = 0; renderQueue(); });
  for (const next of ['queue', 'rooms', 'favorites']) $(`${next}-tab`).addEventListener('click', () => { view = next; renderSonos(); sonosVersion++; loadSonos(true); });
  $('sonos-room-heading').addEventListener('click', () => { view = 'rooms'; renderSonos(); sonosVersion++; loadSonos(true); });
  const poll = () => { if (!document.hidden) update(); };
  setInterval(() => {
    if (!dashboard || document.hidden) return;
    renderHeader();
    const before = card;
    updateHomeCard();
    if (card !== before) renderCards();
  }, 1000);
  setInterval(poll, 10000); document.addEventListener('visibilitychange', poll);
  return {
    dashboard(next) {
      dashboard = next;
      if (next.status === 'offline') { generation++; weather = null; history = null; sonos = null; weatherAt = historyAt = sonosAt = 0; sonosError = t('offline'); }
      render(); update();
    },
    reset() {
      generation++; sonosVersion++; dashboard = null; weather = null; history = null; sonos = null;
      weatherAt = historyAt = sonosAt = 0; draft = null; room = ''; message = ''; chargeMessage = ''; chargeUntil = 0;
      queueSignature = queueCentered = ''; queueVisible = false; queueHeight = 0;
      queueQuietUntil = 0; queueHeld = queueDeferred = false; clearTimeout(queueFollowTimer);
      wasPlaying = false;
      explicitRoom = false;
      display.reset(); homeCards.reset(); card = 'gas'; lastInteraction = Date.now();
      chargeTarget = null;
      batteryDetail.reset();
      $('charge-dialog').close(); navigate('overview', false);
      for (const id of ['full-player', 'compact-player', 'sonos-rooms', 'favorites-grid', 'climate-rooms', 'weather-overview', 'weather-climate']) $(id).replaceChildren();
    },
  };
}
