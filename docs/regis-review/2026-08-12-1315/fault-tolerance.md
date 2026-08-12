---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-08-12-1315
agent: qa-fault-tolerance
generated_at: 2026-08-12T13:15:00-03:00
scope: backend
score: 7
findings_count: 6
cards_count: 5
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

Delta em revisão: nova etapa 3.5 da cauda fiscal da NDe (`RecebimentoNumerarioService.etapaDescricaoItem`
+ `ConexosNdeFiscalClient.{listItensNde,lerItemNde,preDescricaoProdutoNf,gravarDescricaoItemNde}`).
Read-modify-write sobre `com297/comDocProdutos` para gravar `dprLngDescrNf` (o `xProd` da NF-e)
quando o ERP a deixou vazia por causa da regra `cmn025.dpeVld1DescrNfe=4` do cliente.

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Automação (`processarAlocacao`) rodando entre `etapaNotaDebito` e `etapaFiscal` | ERP materializou o item da NDe com `dprLngDescrNf` VAZIA (cadastro do cliente = "4 - Descrição DI") | `com297/comDocProdutos` (RMW no ITEM da NDe já gerada) | Produção, tenant Columbia, cliente com cadastro incompatível; documento AINDA NÃO homologado | Ler item, resolver texto (env → `preDescrProdutoNf` → `prdDesNome` → default), PUT com objeto INTEIRO, exigir eco não-vazio, seguir para `etapaFiscal`. Falha ⇒ fail-closed (`markError`) ANTES do com300/com131/homologar | 0 NDes homologadas com descrição vazia; 0 documentos com item corrompido pelo RMW; retomada de execuções paradas em `obs-done` conserta sem intervenção. Métrica no-op esperada: 100% p/ clientes com `dpeVld1DescrNfe ∈ {0,1,2}` (nada muda), PUT p/ clientes em `{3,4,5,6}` |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escrita no ERP posicionada ANTES de operação irreversível (com300, com131, homologar) | Sim — chamada na linha 455 do service, antes das linhas 456-460 | 100% das novas escritas com contra-efeito difícil | ✅ | `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:451-1507` |
| Discriminador de sucesso explícito no PUT (não confia em HTTP 200) | Sim — `textoOuIndefinido(eco.dprLngDescrNf) === undefined ⇒ throw` | 100% dos writes fiscais | ✅ | `src/backend/domain/client/ConexosNdeFiscalClient.ts:405-413` |
| Tentativa única (`putGenericOnce`, sem retry) no RMW | Sim | Obrigatório em RMW (retry cega perde a versão) | ✅ | `ConexosNdeFiscalClient.ts:399` |
| Recusa client-side de descrição vazia ANTES do PUT | Sim — `descricao === '' ⇒ throw` | 100% (evita gravar o próprio bug) | ✅ | `ConexosNdeFiscalClient.ts:390-396` |
| Truncamento aplicado ANTES do envio (nunca depois) | Sim, `slice(0, 4000)` em code units JS | Byte-safe (Oracle VARCHAR2(4000 BYTE)) | ⚠️ | `ConexosNdeFiscalClient.ts:389` — ver F-fault-tolerance-2 |
| Gate anti-mutação pós-emissão (`etapaAtingida('homologado')`) | Presente | Obrigatório (NF-e emitida é irreversível) | ✅ | `RecebimentoNumerarioService.ts:1456` |
| Auto-idempotência por estado do documento (sem etapa própria no ledger) | Presente — `dprLngDescrNf !== undefined ⇒ continue` | Explícito e testado | ✅ | `RecebimentoNumerarioService.ts:1477` + teste `RecebimentoNumerarioService.test.ts:1551-1563,1658-1691` |
| Cobertura de testes do delta (unit + integração de rota) | 9 casos em `RecebimentoNumerarioService.test.ts:1526-1692` + 6 cliente + sonda read-only | ≥6 caminhos (feliz, no-op, retomada, homologada, sem item, fail-closed) | ✅ | `RecebimentoNumerarioService.test.ts:1526-1692`, `ConexosNdeFiscalClient.test.ts:127-258` |
| Otimistic-concurrency / version check no RMW (item vs. eco) | Ausente — RMW não carrega `dprCodAlt`/timestamp/ETag | Presente ou justificado explicitamente | ❌ | Ver F-fault-tolerance-1 |
| Truncamento consciente de bytes UTF-8 | Ausente — `slice` corta em code units | Corte por `Buffer.byteLength` ≤ limite do BD | ❌ | Ver F-fault-tolerance-2 |
| Persistência da correção no ledger (audit-trail rastreável) | Apenas WARN log — nenhuma linha nova em `solicitacao_numerario_execucao` para "descricao gravada" | Toda mutação em ERP → linha persistida (cross-QA com Security) | ⚠️ | `RecebimentoNumerarioService.ts:1491-1505` |
| Cobertura de teste "documento sem itens" | Teste segue com WARN (linha 1648) | Decisão explícita: bloquear ou seguir | ⚠️ | `RecebimentoNumerarioService.test.ts:1648-1656` — ver F-fault-tolerance-3 |
| Teste de concorrência (duas execuções simultâneas da mesma alocação disputando o mesmo item) | Ausente | Presente ou risco documentado | ⚠️ | Ver F-fault-tolerance-4 |

> ⚠️ **Não medível localmente**: taxa real de NDes com `dprLngDescrNf` vazia por cliente. Requer sonda
> em produção (`recebimentos.e2e.descricaoNfeNde.integration.test.ts` já existe read-only). Recomendação:
> rodar no tenant após o deploy p/ produzir métrica de baseline "% de execuções em que a etapa 3.5 escreve".

> ⚠️ **Não medível localmente**: taxa de conflito com edição humana concorrente do item durante a
> automação. Requer amostragem de logs em produção após o deploy.

## 3. Tactics — Cobertura no nf-projects

Escopo: apenas as tactics relevantes para o delta (etapa 3.5). Tactics do fluxo geral já cobertas em
revisões anteriores do serviço são referenciadas mas não re-auditadas aqui.

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Avoid Faults · Substitution | Truncamento em 4000 caracteres antes do PUT (evita rejeição do ERP). Recusa client-side de descrição vazia. | ⚠️ parcial | `ConexosNdeFiscalClient.ts:389-396` — corte por code units, não bytes (F-fault-tolerance-2) |
| Detect Faults · Sanity Checking | Zod `.passthrough()` valida shape do item e do eco; discriminador explícito `textoOuIndefinido(eco.dprLngDescrNf) === undefined ⇒ throw` | ✅ presente | `ConexosNdeFiscalClient.ts:68-77,404-413` |
| Detect Faults · Comparison | Eco do PUT é comparado apenas por "não-vazio", não por igualdade com o enviado — decisão consciente (ERP pode normalizar). Ausência de versão/ETag no RMW. | ⚠️ parcial | `ConexosNdeFiscalClient.ts:378-381`; ver F-fault-tolerance-1 e F-fault-tolerance-6 |
| Detect Faults · Timeout | Herdado do `ConexosBaseClient` (timeout global do axios) | ✅ presente | N/A no delta |
| Detect Faults · Condition Monitoring | Gate `etapaAtingida(existente, 'homologado')` — nunca mexe em NDe já emitida. `dprLngDescrNf !== undefined` como condição de skip. | ✅ presente | `RecebimentoNumerarioService.ts:1456,1477` + teste `1676-1691` |
| Detect Faults · Self-Test | Sonda read-only `recebimentos.e2e.descricaoNfeNde.integration.test.ts` valida hipótese em campo | ✅ presente | `src/backend/routes/recebimentos.e2e.descricaoNfeNde.integration.test.ts` |
| Contain Faults · Redundancy (RMW) | GET item inteiro + PUT item inteiro (mesma doutrina do com300) — Zod `.passthrough()` preserva ~105 campos | ✅ presente | `ConexosNdeFiscalClient.ts:66-77,314-315,399-402` |
| Contain Faults · Recovery (forward) | Descrição gravada permanece; execuções futuras da mesma alocação viram no-op pelo estado do documento | ✅ presente | `RecebimentoNumerarioService.ts:1477`; teste retomada `1658-1674` |
| Recover State · Rollback | N/A — o passo é intencionalmente sem rollback (é uma correção positiva; anular seria pior). Posicionado ANTES da homologação (irreversível), então "rollback" é "morrer sem homologar". | N/A | Documentado em `etapaDescricaoItem` docstring (linha 1447-1449) |
| Recover State · Idempotent Replay | Auto-idempotente pelo estado do documento — sem etapa própria no ledger (decisão explícita para o caso de retomada de `obs-done`) | ✅ presente | `RecebimentoNumerarioService.ts:1441-1445` + teste `1658-1674` |
| Recover State · Compensating Transaction | N/A — se a etapa falhar, `registrarFalha` marca `markError`, e o próximo `processarAlocacao` retoma. Nada foi feito no ERP que precise ser desfeito. | N/A | `RecebimentoNumerarioService.ts:489-491,1753-1788` |
| Recover State · Repair State | O passo INTEIRO é uma repair-state action — conserta `dprLngDescrNf` ausente que o ERP deixou vazio | ✅ presente | ADR-0036 |
| Recover State · Audit Trail | Apenas WARN log — nenhuma linha nova no ledger própria da correção. Diverge do invariante-proposta "toda mutação → audit persistido". | ⚠️ parcial | `RecebimentoNumerarioService.ts:1491-1505`; ver F-fault-tolerance-5 |
| Avoid Faults · Predictive Model (pré-flight leitura de `dpeVld1DescrNfe`) | Sugerido no diagnóstico (`_inbox/nde-descricao-produto-nfe-diagnostico.md:132-135`) mas NÃO implementado nesta fatia | ❌ ausente | Fora do escopo do delta (aceito) |

## 4. Findings (achados)

### F-fault-tolerance-1: RMW sem controle de concorrência otimista pode destruir edições concorrentes do item

- **Severidade**: P1
- **Tactic violada**: Detect Faults · Comparison (versão/ETag ausente)
- **Localização**: `src/backend/domain/client/ConexosNdeFiscalClient.ts:298-320,383-419` + `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1476-1490`
- **Evidência (objetiva)**:
  ```typescript
  // service:1479-1490
  const completo = await this.fiscalClient.lerItemNde({ ... });
  const eco = await this.fiscalClient.gravarDescricaoItemNde({ filCod, item: completo, descricao });
  // client:399-402
  const raw = await this.base.putGenericOnce<unknown>(
      'com297/comDocProdutos',
      { ...item, dprLngDescrNf: descricao },
      { filCod },
  );
  ```
  O item vem do GET (`lerItemNde`), a descrição é substituída, o objeto INTEIRO volta pelo PUT. Não há
  `If-Match`/`dprCodAlt`/timestamp/version — o PUT não sabe se o item mudou entre o GET e o PUT.
- **Impacto técnico**: se um analista editar o item no UI do Conexos (ou uma segunda execução da mesma
  alocação rodar em paralelo) entre `lerItemNde` e `gravarDescricaoItemNde`, o PUT reescreve o item
  INTEIRO com os campos que a automação leu — **destruindo silenciosamente qualquer alteração
  concorrente em qualquer campo do item** (`dprPreValorun`, `ctpCod`, `prdQtdQuantidade`, etc.), não
  apenas `dprLngDescrNf`. A janela é curta (milissegundos) mas o fluxo é human-in-the-loop por
  design — o analista ATIVO no doc é a norma, não a exceção.
- **Impacto de negócio**: um valor manual do analista pode ser sobrescrito por um dado stale sem que
  ninguém perceba, porque o eco retorna válido (descrição não-vazia) e o fluxo segue para homologação.
  A NF-e sai homologada mas com valor do item errado — sem alerta, sem log de conflito, e sem forma
  de reverter (a NF-e já foi emitida).
- **Métrica de baseline**: 0 verificações de versão em `com297/comDocProdutos` no repo (grep vazio).
  Análoga ao gap do `com300` — mesma classe de risco herdada, mas com superfície nova.

### F-fault-tolerance-2: Truncamento em 4000 code units JS pode ser rejeitado pelo Oracle em texto pt-BR com acentos

- **Severidade**: P1
- **Tactic violada**: Avoid Faults · Substitution (byte-safe)
- **Localização**: `src/backend/domain/client/ConexosNdeFiscalClient.ts:79-80,389`
- **Evidência (objetiva)**:
  ```typescript
  export const DESCRICAO_IMPRESSAO_MAX = 4000;
  // ...
  const descricao = params.descricao.trim().slice(0, DESCRICAO_IMPRESSAO_MAX);
  ```
  `String.prototype.slice` opera em unidades UTF-16, não em bytes. O `maxLength 4000` do swagger casa
  com o típico `VARCHAR2(4000)` do Oracle, que na maioria das instalações é `VARCHAR2(4000 BYTE)` (o
  default histórico) — não `CHAR`.
- **Impacto técnico**: caracteres pt-BR com acento em UTF-8 usam 2 bytes; um texto de 4000 chars
  acentuados = ~8000 bytes → `ORA-01461` / `ORA-12899` no ERP → `putGenericOnce` falha. Vetor
  principal: env `NDE_DESCRICAO_ITEM_FALLBACK` (texto fixado pelo fiscal, sem enforcement de
  tamanho). Vetor secundário: `preDescrProdutoNf` devolvendo um texto longo baseado na DI. Caracteres
  supplementary (fora do BMP — emoji, símbolos raros) também podem ser cortados no meio do par
  substituto, produzindo string inválida UTF-16 que o axios serializa como `?` ou lança.
- **Impacto de negócio**: em produção, primeira execução para um cliente com fallback fiscal customizado
  longo pode falhar; erro sobe como `ConexosError('com297/comDocProdutos')` sem contexto do
  truncamento. Correção "aumentar o env" é enganosa — o problema é a unidade de corte.
- **Métrica de baseline**: 0 usos de `Buffer.byteLength` no delta; 0 testes com texto acentuado
  próximo do limite (`grep -n "byteLength\|utf8" src/backend/domain/client/ConexosNdeFiscalClient*`
  = vazio).

### F-fault-tolerance-3: Documento sem linha de produto loga WARN e segue — falha só é detectada após 3 round-trips downstream

- **Severidade**: P2
- **Tactic violada**: Detect Faults · Sanity Checking (fail-fast)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1463-1474`
- **Evidência (objetiva)**:
  ```typescript
  if (itens.length === 0) {
      await this.logService.warn({ ...'NDe sem linha de produto no com297...' });
      return;
  }
  ```
  Comentário: "não inventamos a linha; o ERP tem a última palavra". Fluxo segue para `etapaFiscal`
  (com300 RMW) → `etapaObservacoes` (com131 POST) → `etapaHomologar` (POST + poll SEFAZ) — 3+ escritas
  antes do ERP recusar por ausência de produto.
- **Impacto técnico**: NDe sem item é um estado impossível no happy-path do ADR-0036 (o ERP
  materializa a linha a partir do `prdCod` do header). Se `listItensNde` devolver 0, ou o ERP mudou
  contrato, ou o documento foi manipulado externamente (raro). Seguir apenas gera ruído no log e
  custa 3 chamadas ao ERP antes da falha inevitável na homologação. A mensagem de erro que chega ao
  analista é a do ERP, não a nossa — pior diagnóstico.
- **Impacto de negócio**: baixa — só se manifesta em cenário de manipulação externa. Custo é
  latência + entropia de log, não perda de dado.
- **Métrica de baseline**: 3 escritas desnecessárias por ocorrência (`gravarDocFiscal`,
  `gerarObservacoes`, `homologar`) — mensurável, mas caso extremo.

### F-fault-tolerance-4: Resolução do texto de fallback não é determinística entre retomadas (flake do `preDescrProdutoNf`)

- **Severidade**: P2
- **Tactic violada**: Recover State · Idempotent Replay (idempotência dependente de sorte no ordering)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1509-1541`
- **Evidência (objetiva)**:
  ```typescript
  const sugerida = await this.fiscalClient.preDescricaoProdutoNf({...});
  if (sugerida !== undefined && sugerida.trim() !== '') return sugerida.trim();
  const cadastrada = item.prdDesNome?.trim();
  if (cadastrada !== undefined && cadastrada !== '') return cadastrada;
  ```
  `preDescricaoProdutoNf` é best-effort (nunca lança — devolve `undefined` em erro/timeout/5xx —
  `ConexosNdeFiscalClient.ts:328-347`). Execução A com rede boa recebe "TEXTO SUGERIDO"; execução B
  posterior com flake recebe `undefined` e cai para `prdDesNome` = "PAGAMENTO ANTECIPADO".
- **Impacto técnico**: DUAS execuções da mesma alocação, em sequência ou em paralelo, podem resolver
  descrições DIFERENTES. Mitigação de facto: o gate `dprLngDescrNf !== undefined` faz a segunda ser
  no-op — mas isso presume que a primeira gravou com sucesso. Se a primeira falhou APÓS resolver
  "TEXTO SUGERIDO" mas ANTES do PUT (erro de rede), e a segunda resolve "PAGAMENTO ANTECIPADO", a
  segunda grava a última. Aceitável (invariante "tem descrição" satisfeito), mas rompe a promessa
  de "idempotente pelo estado do documento".
- **Impacto de negócio**: baixo — o texto final é sempre válido; apenas a auditoria pode achar
  estranho "por que este documento tem descrição X e aquele tem Y sem razão aparente".
- **Métrica de baseline**: 0 testes cobrem "flake do preDescr entre retomadas produz descrições
  diferentes"; 1 fonte de não-determinismo identificada.

### F-fault-tolerance-5: Correção da descrição só existe como WARN log — audit-trail persistido ausente

- **Severidade**: P2
- **Tactic violada**: Recover State · Audit Trail (invariante-proposta cross-cutting)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1491-1505`
- **Evidência (objetiva)**:
  ```typescript
  await this.logService.warn({
      type: LOG_TYPE.BUSINESS_WARN,
      message: 'Descrição de impressão do item da NDe estava VAZIA e foi gravada no documento ...',
      data: { txnId, ndDocCod, priCod, prdCod, dprCodSeq, descricaoGravada, descricaoEco },
  });
  ```
  Nenhuma linha no `solicitacao_numerario_execucao` marca "descricao-item-gravada"; nenhum row novo
  em `nota_debito_eletronica.erp_response`; nenhum campo próprio. A auditoria de "quais NDes tiveram
  o campo corrigido pela automação, com que texto, quando" depende de retenção/indexação de log.
- **Impacto técnico**: se o log for perdido (rotacionado, coleta interrompida) fica cego para essa
  classe de mutação. Também impede consultas SQL simples do tipo "quantas NDes deste cliente
  precisaram do fallback este mês" — informação valiosa para negociar com o fiscal a troca do cadastro.
- **Impacto de negócio**: baixo em produção estável — o ERP tem a versão nova do item, o histórico
  está lá; mas o invariante proposta ("toda mutação em estado / financial write → audit persistido")
  não é atendido para este passo. Cross-QA com Security (auditability).
- **Métrica de baseline**: 0 escritas no ledger por invocação de `etapaDescricaoItem` no fluxo
  "descrição vazia → gravou".

### F-fault-tolerance-6: Discriminador "eco não-vazio" (não igualdade) aceita normalização/truncamento silencioso do ERP

- **Severidade**: P3
- **Tactic violada**: Detect Faults · Voting (não aplicado — comparação por presença, não por igualdade)
- **Localização**: `src/backend/domain/client/ConexosNdeFiscalClient.ts:377-413`
- **Evidência (objetiva)**:
  ```typescript
  // Não exigimos igualdade exata com o que mandamos: o ERP pode normalizar/truncar o texto,
  // e o invariante que estamos protegendo é "a NF-e tem descrição de produto", não "a NF-e tem
  // exatamente esta string".
  ```
  Decisão consciente e defensável dado o invariante fiscal. Porém: se o ERP silenciosamente truncar
  a string em 100 chars (por outra regra de negócio invisível), a NF-e sai com descrição diferente
  da enviada e nada avisa.
- **Impacto técnico**: mudanças de contrato do ERP (normalização de caracteres, corte de whitespace,
  substituição de tokens) passam despercebidas. Se a mudança for benigna (uppercase, trim), OK. Se
  for corrupção real, só a auditoria SEFAZ pega.
- **Impacto de negócio**: hoje muito baixo (o ERP não faz nada disso conhecidamente). Vira P1 se
  detectada evidência de normalização em campo.
- **Métrica de baseline**: 0 asserção de igualdade sent==echo no teste de sucesso
  (`ConexosNdeFiscalClient.test.ts:178-197` verifica apenas presença).

## 5. Cards Kanban

### [fault-tolerance-1] Adicionar controle otimista de versão no RMW do item da NDe (ou documentar aceitação explícita do risco)

- **Problema**
  > O RMW do `com297/comDocProdutos` reenvia o objeto INTEIRO lido do GET sem If-Match/versão. Uma
  > edição concorrente do item (analista no UI do Conexos ou segunda execução em paralelo) entre
  > `lerItemNde` e `gravarDescricaoItemNde` é sobrescrita silenciosamente — inclusive em campos que
  > a automação nem quis alterar (`dprPreValorun`, `ctpCod`, etc.). O eco valida como sucesso porque
  > só verifica `dprLngDescrNf` não-vazia.

- **Melhoria Proposta**
  > Investigar se `ComDocProdutosFisFin` do tenant expõe um campo de versão/timestamp
  > (`dprCodAlt`, `dprDatAlt`, `versionSeq`) que o PUT possa devolver diferente quando o item foi
  > tocado entre o GET e o PUT. Se sim: comparar antes de aceitar o eco (tactic Bass: Detect Faults ·
  > Comparison). Se não: **documentar explicitamente a decisão** na ADR-0036 (fluxo human-in-the-loop
  > + janela ~10ms + baixa probabilidade) e adicionar uma sonda de auditoria no log ("dprPreValorun
  > lido X, gravado X" — se divergir, alerta). Mesma reflexão vale para o `com300` (ADR original) —
  > tratar como refactor cross-cutting.

- **Resultado Esperado**
  > Ou detecção ativa de conflito (throw + retomada) ou risco documentado + baseline de auditoria
  > que permita medir a frequência real do conflito em produção.

- **Tactic alvo**: Detect Faults · Comparison
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Casos de RMW com detecção de conflito: 0 → ≥ 1 (RMW do item + RMW do com300)
  - Ou: aceitação documentada na ADR + sonda de auditoria com métrica "eco divergente"
- **Risco de não fazer**: NF-e emitida com valor de item destruído por race silencioso — descoberto
  só na auditoria SEFAZ ou reclamação do cliente. Sem forma de reverter (NF-e já emitida).
- **Dependências**: leitura do swagger `com297/comDocProdutos` (`060-com2.json`) para checar
  campos de versão disponíveis.

### [fault-tolerance-2] Truncar por bytes UTF-8, não por code units JS, no `dprLngDescrNf`

- **Problema**
  > `String.prototype.slice(0, 4000)` conta code units UTF-16, mas o Oracle em `VARCHAR2(4000 BYTE)`
  > mede bytes UTF-8. Texto pt-BR com acentos (2 bytes cada) pode gerar até ~8000 bytes em 4000
  > chars → ORA-01461/ORA-12899 no ERP. Vetor principal: env `NDE_DESCRICAO_ITEM_FALLBACK` sem
  > enforcement de tamanho.

- **Melhoria Proposta**
  > Substituir `slice(0, 4000)` por um helper `truncateUtf8Bytes(s, 4000)` que decrementa até
  > `Buffer.byteLength(s, 'utf8') <= 4000`, respeita fronteiras de UTF-16 surrogate pairs e code
  > points completos. Adicionar teste com "ã".repeat(4000) e com emoji na borda.

- **Resultado Esperado**
  > PUT com `dprLngDescrNf` acentuado longo passa no ERP; teste unitário garante `byteLength <= 4000`.

- **Tactic alvo**: Avoid Faults · Substitution
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Testes: 0 → 2 (limite exato com acentos + surrogate pair na borda)
  - `Buffer.byteLength(descricao, 'utf8')` no envio: unbounded → ≤ 4000
- **Risco de não fazer**: primeiro cliente com fallback fiscal customizado e texto longo com acentos
  quebra em produção com erro do ERP obscuro; correção "aumentar o env" não resolve.
- **Dependências**: nenhuma.

### [fault-tolerance-3] Persistir a correção `dprLngDescrNf` no ledger da execução (audit-trail cross-cutting)

- **Problema**
  > A gravação da descrição no ITEM da NDe só é registrada como WARN log. Nada no
  > `solicitacao_numerario_execucao` ou `nota_debito_eletronica` marca "descricao-corrigida". A
  > auditoria "quais NDes deste cliente precisaram do fallback e por quê" depende de retenção de
  > log — diverge do invariante-proposta "toda mutação em estado → audit persistido".

- **Melhoria Proposta**
  > Adicionar boolean/JSONB `descricao_item_corrigida` (ou objeto `{corrigida: true, texto,
  > fonte: 'env'|'preDescr'|'prdDesNome'|'default', em: ts}`) na tabela do ledger, gravado no mesmo
  > commit lógico do `setEtapa`. Alternativa mais leve: campo em `nota_debito_eletronica.erp_response`
  > (já existe). Preferir a coluna própria para permitir agregação SQL trivial.

- **Resultado Esperado**
  > Consulta SQL "quantas NDes tiveram o campo corrigido pelo automatismo neste mês" fica trivial;
  > audit-trail persistido independente de retenção de log.

- **Tactic alvo**: Recover State · Audit Trail
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-5
- **Métricas de sucesso**:
  - Persistência da correção: 0% → 100% dos casos onde a etapa 3.5 escreve
  - Query "SELECT COUNT(*) WHERE descricao_item_corrigida" possível: não → sim
- **Risco de não fazer**: cegueira operacional sobre a frequência do fallback; renegociação com o
  fiscal (para trocar o cadastro do cliente) fica sem dado quantitativo.
- **Dependências**: cross-QA com Security (auditability) — mesma raiz.

### [fault-tolerance-4] Estabilizar a resolução do texto de fallback entre retomadas (determinismo)

- **Problema**
  > `resolverDescricaoItem` chama `preDescricaoProdutoNf` (best-effort, nunca lança). Um flake de
  > rede na primeira execução vs. sucesso na segunda produz descrições DIFERENTES para a mesma
  > alocação. O gate `dprLngDescrNf !== undefined` mascara o problema (o primeiro que gravar vence),
  > mas a promessa "idempotente pelo estado do documento" fica dependente de ordering.

- **Melhoria Proposta**
  > Duas opções, escolher uma explicitamente:
  > (a) Priorizar `prdDesNome` (determinístico, do próprio item) sobre `preDescricaoProdutoNf`
  > (variável), aceitando que "respeitar a config do cliente quando ela funciona" é benefício
  > marginal frente à estabilidade da retomada.
  > (b) Manter a ordem atual e documentar explicitamente na docstring de `resolverDescricaoItem`
  > que retomadas podem gravar textos distintos (aceitável porque o invariante NF-e é "tem
  > descrição"), com teste que demonstra o comportamento.

- **Resultado Esperado**
  > Duas execuções da mesma alocação resolvem a mesma string OU a documentação torna o
  > comportamento explícito e testado.

- **Tactic alvo**: Recover State · Idempotent Replay
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Determinismo da retomada: dependente de sorte → determinístico OU documentado
  - Teste "flake do preDescr entre retomadas": 0 → 1
- **Risco de não fazer**: divergências inexplicáveis em auditoria; questionamento posterior "por
  que este doc tem X e aquele Y" sem resposta rastreável.
- **Dependências**: nenhuma.

### [fault-tolerance-5] Fail-fast quando a NDe recém-gerada não tem linha de produto

- **Problema**
  > `etapaDescricaoItem` com `itens.length === 0` loga WARN e segue. Como o happy-path do ADR-0036
  > garante que o ERP materializa a linha a partir do header, um `list` vazio indica anomalia
  > (contrato mudou, doc manipulado externamente). Seguir gasta 3+ chamadas ao ERP (com300, com131,
  > homologar) antes de o ERP recusar com mensagem própria — sem contexto do problema real.

- **Melhoria Proposta**
  > Trocar o WARN + `return` por `throw new NumerarioGapError({ etapa: 'nota-debito', message:
  > 'NDe gerada sem linha de item — cenário fora do contrato do ADR-0036 (o ERP materializa a
  > linha a partir do header). Investigar antes de tentar homologar.' })`. Custa 0 escritas no
  > ERP e dá diagnóstico direto no analista.

- **Resultado Esperado**
  > Cenário anômalo interrompe cedo com mensagem própria; economiza 3 round-trips e melhora o MTTR.

- **Tactic alvo**: Detect Faults · Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Round-trips desperdiçados quando NDe não tem item: 3 → 0
  - Mensagem de erro proveniente da automação vs. do ERP: ERP → automação
- **Risco de não fazer**: baixo em regime normal; alto se contrato do ERP mudar sem aviso — cascata
  de erros obscuros.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo restrito ao delta: as tactics já cobertas pelo fluxo existente (SN, fin014, com300 fiscal,
  homologação) não foram re-auditadas — assumo cobertura das revisões anteriores.
- F-fault-tolerance-1 (RMW race) é uma classe de risco pré-existente no `com300` (`gravarDocFiscal`)
  sendo REPLICADA no `com297/comDocProdutos`; o card sugere tratar como refactor cross-cutting.
- F-fault-tolerance-2 (byte vs char) é o achado mais concreto e barato de corrigir — recomendo
  priorizar mesmo se o resto ficar em backlog.
- Cross-QA: F-fault-tolerance-5 (audit-trail persistido) sobrepõe com Security (auditability); a
  mesma coluna resolve ambos. F-fault-tolerance-1 (comparação sem versão) sobrepõe com
  Modifiability (contrato ERP evolvendo) e Testability (concurrency testing ausente).
- Não medi taxa real do bug em produção — a sonda `recebimentos.e2e.descricaoNfeNde.integration.test.ts`
  precisa ser rodada no tenant com credenciais e docCods reais (fora do escopo local `--quick`).
