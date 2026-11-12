# Orquestrador IA — plano de execução (MVP 2)

> Criado em 2026-11-10 a partir do guia `gui-arquitetura claude-codex`, do código da `develop` (v0.1.0) e da imagem de referência do painel.
> **Status: aprovado em 2026-11-10; MVP concluído em 2026-11-12: ondas 0 a 3 integradas (PRs #3 a #6). Onda 4 adiada como MVP futuro, por decisão do Guilherme.**

A `develop` já entrega cadastro de projeto com N repositórios, papéis por agente (PO/Dev/QA → Claude/Codex/Gemini), leitura de contexto pelo MCP e pipeline de tarefas/PRs por projeto. Este plano **não reescreve nada**: migra o painel para o WSL, fecha as três lacunas dos problemas originais (contexto preso nos `.md`, visão única de todos os projetos, agentes plugáveis) e aproxima o painel da imagem de referência.

## 1. Como o trabalho anda

### Ambiente alvo

| Peça | Onde roda | Observação |
| --- | --- | --- |
| Painel (`server.mjs`) + SQLite | WSL (`~/projetos/orquestradorIA`), Node 24 do nvm | Navegador do Windows abre `http://127.0.0.1:47621` (WSL 2 encaminha o localhost) |
| `gh` | WSL (conta `guilherme-oliveria`) | Dev e QA usam a mesma conta → veredito por comentário `QA: APROVADO <sha>` |
| Claude Desktop e Codex Desktop | Windows | Continuam sendo os agentes. O conector MCP é iniciado por eles via `wsl.exe … node mcp.mjs <agente>`, assim o `mcp.mjs` roda no WSL e enxerga o painel no loopback. Alternativa testada na onda 0: Node do Windows + encaminhamento de porta |
| Repositórios dos produtos | Windows (`C:\projetos\…`) ou WSL | `preparar_worktree` aceita `/mnt/c/...` quando o conector roda no WSL |
| Claude Code CLI e Codex CLI | WSL | Opcional; recebem o mesmo MCP com `claude mcp add` / `codex mcp add` |

### Gitflow

| Branch | Para quê | Sai de | Volta para |
| --- | --- | --- | --- |
| `main` | Versões publicadas, tag `vX.Y.Z` | — | — |
| `develop` | Integração | `main` | `main` via `release/` |
| `feature/orq-NN-descricao` | Uma tarefa deste plano | `develop` | `develop` (PR, squash) |
| `release/X.Y.Z` | Fechar um marco | `develop` | `main` (PR aprovado pelo Guilherme) + back-merge |

- Uma onda = um PR para `develop` (as tarefas da onda entram juntas, nomeadas no PR). Tarefa grande demais vira PR próprio.
- Nunca commit em `main`/`develop`; o kit Gitflow instalado na onda 0 bloqueia isso no Claude Code e nos git hooks.
- Merge em `develop` e em `main`: **sempre do Guilherme**.
- Ao fim de cada onda: resumo do que foi feito, como rodar e testar, pendências.
- Dependência nova (npm ou serviço): avisar antes. Previsão: **nenhuma**.

### Formato das tarefas

```
- [ ] ORQ-NN Título
  Depende de: …
  Faz: …
  Pronto quando: …
```

## 2. Ondas

| Onda | Tarefas | Integração ao fim da onda |
| --- | --- | --- |
| 0. Migração e base | ORQ-01, ORQ-02, ORQ-03, G-01, G-02 | Painel rodando no WSL, Desktops conectados ao MCP, um PR real do Dieta+ lido pelo painel, Gitflow protegido na máquina |
| 1. Contexto estruturado | ORQ-04, ORQ-05, ORQ-06 | Agente do mobile lê pelo MCP uma decisão registrada pelo agente do back; aba "Contexto" no painel; exportação para `docs/CONTEXTO-PROJETO.md` |
| 2. Visão geral | ORQ-07, ORQ-08, ORQ-09 | Página inicial com todos os projetos, cards com trilho e contagem de correções, resumo "N PRs esperando seu merge" como na imagem |
| 3. Agentes plugáveis | ORQ-10, ORQ-11, ORQ-12 | Novo agente = uma entrada em `lib/agents.mjs`; instruções por papel geradas a partir do guia; diagnóstico por agente |
| 4. MVP futuro (adiado) | ORQ-13, ORQ-14 | Runner local por CLI e propagação automática do contexto por PR |

Cada onda cabe em 1 a 2 sessões de trabalho. A onda seguinte começa depois do merge da anterior na `develop`.

## 3. Marcos

| Marco | Versão | O que o Guilherme consegue fazer | Como conferir |
| --- | --- | --- | --- |
| M1 | incluído na 1.0.0 | Usar o painel no WSL com os Desktops e registrar/ler decisões e contratos entre repos pelo MCP | Onda 1 integrada; `node --test` verde |
| M2 (MVP) | 1.0.0 | Ver todos os projetos num painel só, no layout da imagem, e trocar/adicionar agentes sem editar o guia | Onda 3 integrada |
| M3 (futuro) | 1.1.0 | Agentes disparados pelo painel via CLI, sem agendamento manual nos Desktops | Onda 4, adiada |

A release é aberta e aprovada pelo Guilherme (`release/X.Y.Z` → `main`).

## 4. Tarefas

### Onda 0 — migração e base

- [x] **ORQ-01 Painel no WSL**
  Depende de: —
  Faz: `iniciar-painel.sh` (carrega o nvm, valida Node ≥ 24 e `gh auth status`, sobe o painel); seção "WSL + Desktops no Windows" no `docs/MANUAL.md` com o comando `wsl.exe` para o MCP de cada Desktop; `.gitignore` revisado; este plano em `docs/plano-de-execucao.md`.
  Pronto quando: `bash iniciar-painel.sh` sobe o painel no WSL e o navegador do Windows abre `http://127.0.0.1:47621`; `node --test` verde.

- [x] **ORQ-02 Desktops conectados ao painel do WSL**
  Depende de: ORQ-01
  Faz: configurar `orquestradoria` no Codex Desktop (`config.toml`) e no Claude Desktop apontando para `wsl.exe -d Ubuntu-24.04 -- <node> <mcp.mjs> <agente>`; remover a entrada antiga `orquestradoria-2` (OneDrive); registrar também nos CLIs do WSL (`claude mcp add`, `codex mcp add`).
  Pronto quando: `testar_conexao` executado nas sessões do Claude Desktop e do Codex Desktop aparece em Configurações → Conexões; `preparar_worktree` cria uma worktree num repo em `/mnt/c/projetos`.

- [x] **ORQ-03 Kit Gitflow no WSL**
  Depende de: —
  Faz: rodar `instalar.sh` do kit (`/mnt/c/projetos-claude/projeto-dieta-mais/gitflow`) no WSL, preservando o hook `rtk` já existente no `settings.json`; skill `gitflow` em `~/.claude/skills` e `~/.codex/skills`; bloco no `~/.codex/AGENTS.md`.
  Pronto quando: em qualquer repo, na `main`, `git commit --allow-empty -m teste` é recusado; o Claude Code mostra o bloqueio do `gitflow-guard`.

- [ ] **G-01 Proteção do repositório no GitHub** *(Guilherme)*
  Depende de: —
  Faz: rulesets em `main` e `develop` (exigir PR, bloquear force push), workflows do kit em `.github/workflows/` se quiser CI, "Automatically delete head branches".
  Pronto quando: um push direto na `develop` é recusado pelo GitHub.

- [ ] **G-02 Validação ponta a ponta** *(Guilherme)*
  Depende de: ORQ-02
  Faz: cadastrar o Dieta+ (API + mobile) no painel do WSL, vincular um PR existente e conferir o estágio.
  Pronto quando: o painel mostra o PR com CI e veredito corretos.

### Onda 1 — contexto estruturado (problema 1)

- [x] **ORQ-04 Entradas de contexto no modelo e no serviço**
  Depende de: ORQ-01
  Faz: `project.contextEntries[]` com `{ id, type: decision|contract|note, repos[], title, body (md ≤ 8 KB), author, at, supersedes, status }`; ações `add_context_entry`, `supersede_context_entry`, `list_context_entries` (filtro por repo/tipo); `contexto` do MCP passa a devolver também as entradas ativas relevantes ao repo da tarefa reservada; limite de 300 entradas por projeto; testes em `test/context.test.mjs`.
  Pronto quando: teste cobre registrar, substituir e filtrar por repo; `contexto` devolve entrada criada por outro agente.

- [x] **ORQ-05 Tools MCP de escrita de contexto**
  Depende de: ORQ-04
  Faz: tools `registrar_decisao`, `registrar_contrato`, `registrar_nota` (com `repos` e `substitui`), `listar_contexto`; PO e Dev escrevem, QA só nota; autor registrado pelo agente da sessão; instruções da sessão (botão "Copiar instruções") atualizadas para pedir o registro de decisões e contratos.
  Pronto quando: na sessão do Codex, `registrar_contrato` cria a entrada e a sessão do Claude a lê com `contexto`.

- [x] **ORQ-06 Aba "Contexto" e exportação**
  Depende de: ORQ-04
  Faz: nova view `Contexto` por projeto (lista por tipo e repo, filtro, criar/substituir pelo painel); botão "Gerar Markdown" que monta o `docs/CONTEXTO-PROJETO.md` a partir do resumo + entradas ativas e copia as instruções do PR de propagação (reaproveita `propagate`); "Verificar cópias" passa a comparar com o Markdown gerado.
  Pronto quando: o Markdown gerado contém todas as entradas ativas e a comparação de cópias aponta divergência quando um repo está atrasado.

### Onda 2 — visão geral (problema 3, imagem de referência)

- [x] **ORQ-07 Página inicial "Visão geral"**
  Depende de: ORQ-01
  Faz: view padrão ao abrir o painel com todos os projetos: linha-resumo no topo ("N PRs esperando seu merge · M agentes trabalhando"), um bloco por projeto com repos, tarefas e PRs no mesmo trilho Fila → Desenvolvimento → PR → Revisão → Testes → Aprovação → Seu merge; filtros por projeto, repo, agente e etapa; clique abre o detalhe.
  Pronto quando: com dois projetos cadastrados, a página lista os dois e os filtros funcionam sem recarregar.

- [x] **ORQ-08 Cards como na imagem**
  Depende de: ORQ-07
  Faz: contagem de correções por PR ("1 correção", "2 correções") calculada dos eventos `QA: CORRIGIR` e reviews CHANGES_REQUESTED (campo `observation.corrections`); texto de status à direita ("Rodando testes", "Aprovado, esperando seu merge", "Merge feito", "Cancelado") e quem desenvolve/revisa; detalhe do card com link do PR, pendências da revisão (último comentário `QA: CORRIGIR`) e último evento da execução.
  Pronto quando: um PR que passou por CORRIGIR → PRONTO PARA REVISAR → APROVADO mostra "1 correção" e o estágio certo.

- [x] **ORQ-09 Barra de agentes com cota**
  Depende de: ORQ-07
  Faz: cabeçalho com um cartão por agente (Livre/Ocupado, tarefa atual, % da janela de 5 h e semanal já coletados em `usage.mjs`); preset rápido do projeto atual ("Claude desenvolve, Codex revisa" / inverso / automático) reaproveitando `settings`; "Automático" escolhe o Dev com mais cota livre na criação da tarefa.
  Pronto quando: trocar o preset altera o perfil das próximas tarefas e o modo automático escolhe o agente com menor uso registrado.

### Onda 3 — agentes plugáveis (problema 2)

- [x] **ORQ-10 Registro único de agentes**
  Depende de: ORQ-01
  Faz: `lib/agents.mjs` com, por agente, `{ id, label, cli: { command, versionArgs, authCheck }, mcp: { registerCommand }, roles: { po, dev, qa } }`; `workflow.mjs`, `mcp.mjs`, `connections.mjs`, `service.mjs` e `app.js` passam a derivar nomes, validações e opções dele (o painel recebe a lista por `/api/workspace`).
  Pronto quando: adicionar um agente de teste só no registro faz ele aparecer em papéis, conexões, chat e MCP; testes verdes.

- [x] **ORQ-11 Instruções por papel geradas do guia**
  Depende de: ORQ-10
  Faz: templates de instrução por papel (PO, Dev, QA) com campos do projeto (repos, docs, checks, protocolo `QA: APROVADO/CORRIGIR <sha>`, regras Gitflow), derivados do guia atual; botão "Copiar instruções do PO / Dev / QA" por agente para colar na sessão ou no agendamento do Desktop; o texto muda conforme quem ocupa cada papel.
  Pronto quando: trocar Claude↔Codex nos papéis gera instruções coerentes sem editar o guia.

- [x] **ORQ-12 Diagnóstico por agente**
  Depende de: ORQ-10
  Faz: Configurações → Conexões lê os testes do registro (CLI, login, MCP) e mostra o comando de registro do MCP pronto para copiar, com o caminho do WSL.
  Pronto quando: o cartão de cada agente mostra versão, login e último teste MCP a partir do registro.

### Depois do MVP — ajustes do primeiro uso real (2026-11-12)

- [x] **ORQ-15 Painel observa o GitHub** (PR #10)
  Faz: PRs abertos para a develop viram cards sozinhos; veredito do QA sem SHA; branches `claude/` e `codex/`; plano lido do repositório.
- [x] **ORQ-16 Kanban alimentado pelo plano de ação**
  Faz: quadro em colunas por projeto; importação do `plano-de-acao.md` de cada repositório; card sem PR arrastável, card com PR segue o GitHub; PR ligado ao card pelo ID no título.

### Onda 4 — MVP futuro (adiado)

> Decisão de 2026-11-12: não fazer agora. O fluxo segue como está: os pedidos e as sessões continuam no Claude Desktop e no Codex Desktop, e o painel organiza e mostra o andamento. Reavaliar depois de usar o MVP com o Dieta+, se manter sessão aberta ou agendamento configurado virar incômodo.
>
> Antes de começar o ORQ-13, definir: limite de cota para pausar execuções, máximo de execuções simultâneas, permissões pré-liberadas dos CLIs e onde ficam os clones no WSL. O runner dispara execuções em segundo plano; não é um chat no painel.

- [ ] **ORQ-13 Runner local por CLI**
  Depende de: ORQ-11
  Faz: o painel dispara `claude -p` / `codex exec` na pasta do repo, com as instruções do papel, em intervalo configurável; execução registrada em Execuções.
  Pronto quando: uma tarefa na fila é reservada e trabalhada sem sessão aberta no Desktop.

- [ ] **ORQ-14 Propagação automática do contexto**
  Depende de: ORQ-06, ORQ-13
  Faz: ao detectar cópia divergente, o painel abre o PR de atualização do `CONTEXTO-PROJETO.md` em cada repo via `gh`.
  Pronto quando: a divergência some após o merge dos PRs gerados.

## 5. Decisões já tomadas

- Stack mantida: Node 24, `node:sqlite`, ES modules, painel em JS puro com CSP restrita, MCP stdio sem SDK. Nenhuma dependência npm.
- O painel é a **fonte viva** do contexto (decisões, contratos, notas). O `docs/CONTEXTO-PROJETO.md` dos repos passa a ser um snapshot gerado e propagado por PR.
- Desktops continuam no Windows; painel no WSL; conector MCP executado dentro do WSL via `wsl.exe`.
- O clone vazio em `C:\projetos-claude\OrquestradorIA\orquestradorIA` não é usado; o de trabalho é `~/projetos/orquestradorIA` no WSL.

## 6. Como um agente pega a próxima tarefa

1. Abre este arquivo e acha a primeira onda com tarefa `[ ]`.
2. Confere o "Depende de"; só pega tarefa com dependências `[x]` ou mergeadas.
3. `git switch -c feature/orq-NN-descricao origin/develop`, trabalha, `node --test`, PR para `develop` com o ID no título e `[x]` neste arquivo no mesmo PR.
4. Espera o merge do Guilherme antes de tarefa que dependa desse PR.
