---
type: regis-review-report
run_id: 2026-08-12-1315
generated_at: 2026-08-12T13:15:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: delta da branch fix/nde-descricao-item (worktree /home/inteli/kavex-worktrees/nde-descricao-item) — 20 arquivos, +1458/-13 LOC
total_cards: 28
total_p0: 0
total_p1: 6
total_p2: 6
total_p3: 16
overall_score: 7.7
---

# Regis-Review — financeiro — 2026-08-12-1315

> **Escopo**: SOMENTE o delta de `fix/nde-descricao-item` contra `main` (nova `etapaDescricaoItem`, 5 métodos novos no `ConexosNdeFiscalClient`, env opcional `NDE_DESCRICAO_ITEM_FALLBACK`, ADR-0036, business-rule `descricao-item-nde` / I-Receb-5, sonda read-only). **NÃO é um raio-X da plataforma.** As dívidas herdadas da `main` que aparecem estão explicitamente marcadas — o autor do delta não deve levar a culpa da dívida da plataforma, e a dívida da plataforma não deve ser lavada por um delta bom.
>
> **Não houve nenhum achado P0.** É um resultado, não uma omissão. O delta é um patch fiscal defensivo (fail-closed antes de qualquer escrita irreversível), com discriminador de sucesso explícito, RMW correto por `passthrough()`, cadeia de 4 fallbacks e cobertura de teste ~1,5:1 sobre código novo. O que sobra na fila são melhorias (P1–P3), não bloqueios.
>
> **Nota de numeração:** este relatório foi gerado quando o ADR desta feature era o `0034`. A `main` publicou `0034` e `0035` enquanto a branch estava no gate, então o ADR foi renumerado para **0036**. As referências abaixo já apontam para `ADR-0036`.

## 1. Executive scorecard

Pesos aplicados (perfil financeiro / SaaSo multi-tenant que executa escritas irreversíveis em ERP fiscal):

| QA | Peso |
|---|---|
| Security | 1.5 |
| Fault Tolerance | 1.3 |
| Availability | 1.2 |
| Modifiability | 1.2 |
| Testability | 1.0 |
| Performance | 1.0 |
| Integrability | 0.9 |
| Deployability | 0.9 |
| **Total** | **9.0** |

`overall_score = Σ(score × peso) / 9.0 = 69.1 / 9.0 = **7.7**`.

| QA | Score | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 7.5 | 0 | 1 | 1 | 2 | F-availability-1: `ConexosBaseClient` sem `timeout:` no axios — herdado, agravado por 3–4 chamadas novas no caminho síncrono |
| Deployability | 8.0 | 0 | 0 | 1 | 3 | F-deployability-1: ACL `PUT com297/comDocProdutos` só está no ADR — ausente do runbook e não distinguível no preflight |
| Integrability | 8.0 | 0 | 0 | 1 | 2 | F-integrability-1: preflight ACL casa `com297` por substring — falha "só HOMOLOGAR sem UPDATE ITEM" descoberta em runtime |
| Modifiability | 8.0 | 0 | 1 | 0 | 3 | F-modifiability-1: `RecebimentoNumerarioService` a 1897 LOC (3,16× soft cap) — dívida herdada, delta agrava marginalmente +6,7% |
| Performance | 7.0 | 0 | 0 | 0 | 4 | F-performance-2: loop sequencial 3×N chamadas por item vazio; hoje N=1, sem carga simulada para N>1 |
| Fault Tolerance | 7.0 | 0 | 2 | 3 | 0 | F-fault-tolerance-2: `slice(0, 4000)` em code units UTF-16 contra `VARCHAR2(4000 BYTE)` — vetor concreto pela env de fallback |
| Security | 8.0 | 0 | 0 | 2 | 2 | F-security-1: `dprLngDescrNf` sem sanitização de `\p{Cc}`/BOM/direction-override — texto vira `xProd` da NF-e sem revisão |
| Testability | 8.0 | 0 | 2 | 1 | 3 | F-testability-1: fixture do `prdDesNome` (`'PAGAMENTO ANTECIPADO'`) colide com `NDE_GERACAO_DEFAULTS.produtoNome` — teste do fallback #3 dá verde por acaso |
| **Overall** | **7.7** | **0** | **6** | **6** | **16** | — |

Score interpretation:
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais ← **estamos aqui**
- 9–10: estado-da-arte para o estágio atual

Leitura direta: o delta em si é saudável (todos os QAs em ≥ 7); o cursor aponta duas dívidas herdadas relevantes (`RecebimentoNumerarioService` oversize e 14 testes red no baseline) e dois erros técnicos concretos introduzidos pelo delta que são baratos de corrigir (byte-truncation, colisão de fixture).

## 2. Top 10 risks (cross-QA)

Ranking por composite = severidade × impacto de negócio × leverage (custo/benefício da correção). "Herdado" e "introduzido pelo delta" declarados por item.

### R-1: Truncamento em code units UTF-16 pode ser rejeitado pelo Oracle com texto pt-BR acentuado
- **QA(s) afetados**: Fault Tolerance, Security
- **Findings de origem**: F-fault-tolerance-2 (`ConexosNdeFiscalClient.ts:79-80,389`)
- **Origem**: **introduzido pelo delta**
- **Evidência sintetizada**: `descricao.trim().slice(0, 4000)` conta code units UTF-16; Oracle `VARCHAR2(4000 BYTE)` conta bytes. Texto pt-BR acentuado (2 bytes/char) em 4000 chars = ~8000 bytes → `ORA-01461`/`ORA-12899`. Vetor concreto: env `NDE_DESCRICAO_ITEM_FALLBACK` (texto fixado pelo fiscal, sem enforcement de tamanho). Vetor secundário: `preDescrProdutoNf` devolvendo texto derivado da DI.
- **Impacto técnico**: `putGenericOnce` falha com `ConexosError('com297/comDocProdutos')` sem contexto do truncamento. Fail-closed protege o dado, mas a correção "aumentar o env" é enganosa — o problema é a unidade de corte.
- **Impacto de negócio**: primeira execução para cliente com fallback fiscal customizado longo trava; suporte diagnostica manualmente. Dá impressão de "a solução do bug tem outro bug".
- **Cards Kanban relacionados**: `fault-tolerance-2`
- **Custo de inação em 6 meses**: probabilidade cresce com cada tenant novo que customize o texto. Premissa: pelo menos 1 tenant customiza em 6m. Custo esperado: 4h de diagnóstico + 1 execução travada por incidente.

### R-2: RMW do item da NDe sem controle otimista de versão pode destruir edição concorrente
- **QA(s) afetados**: Fault Tolerance, Modifiability, Testability
- **Findings de origem**: F-fault-tolerance-1 (`ConexosNdeFiscalClient.ts:298-320,383-419`; `RecebimentoNumerarioService.ts:1476-1490`)
- **Origem**: **introduzido pelo delta** (classe de risco herdada do `com300`, replicada no `com297/comDocProdutos`)
- **Evidência sintetizada**: `GET → mutate → PUT` do objeto INTEIRO (`.passthrough()` preserva ~105 campos) sem `If-Match`/`dprCodAlt`/timestamp. Janela: milissegundos entre `lerItemNde` e `gravarDescricaoItemNde`. Discriminador de sucesso verifica presença de `dprLngDescrNf`, não igualdade com o enviado.
- **Impacto técnico**: analista editando o item no UI do Conexos entre GET e PUT tem a mudança silenciosamente sobrescrita — inclusive em campos que a automação nem quis alterar (`dprPreValorun`, `ctpCod`, `prdQtdQuantidade`). Eco retorna válido, fluxo segue para homologação.
- **Impacto de negócio**: NF-e sai homologada com valor de item errado — sem alerta, sem log de conflito, sem forma de reverter. Descoberto só na auditoria SEFAZ ou reclamação do cliente. Fluxo é human-in-the-loop por design — analista ativo no doc é a norma.
- **Cards Kanban relacionados**: `fault-tolerance-1`
- **Custo de inação em 6 meses**: baixa frequência (janela ~10ms), mas cada incidente é uma NF-e errada. Premissa: 1 ocorrência em 6m; consequência é retificação fiscal, não perda de receita imediata, mas rastro fica ruim.

### R-3: Colisão de fixture entre fallbacks #3 e #4 mascara regressão do próprio bug consertado
- **QA(s) afetados**: Testability, Fault Tolerance (invariante fiscal)
- **Findings de origem**: F-testability-1 (`RecebimentoNumerarioService.test.ts:1528-1584`; `constants.ts:364-366`)
- **Origem**: **introduzido pelo delta**
- **Evidência sintetizada**: fixture usa `prdDesNome: 'PAGAMENTO ANTECIPADO'`, string IDÊNTICA ao `NDE_GERACAO_DEFAULTS.produtoNome`. Regressão que suprima o ramo #3 e caia no #4 fica invisível. Ramo #4 isolado não tem teste.
- **Impacto técnico**: teste dá verde por coincidência de string. `resolverDescricaoItem` tem 4 ramos; suíte prova #1>#2 e #2>#3, nunca prova #3 vs #4.
- **Impacto de negócio**: descrição errada no `xProd` é o motivo pelo qual a homologação estava falhando — é o problema que este delta veio consertar. Teste que passa por acaso permite reintroduzir a falha original sem sinal.
- **Cards Kanban relacionados**: `testability-1`
- **Custo de inação em 6 meses**: refatoração que colapse #3 e #4 "para simplificar" passa despercebida. Probabilidade ~20% em 12m.

### R-4: `ConexosBaseClient` sem timeout HTTP — dívida herdada, agravada pelo delta
- **QA(s) afetados**: Availability, Fault Tolerance
- **Findings de origem**: F-availability-1 (`ConexosBaseClient.ts`, `ConexosLegacyClient.ts` — `grep 'timeout:'` só encontra `BcbClient`)
- **Origem**: **HERANÇA da main** — agravada pelo delta (3–4 chamadas Conexos síncronas novas no caminho "Processar")
- **Evidência sintetizada**: nenhum cliente Conexos configura `timeout:` no `axios.create` (só `BcbClient.ts:57`). Delta soma `listItensNde` + `lerItemNde` + `gravarDescricaoItemNde` (+ opcional `preDescricaoProdutoNf`) a caminho síncrono que já executa SN, borderô, NDe, com300, com131, homologar e poll SEFAZ.
- **Impacto técnico**: chamada travada não retorna nunca; `RetryExecutor` só age em erro; timeout do proxy Render mata a conexão mas processo Node continua com handle pendente.
- **Impacto de negócio**: analista vê "Processar" pendurar; execução pode ter sucedido no ERP mas front reporta erro. **Não é falha do delta — é dívida herdada que o delta ativa mais.**
- **Cards Kanban relacionados**: `availability-1`
- **Custo de inação em 6 meses**: probabilidade linear no número de manutenções do ERP + etapas. Delta somou 3–4 pontos. Correção é uma linha por cliente — custo comparativo absurdo.

### R-5: 14 testes red permanentes no baseline destroem valor semântico do CI
- **QA(s) afetados**: Testability, Deployability
- **Findings de origem**: F-testability-6 (`_shared-metrics.md:36`)
- **Origem**: **HERANÇA da main** — verificado em worktree pristino
- **Evidência sintetizada**: `npm test` → 1132 passed / 14 failed, conjunto idêntico ao da `main`. CI roda `npm test -- --coverage` — ou está red permanente ou algo mascara; qualquer caso destrói o sinal.
- **Impacto técnico**: regressão real do delta é indistinguível de "aquela falha antiga" no primeiro olhar. Signal-to-noise 98,8%, mas o inverso (1 falha nova entre 14) exige diff manual.
- **Impacto de negócio**: cada PR re-negocia significado de "verde"; testes viram folclore em vez de gate.
- **Cards Kanban relacionados**: `testability-6`
- **Custo de inação em 6 meses**: velocidade decrescente de code review + risco de regressão silenciosa. **Priorizar triagem** (bug real vs. flake) antes de qualquer outra métrica de testabilidade valer alguma coisa.

### R-6: `RecebimentoNumerarioService` a 1897 LOC — 3,16× o soft cap Bass
- **QA(s) afetados**: Modifiability, Testability
- **Findings de origem**: F-modifiability-1 (arquivo), F-testability-2 (teste dele: 1692 LOC, top-1 do repo)
- **Origem**: **HERANÇA da main** — delta contribui +120 LOC (+6,7%), não é regressão
- **Evidência sintetizada**: 1897 LOC, 38 métodos privados, 2 públicos. Cauda fiscal (`etapaNotaDebito`/`etapaDescricaoItem`/`etapaFiscal`/`etapaObservacoes`/`etapaHomologar`/`etapaPoll`) é subsistema coeso reconhecível.
- **Impacto técnico**: cada `/feature-tweak` sobre cauda fiscal cai neste arquivo. Testar em unidade exige mockar 8 colaboradores. Merge Conflict Hell com paralelo de Permutas é questão de tempo.
- **Impacto de negócio**: velocidade decrescente na Frente Recebimentos.
- **Cards Kanban relacionados**: `modifiability-2`, `testability-2`
- **Custo de inação em 6 meses**: 1–2 features somam mais 200–400 LOC. Split que hoje é L vira XL. **Não executar como PR isolado** — no próximo `/feature-tweak` que tocar ≥ 2 `etapa*` fiscais.

### R-7: Rastro da correção não persiste no ledger — auditoria depende de retenção de log (cross-cutting)
- **QA(s) afetados**: Fault Tolerance, Security, Availability
- **Findings de origem**: F-fault-tolerance-5, F-security-4, F-availability-2
- **Origem**: **introduzido pelo delta** (decisão de auto-idempotência; consequência não medida)
- **Evidência sintetizada**: única prova de que a Kavex reescreveu `dprLngDescrNf` é o log `BUSINESS_WARN`. Sem contador/histograma/alarme; sem coluna dedicada no `solicitacao_numerario_execucao`. Consulta "quantas NDes precisaram do fix este mês" é `grep` de log.
- **Impacto técnico**: se log perdido (rotacionado), cego para essa classe de mutação. Sem alarme para "taxa de correção subiu abruptamente" (indicaria cadastro em massa OU regressão do `preDescrProdutoNf`).
- **Impacto de negócio**: em disputa fiscal ("quem escreveu esse texto no meu `xProd`?"), resposta sai de log estruturado com risco de já ter caído da janela de retenção.
- **Cards Kanban relacionados**: `xqa-2` (unificado)
- **Custo de inação em 6 meses**: a regressão silenciosa do `preDescr` só é descoberta pela primeira homologação recusada — proposta da etapa é PREVENIR isso.

### R-8: Sanitização ausente do `dprLngDescrNf` que vira `xProd` da NF-e
- **QA(s) afetados**: Security
- **Findings de origem**: F-security-1 (`ConexosNdeFiscalClient.ts:389`)
- **Origem**: **introduzido pelo delta**
- **Evidência sintetizada**: só `trim` + `slice(4000)`. Nada bloqueia `\x00..\x1F` (exceto `\t\n\r`), BOM, direction-override, zero-width joiners, PUA. Vetor: env `NDE_DESCRICAO_ITEM_FALLBACK` colada com BOM ou aspas curly do Word.
- **Impacto técnico**: pior caso realista = rejeição SEFAZ com mensagem opaca. Também: char de controle "quebrar" tooling downstream (parser PDF, ledger contábil do cliente).
- **Impacto de negócio**: texto entra pelo deploy sem loop humano na trilha. Contamina N notas até alguém rodar uma NDe e sentir.
- **Cards Kanban relacionados**: `security-1`
- **Custo de inação em 6 meses**: baixa frequência, alta variância. Um caractere invisível destrói uma tarde de fiscal.

### R-9: ACL preflight casa `com297` por substring — 3 QAs marcaram o mesmo bug (cross-cutting)
- **QA(s) afetados**: Deployability, Integrability, Security
- **Findings de origem**: F-deployability-1, F-integrability-1, F-security-2 (`NumerarioAclChecker.ts:19-24`)
- **Origem**: **HERANÇA da main** — o checker é pré-existente; o delta introduz um verbo novo (`PUT com297/comDocProdutos` = "alteração de item") que casa por acidente com "HOMOLOGAR"
- **Evidência sintetizada**: `ACL_REQUERIDAS = ['com300', 'com131', 'com297', 'com194']` com `texto.includes(...)`. Tenant com HOMOLOGAR mas sem UPDATE ITEM passa no preflight e falha em runtime como 403 cru.
- **Impacto técnico**: fail-closed protege dado (é antes da leg fiscal), mas MTTR sobe: primeiro `Recebimento` do cliente afetado quebra, diagnóstico via log 403 sem contexto (mapeamento "403 aqui = ACL faltando" só existe no ADR).
- **Impacto de negócio**: em rollout de novo tenant, o primeiro `Recebimento` que dispara a etapa consome ciclos de L2. Trai a promessa "está tudo checado antes de escrever".
- **Cards Kanban relacionados**: `xqa-1` (unificado)
- **Custo de inação em 6 meses**: 1 incidente por tenant novo. Correção é S — trocar `substring('com297')` por lookup de rótulo específico.

### R-10: NDe sem linha de produto loga WARN e segue — 3 escritas desperdiçadas antes do erro real
- **QA(s) afetados**: Fault Tolerance, Performance
- **Findings de origem**: F-fault-tolerance-3 (`RecebimentoNumerarioService.ts:1463-1474`)
- **Origem**: **introduzido pelo delta**
- **Evidência sintetizada**: `if (itens.length === 0) { warn(...); return; }`. Fluxo continua para `etapaFiscal` → `etapaObservacoes` → `etapaHomologar`. 3+ escritas antes do ERP recusar por ausência de produto.
- **Impacto técnico**: cenário anômalo (contrato mudou ou doc manipulado externamente); mensagem que chega ao analista é do ERP, não da automação.
- **Impacto de negócio**: baixa frequência hoje. Ganha peso se contrato ERP mudar — vira cascata de erros obscuros.
- **Cards Kanban relacionados**: `fault-tolerance-5`
- **Custo de inação em 6 meses**: baixo em regime normal; alto em cenário de contrato mudando. Correção troca 2 linhas por `throw NumerarioGapError({...})`.

## 3. Cross-cutting findings

### CC-1: `NumerarioAclChecker` faz match por substring — o novo grant "UPDATE ITEM em com297" é indistinguível de HOMOLOGAR
- **Aparece em**: Deployability, Integrability, Security
- **Findings**: F-deployability-1, F-integrability-1, F-security-2
- **Diagnóstico unificado**: `ACL_REQUERIDAS: readonly string[]` casa `texto.includes(k.toLowerCase())`. O ADR-0036 declara explicitamente a nova ACL como consequência, mas ninguém amplia a lista de grants. Três agentes marcaram o mesmo ponto por lentes diferentes: dep viu como "pré-requisito sem trilha", int como "descoberta de serviço fraca", sec como "authorize actors parcial".
- **Recomendação consolidada**: card **`xqa-1`** — trocar strings de tela por objetos `{tela, acaoLabel}` (ou `EnumSet` de rótulos exatos), documentar no runbook Frente IV, adicionar teste "só HOMOLOGAR sem UPDATE → deny".

### CC-2: Correção da descrição só vive em log `BUSINESS_WARN` — sem ledger, sem contador, sem alarme
- **Aparece em**: Availability (Monitor), Fault Tolerance (Audit Trail), Security (Audit Trail)
- **Findings**: F-availability-2, F-fault-tolerance-5 (ledger), F-security-4
- **Diagnóstico unificado**: a decisão arquitetural de não adicionar etapa monotônica ao ledger (para preservar retomadas de `obs-done`) foi correta, mas produziu efeito colateral: auditoria da mutação depende inteiramente de retenção de log. Três lentes viram o mesmo buraco — observabilidade agregada, audit-trail persistido, rastro para disputa fiscal.
- **Recomendação consolidada**: card **`xqa-2`** — coluna `descricao_item_corrigida` (bool) + `descricao_item_fonte` (`'env'|'preDescr'|'prdDesNome'|'default'`) no `solicitacao_numerario_execucao`, gravadas no mesmo commit lógico do `setEtapa`. Habilita `SELECT COUNT(*) WHERE descricao_item_corrigida`.

### CC-3: Cobertura fraca do caso empty com N>1 — testabilidade + performance se cruzam
- **Aparece em**: Testability, Performance
- **Findings**: F-testability-3, F-performance-2
- **Diagnóstico unificado**: hoje N=1 em 100% dos casos observados. Os 4 e2e de rota só programam caminho no-op; unit test cobre o ramo escrita mas com N=1. Implementação usa `for..of await` sequencial. Se cliente novo produzir NDe multi-item vazia, ninguém sabe o que acontece — correção nem latência.
- **Recomendação consolidada**: card **`xqa-3`** — (a) adicionar e2e que devolve `dprLngDescrNf: null` na 1ª chamada e verifica o `PUT`; (b) teste com N>1 (2 itens vazios) para demonstrar comportamento sequencial; (c) implementar concorrência SÓ SE F-performance-3 provar que a proporção justifica. Não paralelizar preventivamente.

### CC-4: Dívida herdada do `RecebimentoNumerarioService` (arquivo + arquivo de teste)
- **Aparece em**: Modifiability, Testability
- **Findings**: F-modifiability-1 (1897 LOC, 3,16× cap), F-testability-2 (teste dele: 1692 LOC, top-1 do repo)
- **Diagnóstico unificado**: pré-existente na main. Delta absorve corretamente no padrão `etapa*` (não é regressão), mas empurra o problema. Cauda fiscal já é subsistema coeso reconhecível.
- **Recomendação consolidada**: cards **`modifiability-2`** (extrair `NdeCaudaFiscalService`) e **`testability-2`** (arquivo de teste dedicado). Executar no próximo `/feature-tweak` que tocar ≥ 2 `etapa*` fiscais, para amortizar migração de testes. **Não executar como PR isolado.**

## 4. Quick wins (≤5 dias úteis)

Cards com esforço S e severidade ≥ P2. Proposta de "primeira sprint pós-aprovação".

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| `fault-tolerance-2` | Fault Tolerance | S | P1 | `Buffer.byteLength(descricao, 'utf8') <= 4000` garantido; 2 testes novos (limite com acentos + surrogate na borda); primeiro tenant com fallback longo acentuado deixa de quebrar |
| `testability-1` | Testability | S | P1 | Fallbacks #3 e #4 distinguíveis por fixture; 4/4 ramos de `resolverDescricaoItem` com teste dedicado; regressão do ramo #3 vira teste vermelho |
| `availability-1` | Availability / Fault Tolerance | S | P1 | `timeout:` explícito no `ConexosBaseClient` (15s GETs, 30s PUTs write-once); nenhuma chamada Conexos pode segurar event loop indefinidamente |
| `xqa-1` | Deployability + Integrability + Security | S | P2 | Grant "UPDATE ITEM em com297" distinguível no preflight; teste "só HOMOLOGAR → deny"; ACLs por-tela documentadas no runbook |
| `security-1` | Security | S | P2 | Sanitização NFC + strip `\p{Cc}` + colapso whitespace no boundary do client; 4 testes (BOM, direction-override, control char, CRLF) |
| `fault-tolerance-5` | Fault Tolerance | S | P2 | `throw NumerarioGapError({...})` quando `itens.length === 0`; 3 round-trips desperdiçados → 0; erro da automação, não do ERP |
| `fault-tolerance-4` | Fault Tolerance | S | P2 | Determinismo do fallback documentado OU priorizado localmente; teste "flake do preDescr entre retomadas produz mesmo texto" |

Total: 7 cards. Custo total ~5–6d de dev. **A defesa em reunião: dos 6 P1 + 6 P2, 4 P1 e 3 P2 são todos S — comprar essa fatia elimina metade da fila com esforço mínimo.**

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| `xqa-2` | Availability + Fault Tolerance + Security | M | Monitor + Audit Trail | Uma coluna + um contador resolvem 3 findings de QAs distintos. Habilita `SELECT COUNT(*) WHERE descricao_item_corrigida` (baseline hoje = `grep` de log = inobservável) e destrava alarme "corrigidas/total > 30%/dia". Sem isso, a etapa é reativa — e o propósito dela é PREVENIR homologação recusada. |
| `xqa-3` | Performance + Testability | S+M | Sandbox / Increase Concurrency (gated) | Fecha o único ponto cego real do delta (N>1 empty). E2E cobrindo ramo de escrita: 0/4 → 1. Ganha defesa em profundidade em caminho fiscal irreversível. Concorrência SÓ SE `performance-3` provar necessidade — evita otimização especulativa. |
| `testability-6` | Testability + Deployability | M | Baseline hygiene | 14 red permanentes = signal-to-noise 98,8%, mas 1 falha nova entre 14 é indistinguível sem diff manual. Sem essa triagem, TODA outra métrica de testabilidade daqui pra frente fica com valor semântico reduzido. |
| `modifiability-2` | Modifiability + Testability | L | Split Module + Increase Semantic Coherence | Alvo: orquestrador 1897 → ≤ 900 LOC; métodos privados 38 → ≤ 20; colaboradores mockados na cauda fiscal 8 → 1. Fazer no próximo `/feature-tweak` que toque ≥ 2 `etapa*` fiscais. **Não fazer como PR isolado.** |
| `fault-tolerance-1` | Fault Tolerance + Modifiability | M | Detect Faults · Comparison | Investigar campo de versão no swagger `ComDocProdutosFisFin` (`dprCodAlt`/`dprDatAlt`). Se existe: comparar antes de aceitar eco. Se não: documentar aceitação explícita + sonda "dprPreValorun lido X, gravado X → se divergir, alerta". O risco é NF-e emitida com valor errado — descoberto só na auditoria SEFAZ. |
| `testability-4` | Testability + Integrability | M | Recordable Test Cases | HAR real versionado em `__fixtures__/` — fixtures inline têm 7 campos vs ~105 do schema `ComDocProdutosFisFin`. Regressão contratual só aparece em produção. Cobertura de campos preservados por `.passthrough()`: 1 → ≥ 10. |

## 6. O que está bem (e por quê)

1. **Fail-closed antes de escrita irreversível**. Etapa 3.5 roda ANTES de `etapaFiscal`/`etapaObservacoes`/`etapaHomologar`; falha marca `status=error, etapa=nota-debito` sem tocar com300/com131/homologar. Tactic Bass: Exception Handling. Evidência: `RecebimentoNumerarioService.ts:455-456,489-491`; teste `:1635-1646`.
2. **Discriminador de sucesso explícito, não HTTP 200**. Cliente rejeita PUT como falha se eco do `dprLngDescrNf` vier vazio (`ConexosNdeFiscalClient.ts:404-413`). Tactic: Verify Message Integrity.
3. **Auto-idempotência pelo estado do documento (não etapa monotônica no ledger)**. Decisão explícita: `dprLngDescrNf !== undefined ⇒ continue`. Preserva retomada de execuções paradas em `obs-done`. Tactic: State Resynchronization. ADR-0036 explicita trade-off.
4. **Cadeia de 4 fallbacks para o texto**. Env → `preDescrProdutoNf` → `prdDesNome` → default hardcoded. Nunca devolve vazio. Tactic: Degradation.
5. **`preDescricaoProdutoNf` é degradação apropriada** — best-effort com try/catch que devolve `undefined`, não derruba a etapa. Tactic: Ignore Faulty Behavior. Correto por design (é uma sugestão).
6. **RMW correto: GET inteiro (`.passthrough()`, ~105 campos) → PUT inteiro modificado**. Sem risco de "campo omitido vira null". Tactic: Transactions.
7. **Encapsulate + Restrict Communication Paths exemplares**. 4 novos endpoints ERP incorporados sem adicionar cliente novo, sem vazar HTTP, com discriminador próprio por etapa. Substituir o ERP amanhã continua sendo "trocar 1 client".
8. **Ontologia acompanha o delta**. ADR-0036 declara `entity_changed=false` explicitamente, amenda ADRs 0022+0024, lista alternativas descartadas com justificativa fiscal (não só técnica) e enumera consequências operacionais. Padrão que a ontologia deveria produzir sempre.

## 7. Limitações da análise

**Métricas declaradas "não medíveis localmente" pelos agents**:
- Latência p95 real do "Processar" antes × depois do delta em tenant produtivo.
- MTTR real quando a etapa começa a falhar em massa.
- Taxa real de conflito com edição humana concorrente do item.
- Taxa real de NDes com `dprLngDescrNf` vazia por cliente (requer sonda `recebimentos.e2e.descricaoNfeNde.integration.test.ts` com credenciais e docCods reais).
- Taxa real de 403 no primeiro real-run pós-configuração de ACL.
- `% cobertura de branch NO delta` isolado (jest emite por arquivo, não por diff). Recomendação: `npx jest --coverage --changedSince=main`.
- Tempo real de build+deploy no Render; MTTR de rollback.

**O que este pipe NÃO cobre**: chaos engineering, threat modeling formal, custo cloud, UX/acessibilidade, `npm audit` (não há dep nova no delta).

**Janela temporal**: snapshot do dia 2026-08-12 sobre `fix/nde-descricao-item`. Refazer trimestralmente sobre `main` (sem escopo de branch).

**Escopo do run**: EXPLICITAMENTE restrito ao delta. Métricas globais de plataforma não recalculadas.

**Notas de consolidação**:
- 4 pares/trios de cards duplicados unificados em `xqa-1`..`xqa-4`. Distribuição original 34 → 28 no KANBAN. Cada `xqa-*` cita IDs originais.
- IDs originais preservados nos cards não-unificados. Nada renomeado silenciosamente.
- Card `deployability-3` (kill-switch específico da etapa) unificado com `availability-4` como `xqa-4` — mesma proposta (`NDE_DESCRICAO_ITEM_ENABLED`), duas seções redundantes.

## 8. Ações recomendadas

1. **Sprint dedicada aos quick-wins P1/P2 S**: `fault-tolerance-2` + `testability-1` + `availability-1` + `xqa-1` + `security-1` + `fault-tolerance-5` + `fault-tolerance-4`. Custo total ~5–6d. **Prioridade máxima:** `fault-tolerance-2`.
2. **Triar as 14 falhas de baseline (`testability-6`)** antes que qualquer outra métrica de testabilidade valha alguma coisa. Bloqueia confiança em CI daqui pra frente.
3. **Instrumentar cross-cutting `xqa-2` (ledger + observability)**. Uma coluna + um contador resolvem 3 findings. Único P2 M — em fila logo depois do sprint quick-wins.
4. **Registrar follow-ups em `ontology/_inbox/`**: `modifiability-3`, `modifiability-4`, `deployability-2`. Custo ~2h somado; evita esquecimento estratégico.
5. **Programar `modifiability-2` (split `NdeCaudaFiscalService`)** para o próximo `/feature-tweak` que toque ≥ 2 etapas fiscais. Combinar com `testability-2` na mesma janela.

**Do que NÃO fazer neste ciclo**: paralelizar loop N>1 preventivamente (depende de `performance-3` provar); extrair helper genérico de RMW (só na 3ª ocorrência); migrar fallback para tabela por-cliente (não há demanda).
