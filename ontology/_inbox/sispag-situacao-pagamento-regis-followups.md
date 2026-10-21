# sispag-situacao-pagamento — follow-ups do Regis-Review

**Run:** `2026-10-21-1458-sispag-situacao-pagamento`
**Relatório:** `docs/regis-review/2026-10-21-1458-sispag-situacao-pagamento/REPORT.md`
**Kanban:** `docs/regis-review/2026-10-21-1458-sispag-situacao-pagamento/KANBAN.md`
**Branch:** `worktree-sispag-situacao-pagamento` · HEAD `737d010` · PR `#128` · ADR-0075

Score consolidado **8.0** (ponderado nos 3 QAs rodados). 20 cards: P0=0 · P1=4 · P2=11 · P3=5.
**Review reduzido por desenho** — 3 de 8 QAs rodados (testability, modifiability, fault-tolerance). Os cinco não rodados (availability, deployability, integrability, performance, security) não foram medidos nesta rodada e não implicam ausência de dívida nesses eixos; o CLAUDE.md manda rodá-los quando um PR tocar os artefatos correspondentes.
Por Inviolable Rule #11, como **não há P0**, nenhum card re-entrou no loop deste PR. Todos os 20 estão aqui.

## P0 — status

_Nenhum card P0 nesta rodada. Rule #11 não dispara re-loop._

## P1 (4) — não implementados

| Card | QA | Esforço | Uma linha |
|---|---|---|---|
| `testability-1` | Testability | S | Guarda de host + `--allow-production-migrations` + 2 testes no `validate-situacao-pagamento-v1.ts`; fecha a porta por onde `0089` entrou em PRD em 20/10/2026 |
| `testability-2` | Testability | S | Gravar 3 fixtures reais do `com298/list` + teste contra fixture; `tipoDocumentoRowSchema` ainda nunca foi exercido contra bytes do Conexos |
| `fault-tolerance-1` | FT + Testability | S (opção A) / M (opção B) | `exigirSituacaoPagavel` com título fora da carteira persistida pula ADR-0075 (exposição: títulos criados no Conexos depois da última ingestão; não medida); fail-closed OU contexto ao vivo. **Re-checado em `LotePagamentoService.ts:332-348`; não é regressão vs `main` (main também não bloqueava permuta/forma na inclusão); mantido P1 pelo leverage da regra única** |
| `fault-tolerance-2` | FT + Testability | S | Propagar `fontesIndisponiveis` para `CriarLotesPorFilialResult` + política fail-closed p/ fontes críticas (duplicidade, boleto DDA); hoje o lote entra verde mesmo com fonte caída |

## P2 (11) — não implementados

| Card | QA | Esforço | Uma linha |
|---|---|---|---|
| `testability-3` | Testability + FT | S | 1 WARN + 1 asserção quando `avaliarVivo` cai em `null`; caminho morto deixa de ser invisível |
| `testability-4` | Testability | S | `AjusteCentavosExecucaoRepository.test.ts` com 3 casos (último ledger, sem ledger, vazio); SQL do método I19h ainda sem teste próprio |
| `testability-5` | Testability | M | `TabelaTitulos.test.tsx` focado (5–8 casos): hoje o componente só é exercitado via `TitulosAbaSituacao.test.tsx` (29 casos integrados) |
| `modifiability-1` | Modif + Integr | S | Teste de paridade dos rótulos BE (`PERFIL[m].rotulo`) × FE (`ROTULO_MOTIVO[m]`); 3/9 pares divergentes hoje |
| `modifiability-2` | Modif | S | Unificar `HORIZONTE_DIAS=7` (BE) / `JANELA_FORMACAO_DIAS=7` (FE) via `GET /sispag/painel` ou `SispagInterface` + paridade |
| `modifiability-3` | Modif | M | Planejar split do `LotePagamentoService` (832 LOC, 11 deps) em `LoteLifecycleService` / `LoteItemService` / `LoteQueryService` antes do próximo endpoint de lote |
| `modifiability-4` | Modif | S | Cabeçalhos de coluna de `TabelaTitulos.tsx` em array declarativo; 427 LOC → ≤ 300 LOC |
| `fault-tolerance-3` | FT | S | `Idempotency-Key` em `POST /sispag/lotes/por-filial` — único endpoint SISPAG criador de agregado sem; replay com `mover: true` cancela os lotes anteriores |
| `fault-tolerance-4` | FT | S (≤1h) | `cancelarSeVazio(...).catch(e => warn(...))` no lugar de `.catch(() => false)`; falha de descarte deixa de ser invisível |
| `fault-tolerance-5` | FT | S (≤1h) | 1 `BUSINESS_INFO` agregado por chamada de `criarLotesPorFilial` (ator, títulos pedidos, lotes criados, recusados); hoje só há log por lote/por título |
| `fault-tolerance-6` | FT | M | Promover `validate-situacao-pagamento-v1.ts` a job de reconciliação diário com alerta quando `semSituacao > 0`, `somaMotivos ≠ bloqueados` ou drift > 1% |

## P3 (5) — não implementados

| Card | QA | Esforço | Uma linha |
|---|---|---|---|
| `testability-6` | Testability | S | Property-based test (fast-check) para `∑ porMotivo = porEstado.BLOQUEADO`; hoje 2 exemplos → 100 carteiras aleatórias/run |
| `modifiability-5` | Modif | S | Encapsular as 4 fontes do `SituacaoPagamentoService` em `SituacaoContextoLoader`; 8 deps → 5 |
| `modifiability-6` | Modif | S (≤1h) | `chaveTitulo({filCod, docCod, titCod})` como util em `SispagInterface` + mirror FE; 5 cópias → 2 |
| `modifiability-7` | Modif | M | Externalizar `HORIZONTE_DIAS`, `FORMACAO_LOCK_KEY`, `EFEITO_MOTIVO`, `ORIENTACAO_NO_CONEXOS` para `GET /sispag/recursos`; compor com `modifiability-2` |
| `fault-tolerance-7` | FT | S | Separar `INFRA_ERROR` (pg code, timeout) de `FLOW_ERROR` (bug) no `SispagPainelService.avaliarSituacao`; hoje é 1 tipo só |

## Cross-cutting (consolidados no REPORT.md)

Resumo dos quatro cross-cutting findings, cada um já apontando os cards que resolvem:

- **CC-1 — Observabilidade do caminho degradado é silenciosa.** `testability-3` + `fault-tolerance-2` + `fault-tolerance-4` + `fault-tolerance-5` + `fault-tolerance-7`. Pode virar 1 PR único de instrumentação.
- **CC-2 — Fail-open implícito na escrita quando a fonte autoritativa falha.** `fault-tolerance-1` + `fault-tolerance-2`. Precisa de ADR complementar (ou extensão da ADR-0075) classificando fontes como "crítica" vs "acessória".
- **CC-3 — Paridade/duplicação BE↔FE em contrato de UI.** `modifiability-1` + `modifiability-2` + `modifiability-6` + `modifiability-7`. Alvo: `GET /sispag/painel` carregar janela/rótulos + teste de paridade de rótulos.
- **CC-4 — Hotspot `LotePagamentoService` encosta no teto operacional.** `modifiability-3` + `modifiability-5`. Pré-requisito do próximo endpoint SISPAG (lote-por-prioridade, lote-por-credor).

## Correções de premissa aplicadas na consolidação

Registradas porque as seções individuais dos agents mantêm os textos originais:

1. **C1** — F-fault-tolerance-1 foi re-checada em código pelo orquestrador (`LotePagamentoService.ts:332-348`: `avaliarVivo` null ⇒ no block). Confirmado que afeta somente títulos ausentes da carteira persistida, é escolha documentada, e **NÃO é regressão vs `main`** (main também não bloqueava permuta nem forma-não-SISPAG na inclusão manual). Prioridade mantida em P1 pelo leverage de fechar a camada de defesa que a ADR-0075 vendeu e pelo esforço baixo (S na opção A). Nota incorporada ao card `fault-tolerance-1` e ao R-1 do REPORT.
2. **C2** — Review reduzido por desenho. Cinco QAs (availability, deployability, integrability, performance, security) **não foram executados** nesta rodada por escolha de escopo, não por ausência de dados; isso está explicitado na §0 do REPORT.md e aqui no cabeçalho. Reviews futuros devem cobrir esses eixos quando um PR tocar os artefatos correspondentes.

## QAs não rodados nesta rodada

- `availability` — não rodado (feature não altera job de ingestão nem endpoint monetário).
- `deployability` — não rodado (sem mudança de pipeline, Render hook, Terraform ou SSM).
- `integrability` — não rodado (nenhum contrato novo com o Conexos; `com298/list` já existia; paridade FE↔BE coberta em Modifiability).
- `performance` — não rodado (sem endpoint de alta carga; `/sispag/painel` tem benchmark em PRs anteriores).
- `security` — não rodado (nenhuma mudança em AuthZ/AuthN; só uso de `SISPAG_EXECUTAR` existente).
