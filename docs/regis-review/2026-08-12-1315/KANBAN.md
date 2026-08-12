---
type: regis-review-kanban
run_id: 2026-08-12-1315
total: 28
counts: { p0: 0, p1: 6, p2: 6, p3: 16 }
---

# Kanban — financeiro — 2026-08-12-1315

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P1 (S → L) → P2 (S → M) → P3 (S → M).
> Cards `xqa-*` unificam findings duplicados entre QAs (declarados no campo Findings).
> **Nota de numeração:** o ADR desta feature era `0034` quando o review rodou; a `main` publicou `0034`/`0035` no meio do gate, então ele foi renumerado para **ADR-0036**.

---

## P0 — Crítico

_Nenhum P0 identificado neste run._

---

## P1 — Alto

### [fault-tolerance-2] Truncar `dprLngDescrNf` por bytes UTF-8, não por code units JS

**QA**: Fault Tolerance
**Tactic alvo**: Avoid Faults · Substitution (byte-safe)
**Esforço**: S
**Findings**: F-fault-tolerance-2
**Origem**: introduzido pelo delta

**Problema**
> `String.prototype.slice(0, 4000)` conta code units UTF-16, mas o Oracle em `VARCHAR2(4000 BYTE)` mede bytes UTF-8. Texto pt-BR com acentos (2 bytes cada) pode gerar até ~8000 bytes em 4000 chars → ORA-01461/ORA-12899 no ERP. Vetor principal: env `NDE_DESCRICAO_ITEM_FALLBACK` sem enforcement de tamanho.

**Melhoria Proposta**
> Substituir `slice(0, 4000)` (`ConexosNdeFiscalClient.ts:389`) por helper `truncateUtf8Bytes(s, 4000)` que decrementa até `Buffer.byteLength(s, 'utf8') <= 4000`, respeita fronteiras de UTF-16 surrogate pairs e code points completos. Adicionar teste com `"ã".repeat(4000)` e com emoji na borda.

**Resultado Esperado**
> PUT com `dprLngDescrNf` acentuado longo passa no ERP; teste unitário garante `byteLength <= 4000`.

**Métricas de sucesso**
- Testes: 0 → 2 (limite exato com acentos + surrogate pair na borda)
- `Buffer.byteLength(descricao, 'utf8')` no envio: unbounded → ≤ 4000

**Risco de não fazer**: primeiro cliente com fallback fiscal customizado e texto longo com acentos quebra em produção com erro do ERP obscuro; correção "aumentar o env" não resolve.

**Dependências**: Nenhuma

---

### [testability-1] Distinguir os fallbacks #3 e #4 do `resolverDescricaoItem` por fixture

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-1
**Origem**: introduzido pelo delta

**Problema**
> A fixture do teste "descrição VAZIA: grava do prdDesNome" usa `prdDesNome: 'PAGAMENTO ANTECIPADO'`, que é IGUAL ao `NDE_GERACAO_DEFAULTS.produtoNome`. Uma regressão que suprima o ramo #3 e caia direto no #4 passa despercebida. O ramo #4 (último recurso: nem env, nem `preDescr`, nem `prdDesNome`) não tem teste isolado.

**Melhoria Proposta**
> Trocar `prdDesNome` no `comDescricaoVazia` (`RecebimentoNumerarioService.test.ts:1528-1544`) para string DISTINTA (ex. `'DESCRICAO CADASTRADA DO PRODUTO'`) e ajustar asserção. Adicionar `it()` novo que zera `prdDesNome` (`prdDesNome: null`), retorna `preDescricaoProdutoNf: undefined` e verifica que valor gravado é `NDE_GERACAO_DEFAULTS.produtoNome`.

**Resultado Esperado**
> Todos os 4 ramos de `resolverDescricaoItem` distinguíveis por fixture. Ramos com teste isolado: 4/4 (era 3/4). Regressão que suprima o ramo #3 → falha vermelha.

**Métricas de sucesso**
- Fallbacks distinguíveis por fixture: 2/4 → 4/4
- Ramos de `resolverDescricaoItem` com teste dedicado: 3/4 → 4/4

**Risco de não fazer**: se alguém colapsar os ramos #3 e #4 em um único (o fallback hardcoded) para "simplificar", nada quebra — e a NDe volta a sair com descrição errada em cliente que tem `prdDesNome` no cadastro. Reintroduz o próprio bug que este delta consertou.

**Dependências**: Nenhuma

---

### [availability-1] Adicionar timeout HTTP explícito no `ConexosBaseClient`

**QA**: Availability (cross-QA: Fault Tolerance)
**Tactic alvo**: Prevent Faults — Exception Prevention
**Esforço**: S
**Findings**: F-availability-1
**Origem**: HERANÇA da main (agravada pelo delta — +3 a +4 chamadas Conexos síncronas no caminho crítico)

**Problema**
> O `ConexosBaseClient`/`ConexosLegacyClient` não configura `timeout:` no axios (só `BcbClient` tem `10_000`). O delta adiciona 3 (caso comum) a 4 (com `preDescricaoProdutoNf`) chamadas Conexos síncronas ao caminho crítico do "Processar", que já era longo. Sem teto de tempo, uma chamada travada segura o request até o proxy do Render matar a conexão, e o analista vê o "Processar" pendurar mesmo quando a execução idempotente teria retomado limpo.

**Melhoria Proposta**
> Definir `timeout` explícito no axios do `ConexosBaseClient`/`ConexosLegacyClient` (sugestão: 15s por chamada; 30s para PUTs write-once), lido de `EnvironmentProvider` (`CONEXOS_HTTP_TIMEOUT_MS`, default seguro). Cobrir com teste unitário assertando o `timeout` no `axios.create`. Não muda política de retry: `RetryExecutor` já reage a erro; timeout vira erro, então entra na retomada natural.

**Resultado Esperado**
> Nenhuma chamada Conexos pode segurar o Node event loop indefinidamente. A etapa 3.5 (e todas as anteriores) passam a falhar rápido em vez de pendurar, o que combina com desenho fail-closed + retomada do serviço.

**Métricas de sucesso**
- `grep -c 'timeout:' src/backend/domain/client/Conexos*.ts`: 0 → ≥ 1
- Testes unitários assertando timeout do axios: 0 → 1 (client base)

**Risco de não fazer**: em 6 meses, a probabilidade de uma manutenção do ERP causar "Processar pendurado" para o analista sobe proporcionalmente ao número de etapas do fluxo; o delta acabou de somar 3–4 pontos de exposição a mais.

**Dependências**: Nenhuma

---

### [fault-tolerance-1] Adicionar controle otimista de versão no RMW do item da NDe (ou documentar aceitação explícita)

**QA**: Fault Tolerance (cross-QA: Modifiability, Testability)
**Tactic alvo**: Detect Faults · Comparison
**Esforço**: M
**Findings**: F-fault-tolerance-1
**Origem**: introduzido pelo delta (classe de risco herdada do com300, replicada no com297)

**Problema**
> O RMW do `com297/comDocProdutos` reenvia o objeto INTEIRO lido do GET sem If-Match/versão. Uma edição concorrente do item (analista no UI do Conexos ou segunda execução em paralelo) entre `lerItemNde` e `gravarDescricaoItemNde` é sobrescrita silenciosamente — inclusive em campos que a automação nem quis alterar (`dprPreValorun`, `ctpCod`, etc.). O eco valida como sucesso porque só verifica `dprLngDescrNf` não-vazia.

**Melhoria Proposta**
> Investigar se `ComDocProdutosFisFin` do tenant expõe campo de versão/timestamp (`dprCodAlt`, `dprDatAlt`, `versionSeq`) que o PUT possa devolver diferente quando o item foi tocado entre GET e PUT. Se sim: comparar antes de aceitar o eco. Se não: **documentar explicitamente a decisão** na ADR-0036 (fluxo human-in-the-loop + janela ~10ms + baixa probabilidade) e adicionar sonda de auditoria no log ("dprPreValorun lido X, gravado X" — se divergir, alerta). Mesma reflexão vale para com300 — tratar como refactor cross-cutting.

**Resultado Esperado**
> Ou detecção ativa de conflito (throw + retomada) ou risco documentado + baseline de auditoria que permita medir a frequência real do conflito em produção.

**Métricas de sucesso**
- Casos de RMW com detecção de conflito: 0 → ≥ 1 (RMW do item + RMW do com300)
- Ou: aceitação documentada na ADR + sonda de auditoria com métrica "eco divergente"

**Risco de não fazer**: NF-e emitida com valor de item destruído por race silencioso — descoberto só na auditoria SEFAZ ou reclamação do cliente. Sem forma de reverter (NF-e já emitida).

**Dependências**: leitura do swagger `com297/comDocProdutos` (`060-com2.json`) para checar campos de versão disponíveis.

---

### [testability-6] Fechar as 14 falhas de baseline — a suíte vermelha destrói o valor semântico do CI

**QA**: Testability (cross-QA: Deployability)
**Tactic alvo**: (baseline hygiene — pré-requisito das demais tactics)
**Esforço**: M
**Findings**: F-testability-6
**Origem**: HERANÇA da main

**Problema**
> `npm test` na `main` limpa reporta 14 failing / 1132 passing (mesmo conjunto reproduzido em worktree pristino). Enquanto isso durar, todo PR carrega ruído de baseline e uma regressão real fica indistinguível de "aquela falha antiga" no primeiro olhar. O gate `.github/workflows/ci.yml` roda `npm test -- --coverage` — ou o CI está red permanente, ou algo está mascarando; qualquer que seja o caso, o sinal está comprometido.

**Melhoria Proposta**
> Triar as 14 falhas em uma passada: (a) as que são bugs de produto → cards próprios; (b) as que são flakes de infra (timing/porta em teste de integração) → `.skip` com TODO nomeado e follow-up em `_inbox/`. Manter a suíte verde é PRÉ-REQUISITO para acreditar em qualquer métrica de testabilidade daqui para frente.

**Resultado Esperado**
> `npm test` → 0 failing / 1146+ passing (ou 14 skipped nominados). CI vira sinal confiável de regressão.

**Métricas de sucesso**
- Testes red na baseline: 14 → 0
- Ratio green: 1132/1146 = 98,8 % → 100 %

**Risco de não fazer**: cada PR novo re-negocia o significado de "verde"; testes viram folclore em vez de gate.

**Dependências**: cross-QA com Deployability (o coverage gate em CI depende de suite verde para ser autoridade).

---

### [modifiability-2] Planejar split de `RecebimentoNumerarioService` extraindo `NdeCaudaFiscalService`

**QA**: Modifiability (cross-QA: Testability)
**Tactic alvo**: Split Module + Increase Semantic Coherence
**Esforço**: L
**Findings**: F-modifiability-1
**Origem**: HERANÇA da main (delta contribui +120 LOC / +6,7%, não é regressão)

**Problema**
> `RecebimentoNumerarioService` está em 1897 LOC, 3,16x o soft cap de 600. Este delta contribui +120 (+6,7%) — não é regressão, mas empurra o problema. 38 métodos privados; a "cauda fiscal" (`etapaNotaDebito`, `etapaDescricaoItem`, `etapaFiscal`, `etapaObservacoes`, `etapaHomologar`, `etapaPoll`) já é um subsistema coeso reconhecível dentro da classe.

**Melhoria Proposta**
> **Não fazer o split neste delta.** Registrar em `ontology/_inbox/recebimentos-refactor-cauda-fiscal.md` a proposta: extrair `NdeCaudaFiscalService` com as 6 `etapa*` fiscais + `etapaAtingida` + `etapaOrdem`, injetado no `RecebimentoNumerarioService` que fica com o orquestrador (`rodarEtapas`, `etapaSn`, `etapaFin014`, `classificarAlocacao`). Executar no próximo `/feature-tweak` que tocar duas ou mais `etapa*` fiscais.

**Resultado Esperado**
> Orquestrador ≤ 900 LOC; `NdeCaudaFiscalService` ≤ 800 LOC. Testes unitários da cauda fiscal ganham autonomia (mockar 1 colaborador em vez de 8). O padrão de `etapa*` continua o mesmo — só ganha um lar próprio.

**Métricas de sucesso**
- LOC do orquestrador: 1897 → ≤ 900
- Métodos privados no orquestrador: 38 → ≤ 20
- Colaboradores mockados nos testes da cauda fiscal: 8 → 1

**Risco de não fazer**: o próximo `/feature-tweak` na cauda fiscal adiciona mais 100-200 LOC; testar em unidade fica proibitivo; merge conflicts com paralelos de Permutas viram rotina.

**Dependências**: só executar quando o próximo delta na cauda fiscal chegar, para amortizar migração de testes. Não bloqueia este PR.

---

## P2 — Alto

### [xqa-1] Distinguir "alteração de item em com297" no preflight ACL (unifica deployability-1 + integrability-1 + security-2)

**QA**: Deployability + Integrability + Security
**Tactic alvo**: Authorize Actors + Discover Service + Script Deployment Commands
**Esforço**: S
**Findings**: F-deployability-1, F-integrability-1, F-security-2
**Origem**: HERANÇA da main (checker pré-existente; delta introduz verbo novo que casa por acidente)

**Problema**
> O `NumerarioAclChecker` faz `substring('com297')` — que já casa com `HOMOLOGAR`. O novo `PUT com297/comDocProdutos` exige o grant "ALTERAÇÃO DE ITEM" (documentado como "ACL adicional (0)" em `ontology/integrations/conexos-nde-fiscal.md:98-99`), mas o preflight não distingue. Tenant com `HOMOLOGAR` sem `ALTERAÇÃO DE ITEM` passa no preflight e falha em runtime, dentro do primeiro real-run, como 403 cru do ERP. Além disso, a exigência ACL nova está SÓ no ADR — nem `docs/runbooks/fin010-write-cutover.md` nem `docs/e2e/producao-runbook-primeira-execucao.md` mencionam.

**Melhoria Proposta**
> (a) Trocar `ACL_REQUERIDAS` (`NumerarioAclChecker.ts:19-24`) de lista de tela para lista de `{tela, acaoLabel}` (ex.: `{tela: 'com297', acaoLabel: 'alteração de item'}`) e casar por substring do PAR — não só da tela. Enquanto o shape do `permissoes/new/com297` não estiver confirmado por HAR, manter casamento defensivo por rótulo (case-insensitive). (b) Adicionar seção "Pré-requisitos no ERP" no runbook Frente IV listando ACLs por-tela requeridas, marcando "com297 — alteração de item" como novo desde ADR-0036. (c) Teste "só HOMOLOGAR sem UPDATE → deny" em `NumerarioAclChecker.test.ts` (criar se faltar).

**Resultado Esperado**
> Preflight bloqueia execução antes do primeiro `PUT com297/comDocProdutos`. Provisionamento mal configurado reportado com `motivo: "missing ACL grants for: com297/alteração de item"`.

**Métricas de sucesso**
- Distinção de grants no `NumerarioAclChecker`: 1 (só tela) → N (tela + ação)
- Falha de ACL detectada no preflight vs runtime: runtime → preflight
- Testes cobrindo "só HOMOLOGAR → deny": 0 → 1
- Pré-requisitos documentados no runbook: 0 → N (todas ACLs por-tela)

**Risco de não fazer**: em cada novo tenant onboardado, o primeiro `Recebimento` que dispara a etapa consome ciclos de suporte L2 até a ACL ser adicionada. Trai a promessa "está tudo checado antes de escrever".

**Dependências**: idealmente HAR de `GET /api/permissoes/new/com297` para validar shape.

---

### [xqa-2] Persistir correção da descrição no ledger + observabilidade agregada (unifica availability-2 + fault-tolerance-3 + security-4)

**QA**: Availability + Fault Tolerance + Security
**Tactic alvo**: Monitor + Audit Trail
**Esforço**: M
**Findings**: F-availability-2, F-fault-tolerance-5 (audit), F-security-4
**Origem**: introduzido pelo delta (decisão explícita de auto-idempotência; consequência não medida)

**Problema**
> A gravação da descrição no ITEM da NDe só é registrada como `BUSINESS_WARN` log. Nada no `solicitacao_numerario_execucao` ou `nota_debito_eletronica` marca "descricao-corrigida". A auditoria "quais NDes deste cliente precisaram do fallback e por quê" depende de retenção de log — diverge do invariante "toda mutação em estado → audit persistido". Além disso, sem contador/histograma/alarme, não há como detectar proativamente regressão do ERP na rota `preDescrProdutoNf` — a única forma de responder "quantas NDes/dia precisaram do conserto" é `grep` de log.

**Melhoria Proposta**
> Adicionar duas colunas no ledger `solicitacao_numerario_execucao`: `descricao_item_corrigida boolean` + `descricao_item_fonte text` (`'env'|'preDescr'|'prdDesNome'|'default'`), gravadas no mesmo commit lógico do `setEtapa`. Enquanto plataforma é Render+Supabase, materializar contadores como queries SQL padronizadas (`SELECT count(*) WHERE descricao_item_corrigida ...`); quando migrar para Lambda/CloudWatch, promover para metric filter dos logs `BUSINESS_WARN`. Definir alarme "corrigidas/total > 30% por dia" (indica cadastro em massa) e "falhas > 1% por dia" (indica regressão do contrato ERP).

**Resultado Esperado**
> Consulta "quantas NDes tiveram o campo corrigido pelo automatismo neste mês" trivial via SQL; audit-trail persistido independente de retenção de log; alarme proativo para regressão do ERP.

**Métricas de sucesso**
- Persistência da correção: 0% → 100% dos casos onde a etapa 3.5 escreve
- Query `SELECT COUNT(*) WHERE descricao_item_corrigida` possível: não → sim
- Nº de métricas/queries específicas da etapa 3.5: 0 → ≥ 3
- Nº de alarmes: 0 → ≥ 2 (corrigidas/total, falhas/total)

**Risco de não fazer**: cegueira operacional sobre a frequência do fallback; renegociação com o fiscal (para trocar cadastro do cliente) fica sem dado quantitativo; regressão do contrato ERP `com297/comDocProdutos` passa silenciosa até homologação recusar; em disputa fiscal a resposta hoje sai de log com risco de retenção expirada.

**Dependências**: migração SQL leve (2 colunas nullable com default `false`/null); repositório `SolicitacaoNumerarioExecucaoRepository` recebe novo setter.

---

### [xqa-3] Cobrir e2e do ramo empty + preparar concurrency guard para N>1 (unifica testability-3 + performance-2)

**QA**: Testability + Performance
**Tactic alvo**: Sandbox + Increase Concurrency (gated)
**Esforço**: S (e2e) + M (concorrência gated)
**Findings**: F-testability-3, F-performance-2
**Origem**: introduzido pelo delta

**Problema**
> Os 4 `recebimentos.e2e.*.test.ts` só programaram no fake ERP o caminho no-op (`dprLngDescrNf` já preenchido). O ramo real de escrita — o que o delta veio adicionar — não é exercitado em NENHUM teste que passe por Express + fake ERP. Adicionalmente, o loop `for..of await` na `etapaDescricaoItem` faz 3 chamadas Conexos por item vazio; N=1 hoje, mas se um cliente novo produzir NDe multi-item vazia, latência escala linear (~1-1.5s p50 × N, até ~30s p99 × N).

**Melhoria Proposta**
> (a) Adicionar cenário no `recebimentos.e2e.test.ts` (ou `recebimentos.e2e.descricaoItem.test.ts` novo) em que rota `/api/:tela/comDocProdutos/list/:docCod/:fisCod` devolve `dprLngDescrNf: null` na 1ª chamada e `'PAGAMENTO ANTECIPADO'` (eco do PUT) depois. Verificar que `PUT com297/comDocProdutos` chegou ao fake ERP com descrição preenchida. (b) Adicionar teste unitário com N=2 (2 itens vazios) demonstrando comportamento sequencial. (c) Implementar concorrência **SÓ SE** `performance-3` (instrumentação da proporção empty × N) provar que valor real justifica — evitar otimização especulativa.

**Resultado Esperado**
> E2E cobrindo ramo de escrita da etapa 3.5: 0 → 1. Se `etapaDescricaoItem` for removida por engano ou o guard for invertido, pelo menos um e2e vira vermelho. Teste com N>1 demonstra comportamento hoje (baseline); concorrência real fica atrás de evidência.

**Métricas de sucesso**
- E2E cobrindo ramo de escrita: 0/4 → 1
- PUT `com297/comDocProdutos` observado ao menos uma vez na suíte e2e
- Teste com N>1 empty: 0 → 1

**Risco de não fazer**: se um refactor amanhã inverter a condição do guard (`if (item.dprLngDescrNf !== undefined) continue`), os e2e continuam verdes; a NDe volta a gravar dupla no ERP. Se Columbia começar a emitir NDe multi-item (mudança de cadastro), analista vê timeout HTTP no navegador antes do loop terminar.

**Dependências**: (c) depende do card `performance-3` produzir dado real de proporção.

---

### [security-1] Sanitizar `dprLngDescrNf` antes de gravar (strip de caracteres de controle)

**QA**: Security
**Tactic alvo**: Validate Input
**Esforço**: S
**Findings**: F-security-1
**Origem**: introduzido pelo delta

**Problema**
> A gravação do `dprLngDescrNf` só faz `.trim().slice(0, 4000)` (`ConexosNdeFiscalClient.ts:389`). Um texto do env `NDE_DESCRICAO_ITEM_FALLBACK` — ou (menos provável) uma sugestão anômala do próprio ERP — pode conter caracteres de controle, BOM, direction-override, aspas curly, CRLF, PUA. Esse valor vira o `xProd` do XML da NF-e emitida pelo Conexos e propaga para tooling downstream sem revisão humana.

**Melhoria Proposta**
> Introduzir normalização no boundary do client (mesmo lugar do `trim/slice`): NFC + strip de `\p{Cc}` (mantendo `\n` só se realmente necessário — checar contrato do `xProd`), colapso de whitespace, rejeição imediata de string que sobre vazia após saneamento. Arquivo único: `src/backend/domain/client/ConexosNdeFiscalClient.ts` (função `gravarDescricaoItemNde`). Cobrir com teste em `ConexosNdeFiscalClient.test.ts` (BOM, direction-override, zero-width, curly quotes, CRLF).

**Resultado Esperado**
> 100% dos caracteres não-imprimíveis filtrados antes do PUT. `NDE_DESCRICAO_ITEM_FALLBACK` copiado com CRLF por acidente deixa de contaminar o `xProd`.

**Métricas de sucesso**
- `# chars fora do range XML 1.0 aceito no payload PUT com297/comDocProdutos`: desconhecido → 0
- `# testes cobrindo saneamento`: 0 → 4 (BOM, direction-override, control char, CRLF)

**Risco de não fazer**: Uma NDe recusada por SEFAZ com mensagem opaca ("erro no xProd") custa manhã de diagnóstico do fiscal; um caractere invisível colado no env do tenant contamina N notas em silêncio.

**Dependências**: Nenhuma

---

### [fault-tolerance-4] Estabilizar a resolução do texto de fallback entre retomadas (determinismo)

**QA**: Fault Tolerance
**Tactic alvo**: Recover State · Idempotent Replay
**Esforço**: S
**Findings**: F-fault-tolerance-4
**Origem**: introduzido pelo delta

**Problema**
> `resolverDescricaoItem` chama `preDescricaoProdutoNf` (best-effort, nunca lança). Um flake de rede na primeira execução vs. sucesso na segunda produz descrições DIFERENTES para a mesma alocação. O gate `dprLngDescrNf !== undefined` mascara o problema (o primeiro que gravar vence), mas a promessa "idempotente pelo estado do documento" fica dependente de ordering.

**Melhoria Proposta**
> Duas opções, escolher uma explicitamente:
> (a) Priorizar `prdDesNome` (determinístico, do próprio item) sobre `preDescricaoProdutoNf` (variável), aceitando que "respeitar a config do cliente quando ela funciona" é benefício marginal frente à estabilidade da retomada.
> (b) Manter a ordem atual e documentar explicitamente na docstring de `resolverDescricaoItem` que retomadas podem gravar textos distintos (aceitável porque o invariante NF-e é "tem descrição"), com teste que demonstra o comportamento.

**Resultado Esperado**
> Duas execuções da mesma alocação resolvem a mesma string OU a documentação torna o comportamento explícito e testado.

**Métricas de sucesso**
- Determinismo da retomada: dependente de sorte → determinístico OU documentado
- Teste "flake do preDescr entre retomadas": 0 → 1

**Risco de não fazer**: divergências inexplicáveis em auditoria; questionamento posterior "por que este doc tem X e aquele Y" sem resposta rastreável.

**Dependências**: Nenhuma

---

### [fault-tolerance-5] Fail-fast quando a NDe recém-gerada não tem linha de produto

**QA**: Fault Tolerance (cross-QA: Performance)
**Tactic alvo**: Detect Faults · Sanity Checking
**Esforço**: S
**Findings**: F-fault-tolerance-3
**Origem**: introduzido pelo delta

**Problema**
> `etapaDescricaoItem` com `itens.length === 0` loga WARN e segue. Como o happy-path do ADR-0036 garante que o ERP materializa a linha a partir do header, um `list` vazio indica anomalia (contrato mudou, doc manipulado externamente). Seguir gasta 3+ chamadas ao ERP (com300, com131, homologar) antes de o ERP recusar com mensagem própria — sem contexto do problema real.

**Melhoria Proposta**
> Trocar o WARN + `return` (`RecebimentoNumerarioService.ts:1463-1474`) por `throw new NumerarioGapError({ etapa: 'nota-debito', message: 'NDe gerada sem linha de item — cenário fora do contrato do ADR-0036 (o ERP materializa a linha a partir do header). Investigar antes de tentar homologar.' })`. Custa 0 escritas no ERP e dá diagnóstico direto no analista.

**Resultado Esperado**
> Cenário anômalo interrompe cedo com mensagem própria; economiza 3 round-trips e melhora MTTR.

**Métricas de sucesso**
- Round-trips desperdiçados quando NDe não tem item: 3 → 0
- Mensagem de erro proveniente da automação vs. do ERP: ERP → automação

**Risco de não fazer**: baixo em regime normal; alto se contrato do ERP mudar sem aviso — cascata de erros obscuros.

**Dependências**: Nenhuma

---

## P3 — Baixo/Médio

### [availability-3] Cobrir teste de indisponibilidade da leitura (`listItensNde`/`lerItemNde`)

**QA**: Availability
**Tactic alvo**: Detect Faults — Exception Detection
**Esforço**: S
**Findings**: F-availability-3
**Origem**: introduzido pelo delta

**Problema**
> Só `gravarDescricaoItemNde` tem teste de rejeição no `RecebimentoNumerarioService.test.ts:1635`. Não há teste equivalente para o LIST ou o READ do RMW falharem. O comportamento é o certo hoje (rethrow → try/catch do `rodarEtapas` → `registrarFalha` → `markError` → `status:error, etapa:nota-debito`), mas não há prova viva contra regressão silenciosa.

**Melhoria Proposta**
> Adicionar 2 casos no `describe('RecebimentoNumerarioService — etapa 3.5 ...')` — (a) `listItensNde rejeita → status: error, etapa: nota-debito, sem tocar com300`; (b) `lerItemNde rejeita após LIST devolver item vazio → mesmo desfecho`.

**Resultado Esperado**
> Retomada e fail-closed da etapa 3.5 amparados por teste em todos os pontos de I/O, não só o PUT.

**Métricas de sucesso**
- Endpoints da etapa 3.5 cobertos por teste-de-falha: 1/3 → 3/3

**Risco de não fazer**: baixo hoje; ganha peso quando o serviço ficar maior e alguém adicionar cache/tratamento intermediário.

**Dependências**: Nenhuma

---

### [xqa-4] Flag por-etapa para desligar a correção de descrição sem desligar a Frente IV (unifica availability-4 + deployability-3)

**QA**: Availability + Deployability
**Tactic alvo**: Prevent Faults — Removal from Service / Feature flags
**Esforço**: S
**Findings**: F-availability-4, F-deployability-2
**Origem**: introduzido pelo delta

**Problema**
> A única forma de desligar a etapa 3.5 sem tocar o resto hoje é `conexosDryRun=true`, que desliga a frente inteira. A ADR-0028 já estabeleceu o padrão de flag por-etapa (`snCondPgtoAutoajuste`) e a etapa 3.5 caberia no mesmo desenho. Se a rota `com297/comDocProdutos` do ERP mudar de forma bloqueante em uma manutenção, hoje paramos a frente ou aceitamos correr o risco de NDe com descrição vazia.

**Melhoria Proposta**
> Introduzir `NDE_DESCRICAO_ITEM_ENABLED` (default `true`) em `EnvironmentVars`; quando `false`, a `etapaDescricaoItem` emite `BUSINESS_INFO` "etapa desligada por flag" e retorna, deixando a leg fiscal seguir. A ordem já garante que nada irreversível aconteceu antes dela — pular é seguro pelo desenho. Marcar como `sync:false` no `render.yaml` (dashboard = fonte da verdade).

**Resultado Esperado**
> Operação pode desligar a correção como interruptor cirúrgico em manutenção do ERP, sem sacrificar a Frente IV.

**Métricas de sucesso**
- Flags por-etapa da Frente IV: 1 (`snCondPgtoAutoajuste`) → 2
- `grep -rn 'ndeDescricaoItemEnabled\|NDE_DESCRICAO_ITEM_ENABLED' src/backend`: 0 → ≥ 3 (env, provider, service)
- 1 teste unitário do modo desligado

**Risco de não fazer**: em incidente do ERP na rota nova, a única alternativa é o kill switch global; a ADR-0028 seria descumprida na prática.

**Dependências**: Nenhuma

---

### [deployability-2] Adicionar seção "Rollback" ao ADR-0036

**QA**: Deployability
**Tactic alvo**: Rollback
**Esforço**: S
**Findings**: F-deployability-3
**Origem**: introduzido pelo delta

**Problema**
> O ADR desta feature tem 83 linhas e zero mencionam rollback. A propriedade que torna o rollback seguro (o texto gravado é byte-a-byte o workaround manual, portanto continua fiscalmente correto se a versão for revertida) está no `_inbox/nde-descricao-produto-nfe-diagnostico.md`, não no ADR. Dev de plantão precisa consultar duas fontes para agir com confiança.

**Melhoria Proposta**
> Acrescentar §"Rollback" no ADR-0036: (a) rollback do binário é seguro — sem migration, sem breakage de contrato; (b) `PUT com297.dprLngDescrNf` já executados PERMANECEM (não há UNDO possível), mas o texto ≡ workaround manual, portanto sem passivo fiscal; (c) após rollback, novos `Recebimentos` de clientes com `dpeVld1DescrNfe=4` voltam a falhar como antes do fix. Duas frases, um bullet.

**Resultado Esperado**
> Rollback decidido em <2 min por qualquer plantonista, sem consulta ao autor. Reduz MTTR percebido durante madrugada/fim-de-semana.

**Métricas de sucesso**
- Linhas sobre rollback no ADR: 0 → ≥5
- Fontes consultadas para decisão de rollback: 2 → 1

**Risco de não fazer**: hesitação em rollback durante incidente noturno; decisões piores que a técnica permite.

**Dependências**: Nenhuma

---

### [deployability-4] Job semanal de drift-detection contra o dashboard Render

**QA**: Deployability
**Tactic alvo**: Drift detection
**Esforço**: M
**Findings**: F-deployability-4
**Origem**: HERANÇA da main

**Problema**
> 12 envs em `sync:false` no `render.yaml` (incluindo `CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN`, `RECEBIMENTOS_ENABLED`) — não há detecção se alguém trocar essas envs no dashboard sem avisar. O delta atual não introduz o problema, mas convive com ele e adiciona ainda outra env (`NDE_DESCRICAO_ITEM_FALLBACK`, se um dia for setada).

**Melhoria Proposta**
> Workflow do GitHub Actions (`drift-envs.yml`, `cron: 0 12 * * 1`) que usa a Render API para listar envs do serviço e comparar com snapshot versionado (`docs/deploy/envs-snapshot.md`, atualizado à mão em cada mudança sancionada). Diff → PR-comment/issue automático. Não bloqueia; apenas alerta.

**Resultado Esperado**
> Deriva de configuração denunciada em ≤7 dias em vez de "descoberta no próximo incidente".

**Métricas de sucesso**
- Envs `sync:false` monitoradas: 0 → 12
- Lag entre drift real e detecção: indefinido → ≤7d

**Risco de não fazer**: incidente de configuração dentro de 6 meses ("por que a NDe parou de emitir? — alguém colocou DRY_RUN=true e ninguém viu").

**Dependências**: Render API token com escopo de leitura do serviço.

---

### [integrability-2] Logar shape inesperado do `preDescrProdutoNf` (sem endurecer o contrato)

**QA**: Integrability
**Tactic alvo**: Observability of integration failures
**Esforço**: S
**Findings**: F-integrability-2
**Origem**: introduzido pelo delta

**Problema**
> `preDescricaoProdutoNf` aceita 4 formas plausíveis e devolve `undefined` para qualquer outra. Comportamento correto (é uma sugestão), mas a degradação silenciosa esconde uma futura mudança de shape do ERP — o caller cai no `prdDesNome` e o fiscal só descobre pelo texto errado na NF-e.

**Melhoria Proposta**
> No `extrairDescricaoSugerida` (`ConexosNdeFiscalClient.ts:355-371`), quando `raw` for objeto E nenhuma das chaves mapeadas produzir texto, emitir `logService.warn({type: BUSINESS_WARN, message: 'preDescrProdutoNf devolveu shape não mapeado', data: {keys: Object.keys(raw)}})`. Manter `undefined` como retorno — não endurecer o contrato.

**Resultado Esperado**
> Alteração silenciosa no shape do ERP produz warn estruturado, com array de chaves top-level, permitindo triagem em 1 log-query.

**Métricas de sucesso**
- Logs em fallback silencioso do `preDescr`: 0 → 1
- Tempo até detecção de "ERP mudou shape do preDescr": indeterminado → 1 log-query

**Risco de não fazer**: baixo em janela curta; em 6-12 meses uma versão nova do Conexos pode mudar o envelope e degradar a qualidade da descrição impressa sem sinal.

**Dependências**: Nenhuma

---

### [integrability-3] Gerar fixture de contrato dos endpoints com297/comDocProdutos a partir do swagger

**QA**: Integrability (cross-QA: Testability)
**Tactic alvo**: Contract testing (schema-pinned)
**Esforço**: M
**Findings**: F-integrability-3
**Origem**: introduzido pelo delta

**Problema**
> As fixtures do `ConexosNdeFiscalClient.test.ts` são construídas à mão com 5-7 campos, enquanto o schema `ComDocProdutosFisFin_ComDocProdutosFis` do swagger declara ~105 propriedades. O `.passthrough()` do Zod protege o RMW no runtime, mas nenhum teste exercita o shape real — regressão contratual só aparece em produção.

**Melhoria Proposta**
> Adicionar utilitário `docs/conexos-api/fixtures.ts` (dev-only) que hydrata uma instância "shape-realista" de `ComDocProdutosFisFin_ComDocProdutosFis` a partir do JSON do swagger, e usar essa fixture no teste do `lerItemNde`/`gravarDescricaoItemNde` para provar que `.passthrough()` preserva o objeto inteiro e que o Zod aceita o shape declarado. Não substitui HAR; complementa.

**Resultado Esperado**
> Alteração do swagger que mude o tipo ou remova um campo esperado quebra pelo menos um teste local, antes de chegar em produção.

**Métricas de sucesso**
- Fixtures shape-derivadas do swagger: 0 → 1 (com297/comDocProdutos)
- Cobertura de campos do schema declarado: 7/~105 → ≥ 50/~105

**Risco de não fazer**: baixo enquanto o Conexos permanecer estável; alto na primeira upgrade se o swagger evoluir sem changelog claro.

**Dependências**: pode ser feito em qualquer `/feature-tweak` que toque outro endpoint do com297.

---

### [modifiability-1] Anotar em `etapaOrdem` que "descrição-item" NÃO tem etapa própria por design

**QA**: Modifiability
**Tactic alvo**: Defer Binding (state-machine) — proteger a decisão contra erosão
**Esforço**: S
**Findings**: F-modifiability-3
**Origem**: introduzido pelo delta

**Problema**
> `etapaOrdem` é a máquina de estados canônica; quem só lê esse método não descobre por que a nova regra de descrição-item ficou fora. Existe risco alto de um dev futuro adicionar `'descricao-item-done'` "porque parece óbvio" e quebrar a idempotência por-documento que permite retomar execuções paradas em `obs-done`.

**Melhoria Proposta**
> Adicionar comentário de 3-4 linhas ACIMA do `Record<SolicitacaoNumerarioEtapa, number>` em `etapaOrdem` (linha 1717) explicando: (a) descricao-item roda ANTES de fiscal-done sem ledger; (b) idempotência vem do estado do DOCUMENTO (`dprLngDescrNf` vazio ⟺ tem trabalho); (c) etapa monotônica AQUI bloquearia retomadas. Ligar textualmente ao ADR-0036 e ao doc-comment de `etapaDescricaoItem`.

**Resultado Esperado**
> Zero risco de regressão silenciosa. Comentário curto o suficiente para não poluir; longo o suficiente para bloquear a "boa-vontade" de padronizar.

**Métricas de sucesso**
- Comentários inline em `etapaOrdem` remetendo à ADR-0036: 0 → 1
- Tempo para um novo dev inferir a decisão sem sair do arquivo: várias leituras → 1 leitura

**Risco de não fazer**: uma tweak future adiciona `descricao-item-done` na `etapaOrdem`; execuções travadas em `obs-done` deixam de ser consertadas na retomada; problema só aparece nas NDes de clientes com `dpeVld1DescrNfe = 4` — silencioso em CI, visível apenas em campo.

**Dependências**: Nenhuma

---

### [modifiability-3] Monitorar 3ª ocorrência do padrão RMW no client fiscal antes de extrair helper genérico

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services (regra dos três)
**Esforço**: S (registrar follow-up) / L (extração quando o 3º RMW chegar)
**Findings**: F-modifiability-2
**Origem**: introduzido pelo delta

**Problema**
> O padrão "GET objeto inteiro → mutate um campo → PUT objeto inteiro → assert(predicado no eco)" apareceu 2x em `ConexosNdeFiscalClient` (com300 `finDocFiscal` e com297 `comDocProdutos`). Duas ocorrências não justificam abstração — cada RMW tem Zod, endpoint e discriminador de sucesso próprios.

**Melhoria Proposta**
> **Não abstrair agora.** Registrar em `ontology/_inbox/rmw-conexos-abstraction.md` que a extração de `rmwPut<T>({schema, endpoint, mutator, predicate})` vira P2 quando aparecer a 3ª ocorrência (candidato provável: `PUT com299` na Frente III se ela ganhar campo derivado de cadastro).

**Resultado Esperado**
> Decisão de abstrair não é esquecida. Quando o 3º RMW chegar, existe follow-up pronto e a extração vem com o delta que precisa dela — não como refactor especulativo.

**Métricas de sucesso**
- Follow-up documentado em `_inbox/`: não existe → existe
- Quando o 3º RMW chegar: extração + 3 chamadas → 1 helper + 3 configurações

**Risco de não fazer**: 3ª ocorrência entra copiando a 1ª, e ninguém percebe até a 4ª, quando o custo de padronizar retroativamente ficou maior.

**Dependências**: Nenhuma

---

### [modifiability-4] Preparar caminho para `ndeDescricaoItemFallback` por-cliente se o modelo por-tenant surgir

**QA**: Modifiability
**Tactic alvo**: Defer Binding (configuration)
**Esforço**: S (registrar) / M (implementar se demanda vier)
**Findings**: F-modifiability-4
**Origem**: introduzido pelo delta

**Problema**
> `NDE_DESCRICAO_ITEM_FALLBACK` é uma env global ao processo. Hoje isso é adequado (o default `prdDesNome` cobre 100% dos casos observados; a env existe só para o fiscal exigir OUTRO texto). Se aparecer variação por-cliente (Columbia diz "PAGAMENTO ANTECIPADO"; Cliente-Y diz "TARIFA DE CÂMBIO"), o modelo não resolve.

**Melhoria Proposta**
> **Não implementar por-cliente agora** — não há demanda. Registrar em `ontology/_inbox/nde-descricao-config-por-cliente.md` o caminho previsto: promover `ndeDescricaoItemFallback` para tabela `nde_config_por_cliente(cli_cod, descricao_item_fallback)` consultada pelo `resolverDescricaoItem`.

**Resultado Esperado**
> Sem sobre-engenharia hoje. Quando (se) a demanda surgir, existe contrato pronto e único ponto de código a mudar é `resolverDescricaoItem`.

**Métricas de sucesso**
- Follow-up documentado: 0 → 1
- Custo estimado da migração se demanda vier: proporcional (apenas `resolverDescricaoItem` toca a env)

**Risco de não fazer**: quando a demanda vier, o dev que a receber vai improvisar (talvez um `switch` por `pesCod` inline) em vez de subir o tier corretamente.

**Dependências**: Nenhuma

---

### [performance-1] Detectar página cheia em `listItensNde` (defesa contra crescimento silencioso)

**QA**: Performance
**Tactic alvo**: Limit Event Response
**Esforço**: S
**Findings**: F-performance-1
**Origem**: introduzido pelo delta

**Problema**
> `listItensNde` faz POST com `pageSize: 200` e nunca pagina (`ConexosNdeFiscalClient.ts:272-274`). Se um dia a NDe crescer > 200 itens (mudança de cadastro ou config do cliente), as linhas 201+ ficam invisíveis à etapa de conserto de descrição, e a homologação segue com um subconjunto corrigido. Silencioso.

**Melhoria Proposta**
> Em `ConexosNdeFiscalClient.listItensNde`, quando `rows.length === pageSize` (200), emitir `logService.warn` com `docCod`/`fisCod`/`rows.length` — flag para observabilidade, não bloqueio. Alternativamente, adotar paginação real (`pageNumber++` até `rows.length < pageSize`), mas só se o warn começar a disparar.

**Resultado Esperado**
> Latência inalterada no caso atual (N=1). Se um cliente produzir NDe > 200 itens, alerta imediato em log em vez de descoberta por chamado do analista.

**Métricas de sucesso**
- `# truncamentos silenciosos em com297/comDocProdutos/list`: hoje 0 detectáveis → alvo 0 detectáveis com warn ativo

**Risco de não fazer**: uma NDe grande futura será parcialmente corrigida sem sinal. Auditoria não distingue "consertamos" de "consertamos os primeiros 200".

**Dependências**: Nenhuma

---

### [performance-3] Instrumentar contagem de "caso empty vs caso comum" para validar overhead esperado

**QA**: Performance
**Tactic alvo**: (observabilidade para validar tactics existentes)
**Esforço**: S
**Findings**: F-performance-3
**Origem**: introduzido pelo delta

**Problema**
> A justificativa da arquitetura ("chamada sempre, mesmo pagando 1 round-trip a mais") assume que o caso empty é raro (< 5%). Não há telemetria que valide isso em produção — o `logService.warn` só dispara no caso empty, mas não conta o total. Sem essa razão medida, o trade-off documentado é uma hipótese.

**Melhoria Proposta**
> Adicionar `logService.info` com `type: BUSINESS_INFO` no início de `etapaDescricaoItem` com `{ndDocCod, totalItens, itensVazios, itensPreenchidos}` — permite ao ObservabilityAdvisor derivar, do log, a proporção real de caso empty por semana. Custo: 1 log call, zero HTTP.

**Resultado Esperado**
> Métrica derivável do log: `% NDe com dprLngDescrNf vazia` por semana. Confirma (ou refuta) hipótese de "< 5% dos casos". Se refutada (> 30%), reabre F-performance-3 para reconsiderar arquitetura reativa.

**Métricas de sucesso**
- `% NDe empty` observável em produção: hoje inobservável → queryable a partir de log

**Risco de não fazer**: decisão de "pagar 1 round-trip sempre" fica sem validação empírica. Se a proporção mudar, não temos como saber.

**Dependências**: se `xqa-2` for feito, este contador migra naturalmente para a coluna do ledger — considerar amalgamar.

---

### [performance-4] Documentar a precedência de `resolverDescricaoItem` como intencional (não otimizar)

**QA**: Performance
**Tactic alvo**: (contramedida contra otimização perigosa)
**Esforço**: S
**Findings**: F-performance-4
**Origem**: introduzido pelo delta

**Problema**
> A ordem `env → preDescr (HTTP) → prdDesNome (local) → default` chama HTTP mesmo quando `prdDesNome` está disponível localmente. Um revisor futuro pode "otimizar" pulando o HTTP quando `prdDesNome !== undefined`, mudando semântica (preDescr aplica regra do cadastro do cliente `dpeVld1DescrNfe`; prdDesNome é a descrição crua). O código não explica por que a ordem importa.

**Melhoria Proposta**
> Adicionar comentário `// PRECEDÊNCIA INTENCIONAL — não reordenar; ver docstring do método` na linha entre a chamada `preDescr` e o fallback `prdDesNome`, referenciando o docstring já existente. Zero mudança comportamental.

**Resultado Esperado**
> Nenhuma mudança de latência. Redução de risco de regressão fiscal por otimização mal-intencionada.

**Métricas de sucesso**
- Comentário defensivo presente: 0 → 1

**Risco de não fazer**: alguém pula `preDescr` porque "prdDesNome já resolve"; NDe passa a gravar descrição crua no lugar da regra do cadastro do cliente; NF-e homologa com texto errado sem alarme.

**Dependências**: Nenhuma

---

### [security-3] Restringir permissões do dump da sonda de diagnóstico

**QA**: Security
**Tactic alvo**: Limit Exposure / Encrypt Data (em repouso)
**Esforço**: S
**Findings**: F-security-3
**Origem**: introduzido pelo delta

**Problema**
> `recebimentos.e2e.descricaoNfeNde.integration.test.ts:210-212` grava o dump com `writeFileSync` sem `mode:`, respeitando umask default (0022 → 0644) em `<tmp>/nde-descricao-diagnostico.json`. O dump contém PII de negócio (pesCod, nome do cliente, item fiscal, cadastro `cmn025`) — não credenciais, mas o suficiente para vazar em máquina compartilhada.

**Melhoria Proposta**
> Trocar por `mkdtempSync` (dir 0700) + `writeFileSync(destino, ..., { mode: 0o600 })`. Documentar no cabeçalho da sonda que o dump é sensível.

**Resultado Esperado**
> `# leitores possíveis do dump`: local users → 1 (o próprio usuário).

**Métricas de sucesso**
- `mode do dump em /tmp`: `0644` → `0600`
- Nota explícita no cabeçalho sobre sensibilidade: 0 → 1

**Risco de não fazer**: Baixo, mas cumulativo — sondas de diagnóstico tendem a se multiplicar; padrão frouxo hoje vira dívida institucional em três iterações.

**Dependências**: Nenhuma

---

### [testability-2] Extrair a suíte da etapa 3.5 para `RecebimentoNumerarioService.etapaDescricaoItem.test.ts` dedicado

**QA**: Testability (cross-QA: Modifiability)
**Tactic alvo**: Limit Structural Complexity
**Esforço**: S
**Findings**: F-testability-2
**Origem**: introduzido pelo delta

**Problema**
> `RecebimentoNumerarioService.test.ts` chegou a 1692 LOC (top-1 do backend). A etapa 3.5 acrescentou 166 LOC em um único `describe`, o que preserva coesão local mas continua empurrando o arquivo raiz para além do humanamente legível em revisão.

**Melhoria Proposta**
> Mover o `describe('RecebimentoNumerarioService — descrição de impressão do item da NDe (etapa 3.5)')` para arquivo próprio (`RecebimentoNumerarioService.etapaDescricaoItem.test.ts`), reusando o mesmo `buildMocks`/`baseInput` via um `__testUtils__/recebimentoNumerarioService.fixtures.ts` (novo).

**Resultado Esperado**
> LOC do arquivo raiz: 1692 → ≤ 1550. Nascimento de arquivo dedicado ≤ 250 LOC. Padrão replicável para próximas etapas.

**Métricas de sucesso**
- LOC do `RecebimentoNumerarioService.test.ts`: 1692 → 1500 ± 50
- Novo arquivo `etapaDescricaoItem.test.ts` ≤ 250 LOC
- Utilitário compartilhado extraído

**Risco de não fazer**: fricção crescente em cada PR que tocar o serviço; onboarding cada vez mais custoso.

**Dependências**: cross-QA com `modifiability-2`.

---

### [testability-4] Versionar HAR real do com297/comDocProdutos como fixture (`__fixtures__/`)

**QA**: Testability (cross-QA: Integrability)
**Tactic alvo**: Recordable Test Cases
**Esforço**: M
**Findings**: F-testability-4
**Origem**: introduzido pelo delta

**Problema**
> Os shapes usados nos testes do `ConexosNdeFiscalClient` são compostos inline (`itemBase = { docCod: 18347, ... }`) e não refletem os ~105 campos que o ERP devolve na resposta real. O `.passthrough()` do Zod aceita — o teste com um único campo extra (`dprPreValorun`) é smoke check, não contract test.

**Melhoria Proposta**
> Extrair, da sonda `recebimentos.e2e.descricaoNfeNde.integration.test.ts`, os dumps de `com297.itens` / `com297.item.{...}` / `com297.preDescrProdutoNf.{...}` em rodada controlada com PROBE_ND_DOC_COD real, versionar como `src/backend/domain/client/__fixtures__/com297-comDocProdutos.json` e carregar nos testes do client.

**Resultado Esperado**
> Fixture do HAR real versionada: 0 → 1 (com pelo menos 2 payloads: item preenchido + item vazio). Testes do client passam a validar shape completo — mudança de contrato do ERP vira teste vermelho em CI.

**Métricas de sucesso**
- Fixtures HAR versionadas para com297/comDocProdutos: 0 → ≥ 2
- Campos preservados por `.passthrough()` verificados: 1 → ≥ 10

**Risco de não fazer**: mudanças de shape no ERP só são descobertas em produção; o delta acaba dependendo de sonda manual em cada suspeita.

**Dependências**: acesso ao Conexos de HML com PROBE_ND_DOC_COD válido; overlap com `integrability-3` (fixtures = contract tests).

---

### [testability-5] Fechar o buraco do shape "objeto no topo com `dprLngDescrNf`" em `preDescricaoProdutoNf`

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-5
**Origem**: introduzido pelo delta

**Problema**
> O extrator do `preDescricaoProdutoNf` aceita 4 formas (string crua, envelope `{responseData:'X'}`, envelope `{responseData:{...}}`, e objeto no topo com `{dprLngDescrNf|descricao|descr}`). O teste cobre 3 formas + erro; a 4ª (objeto no topo, sem envelope) não é exercitada.

**Melhoria Proposta**
> Adicionar caso no `it('preDescricaoProdutoNf: aceita string crua, envelope e objeto — e NUNCA lança')` cobrindo `client({ dprLngDescrNf: 'DIRETO NO TOPO' })` → `'DIRETO NO TOPO'`.

**Resultado Esperado**
> Shapes cobertos por `preDescricaoProdutoNf`: 3/4 + erro → 4/4 + erro. Se alguém remover o fallback `o` no `alvo = … ? … : o`, o teste vira vermelho.

**Métricas de sucesso**
- Ramos do extrator com teste: 3/4 → 4/4

**Risco de não fazer**: baixo (best-effort nunca lança); é higiene de contrato.

**Dependências**: Nenhuma
