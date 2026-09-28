# SISPAG — plano TED e PIX

> **Objetivo:** gerar pelo `fin015` uma remessa pagável ao banco por **TED** ou **PIX**.
> **Estado:** plano fechado em 2026-09-28, nada implementado. Decisão do Yuri: terminar o plano
> antes de começar. Crédito em conta está **fora da oferta** (commit `fc22dcd`, não testado,
> não é prioridade).

## 1. Como está hoje

- **Não escrevemos CNAB.** O `fin015` gera o arquivo; o nosso trabalho é mandar os campos certos
  em cada item (`RemessaService.montarItensImport`).
- **TED e PIX saem como crédito em conta.** `MODALIDADE_NATIVA` (`RemessaService.ts:41`) manda
  `TED: 1` e `PIX: 1`. No schema `FinItemSispag`, `itsVldModalidade` é 1 CRÉDITO CC, 4 DOC,
  **5 TED**, 6/7 boleto, 8–10 contas/tributos. **Não existe código de PIX**: o PIX é um conjunto
  de campos à parte (`itsVldChavePix`, `itsDesChavePix`, `itsEspLocPix`, `itsEspTxidPix`), que
  hoje não mandamos.
- **TED para outro banco é barrado.** `RemessaService.ts:982` só aceita conta do favorecido no
  MESMO banco do lote.
- **A tela oferece TED quando existe conta em QUALQUER banco** (`SispagPainelService`), e o envio
  recusa. A oferta e o envio discordam.
- **Não lemos chave PIX de lugar nenhum.**
- **`RemessaCnabValidator` não olha segmento A**: um PIX que saísse como crédito passaria.
- **O ERP tem validações prontas, não usadas:** `fin015/finItemSispag/validacao/modalidadeTed` e
  `.../modalidadePix` (POST, devolvem o próprio `FinItemSispag`). Não sabemos se têm efeito
  colateral.

## 2. O que foi medido (PRD, read-only, 2026-09-28)

Sondas: `jobs/probe-sispag-modalidades.ts` e `jobs/probe-sispag-destino-favorecido.ts`.

**Uso real no `fin015`** — 56 lotes nativos, 89 itens, filiais 1/2/4/6/7:

| Forma | Itens | Último uso |
|---|---|---|
| Boleto do mesmo banco (6) | 52 (58%) | 2026-10 |
| Boleto de outro banco (7) | 18 (20%) | 2026-09 |
| Crédito CC (1), sempre no mesmo banco | 16 (18%) | 2026-02 |
| **TED (5), sempre para OUTRO banco** | **3 (3%)** | 2026-04 |
| **PIX** | **0** | nunca |
| Tributos / concessionárias | 0 | — |

**De onde vem o destino.** Nos 19 itens TED/crédito, o `pctCodSeq` aponta para uma conta ATIVA
do cadastro da pessoa (`cmn025/ctcorr`), e banco e conta batem nos 19. **O ERP puxa o destino
do cadastro — nenhum item carrega dado digitado à mão.**

**Chave PIX.**
- A do **fornecedor** mora no cadastro da pessoa: `cmn025/cmnPessoasPix`, por `pesCod` (tipo
  1 telefone / 2 e-mail / 3 CPF-CNPJ / 4 aleatória; situação; default). Nos 4 favorecidos
  consultados, **0 chaves**.
- A do `fin005/cmnPessoasPix` exige `ccoCod` (conta corrente) → é chave das **contas da própria
  Columbia**. Não serve como destino de pagamento.

**Cobertura de conta** (amostra de 21 favorecidos dos lotes): 12 sem conta, 4 só no Itaú, 5 só
em outro banco.

**Não medido:** cobertura de conta e de PIX na carteira aberta inteira. A amostra do `fin064`
não trouxe favorecidos novos, e a sonda foi interrompida (ver §7).

## 3. Destino do favorecido — cadastro e entrada manual

Hoje o destino vem **só do cadastro da pessoa**, e o ERP trabalha assim. Mas com metade dos
favorecidos sem conta e nenhuma chave PIX cadastrada, o fluxo precisa de entrada manual para os
dois casos.

**Duas formas de fazer a entrada manual:**

| | A — gravar no cadastro, depois referenciar | B — só no item do lote |
|---|---|---|
| Como | `POST cmn025/ctcorr` (conta) ou `POST cmn025/cmnPessoasPix` (chave) → item usa `pctCodSeq` / a chave | item vai com banco/agência/conta ou `itsDesChavePix` digitados, sem `pctCodSeq` |
| Igual ao ERP | sim — os 19 itens históricos são assim | não observado; `montarItensImport` sempre manda `pctCodSeq` |
| Reuso | próxima remessa já acha o destino | redigitar toda vez |
| Trilha | no ERP (`ctcorr/log`, `cmnPessoasPix/log`) | só a nossa |
| Incógnita | o robô tem permissão de escrita no `cmn025`? | o `fin015` aceita item sem `pctCodSeq`? |

**Decisão (Yuri, 2026-09-28): opção A.** Segue o modelo que o ERP já usa e deixa o dado
reaproveitável. A opção B sai do plano (o H3 deixa de bloquear). Validar antes em HML: permissão
do robô no `cmn025` e o formato que o `cmn025` exige. Pendente: validação com a Columbia.

**Controle obrigatório, qualquer que seja a forma.** Trocar o destino de um pagamento é o vetor
clássico de fraude. A entrada manual precisa de:
- **titularidade**: o CPF/CNPJ da conta ou da chave é o do favorecido do título;
- **quatro olhos**: quem digita não é quem aprova;
- **trilha**: quem, quando, valor anterior e novo;
- conferir se `validacao/modalidadePix` devolve o nome do titular (consulta ao DICT) — se
  devolver, mostrar na tela antes de aprovar.

## 4. Fases

### Fase 0 — medir (resta)
1. Credencial própria para o `.env` local (ver §7) antes de qualquer nova sonda.
2. Cobertura de conta e de chave PIX em toda a carteira aberta.
3. Um `.REM` da Columbia com TED (e PIX, se houver) → fixture via `redigir-fixture-rem.ts`.
4. Perguntas à Columbia (§5).

### Fase 1 — TED (`/feature-tweak lote-pagamento`)
- `TED → 5`. Aceitar conta ativa em **qualquer banco** (default primeiro).
- Oferta e envio com a mesma regra: TED quando há conta ativa.
- `validacao/modalidadeTed` antes do import, se o HML provar que não tem efeito colateral.
- `RemessaCnabValidator`: forma de lançamento do segmento A condiz com a modalidade (41/43 × 01,
  a confirmar no fixture) e segmento B presente.
- HML ponta a ponta → primeiro TED de valor baixo em PRD.

### Fase 2 — destino manual (conta)
- Tela de "cadastrar conta do favorecido" no item sem conta, gravando no `cmn025/ctcorr`
  (opção A), com titularidade, quatro olhos e trilha.
- Entidade/ADR na ontologia para o destino manual.

### Fase 3 — PIX
- Ler chaves do `cmn025/cmnPessoasPix` (Zod no boundary); oferecer PIX só com chave ativa;
  chave mascarada na tela.
- Cadastro manual de chave (mesmo fluxo da Fase 2, gravando no `cmnPessoasPix`).
- Item: `itsVldChavePix=1`, `itsDesChavePix`, e `itsVldModalidade` / `itsEspLocPix` /
  `itsEspTxidPix` como o HML mostrar — não há item PIX histórico para copiar.
- `validacao/modalidadePix` antes do import.
- Validador: forma PIX (45 no Itaú, a confirmar) e segmento B com a chave.
- HML → primeiro PIX de valor baixo em PRD.

### Fase 4 — retorno
- Casos de rejeição TED/PIX no `fin052` (conta encerrada, chave inexistente, titularidade).
- Lote misto boleto + TED + PIX (GT-3): o ERP quebra em vários lotes CNAB.

## 5. Perguntas para a Columbia

1. O contrato SISPAG do Itaú (e dos outros bancos) tem **PIX** habilitado? Nunca usaram.
2. Por que o TED sumiu desde abril? Pagam por fora (portal do banco)?
3. Onde vocês guardam hoje a conta e a chave PIX de fornecedor que não está no Conexos?
4. Quem pode cadastrar ou alterar o destino de um fornecedor, e quem aprova?
5. Com os dois disponíveis, preferem TED ou PIX?

## 6. Experimentos em HML (bloqueiam as fases)

| # | Pergunta | Fase |
|---|---|---|
| H1 | `validacao/modalidadeTed` e `validacao/modalidadePix` têm efeito colateral? O que devolvem? | 1, 3 |
| H2 | O robô consegue `POST cmn025/ctcorr` e `POST cmn025/cmnPessoasPix`? | 2, 3 |
| H3 | ~~O `fin015` aceita item com destino digitado, sem `pctCodSeq`?~~ Fora: opção A decidida | — |
| H4 | Que campos o item PIX exige, e que forma/segmentos o `.REM` gerado traz? | 3 |

## 7. Incidente — sessões derrubadas pela sonda

As duas sondas logaram com o usuário do `.env` local (`MPS_FRANCINEI`), que estava no limite de
sessões. O client relogou com `sessionToKill` na mais antiga:
- `2f6bf3da` (IP 32.198.56.192 — provavelmente o servidor);
- `2e2488dc` (IP 189.112.201.185 — provavelmente uma pessoa).

**Antes de qualquer nova sonda em PRD:** credencial própria para o `.env` local.
