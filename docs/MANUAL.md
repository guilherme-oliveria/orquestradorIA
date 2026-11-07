# Manual do Orquestrador IA

O Orquestrador reúne projetos, contexto, mensagens, tarefas e status dos PRs. Claude e Codex trabalham nas sessões locais dos seus clientes. O MCP dá a essas sessões acesso à fila e ao contexto do painel. O GitHub guarda código, branches, PRs e resultados do CI.

## 1. Escolha seu ambiente

| Componente | Quando precisa dele |
| --- | --- |
| **Node.js 24 ou superior** | Obrigatório no ambiente que executa o painel. Use também um executável Node acessível ao cliente que inicia o MCP. O painel usa SQLite embutido e funciona sem instalar pacotes npm. |
| **GitHub e GitHub CLI (`gh`)** | Para consultar PRs, checks e Markdown versionado. Instale e autentique o `gh` no ambiente onde o painel roda. O modo de demonstração pode ser explorado sem acesso ao GitHub. |
| **Git** | Nos ambientes onde Dev e QA vão baixar o código, trocar de branch e trabalhar nos PRs. |
| **Claude Desktop ou Claude Code CLI** | Escolha um cliente com sessão local para o agente Claude. |
| **Codex Desktop ou Codex CLI** | Escolha um cliente com sessão local para o agente Codex. Pode combinar Desktop de um provedor com CLI do outro. |
| **WSL 2** | Opcional. Use se preferir trabalhar com Node, Git, `gh` e os CLIs dentro do Linux. |
| **Docker** | Opcional. Use para bancos, serviços e testes dos projetos. O painel pode rodar diretamente no Windows ou WSL. |
| **OpenCode** | Opcional como ferramenta de desenvolvimento. Esta versão do painel registra Claude, Codex e Gemini CLI. OpenCode ainda precisa de um adaptador próprio para aparecer como agente. |

Para começar no Windows, use Node 24, Git, `gh`, Claude Desktop e Codex Desktop. Use WSL se seu trabalho já estiver concentrado no Linux. [Node.js](https://nodejs.org/en/download) · [Git](https://git-scm.com/downloads) · [GitHub CLI](https://cli.github.com/)

## 2. Inicie o painel e confira o GitHub

No Windows, abra `Iniciar-painel.cmd` na pasta do Orquestrador ou rode `node server.mjs` nessa pasta. No WSL, use `node server.mjs`. Abra [127.0.0.1:47621](http://127.0.0.1:47621/). O Projeto Atlas usa dados de demonstração.

Use os comandos abaixo no terminal do **mesmo ambiente do painel**.

```text
node --version
git --version
gh --version
gh auth status --hostname github.com
```

Se o `gh` ainda precisar de login, rode `gh auth login --hostname github.com --web` e conclua pelo navegador. Use `gh api user --jq .login` para conferir a identidade ativa. Substitua `DONO/REPO` abaixo por um repositório do projeto para testar o acesso. [Manual do gh auth login](https://cli.github.com/manual/gh_auth_login)

```text
gh repo view DONO/REPO
gh pr list --repo DONO/REPO --base develop
```

O painel precisa de acesso de leitura. Nas sessões dos agentes, confira separadamente a identidade usada para abrir PRs, publicar reviews ou comentar. Se um repositório privado exigir SSO, verifique também a autorização da conta para a organização.

## 3. Conecte os agentes por MCP

O conector MCP usa **STDIO** e roda localmente com Node. Use o caminho absoluto de `mcp.mjs` na sua instalação. A porta padrão do painel e do conector é `47621`. Mantenha o painel ligado enquanto as sessões trabalham. Se o cliente não achar `node`, informe o caminho absoluto do executável.

### Codex Desktop

Em **Settings → MCP servers → Add server**, use o nome `orquestradoria`, transporte **STDIO** e comando `node`. Adicione dois argumentos separados, o caminho absoluto de `mcp.mjs` e `codex`. Salve e reinicie. Confira a conexão com `/mcp`. [MCP no Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

### Claude Desktop

Em **Settings → Developer → Edit Config**, adicione `orquestradoria` dentro de `mcpServers`. Preserve as outras entradas. Este exemplo usa uma pasta de instalação genérica. Troque pelo caminho real, encerre o Claude completamente e abra de novo. Confira se o servidor aparece em **Connectors** na sessão que você vai usar. [Claude Desktop e MCP local](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop) · [Configuração manual](https://py.sdk.modelcontextprotocol.io/get-started/real-host/)

```json
{
  "mcpServers": {
    "orquestradoria": {
      "command": "node",
      "args": ["C:/Projetos/Orquestrador/mcp.mjs", "claude"]
    }
  }
}
```

### Codex CLI e Claude Code CLI

Instale apenas os CLIs que pretende usar. Na pasta do Orquestrador, em PowerShell ou Bash, registre o conector para cada cliente escolhido. O escopo `user` no Claude Code disponibiliza o servidor nas sessões dos diferentes repositórios da mesma conta local. [Instalação do Codex CLI](https://learn.chatgpt.com/docs/cli) · [Instalação do Claude Code](https://code.claude.com/docs/en/setup) · [MCP no Claude Code](https://code.claude.com/docs/en/mcp)

```text
codex mcp add orquestradoria -- node "$PWD/mcp.mjs" codex
codex mcp list

claude mcp add --scope user --transport stdio orquestradoria -- node "$PWD/mcp.mjs" claude
claude mcp list
```

Para testar, peça na sessão de cada agente “Use o MCP `orquestradoria` para listar os projetos”. Se a lista estiver vazia e o painel mostrar só o Atlas, cadastre um projeto real antes de repetir. O cadastro fica no Orquestrador. Você pode continuar usando suas sessões e pastas existentes no Claude e no Codex.

Em **Configurações → Conexões**, use **Testar CLI** para verificar se o executável está acessível no ambiente do painel. Claude e Codex também mostram se o CLI encontrou um login local. Para validar o caminho MCP, use **Copiar teste MCP**, cole na sessão que quer testar e clique em **Atualizar testes MCP** no painel. O horário exibido é o do último teste bem-sucedido do agente. OpenCode aparece no diagnóstico de CLI.

### OpenCode

No OpenCode, use `/connect` para autenticar o provedor e `/models` para escolher o modelo disponível. A documentação do cliente lista as opções de login, como assinatura elegível do ChatGPT quando oferecida, ou chave API do provedor. Para modelos Anthropic no OpenCode, siga o fluxo oficial com chave do Claude Console. OpenCode suporta servidores MCP locais, mas o Orquestrador ainda não tem identidade `opencode` para atribuir papéis, tarefas ou mensagens ao cliente. Ele pode ser usado de forma independente para trabalhar nos mesmos repositórios. [Provedores do OpenCode](https://opencode.ai/docs/providers/) · [MCP no OpenCode](https://opencode.ai/docs/mcp-servers/)

## 4. Assinatura, créditos e chaves de API

O cliente que executa a tarefa chama o modelo usando sua conta, e o provedor contabiliza o uso. O `gh` tem login separado para o GitHub.

| Opção | Como usar | Onde acompanhar o consumo |
| --- | --- | --- |
| **Codex com conta ChatGPT** | Entre com ChatGPT no Desktop ou use `codex login` no CLI. | No plano ou workspace ChatGPT. |
| **Codex com chave OpenAI API** | No Desktop local, escolha a opção de login por chave. No CLI, use `codex login --with-api-key` com a chave pela entrada padrão. `codex login status` informa o modo ativo. | Na organização e no projeto da OpenAI Platform, pela cobrança de API. |
| **Claude com assinatura** | Entre com sua conta Claude no Desktop ou use `/login` em uma sessão Claude Code. Confira o plano ativo antes de usar. | Na conta ou organização Claude. |
| **Claude Code com chave Anthropic API** | Use o Claude Console ou injete `ANTHROPIC_API_KEY` no ambiente do CLI. Confira o modo em `/status`. Se uma chave estiver configurada, ela pode prevalecer sobre a assinatura, especialmente em execução não interativa. | No Claude Console, na conta ou workspace da API. |
| **OpenCode** | Selecione o provedor em `/connect`. A forma de autenticar e pagar depende do provedor escolhido. | Na conta conectada ou no console do gateway usado. |

No Claude Desktop, o login normal usa a conta Claude. A variável `ANTHROPIC_API_KEY` da tabela se aplica ao Claude Code CLI. Para usar a API diretamente com esse fluxo, configure a chave no ambiente do CLI.

Créditos adquiridos dentro de um plano e saldo de uma plataforma de API são separados. Antes de habilitar tarefas recorrentes, confirme qual conta será cobrada e configure alertas ou limites de uso no provedor, se disponíveis. Guarde chaves em um gerenciador de segredos ou na configuração privada da sessão. Mantenha credenciais fora do Markdown, de arquivos compartilhados, de logs e de PRs. [Autenticação e cobrança do Codex](https://learn.chatgpt.com/docs/auth) · [Autenticação e prioridade de credenciais do Claude Code](https://code.claude.com/docs/en/authentication) · [Provedores do OpenCode](https://opencode.ai/docs/providers/)

## 5. Cadastre um projeto novo ou em andamento

1. Clique em **Criar meu projeto**. Defina o identificador e escolha PO, Dev e QA. Informe o login GitHub que vai publicar os vereditos do QA.
2. Em **Repositórios**, adicione os repos no formato `dono/repositorio`. Se houver CI obrigatório, copie os nomes exatos dos checks do GitHub. Deixar o campo vazio faz o painel exigir ao menos um check e considerar todos os checks publicados.
3. Em **Papéis e contexto**, escolha um repositório oficial para `docs/CONTEXTO-PROJETO.md`. Versione esse arquivo pela `develop` de cada repo via PR. **Verificar cópias** mostra o que está atualizado, divergente ou ausente. Documentos específicos de cada repo podem ser cadastrados separadamente.
4. Crie as tarefas que quer acompanhar. Declare dependências pelos IDs das tarefas cadastradas. Para um PR já em andamento, abra a tarefa, use **Vincular PR** e informe o número. O painel valida o repo, a branch de origem `feature/` ou `bugfix/` e o destino `develop`.
5. Clique em **Sincronizar GitHub**. A partir daí, o painel consulta os PRs vinculados periodicamente. Nesta versão, cadastros, importação de PRs e escolhas de papel são feitos por projeto.

Na tela **Repositórios**, cada cartão mostra a área e o nome do projeto. Use **Todos os projetos** para ver os repositórios cadastrados em uma única lista. O botão **+ Repositório** cadastra no projeto selecionado na barra lateral.

### Da fila ao merge

- O **PO** lê o contexto e registra tarefas com critérios de aceite.
- O **Dev** reserva a tarefa, trabalha numa branch Gitflow, roda os testes e vincula o PR aberto para `develop`.
- O **QA** revisa o SHA atual e registra o resultado. Uma review formal exige uma conta GitHub diferente da conta que abriu o PR. Se ambos usam a mesma conta, o painel aceita um comentário novo do login configurado para o QA, com `QA: APROVADO <sha completo>` ou `QA: CORRIGIR <sha completo>` na primeira linha. Esse veredito informa o painel. As exigências de aprovação do GitHub continuam valendo. [Revisões obrigatórias no GitHub](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews)
- O **dono** faz o merge no GitHub. O painel libera as dependências após verificar merge, QA e CI. Se houver um novo push, o QA precisa revisar o novo SHA.

Para usar agendamentos, abra **Papéis e contexto → Copiar instruções da sessão** e inclua o texto no agendamento existente. Teste primeiro a sessão local. A execução agendada precisa alcançar o MCP e o painel. Uma execução inteiramente na nuvem não alcança o `127.0.0.1` desta máquina. Modelo e esforço são preferências salvas na tarefa. Configure o modelo efetivo no cliente que roda a sessão.

Em **Agentes e papéis**, o painel mostra o modelo e o esforço configurados. **Ocupado** indica uma reserva ativa, inclusive quando a tarefa é de outro projeto do painel. **Livre** indica que o Dev ou QA está sem reserva ativa. A cota do provedor e sessões externas são consultadas no cliente de cada agente.

### Checklist para o primeiro PR real

- [ ] A `develop` existe no repositório e o Dev consegue abrir um PR a partir de `feature/` ou `bugfix/`.
- [ ] O painel consegue ler esse PR com o `gh` do ambiente local.
- [ ] Cada agente lista o projeto pelo MCP e consegue abrir a pasta de trabalho que lhe corresponde.
- [ ] O GitHub publica os checks do CI e o login cadastrado para o QA consegue registrar o veredito.
- [ ] Após o merge, o painel indica a tarefa como validada e libera as dependentes.

## 6. WSL, Docker e múltiplos projetos

**WSL 2.** Confira suas distribuições com `wsl -l -v`. Se escolher o fluxo Linux, instale Node, Git e `gh` na distribuição, faça o login do GitHub nela e execute ali o painel e os CLIs. Use o caminho Linux de `mcp.mjs` nos clientes WSL. Para uma combinação de painel no WSL e Desktops no Windows, teste o endereço local no navegador Windows e a chamada MCP de ponta a ponta antes de usar o agendamento. [Instalação do WSL](https://learn.microsoft.com/windows/wsl/install) · [Rede do WSL](https://learn.microsoft.com/windows/wsl/networking)

**Docker.** Para usar Docker Desktop a partir do WSL, habilite a integração da distribuição e confirme com `docker version`. Use Docker para as dependências e os testes de cada repositório. O painel liga apenas no loopback e usa o `gh` do ambiente em que roda. Colocá-lo em contêiner exige tratar rede, `gh` e persistência do SQLite. A versão atual é distribuída para execução direta. [Docker Desktop com WSL 2](https://docs.docker.com/desktop/features/wsl/)

**Mais de um projeto.** Uma instância do painel comporta vários projetos. Para separar duas instâncias, use uma porta e um diretório de dados diferentes em cada uma. Configure o mesmo `ORQ_PORT` no ambiente do servidor e na configuração do MCP que vai atendê-lo. Abra o navegador na porta correspondente.

## 7. Diagnóstico e backup

| Sintoma | O que conferir |
| --- | --- |
| Navegador não abre ou porta ocupada | O processo `node server.mjs` precisa estar ativo. Confira `ORQ_PORT` e o endereço no navegador. |
| MCP não aparece | Confira caminho de `mcp.mjs`, executável Node, transporte STDIO e argumento `claude` ou `codex`. Reinicie o cliente. |
| MCP aparece mas não conecta | Confirme se o cliente e o painel alcançam a mesma porta local. Reproduza primeiro numa sessão local e depois no agendamento. |
| GitHub retorna erro de acesso | No ambiente do painel, rode `gh auth status` e `gh repo view DONO/REPO`. Verifique conta ativa, permissões e SSO. |
| PR aparece em teste ou revisão mesmo após o QA | Confira se o veredito foi publicado pelo login esperado, se cita o SHA atual e se os checks configurados já concluíram. |
| Cópia de contexto aparece ausente | Confira o caminho exato e se o PR do Markdown já entrou na `develop` daquele repositório. |

Os cadastros ficam em `data/workspace.sqlite` por padrão. Para um backup simples, pare o servidor e copie a pasta `data/` inteira para um local privado. Se configurou `ORQ_DATA_DIR`, copie essa pasta em vez da padrão. Para restaurar, mantenha o servidor parado, preserve uma cópia do estado atual e aponte a instância para a cópia restaurada antes de iniciar.
