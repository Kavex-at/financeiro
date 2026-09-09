---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-08-1955
agent: qa-modifiability
generated_at: 2026-09-08T17:02:00-03:00
scope: backend
score: 6.5
findings_count: 4
cards_count: 2
---

# Modifiability — Regis-Review (`permutas-baixa-integridade`, DELTA)

> Gate `--quick` do commit `8b18686`. Julga o **delta** contra `main@47c48f8`, não o módulo Permutas
> (isso é o run `2026-09-08-1414-permutas`). Findings pré-existentes só entram quando o delta piora
> a métrica ou passa por cima da oportunidade de mitigá-los.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Yuri/Kavex dev | ADR-0043 exige novo terminal `parcial` + advisory lock + pré-checagem I-Write-8a | `ReconciliacaoPermutaService.ts` (baixa `fin010`), `PermutaExecucaoRepository.ts` (terminal parcial), `types.ts`/`ui.tsx` (badge B1'), `types.test.ts` (paridade FE↔BE) | Delta em branch, gate `--quick` | Uma única iteração de `/feature-tweak` deve implementar 4 invariantes novas SEM introduzir novos hotspots de complexidade nem novas cópias mudas entre backend e frontend | Cognitive-complexity do laço central não pode SUBIR (cc ≤ baseline `main`); nenhum literal de estado espelhado à mão pode entrar em produção sem guarda automática; nenhuma constante nova de regra pode entrar como número mágico dentro de método |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| cc de `reconciliar`/`reconciliarSerializado` em `ReconciliacaoPermutaService.ts` | **36** (era 35 em `main`, medido no baseline pareado) | ≤ 15 (Biome `noExcessiveCognitiveComplexity`) | ⚠️ (delta: +1, essencialmente sem melhora nem regressão) | `npx biome lint domain/service/permutas/ReconciliacaoPermutaService.ts` no worktree; e mesma lint aplicada a `git show main:...` |
| LOC de `ReconciliacaoPermutaService.ts` | 1.093 (era 838 em `main`; **+255**, +30 %) | ≤ 600 (Bass Split Module) | ❌ | `wc -l` antes e depois do delta |
| LOC de `PermutaExecucaoRepository.ts` | 551 (era 495 em `main`; **+56**) | ≤ 400 | ⚠️ | `wc -l` antes e depois do delta |
| Extrações pedidas por `mod-1` (`resolveExecutionMode`, `ensureBordero`, `processarUmaAlocacao`) | **0/3** presentes | 3/3 | ❌ | `grep resolveExecutionMode\|ensureBordero\|processarUmaAlocacao` no worktree = vazio |
| Métodos privados NOVOS extraídos no delta (`chaveDeLock`, `assertCobertura`, `removerBorderoOrfao`) | 3 | — | ✅ (delta escolheu extrair *outros* três) | `git diff HEAD~1 -- domain/service/permutas/ReconciliacaoPermutaService.ts` |
| Warnings Biome no domínio (backend) | 68 (baseline `main`: 66) | não crescer | ⚠️ +2 (uma cc nova em `ReconciliacaoLotePermutaService.reconciliarLote` cc 30, uma pré-existente contando de novo) | `_shared-metrics.md` |
| Constantes NOVAS de regra introduzidas no delta | 2: `TOLERANCIA_FECHAMENTO_NEG = 0.005` (top-level, comentado) e `limiteResiduo = 1` (**inline** em `ancorarVariacaoNoAdto`) | Top-level ou externalizadas | ⚠️ (uma sim, uma não) | `ReconciliacaoPermutaService.ts:41` vs `:886` |
| Uniões espelhadas à mão FE↔BE cobertas pela guarda de paridade `types.test.ts` | 3 (`ExecucaoStatus`, `PermutaStatusBordero`/`PermutaStatus`, `LoteAdiantamentoStatus`) | Todas as uniões espelhadas | ⚠️ interfaces (`ResultadoAlocacao`, `ReconciliarResult`, `PermutaBorderoVinculo`, `ExecucaoPermuta`) não guardadas | `src/frontend/lib/types.test.ts` |
| Duplicação de SQL `markSettled` vs `markParcial` | 12 de 13 linhas da cláusula `UPDATE ... SET` idênticas (~92 %), 4 de 12 linhas do bloco de parâmetros idênticas | Baixa, mas justificada | ⚠️ P3 — decisão consciente documentada | `PermutaExecucaoRepository.ts:287-344` vs `:346-397` |
| Cross-layer violations introduzidas no delta | 0 | 0 | ✅ | `grep -n "from '.*lambda/" domain/**/*.ts` + inspeção do diff |
| Fan-out de imports em `ReconciliacaoPermutaService.ts` | 15 (era 12 em `main`; +3 pelos dois erros novos e o adapter) | ≤ 15 | ⚠️ no teto | `grep -cE '^import ' domain/service/permutas/ReconciliacaoPermutaService.ts` |

> ⚠️ **Não medível neste gate (`--quick`)**: cobertura por arquivo (não rodada), audits externos, latência do lock em produção. A cobertura do módulo já foi medida no run `2026-09-08-1414-permutas` (94,74 % stmts / 72,78 % branch para `permutas/`). O acréscimo de 562 linhas de teste em `ReconciliacaoPermutaService.test.ts` (incluindo 3 casos de concorrência) sobe branch coverage, mas por convenção `--quick` não recalcula.

## 3. Tactics — Cobertura no delta

Só as tactics tocadas pelo delta são avaliadas — o restante entra por herança do run do módulo.

| Tactic (Bass) | Implementação no delta | Status | Evidência |
|---|---|---|---|
| **Split Module** | O delta ADICIONOU 3 privados (`chaveDeLock`, `assertCobertura`, `removerBorderoOrfao`) mas o laço central `reconciliarSerializado` cresceu de 96 para ~223 linhas e cc 35 → 36. As extrações pedidas em `mod-1` (`resolveExecutionMode`, `ensureBordero`, `processarUmaAlocacao`) não foram feitas. | ⚠️ parcial | `ReconciliacaoPermutaService.ts:183-403` |
| **Increase Semantic Coherence** | `markParcial` foi criado como IRMÃO de `markSettled` (não parâmetro): cada método afirma uma proposição distinta no livro-razão (comment `:346-354`). Escolha correta para modificabilidade — futuras mudanças em um terminal não arrastam o outro. | ✅ | `PermutaExecucaoRepository.ts:287-397` |
| **Encapsulate** | `TOLERANCIA_FECHAMENTO_NEG = 0.005` foi elevada a top-level nomeada e comentada (delta introduziu, `:41`). O laço não referencia mais o literal cru. **Miss:** `limiteResiduo = 1` ficou INLINE dentro de `ancorarVariacaoNoAdto` (`:886`), sem nome de módulo — dois cardinais de regra, dois níveis de encapsulamento distintos. | ⚠️ parcial | `ReconciliacaoPermutaService.ts:41` vs `:886` |
| **Use an Intermediary** | A duplicação FE↔BE das uniões (`ExecucaoStatus`, `PermutaStatusBordero`, `LoteAdiantamentoStatus`) NÃO foi resolvida. O delta introduziu `types.test.ts` como **guarda de detecção**, que lê o arquivo-fonte do backend e compara literais. Isso mata o modo de falha (adicionar estado só de um lado passa CI silencioso), mas não elimina a duplicação — a duas fontes seguem existindo. | ⚠️ mitigado, não resolvido | `src/frontend/lib/types.test.ts:1-75` |
| **Restrict Dependencies** | Nenhum layer skip introduzido; `routes/permutas.ts` continua chamando `ReconciliacaoPermutaService` (via `ReconciliacaoLotePermutaService`, o adapter certo). Zero regressão. | ✅ | `git diff HEAD~1 -- routes/permutas.ts` |
| **Abstract Common Services** | Não aplicado ao par `markSettled`/`markParcial` (SQL 92 % duplicada). Decisão consciente e defensável (a duplicação comunica que cada método diz uma coisa distinta), mas a tactic canônica seria um `applyTerminal(status, data)` privado. | ⚠️ deliberadamente não | `PermutaExecucaoRepository.ts:287-397` |
| **Refactor** | Segue como follow-up `mod-1` do run anterior — 3 ciclos de atraso, com o delta reforçando a função sem atacar a dívida. | ❌ (herdado) | `docs/regis-review/2026-09-08-1414-permutas/modifiability.md:253-264` |
| **Defer Binding** (config externalization) | `TOLERANCIA_FECHAMENTO_NEG` e `limiteResiduo` seguem hardcoded em código — não vão para `EnvironmentProvider` nem para SSM. Aceitável para epsilons NUMÉRICOS de invariante (não são política de negócio), inaceitável para plano de contas 130/131 (F-modifiability-1 do run anterior, ainda aberto). | ⚠️ mesmo posture herdado | `ReconciliacaoPermutaService.ts:22, 29, 41, 886` |
| Split Module (frontend) | `ui.tsx` cresceu +41 linhas (novo ramo B1'). Ainda coeso; sem sinal de partir. | ✅ | `src/frontend/app/permutas/components/ui.tsx:124-143` |
| Increase Semantic Coherence (frontend) | `PermutaStatusBordero` ganhou `parcial-aguardando-finalizacao` — ramo explícito no `switch` (`ui.tsx:129`), sem `else` guarda-chuva. Alta coerência. | ✅ | `ui.tsx:124-143` |

## 4. Findings

### F-modifiability-1: Oportunidade `mod-1` não tomada — `reconciliarSerializado` cresceu +255 LOC sem extração

- **Severidade**: P2 (débito herdado NÃO agravado, mas oportunidade evidente desperdiçada dentro do próprio delta)
- **Tactic violada**: Split Module
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:183-403`
- **Evidência (objetiva)**:
  ```
  main baseline (git show main:...):  ReconciliacaoPermutaService.ts  838 LOC, `reconciliar` cc 35
  HEAD (delta):                       ReconciliacaoPermutaService.ts  1093 LOC, `reconciliarSerializado` cc 36
  Grep resolveExecutionMode|ensureBordero|processarUmaAlocacao: 0 hits (mod-1 do run 2026-09-08-1414 pedia esses três)
  Métodos privados extraídos no delta: chaveDeLock, assertCobertura, removerBorderoOrfao — nenhum é os três pedidos
  ```
- **Impacto técnico**: o próximo card sobre este serviço (ADR-0043 emenda de hoje já cita um novo pedaço — o "reconciling órfão" em `:307-338`) vai bater na mesma parede: uma função de 223 linhas com dez responsabilidades intercaladas (idempotência viva, dry-run, criação de borderô, execução, catch, órfão, retorno) é hostil a mudança cirúrgica. Cada regra nova acrescenta um bloco.
- **Impacto de negócio**: risco de regressão em cada ADR novo sobre a baixa. O run anterior atribuiu 78 dias de atraso a `mod-1`; o delta atual não é o momento de cobrar, mas confirma que ele não é auto-remediável — sem um ciclo dedicado, nunca vai ceder.
- **Métrica de baseline**: cc 36 (limite 15); LOC 1.093 (alvo 600); função central 223 linhas.

### F-modifiability-2: `limiteResiduo` introduzido inline, sem elevar a top-level nomeada como fez com `TOLERANCIA_FECHAMENTO_NEG`

- **Severidade**: P3 (delta-introduzido, custo de mudança pequeno hoje)
- **Tactic violada**: Encapsulate
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:886`
- **Evidência (objetiva)**:
  ```
  :22   const CONTA_GER_JUROS = 131;             // top-level, comentado, ADR-referenciado
  :29   const CONTA_GER_DESCONTO = 130;          // idem
  :41   const TOLERANCIA_FECHAMENTO_NEG = 0.005; // top-level, comentado, ADR-referenciado (DELTA)
  :886  const limiteResiduo = 1;                 // INLINE, dentro de ancorarVariacaoNoAdto (DELTA)
  ```
  O comentário nas linhas anteriores (`:880-889`) explica bem POR QUE R$1,00 e por que é absoluto — o que é ótimo — mas o valor não é referenciável de fora do método, e o próximo teste que quiser exercitar o teto vai precisar entrar em `ancorarVariacaoNoAdto` para ler o número.
- **Impacto técnico**: quando a próxima decisão for "queremos R$1,50 no ambiente Y ou uma tolerância proporcional para adto grande", a mudança toca uma linha DENTRO do método — o mesmo antipadrão que `TOLERANCIA_FECHAMENTO_NEG` acertou.
- **Impacto de negócio**: nenhum agora — é higiene. Mas o run anterior tem F-modifiability-4 exatamente sobre "13 magic numbers dispersos": o delta acabou de somar 1, no mesmo arquivo, sem imitar a boa prática que ele mesmo introduziu 800 linhas acima.
- **Métrica de baseline**: 1 constante nova top-level (boa) + 1 constante nova inline (má) = paridade zero dentro do próprio arquivo.

### F-modifiability-3: Guarda de paridade FE↔BE cobre 3 uniões, mas propriedades de interface (`ResultadoAlocacao`, `ReconciliarResult`, `PermutaBorderoVinculo`, `ExecucaoPermuta`) seguem sem guarda

- **Severidade**: P3 (delta introduziu mitigação; upgrade opcional)
- **Tactic violada**: Use an Intermediary (mitigada por detecção, não resolvida)
- **Localização**: `src/frontend/lib/types.test.ts:44-75` (guarda) vs `src/frontend/lib/types.ts:265-274, 322-330, 341-347, 380-388` (interfaces sem guarda)
- **Evidência (objetiva)**:
  ```
  Guardado: ExecucaoStatus, PermutaStatus/PermutaStatusBordero, LoteAdiantamentoStatus
  Não guardado (propriedades espelhadas manualmente):
    - ResultadoAlocacao { invoiceDocCod, status, dryRun, borCod, bxaCodSeq, valorBaixado, valorResidualUsd, erro, payload }
    - ReconciliarResult { adiantamentoDocCod, dryRun, writeEnabled, borCod, resultados }
    - ReconciliarLoteResult { totalCasos, totalSettled, totalParciais, totalErros, borderos, resultados }
    - PermutaBorderoVinculo { borCod, permutaStatus, situacao }
    - ExecucaoPermuta { idempotencyKey, adiantamentoDocCod, invoiceDocCod, ... }
  ```
  A guarda extrai literais de STRING de uma `export type = 'a' | 'b'`. Não pega adição de PROPRIEDADE nova numa interface — que é o modo de falha mais frequente da duplicação (o delta ADICIONOU `valorResidualUsd?` a `ResultadoAlocacao` nos dois lados, à mão, e nada checaria se um lado esquecesse).
- **Impacto técnico**: quando o próximo campo entrar em `ResultadoAlocacao` (por exemplo, o `valorResidualBrl` que ADR-0043 emenda menciona como follow-up), a UI vai receber `undefined` até alguém rodar o build do outro projeto e reparar.
- **Impacto de negócio**: modo de falha silencioso — número aparece na tela como "—" e o analista clica pra baixa achando que fechou 100 %.
- **Métrica de baseline**: 3 uniões guardadas / 3 uniões existentes = 100 %. 0 interfaces guardadas / ≥5 interfaces espelhadas com valorResidualUsd/valorBaixado/etc. = 0 %.

### F-modifiability-4: SQL de `markSettled` vs `markParcial` = 92 % idêntica; escolha consciente, custo real de manutenção baixo

- **Severidade**: P3 (nota, não obrigação — decisão bem documentada)
- **Tactic violada**: Abstract Common Services (deliberadamente não aplicada)
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:287-344` vs `:346-397`
- **Evidência (objetiva)**:
  ```
  markSettled UPDATE ... SET: 12 linhas
  markParcial UPDATE ... SET: 13 linhas (a mais: `valor_residual_usd = $valorResidualUsd`)
  Linhas idênticas na cláusula SET: 11 de 12 (~92 %)
  Bloco de bind de parâmetros: 8 de 8 chaves comuns idênticas + 1 chave a mais (`valorResidualUsd`)
  ```
  O comment em `:346-354` explica: os dois métodos AFIRMAM COISAS DIFERENTES no livro-razão (`settled` = "alocado 100 % baixado"; `parcial` = "baixa confirmada mas resíduo a re-alocar"), e colapsá-los reintroduziria o `settled` mudo que ADR-0043 mata.
- **Impacto técnico**: se uma coluna nova entrar em ambos os terminais, precisa ser adicionada duas vezes. Baixo — só duas cópias, ambas visíveis lado a lado, e o campo distinto (`valor_residual_usd`) é o único acoplado ao domínio de `parcial`.
- **Impacto de negócio**: nenhum previsível — a granularidade de cada método reforça auditabilidade da baixa, o que É o negócio deste código.
- **Métrica de baseline**: 92 % duplicação; 0 findings sobre auditoria do livro-razão desde `parcial` entrou.

## 5. Cards Kanban

Nenhum card **novo** de P0/P1 sai do delta — modificabilidade dele é neutra (não agrava a dívida `mod-1`, mas também não a ataca) e as duas questões cirúrgicas viram P3 acionáveis, listadas abaixo. Os cards `modifiability-1`/`-2`/`-4`/`-8` do run `2026-09-08-1414-permutas` seguem vigentes — este gate NÃO os re-abre; apenas os cita.

### [modifiability-delta-1] Nomear e elevar `limiteResiduo` a top-level constante do módulo

- **Problema**
  > O delta introduziu duas constantes novas de regra em `ReconciliacaoPermutaService.ts`. Uma virou top-level nomeada e comentada (`TOLERANCIA_FECHAMENTO_NEG = 0.005`, `:41`); a outra ficou inline dentro do método (`const limiteResiduo = 1`, `:886`). Inconsistência gratuita — a segunda vale exatamente pela mesma razão que a primeira (invariante do domínio, referenciada em ADR-0020).

- **Melhoria Proposta**
  > Aplicar **Encapsulate**: elevar `limiteResiduo` a `const LIMITE_RESIDUO_ANCORAGEM_BRL = 1;` no topo do arquivo, com o mesmo padrão de comentário de `TOLERANCIA_FECHAMENTO_NEG` (por que é absoluto, ADR-referência, o que acontece se mudar). Se o card `modifiability-4` do run anterior for atacado (mover para `permutas/config/`), levar as duas juntas.

- **Resultado Esperado**
  > Ambas as constantes referenciáveis por nome de módulo, testáveis sem entrar em `ancorarVariacaoNoAdto`, coerentes com o padrão do resto do arquivo.
  > Métrica: 2/2 constantes novas do delta como top-level nomeadas (hoje: 1/2).

- **Tactic alvo**: Encapsulate
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1h)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Constantes de regra top-level em `ReconciliacaoPermutaService.ts`: 3 → 4
  - Grep de literais `= 1` dentro de métodos de regra: −1
- **Risco de não fazer**: nenhum imediato. Débito acumulável — a cada delta em que o padrão não é imitado, o F-modifiability-4 herdado engorda em 1.
- **Dependências**: nenhuma.

### [modifiability-delta-2] Estender guarda de paridade FE↔BE para interfaces (não só uniões)

- **Problema**
  > O delta ADICIONOU `valorResidualUsd?: number` em `ResultadoAlocacao` nos dois lados à mão, e nada teria detectado se ficasse só de um lado. `types.test.ts` fecha o modo de falha para 3 UNIÕES (`ExecucaoStatus`, `PermutaStatus`/`PermutaStatusBordero`, `LoteAdiantamentoStatus`), mas ≥5 interfaces espelhadas seguem sem guarda: `ResultadoAlocacao`, `ReconciliarResult`, `ReconciliarLoteResult`, `PermutaBorderoVinculo`, `ExecucaoPermuta`.

- **Melhoria Proposta**
  > Estender o mesmo padrão de detecção do `types.test.ts` para extrair a lista de PROPRIEDADES de uma `interface`/`export type X = {...}` no arquivo backend e comparar com o frontend. Alternativa canônica (mais forte, também mais cara): **Use an Intermediary** — extrair um pacote compartilhado (`packages/permutas-contracts`) e importá-lo dos dois lados. A guarda por parse é o meio-termo aceitável enquanto o monorepo não for repartido.

- **Resultado Esperado**
  > Adicionar um campo à interface backend sem espelhar no frontend faz o CI reprovar; o modo de falha silencioso ("`—`" na tela) some.
  > Métrica: interfaces espelhadas cobertas por parity test: 0/5 → 5/5.

- **Tactic alvo**: Use an Intermediary (via detection guard); alternativa Encapsulate + Shared Contract
- **Severidade**: P3
- **Esforço estimado**: M (2–3 dias — o parser TS via regex fica frágil; talvez mais simples usar o compiler API para extrair os membros)
- **Findings relacionados**: F-modifiability-3, F-modifiability-2 do run anterior, F-modifiability-5 do run anterior
- **Métricas de sucesso**:
  - Uniões guardadas: 3/3 (mantido)
  - Interfaces guardadas: 0/5 → 5/5
  - Regressão FE↔BE detectada em CI antes de merge: 100 % dos casos
- **Risco de não fazer**: campo novo espelhado à mão vai divergir na primeira feature em que o dev do frontend não abrir o backend. `valorResidualUsd` é a próxima que a UI vai apresentar (rateio, tela de re-alocação); qualquer campo derivado dele nasce nesse risco.
- **Dependências**: depende de `modifiability-2` do run 2026-09-08-1414 (que propõe o SSOT via pacote compartilhado) — se aquele card for feito primeiro, este vira desnecessário.

## 6. Notas do agente

- **Baseline pareado**: medi `main` e `HEAD` no MESMO Biome, no MESMO worktree, com o MESMO arquivo copiado como `_baseline.ts` para não sofrer com `ignore` do biome.json. `main` cc = 35, `HEAD` cc = 36. **Piorou em +1 ponto** — noise, mas explicitamente NÃO melhorou como `mod-1` pedia.
- **PatternGuardian já cometeu, neste ciclo, o erro que este gate evita**: reportou 2 SQLs de `main` como violação nova porque o arquivo cresceu. Meu método aqui — `git show main:… > /tmp/*; cp; biome lint; rm;` — foi construído justo para não repetir isso.
- **Cross-QA**: F-modifiability-1 (extrações não feitas) tem simetria em **Testability** (função de 223 linhas é hostil a mock cirúrgico) e em **Fault-Tolerance** (o bloco de `reconciling` órfão `:307-338` vive DENTRO do laço central, tornando difícil raciocinar sobre o modo de recuperação sem ler a função inteira). F-modifiability-3 (paridade FE↔BE) tem simetria em **Integrability** (o contrato é a interface FE↔BE; a guarda por parse é uma tactic de Integrability aplicada). F-modifiability-2 (`limiteResiduo` inline) tem simetria em **Deployability** — se um dia esses valores forem por ambiente/tenant, cada um sem nome é uma mudança a mais que exige redeploy.
- **Escopo `--quick`**: não rodei `madge`, não recalculei coverage, não escaneei fan-in de todo `domain/service/`. Métrica de fan-out foi feita à mão sobre os 3 arquivos do delta. `_shared-metrics.md` cobre os globais e não conflita com nada aqui.
- **Confiança**: alta na cc do laço, alta no ratio de duplicação SQL (linhas contadas), média-alta no fan-out (imports podem ter type-only imports que o `grep` conta como import físico — a ordem de grandeza está certa).
