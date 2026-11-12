import { exec } from 'node:child_process';
import { delimiter, dirname } from 'node:path';
import { reportedWindow } from './lib/usage.mjs';

function previousStatusline(encoded, input) {
  if (!encoded) return Promise.resolve('');
  const command = Buffer.from(encoded, 'base64').toString('utf8');
  const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') || 'PATH';
  const env = { ...process.env, [pathKey]: dirname(process.execPath) + delimiter + (process.env[pathKey] || '') };
  return new Promise(resolve => {
    const child = exec(command, { env, windowsHide: true, timeout: 4000, maxBuffer: 128_000 },
      (error, stdout) => resolve(error ? '' : stdout.trimEnd()));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function sendUsage(input) {
  const data = JSON.parse(input);
  const windows = {};
  for (const [key, field] of [['fiveHours', 'five_hour'], ['weekly', 'seven_day']]) {
    const entry = data.rate_limits?.[field];
    const value = reportedWindow(entry?.used_percentage, entry?.resets_at);
    if (value) windows[key] = value;
  }
  const amount = data.cost?.total_cost_usd;
  const sessionCostUsd = Number.isFinite(amount) && (amount > 0 || (amount === 0 && data.cost.total_api_duration_ms > 0)) ? amount : undefined;
  if (Object.keys(windows).length || sessionCostUsd !== undefined) {
    const response = await fetch('http://127.0.0.1:' + (process.env.ORQ_PORT || '47621') + '/api/action', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'import_claude_limits', args: { windows, sessionCostUsd } }),
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) throw new Error('Falha ao registrar leitura.');
  }
  const indicators = Object.entries(windows).map(([key, value]) => (key === 'fiveHours' ? '5h ' : 'Semana ') + value.used + '%');
  if (sessionCostUsd !== undefined) indicators.push('US$ ' + sessionCostUsd.toFixed(4) + ' estimado');
  return 'Orquestrador · ' + (indicators.join(' · ') || 'sem leitura');
}

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 128_000) process.exit(1);
}
const [original, summary] = await Promise.all([
  previousStatusline(process.argv[2], input),
  sendUsage(input).catch(() => 'Orquestrador · dados de uso indisponíveis')
]);
process.stdout.write(original || summary);
