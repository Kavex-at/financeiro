---
name: idempotencia-reconciliacao
type: business-rule
entity: Permuta
ontology_version: "0.5"
implementation_status: implemented
related_files:
  - src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts
  - src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts
  - src/backend/domain/errors/ReconciliacaoEmAndamentoError.ts
  - src/backend/domain/errors/AlocacaoSemCoberturaError.ts
  - src/backend/migrations/0015_permuta_alocacao_execucao.sql
  - src/backend/migrations/0054_permuta_execucao_parcial.sql
last_review: 2026-09-08
has_canonical_test: true
---

# Business Rule — Idempotência e fault-tolerance da reconciliação (baixa `fin010`)

> Fase 3 (risco arquitetural #1). A baixa no ERP é a **primeira escrita irreversível-por-nós** do sistema
> (o estorno é manual, na UI do `fin010`). Estas regras garantem que uma re-execução, um clique duplo, ou
> uma falha parcial **não** gerem baixa duplicada nem percam o rastro. Ver ADR-0013, ADR-0043 e
> `fin010-write-contract.md`.

## Granularidade e chave

- A unidade de execução é o **par adto↔invoice** (espelha a UNIQUE de `permuta_alocacao`).
- `idempotency_key = "permuta:{adiantamentoDocCod}:{invoiceDocCod}:{alocacao.atualizadoEm}"`
  (epoch-ms) — UNIQUE em `permuta_alocacao_execucao`. Código:
  `ReconciliacaoPermutaService.ts:161`.

  A chave **versiona pelo estado da alocação**, e isso é deliberado:
  - re-executar a **mesma** alocação repete a chave → bloqueado (idempotência real);
  - **re-alocar** o par muda `atualizado_em` → chave nova → lançável de novo, **por decisão
    humana**, não por acidente. É por aqui que o resíduo de uma execução `parcial` se resolve;
  - alocar **outro** par → chave nova.
- Variante `"{key}:sup:{borCod}"` — quando o borderô de uma baixa `settled` foi
  CANCELADO/ESTORNADO/REMOVIDO no ERP, a baixa é nula: a linha antiga é **renomeada** (não apagada,
  para preservar o borderô cancelado no histórico) e o par volta a ser lançável.

> **Correção de drift (2026-09-08, ADR-0043).** Este documento afirmava a chave sem o sufixo de
> versão, e atribuía à UNIQUE uma garantia que ela nunca teve. O código está certo desde sempre; a
> ontologia é que descrevia outra coisa. Ver `I-Recon-1`.

## Máquina de estados da execução (`permuta_alocacao_execucao.status`)

```
            beginExecution (write-ahead)
   (novo) ───────────────────────────────▶ reconciling ──baixa COBRE o alocado──▶ settled (terminal)
                                                 │
                                                 ├──baixa cobre EM PARTE────────▶ parcial (terminal)
                                                 │     (grava valor_residual_usd + BUSINESS_WARN)
                                                 │
                                                 └────────── POST falhou ────────▶ error
   error ──(retry: nova chamada)──▶ reconciling ...
   settled ──(re-execução)──▶ PRESERVADO (pulado, idempotência)
   parcial ──(re-execução, MESMA chave)──▶ PRESERVADO (pulado) — o dinheiro já se moveu
           └─ resolução do resíduo = RE-ALOCAR o par ⇒ chave nova ⇒ novo lançamento
   dry-run: status 'pending', dry_run=true, sem POST

   concorrência: 2º caller no MESMO adto não entra ──▶ 409 ReconciliacaoEmAndamentoError
                 (advisory lock, I-Recon-5 — nenhuma chamada ao ERP)
   cobertura insuficiente detectada ANTES do 1º POST ──▶ 422 AlocacaoSemCoberturaError
                 (fail-closed de verdade: nada foi escrito — I-Write-8a)
```

- **`settled` e `parcial` são terminais e preservados.** `beginExecution` NUNCA regride nenhum dos
  dois (CASE no `ON CONFLICT DO UPDATE`). O critério é *"houve escrita irreversível no ERP sob esta
  chave?"* — e em `parcial` houve: as baixas dos títulos consumidos estão lá. Re-executar retorna
  `alreadySettled=true` → **pulado**.
- **`error` e `pending` são reabríveis** — um retry os leva de volta a `reconciling`.
- **`parcial` não é `settled` degradado nem `error` suavizado.** É o registro fiel de uma escrita
  que aconteceu pela metade. Ver ADR-0043.

## Write-ahead (ordem obrigatória)

1. `beginExecution` grava `reconciling` **antes** de qualquer chamada ao ERP.
2. Handshake (passos 1–4) + `gravarBaixaPermuta` (passo 5).
3. Sucesso integral → `markSettled` (com `bxaCodSeq`, `bor_cod`, `valor_baixado`, `erp_response`).
4. Sucesso com resíduo → `markParcial` (idem + `valor_residual_usd`) — ver I-Recon-6.
5. Falha → `markError` (com `erro_mensagem` + `erp_response` crua).

**Por que write-ahead e não transação:** o ERP não participa do nosso commit de Postgres. Se o processo
morre **entre** o POST e o `markSettled`, a linha fica em `reconciling` — sinal explícito de "verificar no
ERP se a baixa entrou" (reconciliação manual), em vez de um silêncio que pareceria "não executado".

> **Emendado pela ADR-0039 (2026-08-25), só para o SISPAG.** "Reconciliação manual" continua sendo a
> doutrina aqui, na permuta. No SISPAG, onde o ERP **expõe estado verificável** da escrita
> (`flpVldStatus`/`titulosCount` no fin015, `processadoEm` no fin052), a execução órfã é **retomada por
> consulta** em vez de mandar a pessoa ao ERP — ver `retomada-remessa-sispag.md`. O critério é
> por-escrita, não por-módulo: para a baixa do `fin010` ninguém mediu ainda se existe estado
> consultável equivalente, então aqui nada muda.

## Serialização por adiantamento (tática nomeada)

**O ledger write-ahead protege contra INTERRUPÇÃO, não contra CONCORRÊNCIA.** Duas requisições
simultâneas ao mesmo `adiantamentoDocCod` leem o estado da trilha **antes** de qualquer uma escrever,
as duas se veem como "primeira tentativa", e as duas seguem o handshake. Resultado: dois borderôs no
`fin010`, duas baixas para o mesmo par, e uma trilha que grava só o último `bor_cod`
(last-write-wins) — o borderô perdedor fica invisível ao painel. Exatamente o dano que o ledger
existe para evitar.

O `ON CONFLICT DO UPDATE` do `beginExecution` **não** fecha isso: a CASE preserva `settled` (e agora
`parcial`), mas dois callers em `reconciling` passam os dois. E o `heavyRouteLimiter` é por IP — não
alcança dois operadores em máquinas diferentes.

A tática é a mesma já em uso no SISPAG (`RemessaService.gerarRemessa`, `RemessaEmAndamentoError`):
**advisory lock do Postgres, com chave derivada por hash estável de 32 bits do
`adiantamentoDocCod`** — adiantamentos distintos seguem em paralelo; colisão de hash custa
serialização desnecessária, nunca corretude. O caller barrado recebe **HTTP 409**
(`ReconciliacaoEmAndamentoError`, retryable: basta esperar) e **não toca o ERP**.

> Diferente do IN-DOUBT de `reconciling` órfão: lá a execução anterior **morreu** e o estado do ERP é
> desconhecido (fail-closed, conciliação manual). Aqui ela está **viva e rodando neste instante**,
> noutra requisição — e a espera resolve.

## Invariantes

- **I-Recon-1 (o que a UNIQUE garante — e o que NÃO garante):** no máximo **uma** execução terminal
  (`settled` ou `parcial`) por par adto↔invoice **por versão da alocação**. A UNIQUE de
  `idempotency_key` cobre o clique-duplo e o retry **da mesma alocação**. Ela **não** cobre:
  1. **re-alocação** — mudar a alocação do par muda `atualizado_em`, cunha chave nova e libera um
     novo lançamento. Isso é **por decisão**, não por acidente: é o caminho de resolução do resíduo
     de `parcial`. Quem re-aloca está pedindo um novo lançamento;
  2. **concorrência** — duas requisições simultâneas leem antes de qualquer uma escrever, e as duas
     se veem como primeira. Isso é barrado por **I-Recon-5** (advisory lock), **não** pela UNIQUE. A
     ontologia afirmava o contrário até 2026-09-08 (ADR-0043).
- **I-Recon-2:** toda transição para `settled` carrega o `bxaCodSeq` confirmado pelo ERP — sem confirmação,
  não há `settled`. Vale igualmente para `parcial`: o terminal parcial só existe sobre baixas confirmadas.
- **I-Recon-3:** nenhuma baixa é gravada se o em-aberto vivo do ERP (`bxaMnyValor`, passo 2) for ≤ 0
  (anti-super-pagamento — o valor vem do ERP, nunca do nosso rascunho).
- **I-Recon-4:** dry-run **não** chama o ERP e **não** cria borderô — zero efeito colateral (seguro até em
  produção).
- **I-Recon-5 (serialização por adiantamento):** existe **no máximo uma** execução de
  `reconciliarPermuta` em voo por `adiantamentoDocCod`. A segunda requisição concorrente é recusada
  com **409** (`ReconciliacaoEmAndamentoError`) **sem nenhuma chamada ao ERP** — zero borderô, zero
  baixa. Adiantamentos distintos não se bloqueiam.
- **I-Recon-6 (baixa parcial é estado, nunca silêncio):** ao fim do laço de baixa por título, se
  `restanteUsd > 0,005` (moeda negociada), a execução termina em **`parcial`** com
  `valor_residual_usd = restanteUsd` gravado. **Nunca `settled`.** `settled` afirma "o alocado foi
  integralmente baixado"; declarar isso com resíduo é uma afirmação falsa no livro-razão. O caso
  caso **detectável antes de escrever** é barrado por **I-Write-8a** (cobertura em aberto derivada,
  não a face — ver a emenda de 2026-09-08 da ADR-0043); `parcial` cobre o que 8a não alcança:
  título **renegociado/cancelado após a alocação** (sai do filtro `titVldStatus = 1` sem erro
  nenhum) ou lista incompleta. **Não** é "título baixado externamente antes do POST" — esse caso já
  lança erro no passo 2 por I-Recon-3.
- **I-Recon-7 (`parcial` é visível por construção):** um terminal `parcial` **obrigatoriamente**
  (a) emite `LogService.warn` `BUSINESS_WARN` com `adiantamentoDocCod`, `invoiceDocCod`, `borCod` e
  `valorResidualUsd`; (b) aparece com o resíduo em `GET /permutas/adiantamentos/:docCod/execucoes`;
  e (c) é **alvo elegível do detector proativo** da trilha de permutas (card `cc-reaper-permutas`),
  na mesma classe de `reconciling` preso.
  Este invariante existe porque a alternativa óbvia ao silêncio de hoje é *outro* silêncio: um estado
  que ninguém olha. `parcial` é **trabalho pendente**, não linha de log.

## Recuperação de linhas `reconciling`/`error` (operacional)

- `GET /permutas/adiantamentos/:docCod/execucoes` expõe o status por par. Linhas `error` mostram a mensagem
  e a resposta do ERP. Linhas `reconciling` "presas" (processo morreu no meio) exigem checagem no `fin010`:
  se a baixa entrou → marcar `settled` manualmente (futuro: endpoint de conciliação); se não → retry.

### Resolução de uma execução `parcial`

O resíduo **não** se resolve marcando `settled`. Resolve-se **re-alocando o par** (ou alocando o
restante contra outra invoice): a alocação muda, `atualizado_em` muda, a chave é nova, e um novo
lançamento cobre o que faltou. Enquanto isso não acontece, a permuta segue com saldo em aberto — o
que é a verdade contábil, e o que a mantém na fila de elegibilidade normalmente.

O borderô da execução `parcial` **não** desaparece: `listComBordero` filtra por `bor_cod IS NOT NULL`
(sem filtro de status), então ele é resgatado para o cache `permuta_bordero` e aparece na aba
Borderôs como `EM CADASTRO`, onde `finalizar`/`cancelar` acontecem. No painel de permutas o
adiantamento recebe o badge `parcial-aguardando-finalizacao` — ver
`state-machines/status-permuta-bordero.md`, transição **B1'**.
