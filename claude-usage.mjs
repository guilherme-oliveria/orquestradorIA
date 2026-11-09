import { reportedWindow } from './lib/usage.mjs';

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 128_000) process.exit(1);
}
try {
  const data = JSON.parse(input);
  const windows = {};
  for (const [key, field] of [['fiveHours', 'five_hour'], ['weekly', 'seven_day']]) {
    const entry = data.rate_limits?.[field];
    const value = reportedWindow(entry?.used_percentage, entry?.resets_at);
    if (value) windows[key] = value;
  }
  if (Object.keys(windows).length) {
    await fetch('http://127.0.0.1:' + (process.env.ORQ_PORT || '47621') + '/api/action', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'import_claude_limits', args: { windows } }),
      signal: AbortSignal.timeout(1500)
    });
  }
  process.stdout.write('Orquestrador · ' + (Object.entries(windows).map(([key, value]) =>
    (key === 'fiveHours' ? '5h ' : 'Semana ') + value.used + '%'
  ).join(' · ') || 'janelas sem leitura'));
} catch {
  process.stdout.write('Orquestrador · dados de uso indisponíveis');
}
