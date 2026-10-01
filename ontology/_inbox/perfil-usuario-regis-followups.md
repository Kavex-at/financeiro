# perfil-usuario — follow-ups do Regis-Review

Origem: [`docs/regis-review/2026-10-01-1909-perfil-usuario/`](../../docs/regis-review/2026-10-01-1909-perfil-usuario/REPORT.md)
(o detalhe de cada card está no `KANBAN.md`). Score 7,7. Nenhum P0, então nada entrou no loop.
Os cards abaixo **não foram implementados** e ficam aqui para virar ticket.

Também fica de fora o P1 do DesignSystemReviewer, que pede usar o `DateFormatter` de
`@/shared/lib/datetime`. A documentação do design system descreve esse módulo, mas ele não existe
no repositório. Ou se cria o módulo, ou se corrige a documentação.

## P2

| Card | Achado de origem |
|------|------------------|
| availability-1 | Impor `statement_timeout` nas leituras do perfil (inclui fault-tolerance-1) |
| availability-2 | Instrumentar latência e erros de `/me*` |
| deployability-1 | Registrar a 0072 no DEPLOY.md e no `rollbacks/README.md` (inclui fault-tolerance-3) |
| integrability-2 | Fixar o contrato de `POST /me/senha` antes de ligar `SENHA_PROPRIA_HABILITADA` |
| performance-2 | Reduzir a rajada de conexões e consultas no mount de `/perfil` |
| security-1 | Atualizar `next` e as dependências high do frontend (anterior a esta feature) |
| testability-2 | Congelar o relógio em `page.test.tsx` |
| testability-3 | Testes diretos de `lib/api/perfil` e `lib/perfil/senha`, com piso de cobertura por pasta |
| integrability-1 | Schema único e teste de contrato para o perfil entre front e back |
| modifiability-1 | Guarda de paridade de KPI entre o perfil e `metricas_ciclo` no CI |
| modifiability-2 | Quebrar o histórico em fontes por frente |
| modifiability-3 | Decompor as seções e o job com complexidade acima de 15 |
| testability-1 | Testar `AtividadeSection` e `HistoricoSection` isoladamente |

## P3

| Card | Achado de origem |
|------|------------------|
| availability-3 | Degradar o comparativo sem derrubar o período atual (inclui fault-tolerance-2) |
| deployability-2 | Documentar quando usar `CREATE INDEX CONCURRENTLY` em tabelas grandes |
| deployability-3 | Avaliar flag de rollout para páginas novas de UI |
| integrability-3 | Centralizar a base URL da API no frontend |
| performance-1 | Medir `/perfil` sob volume sintético, com a 0072 aplicada em produção |
| performance-3 | Memoizar os agregados de períodos fechados |
| security-2 | Redigir os usernames na saída do job de validação |
| security-3 | Rate limit leve e métrica de 400 em `/me/*` |
| testability-4 | Casos de erro de transporte e teste de propriedade |

## Follow-ups de produto (decisões da entrevista)

- Adicionar `encerrado_em` em `conciliacao_execucao`. Hoje ela é datada por `atualizado_em`, que é uma aproximação.
- Deep link com foco no item. Hoje o link abre a página da frente e o id aparece em texto.
- v2: admin vendo o perfil de outro usuário em `/usuarios/:id`. O service já recebe o usuário alvo.
- v2: "minhas pendências".
