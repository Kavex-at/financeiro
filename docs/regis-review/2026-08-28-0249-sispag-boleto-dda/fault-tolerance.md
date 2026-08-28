---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-08-28-0249-sispag-boleto-dda
agent: qa-fault-tolerance
generated_at: 2026-08-28T02:49:00-03:00
scope: backend
score: 8
findings_count: 5
cards_count: 5
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Conexos ERP `fin015` (write) | Interrupção parcial na sequência `criarLote → importarTitulos (2 grupos) → finalizarLote → gerarRemessa`, ou `type:QUESTION` no meio do import DDA | `RemessaService.gerarRemessa` + `ConexosSispagWriteClient.importarTitulos` (`postGenericOnce`) + ledger `remessa_execucao` | PRD escrita-habilitada, primeira remessa real com boleto DDA | Cada `.REM` é gerado exatamente uma vez para o lote; QUESTION allowlistada auto-respondida sem duplicar item; qualquer outra pergunta ou dúvida vira fail-closed (`RemessaEmDuvidaError`/`ErpPerguntaError`) — nunca um segundo lote nativo, nunca segmento J sem código de barras | 0 duplicações; 100% dos POST não-idempotentes usam `postGenericOnce`; retomada verifica no ERP antes de re-executar cada etapa; boleto sem DDA barrado ANTES de qualquer escrita no lote |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas SISPAG usando `postGenericOnce` (single-attempt, sem retry cego) | 3/3 (`criarLote`, `importarTitulos`, `gerarRemessa`) | 100% | ✅ | `src/backend/domain/client/ConexosSispagWriteClient.ts:158,551,558,674` |
| Ledger write-ahead antes da 1ª escrita irreversível | presente (marca d'água + `setNativeFlpCod` imediato) | presente | ✅ | `src/backend/domain/service/sispag/RemessaService.ts:413-436` |
| Estados da máquina de retomada cobertos por teste (linhas de `retomada-remessa-sispag.md`) | 8/8 (não existe, aberto/vazio, aberto/parcial, aberto/completo, finalizado sem arquivo, finalizado com arquivo, cancelado 2/3, intruso) | 8/8 | ✅ | `src/backend/domain/service/sispag/RemessaService.test.ts:220-472` |
| Testes cobrindo o re-POST à `FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO` | 5 casos (YES reenvia body idêntico com `answers` por `id`; fora da allowlist → `ErpPerguntaError`; envelope 2+ perguntas não auto-responde; pergunta repetida não vira laço; propagação em 1-item-por-chamada) | ≥3 | ✅ | `src/backend/domain/client/ConexosSispagWriteClient.test.ts:226-376` |
| Concorrência intra-lote (2 cliques/2 abas) | advisory-lock por hash do `loteId` → `RemessaEmAndamentoError` sem tocar ledger | 100% dos gerar-remessa serializados por lote | ✅ | `src/backend/domain/service/sispag/RemessaService.ts:127-138`; teste `RemessaService.test.ts:873-897` |
| Verificação pós-import de `itsNumCodbar` populado (defense-in-depth do acordo "YES ⇒ ERP anexa barcode") | 0 no caminho quente (só em `jobs/probe-dda-assoc-write-hml.ts:178-184`, sonda manual) | ≥1 read-back ou parse-canário do `.REM` | ❌ | `grep -rn "itsNumCodbar\|Segmento J" src/backend/domain` |
| Reaper de execuções `status='error'` com `native_flp_cod` preenchido (lote nativo VAZIO deixado após `BoletoSemCodigoBarrasError`) | 0 — `listReconcilingParadas` filtra `status='reconciling'`, não pega `error` | reaper que expõe ou reusa/limpa esses órfãos | ❌ | `src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts:115-128` |
| Sinal distinto de "não pude ler o flag DDA" vs "título sem DDA" na ingestão | ausente — `titulosComBoletoDda` catch-all → `new Set()` + WARN; a analista vê `temBoleto=false` para os dois casos | 1 sinal separável (coluna "DDA indisponível" ou `temBoletoIndeterminado`) | ❌ | `src/backend/domain/service/sispag/IngestaoPagamentosService.ts:71-97` |
| Reconciliação periódica global (nossa base vs. `fin015` do ERP, independente de execução) | ausente — só há sync per-execução em `sincronizarComErp` | 1 job periódico ou runbook | ⚠️ Não medível localmente | grep + inspeção de `jobs/` |
| Teste dedicado ao particionamento `associarDda=false/true` com falha entre grupos | 0 dedicado; retomada coberta pelo cenário genérico "import parcial importa só o que falta" | ≥1 dedicado | ⚠️ | `RemessaService.test.ts:519-546` (genérico), sem cenário `[false ok, true fail]` |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution | Fail-closed no envio (`BoletoSemCodigoBarrasError`) em vez de mandar segmento J vazio; kill-switch `sispagLiveWriteEnabled` local à frente | ✅ | `RemessaService.ts:186-188,876-882`; `BoletoSemCodigoBarrasError.ts` |
| Replacement | Retomada com adoção por marca d'água quando `flpCod` não foi gravado | ✅ | `RemessaService.ts:747-809` |
| Predictive Model | Sondagem (4 read-only PRD + 2 write HML) mediu `titEspCodbar=0%`, `titVldReflexoDdaAssoc` como único vínculo e "POST-QUESTION não escreve" antes de trocar a fonte de `temBoleto` | ✅ | `ontology/_inbox/sispag-boleto-dda-sondagem.md`; ADR-0040 |
| Increase Competence Set | Allowlist estreita de UMA pergunta auto-respondível (chave exata, não `includes`); envelope 2+ perguntas nunca auto-responde | ✅ | `ConexosSispagWriteClient.ts:52,573-582`; teste `ConexosSispagWriteClient.test.ts:322-343` |
| Sanity Checking | Zod nos boundaries (`LOTE_CRIADO_SCHEMA`, `QUESTION_SCHEMA`, `SUCESSO_SCHEMA`); busca do `.REM` PELO NOME (nunca "primeiro com conteúdo") | ✅ | `ConexosSispagWriteClient.ts:22-62`; `RemessaService.ts:520-525` |
| Comparison | `sincronizarComErp` compara `nossas` × `jaNoErp` (chaves do lote local × chaves no ERP) para computar `faltando` e detectar `intrusos` | ✅ | `RemessaService.ts:685-733` |
| Timestamp | `atualizado_em` do ledger alimenta o filtro do reaper (`MINUTOS_ORFAO=15`) | ✅ parcial | `RemessaExecucaoRepository.ts:120-125`; `SispagPainelService.ts:328-357` |
| Timeout | Herdado de `postGenericOnce`/`runWithRetry` da `ConexosBaseClient` (cross-QA: availability) | ✅ | `ConexosBaseClient.ts:149-155` (cross-ref availability) |
| Condition Monitoring | Contagem de execuções `reconciling` paradas exposta no painel (`execucoesParadas`) — mas SÓ para `reconciling`; execuções em `error` com lote nativo criado ficam invisíveis | ⚠️ parcial | `SispagPainelService.ts:328-357` — ver F-fault-tolerance-3 |
| Self-Test | Ausente no caminho quente. Sondas (`probe-dda-assoc-write-hml.ts`) validam a associação DDA offline, não em runtime | ⚠️ parcial | `src/backend/jobs/probe-dda-*.ts` (7 sondas) |
| Voting | N/A — uma via só (ERP é a fonte da verdade) | N/A | — |
| Redundancy | N/A — não faz sentido para write no ERP (dupla escrita ⇒ dupla remessa) | N/A | — |
| Recovery (Forward) | Retomada consulta o ERP e reusa etapas concluídas; boleto sem DDA obriga o operador a corrigir a montante (importar DDA no `fin124` ou trocar modalidade) | ✅ | `RemessaService.ts:592-734`; `boleto-exige-codigo-de-barras.md` |
| Recovery (Backward) | N/A explícita — o ERP não suporta rollback limpo de `criarLote`/`importarTitulos`; escolha explícita registrada em ADR-0013/0039 | N/A justif. | ADR-0013 §"Alternativas descartadas" |
| Reintroduction (Shadow/Resync/Restart) | `dryRun` + `sispagLiveWriteEnabled` fazem shadow-mode; kill-switch da frente permite conter bug SISPAG sem parar permutas/recebimentos | ✅ | `RemessaService.ts:184-188` |
| Rollback | N/A no ERP; o ledger volta para `error` sem apagar `native_flp_cod` — a próxima tentativa reusa o lote vazio | N/A (parcial via reaproveitamento) | `RemessaService.ts:567-576` |
| Repair State | `sincronizarComErp` é o núcleo do repair-state | ✅ | `RemessaService.ts:592-734` |
| Idempotent Replay | `idempotency_key = remessa:{loteId}`; `settled` curto-circuita; `postGenericOnce` impede 401-retry silencioso duplicar escrita | ✅ | `RemessaService.ts:191-216`; `ConexosBaseClient.ts:68-77` |
| Compensating Transaction | N/A explícita — Conexos não expõe cancelamento programático seguro; forward-recovery com decisão humana (`LoteAnteriorCanceladoError` pergunta pelo confirm) | N/A justif. | `RemessaService.ts:267-273`; `retomada-remessa-sispag.md` §"O que continua travando" |
| Reconcile | Per-execução: `sincronizarComErp`. **Ausente:** reconciliação periódica global (comparar toda a carteira SISPAG local × `fin015` do ERP fora do contexto de uma execução) — dependência silenciosa se o ERP for editado por analista via UI Conexos | ⚠️ | grep em `src/backend/jobs/` (só sondas + crons de ingestão) |
| Quarantine | `RemessaEmDuvidaError` / `LoteAnteriorCanceladoError` / `ErpPerguntaError` — todos com `code`, `statusCode`, `userMessage` e `retryable` para o UI decidir | ✅ | `src/backend/domain/errors/` |

## 4. Findings

### F-fault-tolerance-1: re-POST à QUESTION do ERP baseia-se em medição HML sem canário runtime

- **Severidade**: P2
- **Tactic violada**: Self-Test (defense-in-depth ausente)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:512-567`
- **Evidência (objetiva)**:
  ```ts
  // No catch de `importarTitulos`, após reconhecer a pergunta allowlistada:
  await this.base.postGenericOnce<unknown>(
      path,
      { ...body, answers: { [idPergunta]: 'YES' } },  // 2ª tentativa única em sequência
      { filCod },
  );
  ```
  ADR-0040: *"O POST que devolve QUESTION não escreve nada (pré-commit), então o re-POST não é retry cego"* — a evidência citada é uma medição HML (contagem de itens do lote inalterada antes da resposta). Não há verificação **em runtime** — por exemplo, chamar `listarChavesDoLote(flpCod)` antes do re-POST para confirmar que o item ainda não está no lote.
- **Impacto técnico**: se o ERP em PRD tiver, em algum caminho não observado em HML, escrito o item parcialmente ANTES de emitir a `QUESTION` (edge-case de commit-timing, tenant-specific hook, atualização do Conexos), o re-POST importaria o mesmo `(filCod, docCod, titCod)` uma segunda vez. Como cada `postGenericOnce` já é "1 item por chamada" (a atomicidade não existia antes), o resultado seria dois `FinItemSispag` para o mesmo título no mesmo lote — e o `.REM` sairia com duas linhas do mesmo pagamento.
- **Impacto de negócio**: pagamento duplicado do mesmo título. É exatamente o cenário que `postGenericOnce` foi criado para evitar (ADR-0013). A probabilidade é baixa (medição HML aponta pré-commit), mas o custo por evento é alto (dinheiro saindo duas vezes) e não há canário para detectar.
- **Métrica de baseline**: 0 verificações runtime da hipótese "QUESTION é pré-commit"; 1 medição HML (single-shot, 2026-08-27). A propriedade é generalizada de 1 execução HML para todas as execuções PRD.

### F-fault-tolerance-2: `temBoleto` fail-open silencioso confunde "não tem DDA" com "não pude ler"

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring (perde-se o sinal de degradação)
- **Localização**: `src/backend/domain/service/sispag/IngestaoPagamentosService.ts:71-97`
- **Evidência (objetiva)**:
  ```ts
  private titulosComBoletoDda = async (filCod: number): Promise<Set<string>> => {
      try {
          // ...
          return await this.fin015.listarTitulosComBoletoDda({ filCod, bncCod });
      } catch (error) {
          await this.logService.warn({ /* BUSINESS_WARN */ });
          return new Set();  // ← indistinguível de "filial sem nenhum título com DDA"
      }
  };
  ```
  Todos os títulos daquela filial ficam com `temBoleto: false` no `TituloAPagar`. O painel e o `LoteCard` não sinalizam a origem do `false` — o próprio `LoteCard` (`page.tsx:734`) mostra tooltip *"Nenhum boleto DDA associado. Pagamento por TED/PIX/crédito"* mesmo quando a leitura falhou.
- **Impacto técnico**: analista escolhe outra modalidade (TED/PIX) porque a UI diz que não há boleto disponível. `RemessaService.montarItensImport` NÃO fira `BoletoSemCodigoBarrasError` (não é BOLETO). O `.REM` sai por outro rail.
- **Impacto de negócio**: pagamento por rail errado. Se o fornecedor só reconhecia o boleto (número do documento na cobrança dele bate com o barcode, não com uma TED avulsa), a AR do fornecedor não concilia — segunda cobrança, atraso reputacional, no limite pagamento duplicado (manual). Mitigado por (1) próxima rodada da ingestão pode re-ler com sucesso, e (2) alguns fornecedores aceitam qualquer rail. Mas há uma janela.
- **Métrica de baseline**: 100% dos catches devolvem `Set()` sem levar o sinal ao domínio; 0 campos no `TituloAPagar` distinguindo "sem DDA" de "DDA indisponível".

### F-fault-tolerance-3: `BoletoSemCodigoBarrasError` deixa lote nativo VAZIO no ERP invisível ao reaper

- **Severidade**: P3
- **Tactic violada**: Condition Monitoring (superfície de detecção parcial)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:428-478,567-576`; `src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts:115-128`
- **Evidência (objetiva)**:
  1. `criarLote` (linha 428) e `setNativeFlpCod` (linha 436) rodam ANTES de `montarItensImport` (linha 461).
  2. `montarItensImport` lança `BoletoSemCodigoBarrasError` (linha 876-882).
  3. O `catch` (linhas 567-576) chama `ledger.fail(key, ...)` — `status='error'` com `native_flp_cod` preenchido.
  4. `listReconcilingParadas` filtra `WHERE status = 'reconciling'` — o `error` com órfão fica invisível.
  5. O erro é `retryable: false` (`BoletoSemCodigoBarrasError.ts:19`) — o usuário não é convidado a repetir; se ele desistir, o lote nativo vazio nunca é limpo nem re-adotado.
- **Impacto técnico**: um `fin015` vazio por lote-do-sistema abandonado. Reusável em retry (correto: o `RemessaService.test.ts:751-771` cobre o `retry após falha` reusando o `nativeFlpCod`), mas invisível se não houver retry. O ERP recicla `flpCod` (documentado no ADR-0040/comentários), então esse órfão pode ser adotado por outro fluxo — ou apenas ocupar espaço.
- **Impacto de negócio**: sujeira no ERP; onda de suporte para a Columbia entender por que um `flp` aparece no `fin015` sem itens; risco menor de o operador humano cancelar o órfão errado. Não move dinheiro.
- **Métrica de baseline**: 0 exposição na UI/painel; 0 job de reaping para `status='error' AND native_flp_cod IS NOT NULL AND updated_at < now() - 1 day`. O comentário `RemessaService.ts:454-457` afirma *"o lote nativo vazio fica registrado no ledger para ser reusado na próxima tentativa, em vez de virar órfão"* — é verdade condicional a haver "próxima tentativa".

### F-fault-tolerance-4: sem verificação pós-import de `itsNumCodbar` (o acordo "YES ⇒ ERP anexa barcode" só é validado em sonda offline)

- **Severidade**: P2
- **Tactic violada**: Sanity Checking (validação da resposta funcional, não só do envelope)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:458-486` (import → finalizar → gerarRemessa sem read-back)
- **Evidência (objetiva)**: após `importarTitulos({ associarDda: true })` retornar 200, o código vai direto para `setEtapa(key, 'finalizar')` → `finalizarLote` → `gerarRemessa`. Não há chamada de leitura para validar que `itsNumCodbar` do item veio populado nem que `vldVinculoDda === 1`. A comprovação existe **apenas** em `jobs/probe-dda-assoc-write-hml.ts:178-184` (sonda executada 1× em HML, 2026-08-27). O `.REM` gerado também não é parseado antes de retornar `status: 'gerada'` — o serviço confia no shape do envelope (`SUCESSO_SCHEMA`) e na entrega do `gabLngDados`.
- **Impacto técnico**: se o ERP em algum edge-case aceitar o `YES` sem de fato anexar o barcode (bug do Conexos, DDA cancelado no `fin124` entre a leitura do flag e o import, atraso de indexação), o item entra no lote sem `itsNumCodbar`, `finalizarLote` passa (o ERP não bloqueia J vazio hoje), `gerarRemessa` produz `.REM` com segmento J sem barras. A ADR-0040 lista isso como pendência explícita: *"a primeira remessa real com boleto deve ser acompanhada (o `.REM` gerado precisa mostrar segmento J com barras)"* — a validação é humana, não automatizada.
- **Impacto de negócio**: banco recusa a linha do CNAB (não liquida). Detectado só no `.RET` (dias depois) — pagamento não sai, fornecedor cobra novamente. É a versão automatizada exata do bug que a feature está resolvendo (só que originada em edge-case do ERP em vez de na origem do dado).
- **Métrica de baseline**: 0 verificações programáticas do vínculo DDA em runtime; 1 medição HML na sonda; 1 pendência humana no ADR-0040.

### F-fault-tolerance-5: particionamento `associarDda` em 2 chamadas não tem teste dedicado para falha entre grupos

- **Severidade**: P3
- **Tactic violada**: Verification (cobertura de teste do novo caminho)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:466-478`; testes em `RemessaService.test.ts`
- **Evidência (objetiva)**:
  ```ts
  for (const associarDda of [false, true]) {
      const itens = montados
          .filter((m) => m.associarDda === associarDda)
          .map((m) => m.payload);
      if (itens.length === 0) continue;
      await this.write.importarTitulos({ /* ... */ associarDda });
  }
  ```
  O teste `RemessaService.test.ts:983-1010` (`lote misto → uma chamada por grupo`) exercita o **caminho feliz** com 1 item em cada grupo. O teste `import PARCIAL importa SÓ o que falta` (linhas 519-546) exercita a retomada, mas com um único grupo (`CREDITO_CONTA`). **Nenhum** teste combina os dois: *"grupo `false` (2 itens) importa OK, grupo `true` (2 itens) falha no 2º item → retomada consulta ERP e reimporta apenas o item faltante do grupo `true`"*.
- **Impacto técnico**: a máquina de retomada REALMENTE cobre esse caso — `sincronizarComErp` computa `faltando` via chaves e `montarItensImport` recomputa `associarDda` por item a partir do flag do ERP no momento da retomada. A análise adversarial confirma que o mecanismo funciona. O que falta é a **prova executável** desse caminho específico (defesa contra regressão futura quando alguém reorganizar o loop ou trocar a ordem `[false, true]`).
- **Impacto de negócio**: baixo enquanto o código não mudar. Alto se um refactor futuro (por exemplo, mudar a ordem para `[true, false]` ou paralelizar) quebrar a propriedade sem que nenhum teste rode vermelho.
- **Métrica de baseline**: 0 testes dedicados; 1 teste genérico (`import parcial`) cobre o mecanismo subjacente.

## 5. Cards Kanban

### [fault-tolerance-1] Canário runtime antes do re-POST à `QUESTION` do ERP

- **Problema**
  > O re-POST à `FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO` assume que "POST-QUESTION não escreve" baseado em 1 medição HML. Não há verificação em runtime (`listarChavesDoLote` antes do re-POST) para confirmar que o item ainda não está no lote nativo. Se o edge-case existir em PRD, resultado é item duplicado no lote → duas linhas no `.REM` para o mesmo pagamento.

- **Melhoria Proposta**
  > No `ConexosSispagWriteClient.importarTitulos`, entre reconhecer a `QUESTION` allowlistada e emitir o 2º `postGenericOnce`, ler `listarChavesDoLote({ filCod, bncCod, flpCod })` e:
  > - se a chave do item já estiver lá ⇒ NÃO re-POSTar; considerar como "já importado" e retornar sem erro (equivalente a idempotência observada);
  > - se não estiver ⇒ prosseguir com o re-POST.
  > Adicionar teste unitário simulando as duas trilhas. Custo: 1 leitura extra apenas no caminho `QUESTION` (não no happy-path).

- **Resultado Esperado**
  > 0% de risco de duplicação por assumir que a medição HML generaliza. Defense-in-depth alinhada com a doutrina do `postGenericOnce`.

- **Tactic alvo**: Self-Test / Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Verificações runtime da hipótese "QUESTION é pré-commit": 0 → 1 por re-POST
  - Testes cobrindo o caminho "QUESTION + chave já no lote": 0 → 1
- **Risco de não fazer**: baixa probabilidade × alto custo (pagamento duplicado). Se ativar em PRD sem canário, uma primeira ocorrência pode passar despercebida até a conciliação bancária dias depois.
- **Dependências**: nenhuma (o método `listarChavesDoLote` já existe).

### [fault-tolerance-2] Sinalizar "DDA indisponível" ≠ "sem DDA" na ingestão

- **Problema**
  > `IngestaoPagamentosService.titulosComBoletoDda` engole falhas de leitura e devolve `Set()`, indistinguível de "filial sem nenhum título com DDA". A analista vê `temBoleto=false` e o `LoteCard` renderiza o tooltip *"Nenhum boleto DDA associado"* — mesmo quando o `fin015` estava fora do ar durante a ingestão.

- **Melhoria Proposta**
  > Adicionar campo `temBoletoIndeterminado?: boolean` ao `TituloAPagar` (ou um `boletoStatus: 'com' | 'sem' | 'indeterminado'`), preenchido `true` quando a leitura DDA falhou para aquela filial. Propagar para o painel e para o `LoteCard`: tooltip separado *"Não foi possível confirmar boleto DDA (Conexos indisponível na última ingestão) — consulte antes de escolher a modalidade"*. Nada muda no fail-closed do envio (`BoletoSemCodigoBarrasError` continua sendo a rede de segurança).

- **Resultado Esperado**
  > Analista tem sinal explícito para escalar/reingerir antes de mandar um pagamento por rail que o fornecedor não reconhece.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Campo distinguindo "sem" de "indeterminado": ausente → presente
  - Cobertura de teste: adicionar cenário `ingestão falha → titulo.boletoStatus === 'indeterminado'`
- **Risco de não fazer**: pagamento pelo rail errado durante instabilidade do ERP, fornecedor cobra segunda vez, retrabalho manual + risco de duplo pagamento.
- **Dependências**: migration acrescentando coluna em `titulo_a_pagar` (proporcional, cai em `/feature-tweak`).

### [fault-tolerance-3] Reaper/exposição de execuções `error` com `native_flp_cod` (lote nativo vazio abandonado)

- **Problema**
  > Quando `BoletoSemCodigoBarrasError` (ou outra falha após `criarLote`) fecha o ledger em `status='error'` com `native_flp_cod` preenchido, o lote vazio fica no ERP e é invisível ao `contarExecucoesParadas` (que só olha `reconciling`). Reusável em retry, mas se a analista abandonar, órfão permanente.

- **Melhoria Proposta**
  > Estender `SispagPainelService.contarExecucoesParadas` (ou criar `listOrfaosSemRetry`) para incluir `status='error' AND native_flp_cod IS NOT NULL AND updated_at < now() - '1 day'::interval`. Mostrar na mesma tela junto com os `reconciling`. Alternativa mais forte: job daily que tenta cancelar (via ERP) lotes vazios com > N dias, gerando `BUSINESS_WARN` — mas isso requer sondar se o ERP tem endpoint de cancelamento seguro; começar com exposição visual.

- **Resultado Esperado**
  > 0 lotes vazios órfãos > 24h invisíveis à operação.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Consultas ao ledger cobrindo `status='error'` com órfão: 0 → 1
  - Sinal visível na UI para o operador agir: ausente → presente
- **Risco de não fazer**: sujeira acumulada no `fin015`, ruído para a Columbia, risco menor de cancelamento manual errado.
- **Dependências**: nenhuma.

### [fault-tolerance-4] Read-back de `itsNumCodbar` (ou parse de canário do segmento J) após import DDA

- **Problema**
  > O acordo "responder `YES` ⇒ ERP anexa barcode e marca `vldVinculoDda=1`" é validado só por sonda HML (`jobs/probe-dda-assoc-write-hml.ts`). No caminho quente, o serviço vai direto de `importarTitulos` para `finalizarLote` para `gerarRemessa`, sem verificar que o barcode de fato apareceu no item. O próprio ADR-0040 lista "acompanhar a primeira remessa real" como pendência humana.

- **Melhoria Proposta**
  > Opção A (mais barata): após `importarTitulos` retornar, para lotes que tinham `associarDda=true`, reler o grid via `listarTitulosPendentes` (com `chavesDesejadas` restrita) OU um endpoint de leitura do item importado, confirmando `itsNumCodbar` não vazio. Divergência ⇒ `BoletoSemCodigoBarrasError` (não gerar remessa).
  > Opção B (defense-in-depth do artefato): após `gerarRemessa`, parsear o `.REM` e verificar que todo segmento J tem barras (44 dígitos na posição correta) — o parser já existe em `jobs/sintetizar-ret-fin052.ts` para o `.RET` e serve de referência. Se algum segmento J vier vazio, cancelar o lote ANTES de disponibilizar o download.
  > Recomendo Opção B — valida o artefato terminal, independente do endpoint de leitura do item.

- **Resultado Esperado**
  > `.REM` com segmento J sem barras nunca chega ao operador. A pendência humana do ADR-0040 vira gate automatizado.

- **Tactic alvo**: Sanity Checking (validação de resposta funcional)
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Verificações programáticas de barcode no artefato final: 0 → 1
  - Testes de regressão do parse de segmento J: 0 → ≥2 (segmento J válido, segmento J com barras vazia)
- **Risco de não fazer**: caso de edge (bug do Conexos, DDA revogado entre leitura e import) produz `.REM` que o banco rejeita. Detectado só no `.RET` — pagamento atrasa e fornecedor cobra.
- **Dependências**: nenhuma (o parser de CNAB já existe para a via retorno).

### [fault-tolerance-5] Teste dedicado ao particionamento `associarDda` com falha entre grupos

- **Problema**
  > O novo loop `for associarDda of [false, true]` divide o import em duas chamadas. Nenhum teste combina "grupo `false` importa OK + grupo `true` falha no 2º item + retomada verifica ERP e reimporta só o item faltante do grupo `true`". A retomada cobre esse caso pelo mecanismo genérico (`apenasChaves` + recomputação por item), mas a propriedade não está protegida por teste — um refactor futuro (paralelizar, inverter ordem) pode quebrá-la em silêncio.

- **Melhoria Proposta**
  > Adicionar teste em `RemessaService.test.ts` com lote misto (2 itens `CREDITO_CONTA` + 2 itens `BOLETO` com DDA):
  > 1. 1ª execução: mock faz o grupo `false` completo passar; grupo `true` falha no 2º item. Verificar que ledger fica `error` com o flpCod correto e que os 2 primeiros itens estão no `jaNoErp`.
  > 2. 2ª execução (retomada): `sincronizarComErp` devolve `apenas={último_boleto}`; verificar que `importarTitulos` é chamado UMA vez, com `associarDda=true` e 1 item.

- **Resultado Esperado**
  > A propriedade "particionamento sobrevive a falhas entre grupos" fica protegida contra regressão.

- **Tactic alvo**: Verification
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-5
- **Métricas de sucesso**:
  - Testes dedicados ao cenário: 0 → 1
  - Cobertura da branch `pular('importar') === false` + `retomarDe === 'importar'` no lote misto: 0 → 1
- **Risco de não fazer**: refactor inocente do loop introduz duplo import de itens já no ERP; a suíte segue verde até o problema aparecer em PRD.
- **Dependências**: nenhuma (helpers já existem no arquivo de teste).

## 6. Notas do agente

- Escopo intencionalmente estreito ao **delta** e aos 5 pontos de escrutínio do prompt. O núcleo do `RemessaService` (advisory-lock, marca d'água, retomada, arquivo pelo nome) já é sólido — a suíte cobre 8/8 estados da máquina de retomada. Nada disso é achado.
- **Sobre o ataque ao re-POST**: o raciocínio do ADR-0040 é defensável (a medição HML é plausível como generalização, e o `postGenericOnce` bloqueia 401-retry). O que abre a brecha P2 não é o raciocínio — é a ausência de canário runtime (F-1). É uma extrapolação HML→PRD sem defesa-em-profundidade, não uma violação clara.
- **Sobre o particionamento**: analisei o `sincronizarComErp` × `montarItensImport` linha a linha. A retomada FUNCIONA para o caso "falha entre grupos" porque `associarDda` é recomputado por item na 2ª tentativa a partir do flag ERP fresco, e `apenasChaves` filtra corretamente. Não abri finding de correção — só de teste dedicado (F-5).
- **Sobre o `BoletoSemCodigoBarrasError` timing**: confirmado que roda ANTES de qualquer `importarTitulos`. Sobra lote nativo VAZIO (não órfão do ponto de vista de dinheiro), reusável em retry. F-3 é sobre a superfície de detecção quando o retry nunca acontece.
- **Cross-QA**: F-fault-tolerance-1 (canário/read-back) e F-4 (parse do `.REM`) tocam **testability** (novos assertion points) e **integrability** (contrato de resposta com o Conexos). F-2 (sinal de indisponibilidade) toca **availability** (superfície de degradação). O ledger write-ahead e o `postGenericOnce` compartilham doutrina com Permutas (ADR-0013/0039) — consolidator já sabe. Nenhum cross-cutting com security/deployability.
