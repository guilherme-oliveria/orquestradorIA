export const agents = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI'
};

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

export function evaluate(pr, repo, qaLogin) {
  const ci = ciState(pr.statusCheckRollup, repo.checks);
  const verdict = lastVerdict(pr, qaLogin);
  let stage = 'review';
  if (pr.state === 'MERGED') stage = verdict === 'approved' && ci === 'passed' ? 'merged' : 'merged-unverified';
  else if (pr.state === 'CLOSED') stage = 'closed';
  else if (pr.isDraft) stage = 'draft';
  else if (verdict === 'changes' || ci === 'failed') stage = 'changes';
  else if (verdict === 'approved') stage = ci === 'passed' ? 'merge' : 'tests';
  return {
    stage, ci, verdict: verdict || null, head: pr.headRefOid, url: pr.url,
    mergeState: pr.mergeStateStatus || null, reviewDecision: pr.reviewDecision || null,
    author: pr.author?.login || null
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
