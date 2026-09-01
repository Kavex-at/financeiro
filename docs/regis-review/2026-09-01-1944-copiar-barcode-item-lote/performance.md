---
qa: Performance
qa_slug: performance
run_id: 2026-09-01-1944-copiar-barcode-item-lote
agent: qa-performance
generated_at: 2026-09-01T19:44:00-03:00
scope: all
score: 6
findings_count: 4
cards_count: 4
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abre um card de lote não-rascunho no painel SISPAG | `useEffect` dispara `GET /sispag/lotes/:id/linhas-digitaveis` a cada expansão | `LoteCard` → `SispagPainelService.linhasDigitaveisDoLote` → `ConexosSispagWriteClient.listarLinhasDigitaveisDoLote` → `fin015/finItemSispag/list/{fil}/{bnc}/{flp}` | Operação normal (produção); pool de sessões do Conexos compartilhado com ingestão/remessa | Devolver as 47 posições da linha digitável de **todos** os itens do lote em ≤ 2s, sem competir com o pool de sessões nem re-onerar o ERP a cada abertura repetida do mesmo card | p95 latência ≤ 1500ms; 0 truncamentos silenciosos; ≤ 1 chamada ao Conexos por lote a cada 30s por analista (cache curto), independente do número de expansões |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| `pageSize` fixo no novo `listarLinhasDigitaveisDoLote` | 500, `pageNumber: 1`, sem loop | Paginar como `listarTitulosPendentes` faz (`while (pagina < maxPaginas)`) OU parar cedo em `chavesDesejadas` | ❌ | `src/backend/domain/client/ConexosSispagWriteClient.ts:373-374` |
| Precedente documentado do mesmo bug no mesmo arquivo | Filial 2 tem ~2020 pendentes; a versão fixa em `pageNumber:1` mostrava 24,7% do grid; ADR-0040 removeu o padrão | 0 métodos novos herdando esse padrão | ❌ | `src/backend/domain/client/ConexosSispagWriteClient.ts:445-457` (comentário do `listarTitulosPendentes`) |
| Tamanho típico de lote SISPAG | ⚠️ **Não medível localmente**: repositório não tem cap explícito no domínio (`grep MAX.*SISPAG` = 0 hits; `LOTE_MAX=6` é da frente Permutas, não desta); no ERP `titulosCount` é agregador (`RemessaService.ts:731` documenta "vale 1 para qualquer lote não-vazio"). Requer contagem em PRD. | Se pode chegar a >500 itens, é P0; se cap operacional real é ≤ 100, é P2. Marcar essa fronteira antes do release. | ⚠️ | `src/backend/domain/service/sispag/RemessaService.ts:731-736`; ausência de constante em `src/backend/domain/service/sispag/**` |
| Chamadas ao ERP por abertura de card | 1 por expansão (sem cache; `useEffect` deps `[aberto, isRascunho, l.id]`) | ≤ 1 por lote por sessão (ou TTL curto), reaproveitando entre abrir/fechar | ❌ | `src/frontend/app/sispag/components/LoteCard.tsx:158-172` |
| Concorrência entre `linhas-digitaveis` e `modalidades-disponiveis` no MESMO card | 0 (são mutuamente exclusivos: `modalidades` roda só em RASCUNHO — `LoteCard.tsx:138`; `linhas` roda só em NÃO-RASCUNHO — `LoteCard.tsx:159`) | Manter a exclusão | ✅ | `src/frontend/app/sispag/components/LoteCard.tsx:137-172` |
| Fan-out server-side (BoundedConcurrency) para este endpoint | N/A — é 1 leitura por request (por analista, por lote) | Manter, mas medir concorrência agregada quando N analistas abrem N cards | ✅ (para o request isolado) | `src/backend/domain/service/sispag/SispagPainelService.ts:229-263` |
| Uso do `count` devolvido pelo grid | Descartado (`page.rows ?? []` — o `count` do `listGenericPaginated` não é lido) | Ler `count` e, se `rows.length < count`, `console.warn` + degrade explícito (não silenciar) | ❌ | `src/backend/domain/client/ConexosSispagWriteClient.ts:378-386` |
| Serviço nunca lança (converte falha em `[]`) — custo de retry | 0 retentativas na UI (falha vira Map vazio no catch) | Mantido — decisão deliberada e correta para um botão de conveniência | ✅ | `src/frontend/app/sispag/components/LoteCard.tsx:166-168` + `SispagPainelService.ts:248-263` |

## 3. Tactics — Cobertura no nf-projects

### Control Resource Demand
| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | UI dispara 1 request por expansão; sem debounce/throttle e sem cache entre aberturas do mesmo card | ⚠️ parcial | `src/frontend/app/sispag/components/LoteCard.tsx:158-172` |
| Limit Event Response | Falha do ERP vira lista vazia; nunca lança para a UI — evita cascata que derrubaria o card inteiro | ✅ presente | `src/backend/domain/service/sispag/SispagPainelService.ts:248-263` |
| Prioritize Events | N/A — endpoint isolado, sem fila competindo por prioridade neste delta | N/A | — |
| Reduce Overhead | A cada abertura de card refaz uma leitura ERP de 500 linhas (payload cheio) mesmo quando a analista só reabriu para conferir OUTRO campo; sem `ETag`, sem `If-None-Match`, sem TTL local | ❌ ausente | `LoteCard.tsx:157-172` |
| Bound Execution Times | `runWithRetry` do `ConexosBaseClient` limita retries; **não** há timeout explícito no request desse novo caminho além do herdado do axios base do Conexos | ⚠️ parcial | `ConexosSispagWriteClient.ts:365-386` |
| Increase Resource Efficiency | O grid do fin015 é pago por página inteira: pedir 500 quando o lote típico tem dezenas transfere payload à toa em toda expansão | ⚠️ parcial | `ConexosSispagWriteClient.ts:373-374` |

### Manage Resources
| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Increase Resources | N/A — mesmo Conexos, mesmo pool | N/A | — |
| Increase Concurrency | `BoundedConcurrency` está injetado no `SispagPainelService`, mas o novo método é 1 chamada só — não precisa fan-out | ✅ presente (não usada aqui, corretamente) | `SispagPainelService.ts:66,229-247` |
| Maintain Multiple Copies of Computations | ⚠️ Não há cache local: nem no service nem no `LoteCard`; a resposta é derivada 100% a cada request | ❌ ausente | `SispagPainelService.ts:239-247`; `LoteCard.tsx:157-172` |
| Maintain Multiple Copies of Data | Poderia persistir `itsNumCodbar` no banco quando o backend já lê o grid (padrão do `tem_boleto` em `IngestaoPagamentosService`); hoje toda leitura vai ao ERP | ❌ ausente | `SispagPainelService.ts:334-340` (comentário mostra o padrão `tem_boleto` para o mesmo motivo, aqui NÃO seguido) |
| Bound Queue Sizes | N/A — request/response HTTP direto, sem fila | N/A | — |
| Schedule Resources | `CONEXOS_FANOUT_LIMIT=4` no `SispagPainelService` continua respeitado; o novo endpoint entra como request isolado por analista | ✅ presente | `SispagPainelService.ts:48-51` |

### Modern facets
| Faceta | Estado neste delta |
|---|---|
| Cold start budget | ⚠️ Não medível (Express/Render, sem Lambda) — herdado da baseline |
| Cache strategy | ❌ Ausente para este endpoint: sem TTL no service, sem `useMemo`/persistência no `LoteCard` |
| Index discipline | N/A neste delta (não toca SQL) |
| Bundle leanness | ⚠️ Frontend adiciona 1 ícone `lucide-react` (`Copy`) e `sonner` (`toast`) — `sonner` já era dep, mas passa a ser importado neste componente; sem métrica de bundle no `--quick` |

## 4. Findings (achados)

### F-performance-1: `listarLinhasDigitaveisDoLote` reintroduz o anti-padrão `pageSize:500, pageNumber:1` que o ADR-0040 corrigiu

- **Severidade**: P1 (P0 se lote SISPAG puder passar de 500 itens — confirmar em PRD antes do release)
- **Tactic violada**: Bound Execution Times (usada como desculpa para NÃO paginar); Reduce Overhead (aloca sempre 500 mesmo quando o lote tem 20)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:367-386`
- **Evidência (objetiva)**:
  ```typescript
  return this.base.listGenericPaginated<Record<string, unknown>>(
      path,
      {
          fieldList: [],
          filterList: {},
          serviceName: 'fin015',
          pageNumber: 1,
          pageSize: 500,   // ← mesmo padrão que o listarTitulosPendentes documenta ter causado bug real
      },
      { filCod },
  );
  ```
  O mesmo arquivo, 60 linhas abaixo, documenta o precedente (linhas 445-457): *"A versão anterior pedia `pageSize: 500` e fixava `pageNumber: 1` [...] a filial 2 tem ~2020 pendentes, então o chamador enxergava 24,7% do grid [...] `chavesDesejadas` permite sair assim que as chaves apareceram"*. Aqui não há `chavesDesejadas` nem loop `while`.
- **Impacto técnico**: lote com N > 500 itens perde silenciosamente os itens da segunda página em diante. Como o service converte falha em `[]` e o front oculta o botão de copiar quando não há linha (`LoteCard.tsx:463`), o modo de falha é **indistinguível de "este boleto ainda não tem código de barras"** — a mesma classe de silêncio que motivou o ADR-0040. `page.count` é devolvido pelo `listGenericPaginated` e descartado; nem WARN cai no log.
- **Impacto de negócio**: analista clica em conferir a linha digitável do 501º boleto do lote e não vê botão. Ou cola do banco à mão (retrabalho + risco de dígito trocado), ou pula a conferência (que é justamente o controle que este delta veio adicionar). Em produção o padrão custou "24,7% do grid" na filial 2 — este endpoint tem exposição menor (só rodam após remessa gerada), mas a fronteira precisa ser conhecida.
- **Métrica de baseline**: p_perda = 100% × max(0, (N_itens - 500) / N_itens) sem WARN em log. N_itens típico ≠ medido no repo (`titulosCount` do ERP é agregador — `RemessaService.ts:731`).

### F-performance-2: `LoteCard` refaz a chamada a cada expansão — sem cache/memo entre abrir e fechar

- **Severidade**: P2
- **Tactic violada**: Maintain Multiple Copies of Computations (cache); Reduce Overhead
- **Localização**: `src/frontend/app/sispag/components/LoteCard.tsx:157-172`
- **Evidência (objetiva)**:
  ```tsx
  const [linhas, setLinhas] = React.useState<Map<string, string>>(new Map())
  React.useEffect(() => {
    if (!aberto || isRascunho) return
    // ... fetchLinhasDigitaveis(l.id) ...
  }, [aberto, isRascunho, l.id])
  ```
  `aberto` está na lista de dependências e é toggled a cada clique no cabeçalho (`setAberto((v) => !v)` em `LoteCard.tsx:189`). Toda vez que a analista fecha e reabre o mesmo card, o `useEffect` roda de novo (o `useState` local nasce com `new Map()` a cada mount, e mesmo entre montagens o effect é re-executado). O linha digitável é **imutável** para o lote depois da remessa gerada (comentário do próprio service, `SispagPainelService.ts:229-234`), então re-buscar é puro desperdício.
- **Impacto técnico**: N expansões do mesmo lote = N chamadas ao Conexos = N ocupações de sessão do pool `LOGIN_ERROR_MAX_SESSIONS`. Um analista que abre 5 cards conferindo boletos, fecha, volta a abrir para conferir outro campo → 10 requests ao ERP para o mesmo dado imutável.
- **Impacto de negócio**: multiplicador desnecessário sobre o pool de sessões que o `CONEXOS_FANOUT_LIMIT=4` foi criado para proteger. Em pico (fechamento de mês, várias analistas), aumenta a probabilidade de `LOGIN_ERROR_MAX_SESSIONS` disparar em rotas que **movem dinheiro** (remessa/importação), não só na conveniência.
- **Métrica de baseline**: 1 chamada ERP por expansão × N expansões (não medível no `--quick`, mas geometricamente ≥ 2 no fluxo típico de conferência).

### F-performance-3: `count` devolvido pelo grid é descartado — impossível detectar truncamento em runtime

- **Severidade**: P2
- **Tactic violada**: Reduce Overhead (não instrumenta); mitigante para F-performance-1
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:378-386`
- **Evidência (objetiva)**:
  ```typescript
  const itens: Array<{ ... }> = [];
  for (const row of page.rows ?? []) {
      // ...
  }
  return itens;
  ```
  Compare com `listarTitulosPendentes` (linha 503): `if (Number.isFinite(Number(resposta.count))) total = Number(resposta.count);` — lá o `count` guia a decisão de continuar paginando E vira base do WARN de truncamento (linhas 517-523). Aqui o `count` some.
- **Impacto técnico**: se o lote crescer para > 500 itens em algum tenant, ninguém sabe. Não há sinal em log, dashboard ou UI.
- **Impacto de negócio**: F-performance-1 é permanentemente invisível até uma analista reclamar. Diagnóstico depende de reprodução manual.
- **Métrica de baseline**: 0 de 1 uso do `count` disponível.

### F-performance-4: Sem persistência local de `itsNumCodbar` — repete o custo que o `tem_boleto` já pagou

- **Severidade**: P3 (melhoria; não bloqueia release, mas o padrão inverso está a 100 linhas de distância)
- **Tactic violada**: Maintain Multiple Copies of Data
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:229-263` (novo caminho) vs. `SispagPainelService.ts:334-340` (padrão contrário, adotado para `tem_boleto`)
- **Evidência (objetiva)**:
  Comentário do `modalidadesDisponiveisDoLote` que **rejeitou** exatamente essa ida ao ERP para dados equivalentes:
  > *"BOLETO: lido do BANCO, não do ERP. A ingestão já resolveu o flag de DDA na última rodada e gravou em `tem_boleto`; refazer o grid de pendentes aqui custava +7 requisições Conexos por abertura de lote na filial 2, para chegar à mesma resposta."*

  A `linhaDigitavel` é gerada pelo ERP no mesmo `importarTitulos(associarDda)` e não muda depois (ADR-0040). Persistir junto com `tem_boleto` na ingestão eliminaria totalmente o novo endpoint no caminho quente.
- **Impacto técnico**: mantém o Conexos no caminho de leitura de um dado imutável, quando a arquitetura do resto do arquivo já foi calibrada para NÃO fazer isso.
- **Impacto de negócio**: multiplica pressão sobre o mesmo pool de sessões que a frente Recebimentos também disputa.
- **Métrica de baseline**: 1 request Conexos/expansão × M analistas × N lotes finalizados abertos por dia. Alternativa: 0 requests Conexos (leitura direta do Postgres via extensão do repo, custo O(itens do lote) SQL local).

## 5. Cards Kanban

### [performance-1] Paginar de verdade em `listarLinhasDigitaveisDoLote` (matar o `pageNumber:1` fixo)

- **Problema**
  > Novo método fixa `pageNumber:1, pageSize:500` sem loop nem `chavesDesejadas`. É o MESMO anti-padrão que o `listarTitulosPendentes` (60 linhas abaixo no mesmo arquivo) documenta ter causado bug real: filial 2 com ~2020 pendentes viu 24,7% do grid. Aqui a falha é silenciosa por design — a UI oculta o botão quando não há linha, então o modo de falha é indistinguível de "não tem código de barras".

- **Melhoria Proposta**
  > Reusar o esqueleto do `listarTitulosPendentes` (loop `while (pagina < maxPaginas)`, leitura de `resposta.count`, `maxPaginas` como guarda anti-loop, WARN se cortou antes do total). Adicionalmente aceitar `chavesDesejadas?: ReadonlySet<string>` para parar cedo: o chamador (`SispagPainelService.linhasDigitaveisDoLote`) tem o `lote.itens` inteiro e sabe exatamente quais `docCod:titCod` procurar. Tactic Bass: **Bound Execution Times** (correta, via `maxPaginas`) sem sacrificar **Reduce Overhead** (para cedo no caso comum).
  >
  > Arquivos: `src/backend/domain/client/ConexosSispagWriteClient.ts` (método), `src/backend/domain/service/sispag/SispagPainelService.ts` (repassa `chavesDesejadas = new Set(lote.itens.map(chave))`).

- **Resultado Esperado**
  > Lote de até `maxPaginas × pageSize` itens é lido completo; lote maior emite WARN estruturado em vez de silenciar. Caso comum (lote pequeno, boletos vencendo primeiro que o ERP ordena) resolve em 1 página por `chavesDesejadas`. Métrica: p_perda 100% para lote > 500 → 0% até `maxPaginas × pageSize`; WARN por truncamento: 0 → 1 por ocorrência (observável).

- **Tactic alvo**: Bound Execution Times + Reduce Overhead
- **Severidade**: P1 (sobe para P0 se contagem em PRD mostrar lote > 500)
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1, F-performance-3
- **Métricas de sucesso**:
  - Itens truncados silenciosamente: incalculável hoje → 0 (com WARN mensurável)
  - Chamadas ao Conexos no caso comum: 1 página cheia (500 linhas) → 1 página com early-exit por `chavesDesejadas` (payload proporcional ao lote real)
- **Risco de não fazer**: em 6 meses, a primeira analista a cair no caso `N > 500` reporta "boleto sem código de barras" para um título que TEM código; investigação repete o mesmo trabalho da sondagem que produziu o ADR-0040.
- **Dependências**: nenhuma

### [performance-2] Cachear a resposta de `fetchLinhasDigitaveis` no ciclo de vida do card (ou por sessão)

- **Problema**
  > `useEffect` com `aberto` nas dependências dispara `fetchLinhasDigitaveis(l.id)` toda vez que a analista fecha e reabre o card. A linha digitável é imutável após a remessa gerada (documentado no próprio service e no ADR-0040), então re-buscar é puro desperdício de sessão Conexos.

- **Melhoria Proposta**
  > Duas opções, do mais barato ao mais estruturado:
  > 1. Guardar o `Map<string,string>` num `useRef` chaveado por `l.id` dentro do `LoteCard`, e só refetchar se `l.status` mudou (i.e., analista voltou a mexer no lote). Bass: **Maintain Multiple Copies of Computations** (cache local).
  > 2. Subir o cache para o `SispagContext`/hook compartilhado (junto com o padrão que `fetchModalidadesDisponiveis` já quer eventualmente): TTL de 60s, invalidado ao gerar/regerar remessa.
  >
  > Arquivos: `src/frontend/app/sispag/components/LoteCard.tsx` (option 1); ou `src/frontend/lib/sispag.ts` + hook novo em `src/frontend/app/sispag/hooks/` (option 2).

- **Resultado Esperado**
  > Reabrir o mesmo card N vezes → 1 request ao ERP (não N). Métrica: chamadas/expansão 1 → 1/N (com N = número de expansões do MESMO card na sessão).

- **Tactic alvo**: Maintain Multiple Copies of Computations
- **Severidade**: P2
- **Esforço estimado**: S (option 1) / M (option 2)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Chamadas ao Conexos por sessão de análise: N_expansões → N_lotes_distintos
  - Pressão sobre `LOGIN_ERROR_MAX_SESSIONS` durante fechamento de mês: reduz linearmente
- **Risco de não fazer**: multiplicador constante sobre o pool que a remessa/importação REAL divide; em pico volta a disparar `LOGIN_ERROR_MAX_SESSIONS` em rota que move dinheiro.
- **Dependências**: nenhuma

### [performance-3] Ler e agir sobre o `count` do `listGenericPaginated`

- **Problema**
  > O `page.count` devolvido pelo ERP no `listarLinhasDigitaveisDoLote` é descartado. Sem ele, não há como saber em runtime se o `pageSize:500` está sendo suficiente — o defeito F-performance-1 é permanentemente invisível.

- **Melhoria Proposta**
  > Mesmo tratamento do `listarTitulosPendentes` (linhas 502-523): capturar `resposta.count`, comparar com `linhas.length`, emitir `console.warn` estruturado se cortou. Sobrepõe-se com [performance-1] mas vale mesmo se aquele card demorar: um WARN barato hoje é o alarme que evita a investigação de 3 dias em 6 meses. Bass: **Reduce Overhead** (instrumentação leve com sinal alto).
  >
  > Arquivo: `src/backend/domain/client/ConexosSispagWriteClient.ts` (mesmo método).

- **Resultado Esperado**
  > Truncamento passa a ser observável em CloudWatch/Render logs. Métrica: MTTD do defeito de paginação: ∞ → segundos após ocorrência.

- **Tactic alvo**: Reduce Overhead (instrumentação)
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-3, F-performance-1
- **Métricas de sucesso**:
  - Cobertura de observabilidade do truncamento: 0% → 100%
- **Risco de não fazer**: F-performance-1 permanece invisível independente do valor efetivo dos lotes.
- **Dependências**: pode/deve ir junto com [performance-1]

### [performance-4] Persistir `itsNumCodbar` na ingestão (o mesmo padrão que `tem_boleto` já usa)

- **Problema**
  > `linhasDigitaveisDoLote` faz round-trip ao Conexos para um dado que o ERP JÁ escreveu no import da remessa e não muda depois. Cem linhas abaixo, `modalidadesDisponiveisDoLote` deliberadamente rejeita esse caminho para o flag `tem_boleto`: *"refazer o grid de pendentes aqui custava +7 requisições Conexos por abertura de lote na filial 2, para chegar à mesma resposta."* — este novo endpoint volta a pagar esse custo.

- **Melhoria Proposta**
  > Estender `IngestaoPagamentosService` (ou o passo do `RemessaService` que confirma a remessa) para gravar `itsNumCodbar` em coluna nova de `sispag_lote_item` (ou `titulo`, dependendo do modelo — checar com o Ontology Curator). Rota passa a ler do Postgres local; ERP só é consultado se a coluna estiver vazia (backfill lazy). Bass: **Maintain Multiple Copies of Data**.
  >
  > Arquivos: nova migration em `src/backend/migrations/`; `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` (coluna nova + getter); `src/backend/domain/service/sispag/RemessaService.ts` (gravar no ledger da remessa); `SispagPainelService.linhasDigitaveisDoLote` (ler local antes do fallback ERP).

- **Resultado Esperado**
  > Botão de copiar linha digitável passa a ser 100% servido do Postgres local depois da 1ª remessa. Métrica: chamadas ao Conexos por expansão de card não-rascunho: 1 → 0 (com fallback ao ERP só se coluna vazia).

- **Tactic alvo**: Maintain Multiple Copies of Data
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-performance-4
- **Métricas de sucesso**:
  - Chamadas ao Conexos no caminho quente: 1/expansão → 0/expansão (steady state)
  - Latência p95 do endpoint: rede+ERP (~1-3s) → SQL local (~50ms)
- **Risco de não fazer**: divergência arquitetural com `tem_boleto`; a mesma pressão que aquele padrão foi criado para aliviar volta pela porta ao lado. Não urgente, mas a decisão contrária foi tomada explicitamente 100 linhas acima do código novo — vale registrar coerência.
- **Dependências**: coordenar com Ontology Curator (nova coluna → diff de ontologia); depende de aceitar que o backfill de lotes já finalizados fica lazy.

## 6. Notas do agente

- Escopo `--quick` respeitado: não rodei build de frontend nem benchmarks; medi só o delta e comparei ao precedente documentado no mesmo arquivo. Não há `infra/`, então cold start / Terraform ficam "não medível" (herdado de `_shared-metrics.md`).
- Métrica que **tentei** e falhou: tamanho típico de lote SISPAG em produção. Grep por `LOTE_MAX`/`maxItens`/`titulosCount` mostra que (a) o cap `LOTE_MAX=6` é da frente Permutas e não desta, e (b) `titulosCount` é agregador (comentário em `RemessaService.ts:731`). Sem contagem de PRD não dá pra decidir se F-performance-1 é P0 ou P1 — deixei P1 e sinalizei no card.
- Cross-QA: (i) **Availability + Fault Tolerance** — o `service nunca lança` (return `[]`) é a decisão correta para UI, mas F-performance-1 explora esse silêncio para virar bug de correção; qa-availability deve saber que o mesmo padrão que protege o card cria um pit-of-failure de dado. (ii) **Modifiability** — [performance-4] toca schema (migration + coluna), portanto coordena com qa-modifiability. (iii) **Security** — a rota `requireRole('admin')` está correta e é referenciada no delta; qa-security deve confirmar que o Cache ([performance-2]) não vaza linhas digitáveis entre roles/tenants no client.
- Não sinalizei bundle-size do frontend (`sonner` + `Copy`) porque o `sonner` já era dependência do repo; o único delta real é 1 import de ícone (~1KB tree-shaken).
