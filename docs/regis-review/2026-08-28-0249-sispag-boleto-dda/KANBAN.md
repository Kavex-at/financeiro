---
type: regis-review-kanban
run_id: 2026-08-28-0249-sispag-boleto-dda
generated_at: 2026-08-28T02:49:00Z
total_pre_dedupe: 37
total: 31
counts: { p0: 0, p1: 5, p2: 19, p3: 7 }
resolved_post_review: [security-1, security-2]
open: 29
dedupe_notes: 10 cards fundidos em 4 (ver REPORT §4).
---

# Kanban — financeiro — 2026-08-28-0249-sispag-boleto-dda

> Ordem: P0 → P1 → P2 → P3; dentro de cada prioridade S → M → L → XL.
> `[DELTA]` = dívida introduzida pelo commit 5978ac5. `[HERDADA]` = dívida pré-existente
> que o delta tornou mais visível. `[MIXED]` = parte de cada.
> ✅ **RESOLVIDO** = já implementado no commit `5558cf8`, mantido aqui como registro.

---

## P0 — Crítico

**Nenhum.** O gate do `/feature-tweak` passa sem re-loop.

---

## P1 — Alto

### [security-1] [DELTA] ✅ RESOLVIDO — Emitir `BUSINESS_INFO` a cada auto-resposta ao ERP

**QA** Security · **Tactic** Audit Trail · **Esforço** S · **Findings** F-security-1

- **Problema** — `importarTitulos` respondia `YES` sozinho à pergunta do ERP num fluxo
  que termina em `.REM` bancária, sem rastro auditável. T1 do `tasks.md` previa o log;
  não foi implementado (`grep -c 'LogService'` = 0). Em incidente pós-morte, não era
  possível reconstituir qual `docCod/titCod`/`flpCod` recebeu auto-resposta.
- **Melhoria Proposta** — injetar `LogService` e emitir `BUSINESS_INFO` antes do re-POST.
- **Resultado Esperado** — 100% das auto-respostas registradas e correlacionáveis.
- **Métricas** — auto-respostas registradas: 0/N → N/N · `grep -c 'logService'`: 0 → 1
- **Risco de não fazer** — auditoria/compliance sem prova local da decisão automatizada.
- **Resolução** — commit `5558cf8`: log com `pergunta`, `questionId`, `filCod`, `bncCod`,
  `flpCod` e títulos; 2 testes (loga quando houve pergunta, não loga quando não houve).

### [deployability-1] [DELTA] Toggle por-comportamento para o caminho de associação DDA

**QA** Deployability · **Tactic** Feature Toggle; Roll Back · **Esforço** S ·
**Findings** F-deployability-1, F-deployability-5

- **Problema** — o caminho DDA não tem gate próprio. Um bug específico dele só pode ser
  contido matando 100% das escritas SISPAG (`SISPAG_LIVE_WRITE_ENABLED=false`), que
  derruba remessa PIX/TED e conciliação. Blast-radius: 100% vs. ~31–35% dos itens reais.
- **Melhoria Proposta** — `SISPAG_DDA_ASSOC_ENABLED` no `EnvironmentProvider`;
  curto-circuitar `associarDda = false` quando desligado (o `BoletoSemCodigoBarrasError`
  continua barrando o envio). Render `sync:false` para flippar sem redeploy.
- **Resultado Esperado** — rollback do DDA sem afetar PIX/TED/conciliação.
- **Métricas** — blast-radius: 100% → ~35% · tempo de contenção: 5–10 min (redeploy) → <1 min (flip)
- **Risco de não fazer** — no primeiro incidente, escolher entre parar a folha inteira
  ou reverter um commit grande com fixes concorrentes.

### [integrability-2] [DELTA] Zod estrito para `titVldReflexoDdaAssoc` no boundary

**QA** Integrability · **Tactic** Tailor Interface · **Esforço** S · **Findings** F-integrability-3

- **Problema** — `paraTituloPendente` coage `Number(r.titVldReflexoDdaAssoc ?? 0) === 1`
  sem Zod. Se o Conexos renomear o campo, degrada silenciosamente para `false` em 100%
  dos títulos — a mesma classe do bug do `titEspCodbar` que esta feature resolve.
  (Atenuante: o modo de falha agora é fail-closed, não fail-open.)
- **Melhoria Proposta** — `TITULO_PENDENTE_SCHEMA` com
  `titVldReflexoDdaAssoc: z.union([z.literal(0), z.literal(1)])`; `safeParse` falho ⇒
  `ConexosError` com endpoint. Métrica agregada `boleto_dda_flag_rate` por filial.
- **Resultado Esperado** — mudança silenciosa do wire vira falha explícita na ingestão.
- **Métricas** — Zod schemas cobrindo `TituloPendente`: 0 → 1 · alerta se a taxa cair a 0: ausente → presente
- **Risco de não fazer** — reintrodução do defeito histórico pela mesma causa raiz.

### [performance-1] [DELTA] Reutilizar `titulo_a_pagar.tem_boleto` no painel

**QA** Performance · **Tactic** Maintain Multiple Copies of Data · **Esforço** S ·
**Findings** F-performance-1, F-performance-2

- **Problema** — `modalidadesDisponiveisDoLote` refaz `listContasCorrentes` +
  `listarLotesNativos` + `listarTitulosPendentes` paginado por filial a cada abertura.
  +7 req para lote da fil 2; +10 para misto 2+6. O valor já está persistido (≤ 24 h).
- **⚠️ Decisão de negócio, não defeito** — a leitura ao vivo foi escolha explícita do
  Yuri ("nos dois lugares"), coerente com a doutrina anti-drift. Este card é o
  contra-argumento numérico; a decisão é de quem tem o contexto.
- **Melhoria Proposta** — derivar `comBoleto` do repositório; manter a leitura ao vivo
  APENAS em `RemessaService.montarItensImport` (caminho de escrita).
- **Resultado Esperado** — 0 req Conexos por abertura de painel para saber "tem boleto?".
- **Métricas** — req/abertura (fil 2): 7 → 0 · (misto 2+6): 10 → 0 · freshness: ≤ 24 h
- **Risco de não fazer** — latência do painel cresce com a carteira e com nº de filiais.

### [sispag-question-wire-contract] [DELTA] Fixture cru do envelope `QUESTION` + trancar `answers`

**QA** Integrability + Testability (deduplicado) · **Tactic** Contract testing;
Record/Playback · **Esforço** S (≤2h — a sonda já existe) ·
**Cards de origem** integrability-1, testability-3 · **Findings** F-integrability-1, F-testability-3

- **Problema** — o contrato `answers: Map<String,String>` chaveado pelo `id` foi
  descoberto por engenharia reversa. O único registro é prosa em
  `ontology/integrations/conexos.md` e um shape SINTETIZADO inline no teste. Um upgrade
  que mude `answers` → `answer` (ou `id` → `questionId`) mantém o CI verde.
  `QUESTION_SCHEMA.id` é `.optional()`.
- **Melhoria Proposta** — (a) capturar o envelope real em
  `__fixtures__/2026-08-27-fin015-question-barcode.json` a partir de
  `probe-dda-answer-shape-hml.ts`; (b) estender `contrato.test.ts`; (c) endurecer
  `QUESTION_SCHEMA` (`id` obrigatório, `answerList` obrigatório); (d) teste que
  serializa e valida `{ answers: { "1": "YES" } }` no wire.
- **Resultado Esperado** — alteração unilateral do Conexos falha o CI, não o banco.
- **Métricas** — fixtures do envelope: 0 → ≥1 · `id` obrigatório: false → true ·
  campos cobertos por `contrato.test.ts`: 0 → 4
- **Risco de não fazer** — regressão silenciosa no caminho de pagamento.

---

## P2 — Médio

### [testability-1] [DELTA] Asserção negativa: boleto DDA não leva `pctCodSeq`/`conta`

**QA** Testability · **Tactic** Executable Assertions · **Esforço** S (≤1h) · **Findings** F-testability-1

- **Problema** — o teste de boleto DDA asserta `associarDda:true` mas não prova que o
  payload OMITE `pctCodSeq`/`itsNumBanco`/`conta`/`agencia`. Reverter a guarda
  `!associarDda` passaria pelo CI verde.
- **Melhoria Proposta** — `expect(payload.itens[0]).not.toHaveProperty('pctCodSeq')` etc.,
  mais `expect(sispag.listContasFavorecido).not.toHaveBeenCalled()`.
- **Resultado Esperado** — regressão pega em `npm test`, sem depender de HML.
- **Métricas** — asserções negativas: 0 → 3 · `not.toHaveBeenCalled` no caminho boleto: 0 → 1
- **Risco de não fazer** — refactor de "unificar caminhos" reintroduz campos que o
  ADR-0040 diz não deverem ir.

### [testability-2] [DELTA] Teste do re-POST com falha não-QUESTION

**QA** Testability · **Tactic** Executable Assertions · **Esforço** S (≤1h) · **Findings** F-testability-2

- **Problema** — o `catch (causeAposResposta)` só é exercido com QUESTION repetida ou
  sucesso. Um 2º POST devolvendo `VALIDATION_LIST` ou 500 está correto por inspeção,
  sem teste.
- **Melhoria Proposta** — 2 casos: 2º POST com `VALIDATION_LIST` ⇒ `ConexosError` com a
  msg do ERP; 2º POST com erro axios sem `response.data` ⇒ `ConexosError` genérico.
- **Resultado Esperado** — contrato "sempre sobe como `ConexosError`" protegido.
- **Métricas** — testes do 2º POST com erro não-QUESTION: 0 → 2
- **Risco de não fazer** — refatoração de `toConexosError` altera o tipo que sobe da retomada sem alerta.

### [fault-tolerance-1] [DELTA] Canário runtime antes do re-POST à `QUESTION`

**QA** Fault Tolerance · **Tactic** Sanity Checking · **Esforço** S · **Findings** F-fault-tolerance-1

- **Problema** — o re-POST assume "POST-QUESTION não escreve" a partir de 1 medição HML,
  sem verificação em runtime. Se o edge-case existir em PRD, o item entra duas vezes no
  lote → duas linhas no `.REM` para o mesmo pagamento.
- **Melhoria Proposta** — entre reconhecer a QUESTION e emitir o 2º POST, ler
  `listarChavesDoLote`: se a chave já estiver lá, NÃO re-POSTar (tratar como já
  importado); senão prosseguir. Custo: 1 leitura extra apenas no caminho QUESTION.
- **Resultado Esperado** — 0% de risco de duplicação por generalizar a medição HML.
- **Métricas** — verificações runtime: 0 → 1 por re-POST · testes das duas trilhas: 0 → 1
- **Risco de não fazer** — baixa probabilidade × alto custo (pagamento duplicado),
  detectável só na conciliação bancária dias depois.

### [security-2] [DELTA] ✅ RESOLVIDO — Redigir barcode real de produção da sondagem

**QA** Security · **Tactic** Limit Exposure · **Esforço** S · **Findings** F-security-2

- **Problema** — `sispag-boleto-dda-sondagem.md` continha um barcode de 47 dígitos
  verbatim, codificando banco beneficiário (745), valor, vencimento e nosso-número de um
  pagamento real de um fornecedor da Columbia. Único dado individual do arquivo.
- **Melhoria Proposta** — máscara preservando o banco emissor (que é o ponto do encoding 6×7).
- **Resultado Esperado** — `git grep -E '[0-9]{40,}'` sem hits na ontologia.
- **Métricas** — barcodes reais versionados: 1 → 0
- **Risco de não fazer** — vazamento identifica relação comercial e reconstitui valor/vencimento.
- **Resolução** — commit `5558cf8`: redigido para `745…` com nota explicando o corte.

### [deployability-2] [DELTA] Documentar mudança de semântica de `tem_boleto`

**QA** Deployability · **Tactic** Script Deployment Commands · **Esforço** S · **Findings** F-deployability-2

- **Problema** — `tem_boleto` mudou de fonte sem migration de backfill nem menção em
  `CHANGELOG`/`DEPLOY.md`. Entre o deploy e a próxima rodada do cron, a coluna carrega a
  semântica antiga (tudo `false`) — confundível com "a feature não subiu".
- **Melhoria Proposta** — entrada no CHANGELOG v0.32.0; step opcional
  `npm run job:ingest-pagamentos` logo após o deploy; comentário no repositório de que
  `tem_boleto` é enriquecimento eventualmente-consistente.
- **Resultado Esperado** — janela de inconsistência 24h → 0 (com step) ou explícita.
- **Métricas** — CHANGELOG menciona a janela: presente · step em `DEPLOY.md`: presente
- **Risco de não fazer** — dúvida operacional recorrente pós-deploy.

### [deployability-3] [DELTA] Runbook de cutover do caminho DDA

**QA** Deployability · **Tactic** Script Deployment Commands · **Esforço** S · **Findings** F-deployability-5, F-deployability-1

- **Problema** — o ADR-0040 declara que "a primeira remessa real com boleto deve ser
  acompanhada", mas não há runbook com o procedimento: o que verificar no `.REM`, o que
  fazer se aparecer `ErpPerguntaError`, quando escalar.
- **Melhoria Proposta** — `docs/runbooks/sispag-boleto-dda-cutover.md` no formato do
  `fin010-write-cutover.md`: pré-condições, verificação (segmento J com barras),
  kill-switch, quem chamar (Yuri + Flávia).
- **Resultado Esperado** — MTTR de decisão < 5 min no go-live.
- **Métricas** — runbook presente e linkado do ADR-0040
- **Risco de não fazer** — primeiro incidente vira decisão improvisada (ex.: `git revert`
  do commit inteiro em vez de flip do env).

### [availability-3] [DELTA] Métrica agregada de degradação DDA

**QA** Availability · **Tactic** Monitor · **Esforço** S · **Findings** F-availability-4, F-availability-1

- **Problema** — os 3 WARNs novos do delta só existem no log do Render. O próprio
  comentário do delta admite que "ninguém abre por hábito". MTTD = tempo até a analista
  reclamar.
- **Melhoria Proposta** — contagem por filial × dia persistida, com KPI no painel
  ("filiais com leitura DDA degradada nas últimas 24 h"); ou `LOG_TYPE` novo com filtro.
- **Resultado Esperado** — degradação vira número na tela.
- **Métricas** — canais de detecção: 1 (log) → 2 (log + KPI) · MTTD: → ≤ 1 refresh
- **Risco de não fazer** — incidente do Conexos degrada em silêncio por dias.

### [integrability-4] [DELTA] Endurecer o contexto do grid contra reciclagem de `flpCod`

**QA** Integrability · **Tactic** Manage Resource Coupling · **Esforço** S · **Findings** F-integrability-4

- **Problema** — `listarTitulosComBoletoDda` usa o maior `flpCod` da conta como contexto
  de leitura — e o ERP recicla `flpCod` (migration 0049). Nada valida que o contexto é
  estável entre rodadas.
- **Melhoria Proposta** — preferir lote **finalizado** (`status=1`) como contexto; teste
  de estabilidade entre rodadas com `flpCod` diferente; log do contexto usado por filial.
- **Resultado Esperado** — a coluna Boleto só muda por evento do ERP, não por rascunho
  que a analista mexeu.
- **Métricas** — preferência por `status=1`: implementada · teste de estabilidade: 0 → ≥1
- **Risco de não fazer** — flutuação da coluna entre rodadas; chamado "por que sumiu o boleto?".

### [performance-2] [DELTA] Rebaixar `FANOUT_LIMIT` ou instrumentar o pool Conexos

**QA** Performance · **Tactic** Bound Queue Sizes · **Esforço** S · **Findings** F-performance-3

- **Problema** — a ingestão passou a fazer 3 operações paralelas por worker (era 2),
  mantendo `FANOUT_LIMIT=4`: concorrência simultânea 8 → 12, sem revisão do bound nem
  métrica de `LOGIN_ERROR_MAX_SESSIONS`.
- **Melhoria Proposta** — (a) baixar `FANOUT_LIMIT` para 3 (pico ≈ 9), ou (b) manter 4 e
  instrumentar 5xx/`LOGIN_ERROR_MAX_SESSIONS` para provar que 12 cabe no orçamento.
- **Resultado Esperado** — concorrência 12 → 9, ou dashboard provando o teto.
- **Métricas** — concorrência simultânea: 12 → 9 (opção a) · falhas de sessão: mantém 0
- **Risco de não fazer** — o próximo `Promise.all` no worker leva a 16 conexões.

### [modifiability-3] [DELTA] `MODALIDADE_NATIVA.BOLETO = 7` como barreira de tipo

**QA** Modifiability · **Tactic** Encapsulate · **Esforço** S · **Findings** F-modifiability-3

- **Problema** — a constante é sabidamente errada (89% dos boletos reais são 6). A
  proteção é implícita: se o gate for removido, o valor errado volta ao ERP em silêncio.
- **Melhoria Proposta** — (a) remover a chave `BOLETO` e tipar
  `Record<Exclude<Modalidade,'BOLETO'>, number>` — o compilador força tratar o caso; ou
  (b) `throw new UnreachableError('boleto sem DDA deveria ter sido barrado antes')`.
- **Resultado Esperado** — `BOLETO` só aceito pelo caminho com `associarDda=true`,
  garantido por tipo ou throw.
- **Métricas** — constantes erradas sem barreira: 1 → 0
- **Risco de não fazer** — se um dev relaxar o gate, o SISPAG volta a mandar modalidade
  errada — falha silenciosa que só aparece na tesouraria.

### [availability-2] [DELTA] Deadline agregado no `modalidadesDisponiveisDoLote`

**QA** Availability · **Tactic** Removal from Service · **Esforço** M · **Findings** F-availability-3

- **Problema** — 3 fan-outs sequenciais, cada chamada limitada aos 40 s do axios global.
  Sob degradação parcial do Conexos o total passa de 60 s: painel dependurado, usuário
  refresha, cascata sobre o pool de sessões. O delta introduziu o terceiro fan-out.
- **Melhoria Proposta** — `AbortController` de escopo request com deadline configurável
  (~30 s), devolvendo parcial com marcadores por filial ausente.
- **Resultado Esperado** — 100% dos requests do painel encerram em ≤ 30 s.
- **Métricas** — deadline agregado: ausente → 30 s
- **Risco de não fazer** — incidente parcial vira incidente total percebido.

### [fault-tolerance-4] [DELTA] Read-back de `itsNumCodbar` ou parse do segmento J

**QA** Fault Tolerance · **Tactic** Sanity Checking · **Esforço** M · **Findings** F-fault-tolerance-4

- **Problema** — o acordo "YES ⇒ ERP anexa barcode" é validado só por sonda HML. No
  caminho quente, o serviço vai de `importarTitulos` a `gerarRemessa` sem verificar que
  o barcode apareceu. O ADR-0040 lista "acompanhar a primeira remessa" como pendência humana.
- **Melhoria Proposta** — **Opção B (recomendada)**: após `gerarRemessa`, parsear o
  `.REM` e verificar que todo segmento J tem barras; se algum vier vazio, cancelar o
  lote ANTES de disponibilizar o download. O parser de CNAB já existe para o `.RET`.
- **Resultado Esperado** — `.REM` com segmento J vazio nunca chega ao operador; a
  pendência humana vira gate automatizado.
- **Métricas** — verificações do artefato final: 0 → 1 · testes do parse: 0 → ≥2
- **Risco de não fazer** — edge case produz `.REM` que o banco rejeita; detectado só no `.RET`.

### [integrability-3] [HERDADA] Separar leitura e escrita do `fin015`

**QA** Integrability · **Tactic** Encapsulate; Restrict Communication Paths ·
**Esforço** S (rename) / M (split) · **Findings** F-integrability-2

- **Problema** — `ConexosSispagWriteClient` tem 8 leituras / 4 escritas (67% read), e o
  JSDoc diz ser "a 1ª superfície de ESCRITA que quebra a I1" — mas dois services que não
  escrevem nada dependem dele. Um gate futuro por `conexosWriteEnabled` quebraria a ingestão.
  *(Herdada: já hospedava 4 leituras; o delta adicionou a 5ª e a 1ª dependência read-only.)*
- **Melhoria Proposta** — **(A)** renomear para `ConexosFin015Client` (o que ele é), ou
  **(B)** extrair `ConexosSispagLotesReadClient`. Recomendo A pelo custo/benefício.
- **Resultado Esperado** — auditoria "quem escreve no ERP" fica trivial.
- **Métricas** — services read-only importando o "WriteClient": 2 → 0
- **Risco de não fazer** — a separação I1 declarada na ontologia deixa de valer na prática.

### [modifiability-2] [DELTA] Consolidar "modalidade exige artefato" num módulo

**QA** Modifiability · **Tactic** Abstract Common Services · **Esforço** M · **Findings** F-modifiability-2

- **Problema** — a regra "BOLETO só sai se `temBoletoDda`" aparece em 6 arquivos físicos,
  cada um repetindo parte dela em comentário/string. A cola é o ADR-0040.
- **Melhoria Proposta** — `domain/service/sispag/ModalidadeElegibilidade.ts` com
  `avaliar(item, pendente): { elegivel, motivo?, flagsErp }`. UI consome o `motivo` da
  API em vez de recriar a mensagem.
- **Resultado Esperado** — nova modalidade fail-closed toca 2 arquivos, não 6.
- **Métricas** — arquivos que carregam a regra: 6 → 2
- **Risco de não fazer** — UI e backend divergem em critério/mensagem silenciosamente.

### [modifiability-1] [DELTA] Extrair `SispagRemessaPayloadBuilder`

**QA** Modifiability · **Tactic** Split Module · **Esforço** M · **Findings** F-modifiability-1, F-modifiability-5

- **Problema** — `RemessaService.ts` 851 → 971 LOC (+14%); `montarItensImport` 74 → 120
  LOC (+62%), concentrando chaveamento, gates, resolução condicional de destino e
  montagem de payload.
- **Melhoria Proposta** — extrair um builder responsável por `TituloPendente` →
  `{payload, associarDda}`; `RemessaService` fica com orquestração (etapas, ledger, retomada).
- **Resultado Esperado** — `RemessaService.ts` ≤ 800 LOC; método mais longo ≤ 60 LOC.
- **Métricas** — LOC do arquivo: 971 → ≤800 · arquivos tocados p/ nova modalidade: 6 → 2
- **Risco de não fazer** — em 2 features deste tamanho o arquivo passa de 1.100 LOC.

### [integrability-6] [HERDADA] Observabilidade de breaking-change do Conexos

**QA** Integrability · **Tactic** Observability of integration failures · **Esforço** M ·
**Findings** F-integrability-6, F-integrability-1, F-integrability-3

- **Problema** — sem version-pinning na API do Conexos (ERP proprietário sem `v1`),
  combinada com contrato descoberto por engenharia reversa e coerções sem Zod, a única
  detecção de breaking-change é o banco recusar a remessa.
- **Melhoria Proposta** — contar por rodada a taxa de `titVldReflexoDdaAssoc=1` por
  filial; alertar se cair a 0 ou pular para 100%; mesma métrica para QUESTIONs que
  precisaram de re-POST; rodar `contrato.test.ts` em smoke pós-deploy contra HML.
- **Resultado Esperado** — quebra do wire vira alerta na próxima rodada. Detecção: dias → minutos.
- **Métricas** — tempo de detecção de "flag DDA caiu a 0": indeterminado → ≤ 1 rodada
- **Risco de não fazer** — manter o modelo "detecção pelo banco" no caminho de pagamento.

### [performance-4] [HERDADA] Instrumentar `duration_ms` por chamada Conexos

**QA** Performance · **Tactic** pré-requisito de Performance · **Esforço** S · **Findings** F-performance-6

- **Problema** — sem latência por endpoint, todo alvo de performance é declarativo —
  inclusive o do card `performance-1`, que não pode ser validado antes nem depois.
- **Melhoria Proposta** — envolver a chamada em `ConexosBaseClient` num diff de tempo e
  emitir `LOG_TYPE.PERF` com `{ endpoint, filCod, duration_ms, page }`.
- **Resultado Esperado** — p50/p95 por endpoint construível em qualquer coletor downstream.
- **Métricas** — cobertura de instrumentação: 0% → 100% das chamadas Conexos
- **Risco de não fazer** — regressões de performance ficam invisíveis até virarem reclamação.

### [sispag-dda-status-visivel] [DELTA] "DDA indisponível" ≠ "sem DDA"

**QA** Availability + Fault Tolerance (deduplicado) · **Tactic** Condition Monitoring ·
**Esforço** M · **Cards de origem** availability-1, fault-tolerance-2 ·
**Findings** F-availability-1, F-availability-2, F-fault-tolerance-2

- **Problema** — quando `listarTitulosComBoletoDda` falha, TODOS os títulos da filial
  ficam `temBoleto=false`, renderizados como "esse fornecedor não tem boleto". A analista
  não distingue "não tem" de "não pude ler" e escolhe TED/PIX quando o boleto existe —
  tarifa, retrabalho, e se o fornecedor só reconhece boleto, segunda cobrança.
- **Melhoria Proposta** — (a) `boletoStatus: 'com' | 'sem' | 'indeterminado'` no
  `TituloAPagar`; (b) expor `boletoDdaStatusPorFilial` no painel e tooltip distinto no
  `LoteCard`. O fail-closed do envio continua sendo a rede de segurança.
- **Resultado Esperado** — overlap "sem boleto real" × "leitura falhou": 100% → 0%.
- **Métricas** — sinal visual de degradação por filial: 0 → 1
- **Risco de não fazer** — pagamento pelo rail errado durante instabilidade do ERP.
- **Dependências** — migration acrescentando coluna; compartilha storage com `availability-3`.

### [sispag-probes-consolidation] [MIXED] Consolidar sondas HML

**QA** Security + Deployability + Modifiability (deduplicado) · **Tactic** Limit Access;
Package Dependencies · **Esforço** M · **Cards de origem** security-3, deployability-4,
modifiability-4, modifiability-6

- **Problema** — `jobs/probe-*.ts` acumulou 30 arquivos / 5.181 LOC (0 apagados em 60
  dias); o delta somou 7 (1.148 LOC), 3 escrevendo em HML, guardadas por
  `BASE.includes('-hml')` — substring que aceita qualquer URL contendo `-hml`. O
  `tsconfig` inclui `**/*.ts` sem exclude: as sondas compilam para `dist/`. O guard não
  tem teste. *(Mixed: 30 probes é herança; as 7 novas e o reforço do padrão são delta.)*
- **Melhoria Proposta** — (a) mover para fora do build; (b) allowlist positiva de
  hostname via `assertNotProd()`; (c) política de retirada no README com `expiresAt`;
  (d) teste que carrega cada probe HML apontando para PRD e verifica que morre antes do POST.
- **Resultado Esperado** — 1.148 LOC fora do `dist/`; guard não-permissivo; diretório ≤ 15 ativos.
- **Métricas** — LOC no artefato: 1148 → 0 · guard: substring → hostname exato ·
  probes ativos: 30 → ≤15 · `grep -c "includes('-hml')"`: 2+ → 0
- **Risco de não fazer** — baixo hoje (hosts estáveis), cresce com mais clientes; o guard
  de 1 linha é a única barreira contra escrever no ERP real.

---

## P3 — Baixo

### [fault-tolerance-5] [DELTA] Teste do particionamento `associarDda` com falha entre grupos

**QA** Fault Tolerance · **Tactic** Verification · **Esforço** S · **Findings** F-fault-tolerance-5

- **Problema** — nenhum teste combina "grupo `false` importa OK + grupo `true` falha no
  2º item + retomada reimporta só o faltante". A retomada cobre pelo mecanismo genérico
  (confirmado linha a linha), mas a propriedade não está protegida contra refactor.
- **Melhoria Proposta** — lote misto (2 `CREDITO_CONTA` + 2 `BOLETO` com DDA); 1ª execução
  falha no grupo `true`; 2ª execução verifica `importarTitulos` chamado UMA vez com
  `associarDda=true` e 1 item.
- **Resultado Esperado** — propriedade protegida contra regressão.
- **Métricas** — testes do cenário: 0 → 1
- **Risco de não fazer** — refactor do loop introduz duplo import; suíte segue verde.

### [fault-tolerance-3] [HERDADA] Expor execuções `error` com `native_flp_cod` (lote vazio órfão)

**QA** Fault Tolerance · **Tactic** Condition Monitoring · **Esforço** S · **Findings** F-fault-tolerance-3

- **Problema** — quando `BoletoSemCodigoBarrasError` (ou outra falha após `criarLote`)
  fecha o ledger em `error` com `native_flp_cod`, o lote vazio fica no ERP e é invisível
  ao `contarExecucoesParadas`, que só olha `reconciling`.
  *(Herdada: mecanismo geral; o delta apenas cria um novo cenário que o expõe.)*
- **Melhoria Proposta** — estender a consulta para `status='error' AND native_flp_cod IS
  NOT NULL AND updated_at < now() - '1 day'`; mostrar junto com os `reconciling`.
- **Resultado Esperado** — 0 lotes vazios órfãos > 24h invisíveis à operação.
- **Métricas** — sinal visível na UI: ausente → presente
- **Risco de não fazer** — sujeira acumulada no `fin015`, ruído para a Columbia.

### [modifiability-5] [DELTA] Decompor o builder em três funções

**QA** Modifiability · **Tactic** Split Module · **Esforço** S (após `modifiability-1`) ·
**Findings** F-modifiability-1

- **Problema** — mesmo após extrair o builder, o corpo tem 3 responsabilidades:
  chaveamento/indexação, gates, resolução de destino + montagem.
- **Melhoria Proposta** — `indexarPendentes`, `validarElegibilidade`, `montarPayload`.
- **Resultado Esperado** — cada função ≤ 40 LOC; testes de gate independentes.
- **Métricas** — método mais longo: 120 → ≤40 · testes de gate isolados: 0 → ≥3
- **Dependências** — `modifiability-1`.

### [integrability-5] [DELTA] Política de sondas + mover `fin124` para "diagnóstico"

**QA** Integrability · **Tactic** Encapsulate · **Esforço** S · **Findings** F-integrability-5

- **Problema** — `jobs/` tem 51 arquivos / 9.027 LOC, diluindo o sinal de "o que roda em
  produção". E `endpoints_read` lista `fin124/*` como leitura do sistema — mas nenhum
  código de runtime consulta `fin124`, só as sondas.
- **Melhoria Proposta** — separar `jobs/probes/` de `jobs/`; mover `fin124` para
  sub-seção "Diagnóstico (só sondas, não runtime)"; documentar a política no CLAUDE.md.
- **Resultado Esperado** — `endpoints_read` volta a listar só o que a solução consome.
- **Métricas** — endpoints sem código de runtime: 1 → 0
- **Risco de não fazer** — o próximo dev procura o código que consome `fin124` (não existe).

### [deployability-5] [DELTA] Limpar `flp 24 / doc 452/1` em HML e adotar cleanup em `finally`

**QA** Deployability · **Tactic** Manage Service Interactions · **Esforço** S · **Findings** F-deployability-3

- **Problema** — a sondagem deixou um item importado no lote de teste `flp 24` (fil 2,
  bnc 4) em HML. O probe cancela o lote do próprio run, mas se cair antes de setar
  `loteCriado = true`, o item fica órfão.
- **Melhoria Proposta** — cancelar `flp 24` à mão; mover o cleanup do probe para `finally`;
  documentar "como limpar resíduo de probe em HML".
- **Resultado Esperado** — órfãos em HML: 1 → 0.
- **Métricas** — cleanup em `try/finally`: presente
- **Risco de não fazer** — HML deriva; probes futuras confundem estado com resíduo.

### [testability-5] [HERDADA] Fatia mínima de teste de UI para `app/sispag/`

**QA** Testability · **Tactic** Specialized Interfaces · **Esforço** M · **Findings** F-testability-5

- **Problema** — `src/frontend/app/sispag/` tem 1.590 LOC de UI e 0 testes. A nova coluna
  "Boleto" e o aviso condicional do `LoteCard` estão sem asserção. Recebimentos, frente
  vizinha, tem 6 arquivos de teste. *(Herdada: pattern da frente inteira.)*
- **Melhoria Proposta** — `page.test.tsx` cobrindo os 2 caminhos da coluna Boleto e
  `LoteCard.test.tsx` cobrindo o aviso de boleto ausente, espelhando `recebimentos/`.
- **Resultado Esperado** — base para testes de frontend do SISPAG; regressão detectável
  sem QA manual.
- **Métricas** — arquivos de teste em `app/sispag/`: 0 → 2
- **Risco de não fazer** — a próxima mudança em `LoteCard.tsx` (503 LOC) é cega.

### [sispag-truncamento-observavel] [HERDADA] WARN estruturado + teste de propagação

**QA** Performance + Testability (deduplicado) · **Tactic** Bound Execution Times ·
**Esforço** S · **Cards de origem** testability-4, performance-3

- **Problema** — `listarTitulosPendentes` alerta via `console.warn` ao truncar em
  `maxPaginas` (default 40, teto 20k pendentes/filial). Nenhum teste prova que o chamador
  `listarTitulosComBoletoDda` propaga o sinal. Filial 2 hoje = 2.195 pendentes (11% do
  teto) — margem confortável, mas um filtro futuro que expanda a leitura reintroduz o
  truncamento silencioso. *(Herdada: `console.warn` e `maxPaginas` pré-existem ao delta.)*
- **Melhoria Proposta** — trocar por `logService.warn` estruturado com
  `{filCod, bncCod, flpCod, paginas, acumulado, total}`; teste `gridDe(10_000)` +
  `maxPaginas: 2` provando que o chamador detecta.
- **Resultado Esperado** — 0 usos de `console.warn` em `domain/client/*.ts`; truncagem auditável.
- **Métricas** — `console.warn` no client: 1 → 0 · teste de truncagem: 0 → 1
- **Risco de não fazer** — boletos "sumindo" da tela conforme a carteira cresce.
