
---
type: regis-review-kanban
run_id: 2026-10-30-2243-dda-pool-limpo
total: 33
counts: { p0: 0, p1: 5, p2: 16, p3: 12 }
---

# Kanban — financeiro — 2026-10-30-2243-dda-pool-limpo

> Importável para o Kanban do time. Cada card já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (vazio) → P1 (S → XL) → P2 (S → XL) → P3 (S → XL).

---

## P0 — Crítico

_Nenhum. Feature é 100% read-only; sem caminho de write financeiro. Candidato a promoção: `fault-tolerance-2` (R-1), caso surja incidente de multa documentado._

---

## P1 — Alto

### [fault-tolerance-1] Isolar `listInativosRecentes` com fallback para array vazio

**QA**: Fault Tolerance
**Tactic alvo**: Recovery (forward) / Condition Monitoring
**Esforço**: S
**Findings**: F-fault-tolerance-1, F-fault-tolerance-5 (toca também F-availability-1, F-integrability-4)

**Problema**
> Hoje a nova consulta roda dentro do `Promise.all` que entrega a aba de boletos DDA. Como `TITULO_SAIU_CARTEIRA` é informativo e esconderia o boleto por padrão, uma falha nessa consulta derruba a aba inteira — regressão de disponibilidade numa feature crítica para pagar no prazo.

**Melhoria Proposta**
> Trocar a chamada no `Promise.all` por uma versão com `catch` que loga `LogService.warn` e devolve `[]`. Tactic alvo: Recovery (forward) — degradar graciosamente. Arquivo: `src/backend/domain/service/sispag/BoletoDdaService.ts:136-144`. Padrão sugerido: envolver `this.tituloRepo.listInativosRecentes(...)` numa função privada que faça o try/catch e marque no snapshot um bit "saídos indisponíveis" para a UI opcionalmente exibir.

**Resultado Esperado**
> A aba renderiza mesmo se a nova query falhar; apenas `TITULO_SAIU_CARTEIRA` fica vazio. Métrica observável: incidentes "aba DDA inteira caiu por `listInativosRecentes`": 1 risco → 0.

**Métricas de sucesso**
- consultas informativas isoladas por fallback: 0/1 → 1/1
- log de degradação parcial: ausente → `LogService.warn('listInativosRecentes falhou, aba degrada com saídos=[]')`

**Risco de não fazer**
> Num dia de janela de pagamento, uma indisponibilidade pontual do Postgres (ou plano ruim após `ANALYZE`) tira a aba do ar e o analista não consegue pagar.

**Dependências**: Nenhuma. **Mescla**: resolve também availability-1 (idêntico) e integrability-2 (idêntico) — tratar como 1 PR só.

---

### [fault-tolerance-2] Endurecer a elegibilidade de `TITULO_SAIU_CARTEIRA` e instrumentar

**QA**: Fault Tolerance
**Tactic alvo**: Quarantine / Comparison
**Esforço**: S
**Findings**: F-fault-tolerance-2

**Problema**
> A classificação `TITULO_SAIU_CARTEIRA` esconde o boleto da lista padrão e das somas `contagem.todas`/`totais.todas`/`urgentes`. O match é frouxo (±R$0,05 e ±10 dias) e aceita qualquer `ativo=false`, inclusive **cancelados**, **previsão** e **renegociados**. Cenário realista: dois boletos mensais de valor próximo, o anterior cancelado no ERP, o novo some do painel.

**Melhoria Proposta**
> (1) Restringir no SQL de `listInativosRecentes` para `ativo=false AND pago=true` — mantém o espírito "em regra quitados" e corta cancelados/previsão. (2) Casar também por `pes_cod`/credor quando ambos tiverem (reduz colisão por valor). (3) Instrumentar: `LogService.warn` quando um boleto virar `TITULO_SAIU_CARTEIRA` tendo `arquivos > 1` ou valor exatamente igual ao do saído. (4) Documentar no `rotulosDda.ts` que o estado é uma inferência. Tactic alvo: Quarantine com gatilho de revisão.

**Resultado Esperado**
> Falso-positivo da ocultação cai: boletos cuja contraparte é cancelada/previsão/renegociada voltam a aparecer na lista padrão (como `SEM_TITULO`, com urgência preservada). Métrica observável: percentual estimado de `TITULO_SAIU_CARTEIRA` cuja contraparte não é `pago=true`: desconhecido → 0.

**Métricas de sucesso**
- cláusula `AND pago = TRUE` presente em `listInativosRecentes`: não → sim
- log/counter de classificação `TITULO_SAIU_CARTEIRA`: ausente → presente
- testes cobrindo "inativo não pago não deve esconder": 0 → 2

**Risco de não fazer**
> Boleto esquecido → multa/juros ao fornecedor; recorrente de valor fixo é o caso mais provável e mais embaraçoso para a área financeira.

**Dependências**: Nenhuma (`pago` já é campo lido pelo repositório).

---

### [performance-1] Trocar o scan linear do `saiuDaCarteira` por busca por faixa de centavos

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: S
**Findings**: F-performance-1

**Problema**
> `saiuDaCarteira` percorre todos os `titulosSaidos` para cada boleto livre (`filter` linear em `TituloAberto[]`). No pool de prod simulado (23 292 boletos, 2 832 inativos) isso custa +436 ms (65 M comparações) por consolidação fria. O `indexarAbertos` já resolve o mesmo problema com array ordenado por centavos — o `indexarSaidos` só espelha o padrão pela metade.

**Melhoria Proposta**
> No `indexarSaidos`, ordenar `saidos` por `centavos`. No `saiuDaCarteira`, usar busca binária por `[valor−5, valor+5]` (`lowerBound`/`upperBound`) e iterar só a fatia; validar o `Math.abs(diasEntre) <= 10` na fatia. Arquivo: `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts`.

**Resultado Esperado**
> `consolidar` wall-time para 23 k boletos: 2 859 ms → ≤ 2 500 ms (overhead do `TITULO_SAIU_CARTEIRA` cai de +436 ms para ≤ 50 ms). Mantém semântica: mesma lista `titulosSaidos` por boleto.

**Métricas de sucesso**
- Overhead do `saiuDaCarteira` @ 23 k: 436 ms → ≤ 50 ms (harness `factor=12` reutilizável)
- `consolidar` wall-time @ 23 k: 2 859 ms → ≤ 2 500 ms
- Testes `ConsolidacaoBoletoDda.test.ts` continuam verdes

**Risco de não fazer**
> Se o número de inativos retornados crescer (janela ampliada, ou retenção maior de pagos), o custo cresce linearmente. Em 6 meses, com 10 k inativos no recorte, overhead vai a ~1,5 s/consolidação fria.

**Dependências**: Nenhuma.

---

### [deployability-1] Blindar a UI contra enum `BoletoDdaSituacao` desconhecido

**QA**: Deployability
**Tactic alvo**: Scale Rollouts + Logical Grouping
**Esforço**: S
**Findings**: F-deployability-1, F-deployability-4

**Problema**
> O enum `BoletoDdaSituacao` ganhou dois valores novos (`FORA_JANELA`, `TITULO_SAIU_CARTEIRA`) e vive duplicado entre `src/backend/domain/interface/sispag/BoletoDda.ts` e `src/frontend/lib/sispag.ts`. Durante a janela de rolling deploy (Render ≠ Vercel), o backend novo pode servir esses valores ao frontend antigo. `ORDEM_SITUACAO`, `rotulos` e os cards no FE antigo não conhecem as novas chaves — a tabela renderiza "undefined" e a ordenação fica instável.

**Melhoria Proposta**
> Tornar o FE tolerante a enum desconhecido (defaults em `ORDEM_SITUACAO`/`rotulosDda`/`filtrosBoletosDda`) e explicitar na review que **mudanças de enum são aditivas-com-fallback**: FE merge/deploy obrigatoriamente **antes** do BE para situações novas, ou um fallback canônico ("SEM_TITULO" ou "Outro") para unknown. Scale Rollouts via ordem de deploy documentada no `DEPLOY.md`.

**Resultado Esperado**
> FE antigo tolera `BoletoDdaSituacao` desconhecida (zera totais, usa rótulo "—", ordem = última). Nenhuma linha "undefined" na tabela durante rolling deploy.

**Métricas de sucesso**
- Linhas renderizando `undefined` em `rotulos[sit]` durante janela de deploy: 1+ possível → 0
- Contract test que falha quando os dois enums divergem: 0 → 1

**Risco de não fazer**
> A cada feature nova da aba, o analista financeiro vê UI quebrada no minuto do deploy; perda de confiança no painel.

**Dependências**: Nenhuma.

---

### [testability-1] Fechar o seam do `listInativosRecentes` com teste unitário + integração civil

**QA**: Testability
**Tactic alvo**: Abstract Data Sources
**Esforço**: S
**Findings**: F-testability-1

**Problema**
> O novo método `TituloAPagarRepository.listInativosRecentes` entrega a lista que alimenta `TITULO_SAIU_CARTEIRA` sem nenhum teste no repositório. O SQL compara dia civil com `(vencimento AT TIME ZONE 'UTC')::date BETWEEN $de::date AND $ate::date` — exatamente o padrão que o incidente 2026-10-14 (desfazimento de 15 lotes / 79 itens, ADR-0070) nos ensinou a defender com teste de borda em Postgres real.

**Melhoria Proposta**
> Adicionar (a) um unit test espelho do `listAtivos` em `TituloAPagarRepository.test.ts` assertando `ativo = FALSE` no SQL e `{ de, ate }` nos parâmetros; (b) um caso em `TituloAPagarRepository.integration.test.ts` inserindo três títulos com `vencimento` em 00:00Z, 15:00Z e 23:00Z do dia da borda `ate`, verificando quais entram.

**Resultado Esperado**
> Nova query ganha o mesmo nível de guarda que `listAtivos`. `# testes unit para listInativosRecentes`: 0 → 1; `# testes integração`: 0 → 1 (3 asserções de borda civil).

**Métricas de sucesso**
- Testes unit do método: 0 → 1
- Testes integração do método: 0 → 1 (cobrindo bordas 00:00Z e 15:00Z)

**Risco de não fazer**
> Edição silenciosa do `AT TIME ZONE 'UTC'` desloca a borda em 3h; a aba Boletos DDA deixa de mostrar `TITULO_SAIU_CARTEIRA` em dias de borda — regressão idêntica à ADR-0070, incidente 2026-10-14.

**Dependências**: Nenhuma.

---

## P2 — Médio

### [availability-1] Degradar graciosamente quando `listInativosRecentes` falha

**QA**: Availability
**Tactic alvo**: Degradation / Exception Handling
**Esforço**: S
**Findings**: F-availability-1, F-availability-3

**Problema**
> A nova query de títulos inativos alimenta uma dimensão (`TITULO_SAIU_CARTEIRA`) que é **escondida por padrão** e não aparece em `contagem.todas`. Mesmo assim, uma falha dela mata a aba inteira porque está no `Promise.all` junto das queries essenciais.

**Melhoria Proposta**
> Trocar `Promise.all` por `Promise.allSettled` em `BoletoDdaService.carregar` (ou envolver só `listInativosRecentes` em `FallbackExecutor` que retorne `[]`). Logar `LogService.message` com `LOG_TYPE.WARN` quando a sub-query falhar.

**Resultado Esperado**
> Falha isolada em `listInativosRecentes` não indisponibiliza a aba. Observabilidade: `% montagens com fallback acionado` passa a ser medível.

**Métricas de sucesso**
- Falhas de `listInativosRecentes` que indisponibilizam a aba: 100% → 0%
- Logs `WARN` emitidos quando a query falha: 0 → 1 por ocorrência

**Risco de não fazer**
> Incidente onde `titulo_a_pagar` com `ativo=FALSE` fica lenta tira do ar o painel de DDA inteiro, inclusive os `CANDIDATO` que o analista precisa resolver no dia.

**Dependências**: Nenhuma. **Mescla**: idêntico a fault-tolerance-1 e integrability-2 — fazer 1 PR.

---

### [availability-2] Limitar e cobrir por índice a nova query de inativos

**QA**: Availability
**Tactic alvo**: Exception Prevention / Monitor
**Esforço**: S
**Findings**: F-availability-2, F-availability-3

**Problema**
> `listInativosRecentes` roda sem `LIMIT` sobre uma faixa de ~70 dias de `titulo_a_pagar WHERE ativo = FALSE`. A tabela cresce indefinidamente, e não há garantia local de que exista índice que cubra o filtro. Para `TITULO_SAIU_CARTEIRA`, só interessa um punhado de linhas por boleto DDA (`MAX_INFORMATIVOS = 5`).

**Melhoria Proposta**
> (i) Confirmar/criar índice parcial `titulo_a_pagar (vencimento) WHERE ativo = FALSE`; (ii) `LIMIT` de defesa (ex.: 2000) com log `WARN` quando o limite for atingido; (iii) Documentar na ontologia o teto esperado.

**Resultado Esperado**
> Latência da nova query previsível e observável. Alvo: p95 ≤ p95 de `listAtivos` da mesma montagem.

**Métricas de sucesso**
- Índice cobrindo o predicado: ausente/desconhecido → presente e usado (`EXPLAIN`)
- `LIMIT` de defesa: ausente → presente, com log quando saturado

**Risco de não fazer**
> Tenant com histórico longo passa a sofrer latência crescente na aba DDA (sintoma lento, origem silenciosa) e, no limite, pressão de memória no processo Node compartilhado.

**Dependências**: Visibilidade do schema do tenant.

---

### [deployability-2] Introduzir `arquivos` como opcional + default no FE

**QA**: Deployability
**Tactic alvo**: Scale Rollouts (contrato aditivo em duas etapas)
**Esforço**: S
**Findings**: F-deployability-2

**Problema**
> `BoletoDdaConsolidado.arquivos: number` é obrigatório em ambos os lados do contrato. Se o FE novo deploy antes do BE (Vercel builda em <1 min, Render em 5–8 min), o FE recebe `arquivos === undefined` — tipagem mente, e qualquer uso aritmético futuro produz `NaN`.

**Melhoria Proposta**
> Marcar `arquivos?: number` em ambos os lados por **um release** até o backend estar em prd, com fallback `arquivos ?? 1` nos consumidores (`TabelaBoletosDda.tsx:316`); num release seguinte promover a obrigatório.

**Resultado Esperado**
> Rolling deploy em qualquer ordem não produz `undefined`/`NaN` na tabela.

**Métricas de sucesso**
- Campos obrigatórios novos durante janela de deploy: 1 → 0

**Risco de não fazer**
> O próximo campo numérico novo repetirá o padrão e eventualmente alguém somará `NaN` numa linha do painel.

**Dependências**: Nenhuma. Combinável com integrability-1.

---

### [deployability-3] Feature flag para desligar o pool consolidado DDA sem revert

**QA**: Deployability
**Tactic alvo**: Rollback / Dark Launch
**Esforço**: S
**Findings**: F-deployability-3

**Problema**
> Não há flag em `EnvironmentProvider` que desligue o colapso por `codbar`, a classificação em `FORA_JANELA` / `TITULO_SAIU_CARTEIRA`, ou a leitura de `listInativosRecentes`. Rollback só por `git revert + redeploy duplo` (≥10 min).

**Melhoria Proposta**
> Introduzir `SISPAG_DDA_POOL_LIMPO_ENABLED` em `EnvironmentProvider`. Em `BoletoDdaService.consolidar`: quando desligado, pular `listInativosRecentes` e cair no comportamento legado. Documentar no `DEPLOY.md`. Alinhado ao padrão `SISPAG_LIVE_WRITE_ENABLED` / `SISPAG_BIND_CODBAR_FILIAIS`.

**Resultado Esperado**
> MTTR de rollback cai de ~10 min para ≤2 min.

**Métricas de sucesso**
- MTTR de rollback: ~10 min → ≤2 min
- Flags gatando a nova classificação: 0 → 1

**Risco de não fazer**
> Um bug na `listInativosRecentes` em prd só sai do ar com rebuild duplo.

**Dependências**: Nenhuma.

---

### [deployability-4] Fonte única de contrato (ou contract test) para `BoletoDda*`

**QA**: Deployability
**Tactic alvo**: Logical Grouping / Package Dependencies
**Esforço**: M
**Findings**: F-deployability-1, F-deployability-4

**Problema**
> Backend e frontend duplicam manualmente ~25 campos do contrato `BoletoDdaConsolidado`. Este diff já teve que mexer em ambos; nada no CI falha se alguém esquecer um lado.

**Melhoria Proposta**
> Opção A: extrair os tipos públicos para um pacote compartilhado (`src/shared/sispag-boleto-dda.ts`). Opção B (mais barata): script `scripts/check-contract.mjs` no CI que compara chaves e enum values entre os dois arquivos.

**Resultado Esperado**
> Enum / interface fora de sincronia: typecheck ou CI falha antes do merge.

**Métricas de sucesso**
- Contract tests FE↔BE: 0 → ≥1
- Divergências de enum passando no CI: possível → impossível

**Risco de não fazer**
> Cada feature nova nessa aba carrega 20% de chance de ter um lado esquecido.

**Dependências**: Nenhuma.

---

### [integrability-1] Introduzir shim retrocompatível no serializador do pool DDA

**QA**: Integrability
**Tactic alvo**: Backward-compatibility shims
**Esforço**: S
**Findings**: F-integrability-1

**Problema**
> O diff adiciona `arquivos: number` obrigatório e dois keys obrigatórios em `BoletoDdaContagem`/`BoletoDdaTotais` (`FORA_JANELA`, `TITULO_SAIU_CARTEIRA`). Deploy lockstep FE+BE é a única salvaguarda; um FE em cache de SW/CDN contra BE novo renderiza NaN em cards KPI.

**Melhoria Proposta**
> (1) Tornar `arquivos` opcional no contrato FE (`arquivos?: number` com default `1` em `CardsBoletosDda`/`TabelaBoletosDda`); (2) acrescentar comentário "Backend anterior à vX não manda `FORA_JANELA`/`TITULO_SAIU_CARTEIRA`" em `BoletoDdaContagem`.

**Resultado Esperado**
> FE em versão anterior renderiza payload BE novo sem quebra visível. Ratio campos obrigatórios/opcionais novos: `3/3` → `0/3`.

**Métricas de sucesso**
- Campos novos obrigatórios no contrato wire: 3 → 0
- Deploy lockstep necessário: sim → não (quando release pular 1 versão FE)

**Risco de não fazer**
> Em 6 meses, com a aba incorporada em webview Columbia ou cache CDN prolongado, 1 incidente de "cards zerados" em release.

**Dependências**: Nenhuma. Combinável com deployability-2.

---

### [integrability-2] Blindar `consolidarEscopo` contra falha do `listInativosRecentes`

**QA**: Integrability
**Tactic alvo**: Observability of integration failures / Limit Fault Propagation
**Esforço**: S
**Findings**: F-integrability-4

**Problema**
> A nova query de títulos inativos entra num `Promise.all` sem try/catch dedicado. Falha dela derruba a aba inteira, mesmo sendo situação escondida da lista padrão.

**Melhoria Proposta**
> Envelope análogo a `gruposOuNenhum`: `listInativosRecentesOuVazio` que captura, loga `BUSINESS_WARN` e devolve `[]`.

**Resultado Esperado**
> Falha isolada no caminho secundário não propaga para o primário.

**Métricas de sucesso**
- Caminhos secundários sem fallback no `consolidarEscopo`: 1 → 0
- Logs `BUSINESS_WARN` dedicados: 0 → 1

**Risco de não fazer**
> Incidente de aba DDA offline causado por regressão em query de situação escondida.

**Dependências**: Nenhuma. **Mescla**: idêntico a fault-tolerance-1 e availability-1 — 1 PR só.

---

### [integrability-3] Expor janela da carteira via `EnvironmentProvider`

**QA**: Integrability
**Tactic alvo**: Configure Behavior
**Esforço**: S
**Findings**: F-integrability-3

**Problema**
> `JANELA_CARTEIRA_DIAS_ATRAS=15` / `_ADIANTE=45` são `export const` fixos. A janela é propriedade da **carteira do ERP (fin064)**; se mudar, troca-se código e sobe-se release.

**Melhoria Proposta**
> Mover para `EnvironmentProvider.janelaCarteira(): { diasAtras, diasAdiante }` com default `(15, 45)` e override por SSM/env.

**Resultado Esperado**
> Mudar a janela deixa de exigir rebuild — passa a ser hot-reload de config.

**Métricas de sucesso**
- Call-sites com janela configurável: 0/3 → 3/3
- Rebuild necessário para mudar a janela: sim → não

**Risco de não fazer**
> Quando a 2ª empresa do grupo Columbia subir no SISPAG com janela diferente, vira hot-fix com release.

**Dependências**: Nenhuma.

---

### [modifiability-1] Quebrar `PaginacaoBoletoDda.totalizar` em passes nomeados

**QA**: Modifiability
**Tactic alvo**: Refactor
**Esforço**: S
**Findings**: F-modifiability-1

**Problema**
> `totalizar` acumula situação, grupo, urgência e amostraHoje no mesmo laço (cognitive complexity 19, teto Biome 15). Novo chip = mexer no laço.

**Melhoria Proposta**
> Extrair `contarPorSituacao`, `acumularGrupo`, `acumularUrgencia`, `acumularAmostraHoje` como funções locais que recebem o acumulador e a linha. `totalizar` vira composição delas.

**Resultado Esperado**
> Complexity ≤ 15; cada passe testável; incluir uma métrica nova = adicionar 1 acumulador.

**Métricas de sucesso**
- Biome `noExcessiveCognitiveComplexity` em `totalizar`: 19 → ≤ 15
- Avisos Biome em arquivos do diff: 1 → 0

**Risco de não fazer**
> Regressão em `totais.urgentes*` passa despercebida porque o laço mistura `continue` de "saiu da carteira", "fora da janela" e faixa não-urgente.

**Dependências**: Nenhuma.

---

### [modifiability-2] Encapsular "esconder saídos da lista padrão" como filtro declarativo

**QA**: Modifiability
**Tactic alvo**: Increase Semantic Coherence
**Esforço**: S
**Findings**: F-modifiability-2

**Problema**
> A mesma regra ("sem pedido explícito ⇒ `TITULO_SAIU_CARTEIRA` some das facetas, da lista e dos totais") está escrita em 3 lugares com 3 sintaxes.

**Melhoria Proposta**
> Introduzir `visibilidadePadrao(filtro): (b) => boolean` em `PaginacaoBoletoDda`. `paginar` e `facetas` consomem a função; `totalizar` recebe o predicado e pula a linha num único ponto.

**Resultado Esperado**
> Mudar quais situações ficam escondidas por padrão = editar 1 função.

**Métricas de sucesso**
- Pontos de edição coordenada da regra "escondida": 3 → 1

**Risco de não fazer**
> Facetas e totais divergirem em releases futuros (contagem bate, chip-count não).

**Dependências**: Nenhuma.

---

### [modifiability-3] Mover `JANELA + LIMITE_DIAS_SAIDO` para a lib de janela

**QA**: Modifiability
**Tactic alvo**: Encapsulate
**Esforço**: S
**Findings**: F-modifiability-3, F-modifiability-6

**Problema**
> `LIMITE_DIAS_SAIDO` é parâmetro interno da regra "saiu da carteira" na `ConsolidacaoBoletoDda`, mas foi `export`ado para que `BoletoDdaService` montasse o range SQL de inativos. Mudança no halo exige mudar 2 arquivos acoplados por conhecimento tácito.

**Melhoria Proposta**
> Adicionar em `JanelaCarteira.ts` um `janelaDeInativosParaSaidaDaCarteira(calendar, hoje)` que devolve `{de, ate}` já com o halo somado. `ConsolidacaoBoletoDda` segue com `LIMITE_DIAS_SAIDO` **privado** (não `export`). Service passa a chamar a nova função.

**Resultado Esperado**
> `grep LIMITE_DIAS_SAIDO src/backend` só casa dentro de `ConsolidacaoBoletoDda.ts`. Reajustar `±10` muda em 1 ponto; o SQL acompanha por composição.

**Métricas de sucesso**
- Fan-out de `LIMITE_DIAS_SAIDO`: 2 → 1
- Aritmética inline `JANELA_CARTEIRA_* + LIMITE_DIAS_SAIDO`: 2 ocorrências → 0

**Risco de não fazer**
> Ajuste do halo em uma release deixa a sugestão "saiu da carteira" encontrando casos que o repositório já cortou (silent miss).

**Dependências**: Nenhuma. Resolve F-modifiability-6 de brinde.

---

### [modifiability-4] Registry único para `BoletoDdaSituacao` (label + segmento + ordem + chave de total)

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: M
**Findings**: F-modifiability-4

**Problema**
> Adicionar uma situação neste diff tocou 7 arquivos frontend + 2 backend. A mesma informação (label, help, cor, segmento, chave de total, posição de ordem) está dispersa em `SITUACAO_BADGE`, `ROTULO_SITUACAO_DDA`, `ORDEM_SITUACAO`, `SEGMENTOS`, `segmentoDe`, `situacoesDoSegmento`, `totalDoSegmento`, `ORDEM` do `RegrasBoletoDda`.

**Melhoria Proposta**
> Em `src/frontend/app/sispag/boletos-dda/rotulosDda.ts` (fonte única), definir `SITUACOES_DDA: Record<BoletoDdaSituacao, { label; className; help; ordem; segmento; chaveTotal; escondidaNaListaPadrao? }>` e derivar os demais. No backend, derivar `ORDEM_SITUACAO` de uma constante compartilhada em `interface/sispag/BoletoDda.ts`.

**Resultado Esperado**
> Nova situação = acrescentar 1 entrada no registry + eventual regra de hide. Edição em 1 arquivo.

**Métricas de sucesso**
- Arquivos frontend tocados para introduzir 1 situação: 7 → ≤ 2
- Switches gêmeos (`segmentoDe`+`situacoesDoSegmento`+`totalDoSegmento`): 3 → 1 lookup

**Risco de não fazer**
> Cada evolução do produto na aba paga retrabalho desproporcional.

**Dependências**: Nenhuma.

---

### [performance-2] Tornar o filtro de `vencimento` em `listInativosRecentes` sargável

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: S
**Findings**: F-performance-2

**Problema**
> `WHERE … AND (vencimento AT TIME ZONE 'UTC')::date BETWEEN $de::date AND $ate::date` aplica função sobre a coluna, invalidando o lado `vencimento` do índice composto `idx_titulo_a_pagar_ativo_venc`. Em PRD-copy há 12 280 inativos; retorno útil 2 832 — 77% é refiltrado em memória do DB.

**Melhoria Proposta**
> Reescrever o predicado para comparar `vencimento` diretamente contra timestamps absolutos (`vencimento >= $de::date AT TIME ZONE 'UTC' AND vencimento < ($ate::date + 1) AT TIME ZONE 'UTC'`) ou mover o cast para o parâmetro, não para a coluna. Validar com `EXPLAIN (ANALYZE, BUFFERS)`.

**Resultado Esperado**
> A query usa a parte `vencimento` do índice. Tempo de SQL < 10 ms mesmo com 100 k linhas inativas.

**Métricas de sucesso**
- `EXPLAIN (ANALYZE)` em PRD-copy: nó `Index Scan using idx_titulo_a_pagar_ativo_venc` presente
- Linhas descartadas em memória (`Rows Removed by Filter`): hoje ~77%; alvo ≤ 10%

**Risco de não fazer**
> Crescimento silencioso do custo conforme `titulo_a_pagar` acumula inativos. Em 3 anos (~100 k), query pode dobrar o tempo de resposta frio.

**Dependências**: Nenhuma.

---

### [performance-3] Instrumentar `duracaoMs` nas fases de `BoletoDdaService.listar`

**QA**: Performance
**Tactic alvo**: Reduce Overhead (via feedback loop)
**Esforço**: S
**Findings**: F-performance-4 (resolve também CC-3 inteiro: deployability-5, fault-tolerance-4, availability-3)

**Problema**
> Sem log estruturado de tempo por fase (`cache hit`, `consolidarEscopo`, `comGrupo`, `aplicar filtros/paginar`), não dá para verificar em produção se a feature cumpre o alvo p95 ≤ 1,5 s nem detectar regressão depois.

**Melhoria Proposta**
> Adicionar `logService.message` com `duracaoMs` por fase (ou `Timer` compartilhado em `domain/libs/`), chaveado por `escopo`. Incluir contagem (`{ counts: contagem }`) para dar visibilidade de `FORA_JANELA`/`TITULO_SAIU_CARTEIRA`.

**Resultado Esperado**
> Em cada chamada ao endpoint, log traz `{ fase, duracaoMs, pool, ativos, inativos }`. Dashboard do Render passa a ter p50/p95 por fase.

**Métricas de sucesso**
- 100% das chamadas ao `listar` com log estruturado
- 0 fases >1 s sem log de pool/ativos/inativos acompanhando

**Risco de não fazer**
> Regressões descobertas por reclamação do analista, não por métrica.

**Dependências**: Nenhuma. Pré-requisito recomendado de performance-4.

---

### [performance-4] Garantir que a chave do `ConsolidacaoBoletoDdaCache` reflita `titulosSaidos`

**QA**: Performance
**Tactic alvo**: Maintain Multiple Copies of Computations
**Esforço**: M
**Findings**: F-performance-3

**Problema**
> A nova entrada `titulosSaidos` entra no `consolidar` mas não aparece na chave do cache. Se `carteiraEm` não é atualizado em toda transição de `ativo=TRUE→FALSE`, cópias cacheadas podem ter `TITULO_SAIU_CARTEIRA` desatualizado. Baixar TTL para mitigar quebra a economia de 2,9 s.

**Melhoria Proposta**
> Garantir que `carteiraEm` (ou novo `pagamentosAtivoEm`) seja bumpado em QUALQUER alteração do campo `ativo`. Opcional: incluir hash dos inativos recentes na chave.

**Resultado Esperado**
> Dado um título que passa a `ativo=FALSE`, a próxima chamada ao `listar` com a mesma chave retorna consolidado novo em ≤ 1 ciclo. Nenhum impacto no hit-rate em regime estável.

**Métricas de sucesso**
- Teste adicional em `ConsolidacaoBoletoDdaCache.test.ts` cobrindo `carteiraEm` bumpado em transição `ativo`
- 0 ocorrências em prod de linha `SEM_TITULO` com `titulosSaidos` populável (via log do performance-3)

**Risco de não fazer**
> Analista toma decisão com dado estale.

**Dependências**: performance-3 (observabilidade) recomendado.

---

### [testability-2] Trocar `Date.now()` da `IngestaoPagamentosService` pelo relógio injetado

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism
**Esforço**: S
**Findings**: F-testability-2

**Problema**
> O mesmo arquivo que importa `JANELA_CARTEIRA_*` para unificar as pontas da janela ainda calcula `const now = Date.now()` cru. `ConsolidacaoBoletoDda` já usa `calendar.todayBrt()` + `addDays`. A janela virou constante única, mas o relógio não.

**Melhoria Proposta**
> Injetar `BankingCalendar` no `IngestaoPagamentosService` e substituir `Date.now()` por `calendar.todayBrt()` + `calendar.addDays(hoje, ±N)`. Converter para epoch via `toErpEpoch` se necessário.

**Resultado Esperado**
> A ingestão passa a ser testável no mesmo nível da consolidação; borda do dia virando no meio da corrida vira caso de teste.

**Métricas de sucesso**
- `Date.now()` em `IngestaoPagamentosService.ts`: 1 → 0
- Teste novo cobrindo a borda com relógio fixo: 0 → 1

**Risco de não fazer**
> Discrepância rara entre janela ingerida e consolidada em corridas por volta da virada do dia.

**Dependências**: Nenhuma; `BankingCalendar` já é injetável.

---

## P3 — Baixo

### [deployability-5] Release marker + contador para novas situações

**QA**: Deployability
**Tactic alvo**: Deployment observability
**Esforço**: S
**Findings**: F-deployability-5

**Problema**
> Nenhum `logService.message` registra ocorrências de `FORA_JANELA` / `TITULO_SAIU_CARTEIRA` nem a quantidade de `copias` colapsadas.

**Melhoria Proposta**
> Em `BoletoDdaService.listar`, emitir `logService.message('boletos dda consolidado', { counts: contagem })` por chamada.

**Resultado Esperado**
> Grep nos logs do Render responde em segundos "quantos boletos saíram da carteira hoje?".

**Métricas de sucesso**
- Contadores pós-deploy: 0 → ≥1

**Risco de não fazer**
> Regressão silenciosa até o Yuri abrir a aba.

**Dependências**: Resolvido por performance-3 (consolidar).

---

### [fault-tolerance-3] Desempate explícito em `comGrupo` quando múltiplas cópias têm grupo `CONFIRMADO`

**QA**: Fault Tolerance
**Tactic alvo**: Voting
**Esforço**: S
**Findings**: F-fault-tolerance-3

**Problema**
> O escolhido em `comGrupo` é o primeiro `CONFIRMADO` encontrado em ordem — e o representante vem primeiro. Se dois `CONFIRMADO` existirem em cópias distintas (estado inconsistente), a escolha é arbitrária pela ordem.

**Melhoria Proposta**
> Tiebreak estável: ao haver 2+ `CONFIRMADO`, preferir o do `ddcCod` maior (arquivo mais recente). Caso ainda haja empate, `ditCod` maior.

**Resultado Esperado**
> Comportamento previsível em estado anômalo; log opcional alertando o caso.

**Métricas de sucesso**
- Teste explícito presente: não → sim

**Risco de não fazer**
> Cenário raro, impacto meramente visual; conviver 6 meses sem resolver é aceitável.

**Dependências**: Nenhuma.

---

### [fault-tolerance-4] Contador/telemetria para boletos `FORA_JANELA`

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring
**Esforço**: S
**Findings**: F-fault-tolerance-4

**Problema**
> `FORA_JANELA` é a vala comum de boleto com vencimento esquisito (ano trocado no `codbar`). Fica fora de "urgentes" e sem destaque próprio.

**Melhoria Proposta**
> Emitir `LogService.message` info quando o volume diário de `FORA_JANELA` crescer >1σ sobre a semana anterior; ou simplesmente logar contagem no final do `consolidar`.

**Resultado Esperado**
> Picos de boletos com vencimento esquisito ficam visíveis.

**Métricas de sucesso**
- Log/metric diária presente: 0 → 1

**Risco de não fazer**
> Perda silenciosa do nudge sobre data suspeita.

**Dependências**: Resolvido por performance-3.

---

### [fault-tolerance-5] `statement_timeout` dedicado para `listInativosRecentes`

**QA**: Fault Tolerance
**Tactic alvo**: Timeout
**Esforço**: S
**Findings**: F-fault-tolerance-5, F-fault-tolerance-1

**Problema**
> A query nova usa `(vencimento AT TIME ZONE 'UTC')::date BETWEEN …` sobre `WHERE ativo=false`. Sem timeout dedicado, uma varredura ampla em PRD pode travar a aba.

**Melhoria Proposta**
> Envolver a chamada em `PollExecutor`/driver-level `statement_timeout` curto (ex.: 2s); no erro, cair no fallback do fault-tolerance-1.

**Resultado Esperado**
> Pior caso da nova query: 2s + fallback `[]` + warn.

**Métricas de sucesso**
- Timeout explícito presente: não → sim

**Risco de não fazer**
> Amplifica fault-tolerance-1.

**Dependências**: fault-tolerance-1.

---

### [integrability-4] Documentar política do contrato FE para `copias`

**QA**: Integrability
**Tactic alvo**: Tailor Interface
**Esforço**: S
**Findings**: F-integrability-2

**Problema**
> `BoletoDdaCopia` existe no backend e vai pelo wire; o FE não tipa (nem usa). Decisão deliberada do `comGrupo` (pivotar `ddcCod/ditCod` no servidor), mas sem comentário no FE.

**Melhoria Proposta**
> Em `src/frontend/lib/sispag.ts` perto de `BoletoDda`, acrescentar comentário: "O backend serializa `copias?: Array<{ddcCod, ditCod, arquivo?, importadoEm?}>` mas o FE não consome — o pivot já foi feito em `BoletoDdaService.comGrupo`."

**Resultado Esperado**
> Próximo dev FE sabe por que o campo chega e não é tipado.

**Métricas de sucesso**
- Comentário presente: não → sim

**Risco de não fazer**
> Dev FE replica `BoletoDdaCopia` sem alinhar e cria segundo contrato.

**Dependências**: Nenhuma.

---

### [modifiability-5] Separar `comGrupo` do `BoletoDdaService`

**QA**: Modifiability
**Tactic alvo**: Split Module / Increase Semantic Coherence
**Esforço**: S
**Findings**: F-modifiability-5

**Problema**
> `BoletoDdaService` (463 LOC) mistura orquestração de IO com `comGrupo` (35 LOC puras). Teste e mudança da regra do grupo passam pelo container inteiro.

**Melhoria Proposta**
> Extrair `comGrupo` para `ConsolidacaoBoletoDda.aplicarGrupo` (ou `BoletoDdaGrupoResolver` injetável).

**Resultado Esperado**
> `BoletoDdaService` ≤ 420 LOC; `comGrupo` testável sem o container.

**Métricas de sucesso**
- LOC `BoletoDdaService.ts`: 463 → ≤ 420

**Risco de não fazer**
> Cumulativo; o service continuará ganhando pós-processamentos e virará *god service* da aba.

**Dependências**: Pode combinar com modifiability-3.

---

### [modifiability-6] Nomear o recorte da janela de inativos

**QA**: Modifiability
**Tactic alvo**: Encapsulate
**Esforço**: S
**Findings**: F-modifiability-6

**Problema**
> `BoletoDdaService.consolidarEscopo` usa `-(JANELA_CARTEIRA_DIAS_ATRAS + LIMITE_DIAS_SAIDO)` sem um nome. O "halo de ±10 do matching" só aparece como aritmética.

**Melhoria Proposta**
> Resolver no card modifiability-3 encapsulando o recorte em `janelaDeInativosParaSaidaDaCarteira`. P3 independente caso o -3 não entre no sprint.

**Resultado Esperado**
> 0 somas inline das constantes de janela em services.

**Métricas de sucesso**
- Ocorrências de `JANELA_CARTEIRA_* +/- LIMITE_*` em services: 2 → 0

**Risco de não fazer**
> Baixo direto; alto se outro service replicar a aritmética.

**Dependências**: modifiability-3.

---

### [security-1] Blindar o payload DDA caso a Columbia venha a criar role somente-DDA no futuro

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: S
**Findings**: F-security-1, F-security-2

**Problema**
> `titulosSaidos[]` devolve credor/valor/vencimento de títulos INATIVOS a toda role `sispag:ver`. Hoje é equivalente ao que a role já enxerga em outras abas (não é regressão), mas se amanhã existir uma role de visualização reduzida, esse payload passará a vazar.

**Melhoria Proposta**
> Documentar em `ontology/entities/boleto-dda.md` que `titulosSaidos` e `copias[]` herdam a sensibilidade de "títulos ativos". Opcional: parametrizar o campo `credor` para omissão quando a role for restrita.

**Resultado Esperado**
> Ontologia explicita o acoplamento DTO ↔ role e exige revisão em qualquer PR que fatie `sispag:ver`.

**Métricas de sucesso**
- Nota de sensibilidade em `ontology/entities/boleto-dda.md`: ausente → presente

**Risco de não fazer**
> Baixo — potencial vazamento quando/se uma role restrita for criada.

**Dependências**: Nenhuma.

---

### [security-2] Fixar invariante de parametrização em `listInativosRecentes` com teste e comentário

**QA**: Security
**Tactic alvo**: Validate Input
**Esforço**: S
**Findings**: F-security-3

**Problema**
> A nova query `listInativosRecentes` é parametrizada corretamente, mas o cast `AT TIME ZONE 'UTC'::date` é a primeira vez que esse padrão aparece. Sem teste adversarial, uma refatoração futura em `BankingCalendar.addDays` ou no SqlBuilder pode degradar a invariante.

**Melhoria Proposta**
> Em `TituloAPagarRepository.*.test.ts`, acrescentar teste focado em parametrização: injetar `de` string `"2026-01-01' OR '1'='1"` e verificar que o SQL enviado nunca contém a string.

**Resultado Esperado**
> Qualquer refactor que quebre o binding falha em CI.

**Métricas de sucesso**
- Tests para `listInativosRecentes` com payload adversarial: 0 → ≥1

**Risco de não fazer**
> Baixo — a invariante hoje é cumprida; sem o teste, regressão silenciosa possível.

**Dependências**: Nenhuma.

---

### [testability-3] Gravar o contrato das novas situações num teste de rota

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-3

**Problema**
> `FORA_JANELA` e `TITULO_SAIU_CARTEIRA` entraram no contrato HTTP via `SITUACOES_FILTRAVEIS = Object.values(BOLETO_DDA_SITUACAO)`. Hoje a derivação automática protege contra drift, mas o contrato não está gravado.

**Melhoria Proposta**
> Adicionar `it` em `src/backend/routes/sispag.test.ts` que mande `GET /sispag/boletos-dda?situacao=FORA_JANELA` e outro com `?situacoes=TITULO_SAIU_CARTEIRA` e exija 200.

**Resultado Esperado**
> Contrato das duas situações novas vira teste explícito.

**Métricas de sucesso**
- Testes de rota com as duas situações: 0 → 2

**Risco de não fazer**
> Alguém "defende" a API escondendo situações internas; rotas e aba divergem sem alarme.

**Dependências**: Nenhuma.

---

### [testability-4] Partir `BoletoDdaService.test.ts` por responsabilidade

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: S
**Findings**: F-testability-4

**Problema**
> O test file passou de ~580 para 647 LOC com os 2 `it`s novos de cópia + grupo. Ainda estável, mas colando no limiar.

**Melhoria Proposta**
> Separar em `BoletoDdaService.listar.test.ts` e `BoletoDdaService.comGrupo.test.ts`.

**Resultado Esperado**
> Nenhum file > 500 LOC entre os testes do service.

**Métricas de sucesso**
- Maior test file: 647 → ≤ 400 LOC

**Risco de não fazer**
> O próximo diff que mexer em `comGrupo` empurra o file para 700+ LOC.

**Dependências**: Idealmente após testability-1 e testability-2 para evitar rebase.

---

### [testability-5] Caso "saiu da carteira sem credor" no teste de consolidação

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-5

**Problema**
> O ramo `...(s.titulo.credor ? { credor: s.titulo.credor } : {})` do `saiuDaCarteira` não tem teste; o frontend assume que `credor` existe (`screen.findByText('FORNECEDOR SAIDO LTDA')` no teste do `BoletosDdaTab`).

**Melhoria Proposta**
> Um `it` novo no bloco "título que saiu da carteira" com `saido({ valor: 100, vencimento: utc('2026-09-22'), credor: undefined })` e assertando que a linha devolve `titulosSaidos[0]` sem a chave `credor`.

**Resultado Esperado**
> Ramo coberto.

**Métricas de sucesso**
- Cenários cobrindo `credor` ausente em `titulosSaidos`: 0 → 1

**Risco de não fazer**
> Nenhum concreto hoje; higienização de ramos.

**Dependências**: Nenhuma.
```

---

**Notas de síntese / consistência**:
- Mantive integralmente as prioridades dos especialistas. Nenhum achado foi promovido/demovido pelo consolidador.
- Marquei explicitamente as mesclagens cross-QA (availability-1 ≡ fault-tolerance-1 ≡ integrability-2) no texto dos cards para a reunião poder tratar como 1 PR.
- Nenhum achado P0 — o motivo é consistente entre as 8 seções: feature é read-only. Candidato natural a P0, se o leitor discordar: `fault-tolerance-2` (R-1), que mapeia para o único cenário com dinheiro em risco direto (multa/juros por boleto escondido).
- Os cards duplicados por overlap foram preservados no KANBAN para preservar a numeração estável dos arquivos de origem (`<slug>-N`); a seção 4 do REPORT.md deixa explícito "mesclado" para o planejamento operacional.
