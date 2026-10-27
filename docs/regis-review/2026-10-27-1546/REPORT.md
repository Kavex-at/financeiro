---
type: regis-review-report
run_id: 2026-10-27-1546
generated_at: 2026-10-27T16:00:53.818286+00:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice
total_cards: 2
source_cards: 4
total_p0: 0
total_p1: 1
total_p2: 1
total_p3: 0
overall_score: 7.97
---

# Regis-Review — financeiro — 2026-10-27-1546

Revisão quick do delta backend da guarda de reenvio de boleto agrupado rejeitado. Correção imediata implementada; não há novo defeito de código identificado após os ajustes de retomada completa/parcial e limpeza. **Merge continua bloqueado pela prova HML V7 pós-guarda (Task 21).** Task 22 permanece gate original separado da feature, fora deste recorte. Liberação seletiva automática permanece exploração.

## 1. Executive scorecard

Pesos: Security 1,5; Fault Tolerance 1,3; Availability 1,2; Modifiability 1,2; Testability 1,0; Performance 1,0; Integrability 0,9; Deployability 0,9. Soma 9,0; média ponderada 7,97/10. Nota do delta, sem representar maturidade global ou autorizar merge.

| QA | Score | P0 | P1 | P2 | P3 | Principal achado |
|---|---|---|---|---|---|---|
| Availability | 8,0 | 0 | 0 | 1 | 0 | F-availability-1: prova HML pendente |
| Deployability | 7,0 | 0 | 1 | 0 | 0 | F-deployability-1: gate operacional pré-merge |
| Integrability | 8,0 | 0 | 0 | 1 | 0 | F-integrability-1: normalização permissiva herdada |
| Modifiability | 8,0 | 0 | 0 | 0 | 0 | Nenhum adicional no delta |
| Performance | 8,0 | 0 | 0 | 0 | 0 | Nenhum gargalo medido |
| Fault Tolerance | 8,5 | 0 | 0 | 0 | 0 | Nenhum adicional no delta |
| Security | 8,0 | 0 | 0 | 0 | 0 | Nenhum adicional no delta |
| Testability | 8,0 | 0 | 0 | 1 | 0 | F-testability-1: mesma prova HML pendente |
| **Fontes: 4 findings / 4 cards** | **7,97** | **0** | **1** | **3** | **0** | 3 registros descrevem a mesma ação HML |
| **Ações deduplicadas: 2** | — | **0** | **1** | **1** | **0** | deployability-1 + integrability-1 |

Interpretação: 0–3 risco estrutural; 4–6 dívida a endereçar; 7–8 saudável com oportunidades pontuais; 9–10 referência para o estágio. Contagens limitadas à evidência deste delta.

Gates finais do coordenador: **305 suites / 5979 testes aprovados (89,147 s)**; typecheck exit 0; lint exit 0 em 943 arquivos, 124 warnings, mesma contagem da baseline; `git diff --check` exit 0. Revisão focada: **4 suites / 314 testes**. Resultados finais de [_shared-metrics.md](_shared-metrics.md) prevalecem sobre referências iniciais a gates em andamento nas seções.

## 2. Riscos consolidados (2 sustentados pela evidência)

### R-1: Prontidão operacional depende da prova HML pós-guarda — P1

- **QAs / findings**: [F-deployability-1](deployability.md#4-findings-achados), [F-availability-1](availability.md#4-findings-achados), [F-testability-1](testability.md#4-findings-achados).
- **Evidência**: V7 histórica 5/6, com importação aceita e finalização recusada por vínculo antigo; 0 rodadas HML pós-correção. Localmente, 314 testes focados passam; isso não prova o contrato Conexos. Tactics: Scale Rollouts, Self-Test / Degradation e Recordable Test Cases.
- **Impacto técnico e de negócio**: liberar sem demonstrar retirada integral, preservação do antigo e continuidade dos demais itens mantém incerteza sobre nova finalização e intervenção da analista.
- **Card**: deployability-1, incorporando availability-1 e testability-1. Manter merge bloqueado até evidência saneada aprovada.
- **Custo de inação em 6 meses**: se houver novos reenvios rejeitados, pode persistir retrabalho manual; frequência e custo financeiro não medidos. Não é previsão de incidente.

### R-2: Envelope bruto inválido pode ser normalizado como ausência — P2

- **QA / finding**: [F-integrability-1](integrability.md#4-findings-achados).
- **Evidência**: `legacyConexosAdapter.ts:48-50` normaliza `rows` inválido para `[]` e `count` ausente para tamanho; cabeçalho contém defaults herdados. A guarda consome esse boundary como prova negativa. Tactic: Adhere to Standards.
- **Impacto técnico e de negócio**: condicionado a drift do ERP, resposta HTTP 200 inválida pode permitir avanço e recriar recusa tardia. Sem incidente atual comprovado; sem taxa de drift medida.
- **Card**: integrability-1, já registrado nos follow-ups existentes. Leitura estrita e fixtures adapter→cliente devem distinguir vazio válido de resposta inválida.
- **Custo de inação em 6 meses**: se o contrato mudar de forma incompatível, poderá exigir saneamento manual; probabilidade e valores não medidos.

Não há evidência para dez riscos independentes nem para um terceiro risco material.

## 3. Cross-cutting findings

### CC-1: Evidência operacional ausente é um único gate em três QAs

Availability, Deployability e Testability registram a mesma raiz: 0 provas pós-correção frente à V7 anterior 5/6. Executar uma rodada HML autorizada da Task 21 e anexar evidência saneada resolve os três registros, se todas as pós-condições forem satisfeitas. Card único: deployability-1; aliases de origem: availability-1 e testability-1. Medir duração, grupos e páginas nessa rodada, conforme Performance, sem inventar orçamento de latência.

O boundary de normalização interessa também a Fault Tolerance/Testability, mas só Integrability abriu finding próprio. Não é contado como três achados independentes nem justifica outras ações sem evidência.

## 4. Quick wins (≤5 dias úteis)

| Card | QAs | Esforço | Prioridade | Resultado esperado |
|---|---|---|---|---|
| deployability-1 | Deployability, Availability, Testability | S (≤1d) | P1 | 0 → ≥1 rodada HML aprovada; grupo RETIRADO, alerta, antigo intacto e demais itens seguem |
| integrability-1 | Integrability | S (≤1d) | P2 | Rejeitar envelopes inválidos sem confundir ausência válida; fixtures estritas |

A estimativa de execução não inclui espera por ambiente/fixture. Estes cards registram trabalho futuro; não autorizam chamadas ERP nesta revisão.

## 5. Strategic moves (M / L / XL)

Nenhum card desse porte sustentado pelo delta. Não se reabriu dívida preexistente dos serviços grandes nem se propôs migração de infraestrutura.

## 6. O que está bem (e por quê)

- **Encapsulate / Restrict Dependencies**: uma guarda privada compartilhada por dois pontos; nenhum client, tabela ou dependência novo.
- **State Resynchronization / Idempotent Replay**: retomadas completa e parcial passam por preparação; duas regressões verificam o caminho.
- **Compensating Transaction / Limit Access**: limpeza restrita ao item do rascunho atual, após releitura; cenário composto preserva borderô antigo, três baixas e avulso saudável.
- **Sanity Checking / Executable Assertions**: quatro estados com vínculo e sete casos tipados de leitura/chaves inconclusivas cobertos. Essa evidência não cobre drift bruto normalizado pelo adapter.
- **Sandbox / Abstract Data Sources**: serviços reais de retirada e borderô compõem com dependências externas substituídas; 314 testes focados aprovados.
- **Manage Resources / Bound Execution Times**: leitura limitada a 40 páginas de 500 e HTTP com timeout de 40 s. Custo real por lote não medido; retries/sessão podem adicionar chamadas físicas.
- **Inform Actors / Audit Trail**: motivo BORDERO_ANTERIOR_NAO_RESOLVIDO e alerta acionável; falha best-effort de entrega mantém desfecho/log. Sem liberação automática do antigo.

## 7. Limitações da análise

- Snapshot local de 2026-10-27, escopo backend Express/Render. Sem ERP, banco de produção, rede, frontend ou nova execução HML. Lambda/Terraform são alvo, não runtime atual. Reavaliar após prova operacional e periodicamente conforme evolução.
- Não medidos: disponibilidade/MTTR reais; latência p50/p95, throughput, volume e custo por lote; tempo de intervenção; lead time, sucesso de deploy e rollback real; coverage executada por camada/delta; flakiness histórica; drift real do ERP; complexidade AST/grafo completo e custo de mudança.
- Sem chaos engineering, threat modeling formal, custo cloud, UX, acessibilidade, novo audit de dependências, build final próprio ou comprovação de CI remoto. Gates locais não substituem essas evidências.
- Zero findings em quatro QAs significa nenhum adicional demonstrado neste delta; não certifica ausência de falhas em todo o sistema. Falhas corrigidas de retomada/limpeza não são contadas novamente.
- KANBAN tem **2 ações únicas**; as **4 fichas fonte** (P1=1, P2=3) foram preservadas verbatim em anexo para rastreabilidade. availability-1 e testability-1 são aliases da ação deployability-1. Cabeçalhos de contagem distinguem fontes de ações.
- A guarda fecha os cenários tipados de erro inspecionados; não se afirma fail-closed universal perante drift bruto, pois F-integrability-1 documenta o limite herdado. Esse P2 permanece follow-up, sem reclassificação para defeito novo crítico.

## 8. Ações recomendadas

1. Manter merge bloqueado; preparar e executar no ciclo autorizado a prova V7 pós-guarda da Task 21 (**deployability-1**, cobrindo availability-1/testability-1), incluindo retomadas, retirada integral, alerta, zero mutações antigas e continuidade após ausência do item atual.
2. Registrar evidência saneada e duração/grupos/páginas nessa mesma ação; converter divergências observadas em fixtures, sem usar importação isolada como critério de sucesso (**deployability-1**).
3. Tratar o boundary bruto no follow-up existente com fixtures fin015 e teste adapter→cliente, preservando consumidores fora do escopo (**integrability-1**).
4. Ao avaliar merge após a prova, verificar também o gate original Task 22 fora deste review. Manter liberação seletiva automática como exploração separada, sem confundi-la com a guarda implementada (**deployability-1**, dependência).


## Complemento local — controle com boleto sintético

Preparado `CONTROL_DOC=doc/tit` para a V7: título avulso fora de `DOCS`, semeado no banco local com
boleto sintético próprio e confirmado por `BoletoSuggestionService`. Modalidade BOLETO explícita e
vínculo por título `FIL:on` só neste cenário; entra apenas no segundo lote, após a rejeição do grupo.
Não é necessário criar boleto/DDA bancário real. Fixture sugerida: AR SOLUÇÕES (`pesCod 121`), filial 2,
R$ 50,00, vencimento futuro igual ao do par; finalizado, aprovado, não pago e fora de lote.

A prova verifica item antigo presente antes do retry; snapshots exatos por SHA256 preservados;
retirada do novo ledger sem adoção/importação; grupo fora do lote local/nativo/arquivo; exatamente o J
do controle com barra/valor corretos; alerta novo da guarda com contexto do vínculo antigo. Contexto
inconclusivo interrompe antes do segundo lote. Não confundir máscaras de barras com identidade.

Validação local após esta extensão: **75 testes do probe aprovados**, typecheck exit 0, Biome limpo nos
três arquivos e `git diff --check` exit 0. Revisão independente identificou e corrigiu ausência de
modalidade do controle e colisão de máscaras; sem bloqueador concreto remanescente no diff revisado.
Nenhuma chamada HML executada; IDs dos três títulos e autorização de escrita ainda necessários.
