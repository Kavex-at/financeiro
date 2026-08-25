---
qa: Availability
qa_slug: availability
run_id: 2026-08-25-1742-sispag-retomada
agent: qa-availability
generated_at: 2026-08-25T20:15:00-03:00
scope: backend
score: 7
findings_count: 6
cards_count: 6
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Operador clica "Gerar remessa" após uma tentativa que morreu entre POSTs no fin015 (timeout do Render, restart do dyno, queda de rede) | Execução anterior deixou linha `reconciling` no ledger + lote nativo possivelmente criado no ERP | `RemessaService.gerarRemessa` (perna de IDA) e `ConciliacaoRetornoService.conciliar` (perna de VOLTA) | Produção, escrita ligada (`SISPAG_LIVE_WRITE_ENABLED=true`) | Consulta o estado real no ERP (`getLoteNativo`, `listarChavesDoLote`, `getArquivoRetorno`), retoma exatamente do ponto onde parou, **nunca duplica lote/baixa**. Casos indeterminados travam com erro explícito e UX própria (segundo clique quando cabe) | Zero lotes duplicados no fin015; MTTR de execução órfã ≤ 15 min (janela do reaper); ≥ 7 dos 8 desfechos de queda resolvem sozinhos, o 8º pergunta em vez de travar |

Contexto: o ledger write-ahead (ADR-0013) protegia o dinheiro mas terminava em "reconciliação manual" — 409 na tela + ida ao fin015. Este delta (ADR-0039) troca "supor" por "perguntar", com o critério estreito de "onde o ERP expõe estado verificável daquela escrita".

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Desfechos de queda que retomam sem intervenção | 3 de 3 cenários provados ao vivo em HML (C1 adoção por marca d'água, C2 import parcial, C3 remessa já gerada) | ≥ 7 dos 8 desfechos da máquina de retomada | ✅ (para a perna de IDA) | `ontology/_inbox/sispag-retomada-gap.md` — placar final; log `usou flp 12 · 0 lote(s) novo(s)` etc. |
| Cobertura ao vivo da perna de VOLTA (`conciliar`, `sincronizarComErp` do fin052) | 0 cenários (só mock) | ≥ 1 execução `reconciling` recriada e retomada em HML | ❌ | `_shared-metrics.md` §"Gates executados": "NAO exercitada ao vivo nesta bateria: a perna de VOLTA (conciliacao do .RET)"; `ConciliacaoRetornoService.ts:150-183` |
| Reaper agendado em produção | Comando existe (`npm run job:reaper-sispag`), scheduler NÃO configurado | Cron ativo a cada 15 min em Render (ou equivalente) | ❌ | `render.yaml` (79 linhas, sem `cron`/`schedule`); `reaper-sispag-reconciling.ts:22` — "CRON (não configurado — entrada documentada)" |
| MTTR observável de execução órfã | Enquanto o reaper não roda: "até alguém abrir o painel". `SispagPainelService.contarExecucoesParadas` (`SispagPainelService.ts:135,296`) exibe o banner só quando `GET /sispag/painel` é chamado | ≤ 15 min do carimbo `atualizado_em` (o próprio `MINUTOS_ORFAO`) | ⚠️ Não medível localmente sem produção rodando — MTTR real dependeria de logs do Render. Recomendação: agendar o reaper e emitir métrica `sispag.orfaos.count` a cada tick. | `SispagPainelService.ts:42` (`MINUTOS_ORFAO=15`) vs. `reaper-sispag-reconciling.ts:28` |
| Erros terminais com UX própria no frontend | 2 de 3: `RemessaEmDuvidaError` e `LoteAnteriorCanceladoError` (`sispag.ts:335-350`; `page.tsx:341-361`); `ConciliacaoEmDuvidaError` **não** tem classe própria no cliente | 3 de 3 | ⚠️ | `grep -n "ConciliacaoEmDuvida" src/frontend/**/*.{ts,tsx}` → 0 hits; `ConciliacaoRetornoService.ts:180` lança com `code: 'CONCILIACAO_EM_DUVIDA'`, `page.tsx:414` cai no `toast.error('Não foi possível conciliar')` genérico |
| Retomada com >1 candidato de marca d'água | 100% fail-closed (`indeterminado`) — a doutrina "exatamente um" trava e a mensagem lista os `flpCod` candidatos | Fail-closed + escalação automática (log estruturado com correlação para o operador saber que o retry vai continuar reprovando até intervenção) | ⚠️ | `RemessaService.ts:713-720` (`candidatos.length > 1`); nada distingue esse motivo do "sem marca" no log — reaper não sabe diferenciar |
| Kill-switch de escrita da frente SISPAG (isolamento de blast radius) | `SISPAG_LIVE_WRITE_ENABLED` gated no serviço, `sync: false` no `render.yaml` — desliga sem redeploy sem levar Permutas/Recebimentos junto | Presente e documentado | ✅ | `RemessaService.ts:139-143`, `ConciliacaoRetornoService.ts:106-110`, `render.yaml:38-42` |
| Timeout do cliente Conexos | 40 s (`axios.create` em `services/conexos.ts:121`) — global, não distingue leitura curta (getLoteNativo) de multipart pesado (`carregar` do `.RET`) | Timeouts diferenciados por classe de chamada; upload com timeout maior + streaming | ⚠️ | `src/backend/services/conexos.ts:121` |
| Transação DB no fan-in de conciliação | Item + transição de lote sob `db.withTransaction`; PUT ao ERP fica FORA (correto — não regride baixa remota se DB falhar) | Presente | ✅ | `ConciliacaoRetornoService.ts:275-306` |
| Testes automatizados no escopo (mecânica) | backend 109 suites / 1454 testes verdes; `RemessaService.test.ts` cobre C1/C2/C3 e o defeito do `flpCod` não-monotônico | Verdes + gate ao vivo passando na perna de IDA e VOLTA | ⚠️ (VOLTA falta) | `_shared-metrics.md` §Testes |

## 3. Tactics — Cobertura no delta

### Detect Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | `GET /health` responde 200 sem checar dependências | ⚠️ parcial | `src/backend/index.ts:76` |
| Heartbeat | N/A — serviço único no Render, sem cluster | N/A | — |
| Monitor | `reaper-sispag-reconciling.ts` + `SispagPainelService.contarExecucoesParadas` observam ledger em `reconciling`. **Reaper existe, mas não está agendado** | ⚠️ parcial | `reaper-sispag-reconciling.ts:22` (comentário: "CRON (não configurado — entrada documentada)"); `SispagPainelService.ts:296-324` |
| Timestamp | `atualizado_em` em `remessa_execucao`/`conciliacao_execucao` é o pivô do reaper e do banner do painel; `flpTimFinaliza` lido do ERP | ✅ presente | `RemessaExecucaoRepository.ts:120`; `ConciliacaoExecucaoRepository.ts:59` |
| Sanity Checking | Guarda "intrusos" (`RemessaService.ts:643`), regra "exatamente um" na marca d'água (`RemessaService.ts:712`), `titulosCount` tratado como booleano (`RemessaService.ts:610-615`), chave do item com filial (`RemessaService.ts:772-776`) | ✅ presente | linhas citadas |
| Condition Monitoring | Banner `execucoesParadas` no painel (`SispagPanel` em `page.tsx:483-510`) — vermelho, cita os `flpCod` para o operador ir direto no fin015 | ✅ presente | `page.tsx:483-510` |
| Voting | N/A — não há réplicas | N/A | — |
| Exception Detection | 4 erros de domínio tipados: `ConexosError`, `RemessaEmDuvidaError`, `ConciliacaoEmDuvidaError`, `LoteAnteriorCanceladoError`; classificação no `describeConexosValidation` (VALIDATION_LIST vs VALIDATION vs QUESTION) | ✅ presente | `ConexosSispagWriteClient.ts:71-107`; `errors/*.ts` |
| Self-Test | `validate-retomada-remessa-v1.ts` interrompe a sequência em cada ponto em HML e afirma "exatamente os lotes esperados" | ⚠️ parcial | job existe (473 linhas) mas só cobre remessa; sem `validate-retomada-conciliacao-v1.ts` |

### Recover from Faults — Preparation & Repair

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Active Redundancy | N/A — Render single-instance | N/A | — |
| Passive Redundancy | N/A | N/A | — |
| Spare | N/A | N/A | — |
| Exception Handling | Try/catch com `ledger.fail` em `RemessaService.ts:494-503`; wrapping `ConexosError` em todos os writes; **falha de leitura ≠ ausência** (`listarChavesDoLote` e `getArquivoRetorno` devolvem `undefined` em vez de "vazio") | ✅ presente | `ConexosSispagWriteClient.ts:274-283`; `ConexosSispagRetornoClient.ts:191-208` |
| Rollback | `db.withTransaction` envolve gravação de itens + transição de lote — uma queda no meio não deixa lote em "meio-conciliado" | ✅ presente | `ConciliacaoRetornoService.ts:275-306` |
| Software Upgrade | Fora do escopo do delta | N/A | — |
| Retry | Leituras: `RetryExecutor` (2 retries, 500 ms, jitter 200 ms) com `shouldRetry` deterministic-refusal-aware. Escritas irreversíveis: `postGenericOnce`/`putGenericOnce` (tentativa única, deliberada) | ✅ presente | `ConexosBaseClient.ts:153-163` |
| Ignore Faulty Behavior | Contrário à doutrina — fail-closed é a política declarada (ADR-0039) | N/A | — |
| Degradation | Painel degrada sem o banner de órfãos quando `contarExecucoesParadas` falha, em vez de derrubar a tela inteira (`SispagPainelService.ts:319-323`) | ✅ presente | linhas citadas |
| Reconfiguration | Kill-switch `SISPAG_LIVE_WRITE_ENABLED` isola a frente sem redeploy; `CONEXOS_DRY_RUN` global preservado como emergência de última milha | ✅ presente | `RemessaService.ts:139-143`; `render.yaml:38-42` |

### Recover from Faults — Reintroduction

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Shadow | N/A — não há canário/paralelo | N/A | — |
| State Resynchronization | **Essência do delta.** `sincronizarComErp` (`RemessaService.ts:504-664`) e o análogo em `ConciliacaoRetornoService.ts:150-183` reconstroem a etapa real perguntando ao ERP: `getLoteNativo` (status/`titulosCount`), `listarChavesDoLote` (import parcial), `getArquivoRetorno` (processadoEm) e `adotarPorMarcaDagua` (janela entre POST e ledger) | ✅ presente | linhas citadas |
| Escalating Restart | N/A — Render web service, sem hierarquia de restart | N/A | — |
| Non-Stop Forwarding | N/A | N/A | — |

### Prevent Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Removal from Service | Kill-switch por-frente removes ESCRITA sem redeploy | ✅ presente | `RemessaService.ts:139-143` |
| Transactions | Fan-in de conciliação atômico (item + transição); ledger UPSERT ON CONFLICT preserva `settled` (nunca regride) | ✅ presente | `ConciliacaoRetornoService.ts:275-306`; `RemessaExecucaoRepository.ts:83-90` |
| Predictive Model | Não há métricas de rate/latência do retomada; sem tendência de "chances de dar ruim hoje" | ❌ ausente | — |
| Exception Prevention | `idempotencyKey` estável por lote (`remessa:${loteId}`) impede duas remessas concorrentes; write-ahead do `flpCod` + marca d'água + nome do arquivo antes dos POSTs elimina 3 janelas irrecuperáveis | ✅ presente | `RemessaService.ts:132-135`, `RemessaService.ts:352-365`, `RemessaService.ts:432-436` |
| Increase Competence Set | ADR-0039 + `retomada-remessa-sispag.md` documentam a doutrina; comentários no código explicam **por que** cada write-ahead precede cada POST (não só o que) | ✅ presente | ontology + `RemessaService.ts` inteiro |

## 4. Findings

### F-availability-1: Reaper de execuções presas não está agendado em produção

- **Severidade**: P0 (crítico — anula o principal mecanismo de detecção fora do painel)
- **Tactic violada**: Monitor (Detect Faults)
- **Localização**: `render.yaml` (não contém entrada `cron`/`schedule`); `src/backend/jobs/reaper-sispag-reconciling.ts:12-23` (comentário: "CRON (não configurado — entrada documentada)")
- **Evidência (objetiva)**:
  ```
  $ wc -l render.yaml → 79
  $ grep -n "cron\|reaper\|schedule" render.yaml → 0 hits
  reaper-sispag-reconciling.ts:22: // CRON (não configurado — entrada documentada):
  reaper-sispag-reconciling.ts:23: //   */15 * * * *  cd /caminho/do/repo/src/backend && npm run job:reaper-sispag
  ```
- **Impacto técnico**: uma execução `reconciling` órfã (lote nativo criado no ERP, ledger não confirmou) só é observada quando alguém abre `GET /sispag/painel` — que é on-demand e admin-only. Sem reaper rodando, o único canal ativo de alerta é a UI vista por humano.
- **Impacto de negócio**: Se o operador não abrir o painel no dia da queda, o lote órfão fica invisível. A próxima remessa do mesmo lote local será travada por `RemessaEmDuvidaError` (bom), mas o operador só descobre isso no próximo clique — que pode ser dias depois. MTTR degrada de "≤ 15 min" (janela do reaper) para "próxima interação humana".
- **Métrica de baseline**: 0 executions do reaper em produção nos últimos 30 dias (não há Render Cron Job configurado); 100% da observabilidade de órfãos hoje depende de abertura manual do painel.

### F-availability-2: Perna de VOLTA (conciliação `.RET`) não foi provada ao vivo

- **Severidade**: P1 (alto — mecanismo compartilha a doutrina, mas não passou pelo mesmo gate que a IDA)
- **Tactic violada**: Self-Test (Detect Faults) + State Resynchronization (Recover — Reintroduction, sem prova empírica)
- **Localização**: `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts:150-183` (`sincronizarComErp` do fin052); ausente: `jobs/validate-retomada-conciliacao-v1.ts`
- **Evidência (objetiva)**:
  ```
  _shared-metrics.md §"Gates executados":
    "NAO exercitada ao vivo nesta bateria: a perna de VOLTA (conciliacao do .RET)."
  jobs/ → só validate-retomada-remessa-v1.ts (a de IDA)
  ```
- **Impacto técnico**: a lógica de "carimbou `processadoEm` no arquivo? → pula o `processar`" é análoga à de remessa mas nunca foi exercitada contra o `.RET` real do Bradesco/Itaú. Se o campo `garTimProcessamento` vier com shape diferente do esperado (número vs. string, epoch vs. ISO), a retomada da conciliação vira retry cego — e `arquivosRetorno/processar` **grava baixa em cima de baixa** no fin010 (double-payment).
- **Impacto de negócio**: em produção, na primeira queda entre o PUT `processar` e o `settle` do ledger, a próxima tentativa pode gerar baixas duplicadas no fin010 — reconciliação contábil manual (o dano que este delta inteiro existe para evitar). O risco é potencial, não observado — mas o gate que provaria a segurança está ausente.
- **Métrica de baseline**: 0 execuções ao vivo da retomada de `.RET` em HML; 3 execuções ao vivo da retomada de remessa (C1/C2/C3 verdes). Assimetria de cobertura: 50%.

### F-availability-3: Frontend não classifica `ConciliacaoEmDuvidaError` distintamente

- **Severidade**: P1 (alto — usuário pode reintervir num caminho fail-closed que existe justamente para não ser retentado)
- **Tactic violada**: Exception Detection (Detect Faults) — a distinção do backend não sobrevive até a UI
- **Localização**: `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts:180` (throw) → `src/backend/domain/errors/ConciliacaoEmDuvidaError.ts:15` (`code: 'CONCILIACAO_EM_DUVIDA'`) → **cliente**: `src/frontend/lib/sispag.ts` (sem classe) → `src/frontend/app/sispag/page.tsx:414-418` cai no `toast.error('Não foi possível conciliar')` genérico
- **Evidência (objetiva)**:
  ```
  $ grep -n "ConciliacaoEmDuvida" src/frontend/**/*.{ts,tsx}
  (0 hits)
  $ grep -n "REMESSA_EM_DUVIDA\|LOTE_ANTERIOR_CANCELADO\|CONCILIACAO_EM_DUVIDA" src/frontend/lib/sispag.ts
  src/frontend/lib/sispag.ts:378:  if (body.code === 'REMESSA_EM_DUVIDA')
  src/frontend/lib/sispag.ts:381:  if (body.code === 'LOTE_ANTERIOR_CANCELADO')
  (CONCILIACAO_EM_DUVIDA: 0 hits)
  ```
  Comparação com `RemessaEmDuvidaError`: toast tem `duration: 30000`, título "Remessa em dúvida — NÃO repita" e descrição de ação (`page.tsx:362-370`). Já a conciliação em dúvida cai num `toast.error` de 5 s sem instrução.
- **Impacto técnico**: um operador que recebeu o 500 com `code=CONCILIACAO_EM_DUVIDA` vê um toast vermelho igual a qualquer outro erro do Conexos, e é razoável ele clicar de novo — que na próxima chamada refaz `beginExecution` (que preserva `reconciling`) e o serviço faz o **mesmo caminho** (chama de novo `getArquivoRetorno`, que talvez ainda esteja indeterminado). Não gera baixa duplicada (o serviço trava de novo), mas ensina o operador a ignorar o alerta.
- **Impacto de negócio**: comportamento inconsistente entre "remessa em dúvida" e "conciliação em dúvida" — a segunda é tratada como uma falha temporária no fluxo do usuário, quando é a mesma classe de risco.
- **Métrica de baseline**: 2 de 3 erros terminais têm UX própria; conciliação = 0 UX especializada.

### F-availability-4: Reaper é passivo — logs, sem canal ativo de alerta

- **Severidade**: P2 (médio — se agendado, ainda depende de alguém ler o log; comparar com F-availability-1 que é mais grave por não rodar de todo)
- **Tactic violada**: Monitor (Detect Faults) — sinal existe mas não vai a quem precisa
- **Localização**: `src/backend/jobs/reaper-sispag-reconciling.ts:42-79`
- **Evidência (objetiva)**:
  ```
  reaper-sispag-reconciling.ts:42:  await logService.warn({...})
  reaper-sispag-reconciling.ts:54:  console.warn(`[reaper-sispag] remessa ${r.idempotencyKey}...`)
  (grep "SES\|Slack\|webhook\|SendEmailCommand" no arquivo → 0 hits)
  ```
- **Impacto técnico**: `LogService.warn` grava em Postgres (`logs`) + stdout do Render. Nada é empurrado para email/Slack/PagerDuty. O comentário do próprio arquivo (linha 44-45) diz "achar um órfão é o job funcionando" e por isso não usa `error` — que é a decisão certa para não acordar plantão desnecessário, mas deixa aberto o canal de escalação para o operador cotidiano.
- **Impacto de negócio**: mesmo com o reaper agendado (F-1), o "ficou 15 min sem confirmar" só é visível para quem acompanha logs — não para quem opera. Aumenta MTTR entre "detectado pelo sistema" e "visto pelo humano".
- **Métrica de baseline**: 0 canais ativos de notificação; 1 canal passivo (stdout + tabela `logs`).

### F-availability-5: `MINUTOS_ORFAO` hardcoded em dois pontos, sem parametrização compartilhada

- **Severidade**: P2 (médio — dívida de configurabilidade)
- **Tactic violada**: Reconfiguration (Recover — Preparation & Repair)
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:42` (`const MINUTOS_ORFAO = 15;`) e `src/backend/jobs/reaper-sispag-reconciling.ts:28` (`Number(process.env.SISPAG_REAPER_MIN ?? 15)`)
- **Evidência (objetiva)**:
  ```
  SispagPainelService.ts:42:  const MINUTOS_ORFAO = 15;
  reaper-sispag-reconciling.ts:28:  const MINUTOS = Number(process.env.SISPAG_REAPER_MIN ?? 15);
  ```
- **Impacto técnico**: se o operador precisar "encurtar a janela" (ex.: reduzir para 5 min durante fechamento), altera o env do reaper mas o painel continua exibindo "há mais de 15 min" — divergência silenciosa entre o que o job detecta e o que a tela mostra.
- **Impacto de negócio**: baixo em regime normal; alto em incidente ("por que o painel diz 0 e o log diz 3?").
- **Métrica de baseline**: 1 constante espalhada em 2 pontos, com padrão de leitura diferente (`process.env` vs. hardcoded).

### F-availability-6: Marca d'água com >1 candidato não tem escalação — só fail-closed silencioso

- **Severidade**: P2 (médio — o fail-closed protege dinheiro, mas o operador entra em loop sem saber por quê)
- **Tactic violada**: Escalating Restart (Recover — Reintroduction), adaptada: falta escalar para intervenção humana
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:713-720`
- **Evidência (objetiva)**:
  ```
  RemessaService.ts:713:  if (candidatos.length > 1) {
  RemessaService.ts:714:      return {
  RemessaService.ts:715:          resultado: {
  RemessaService.ts:716:              etapa: 'indeterminado',
  RemessaService.ts:717:              motivo: `${candidatos.length} lotes vazios novos com a mesma assinatura: ${candidatos
  RemessaService.ts:718:                  .map((c) => c.flpCod)
  RemessaService.ts:719:                  .join(', ')}`,
  ```
  O `RemessaEmDuvidaError` levantado em seguida (`RemessaService.ts:214`) traz `filCod`/`bncCod`/`criadoEm` mas **não** os `flpCod` candidatos — o motivo textual está no log, não no erro. O operador vê o toast "Remessa em dúvida — NÃO repita", vai ao fin015 e não sabe quais dois lotes olhar sem escavar o log do Render.
- **Impacto técnico**: o retry seguinte cai no mesmo caminho (mesmos candidatos, mesmo veredito), e nada muda até uma pessoa cancelar um dos lotes ambíguos manualmente. Não há sinal para o reaper diferenciar "sem marca" (queda antiga, sem pista) de "ambíguo" (dois candidatos, precisa escolher) — ambos aparecem como `reconciling` genérico.
- **Impacto de negócio**: caso raro (dois lotes com mesma conta, mesma data de débito, ambos vazios, ambos novos), mas quando acontece o operador entra em loop de "clicar → em dúvida → clicar" até alguém abrir suporte.
- **Métrica de baseline**: 0 execuções desse cenário observadas em HML/produção (a favor da raridade); 0 telemetria específica para separar "sem marca" de "ambíguo" nos ledgers.

## 5. Cards Kanban

### [availability-1] Agendar o reaper de execuções presas em produção

- **Problema**
  > O `reaper-sispag-reconciling.ts` existe, é testado e escreve o warn certo, mas `render.yaml` não tem entrada `cron` para ele. Em produção hoje, uma execução órfã só é observada quando um humano abre `GET /sispag/painel` — o que anula o principal canal ativo de detecção. MTTR degrada de "≤ 15 min" para "próxima interação humana com a tela certa".

- **Melhoria Proposta**
  > Adicionar `type: cron` no `render.yaml` (ou equivalente Render Cron Job) que rode `npm run job:reaper-sispag` a cada 15 min, no mesmo repo, com as mesmas envs de banco/Conexos que o web. Alternativa mais leve: `pg_cron` no Supabase disparando um endpoint dedicado autenticado por token de serviço. Tactic Bass: **Monitor** (Detect Faults).

- **Resultado Esperado**
  > Órfãos passam a ser detectados sem depender do operador abrir tela. MTTR observável cai de "próxima interação" (potencial dias) para ≤ 15 min. Métrica: `sispag.orfaos.count` no log do reaper com >0 tick observável em CloudWatch/Render logs em incidente encenado.

- **Tactic alvo**: Monitor
- **Severidade**: P0
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Execuções do reaper por dia: 0 → ≥ 96 (a cada 15 min)
  - Tempo entre `atualizado_em` do órfão e primeiro `logService.warn`: on-demand → ≤ 15 min
- **Risco de não fazer**: um órfão criado numa sexta-feira à noite fica invisível até segunda; se ele durar até a próxima janela de fechamento, a Columbia paga o mesmo título duas vezes ao clicar "gerar remessa" de novo (o `RemessaEmDuvidaError` protege, mas o operador precisa entender a mensagem).
- **Dependências**: nenhuma

### [availability-2] Rodar o gate ao vivo da retomada da conciliação (`.RET`)

- **Problema**
  > `ConciliacaoRetornoService.sincronizarComErp` (linhas 150-183) implementa a mesma doutrina de "perguntar em vez de supor" que a remessa, mas nunca foi exercitada ao vivo. Se o shape de `garTimProcessamento` no Bradesco divergir do assumido, a retomada vira retry cego e `arquivosRetorno/processar` grava baixa em cima de baixa no fin010 — exatamente o dano que este delta inteiro existe para evitar.

- **Melhoria Proposta**
  > Escrever `jobs/validate-retomada-conciliacao-v1.ts` seguindo o mesmo padrão de `validate-retomada-remessa-v1.ts`: (a) subir `.RET` em HML via `carregar`, (b) plantar linha `reconciling` no `conciliacao_execucao` sem `settled`, (c) rodar `conciliar` e afirmar que baixas não foram duplicadas. Requer `.RET` real de HML — se não houver, coordenar com a Columbia para gerar um. Tactic Bass: **Self-Test** + **State Resynchronization**.

- **Resultado Esperado**
  > 3 cenários análogos aos C1/C2/C3 da remessa provados ao vivo: (i) PUT que não confirmou → refaz sem duplicar; (ii) PUT que confirmou mas ledger não fechou → pula `processar`, segue leitura; (iii) arquivo indeterminado → fail-closed com `ConciliacaoEmDuvidaError`. Métrica: cobertura ao vivo da perna de VOLTA passa de 0% para 100% dos ramos de `sincronizarComErp`.

- **Tactic alvo**: Self-Test / State Resynchronization
- **Severidade**: P1
- **Esforço estimado**: M (2–5d) — depende de `.RET` disponível em HML
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Cenários da conciliação provados ao vivo: 0 → 3
  - Ramos de `sincronizarComErp` cobertos por gate real: 0/3 → 3/3
- **Risco de não fazer**: primeira queda entre PUT `processar` e `settle` em produção pode disparar duplicação de baixa no fin010; reconciliação contábil manual e perda de confiança na frente inteira.
- **Dependências**: `.RET` real do Bradesco em HML (bloqueio já sinalizado no gap file)

### [availability-3] Dar UX própria ao `ConciliacaoEmDuvidaError` no frontend

- **Problema**
  > Backend emite 500 com `code: 'CONCILIACAO_EM_DUVIDA'`, mas o cliente não tem classe correspondente. O operador vê um `toast.error('Não foi possível conciliar')` de 5 s, indistinguível de qualquer falha de rede, e é razoável ele clicar de novo. Contrasta com `RemessaEmDuvidaError`, que tem toast dedicado "NÃO repita" com duração de 30 s (`page.tsx:362-370`).

- **Melhoria Proposta**
  > Espelhar a paridade: (a) exportar `ConciliacaoEmDuvidaError` em `src/frontend/lib/sispag.ts` mapeando `body.code === 'CONCILIACAO_EM_DUVIDA'`; (b) no `catch` do `conciliar` em `page.tsx:414`, tratar antes do `toast.error` genérico com título "Conciliação em dúvida — NÃO repita", descrição igual à do backend, e duração 30 s. Tactic Bass: **Exception Detection** completa até a UI.

- **Resultado Esperado**
  > 3 dos 3 erros terminais da frente com UX própria (RemessaEmDuvida, LoteAnteriorCancelado, ConciliacaoEmDuvida). O operador aprende que "em dúvida" é uma classe consistente que exige verificação no ERP, não uma falha temporária de rede.

- **Tactic alvo**: Exception Detection
- **Severidade**: P1
- **Esforço estimado**: S (≤1d) — ~30 linhas
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Erros terminais com UX especializada: 2/3 → 3/3
- **Risco de não fazer**: operador retenta em `CONCILIACAO_EM_DUVIDA` (o serviço protege, mas o hábito de ignorar o alerta se instala) → quando aparecer um caso onde a proteção falhar (F-availability-2 realizado), o operador já está treinado a clicar por cima.
- **Dependências**: nenhuma

### [availability-4] Canal ativo de alerta para o reaper (Slack/email)

- **Problema**
  > Mesmo com o reaper agendado (card availability-1), a saída é `logService.warn` + `console.warn`. Ninguém acompanha stdout do Render nem consulta a tabela `logs` por hábito. O sinal existe mas não vai a quem precisa.

- **Melhoria Proposta**
  > Adicionar ao final do `main()` do reaper: se `total > 0`, disparar `SesClient.sendEmail` para a lista de operadores SISPAG com resumo (contagem, mais antigo, `flpCod`s conhecidos, link direto para `/sispag`). Alternativa: webhook Slack (secret já usável via env). Manter `logService.warn` — não substituir, complementar. Tactic Bass: **Monitor** com escalação ativa.

- **Resultado Esperado**
  > Ciclo de detecção: reaper roda a cada 15 min → achou órfão → email chega em ≤ 1 min → operador abre `/sispag` e trata. MTTR ponta-a-ponta ≤ 20 min em vez de "quando alguém abrir logs".

- **Tactic alvo**: Monitor (com escalação)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Latência entre `atualizado_em` do órfão e email ao operador: ∞ → ≤ 20 min
  - Canais de notificação ativos: 0 → 1
- **Risco de não fazer**: se availability-1 for feito mas este não, órfãos existem no log mas ninguém sabe — MTTR se torna "quando alguém tropeçar".
- **Dependências**: availability-1 (agendar o reaper)

### [availability-5] Unificar `MINUTOS_ORFAO` com o env do reaper

- **Problema**
  > A janela de "órfão" está declarada em duas variáveis independentes: `SispagPainelService.ts:42` (hardcoded 15) e `reaper-sispag-reconciling.ts:28` (`SISPAG_REAPER_MIN ?? 15`). Alterar uma sem a outra deixa painel e reaper divergentes em incidente.

- **Melhoria Proposta**
  > Ler `SISPAG_REAPER_MIN` também no `SispagPainelService` via `EnvironmentProvider` (não `process.env` cru — Rule #8). Manter default 15 e documentar no `render.yaml` como env opcional. Tactic Bass: **Reconfiguration** com fonte única.

- **Resultado Esperado**
  > Uma única variável controla painel e reaper. Ajustar de 15 para 5 min durante fechamento passa a ser um único toggle no dashboard do Render, sem redeploy.

- **Tactic alvo**: Reconfiguration
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-5
- **Métricas de sucesso**:
  - Pontos de configuração da janela de órfão: 2 → 1
  - Divergência painel-vs-reaper possível: sim → não
- **Risco de não fazer**: mudança de janela em incidente vira caça a inconsistência entre "o que a tela mostra" e "o que o reaper detecta".
- **Dependências**: nenhuma

### [availability-6] Tipar o motivo do "indeterminado" no ledger para escalar ambíguos

- **Problema**
  > Quando `adotarPorMarcaDagua` acha >1 candidato (`RemessaService.ts:713-720`), o motivo textual fica só no log; o `RemessaEmDuvidaError` levantado depois não carrega os `flpCod` ambíguos. O retry seguinte cai no mesmo veredito, e o reaper não sabe diferenciar "sem marca" (queda antiga, sem pista) de "dois candidatos, precisa decidir" — ambos aparecem como `reconciling` genérico.

- **Melhoria Proposta**
  > (a) Persistir o `motivo` estruturado (`sem_marca` | `ambiguo` | `sem_candidato` | `intruso`) em `remessa_execucao.request_payload.retomadaMotivo`. (b) Incluir os `flpCod` candidatos no `RemessaEmDuvidaError.details` para o operador ver na tela. (c) Reaper diferencia o warn: "AMBÍGUO: decida entre flp X ou Y" vs "SEM PISTA: varra o fin015 desde criadoEm". Tactic Bass: **Escalating Restart** adaptada — quando o auto-recovery esgota, escala com o mínimo de contexto necessário.

- **Resultado Esperado**
  > Operador clica em "gerar remessa", recebe "flp 39 ou flp 41 — cancele o errado no fin015", resolve em minutos em vez de abrir suporte. Reaper alerta com classe de motivo. Métrica: 0% de casos "em dúvida" que exigem escavar log do Render para diagnosticar.

- **Tactic alvo**: Escalating Restart / Exception Detection
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-availability-6
- **Métricas de sucesso**:
  - Casos "em dúvida" com contexto suficiente na UI para decisão: 0% → 100%
  - Classes de motivo distinguíveis no ledger: 1 (`reconciling` opaco) → 4 (`sem_marca`/`ambiguo`/`sem_candidato`/`intruso`)
- **Risco de não fazer**: cenário raro, mas quando ocorrer, custa uma janela de suporte por não haver contexto acessível ao operador.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo restrito ao delta `da2714e..HEAD`: não avaliei race condition de duplo-clique concorrente pré-`beginExecution` (existia antes do delta; o retomada agora *recupera* dela, mas não *previne*). Se virar risco em produção, é um card à parte.
- Cross-QA: F-availability-2 (perna de VOLTA sem gate ao vivo) é também finding de **testability** e **fault-tolerance** — o consolidator deve evitar contagem tripla. Igualmente F-availability-3 (UX de `ConciliacaoEmDuvidaError`) pode aparecer em **integrability**/**usabilidade**.
- MTTR real e taxa de retomada em produção não são medíveis localmente: dependeriam de CloudWatch/Render logs + métrica emitida pelo `LogService`. Recomendação implícita nos cards availability-1 e availability-4.
- Score 7/10: os fundamentos estão sólidos (retomada empiricamente comprovada na IDA, transactions, kill-switch, exception detection tipado), mas o principal loop ativo de detecção (reaper) não está fechado em produção, e a perna de VOLTA carece do mesmo gate ao vivo da IDA.
