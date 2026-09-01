---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-01-1944
agent: qa-fault-tolerance
generated_at: 2026-09-01T19:44:00-03:00
scope: all
score: 7
findings_count: 4
cards_count: 4
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Conexos `fin015` (leitura do grid `finItemSispag/list`) | falha intermitente (timeout / 5xx / SID expirado) ou dado degradado (linha digitável fora de formato/DV) | `ConexosSispagWriteClient.listarLinhasDigitaveisDoLote` → `SispagPainelService.linhasDigitaveisDoLote` → `GET /sispag/lotes/:id/linhas-digitaveis` → `LoteCard.tsx` | operação normal, analista com o card do lote aberto e prestes a copiar a linha digitável para o app do banco | (a) cliente distingue "falha" de "vazio" (throw vs `[]`); (b) service degrada para `[]` + `BUSINESS_WARN` para não derrubar o card; (c) UI omite o botão de copiar; (d) linha degradada NUNCA vira `""` e NUNCA vai para o clipboard sem passar por sanity checking | 0 pagamentos em boleto errado; 100% das falhas rastreáveis no log de operador; sem "fantasma" (linha digitável exibida com DV inválido) |

> Este delta é **100% leitura**. Não há escrita nova no ERP, migration, ou estado persistido — as métricas clássicas de fault tolerance de write (idempotência, transação, DLQ, dual-write, outbox) **não se aplicam ao delta**. O que se aplica é a doutrina de tratamento de degradação **em três camadas com contratos distintos**.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Client throws `ConexosError` em falha (não devolve `[]`) | sim | sim | ✅ | `src/backend/domain/client/ConexosSispagWriteClient.ts:432-436` (catch → `toConexosError`) |
| Client usa `runWithRetry` na leitura | sim | sim | ✅ | `src/backend/domain/client/ConexosSispagWriteClient.ts:410` |
| Service documenta "nunca lança" e converte em `BUSINESS_WARN` | sim | sim | ✅ | `src/backend/domain/service/sispag/SispagPainelService.ts:248-263` |
| Log de falha do service omite a linha digitável | sim (só `loteId`/`flpCod`/`motivo`) | sim | ✅ | `SispagPainelService.ts:255-262` + teste `SispagPainelService.test.ts` ("nunca loga a linha digitável completa") |
| Sanity checking da resposta com Zod | sim, `LINHA_DIGITAVEL_SCHEMA` | sim | ✅ | `ConexosSispagWriteClient.ts:69-85` |
| Contagem de itens omitidos pelo Zod é logada | **não** — `continue` silencioso | logar se `dropped > 0` | ❌ | `ConexosSispagWriteClient.ts:422-424` |
| Validação de DV da linha digitável (47 díg. — módulo 10 dos 3 blocos + módulo 11 geral) | **não** — só regex de formato `/^\d{47}$/` | validar DV, análoga a `RemessaCnabValidator.dvBarrasValido` | ❌ | `ConexosSispagWriteClient.ts:83` vs `src/backend/domain/libs/cnab/RemessaCnabValidator.ts:74-88` |
| Rascunho evita ida ao ERP (curto-circuito) | sim | sim | ✅ | `SispagPainelService.ts:246` (`nativeFlpCod == null → []`) |
| Frontend sinaliza falha de fetch para o usuário | **não** — `.catch → Map()` silencioso | sinal discreto (toast/badge) quando o lote ESTÁ em `REMESSA_GERADA` e a leitura falhou | ⚠️ parcial | `src/frontend/app/sispag/components/LoteCard.tsx:163-166` |
| Frontend evita race condition em unmount (`vivo` flag) | sim | sim | ✅ | `LoteCard.tsx:154-171` |
| Guarda de autorização na rota | `requireRole('admin')` | `admin` | ✅ | `src/backend/routes/sispag.ts:66` |
| Idempotência do handler (POST/PUT dedupe) | N/A — GET puro, sem side-effect | N/A | N/A | `sispag.ts:70` |
| Cobertura de teste do caminho de falha (client `.rejects`, service `[]`+`warn`) | 5 testes novos: falha do grid vira `ConexosError`; rascunho não bate ERP; falha do ERP vira `[]`+`warn`; log não vaza linha completa | ≥ 1 teste por ramo de degradação | ✅ | `ConexosSispagWriteClient.test.ts:499-566`, `SispagPainelService.test.ts:390-457` |

> ⚠️ **Não medível localmente**: incidência real de linhas digitáveis degradadas pelo `fin015` em produção. Requer inspeção do log `BUSINESS_WARN` no ambiente Render + análise dos `.REM` reais (61 segmentos J históricos, mesma base do ADR-0040). Recomendação: quando existir CloudWatch/agregador, contar `linhasDigitaveisDoLote: leitura do fin015 falhou` por período.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Avoid Faults — Substitution | N/A — não há redundância planejada para o `fin015` (fonte única do dado) | N/A | — |
| Detect Faults — Sanity Checking | Zod `LINHA_DIGITAVEL_SCHEMA` valida **formato** (47 dígitos); **DV não é verificado** | ⚠️ parcial | `ConexosSispagWriteClient.ts:69-85` — falta contraparte de `RemessaCnabValidator.dvBarrasValido` para 47 díg. |
| Detect Faults — Timeout | Herdado do `ConexosBaseClient.runWithRetry` / `listGenericPaginated` (não parametrizado neste delta) | ✅ | `ConexosSispagWriteClient.ts:410` |
| Detect Faults — Condition Monitoring | Não há métrica de "linhas omitidas por Zod por chamada" — `continue` silencioso | ❌ | `ConexosSispagWriteClient.ts:423-424` |
| Detect Faults — Comparison / Voting | N/A — fonte única (Conexos), sem espelho local | N/A | — |
| Contain Faults — Recovery (forward) | Serviço absorve toda exceção → `[]` + `BUSINESS_WARN`. UI degrada omitindo o botão de copiar | ✅ | `SispagPainelService.ts:250-263`; `LoteCard.tsx:163-166` |
| Contain Faults — Redundancy | N/A — leitura idempotente sem estado, não requer réplica | N/A | — |
| Recover State — Rollback | N/A — sem mutação | N/A | — |
| Recover State — Compensating Transaction | N/A — sem escrita | N/A | — |
| Recover State — Idempotent Replay | Leitura é idempotente por natureza; `useEffect` refaz o fetch quando o card é reaberto | ✅ | `LoteCard.tsx:155` |
| Recover State — Reconcile | N/A neste delta (não há estado local para reconciliar); reconciliação DDA continua em `ConexosSispagWriteClient.listarTitulosComBoletoDda` | N/A | — |
| Recover State — Quarantine | Item que falha o Zod é **omitido** silenciosamente (equivalente a quarentena, mas sem trilha) | ⚠️ parcial | `ConexosSispagWriteClient.ts:423-424` |
| Recover State — Repair State | N/A — leitura | N/A | — |
| Contain Faults — Reintroduction (State Resync) | Reabrir o card refaz o `useEffect`, ressincronizando a partir do ERP | ✅ | `LoteCard.tsx:155,167-170` |

## 4. Findings

### F-fault-tolerance-1: Doutrina de "falha ≠ vazio" do client é apagada no service, e o usuário não tem SINAL de que o fetch falhou

- **Severidade**: P2
- **Tactic violada**: Detect Faults — Condition Monitoring (no front)
- **Localização**:
  - `src/backend/domain/service/sispag/SispagPainelService.ts:250-263` (catch-all → `[]`)
  - `src/frontend/app/sispag/components/LoteCard.tsx:163-166` (`.catch(() => setLinhas(new Map()))`)
- **Evidência (objetiva)**:
  ```typescript
  // client — preserva a distinção
  } catch (cause) {
      throw this.toConexosError(path, cause);
  }
  // service — apaga a distinção
  } catch (err) {
      await this.logService.warn({ type: LOG_TYPE.BUSINESS_WARN, ... });
      return [];
  }
  // frontend — apaga tudo
  .catch(() => { if (vivo) setLinhas(new Map()) })
  ```
- **Impacto técnico**: usuário vê o MESMO estado em três cenários distintos — (a) nenhum item tem boleto, (b) ERP oscilou, (c) resposta veio malformada. A analista que SABE que o lote é DDA e vê "sem botão de copiar" não tem como distinguir "estágio" de "erro". O rastro operator-side está preservado (`BUSINESS_WARN` com `loteId`+`flpCod`+`motivo`) — mas o usuário final decide sem esse sinal.
- **Impacto de negócio**: em lote com dezenas de itens DDA, se o `fin015` oscilou uma vez, a analista pode assumir "nenhum item aqui é DDA de verdade" e recorrer ao caminho manual (2ª via de e-mail) → retrabalho silencioso. Sem instrumentação, isso não aparece em métrica. Compensação: o log existe e o operador consegue investigar sob demanda.
- **Métrica de baseline**: 0% dos cenários de falha do fetch geram feedback ao usuário (0/3 ramos de estado observáveis).

> **Nota**: a decisão do **service** de nunca lançar É defensável — este é um botão de conveniência; derrubar o card inteiro por causa dele seria pior. A crítica é da **camada de UI**, que deveria discriminar minimamente "estágio vazio legítimo" de "falha ao ler". O client está certo em preservar a distinção; a UI é que deveria consumi-la em vez de ignorar.

### F-fault-tolerance-2: Item omitido pelo Zod é indistinguível de item sem boleto — sem rastro, sem contagem

- **Severidade**: P1
- **Tactic violada**: Detect Faults — Condition Monitoring; Recover State — Quarantine (sem trilha)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:422-424`
- **Evidência (objetiva)**:
  ```typescript
  for (const row of page.rows ?? []) {
      const parsed = LINHA_DIGITAVEL_SCHEMA.safeParse(row);
      if (!parsed.success) continue;   // silent drop, no count
      itens.push({ ... });
  }
  ```
- **Impacto técnico**: se o Conexos passar a devolver rows com formato diferente (schema drift, mudança de layout, campo faltando), ou se um batch de barcodes chegar corrompido, os itens somem sem sinal. É EXATAMENTE a classe de defeito da ADR-0040 — "campo silenciosamente degradado" — reintroduzida num lugar novo (uma leitura), com uma cara diferente (`continue` em vez de `?? ''`). O regime "vazio-com-boleto" é indistinguível de "vazio-porque-deu-erro-de-parse-nos-3-que-tinham".
- **Impacto de negócio**: a analista abre o lote, vê que só 2 dos 5 itens DDA têm botão de copiar, e não tem como saber se os outros 3 (i) não têm boleto de verdade, ou (ii) tiveram algo estranho no `fin015`. Sem contador, ninguém acha esse tipo de degradação até virar chamado.
- **Métrica de baseline**: 0 logs emitidos por linhas omitidas / N chamadas ao `fin015`. Deveria ser `> 0` na presença de degradação — e a chamada não tem como emitir esse número.

### F-fault-tolerance-3: Regex `/^\d{47}$/` valida FORMATO, não DV — linha digitável errada pode chegar ao clipboard

- **Severidade**: P1
- **Tactic violada**: Detect Faults — Sanity Checking
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:83` (schema) e ausência em `SispagPainelService.linhasDigitaveisDoLote` / rota
- **Evidência (objetiva)**:
  ```typescript
  itsNumCodbar: z.string().regex(/^\d{47}$/),   // FORMATO apenas
  ```
  Contraste com o que já existe no repo para as 44 posições do CNAB:
  ```typescript
  // src/backend/domain/libs/cnab/RemessaCnabValidator.ts:74-88
  public dvBarrasValido = (barras: string): boolean => {
      if (!/^\d{44}$/.test(barras)) return false;
      // ... módulo 11, pesos 2..9 ...
  };
  ```
- **Impacto técnico**: a linha digitável de 47 dígitos tem **quatro** DVs próprios: três módulo-10 (posições 5, 11, 17 dos três primeiros blocos) + o módulo-11 geral (posição 33). Nenhum é checado aqui. Se o `fin015` devolver um `itsNumCodbar` truncado, com um dígito trocado, ou remontado errado a partir do `ditEspCodbar` (44 díg.), a string passa o regex, vai ao frontend, vai ao clipboard e a analista cola no app do banco. A `RemessaCnabValidator` existe **exatamente** porque "o ERP não deveria produzir barras erradas, mas produziu" — e o exemplo real citado no próprio validator (`fil 2, PG121101.REM, R$ 37.567,14`) prova que essa hipótese não é acadêmica. Mas essa validação só roda na **geração da remessa** — na LEITURA (este caso) ninguém checa.
- **Impacto de negócio**: **pagamento no boleto errado ou rejeição do banco.** O primeiro é indistinguível do fluxo feliz até virar diferença de conciliação; o segundo é ruído. Em ambos, a defesa "o banco recusa DV errado" transfere a responsabilidade — mas o banco recusa depois de ter recebido, e a analista já sinalizou "pago" mentalmente. Cadeia com humano no loop atenua, não elimina.
- **Métrica de baseline**: 0/47 dígitos verificados por checksum (0% de cobertura de DV); 44/44 checados no fluxo simétrico da remessa (100% via `RemessaCnabValidator`). A assimetria é o gap.

### F-fault-tolerance-4: Lote em `REMESSA_GERADA` com `nativeFilCod/Bnc/Flp` nulo retorna `[]` sem `WARN` — inconsistência de estado silenciosa

- **Severidade**: P2
- **Tactic violada**: Detect Faults — Sanity Checking (invariante de state machine)
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:245-247`
- **Evidência (objetiva)**:
  ```typescript
  const { nativeFilCod, nativeBncCod, nativeFlpCod } = lote;
  if (nativeFilCod == null || nativeBncCod == null || nativeFlpCod == null) return [];
  ```
- **Impacto técnico**: em RASCUNHO isso é o comportamento correto — curto-circuito, sem chamada ao ERP. Mas se um lote em `REMESSA_GERADA` chegar aqui com algum dos três nulos (bug de escrita, migration incompleta, reprocessamento inconsistente), o método devolve `[]` como se fosse "não há boletos" — o mesmo símbolo de "estágio rascunho" mascara uma **quebra de invariante**. Sem log, ninguém enxerga.
- **Impacto de negócio**: baixo agora (não é caminho quente), mas a state machine do lote é o cerne do SISPAG e qualquer erosão silenciosa vira dívida difícil de encontrar depois. Regra do ADR-0040 aplicada aqui: "campo silenciosamente ausente é a mesma classe de defeito que campo silenciosamente degradado".
- **Métrica de baseline**: 0 logs quando `status ∈ {REMESSA_GERADA, ENVIADO, RETORNO, CONCILIADO}` e algum `native*` é nulo.

## 5. Cards Kanban

### [fault-tolerance-1] Sinalizar falha de leitura da linha digitável para a analista

- **Problema**
  > O client preserva com cuidado a distinção "falhou vs vazio" (throw `ConexosError` vs `[]`), mas essa informação é apagada no service (`try/catch → []`) e novamente no frontend (`.catch → Map()`). A analista que abre um lote DDA sem botões de copiar não sabe se (a) nenhum item é DDA, (b) o ERP oscilou, ou (c) a resposta veio malformada. O log operator-side existe (`BUSINESS_WARN`), mas a UI é cega.

- **Melhoria Proposta**
  > No `LoteCard.tsx`, dentro do `.catch` do `fetchLinhasDigitaveis`, distinguir "sem dados" de "erro" com um estado `'idle' | 'ok' | 'fail'` (setar `'fail'`). Renderizar um badge/ícone discreto ao lado do rótulo `boleto` quando `status === 'fail'`, com `title="Não foi possível ler as linhas digitáveis — tente reabrir o lote"`. Nenhum toast intrusivo (é uma conveniência, não uma ação). Tactic alvo: Detect Faults — Condition Monitoring na camada de apresentação.

- **Resultado Esperado**
  > A analista tem sinal visual de "isto não é o estágio, é um erro" sem precisar do log do backend. Cobertura de ramos observáveis: 0/3 → 2/3 (o terceiro — "malformado no client" — não sobe para o front por design, e assim está bom).

- **Tactic alvo**: Detect Faults — Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Ramos de falha do fetch com feedback ao usuário: 0/3 → 2/3
  - Novo teste em `LoteCard`: com `fetchLinhasDigitaveis` rejeitando, o badge de "falha" aparece.
- **Risco de não fazer**: retrabalho silencioso (analista recorre ao caminho manual quando o DDA está pronto mas o fetch falhou); indistinguível de "não é DDA".
- **Dependências**: nenhuma.

### [fault-tolerance-2] Logar contagem de linhas digitáveis descartadas pelo Zod

- **Problema**
  > O laço do `listarLinhasDigitaveisDoLote` faz `continue` silencioso quando o `safeParse` falha (linha não é 47 dígitos, `docCod` faltando, etc.). Se o Conexos passar a devolver rows com layout novo, os itens somem sem trilha. É a classe de defeito da ADR-0040 reintroduzida num lugar novo — com cara de `continue` em vez de `?? ''`.

- **Melhoria Proposta**
  > No próprio client, contar o número de descartes por chamada e, quando `dropped > 0`, emitir um `CONEXOS_DEBUG` (ou `BUSINESS_WARN` se `dropped / total > 0.5`) com `{ path, total, dropped }`. **Não logar as rows descartadas** (podem conter dado sensível). Alternativa: retornar `{ itens, dropped }` do client e deixar o service decidir o log — mantém a camada baixa sem `logService`. Tactic alvo: Detect Faults — Condition Monitoring.

- **Resultado Esperado**
  > Qualquer degradação de schema no `fin015` deixa rastro operator-side; hoje o rastro é zero. Ao rodar sobre o histórico, esperar `dropped == 0` para 100% das chamadas em cenário saudável.

- **Tactic alvo**: Detect Faults — Condition Monitoring / Recover State — Quarantine (com trilha)
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Chamadas com `dropped > 0` que emitem log: 0% → 100%
  - Teste novo no client: 5 rows, 2 malformadas → 3 itens + 1 chamada de log com `dropped: 2`.
- **Risco de não fazer**: repetir a ADR-0040 num flanco novo — degradação silenciosa que só aparece quando a analista reclama.
- **Dependências**: nenhuma.

### [fault-tolerance-3] Validar o DV da linha digitável (47 díg.) antes de devolver ao frontend

- **Problema**
  > A linha digitável tem 4 DVs próprios (três módulo-10 nos blocos + módulo-11 geral). O schema atual valida apenas o formato (`/^\d{47}$/`). Se o `fin015` retornar uma string truncada/corrompida, ela passa, vai ao clipboard, e a analista paga o boleto errado. O simétrico da geração (`RemessaCnabValidator.dvBarrasValido`) valida os 44 dígitos do código de barras justamente porque "o ERP não deveria errar, mas erra" — a assimetria entre escrita (validada) e leitura (não validada) é o gap.

- **Melhoria Proposta**
  > Adicionar em `src/backend/domain/libs/cnab/` (ou junto do `RemessaCnabValidator`) uma função `linhaDigitavelDvValida(linha: string): boolean` que verifica os 3 DVs módulo-10 (posições 5, 11, 17 relativas a cada bloco) e o DV módulo-11 geral (posição 33). No `LINHA_DIGITAVEL_SCHEMA`, encadear `.refine(linhaDigitavelDvValida, 'DV inválido')`. Item que falha o DV é **omitido** — mesma disciplina do regex falhado — e alimenta o contador do card fault-tolerance-2. Tactic alvo: Detect Faults — Sanity Checking (com paridade escrita/leitura).

- **Resultado Esperado**
  > Cobertura de DV da linha digitável: 0% → 100%. Simetria com o fluxo de escrita (que valida 100% dos 44 díg. do barcode CNAB). Uma linha digitável entregue ao clipboard é matematicamente consistente ou não é entregue.

- **Tactic alvo**: Detect Faults — Sanity Checking
- **Severidade**: P1
- **Esforço estimado**: S (≤1d) — algoritmo bem definido, testes com vetores conhecidos.
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Dígitos verificados por checksum: 0/47 → 47/47
  - Novo teste: linha digitável real (das 61 de produção do ADR-0040) → aceita; mesma linha com 1 dígito trocado → rejeitada; linha com todos zeros → rejeitada.
  - Contador de descartes por DV inválido no log (via card fault-tolerance-2).
- **Risco de não fazer**: pagamento no boleto errado se o `fin015` degradar um `itsNumCodbar` — a defesa "o banco recusa" transfere responsabilidade, não a elimina, e o custo do incidente (dinheiro público na conta errada, reversão manual, quebra de confiança da analista no botão) desloca qualquer economia de esforço.
- **Dependências**: idealmente vai junto do card fault-tolerance-2 (mesmo arquivo, mesma disciplina).

### [fault-tolerance-4] Distinguir "rascunho legítimo" de "invariante quebrada" no `linhasDigitaveisDoLote`

- **Problema**
  > O `if (nativeFilCod == null || nativeBncCod == null || nativeFlpCod == null) return [];` é correto para RASCUNHO (curto-circuito). Mas se um lote em `REMESSA_GERADA/ENVIADO/RETORNO/CONCILIADO` chegar com algum dos três nulos (bug de escrita, migration incompleta), a mesma linha devolve `[]` como se fosse estágio — mascarando quebra de invariante da state machine.

- **Melhoria Proposta**
  > Antes do return, checar o `status` do lote. Se `status === 'RASCUNHO'`, `[]` sem log (comportamento atual). Caso contrário, emitir `BUSINESS_WARN` com `{ loteId, status, missing: ['nativeFilCod'?, 'nativeBncCod'?, 'nativeFlpCod'?] }` e continuar retornando `[]` (o botão não aparece, o card não quebra) — mas o rastro fica. Tactic alvo: Detect Faults — Sanity Checking de invariantes de state machine.

- **Resultado Esperado**
  > Qualquer erosão silenciosa da relação `status ≥ REMESSA_GERADA ⇒ native* != null` é detectada operator-side. Cobertura: 0 → 1 invariante monitorada.

- **Tactic alvo**: Detect Faults — Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Invariantes de state machine monitoradas em `linhasDigitaveisDoLote`: 0 → 1
  - Novo teste: lote em `REMESSA_GERADA` com `nativeFlpCod == null` → `[]` + `log.warn` chamado com `missing: ['nativeFlpCod']`.
- **Risco de não fazer**: baixo agora, mas a state machine do lote é o cerne do SISPAG; erosão silenciosa vira dívida difícil de encontrar depois.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Delta é 100% leitura — descartei métricas clássicas de write (idempotência de SQS, transação DB+ERP, DLQ, outbox) por vacuidade e registrei o motivo no cenário. As tactics de recovery de estado (Rollback, Compensating Transaction, Repair State) são todas N/A neste delta.
- A **doutrina inconsistente entre camadas é defensável**: o client acerta em preservar "falha ≠ vazio" (nível baixo, contrato máximo); o service acerta em não derrubar o card por causa de um botão de conveniência (nível alto, degradação graciosa). O que sobra é o gap de UX: o **frontend deveria** consumir a distinção que o service já tem no `BUSINESS_WARN` (card fault-tolerance-1). Não é doutrina errada, é doutrina truncada uma camada antes do usuário.
- Cross-QA:
  - **Security / Privacidade**: o log do service já omite a linha digitável completa (teste explícito verifica). A rota já exige `admin` (LGPD/LC-105 mencionadas no comentário). Bom estado — sinalizar para `qa-security` que este caminho está alinhado.
  - **Integrability**: card fault-tolerance-3 (DV da linha digitável) é irmão do `RemessaCnabValidator` — mesma família de sanity checking sobre payload do Conexos; `qa-integrability` deveria mencionar a assimetria escrita-validada / leitura-não-validada.
  - **Testability**: os 5 testes novos do caminho de degradação (rejects, `[]`+warn, log-não-vaza, rascunho, formato-omitido) cobrem bem os ramos EXISTENTES. Cards fault-tolerance-2/3 pedem 2 testes novos (contagem de dropped, vetor de DV). Rotina.
