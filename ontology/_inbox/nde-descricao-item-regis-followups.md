# Follow-ups — feature `nde-descricao-item` (ADR-0036)

**Branch:** `fix/nde-descricao-item` · **Base:** `main` · **Data:** 2026-08-11
**Gates:** PatternGuardian ✅ (1 achado, avaliado abaixo) · Regis-Review: `docs/regis-review/2026-08-12-1315/`

> Só achados **P0 (Crítico)** re-entram no loop e são implementados nesta entrega. P1/P2/P3 ficam
> registrados aqui, sem implementação (política do pipeline).

## PatternGuardian

### PG-1 (P2 — avaliado e RECUSADO, com correção de documentação)

**Achado:** `ItemNdeResumo.prdDesNome` / `.dprLngDescrNf` estão tipados `?: string` enquanto o Zod do
boundary (`ITEM_NDE_SCHEMA`) usa `.nullish()`; o `ItemNde` irmão tipa `?: string | null`. O agente
pediu alinhar os dois para `| null`.

**Decisão: não alinhar.** Os dois tipos existem justamente porque são coisas diferentes:

- `ItemNde` é o **eco cru** da linha do ERP, e precisa preservar `null` — é o objeto que volta no
  read-modify-write, onde campo omitido vira `null` no banco.
- `ItemNdeResumo` é a **projeção normalizada** do `listItensNde`, que colapsa `null` e string em
  branco em AUSENTE antes de projetar. Tipar `| null` ali obrigaria todo caller a tratar um `null` que
  não pode ocorrer, e enfraqueceria o invariante que o colapso existe para dar ("um único teste
  `=== undefined` decide se há descrição").

O que o achado acertou foi a **legibilidade**: a assimetria não se explicava sozinha. Corrigido com um
bloco de doc em `NdeFiscal.ts` dizendo qual é a projeção e qual é o eco cru, e por quê.

## Regis-Review

Ver `docs/regis-review/2026-08-12-1315/KANBAN.md` e `REPORT.md`. Cards P1/P2/P3 abaixo (P0, se houver,
foram remediados nesta branch e não aparecem aqui).

**Resultado do gate: ZERO achados P0.** Nenhuma remediação re-entrou no loop. Score geral **7,7/10**
(8 seções: Integrability 8 · Modifiability 8 · Security 8 · Testability 8 · Deployability 8 ·
Availability 7,5 · Performance 7 · Fault Tolerance 7). 34 achados consolidados em **28 cards**
(6 P1 · 6 P2 · 16 P3) após unificar 4 duplicados cross-QA nos `xqa-*`.

### P1 — 6 cards (2 já CORRIGIDOS nesta branch)

> Os dois P1 **introduzidos pelo delta** foram corrigidos a pedido do Yuri, fora da política padrão
> (que só reintroduz P0 no loop) — ambos eram S e um deles enfraquecia a prova do próprio conserto.

| Card | O quê | Origem | Estado |
|---|---|---|---|
| `fault-tolerance-2` | `slice(0, 4000)` contava code units UTF-16, mas a coluna Oracle é `VARCHAR2(4000 BYTE)`. Texto pt-BR acentuado de 4000 chars vira ~8000 bytes → `ORA-12899`. Vetor concreto: a env de fallback. | **delta** | ✅ **corrigido** — `truncarPorBytesUtf8` corta por code point até caber em 4000 bytes; constante renomeada para `DESCRICAO_IMPRESSAO_MAX_BYTES`. 4 testes (ASCII, acentuado, surrogate na borda, dentro do limite). Verificado por mutação: com o `slice` antigo, 2 deles falham. |
| `testability-1` | A fixture do fallback #3 usava `'PAGAMENTO ANTECIPADO'`, string idêntica ao `NDE_GERACAO_DEFAULTS.produtoNome` (fallback #4) — o teste passava por coincidência, e uma regressão do ramo #3 ficava invisível. | **delta** | ✅ **corrigido** — fixture passa a ser `'DESCRICAO CADASTRADA DO PRODUTO'`, com asserção explícita de que difere do default; novo teste isola o fallback #4. Verificado por mutação: colapsar os ramos #3/#4 agora quebra a suíte. |
| `availability-1` | `ConexosBaseClient` sem `timeout:` no axios (só o `BcbClient` tem). O delta soma 3–4 chamadas síncronas ao caminho do "Processar". | herdado (agravado) | aberto |
| `fault-tolerance-1` | RMW do item sem controle otimista de versão: edição concorrente do analista entre GET e PUT é sobrescrita em silêncio, inclusive em campos que a automação não quis tocar. | **delta** (classe herdada do com300) | aberto |
| `testability-6` | 14 testes vermelhos permanentes no baseline da `main`. | herdado | ✅ **resolvido na origem** — o rebase em `origin/main` trouxe os 6 commits que consertaram as 4 suítes e2e. Suíte inteira verde (1188/1188). |
| `modifiability-2` | `RecebimentoNumerarioService` a 1897 LOC (3,16× o cap). Delta soma +120 (+6,7%) — não é regressão. Split (`NdeCaudaFiscalService`) fica para o próximo tweak que tocar ≥ 2 `etapa*` fiscais. | herdado | aberto |

### P2 — 6 cards

- `xqa-1` — preflight de ACL casa `com297` por substring (já bate em HOMOLOGAR), então o grant novo
  "alteração de item" não é distinguível; falha vira 403 cru no primeiro real-run. Unifica
  `deployability-1` + `integrability-1` + `security-2`. **Herdado**, ativado pelo delta.
- `xqa-2` — a correção não deixa rastro no ledger, só `BUSINESS_WARN`. Duas colunas
  (`descricao_item_corrigida`, `descricao_item_fonte`) resolvem 3 achados de QAs distintos.
- `xqa-3` — nenhum e2e exercita o ramo de ESCRITA (os 4 só programam o no-op); e N>1 não é coberto.
- `security-1` — `dprLngDescrNf` não é sanitizado contra caracteres de controle/BOM antes de virar
  `xProd` da NF-e.
- `fault-tolerance-4` — `preDescrProdutoNf` é best-effort e não-determinístico: duas retomadas com
  flake podem gravar textos diferentes.
- `fault-tolerance-5` — NDe sem item loga WARN e segue, gastando 3 round-trips antes de o ERP recusar.

### P3 — 16 cards

`availability-3` · `xqa-4` (kill-switch por etapa) · `deployability-2` (§Rollback no ADR) ·
`deployability-4` (drift de env no Render) · `integrability-2` · `integrability-3` ·
`modifiability-1` (breadcrumb no `etapaOrdem`) · `modifiability-3` (regra dos três no RMW) ·
`modifiability-4` (fallback por-cliente) · `performance-1` (página cheia no list) ·
`performance-3` (instrumentar empty vs comum) · `performance-4` (precedência é intencional) ·
`security-3` (mode 0600 no dump da sonda) · `testability-2` · `testability-4` · `testability-5`.

### Os dois que eu levantaria primeiro

`fault-tolerance-2` e `testability-1`. Ambos são S, ambos são do delta, e o segundo é o mais
incômodo: o teste que prova o conserto passa por coincidência de string, então a regressão que
reintroduz **exatamente o bug que esta branch veio consertar** não acende nada.

## Pendências herdadas (não são desta feature)

- **Sonda de confirmação não executada.** `recebimentos.e2e.descricaoNfeNde.integration.test.ts` (read-only)
  confirma, contra o tenant, se o XML sai do `dprLngDescrNf` **gravado** ou é recalculado na
  homologação. Rodar com um doc que falhou e um que homologou.
  Ver `_inbox/nde-descricao-produto-nfe-diagnostico.md`.
- ~~**4 suítes e2e de rota vermelhas na `main`**~~ — **resolvido**. Eram 14 testes
  (`recebimentos.e2e{,.falhas,.gates,.retomada}.test.ts`), pré-existentes e não regressão desta
  branch. Os 6 commits que a `main` recebeu enquanto esta branch estava no gate consertaram as quatro
  suítes; o rebase trouxe as correções e o `npm test` fecha **1188/1188, 103 suítes**.
- **ACL da conta de serviço:** a etapa nova exige a ação de **alteração de item** em `com297`
  (`PUT comDocProdutos`). Sem ela a etapa falha fail-closed (403) antes de qualquer escrita
  irreversível — mas é pré-requisito operacional a confirmar no tenant.
