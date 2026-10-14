## Ontology Diff Proposal — sispag-guarda-codbar-repetido

**Status:** proposta, nada aplicado. Aguarda aprovação do Yuri.
**Mode:** `/feature-tweak`, `entity_changed = true` (invariante aditiva + erro nomeado; nenhuma entidade, coluna ou permissão nova).

> **Números provisórios.** ADR **0069** e ontologia **v0.40.1** valem para este worktree (último ADR = 0068,
> `_index.json._meta.version` = `_coverage.json.version` = 0.40.0, HEAD = 31e433d = `origin/main` conhecido
> localmente). Outra sessão corrige em paralelo um bug de data de vencimento com ADR retroativo próprio.
> **Reconferir contra `origin/main` e as branches/PRs abertas no momento do ship** (ADR, versão da
> ontologia, `CHANGELOG.md` raiz) e renumerar se colidir. Id de invariante: ver nota em 1.

### Candidate analysis

| Candidato | Filtros | Decisão |
|---|---|---|
| Unicidade do código de barras (44 dígitos) dentro do lote, checada logo após `importarTitulos` e antes de `finalizarLote` | A:Y (ADR-0063 já cobre duplicidade por título; pagar o mesmo boleto 2x é universal em SISPAG), B:onto, C:Y (é a mesma regra enquanto houver DDA 1:N), D:novo (a regra de ausência não cobre repetição), E:invariante | **ACCEPT** (I16a) |
| Rede de segurança: segmentos J do `.REM` gerado repetem o 44 dígitos (`RemessaCnabValidator`) | A:Y, B:onto, C:Y, D:novo, E:invariante (mesmo I16a, 2º ponto de checagem) | **ACCEPT** (parte de I16a) |
| Código presente porém inválido (DV ruim, `dropped` pelo parser) na camada 1 | A:Y, B:onto, C:Y | **ACCEPT** — falha fechada (I16b) |
| Erro nomeado `BoletoCodigoBarrasRepetidoError` (409) | A:Y, B:onto, D:novo (irmão de `BoletoSemCodigoBarrasError`) | **ACCEPT** |
| Abortar sem descartar item em silêncio; analista remove o título do lote local | decisão do mantenedor; invariante human-in-the-loop | **ACCEPT** (I16c) |
| Valor "16:00 de corte", mascaramento exato (5 primeiros + 4 últimos) | detalhe de implementação/log | **REJECT-CONFIG** (fica na regra como formato de mensagem, sem entidade) |
| Nova regra irmã `boleto-codbar-unico.md` | D:duplicate de escopo — mesmo fail-closed no mesmo ponto de envio | **REJECT-DUPLICATE** → invariante na regra existente |
| Nova entidade `CodigoBarrasEnviado`/persistir hash salgado | A:? C:? — só serve ao escopo cross-lote | **REJECT-PREMATURE** → watchlist (ver abaixo) |
| Guarda **entre lotes vivos** (mesmo boleto em 2 lotes por vencimento, ADR-0064) | conceito válido; mas exige persistência de hash salgado (HMAC, segredo do `EnvironmentProvider`) + migration + ADR próprio, ou leituras extras ao ERP | **REJECT-PREMATURE** (follow-up) |
| Guarda contra boleto já pago (RETORNADO/baixado) | o título pago sai da carteira pelo ERP; precisa do mesmo hash persistido | **REJECT-PREMATURE** (follow-up, mesmo pré-requisito) |
| Descartar automaticamente o item "de trás" / remover itens do rascunho via API | viola human-in-the-loop; remoção por API não verificada | **REJECT-WORKAROUND** |
| Persistir ou logar o codbar em claro | política de log do projeto | **REJECT-NOT-DOMAIN** (proibido; ver I16d) |

### Changed files (ACCEPT only)

1. `ontology/business-rules/boleto-exige-codigo-de-barras.md` — nova seção "Um código de barras, um item" (I16a–e) + related_files + last_review.
2. `ontology/business-rules/sugestao-boleto-dda-sispag.md` — nota de pré-requisito (passo 2 da ADR-0068) e erro na tabela de erros nomeados.
3. `ontology/decisions/0069-sispag-guarda-de-codigo-de-barras-repetido.md` — novo.
4. `ontology/decisions/0068-*.md` — emenda de uma linha (passo 2 depende da ADR-0069).
5. `ontology/_index.json`, `ontology/_coverage.json`, `ontology/CHANGELOG.md`.
6. `ontology/_inbox/_watchlist.md` — 1 linha.
7. Docs: `docs/ontologia.md` — conferir se cita `boleto-exige-codigo-de-barras`/`BoletoSemCodigoBarrasError`; se citar, acrescentar uma linha apontando para I16. (`docs/sispag/ANEXO-requisitos.md` e `GAP-ENTREGA.md` citam o erro de ausência; propor um bullet só se Yuri quiser; não bloqueante.)

---

### 1. Regra `ontology/business-rules/boleto-exige-codigo-de-barras.md`

> **Nota sobre o id.** Esta regra não tem ids de invariante; as famílias vigentes são I13 (ted-pix), I14
> (favorecido), I15 (sugestão). Proposta: abrir a família **I16** (`I16a–e`), a próxima livre.
> Alternativa: renomear só para `I-COD1…`; I16 é preferível por consistência.

**Frontmatter — BEFORE**
```yaml
ontology_version: "0.10"
related_files:
  - src/backend/domain/errors/BoletoSemCodigoBarrasError.ts
  - src/backend/domain/service/sispag/RemessaService.ts
  - src/backend/domain/client/ConexosSispagWriteClient.ts
last_review: 2026-10-14
```
**AFTER**
```yaml
ontology_version: "0.10"
related_files:
  - src/backend/domain/errors/BoletoSemCodigoBarrasError.ts
  - src/backend/domain/errors/BoletoCodigoBarrasRepetidoError.ts
  - src/backend/domain/service/sispag/RemessaService.ts
  - src/backend/domain/libs/cnab/RemessaCnabValidator.ts
  - src/backend/domain/client/ConexosSispagWriteClient.ts
last_review: 2026-10-14
```
(`ontology_version` do frontmatter da regra fica "0.10": é o campo de schema da regra, o repo não o move a cada bump; manter.)

**Corpo — inserir ANTES de `## Ver também` (AFTER; nada é removido):**

```markdown
## Um código de barras, um item (I16)

> `titVldReflexoDdaAssoc` significa "existe boleto DDA com mesmo valor e vencimento"; **não reserva 1:1**.
> O ERP anexa o **mesmo** código de barras a cada item importado do grupo (caso PEDRONI, fil 2: 10 títulos
> de R$ 1.412,00 vencendo no mesmo dia, 2 boletos). A regra de ausência acima nunca prometeu unicidade:
> sem esta guarda, o mesmo boleto sai duas vezes no `.REM`. Esta é a duplicidade **por boleto**; a
> duplicidade **por título** é a I13g (ADR-0063).

| # | Invariante |
|---|---|
| **I16a** | **Um código de barras, um item.** Dentro de um mesmo lote/remessa, dois ou mais itens `modalidade = BOLETO` não podem carregar o mesmo código de barras **normalizado de 44 dígitos** (a linha digitável de 47 dígitos de `itsNumCodbar` é convertida para barras de 44; o segmento J do `.REM` já carrega 44). Violação ⇒ `BoletoCodigoBarrasRepetidoError` (409). |
| **I16b** | **Pontos de checagem.** (1) **Principal:** logo após `importarTitulos` e **antes de `finalizarLote`**, sobre `listarLinhasDigitaveisDoLote` (único ponto em que o código já existe e o último antes de o lote nativo virar FINALIZADO; rascunho nativo não se apaga por API, finalizado se cancela). (2) **Rede de segurança:** `RemessaCnabValidator` compara o 44 dígitos dos segmentos J do `.REM` gerado, e cobre o caso em que (1) foi pulado (retomada de etapa) ou a leitura dropou itens. Falha em (2) é tardia e segue o tratamento já existente do gate pós-geração (lote nativo finalizado e arquivo no ERP para cancelamento manual). O mesmo caminho serve lote manual e automático. |
| **I16c** | **Falha fechada para código presente mas inválido.** Item cujo código de barras existe porém foi descartado pela leitura (`dropped`: DV inválido, tamanho incorreto) impede a comparação confiável: o lote com BOLETO e `dropped > 0` **aborta** com o mesmo erro nomeado, em mensagem própria ("código de barras ilegível/inválido para o título X"). Nunca se ignora o item inválido para "seguir com o resto". Ausência continua sendo tratada pela regra `BoletoSemCodigoBarrasError`, antes desta. |
| **I16d** | **Semântica do aborto.** Aborta **antes de `finalizarLote`**; o ledger de idempotência da remessa é marcado `failed` com motivo e títulos; o **rascunho nativo permanece** e a retomada o **reaproveita**. A solução **não decide** qual título fica com o boleto (julgamento financeiro, human-in-the-loop) e **não descarta item em silêncio**: a analista tira o título repetido do lote **local** (RETIRAR) e gera de novo. |
| **I16e** | **Mensagem e privacidade.** A mensagem é em pt-BR e lista, para cada grupo repetido, os títulos (`docCod/titCod`), `valor`, `vencimento` e o código de barras **mascarado** (primeiros 5 + últimos 4 dígitos). O código completo **nunca** aparece em mensagem, log ou ledger, e **nada sobre o código de barras é persistido** por esta guarda: a leitura é ao vivo do ERP (sem migration). A guarda roda dentro de `gerarRemessa`, sem permissão nova; o bloqueio é auditado por `LogService.warn` (mascarado) e pelo ledger. |

**Escopo e limites.** Vale **dentro do lote**. A repetição **entre lotes vivos** (ex.: o mesmo boleto em dois
lotes por vencimento, ADR-0064) e contra boleto **já pago** NÃO é coberta; requer persistir hash salgado do
código (HMAC com segredo do `EnvironmentProvider`) + migration + ADR próprio. Follow-up registrado no
watchlist.

**Relação com outras decisões.** Complementa a ADR-0063 (duplicidade por título; I13g) com a duplicidade por
boleto. É **pré-requisito do passo 2 da ADR-0068**: vincular o código de um boleto confirmado ao título passa
pelo mesmo import, e sem esta guarda confirmar o mesmo boleto para N títulos reproduz o caso PEDRONI por ação
humana. A guarda opera sobre `itsNumCodbar` pós-import, independente de como o código chegou (DDA flagado
ou confirmação). A confirmação de emissor continua sendo evidência, não autoridade (I15a).
```

**`## Ver também` — BEFORE** (última linha)
```
- `business-rules/elegibilidade-titulo-lote.md` — I2, elegibilidade do item
```
**AFTER** (acrescenta)
```
- `business-rules/elegibilidade-titulo-lote.md` — I2, elegibilidade do item
- ADR-0063 / `business-rules/verificacao-ted-pix-sispag.md` — I13g, duplicidade por TÍTULO
- ADR-0069 — I16, duplicidade por BOLETO (um código de barras, um item); pré-requisito do passo 2 da ADR-0068
```

### 2. Erro nomeado — `ontology/business-rules/sugestao-boleto-dda-sispag.md` (tabela "Erros nomeados")

O repo lista erros nomeados nas tabelas das regras (não há arquivo central; `BoletoSemCodigoBarrasError`
vive só na regra e em `_index.json.impl_files`). Para não deixar o erro novo fora da tabela mais próxima,
acrescentar uma linha **no fim da tabela** (BEFORE: termina em `DecisionNotConfirmedError`):

```
| `BoletoCodigoBarrasRepetidoError` | **remessa** (não é da sugestão): dois itens BOLETO do lote com o mesmo código de barras de 44 dígitos, ou código presente porém inválido (I16a–c, ADR-0069). Pré-requisito do passo 2. Mensagem pt-BR com `docCod/titCod`, valor, vencimento e código mascarado | 409 |
```
E em `boleto-exige-codigo-de-barras.md`, na tabela "Não confundir com favorecido sem conta" **acrescentar**:

```
| Dois itens BOLETO com o mesmo código de barras | `BoletoCodigoBarrasRepetidoError` | retirar o título repetido do lote local e gerar de novo |
```

Em `ontology/business-rules/sugestao-boleto-dda-sispag.md`, `## Ver também`, acrescentar
`decisions/0069-*.md` (guarda de repetição, pré-requisito do passo 2).

### 3. ADR — `ontology/decisions/0069-sispag-guarda-de-codigo-de-barras-repetido.md` (novo, provisório)

```markdown
---
adr_number: 0069
title: SISPAG — guarda de código de barras repetido na remessa (um código de barras, um item)
date: 2026-10-14
status: accepted
type: addition
related_entities: [LotePagamento, TituloAPagar, BoletoDda]
related_business_rules: [boleto-exige-codigo-de-barras, verificacao-ted-pix-sispag, sugestao-boleto-dda-sispag]
continues: [0040, 0063, 0068]
evidence:
  - ontology/_inbox/sispag-guarda-codbar-repetido-interview.md
  - ontology/_inbox/sispag-guarda-codbar-repetido-ontology-diff.md
  - "regis-review 2026-10-14-1330, F-6; followups fault-tolerance-5 (sispag-sugestao-boleto-dda-regis-followups.md)"
  - "medição PRD: 27 títulos flagados em grupos com mais títulos que boletos; caso PEDRONI fil 2, 10 títulos de R$ 1.412,00 venc. 14/10, 2 boletos"
---

# ADR 0069: guarda de código de barras repetido

**Branch:** `fix/sispag-guarda-codbar-repetido`. `/feature-tweak`. `entity_changed = true`.

## Contexto
`titVldReflexoDdaAssoc` é "existe boleto DDA com mesmo valor e vencimento", não reserva 1:1. O ERP anexa o
mesmo código de barras a cada item importado; o `.REM` pagaria o mesmo boleto N vezes. A única guarda era de
ausência (ADR-0040). A duplicidade por título (ADR-0063) não vê isso: são títulos distintos.

## Decisão
Nova invariante **I16** em `boleto-exige-codigo-de-barras`: um código de barras normalizado (44 dígitos), um
item. Checada (1) logo após `importarTitulos`, antes de `finalizarLote`, sobre `listarLinhasDigitaveisDoLote`;
(2) nos segmentos J do `.REM` em `RemessaCnabValidator`, como rede. No acerto, aborta com
`BoletoCodigoBarrasRepetidoError` (409), marca o ledger `failed`, deixa o rascunho e a analista retira o
título repetido do lote local; a retomada reaproveita o rascunho. Código presente porém inválido falha
fechado. Nada do código é persistido nem logado em claro (só mascarado). Sem permissão nova; lote manual e
automático compartilham o caminho.

## Rejeitado
- **Descartar o item repetido em silêncio / remover do rascunho por API:** viola human-in-the-loop; remoção
  por API não verificada. (REJECT-WORKAROUND)
- **Regra irmã `boleto-codbar-unico`:** mesmo ponto e mesmo fail-closed; vira invariante da regra existente. (REJECT-DUPLICATE)
- **Guarda entre lotes vivos e contra boleto pago:** exige hash salgado persistido + migration. Follow-up
  com ADR próprio. (REJECT-PREMATURE)

## Consequências
Pré-requisito do passo 2 da ADR-0068. Custo: 0 chamadas novas ao ERP (reusa a leitura do lote). Risco
residual: reenvio entre lotes não é detectado até o follow-up.
```

**ADR-0068 — emenda de uma linha (no fim da seção de passos/consequências):**
`> **Emenda (ADR-0069):** o passo 2 só pode ser implementado depois da guarda I16 (um código de barras, um item).`

### 4. `_index.json`, `_coverage.json`, CHANGELOG

**`_index.json`** (`_meta.version` e `_coverage.json.version`: `"0.40.0"` → `"0.40.1"`; prefixar `_meta.note` com
"v0.40.1 (2026-10-14, feature sispag-guarda-codbar-repetido, ADR-0069): +invariante I16 em boleto-exige-codigo-de-barras, erro BoletoCodigoBarrasRepetidoError; contagens inalteradas. " e manter o texto anterior):

`business_rules."boleto-exige-codigo-de-barras"` — BEFORE → AFTER:
```diff
       "impl_files": [
         "src/backend/domain/errors/BoletoSemCodigoBarrasError.ts",
+        "src/backend/domain/errors/BoletoCodigoBarrasRepetidoError.ts",
         "src/backend/domain/service/sispag/RemessaService.ts",
+        "src/backend/domain/libs/cnab/RemessaCnabValidator.ts",
         "src/backend/domain/client/ConexosSispagWriteClient.ts"
       ],
-      "note": "Fail-closed no ENVIO (nao no rascunho): ... ADR-0040."
+      "note": "Fail-closed no ENVIO (nao no rascunho): ... ADR-0040. I16 (ADR-0069): um codigo de barras (44 digitos), um item; checado apos importarTitulos/antes de finalizarLote e nos segmentos J do .REM; presente-mas-invalido falha fechado; so dentro do lote (cross-lote = follow-up)."
```
Adicionar `"ADR-0069"` em qualquer índice de decisões, se `_index.json` mantiver um (conferir, não visto).
`status` permanece `implemented` ao fim da implementação; **enquanto o código não existir, marcar a nota
"I16 planned"** e `has_canonical_test` permanece como está até existir teste da I16.

**`_coverage.json`** — deltas de contagem: **nenhum** (sem entidade/ação/regra/state-machine/integração nova;
`business_rules_total` 28, `implemented` 18, `with_tests` 14 inalterados). Só `version` e `note`.
Se o ship ocorrer com testes canônicos da I16, `business_rules_with_tests` já conta a regra (já tem teste);
nada muda.

**`ontology/CHANGELOG.md`** — inserir acima de `## v0.40.0`:
```markdown
## v0.40.1 — SISPAG: guarda de código de barras repetido na remessa (2026-10-14, ADR-0069)

Feature: `sispag-guarda-codbar-repetido` (`/feature-tweak`). `entity_changed = true`, aditivo, sem entidade nova.

- **Regra `boleto-exige-codigo-de-barras`:** nova família **I16a–e** — um código de barras (44 dígitos)
  por item do lote; checada após `importarTitulos`/antes de `finalizarLote` e nos segmentos J do `.REM`;
  falha fechada para código presente porém inválido; aborta com erro nomeado, ledger `failed`, rascunho
  preservado, analista remove o título do lote local; código só mascarado, nada persistido.
- **Erro `BoletoCodigoBarrasRepetidoError`** (409).
- **Pré-requisito do passo 2 da ADR-0068** (emenda).
- **Adiado (REJECT-PREMATURE):** guarda entre lotes vivos e contra boleto já pago — requer hash salgado
  persistido + migration + ADR.
- Coverage: contagens inalteradas.
```

### 5. Watchlist — `ontology/_inbox/_watchlist.md` (append)

```
- **Guarda de código de barras entre lotes/contra boleto pago** (2026-10-14, ADR-0069): o mesmo boleto pode
  cair em dois lotes por vencimento (ADR-0064) ou ser reenviado após RETORNADO. Pré-requisito: persistir
  hash salgado (HMAC, segredo do EnvironmentProvider) do código por item enviado + migration + ADR próprio;
  alternativa sem persistência = ler `itsNumCodbar` dos demais lotes nativos (mais chamadas ao ERP).
  Revisitar se o caso aparecer em produção após I16.
```

### Rejeições que viram ADR
Só a ADR-0069 (as rejeições acima estão na seção "Rejeitado"; nenhuma exige ADR separado).

### ADR needed for accepts? yes — 0069 (provisório), texto na seção 3.

### Observações para o Yuri
- **Precondição nas barras:** a normalização 47→44 deve ser a mesma usada em `LINHA_DIGITAVEL_SCHEMA`; o texto não fixa a função.
- **Ontologia à frente do código:** aplicar o diff junto com a implementação; se ela ainda não existir ao
  aprovar, manter `status` da nota "I16 planned" (convenção do repo).
- **Evidência citada, não alterada:** `RemessaService.ts` (~610–623 import/finalizar, ~1080 erro de ausência) e `RemessaCnabValidator.ts` (leitura do segmento J, pos 18–61).

---
Please review and respond:
- **approve** — write changes as proposed, create ADR 0069, update watchlist
- **edit [file] [instruction]** — modify before writing
- **reject [reason]** — block the entire diff
- **partial [accept items 1, 3] [reject items 2]**
