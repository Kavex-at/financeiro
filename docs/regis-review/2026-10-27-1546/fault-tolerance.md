---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-27-1546
agent: qa-fault-tolerance
generated_at: 2026-10-27T15:57:42.892144+00:00
scope: backend
score: 8.5
findings_count: 0
cards_count: 0
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Conexos ou retomada após falha | J rejeitado e item antigo ainda vinculado, leitura incerta ou preparação interrompida | BorderoGrupoBoletoService e RemessaService | Lote novo aberto, inclusive rascunho misto completo/parcial | Retirar o grupo inteiro, alertar com lote/borderô e preservar o antigo; continuar avulsos após limpeza segura | Zero importações do grupo bloqueado; zero exclusões do borderô antigo; ausência do item atual observada |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Estados nativos com item antigo cobertos no teste parametrizado | 4 (0, 1, 2, 3) | 4 estados reconhecidos | ✅ | BorderoGrupoBoletoService.test.ts:1241 |
| Casos de falta de prova de liberação cobertos no teste parametrizado | 7 | Falhar fechado nos 7 casos listados | ✅ | BorderoGrupoBoletoService.test.ts:1263 |
| Retomadas com vínculo antigo novamente conferido | 2 etapas (failed, importado) | 2 cenários modelados neste teste | ✅ | BorderoGrupoBoletoService.test.ts:1300 |
| Regressões de rascunho misto com grupo presente | 2 (completo e parcial) | 2; parcial importa apenas faltantes | ✅ | RemessaService.test.ts:4495,4535 |
| Integração com guarda real e limpeza reaproveitada | 1 cenário inspecionado | Retirar 3 títulos e preservar 1 avulso | ✅ | BorderoGrupoBoletoService.test.ts:1326 |
| Testes executados por este agente | 0 | Evitar duplicar gates do coordenador | ✅ | Escopo delegado; _shared-metrics.md |

⚠️ **Não medível localmente**: comportamento pós-correção no ERP real, latência e disponibilidade em produção. Requer validação controlada no ambiente autorizado e telemetria; testes com mocks não substituem essa evidência.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution | N/A: não há provedor alternativo seguro para o estado autoritativo do ERP | N/A | BorderoGrupoBoletoService.ts:1004 |
| Replacement | N/A: substituição de componente em runtime fora do delta | N/A | Escopo backend local |
| Predictive Model | N/A: decisão por observação, sem previsão de estado financeiro | N/A | BorderoGrupoBoletoService.ts:1004 |
| Increase Competence Set | Mensagem informa fin015, vínculo e analista responsável | ✅ presente | BorderoGrupoBoletoService.ts:1015 |
| Sanity Checking | Identidade, chaves e estados reconhecidos exigidos | ✅ presente | BorderoGrupoBoletoService.ts:1019 |
| Comparison | Compara identidade adotada e antiga; lote anterior distinto do atual | ✅ presente | BorderoGrupoBoletoService.ts:1036 |
| Timestamp | borTimCad compõe identidade do borderô | ✅ presente | BorderoGrupoBoletoService.ts:651,943 |
| Timeout | Erro na leitura anterior retira e alerta; configuração de timeout não alterada | ⚠️ parcial | BorderoGrupoBoletoService.ts:1068 |
| Condition Monitoring | Leitura ao vivo do lote e do item anterior | ✅ presente | BorderoGrupoBoletoService.ts:1053 |
| Self-Test | Casos de regressão de falha e retomada existentes | ✅ presente | BorderoGrupoBoletoService.test.ts:1223 |
| Voting | N/A: ERP é fonte autoritativa, sem réplicas votantes | N/A | Escopo |
| Redundancy | N/A: duplicar escrita financeira contrariaria a regra do grupo | N/A | Escopo |
| Recovery (forward / backward) | Retirada completa e alerta para reconciliação humana | ✅ presente | RemessaService.ts:1416; RetiradaCodigoBarrasService.ts:1051 |
| Reintroduction (Shadow, State Resync, Escalating Restart) | Retomada reconcilia ao vivo antes de seguir | ✅ presente | RemessaService.ts:1264; BorderoGrupoBoletoService.ts:632 |
| Rollback | N/A para o lote antigo: preservação é requisito; limpeza atual é compensação limitada | N/A | BorderoGrupoBoletoService.ts:1316 |
| Repair State | Conclui execução rejeitada antes de preparar nova execução | ✅ presente | BorderoGrupoBoletoService.ts:280; FechamentoGrupoBoleto.ts:191 |
| Idempotent Replay | Reconfere vínculo inclusive com item atual já existente | ✅ presente | BorderoGrupoBoletoService.ts:637; RemessaService.ts:1277 |
| Compensating Transaction | Remove só item reaproveitado do lote atual, com releitura | ✅ presente | BorderoGrupoBoletoService.ts:1316,1361 |
| Reconcile | Ausência só vale com leitura completa; resposta truncada lança erro | ✅ presente | ConexosSispagWriteClient.ts:911 |
| Quarantine | Motivo BORDERO_ANTERIOR_NAO_RESOLVIDO e alerta acionável | ✅ presente | BorderoGrupoBoletoService.ts:1229; FechamentoGrupoBoleto.ts:173 |

## 4. Findings (achados)

Nenhum achado material novo no delta inspecionado. As duas falhas apontadas na rodada anterior foram corrigidas: retomada completa/parcial passa por preparação e limpeza reaproveitada preserva a pendência antiga sem bloquear os demais pagamentos após ausência observada do item atual.

## 5. Cards Kanban

Nenhum card novo: não há finding acionável remanescente demonstrado nesta inspeção local.

## 6. Notas do agente

- Escopo: correção backend do reenvio após J rejeitado; revisão quick, sem ERP, rede, banco ou execução duplicada de testes.
- As contagens de cenários abaixo são inspeção do código de teste, não resultados de uma execução própria.
- Gates executados pelo coordenador: consultar `_shared-metrics.md`; esta seção não antecipa seu resultado final.
- Idempotência/retomada cruzam Testability; leitura completa cruza Integrability; preservação e trilha cruzam Security/Fault Tolerance.
- Liberação automática permanece exploração, sem autorização de execução no ERP.
