import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { shaPattern } from './workflow.mjs';

const exec = promisify(execFile);

async function git(path, ...args) {
  try {
    const { stdout } = await exec('git', ['-C', path, ...args], {
      timeout: 15_000, windowsHide: true, maxBuffer: 64 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    return stdout.trim();
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Instale o Git no ambiente do agente.');
    throw new Error((error.stderr || '').trim() || 'Falha ao executar Git. Confira o clone e as referências locais.');
  }
}

async function refExists(path, ref) {
  try {
    await git(path, 'show-ref', '--verify', '--quiet', ref);
    return true;
  } catch {
    return false;
  }
}

export async function prepareWorktree(spec, repoPath) {
  if (typeof repoPath !== 'string' || !isAbsolute(repoPath)) throw new Error('Informe o caminho absoluto do clone local.');
  const root = await git(repoPath, 'rev-parse', '--show-toplevel');
  const origin = await git(root, 'remote', 'get-url', 'origin');
  const slug = origin.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+)$/i)
    ?.[1].replace(/\.git$/i, '').toLowerCase();
  if (slug !== spec.repo) throw new Error('A origem Git do clone deve corresponder a ' + spec.repo + '.');

  const qa = spec.role === 'qa';
  const branch = qa ? '' : spec.branch;
  if ((qa || spec.head) && !shaPattern.test(spec.head)) throw new Error('O PR precisa ter um SHA válido.');
  if (!qa && !/^(feature|bugfix)\/.+/.test(branch)) throw new Error('Use uma branch Gitflow para o Dev.');
  const suffix = qa ? '-qa-' + spec.run : '-dev';
  const path = join(dirname(root), '.orquestrador-worktrees', basename(root), spec.project, spec.task.toLowerCase() + suffix);
  if (existsSync(path)) {
    const [actual, rootGit, worktreeGit, ref] = await Promise.all([
      git(path, 'rev-parse', '--show-toplevel'),
      git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir'),
      git(path, 'rev-parse', '--path-format=absolute', '--git-common-dir'),
      qa ? git(path, 'rev-parse', 'HEAD') : git(path, 'branch', '--show-current')
    ]);
    if (relative(path, actual) || relative(rootGit, worktreeGit) || ref !== (qa ? spec.head : branch)) {
      throw new Error('O destino já existe e pertence a outra worktree ou referência.');
    }
    if (!qa && spec.head) await verifyPrBase(path, spec.head, 'HEAD');
    return { path, branch: branch || 'detached HEAD', reused: true };
  }

  const existingBranch = !qa && await refExists(root, 'refs/heads/' + branch);
  if (existingBranch && spec.head) await verifyPrBase(root, spec.head, 'refs/heads/' + branch);
  const base = spec.head || 'refs/remotes/origin/develop';
  if (!existingBranch) await git(root, 'cat-file', '-e', base + '^{commit}');
  mkdirSync(dirname(path), { recursive: true });
  if (qa) await git(root, 'worktree', 'add', '--detach', path, base);
  else if (existingBranch) await git(root, 'worktree', 'add', path, branch);
  else await git(root, 'worktree', 'add', '-b', branch, path, base);
  return { path, branch: branch || 'detached HEAD', reused: false };
}

async function verifyPrBase(path, head, ref) {
  try {
    await git(path, 'merge-base', '--is-ancestor', head, ref);
  } catch {
    throw new Error('Atualize a branch local para o commit do PR antes de reutilizar a worktree.');
  }
}
