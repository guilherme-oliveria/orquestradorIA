# AGENTS.md

Instruções para agentes de IA neste repositório.

## Orquestrador IA (contexto compartilhado entre os repositórios)

Este repositório faz parte do projeto **`teste-adocao`** (Teste de adoção) no painel local do Orquestrador IA. O painel acompanha sozinho os PRs abertos para a `develop` (etapa, CI e vereditos do QA) e monta o Kanban a partir do plano de ação, então o fluxo de PR deste arquivo não muda.

Para o card andar sozinho no Kanban, comece o título do PR pelo ID da tarefa (ex.: `API-12 Cadastro de paciente`).

Se a sessão tiver o MCP `orquestradoria` (sessões locais), use-o com `project: "teste-adocao"` e `repo: "guilherme-oliveria/orquestradoria"`:

- Antes de começar uma tarefa: `listar_contexto` deste repositório, para ver decisões e contratos registrados pelos outros.
- Ao tomar uma decisão que outro repositório precisa respeitar: `registrar_decisao`.
- Ao criar ou mudar um contrato (endpoint, DTO, código de erro, evento): `registrar_contrato`, com os repositórios envolvidos em `repos`. Para atualizar um registro, passe o ID dele em `supersedes`.
- Risco ou pendência que afeta outro repositório: `registrar_nota`.
- `instrucoes_do_papel` devolve as instruções completas do seu papel (PO, Dev ou QA).

Sem o MCP (sessão na nuvem), siga normalmente: os documentos do repositório continuam sendo a referência e nada aqui bloqueia o trabalho.
