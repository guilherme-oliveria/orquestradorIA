import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { reportedWindow } from './usage.mjs';

export async function readCodexLimits() {
  const result = await new Promise((resolve, reject) => {
    const args = ['app-server', '--listen', 'stdio://'];
    const child = process.platform === 'win32' ?
      spawn('cmd.exe', ['/d', '/c', 'codex', ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }) :
      spawn('codex', args, { stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout });
    const timer = setTimeout(() => finish(new Error('O Codex demorou para responder. Confira a rede e tente novamente.')), 12_000);
    let settled = false;
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      child.kill();
      if (error) reject(error);
      else resolve(value);
    }
    function send(method, id, params) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    }
    child.on('error', () => finish(new Error('Não foi possível iniciar o Codex CLI local.')));
    child.stdin.on('error', () => finish(new Error('O Codex CLI local não aceitou a consulta.')));
    child.on('exit', () => finish(new Error('O Codex CLI encerrou antes de informar os limites.')));
    lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message?.id !== 1 && message?.id !== 2) return;
      if (message.error) return finish(new Error('O Codex não disponibilizou a cota desta conta. Confira o login local.'));
      if (message.id === 2) return finish(null, message.result);
      send('initialized');
      send('account/rateLimits/read', 2);
    });
    send('initialize', 1, { clientInfo: { name: 'orquestradoria', version: '0.1.0' } });
  });
  const snapshot = result?.rateLimitsByLimitId?.codex || result?.rateLimits;
  const windows = {};
  for (const window of [snapshot?.primary, snapshot?.secondary]) {
    const name = { 300: 'fiveHours', 10080: 'weekly' }[window?.windowDurationMins];
    const value = reportedWindow(window?.usedPercent, window?.resetsAt);
    if (name && value) windows[name] = value;
  }
  if (!Object.keys(windows).length) throw new Error('O Codex não retornou janelas de 5 horas ou semanal para esta conta.');
  return windows;
}
