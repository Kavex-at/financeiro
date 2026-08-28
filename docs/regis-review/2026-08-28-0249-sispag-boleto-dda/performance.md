---
qa: Performance
qa_slug: performance
run_id: 2026-08-28-0249-sispag-boleto-dda
agent: qa-performance
generated_at: 2026-08-28T02:49:00-03:00
scope: backend
score: 6
findings_count: 6
cards_count: 4
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Cron da ingestão diária (+ trigger manual) | rodada da ingestão de pagamentos com 4 filiais | `IngestaoPagamentosService.runIngestion` → Conexos `fin005/fin015` | operação normal, Render (Express, single node) | roda dentro do orçamento e não estoura `LOGIN_ERROR_MAX_SESSIONS` do Conexos | +18 chamadas HTTP/rodada vs. baseline; concorrência simultânea de 8 → 12 requisições por worker-tick |
| Analista abrindo um lote na UI SISPAG | `GET /sispag/lotes/:id/modalidades` | `SispagPainelService.modalidadesDisponiveisDoLote` → `getTituloAPagar` × item + `listContasFavorecido` × favorecido + **novo** grid DDA × filial | interação humana, latência percebida | latência percebida da abertura estável | +2 a +12 requisições Conexos por abertura (depende de nº de filiais distintas + páginas do grid da filial) |
| Envio da remessa (RemessaService) | `POST /sispag/lotes/:id/remessa` — grupo DDA vs. não-DDA | `RemessaService.executarRemessa` → `ConexosSispagWriteClient.importarTitulos` × 2 grupos | escrita não-idempotente, tentativa única | número total de POSTs de import inalterado (client já quebra 1 POST/item) | +0 POSTs de escrita vs. baseline (apenas 1 laço a mais no orquestrador) |

> **Não medível localmente:** latência real de produção (p50/p95 do Conexos, tempo de painel percebido) requer instrumentação em Render/PRD. Todos os números abaixo são **contagem de requisições** e **páginas medidas**, não milissegundos.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| HTTP requests NOVOS por rodada de ingestão | **+18 requisições** (4× `listContasCorrentes` + 4× `listarLotesNativos` + 10× `listarTitulosPendentes` pages) | ≤ +8 (idealmente reutilizar `tem_boleto` já persistido) | ⚠️ | soma manual sobre `IngestaoPagamentosService.titulosComBoletoDda` + `ConexosSispagWriteClient.listarTitulosComBoletoDda` |
| Páginas do grid `fin015/titulosPendentes` por filial (medido em PRD) | fil 1: **1** (173/500) · fil 2: **5** (2195/500) · fil 4: **2** (598/500) · fil 6: **2** (636/500) | manter a soma ≤ 10 páginas/rodada (baseline atual) | ✅ (por ora) | `ontology/_inbox/sispag-boleto-dda-sondagem.md` §3 |
| `maxPaginas` da paginação DDA | **40** (default; teto de 20.000 pendentes por filial) | manter; hoje fil 2 usa 12,5% do teto | ✅ | `ConexosSispagWriteClient.ts:371` |
| Concorrência HTTP simultânea na ingestão | **12** (3 ops paralelas × 4 workers) — era 8 antes do delta | ≤ Conexos `LOGIN_ERROR_MAX_SESSIONS` (valor exato não medível daqui) | ⚠️ | `IngestaoPagamentosService.ts:118-129` (Promise.all de 3 leituras × `FANOUT_LIMIT=4`) |
| HTTP requests NOVOS por abertura de lote no painel | **+1 a +6** (`listContasCorrentes` × filiais_distintas + `listarLotesNativos` × filiais_distintas + páginas de `listarTitulosPendentes`) | 0 (usar `tem_boleto` persistido) | ❌ | `SispagPainelService.ts:255-284` |
| Baseline de HTTP por abertura de lote (pré-delta) | `getTituloAPagar` × N_itens + `listContasFavorecido` × N_favorecidos_distintos (limit 4) | — | — | `SispagPainelService.ts:225-253` |
| POSTs de escrita por remessa (particionamento DDA) | **igual ao baseline** (client quebra em 1 POST/item; 2 laços × N_items_do_grupo = N_items total) | inalterado | ✅ | `ConexosSispagWriteClient.ts:512-544` (loop `if (itens.length > 1)`) + `RemessaService.ts:466-478` |
| Uso de `BoundedConcurrency` nos novos fan-outs | **100%** dos 3 sítios novos respeitam `CONEXOS_FANOUT_LIMIT=4` | 100% | ✅ | `grep -n CONEXOS_FANOUT_LIMIT src/backend/domain/service/sispag/SispagPainelService.ts` — linhas 190, 206, 260, 281, 306 |
| Cache do resultado DDA por lote/filial dentro de uma abertura de painel | **ausente** — `listarTitulosComBoletoDda` chamado sem memoização por (filCod, bncCod) | 1 leitura por (filCod, bncCod) por request | ⚠️ | `SispagPainelService.ts:255-284` |
| Reuso do `titulo_a_pagar.tem_boleto` persistido | **0%** — painel refaz leitura ao vivo mesmo com valor persistido pela última ingestão | oportunidade (trade-off vs. anti-drift) | ⚠️ | `TituloAPagarRepository.listAtivos` já devolve `tem_boleto` (linha 137); painel ignora |
| Latência real p50/p95 (Conexos, painel, ingestão) | **não medível localmente** | requer Render logs/CloudWatch-equivalente | ⚠️ | — |

> ⚠️ **Não medível localmente:** latência absoluta em ms. Recomendação: instrumentar no `LogService` um `duration_ms` por chamada Conexos e agregar via dashboard do Render (ou destino de log downstream) para captura de p50/p95 por endpoint.

## 3. Tactics — Cobertura no delta

### Control Resource Demand

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | Cadência da ingestão = cron diário + trigger manual; painel = por abertura (interação humana, não amostragem programática) | ✅ | `IngestaoPagamentosService.executar` (advisory lock cross-processo bloqueia sobreposição) |
| Limit Event Response | `TITULOS_CAP=5000` no payload do painel; `listarTitulosPendentes` para em `chavesDesejadas` cheias antes de esgotar o grid | ✅ parcial | `SispagPainelService.ts:36`; `ConexosSispagWriteClient.ts:408` |
| Prioritize Events | N/A — não há fila de eventos com priorização (fluxo é síncrono/request-response) | N/A | — |
| Reduce Overhead | `listContasFavorecido` já é feito por par (filCod, pesCod) **distinto** em vez de por item; particionamento DDA reaproveita o mesmo `montarItensImport` | ✅ | `SispagPainelService.ts:239-249`; `RemessaService.montarItensImport` |
| Bound Execution Times | `maxPaginas=40` na paginação DDA impede loop infinito com WARN em vez de silêncio; `MINUTOS_ORFAO=15` para execuções paradas | ✅ | `ConexosSispagWriteClient.ts:371, 413-418`; `SispagPainelService.ts:46` |
| Increase Resource Efficiency | `Promise.all` intra-worker (3 leituras/filial em paralelo), `Set` para lookup O(1) das chaves DDA e do exterior | ✅ | `IngestaoPagamentosService.ts:118-129, 154` |

### Manage Resources

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Increase Resources | N/A no delta — não altera dimensionamento de Render/Postgres | N/A | — |
| Introduce Concurrency | `BoundedConcurrency` respeitado em 100% dos novos fan-outs (`CONEXOS_FANOUT_LIMIT=4`) | ✅ | 6 sítios do SispagPainelService (linhas 104, 190, 206, 260, 281, 306) + IngestaoPagamentosService (linha 129) |
| Maintain Multiple Copies of Computations | Ausente — cada abertura de painel recomputa `listarTitulosComBoletoDda` **por filial**, sem memoização por (filCod, bncCod) nem por request | ❌ | `SispagPainelService.modalidadesDisponiveisDoLote` chamado por lote, sem cache request-scoped |
| Maintain Multiple Copies of Data | Ausente para `temBoleto` — a ingestão persiste em `titulo_a_pagar.tem_boleto` mas o painel refaz ao vivo | ❌ | `TituloAPagarRepository.ts:137` (persistido) vs. `SispagPainelService.ts:255-284` (ao vivo) |
| Bound Queue Sizes | Advisory lock impede 2 ingestões concorrentes (`IngestLockBusyError` → 409); `TITULOS_CAP=5000` limita payload do painel | ✅ | `IngestaoPagamentosService.ts:54-64`; `SispagPainelService.ts:36` |
| Schedule Resources | `BoundedConcurrency` = round-robin sobre pool de N workers (FIFO por item, `nextIndex++`) — não há prioridade explícita | ✅ | `BoundedConcurrency.ts:44-51` |

## 4. Findings (achados)

### F-performance-1: Painel refaz leitura ao vivo do grid DDA por filial, mas o valor já está persistido em `titulo_a_pagar.tem_boleto`

- **Severidade**: P1 (alto — degrada latência mensurável no caminho quente do analista)
- **Tactic violada**: `Maintain Multiple Copies of Data` (Manage Resources)
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:255-284`
- **Evidência (objetiva)**:
  ```
  # Painel refaz o cálculo ao vivo por filial distinta do lote:
  const filiaisDoLote = [...new Set(lote.itens.map((it) => it.filCod))];
  const boletoSettled = await this.bounded.run(filiaisDoLote, async (filCod) => {
      const contas = await this.sispag.listContasCorrentes(filCod);
      const bncCod = contas[0]?.bncCod;
      if (bncCod === undefined) return new Set<string>();
      return this.fin015.listarTitulosComBoletoDda({ filCod, bncCod });
  }, CONEXOS_FANOUT_LIMIT);

  # A ingestão JÁ persiste o mesmo dado:
  TituloAPagarRepository.listAtivos → SELECT ... tem_boleto FROM titulo_a_pagar
  ```
  Custo por chamada do painel (medido a partir dos números da sondagem):
  - `listContasCorrentes` × N_filiais_distintas = 1 req/filial
  - `listarLotesNativos` × N_filiais_distintas = 1 req/filial (pageSize 500, 1 página em prática)
  - `listarTitulosPendentes` × N_filiais_distintas × páginas (fil 2 = 5 páginas, fil 4/6 = 2, fil 1 = 1)
  Lote da filial 2 = **+7 requisições Conexos** por abertura de painel; lote misto 2+6 = **+10**.
- **Impacto técnico**: cada requisição Conexos é 2–10 s p99 (contexto do CLAUDE.md); +7 a +10 requisições em série (dentro do worker) empilham latência percebida. Uma abertura de painel na filial 2 pode adicionar dezenas de segundos.
- **Impacto de negócio**: o painel é a tela que o analista abre para escolher forma de pagamento — o gargalo cai no caminho crítico da operação diária. Trade-off contra anti-drift é limitado: a decisão final continua gated pelo `BoletoSemCodigoBarrasError` no ENVIO (fail-closed), então servir o painel com dado do último ingest (≤ 24 h) NÃO abre risco de dinheiro sair errado.
- **Métrica de baseline**: +7 req Conexos por abertura de painel para lote de fil 2 (medido: 2195 pendentes / pageSize 500 = 5 páginas + 1 lotes + 1 contas) vs. 0 req se reutilizar `tem_boleto`.

### F-performance-2: Ausência de memoização request-scoped no fan-out DDA do painel

- **Severidade**: P2 (médio — desperdício estrutural, agrava F-performance-1)
- **Tactic violada**: `Maintain Multiple Copies of Computations` (Manage Resources)
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:255-284`
- **Evidência (objetiva)**:
  ```
  const filiaisDoLote = [...new Set(lote.itens.map((it) => it.filCod))];
  # deduplica POR LOTE, mas não POR REQUEST — abrir 3 lotes em sequência da mesma filial
  # refaz o mesmo grid 3 vezes.
  ```
- **Impacto técnico**: se o analista abrir 5 lotes seguidos na mesma filial (comportamento comum ao revisar rascunhos), o grid `fin015/titulosPendentes` da filial é lido 5 vezes com resposta idêntica (o grid é da filial, não do lote — conforme comentário em `SispagPainelService.ts:255`).
- **Impacto de negócio**: multiplica a latência de F-performance-1 pelo nº de aberturas na sessão.
- **Métrica de baseline**: 5 aberturas seguidas × 7 requisições (fil 2) = 35 requisições evitáveis.

### F-performance-3: Concorrência HTTP simultânea da ingestão subiu de 8 → 12 requisições sem revisão do bound

- **Severidade**: P2 (médio — pressiona o pool de sessões do Conexos)
- **Tactic violada**: `Bound Queue Sizes` / `Introduce Concurrency` (o bound aumentou sem alarme correspondente)
- **Localização**: `src/backend/domain/service/sispag/IngestaoPagamentosService.ts:118-129`
- **Evidência (objetiva)**:
  ```
  const settled = await this.bounded.run(filCods, async (filCod) => {
      const [titulos, exterior, comBoleto] = await Promise.all([
          this.sispag.listTitulosAPagar(filCod, { minVencimento, maxVencimento }),
          this.sispag.listExteriorDocCods(filCod),
          this.titulosComBoletoDda(filCod),   // <— NOVA operação paralela
      ]);
      return { titulos, exterior, comBoleto };
  }, FANOUT_LIMIT);
  ```
  Antes: 2 ops paralelas × 4 workers = 8 requisições Conexos concorrentes. Agora: 3 × 4 = 12. E `titulosComBoletoDda` internamente encadeia até 6 requisições sequenciais (fil 2), então o tempo em que 12 conexões coexistem se estende.
- **Impacto técnico**: pool de sessões do Conexos (comentário em `SispagPainelService.ts:44`: "Evita o burst que pressiona `LOGIN_ERROR_MAX_SESSIONS`") pode ser atingido — o limite exato não é documentado.
- **Impacto de negócio**: falha da ingestão → carteira sem `tem_boleto` atualizado → painel oferece BOLETO em títulos que perderam o DDA (ou vice-versa) → `BoletoSemCodigoBarrasError` no envio.
- **Métrica de baseline**: 8 → 12 requisições Conexos concorrentes máximas por rodada de ingestão (+50%).

### F-performance-4: `maxPaginas=40` como guarda tem headroom, mas nenhum alarme antes do WARN silencioso

- **Severidade**: P3 (baixo — margem confortável hoje, mas o WARN vai para stderr sem observabilidade)
- **Tactic violada**: `Bound Execution Times` (o bound existe, mas o sinal é fraco)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:413-418`
- **Evidência (objetiva)**:
  ```
  if (pagina >= maxPaginas && acumulado.length < total) {
      console.warn(`[fin015] titulosPendentes truncado em ${maxPaginas} páginas: ...`);
  }
  ```
  Ceiling = 40 × 500 = 20.000 pendentes/filial. Filial 2 hoje = 2.195 (11% do teto). Uso saudável, mas o único aviso é `console.warn` — não passa por `LogService` (que é o canal com metadata/estruturado do repo).
- **Impacto técnico**: se um filtro futuro expandir a leitura (por exemplo, remover `filCod#EQ` — foi o bug histórico descrito nas linhas 213-227) o truncamento silencioso reintroduz o mesmo bug que a paginação foi criada para evitar.
- **Impacto de negócio**: título com boleto DDA além da página 40 não vira `tem_boleto = true` → painel omite BOLETO como opção → analista escolhe TED e paga a taxa errada.
- **Métrica de baseline**: 1 uso de `console.warn` em código produtivo (encontrado por `grep -n "console.warn" src/backend/domain/client/ConexosSispagWriteClient.ts`) vs. 0 esperado (padrão do repo é `LogService`).

### F-performance-5: Particionamento DDA/não-DDA em `importarTitulos` NÃO aumenta o número total de POSTs (verificado)

- **Severidade**: P3 (baixo — na verdade neutro; registrado para fechar a pergunta do briefing)
- **Tactic violada**: nenhuma
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:466-478`; `src/backend/domain/client/ConexosSispagWriteClient.ts:512-544`
- **Evidência (objetiva)**:
  ```
  # RemessaService:
  for (const associarDda of [false, true]) {
      const itens = montados.filter((m) => m.associarDda === associarDda).map((m) => m.payload);
      if (itens.length === 0) continue;
      await this.write.importarTitulos({ filCod, bncCod, flpCod, itens, associarDda });
  }

  # ConexosSispagWriteClient já quebra em 1 POST por item:
  if (itens.length > 1) {
      for (const item of itens) {
          await this.importarTitulos({ filCod, bncCod, flpCod, itens: [item], op, associarDda });
      }
      return;
  }
  ```
  Antes do delta: 1 chamada externa `importarTitulos` com N itens → o client já expandia para N POSTs. Depois: 2 chamadas externas (grupo DDA + grupo não-DDA) com N_dda + N_nao_dda itens → mesmo N POSTs totais (mais 1 iteração no orquestrador quando ambos os grupos têm ≥1 item — custo desprezível).
- **Impacto técnico**: nulo. O particionamento é semanticamente necessário (`titVldReflexoDdaAssoc` é campo de SELEÇÃO, vale para a requisição inteira) e não paga custo de rede.
- **Impacto de negócio**: nenhum.
- **Métrica de baseline**: N POSTs de import antes = N POSTs depois (idêntico).

### F-performance-6: Latência real do painel e da ingestão não medível a partir deste repo

- **Severidade**: P2 (médio — cega o time para regressões futuras)
- **Tactic violada**: instrumentação prévia a qualquer tactic de performance
- **Localização**: `src/backend/domain/libs/LogService.*` (não há campo `duration_ms` estruturado por chamada)
- **Evidência (objetiva)**:
  ```
  # LogService atual registra type/message/data mas nenhum ponto do fluxo mede duração por endpoint Conexos.
  # Números deste report são contagem de REQUISIÇÕES, não milissegundos.
  ```
- **Impacto técnico**: não há como validar o alvo "latência abaixo de X" de nenhum card sem instrumentação.
- **Impacto de negócio**: F-performance-1 fica sem baseline em ms — o time só sente a regressão quando a analista reclamar.
- **Métrica de baseline**: 0 pontos de instrumentação `duration_ms` por chamada Conexos (grep de "duration" no `domain/libs/` retorna vazio).

## 5. Cards Kanban

### [performance-1] Reutilizar `titulo_a_pagar.tem_boleto` no painel em vez de refazer o grid DDA por filial

- **Problema**
  > `SispagPainelService.modalidadesDisponiveisDoLote` refaz `listContasCorrentes` + `listarLotesNativos` + `listarTitulosPendentes` (paginado) por filial distinta do lote a cada abertura. O mesmo valor já está persistido em `titulo_a_pagar.tem_boleto` pela última ingestão (≤ 24 h). Para o lote de fil 2 são +7 requisições Conexos por abertura; um lote misto 2+6 são +10. O fail-closed do envio (`BoletoSemCodigoBarrasError`) continua garantindo que dinheiro não saia errado se o flag persistido estiver stale.

- **Melhoria Proposta**
  > No painel: derivar `comBoleto` a partir do `TituloAPagarRepository.listByChaves(chaves)` (ou reaproveitar o `listAtivos` já usado em `montarPainel` via um lookup por chave) e eliminar o fan-out `boletoSettled`. Manter a leitura ao vivo APENAS em `RemessaService.montarItensImport` (caminho de escrita, doutrina anti-drift). Documentar o trade-off no comentário do método e no ADR-0040. Tactic: `Maintain Multiple Copies of Data`.

- **Resultado Esperado**
  > Painel deixa de emitir chamadas Conexos para descobrir "tem boleto DDA?": +7 a +10 req/abertura → **0 req/abertura**. Latência percebida cai proporcionalmente (não medível daqui, mas contagem de requisições evitadas é objetiva).

- **Tactic alvo**: Maintain Multiple Copies of Data
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1, F-performance-2
- **Métricas de sucesso**:
  - Requisições Conexos por abertura de painel (lote fil 2): **7 → 0**
  - Requisições Conexos por abertura de painel (lote misto fil 2+6): **10 → 0**
  - Freshness do `tem_boleto` servido pelo painel: **≤ 24 h** (cadência do cron)
- **Risco de não fazer**: a rota mais quente do SISPAG (painel) fica com latência que cresce com a carteira e com o número de filiais do lote — cada nova filial adiciona uma leitura paginada.
- **Dependências**: revisar `ADR-0040` para consignar o trade-off; alinhar com o `qa-fault-tolerance` (quem falar sobre anti-drift).

### [performance-2] Rebaixar concorrência de fan-out da ingestão de 4 para 3 (ou introduzir observabilidade do pool Conexos)

- **Problema**
  > A ingestão passou a fazer **3** operações paralelas dentro de cada worker de filial (era 2), mantendo `FANOUT_LIMIT=4`. Concorrência simultânea máxima subiu de 8 → 12 requisições Conexos, sem revisão do bound e sem métrica de `LOGIN_ERROR_MAX_SESSIONS` que valide o novo teto.

- **Melhoria Proposta**
  > Duas opções, escolher uma:
  > (a) baixar `FANOUT_LIMIT` de 4 para 3 na `IngestaoPagamentosService` (mantém pico ≈ 9, próximo do pré-delta);
  > (b) manter 4 e instrumentar contagem/agregação de 5xx Conexos e `LOGIN_ERROR_MAX_SESSIONS` para provar que 12 concorrentes está dentro do orçamento.
  > Tactic: `Bound Queue Sizes` (a) ou `Manage Sampling Rate` sobre o próprio Conexos (b).

- **Resultado Esperado**
  > (a) Concorrência HTTP simultânea da ingestão: **12 → 9** (paridade com o pré-delta ± 1) e taxa de falha `LOGIN_ERROR_MAX_SESSIONS` estável.
  > (b) Dashboard em produção com contagem de sessões concorrentes vs. teto.

- **Tactic alvo**: Bound Queue Sizes
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Concorrência Conexos simultânea por rodada: **12 → 9** (opção a), ou dashboard em produção (opção b)
  - Falhas `LOGIN_ERROR_MAX_SESSIONS` por rodada: mantém 0 (baseline atual, informado nas sondas)
- **Risco de não fazer**: o próximo `Promise.all` adicionado ao worker sobe para 4 ops × 4 workers = 16 conexões — o momento em que estoura vai ser numa rodada de produção qualquer.
- **Dependências**: —

### [performance-3] Elevar o WARN de `maxPaginas` para `LogService` estruturado + threshold no logService

- **Problema**
  > O único aviso quando a paginação DDA satura em 40 páginas é `console.warn` (`ConexosSispagWriteClient.ts:414`). Vai para stderr sem estrutura, sem correlação, sem alarme. Se um filtro futuro expandir a leitura (o histórico do próprio arquivo, linhas 213-227, mostra que já aconteceu com `filCod#EQ`), o truncamento silencioso re-cria o bug que a paginação resolve.

- **Melhoria Proposta**
  > Trocar `console.warn` por `logService.warn({ type: LOG_TYPE.BUSINESS_WARN, message: '...' , data: { filCod, bncCod, flpCod, paginas, acumulado, total }})`. Tactic: `Bound Execution Times` (o bound existe; o sinal precisa ser observável).

- **Resultado Esperado**
  > 0 usos de `console.warn` em `src/backend/domain/client/*.ts` (padrão do repo); o WARN de truncamento passa a aparecer no mesmo canal dos demais logs de negócio, correlacionável por `filCod`.

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-4
- **Métricas de sucesso**:
  - `grep -n "console.warn" src/backend/domain/client/ConexosSispagWriteClient.ts` → **1 → 0**
  - WARN de truncamento passa a aparecer na base de logs padrão (verificável em dev)
- **Risco de não fazer**: bug de filtro passa despercebido até um analista reclamar de BOLETO ausente para um pagamento específico.
- **Dependências**: —

### [performance-4] Instrumentar `duration_ms` por chamada Conexos no `LogService`

- **Problema**
  > Sem métricas de latência por endpoint Conexos, todo alvo de performance é declarativo. Este próprio card [performance-1] promete "latência cai proporcionalmente" mas não pode ser validado — nem antes, nem depois.

- **Melhoria Proposta**
  > No `ConexosBaseClient.runWithRetry` (ou no `listGenericPaginated`), envolver a chamada num `Date.now()` diff e emitir um `logService.info({ type: LOG_TYPE.PERF, data: { endpoint, filCod, duration_ms, page } })`. Custo mínimo, permite agregação por endpoint em produção. Tactic: pré-requisito para toda tactic de Performance.

- **Resultado Esperado**
  > 100% das chamadas ao Conexos emitem `duration_ms` estruturado; possível construir p50/p95 por endpoint em qualquer coletor de logs downstream (Render → export). Baseline mensurável para o antes/depois do card [performance-1].

- **Tactic alvo**: (pré-requisito para Performance)
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-6
- **Métricas de sucesso**:
  - Cobertura de instrumentação: **0% → 100%** das chamadas Conexos
  - Dashboard em produção com p50/p95 por endpoint (validação externa)
- **Risco de não fazer**: regressões de performance no próximo delta ficam invisíveis até virarem reclamação da operação.
- **Dependências**: [performance-1] se beneficia deste para validar o resultado.

## 6. Notas do agente

- Escopo consciente: revisei APENAS o delta do commit 5978ac5 e o entorno imediato (`SispagPainelService`, `IngestaoPagamentosService`, `ConexosSispagWriteClient`, `RemessaService`, `BoundedConcurrency`, `TituloAPagarRepository`). Não avaliei o backend inteiro.
- **Cross-QA a alertar o consolidator**:
  - **qa-fault-tolerance / qa-availability**: F-performance-3 (concorrência 8→12) toca o mesmo tema de "pressão sobre pool de sessões Conexos" que já é doutrina em `LOGIN_ERROR_MAX_SESSIONS`; e o trade-off do card [performance-1] (reuso do `tem_boleto` persistido) é diretamente uma decisão de anti-drift que qa-fault-tolerance também revisa.
  - **qa-modifiability**: `MODALIDADE_NATIVA.BOLETO` continua no código (`RemessaService.ts:30`) apenas para o caminho boleto SEM DDA — hoje barrado no envio. Pode virar dead code no médio prazo (registrar como dívida, não como finding meu).
  - **qa-testability**: os testes tocados (`IngestaoPagamentosService.test.ts`, `SispagPainelService.test.ts`) cobrem o novo fan-out DDA, mas não cobrem o cenário "5 aberturas seguidas do painel na mesma filial" (F-performance-2 seria detectada por um teste desses).
- Métricas de latência absoluta (ms) declaradas como **não medíveis daqui** — todos os números do report são contagens de requisições e páginas efetivamente medidas em PRD (sondagem) ou derivadas por leitura de código.
- Nenhum finding aberto contra warnings de lint ou tamanho de bundle — este delta é 100% backend (mais o LoteCard/page.tsx do front, mudanças cosméticas).
