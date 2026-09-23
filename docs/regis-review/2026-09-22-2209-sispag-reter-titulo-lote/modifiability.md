---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-22-2209
agent: qa-modifiability
generated_at: 2026-09-23T12:00:00-03:00
scope: backend+frontend (delta de sispag-reter-titulo-lote)
score: 8.4
findings_count: 4
cards_count: 3
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev (Kavex) que amanhã precisa mexer na retenção (mudar teto do motivo, trocar `sempre / se-automatico`, expor a retenção em outra tela, ou eventualmente marcar retenção sem lote — hipótese que já foi rejeitada em P1-2 mas pode retornar) | Nova regra ou tela puxa `retirarDoLote` / `liberarRetencao` / retenção; ou o teto do motivo muda de 500 para outro valor; ou o motivoRemocao ganha um terceiro caso | `LotePagamentoService` (2 métodos novos + `removerItemDoLote` privado compartilhado), `RetencaoFormacaoRepository` (novo, isolado), `SispagPainelService` (join da retenção no painel), 2 rotas admin (`POST .../retirar-do-lote`, `DELETE .../retencao`), migration `0062` (tabela + índice parcial + 3 CHECKs), frontend (`page.tsx`, `LoteCard.tsx`, `RetencaoBadge.tsx`, `RetirarDoLoteDialog.tsx`, `retencao.ts`, `lib/sispag.ts`) | Dev toca ≤ N arquivos p/ a mudança, sem quebrar invariantes; PatternGuardian aprova; testes verdes | N ≤ 4 para uma mudança de regra bem-encapsulada (ex.: motivo de remoção adicional = tocar `SispagInterface.MOTIVO_REMOCAO_RETENCAO`, o CHECK da 0062 numa nova migration aditiva, e o mapa de motivo em `LotePagamentoService`); mudança do teto `500` custa 3 arquivos (CHECK, Zod, const do frontend) — Defer Binding fraco mas explícito |

Este QA avalia o **delta**. O shape existente (DDD 4-layer, tsyringe, `HandlerError` tipado, Zod nos boundaries, SQL parametrizado com `$var` do wrapper e helpers `withTransaction`/`withAdvisoryLock`) é pré-existente e não é a moldura desta feature — mas foi a moldura em que o dev colocou a peça: as decisões de fronteira do agregado (`I2..I6`), o Idempotent-Insert com índice parcial e o Split Module do `RetencaoFormacaoRepository` são a leitura correta desse shape.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC dos arquivos NOVOS do delta (p50 · p95 · máx) | p50=105 · p95=133 · máx=133 | p50 ≤ 150 · p95 ≤ 400 · máx ≤ 600 | ✅ | `RetencaoFormacaoRepository.ts` (105), `RetirarDoLoteDialog.tsx` (133), `retencao.ts` (46), `RetencaoBadge.tsx` (39), `RetencaoInexistenteError.ts` (21), `TituloForaDeLoteError.ts` (22) |
| LOC dos arquivos TOCADOS (após delta) — p50 · p95 · máx | p50=444 · p95=1229 · máx=1229 | p50 ≤ 150 · p95 ≤ 400 · máx ≤ 600 | ⚠️ (arrastado pelo `page.tsx` e `lib/sispag.ts` pré-existentes) | ver appendix A |
| Crescimento vs. `main` — `LotePagamentoService.ts` | 391 → 543 (+152, +39%) — abaixo do teto de 600 | manter ≤ 600 | ✅ | `wc -l` + `git show main:...` |
| Crescimento vs. `main` — `LotePagamentoRepository.ts` | 589 → 633 (+44, +7,4%) — atravessou o teto de 600 | ≤ 600 | ⚠️ (transposição marginal, 33 linhas acima) | ver appendix A |
| Crescimento vs. `main` — `routes/sispag.ts` | 607 → 716 (+109, +18%) | ≤ 600 | ⚠️ (pré-existente já >600; delta amplia) | `git diff --stat main...HEAD` |
| Crescimento vs. `main` — `src/frontend/app/sispag/page.tsx` | 1079 → 1229 (+150, +14%) | ≤ 600 | ⚠️ (pré-existente kitchen-sink; delta amplia) | idem |
| Warnings Biome `noExcessiveCognitiveComplexity` em arquivos do DELTA | 0 (nenhum arquivo tocado pelo delta consta na lista) | 0 | ✅ | `npm run lint` (73 warnings totais, todos pré-existentes em `permutas`, `recebimentos`, clients Conexos, `services/conexos.ts`) |
| Fan-out (imports) — top do delta | `page.tsx` 24 · `routes/sispag.ts` 21 · `SispagPainelService.ts` 17 · `LotePagamentoService.ts` 17 · `LoteCard.tsx` 14 · `RetirarDoLoteDialog.tsx` 10 · `lib/sispag.ts` 3 · `RetencaoFormacaoRepository.ts` 3 | ≤ 15 por arquivo | ⚠️ (só `page.tsx` e `routes/sispag.ts` acima do teto — pré-existentes) | ver appendix A |
| Fan-in — `RetencaoFormacaoRepository` (novo) | 2 chamadores efetivos: `LotePagamentoService`, `SispagPainelService` (+ 2 tests + o próprio arquivo) | Baixo fan-in é OK para repo novo; escrita concentrada no service | ✅ | `grep -rln` |
| Fan-in — `LotePagamentoService` (tocado) | 2 chamadores efetivos: `routes/sispag.ts`, `jobs/validate-retomada-remessa-v1.ts` | Escrita concentrada; baixo custo de propagação | ✅ | idem |
| Violações Lambda→Service→Repository→Client no DELTA | 0 (rota chama service; service chama repository/client; repository só toca DB) | 0 | ✅ | inspeção manual de `routes/sispag.ts` (as duas novas rotas resolvem `LotePagamentoService`) |
| Ciclos de dependência introduzidos pelo delta | 0 detectados | 0 | ✅ | inspeção dos imports novos |
| Métodos públicos por classe (delta) | `LotePagamentoService` 12 (era 10; +2: `retirarDoLote`, `liberarRetencao`) · `LotePagamentoRepository` 26 (era 25; +1 método com sig. expandida: `lerEstadoParaEdicao`; `listTitulosEmRascunho` alargou o retorno) · `RetencaoFormacaoRepository` 3 (`listAtivas`, `insertAtiva`, `liberarAtiva`) | Repository focado; service com responsabilidades diretas do agregado | ⚠️ (LotePagamentoRepository já grande antes; +1 método/+44 linhas) | `grep -c` |
| Split Module explícito nesta feature | Sim — `RetencaoFormacaoRepository` (105 LOC, 3 métodos, uma única tabela) NASCEU separado em vez de morar dentro de `TituloAPagarRepository` ou `LotePagamentoRepository` | 1 novo módulo com uma única razão de mudança | ✅ | `RetencaoFormacaoRepository.ts:26-33` (razão registrada no header) |
| Increase Semantic Coherence — `removerItemDoLote` privado compartilhado | `LotePagamentoService.removerTitulo` (lixeira do lote) e `LotePagamentoService.retirarDoLote` (aba de títulos) delegam à MESMA rotina privada, parametrizada por `retencao: 'sempre' \| 'se-automatico'`. Uma única transação faz travar-linha + remover-item + gravar-retenção + `marcarManual` + `tocarLote` | Duas entradas, uma implementação | ✅ | `LotePagamentoService.ts:44,293-339,464-491` |
| Encapsulate — retenção como agregado independente | A retenção está numa TABELA PRÓPRIA (não coluna em `titulo_a_pagar`, que é espelho do ERP e já foi purgada) e num REPOSITÓRIO PRÓPRIO. Nada acima do service conhece o SQL da retenção. | Baixo raio de acoplamento; rebuild da carteira não leva as decisões da analista junto | ✅ | `0062_titulo_retencao_formacao.sql:10-14`, `RetencaoFormacaoRepository.ts:26-33` |
| Defer Binding — motivos de remoção como constantes tipadas | `MOTIVO_REMOCAO_RETENCAO = { LIBERADO: 'liberado', INCLUIDO_NO_LOTE: 'incluido-no-lote' } as const` + `MotivoRemocaoRetencao` derivado + CHECK da 0062 apontando para as MESMAS duas strings | Sem strings soltas no código | ✅ | `SispagInterface.ts:67-73`, `0062_...sql:59-64` |
| Defer Binding — teto do motivo (`500`) | Duplicado em 3 sítios (`0062...sql:48` CHECK, `routes/sispag.ts:124` Zod `.max(500)`, `retencao.ts:9` `MOTIVO_RETENCAO_MAX = 500`). Nenhum lê do outro | Um só lugar (ou compartilhado FE-BE) mudaria por config | ⚠️ | ver F-modifiability-3 |
| Defer Binding — polimorfismo / tokens de DI | Nenhuma interface nova com múltiplas implementações; nenhum `container.register` novo. Coerente com o resto do repo (2 `container.register` em `recebimentosContainer.ts`, uso pontual). | Domain-bound; sem plugabilidade dinâmica esperada — OK documentar | ✅ | `grep -c 'container.register' src/backend` |
| Cobertura ontológica do delta | `ontology/_coverage.json` v0.28.1: `reterTituloDaFormacao` action + `retencao-formacao-automatica` (I9) business-rule ambos `planned → implemented` no mesmo ciclo; `_index.json` aponta ambos para `actions/sispag/reter-titulo-da-formacao.md` e `business-rules/retencao-formacao-automatica.md`; `TituloAPagar impl_pct 90 → 100` | Sem drift ontologia↔código nesta feature | ✅ | `ontology/_coverage.json`, `ontology/_index.json` |
| Duplicação de interfaces backend↔frontend (delta) | `LoteRascunhoRef`, `RetencaoFormacao`, `ChaveTitulo` foram declaradas nas DUAS pontas (`domain/interface/sispag/SispagInterface.ts` + `frontend/lib/sispag.ts`) com o MESMO shape | Contratos digitados uma vez só, ou gerados de uma fonte comum | ⚠️ (pré-existente como padrão do repo; delta seguiu o padrão) | ver F-modifiability-2 |

> ⚠️ **Não medível localmente**: fan-in real medido por análise estática de grafo (madge/dependency-cruiser não estão instalados neste repo). Aproximação por `grep -rln` sobre nome de classe cobre a maioria dos casos (as classes são exportadas por default, o import só usa o path). Como o delta introduz uma classe nova e altera duas existentes, todos os call-sites eram inspeccionáveis à mão.

### Appendix A — top-10 maiores arquivos após o delta (repo inteiro, `find src -name '*.ts' -o -name '*.tsx' | grep -v .test. | xargs wc -l | sort -rn | head -10`)

| # | LOC | Arquivo | Delta? |
|---|-----|---------|--------|
| 1 | 2415 | `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` | não (fora do delta) |
| 2 | 1291 | `src/backend/domain/client/ConexosGerDocProcessoClient.ts` | não |
| 3 | **1229** | **`src/frontend/app/sispag/page.tsx`** | **sim** (+150) |
| 4 | 1140 | `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts` | não |
| 5 | 1114 | `src/backend/domain/service/permutas/EleicaoPermutasService.ts` | não |
| 6 | 1111 | `src/backend/domain/service/sispag/RemessaService.ts` | não |
| 7 | 1083 | `src/frontend/app/permutas/page.tsx` | não |
| 8 | 1065 | `src/frontend/lib/recebimentos.ts` | não |
| 9 | 984 | `src/backend/routes/recebimentos.ts` | não |
| 10 | 928 | `src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx` | não |

Do delta, ainda dentro do top-20: `src/frontend/lib/sispag.ts` (787, +56), `src/backend/routes/sispag.ts` (716, +109), `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` (633, +44). Os arquivos NOVOS do delta são todos ≤ 133 LOC e nenhum aparece no top-30.

### Appendix B — top fan-in dos módulos do delta

| Fan-in efetivo | Classe | Chamadores (excluindo self + tests) |
|----|--------|------|
| 2 | `LotePagamentoService` | `routes/sispag.ts`, `jobs/validate-retomada-remessa-v1.ts` |
| 2 | `SispagPainelService` | `routes/sispag.ts`, `jobs/validate-retomada-remessa-v1.ts` |
| 2 | `RetencaoFormacaoRepository` (novo) | `LotePagamentoService`, `SispagPainelService` |
| 4 | `LotePagamentoRepository` | `LotePagamentoService`, `SispagPainelService`, `FormacaoLotesService`, `RemessaService` (fan-in mais alto do delta — mudar seu SQL ainda ripple por 4 arquivos) |

Nenhuma classe do delta tem fan-in próximo do maior do repo (`ConexosClient`/`LogService` são singletons chamados por dezenas). Como o delta não mexeu em nada de altíssimo fan-in, o ripple horizontal é pequeno.

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** (Reduce Size of Module) | `RetencaoFormacaoRepository` nasceu separado — 105 LOC, 3 métodos, escopo único (tabela `titulo_retencao_formacao`). Cabia ter sido enfiado em `TituloAPagarRepository` (só chave natural em comum) ou em `LotePagamentoRepository` (que já tem 26 métodos e 633 LOC); o dev escolheu o Split. Erros também foram separados (`RetencaoInexistenteError`, `TituloForaDeLoteError` em arquivos próprios, 21-22 LOC cada). | ✅ presente | `RetencaoFormacaoRepository.ts`, `errors/RetencaoInexistenteError.ts`, `errors/TituloForaDeLoteError.ts` |
| **Increase Semantic Coherence** | `LotePagamentoService.removerItemDoLote` é a rotina interna única que serve às DUAS entradas de saída (lixeira e "Retirar do lote"). A distinção fica num parâmetro `retencao: 'sempre' \| 'se-automatico'` — um tipo de duas cases que declara o comportamento. `SispagPainelService.montarPainel` agrega retenção junto com títulos-em-rascunho num único `Promise.all`, pertencendo à mesma responsabilidade "estado atual da carteira". | ✅ presente | `LotePagamentoService.ts:44,293-339,464-491`; `SispagPainelService.ts:91-112` |
| **Encapsulate** | A retenção não vaza da camada de serviço — nem o SQL, nem a decisão de reter ou não (`{ removido, retido }` volta como fato consumado). A tabela `titulo_retencao_formacao` não tem FK para `titulo_a_pagar` de propósito (a decisão da analista sobrevive a um rebuild da carteira; ver header da 0062). O painel expõe `retencaoFormacao?: RetencaoFormacao` como projeção read-only, nunca como handle mutável. | ✅ presente | `RetencaoFormacaoRepository.ts:25-33`, `0062_...sql:10-14`, `SispagInterface.ts:38-39,60-65` |
| **Use an Intermediary** | O `HandlerError` (interface pré-existente) + `respondLoteError` (helper local em `routes/sispag.ts`) traduz erros de domínio para HTTP sem que a rota precise conhecer cada `Error` novo. Adicionar `TituloForaDeLoteError`/`RetencaoInexistenteError` custou 0 modificação no helper — só implementar `HandlerError` na classe do erro basta. Isto é Encapsulate+Intermediary combinados. | ✅ presente | `routes/sispag.ts:130-140`, `errors/RetencaoInexistenteError.ts:7-20`, `errors/TituloForaDeLoteError.ts:8-21` |
| **Restrict Dependencies** | O delta respeita as 4 camadas: rota → service → repository → client. As duas rotas novas (`POST .../retirar-do-lote`, `DELETE .../retencao`) resolvem `LotePagamentoService` do container e nada mais. `RetencaoFormacaoRepository` só depende de `PostgreeDatabaseClient`. Nada no delta pula camada. | ✅ presente | `routes/sispag.ts:276-334`, `RetencaoFormacaoRepository.ts:36-39` |
| **Refactor** | O método `removerItemDoLote` foi ExtractMethod da lixeira antiga: `removerTitulo` deixou de ter a lógica de transação e chama o helper. Idem `travarRascunho` para o `SELECT ... FOR UPDATE`. Não são refactorings gratuitos — são preparação para a segunda entrada (`retirarDoLote`) reutilizar a mesma transação atômica sem duplicar. | ✅ presente | `LotePagamentoService.ts:293-314,321-339,464-507` |
| **Abstract Common Services** | `db.withTransaction(...)`, `db.withAdvisoryLock(...)`, `HandlerError`, `LogService` e o próprio `tsyringe` container já são serviços comuns; o delta os reusa sem inventar novos. Nenhum novo Common Service foi extraído (o volume não pedia). | ✅ presente (por reuso) | `LotePagamentoService.ts:130-157,233-280,347-353` |
| **Defer Binding** | Configuração externalizada em SSM/env é pré-existente e não muda com o delta. A binding específica desta feature é fraca em UM ponto: o teto do motivo (`500`) aparece em 3 sítios paralelos (CHECK do Postgres, Zod do route, const do frontend), sem uma fonte única. Os motivos de remoção (`liberado`/`incluido-no-lote`) estão bem defers via `MOTIVO_REMOCAO_RETENCAO as const`. Nenhum uso de polimorfismo / plugin / registration dinâmico — coerente com um domínio bounded. | ⚠️ parcial | ver F-modifiability-3 |

## 4. Findings (achados)

### F-modifiability-1: `LotePagamentoRepository.ts` atravessou o teto de 600 LOC no delta (633 LOC, 26 métodos)

- **Severidade**: P2
- **Tactic violada**: Split Module (Reduce Size of Module)
- **Localização**: `src/backend/domain/repository/sispag/LotePagamentoRepository.ts`
- **Evidência (objetiva)**:
  ```
  main:  589 LOC · 25 métodos
  HEAD:  633 LOC · 26 métodos  (+44 LOC, +1 método: `lerEstadoParaEdicao`;
                                  `listTitulosEmRascunho` alargou o retorno)
  ```
  O repositório hoje mistura ao menos 4 razões de mudança: CRUD do lote raiz (`criarLote`, `atualizarContaPagadora`, transições), CRUD dos itens (`adicionarItem`, `removerItem`, `atualizarModalidadeItem`), leitura para o painel (`listLotes`, `listTitulosEmRascunho`), metadados da remessa nativa (`nativeFlpCod`, `remessaArquivo`, `dataDebito`). O delta acrescentou uma quinta ("estado para edição sob lock"), sem alcançar Split.
- **Impacto técnico**: cada nova regra sobre o lote (ADR-0049 data de débito, ADR-0050 retenção, próximas fatias) empurra +40 a +100 LOC nesse arquivo, e um único arquivo grande é a variável que mais correlaciona com bugs de merge e revisão superficial. Um mesmo módulo com >600 LOC + 26 métodos é, por default, um risco de "todo mundo edita, ninguém revê tudo".
- **Impacto de negócio**: baixo hoje (fan-in do repositório é 4, todos internos ao domínio SISPAG); médio no horizonte de 6 meses porque as Fatias 3–4 vão acrescentar rotinas de escrita.
- **Métrica de baseline**: `LotePagamentoRepository.ts` 633 LOC (alvo ≤ 600); 26 métodos (heurístico ≤ ~15 em repositório coeso). Delta empurrou de 589 → 633, sendo a primeira feature a atravessar o teto.
- **Origem**: pré-existente amplificado pelo delta (o corte de 600 já estava a 11 LOC no `main`).

### F-modifiability-2: Interfaces `LoteRascunhoRef`, `RetencaoFormacao`, `ChaveTitulo` foram declaradas 2×  (backend + frontend), sem contrato compartilhado

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services / Encapsulate
- **Localização**: `src/backend/domain/interface/sispag/SispagInterface.ts:38-80` e `src/frontend/lib/sispag.ts:39-65`
- **Evidência (objetiva)**:
  ```
  backend: interface LoteRascunhoRef  { id: string; automatico: boolean; }
  frontend: interface LoteRascunhoRef  { id: string; automatico: boolean; }

  backend: interface RetencaoFormacao { marcadoPor: string; marcadoEm: string; motivo?: string; }
  frontend: interface RetencaoFormacao { marcadoPor: string; marcadoEm: string; motivo?: string; }

  backend: interface ChaveTitulo      { filCod: number; docCod: string; titCod: string; }
  frontend: interface ChaveTitulo     { filCod: number; docCod: string; titCod: string; }
  ```
- **Impacto técnico**: qualquer mudança de shape na API (renomear `automatico`, adicionar `retidoPor` no top-level do título, mudar `marcadoEm` para epoch) exige tocar dois arquivos em fase — e não há verificação de compile-time que os dois estejam em fase, além dos testes de integração ponta-a-ponta.
- **Impacto de negócio**: baixo em custo unitário; alto em recorrência (todo campo novo do painel é uma oportunidade de drift). Um contrato drifted pergunta ao operador "porque a badge de retenção sumiu depois do deploy do frontend?" — o tipo de bug que o TypeScript acha se estiver do mesmo lado da fonte.
- **Métrica de baseline**: 3 tipos duplicados adicionados por este delta; padrão pré-existente no repo (todos os DTOs FE/BE são duplicados hoje — a monorepo compartilha `src/backend` e `src/frontend` mas sem package comum de tipos). Marcado P3 e pré-existente-mas-ampliado por consistência.
- **Origem**: pré-existente como padrão do monorepo; delta seguiu o padrão. Não é regressão.

### F-modifiability-3: Teto do motivo (`500`) duplicado em 3 sítios sem fonte única

- **Severidade**: P3
- **Tactic violada**: Defer Binding (configuration externalization)
- **Localização**: `src/backend/migrations/0062_titulo_retencao_formacao.sql:48`, `src/backend/routes/sispag.ts:124`, `src/frontend/app/sispag/components/retencao.ts:9`
- **Evidência (objetiva)**:
  ```
  0062_...sql:48:  CHECK (motivo IS NULL OR char_length(motivo) <= 500)
  routes/sispag.ts:124:            .max(500)
  retencao.ts:9:   export const MOTIVO_RETENCAO_MAX = 500
  ```
- **Impacto técnico**: mudar o teto (750, 300, ilimitado) hoje custa TRÊS pontos de escrita coordenados — o CHECK só pode ser trocado via migration aditiva (drop+add constraint, já é o padrão do arquivo, então o preço é pequeno), o Zod recusa antes de chegar no banco, e o contador do dialog no frontend precisa concordar para a UI não parecer travada. Se um desses ficar para trás numa PR, a UX quebra em silêncio (o botão trava porque o front diz 500 mas o back permite 750, ou o backend recusa antes de o CHECK ver).
- **Impacto de negócio**: baixo (o número é estável — o critério "não é campo de romance, é lembrete") e o CHECK é a fonte autoritativa efetiva. Mas cai no padrão "regra de domínio expressa como número mágico em 3 lugares" — que é justamente o que Deployability chamou de "config não externalizada = cada mudança = redeploy da FE+BE+migration em fase".
- **Métrica de baseline**: 3 sítios, 0 abstração compartilhada. Padrão análogo em outras invariantes do repo (número de casas do docCod, teto de itens por lote) — não é isolado, é sintomático.
- **Origem**: introduzido pelo delta.

### F-modifiability-4: `src/frontend/app/sispag/page.tsx` já era kitchen-sink; delta amplia (+150 LOC → 1229 LOC)

- **Severidade**: P2 (pré-existente, fora do escopo estrito do delta; delta amplia)
- **Tactic violada**: Split Module + Increase Semantic Coherence
- **Localização**: `src/frontend/app/sispag/page.tsx`
- **Evidência (objetiva)**:
  ```
  main:  1079 LOC · 2 componentes top-level (SispagPage, SispagPanel) + 1 badge
  HEAD:  1229 LOC · idem, com estado local para 3 fluxos novos:
                     - retirando (TituloAPagar | null)
                     - salvandoRetencao (boolean)
                     - handlers confirmarRetirada + liberar
                     - link cross-tab paginaDoLote/loteEmFoco
  ```
- **Impacto técnico**: `SispagPanel` já concentra estado da carteira, seleção múltipla, lotes candidatos, finalizados, ingestão, formação automática, retornos, e agora retenção. Cada campo novo do painel entra como `React.useState` de mais no mesmo componente. Testes de UI dependem de acionar dezenas de estados juntos.
- **Impacto de negócio**: baixo agora (a página funciona e passou nos gates), mas cada Fatia futura desta frente é forçada a mexer neste único arquivo. A alternativa (extrair `TitulosTab`, `LotesCandidatosTab`, `LotesFinalizadosTab`, `RetornosTab`) devolveria o custo médio de uma mudança de UI para o alvo de 400 LOC/arquivo.
- **Métrica de baseline**: 1229 LOC · 2× o alvo estrito de 600 · +150 LOC no delta (14% de aumento). O arquivo é o 3º maior do repo depois do delta.
- **Origem**: pré-existente amplificado pelo delta. NÃO é P1 desta feature porque a decisão de manter uma única `page.tsx` grande é anterior à ADR-0050 e o delta acompanha o padrão vigente.

## 5. Cards Kanban

### [modifiability-1] Split de `LotePagamentoRepository.ts` em `LoteRepository` + `ItemLoteRepository`

- **Problema**
  > `LotePagamentoRepository.ts` está em 633 LOC / 26 métodos e mistura 4 razões de mudança (CRUD do lote raiz, CRUD dos itens, leitura para o painel, metadados da remessa nativa). O delta o empurrou pela primeira vez acima do teto de 600 LOC. Sem intervenção, as próximas features (Fatias 3–4) vão continuar acumulando ali.

- **Melhoria Proposta**
  > Tactic alvo: *Split Module + Increase Semantic Coherence*. Separar em (a) `LoteRepository` — só `lote_pagamento` (criar, transicionar, `lerEstadoParaEdicao`, `atualizarContaPagadora`, `tocarLote`, `marcarManual`, metadados da remessa nativa/data-débito); (b) `ItemLoteRepository` — só `lote_pagamento_item` (`adicionarItem`, `removerItem`, `atualizarModalidadeItem`, `contarItens`, `contarItensSemModalidade`, `listTitulosEmRascunho`). Manter `LotePagamentoService` como orquestrador do agregado — as duas classes vivem sob o mesmo aggregate root, o SQL só se separa. Feito num `/feature-tweak lote-pagamento "split repository"` ANTES da Fatia 3 encostar no arquivo.

- **Resultado Esperado**
  > Dois repositórios de ~300 LOC · ~13 métodos cada, ambos abaixo do teto. Fan-in de cada um permanece 4 (mesmos callers, dois handles em vez de um). Nenhuma mudança de comportamento — só shape.

- **Tactic alvo**: Split Module (Reduce Size of Module)
- **Severidade**: P2
- **Esforço estimado**: M (~1–2d) — reescrita mecânica, testes já são por método, `PatternGuardian` valida
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - `LotePagamentoRepository.ts` LOC: 633 → ≤ 350
  - Métodos por classe: 26 → ≤ 15 em cada
  - Testes: 143 suites verdes se mantêm
- **Risco de não fazer**: em 6 meses, no ritmo médio de crescimento observado (+50 LOC/feature nas últimas 3 features SISPAG que mexeram no arquivo), o repositório passa de 800 LOC e vira o próximo `RecebimentoNumerarioService.ts` (2415 LOC — o topo do repo hoje).
- **Dependências**: nenhuma; não depende de outra Fatia.

### [modifiability-2] Centralizar o teto do motivo da retenção numa constante compartilhada

- **Problema**
  > O número `500` (teto do campo `motivo`) aparece em 3 sítios paralelos: CHECK da migration 0062, `.max(500)` do Zod no route, `MOTIVO_RETENCAO_MAX` no frontend. Mudar o teto exige 3 edições coordenadas; ficar 2/3 em fase é bug silencioso.

- **Melhoria Proposta**
  > Tactic alvo: *Defer Binding*. Exportar `MOTIVO_RETENCAO_MAX = 500` de `src/backend/domain/interface/sispag/SispagInterface.ts` e importar no `routes/sispag.ts` (Zod). O frontend continua com seu próprio `MOTIVO_RETENCAO_MAX` (o monorepo não compartilha código entre `src/backend` e `src/frontend` — ver F-modifiability-2), MAS os dois passam a citar a mesma origem por comentário `/** deve casar com SispagInterface.MOTIVO_RETENCAO_MAX (backend) e o CHECK da migration 0062 */` — pelo menos torna a intenção auditável. O CHECK do Postgres permanece como fonte AUTORITATIVA (é a última linha de defesa), mas passa a citar o mesmo comentário.

- **Resultado Esperado**
  > Mudar o teto → 1 constante no backend + 1 constante no frontend + 1 migration aditiva. 3 arquivos hoje → 3 arquivos amanhã, mas com dependência declarada em vez de coincidência.

- **Tactic alvo**: Defer Binding (Configuration Externalization)
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1h)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Sítios de escrita coordenada: 3 → 3 (mas com fonte declarada, não mágico)
  - Testes: 1 novo teste em `retencaoFormacao.test.ts` afirmando que o CHECK do SQL e a constante do backend têm o mesmo valor (regex sobre o SQL)
- **Risco de não fazer**: baixo hoje (o valor é estável). Custo do card também é baixo — vale fazer junto com a próxima mudança no dialog.
- **Dependências**: nenhuma.

### [modifiability-3] Extrair abas de `src/frontend/app/sispag/page.tsx` em componentes por responsabilidade

- **Problema**
  > `page.tsx` (1229 LOC) é kitchen-sink: gerencia estado da carteira, seleção múltipla, lotes candidatos, finalizados, ingestão, formação automática, retornos e agora retenção — tudo dentro de `SispagPanel`. Cada Fatia acrescenta 100–150 LOC no mesmo arquivo. Testes de UI ficam acoplados a estado global do painel.

- **Melhoria Proposta**
  > Tactic alvo: *Split Module + Increase Semantic Coherence*. Extrair 4–5 subcomponentes em `src/frontend/app/sispag/components/`: `TitulosTab` (a tabela de títulos a pagar + retenção + retirar), `LotesCandidatosTab` (montagem + finalizar), `LotesFinalizadosTab` (remessa + baixa), `RetornosTab` (fin052), `IngestaoBloco` (banner + botão + trilha). `SispagPanel` fica só com a orquestração de abas e o estado transversal (`painel`, `lotes`, `carregar`).

- **Resultado Esperado**
  > `page.tsx` ≤ 400 LOC (composição das abas + guard-rails + wiring). Cada aba um arquivo próprio, testável com estado isolado. Fatias futuras encostam só no arquivo da sua aba.

- **Tactic alvo**: Split Module + Increase Semantic Coherence
- **Severidade**: P2 (pré-existente amplificado)
- **Esforço estimado**: L (~3–4d) — extração cuidadosa, muitos props para inferir; `DesignSystemReviewer` obrigatório porque mexe em UI
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - `page.tsx`: 1229 → ≤ 400 LOC
  - Nº de componentes top-level em `src/frontend/app/sispag/components/`: 6 → ~10
  - Testes E2E SISPAG (48 suites hoje): mesma passagem
- **Risco de não fazer**: cada nova Fatia adiciona 100+ LOC em `page.tsx`. Em 6 meses o arquivo passa de 1500 LOC e cada revisão de PR do painel passa a levar meia hora só para ler o diff.
- **Dependências**: recomendado ANTES da Fatia 4 (Recebimentos-NDe já provou que kitchen-sink de painel escala mal — `recebimentos/page.tsx` está em 727 LOC e ainda assim é limpo por conta da separação em subcomponentes; SISPAG deveria imitar).

## 6. Notas do agente

- **Escopo**: avaliei o **delta** vs. `main` (`git diff main...HEAD -- src`) — 25 arquivos, +1929/-48 LOC, 11 commits, ADR-0050. O núcleo do delta (Retenção I9, `RetencaoFormacaoRepository`, `retirarDoLote`/`liberarRetencao`, migration 0062) é bem-modelado do ponto de vista de modifiability: Split Module explícito ao nascer o repositório separado; Increase Semantic Coherence no `removerItemDoLote` compartilhado; Encapsulate ao NÃO expor SQL da retenção acima do service; Refactor para preparar a reutilização em vez de duplicar; Zero cognitive-complexity warnings e Zero violações de camada. Não há finding P0.
- **P0 desta feature**: **NENHUM**. Todos os 4 findings são P2 ou P3, e 3 dos 4 já eram condição do repositório antes do delta (aumentaram no ciclo, sem regressão de qualidade).
- **Cross-QA**:
  - **F-modifiability-1 (Split Repository)** ⇄ **Testability**: repositório com 26 métodos + SQL cru é candidato a testes por-método que já existem, mas o Split reduz o custo de manter suites por camada de agregado.
  - **F-modifiability-1** ⇄ **Integrability** (Refactor + Encapsulate): a fronteira do agregado fica mais nítida se o repo se dividir; hoje `LotePagamentoService` conhece 26 métodos de um repositório só.
  - **F-modifiability-3 (motivo=500 em 3 sítios)** ⇄ **Deployability**: config não externalizada é o alerta clássico dessa QA — cada mudança do teto exige commit da migration + rota + FE em fase, redeploy Render + Vercel juntos. Deployability já flagou o padrão em `F-deployability-1` (migration sem integration test).
  - **F-modifiability-4 (page.tsx kitchen-sink)** ⇄ **Testability**: arquivos grandes com muitos `useState` são o correlato canônico de "difícil de testar em unidade" — extrair abas devolve capacidade de teste focada.
  - Todas as sinergias acima são para o **qa-consolidator** decidir quais cards mesclar. O card `modifiability-1` (Split Repository) é o de maior alavanca no delta e é o único que amadurecerá logo (a próxima feature SISPAG que tocar o arquivo já paga o custo do adiamento).
- **Pontos fortes desta feature (para registro)**:
  1. `RetencaoFormacaoRepository` nasceu separado — o dev nomeou a razão de separação no header do arquivo (linhas 25–33). Isto é o oposto do "goto for repositório", e serve de exemplo para as próximas migrations.
  2. `removerItemDoLote` privado compartilhado entre lixeira e "Retirar do lote" é DRY sem cair em abstração prematura: o parâmetro `retencao: 'sempre' \| 'se-automatico'` explicita as duas cases, não esconde.
  3. Motivos de remoção como `const … as const` + type derivado + CHECK do Postgres apontando para as MESMAS strings é o cânone tsyringe/DDD deste repositório aplicado por completo — nada de string solta.
  4. Migration idempotente end-to-end (`CREATE TABLE IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` antes de cada `ADD`, índice único parcial) — herança direta do padrão do repo, mas confirmado pelo teste dedicado.
  5. Ontologia em fase com o código no mesmo ciclo (`_coverage.json` v0.28.1 marca `reterTituloDaFormacao` e `retencao-formacao-automatica` planned → implemented; `TituloAPagar impl_pct` 90 → 100) — zero drift.
