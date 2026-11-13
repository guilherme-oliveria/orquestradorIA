## Cadastrar o projeto no Orquestrador IA

Faça isto logo depois de os repositórios existirem no GitHub com a branch `develop` (passo 3 do fluxo) e repita sempre que entrar um repositório novo no projeto.

1. Se a sessão tiver o MCP `orquestradoria`, chame `cadastrar_projeto` com:
   - `id`: identificador curto em minúsculas com hífen (ex.: `dieta-mais`);
   - `name`: nome do produto;
   - `repos`: todos os repositórios do produto, no formato `dono/repositorio`;
   - `context` (opcional): resumo de 5 a 10 linhas com produto, stack e decisões já tomadas.
2. O painel responde com o que fez em cada repositório: documentos de referência detectados, o PR "docs: seção Orquestrador IA no AGENTS.md" aberto para a `develop` e os cards criados a partir do `docs/arquitetura/plano-de-acao.md`. Informe os links desses PRs ao dono.
3. Depois de escrever ou atualizar o plano de ação, chame `adotar_repositorios` (ou `importar_plano`) para os cards novos entrarem no Kanban.
4. Regra para todo PR de tarefa: o título começa pelo ID da tarefa (`API-12 Cadastro de paciente`). É assim que o card anda sozinho no Kanban.
5. Sem o MCP (sessão na nuvem), não tente contornar: avise o dono para criar o projeto no painel com a lista de repositórios, que o efeito é o mesmo.
