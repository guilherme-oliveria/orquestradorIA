import assert from 'node:assert/strict';
import test from 'node:test';
import { contextPath, compareContext } from '../lib/context.mjs';

test('checks committed copies against the official Markdown blob', () => {
  const repoNames = ['time/api', 'time/web', 'time/mobile', 'time/infra', 'time/worker'];
  const project = { officialRepo: 'time/api', repos: repoNames.map(slug => ({ slug })) };
  const docs = [
    { path: contextPath, repo: 'time/api', blob: 'one', markdown: '# Projeto', sha: 'commit' },
    { path: contextPath, repo: 'time/web', blob: 'one' },
    { path: contextPath, repo: 'time/mobile', blob: 'two' },
    { path: contextPath, repo: 'time/infra', missing: true, error: '404' },
    { repo: 'time/worker', error: 'Falha de rede' }
  ];
  const result = compareContext(project, docs);
  assert.equal(result.official.markdown, '# Projeto');
  assert.deepEqual(result.copies.map(item => item.status), ['official', 'current', 'diverged', 'missing', 'error']);
  assert.equal(compareContext(project, docs.slice(1)).copies[0].status, 'unverified');
});
