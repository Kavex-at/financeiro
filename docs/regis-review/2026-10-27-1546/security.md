---
qa: Security
qa_slug: security
run_id: 2026-10-27-1546
agent: qa-security
generated_at: 2026-10-27T15:57:42.892144+00:00
scope: backend
score: 8
findings_count: 0
cards_count: 0
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Operador ou resposta incompleta do ERP | Tenta preparar grupo cujo pagamento anterior foi rejeitado | Guarda de integridade do borderô/lote | Express/Render; remessa nova ou retomada | Exigir identidade e ausência ao vivo, preservar patrimônio financeiro e instruir analista | Zero mutações no lote/borderô antigo; zero decisão de ausência baseada em leitura incompleta |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Novas rotas HTTP no delta de produção | 0 | 0 para correção interna | ✅ | git diff; alterações em services/libs e probe HML |
| Estados antigos com vínculo persistente bloqueados em casos de teste | 4 | 4 estados reconhecidos | ✅ | BorderoGrupoBoletoService.test.ts:1241 |
| Verificações booleanas de identidade/chaves anteriores | Presente; grupo, borCod, borTimCad, banco, lote e filial | Exigir todas antes de reutilizar | ✅ | BorderoGrupoBoletoService.ts:1019 |
| Cenários de preservação com guarda real | 1 | Zero exclusões de borderô/baixas antigas | ✅ | BorderoGrupoBoletoService.test.ts:1326 |
| npm audit neste quick review | Não executado | N/A, quick sem rede | ⚠️ | Escopo delegado |

⚠️ **Não medível localmente**: comportamento pós-correção no ERP real, latência e disponibilidade em produção. Requer validação controlada no ambiente autorizado e telemetria; testes com mocks não substituem essa evidência.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | N/A: detecção de intrusão não é alterada pela guarda interna | N/A | Delta backend |
| Detect Service Denial | N/A: detecção de abuso HTTP fora do delta sem novas rotas | N/A | Delta backend |
| Verify Message Integrity | Confere identidade e resposta completa antes de aceitar liberação | ✅ presente | BorderoGrupoBoletoService.ts:1019; ConexosSispagWriteClient.ts:911 |
| Detect Message Delay | Releitura ao vivo na retomada reduz uso de estado antigo | ✅ presente | BorderoGrupoBoletoService.ts:632 |
| Identify Actors | Ator do sistema usado em eventos de fechamento; autenticação não alterada | ✅ presente | FechamentoGrupoBoleto.ts:126,221 |
| Authenticate Actors | N/A: nenhuma nova fronteira HTTP/autenticação no delta | N/A | git diff |
| Authorize Actors | Escrita requer flags e ausência de dry-run; autorização HTTP herdada, não reavaliada | ✅ presente no escopo | BorderoGrupoBoletoService.ts:268,1290 |
| Limit Access | Só limpeza do item atual; vínculo antigo não é removido | ✅ presente | BorderoGrupoBoletoService.ts:1316,1361 |
| Limit Exposure | Alertas usam código mascarado; não exigem novo segredo | ✅ presente | FechamentoGrupoBoleto.ts:166 |
| Encrypt Data | N/A: delta não muda transporte nem persistência criptográfica | N/A | Escopo |
| Separate Entities | Compara grupo, filial e identidade; rejeita lote anterior igual ao atual | ✅ presente | BorderoGrupoBoletoService.ts:1019,1046 |
| Change Default Settings | Mantém kill-switch de escrita e dry-run | ✅ presente | BorderoGrupoBoletoService.ts:268,1290 |
| Validate Input | Valida inteiros positivos e identidade das respostas; ausência truncada é erro | ✅ presente | BorderoGrupoBoletoService.ts:1027; ConexosSispagWriteClient.ts:931 |
| Revoke Access | N/A: sessões/credenciais não alteradas; kill-switch mantém suspensão de escrita | N/A | Escopo |
| Lock Computer | N/A: tática de dispositivo sem relação com serviço backend | N/A | Escopo |
| Inform Actors | Alerta indica lote, borderô, fin015 e regularização com analista | ✅ presente | BorderoGrupoBoletoService.ts:1015,1229; FechamentoGrupoBoleto.ts:173 |
| Restore | Retirada/limpeza atual não restaura nem altera lote antigo | ✅ presente | BorderoGrupoBoletoService.ts:1316 |
| Audit Trail | Transições persistidas e alerta; nenhuma nova mutação remota antiga | ✅ presente no escopo | BorderoGrupoBoletoService.ts:1223,1323; FechamentoGrupoBoleto.ts:151 |

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
