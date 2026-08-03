# HANDOFF — estado em 2026-08-03 (fim da sessão de auditoria + E2E real)

> Leia primeiro: `docs/reforma-tributaria/00_fonte_da_verdade_ibs_cbs.md` (§10 RT-001..RT-014) e
> `docs/reforma-tributaria/02_auditoria_gap_report.md`. Depois esta página inteira.
> **Tarefa nº 1 da próxima sessão** está no §6.

## 1. O que esta sessão fez

Duas frentes, nesta ordem:

1. **Auditoria de conformidade IBS/CBS** (RT-001..RT-014) — gap report com evidências, 6 testes de
   caracterização, info-gaps para o fiscal. Nada de produto foi alterado nessa fase.
2. **E2E de verdade** — harness sem Docker (ERP fake em processo), depois **contra o Conexos de
   homologação real**, incluindo **escrita real** (Fase B). Foi aqui que apareceram os achados
   grandes: 3 bugs de produto e 1 gap estrutural.

## 2. Branches e commits (tudo local; nada foi pushado)

| Branch | Onde está | Conteúdo |
|---|---|---|
| `dev` | local, = `97b2d86` | **branch de integração desta linha de trabalho.** Contém tudo abaixo. |
| `test/e2e-recebimentos-extrato-nde` | local, = `dev` | branch de trabalho da sessão |
| `fix/sn-cond-pgto-finalizacao` | local + worktree `C:/tmp/sn-condpgto-wt` | **2 commits com os fixes** (`fb693fc`, `aebc905`). Suíte 97 suites / **1005 testes verdes**. **Ainda não mergeada, sem Regis-Review, sem PR.** |
| `origin/feat/recebimentos-numerario-real` | remoto | **branch do colega — tem 1 commit NOVO (`9c4224a`) que ainda não vimos integrado.** Ver §6. |

Commits desta sessão em `dev` (do mais antigo ao mais novo):
`7c25fe2` auditoria IBS/CBS (gap report + 6 testes de caracterização) ·
`8c76e54` E2E extrato→NDe com ERP fake (12 testes) ·
`e827882` E2E falhas/retomada/gates (16 testes, 3 agentes) ·
`58b1838` sondagem do Conexos HML ·
`05910a9` Fase A (E2E read-only contra HML real) ·
`562c798` setup de dados-mestre no HML ·
`7bc171a` Fase B (escrita real) + 2 bugs ·
`97b2d86` Fase B rodada 2 + gap dos títulos.

## 3. Ambiente pronto (não precisa refazer)

- **Sem Docker.** O harness E2E usa ERP fake em processo + fakes in-memory nos tokens de DI.
  Docker foi desinstalado do disco (estava cheio); não reinstale.
- **HML acessível** de `columbiatrading-hml.conexos.cloud` com as credenciais em
  `src/backend/.env` (gitignored; `CONEXOS_BASE_URL` **travado no HML**). Usuário: MPS_FRANCINEI.
- **Dados-mestre criados no HML** (espelhando produção — detalhes em `hml-setup-executado.md`):
  conta de projeto **699** "ADIANTAMENTO DE CLIENTE ENCOMENDA", configuração de documento **186**
  "NOTA DE DEBITO PAGAMENTO ANTECIPADO" (filial 2, ATIVO) + item, CFOP `5949-ND` corrigido e
  `6949-ND` criado. Env já aponta `COM297_GCD_NOTA_DEBITO=186`.
- **Resíduos inócuos no HML**: SN **731**, **732**, **733** (sem título, sem baixa, sem NDe).

### Testes E2E disponíveis

| Arquivo | O que faz | Como rodar |
|---|---|---|
| `routes/recebimentos.e2e.test.ts` (+ `.falhas`, `.retomada`, `.gates`) | 28 testes contra ERP fake, na suíte padrão | `npm test` |
| `routes/recebimentos.e2e.hml.integration.test.ts` | **Fase A**: HML real, read-only (aborta se a URL não for `-hml`) | `npx jest recebimentos.e2e.hml --testPathIgnorePatterns "/node_modules/"` |
| `routes/recebimentos.e2e.hmlWrite.integration.test.ts` | **Fase B**: HML real com **escrita** | idem, `recebimentos.e2e.hmlWrite` |

⚠️ Os `*.integration.test.ts` ficam fora do `npm test` por padrão. A execução deles **precisa ser
disparada pelo Yuri** (o classificador de permissões bloqueia o agente).

## 4. Achados de produto (o valor real desta sessão)

| # | Achado | Status | Evidência |
|---|---|---|---|
| 1 | `escolherCondicaoPagamento` gravava condição de **outro cliente** (LOV ignora `pesCod`, lista global paginada) — gravou BONDUELLE num doc do SKYJACK | **corrigido** em `fix/sn-cond-pgto-finalizacao` e **validado no HML** (agora grava `101 SKYJACK BRASIL - DUPLICATA`) | `fase-b-resultado-hml.md` |
| 2 | `finalizarDocumento` tratava HTTP 200 como sucesso, mas o doc ficava `docVldFinalizado=0` | **corrigido** e validado (para na etapa `sn` com mensagem correta) | idem |
| 3 | ERP **ignora `pageSize`** (50/página, `count` no envelope) | **corrigido** (paginação por `count`) | `fase-b-rodada2-e-gap-titulos.md` |
| 4 | **GAP ESTRUTURAL: a automação nunca gera os TÍTULOS do documento** | **ABERTO — bloqueia o E2E** | mensagem do ERP: *"O TOTAL DOS TÍTULOS: 0.00 NÃO CONFERE COM O TOTAL DO DOCUMENTO: 123.45"* |
| 5 | `COM297_GCD_NOTA_DEBITO_NOME` default errado + `resolveGcdCodByName` inviável (`com297/list` devolve `gcd*` nulos) | aberto (o colega pode ter resolvido — ver §6) | `hml-setup-executado.md` |
| 6 | RT-001 confirmado em **escrita real**: `dprVldCstIbsCbs:"-1"` persistido no ERP em 3 documentos | aberto (gate fail-closed não implementado) | `fase-b-resultado-hml.md` |

### Sobre o achado nº 4 (o mais importante)

O fluxo do orquestrador é: condição de pagamento → linha de item → **finalizar**. Falta a etapa de
**gerar as parcelas/títulos** entre o item e a finalização. Na UI é o botão **"Financeiro"** do
com299, que abre a tela **com032** (`com032.viewFinTitulo`, confirmado no JS público
`views/com299.js`). O contrato **não foi capturado**: o JS do com032 dá 403 no CDN,
`com032/initialValues` dá 404 e nenhum doc do HML tem título para inspecionar o shape.

**Consequência:** o `fin014` depende desse título (`lov/TituloBorderoReceber`), então **o fluxo
automatizado nunca poderia concluir sozinho**. O HAR de produção mostrava a SN já com título —
sinal de que o analista fazia esse passo **manualmente**.

## 5. Estado da auditoria fiscal (inalterado)

`docs/reforma-tributaria/02_auditoria_gap_report.md` tem a tabela RT × veredito × evidência ×
severidade e o backlog priorizado. Os 6 info-gaps para o fiscal da Columbia estão em
`ontology/_inbox/reforma-tributaria-gap.md` — **ainda sem resposta**. O item nº 1 do backlog (gate
fail-closed de CST IBS/CBS) segue não implementado.

## 6. TAREFA Nº 1 DA PRÓXIMA SESSÃO — integrar o trabalho do colega

`origin/feat/recebimentos-numerario-real` recebeu **`9c4224a`** — *"fix(recebimentos): NDe com297
real-generation fixes + async SEFAZ authorization"* (feito por outro agente, também com teste
live/HAR em 2026-08-02/03). Pelo corpo do commit, ele resolve coisas que também vimos:

- com297 usa `globalDocVldTipo=0` (não o 9 da SN) — com 9 o processo rejeitava a config 248;
- produto 41978 vai no **header** do `gerDocProcesso`, não em POST separado de `comDocProdutos`;
- envia `endCodFis`/`pdcDocFederal` reais do pré-flight; série NFE1 default;
- `docVldComvalidacoes=0` tratado como 2 (homologada com revisão humana);
- **autorização SEFAZ assíncrona**: `markSettled` logo após homologar, sem poll bloqueante;
- persiste a NDe em `nota_debito_eletronica`; novo `GET /recebimentos/execucoes`.

**Ele tocou 15 arquivos, incluindo `RecebimentoNumerarioService.ts` (113 linhas) — o MESMO arquivo
dos nossos fixes.** Conflito é provável em `completarSnAdiantamento`/`etapaSn`.

Roteiro sugerido:

1. `git fetch origin` e leia `git show 9c4224a` inteiro (+ `ontology/_inbox/com299-sn-generation-har.md`,
   que ele adicionou — pode conter o HAR que responde o achado nº 4).
2. Verifique se ele já resolveu os achados 1, 2, 3 e 5 (provavelmente **não** os 1–3; o 5 talvez).
3. Rebase/merge `origin/feat/recebimentos-numerario-real` em `dev`, resolvendo os conflitos do
   `RecebimentoNumerarioService.ts` com cuidado — **preserve os dois fixes** (condição de pagamento
   do próprio cliente com paginação por `count`; verificação `docVldFinalizado===1`), que estão
   validados contra o ERP real e cobertos por testes de regressão.
4. Rode `npm test` (esperado: ~1005 testes verdes antes do merge; recalibre depois).
5. Se o HAR dele **não** cobrir a geração de títulos (achado nº 4), peça ao Yuri o HAR da tela
   (doc 733 no HML → botão **Financeiro** → gerar/salvar o título → DevTools/Network) e só então
   implemente a etapa `etapaTitulos` (com discriminador próprio: reler o doc e exigir
   `mnyTitValor === docMnyValor`).
6. Com isso verde, repita a **Fase B** (o Yuri dispara) e siga para fin014 → NDe → homologação →
   SEFAZ. O objetivo final continua sendo **ver o XML autorizado** e responder se sai com grupo
   IBS/CBS (RT-001/RT-003).

## 7. Pendências de processo

- `fix/sn-cond-pgto-finalizacao` **não passou pelo Regis-Review** nem virou PR (o pipe exige ambos
  antes do merge). Worktree ainda montado em `C:/tmp/sn-condpgto-wt` (com `node_modules` por junction).
- Nenhum branch foi pushado — decida com o Yuri o que sobe.
- `npm run lint` do backend está quebrado **de forma pré-existente** (formatação CRLF repo-wide);
  não é regressão desta sessão.
