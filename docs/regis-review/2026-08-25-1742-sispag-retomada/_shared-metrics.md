# Métricas compartilhadas — 2026-08-25-1742-sispag-retomada

Escopo: delta do `/feature-tweak sispag` (retomada). Branch `fix/sispag-fin015-import-shape`.

## Delta desta feature (vs. o commit anterior ao tweak)
```
 .../domain/client/ConexosSispagClient.test.ts      |  21 +
 src/backend/domain/client/ConexosSispagClient.ts   |  19 +-
 .../domain/client/ConexosSispagWriteClient.test.ts | 104 ++++-
 .../domain/client/ConexosSispagWriteClient.ts      | 126 +++++-
 .../domain/errors/LoteAnteriorCanceladoError.ts    |  34 ++
 src/backend/domain/interface/sispag/Fin015Write.ts |   4 +
 .../domain/service/sispag/RemessaService.test.ts   | 298 ++++++++++++-
 .../domain/service/sispag/RemessaService.ts        | 277 ++++++++++--
 src/backend/jobs/probe-imp021-modalidade.ts        |  87 ++++
 src/backend/jobs/probe-imp021-previsao.ts          |  31 ++
 src/backend/jobs/probe-impacto-antecipacao.ts      | 172 ++++++++
 src/backend/jobs/probe-impacto-narrativa.ts        | 134 ++++++
 .../jobs/probe-impacto-recebimentos-kpis.ts        | 241 +++++++++++
 src/backend/jobs/probe-impacto-sispag-baixas.ts    |  76 ++++
 src/backend/jobs/probe-impacto-sispag-volume.ts    | 104 +++++
 src/backend/jobs/probe-impacto-verificacao.ts      | 111 +++++
 src/backend/jobs/validate-retomada-remessa-v1.ts   | 473 +++++++++++++++++++++
 src/backend/reports/harness-metrics/2026-08.jsonl  |  10 +
 src/backend/routes/sispag.ts                       |   3 +
 src/frontend/app/sispag/components/LoteCard.tsx    |   6 +-
 src/frontend/app/sispag/page.tsx                   |  19 +-
 src/frontend/lib/sispag.ts                         |  29 +-
 src/frontend/reports/harness-metrics/2026-08.jsonl |   1 +
 23 files changed, 2322 insertions(+), 58 deletions(-)
```

## LOC dos arquivos no escopo
```
  9415 total
   870 src/backend/domain/service/sispag/RemessaService.ts
   828 src/backend/domain/service/sispag/RemessaService.test.ts
   629 src/backend/domain/client/ConexosSispagWriteClient.ts
   566 src/backend/domain/repository/sispag/LotePagamentoRepository.ts
   545 src/backend/routes/sispag.ts
   510 src/backend/domain/service/sispag/ConciliacaoRetornoService.test.ts
   506 src/backend/domain/service/sispag/LotePagamentoService.test.ts
   481 src/backend/domain/client/ConexosSispagWriteClient.test.ts
   455 src/backend/domain/service/sispag/ConciliacaoRetornoService.ts
   419 src/backend/domain/client/ConexosSispagClient.ts
   405 src/backend/domain/service/sispag/LotePagamentoService.ts
   401 src/backend/domain/client/ConexosSispagRetornoClient.ts
   356 src/backend/domain/service/sispag/SispagPainelService.ts
   317 src/backend/domain/service/sispag/SispagPainelService.test.ts
   214 src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts
   204 src/backend/domain/client/ConexosSispagClient.test.ts
   183 src/backend/domain/repository/sispag/LotePagamentoRepository.test.ts
   176 src/backend/domain/client/ConexosSispagRetornoClient.test.ts
   171 src/backend/domain/repository/sispag/RemessaExecucaoRepository.test.ts
   169 src/backend/domain/repository/sispag/TituloAPagarRepository.ts
   168 src/backend/domain/repository/sispag/ConciliacaoExecucaoRepository.ts
```

## Frontend no escopo
```
 2439 total
 1026 src/frontend/app/sispag/page.tsx
  587 src/frontend/lib/sispag.ts
  499 src/frontend/app/sispag/components/LoteCard.tsx
  171 src/frontend/app/sispag/components/AdicionarTituloDialog.tsx
  156 src/frontend/app/sispag/components/IngestaoDialog.tsx
```

## Testes
```
backend suites: 267
frontend suites: 211
backend: 109 suites / 1454 testes (verde, com .env presente)
frontend: 25 suites / 189 testes (verde)
```

## Gates executados
- typecheck backend/frontend: limpos
- biome: limpo nos arquivos tocados
- **Ground-Truth AO VIVO (HML)**: os 3 cenarios de retomada verdes; caminho normal com lote de 2 titulos gerou `PG2508009002.R1EM` e o download manteve 1 byte/char (latin1).
- NAO exercitada ao vivo nesta bateria: a perna de VOLTA (conciliacao do .RET).

## Defeitos de producao achados pelo gate ao vivo (ja corrigidos)
1. `importar` aceita UM item por chamada — lote com 2+ titulos falhava no caminho normal
2. `flpCod` nao e monotonico — marca d'agua virou conjunto
3. `fin015/list` sem `filCod#EQ` — contaminava a marca d'agua e rotulava lote alheio no painel
4. chave do item sem filial — `docCod` se repete entre filiais; importaria pagamento de outro fornecedor
5. `titulosCount` nao conta itens (vale 1 para qualquer lote nao-vazio)
6. download do `.REM` recodificava o CNAB para UTF-8 (Express reescreve charset em `res.send(string)`)

---

## VERIFICAÇÃO DO ORQUESTRADOR — escopo de filial por endpoint (medido AO VIVO em HML, 2026-08-25)

O agente de Integrability levantou como **P0** que `fin005/list` (contas pagadoras) vazaria contas de
outras filiais, e como **P1** que o mesmo valeria para outros 10 endpoints — generalizando a partir
do defeito comprovado do `fin015/list`. **Medi endpoint a endpoint. A generalização não se sustenta.**

| Endpoint | Linhas | Filiais retornadas | Veredito |
|---|---|---|---|
| `fin015/list` | 117 | 2:52 · 1:58 · 7:6 · 3:1 | **VAZA** — exige `filCod#EQ` |
| `fin005/list` | 17 | 2:17 | escopado pelo contexto |
| `fin064/list` | 300 | 2:300 | escopado pelo contexto |
| `fin050/list` | 300 | linhas sem `filCod` | N/A — códigos de evento são globais |
| `ger015/list` | 4 | linhas sem `filCod` | N/A — config de layout é global |

**Conclusão:** o `fin015/list` é a EXCEÇÃO. O comportamento é por-endpoint e não se infere de um
para o outro — o que é, ironicamente, o mesmo erro de generalização que produziu os defeitos que
esta feature corrigiu.

- **F-integrability-3 (P0) → REFUTADO.** `fin005/list` escopa; `contas[0]` não pega conta de outra filial.
- **F-integrability-2 (P1) → REBAIXADO.** A preocupação é legítima como *dívida de verificação*
  (ninguém mediu os endpoints restantes), não como defeito. O card deve ser "medir os endpoints que
  faltam", não "adicionar `filCod#EQ` em 10 lugares" — adicionar filtro onde o ERP já escopa é ruído.

## VERIFICAÇÃO DO ORQUESTRADOR — outros achados conferidos

| Achado | Fonte | Veredito |
|---|---|---|
| Reaper não agendado no `render.yaml` | availability, fault-tolerance | **CONFIRMADO** — `grep cron render.yaml` vazio |
| `RemessaService` sem advisory lock (corrida → 2 lotes) | fault-tolerance | **CONFIRMADO** — `withAdvisoryLock` existe e é usado por `IngestaoPagamentosService`; `RemessaService` não tem nenhum |
| `listarLotesNativos` lê só a 1ª página | fault-tolerance | **CONFIRMADO** — `pageNumber: 1, pageSize: 500`, sem aviso de truncamento |
| `ConciliacaoEmDuvidaError` sem tratamento no FE | availability | **CONFIRMADO** — 0 ocorrências em `src/frontend` |
| Copy diz `CONEXOS_DRY_RUN` mas a causa é `SISPAG_LIVE_WRITE_ENABLED` | deployability | **CONFIRMADO** — `LoteCard.tsx:228` |
| Timeout de 40s por chamada ao Conexos | performance | **CONFIRMADO** — `services/conexos.ts:121` |
| Sem keep-alive no axios do Conexos | performance | **CONFIRMADO** — nenhum `httpAgent`/`keepAlive` nos clients |
| `heavyRouteLimiter` em 4 de 18 rotas | performance | **CONFIRMADO** |
| CNAB indo para o log da aplicação | security | **PARCIALMENTE REFUTADO** — o corpo da resposta só é logado em status ≥ 400 (`index.ts:63`); o `.REM` de um sucesso não é logado. Resta a duplicação de superfície (o POST devolve `conteudo` no JSON), que é P2 |
| `notify()` / `NotificationCenter` / "Patterns §21" | design-system | **REFUTADO** — não existem neste repositório; 2 findings descartados |
| LOC: RemessaService 870, Conciliacao 455, page.tsx 1026 | modifiability | **CONFIRMADO** |
