# Regis-Review — follow-ups de `sispag-data-pagamento`

Executado em 2026-09-22 sobre o delta da branch `fix/sispag-data-pagamento` (ADR-0049), escopo
restrito aos arquivos tocados, `--quick`, 8 QAs + consolidador. Relatório:
`docs/regis-review/2026-09-22-2020-sispag-data-pagamento/REPORT.md` e `KANBAN.md`.

**Score geral 7,8/10** — Availability 8 · Deployability 8 · Integrability 7 · Modifiability 6,5 ·
Performance 8 · Fault Tolerance 8,5 · Security 8 · Testability 8.

**Nenhum P0.** Nada foi remediado neste ciclo; tudo abaixo é follow-up e **não** foi implementado.
22 cards (2 P1 / 10 P2 / 10 P3), já deduplicados pelo consolidador (`integrability-2` absorvido por
`modifiability-1`).

## P1

### P1 — `testability-2` — Teste de integração para o round-trip de `data_debito`
`setDataDebito` (`$dataDebito::date`) e a leitura `to_char(data_debito, 'YYYY-MM-DD')` só são
testados por mock (casamento de string SQL). É justamente a classe de bug de data/fuso que a
ADR-0049 corrigiu. **Correção ao card:** o finding diz que não existe infra de Postgres de teste;
existe — `npm run test:sql` roda `migrations/*.integration.test.ts` contra Postgres real
(`vwMetricasCiclo.integration.test.ts`). O card deve reusar essa trilha. Esforço M → provavelmente S.

### P1 — `modifiability-1` — Extrair um orquestrador fino da escrita no fin015
`RemessaService.gerarRemessaSerializado` tem complexidade cognitiva 91 (teto do Biome: 15) e o
arquivo foi de 1028 para 1111 LOC. A regra nova foi para o `DebitDateService`, mas os dois pontos de
chamada entraram na função já grande. Absorve `integrability-2` (10 colaboradores, 3 Clients).
Esforço L — função crítica que escreve remessa real, pede regressão cuidadosa.

## P2

- **`availability-2`** — logar/instrumentar `data_debito` persistido sem `native_flp_cod` (queda
  entre `setDataDebito` e `criarLote`; a próxima tentativa recalcula sem log). S.
- **`deployability-1`** — cohort de validação (reusar `dryRunOverride`) antes de liberar a data
  escolhida para todas as filiais; hoje o deploy é 100% de uma vez (`autoDeploy: true`). S.
- **`integrability-1`** — validar com Zod no frontend as respostas de `/remessa/janela` e `/remessa`
  (hoje `body as T`). S.
- **`modifiability-3`** — compartilhar/gerar os tipos e enums do contrato SISPAG entre backend e
  frontend (`details.motivo` é `string` solto no frontend). S/M.
- **`testability-1`** — testar a fiação LoteCard → GerarRemessaDialog → toasts do `page.tsx`. S.
- **`testability-3`** — quebrar `RemessaService.test.ts` (1452 LOC) por responsabilidade. S.
- **`fault-tolerance-1`** — retomada de `status='error'` sem `nativeFlpCod` pula a checagem de órfão
  por marca d'água (pré-existente, ADR-0039); com a data nova, a 2ª tentativa sobrescreve o rastro
  local sem religar a um possível lote fantasma vazio. M.
- **`security-1`** — RBAC é no-op em produção (`app_user.role DEFAULT 'admin'`); a escolha de data
  herda isso numa escrita que move dinheiro. Pré-existente. M.
- **`modifiability-2`** — `routes/sispag.ts` importa repository/client direto (layer-skip,
  pré-existente). M.

## P3

- **`availability-3`** / **`security-2`** — alinhar `GET /lotes/:id/remessa/janela` ao padrão das
  rotas com dado de fornecedor (`requireRole('admin')`, rate limit). O mesmo dado já sai em
  `GET /lotes/:id`, então não é exposição nova. S.
- **`availability-4`** — retry com backoff no fetch da janela (frontend). S.
- **`deployability-2`** — separar o kill-switch do fin015 (remessa) do fin052 (conciliação). S.
- **`integrability-3`** — fixture real do fin015 para `RemessaService`/`DebitDateService`. M.
- **`modifiability-4`** — `ontology/_index.json` ainda marca `LotePagamento` como `planned` com 14
  `impl_files` (drift pré-existente; tratar no `/retro-ontology`). S.
- **`performance-1`** — memoizar `BankingCalendar.holidays(year)` por ano. S.
- **`performance-2`** — teto explícito de dias na janela e validação da distância do vencimento na
  inclusão manual. S.
- **`fault-tolerance-2`** — teste espelho do mismatch de `dataDebito` no candidato a órfão. S.
- **`fault-tolerance-3`** — `setDataDebito` + `setRequestPayload` numa transação. S.

## Fora do Regis, mas pendente desta feature

- `jobs/preflight-fin015-prd.ts` e `jobs/validate-fin015-import.ts` ainda têm `hojeUtc()` local
  (meia-noite UTC) — fora do escopo da Task 10.
- Verificação ao vivo em HML (Task 11) — roteiro no corpo do PR, não executada.
- Feriados municipais/estaduais e 31/12 — pergunta P1 em `sispag-data-pagamento-gap.md`.
