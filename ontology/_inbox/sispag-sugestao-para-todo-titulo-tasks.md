# Tasks: sispag-sugestao-para-todo-titulo

**Spec source:** `ontology/_inbox/sispag-sugestao-para-todo-titulo-proposta.md` (aprovada; decisões do maintainer finais) + `ontology/decisions/0072-sispag-desfecho-por-titulo-e-aviso-vence-antes.md` (ontologia 0.43.0, commit 0492aaf, `planned`)
**Ontology diff:** yes (já aplicado, `implementation_status: planned`) — `ontology/business-rules/sugestao-boleto-dda-sispag.md` (I15m, I15n, I15o; emendas I15c/I15e/I15h), `ontology/business-rules/vinculo-codbar-item-sispag.md` (notas I17a/I17c), `ontology/entities/decisao-sugestao-boleto.md`, `ontology/entities/boleto-dda.md`, ADR-0072
**entity_changed:** true (propriedade derivada `SituacaoSugestaoTitulo`; 2 sinais no snapshot; sem entidade nova, sem estado novo)
**Estimated scope:** L (backend ~8 arquivos + rota + frontend ~7 arquivos + 2 execuções de medição somente leitura; **sem migration prevista**, ver Task 11)
**Mode:** `/feature-new`. Estende `RegraSugestaoBoleto`, `MotorSugestaoBoleto`, `BoletoSuggestionService`; não reescreve. Passo 2 (I17) **não é tocado**.
**Entrega:** nenhuma flag nova. Mudança de exibição + validação de ack no servidor; escrita no ERP continua zero (I15a/b).

## Decisões fechadas (não reabrir)

- **Exibir ≠ confirmar (P0-1, opção a):** candidato fraco (ATENCAO sem âncora) e candidatos ambíguos são exibidos ranqueados (top-N = 3) e **não** confirmáveis; o servidor recusa (409 `BoletoSuggestionNotAvailableError` com o motivo da situação). Ambíguo se resolve **rejeitando** os outros pela ação existente.
- **Aviso + ack (P0-2, opção a):** Δdias < 0 emite `VENCE_ANTES_DO_TITULO`; confirmar exige `reconheceAvisos` contendo o sinal (422 `WarningAcknowledgementRequiredError` sem ele), gravado como `RECONHECEU_VENCE_ANTES` no snapshot. Vencido na data de débito segue bloqueado por I15h (`VENCIDO_INFORMATIVO`). O passo 2 nunca lê situação, âncora nem ack.
- **P1 defaults aplicados:** top-N = 3 (constante de exibição, não domínio); uma linha por título + candidatos sob demanda; atraso por dia civil (ADR-0070); sem aviso para título já associado a DDA pelo ERP; medição somente leitura como critério de aceite.

## Fatos do código que moldam as tasks (verificados neste worktree em 2026-10-15)

- `MotorSugestaoBoleto.aceita` descarta `ATENCAO` sem âncora e `VENCIDO_INFORMATIVO` sem âncora e com |Δvalor| > R$ 0,05; `camadaSegura` descarta silenciosamente o título com 2+ seguros de mesma força (`resolvidos.add`, sem linha); o perdedor da disputa é "reavaliado sem o boleto" e some se nada sobra. Esses três pontos são o alvo.
- `RegraSugestaoBoleto.avaliar` marca `confirmavel = true` para todo `ATENCAO` (set `CONFIRMAVEIS`), inclusive sem âncora. Hoje isso é inofensivo porque o motor nunca devolve o fraco; **depois da mudança o fraco passa a existir no cenário**, então a trava precisa estar no motor (`confirmavel` do item exibido) **e** em `BoletoSuggestionService.confirmar` (que hoje consulta `avaliacaoDireta.confirmavel` e `sugestao.avaliacao.confirmavel`). Risco P0 de implementação: não confiar na regra pura.
- `confirmar` reavalia ao vivo (`sugerirAgora`) e já devolve `OverdueBoletoNotConfirmableError` (422) para `VENCIDO_INFORMATIVO`. O ack entra **depois** dos atalhos de idempotência (decisão já existente devolve `criada:false` sem exigir ack) e **depois** do 409 de não confirmável; é conferido contra a avaliação recalculada no servidor, nunca contra o cache.
- `sinais` em `sispag_decisao_sugestao_boleto` é `JSONB NOT NULL DEFAULT '[]'` **sem CHECK** (0084, linha 101); o repositório grava `JSON.stringify(input.sinais)` e lê `d.sinais` sem validar enum. **Valores novos não exigem migration.** Última migration em `src/backend/migrations` = **0086**; próximo livre = **0087**, só se a Task 11 provar o contrário.
- `ChaveSugestaoBodySchema` é `.strict()` e compartilhado por confirmar/copiar-linha; `rejeitar` estende-o. O campo `reconheceAvisos` entra só num schema novo de confirmar (não nos demais).
- `listarSugestoes` pagina em memória com `SUGESTAO_TAMANHO_MAXIMO = 2000` e `contagem` por `ResultadoSugestao`; a tela busca tudo numa chamada. Com N = 3 por título a lista passaria do teto (~1,1 mil títulos × 3) ⇒ listagem passa a **uma linha por título**, candidatos completos por rota de detalhe.
- Cache (`SugestaoBoletoCache`, single-flight, TTL 30 s) guarda `CenarioSugestoes`; o formato do cenário muda, a invalidação não.
- Frontend: `src/frontend/lib/sispag.ts` valida a resposta com Zod e tem enum fechado `SINAIS_SUGESTAO_BOLETO`; sinal novo desconhecido **quebra o parse** da tela inteira se não for incluído. `TEXTO_SINAL` e `TIER_ROTULO` são `Record` exaustivos em `sugestaoBoleto.ts`. `resumoDoTitulo` hoje devolve `ORFA | CONFIRMADA | DISPONIVEL | INFORMATIVA`.
- Passo 2: `VinculoCodigoBarrasService` + `ElegibilidadeVinculoCodigoBarras` (já na branch) recalculam o tier por `RegraSugestaoBoleto.avaliar` e comparam `deltaDias` (`DATA_ANTES_DO_TITULO` para < 0). Não leem sinais.
- Jobs somente leitura ficam em `src/backend/jobs/` (precedente `probe-prd-readonly-permissao-fin015.ts`, `validate-sispag-sugestao-boleto-dda-v1.ts`). O motor é puro; a medição usa repositórios (`TituloAPagarRepository.listAtivos`, `BoletoDdaRepository.listBoletos`, decisões) + motor, **sem** `LogService`, **sem** client do ERP.

## Ground-truth plan

**Status: SEM escrita no ERP; validação por medição.** Não há comparação com o Conexos (tela pura de evidência). Critério de aceite empírico = Task 1 (antes) e Task 16 (depois): sobre o mesmo Postgres de PRD (leitura), 100 % dos títulos BOLETO elegíveis sem DDA têm desfecho; `SO_FRACA` não é maioria silenciosa. `GroundTruthValidator` contra Conexos **não se aplica** (nenhum campo monetário novo é derivado do ERP).

## Task list

### Task 1: Medição de linha de base (somente leitura) — antes de qualquer mudança no motor
**Files to change:**
- `src/backend/jobs/medir-desfecho-sugestao-boleto.ts` (novo; job somente leitura)
- `src/backend/jobs/medir-desfecho-sugestao-boleto.test.ts` (novo; teste com repositórios fake)
- `ontology/_inbox/sispag-sugestao-para-todo-titulo-medicao.md` (resultado "antes")

**Acceptance criteria:**
- [ ] Testes primeiro: com fakes, o job calcula (a) nº de títulos elegíveis (BOLETO, ativo, não pago, `tem_boleto != true`, com vencimento), (b) nº com ao menos uma linha de sugestão (comportamento do motor **atual**), (c) nº sem linha; imprime contagem por resultado (`CONHECIDO/FORTE/ATENCAO/VENCIDO_INFORMATIVO/CONFIRMADA/ORFA`)
- [ ] Só `SELECT` via repositórios existentes; nenhum `INSERT/UPDATE/DELETE`, nenhuma chamada de client do ERP, nenhum `LogService` que grave; teste afirma que o container do job não resolve `ConexosClient`
- [ ] Saída sem barras nem linha digitável (só chave do título, situação, máscara do emissor); lê `databaseConnectionString` do `.env` local e **aborta** se apontar para banco que não seja o esperado (flag explícita `--alvo=prd|local`)
- [ ] Registra `sincronizadoEm` do pool e a data/hora da execução (para comparar com a Task 16 sobre o mesmo snapshot)
- [ ] Executado **neste commit base** (antes das Tasks 4–5) contra PRD somente leitura e o resultado "antes" gravado no `.md` de medição (esperado ~7 de 14 na grade do caso real)
- [ ] `typecheck` e Biome ok

**Dependencies:** none

---

### Task 2: RED — sinal `VENCE_ANTES_DO_TITULO` e `diasVencidoNoDebito` na regra pura (I15o)
**Files to change:**
- `src/backend/domain/service/sispag/RegraSugestaoBoleto.test.ts`

**Acceptance criteria:**
- [ ] Δdias = −1, −8: `sinais` contém `VENCE_ANTES_DO_TITULO`; Δdias = 0, +1, +5: não contém
- [ ] Caso A (boleto < débito): `resultado = VENCIDO_INFORMATIVO` (inalterado), `confirmavel = false`, sinal presente, `diasVencidoNoDebito = débito − vencimento do boleto` (ex.: 3)
- [ ] Caso B (boleto ≥ débito, Δ < 0, débito antecipado): `resultado = ATENCAO` (inalterado), sinal presente, `diasVencidoNoDebito = 0`
- [ ] Sinal **não altera** tier, `deltaValor`, `deltaPercentual`, `confirmavel` nem o conjunto dos demais sinais (teste compara a avaliação com o sinal removido contra a baseline anterior)
- [ ] Fora do envelope (`SEM_RELACAO`) **não** emite o sinal (ver pergunta Q3)
- [ ] Datas civis UTC meia-noite: fixture com offset São Paulo não desloca o dia
- [ ] Os testes **falham** antes da Task 3 (RED comprovado)

**Dependencies:** none

---

### Task 3: Interface + regra: tipos novos e sinal
**Files to change:**
- `src/backend/domain/interface/sispag/SugestaoBoleto.ts`
- `src/backend/domain/service/sispag/RegraSugestaoBoleto.ts`

**Acceptance criteria:**
- [ ] `SITUACAO_SUGESTAO_TITULO` = `UNICA_SEGURA, AMBIGUA, SO_ATENCAO, SO_FRACA, SO_VENCIDA, DISPUTADA, SEM_CANDIDATO, CONFIRMADA, ORFA` (constante tipada, nunca string crua); `SUGESTAO_TOP_CANDIDATOS = 3` com comentário "limite de exibição, não regra de domínio"
- [ ] `SINAL_SUGESTAO` ganha `VENCE_ANTES_DO_TITULO` e `RECONHECEU_VENCE_ANTES`; `AvaliacaoSugestao` ganha `diasVencidoNoDebito: number` (derivado, nunca persistido)
- [ ] Novos tipos: `CandidatoTitulo` (boleto + avaliação + `ancorado`, `confirmavel`, `compartilhado?`, `reservadoParaTitulo?`, `motivo`), `DesfechoTitulo` (`situacao`, `candidatos[≤N]`, `totalCandidatos`, `motivo`), `ListagemSugestoes.contagemSituacao`
- [ ] Task 2 verde; regra continua pura, sem I/O; `confirmavel` da regra permanece como está (a trava do fraco é do motor/serviço)
- [ ] Nenhum campo de barras/linha digitável nos tipos de view (I15k)
- [ ] `typecheck` e Biome ok

**Dependencies:** Task 2

---

### Task 4: RED — motor: exibível ≠ confirmável, top-N, AMBIGUA, DISPUTADA, SEM_CANDIDATO, fraco não reserva (I15m, I15n)
**Files to change:**
- `src/backend/domain/service/sispag/MotorSugestaoBoleto.test.ts`

**Acceptance criteria:**
- [ ] **Todo título elegível produz exatamente um desfecho** (propriedade: `desfechos.length === elegiveis.length` para fixtures com 0, 1 e N candidatos); nunca boleto inventado
- [ ] `UNICA_SEGURA` e `SO_ATENCAO` (com âncora) e `CONFIRMADA`/`ORFA` reproduzem **byte a byte** a saída atual (teste de regressão com as fixtures existentes)
- [ ] `SO_FRACA`: ATENCAO sem âncora vira desfecho com `confirmavel = false` e rótulo de "sem confirmação", Δvalor/Δdias com sinal; casos reais: Δ +R$ 3 … +R$ 526, abaixo −R$ 9,49, igual com +8 d
- [ ] `AMBIGUA`: 2+ seguros de mesma força listados ranqueados, todos `confirmavel = false`, `totalCandidatos` correto; após rejeitar um (decisão `REJEITADA` na entrada), o restante vira `UNICA_SEGURA` confirmável
- [ ] `CONHECIDO` ainda vence `FORTE` (não é ambíguo; comportamento atual preservado)
- [ ] `DISPUTADA`: o perdedor de Q-D vê o boleto com `reservadoParaTitulo` do vencedor; **nunca** `SEM_CANDIDATO` por ter perdido disputa (I15n); regra de precedência conforme resposta da Q1
- [ ] Fraco e `VENCIDO_INFORMATIVO` **não reservam**: o mesmo boleto aparece em dois títulos com `compartilhado = true` e não rouba boleto de seguro/ancorado de outro título
- [ ] `SEM_CANDIDATO` só quando nenhum boleto livre dentro do envelope (R$ 10 ou 2 %, ±10 d); candidato fora do envelope **não** aparece (I15f: número igual não resgata)
- [ ] Top-N = 3 retido por inserção ordenada; ordem: força → |Δvalor| → |Δdias| → `ddcCod/ditCod`; **teste de permutação da entrada** (embaralhar títulos e boletos não muda o resultado)
- [ ] Item exibido sem âncora/ambíguo/disputado/vencido tem `confirmavel = false` mesmo que `RegraSugestaoBoleto` diga `true` para o tier
- [ ] Desempenho: fixture de 1,1 mil títulos × 8,8 mil boletos conclui dentro de orçamento definido no teste (sem varredura nova do pool)
- [ ] Os testes **falham** antes da Task 5

**Dependencies:** Task 3

---

### Task 5: Motor implementado
**Files to change:**
- `src/backend/domain/service/sispag/MotorSugestaoBoleto.ts`

**Acceptance criteria:**
- [ ] Task 4 verde; motor continua puro, sem relógio, sem mutar a entrada; classe exportada, métodos arrow, modificadores explícitos
- [ ] `aceita` deixa de decidir confirmabilidade: separa `exibivel` (dentro do envelope e não rejeitado) de `confirmavel`; candidatos fracos entram na lista, não em reserva
- [ ] `camadaSegura` devolve desfecho `AMBIGUA` em vez de `continue` silencioso; título perdedor de disputa é reavaliado e, se só restar boleto reservado, vira `DISPUTADA`
- [ ] Contrato antigo (`SugestaoBoletoTitulo[]`) preservado como projeção dos confirmáveis/confirmadas/órfãs para compatibilidade
- [ ] Docblock do motor atualizado (algoritmo, decisão "sem sugestão" substituída, ADR-0072)
- [ ] `typecheck`, Biome e testes do motor verdes

**Dependencies:** Task 4

---

### Task 6: Não-regressão do passo 2 (I17a/I17c) — mesmo conjunto vinculável antes e depois
**Files to change:**
- `src/backend/domain/service/sispag/VinculoCodigoBarrasService.test.ts` (acrescentar casos)
- `src/backend/domain/libs/boleto/ElegibilidadeVinculoCodigoBarras.test.ts` (acrescentar casos)

**Acceptance criteria:**
- [ ] Teste de conjunto fixo: dado o mesmo conjunto de decisões `CONFIRMADA` + pool + abertos, o conjunto de itens "vinculáveis" no `shadow` é **idêntico** com o motor antigo (golden gravado do commit base) e o novo
- [ ] Decisão com Δdias < 0 permanece `INELEGIVEL` com motivo `DATA_ANTES_DO_TITULO`; o motivo do `shadow`/`vinculos-previstos` cita `VENCE_ANTES_DO_TITULO` só no texto (nota I17c), sem mudar o código do motivo
- [ ] Teste afirma que o passo 2 **não importa** situação, âncora nem `RECONHECEU_VENCE_ANTES` (nenhuma leitura desses campos; decisão com o sinal no snapshot elegível exatamente como sem ele)
- [ ] Candidato exibido sem âncora/ambíguo/disputado não gera decisão (impedido por `confirmavel = false` — coberto na Task 8)
- [ ] Nenhuma mudança em `ModoVinculoCodigoBarras`, flags nem migrations do passo 2

**Dependencies:** Task 5

---

### Task 7: Erro nomeado `WarningAcknowledgementRequiredError` + schema do body
**Files to change:**
- `src/backend/domain/errors/WarningAcknowledgementRequiredError.ts` (novo)
- `src/backend/domain/errors/BoletoSuggestionErrors.test.ts`
- `src/backend/domain/interface/sispag/SugestaoBoletoSchemas.ts` (+ teste do schema)

**Acceptance criteria:**
- [ ] Testes primeiro; `statusCode = 422`, `code = 'RECONHECIMENTO_DE_AVISO_OBRIGATORIO'`, `retryable = false`; `message` em inglês, `userMessage` em pt-BR com o texto do aviso (datas e dias de atraso no débito) e a frase "confirme o vencimento no portal do banco"
- [ ] `ConfirmarSugestaoBodySchema = ChaveSugestaoBodySchema.extend({ reconheceAvisos: z.array(z.enum([...])).max(...).default([]) }).strict()`; "ator" no body continua 400; `reconheceAvisos` desconhecido é 400; os demais schemas (rejeitar/copiar) **não** aceitam o campo
- [ ] `SugestoesQuerySchema` ganha `situacao` (nativeEnum) sem quebrar `tier`
- [ ] Novo schema do detalhe por título (`filCod`, `docCod`, `titCod`)

**Dependencies:** Task 3

---

### Task 8: RED — serviço: listagem por título, detalhe sob demanda, ack no servidor, 409 para não confirmável novo
**Files to change:**
- `src/backend/domain/service/sispag/BoletoSuggestionService.test.ts`

**Acceptance criteria:**
- [ ] Listagem: `titulos[]` com **uma linha por título elegível** (melhor candidato, `situacao`, `totalCandidatos`, `avisoVenceAntes: NENHUM|ATENCAO|CRITICO`, `diasVencidoNoDebito`); `contagemSituacao` soma = nº de títulos; `sugestoes[]` antigo preservado; `sincronizadoEm` e `ddaDefasadoHoras` presentes (base do texto "sem candidato no pool de há N h")
- [ ] Teto: 1,1 mil títulos produzem 1,1 mil linhas (< 2000); acima do teto o aviso de truncamento existente continua
- [ ] Detalhe por título: devolve até N candidatos com Δ com sinal, emissor mascarado, `compartilhado`/`reservadoParaTitulo`; título sem desfecho elegível ⇒ 404 nomeado; **sem** barras nem linha digitável (snapshot de chaves)
- [ ] Confirmar `SO_FRACA`/`AMBIGUA`/`DISPUTADA`/`SO_VENCIDA` ⇒ 409 `BoletoSuggestionNotAvailableError` com o motivo da situação; **nenhuma** decisão/par gravado (assert no repositório fake)
- [ ] Confirmar caso B (Δ < 0, boleto ≥ débito, ancorado) **sem** `reconheceAvisos` ⇒ 422 `WarningAcknowledgementRequiredError`, nada gravado; **com** ack ⇒ 201, snapshot `sinais` contém `VENCE_ANTES_DO_TITULO` e `RECONHECEU_VENCE_ANTES`, evento `DECISAO_CONFIRMADA.detalhe` registra o reconhecimento
- [ ] Ack é conferido contra avaliação **recalculada** no servidor: enviar ack para candidato sem o sinal é aceito mas **não** grava `RECONHECEU_VENCE_ANTES` (nada a reconhecer); enviar o ack e o servidor reavaliar com sinal novo (mudança de lote) ⇒ recalcula, nunca confia no cache
- [ ] Caso A (boleto < débito) continua 422 `OverdueBoletoNotConfirmableError` mesmo **com** ack (I15h inalterado)
- [ ] Idempotência: reconfirmar decisão já existente devolve `criada:false` sem exigir ack
- [ ] Rejeitar continua funcionando para candidatos de `AMBIGUA` (e conforme Q2 para os demais); `anular`/`copiarLinha` inalterados
- [ ] Log `sugestao_boleto.cenario_calculado` ganha contagem por situação; sem barras
- [ ] Os testes **falham** antes da Task 9

**Dependencies:** Tasks 5, 7

---

### Task 9: Serviço implementado
**Files to change:**
- `src/backend/domain/service/sispag/BoletoSuggestionService.ts`
- `src/backend/domain/service/sispag/SugestaoBoletoCache.ts` (só se o formato do cenário exigir; TTL/invalidations intactos)

**Acceptance criteria:**
- [ ] Task 8 verde; `confirmar` aplica as travas na ordem: idempotência → disponibilidade (409) → vencido (422 I15h) → ack (422) → transação
- [ ] Fraco/ambíguo/disputado recusados **no serviço**, independentemente do `confirmavel` da regra pura
- [ ] Filtros de filial/credor/situação aplicados depois do cache (como hoje); confirmar/rejeitar/anular continuam relendo o banco ao vivo (anti-TOCTOU)
- [ ] Nenhuma gravação nova fora de `sinais` (JSONB) e `detalhe` do evento; sem coluna nova
- [ ] Logs em pt-BR; sem barras nem linha digitável
- [ ] Se `BoletoSuggestionService.ts` ultrapassar ~1000 linhas, extrair a montagem de desfecho para classe própria `@injectable()` (decisão do implementador)
- [ ] `typecheck`, Biome, testes verdes

**Dependencies:** Task 8

---

### Task 10: Rotas — detalhe por título, filtro `situacao`, body de confirmar
**Files to change:**
- `src/backend/routes/sispag.ts`
- `src/backend/routes/sispag.test.ts` (ou o arquivo de teste de rotas de sugestão existente)

**Acceptance criteria:**
- [ ] Testes primeiro: `GET /sispag/sugestoes-boleto/titulo?filCod&docCod&titCod` (`SISPAG_VER`, `Cache-Control: no-store`, 404 nomeado); `GET /sispag/sugestoes-boleto?situacao=` filtra; `POST .../confirmar` aceita `reconheceAvisos`, 422 sem ele no caso B, 409 para não confirmável novo
- [ ] Permissões inalteradas (sem permissão nova); rate limiter de confirmar mantido
- [ ] Snapshot de chaves da resposta: sem linha digitável/barras
- [ ] Compatibilidade: cliente antigo (sem `titulos[]` / sem `reconheceAvisos`) continua válido onde não há aviso

**Dependencies:** Task 9

---

### Task 11: Repositório — provar que `sinais` aceita os valores novos sem migration
**Files to change:**
- `src/backend/domain/repository/sispag/SugestaoBoletoRepository.test.ts`
- `src/backend/domain/repository/sispag/SugestaoBoletoRepository.integration.test.ts`

**Acceptance criteria:**
- [ ] Teste unitário: `inserirDecisao` com `sinais` contendo `VENCE_ANTES_DO_TITULO` e `RECONHECEU_VENCE_ANTES` serializa JSONB e a leitura (`listarChaveadas`, `listarDecisoes`) devolve os mesmos valores
- [ ] Teste de integração (Postgres de teste): INSERT/SELECT com os dois valores novos; decisão legada sem os sinais continua legível
- [ ] **Conclusão registrada no PR:** sem migration. Se o teste de integração mostrar qualquer CHECK/enum, criar `0087_*` aditiva, idempotente, copiada ao `dist` (paridade `copy-to-dist`, incidente 2026-09-23) e reconferir o número livre em `origin/main`
- [ ] Decisão `ORFA` legada (sem o sinal) exibe o aviso derivando de `deltaDias < 0` (não do sinal gravado)

**Dependencies:** Task 3

---

### Task 12: RED + GREEN — contrato do frontend (`lib/sispag`)
**Files to change:**
- `src/frontend/lib/sispag.ts`
- `src/frontend/lib/sispag.sugestaoBoletoApi.test.ts`
- `src/frontend/lib/sispag.sugestaoBoleto.test.ts`

**Acceptance criteria:**
- [ ] Testes primeiro: Zod aceita `titulos[]`, `contagemSituacao`, `situacao`, `avisoVenceAntes`, `totalCandidatos`; `SINAIS_SUGESTAO_BOLETO` inclui os dois sinais novos (resposta com sinal novo **não** quebra o parse da lista inteira)
- [ ] `confirmarSugestaoBoleto` envia `reconheceAvisos`; função de API do detalhe por título; filtro `situacao`
- [ ] Resposta antiga (sem campos novos) ainda é aceita onde o campo é opcional

**Dependencies:** Task 10

---

### Task 13: Frontend — textos, rótulos e badge
**Files to change:**
- `src/frontend/app/sispag/components/sugestaoBoleto.ts` (+ teste)
- `src/frontend/app/sispag/components/FormaPagamentoBadge.tsx` (+ teste)

**Acceptance criteria:**
- [ ] `TEXTO_SINAL` ganha `VENCE_ANTES_DO_TITULO` (`atencao: true`) e `RECONHECEU_VENCE_ANTES`; `ROTULO_SITUACAO` exaustivo: `UNICA_SEGURA` "sugestão disponível", `SO_ATENCAO` "ver boleto sugerido", `AMBIGUA` "mais de um boleto possível", `SO_FRACA` "ver candidato (sem confirmação)", `DISPUTADA` "boleto reservado a outro título", `SO_VENCIDA` "ver boleto vencido", `SEM_CANDIDATO` "sem boleto no pool"
- [ ] Fraco **nunca** usa "sugestão disponível" nem verde; tom `muted`/`warning`
- [ ] `mensagemVenceAntes(candidato)` com os textos dos casos A e B (datas formatadas, dias de atraso no débito, "confirme no portal do banco"), sem mensagem inventada para Δ ≥ 0
- [ ] Badge: prop `sugestao` vira `{ situacao, avisoVenceAntes, total }`; chip `AlertTriangle` + texto + `sr-only` (cor nunca é o único canal); `SEM_CANDIDATO` não é botão quando o painel só mostraria o texto
- [ ] Testes de renderização por situação e por aviso; `resumoDoTitulo` atualizado sem regressão dos casos existentes

**Dependencies:** Task 12

---

### Task 14: Frontend — painel, diálogo de reconhecimento, filtro por situação, aba Boletos DDA
**Files to change:**
- `src/frontend/app/sispag/components/SugestaoBoletoPainel.tsx` (+ teste)
- `src/frontend/app/sispag/components/ReconhecerAvisoDialog.tsx` (novo, + teste) — ou extensão de `MotivoDecisaoDialog` se for o padrão
- `src/frontend/app/sispag/components/BoletosDdaTab.tsx` (+ teste)
- `src/frontend/app/sispag/page.tsx`

**Acceptance criteria:**
- [ ] Painel lista até 3 candidatos com situação e motivo ("mais de um candidato", "sem confirmação do emissor ou do número", "reservado ao título <doc>"); "mostrando 3 de N"; Δ grande mostra ordem de grandeza (`formatDeltaPercentual`)
- [ ] `SEM_CANDIDATO`: texto "Nenhum boleto no pool DDA dentro do envelope (±R$ 10,00 ou 2 %, ±10 dias)" + hora da última sincronização (e "no pool de há N h" quando defasado) + atalho para "Boletos DDA"
- [ ] Botão Confirmar **ausente** para não confirmável, com "Confirmar indisponível: <motivo>"; ambíguo oferece "Rejeitar" nos demais
- [ ] Caso B: Confirmar abre diálogo com checkbox obrigatório (texto da proposta §3.4); botão só habilita marcado; envia `reconheceAvisos`; erro 422 do servidor exibido; foco no diálogo; caso A sem botão
- [ ] Sem sinal: fluxo atual (sem diálogo) inalterado
- [ ] `page.tsx`: filtro por situação com contagem (`contagemSituacao`) e aviso de truncamento mantido
- [ ] Aba "Boletos DDA": rótulo de aviso quando Δdias < 0
- [ ] Fixtures com os 14 casos reais (igual +8 d, acima +R$ 3…+R$ 526, abaixo −R$ 9,49)
- [ ] `npm run lint`, `typecheck` e testes do frontend verdes (o gate é `npm run lint`, não Prettier)

**Dependencies:** Task 13

---

### Task 15: DesignSystemReviewer gate (frontend tocado)
**Files to change:**
- (nenhum; revisão de `src/frontend/app/sispag/components/*` e `page.tsx`)

**Acceptance criteria:**
- [ ] DesignSystemReviewer executado sobre o delta do frontend: tokens, acessibilidade (`role="status"`, `sr-only`, foco no diálogo, contraste do chip), composição
- [ ] P0 remediados; P1+ em `ontology/_inbox/sispag-sugestao-para-todo-titulo-regis-followups.md`

**Dependencies:** Task 14

---

### Task 16: Medição "depois" em PRD somente leitura (critério de aceite da P1-7)
**Files to change:**
- `src/backend/jobs/medir-desfecho-sugestao-boleto.ts` (estender para o motor novo)
- `src/backend/jobs/medir-desfecho-sugestao-boleto.test.ts`
- `ontology/_inbox/sispag-sugestao-para-todo-titulo-medicao.md` (resultado "depois" e comparação)

**Acceptance criteria:**
- [ ] Mesmo job (somente leitura, sem ERP, sem log gravável) roda o motor novo e imprime contagem por `SituacaoSugestaoTitulo`
- [ ] Execução "antes" (Task 1, código base) e "depois" sobre o **mesmo snapshot**: registrar `sincronizadoEm` de ambas; se divergirem, reexecutar o "antes" no commit base (git worktree de `origin/main`) na mesma janela
- [ ] **Resultado esperado: 100 % dos títulos elegíveis têm desfecho** (`sem desfecho = 0`); soma de `contagemSituacao` = nº de títulos elegíveis
- [ ] `SO_FRACA` não é a maioria silenciosa: se > 50 % dos títulos, **parar e abrir pergunta P1 ao maintainer** antes do ship (ruído)
- [ ] Contagem por situação, comparação antes × depois e nº de títulos por filial no `.md` (sem barras nem linha digitável)
- [ ] Linha de log `sugestao_boleto.cenario_calculado` com contagem por situação confere com o job

**Dependencies:** Tasks 9, 10

---

### Task 17: Higiene de ontologia, versão e ship
**Files to change:**
- `ontology/_index.json`, `ontology/_coverage.json` (I15m–o `planned` → `implemented`, ontologia 0.43.0)
- `ontology/_inbox/_watchlist.md` (C4, C6, C13, C17 já registradas; conferir)
- `CHANGELOG.md`, `src/backend/package.json`, `src/frontend/package.json` (bump FE==BE)
- `docs-contexto/03_ontologia_financeiro.md` e `CLAUDE.md` (só se citarem a regra "ambiguidade ⇒ sem sugestão")

**Acceptance criteria:**
- [ ] Reconferir `origin/main` imediatamente antes do bump: versão do app (hoje 0.68.1), número do ADR (0072) e versão da ontologia (0.43.0); versões e CHANGELOG colidem entre sessões paralelas (rebase, nunca merge)
- [ ] Bump semver lockstep aplicado **à mão** nos dois `package.json` (sem `pwsh` nesta máquina) + `CHANGELOG.md`; commit `chore(release): vX.Y.Z`
- [ ] `docs-contexto/03_ontologia_financeiro.md`: contagem de invariantes conferida
- [ ] Regis-Review reduzido (delta + QAs de risco: performance, security/auditoria do ack, testability); P0 remediados, P1/P2/P3 → follow-ups em `_inbox`

**Dependencies:** Tasks 15, 16

---

## Plano de testes (resumo)

| Camada | O que prova | Onde |
|--------|-------------|------|
| Regra pura | sinal Δ<0, `diasVencidoNoDebito`, casos A/B, sem efeito em tier | Task 2–3 |
| Motor | desfecho único por título, top-N, ambíguo/disputado/fraco, permutação, não-reserva, desempenho | Task 4–5 |
| Não-regressão passo 2 | mesmo conjunto vinculável (shadow) antes/depois; Δ<0 `INELEGIVEL` | Task 6 |
| Serviço/rota | 409 não confirmável, 422 ack, 422 vencido com ack, idempotência, sem barras | Task 8–10 |
| Persistência | `sinais` JSONB aceita valores novos, sem migration | Task 11 |
| Frontend | contrato Zod, rótulos exaustivos, diálogo de ack, 14 casos reais, a11y | Task 12–15 |
| Empírico | PRD somente leitura antes × depois, 100 % com desfecho | Task 1, 16 |

## Perguntas abertas (P1; padrão aplicado se não houver resposta)

- **Q1 — Precedência de `DISPUTADA`:** a tabela da proposta coloca `DISPUTADA` abaixo de `SO_FRACA`/`SO_VENCIDA`, mas I15n diz "o título que perdeu a disputa mostra o boleto como `DISPUTADA`" e o texto fala em "melhor candidato reservado". Se o perdedor tem também um candidato fraco livre, qual situação leva o título? **Padrão proposto:** `DISPUTADA` quando o melhor candidato (por força) é o reservado; os fracos livres aparecem na lista.
- **Q2 — Rejeitar candidato exibido não confirmável:** permitir `rejeitar` para `SO_FRACA`/`DISPUTADA`/`SO_VENCIDA` (esconde o par, ajuda a limpar ruído), ou só para `AMBIGUA`? Hoje `rejeitar` não bloqueia por tier. **Padrão:** permitir para qualquer candidato com boleto, exceto vencido (como a proposta §2.3), com motivo obrigatório.
- **Q3 — Sinal em `SEM_RELACAO`:** `VENCE_ANTES_DO_TITULO` só dentro do envelope (padrão) ou também fora? Fora do envelope não há candidato exibido, então o sinal seria inócuo.
- **Q4 — Filtro de exibição de `SO_VENCIDA`:** `aceita` hoje só mostra vencido com âncora ou |Δvalor| ≤ R$ 0,05; o ADR mede "candidato dentro do envelope para os 14". **Padrão:** exibir todo vencido dentro do envelope (top-N), sempre `confirmavel = false`.
- **Q5 — Ambiguidade entre `ATENCAO` ancorados:** ADR só trata 2+ **seguros**; hoje a camada ATENCAO escolhe o primeiro e reserva. **Padrão:** inalterado (sem `AMBIGUA` para ATENCAO) — confirmar.
- **Q6 — Decisões legadas sem `RECONHECEU_VENCE_ANTES`/`VENCE_ANTES_DO_TITULO` no snapshot:** sem backfill; aviso derivado de `deltaDias < 0`. Confirmar que não é preciso marcar decisões anteriores como "não reconhecidas".
- **Q7 — Hora do sync por linha:** `sincronizadoEm` é global na listagem (não por título). Suficiente para "com sync time" de `SEM_CANDIDATO`? **Padrão:** sim (campo da resposta + `ddaDefasadoHoras`).
- **Q8 — Limiar de ruído da Task 16:** "`SO_FRACA` > 50 % ⇒ parar" é número proposto por este TaskScoper, não do maintainer; confirmar ou trocar.

## Definition of Done

All tasks complete AND:
- [ ] `npm run typecheck` (backend e frontend)
- [ ] `npm run lint` (backend e frontend)
- [ ] `npm test` (backend e frontend)
- [ ] PatternGuardian gate (revisa o arquivo inteiro: conferir achados contra `main` antes de remediar)
- [ ] ontology diff em `ontology/` presente (0.43.0, ADR-0072, I15m–o)
- [ ] DesignSystemReviewer gate (frontend tocado)
- [ ] Medição somente leitura "depois" registrada: 100 % dos títulos elegíveis com desfecho (Task 16)
- [ ] Não-regressão do passo 2 verde (Task 6)
- [ ] Nenhuma migration, ou `0087` aditiva com paridade de build e número reconferido
- [ ] ObservabilityAdvisor: **não aplicável** (sem handler/job novo em produção; o job de medição é script manual)
- [ ] AwsInfraArchitect: **não aplicável** (sem `infra/`)
- [ ] Regis-Review reduzido ran; P0 remediados; P1/P2/P3 em `_inbox`
- [ ] Rebase de `main` sem conflito pendente
- [ ] App version bumped (FE+BE lockstep) à mão + `CHANGELOG.md` (delta tem `feat` em `src/`)
