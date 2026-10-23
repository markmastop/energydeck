// EventSource reconnects automatically and uses the existing HttpOnly session.
export function createLiveUpdates({ onDashboard, onUnavailable, onUnauthorized, checkSession, Source = globalThis.EventSource }) {
  let source = null, connected = false;
  return {
    get connected() { return connected; },
    start() {
      if (source || !Source) return;
      const current = source = new Source('/api/events');
      current.onopen = () => { if (source === current) connected = true; };
      current.addEventListener('dashboard', event => {
        if (source !== current) return;
        try { onDashboard(JSON.parse(event.data)); }
        catch { connected = false; onUnavailable(); }
      });
      current.addEventListener('unavailable', () => { if (source === current) onUnavailable(); });
      current.addEventListener('unauthorized', () => {
        if (source !== current) return;
        this.stop(); onUnauthorized();
      });
      current.onerror = async () => {
        if (source !== current) return;
        connected = false; onUnavailable();
        try {
          const response = await checkSession();
          if (source === current && response.status === 401) { this.stop(); onUnauthorized(); }
        } catch { /* The REST timer remains available while EventSource retries. */ }
      };
    },
    stop() { const previous = source; source = null; connected = false; previous?.close(); },
  };
}
