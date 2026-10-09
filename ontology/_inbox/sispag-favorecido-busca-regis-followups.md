# Follow-ups do Regis-Review — sispag-favorecido-busca (2026-10-09)

Run: `docs/regis-review/2026-10-09-1636-favorecido-busca/` (REPORT.md, KANBAN.md). **0 P0, 0 P1**:
nada reentra no loop. Os cards abaixo **não foram implementados** nesta branch.

## P2

- [x] **security-1** — FEITO na busca (2026-10-09): `buildPayeeSearchLimiter`, 30 buscas/min por
      usuário em `POST /busca`, 429 `MUITAS_BUSCAS` (≤ 60 leituras `cmn025`/min por usuário; antes
      ~200/min por IP). Testado no limitador e na montagem da rota. `GET /destino-atual` também,
      30/min por usuário em balde separado (escopo `previa`); 429 na prévia não bloqueia o pedido.
- [ ] **integrability-1** — medir ao vivo a semântica do `#LIKE` do `cmn025` e o formato de
      `pdcDocFederal`; gravar 2+ fixtures reais. Bloqueado: HML recusa o usuário do `.env` (pedir
      credencial HML). Sonda pronta: `src/backend/jobs/probe-cmn025-busca-hml.ts`. Se o documento
      vier sempre num formato, tirar a 2ª leitura de documento.
- [ ] **integrability-2** — logar a contagem de linhas descartadas pelo `pessoaRowSchema` (como o
      `cmnPessoasPix` já faz), sem dado da pessoa.
- [ ] **security-2** — evento de auditoria na prévia do destino (usuário, `pesCod`, modalidade; nunca
      termo nem destino).
- [ ] **deployability-2** — no deploy desta versão, Render antes de Vercel (o diálogo novo chama 2
      rotas novas).
- [ ] **performance-1** — buscar razão social e nome fantasia em paralelo (depois de security-1).
- [ ] **modifiability-1** — uma só regra de classificação do termo (documento / código / texto); hoje
      em `PayeeSearchService` e `ConexosSispagClient.buscarPessoas`.
- [ ] **testability-2** — fake timers no teste do diálogo e caso "várias teclas → 1 busca".
- [ ] **performance-3** (M) — orçamento total da busca (≤ 8 s) e log de duração; hoje timeout 40 s
      por chamada + retry.
- [ ] **modifiability-2** (M) — dividir `ConexosSispagClient.ts` (935), `routes/sispag.ts` (1252) e
      `frontend/lib/sispag.ts` (1721); leituras `cmn025` estão em dois clientes.

## P3

- [ ] **availability-2** — log de duração/resultado da busca e flag para desligá-la sem deploy.
- [ ] **modifiability-3** — constantes 20 / 3 letras / 350 ms em um lugar.
- [ ] **testability-3** (M) — extrair a busca do diálogo (444 LOC) para um hook; testar a guarda da
      sonda HML.
