import { watchHomey } from './realtime.mjs';

export function createDashboardStream(config, service, validSession, { watch = watchHomey, interval = 15000, debounce = 1000 } = {}) {
  const clients = new Set();
  let heartbeat = null, scheduled = null, stop = null, running = false, dirty = false, generation = 0;
  function send(client, event, value) {
    // Disconnect slow readers instead of accumulating private snapshots in memory.
    if (!client.res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)) client.res.destroy();
  }
  function authorized(client) {
    if (validSession(client.key)) return true;
    send(client, 'unauthorized', {}); client.res.end();
    return false;
  }
  async function publish() {
    if (running) { dirty = true; return; }
    if (!clients.size) return;
    running = true;
    const version = generation;
    try {
      const value = await service.get();
      if (version !== generation) return;
      for (const client of clients) if (authorized(client)) send(client, 'dashboard', value);
    } catch {
      if (version === generation) for (const client of clients) if (authorized(client)) send(client, 'unavailable', {});
    } finally {
      running = false;
      if (dirty && clients.size) { dirty = false; schedule(); }
    }
  }
  function schedule() {
    if (!clients.size || scheduled) return;
    // Coalesce meter bursts and retain the existing three-worker Homey read cap.
    scheduled = setTimeout(() => { scheduled = null; void publish(); }, debounce);
  }
  function changed() { service.invalidate?.(); schedule(); }
  function remove(client) {
    clients.delete(client);
    if (!clients.size) {
      generation++; clearInterval(heartbeat); clearTimeout(scheduled);
      heartbeat = scheduled = null; dirty = false;
      stop?.(); stop = null;
    }
  }
  return {
    open(res, key) {
      if (clients.size >= 128 || [...clients].filter(client => client.key === key).length >= 4) return false;
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      const client = { res, key }; clients.add(client);
      res.on('close', () => remove(client));
      if (!heartbeat) {
        stop = watch(config, changed);
        // Heartbeats also reconcile missed events, failed subscriptions and midnight.
        heartbeat = setInterval(() => {
          for (const client of clients) if (authorized(client)) client.res.write(': heartbeat\n\n');
          void publish();
        }, interval);
      }
      void publish();
      return true;
    },
    revoke(key) { for (const client of clients) if (client.key === key) { send(client, 'unauthorized', {}); client.res.end(); } },
    close() { for (const client of [...clients]) { client.res.end(); remove(client); } },
  };
}
