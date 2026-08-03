# Runbook — primeira execução do fluxo de Recebimentos em PRODUÇÃO

> Escrito em 2026-08-03, quando o HML foi **encerrado como fonte de informação** para a perna
> `fin014 → NDe`: o defeito `CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE` é do ambiente inteiro, medido nas
> filiais 1 e 2 com braço de controle (`fin014-finalizacao-hml-diagnostico.md` §12.3).
>
> **Premissa desta execução:** ela roda sobre um **caso real pendente** — um adiantamento de cliente que
> legitimamente precisa de NDe. A nota emitida é trabalho, não resíduo de teste. Por isso o fluxo vai
> **até o fim**, incluindo homologação e SEFAZ.

## 1. O que já está provado, e onde

Vale ter isto na cabeça antes de apertar o botão — é o que separa "estreia" de "repetição".

| Perna | Provado onde |
|---|---|
| SN com299: geração → item → finalização com título | **HML, pelo código do produto, na rota real** (Fase B, doc 738) |
| `fin014` borderô + baixa | HML até a baixa; a **finalização** só em produção (SN 18345) |
| NDe com297 + fiscal + observações + homologação + SEFAZ | **só produção** (SN 18345, pelo colega) |
| `applyPaymentConditionIfRequired` (ramo condicional) | **nenhum ambiente** — ver §3 |
| Persistência Postgres (ledger + `nota_debito_eletronica`) | **nenhum ambiente neste fluxo** — tudo fake nos E2E |

Ou seja: produção já executou esta cadeia inteira uma vez. O que produção **nunca** rodou é o *código
novo* — e o código novo mudou justamente o passo cujo comportamento divergia entre os dois ambientes.

## 2. A escolha do caso — duas restrições duras

**Filial 2 a 7.** O `SN_GCD_COD=150` (SN-Encomenda) é **por-filial**: na **filial 1** ele devolve
`CFOP_INCOMPATIVEL` para *todo* processo, e o gcd próprio dela nunca foi capturado. Um caso da filial 1
para no pré-flight como `BLOCKED_ELEGIBILIDADE` — não é bug, é cadastro (`com299-sn-generation-har.md`).

**Cliente sem condição de pagamento sugerida.** Se o cadastro do cliente tiver uma condição, a com194
pode exigi-la e acionar `applyPaymentConditionIfRequired` — o ramo que **nunca rodou em nenhum
ambiente**. Com um cliente sem condição, o PUT simplesmente não acontece, que é o caminho já demonstrado
em produção. Não estreie dois desconhecidos na mesma rodada.

> **Não use o L-FOUNDERS (pesCod 194).** Tem condição sugerida **e** a NDe dele (18337) voltou com
> `docVldComvalidacoes: 2` e valor zerado. É o pior caso possível para uma primeira execução.

## 3. Passo 0 — pré-flight, sem escrever nada

`src/backend/routes/recebimentos.e2e.prodPreflight.integration.test.ts` responde o go/no-go do caso
escolhido. É a **única** sonda do repositório que aponta para produção, e é estruturalmente incapaz de
escrever: toda chamada passa por uma allowlist de rotas de leitura, e há um teste que prova a trava.

Credenciais vêm do **shell**, nunca de arquivo:

```bash
cd C:/tmp/erp4xx-wt/src/backend
CONEXOS_PROD_BASE_URL=https://<producao>/api \
CONEXOS_PROD_USERNAME=... CONEXOS_PROD_PASSWORD=... \
PROD_FIL_COD=2 PROD_PRI_COD=<processo> \
npx jest recebimentos.e2e.prodPreflight --testPathIgnorePatterns "/node_modules/"
```

Quatro respostas, e o que fazer com cada uma:

| Checagem | Verde | Vermelho |
|---|---|---|
| pessoa / endereço fiscal / CNPJ do processo | segue | processo sem cadastro fiscal — outro caso |
| elegibilidade no `SN_GCD_COD` | segue | outro processo, ou capture o gcd da filial |
| **condição de pagamento no cadastro** | `count: 0` → **verde** | tem condição → prefira outro cliente |
| config da NDe resolvida pelo NOME | gcd encontrado | **pare** — a etapa `nota-debito` falharia |

## 4. Configuração da execução

O fluxo real roda pela **UI** (`/recebimentos` → *Alocar processos* → **Processar**), que é o caminho do
analista, não por jest. O backend precisa de:

| Variável | Valor | Por quê |
|---|---|---|
| `CONEXOS_BASE_URL` | produção | hoje está **travado no HML** |
| `CONEXOS_FIL_COD` | a filial do caso | hoje `2` |
| `CONEXOS_WRITE_ENABLED` | `true` | default é `false` |
| `CONEXOS_DRY_RUN` | `false` | default é `true` |
| `SN_GCD_COD` | `150` | já é o valor de produção (filiais 2–7) |
| `COM297_GCD_NOTA_DEBITO` | **não setar** | o código é por-ambiente (`186` é do HML); sem a env o com297 resolve pelo NOME |
| `databaseConnectionString` | Postgres real | o ledger e a `nota_debito_eletronica` são gravados de verdade — é a camada nunca exercitada |

> Os defaults de `CONEXOS_WRITE_ENABLED` e `CONEXOS_DRY_RUN` são seguros: quem não faz nada, não escreve.
> Ambos precisam ser ligados **conscientemente**.

Código: worktree `C:/tmp/erp4xx-wt`, branch `fix/erp-4xx-nao-retentavel` (contém toda a pilha).

## 5. O que observar, etapa por etapa

O ledger registra a etapa alcançada; o console traz `[LEDGER]`. Cada etapa tem **discriminador próprio** —
nunca trate HTTP 200 como sucesso.

| Etapa | Discriminador | Se falhar aqui |
|---|---|---|
| `sn` | `docVldFinalizado === 1` **e** `mnyTitValor === docMnyValor` | documento pode ficar sem título — o fail-closed avisa com o `docCod` |
| `fin014` | borderô criado, título achado no LOV, baixa com `bxaCodSeq`, finalização OK | borderô/baixa são **excluíveis** pela API (baixa primeiro) |
| `nota-debito` | `docCod` da NDe | NDe rascunho é excluível |
| `fiscal-done` | eco `fisVldTipoNfDebito === 6` | rascunho ainda excluível |
| `obs-done` | observações SINIEF gravadas | rascunho ainda excluível |
| **`homologado`** | `docVldComvalidacoes` | **ponto sem volta** — a partir daqui é fato fiscal |
| `concluido` | `vldAutorizado` da SEFAZ | assíncrono; `settled` com `ndeAutorizado:false` é aceitável e reconcilia depois |

**A fronteira que importa:** tudo até `obs-done` o analista desfaz no ERP. `homologado` em diante, não —
só cancelamento dentro do prazo legal.

## 6. Se quebrar no meio

A execução é **retomável**: o ledger guarda a etapa e a chave de idempotência
(`sn-real:{txnId}:{priCod}:{valor}`); reprocessar pula o que já foi feito em vez de duplicar. Não refaça
manualmente no ERP o que a automação já gravou — isso quebra a retomada.

Com o ADR-0026 no lugar, uma **recusa do ERP (4xx)** agora falha na primeira tentativa e traz a razão
crua dele na mensagem. Se a mensagem disser "tente novamente", é indisponibilidade de verdade
(5xx/timeout), não veredito.

## 7. Depois que a NDe for autorizada

Capturar o XML/documento e responder as perguntas fiscais pendentes — sai com grupo IBS/CBS? `finNFe=6`?
`tpNFDebito`? `DFeReferenciado`? (RT-001/002/003). Alimenta `ontology/_inbox/reforma-tributaria-gap.md`.
O gate fiscal RT-001 (`dprVldCstIbsCbs: "-1"`) segue **não implementado** — backlog da auditoria IBS/CBS.
