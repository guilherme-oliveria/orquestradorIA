# Manual do Orquestrador IA

O Orquestrador reúne projetos, contexto, mensagens, tarefas e status dos PRs. Claude e Codex trabalham nas sessões locais dos seus clientes. O MCP dá a essas sessões acesso à fila e ao contexto do painel. O GitHub guarda código, branches, PRs e resultados do CI.

## 1. Escolha seu ambiente

| Componente | Quando precisa dele |
| --- | --- |
| **Node.js 24 ou superior** | Obrigatório no ambiente que executa o painel. Use também um executável Node acessível ao cliente que inicia o MCP. O painel usa SQLite embutido e funciona sem instalar pacotes npm. |
| **GitHub e GitHub CLI (`gh`)** | Para consultar PRs, checks e Markdown versionado. Instale e autentique o `gh` no ambiente onde o painel roda. |
| **Git** | Nos ambientes onde Dev e QA vão baixar o código, trocar de branch e trabalhar nos PRs. |
| **Claude Desktop ou Claude Code CLI** | Escolha um cliente com sessão local para o agente Claude. |
| **Codex Desktop ou Codex CLI** | Escolha um cliente com sessão local para o agente Codex. Pode combinar Desktop de um provedor com CLI do outro. |
| **WSL 2** | Opcional. Use se preferir trabalhar com Node, Git, `gh` e os CLIs dentro do Linux. |
| **Docker** | Opcional. Use para bancos, serviços e testes dos projetos. O painel pode rodar diretamente no Windows ou WSL. |
| **OpenCode** | Opcional como ferramenta de desenvolvimento. Esta versão do painel registra Claude, Codex e Gemini CLI. OpenCode ainda precisa de um adaptador próprio para aparecer como agente. |

Para começar no Windows, use Node 24, Git, `gh`, Claude Desktop e Codex Desktop. Use WSL se seu trabalho já estiver concentrado no Linux. [Node.js](https://nodejs.org/en/download) · [Git](https://git-scm.com/downloads) · [GitHub CLI](https://cli.github.com/)

## 2. Inicie o painel e confira o GitHub

No Windows, abra `Iniciar-painel.cmd` na pasta do Orquestrador ou rode `node server.mjs` nessa pasta. No WSL, use `bash iniciar-painel.sh`: ele carrega o Node do nvm quando necessário, confere a versão e o login do `gh` e sobe o painel. Abra [127.0.0.1:47621](http://127.0.0.1:47621/).

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

### Painel no WSL com os Desktops no Windows

Se o painel, o Node e o `gh` estão no WSL e os Desktops no Windows, faça cada Desktop iniciar o conector **dentro do WSL** com `wsl.exe`. Assim o `mcp.mjs` roda no mesmo ambiente do painel e as worktrees são criadas pelo Git do WSL. Descubra o nome da distribuição com `wsl -l -v` e o caminho do Node com `which node` (no nvm, `~/.nvm/versions/node/<versão>/bin/node`). Use caminhos absolutos do Linux.

Codex Desktop (`%USERPROFILE%\.codex\config.toml`):

```toml
[mcp_servers.orquestradoria]
enabled = true
command = "C:/Windows/System32/wsl.exe"
args = ["-d", "Ubuntu-24.04", "--", "/home/usuario/.nvm/versions/node/v24.22.2/bin/node", "/home/usuario/projetos/orquestradorIA/mcp.mjs", "codex"]
startup_timeout_sec = 60
```

Claude Desktop (`claude_desktop_config.json`; na versão da Microsoft Store ele fica em `%LOCALAPPDATA%\Claude-Data\<pacote>\`):

```json
{
  "mcpServers": {
    "orquestradoria": {
      "command": "C:/Windows/System32/wsl.exe",
      "args": ["-d", "Ubuntu-24.04", "--", "/home/usuario/.nvm/versions/node/v24.22.2/bin/node", "/home/usuario/projetos/orquestradorIA/mcp.mjs", "claude"]
    }
  }
}
```

O painel precisa estar rodando no WSL (`bash iniciar-painel.sh`). O navegador do Windows abre `http://127.0.0.1:47621` porque o WSL 2 encaminha o localhost. Para testar o comando sem abrir o Desktop, rode no WSL um `initialize` seguido de `tools/call testar_conexao` pelo próprio `wsl.exe`; o resultado aparece em **Configurações → Conexões**. Repositórios em pastas do Windows são acessíveis pelo conector como `/mnt/c/...` em `preparar_worktree`.

### Codex CLI e Claude Code CLI

Instale apenas os CLIs que pretende usar. Na pasta do Orquestrador, em PowerShell ou Bash, registre o conector para cada cliente escolhido. O escopo `user` no Claude Code disponibiliza o servidor nas sessões dos diferentes repositórios da mesma conta local. [Instalação do Codex CLI](https://learn.chatgpt.com/docs/cli) · [Instalação do Claude Code](https://code.claude.com/docs/en/setup) · [MCP no Claude Code](https://code.claude.com/docs/en/mcp)

```text
codex mcp add orquestradoria -- node "$PWD/mcp.mjs" codex
codex mcp list

claude mcp add --scope user --transport stdio orquestradoria -- node "$PWD/mcp.mjs" claude
claude mcp list
```

Para testar, peça na sessão de cada agente “Use o MCP `orquestradoria` para listar os projetos”. Se a lista estiver vazia, cadastre um projeto no painel e repita o teste. O cadastro fica no Orquestrador. Você pode continuar usando suas sessões e pastas existentes no Claude e no Codex.

Em **Configurações → Conexões**, use **Testar CLI** para verificar se o executável está acessível no ambiente do painel. Claude e Codex também mostram se o CLI encontrou um login local. Para validar o caminho MCP, use **Copiar teste MCP**, cole na sessão que quer testar e clique em **Atualizar testes MCP** no painel. O horário exibido é o do último teste bem-sucedido do agente. OpenCode aparece no diagnóstico de CLI.

### Adicionar um novo tipo de agente

Os agentes ficam em um único registro, `lib/agents.mjs`. Uma entrada define o rótulo, o comando do CLI (com o teste de login, se houver), o comando de registro do MCP e se a conta informa janelas de limite. Com a entrada criada, o agente aparece na escolha de papéis, nos destinatários do chat, em **Configurações → Conexões** (teste de CLI, teste MCP e comando de registro pronto para copiar) e passa a ser aceito como identidade do conector (`node mcp.mjs <id>`). Um agente sem `mcp` aparece só no diagnóstico de CLI.

```js
'meu-agente': {
  label: 'Meu Agente',
  cli: { command: 'meuagente', auth: { args: ['login', 'status'], format: 'exit-code' } },
  mcp: { register: 'meuagente mcp add orquestradoria -- {node} {mcp} meu-agente' }
}
```

Reinicie o painel e os conectores depois de editar o registro.

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
3. Em **Papéis e contexto**, escolha o repositório oficial e o caminho do Markdown compartilhado. Você pode reutilizar um contrato existente. Para um documento novo, use `docs/CONTEXTO-PROJETO.md` e publique as cópias por PR para a `develop` de cada repo. **Verificar cópias** mostra o que está atualizado, divergente ou ausente e se o arquivo oficial está atrás do painel. Documentos específicos de cada repo podem ser cadastrados separadamente.
4. Em **Contexto**, registre as decisões, os contratos entre repositórios e as notas que os agentes precisam conhecer (veja "Contexto compartilhado" abaixo).
5. Crie as tarefas que quer acompanhar. Declare dependências pelos IDs das tarefas cadastradas. Para um PR já em andamento, abra a tarefa, use **Vincular PR** e informe o número. O painel valida o repo, a branch de origem `feature/` ou `bugfix/` e o destino `develop`.
6. Clique em **Sincronizar GitHub**. A partir daí, o painel consulta os PRs vinculados periodicamente. Nesta versão, cadastros, importação de PRs e escolhas de papel são feitos por projeto.

### Contexto compartilhado

O painel é a fonte viva do contexto que atravessa os repositórios. Cada entrada tem um tipo, um ID e o escopo de repositórios a que se aplica (vazio = todos):

| Tipo | ID | Quem registra | Para quê |
| --- | --- | --- | --- |
| Decisão | `DEC-NN` | PO e Dev | Escolhas de produto e arquitetura que os outros repositórios precisam respeitar |
| Contrato | `CON-NN` | PO e Dev | Endpoints, DTOs, eventos e códigos de erro entre API, web e mobile |
| Nota | `NOT-NN` | Qualquer papel, inclusive o QA | Andamento, riscos e pendências visíveis aos outros repositórios |

Uma entrada nunca é editada: para mudar, registre outra com **Substituir** (ou `supersedes` no MCP), e a anterior fica marcada como substituída. **Encerrar** retira uma entrada sem substituta; só o autor ou o PO fazem isso.

Pelo MCP, os agentes usam `listar_contexto` (filtro por `repo` e `type`, rápido, sem GitHub), `contexto` (traz as entradas do repositório junto com o Markdown oficial e as referências), `registrar_decisao`, `registrar_contrato`, `registrar_nota` e `encerrar_contexto`. A instrução da sessão já pede para ler `listar_contexto` antes de implementar e registrar o que afeta outros repositórios.

O arquivo versionado nos repositórios passa a ser um **snapshot gerado**: **Baixar Markdown** na aba Contexto (ou `markdown_contexto` no MCP) monta o resumo do projeto mais as entradas ativas. Publique-o no repositório oficial por PR e propague as cópias; **Verificar cópias** avisa quando o oficial está atrás do painel e **Copiar instruções para os PRs** gera o pedido para o Dev atualizar.

Na tela **Repositórios**, cada cartão mostra a área e o nome do projeto. Use **Todos os projetos** para ver os repositórios cadastrados em uma única lista. O botão **+ Repositório** cadastra no projeto selecionado na barra lateral.

### Visão geral

O painel abre na **Visão geral**, que reúne todos os projetos. A linha do topo diz quantos PRs esperam o seu merge e quantos agentes estão trabalhando. Cada agente tem um cartão com o estado (Livre ou Ocupado, com a tarefa reservada) e o uso das janelas de cota já lidas em **Custos e limites**. Abaixo, cada projeto lista seus cards no trilho Fila → Desenvolvimento → PR → Revisão → Testes → Aprovação → Seu merge. O laço "N correções" conta quantas vezes o QA pediu correção naquele PR (reviews com mudanças solicitadas e comentários `QA: CORRIGIR`). Filtre por projeto, repositório, agente e etapa. Clicar num card abre os detalhes, com o link do PR, as pendências da última revisão e o último registro do agente.

**Próximos cards** troca rapidamente quem desenvolve e quem revisa as tarefas novas do projeto. As tarefas já criadas mantêm o perfil que tinham. No modo **Automático**, cada tarefa nova vai para o agente, entre Dev e QA do projeto, com menor uso na janela de 5 horas; sem leitura válida de cota para os dois, vale a configuração do projeto.

### Da fila ao merge

- O **PO** lê o contexto e registra tarefas com critérios de aceite.
- O **Dev** reserva a tarefa, trabalha numa branch Gitflow, roda os testes e vincula o PR aberto para `develop`.
- O **QA** revisa o SHA atual e registra o resultado. Uma review formal exige uma conta GitHub diferente da conta que abriu o PR. Se ambos usam a mesma conta, o painel aceita um comentário novo do login configurado para o QA, com `QA: APROVADO <sha completo>` ou `QA: CORRIGIR <sha completo>` na primeira linha. Esse veredito informa o painel. As exigências de aprovação do GitHub continuam valendo. [Revisões obrigatórias no GitHub](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews)
- O **dono** faz o merge no GitHub. O painel libera as dependências após verificar merge, QA e CI. Se houver um novo push, o QA precisa revisar o novo SHA.

Para usar agendamentos, abra **Papéis e contexto → Instruções por papel**, copie o texto do PO, do Dev ou do QA e inclua no agendamento do agente que ocupa aquele papel. O texto é gerado a partir dos papéis, repositórios, checks e regras do projeto, então muda sozinho quando você troca quem faz cada papel; copie de novo depois de uma troca. O agente também obtém o mesmo texto com a ferramenta `instrucoes_do_papel`. Teste primeiro a sessão local. A execução agendada precisa alcançar o MCP e o painel. Uma execução inteiramente na nuvem não alcança o `127.0.0.1` desta máquina. Modelo e esforço são preferências salvas na tarefa. Configure o modelo efetivo no cliente que roda a sessão.

Em **Agentes e papéis**, o painel mostra o modelo e o esforço configurados. **Ocupado** indica uma reserva ativa, inclusive quando a tarefa é de outro projeto do painel. **Livre** indica que o Dev ou QA está sem reserva ativa. A cota do provedor e sessões externas são consultadas no cliente de cada agente.

### Checklist para o primeiro PR real

- [ ] A `develop` existe no repositório e o Dev consegue abrir um PR a partir de `feature/` ou `bugfix/`.
- [ ] O painel consegue ler esse PR com o `gh` do ambiente local.
- [ ] Cada agente lista o projeto pelo MCP e consegue abrir a pasta de trabalho que lhe corresponde.
- [ ] O GitHub publica os checks do CI e o login cadastrado para o QA consegue registrar o veredito.
- [ ] Após o merge, o painel indica a tarefa como validada e libera as dependentes.

### Planejamento, execuções e worktrees

Em **Planejamento**, o dono pode editar o plano em Markdown e o PO pode publicá-lo pela ferramenta `salvar_plano`. Crie sprints com objetivo e datas. Escolha a sprint no cadastro da tarefa ou use **Definir sprint** nos detalhes de uma tarefa existente. Os agentes consultam o plano e as sprints com `ler_planejamento`.

Em **Execuções**, cada reserva de Dev ou QA tem um histórico próprio. Sessões distintas podem reservar tarefas diferentes em paralelo. O PO também pode abrir uma execução com `iniciar_planejamento`. Use `atualizar_execucao` para registrar o ID ou link da thread e os marcos do trabalho. Informe o ID da tarefa para Dev e QA ou o ID da execução para o PO. O painel atualiza a lista e conserva o histórico após o fim da reserva. As atualizações vêm das ferramentas chamadas pelo agente.

Para isolar o checkout, atualize as referências do clone no ambiente do agente e chame `preparar_worktree` com o caminho absoluto do clone, o projeto, a tarefa e o token da reserva. O conector verifica se o `origin` corresponde ao repositório cadastrado e cria a worktree ao lado do clone, dentro de `.orquestrador-worktrees`. O Dev usa a branch da tarefa. O QA recebe um checkout isolado no SHA do PR. Se outro cliente já criou uma worktree, informe o caminho em `atualizar_execucao`. A worktree permanece disponível após a reserva para permitir retomada e revisão do trabalho.

Quando todas as tarefas da sprint tiverem merge validado, use **Registrar corte** e informe uma versão como `1.2.0`. O painel guarda as tarefas e o SHA observado da `develop` de cada repositório envolvido. O corte é um registro para revisão. A publicação da release continua no fluxo do GitHub.

### Custos, consumo e reset das janelas

Em **Custos e limites**, escolha o projeto atual ou todos os projetos para acompanhar os valores por agente e papel. **Registrar custo** recebe a moeda, o valor e a origem. O relatório separa valores cobrados, estimativas e rateios de assinatura. Para corrigir um lançamento, abra **Lançamentos recentes** e use **Cancelar lançamento**.

Agentes podem enviar o custo acumulado da execução com `registrar_custo`, antes de encerrar a reserva. Enviar novamente o mesmo tipo e moeda para a mesma execução atualiza o total, evitando duplicação. Os valores dependem do resumo de uso ou da fatura que você ou o agente informar. As estimativas de sessão do Claude Code são calculadas pelo cliente e podem diferir da cobrança efetiva. [Custos do Claude Code](https://code.claude.com/docs/en/costs)

As janelas de cota pertencem à conta usada pelo agente e são compartilhadas entre projetos. **Consultar Codex local** lê percentuais e resets pelo app-server do CLI autenticado. As janelas disponíveis dependem da conta. **Informar limites** permite registrar manualmente os percentuais e horários do Claude ou Codex. O painel conserva a origem e o horário de cada leitura e, quando o reset chega, pede uma nova leitura. [App-server do Codex](https://learn.chatgpt.com/docs/app-server) · [Limites do Claude](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)

Para coletar as janelas do Claude Code, configure opcionalmente o arquivo `claude-usage.mjs` como comando de statusline, com o caminho absoluto do Node e do script na máquina da sessão. O coletor envia ao painel local as janelas de uso e a estimativa da sessão em USD quando o Claude Code fornece esses dados. A estimativa aparece no cartão do Claude. Para contabilizá-la por projeto e papel, use um lançamento com atribuição à execução. Se já usa uma statusline, integre a chamada ao seu script existente. A configuração abaixo considera uma instalação em `C:/Projetos/Orquestrador`.

```json
{
  "statusLine": {
    "type": "command",
    "command": "node C:/Projetos/Orquestrador/claude-usage.mjs"
  }
}
```

Use aspas ao redor do caminho do script se a pasta tiver espaços. Ajuste `ORQ_PORT` no ambiente do coletor se alterou a porta padrão. Os campos disponíveis na statusline dependem do cliente e do modo de autenticação. Pela sessão MCP, `registrar_limites` também aceita uma leitura informada pelo agente. [Statusline do Claude Code](https://code.claude.com/docs/en/statusline)

## 6. WSL, Docker e múltiplos projetos

**WSL 2.** Confira suas distribuições com `wsl -l -v`. Se escolher o fluxo Linux, instale Node, Git e `gh` na distribuição, faça o login do GitHub nela e execute ali o painel e os CLIs. Use o caminho Linux de `mcp.mjs` nos clientes WSL. Para a combinação de painel no WSL e Desktops no Windows, configure os Desktops com `wsl.exe` como descrito na seção 3 e teste o endereço local no navegador Windows e a chamada MCP de ponta a ponta antes de usar o agendamento. [Instalação do WSL](https://learn.microsoft.com/windows/wsl/install) · [Rede do WSL](https://learn.microsoft.com/windows/wsl/networking)

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
