# Auditoria de Conformidade IBS/CBS — Gap Report (RT-001..RT-014)

> **Sessão:** 2026-08-02/03 (véspera da obrigatoriedade sob rejeição de 03/08/2026).
> **Fonte da verdade:** `docs/reforma-tributaria/00_fonte_da_verdade_ibs_cbs.md` (§10).
> **Escopo:** auditoria de conformidade — NENHUMA mudança de produto foi feita. Artefatos desta
> sessão: este relatório, testes de caracterização (ver §3) e
> `ontology/_inbox/reforma-tributaria-gap.md` (info-gaps para o fiscal da Columbia).
> **App auditado:** v0.19.0, branch `feat/recebimentos-numerario-real`.

## 1. Baseline verificado

| Gate | Resultado |
|------|-----------|
| `npm run typecheck` | ✅ exit 0 |
| `npm test` (antes da auditoria) | ✅ 92 suites / 960 testes |
| `npm test` (com os 6 testes de caracterização) | ✅ 93 suites / 966 testes |
| `npm run lint` | ⚠️ **falha pré-existente** (dezenas de arquivos com erro de *format* + 2 de complexidade cognitiva em `ConexosCadastroClient`/`ConexosFinanceiroClient`) — não relacionado à auditoria; o arquivo novo passa `biome check` limpo |

## 2. Tabela RT × veredito

Vereditos: **CONFORME** / **GAP** / **INDETERMINADO** (falta acesso/artefato para verificar) /
**ERP** (responsabilidade do Conexos — monitorar). Severidade: **P0** = pode rejeitar NF ou perder a
dispensa do art. 348 §1º a partir de 03/08/2026; **P1** = compliance de negócio imediato; **P2** =
estrutural/2027; **P3** = monitorar.

| RT | Requisito (resumo) | Veredito | Evidência (file:line) | Severidade |
|----|--------------------|----------|------------------------|------------|
| **RT-001** | NDe autorizada com grupo IBS/CBS válido (CST ≠ `-1`); fail-closed se CST não classificado | **GAP** | `RecebimentoNumerarioService.ts:472-491` — spread cego do template `comDocProdutosInitialValues` reenvia `dprVldCstIbsCbs:"-1"`; grep confirma que **nenhum** identificador IBS/CBS (`dprVldCstIbsCbs`, `cClassTrib`, `CST`) é lido/criticado em `src/backend`; template é `Record<string, unknown>` sem Zod fiscal (`ConexosGerDocProcessoClient.ts:836-858`); nenhuma verificação pós-autorização no poll (`RecebimentoNumerarioService.ts:1014-1048`) | **P0** |
| **RT-002** | Tipo da ND (`fisVldTipoNfDebito`/`tpNFDebito`) por hipótese real; nunca hardcode único | **GAP** (parcial) | `constants.ts:308` define apenas `NDE_FISCAL_TIPO_NF_DEBITO_PAGAMENTO_ANTECIPADO = 6`; `RecebimentoNumerarioService.ts:913-916` seta 6 incondicionalmente; `ConexosNdeFiscalClient.ts:114-121` valida o eco **contra a mesma constante** (o client rejeita qualquer outro tipo). O tipo 6 está CORRETO para a hipótese atual (adiantamento/pagamento antecipado — único fluxo automatizado), mas a arquitetura impede qualquer outra hipótese (juros/multa, complemento) | **P1** (vira P0 quando juros/multa forem cobrados) |
| **RT-003** | ND de ajuste referencia o DF-e original (`DFeReferenciado`) | **INDETERMINADO** | grep em `src/`: `DFeReferenciado`/`finNFe`/`tpNFDebito` — **0 ocorrências**. A solução não referencia nem verifica; se o Conexos o faz via config `gcd`, só o XML autorizado responde. Necessário: XML de NDe autorizada pós-03/08/2026 (info-gap #1) | **P0** se o ERP não fizer; **ERP** se fizer |
| **RT-004** | Juros/multa cobrados devem compor a base via ND com destaque | **GAP** (latente) | `RecebimentoNumerarioService.ts:822-824` — `bxaMnyJuros: 0, bxaMnyMulta: 0, bxaMnyDesconto: 0` hard-zerados; regra `separacao-multa-juros` é STUB (`ontology/business-rules/separacao-multa-juros.md`, `implementation_status: planned`); enum `PARCELA_FINALIDADE.MULTA/JUROS` existe (`constants.ts:55-60`) mas nada o usa no caminho real | **P1** hoje (nada é cobrado) / **P0** quando a regra sair do STUB |
| **RT-005** | Repasse excluído da base SÓ com doc do custo em nome do cliente; registrar o vínculo documental | **GAP** | `RateioRecebimento.ts:14-28` — modelo não tem NENHUM campo de vínculo documental (em nome de quem está o documento do custo); nenhum processo/validação no código; risco é do modelo de negócio da Columbia (repasse de numerário) | **P1** (compliance imediato — negócio) |
| **RT-006** | Comissão/serviço próprio segregado do reembolso na cobrança | **GAP** | Mesma evidência de RT-005 — a NDe é emitida com UMA linha de produto (41978) com o valor cheio da alocação (`RecebimentoNumerarioService.ts:884-894`); sem segregação serviço × reembolso | **P1** (compliance imediato — negócio) |
| **RT-007** | `docMnyValor = 0` pós-homologação deve BLOQUEAR (erro/revisão humana) | **GAP** | `RecebimentoNumerarioService.ts:976-984` — warn não-bloqueante ("aceitável por decisão — não bloqueia"); pendência #1 do spec (`ontology/integrations/recebimentos-numerario-real-fiscal-spec.md:63`) já marcava **[ALTO]** "confirmar com o fiscal antes de produção" | **P0** |
| **RT-008** | Divergência `prdCod` (item 2 × com194 espera 41978) resolvida antes de produção | **GAP** | Item da SN usa `prdCod` do template (= `2` no HAR — `RecebimentoNumerarioService.ts:477-491`); NDe usa `41978` (`constants.ts:296-300`, `RecebimentoNumerarioService.ts:884-894`); pendência #5 do spec (`recebimentos-numerario-real-fiscal-spec.md:67`). Item errado ⇒ `cClassTrib` errado no grupo UB | **P0** (por arrasto do RT-001) |
| **RT-009** | Percentuais 0,1%/0,9% = repasse do IBS/CBS-teste? Base/arredondamento/vigência na regra | **INDETERMINADO** | `ontology/business-rules/encomenda-percentuais.md` — STUB sem base/significado/destino; `ENCOMENDA_PERCENTUAIS_RESOLVED = false` trava escrita real (`constants.ts:145`); coincidência exata com as alíquotas do ano-teste (CBS 0,9% + IBS 0,1%, LC 214 art. 348) precisa de confirmação do fiscal (info-gap #2) | **P1** (bloqueia a saída do STUB) |
| **RT-010** | Matching desenhado para tolerar `bruto − (IBS+CBS)` por parcela (split payment 2027+) | **GAP** (estrutural, aceito p/ 2026) | `stubs/MatchingEngineStub.ts:16-21` — matching é stub que devolve sempre `nenhuma`; nenhuma noção de decomposição de tributo em `normalizarLancamento.ts`. Não é exigência 2026; é decisão de arquitetura a registrar antes do engine real | **P2** |
| **RT-011** | Falhas fiscais auditáveis (ledger) e visíveis (painel) | **CONFORME** (parcial) | Ledger write-ahead por etapa: `migrations/0041_solicitacao_numerario_execucao.sql` + `0042_..._fiscal.sql`; `markError`/`setRevisaoHumana`/`setNdeAutorizado` (`RecebimentoNumerarioService.ts:1004-1007,1093-1128`); fail-closed em erro de etapa. **Ressalva:** os DOIS furos não-bloqueantes (RT-001 CST, RT-007 valor 0) são exatamente os que passam SILENCIOSOS pelo ledger (viram warn de log, não estado visível) | **P1** (fechar a ressalva) |
| **RT-012** | Permutas: `bxaMnyJuros/Multa/Desconto ≠ 0` no fin010 ganham efeito de base — revisar classificação c/ fiscal | **INDETERMINADO** | `ReconciliacaoPermutaService.ts:644-652,714-715` — variação cambial roteada p/ `bxaMnyJuros` (JUROS) ou `bxaMnyDesconto` (DESCONTO), valores ≠ 0 REAIS enviados ao fin010. Se "variação cambial" ≢ "acréscimo financeiro" p/ IBS/CBS, a classificação atual pode estar segura — questão fiscal, não de código (info-gap #5) | **P2** (2027, CBS plena) |
| **RT-013** | GED/Frente III: reconhecer DF-e finNFe 5/6 como tipos documentais | **CONFORME** (vacuamente) | Frente III sem código (confirmado por grep); requisito só ativa na implementação | **P3** |
| **RT-014** | NT v1.50 (03/11/2026): payloads propagados não podem quebrar | **CONFORME** (estrutura) | Clients fiscais usam Zod `.passthrough()` exigindo só identificadores: `ConexosNdeFiscalClient.ts:18-49`; `ConexosNdeClient.ts:17-28`; template de item é `Record<string, unknown>` — campos novos do leiaute fluem sem quebrar. **Monitorar** na troca da NT (é também o mecanismo que causa o RT-001: propaga tudo, não critica nada) | **P3** |

## 3. Testes de caracterização criados

Arquivo: `src/backend/domain/service/recebimentos/RecebimentoNumerario.reformaTributaria.characterization.test.ts`
(6 testes, todos verdes — eles **pinam o comportamento atual**, não o desejado; qualquer correção
futura dos gaps quebra o teste correspondente de propósito e força a revisão consciente):

1. **RT-001** — o item da SN reenvia `dprVldCstIbsCbs="-1"` do template sem crítica e o fluxo
   conclui `settled/concluido` sem bloqueio nem revisão humana.
2. **RT-001** — o RMW do com300 reenvia campos IBS/CBS do `finDocFiscal` intocados (só muda
   `fisVldTipoNfDebito`).
3. **RT-002** — `NDE_FISCAL_TIPO_NF_DEBITO_PAGAMENTO_ANTECIPADO === 6` (única constante de tipo).
4. **RT-002** — `etapaFiscal` grava `fisVldTipoNfDebito=6` independente de qualquer campo da alocação
   (não existe input de "hipótese de ND" no orquestrador).
5. **RT-004** — `fin014.gravarBaixa` envia `bxaMnyJuros=0, bxaMnyMulta=0, bxaMnyDesconto=0` e
   `bxaMnyLiquido = bxaMnyValor`.
6. **RT-007** — NDe homologada com `docMnyValor=0`: warn, sem `markError`, sem revisão humana,
   settled/autorizada.

Cobertura pré-existente que já caracteriza comportamento relevante (não duplicada):
`RecebimentoNumerarioService.test.ts:812-829` (docMnyValor=0 segue), `:723-750` (roteamento de
contingência fail-loud), `:456-464` (gcd com297 fail-closed).

## 4. Verificação dinâmica — INDETERMINADO (sem acesso nesta sessão)

Não há `.env` no checkout (sem credenciais Conexos), portanto **nenhuma chamada dinâmica foi
feita** (nem de leitura). O gate dry-run permanece intacto e ativo por default:
`EnvironmentProvider.ts:120-121` — `conexosWriteEnabled` exige `CONEXOS_WRITE_ENABLED === 'true'` e
`conexosDryRun` só desliga com `CONEXOS_DRY_RUN === 'false'`.

Para fechar os INDETERMINADOs seria necessário (em **homologação**, nunca produção):

1. `POST com299/comDocProdutos/initialValues` de um doc de homologação → capturar o valor REAL de
   `dprVldCstIbsCbs` e demais campos IBS/CBS do template hoje (RT-001).
2. `validaConfigDoc` (com299 e com297) → verificar se a config `gcd` da NDe carrega série/CFOP/
   classificação com grupo IBS/CBS (RT-001/RT-003).
3. **XML de uma NDe autorizada pós-03/08/2026** (via fiscal da Columbia ou portal SEFAZ) → conferir
   `finNFe=6`, `tpNFDebito`, grupos UB (CST/cClassTrib por item), W03 (totais IBS/CBS) e
   `DFeReferenciado` (RT-001/RT-002/RT-003).
4. `GET com297/{docCod}` de doc emitido em homologação → conferir se o retorno expõe campos IBS/CBS
   verificáveis no poll (RT-001, mecanismo de fail-closed pós-autorização).

## 5. Riscos ordenados

### Pode rejeitar NF-e / perder a dispensa do art. 348 §1º (a partir de 03/08/2026)

1. **NDe sai sem grupo IBS/CBS válido (RT-001 + RT-008):** o único conteúdo tributário do item vem
   de um template que hoje devolve CST `-1` (não classificado) e um `prdCod` divergente (2 × 41978).
   Se a SEFAZ rejeitar (faixa 1100–1199), o fluxo inteiro para na homologação; se autorizar sem
   destaque correto, a Columbia perde a dispensa do ano-teste e o tributo (0,9% + 1%) vira devido —
   silenciosamente, pois nada verifica o documento autorizado.
2. **NDe autorizada com base 0 (RT-007):** já OBSERVADO em produção (pendência #1 do spec, HAR
   real: `mnyBruto 100→0`). Documento fiscal autorizado com valor zerado = obrigação acessória
   descumprida com evidência gravada; hoje é warn de log que ninguém vê no painel.
3. **DFeReferenciado ausente (RT-003):** se a hipótese da ND exigir referenciamento e a config do
   Conexos não o fizer, rejeição a partir de 01/09/2026 (devoluções) e inconsistência na apuração
   assistida.

### Compliance de negócio da Columbia (independe do app, mas o app pode custodiar)

4. **Repasse de custos sem vínculo documental (RT-005/RT-006):** se os documentos de frete/
   armazenagem/despachante saem em nome da Columbia, TODO o numerário repassado integra a base
   IBS/CBS dela. É a maior exposição financeira do modelo conta-e-ordem/encomenda — e é verificável
   por documento (art. 12 §2º IV). A solução não registra nem valida nada disso hoje.
5. **Percentuais 0,1%/0,9% sem semântica (RT-009):** se forem o repasse do IBS/CBS-teste, o cálculo
   tem vigência normativa (muda em 2027) e base legal definida — sair do STUB sem essa confirmação
   codificaria um tributo por palpite.

### Quando o escopo crescer

6. **Tipo de ND único (RT-002):** correto para adiantamento, errado no dia em que a automação cobrar
   juros/multa (hipótese própria no Ajuste SINIEF 49/2025) ou complemento.
7. **Juros/multa hard-zerados (RT-004):** hoje ninguém cobra nada por fora; quando a regra
   `separacao-multa-juros` sair do STUB, liquidar juros sem ND com destaque = base omitida.
8. **Split payment (RT-010):** decisão de arquitetura do matching engine real (tolerar/decompor
   `bruto − (IBS+CBS)` por parcela) — barata agora, cara depois.

## 6. Backlog priorizado para a fase de implementação (NÃO implementado nesta sessão)

| # | Item | RT | Entrada no pipe | Nota |
|---|------|----|--------------------|------|
| 1 | **Gate fiscal fail-closed na emissão da NDe**: criticar CST IBS/CBS do template (`dprVldCstIbsCbs ≠ -1` + `cClassTrib` presente) antes de `adicionarComDocProduto`; em falha → `revisao_humana`/erro no ledger, nunca warn | RT-001, RT-011 | `/feature-tweak recebimento "fail-closed de CST IBS/CBS na emissão da NDe"` | Depende do info-gap #4 (quem classifica) para a mensagem ao analista; o GATE não depende |
| 2 | **Bloquear `docMnyValor=0` pós-homologação**: promover o warn a `revisao_humana` persistida no ledger + visível no painel | RT-007, RT-011 | `/feature-tweak recebimento "docMnyValor=0 bloqueia com revisão humana"` | Pendência #1 do spec já pedia confirmação do fiscal; o bloqueio é seguro independente da resposta |
| 3 | **Resolver a divergência `prdCod` 2×41978** (item da SN × item da NDe × expectativa do com194) | RT-008 | `/investigate "prdCod divergente na NDe (item 2 × com194 41978)"` | Investigação primeiro: pode ser config do ERP, não bug do app |
| 4 | **Verificação pós-autorização** (leg nova): após `vldAutorizado`, conferir no retorno do ERP (ou XML) o grupo IBS/CBS/nº da NF e gravar o resultado no ledger | RT-001, RT-003, RT-011 | `/feature-new "verificacao fiscal pós-autorização da NDe"` | Precisa do XML de homologação (info-gap #1) para saber o que é verificável via API |
| 5 | **Registrar vínculo documental do repasse** no modelo (`RateioRecebimento.documentoCustoEmNomeDe` ou entidade própria) + processo com o financeiro | RT-005, RT-006 | `/feature-new "vinculo documental do repasse (art. 12 §2º IV)"` | Bloqueado pelo info-gap #3 (em nome de quem saem os docs hoje) |
| 6 | **Tipos de ND por hipótese**: enum `NDE_FISCAL_TIPO_NF_DEBITO_*` completo + parâmetro de hipótese na etapa fiscal (default = 6) | RT-002 | `/feature-tweak nota-debito-eletronica "tipo de ND por hipótese"` | Sem urgência enquanto só houver adiantamento; pré-requisito do item 7 |
| 7 | **Regra `separacao-multa-juros` com destaque fiscal**: quando sair do STUB, juros/multa → ND própria (tipo correto) em vez de `bxaMny* = 0` | RT-004 | Fase 4 (OfficeHours próprio, já planejado) — incluir o requisito fiscal no interview | Não abrir antes da Fase 4 |
| 8 | **Regra `encomenda-percentuais` com vigência normativa** (se confirmado = IBS/CBS-teste) | RT-009 | Fase 4 — bloqueada pelo info-gap #2 | `ENCOMENDA_PERCENTUAIS_RESOLVED=false` já trava escrita |
| 9 | **ADR de arquitetura do matching p/ split payment** (tolerância/decomposição por parcela) | RT-010 | ADR via `OntologyCurator` (sem código) | Antes do Módulo 2 (engine real) |
| 10 | **Revisão fiscal da classificação variação cambial (Permutas)** | RT-012 | Info-gap #5 → depois `/feature-tweak` se o fiscal reclassificar | 2027 |

## 7. Observações finais

- **O desenho "o ERP decide o fiscal" é defensável** (a solução não calcula tributo; CFOP/série/
  classificação vêm do Conexos) — mas ele exige o complemento que falta: **verificar** o que o ERP
  devolveu antes e depois da autorização. Propagar sem criticar (RT-001) e concluir sem conferir
  (RT-007) é o padrão que transforma um erro de config do ERP em infração acessória automatizada.
- Os 4 info-gaps do §10 da fonte da verdade + 1 novo (RT-012) estão registrados em
  `ontology/_inbox/reforma-tributaria-gap.md` no formato do InfoGapBroker.
- Baseline de lint está quebrado no repo (formato, pré-existente) — vale um `npm run lint:fix`
  dedicado fora desta auditoria.
