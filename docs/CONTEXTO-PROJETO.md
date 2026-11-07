# Contexto do Orquestrador IA

O projeto reúne Claude Desktop, Codex Desktop e repositórios GitHub independentes em um painel local. O objetivo é compartilhar decisões de produto, contratos e dependências entre back, web e mobile durante a entrega.

## Arquitetura

- O servidor Node.js serve o painel em `127.0.0.1:47621` e guarda projetos, papéis, tarefas, reservas e mensagens em SQLite.
- Os agentes leem o contexto e conversam por um servidor MCP local. Cada Desktop executa as sessões e os agendamentos com sua própria conta.
- O painel usa o GitHub CLI para consultar PRs, reviews, checks e Markdown. O commit e o PR são produzidos no repositório da tarefa.

## Fluxo de entrega

O PO define o trabalho. O Dev parte da `develop` em uma branch `feature/` ou `bugfix/` e abre um PR para `develop`. O QA revisa o SHA do PR, valida os testes e registra o veredito. O dono faz o merge no GitHub. Dependências entre repositórios avançam após um merge validado.

## Contexto compartilhado

Cada projeto pode definir um repositório oficial. O conteúdo deste caminho na `develop` oficial é a referência. Cada repositório participante versiona uma cópia idêntica no mesmo caminho. Atualizações entram por PR, e o painel compara os hashes das cópias para identificar divergências. Mantenha detalhes internos de cada serviço em Markdown separado no próprio repositório.
