import { loadConfig } from './config.js';
import { createAppServer } from './app.js';
import { buildProviders } from './providers/index.js';

const config = loadConfig();
const providers = buildProviders(config);
const { server } = createAppServer(config, providers);

server.listen(config.port, config.host, () => {
  const mark = (ok: boolean) => (ok ? 'configured' : 'NOT configured (set the key in .env)');
  console.log(`Kotoba Live server on http://${config.host}:${config.port}`);
  console.log(`  speech recognition: ${config.stt.model} @ ${new URL(config.stt.baseUrl).host} - ${mark(Boolean(providers.stt))}`);
  console.log(`  translation:        ${config.llm.model} @ ${new URL(config.llm.baseUrl).host} - ${mark(Boolean(providers.translator))}`);
  if (config.host !== '127.0.0.1' && config.host !== 'localhost' && !config.accessToken) {
    console.warn('  warning: listening on a public interface without ACCESS_TOKEN. Anyone who can reach it can spend your API quota.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
