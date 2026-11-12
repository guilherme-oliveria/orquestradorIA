export { agents } from './agents.mjs';

export const shaPattern = /^[0-9a-f]{40}$/;
export const slugPattern = /^[a-z0-9][a-z0-9-]*\/[a-z0-9_.-]+$/i;

export function validatePr(pr, repo, number) {
  const expectedUrl = 'https://github.com/' + repo.slug + '/pull/' + number;
  if (pr.number !== number || pr.url?.toLowerCase() !== expectedUrl.toLowerCase() ||
      pr.baseRefName !== 'develop' || !/^(feature|bugfix)\/.+/.test(pr.headRefName) ||
      !shaPattern.test(pr.headRefOid)) {
    throw new Error('Vincule um PR do repositório da tarefa com branch feature/ ou bugfix/ e destino develop.');
  }
}

function ciState(rollup, required) {
  const checks = (rollup || []).map(check => ({
    name: check.name || check.context,
    result: check.conclusion || check.state || check.status
  }));
  const success = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];
  const failures = ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STALE', 'STARTUP_FAILURE'];
  const relevant = required.length ? checks.filter(check => required.includes(check.name)) : checks;
  if (relevant.some(check => failures.includes(check.result))) return 'failed';
  if (!relevant.length || required.some(name => !relevant.some(check => check.name === name)) ||
      relevant.some(check => !success.includes(check.result))) return 'pending';
  return 'passed';
}

function lastVerdict(pr, qaLogin) {
  const trusted = event => event.author?.login?.toLowerCase() === qaLogin?.toLowerCase() && qaLogin;
  const events = [];
  for (const review of pr.reviews || []) {
    if (trusted(review) && review.commit?.oid === pr.headRefOid) {
      const decision = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes', DISMISSED: 'dismissed' }[review.state];
      if (decision) events.push({ decision, at: review.submittedAt });
    }
  }
  for (const comment of pr.comments || []) {
    if (!trusted(comment) || comment.includesCreatedEdit) continue;
    const marker = comment.body?.split(/\r?\n/, 1)[0].trim().match(/^QA: (APROVADO|CORRIGIR) ([a-f0-9]{40})$/);
    if (marker?.[2] === pr.headRefOid) {
      events.push({ decision: marker[1] === 'APROVADO' ? 'approved' : 'changes', at: comment.createdAt });
    }
  }
  return events.sort((a, b) => (a.at || '').localeCompare(b.at || '') ||
    (a.decision === 'approved' ? -1 : 1) - (b.decision === 'approved' ? -1 : 1)).at(-1)?.decision;
}

// Histórico de correções pedidas pelo QA em qualquer commit do PR (reviews e comentários "QA: CORRIGIR").
function qaHistory(pr, qaLogin) {
  const trusted = event => qaLogin && event.author?.login?.toLowerCase() === qaLogin.toLowerCase();
  const requests = [];
  for (const review of pr.reviews || []) {
    if (trusted(review) && review.state === 'CHANGES_REQUESTED') requests.push({ at: review.submittedAt || '', body: review.body || '' });
  }
  for (const comment of pr.comments || []) {
    if (trusted(comment) && !comment.includesCreatedEdit && /^QA: CORRIGIR\b/.test(comment.body?.trim() || '')) {
      requests.push({ at: comment.createdAt || '', body: comment.body });
    }
  }
  requests.sort((a, b) => a.at.localeCompare(b.at));
  return { corrections: requests.length, lastRequest: requests.at(-1)?.body.trim().slice(0, 2000) || null };
}

export function swapDevQa(profile) {
  return { po: profile.po, dev: { ...profile.qa, login: profile.dev.login }, qa: { ...profile.dev, login: profile.qa.login } };
}

// Uso da janela de 5 horas; janela vencida ou sem leitura conta como desconhecida.
function quotaUsed(limits, agent) {
  const window = limits?.[agent]?.windows?.fiveHours;
  return window && Date.parse(window.resetsAt) > Date.now() ? window.used : null;
}

// No modo automático, o Dev da próxima tarefa é o agente (entre Dev e QA do projeto) com mais cota livre.
export function profileForNewTask(project, limits) {
  if (!project.autoAssign) return project.profile;
  const dev = quotaUsed(limits, project.profile.dev.agent);
  const qa = quotaUsed(limits, project.profile.qa.agent);
  return dev !== null && qa !== null && qa < dev ? swapDevQa(project.profile) : project.profile;
}

export function evaluate(pr, repo, qaLogin) {
  const ci = ciState(pr.statusCheckRollup, repo.checks);
  const verdict = lastVerdict(pr, qaLogin);
  const history = qaHistory(pr, qaLogin);
  let stage = 'review';
  if (pr.state === 'MERGED') stage = verdict === 'approved' && ci === 'passed' ? 'merged' : 'merged-unverified';
  else if (pr.state === 'CLOSED') stage = 'closed';
  else if (pr.isDraft) stage = 'draft';
  else if (verdict === 'changes' || ci === 'failed') stage = 'changes';
  else if (verdict === 'approved') stage = ci === 'passed' ? 'merge' : 'tests';
  return {
    stage, ci, verdict: verdict || null, head: pr.headRefOid, branch: pr.headRefName, url: pr.url,
    mergeState: pr.mergeStateStatus || null, reviewDecision: pr.reviewDecision || null,
    author: pr.author?.login || null, corrections: history.corrections,
    pending: stage === 'changes' ? history.lastRequest : null
  };
}

export function readyFor(task, tasks, agent, role) {
  if (task.syncError || task[role] !== agent) return false;
  if (task.lease && task.lease.expires > Date.now()) return false;
  const stage = task.observation?.stage || 'queue';
  if (role === 'qa') return stage === 'review';
  if (stage === 'changes' || stage === 'draft') return true;
  return stage === 'queue' && task.depends.every(id =>
    tasks.some(other => other.id === id && other.observation?.stage === 'merged'));
}
