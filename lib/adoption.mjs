// "Adotar" um repositório: detectar os documentos de referência e abrir o PR que acrescenta ao AGENTS.md
// a seção que liga o repositório ao projeto no Orquestrador. Tudo pelo GitHub CLI, como o resto do painel.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const adoptionBranch = 'feature/orquestrador-ia-agents';
const heading = '## Orquestrador IA';
const preferredDocs = ['visao-geral.md', 'integracao.md', 'regras-de-negocio.md', 'plano-de-acao.md', 'plano-de-execucao.md'];

export function parseSlug(value) {
  const text = String(value || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  return /^[a-z0-9][a-z0-9-]*\/[a-z0-9_.-]+$/i.test(text) ? text.toLowerCase() : null;
}

export function guessKind(slug) {
  const name = slug.split('/')[1];
  if (/back|api|server|servidor/.test(name)) return 'Backend';
  if (/mobile|app|android|ios|kmp/.test(name)) return 'Mobile';
  if (/front|web|site|painel/.test(name)) return 'Frontend';
  if (/infra|ops|deploy/.test(name)) return 'Infra';
  return 'Outro';
}

export function agentsSection(project, slug) {
  const others = project.repos.map(repo => repo.slug).filter(item => item !== slug).map(item => '`' + item.split('/')[1] + '`');
  return [
    heading + ' (contexto compartilhado entre os repositórios)',
    '',
    'Este repositório faz parte do projeto **`' + project.id + '`** (' + project.name + ') no painel local do Orquestrador IA' +
      (others.length ? ', junto com ' + others.join(', ') : '') + '. O painel acompanha sozinho os PRs abertos para a `develop` (etapa, CI e vereditos do QA) e monta o Kanban a partir do plano de ação, então o fluxo de PR deste arquivo não muda.',
    '',
    'Para o card andar sozinho no Kanban, comece o título do PR pelo ID da tarefa (ex.: `API-12 Cadastro de paciente`).',
    '',
    'Se a sessão tiver o MCP `orquestradoria` (sessões locais), use-o com `project: "' + project.id + '"` e `repo: "' + slug + '"`:',
    '',
    '- Antes de começar uma tarefa: `listar_contexto` deste repositório, para ver decisões e contratos registrados pelos outros.',
    '- Ao tomar uma decisão que outro repositório precisa respeitar: `registrar_decisao`.',
    '- Ao criar ou mudar um contrato (endpoint, DTO, código de erro, evento): `registrar_contrato`, com os repositórios envolvidos em `repos`. Para atualizar um registro, passe o ID dele em `supersedes`.',
    '- Risco ou pendência que afeta outro repositório: `registrar_nota`.',
    '- `instrucoes_do_papel` devolve as instruções completas do seu papel (PO, Dev ou QA).',
    '',
    'Sem o MCP (sessão na nuvem), siga normalmente: os documentos do repositório continuam sendo a referência e nada aqui bloqueia o trabalho.',
    ''
  ].join('\n');
}

export const hasSection = (markdown, projectId) => markdown.includes(heading) && markdown.includes('`' + projectId + '`');

// Insere (ou substitui) a seção antes de "## Definição de pronto"; sem essa âncora, acrescenta no fim.
export function withSection(markdown, section) {
  const base = markdown || '# AGENTS.md\n\nInstruções para agentes de IA neste repositório.\n';
  const start = base.indexOf(heading);
  if (start >= 0) {
    const next = base.indexOf('\n## ', start + heading.length);
    return base.slice(0, start) + section + (next >= 0 ? base.slice(next) : '');
  }
  const anchor = base.search(/^## Definição de pronto/m);
  return anchor >= 0 ? base.slice(0, anchor) + section + '\n' + base.slice(anchor) : base.replace(/\s*$/, '\n\n') + section;
}

async function api(args) {
  try {
    const { stdout } = await exec('gh', ['api', ...args], {
      timeout: 25_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: '1' }
    });
    return stdout ? JSON.parse(stdout) : null;
  } catch (error) {
    const failure = new Error((error.stderr || error.message || '').trim().split('\n')[0] || 'Falha ao consultar o GitHub.');
    failure.status = Number((error.stderr || '').match(/HTTP (\d{3})/)?.[1]) || 0;
    throw failure;
  }
}

const optional = async promise => { try { return await promise; } catch (error) { if (error.status === 404) return null; throw error; } };

export async function currentLogin() {
  return (await api(['user'])).login;
}

export async function detectDocs(slug) {
  const docs = [];
  if (await optional(api(['repos/' + slug + '/contents/AGENTS.md?ref=develop']))) docs.push('AGENTS.md');
  const folder = await optional(api(['repos/' + slug + '/contents/docs/arquitetura?ref=develop']));
  for (const name of preferredDocs) {
    const entry = Array.isArray(folder) && folder.find(item => item.name === name && item.type === 'file' && item.size <= 48_000);
    if (entry && docs.length < 5) docs.push(entry.path);
  }
  return docs;
}

// Garante a seção no AGENTS.md: devolve "present", "pr-open" ou "pr-created" (com o link do PR).
export async function ensureAgentsSection(slug, project) {
  const section = agentsSection(project, slug);
  const ref = await optional(api(['repos/' + slug + '/git/ref/heads/develop']));
  if (!ref) return { status: 'error', error: 'O repositório não tem a branch develop.' };
  const file = await optional(api(['repos/' + slug + '/contents/AGENTS.md?ref=develop']));
  const markdown = file ? Buffer.from(file.content, 'base64').toString('utf8') : '';
  if (hasSection(markdown, project.id)) return { status: 'present' };
  const owner = slug.split('/')[0];
  const open = await api(['repos/' + slug + '/pulls?state=open&head=' + owner + ':' + adoptionBranch]);
  if (open.length) return { status: 'pr-open', url: open[0].html_url, number: open[0].number };
  const sha = ref.object.sha;
  try {
    await api(['-X', 'POST', 'repos/' + slug + '/git/refs', '-f', 'ref=refs/heads/' + adoptionBranch, '-f', 'sha=' + sha]);
  } catch (error) {
    if (error.status !== 422) throw error;
    await api(['-X', 'PATCH', 'repos/' + slug + '/git/refs/heads/' + adoptionBranch, '-f', 'sha=' + sha, '-F', 'force=true']);
  }
  await api(['-X', 'PUT', 'repos/' + slug + '/contents/AGENTS.md', '-f', 'message=docs: seção Orquestrador IA no AGENTS.md',
    '-f', 'content=' + Buffer.from(withSection(markdown, section)).toString('base64'), '-f', 'branch=' + adoptionBranch,
    ...(file ? ['-f', 'sha=' + file.sha] : [])]);
  const pr = await api(['-X', 'POST', 'repos/' + slug + '/pulls', '-f', 'title=docs: seção Orquestrador IA no AGENTS.md',
    '-f', 'head=' + adoptionBranch, '-f', 'base=develop',
    '-f', 'body=Aberto pelo painel do Orquestrador IA ao adotar este repositório no projeto `' + project.id +
      '`. Acrescenta ao `AGENTS.md` a seção que liga o repositório ao projeto e orienta os agentes a registrar decisões, contratos e notas pelo MCP `orquestradoria`. Só documentação.']);
  return { status: 'pr-created', url: pr.html_url, number: pr.number };
}
