# Regis-Review — `sispag-boletos-dda` (PR #85, v0.42.0)

> **Execução reduzida, por pedido explícito do usuário (2026-09-24):** só os QAs que a mudança
> afeta — **Security, Integrability, Performance**. Availability, Deployability, Modifiability,
> Fault Tolerance e Testability **não rodaram**. Consolidação feita pelo orquestrador (sem o agente
> `qa-consolidator`). Métricas compartilhadas: `_shared-metrics.md`.

## Veredito do gate

**Passa — 0 P0.** Nenhum achado bloqueia o merge. P1/P2/P3 viram follow-ups em
`ontology/_inbox/sispag-boletos-dda-regis-followups.md` (não implementados nesta entrega).

## Placar

| QA | Nota | P0 | P1 | P2 | P3 | Seção |
|---|---|---|---|---|---|---|
| Security | **8** | 0 | 0 | 2 | 2 | [security.md](security.md) |
| Integrability | **8** | 0 | 0 | 4 | 0 | [integrability.md](integrability.md) |
| Performance | **7** | 0 | 1 | 3 | 2 | [performance.md](performance.md) |
| **Total** | — | **0** | **1** | **9** | **4** | 14 cards (13 após dedup) |

## O que a entrega acerta (confirmado com evidência pelos três QAs)

- **Somente leitura no ERP, de fato.** O `ConexosDdaClient` só expõe `fin124/list` e
  `fin124/itens/list`; `importar`/`cancelar` não estão ligados.
- **Acesso:** as duas rotas novas exigem `admin` (mesmo guard das linhas digitáveis do lote); a de
  sincronização tem `heavyRouteLimiter` e advisory lock próprio.
- **Fronteiras:** Zod na query HTTP e nos dois contratos do `fin124`; linha inválida é descartada,
  nunca coagida a 0 (bug pego por teste durante a implementação).
- **SQL 100% parametrizado**; nenhum `codbar`/linha digitável em log.
- **Custo:** consolidação pura O(N + M + N·k), pior k observado = 19; sync com concorrência 3 e
  transação por arquivo; execução real sem falha (162 arquivos / 24.137 boletos).

## Riscos principais

1. **"Todos" entrega o pool inteiro ao navegador** — *performance-1 (P1) + security-2 (P2), mesmo
   conserto.* 24.137 linhas com código de barras e linha digitável num único GET: estimado ~8,5 MB
   sem compressão (~2 MB com gzip). Local mede 393 ms, mas o custo real é a rede, e o pool cresce
   ~um arquivo por dia útil. Pela ótica de segurança, qualquer token admin baixa todo o pool DDA do
   pagador — 96,6% dele (`SEM_TITULO`) nem é da carteira. **Mitigação sugerida:** paginar e filtrar no
   servidor quando o escopo é "todos" (o padrão "a vencer", 1.665 linhas, pode continuar no cliente).
2. **Sincronização sem trilha persistida** — *security-1 (P2).* Hoje só `LogService.info`. As outras
   ingestões gravam run em tabela e expõem `GET …/runs`. Para "quem sincronizou e quando", hoje é
   grep de stdout.
3. **Truncamento silencioso na paginação do fin124** — *integrability-1/3 (P2).* O client reimplementa
   a paginação do `ConexosBaseClient.paginate` e não sinaliza quando bate o teto (60 mil linhas; pool
   hoje 24.137). Reusar o `paginate` resolve os dois.
4. **Sessões do usuário Conexos compartilhado** — *integrability-4 (P2).* Toda sessão nova medida
   recebeu `LOGIN_ERROR_MAX_SESSIONS`; o job e o botão adicionam pressão. Pré-existente, agravado.
5. **Tipos espelhados à mão entre back e front** — *integrability-2 (P2).* ~85 linhas novas em
   `lib/sispag.ts`; o nome já diverge (`BoletoDdaConsolidado` × `BoletoDda`). Sistêmico no repo.

## Observação sobre a migração `0062`

A v0.41.0 publicou `0062_titulo_retencao_formacao.sql`, removido depois; este PR traz
`0062_boleto_dda.sql`. O `MigrationRunner` rastreia pelo **nome completo**, então os dois aplicam sem
conflito. É só rastreabilidade (número repetido no histórico), não risco de deploy.

## Próxima ação

Merge liberado pelo gate. Recomendação: tratar **performance-1 / security-2** (paginação de "todos")
como o primeiro follow-up, antes de o pool dobrar; os demais P2 entram no backlog normal.
