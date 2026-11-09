# Orquestrador IA

Painel local para planejar, desenvolver e revisar tarefas com Claude Desktop e Codex Desktop. Um projeto agrupa repositórios independentes e compartilha contexto Markdown, fila, dependências, mensagens e links de PR.

[Manual de instalação e operação](docs/MANUAL.md)

## Abrir no Windows

1. Instale o Node.js 24 ou superior e mantenha seu GitHub CLI autenticado com acesso aos repositórios.
2. Extraia o pacote, abra `Iniciar-painel.cmd` e acesse [127.0.0.1:47621](http://127.0.0.1:47621). Alternativamente, rode `node server.mjs` na pasta do projeto.
3. Crie um projeto, escolha os papéis e informe o login GitHub usado pelo QA. Cadastre API, web e mobile em **Repositórios**.
4. Indique os arquivos de referência em cada repositório e, se desejar, os nomes exatos dos checks obrigatórios. Sem nomes configurados, o painel exige pelo menos um check publicado e espera todos terminarem com resultado aceito.

Node.js, SQLite embutido e JavaScript de navegador. Os dados ficam em `data/workspace.sqlite`. O painel escuta somente no loopback e confia nos aplicativos locais. `ORQ_PORT` muda a porta e deve ter o mesmo valor no ambiente do painel e na configuração MCP de cada Desktop. `ORQ_DATA_DIR` muda a pasta de dados. Para usar WSL, mantenha o painel, o Node e o `gh` no mesmo ambiente e confirme que o conector Desktop alcança a porta local. Para ambos os Desktops no Windows, o caminho mais simples é executar no Windows.

## Conectar os Desktops

O painel fornece um servidor MCP stdio. Você usa as contas que já tem nos Desktops. O comando MCP inicia apenas o conector em Node, e o painel precisa estar rodando na mesma máquina.

### Codex Desktop

Em **Settings → MCP servers → Add server**, crie `orquestradoria` com transporte STDIO, comando `node` e dois argumentos separados. O primeiro é o caminho absoluto de `mcp.mjs`. O segundo é `codex`. Salve e reinicie a conexão. Use o caminho absoluto de `node.exe` se o aplicativo não localizar o comando no PATH.

[Configuração oficial de MCP no Codex Desktop](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

### Claude Desktop

Em **Settings → Developer → Edit Config**, acrescente a chave `orquestradoria` ao bloco `mcpServers` existente. Mantenha as demais conexões do arquivo. Substitua o caminho pelo local onde extraiu o pacote.

```json
{
  "mcpServers": {
    "orquestradoria": {
      "command": "node",
      "args": ["C:/Projetos/orquestradorIA/mcp.mjs", "claude"]
    }
  }
}
```

Encerre completamente e reabra o Claude Desktop. Confira se as ferramentas aparecem na sessão que vai executar as tarefas. A disponibilidade do MCP local depende da superfície e das permissões da conta. Um agendamento que executa só na nuvem não alcança o localhost deste painel.

[MCP local no Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)

### Chat e agendamentos

Use os comentários do PR para evidências de teste, correções e vereditos. O chat do projeto é uma caixa de entrada de apoio para decisões e handoffs entre repositórios. Inclua os links dos PRs relacionados. Mensagens podem ser endereçadas a um agente e vinculadas a uma tarefa. Use `caixa_de_entrada` e `enviar_mensagem` na sessão do agente. Em **Papéis e contexto**, copie as instruções e cole na sessão ou no agendamento existente de cada Desktop. O agendamento e a janela de execução ficam com o Desktop.

O modelo preferido é um nome de modelo digitado por papel. Em branco, vale o padrão da sessão. O nível de esforço também fica no perfil. O MCP entrega os dois ao agente quando ele reserva uma tarefa. Selecione os valores que a sua conta oferece no Desktop antes de executar. O perfil das tarefas já cadastradas é preservado quando você muda a configuração do projeto.

## Contexto versionado nos repositórios

1. Em **Papéis e contexto → Contexto versionado**, escolha o repositório oficial e o caminho do Markdown na branch `develop`. Você pode apontar para um contrato que já existe.
2. Se ainda precisar criar um documento compartilhado, publique `docs/CONTEXTO-PROJETO.md` na `develop` oficial por PR. Use **Baixar resumo do projeto** para aproveitar o contexto cadastrado no painel.
3. Use **Verificar cópias**. A comparação consulta o arquivo no commit observado da `develop` de cada repositório. A opção **Copiar instruções para os PRs** gera o handoff para o Dev atualizar as cópias ausentes ou divergentes por PR. Reaplique a checagem após os merges.
4. Em cada repositório, referencie esse Markdown no `AGENTS.md` e no `CLAUDE.md` quando aplicável. O MCP entrega o Markdown oficial com origem e SHA, o resumo do painel em `projectContext` e as referências específicas dos repositórios.

Um repositório template do GitHub pode iniciar projetos novos com essa estrutura. Para repositórios existentes, publique o arquivo por PR e use a comparação do painel nas atualizações seguintes. [Templates no GitHub](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template)

Para uma entrega que cruza repositórios, cadastre uma tarefa por repositório e vincule um PR a cada tarefa. Inclua links entre os PRs e registre dependências quando uma mudança precisar estar integrada antes da outra. O QA valida cada SHA e registra o resultado dos testes integrados nos PRs correspondentes.

## Rotina Gitflow

- **PO** lê o contexto e as decisões do chat, registra o plano em Markdown e pode cadastrar tarefas com `criar_tarefa`.
- **Dev** reserva uma tarefa, trabalha em `feature/` ou `bugfix/` com base na `develop`, roda os testes e abre um PR para `develop`. Vincula o número com `vincular_pr` ou pelo painel. Use uma branch estável por tarefa para retomar depois de uma interrupção. O Dev prioriza correções de PRs e pode seguir com tarefas independentes.
- **QA** reserva o PR, revisa o SHA indicado, verifica os testes e usa review formal no GitHub. Se Dev e QA usam a mesma conta, o GitHub impede a aprovação formal do próprio PR. Para um veredito informativo, publique um comentário novo com `QA: APROVADO <sha completo>` ou `QA: CORRIGIR <sha completo>` na primeira linha. O painel aceita o veredito do login configurado para aquela tarefa e invalida o veredito quando muda o SHA. Um comentário não substitui uma aprovação exigida pelo ruleset do GitHub.
- **Dono** faz o merge no GitHub. O painel só libera tarefas dependentes depois de observar o merge validado, com veredito e CI para o commit revisado.

O servidor consulta os PRs vinculados a cada minuto. O botão de sincronização permite antecipar a consulta. O conector pode renovar ou liberar reservas de 45 minutos. Consulte o erro na tarefa se o GitHub ficar indisponível. Os documentos são lidos da `develop` e acompanham o SHA de referência, como dados de contexto. Continue respeitando as instruções do repositório onde o agente trabalha.

## Verificação

Rode `node --test` para verificar o fluxo Gitflow, CI, vereditos e dependências.
