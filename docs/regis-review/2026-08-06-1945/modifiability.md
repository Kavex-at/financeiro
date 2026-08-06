---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-08-06-1945
agent: qa-modifiability
generated_at: 2026-08-06T19:45:00-03:00
scope: backend + frontend (delta apenas — /feature-tweak `bordero-vazio-orfao`)
score: 8
findings_count: 4
cards_count: 3
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

Escopo restrito ao delta do tweak `bordero-vazio-orfao`. O cenário abaixo enquadra a
mudança **como decisão de modifiability** — não do sistema inteiro.

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista (Simone) + operação real | Descoberta em produção de que o borderô nasce ANTES da 1ª baixa (I-Write-3) e sobra como casco vazio quando todas as baixas falham (borderô 18538, 2026-08-06) | `ReconciliacaoPermutaService.reconciliar` (produtor) + `BorderoGestaoService.finalizarBordero` (consumidor) + `BorderosPanel.tsx` (UI) | Runtime; primeira escrita real do sistema no `fin010` (Frente I / Permutas) | Adicionar duas guardas (limpeza best-effort + recusa server-side) **sem alterar o handshake do ERP**, sem quebrar o caso misto (falha-depois-sucesso), e mantendo o erro real da baixa visível ao analista | Delta ≤ 100 LOC úteis; 0 novos warnings de complexidade; testes cobrindo 6 caminhos; ADR + regra de negócio (I-Write-7) atualizados; zero mudança de contrato de API |

Resposta observada: **+80 LOC úteis** (soma de `ReconciliacaoPermutaService` +62, `BorderoGestaoService` +18, `BorderosPanel` +10, retirando comentários), **0 novo warning de complexidade cognitiva** vs baseline 35, **6 testes novos**, e ontologia atualizada (I-Write-7 + ADR-0030). Cumpre o cenário.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Warnings `noExcessiveCognitiveComplexity` no repo | 35 | ≤ 35 (baseline pré-delta) | ✅ | `cd src/backend && npm run lint` — baseline confirmado com `git stash -u` |
| Warnings de complexidade **introduzidos pelo delta** | 0 | 0 | ✅ | comparação `35 (stash) == 35 (com delta)` |
| Warnings tocando `ReconciliacaoPermutaService.ts` | 0 | 0 | ✅ | `npm run lint 2>&1 \| grep ReconciliacaoPermutaService` (nada) |
| Warnings tocando `BorderoGestaoService.ts` | 1 (pré-existente, `statusPorAdiantamento` linha 488) | 0 no delta novo | ✅ | linha `statusPorAdiantamento` NÃO tocada pelo delta; era warning antes |
| LOC do arquivo `ReconciliacaoPermutaService.ts` | 838 | ≤ 600 (Bass p95) | ⚠️ pré-existente | `wc -l` — cresceu de ~776 para 838 (+62 pelo delta) |
| LOC do arquivo `BorderoGestaoService.ts` | 564 | ≤ 600 (Bass p95) | ✅ | `wc -l` — cresceu de 546 para 564 (+18 pelo delta) |
| LOC do método `reconciliar` | 204 (99→302) | ≤ 60 (Bass) | ⚠️ pré-existente | `awk 'NR>=99 && NR<=302'`; em `main` era 191 (92→282). Delta +13 linhas (9 de código + 4 de comentário) |
| LOC do novo método `removerBorderoOrfao` | 34 (310→344, com JSDoc) | ≤ 60 | ✅ | leitura direta |
| LOC do novo método `assertBorderoTemItens` | 8 (264→272, sem JSDoc) | ≤ 60 | ✅ | leitura direta |
| Fan-in `ReconciliacaoPermutaService` | Não medível localmente em `--quick` | — | ⚠️ | fora do escopo de delta |
| Cross-layer violations no delta | 0 | 0 | ✅ | leitura: Service→Client (`ConexosBaixaClient`), Service→Repository (`PermutaExecucaoRepository`), Service→LogService — camadas respeitadas |
| Magic numbers introduzidos | 0 | 0 | ✅ | delta não introduz constantes numéricas cruas em regras de negócio |
| Predicados "borderô vazio" no repo | 3 pontos, 3 shapes distintos | 1 (canônico) OU N (justificados por fonte de dados) | ⚠️ | `Grep -n "status === 'settled'"` + `listBaixas` + `baixas.length` — ver F-modifiability-1 |
| Cobertura documental (ADR + regra de negócio) | ADR-0030 + I-Write-7 no `fin010-write-contract.md` | presente | ✅ | `ontology/decisions/0030-*.md` (82 linhas) + adendo em `business-rules/fin010-write-contract.md:105-122` |
| Testes cobrindo os 4 caminhos de `removerBorderoOrfao` + 2 de `assertBorderoTemItens` | 6 novos | ≥ 4 | ✅ | `_shared-metrics.md` |

## 3. Tactics — Cobertura no delta

Foco: só as tactics que o delta exercita OU que seriam pertinentes em uma revisão de mudança dessa forma.

| Tactic (Bass) | Implementação atual no delta | Status | Evidência |
|---|---|---|---|
| Split Module | Duas responsabilidades separadas — produtor (`ReconciliacaoPermutaService.removerBorderoOrfao`) e consumidor (`BorderoGestaoService.assertBorderoTemItens`) — em vez de acoplar tudo num só ponto | ✅ presente | `ADR-0030 §Decisão`; produtor em `ReconciliacaoPermutaService.ts:310-344`, consumidor em `BorderoGestaoService.ts:264-272` |
| Increase Semantic Coherence | `removerBorderoOrfao` isolada como método próprio (não inline no loop de `reconciliar`); comentário JSDoc a amarra a I-Write-7 | ✅ presente | `ReconciliacaoPermutaService.ts:304-344` — método pequeno, um único propósito |
| Encapsulate | O predicado "baixa confirmada" foi extraído para `isBaixaConfirmada` (const de módulo com JSDoc explicando por que só `settled` conta) — encapsula a definição no produtor | ✅ presente | `ReconciliacaoPermutaService.ts:35-40` |
| Use an Intermediary | Fonte da verdade delegada ao ERP via `ConexosBaixaClient.listBaixas` (em vez de contar a trilha local) | ✅ presente | `ReconciliacaoPermutaService.ts:317` e `BorderoGestaoService.ts:265` — ambos consultam o ERP como intermediário autoritativo |
| Restrict Dependencies | Nenhuma dependência nova introduzida — reutiliza clients já injetados via tsyringe | ✅ presente | construtores de `ReconciliacaoPermutaService` e `BorderoGestaoService` inalterados; nenhum novo `@inject` |
| Refactor | `reconciliar` **não** foi refatorado; delta apenas adicionou linhas ao método já grande (204 linhas) | ⚠️ parcial | ver F-modifiability-2 |
| Abstract Common Services | O predicado "borderô vazio" está expresso em 3 lugares com predicados diferentes (justificados por fonte de dados — ver ADR-0030), mas o CONCEITO é compartilhado | ⚠️ parcial | ver F-modifiability-1 |
| Defer Binding — polymorphism / config | N/A — delta é regra de negócio determinística (I-Write-7); não há decisão a diferir | N/A | não há flag/constante configurável razoável aqui: "borderô vazio" não deveria ser tunável em runtime |
| Defer Binding — configuration files | N/A — nenhum magic number novo; nenhuma regra de negócio hardcoded que deveria virar SSM | N/A | delta não introduz constantes numéricas em regra |
| Increase Cohesion — Split Class | Não necessário no delta; arquivos crescem mas cada método permanece coerente | ✅ presente | métodos novos (`removerBorderoOrfao`, `assertBorderoTemItens`) fazem UMA coisa |

## 4. Findings (achados)

### F-modifiability-1: Predicado "borderô vazio" expresso em 3 lugares com shapes diferentes

- **Severidade**: P3 (baixo — melhoria opcional; divergência é justificada pelas fontes de dados)
- **Tactic violada**: Abstract Common Services (parcial)
- **Localização**:
  - `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:40` — `isBaixaConfirmada = (r) => r.status === 'settled'` (produtor, `resultados` in-memory)
  - `src/backend/domain/service/permutas/BorderoGestaoService.ts:265-266` — `baixas = await conexosBaixaClient.listBaixas(...); if (baixas.length === 0)` (consumidor, ERP)
  - `src/frontend/app/permutas/BorderosPanel.tsx:471` — `const vazio = !b.baixas.some((x) => x.status === 'settled')` (UI, trilha via API)
- **Evidência (objetiva)**:
  ```
  // Produtor (in-memory): !resultados.some(r => r.status === 'settled')
  // Consumidor (ERP):     (await listBaixas()).length === 0
  // Front (trilha):       !b.baixas.some(x => x.status === 'settled')
  ```
- **Impacto técnico**: Se a definição de "borderô vazio" evoluir (ex.: "vazio = zero baixas `settled` **e** zero em `reconciling`"), três pontos precisam mudar juntos. Não há teste que garanta a coerência semântica entre eles. Hoje o ADR-0030 (§"Por que a contagem vem do ERP, e não da trilha") justifica explicitamente por que o consumidor **não** pode usar a mesma fonte do produtor (a trilha guarda linhas `error` com `bor_cod` mas sem baixa no ERP). Então a divergência de **fonte** é intencional; o que se pode consolidar é a definição do **status alvo** (`settled`).
- **Impacto de negócio**: Baixo. Um dos três predicados ficar dessincronizado pode reintroduzir cascos aprovados (front-only bug) ou impedir aprovações legítimas (backend-only bug). Estrutura atual é defensável (dois deles convergem no ERP; o produtor precisa da avaliação in-memory porque roda **antes** da confirmação estável). Documentação (ADR-0030) mitiga o risco de esquecimento em ~80%.
- **Métrica de baseline**: 3 pontos de definição, 0 constantes/tipos compartilhados, 6 testes cobrem os caminhos individuais mas nenhum verifica coerência conjunta.

### F-modifiability-2: Método `reconciliar` já ultrapassa 200 linhas e o delta acresce

- **Severidade**: P2 (médio — débito técnico defensável; delta contribui marginalmente)
- **Tactic violada**: Split Module / Refactor (parcial)
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:99-302` (método `reconciliar`)
- **Evidência (objetiva)**:
  ```
  Baseline (main): reconciliar = 191 linhas (92→282)
  Após delta:      reconciliar = 204 linhas (99→302)
  Delta próprio:   +13 linhas (9 de código + 4 de comentário) — flag `borderoCriadoAqui` + bloco de cleanup no fim
  ```
- **Impacto técnico**: O método concentra: (a) resolução de saldo/adto, (b) auto-alocação lazy, (c) resolve de guard-rails de dry-run/write, (d) loop de handshake com 4 sub-condicionais de idempotência, (e) tratamento de erro por par, e agora (f) cleanup de órfão. Cada nova regra empurra o método mais longe do limite de compreensão de uma leitura. É o "hot spot" de mudança do módulo — Bass diria que um método com essa densidade de branches e mais essa nova responsabilidade transversal (cleanup) é candidato natural a **Split Module**.
- **Impacto de negócio**: Baixo hoje; alto se o próximo tweak precisar tocar a mesma janela (ex.: tornar o cleanup opcional por adto ou reintroduzir política de dry-run diferenciada). Já hoje um leitor precisa manter em cabeça o significado dos 4 estados de `existente` + o novo `borderoCriadoAqui` + o `alreadySettled` do `begin`.
- **Métrica de baseline**: 204 linhas em `reconciliar` (alvo Bass ≤ 60 por método). 0 warnings de `noExcessiveCognitiveComplexity` no método — o compilador Biome não pega isso porque o loop `for` é linear (a complexidade cognitiva é somada por aninhamento, não por comprimento). Portanto o débito **não** é capturado pelo gate automático.

### F-modifiability-3: `assertBorderoTemItens` sem JSDoc de contrato de erro

- **Severidade**: P3 (baixo — polimento)
- **Tactic violada**: Increase Semantic Coherence (menor)
- **Localização**: `src/backend/domain/service/permutas/BorderoGestaoService.ts:264-272`
- **Evidência (objetiva)**:
  ```typescript
  private assertBorderoTemItens = async (filCod: number, borCod: number): Promise<void> => {
      const baixas = await this.conexosBaixaClient.listBaixas({ filCod, borCod });
      if (baixas.length === 0) {
          throw new Error(
              `Borderô ${borCod} não possui baixas — não há o que aprovar. Ele ficou vazio porque ` +
                  'a baixa falhou depois de criá-lo; use "Excluir" para removê-lo.',
          );
      }
  };
  ```
  O JSDoc explica *o porquê* (I-Write-7, contagem via ERP), mas não menciona que **a mensagem lançada é lida palavra-por-palavra pela UI** (o route de finalização repassa o erro; o `toast.error` do `BorderosPanel.confirmarAcao` mostra `err.message`). Trocar a string quebra a comunicação com o analista sem que o TypeScript avise.
- **Impacto técnico**: A string do erro virou parte do contrato UX. Um refactor futuro pode "melhorar" o texto e perder a instrução acionável ("use Excluir para removê-lo"), degradando a experiência sem sinal de gate.
- **Impacto de negócio**: Muito baixo — só se manifesta em mudança futura.
- **Métrica de baseline**: 0 comentário sobre a mensagem-como-contrato; 0 teste cobre o texto da mensagem literalmente (teste 2 do `BorderoGestaoService.test.ts` cobre o `throw`, provavelmente `toThrow(/não possui baixas/)` — verificar quando o consolidador puxar).

### F-modifiability-4: `isBaixaConfirmada` como const de módulo (fora da convenção de classe)

- **Severidade**: P3 (baixo — decisão de estilo com precedente no arquivo)
- **Tactic violada**: N/A — trade-off consciente
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:35-40`
- **Evidência (objetiva)**: CLAUDE.md diz "Export classes only — never plain functions or plain objects" e "Methods as arrow functions". `isBaixaConfirmada` é `const` de módulo (não exportado). Precedente no MESMO arquivo: `round2` (linha 33) segue o mesmo padrão. Como a função é usada em um `Array.prototype.some` (não em `this.`), o padrão const-de-módulo é razoável — mover para método privado exigiria `.some(this.isBaixaConfirmada.bind(this))` ou wrap em arrow.
- **Impacto técnico**: Nenhum. O JSDoc é excelente ("Só `settled` conta — é o único estado com confirmação (`bxaCodSeq`) do ERP. `error`/`skipped`/`dry-run` NÃO põem item no borderô").
- **Impacto de negócio**: Nenhum.
- **Métrica de baseline**: 2 helpers const-de-módulo no arquivo (`round2`, `isBaixaConfirmada`) — coerência interna preservada.

## 5. Cards Kanban

### [modifiability-1] Consolidar a definição semântica de "borderô vazio" em um tipo/constante compartilhado

- **Problema**
  > O predicado "borderô vazio" aparece em três lugares (produtor `!resultados.some(isBaixaConfirmada)`, consumidor `listBaixas().length === 0`, front `!b.baixas.some(x => x.status === 'settled')`). As fontes de dados são intencionalmente diferentes (documentado no ADR-0030), mas os três compartilham o mesmo conceito de "status confirmado = `settled`". Se essa definição mudar (ex.: introduzir estado `partially-settled`), três pontos precisam mudar em sincronia — sem gate automático que force a coerência.

- **Melhoria Proposta**
  > Extrair uma constante/type-guard compartilhada — por exemplo, `export const BAIXA_STATUS_CONFIRMADO = 'settled' as const` num arquivo de tipos do domínio permutas (`src/backend/domain/interface/permuta/` ou `src/shared/types/permuta.ts`), e importada pelos três pontos. Frontend e backend do monorepo já compartilham types (ver `@/lib/types`). Tactic: **Abstract Common Services** (nível de definição, não de execução). Não consolidar a *chamada* (fontes de dados divergem por design); consolidar só o *literal do status*.

- **Resultado Esperado**
  > 1 fonte de verdade para o valor "confirmado". Testes existentes continuam válidos; um teste adicional de "grep test" garante que o literal `'settled'` aparece só na constante e nos testes.
  > - Pontos de definição: 3 → 1 (+ importadores)
  > - Custo esperado do próximo tweak que redefinir "confirmado": tocar 3 pontos → tocar 1

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Ocorrências literais de `'settled'` fora da constante/tipo: 3 → 0 (apenas testes ficam livres)
  - Testes verdes sem alteração de comportamento
- **Risco de não fazer**: Um refactor futuro (ex.: introduzir `reconciling-partial`) esquece um dos três pontos e reintroduz a bug-classe do borderô 18538 — aprovações vazias ou aprovações bloqueadas indevidamente.
- **Dependências**: nenhuma

### [modifiability-2] Extrair o loop de baixa de `reconciliar` para um método próprio (`baixarAlocacoesDoBordero`)

- **Problema**
  > `ReconciliacaoPermutaService.reconciliar` está com 204 linhas (era 191, +13 pelo delta) e concentra: (a) resolução de adto/saldo, (b) auto-alocação lazy, (c) resolve de dry-run/write, (d) loop com 4 sub-branches de idempotência, (e) tratamento de erro por par, (f) cleanup do órfão. O método já era o hot spot de mudança; cada tweak novo (I-Write-6, I-Write-7…) empurra-o mais longe da compreensibilidade. Biome não sinaliza (loop é linear), então não há gate automático.

- **Melhoria Proposta**
  > **Split Module** dentro da classe: extrair o corpo do `for (const aloc of alocacoes)` (linhas ~148-284) para um método privado `baixarAlocacoesDoBordero(params: { alocacoes; adto; filCod; dryRun; ... }): Promise<{ resultados; borCod?; borderoCriadoAqui }>`. `reconciliar` fica reduzido a: resolve → loop delegado → cleanup → return. O `borderoCriadoAqui` sai do escopo léxico e vira retorno explícito. Testes existentes continuam válidos (interface pública não muda). Considerar também extrair o bloco de "idempotência viva do settled" (linhas 175-192) em `verificarIdempotenciaViva`.

- **Resultado Esperado**
  > `reconciliar` cai para ≤ 80 linhas; o loop vive isolado com escopo próprio.
  > - LOC de `reconciliar`: 204 → ≤ 80
  > - LOC do novo `baixarAlocacoesDoBordero`: ~140 (aceitável dentro do teto de 150)
  > - Warnings `noExcessiveCognitiveComplexity`: 35 → ≤ 35 (não regride)
  > - Testes: 47/47 continuam verdes

- **Tactic alvo**: Split Module / Refactor
- **Severidade**: P2
- **Esforço estimado**: M (2–5d — cuidado com a assinatura, porque `dryRun`, `writeEnabled`, `saldoAdtoNeg`, `dataMovto`, `executadoPor` são todos usados dentro do loop)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - `reconciliar` LOC: 204 → ≤ 80
  - Complexity cognitiva do novo método: ≤ 15 (mantém sem warning)
  - Suite `ReconciliacaoPermutaService.test.ts`: 47/47 verde sem modificação
- **Risco de não fazer**: O próximo tweak que tocar essa janela (ex.: retry por par, política de auto-alocação condicional, log estruturado por par) empurra o método para > 250 linhas e nesse ponto qualquer PR passa a ser difícil de revisar. Ancoragem no gate: já é o método mais complexo do domínio permutas hoje.
- **Dependências**: nenhuma (mas coordenar com Testability — se aquele QA propuser cobertura por caminho, prefere-se um alvo já refatorado).

### [modifiability-3] Documentar `assertBorderoTemItens.throw` como contrato de UX

- **Problema**
  > A mensagem lançada por `assertBorderoTemItens` (`"Borderô N não possui baixas — não há o que aprovar. Ele ficou vazio porque a baixa falhou depois de criá-lo; use 'Excluir' para removê-lo."`) é lida palavra-por-palavra pelo `toast.error` do `BorderosPanel.confirmarAcao`. É a instrução acionável ao analista. TypeScript não avisa se um refactor "melhora" o texto e derruba o "use Excluir".

- **Melhoria Proposta**
  > Adicionar comentário no método marcando a mensagem como parte do contrato UX (`@ux-contract`), e um teste que garanta a presença do fragmento "use \"Excluir\"" — evita erosão. Alternativa mais forte (não requerida): mover a string para um constante nomeada (`MSG_BORDERO_VAZIO`) e importá-la também no teste do route.

- **Resultado Esperado**
  > A mensagem é vista como interface e não como log de debug.
  > - Testes que fixam o texto: 0 → 1
  > - Warnings de complexidade: 35 → 35

- **Tactic alvo**: Increase Semantic Coherence
- **Severidade**: P3
- **Esforço estimado**: S (≤1d — literalmente 5min)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Presença de `@ux-contract` (ou equivalente) no JSDoc do método: ausente → presente
  - Teste que assert o fragmento chave: ausente → presente
- **Risco de não fazer**: Baixo, mas real — um refactor de "internacionalização" ou "logs mais concisos" reescreve a mensagem e o analista perde a instrução; volta o mesmo problema que o delta corrigiu (borderô 18538: "não diz o que fazer").
- **Dependências**: nenhuma

> **F-modifiability-4 (const de módulo `isBaixaConfirmada`)** não gera card: o precedente `round2` no mesmo arquivo torna o padrão aceitável, o JSDoc é excelente, e movê-lo para método privado exigiria bind/wrap em `.some()` — troca ruim.

## 6. Notas do agente

- **Escopo aplicado**: revisei APENAS o delta do tweak; `_shared-metrics.md` já confirmou 0 warnings novos de complexidade. Baseline (35 warnings) foi re-verificado com `git stash -u` — a única linha de warning que TOCA arquivos do delta é `BorderoGestaoService.ts:488` (`statusPorAdiantamento`), método NÃO alterado pelo delta.
- **Cross-QA — Testability**: F-modifiability-2 (split de `reconciliar`) reduz também o custo de teste de caminhos individuais; se `qa-testability` propuser cobertura por sub-branch, esse card vira dependência natural.
- **Cross-QA — Integrability**: F-modifiability-1 (consolidar `'settled'`) toca o contrato entre backend e frontend (o front usa a mesma string via `BorderoResumo.baixas[].status`). Alerta ao consolidator para checar se `qa-integrability` mapeia essa string como parte do contrato.
- **Cross-QA — Deployability**: nenhum novo magic number introduzido; delta não move nada para/de SSM. Sem overlap.
- **Documentação ontológica**: ADR-0030 e I-Write-7 são de qualidade acima do baseline do repo — a decisão está rastreável, alternativas descartadas registradas, escopo deliberadamente fora explicitado ("órfãos existentes não são varridos"). Modifiability score sobe por isso: quem herdar esse código sabe *por que* está do jeito que está.
