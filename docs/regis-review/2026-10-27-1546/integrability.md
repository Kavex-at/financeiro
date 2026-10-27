---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-27-1546
agent: qa-integrability
generated_at: 2026-10-27T15:57:33Z
scope: backend
score: 8
findings_count: 1
cards_count: 1
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista / Conexos | Reenvio de grupo rejeitado cujo item pode permanecer no lote anterior | Guarda de reaproveitamento e clientes fin015 | Express/Render, retomada de rascunho completo ou parcial | Comprovar ausência no lote anterior; retirar grupo e alertar se vínculo ou leitura ambígua; preservar antigo | 0 importações sem prova; 0 mutações no lote/borderô anterior; demais itens continuam após ausência no atual |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Estados nativos com item ainda vinculado cobertos no teste da guarda | 4: 0, 1, 2, 3 (inspeção dos casos; execução pelo coordenador) | 4/4 bloqueados | ✅ | `src/backend/domain/service/sispag/BorderoGrupoBoletoService.test.ts:1238` |
| Casos parametrizados de leitura/chaves inconclusivas | 7 (inspeção) | Todos retiram com alerta | ✅ | `src/backend/domain/service/sispag/BorderoGrupoBoletoService.test.ts:1264` |
| Orquestração de retomada agrupada aberta | Completa e parcial convergem para preparar_bordero | 2/2 caminhos protegidos | ✅ | `src/backend/domain/service/sispag/RemessaService.ts:1264-1285` |
| Normalizações permissivas no envelope paginado consumido pela guarda | 2: rows inválido → []; count ausente → tamanho | 0 respostas malformadas aceitas como prova de ausência | ⚠️ | `src/backend/domain/client/legacyConexosAdapter.ts:48-50` |
| Prova HML da guarda após correção | Não executada nesta revisão; V7 anterior 5/6 | Roteiro pós-correção comprova retirada e preservação | ⚠️ | `ontology/_inbox/sispag-boleto-agrupado-reenvio-rejeitado-plano.md` |

⚠️ **Não medível localmente**: compatibilidade real dos envelopes após mudança do ERP e resultado ponta a ponta pós-correção. Requer fixture real saneada e roteiro HML autorizado; mocks não substituem essa prova. Infra/SSM de tenants não existem neste runtime e não foram inferidos.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Leitura fin015 no cliente; guarda no serviço | ✅ presente | `src/backend/domain/client/ConexosSispagWriteClient.ts:600,911` |
| Use an Intermediary | Base e adapter centralizam sessão/HTTP | ✅ presente | `src/backend/domain/client/ConexosBaseClient.ts:215` |
| Restrict Communication Paths | Guarda usa getLoteNativo/lerItemDeBordero sem HTTP direto | ✅ presente | `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:1043-1059` |
| Adhere to Standards | Schemas do item; envelope bruto ainda normalizado permissivamente | ⚠️ parcial | `src/backend/domain/client/ConexosSispagWriteClient.ts:932-938`; `src/backend/domain/client/legacyConexosAdapter.ts:48` |
| Abstract Common Services | Sessão por chamada e retry compartilhados | ✅ presente | `src/backend/domain/client/legacyConexosAdapter.ts:42`; `src/backend/domain/client/ConexosBaseClient.ts:156` |
| Discover Service | N/A: delta não adiciona integração nem descoberta; runtime atual não usa registry Terraform | N/A | `CLAUDE.md` |
| Tailor Interface | Ausência em leitura incompleta lança erro; cabeçalho usa defaults herdados | ⚠️ parcial | `src/backend/domain/client/ConexosSispagWriteClient.ts:620-624,927-938` |
| Configure Behavior | Escrita/limpeza respeita kill-switch | ✅ presente | `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:1292-1298` |
| Manage Resources | Varredura com 40 páginas por padrão; antiga somente lida | ✅ presente | `src/backend/domain/client/ConexosSispagWriteClient.ts:860`; `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:1043` |
| Orchestrate | Retomadas completas/parciais preparam; limpeza reaproveitada permite continuar mantendo pendência | ✅ presente | `src/backend/domain/service/sispag/RemessaService.ts:1277`; `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:1317-1327` |
| Manage Resource Coupling | Identidade borCod+borTimCad e chaves do lote anterior conferidas; nenhum cancelamento automático | ✅ presente | `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:1018-1040` |

Contrato: testes locais cobrem os resultados tipados, incluindo leitura incompleta. A validação do envelope cru ainda precisa de teste atravessando o adapter. Versionamento do ERP e shims não mudaram neste delta; observabilidade operacional usa alerta acionável com chaves e instrução de regularização (`BorderoGrupoBoletoService.ts:1009-1016`).

## 4. Findings (achados)

### F-integrability-1: Envelope inválido pode virar ausência comprovada

- **Severidade**: P2 (médio — débito técnico defensável)
- **Tactic violada**: Adhere to Standards
- **Localização**: `src/backend/domain/client/legacyConexosAdapter.ts:37-50`; `src/backend/domain/client/ConexosSispagWriteClient.ts:620-624,836-841,927-931`; `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:1043-1067`
- **Evidência (objetiva)**:
  ```
  rows = Array.isArray(data?.rows) ? data.rows : []
  count = typeof data?.count === 'number' ? data.count : rows.length
  rows.length < 500 => completa = true
  !achado && completa => undefined
  ```
- **Impacto técnico**: Se finItemSispag/list responder HTTP 200 com envelope fora do contrato (por exemplo `{messages: [...]}`), o adapter devolve `{count:0,rows:[]}`; a nova guarda recebe ausência em vez de erro. O cabeçalho também supre filial/banco/status ausentes com a requisição/0, reduzindo a detecção de drift. Os endpoints são corretamente chaveados: isso é risco condicionado a resposta inválida, sem evidência de erro de roteamento ou incidente atual.
- **Impacto de negócio**: Uma alteração incompatível do ERP pode deixar o reenvio avançar e voltar à recusa tardia de finalização, exigindo saneamento manual.
- **Métrica de baseline**: 2 normalizações permissivas de envelope; 3 defaults relevantes do cabeçalho (filial, banco, status). Nenhuma taxa real de drift foi medida. Comportamento herdado ganha relevância porque a nova guarda o usa como prova negativa.

## 5. Cards Kanban

### [integrability-1] Valide o contrato bruto das leituras usadas como prova de liberação

- **Problema**
  > O adapter converte resposta sem rows válidas em lista vazia; a guarda pode interpretar drift como ausência completa do item anterior. Os testes do serviço recebem clientes mockados e não verificam essa normalização.
- **Melhoria Proposta**
  > Aplicar Adhere to Standards com uma leitura estrita, limitada aos endpoints fin015 usados pela guarda, preservando a distinção entre ausência válida e envelope inválido antes da normalização. Exigir os campos do cabeçalho necessários ao contrato, conforme fixtures reais, e testar do adapter ao cliente; manter comportamento dos demais consumidores fora do escopo.
- **Resultado Esperado**
  > Respostas inválidas usadas como prova de ausência: permitidas pela normalização atual → 0; erro deve produzir BORDERO_ANTERIOR_NAO_RESOLVIDO sem importação e com alerta.
- **Tactic alvo**: Adhere to Standards
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Envelopes sem rows, rows não-array e cabeçalho com campos obrigatórios ausentes: 100% rejeitados pelo contrato estrito.
  - Fixtures válidas de lote vazio e item ausente: 100% preservam o caminho permitido.
- **Risco de não fazer**: Em seis meses, mudança incompatível do ERP pode ser tratada como liberação do item e recriar a recusa tardia.
- **Dependências**: Fixtures saneadas do contrato fin015; prova HML continua pendente e separada.

## 6. Notas do agente

Revisão quick limitada à guarda, retomadas e limpeza; sem chamadas ERP, banco ou execução duplicada de gates.
Nenhum P0/P1 comprovado nesta seção; risco de contrato é P2 condicionado a drift.
Cross-QA: envelope/ausência interessa a Fault Tolerance e Testability; não duplicar o mesmo card.
A pendência/alerta do borderô reaproveitado permanece; NADA_A_LIMPAR descreve somente o rascunho atual após ausência observada.
HML pós-correção é requisito de aceite ainda pendente, sem inferir aprovação por mocks.
