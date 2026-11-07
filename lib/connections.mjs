import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const programs = Object.freeze({
  claude: { auth: ['auth', 'status', '--json'] },
  codex: { auth: ['login', 'status'] },
  gemini: {},
  opencode: {}
});

async function run(file, args) {
  try {
    const { stdout } = await exec(file, args, { timeout: 6_000, maxBuffer: 32_768, windowsHide: true });
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, missing: error.code === 'ENOENT', stdout: error.stdout || '', stderr: error.stderr || '' };
  }
}

export async function testCli(provider) {
  if (!Object.hasOwn(programs, provider)) throw new Error('Selecione um CLI da lista.');
  const onWindows = process.platform === 'win32';
  if (onWindows && !(await run('where.exe', [provider])).ok) return { status: 'missing' };

  // The command and all arguments come from the fixed list above or below.
  const invoke = args => onWindows ? run('cmd.exe', ['/d', '/c', provider, ...args]) : run(provider, args);
  const check = await invoke(['--version']);
  if (!check.ok) return { status: check.missing ? 'missing' : 'error' };
  const version = check.stdout.match(/\b\d+\.\d+\.\d+(?:[-+][a-z\d.-]{1,30})?/i)?.[0] || null;
  const authArgs = programs[provider].auth;
  if (!authArgs) return { status: 'ready', version, auth: 'unsupported' };

  const auth = await invoke(authArgs);
  let authStatus = 'unknown';
  if (provider === 'claude') {
    try {
      const { loggedIn } = JSON.parse(auth.stdout);
      if (loggedIn === true) authStatus = 'signed-in';
      if (loggedIn === false) authStatus = 'signed-out';
    } catch { /* The CLI may have returned a setup or permission error. */ }
  } else if (auth.ok) authStatus = 'signed-in';
  else if (/\bnot logged in\b/i.test(auth.stdout + '\n' + auth.stderr)) authStatus = 'signed-out';
  return { status: 'ready', version, auth: authStatus };
}
