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

## Backend da troca de senha (`feat/auth-senha-propria`)

**Fora do escopo deste PR.** Entregue à sessão dona da transição de auth em 02/10. O front está
pronto e desligado por `SENHA_PROPRIA_HABILITADA = false` em `src/frontend/lib/perfil/senha.ts`.

Contrato que o front espera:
- `GET /me/senha/politica` → `{ minimo, maximo, regras: [{ id, rotulo, padrao? }] }`. Se falhar, o front usa 8 a 72.
- `POST /me/senha { senhaAtual, novaSenha }` → 204, 400 `{ codigo: 'POLITICA', regras: string[] }`, 422
  `SENHA_ATUAL_INVALIDA` (nunca 401), 429 `MUITAS_TENTATIVAS`, 503 `AUTH_INDISPONIVEL`. 5xx nunca desloga.
- Confirmado pela sessão de auth em 02/10 (backend em `feat/auth-senha-propria`, migration 0073, ADR-0059):
  - Os corpos de erro são `{ codigo, error }`; o front lê só `codigo`.
  - Os ids de regra são `tamanho` e `diferente_da_atual`, os mesmos do checklist.
  - O máximo de 72 é contado em **bytes UTF-8**, e o checklist conta igual. O mínimo de 8 é em **caracteres**, como no cadastro e no reset pelo admin.
  - **Quando ligar o formulário:** `SENHA_PROPRIA_HABILITADA = true` entra só no PR que fizer merge por último, e só depois que o backend com `/me/senha` estiver no ar no Render (backend primeiro).
  - Rate limit do GoTrue na verificação da senha atual também vira 429.

Restrições do ADR-0057 que valem para o backend:
- **Ordem de escrita (R6):** a transação trava a linha e grava o bcrypt local; depois o update no GoTrue
  (com a senha em claro, porque o GoTrue ignora `password_hash` no update); depois o commit. Falha no GoTrue = rollback + 503.
- **Senha atual verificada de verdade nos dois modos:** bcrypt no local; no Supabase, login pelo proxy, e a sessão de prova é revogada.
- **Sessões:** "encerrar as outras" usa logout `scope=others` do GoTrue. No modo local o token não tem estado, então não dá para revogar.
- **Trilha:** a CHECK de `app_user_access_event.tipo` só aceita `papel`, `excecao` e `ativo`, então `senha` precisa de
  migration (0073 ou a próxima livre). Gravar `antes`/`depois` = NULL, sem material de senha. O histórico já mostra
  "Senha alterada" quando o tipo vier `senha`.
- **Sem SMTP:** "require reauthentication" do Supabase fica desligado, e a política do GoTrue é alinhada em mínimo 8 e máximo 72 bytes.

## Follow-ups de produto (decisões da entrevista)

- Adicionar `encerrado_em` em `conciliacao_execucao`. Hoje ela é datada por `atualizado_em`, que é uma aproximação.
- Deep link com foco no item. Hoje o link abre a página da frente e o id aparece em texto.
- v2: admin vendo o perfil de outro usuário em `/usuarios/:id`. O service já recebe o usuário alvo.
- v2: "minhas pendências".
