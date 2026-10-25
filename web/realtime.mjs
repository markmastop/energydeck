import { HomeyAPI } from 'homey-api';

// Subscribe only to configured devices. Event payloads stay on the server; the
// existing read-only normalizer remains the authority for values and units.
export function watchHomey(config, changed, createAPI = options => HomeyAPI.createLocalAPI(options)) {
  if (config.demo || !config.address || !config.token) return () => {};
  let stopped = false, api = null, retry = null;
  async function connect() {
    let candidate;
    try {
      candidate = await createAPI({ address: config.address, token: config.token });
      if (stopped) { candidate.destroy(); return; }
      api = candidate;
      const ids = new Set([...Object.values(config.devices), ...config.rooms.map(room => room.id), config.controller].filter(id => id && id !== 'none'));
      for (const id of ids) {
        await api.subscribe(`homey:device:${id}`, {
          onEvent: event => { if (['capability', 'update', 'delete'].includes(event)) changed(); },
          onReconnect: changed,
        });
        if (stopped) return;
      }
      const logicIds = new Set([config.prices, config.batteryPlan].filter(id => id && id !== 'none'));
      if (logicIds.size) {
        await api.subscribe('homey:manager:logic', {
          onEvent: (event, variable) => {
            if (['variable.update', 'variable.delete'].includes(event) && logicIds.has(variable?.id)) changed();
          },
          onReconnect: changed,
        });
      }
      if (!stopped) changed(); // Reconcile changes that happened during setup.
    } catch {
      // Older Homeys or restricted tokens can still use the shared REST fallback.
      candidate?.destroy();
      if (api === candidate) api = null;
      if (!stopped) retry = setTimeout(connect, 30000);
    }
  }
  void connect();
  return () => { stopped = true; clearTimeout(retry); api?.destroy(); api = null; };
}
