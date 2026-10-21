---
qa: Testability
qa_slug: testability
run_id: 2026-10-21-1458
agent: qa-testability
generated_at: 2026-10-21T18:30:00-03:00
scope: all
score: 8
findings_count: 6
cards_count: 6
---

# Testability — Regis-Review (PR #128, sispag-situacao-pagamento)

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev da Kavex alterando a regra I19 (nova prioridade / novo motivo / troca de rótulo) | PR tocando `SituacaoPagamentoResolver`, `SituacaoPagamentoService`, `LotePagamentoService.incluirTitulo`/`criarLotesPorFilial`, `FormacaoLotesService`, `SispagPainelService`, ou o contrato `src/backend/domain/interface/sispag/SituacaoPagamento.ts` | Função única de situação (resolver puro + service que lê contexto) + rotas `/sispag/painel`, `/sispag/lotes/por-filial`, `/sispag/lotes/:id/itens` + tela da aba Situação | Dev local, CI do PR, `jobs/validate-situacao-pagamento-v1.ts` em HML/PRD somente leitura | Teste quebra DETERMINISTICAMENTE antes do merge se: (a) um bloqueio deixa de bloquear, (b) prioridade de motivo muda silently, (c) FE e BE divergem no enum/ordem, (d) uma fonte de contexto some sem registrar `fontesIndisponiveis`, ou (e) o botão `BOLETO_SEM_DDA` sai do rótulo da sugestão | ≥ 50 casos no resolver, 100% dos motivos I19a–j com teste de isolado + de ordem, paridade FE/BE enforced por teste que lê o fonte oposto, 0 testes com `new Date()` sem relógio injetado, I19m exercitada nos três pontos de uso (painel, inclusão, formação automática + criação por filial) |

Bass: "o custo-multiplicador" aqui é definido pelo valor derivado — se faltar teste pinando a prioridade ou a tabela de rótulos, qualquer alteração da regra de pagamento pode liberar um título bloqueado e nunca aparecer no `/painel` até a analista descobrir "tarde" (que é exatamente o modo de falha que a regra foi criada para resolver, ver `situacao-pagamento-titulo.md` §Por que existe).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **Per-layer test ratio no delta (arquivos .test:arquivos de produção)** |  |  |  |  |
|  — `domain/service/sispag` (regra) | 6/6 = 1.00 | ≥ 0.5 | ✅ | `_shared-metrics.md` §"Arquivos de produção" / §"Testes alterados" |
|  — `domain/client/sispag` (Conexos) | 1/1 = 1.00 | ≥ 0.5 | ✅ | idem |
|  — `domain/repository/sispag` | 1/2 = 0.50 (TituloAPagarRepository ✓; `AjusteCentavosExecucaoRepository` novo sem test .test.ts no delta) | ≥ 0.5 | ⚠️ | idem; `AjusteCentavosExecucaoRepository.ts` sem test file próprio no delta |
|  — `domain/libs/calendar` (determinismo) | 1/1 = 1.00 (`BankingCalendar.diasAteVencimento`) | ≥ 0.5 | ✅ | idem |
|  — `routes/sispag` (contrato HTTP) | 1/1 = 1.00, 4 casos para `POST /lotes/por-filial` | ≥ 1 caso por verbo | ✅ | `routes/sispag.test.ts` §"POST /sispag/lotes/por-filial (ADR-0075)" |
|  — `jobs/*` (operacional) | 0/1 = **0.00** (`validate-situacao-pagamento-v1.ts` sem test, sem guarda contra `bootstrapAppContainer()`) | ≥ guarda de ambiente verificada | ❌ | `src/backend/jobs/validate-situacao-pagamento-v1.ts:1-13` |
|  — `migrations` (0089) | 1/1 (contrato do SQL) | ✓ | ✅ | `migrations/0089_sispag_titulo_tipo.test.ts` |
|  — `frontend/app/sispag/situacao` lógica pura | 4/4 (`filtrosAtivos`, `rotulos`, `selecao`, `situacaoTitulos`) + 1 integração (`TitulosAbaSituacao`) | ≥ 0.5 | ✅ | `_shared-metrics.md` §"Testes alterados" |
|  — `frontend/app/sispag/situacao` tsx (views) | 1/13 (TabelaTitulos.tsx 427 LOC, hooks, cells, dialogs — cobertos indiretamente por `TitulosAbaSituacao.test.tsx`) | ≥ cobertura de interação | ⚠️ | `_shared-metrics.md` |
| **Casos de teste por invariante I19** |  |  |  |  |
|  — I19a (dois estados) + I19b (ordem fixa) | 2 casos dedicados + 1 propriedade (ordem = `MOTIVOS_PAGAMENTO_ORDEM`) | ≥ 1 | ✅ | `SituacaoPagamentoResolver.test.ts:390-431` |
|  — I19c–j (um por motivo) | 1 caso de isolado + 1 ou 2 casos de borda por motivo (table-driven, 14 linhas) | 1 por motivo | ✅ | `SituacaoPagamentoResolver.test.ts:80-229` |
|  — I19l (fontesIndisponíveis) | 3 casos (uma fonte falha, duas falham, env falha → fail-closed) | ≥ 1 | ✅ | `SituacaoPagamentoService.test.ts:144-173, 239-247` |
|  — I19m (mesma função em tela/inclusão/cron) | 3 casos: `montarPainel` chama `avaliarCarteira`; `incluirTitulo` recusa `BLOQUEADO`; `FormacaoLotesService` filtra por `avaliarVarios` | 3 | ✅ | `SispagPainelService.test.ts:192+`; `LotePagamentoService.test.ts:391-472`; `FormacaoLotesService.test.ts:83-170` |
|  — I19p (POST /lotes/por-filial) | 10 cenários (1 lote por filial, PARCIAL, RECUSADO sem loteId, falha isolada, mover, 4 inválidos) | ≥ 5 | ✅ | `LotePagamentoService.test.ts:191-330`; `routes/sispag.test.ts:378-464` |
|  — I19q (resumo exclui lote FINALIZADO/REMESSA_GERADA) | 2 casos (comprometido fora; RASCUNHO continua) | ≥ 1 | ✅ | `SituacaoPagamentoService.test.ts:175-194` |
|  — I19r (`BOLETO_SEM_DDA` por sugestão) | 7 mapeamentos table-driven + 4 bordas (sem desfecho, confirmado-off, só se principal, outros motivos não carregam) | mapear 7 desfechos | ✅ | `SituacaoPagamentoResolver.test.ts:337-388` |
| **Determinismo** |  |  |  |  |
|  — relógio injetável no serviço | `BankingCalendar.withClock(() => new Date('2026-10-20T15:00:00Z'))` | 1 | ✅ | `SituacaoPagamentoService.test.ts:67-68` |
|  — resolver puro (sem relógio/I/O) | sim; recebe `diasAteVencimento` já calculado | sim | ✅ | `SituacaoPagamentoResolver.ts:192-325` |
|  — `vence hoje = 0d` em múltiplos instantes | 3 instantes BRT testados (04:30, 11:30, 20:00) | ≥ 2 | ✅ | `SispagPainelService.test.ts:785+`; `BankingCalendar.test.ts:116-125` |
| **FE/BE contract parity (Executable Assertion)** | 7 enums comparados por `readFileSync` + regex do fonte oposto: ESTADO_PAGAMENTO, MOTIVO_PAGAMENTO, SUGESTAO_BOLETO_SEM_DDA, DONO_PAGAMENTO, ACAO_PAGAMENTO, FONTE_SITUACAO, RESULTADO_LOTE_FILIAL — valores E ordem | ≥ MOTIVO + ESTADO | ✅ | `src/frontend/lib/sispag.test.ts:§"situação de pagamento — paridade"` |
| **Live reader com298/list (`listTiposDosDocumentos`)** | 4 testes unitários mockados (chunking de 200, mapeamento, tipo ausente/vazio, lista vazia); **nenhum fixture gravado de produção** | ≥ 1 fixture `__fixtures__/com298-tipos-*.json` | ⚠️ | `ConexosSispagClient.test.ts:319-366`; `src/backend/domain/client/__fixtures__/` só tem `2026-10-14-fin015-vinculo-codbar.json` |
| **jobs/validate-situacao-pagamento-v1.ts** | Chama `bootstrapAppContainer()` que executa `BootMigrator` → migration 0089 **aplicada em PRD por engano** em 20/10/2026 (documentado no header do próprio arquivo). Zero teste automatizado; zero guarda de ambiente | guarda via env var + 1 teste que verifica o guard | ❌ | `src/backend/jobs/validate-situacao-pagamento-v1.ts:9-16` |
| **Cobertura de linha/branch do delta** | ⚠️ **Não medível localmente nesta sessão** (não rodamos `--coverage`; os gates já estão verdes com 280 suítes / 5.255 testes BE + 112 / 1.228 FE) | ≥ 80% nos services tocados, ≥ 70% branch | ⚠️ | medir com `cd src/backend && npm test -- --coverage src/backend/domain/service/sispag/SituacaoPagamento*` |
| **Backend typecheck + lint + jest no PR** | 0 erros TS, 0 erros lint, 5.255 testes verdes | 0/0/all green | ✅ | `_shared-metrics.md` §Gates |
| **Frontend typecheck + lint + jest no PR** | 0 erros TS, 0 erros lint, 1.228 testes verdes | 0/0/all green | ✅ | `_shared-metrics.md` §Gates |
| **CI do PR (Backend SQL em Postgres 17, Frontend, Vercel)** | todos verdes em HEAD 737d010 | all green | ✅ | `_shared-metrics.md` §Gates |

> ⚠️ **Não medível localmente nesta sessão**: cobertura de linha/branch; validação ao vivo do leitor `com298/list` (depende do robô Conexos). Recomendação: rodar `npm test -- --coverage src/backend/domain/service/sispag` localmente (1x) e anexar o número ao próximo PR como baseline, e capturar 1 resposta real do `com298/list` sob supervisão para virar fixture (ver card `testability-2`).

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Specialized Interfaces** | `SituacaoPagamentoResolver` é PURO (`avaliar(t, ctx) → SituacaoPagamento`): seam limpo que a tela, a inclusão (`LotePagamentoService.incluirTitulo` com `avaliarVivo`), a formação automática (`avaliarVarios`) e o criador por filial (`criarLotesPorFilial`) usam. Sem I/O, sem relógio no resolver (recebe `diasAteVencimento` já calculado em dia civil). | ✅ presente | `SituacaoPagamentoResolver.ts:192-325` |
| **Recordable Test Cases** | Fixtures gravadas existem para `fin015/vinculo-codbar` (ADR-0071) mas **não** para `com298/list` (o endpoint novo da regra I19d — nome do tipo com "(PERMUTA)"). Mesmo medindo 100% null em `tpd_cod` em PRD em 20/10/2026, nenhum JSON de resposta real foi gravado para pinar o schema do boundary. | ⚠️ parcial | `src/backend/domain/client/__fixtures__/2026-10-14-fin015-vinculo-codbar.json` (único); ausência medida em `grep "com298" src/backend/domain/client/__fixtures__/` |
| **Sandbox** | O job `validate-situacao-pagamento-v1.ts` deveria ser um sandbox read-only; na prática chama `bootstrapAppContainer()` que **grava** (migrations). O próprio header admite: "roda a 0089 antes do deploy (foi o que aconteceu em 20/10/2026)". | ❌ ausente | `src/backend/jobs/validate-situacao-pagamento-v1.ts:9-17` |
| **Executable Assertions** | (1) Paridade FE/BE: `frontend/lib/sispag.test.ts` lê o fonte do backend por `readFileSync` e compara os 7 enums (ESTADO/MOTIVO/SUGESTAO/DONO/ACAO/FONTE/RESULTADO_LOTE_FILIAL) incluindo a ORDEM. (2) `resolver.resumir`: teste próprio comprova que soma de `porMotivo` = `porEstado.BLOQUEADO` (I19b). (3) `rotuloDo` cobre todos os motivos (`for (const motivo of MOTIVOS_PAGAMENTO_ORDEM)`). | ✅ presente | `src/frontend/lib/sispag.test.ts` §"situação de pagamento — paridade"; `SituacaoPagamentoResolver.test.ts:540-557, 495-500` |
| **Abstract Data Sources** | As três fontes (`BloqueioDuplicidadeRepository`, `AjusteCentavosExecucaoRepository`, `BoletoSuggestionService`) e o relógio (`BankingCalendar`) são injetadas por tsyringe; o `make()` do teste as substitui por mocks mapa-a-mapa (`new Map([[CHAVE, …]])`). `avaliarVivo` combina `TituloAPagarRepository` persistido + o `fin064` ao vivo, controláveis separadamente. | ✅ presente | `SituacaoPagamentoService.test.ts:43-80`; `SituacaoPagamentoResolver.test.ts:36-42` |
| **Limit Structural Complexity** | Resolver puro de 352 LOC com 60 cases de teste (567 LOC) — teste proporcional. `SituacaoPagamentoService` (195 LOC) com 17 descrições. `LotePagamentoService.test.ts` (1.315 LOC) e `routes/sispag.test.ts` (1.791 LOC) são arquivos agregados históricos; dentro deles o bloco `criarLotesPorFilial` tem 139 LOC e o bloco `/lotes/por-filial` tem 86 LOC — bem recortados por `describe`. | ✅ presente | `wc -l` em `_shared-metrics.md` §"Tamanho dos arquivos novos/centrais" |
| **Limit Non-Determinism** | Relógio injetável por `BankingCalendar.withClock(() => new Date('2026-10-20T15:00:00Z'))`; `diasAteVencimento` novo tem teste explícito ("hoje=0, ontem=-1, amanhã=1" às 23:30 BRT). Resolver recebe `diasAteVencimento` já calculado — nenhum `new Date()` no resolver nem no service (fora do mock do teste). | ✅ presente | `BankingCalendar.test.ts:116-125`; `SituacaoPagamentoService.test.ts:67-68`; `grep -n "new Date\\|Date.now" src/backend/domain/service/sispag/SituacaoPagamento*.ts` = 0 ocorrências |

## 4. Findings

### F-testability-1: `jobs/validate-situacao-pagamento-v1.ts` aplica migrations em qualquer banco que a conexão apontar — já aconteceu em PRD por engano

- **Severidade**: P1
- **Tactic violada**: Sandbox + Executable Assertions
- **Localização**: `src/backend/jobs/validate-situacao-pagamento-v1.ts:9-27`
- **Evidência (objetiva)**:
  ```ts
  // Lê o Postgres (carteira, bloqueios, ledger de ajuste, pool DDA) e NÃO chama o Conexos, então não
  // abre sessão do robô. ATENÇÃO: `bootstrapAppContainer` APLICA as migrations pendentes no banco do
  // ambiente (BootMigrator). Contra o banco de produção isso roda a 0089 antes do deploy (foi o que
  // aconteceu em 20/10/2026; aditiva e idempotente, sem efeito no código antigo). Para validar sem
  // migrar, aponte `databaseConnectionString` para um banco local ou de HML.
  …
  const main = async (): Promise<void> => {
      await bootstrapAppContainer();
  ```
  O header é um aviso, não uma guarda: o próprio `main()` chama `bootstrapAppContainer()` sem checar `NODE_ENV`, sem flag `--allow-migrations`, sem comparar o host da string de conexão. Rodar o script com `.env.production` escrito por engano repete o incidente. Zero teste automatizado para o próprio job.
- **Impacto técnico**: qualquer alteração futura em `migrations/` que não seja idempotente/aditiva (DROP, ALTER com default, UPDATE em backfill) viraria incidente real pelo mesmo caminho. A idempotência da 0089 foi sorte do conteúdo, não da ferramenta.
- **Impacto de negócio**: migração aplicada antes do deploy pode esvaziar abas de pagamento (precedente real: incidente da `0061` em 23/09/2026, citado em `CLAUDE.md` §Gotchas). Para Columbia, significa não ver lotes SISPAG montados por horas até a correção manual.
- **Métrica de baseline**: 0 guardas automatizadas no script (`grep -c "NODE_ENV\\|allow-migrations\\|readonlyConnectionString" src/backend/jobs/validate-situacao-pagamento-v1.ts` = 0); 1 incidente registrado em 20/10/2026 pelo próprio comentário.

### F-testability-2: nenhum fixture gravado do `com298/list` — o schema de tipo que alimenta I19d é mockado 100%

- **Severidade**: P1
- **Tactic violada**: Recordable Test Cases
- **Localização**: `src/backend/domain/client/ConexosSispagClient.ts:1004-1041` (`listTiposDosDocumentos`), `src/backend/domain/client/__fixtures__/`
- **Evidência (objetiva)**:
  ```
  $ ls src/backend/domain/client/__fixtures__/
  2026-10-14-fin015-vinculo-codbar.json
  ```
  Nenhum JSON gravado para `com298/list`. Os 4 testes de `listTiposDosDocumentos` em `ConexosSispagClient.test.ts:319-366` usam `base.listGenericPaginated.mockResolvedValue({ count: 2, rows: [{ docCod: 200, tpdCod: 157, tpdDesNome: ' RECIBO/BOLETO/FATURA - (PERMUTA) ' }] })` — o schema `tipoDocumentoRowSchema` (nomes de campo `tpdCod`, `tpdDesNome`) nunca foi exercido contra bytes reais de produção. Em PRD em 20/10/2026 a sondagem mediu `tpd_cod` nulo em **1.277 de 1.277** títulos ativos — o leitor nem roda em produção ainda.
- **Impacto técnico**: se o `com298/list` responder com campo renomeado (`tpdcod` sem camelCase, ou embutido num envelope `tipo:{…}`) o `safeParse` descarta tudo em silêncio (`if (!parsed.success) continue;`), `tipos.set(docCod, …)` nunca executa, e **TIPO_PERMUTA deixa de disparar para 100% dos títulos** — exatamente o modo de falha "silêncio" que I19l diz combater em outras fontes.
- **Impacto de negócio**: o motivo `TIPO_PERMUTA` é a única barreira automatizada contra pagar duas vezes um documento já quitado em permuta (o fin064 não traz tipo, ADR-0075 §Evidência). Se o leitor silencia, a analista volta ao mundo pré-ADR-0075 — descobrir "tarde" que era permuta — e Columbia pode pagar em duplicidade um recibo PROFORMA já abatido no `fin010`.
- **Métrica de baseline**: 0 fixtures de `com298/list`; 4 testes mockados; 0% do schema exercido em produção (a primeira rodada do leitor acontece após o deploy).

### F-testability-3: `avaliarVivo` com título fora da carteira persistida devolve `null` em silêncio — sem log, sem contagem

- **Severidade**: P2
- **Tactic violada**: Executable Assertions (observabilidade do caminho de fallback)
- **Localização**: `src/backend/domain/service/sispag/SituacaoPagamentoService.ts:171-194`; teste em `SituacaoPagamentoService.test.ts:287-291`
- **Evidência (objetiva)**:
  ```ts
  public avaliarVivo = async (chave, vivo) => {
      const persistido = await this.lerPersistido(chave);
      if (!persistido) return null;    // ← sem log, sem métrica
      …
  };
  ```
  O teste pinna o comportamento: `expect(await service.avaliarVivo(chave, …)).toBeNull();`. `lerPersistido` loga apenas quando o `tituloRepo.buscarPorChave` lança — não quando devolve `null` (= título fora da carteira). O caller (`LotePagamentoService.incluirTitulo`) interpreta `null` como "nada a dizer, deixa passar", documentado em `situação desconhecida (null) não bloqueia`.
- **Impacto técnico**: se por algum motivo (ingestão quebrada, filtro `vldPago#EQ:0` que exclui o título do upsert, cadê outras filiais) a carteira ficar vazia OU incompleta, 100% das inclusões manuais passam a cair no `null` e a situação de pagamento vira caminho morto — sem ninguém saber. Difere do modo documentado por I19l (`fontesIndisponiveis` registra a fonte).
- **Impacto de negócio**: a camada avisada da regra ADR-0075 (que ela mesma diz existir "para não descobrir tarde") pode ficar inoperante durante uma janela de ingestão quebrada sem acender aviso na tela ou no log, deixando o único filtro ativo serem os guardas ao vivo do `fin064` (alçada e pago) — o que já existia antes da regra.
- **Métrica de baseline**: 1 teste pinando `null = passa` sem contrapartida de observabilidade; 0 asserção de log em `avaliarVivo`-fallback; `grep -c "titulo fora da carteira\\|avaliarVivo.*null" src/backend/domain/service/sispag/SituacaoPagamentoService.ts` = 0 chamadas de log.

### F-testability-4: `AjusteCentavosExecucaoRepository` novo (20 LOC) entra no delta sem test file próprio

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity (teste por unidade)
- **Localização**: `src/backend/domain/repository/sispag/AjusteCentavosExecucaoRepository.ts` (criado neste PR)
- **Evidência (objetiva)**: `_shared-metrics.md` §"Arquivos de produção alterados" lista `20 1 src/backend/domain/repository/sispag/AjusteCentavosExecucaoRepository.ts`; §"Testes alterados" não lista `AjusteCentavosExecucaoRepository.test.ts`. O repositório é exercitado só indiretamente via `SituacaoPagamentoService.test.ts` (que mocka o método `listarUltimaEtapaPorTitulo`).
- **Impacto técnico**: o SQL do método (que mapeia `etapa` do último ledger por título — I19h) não tem teste próprio; se a query mudar a ordenação (ex.: pegar o primeiro em vez do último, ou perder o `GROUP BY`), o motivo `AJUSTE_CENTAVOS_PENDENTE` passa a bloquear/não bloquear títulos errados.
- **Impacto de negócio**: título com ajuste em `concluido` seria tratado como se estivesse em `indeterminado` (bloquear) ou vice-versa (deixar passar quando deveria barrar) — ambos criam retrabalho; o segundo coloca em remessa um título ainda em ajuste.
- **Métrica de baseline**: 0 testes dedicados ao arquivo novo; cobertura efetiva do método = 0% medido isoladamente.

### F-testability-5: `TabelaTitulos.tsx` (427 LOC, maior componente do FE do delta) sem teste próprio

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/frontend/app/sispag/situacao/TabelaTitulos.tsx`
- **Evidência (objetiva)**: `_shared-metrics.md` §"Tamanho dos arquivos novos/centrais" lista `TabelaTitulos.tsx` com 427 LOC; §"Testes alterados" não lista `TabelaTitulos.test.tsx`. O componente é renderizado indiretamente dentro de `TitulosAbaSituacao.test.tsx` (382 LOC, 29 casos), e o filtro por cabeçalho tem o seu `column-header-filter.test.tsx` (125 LOC).
- **Impacto técnico**: a cobertura indireta via `TitulosAbaSituacao` casa os caminhos principais (ordenação, seleção, chip de situação, abertura de ação, visibilidade por papel), mas regressões localizadas em `TabelaTitulos` (ex.: ordenação por valor numérico vs. string, aria-sort inconsistente, re-render em prop estável) ficam só no modo integrado — o diagnóstico é "a aba toda falhou" em vez de "a tabela ordenou errado".
- **Impacto de negócio**: baixo isoladamente; a cobertura integrada já pinna o essencial. O custo é de triagem, não de defeito-de-produção.
- **Métrica de baseline**: 29 casos em `TitulosAbaSituacao.test.tsx` cobrem a tabela indiretamente; 0 casos direcionados ao componente.

### F-testability-6: propriedade "a soma dos motivos = BLOQUEADO" tem só o teste por exemplo (2 títulos), sem property-based

- **Severidade**: P3
- **Tactic violada**: Limit Non-Determinism (não é exatamente, mas a invariante é um candidato clássico de `fast-check`)
- **Localização**: `SituacaoPagamentoResolver.test.ts:540-557`; `fast-check` já é dependência do projeto
- **Evidência (objetiva)**:
  ```ts
  it('a soma dos motivos principais é igual aos bloqueados', () => {
      const titulos = [
          { valor: 1, situacaoPagamento: resolver.avaliar(titulo({ liberado: false }), ctx()) },
          { valor: 1, situacaoPagamento: resolver.avaliar(titulo({ tpdDesNome: 'X (PERMUTA)' }), ctx()) },
      ];
      …
  });
  ```
  Dois exemplos. A invariante I19b é uma identidade estrutural (∑ `porMotivo[m].qtd` = `porEstado.BLOQUEADO.qtd`); vale para qualquer tamanho de carteira e qualquer combinação de motivos, perfeita para `fast-check`.
- **Impacto técnico**: um caso de borda com empate de prioridade ou com dois motivos de mesmo dono poderia revelar um bug de contagem invisível no exemplo atual.
- **Impacto de negócio**: muito baixo; só a melhoria da confiança da propriedade principal da regra.
- **Métrica de baseline**: 2 títulos testando a propriedade; `grep -c "fast-check\\|from 'fast-check'" src/backend/domain/service/sispag/*.test.ts` = 0.

## 5. Cards Kanban

### [testability-1] Blindar `validate-situacao-pagamento-v1.ts` contra executar migrations fora de HML/local

- **Problema**
  > O script dispara `bootstrapAppContainer()`, que executa `BootMigrator` e aplica migrations na string de conexão apontada. Em 20/10/2026, isso rodou a `0089` em produção por engano (documentado pelo próprio comentário do arquivo). A migração era aditiva/idempotente — a próxima pode não ser. O arquivo tem aviso, não guarda.

- **Melhoria Proposta**
  > Converter o aviso de header em guarda executável: detectar o host da `databaseConnectionString`, recusar execução se não bater com `localhost` / `127.0.0.1` / sufixo configurado para HML, salvo flag explícita `--allow-production-migrations` passada por argv **e** `NODE_ENV !== 'production'`. Alternativa complementar (Bass — Sandbox): instanciar `PostgreeDatabaseClient` com um pool somente-leitura (`SET default_transaction_read_only = on`) para o próprio job, bypassando o `BootMigrator`. Teste automatizado: um `validate-situacao-pagamento-v1.test.ts` que mocka `bootstrapAppContainer`, chama `main()` com uma URL fictícia de prod e verifica `process.exit(1)` com mensagem clara. Mesmo tratamento recomendado para TODO outro job em `src/backend/jobs/` que chame `bootstrapAppContainer` — ver `_shared-metrics.md` (há ~58 jobs compartilhando o bootstrap, conforme §Gotchas do CLAUDE.md).

- **Resultado Esperado**
  > Executar o script com variáveis de produção falha antes de abrir conexão; variáveis de HML/local seguem funcionando. Migrations aplicadas por engano em PRD: 1 → 0 nos próximos 180 dias; cobertura automatizada do job: 0 testes → ≥ 2 testes (feliz em HML + recusa em prod).

- **Tactic alvo**: Sandbox + Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Guardas automatizadas no script: 0 → 1 (verificação de host + flag `--allow-production-migrations`)
  - Testes automatizados do próprio job: 0 → 2
  - Incidentes de migração acidental na próxima rodada do probe: 1 → 0
- **Risco de não fazer**: na próxima migração não-idempotente, repetir o incidente de `0061` (que esvaziou abas de pagamento por tempo mensurável em setembro/2026) — agora com um script que a própria equipe considera "só leitura".
- **Dependências**: nenhuma; segue padrão de outros jobs do repositório (quando houver `databaseConnectionString` restrict ou flag CLI).

### [testability-2] Gravar fixture real do `com298/list` para pinar o schema do leitor de tipo

- **Problema**
  > `listTiposDosDocumentos` (ADR-0075 I19d) é a única fonte do nome do tipo do documento ("(PERMUTA)"). Em PRD, `tpd_cod` está nulo em 1.277/1.277 títulos (medido 20/10/2026), então **o leitor nunca rodou em produção** com dado real. Os 4 testes são 100% mockados; o schema `tipoDocumentoRowSchema` nunca foi exercido contra bytes do ERP. Qualquer renomeação silenciosa de campo faz `TIPO_PERMUTA` virar `0 bloqueios` sem alarme — exatamente o modo de falha que I19l diz atacar.

- **Melhoria Proposta**
  > Durante a primeira execução supervisionada da ingestão em PRD, salvar 2–3 respostas reais do `com298/list` (contendo documento com `tpdDesNome` "(PERMUTA)", um sem tipo e um ADIANTAMENTO) em `src/backend/domain/client/__fixtures__/com298-tipos-*.json`. Adicionar um teste em `ConexosSispagClient.test.ts` que carrega o fixture via `readFileSync` e passa pelo `listGenericPaginated.mockResolvedValue({ rows: fixture })`, verificando que `TIPO_PERMUTA` dispara. Formato espelha o fixture já existente `2026-10-14-fin015-vinculo-codbar.json`. Bass: Recordable Test Cases + Executable Assertions.

- **Resultado Esperado**
  > O schema do boundary passa a quebrar o teste quando o Conexos renomeia campo; a cobertura de defeito da regra I19d passa de "só mockada" para "contra bytes reais". Fixtures gravados: 0 → ≥ 3; testes contra fixture real: 0 → ≥ 1.

- **Tactic alvo**: Recordable Test Cases + Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (≤1d, dependente de uma sessão supervisionada do robô)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Fixtures `com298-tipos-*.json`: 0 → ≥ 3
  - Testes contra fixture real: 0 → 1
  - Caminhos "renomeou campo" cobertos por teste (ex.: `tpdDesNome` ausente, campo com outro nome): 0 → ≥ 2
- **Risco de não fazer**: na primeira variação de contrato do `com298` (ERP update, nova versão), `TIPO_PERMUTA` silencia e Columbia pode pagar documento já quitado por permuta — o cenário que motivou a ADR-0075.
- **Dependências**: 1 sessão supervisionada do robô Conexos (compartilhada com o rollout da ingestão com tipo).

### [testability-3] Observabilidade do caminho `avaliarVivo = null`

- **Problema**
  > Quando o título da inclusão manual não está na carteira persistida, `SituacaoPagamentoService.avaliarVivo` devolve `null` em silêncio e `LotePagamentoService.incluirTitulo` deixa passar (teste pinna isso). Difere do caminho I19l (fonte indisponível ⇒ `fontesIndisponiveis` + WARN). Numa ingestão quebrada, 100% das inclusões caem em `null` sem acender nenhum sinal.

- **Melhoria Proposta**
  > Em `SituacaoPagamentoService.avaliarVivo`, quando `persistido` for `null`, emitir `logService.warn({ type: LOG_TYPE.BUSINESS_WARN, message: 'situação de pagamento: título fora da carteira persistida, inclusão sem avaliação', data: { chave } })`. Adicionar teste em `SituacaoPagamentoService.test.ts` que exige o `warn` em cima do atual `expect(...).toBeNull()`. Expor uma métrica/contagem (`situacao_fallback_sem_persistido_total`) para o painel operacional. Bass: Executable Assertions.

- **Resultado Esperado**
  > O caminho morto deixa de ser invisível. Baseline: 0 asserções de log em `avaliarVivo`-null → 1 asserção; incidentes "ingestão quebrou e ninguém viu" detectáveis em `< 10 min` em vez de só pela analista.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Chamadas de `logService.warn` no caminho `null`: 0 → 1
  - Testes exigindo o log: 0 → 1
  - Métrica/contagem exposta ao painel: 0 → 1
- **Risco de não fazer**: janela de ingestão quebrada passa calada pelo gate SISPAG, voltando ao mundo pré-ADR-0075 (descobrir "tarde") sem nenhum alarme.
- **Dependências**: nenhuma.

### [testability-4] Teste próprio do `AjusteCentavosExecucaoRepository` novo

- **Problema**
  > O repositório que alimenta I19h entrou no delta sem test file próprio. Exercitado só indiretamente via mock no `SituacaoPagamentoService.test.ts`. A query SQL do `listarUltimaEtapaPorTitulo` (que decide qual ledger entra) não tem teste.

- **Melhoria Proposta**
  > Criar `AjusteCentavosExecucaoRepository.test.ts` espelhando o padrão de `TituloAPagarRepository.test.ts` (mock de `withTransaction` + `selectMany`). 3 casos: (a) devolve a última etapa por título quando há vários ledgers, (b) título sem ledger não entra no mapa, (c) query vazia não quebra. Bass: Limit Structural Complexity (teste por unidade).

- **Resultado Esperado**
  > Cobertura de `AjusteCentavosExecucaoRepository`: 0% isolado → ≥ 90% (3 casos cobrem os ramos). Regressões localizadas no SQL (ordenação, GROUP BY) deixam de depender do serviço acima para serem detectadas.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Arquivos .test para o repositório: 0 → 1
  - Casos testados do método `listarUltimaEtapaPorTitulo`: 0 → ≥ 3
- **Risco de não fazer**: uma mudança no SQL do método muda o comportamento do motivo `AJUSTE_CENTAVOS_PENDENTE` sem derrubar nenhum teste de serviço (os mocks reproduzem o novo comportamento sem alarme).
- **Dependências**: nenhuma.

### [testability-5] Teste focado em `TabelaTitulos.tsx` (maior componente FE do delta)

- **Problema**
  > `TabelaTitulos.tsx` (427 LOC) só é exercitado dentro do teste de integração `TitulosAbaSituacao.test.tsx` (29 casos). Regressões localizadas (ordenação numérica, aria-sort, caixa de seleção condicional por papel) ficam invisíveis até o teste integrado quebrar — e quando quebra, aponta para o container, não para a tabela.

- **Melhoria Proposta**
  > Criar `TabelaTitulos.test.tsx` com 5–8 casos focados: (1) ordena por vencimento asc por padrão, (2) clique no cabeçalho `Valor` alterna asc/desc e seta `aria-sort`, (3) linha BLOQUEADA não tem checkbox e mostra motivo/dono/botão, (4) papel `viewer` (sem `sispag:executar`) oculta checkboxes e botões de ação, (5) filtro de credor renderiza etiqueta removível. Bass: Limit Structural Complexity.

- **Resultado Esperado**
  > Diagnóstico de regressão de UI passa de "a aba toda quebrou" para "a tabela ordenou errado". Arquivos .test direcionados ao componente: 0 → 1; casos: 0 → ≥ 5.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: M (2–5d — exige fixtures de títulos e setup react-testing-library)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Arquivo .test direcionado a `TabelaTitulos`: 0 → 1
  - Casos focados: 0 → ≥ 5
  - Cobertura do componente: estimada ~70% (indireta) → ≥ 90% (direta)
- **Risco de não fazer**: baixo isoladamente; triagem fica mais lenta. Não vira defeito-de-produção enquanto `TitulosAbaSituacao` continuar bem coberto.
- **Dependências**: nenhuma.

### [testability-6] Property-based test da identidade `∑ porMotivo = porEstado.BLOQUEADO`

- **Problema**
  > A invariante I19b (soma dos bloqueados por motivo principal = total bloqueados) tem 1 teste por exemplo com 2 títulos. A invariante é estrutural: vale para qualquer tamanho e qualquer combinação. `fast-check` já é dependência do projeto.

- **Melhoria Proposta**
  > Adicionar em `SituacaoPagamentoResolver.test.ts` 1 property-based test: `fc.array(arbTitulo, { minLength: 0, maxLength: 50 })` → avaliar com ctx vazio → `expect(sum(porMotivo.qtd) === porEstado.BLOQUEADO.qtd)`. Idem para `porDono`. Bass: Executable Assertions com fuzzing de domínio.

- **Resultado Esperado**
  > A identidade da regra é verificada em 100 carteiras aleatórias por run, em vez de 1 exemplo. Casos cobertos por run: 2 → 100 (default `fast-check`).

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-6
- **Métricas de sucesso**:
  - Property-based tests no delta: 0 → 1
  - Casos verificados por run: 2 → 100
- **Risco de não fazer**: baixo; só a confiança marginal da invariante global.
- **Dependências**: nenhuma; `fast-check` já é dep do repositório.

## 6. Notas do agente

- Delta tem razão test:source alta: 20 arquivos de teste tocados/criados contra ~34 arquivos de produção, ~2.586 linhas de teste contra ~7.235 de produção. A pontuação 8/10 reflete coverage excepcional de I19a–r (resolver puro + 60 cases, paridade FE/BE enforced, três pontos de uso de I19m testados) e dois buracos específicos (sandbox do job + fixture gravado do com298). Nenhum achado é P0 — nada no delta deixaria passar um pagamento proibido: a mudança preserva os guardas ao vivo do `fin064` (alçada e pago) como autoridade, e `null`/`undefined` em contexto NÃO libera o título, só não aplica aquele motivo específico.
- Não medi cobertura de linha/branch (não rodei `--coverage` conforme guidance de não re-executar os gates já medidos). Recomendo o parent agent agendar 1 passada local focada em `src/backend/domain/service/sispag/SituacaoPagamento*` + `src/frontend/app/sispag/situacao/*` para colar o número ao PR.
- Cross-QA: F-testability-1 (sandbox do job) toca **Deployability** (gate antes do deploy) e **Fault Tolerance** (migração não-idempotente em prod); F-testability-2 (fixture com298) toca **Integrability** (contract test contra Conexos); F-testability-3 (log em `avaliarVivo` null) toca **Modifiability** (observabilidade do fallback) e **Availability** (detectar ingestão quebrada); a paridade FE/BE do teste `src/frontend/lib/sispag.test.ts` é também insumo de **Integrability** (contract parity entre serviços).
- Decisão de escopo: avaliei legado apenas quando o delta o toca (`SispagPainelService`, `LotePagamentoService.incluirTitulo`, `IngestaoPagamentosService`, `ConexosSispagClient`). Testes "antigos" de rotas, modalidade, data-débito etc. estão fora de escopo e não contam para a pontuação.
