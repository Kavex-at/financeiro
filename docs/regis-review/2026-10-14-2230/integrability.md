---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-14-2230
agent: qa-integrability
generated_at: 2026-10-14T23:30:00-03:00
scope: backend
score: 7.5
findings_count: 5
cards_count: 4
---

# Integrability — Regis-Review

> Escopo reduzido: delta `git diff origin/main HEAD` (tweak `sispag-passo2-vinculo-codbar`, ADR-0071), foco nos novos endpoints Conexos. Nenhum P0: toda premissa de integração que poderia pagar errado em silêncio está coberta por observação na releitura (I17e) e pela flag `off` por padrão.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Conexos (ERP) / time Conexos | PRD difere do HML, ou o ERP muda campo/validação de `fin015/finItemSispag` (`validacao/codigoBarras`, `confirmaCodigoBarras`, `PUT`) | `ConexosSispagWriteClient`, `ConexosSispagClient.lerTotalAberto`, `VinculoCodigoBarrasService` | `SISPAG_BIND_CODBAR_FILIAIS=on` em PRD, execução serial sob lock de lote | Resposta fora do contrato vira erro tipado e determinístico (retirada I16d) ou abort/retomada; nunca barra vinculada sem observação na releitura; mudança detectável antes do pagamento | 0 vínculos sem releitura confirmatória; 100% das respostas validadas por Zod; desvio HML×PRD detectado em < 1 execução (sonda) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Endpoints novos com resposta validada por Zod | 3 de 3 (validacao, confirma, fin064 totalAberto); `PUT` sem corpo lido por design | 100% | ✅ | `ConexosSispagWriteClient.ts` `VALIDACAO_CODBAR_SCHEMA`, `CONFIRMA_CODBAR_SCHEMA`; `ConexosSispagClient.ts` `totalAbertoRowSchema` |
| Escritas novas em tentativa única (sem retry cego / 401-retry) | 3 de 3 (`postGenericOnce` x2, `putGenericOnce` x1) | 100% | ✅ | `ConexosSispagWriteClient.ts` `validarCodigoBarras`, `confirmarCodigoBarras`, `editarItemDoRascunho` |
| Métodos genéricos (get/post/request) vazados nos clients tocados | 0 | 0 | ✅ | métodos públicos novos são de domínio (`lerItensDoRascunho`, `editarItemDoRascunho`...) |
| Pontos de código de barras sanitizado em erro/log (`\d{20,}` → `…`) | 3 de 3 chamadas de rede passam por `causaSegura` | 100% | ✅ | `ConexosSispagWriteClient.ts` `causaSegura` |
| Endpoints novos com contrato confirmado em PRD | 0 de 3 (HML apenas; V6, V-PRD1, V-PRD2 abertos) | 3 de 3 antes de `on` | ⚠️ | `ontology/_inbox/sispag-passo2-vinculo-codbar-hml-achados.md` §1, §3 |
| Fixtures gravadas dos endpoints novos | 1 arquivo (amostra única 2026-10-14) | ≥1 por endpoint, datada | ✅ | `src/backend/domain/client/__fixtures__/2026-10-14-fin015-vinculo-codbar.json`, usado em `ConexosSispagWriteClient.vinculo.test.ts:7` |
| Detecção automática de drift de contrato em runtime | 0 (só sonda manual `probe-hml-vinculo-codbar-v1.ts`, não agendada) | ≥1 verificação periódica | ❌ | `src/backend/jobs/probe-hml-vinculo-codbar-v1.ts` (sem scheduler no repo) |
| Versão do contrato explícita na URL/header | 0 (Conexos não expõe versão) | N/A | ⚠️ | paths literais em `ConexosSispagWriteClient.ts` |
| Taxa de erro por dependência / endpoint (observabilidade) | ⚠️ **Não medível localmente**: requer logs/métricas de PRD. Existe evento de trilha `VINCULO_APLICADO`/`VINCULO_FALHOU` (migration 0086) | contador por endpoint | ⚠️ | recomendação: card integrability-3 |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Toda chamada ERP nova dentro de `ConexosSispagWriteClient`/`ConexosSispagClient`; o serviço nunca vê HTTP; tipos em `interface/sispag/Fin015Write.ts` | ✅ presente | `ConexosSispagWriteClient.ts` (métodos `validarCodigoBarras`, `confirmarCodigoBarras`, `editarItemDoRascunho`) |
| Use an Intermediary | `ConexosBaseClient` (sessão, `postGenericOnce`/`putGenericOnce`) entre os clients e o legado | ✅ presente | `ConexosBaseClient.ts:183-194` |
| Restrict Communication Paths | Só `ConexosSispagWriteClient` escreve em `fin015/finItemSispag`; serviço único (`VinculoCodigoBarrasService`) o chama; flag fail-closed por filial | ✅ presente | `VinculoCodigoBarrasService.ts` |
| Adhere to Standards | Dependência de DTO proprietário do Conexos (`FinItemCodigoBarrasDTO`), sem padrão externo | ⚠️ parcial | `corpoCodigoBarras` |
| Abstract Common Services | `lerLinhasDoRascunho` extraído (antes duplicava a paginação); `sanearTexto`/`causaSegura` locais ao WriteClient | ✅ presente | `ConexosSispagWriteClient.ts` `lerLinhasDoRascunho` |
| Discover Service | URL/credenciais Conexos via `EnvironmentProvider`/base client; nada novo | ✅ presente (herdado) | `ConexosBaseClient` |
| Tailor Interface | `validacao`→`confirma` encapsulados atrás de tipos `ValidacaoCodigoBarras`/`ConfirmacaoCodigoBarras`; `splitCodBar` opaco repassado | ✅ presente | `ConexosSispagWriteClient.ts` |
| Configure Behavior | `SISPAG_BIND_CODBAR_FILIAIS` off/shadow/on + kill-switch; modalidade 6/7 derivada do banco do lote | ✅ presente | ontologia I17; `MODALIDADE_ITEM` em `VinculoCodigoBarrasService.ts:92` |
| Manage Resources | `maxPaginas=40` com `completa=false` → aborta, nunca assume ausência | ✅ presente | `lerLinhasDoRascunho`, `RascunhoLeituraIncompletaError` |
| Orchestrate | Fluxo linear síncrono lista→valida→confirma→PUT→releitura sob lock de lote; retomável | ✅ presente | `VinculoCodigoBarrasService.ts` |
| Manage Resource Coupling | Acoplamento ao formato do item do ERP: o `PUT` reenvia a row inteira lida | ⚠️ parcial | F-integrability-3 |
| Contract testing (schema-pinned) | Fixture HML única + testes de client; sem checagem contra o ERP vivo agendada | ⚠️ parcial | F-integrability-1 |
| Versioning strategy | Conexos sem versão; estratégia = medir HML/sonda e fail-closed | ⚠️ parcial | F-integrability-1 |
| Backward-compat shims | `bancoLote` ausente mantém modalidade da linha ("compat.") — shim com `\|\| 6` | ⚠️ parcial | F-integrability-4 |
| Observability of integration failures | Trilha por item (evento + `recusaDeNegocio`); sem contador por endpoint | ⚠️ parcial | F-integrability-5 |

## 4. Findings

### F-integrability-1: Contrato dos três endpoints medido só em HML; sem detector de drift HML→PRD nem de mudança futura do ERP

- **Severidade**: P1
- **Tactic violada**: Contract testing / Versioning strategy
- **Localização**: `ontology/_inbox/sispag-passo2-vinculo-codbar-hml-achados.md:29,51` (V6, V-PRD1/V-PRD2 abertos); `src/backend/jobs/probe-hml-vinculo-codbar-v1.ts`; `src/backend/domain/client/__fixtures__/2026-10-14-fin015-vinculo-codbar.json`
- **Evidência (objetiva)**:
  ```
  V6: "NÃO OBSERVÁVEL em HML ... Segue aberto (V-PRD)."
  V4: modalidade 7 exigida para banco != banco do lote (HML) - nunca visto em PRD
  fixture: 1 arquivo, 1 data, 0 execuções em PRD
  ```
- **Impacto técnico**: um 200 em PRD com semântica diferente (ex.: `PUT` aceito sem persistir, modalidade extra) só é pego pela releitura do vínculo seguinte; não há alerta de "contrato mudou". A releitura (I17e) garante que NÃO se paga barra errada em silêncio, mas converte drift em onda de retiradas/aborts.
- **Impacto de negócio**: mudança do ERP derruba o vínculo (itens retirados do lote) sem causa visível; reexposição do boleto no pool (V6) pode gerar pagamento em duplicidade, mitigado hoje só por `on` estar gated em V-PRD.
- **Métrica de baseline**: 0/3 endpoints confirmados em PRD; 0 verificações agendadas de contrato.

### F-integrability-2: Campos não documentados dependem de inferência (`itsVldModalidade`, `splitCodBar`, `barraDtaVencimento`)

- **Severidade**: P2
- **Tactic violada**: Tailor Interface / Adhere to Standards
- **Localização**: `ConexosSispagWriteClient.ts` (`VALIDACAO_CODBAR_SCHEMA`: `splitCodBar: z.unknown()`; `corpoCodigoBarras`); `VinculoCodigoBarrasService.ts:452-456`
- **Evidência (objetiva)**:
  ```
  splitCodBar: z.unknown().refine(v => v !== undefined && v !== null)
  Number(nativo.row.itsVldModalidade) || MODALIDADE_ITEM.MESMO_BANCO
  ```
- **Impacto técnico**: `splitCodBar` é repassado opaco (aceita qualquer forma, inclusive string vazia ou lista vazia). Modalidade só conhece 6 e 7; qualquer outra (ex.: de item pré-existente) cai em 6 por `|| 6`. Em ambos os casos o erro surge como recusa do ERP ou divergência na releitura, não como erro de contrato local.
- **Impacto de negócio**: recusas determinísticas inexplicadas viram retirada do item do lote (retrabalho do analista), não pagamento errado.
- **Métrica de baseline**: 2 campos sem schema estrito; modalidades modeladas: 2.

### F-integrability-3: `PUT` reenvia a row inteira do ERP (`...item`) — campos não documentados fazem round-trip

- **Severidade**: P2
- **Tactic violada**: Manage Resource Coupling
- **Localização**: `ConexosSispagWriteClient.ts` `editarItemDoRascunho` (spread `...item` + 5 campos, 6º condicional)
- **Evidência (objetiva)**:
  ```
  { ...item, itsNumCodbar, itsNumBanco, bncDesNome, itsMnyVlrPgto, itsDtaPgto, ...(itsVldModalidade?) }
  ```
- **Impacto técnico**: o ERP não tem lock otimista (V3), então a row lida é o contrato do PUT: qualquer campo novo/derivado que o Conexos passe a devolver será regravado sem que o cliente o conheça. TOCTOU residual documentado (janela de ms; releitura detecta). Padrão correto dado o ERP; o custo é acoplamento ao shape completo.
- **Impacto de negócio**: baixo; risco concentrado em upgrade de versão do ERP.
- **Métrica de baseline**: 5-6 campos alterados de ~N campos reenviados (N não medido).

### F-integrability-4: Shim de compatibilidade `bancoLote` ausente → modalidade da linha

- **Severidade**: P3
- **Tactic violada**: Backward-compat shims (custo)
- **Localização**: `VinculoCodigoBarrasService.ts:452-456`
- **Evidência (objetiva)**: "Sem `bancoLote`, mantém a da linha (compat.)" (`hml-achados.md` §2.1)
- **Impacto técnico**: caminho que reintroduz o defeito V4 (barra de outro banco com modalidade 6 → `TITULO_NAO_PERTENCE_AO_BANCO_EM_USO`) se algum chamador omitir `bancoLote`. Falha fechada (recusa do ERP), não mis-pay.
- **Impacto de negócio**: retiradas desnecessárias.
- **Métrica de baseline**: 1 shim; chamadores sem `bancoLote`: não medido.

### F-integrability-5: Sem observabilidade agregada por endpoint do Conexos para o vínculo

- **Severidade**: P2
- **Tactic violada**: Observability of integration failures
- **Localização**: `VinculoCodigoBarrasService.ts:471,492,558` (classificação `ehRecusaDeNegocio`); migration `0086`
- **Evidência (objetiva)**: classificação negócio×transitório via `ConexosError.code === 'CONEXOS_UPSTREAM_REJECTED'` (linha 821-823); eventos por item, sem contador por endpoint/código de erro.
- **Impacto técnico**: não dá para ver "validacao falhou 40% hoje" sem consultar a trilha; a classificação depende do mapeamento 4xx→código no base client (não auditado neste delta).
- **Impacto de negócio**: tempo de detecção de mudança do ERP depende de o analista notar itens retirados.
- **Métrica de baseline**: 0 contadores por endpoint.

## 5. Cards Kanban

### [integrability-1] Fechar V-PRD1/V-PRD2/V6 e agendar sonda de contrato antes de `on` em PRD

- **Problema**
  > Os três endpoints novos foram medidos só em HML; V6 e permissões PRD estão abertos e não há verificação periódica que acuse mudança do ERP.
- **Melhoria Proposta**
  > Executar a sonda PRD read-only (`probe-prd-readonly-permissao-fin015.ts`) como gate de `on`; transformar `probe-hml-vinculo-codbar-v1` em checagem de contrato agendada em HML (schema dos 3 retornos + modalidade 6/7) e registrar a data da última verificação na ontologia (contract testing schema-pinned).
- **Resultado Esperado**
  > Drift detectado em uma execução da sonda; 0/3 → 3/3 endpoints com contrato confirmado em PRD.
- **Tactic alvo**: Contract testing / Versioning strategy
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Endpoints confirmados em PRD: 0/3 → 3/3
  - Verificações agendadas de contrato: 0 → 1 (semanal)
- **Risco de não fazer**: mudança do ERP ou diferença PRD só aparece como onda de retiradas; V6 aberto mantém risco de reuso do boleto.
- **Dependências**: acesso do robô a fin015 em PRD (V-PRD1/V-PRD2).

### [integrability-2] Estreitar schemas de `splitCodBar` e modalidade

- **Problema**
  > `splitCodBar` é `z.unknown()` e modalidades fora de 6/7 caem silenciosamente em 6.
- **Melhoria Proposta**
  > Validar `splitCodBar` como lista não vazia de segmentos (forma vista em V7: 7–8) e rejeitar modalidade fora de {6,7} como erro de contrato em vez de `|| 6`.
- **Resultado Esperado**
  > Erro de contrato local e legível em vez de recusa opaca do ERP.
- **Tactic alvo**: Tailor Interface
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-2, F-integrability-4
- **Métricas de sucesso**:
  - Campos sem schema estrito: 2 → 0
- **Risco de não fazer**: retiradas sem causa clara.
- **Dependências**: integrability-1 (confirmar forma em PRD).

### [integrability-3] Contador de falhas por endpoint e código de erro do ERP

- **Problema**
  > Falhas do vínculo só existem como eventos por item; sem taxa por endpoint.
- **Melhoria Proposta**
  > Emitir métrica/log estruturado `endpoint`, `classe` (negocio/transitoria), `codigo ERP` (sem barra) no ponto de classificação; incluir no painel de operação.
- **Resultado Esperado**
  > Taxa de erro por endpoint visível; alerta quando recusa de negócio > limiar.
- **Tactic alvo**: Observability of integration failures
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-5
- **Métricas de sucesso**:
  - Contadores por endpoint: 0 → 3
- **Risco de não fazer**: detecção tardia de mudança do ERP.
- **Dependências**: nenhuma.

### [integrability-4] Remover shim `bancoLote` opcional

- **Problema**
  > Caminho de compatibilidade reintroduz o defeito V4.
- **Melhoria Proposta**
  > Tornar `bancoLote` obrigatório em `executar` e apagar o fallback.
- **Resultado Esperado**
  > 0 caminhos que enviam modalidade 6 para barra de outro banco.
- **Tactic alvo**: Backward-compat shims
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - Shims de compat.: 1 → 0
- **Risco de não fazer**: regressão futura por chamador novo.
- **Dependências**: nenhuma.

(F-integrability-3 sem card: padrão forçado pela ausência de lock otimista no ERP, mitigado por releitura imediata e observação pós-PUT; reavaliar se o Conexos oferecer controle de versão.)

## 6. Notas do agente

- Classificação 4xx→`CONEXOS_UPSTREAM_REJECTED` vive no base client/legado e não foi auditada (fora do delta).
- Positivos: sucesso = observação na releitura, tentativa única, sanitização de código de barras, `lerTotalAberto` fail-closed sem fallback a `titMny*`.
- Cross-QA: sanitização/`causaSegura` e fail-closed de `lerTotalAberto` para Security/Fault Tolerance; kill-switch/flag para Deployability.
