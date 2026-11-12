# Changelog

## 1.0.1 — não publicada

- PRs abertos para a `develop` entram no pipeline automaticamente, sem tarefa criada nem chamada ao MCP.
- Veredito do QA sem SHA (`QA: APROVADO`, `QA: CORRIGIR`) e `QA: PRONTO PARA REVISAR` passam a ser reconhecidos.
- Branches `claude/`, `codex/` e `copilot/` aceitas nos PRs.
- Planejamento mostra o Markdown do plano versionado no repositório.

## 1.0.0 — 2026-11-12

Primeira versão publicada do Orquestrador IA: painel local que coordena Claude Code, Codex e outros agentes em vários repositórios do mesmo produto, com Gitflow e merge humano.

### Projetos e fluxo de entrega
- Projeto com vários repositórios (back, front, mobile), cada um com documentos de referência e checks de CI.
- Papéis PO, Dev e QA configuráveis por projeto, com modelo e esforço por papel.
- Tarefas com dependências entre repositórios, reservas de 45 minutos, execuções e worktrees isoladas.
- Leitura de PRs, reviews e checks pelo GitHub CLI; veredito do QA por review ou por comentário `QA: APROVADO <sha>` / `QA: CORRIGIR <sha>`.
- Plano do PO, sprints, cortes de release, custos e limites de uso por agente.

### Contexto compartilhado (#4)
- Decisões (`DEC-NN`), contratos (`CON-NN`) e notas (`NOT-NN`) com escopo por repositório, substituição e encerramento.
- Tools MCP `listar_contexto`, `registrar_decisao`, `registrar_contrato`, `registrar_nota`, `encerrar_contexto` e `markdown_contexto`.
- Markdown gerado para versionar nos repositórios, com aviso quando o arquivo oficial está atrás do painel.

### Visão geral (#5)
- Página inicial com todos os projetos, cartões de agente com cota e cards no trilho Fila → Seu merge.
- Contagem de correções pedidas pelo QA por PR e pendências da última revisão.
- Preset "Próximos cards": manter, inverter Dev/QA ou automático pela cota.

### Agentes plugáveis (#6)
- Registro único em `lib/agents.mjs`: um agente novo é uma entrada.
- Instruções do PO, Dev e QA geradas do cadastro do projeto (`instrucoes_do_papel`).
- Diagnóstico de CLI e MCP por agente, com o comando de registro pronto.

### Ambiente (#3)
- Painel no WSL com `iniciar-painel.sh`; Desktops no Windows conectam o MCP via `wsl.exe`.

### Fora desta versão
- Runner que dispara os agentes pelo CLI (ORQ-13) e propagação automática do contexto por PR (ORQ-14): ver `docs/plano-de-execucao.md`.
