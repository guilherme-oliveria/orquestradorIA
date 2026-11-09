export const contextPath = 'docs/CONTEXTO-PROJETO.md';

export function compareContext(project, docs) {
  const entries = new Map(docs.filter(doc => doc.path === contextPath || !doc.path).map(doc => [doc.repo, doc]));
  const source = entries.get(project.officialRepo);
  const official = source?.blob ? source : null;
  const copies = project.repos.map(({ slug }) => {
    const entry = entries.get(slug);
    let status = 'unverified';
    if (entry?.missing) status = 'missing';
    else if (entry?.error) status = 'error';
    else if (official && entry?.blob) {
      status = slug === project.officialRepo ? 'official' : entry.blob === official.blob ? 'current' : 'diverged';
    }
    return { repo: slug, status, sha: entry?.sha || null, error: entry?.error || null };
  });
  return { path: contextPath, officialRepo: project.officialRepo || null, official, copies };
}
