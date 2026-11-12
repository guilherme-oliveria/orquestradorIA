import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { registry } from './agents.mjs';

const exec = promisify(execFile);

async function run(file, args) {
  try {
    const { stdout } = await exec(file, args, { timeout: 6_000, maxBuffer: 32_768, windowsHide: true });
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, missing: error.code === 'ENOENT', stdout: error.stdout || '', stderr: error.stderr || '' };
  }
}

export async function testCli(provider) {
  if (!Object.hasOwn(registry, provider)) throw new Error('Selecione um CLI da lista.');
  const { command, auth: authCheck } = registry[provider].cli;
  const onWindows = process.platform === 'win32';
  if (onWindows && !(await run('where.exe', [command])).ok) return { status: 'missing' };

  // The command and all arguments come from the agent registry.
  const invoke = args => onWindows ? run('cmd.exe', ['/d', '/c', command, ...args]) : run(command, args);
  const check = await invoke(['--version']);
  if (!check.ok) return { status: check.missing ? 'missing' : 'error' };
  const version = check.stdout.match(/\b\d+\.\d+\.\d+(?:[-+][a-z\d.-]{1,30})?/i)?.[0] || null;
  if (!authCheck) return { status: 'ready', version, auth: 'unsupported' };

  const auth = await invoke(authCheck.args);
  let authStatus = 'unknown';
  if (authCheck.format === 'json-loggedIn') {
    try {
      const { loggedIn } = JSON.parse(auth.stdout);
      if (loggedIn === true) authStatus = 'signed-in';
      if (loggedIn === false) authStatus = 'signed-out';
    } catch { /* The CLI may have returned a setup or permission error. */ }
  } else if (auth.ok) authStatus = 'signed-in';
  else if (/\bnot logged in\b/i.test(auth.stdout + '\n' + auth.stderr)) authStatus = 'signed-out';
  return { status: 'ready', version, auth: authStatus };
}
