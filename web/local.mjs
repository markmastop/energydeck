import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { configuration } from './data.mjs';
import { createApp } from './server.mjs';

try {
  try {
    // Native dotenv parsing never executes shell code; inherited variables take precedence.
    loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const port = Number(process.env.ENERGYDECK_WEB_PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid ENERGYDECK_WEB_PORT');
  const origin = `http://127.0.0.1:${port}`;
  // Deployment HTTPS settings must not break cookies on this loopback-only HTTP server.
  const config = configuration({ ...process.env, ENERGYDECK_WEB_SECURE_COOKIE: 'false', ENERGYDECK_WEB_ORIGIN: origin });
  const server = createApp(config);
  server.on('error', error => { console.error(`Local server failed: ${error.code || 'unknown'}`); process.exit(1); });
  server.listen(port, '127.0.0.1', () => {
    console.log(`EnergyDeck web: ${origin}${config.demo ? ' (DEMO)' : ''}`);
    console.log('Sign in with ENERGYDECK_WEB_ACCESS_CODE from .env. Press Ctrl+C to stop.');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
} catch (error) {
  console.error(error.code ? `Local startup failed: ${error.code}` : error.message);
  process.exit(1);
}
