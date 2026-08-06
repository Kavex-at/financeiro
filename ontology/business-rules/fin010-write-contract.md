# Business Rule — Contrato de escrita `fin010` (baixa/permuta de adiantamento)

> **Origem:** engenharia reversa de um HAR real (DevTools Network) de UMA baixa/permuta manual
> executada por um analista no `fin010 #/cadastro` (2026-06-23). Risco arquitetural #1 — a **primeira
> escrita** do sistema no Conexos. Ver ADR-0013 e `integrations/conexos.md` (seção WRITE).

## Descoberta-chave: a baixa NÃO é um POST único

O `fin010` valida cada ponta no servidor antes de gravar. Executar uma permuta **adiantamento → invoice**
é um **handshake de 5 chamadas** (todas `POST`, base `/api`). Em permuta múltipla, os passos 2–5 repetem-se
**por par adto→invoice** dentro do mesmo borderô.

| # | Endpoint | Papel | Entrada que NÓS controlamos | Saída relevante do ERP |
|---|----------|-------|------------------------------|------------------------|
| 1 | `POST /api/fin010` | Cria o borderô | `borDtaMvto` (epoch-ms), `borVldTipo:2`, `borVldFinalizado:0`, `frontModelName:"bordero"`, `filCod` | **`borCod`** (id do borderô) |
| 2 | `POST /api/fin010/baixas/validacao/tituloBaixa` | Valida a **invoice** | `docCod`=invoice, `titCod` (parcela), `docTip:2`, `borCod`, `filCod` | `responseData.bxaMnyValor` (valor do título), contas default (`bxaCodGerJuros` etc.) |
| 3 | `POST /api/fin010/baixas/validacao/tituloPermuta` | Valida o **adiantamento** | `bxaDocCod`=adto, `bxaTitCod`, `bxaDocTip:2`, `borCod`, `filCod` | `gerNumPermuta`, `gerDesPermuta`, `pesCod`, `dpeNomPessoa`, `bxaMnyValorPermuta` |
| 4 | `POST /api/fin010/baixas/validacao/atualizaValorLiquido` | Recalcula o líquido | `docCod`, `titCod`, `bxaMnyValor`, `bxaMnyJuros` (=variação), `bxaMnyDesconto`, `bxaMnyMulta`, `borCod`, `filCod` | `responseData.bxaMnyLiquido` |
| 5 | `POST /api/fin010/baixas` | **Grava a baixa/permuta** | payload consolidado (ver abaixo) | **`bxaCodSeq`** (sequência da baixa) — confirmação |

> O ERP é a **fonte da verdade dos valores** (`bxaMnyValor`, `bxaMnyLiquido`, dados da permuta).
> Nós só fornecemos **quem** (invoice `docCod` + adiantamento `bxaDocCod`), **a data** (`borDtaMvto`),
> e **o juros + conta** (`bxaMnyJuros` + `bxaCodGerJuros`). Isso é *mais seguro*: o valor a baixar e o
> em-aberto vêm do próprio Conexos no passo 2 — o "re-ler em-aberto vivo" do plano vira **capturar
> `bxaMnyValor` do passo 2 e validar contra a nossa alocação** antes de prosseguir ao passo 5.

## Payload consolidado do passo 5 (`POST /api/fin010/baixas`)

Campos = união do que o analista digitou + o que os passos 2/3/4 devolveram:

```jsonc
{
  "filCod": 4, "borCod": 1999, "borVldTipo": 2, "borVldFinalizado": 0,
  "frontModelName": "baixa",
  // lado INVOICE (baixa) — do passo 2
  "docTip": 2, "docCod": 5078, "titCod": 1, "titEspNumero": "CAMEX/MONO1",
  "bxaMnyValor": 40879.9,              // valor do título (do ERP, passo 2)
  "bxaMnyDesconto": 0, "bxaMnyMulta": 0,
  "bxaMnyJuros": 220,                  // VARIAÇÃO CAMBIAL — nós colocamos (variacao_resultado)
  "bxaCodGerJuros": 131,              // CONTA DE JUROS — JUROS=131 (passiva) / DESCONTO via bxaMnyDesconto+bxaCodGerDesconto
  "gerDesJuros": "VARIAÇÃO CAMBIAL PASSIVA REALIZADA",
  "bxaMnyLiquido": 41099.9,           // do ERP (passo 4) = valor + juros
  "bxaCodGerDesconto": 94, "bxaCodGerMulta": 127,
  "gerDesDesconto": "DESCONTOS OBTIDOS", "gerDesMulta": "MULTAS E JUROS COMERCIAIS",
  // lado ADIANTAMENTO (permuta) — do passo 3
  "bxaVldAdto": 1,
  "bxaDocTip": 2, "bxaDocCod": 2767, "bxaTitCod": 1,
  "gerNum": 198, "gerNumPermuta": 198, "gerDesPermuta": "ADTO FORNECEDOR INTERNACIONAIS",
  "gerDes": "ADTO FORNECEDOR INTERNACIONAIS",
  "pesCod": 2658, "dpeNomPessoa": "TOP GLOBAL PARTS CO LTD",
  "bxaMnyValorPermuta": 41175.97, "bxaMnyLiquidoPermuta": null,
  "bxaVldSistema": 0, "bxaVldCcorrente": 0, "bxaVldCorrenteDc": 1
}
```

Resposta do passo 5 (sucesso): objeto da baixa com `bxaCodSeq` (ex.: `1`), `bxaCodSeqPerm`, todos os
valores ecoados, `borDtaMvto`, `vldPermuta:1`. **`bxaCodSeq` é a confirmação** que persistimos.

## Mapeamento `permuta_alocacao` → contrato

| Campo fin010 | Fonte nossa (`permuta_alocacao`) | Observação |
|---|---|---|
| `docCod` (passo 2/5) | `invoice_doc_cod` | docCod da INVOICE (≠ processo) |
| `bxaDocCod` (passo 3/5) | `adiantamento_doc_cod` | docCod do ADIANTAMENTO |
| `titCod` / `bxaTitCod` | `1` (constante por ora) | parcela / número do título |
| `bxaMnyValor` | **ERP (passo 2)** | validar `≈` contra a alocação (anti-drift) |
| `bxaMnyJuros` | `variacao_resultado` | valor da variação cambial |
| `bxaCodGerJuros` | `variacao_classificacao`=`JUROS` → `131` | DESCONTO ⇒ usar `bxaMnyDesconto`+`bxaCodGerDesconto` (94), `bxaMnyJuros=0` |
| `bxaMnyLiquido` | **ERP (passo 4)** | = `bxaMnyValor` + `bxaMnyJuros` |
| `borDtaMvto` | data da execução (entrada do analista) | epoch-ms, meia-noite UTC do dia |
| `gerNum*`, `pesCod`, `dpeNomPessoa`, `bxaMnyValorPermuta` | **ERP (passo 3)** | repassar verbatim ao passo 5 |

## Regras / invariantes de escrita

- **I-Write-1 (anti-drift):** antes do passo 5, `|bxaMnyValor(passo 2) − valorEsperadoDaAlocacao|` deve estar
  dentro da tolerância (≤ 0,005 na moeda do título); divergência ⇒ **abortar** (em-aberto mudou no ERP).
- **I-Write-2 (conta da variação cambial):** seta a conta SÓ do lado ativo (a outra fica `null`).
  `JUROS` → `bxaCodGerJuros=131`, `gerDesJuros="VARIAÇÃO CAMBIAL PASSIVA REALIZADA"`, `bxaMnyDesconto=0`,
  `bxaCodGerDesconto=null`. `DESCONTO` → valor em `bxaMnyDesconto` + **`bxaCodGerDesconto=130`,
  `gerDesDesconto="VARIAÇÃO CAMBIAL ATIVA REALIZADA"`**, `bxaMnyJuros=0`, `bxaCodGerJuros=null`.
  Ver `classificacao-juros-desconto.md`. **Correção 2026-06-25:** este doc dizia `bxaCodGerDesconto=94`
  (errado, conflitava com 130 nos demais docs) e o código lia a conta do `val2` do ERP (que volta `null`)
  → o ERP gravava a baixa mas RECUSAVA a finalização com "CONTA DE DESCONTO NÃO INFORMADA" (borderô 14918).
  Agora a conta 130 é constante no código (espelha o 131 do juros).
- **I-Write-3 (um adto por vez):** escreve-se **adto a adto** (como no manual). Em múltipla, cada par
  adto→invoice é um passo 2–5 separado, no MESMO `borCod`.
- **I-Write-4 (idempotência):** a execução carrega uma `idempotency_key`; uma re-execução com a mesma chave
  NÃO cria novo borderô nem nova baixa (ver `idempotencia-reconciliacao.md`).
- **I-Write-5 (homologação-first):** nenhuma escrita em produção antes de validada em
  `https://columbiatrading-hml.conexos.cloud` (mesmas credenciais/`filCod`). `CONEXOS_DRY_RUN` default ON.
- **I-Write-6 (âncora no valor real do adto — anti-resíduo):** quando a baixa consome o adiantamento
  **por inteiro** (`valorAlocado ≥ saldoAdtoNeg`, e a invoice é de **título único**), o líquido deve
  fechar no valor REAL do adto no ERP (`bxaMnyValorPermuta`, passo 3), e **não** no reconstruído por
  `USD × taxa`. A `taxa` é arredondada a 3 casas → `USD × taxa` não reproduz o BRL real do adto e sobra
  um resíduo de centavos "à permutar" (ex.: borderô 15593, adto 17287: 0,05). A diferença
  `bxaMnyValorPermuta − (bxaMnyValor + juros − desconto)` é absorvida na conta de variação cambial JÁ
  em uso (131 juros / 130 desconto — a variação real É essa diferença). **Guarda:** teto ABSOLUTO
  (`|resíduo| ≤ R$1,00`, não escala com o valor); resíduo maior **não** é ancorado (loga BUSINESS_WARN
  → conferência manual). O teto é fixo de propósito: o resíduo de rate-rounding é `USD × |taxaReal −
  taxaExibida|`, que escala com o USD e num adto grande fica numericamente indistinguível de um saldo
  deliberado pequeno — um teto proporcional absorveria saldo real como variação fictícia. Perna
  **parcial** (N:M) e multi-título full-consume seguem rateando por taxa (saldo remanescente legítimo).
  Ver ADR-0020 e `ReconciliacaoPermutaService.ancorarVariacaoNoAdto`.

- **I-Write-7 (anti-borderô-órfão / anti-aprovação-vazia):** o borderô nasce no **passo 1**, antes de
  qualquer baixa — se as baixas falharem, sobra um **casco vazio** no ERP. Duas guardas:
  1. **Limpeza (produtor):** ao fim de `reconciliar`, se o borderô foi criado **naquela chamada** e
     **nenhuma** alocação terminou `settled`, o borderô é removido do ERP + do cache
     (`ReconciliacaoPermutaService.removerBorderoOrfao`). A limpeza é no **fim do loop**, não na 1ª
     falha: o `borCod` é compartilhado por todas as alocações (I-Write-3), então *falha-depois-sucesso*
     deixa o borderô **com** item e ele **não** é órfão. É **best-effort e fail-safe** — a fonte da
     verdade é o ERP (`listBaixas`): havendo item, não apaga; qualquer falha vira `BUSINESS_WARN` e
     **nunca** mascara o erro real da baixa.
  2. **Recusa (consumidor):** `finalizarBordero` rejeita borderô **sem item no ERP** antes do POST
     (`assertBorderoTemItens`), com mensagem que aponta a saída ("use Excluir"). A contagem vem do
     **ERP**, não da trilha — a trilha guarda linhas `error` **com** `bor_cod` (sem baixa nenhuma no
     borderô), então contá-las daria o casco como "cheio". O front espelha a guarda desabilitando
     "Aprovar" quando não há baixa `settled` (`BorderosPanel.tsx`).

  > **Origem:** borderô **18538** (2026-08-06) — `POST /fin010/finalizar/18538` recusado com
  > `"ESTE BORDERÔ NÃO POSSUI ITENS."`. Antes disto o ERP só reclamava **depois** do POST, com um texto
  > que não dizia o que fazer. Ver ADR-0030.

## Adendo v0.7.0 (2026-06-24) — auto-alocação ANTES de gravar

> **Vigência:** 2026-06-24 (v0.7.0, ADR-0014). O contrato de escrita acima (handshake de 5 chamadas,
> Fase 3) continua igual; o que mudou é o **passo a montante**: o "Processar"/Baixar da aba
> **Automáticas** e o Baixar dos manuais agora **AUTO-ALOCAM antes de gravar** no `fin010`.

`ReconciliacaoPermutaService.reconciliar`
(`src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:97-109`), quando o adiantamento
**não tem rascunho** de alocação (`alocacoes.length === 0`), cria os rascunhos sozinho antes de
qualquer escrita no ERP:

- **múltipla AUTOMÁTICA** → `AlocacaoPermutasService.autoAlocarSeElegivel` (adto cobre todas as
  invoices do processo — ver `business-rules/multipla-automatica.md`);
- **casamento simples/elegível** (fallback) → `AlocacaoPermutasService.autoAlocarDeCasamento`.

A criação dos rascunhos é **ATÔMICA** (all-or-nothing) — ver `business-rules/auto-alocacao-atomica.md`
(`criarRascunhosAtomico`, I-Permuta-8): se um par falha no meio, os rascunhos da própria chamada são
revertidos (nunca uma meia-permuta). Os rascunhos são **locais** (`permuta_alocacao`), **sem efeito no
ERP**; só depois a baixa real (handshake de 5 chamadas acima) toca o `fin010`. A baixa relê o em-aberto
vivo no passo 2 (anti-drift, I-Write-1).

Pós-baixa, o status da permuta passa a ser derivado em relação ao borderô do `fin010` — ver a
state-machine `state-machines/status-permuta-bordero.md` (`pendente | aguardando-finalizacao |
finalizado`; B1 entra quando há baixa `settled` com o borderô EM CADASTRO). A listagem/situação dos
borderôs é servida pelo **cache local** `permuta_bordero` (migration `0018_permuta_bordero_cache.sql`;
ver `BorderoGestaoService.refreshCache`).

## Tolerâncias de arredondamento

Quatro tolerâncias coexistem no fluxo de permuta; cada uma resolve um tipo distinto de ruído. Não
confundir entre si.

| Tolerância | Onde (file:line) | Regra | Para quê |
|---|---|---|---|
| **+0,005** (moeda negociada) — saldo do **adiantamento** | `AlocacaoPermutasService.ts:225` | `valorAlocado > (saldoAdtoNeg − jaAdto) + 0.005` ⇒ `AlocacaoSaldoError` | evita falso-positivo de estouro por ruído de ponto flutuante na validação do rascunho |
| **+0,005** (moeda negociada) — saldo da **invoice** | `AlocacaoPermutasService.ts:239` | `valorAlocado > (saldoInvoiceNeg − jaInvoice) + 0.005` ⇒ `AlocacaoSaldoError` | idem, lado-crédito |
| **dinâmica (anti-drift na baixa)** | `ReconciliacaoPermutaService.ts:269-270` | `tolerancia = Math.max(0.01, emAbertoErp * 0.005)`; se `valorBaixaDesejado > emAbertoErp + tolerancia` ⇒ **aborta** (I-Write-1) | a baixa NUNCA pode exceder o em-aberto VIVO do ERP; tolera só centavo/0,5% de arredondamento, depois capa em `bxaMnyValor = min(valorBaixaDesejado, emAbertoErp)` (`:277`) |
| **+1 USD** (elegibilidade automática) | `GestaoPermutasService.ts:322-335` + `AlocacaoPermutasService.ts:337` | `saldoNeg + 1 ≥ Σ invoices do processo` ⇒ múltipla AUTOMÁTICA | já documentada em `business-rules/multipla-automatica.md` (I-Permuta-6) — só referência aqui |
| **resíduo de âncora (I-Write-6)** — `R$1,00` fixo (absoluto) | `ReconciliacaoPermutaService.ancorarVariacaoNoAdto` | no full-consume de título único, absorve `bxaMnyValorPermuta − líquido` na conta de variação SE `|resíduo| ≤ R$1,00`; senão **não ancora** (BUSINESS_WARN) | zera o resíduo de centavos "à permutar" no adto sem mascarar saldo real (teto NÃO escala com o valor de propósito) |

> **Tolerância dinâmica — fórmula EXATA do código (`ReconciliacaoPermutaService.ts:269`):**
> `const tolerancia = Math.max(0.01, emAbertoErp * 0.005);` — ou seja, o maior entre **0,01 BRL**
> (1 centavo) e **0,5% do em-aberto vivo do ERP** (`bxaMnyValor` do passo 2). É a guarda anti-drift
> (I-Write-1): cobre o ruído de arredondamento sem permitir super-pagamento.

**`round2` (2 casas) nos valores enviados ao `fin010`:** `round2 = (n) => Math.round(n * 100) / 100`
(`ReconciliacaoPermutaService.ts:24`) é aplicado a **todo valor monetário** do payload
(`valorVariacao`/`juros`/`desconto` `:296`, `bxaMnyLiquido` `:311`, e o preview `:452`/`:470`); o
`valorBaixaDesejado` é arredondado inline em `:268`. Motivo (sonda real 2026-06-23): o ERP rejeita
money com >2 decimais (`CnxValidatorMny` → `precision_not_supported`), e a variação cambial chega com
ruído de ponto flutuante (ex.: `1000×(5.2887−4.9806)=308.1000000000005`).

## Fora do contrato (a confirmar em campo)
- Comportamento quando a invoice **já tem baixa parcial** anterior (passo 2 pode mudar `bxaMnyValor`).
- Estorno programático (hoje o analista estorna pela UI).

## Resolvido em campo (2026-06-25)
- **Finalização do borderô** (`POST fin010/finalizar/{borCod}`, body vazio + filCod no header): o
  endpoint estava CORRETO. A finalização falhava com `Generic.ERROR_MESSAGE` cujo `vars.msg` real era
  **"CONTA DE DESCONTO NÃO INFORMADA!!!"** — causa: a baixa de DESCONTO ia sem `bxaCodGerDesconto` (ver
  I-Write-2). Corrigido setando a conta 130. (Sonda HAR `25columbiatrading.conexos.cloud.har`, borderô 14918.)
