---
qa: Integrability
qa_slug: integrability
run_id: 2026-08-17-1402
agent: qa-integrability
generated_at: 2026-08-17T14:02:00-03:00
scope: backend
score: 6
findings_count: 5
cards_count: 4
---

# Integrability — Regis-Review

> Escopo DELTA (`fix/nde-painel-lista` × `main`): reuso de `ConexosNdeFiscalClient.lerDocParaPolling`
> (antes só chamado pelo pipeline de escrita `RecebimentoNumerarioService.etapaPoll`) no serviço de
> LEITURA `RecebimentosPainelService.hidratarNdes`. Duas superfícies de integração no mesmo `montarPainel`
> passam a virar TRÊS (add com297 ao lado do `imp021` via `ProcessoProvider` e do `getFiliais` do
> `ConexosBaseClient`). Contrato do campo `docEspNumero` — agora persistido em `numero_nde` — é
> declarado *best-effort não confirmado por HAR* pela ontologia (`ontology/integrations/conexos-nde-fiscal.md`,
> `conexos-com297-homologacao.md`). Bass cap. 6 aplicado ao ponto de reuso e ao GAP estrutural (falta
> endpoint de grid do com297) — não a auditoria full-repo.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abre a aba NDe do painel de recebimentos | Requisição HTTP `GET /recebimentos/painel` com allow-list de N filiais e M candidatas a hidratar | `RecebimentosPainelService.montarPainel` → 3 rotas Conexos (`getFiliais`, `imp021` via `ProcessoProvider`, `com297/{docCod}` via `ConexosNdeFiscalClient`) | ERP saudável (caso base) OU ERP indisponível OU resposta com `docEspNumero` = "0" logo pós-homologação (HAR-observed) | Hidratar somente NDes não autorizadas, em lotes capados; reconciliar `numero_nde`+`nde_autorizado` quando `vldAutorizado != 0`; degradar para o retrato do banco se qualquer dependência falhar | `PAINEL_NDE_HIDRATACAO_CAP=20` respeitado · 0 crash do painel em falha upstream · `numero_nde` gravado só quando é o número real da NF-e (não "0"/placeholder) · SLO end-to-end do painel ≤ 3s p95 |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Injeções em `RecebimentosPainelService` | 7 (`transacaoRepo`, `runRepo`, `ConexosBaseClient`, `ProcessoProviderInterface`, `SolicitacaoNumerarioExecucaoRepositoryInterface`, `NdeRepositoryInterface`, `ConexosNdeFiscalClient`) | ≤ 5 antes de considerar intermediário | ⚠️ | `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:107-120` |
| Rotas Conexos tocadas por `montarPainel` (uma request HTTP) | 3 (`GET /filiais`, `POST /api/imp021/documento/list` por filial via `ProcessoProviderConexos`, `GET /api/com297/{docCod}` por candidata) | ≤ 2 sem observability por dependência | ⚠️ | `RecebimentosPainelService.ts:122-174` |
| Cap de hidratação com297 por carga | 20 candidatas, lotes de 5 | Cap + lote + best-effort | ✅ | `interface/recebimentos/constants.ts:280,283`; teste `RecebimentosPainelService.test.ts:232-240` (`.toHaveLength(20)`) |
| Timeout ceiling honrado no `GET com297/{docCod}` | **NENHUM** (`ExternalCallOptions.timeoutMs` está declarado em `ports.ts:47`, mas `ConexosNdeFiscalClient.lerDocParaPolling` não recebe `opts`; `ConexosBaseClient.getGeneric` não expõe `timeoutMs`) | Adapter honra `timeoutMs` (default `NEXXERA_FETCH_TIMEOUT_MS`/`NDE_EMIT_TIMEOUT_MS` — padrão do Fase 1) | ❌ | `ConexosNdeFiscalClient.ts:225-254` (assinatura sem `opts`); `ConexosBaseClient.ts:173-174` |
| Política de retry aplicada à hidratação | `runWithRetry` compartilhado (2 retries + 500ms delay + 200ms jitter, `RetryExecutor` construído no boot) | Política **parametrizável por call-site** (poll de homologação quer robustez; hidratação de painel quer resposta rápida) | ⚠️ | `ConexosBaseClient.ts:149-163`; reuso em `ConexosNdeFiscalClient.ts:232` |
| Zod boundary do `com297/{docCod}` cobre `docEspNumero` | Sim (shape) — `docEspNumero: z.union([z.string(), z.number()]).optional()` | Shape + semântica confirmada por HAR real | ⚠️ (shape ✅, semântica ❌) | `ConexosNdeFiscalClient.ts:47-49` |
| Contract test com HAR real de `docEspNumero` autorizado | **Nenhum** — o teste unitário usa valor sintético `'000123'`; a HAR real (`recebimentos-numerario-real-fiscal-spec.md:37`) observa apenas `docEspNumero null→"0"` pós-homologação, NÃO confirma que passa a carregar o número da NF-e após `vldAutorizado != 0` | Fixture HAR-based cobrindo a transição `docEspNumero: "0" → <numero real>` | ❌ | `RecebimentosPainelService.test.ts:204`; `ontology/integrations/recebimentos-numerario-real-fiscal-spec.md:37`; comment `ConexosNdeClient.ts:14-16` ("melhor aposta … não confirmado por HAR") |
| Endpoint de listagem/grid do `com297` mapeado | Nenhum — só `GET com297/{docCod}` (um documento por vez) | Endpoint `POST com297/documento/list` (equivalente ao `fin095`) | ❌ | `ontology/_inbox/nde-painel-lista-gap.md`; `grep -rn "com297" src/backend/domain/client` (só rotas por docCod) |
| Encapsulamento (métodos de domínio no client, não genéricos) | ✅ `lerDocParaPolling`/`lerDocFiscal`/`gerarObservacoes` etc. — sem `get`/`post` vazando ao service | 0 métodos genéricos vazados | ✅ | `ConexosNdeFiscalClient.ts:77-254` |
| Observability por dependência no painel | `enriquecerComModalidade`/`hidratarUma` usam `.catch(() => undefined)` — degrada silenciosamente sem incrementar métrica por endpoint | Contador `integration_failure_total{endpoint="com297"\|"imp021"\|"getFiliais"}` | ⚠️ | `RecebimentosPainelService.ts:197, 282, 297, 301, 316` |
| Discovery / SSM | Via `EnvironmentProvider` (padrão) — sem novo path adicionado no delta | 100% via `EnvironmentProvider` | ✅ | delta não introduz `process.env` |

> ⚠️ **Não medível localmente**: latência real do `GET com297/{docCod}` sob carga (não há registro
> de p95 histórico). Requer instrumentação em produção. Recomendação: incrementar métrica
> `conexos_read_duration_seconds{endpoint="com297"}` a partir do `runWithRetry` — hoje só há log
> pontual do `RetryExecutor`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `ConexosNdeFiscalClient` expõe métodos de domínio (`lerDocParaPolling`, `lerDocFiscal`, `gravarDocFiscal`, `gerarObservacoes`, `listValidacoes`) — nada de `get/post` vazando ao service | ✅ | `ConexosNdeFiscalClient.ts:77-254` |
| Use an Intermediary | `RecebimentosPainelService` **injeta o client diretamente** (sem porta/adapter para "hidratação de NDe"). Ok para essa escala, mas cria acoplamento serviço-de-leitura ↔ client-de-escrita-fiscal | ⚠️ | `RecebimentosPainelService.ts:119` |
| Restrict Communication Paths | `montarPainel` fala com 3 rotas Conexos numa única resposta HTTP. Nenhum limite arquitetural impede uma 4ª/5ª integração migrar para cá | ⚠️ | `RecebimentosPainelService.ts:135-143, 199, 280-282, 323` |
| Adhere to Standards | Zod nos boundaries; `@singleton()`+`@injectable()`; ontologia declara contrato + gaps abertamente | ✅ | `ConexosNdeFiscalClient.ts:18-58, 72-75`; `ontology/integrations/conexos-nde-fiscal.md` |
| Abstract Common Services | `runWithRetry` + `ensureSid` compartilhados via `ConexosBaseClient`; política única (2 retries, jitter) baked-in — não abstrai *seleção* de política por caso de uso | ⚠️ | `ConexosBaseClient.ts:149-163, 216-221` |
| Discover Service | `EnvironmentProvider` unificado; SSM path convention (não tocado no delta) | ✅ | `EnvironmentProvider.ts:165-171` |
| Tailor Interface | **Ausente para o caso de uso de painel.** `lerDocParaPolling` foi desenhado para "poll pós-homologação numa fila de estado" e é agora reusado para "listar N linhas para render de tela". Contextos com SLOs *opostos* (o poll aceita ficar mais lento para não desistir; o painel quer responder rápido e desistir cedo) usam a MESMA implementação | ❌ | `ConexosNdeFiscalClient.ts:225-254` (única assinatura); consumidores `RecebimentoNumerarioService.ts:1482,1501,1569` (write path) vs `RecebimentosPainelService.ts:280-282` (read path) |
| Configure Behavior | `ExternalCallOptions { timeoutMs, signal }` DECLARADO em `ports.ts:45-49` como contrato de qualquer chamada externa da Frente IV, mas o `ConexosNdeFiscalClient` NÃO tem parâmetro `opts` — logo o consumidor de painel não pode encurtar o timeout mesmo querendo | ❌ | `ports.ts:45-49`; `ConexosNdeFiscalClient.ts:225-228` (falta `opts?: ExternalCallOptions`) |
| Manage Resources | Cap `PAINEL_NDE_HIDRATACAO_CAP=20` + lote `=5` protegem o ERP contra rajada em painel grande; teste garante `20 GETs` para 50 candidatas | ✅ | `constants.ts:280-283`; `RecebimentosPainelService.ts:250-266`; teste `RecebimentosPainelService.test.ts:232-240` |
| Orchestrate | `Promise.all` sobre 6 fontes (`listParaPainel` + `contarKpis` + `somarValorPorStatus` + `findLatestSuccess` + `ndeRepo.listParaPainel` + `contarPendentes`) — orquestração linear, sem correlation-id / spans / tracing por leg | ⚠️ | `RecebimentosPainelService.ts:135-143` |
| Manage Resource Coupling | Nenhum bulkhead / pool namespaced por endpoint ERP no painel. `com297` compartilha o pool HTTP (`legacyConexosAdapter`) com `imp021`/`getFiliais` e com o pipeline de escrita — uma degradação de rota afeta todas | ⚠️ | `ConexosBaseClient.ts:150-152` (`legacy` único); `legacyConexosAdapter.ts` |
| Contract testing (facet moderno) | Zod valida shape; testes unitários usam valores sintéticos. **Nenhuma HAR real do `com297/{docCod}` POST-autorização** confirma o campo que agora persistimos (`docEspNumero`) | ❌ | ver F-integrability-1 |
| Versioning strategy (facet moderno) | API Conexos é interna/legada, sem `/vN` — dependemos de HAR + Zod + monitoramento de shape drift | N/A (natureza do provider) | — |
| Backward-compat shims (facet moderno) | Não aplicável a este delta | N/A | — |
| Observability of integration failures | Falhas de `com297`, `imp021` e `getFiliais` viram `.catch(() => undefined)` no serviço — o painel *degrada* mas nenhuma métrica por dependência é emitida | ⚠️ | `RecebimentosPainelService.ts:197, 282, 297, 301, 316` |

## 4. Findings (achados)

### F-integrability-1: `numero_nde` persistido a partir de `docEspNumero` cujo contrato é *best-effort não confirmado por HAR*

- **Severidade**: P1 (alto — grava dado potencialmente errado em campo terminal do domínio; sem re-hidratação futura)
- **Tactic violada**: Contract testing / Adhere to Standards (semântica do boundary)
- **Localização**:
  - `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:287, 298-302` (leitura de `status.docEspNumero` → `updateNumeroNde`)
  - `src/backend/domain/client/ConexosNdeFiscalClient.ts:47-48, 248` (Zod aceita `docEspNumero` opcional; devolve para o service)
  - `src/backend/domain/client/ConexosNdeClient.ts:14-16, 25, 68` (comentário: "melhor aposta … não confirmado por HAR")
  - `ontology/integrations/conexos-com297-homologacao.md:22` (`open-gap: homologacao-response-fields (P1) — numeroNde exato … a confirmar no HAR`)
  - `ontology/entities/nota-debito-eletronica.md:109-110` (`campo wire exato = best-effort, docEspNumero — confirmar no HAR`)
  - `ontology/integrations/recebimentos-numerario-real-fiscal-spec.md:37` (única transição HAR-observada: `docEspNumero null→"0"` pós-homologação, NÃO `null→<número NF-e real>`)
- **Evidência (objetiva)**:
  ```typescript
  // RecebimentosPainelService.hidratarUma (linhas 285-302)
  const autorizado = status.vldAutorizado !== undefined && status.vldAutorizado !== 0;
  const numeroNde = status.docEspNumero ?? nde.numeroNde;
  const linha: NdePainelRow = { ...nde, ...(numeroNde !== undefined ? { numeroNde } : {}), ndeAutorizado: autorizado };
  if (!autorizado) return { linha, reconciliada: false };
  // Escrita LOCAL de reconciliação:
  await this.execucaoRepo.setNdeAutorizado(nde.idempotencyKey, true).catch(...);
  if (numeroNde !== undefined && numeroNde !== nde.numeroNde) {
      await this.ndeRepo.updateNumeroNde(nde.idempotencyKey, numeroNde).catch(...);
  }
  ```
  E o filtro de candidatas (linha 250-252) exclui `ndeAutorizado === true` — significa que, uma vez
  autorizada e escrita, a linha NUNCA mais é re-hidratada. `numero_nde` gravado errado é permanente.
- **Impacto técnico**: se o HAR real mostrar que `docEspNumero` continua `"0"` (ou um número interno
  do ERP, distinto do nº da NF-e) mesmo após `vldAutorizado != 0`, o painel grava `"0"`/lixo em
  `numero_nde` no primeiro poll que pegar `vldAutorizado != 0`. O documento é fiscal (NDe) — o campo
  aparece em relatórios/auditoria para o cliente final.
- **Impacto de negócio**: Nota de Débito Eletrônica é documento fiscal SEFAZ. Um `numero_nde`
  incorreto exibido para o analista/contabilidade compromete conciliação com o ERP e vira dado
  incorreto em qualquer export/relatório downstream. A auditoria não distingue "vazio" de "errado".
- **Métrica de baseline**: 0 HAR real cobre a transição autorizada. Único registro observacional é
  `docEspNumero null→"0"`, i.e., o campo *não carrega o número da NF-e* no único ponto do ciclo
  onde foi observado.

### F-integrability-2: `lerDocParaPolling` reusado em dois SLOs opostos sem *Tailor Interface* nem *Configure Behavior*

- **Severidade**: P2 (médio — a política de retry inadequada para painel adiciona latência sem benefício e amplifica carga no ERP em cenário de estresse)
- **Tactic violada**: Tailor Interface + Configure Behavior
- **Localização**:
  - `src/backend/domain/client/ConexosNdeFiscalClient.ts:225-254` (única assinatura; `runWithRetry` fixo)
  - `src/backend/domain/client/ConexosBaseClient.ts:149-163` (política 2 retries + 500ms + jitter 200ms, hard-coded)
  - `src/backend/domain/interface/recebimentos/ports.ts:45-49` (interface `ExternalCallOptions { timeoutMs, signal }` declarada mas não usada aqui)
- **Evidência (objetiva)**:
  ```typescript
  // ConexosNdeFiscalClient.ts:225 — MESMA assinatura para painel e para poll pós-homologação:
  public lerDocParaPolling = async (params: { filCod: number; docCod: number }): Promise<DocStatusFiscal> => {
      // ... runWithRetry sempre 2× (política do RetryExecutor compartilhado).
  }
  ```
  Consumidores:
  - Write path (aceita ficar lento pra não desistir): `RecebimentoNumerarioService.ts:1482,1501,1569`.
  - Read path (painel — quer resposta rápida): `RecebimentosPainelService.ts:280-282`, com cap 20 candidatas e lote 5 → **até 20 × 3 tentativas** cada abertura de painel em pior caso.
- **Impacto técnico**: sob transient failure no ERP, uma abertura de painel pode gastar 20 × 3 × (t_call + 500-700ms jitter) apenas hidratando NDes — o cap não protege contra latência acumulada, só contra volume de RPS. Configurar `retries=0` + `timeoutMs<1s` seria correto para painel; para poll pós-homolog o atual é adequado.
- **Impacto de negócio**: painel travado em janela de degradação parcial do ERP. UX: analista vê "loading" onde antes veria "carteira do banco" e desiste. Amplifica um problema de disponibilidade em problema de percepção.
- **Métrica de baseline**: 20 candidatas × 3 tentativas × ~500ms mínimo jitter = piso de 30s adicional em pior caso, **sem timeout ceiling honrado**.

### F-integrability-3: `montarPainel` acopla 3 rotas Conexos sem observability por dependência

- **Severidade**: P2 (médio — dificulta root-cause quando o painel degrada)
- **Tactic violada**: Observability of integration failures + Manage Resource Coupling
- **Localização**:
  - `RecebimentosPainelService.ts:135-143` (Promise.all de 6 fontes)
  - `RecebimentosPainelService.ts:197, 282, 297, 301, 316` (`.catch(() => undefined)` em cada call ERP)
- **Evidência (objetiva)**:
  ```typescript
  // RecebimentosPainelService.hidratarUma:
  const status = await this.fiscalClient.lerDocParaPolling({ filCod: nde.filCod, docCod }).catch(() => undefined);
  // enriquecerComModalidade:
  const reais = await this.execucaoRepo.listModalidadePorTxnIds(...).catch(() => new Map(...));
  // construirIndicePrevisao:
  } catch { return undefined; }
  ```
  Nenhuma dessas 4 fronteiras de degradação incrementa um contador por endpoint. O log agregado do
  `RetryExecutor` (`shouldLog: true`) só mostra que houve retry, não onde (com297? imp021? getFiliais?).
- **Impacto técnico**: um regressão só em `com297` (por exemplo, mudança de shape) é indistinguível de
  degradação em `imp021` — o painel carrega, os dados vazios, e ninguém sabe qual leg quebrou.
- **Impacto de negócio**: MTTR alto para o ciclo "aba abre em branco" — a doutrina "best-effort silencioso" transforma incidentes de integração em falhas mudas.
- **Métrica de baseline**: 0 contadores por dependência; 4 pontos de `.catch()` swallowing.

### F-integrability-4: `ExternalCallOptions.timeoutMs` não honrado pelo `ConexosBaseClient.getGeneric`

- **Severidade**: P2 (médio — reduz a defensibilidade da Frente IV frente ao próprio contrato declarado)
- **Tactic violada**: Configure Behavior (contrato existe, implementação não segue)
- **Localização**:
  - `src/backend/domain/interface/recebimentos/ports.ts:41-49` (declara `ExternalCallOptions { timeoutMs, signal }` e comenta: "the adapter real MUST honour `timeoutMs`")
  - `src/backend/domain/client/ConexosBaseClient.ts:173-174` (`getGeneric` não aceita `opts.timeoutMs`)
  - `src/backend/domain/client/ConexosNdeFiscalClient.ts:225-228` (não repassa `opts` — nem tem parâmetro)
- **Evidência (objetiva)**:
  ```typescript
  // ports.ts:45
  export interface ExternalCallOptions { timeoutMs?: number; signal?: AbortSignal; }
  // ConexosBaseClient.ts:173
  public getGeneric = <T>(path: string, opts?: { filCod?: number }): Promise<T> => ...
  //  ↑ opts NÃO tem timeoutMs
  ```
  Pré-existente; ampliado pelo delta ao trazer `com297/{docCod}` para dentro do painel — agora não
  ter timeout tem consequência de painel (antes só afetava um poll assíncrono do write path).
- **Impacto técnico**: um `GET` que não devolve nunca (Conexos pendurado) pin um worker do painel
  indefinidamente — sem circuit breaker, sem abort — até o timeout global do Express/Node.
- **Impacto de negócio**: risco de esgotamento de conexões no BOOT do painel numa janela de indisponibilidade do ERP; a "degradação graciosa" prometida no comentário só funciona se a promessa `.catch()` de fato SE resolve.
- **Métrica de baseline**: 0 chamadas Conexos no delta honram `timeoutMs`.

### F-integrability-5: GAP estrutural — sem endpoint de grid do `com297` (dívida de integrabilidade futura)

- **Severidade**: P3 (baixo — não bloqueia esta feature, bloqueia as próximas)
- **Tactic violada**: Restrict Communication Paths + Manage Resources (padrão de bulk-read ausente para uma família de docs fiscais)
- **Localização**:
  - `ontology/_inbox/nde-painel-lista-gap.md` (aberto 2026-08-17; dono Yuri; destravado por HAR de "Fiscais de Saída (com297)")
  - `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:247-271` (padrão N × `GET com297/{docCod}`)
- **Evidência (objetiva)**: única rota `com297` mapeada de leitura é `GET com297/{docCod}` (unitária).
  Todo caso de uso que quiser "listar NDes por filial/período" ou "NDes emitidas fora da ferramenta"
  paga 1 HTTP por linha ou não é implementável — enumeração inexistente.
- **Impacto técnico**: cada nova feature de leitura fiscal (KPI dashboard, relatório de auditoria,
  back-fill de NDes históricas emitidas manualmente) esbarra na ausência de enumeração; workaround
  = varrer `docCod` (inviável) ou capturar HAR novo (linha crítica bloqueada por acesso ao ambiente
  Conexos real).
- **Impacto de negócio**: NDes emitidas manualmente no Conexos (fora do fluxo automatizado) NÃO aparecem no painel — o próprio GAP admite isso. Cobertura da aba NDe é parcial por design até o HAR ser capturado.
- **Métrica de baseline**: 0 endpoints de grid `com297` mapeados; 1 GAP registrado; a projeção `NdePainelRow` compensa com a inversão "execução dirige, NDe entra por LEFT JOIN" (`NdeRepository.ts:22-27`) — solução engenhosa mas explicitamente incompleta.

## 5. Cards Kanban

### [integrability-1] Firmar contrato de `docEspNumero` com HAR real (ou parar de gravar `numero_nde` pelo poll)

- **Problema**
  > O painel grava `numero_nde` a partir de `docEspNumero` retornado por `GET com297/{docCod}` no momento em que detecta `vldAutorizado != 0` — e a linha é excluída de futuras hidratações. Só que a ontologia (`conexos-com297-homologacao.md`, `conexos-nde-fiscal.md`, `nota-debito-eletronica.md`) DIZ que `docEspNumero` como número da NF-e é *melhor aposta, não confirmado por HAR*, e o único HAR real observado mostra `docEspNumero null→"0"` pós-homologação — sem prova de que passe a carregar o número real quando SEFAZ autoriza. Se o campo não carrega o número real, gravamos "0"/lixo permanentemente em campo fiscal.

- **Melhoria Proposta**
  > Capturar HAR de um `GET com297/{docCod}` de documento com `vldAutorizado != 0` em HML e confirmar (a) o campo exato que traz o nº da NF-e autorizada, (b) o formato ("000123" vs "123" vs "26.0141"). Se `docEspNumero` for de fato o campo, promover a asserção no boundary Zod para *required-when-authorized*. Se NÃO for, remover a persistência do `numero_nde` do `hidratarUma` até termos o campo certo (o painel continua funcionando — só não persiste o número, apenas o flag `nde_autorizado`). Fecha o GAP `homologacao-response-fields` de `conexos-com297-homologacao.md`. Tactic Bass: Contract testing + Adhere to Standards (semântica).

- **Resultado Esperado**
  > `numero_nde` gravado no banco é sempre o número real da NF-e ou ausente — nunca "0"/placeholder. Fixture HAR-based no `ConexosNdeFiscalClient.test.ts` cobrindo a transição autorizada. Ontology `open-gap: homologacao-response-fields` fechada.

- **Tactic alvo**: Contract testing / Adhere to Standards
- **Severidade**: P1
- **Esforço estimado**: S (≤1d) para HAR + validação; M se o campo não for `docEspNumero` (mudança em cadeia: write path também usa esse campo em `ConexosNdeClient.ts:68`)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - HARs cobertos por fixture do `lerDocParaPolling` autorizado: 0 → 1
  - Ontology `open-gap: homologacao-response-fields (P1)`: aberto → fechado
  - `numero_nde` gravado como "0" nos primeiros 30d de produção: risco → 0
- **Risco de não fazer**: em 6 meses, se o campo se prova errado, é preciso back-fill em produção + auditoria contábil. Doc fiscal com número errado tem custo regulatório.
- **Dependências**: acesso a ambiente HML/PROD do Conexos com um documento autorizado (dono Yuri, mesmo do GAP `nde-painel-lista-gap.md`).

### [integrability-2] Parametrizar retry/timeout por call-site via `ExternalCallOptions` (Tailor Interface + Configure Behavior)

- **Problema**
  > `lerDocParaPolling` é chamado por dois consumidores com SLOs opostos: o pipeline de escrita (`RecebimentoNumerarioService.etapaPoll`) quer *robustez* (não desistir do poll), o painel (`RecebimentosPainelService.hidratarNdes`) quer *responsividade* (desistir rápido para renderizar). Hoje ambos herdam a mesma política de 2 retries + 500-700ms de jitter do `RetryExecutor` compartilhado — e o `ExternalCallOptions { timeoutMs, signal }` que a Frente IV declarou como contrato em `ports.ts:45-49` sequer chega no `getGeneric` do `ConexosBaseClient`.

- **Melhoria Proposta**
  > (1) Adicionar `opts?: ExternalCallOptions` a `ConexosNdeFiscalClient.lerDocParaPolling`, (2) propagar até `ConexosBaseClient.getGeneric`, (3) implementar `timeoutMs` via `AbortController` no adapter HTTP, (4) permitir opcionalmente `retries` override (via um segundo `RetryExecutor` "no-retry" para o painel, ou via `Executor` parametrizado). Alternativa mais leve: criar `lerDocParaGrid` (assinatura irmã) com política "sem retry, timeout 800ms" — *Tailor Interface* estrito, sem tocar no consumidor de escrita. O comentário no próprio `ports.ts:47` já obriga o adapter a honrar `timeoutMs`.

- **Resultado Esperado**
  > Painel: hidratação com timeout ≤ 1s por candidata, sem retry (falha vira `.catch()` idêntico ao atual). Write path: intocado. Config em constants, não hard-coded no `RetryExecutor` do construtor.

- **Tactic alvo**: Tailor Interface + Configure Behavior
- **Severidade**: P2
- **Esforço estimado**: M (2–5d) — a mudança atravessa 4 camadas (interface, adapter legacy, cliente, service) e precisa preservar o contrato do write path
- **Findings relacionados**: F-integrability-2, F-integrability-4
- **Métricas de sucesso**:
  - Chamadas `com297` do painel com `timeoutMs` honrado: 0 → 100%
  - Piso de latência do painel sob ERP degradado: 30s (pior caso hoje) → ≤ 3s
  - Uso de `ExternalCallOptions` em `ConexosNdeFiscalClient`: 0 → todas as leituras
- **Risco de não fazer**: painel trava em janela de degradação parcial do ERP; workers do Express pinados sem timeout.
- **Dependências**: nenhuma.

### [integrability-3] Instrumentar `integration_failure_total{endpoint}` no `montarPainel`

- **Problema**
  > `montarPainel` chama 3 rotas Conexos (`getFiliais`, `imp021`, `com297`) numa única resposta HTTP, e cada uma degrada silenciosamente via `.catch(() => undefined)`. Quando a aba abre em branco/parcial, não há como distinguir qual leg quebrou — o log agregado do `RetryExecutor` só diz que houve retry, não onde.

- **Melhoria Proposta**
  > Emitir métrica estruturada por dependência a cada falha (`MetricsPortInterface` já existe — `ports.ts:222-230`). Instrumentar os 4 `.catch(...)` do `RecebimentosPainelService` (linhas 197, 282, 297, 301) com `metrics.emit({ stage: 'painel.hidratar', outcome: 'error', attributes: { endpoint: 'com297', filCod }})`. Reutilizar o `withCorrelationId` que o Módulo 6 já expõe. Tactic Bass: Observability of integration failures.

- **Resultado Esperado**
  > Painel degradado é distinguível por dependência em ≤ 5 minutos via logs/métricas. Alertas específicos possíveis (ex.: "com297 falhou > 5% das hidratações nos últimos 10min").

- **Tactic alvo**: Observability of integration failures
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Contadores por endpoint no `montarPainel`: 0 → 3
  - MTTR para "aba abre em branco": indefinido → alertável
- **Risco de não fazer**: incidentes de integração ficam mudos; troubleshooting recai em bisect por commit em vez de leitura de métrica.
- **Dependências**: `MetricsPortInterface` real (hoje há stub) — pode subir junto com o próximo card do Módulo 6.

### [integrability-4] Capturar HAR do grid `com297` — destrava GAP `nde-painel-lista` e o padrão de bulk-read fiscal

- **Problema**
  > Hoje toda leitura `com297` é unitária (`GET /api/com297/{docCod}`). O painel resolve isso com a inversão "execução dirige, NDe entra por LEFT JOIN" (`NdeRepository.ts:22-27`), mas essa engenhosidade só cobre NDes que **passaram por nós**. Qualquer NDe emitida manualmente no Conexos NÃO aparece — o próprio GAP `nde-painel-lista-gap.md` admite isso. Além disso, cada abertura de painel paga 1 HTTP por candidata a hidratar, sem batch possível — dívida de integrabilidade estrutural.

- **Melhoria Proposta**
  > Capturar HAR real da tela "Fiscais de Saída (com297)" fazendo pesquisa por filial + período (mesma abordagem do `fin095` do extrato). Mapear (a) rota do grid (provavelmente `POST com297/documento/list`), (b) shape do filtro (filial, período, `docVldTipo` da NDe), (c) shape da linha (`docCod`, `docEspNumero`, `vldAutorizado`, valor, cliente), (d) paginação. Adicionar `listNdes` no `ConexosNdeFiscalClient` com Zod completo. Isso além de destravar o GAP também vira o padrão de bulk-read para futuras features fiscais (Frente III, relatórios, back-fill).

- **Resultado Esperado**
  > NDes emitidas manualmente aparecem no painel; hidratação em lote reduz `20 × GET` para `1 × POST list`; contract fixture HAR-based estabelece o padrão para próximos GAPs `com297`.

- **Tactic alvo**: Restrict Communication Paths + Manage Resources (bulk-read)
- **Severidade**: P3 (esta feature não bloqueia; as próximas sim)
- **Esforço estimado**: L (1–2sem) — captura HAR + contract + refactor de `hidratarNdes` para batch
- **Findings relacionados**: F-integrability-5
- **Métricas de sucesso**:
  - HTTPs por abertura de painel (hidratação): 20 → 1 (batch)
  - GAPs `com297` mapeados: 1 (unit) → 2 (unit + grid)
  - Cobertura da aba NDe: só emitidas por nós → todas as NDes da filial no período
- **Risco de não fazer**: em 6 meses, qualquer relatório fiscal/dashboard novo re-esbarra no mesmo GAP. Custo composto de integrabilidade.
- **Dependências**: acesso ao Conexos com credenciais que veem "Fiscais de Saída" (mesmo dono do GAP: Yuri).

## 6. Notas do agente

- Escopo restrito ao DELTA (`fix/nde-painel-lista`) conforme `_shared-metrics.md`. Não auditei full-repo — as
  observações sobre `ExternalCallOptions.timeoutMs` (F-4) são pré-existentes mas ampliadas em consequência
  pelo delta (o `com297` era write-only, agora é read-hot-path do painel).
- Cross-QA: **F-1 e F-2 sobrepõem-se com Fault-Tolerance** (best-effort silencioso + reconciliação
  irreversível de campo fiscal) — flag para o consolidator. **F-3 sobrepõe-se com Availability/Observability**.
  **F-5 sobrepõe-se com Modifiability** (o padrão `NdeRepository.PAINEL_FROM_WHERE` inverteu a fonte
  para compensar o GAP — solução engenhosa que fica difícil de mudar quando o grid chegar).
- Não medi latência real do `GET com297/{docCod}` sob carga — não há histórico local. Recomendação em Métrica ⚠️.
- Score 6/10: encapsulamento e cap de recursos bem feitos (+); `Tailor Interface`/`Configure Behavior`
  ausentes num reuso cross-context (−); um contrato de campo terminal (`docEspNumero → numero_nde`) construído
  em cima de "melhor aposta não confirmada por HAR" (−); GAP estrutural aberto que a solução compensa
  engenhosamente mas não fecha (−).
