import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { shaPattern } from './workflow.mjs';
import { contextPath } from './context.mjs';

const exec = promisify(execFile);
const fields = [
  'number', 'url', 'baseRefName', 'headRefName', 'headRefOid', 'state', 'isDraft', 'author',
  'statusCheckRollup', 'reviews', 'comments', 'mergeStateStatus', 'reviewDecision'
].join(',');

async function gh(args) {
  try {
    const { stdout } = await exec('gh', args, {
      timeout: 25_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, GH_PROMPT_DISABLED: '1' }
    });
    return JSON.parse(stdout);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Instale o GitHub CLI (gh) e autentique no mesmo ambiente do servidor.');
    if (/\b404\b/.test(error.stderr || '')) {
      const missing = new Error('GitHub retornou 404. Confira o caminho e a permissão do gh.');
      missing.code = 'GITHUB_NOT_FOUND';
      throw missing;
    }
    throw new Error('Falha ao consultar o GitHub. Confira a rede, o acesso ao repositório e gh auth status.');
  }
}

export const readPr = (repo, number) => gh(['pr', 'view', String(number), '--repo', repo, '--json', fields]);

export async function readContext(project, onlyShared = false) {
  const results = await Promise.all(project.repos.map(async repo => {
    const paths = new Set(onlyShared ? [] : repo.docs);
    if (project.officialRepo) paths.add(contextPath);
    if (!paths.size) return [];
    let sha;
    try {
      const ref = await gh(['api', 'repos/' + repo.slug + '/git/ref/heads/develop']);
      sha = ref.object?.sha;
      if (!shaPattern.test(sha)) throw new Error('Resposta sem SHA válido.');
    } catch (error) {
      return [{ repo: repo.slug, error: error.message }];
    }
    return Promise.all([...paths].map(async path => {
      try {
        const entry = await gh(['api', 'repos/' + repo.slug + '/contents/' +
          path.split('/').map(encodeURIComponent).join('/') + '?ref=' + sha]);
        if (entry.type !== 'file' || entry.encoding !== 'base64' || entry.size > 24_000) {
          throw new Error('Use um arquivo Markdown de até 24 KB.');
        }
        return { repo: repo.slug, path, sha, blob: entry.sha, markdown: Buffer.from(entry.content, 'base64').toString('utf8') };
      } catch (error) {
        return { repo: repo.slug, path, sha, missing: error.code === 'GITHUB_NOT_FOUND', error: error.message };
      }
    }));
  }));
  return results.flat();
}
