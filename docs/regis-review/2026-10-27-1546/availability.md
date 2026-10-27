---
qa: Availability
qa_slug: availability
run_id: 2026-10-27-1546
agent: qa-availability
generated_at: 2026-10-27T15:57:00Z
scope: backend
score: 8
findings_count: 1
cards_count: 1
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista e Conexos | Reenvio de boleto agrupado rejeitado cujo item permanece no lote anterior; leitura falha ou retomada de rascunho completo | Preparação do borderô, retirada do grupo e retomada da remessa | Backend Express/Render atual, integração financeira com falha parcial | Consultar identidade/cabeçalho/item antigos; retirar todos os títulos com motivo acionável se a liberação não for comprovada; preservar antigo e permitir demais itens após limpeza segura do rascunho atual | Zero importações do grupo bloqueado; zero mutações do lote/borderô antigos; grupo inteiro retirado; demais itens processáveis; prova HML pós-correção pendente |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Pontos explícitos de consulta da nova guarda no serviço | 2: adoção após rejeição e continuação de reaproveitado | 2 caminhos cobertos, contrato aprovado | ✅ | `rg -n unresolvedPreviousBatch src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts`:639,980 |
| Retomada com rascunho completo contendo grupos | 1 ramo retorna `preparar_bordero` antes da barra | 1 ramo protegido, critério de aceite 4 | ✅ | `src/backend/domain/service/sispag/RemessaService.ts:1276` |
| Verificações da última V7 histórica | 5/6; falha na finalização por vínculo no lote anterior | 6/6 na prova posterior, Task 21 | ⚠️ | `ontology/_inbox/sispag-boleto-agrupado-reenvio-rejeitado-exploracao.md:17` |
| Prova HML pós-correção registrada neste review | 0 rodadas executadas; não mede taxa de sucesso real | 1 rodada completa com bloqueio, retirada e preservação comprovados antes do merge | ⚠️ | `_shared-metrics.md`; plano de reenvio, critérios de aceite |
| Gates compartilhados na abertura | Typecheck 0; lint 0, 124 warnings; testes focados 278/278; revisão independente 74/74; suíte completa ainda em execução | Gates finais verdes após correções concorrentes | ⚠️ | `docs/regis-review/2026-10-27-1546/_shared-metrics.md` |
| Redrive/DLQ, alarmes por tenant e isolamento AWS | Não mensurável/não aplicável ao delta: infraestrutura Terraform não existe no runtime atual | Não atribuir disponibilidade do alvo ao Express atual | ⚠️ | `CLAUDE.md`, Estado Atual vs. Alvo |
| Adoção global de Executor, timeouts e catches silenciosos | Não medida nesta revisão do delta | Sem meta global inferida de amostra local | ⚠️ | Escopo quick definido em `_shared-metrics.md` |

> ⚠️ **Não medível localmente**: disponibilidade real, MTTR, latência da leitura adicional e tempo de intervenção da analista. Requer telemetria do Express/Render e evidência operacional Conexos. Recomendação: medir duração entre retirada/Alerta, regularização no fin015 e remessa concluída; não inventar SLA a partir de testes mockados.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | N/A: alteração é guarda financeira por requisição, sem mudança de health endpoint | N/A | `CLAUDE.md`, runtime atual |
| Heartbeat | N/A: não há worker novo ou protocolo de liveness no delta | N/A | `_shared-metrics.md` |
| Monitor | Alerta e log identificam grupo e conflito; entrega do Alerta é best-effort | ⚠️ parcial | `BorderoGrupoBoletoService.ts:1229,1510` |
| Timestamp | Identidade usa `borTimCad`; alerta deduplicado por dia BRT | ✅ presente | `BorderoGrupoBoletoService.ts:1020,1530` |
| Sanity Checking | Chaves positivas, identidade do lote e estado reconhecido exigidos | ✅ presente | `BorderoGrupoBoletoService.ts:1018` |
| Condition Monitoring | Cabeçalho e item antigos relidos antes da adoção e na continuação | ✅ presente | `BorderoGrupoBoletoService.ts:639,980,1043` |
| Voting | N/A: não há réplicas independentes do estado financeiro para votação | N/A | Contrato I21s, plano de reenvio |
| Exception Detection | Exceção de leitura fecha a guarda com motivo explícito | ✅ presente | `BorderoGrupoBoletoService.ts:1058` |
| Self-Test | Regressões locais compartilhadas; prova do ERP posterior ainda pendente | ⚠️ parcial | `_shared-metrics.md`; plano de reenvio |
| Active Redundancy | N/A: duplicar escritor financeiro não integra esta correção | N/A | Escopo backend delta |
| Passive Redundancy | N/A: nenhum failover de infraestrutura no delta | N/A | `CLAUDE.md` |
| Spare | N/A: nenhuma capacidade de reserva criada | N/A | Escopo backend delta |
| Exception Handling | Leitura não comprovada produz retirada e orientação; falha transitória preserva ledger para retomada | ✅ presente | `BorderoGrupoBoletoService.ts:1058,1202` |
| Rollback | Compensação restrita ao rascunho atual aberto sem arquivo; antigo preservado | ⚠️ parcial | `BorderoGrupoBoletoService.ts:1262,1295` |
| Software Upgrade | N/A: rollout/compatibilidade de deploy não alterados | N/A | Escopo backend delta |
| Retry | Leituras usam `runWithRetry`; escritas financeiras permanecem tentativa única seguida de observação | ✅ presente | `ConexosSispagWriteClient.ts:268,608,822,1190` |
| Ignore Faulty Behavior | Não autoriza reaproveitamento com leitura ambígua; ignora falha de entrega do Alerta após gravar desfecho e registra log | ✅ presente | `BorderoGrupoBoletoService.ts:1058,1542` |
| Degradation | Grupo sai inteiro; após ausência relida do item atual, limpeza retorna `nada_a_limpar`, preservando pendência/Alerta do antigo e permitindo demais itens | ✅ presente | `RemessaService.ts:1415`; `BorderoGrupoBoletoService.ts:1318`; `RetiradaCodigoBarrasService.ts:513` |
| Reconfiguration | N/A: guarda não troca provedor nem infraestrutura | N/A | Contrato aprovado |
| Shadow | N/A: modo shadow não prova vínculo liberado; não há alteração dessa tática | N/A | Plano de reenvio |
| State Resynchronization | Releitura do rascunho determina retomada; completo com grupos volta a preparar | ✅ presente | `RemessaService.ts:1215,1276`; `ConexosSispagWriteClient.ts:911` |
| Escalating Restart | N/A: retomada de negócio substitui reinício de processo neste delta | N/A | `RemessaService.ts:385` |
| Non-Stop Forwarding | N/A: não há encaminhamento/rede com plano de controle reiniciado | N/A | Backend Express |
| Removal from Service | Retira grupo indisponível com `BORDERO_ANTERIOR_NAO_RESOLVIDO` | ✅ presente | `RemessaService.ts:1415` |
| Transactions | Retirada local atômica precede limpeza; não há transação distribuída com ERP | ⚠️ parcial | `RetiradaCodigoBarrasService.ts:508,534` |
| Predictive Model | N/A: vínculo é condição observável, não previsão; nenhuma modelagem nova requerida | N/A | Contrato aprovado |
| Exception Prevention | Não cria segundo borderô para contornar vínculo e não repete escrita cegamente | ✅ presente | `BorderoGrupoBoletoService.ts:980`; `ConexosSispagWriteClient.ts:268` |
| Increase Competence Set | Alerta explica fin015 e regularização pela analista; operação automática permanece investigação | ✅ presente | `BorderoGrupoBoletoService.ts:1013`; documento de exploração |

## 4. Findings (achados)

### F-availability-1: Recuperação degradada ainda depende de prova HML posterior à guarda

- **Severidade**: P2 (médio — lacuna de evidência de integração)
- **Tactic violada**: Self-Test / Degradation
- **Localização**: `ontology/_inbox/sispag-boleto-agrupado-reenvio-rejeitado-plano.md`, critérios de aceite; `ontology/_inbox/sispag-boleto-agrupado-reenvio-rejeitado-exploracao.md:17`
- **Evidência (objetiva)**:
  ```
  Última V7 histórica: 5/6; import no novo lote aceito, finalização recusada.
  Prova HML pós-correção nesta revisão: 0 rodadas executadas (escopo local).
  ```
- **Impacto técnico**: mocks não comprovam que leitura de itens em lote finalizado pós-retorno permite detectar o vínculo nem que a retirada preserva o antigo enquanto avulsos seguem. A limpeza corrigida retorna `nada_a_limpar` após ausência observada do item atual, mantendo o antigo pendente; os gates finais ainda dependem do coordenador.
- **Impacto de negócio**: a retomada pode continuar exigindo saneamento manual ou impedir pagamentos independentes se as pós-condições no ERP não forem atendidas; a opção automática permanece deliberadamente fora do escopo.
- **Métrica de baseline**: V7 anterior 5/6; 0 rodadas HML pós-correção realizadas neste review. Não é estimativa de disponibilidade em produção.

## 5. Cards Kanban

### [availability-1] Comprove retirada e continuidade no ERP após a guarda

- **Problema**
  > A V7 anterior terminou 5/6 devido ao vínculo residual no lote antigo. A guarda e as correções locais de retomada/limpeza ainda não têm prova HML posterior registrada; mocks não demonstram a continuidade dos demais pagamentos.

- **Melhoria Proposta**
  > Aplicar Self-Test e validar Degradation no roteiro HML aprovado, em execução separada autorizada: item ainda vinculado produz retirada de todos os títulos e Alerta acionável; antigo permanece intacto; rascunho atual é saneado sem excluir borderô reaproveitado; demais itens seguem. Exercitar retomada do rascunho completo, falha de leitura e lote esvaziado, documentando resíduos. Não automatizar liberação do lote antigo.

- **Resultado Esperado**
  > Passar de 0 provas HML pós-correção registradas para 1 execução completa com todas as pós-condições documentadas antes do merge, incluindo ausência de importação indevida e de mutação no antigo.

- **Tactic alvo**: Self-Test / Degradation
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Prova HML pós-correção registrada: 0 → 1 execução completa aprovada.
  - Importações do grupo com vínculo persistente: alvo 0 na execução observada; baseline pós-correção não medido.
  - Mutações do lote/borderô antigos pela guarda: alvo 0 na execução observada; baseline pós-correção não medido.
- **Risco de não fazer**: manter por seis meses um caminho localmente validado sem confirmação da recuperação no ERP, acumulando bloqueios e intervenção manual em rejeições.
- **Dependências**: gates finais do coordenador após correções de retomada e limpeza; execução HML separada conforme Task 21. Nenhuma chamada ERP autorizada por este card/review.

## 6. Notas do agente

Revisão quick do delta backend Express/Render, sem rede, ERP, DB ou repetição de gates.
Referências sem prefixo na seção 3 pertencem a `src/backend/domain/service/sispag/`, exceto o client em `src/backend/domain/client/`.
Retomada completa e limpeza reaproveitada corrigidas foram inspecionadas; coordenador informou 313/313 testes focados, com gates finais em execução.
Limites da prova HML cruzam testability/fault-tolerance; consolidar o acompanhamento para evitar tickets duplicados.
Alerta best-effort mantém motivo no ledger/log; não foi tratado como dívida geral nova do delta.
