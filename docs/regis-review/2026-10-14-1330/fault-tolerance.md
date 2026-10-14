---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-14-1330
agent: qa-fault-tolerance
generated_at: 2026-10-14T13:30:00-03:00
scope: backend
score: 7.5
findings_count: 8
cards_count: 6
---

# Fault Tolerance — Regis-Review (reduzido, delta `feat/sispag-sugestao-boleto-dda`)

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dois analistas `sispag:executar` (ou um duplo clique) + sync DDA / carteira em paralelo | Confirmar o mesmo par (título, boleto), ou boletos diferentes disputando o mesmo título/boleto; arquivo DDA cancelado ou título sinalizado pelo ERP depois da confirmação; trilha de auditoria indisponível na cópia | `BoletoSuggestionService`, `SugestaoBoletoRepository`, tabelas 0084, painel `/sispag` | Operação normal, pool DDA com até 8 h de defasagem, passo 1 (zero escrita no Conexos) | Uma única decisão vence; a perdedora relê e recebe 200 idempotente ou 409 nomeado; nenhuma linha digitável sai sem trilha; toda decisão ou é válida, ou é sinalizada, nunca invisível | 0 decisões duplicadas por título/boleto (garantido por índice); 0 linhas digitáveis sem `LINHA_COPIADA`; 100% das decisões `CONFIRMADA` ou visíveis ou desfazíveis |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Unicidade de confirmação por título e por boleto (nível de banco) | 2 índices únicos parciais + 1 de rejeição por (título, boleto) | 100% garantido no banco | ✅ | `migrations/0084_sispag_sugestao_boleto.sql:124-134` |
| Insert que perde corrida sem abortar a transação | 2 de 2 (`inserirPar`, `inserirDecisao` com `ON CONFLICT DO NOTHING` + releitura) | 100% | ✅ | `SugestaoBoletoRepository.ts:208,268,222-224,297-303` |
| Escritas multi-linha em transação única (par + decisão + evento) | 3 de 3 fluxos (`confirmar`, `rejeitar`, `revogarPar`) | 100% | ✅ | `BoletoSuggestionService.ts:232,401,475` |
| Lock otimista na revogação | `WHERE id AND versao AND estado='VIGENTE'` + releitura (no-op se já revogada, 409 se conflito) | presente | ✅ | `SugestaoBoletoRepository.ts:237-243`, `BoletoSuggestionService.ts:476-485` |
| Listagens com teto que falham alto | 3 de 4 (`listarParesVigentes`, `listarPares`, `listarDecisoes`); `listarEventos` trunca em silêncio (padrão 1000) | 100% | ⚠️ | `SugestaoBoletoRepository.ts:148,164,367` vs `:446` |
| Cópia da linha com trilha fail-closed | evento gravado antes do retorno; falha → 503 `COPIA_LINHA_SEM_TRILHA` | 100% | ✅ | `BoletoSuggestionService.ts:538-561` |
| Transições de saída de uma decisão `CONFIRMADA` | 0 (nenhum `UPDATE`/`DELETE` em `sispag_decisao_sugestao_boleto` fora de testes) | ≥ 1 (revogação/anulação com motivo) | ❌ | `grep -rn "UPDATE sispag_decisao\|DELETE FROM sispag_decisao" src/backend` = 0 |
| Estados em que a `CONFIRMADA` some da tela sem sinalização | 4 (boleto some do pool / ERP vincula o boleto / título pago ou inativo / título sinalizado `temBoleto`) | 0 | ❌ | `MotorSugestaoBoleto.ts:136-147,190-193`, `BoletoSuggestionService.ts:610-620` |
| Gate ground-truth `DIVERGE_OUTRO_BOLETO` | 0 (98 reproduzem; 26 "ERP compartilha boleto") | 0 | ✅ | `_shared-metrics.md` |
| Falha da carga de sugestões na página distinguível de "sem sugestão" | 0 de 1 (`catch { setSugestoes(null) }`) | 1 | ❌ | `src/frontend/app/sispag/page.tsx` (`carregarSugestoes`) |
| Guarda de código de barras repetido na remessa | 0 (só checagem de ausência, `BoletoSemCodigoBarrasError`) | n/a no passo 1; ≥ 1 antes do passo 2 | ⚠️ | `RemessaService.ts:1080` |
| Rollback da 0084 | só estrutura, ordem FK correta, `IF EXISTS`, teste `rollbacks.test.ts` | presente | ✅ | `migrations/rollbacks/0084_sispag_sugestao_boleto.rollback.sql` |

> ⚠️ **Não medível localmente**: número real de decisões `CONFIRMADA` em produção que ficaram órfãs (boleto cancelado depois). Requer consulta em PRD (`LEFT JOIN boleto_dda` sobre `sispag_decisao_sugestao_boleto`). Recomendação: incluir essa contagem no job `validate-sispag-sugestao-boleto-dda-v1`.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | Releitura de título e boleto do banco no confirmar/rejeitar/copiar; recusa pago, inativo, `temBoleto`, boleto vinculado, boleto fora do pool/cancelado | ✅ presente | `BoletoSuggestionService.ts:601-622`, `BoletoDdaRepository.buscarPorChave` (`cancelado_em IS NULL`) |
| Sanity Checking (regra reavaliada) | `confirmar` reavalia regra + disputa com o pool de agora e exige ser a sugestão única | ✅ presente | `BoletoSuggestionService.ts:201-228` |
| Comparison | Índices únicos parciais comparam no banco; releitura da vencedora e comparação de par (idempotente × conflito nomeado) | ✅ presente | `0084...sql:124-134`, `BoletoSuggestionService.ts:284-301` |
| Timestamp | `decidido_em`, `confirmado_em`, `ocorrido_em` e `sincronizadoEm` com aviso de defasagem > 8 h | ⚠️ parcial | `BoletoSuggestionService.ts:724-728`; frescor = `max()` global (F-5) |
| Timeout | Sem chamada externa no delta (só Postgres) | N/A | passo 1 não toca o Conexos |
| Condition Monitoring | Defasagem DDA exposta; listagem truncada vira erro 503 | ⚠️ parcial | `SuggestionListingTruncatedError`; a tela engole o erro (F-4) |
| Idempotent Replay | 201/200 por `criada`, `ON CONFLICT DO NOTHING` + releitura; revogar já revogado = no-op | ✅ presente | `routes/sispag.ts` (confirmar/rejeitar/revogar), `SugestaoBoletoRepository.ts:197-306` |
| Rollback (backward recovery) | `withTransaction` com BEGIN/COMMIT/ROLLBACK; perda de corrida dentro da transação lança e desfaz o par recém-criado | ✅ presente | `PostgreeDatabaseClient.ts:175-196` |
| Compensating Transaction | Não há o que compensar no ERP (zero escrita); porém não há compensação local da decisão | ❌ ausente | F-1, F-2 |
| Quarantine / Repair State | Boleto vencido só informativo, ambíguo = sem sugestão; mas decisão órfã não é marcada | ⚠️ parcial | `MotorSugestaoBoleto.ts:338-347`, F-1 |
| Reconcile | O job `validate-...-v1` reconcilia o motor contra o ERP (ground truth), mas não decisões × pool | ⚠️ parcial | `jobs/validate-sispag-sugestao-boleto-dda-v1.ts` |
| Substitution / Replacement | N/A: a decisão humana é evidência; a autoridade segue sendo a validação ao vivo da remessa (ADR-0040) | N/A | ADR-0068 |
| Reintroduction / Escalating Restart | N/A neste delta (sem estado em memória nem fila) | N/A | — |
| Audit trail (invariante) | Todo confirmar/rejeitar/revogar/copiar grava evento na mesma transação; trigger recusa UPDATE/DELETE/TRUNCATE | ✅ presente | `0084...sql:166-188`, `BoletoSuggestionService.ts:303-333,426-439,486-499` |

## 4. Findings

### F-fault-tolerance-1: Decisão `CONFIRMADA` não tem saída e some da tela quando o mundo muda

- **Severidade**: P1
- **Tactic violada**: Repair State / Compensating Transaction (Recover State)
- **Localização**: `MotorSugestaoBoleto.ts:127-147,190-193`; `BoletoSuggestionService.ts:162-183,610-620`; `SugestaoBoletoRepository.ts:230-243`
- **Evidência (objetiva)**:
  ```
  // Motor: confirmada cujo boleto não está mais em `livres` desaparece sem rastro
  const boleto = porChave.get(chaveBoleto(confirmada));
  if (boleto) resultado.push(this.montar(..., ESTADO_SUGESTAO.CONFIRMADA));
  continue;                                  // <- título pulado, boleto segue em `ocupados`

  // confirmar(): título já confirmado => 409 permanente
  if (doTitulo[0]) throw new BoletoSuggestionNotAvailableError({... 'Este título já tem um boleto confirmado.'})
  ```
  Nenhum `UPDATE`/`DELETE` em `sispag_decisao_sugestao_boleto` fora dos testes. `revogarPar` só muda o par (`:237-243`); as decisões ficam `CONFIRMADA` apontando para um par `REVOGADA`. A ontologia (Q-E, `sugestao-boleto-dda-sispag.md:40,55`) diz "revogar cancela as decisões não aplicadas (no passo 1 não há nenhuma)", mas no código existem decisões `CONFIRMADA` no passo 1 e nada as cancela.
- **Impacto técnico**: Em 4 situações (arquivo DDA cancelado, ERP vincula o boleto a outro título, título pago/inativado, título sinalizado `temBoleto`) a confirmação some da tela, o título deixa de aceitar nova confirmação (409 "já tem um boleto confirmado") e o boleto continua em `ocupados`/índice `ux_..._confirmada_boleto`, bloqueado para qualquer outro título. Um erro humano de confirmação também não é desfazível. O estado é terminal sem reconciliação.
- **Impacto de negócio**: No passo 1 é só evidência (sem dinheiro movido), mas a decisão confirmada é a base do passo 2 (reaproveitar o par); uma confirmação errada ou órfã trava o título para sempre e exige UPDATE manual em produção, com a trilha só-inclusão apontando para um estado que não existe mais.
- **Métrica de baseline**: 0 transições de saída de `CONFIRMADA`; 4 condições de órfã sem sinalização; 0 de 4 liberam o título ou o boleto.

### F-fault-tolerance-2: Corrida confirmar × revogar deixa decisão sob par `REVOGADA`

- **Severidade**: P2
- **Tactic violada**: Sanity Checking (dentro da transação) / Repair State
- **Localização**: `BoletoSuggestionService.ts:233-283`; `SugestaoBoletoRepository.ts:238-243`; `0084...sql:103,113-115`
- **Evidência (objetiva)**:
  ```
  const existente = await this.repo.buscarParVigente(pesCod, emissor.chave, tx);   // sem FOR SHARE/UPDATE
  ... par = existente; ...
  await this.repo.inserirDecisao({... confirmacaoEmissorId: par.id }, tx);          // FK só exige existência
  ```
  A FK `confirmacao_emissor_id` não checa `estado`; revogar entre a leitura e o insert (READ COMMITTED) deixa `CONFIRMADA` com par `REVOGADA`.
- **Impacto técnico**: Janela de milissegundos entre duas pessoas com `sispag:executar`; o resultado é uma decisão que declara um par que o time já revogou (e que, por F-1, ninguém consegue limpar).
- **Impacto de negócio**: Baixo no passo 1; vira dado inconsistente quando o passo 3 tornar o par elegível a automático.
- **Métrica de baseline**: 0 locks (`FOR SHARE`/`FOR UPDATE`) em `buscarParVigente`; janela = 1 round-trip dentro da transação.

### F-fault-tolerance-3: Releitura anti-TOCTOU acontece fora da transação e sem trava

- **Severidade**: P3
- **Tactic violada**: Sanity Checking
- **Localização**: `BoletoSuggestionService.ts:186-230` (leituras) vs `:232` (transação)
- **Evidência (objetiva)**: `reler` + `sugerirAgora` (6 consultas, pool inteiro) rodam antes de `withTransaction`; dentro dela não há reconferência de `tem_boleto`, `pago` nem de `cancelado_em`. O `ON CONFLICT` só protege as decisões, não o estado do ERP.
- **Impacto técnico**: Um sync que sinalize o título ou cancele o arquivo entre a leitura e o COMMIT é aceito. Mitigado por: passo 1 é evidência, a autoridade segue sendo a validação ao vivo (ADR-0040), e F-1 é o que dita o dano real.
- **Impacto de negócio**: Nenhum dinheiro; no máximo uma confirmação nascida já obsoleta.
- **Métrica de baseline**: janela medida pelo motor (< 1 s para ~1100 × ~1500) + 6 consultas; 0 reconferências na transação.

### F-fault-tolerance-4: Falha da carga de sugestões na página é indistinguível de "sem sugestões"

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring / Sanity Checking (UX)
- **Localização**: `src/frontend/app/sispag/page.tsx` (`carregarSugestoes`); `src/frontend/lib/sispag.ts:2057-2075`
- **Evidência (objetiva)**:
  ```
  try { setSugestoes(await fetchTodasSugestoesBoleto()) } catch { setSugestoes(null) }
  ```
  `GET /sugestoes-boleto` devolve 503 `LISTAGEM_SUGESTAO_TRUNCADA` quando qualquer listagem chega a 10000 linhas; o mesmo `catch` engole 401/403/500/timeout. Além disso `MAX_PAGINAS_SUGESTOES = 20` x 100 trunca em silêncio em 2000 sugestões e cada página recomputa o motor sobre um snapshot novo (itens podem repetir ou faltar entre páginas).
- **Impacto técnico**: O fail-closed do backend (teto vira 503, correto) é anulado na borda: a analista vê a aba de títulos sem selos e conclui que não há sugestão. Ela cai de volta no fluxo manual, que é seguro, mas sem saber que perdeu o auxílio.
- **Impacto de negócio**: Perda silenciosa do ganho da feature durante uma indisponibilidade; sem sinal para o suporte.
- **Métrica de baseline**: 1 `catch` sem aviso, 0 indicadores de erro; cobertura atual 292 sugestões de 953 BOLETO (teto 2000 → folga ~6,8x).

### F-fault-tolerance-5: Frescor do pool DDA é um `max()` global e a confirmação não o consulta

- **Severidade**: P2
- **Tactic violada**: Timestamp / Condition Monitoring
- **Localização**: `BoletoDdaRepository.ts:151-156`; `BoletoSuggestionService.ts:111-114,724-728`
- **Evidência (objetiva)**: `SELECT max(sincronizado_em) FROM boleto_dda_arquivo`. Um único arquivo recém sincronizado esconde 100 outros defasados (sync parcial); só a listagem recebe `ddaDefasadoHoras`, `confirmar` não recusa nem avisa com pool > 8 h.
- **Impacto técnico**: Sync parcial ou travado parece "fresco"; o motor pode oferecer como livre um boleto que o ERP já vinculou e que ainda não chegou ao pool, e a confirmação passa.
- **Impacto de negócio**: Confirmação baseada em pool velho; mitigado por ser evidência (passo 1), mas é a fonte do par.
- **Métrica de baseline**: 1 timestamp agregado; 0 verificações de frescor no `confirmar`; limite de aviso 8 h (`DDA_DEFASADO_HORAS`).

### F-fault-tolerance-6: Boleto informativo (vencido) não é reservado: o mesmo boleto aparece para 2+ títulos; remessa sem guarda de código repetido

- **Severidade**: P2
- **Tactic violada**: Comparison / Sanity Checking
- **Localização**: `MotorSugestaoBoleto.ts:356-376` (`reserva=false` na camada 3); `BoletoSuggestionService.ts:207-209`; `RemessaService.ts:1080`
- **Evidência (objetiva)**:
  ```
  this.camadaFraca(3, false, ...)   // "o vencido informativo não reserva"
  ```
  Dois títulos podem listar o mesmo `(ddcCod, ditCod)` como VENCIDO_INFORMATIVO. Confirmar é recusado (`OverdueBoletoNotConfirmableError`, `:207-209`) e o índice `ux_..._confirmada_boleto` é a segunda barreira, então **não há dupla confirmação**. Os 27 títulos sinalizados do gate (grupos ERP N:1) ficam fora de `elegiveis` (`temBoleto !== true`) e consomem boletos por contagem em `reservadosPeloErp` (`:188-208`), sem entrar na lista duas vezes. Na remessa só existe checagem de ausência de barras, não de repetição.
- **Impacto técnico**: Duplicidade na lista é só visual (copiar a linha de um boleto informativo é permitido por `copiarLinha`, que não olha o tier, `:525-568`). O risco real é adiante: o passo 2 consumirá a decisão e a remessa não tem barreira de barras repetidas.
- **Impacto de negócio**: No passo 1 nenhum pagamento duplicado; antes do passo 2, a guarda precisa existir, senão o mesmo boleto pode ser pago por dois títulos de um grupo N:1.
- **Métrica de baseline**: 0 guardas de barras repetidas em `RemessaService` (grep); 27 títulos ERP N:1 > M boletos no gate (26 "compartilha"); 0 divergências do motor.

### F-fault-tolerance-7: Comparador de documentos não é transitivo e depende de locale

- **Severidade**: P3
- **Tactic violada**: Sanity Checking (determinismo)
- **Localização**: `MotorSugestaoBoleto.ts:78-83,406-416`
- **Evidência (objetiva)**: `comparaDoc` compara como número se ambos numéricos, senão `localeCompare`; com uma mistura (`'10'`, `'9'`, `'A1'`) a relação pode ser cíclica e `localeCompare` varia com o ICU do runtime (Render × cron `tsx`).
- **Impacto técnico**: Empate na disputa (mesmo vencimento) poderia ser resolvido diferente entre processos. Em Conexos os `docCod` são numéricos, então o efeito prático é remoto.
- **Impacto de negócio**: Sugestão que oscila entre execuções em caso patológico.
- **Métrica de baseline**: 0 casos não numéricos no gate; 0 testes com `docCod` não numérico.

### F-fault-tolerance-8: `listarEventos` trunca em silêncio; rejeitar × confirmar concorrentes coexistem

- **Severidade**: P3
- **Tactic violada**: Sanity Checking / Comparison
- **Localização**: `SugestaoBoletoRepository.ts:428-450`; `BoletoSuggestionService.ts:364-374`; `0084...sql:124-134`
- **Evidência (objetiva)**: `LIMIT $limite` (padrão 1000) sem `exigirNaoTruncada`, enquanto as outras 3 listagens lançam; `rejeitar` verifica `CONFIRMADA` fora da transação e os índices `CONFIRMADA` e `REJEITADA` são independentes, então as duas linhas do mesmo par podem existir.
- **Impacto técnico**: Leitura da trilha de auditoria incompleta sem aviso; par com decisões contraditórias (a `CONFIRMADA` prevalece no motor, `:127-147`).
- **Impacto de negócio**: Auditoria que parece completa; ruído em evidência.
- **Métrica de baseline**: 1 de 4 listagens sem falha alta; 0 consumidores de `listarEventos` fora de testes e rota.

## 5. Cards Kanban

### [fault-tolerance-1] Dar saída e sinalização às decisões CONFIRMADA órfãs ou erradas

- **Problema**
  > Uma decisão `CONFIRMADA` não tem transição de saída (0 `UPDATE`/`DELETE`). Se o boleto some do pool, o ERP o vincula, o título é pago/inativado ou a analista errou, a confirmação some da tela, o título devolve 409 "já tem um boleto confirmado" e o boleto fica bloqueado para outros títulos. Revogar o par não cancela decisões, ao contrário do que a ontologia (Q-E) afirma.

- **Melhoria Proposta**
  > Adicionar o estado `ANULADA` (ou coluna `anulada_em/por/motivo`) com índices únicos parciais já filtrando `decisao = 'CONFIRMADA' AND anulada_em IS NULL`; nova ação `anularConfirmacao` (`sispag:executar`, motivo obrigatório, evento `DECISAO_ANULADA` na mesma transação, lock otimista por `versao`). `revogarPar` anula, na mesma transação, as decisões ligadas ao par. No motor, uma `CONFIRMADA` cujo boleto/título saiu do jogo vira estado visível `CONFIRMACAO_OBSOLETA` (não `continue` silencioso) e para de ocupar o boleto. Incluir a contagem de órfãs no job `validate-...-v1`. Tactic: Repair State + Compensating Transaction (forward recovery local).

- **Resultado Esperado**
  > Transições de saída de `CONFIRMADA`: 0 → ≥ 2 (anular manual, anular por revogação); estados órfãos sem sinalização: 4 → 0; boleto bloqueado por título morto: possível → 0.

- **Tactic alvo**: Repair State / Compensating Transaction
- **Severidade**: P1
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-fault-tolerance-1, F-fault-tolerance-2
- **Métricas de sucesso**:
  - Transições de saída de `CONFIRMADA`: 0 → ≥ 2
  - Decisões órfãs visíveis na tela e no job de validação: 0 → 100%
- **Risco de não fazer**: Em 6 meses o passo 2 consome decisões que ninguém consegue desfazer; correções passam a ser UPDATE manual em produção contra uma trilha só-inclusão.
- **Dependências**: nenhuma; deve entrar antes do passo 2.

### [fault-tolerance-2] Fechar a janela confirmar × revogar e a releitura fora da transação

- **Problema**
  > Dentro de `withTransaction` o par é lido sem trava e o estado do título/boleto não é reconferido; revogar ou um sync no meio deixa decisão sob par `REVOGADA` ou confirmação nascida obsoleta.

- **Melhoria Proposta**
  > Em `buscarParVigente` (modo transacional) usar `FOR SHARE`; reconferir dentro da transação `tem_boleto`, `pago`, `ativo` do título e `cancelado_em` do arquivo com `FOR SHARE` nas duas linhas antes do `inserirDecisao`. Alternativa mínima: `CHECK` via trigger que recusa decisão `CONFIRMADA` sob par não `VIGENTE`.

- **Resultado Esperado**
  > Decisões sob par revogado: possíveis → 0; reconferências na transação: 0 → 3.

- **Tactic alvo**: Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-2, F-fault-tolerance-3
- **Métricas de sucesso**:
  - Teste de integração com duas conexões (confirmar × revogar): 0 → 1 caso passando
  - Linhas `CONFIRMADA` com par `REVOGADA`: não verificável → 0
- **Risco de não fazer**: Inconsistência rara e difícil de reproduzir quando o par virar automático.
- **Dependências**: fault-tolerance-1 (mesma migration).

### [fault-tolerance-3] Mostrar a falha da carga de sugestões em vez de engoli-la

- **Problema**
  > `catch { setSugestoes(null) }` torna 503 de truncamento, 403, 500 e timeout idênticos a "sem sugestões"; o teto de 20 páginas também trunca sem aviso.

- **Melhoria Proposta**
  > Estado `erroSugestoes` com mensagem pt-BR e ação "Tentar de novo" na aba de títulos (`notify.error` + banner discreto, sem bloquear a aba); distinguir `LISTAGEM_SUGESTAO_TRUNCADA` (acionar suporte). Tornar `fetchTodasSugestoesBoleto` falho alto quando `sugestoes.length < total` ao bater o teto de páginas, ou trocar por um endpoint agrupado por título.

- **Resultado Esperado**
  > Falhas visíveis: 0 de 1 → 1 de 1; truncamento silencioso por teto de página: possível → sinalizado.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Teste de página com `fetch` rejeitando mostra o aviso: 0 → 1
  - `catch` vazios no delta de `page.tsx`: 1 → 0
- **Risco de não fazer**: Uma indisponibilidade da feature passa semanas sem ser notada porque o fluxo manual segue funcionando.
- **Dependências**: nenhuma.

### [fault-tolerance-4] Medir frescor por arquivo e recusar confirmar sobre pool defasado

- **Problema**
  > O frescor é um único `max(sincronizado_em)`; um sync parcial parece fresco, e `confirmar` não olha a defasagem.

- **Melhoria Proposta**
  > Expor `min` por arquivo ativo (ou contagem de arquivos > 8 h) em `ultimaSincronizacao`; `confirmar` devolve 409 nomeado (`DdaPoolStaleError`, retryable) quando o arquivo do boleto está além do limite em dia útil, reaproveitando `horasDefasado`. Tactic: Timestamp + Sanity Checking.

- **Resultado Esperado**
  > Verificações de frescor no confirmar: 0 → 1; sync parcial detectado: não → sim.

- **Tactic alvo**: Timestamp
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-5
- **Métricas de sucesso**:
  - Confirmações aceitas com arquivo > 8 h em dia útil: não medido → 0
- **Risco de não fazer**: Par confirmado sobre pool velho, que o passo 3 reaproveitará como "conhecido".
- **Dependências**: nenhuma.

### [fault-tolerance-5] Exigir guarda de código de barras repetido antes do passo 2

- **Problema**
  > O motor deixa o mesmo boleto informativo aparecer para 2+ títulos e a remessa só checa ausência de barras, sem detectar o mesmo código em dois itens (grupos ERP N:1: 27 títulos com menos boletos que títulos).

- **Melhoria Proposta**
  > (a) No motor, marcar o boleto informativo disputado (`motivo: 'também sugerido para outro título'`) ou reservar um por título; (b) como pré-requisito do passo 2, em `RemessaService`/`LotePagamentoService` recusar lote com dois itens de mesma `(ddcCod, ditCod)` ou mesmo `codbar` (`DuplicateBarcodeInBatchError`, antes do envio, com teste de lote N:1).

- **Resultado Esperado**
  > Guardas de barras repetido na remessa: 0 → 1; boleto informativo duplicado na lista: possível → sinalizado.

- **Tactic alvo**: Comparison
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-fault-tolerance-6
- **Métricas de sucesso**:
  - Remessas com o mesmo código de barras em 2 itens: não bloqueadas → 0 (bloqueadas)
- **Risco de não fazer**: Pagamento duplicado do mesmo boleto assim que a decisão alimentar a remessa.
- **Dependências**: antes do passo 2.

### [fault-tolerance-6] Endurecer detalhes de determinismo e leitura da trilha

- **Problema**
  > `comparaDoc` não é transitivo para chaves mistas e depende de locale; `listarEventos` trunca sem lançar; rejeitar e confirmar concorrentes deixam o mesmo par com as duas decisões.

- **Melhoria Proposta**
  > `comparaDoc` com `Intl.Collator('pt-BR', { numeric: true })` fixo (ou comparação por (tamanho, texto)); `listarEventos` com `exigirNaoTruncada` ou paginação por cursor; `rejeitar` rejeita (409) se existir `CONFIRMADA` do par dentro da transação.

- **Resultado Esperado**
  > Listagens que falham alto: 3 de 4 → 4 de 4; testes de ordenação com chaves não numéricas: 0 → 1.

- **Tactic alvo**: Sanity Checking
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-7, F-fault-tolerance-8
- **Métricas de sucesso**:
  - Listagens sem teto explícito: 1 → 0
- **Risco de não fazer**: Ruído de auditoria e empate que oscila entre ambientes.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: só o delta. A "autoridade" é a validação ao vivo da remessa (ADR-0040); como o passo 1 não escreve no Conexos, F-1 foi limitado a P1 (decisão irrecuperável) e não P0.
- Pontos fortes confirmados: `ON CONFLICT DO NOTHING` + releitura nos dois inserts, índices parciais cobrindo as duas unicidades, evento na mesma transação, cópia fail-closed (503), 503 de truncamento, rollback só estrutura documentado.
- Cross-QA: F-1/F-8 tocam Security (trilha só-inclusão e auditabilidade); F-4 e o recálculo do motor por página tocam Performance (`sugerirAgora` por requisição, 6 consultas); testes de corrida confirmar × revogar e N:1 tocam Testability. Não verifiquei PRD (contagem de órfãs, não medível localmente).
