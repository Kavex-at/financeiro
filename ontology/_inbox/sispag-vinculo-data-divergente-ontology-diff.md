# Ontology Diff Proposal — sispag-vinculo-data-divergente (2026-10-26)

> **Status: PROPOSTA. Nada foi aplicado em regra, entidade, ação, índice ou cobertura.** Único arquivo
> escrito: este. Aguarda `approve` / `edit` / `partial` / `reject` do Yuri. `/feature-tweak`,
> `entity_changed = true` (regra de domínio muda; entidade ganha propriedade; nenhuma entidade nova).
>
> **Insumos:** `_inbox/sispag-vinculo-data-divergente-interview.md` (P0-1..P0-4 e "Visibilidade do prazo
> efetivo" = decisões do maintainer; **P1-5 e P1-6 = defaults do entrevistador, NÃO confirmados** —
> marcados `[DEFAULT]` abaixo), I17 (ADR-0071/0074), I15 (ADR-0068/0072/0073), I8 (ADR-0049), I19
> (ADR-0075), ADR-0070, ADR-0076.
>
> **Ontologia à frente do código:** tudo o que é novo nasce `planned`. As regras-mãe mantêm o `status`
> (precedente ADR-0072: regra `implemented`, invariantes novas/emendadas `planned`); as contagens de
> `_coverage.json` não mudam.

---

## 0. Numeração e colisões (conferir antes do ship)

| Item | Valor proposto | Observação |
|---|---|---|
| ADR | **0078** | `decisions/` desta branch termina em 0076, **mas** `feat/sispag-boleto-agrupado` (não mergeada) já tem `0077-sispag-boleto-agrupado-bordero.md`. Pegar 0077 colidiria. |
| Ontologia | **0.47.0 → 0.49.0** | Mesma razão: aquela branch reserva **0.48.0**. Se ela cair fora ou for mergeada antes, ajusto (0.48.0 / renumero). Minor bump: nenhuma entidade/ação nova, mas **regra com caminho novo + propriedade nova + campo derivado novo**. |
| Invariantes novas | **I17o, I17p**, **I15q**, **I8c**, **I19t** | Nenhuma existe hoje (grep limpo nesta branch). I17 está em 0.45.0 aqui; a branch `boleto-agrupado` também edita `vinculo-codbar-item-sispag.md` (`last_review` diverge): **conflito de merge previsível, resolver no rebase**. |
| Migration | próxima livre ≥ **0091** | 0089 existe, 0090 reservada por `boleto-agrupado`. Do TaskScoper; aqui só se registra que há **1 migration** (colunas do reconhecimento em `DecisaoSugestaoBoleto` + `deltaDias`/`caminho` no vínculo do item). |
| App | não muda aqui | Bump no ship (`scripts/bump-version.ps1`). |

---

## 1. Candidate analysis

Legenda dos filtros: A universal · B onto/config · C permanência · D já modelado? · E ação/estado/propriedade.
Evidência de universalidade: **1 cliente (Columbia)**, como já aceito para I15/I17 (precedente Q-I do
ADR-0068: revisão com o Francinei, não bloqueante). O que sustenta A2/A3 aqui é que o **fator de
vencimento da barra é norma FEBRABAN** (regulatório, igual para toda trading), e a estrutura "boleto ≠
título em data, valor igual, humano reconhece" é problema de qualquer contas a pagar com DDA.

| # | Candidato | Filtros | Decisão |
|---|---|---|---|
| C1 | Novo **caminho `DATA_DIVERGENTE`** do passo 2: valor igual em centavos (I17b intacta), Δdias ∈ [-10,-1] ∪ [6,10], exige ack válido | A:Y(estrutura) B:onto C:Y D:estende I17c E:regra | **ACCEPT** (emenda I17c, I17a, I17l, I17k; I17o novo) |
| C2 | **7º check de I17d:** vencimento decodificado do **fator de vencimento** da barra × data do DDA (`0000` = sem vencimento; ciclo reinicia em 22/02/2025) | A:Y(FEBRABAN) B:onto C:Y(norma) D:novo E:regra | **ACCEPT** (emenda I17d) |
| C3 | **Ack tipado da divergência** (checkbox + motivo 10–500; grava Δ e valor vistos; invalida se qualquer um mudar) | A:Y B:onto C:Y D:**ver §4** E:propriedade | **ACCEPT como propriedade** de `DecisaoSugestaoBoleto`; **REJECT-DUPLICATE** para entidade própria (§4) |
| C4 | Ack dado pela **mesma analista** que confirma o par (sem segunda pessoa) | A:— B:config de política C:Y | **ACCEPT sem mudança estrutural** (P0-1): é a postura vigente de I15g/Q3; segunda pessoa segue reservada ao passo 3 |
| C5 | Envelope **±10 dias**, valor **exato em centavos** | B:constante global (I15c), não por tenant | **ACCEPT** (nenhuma constante nova; reaproveita o envelope de I15m) |
| C6 | **Data efetiva do lote** (P0-4): data candidata do item = min(título, prazo final do boleto) ≥ hoje | A:Y B:onto C:Y D:estende I8a E:regra | **ACCEPT** (I8c novo) |
| C7 | **Barra vigente na data de débito, rolada ao próximo dia útil bancário**; boleto vencido na data de débito fica `VENCIDO_INFORMATIVO` (P0-3) | A:Y B:onto D:ratifica I15h/I8 | **ACCEPT** (ratifica I15h; usa `BankingCalendar`, nenhum calendário novo) |
| C8 | **`prazoBoleto`** derivado na situação do título (prazo efetivo = min(título, prazo final do candidato acionável)) | A:Y B:onto C:Y D:novo E:propriedade derivada | **ACCEPT** (I19t novo; entidade `TituloAPagar` ganha derivado) |
| C9 | Efeito de `prazoBoleto` na faixa "bloqueados vencem hoje", contador, filtro "Vencidos", de/até | B:UI-flow, regra no backend | **ACCEPT** (I19t(2)); layout/texto da tela é do TaskScoper, não ontologia |
| C10 | Linha mostra a causa ("Boleto sugerido vence hoje · título vence dd/mm"); boleto já vencido em linha separada "perdido"; texto "N candidatos" | A:— B:UI | **REJECT-NOT-DOMAIN** como regra; o **dado** (`origem`, `perdido`, `totalCandidatos`) entra em I19t, o **texto** não |
| C11 | Guarda de data fail-closed no `.REM`: J.data == `itsDtaPgto` (P1-6) | A:Y B:onto C:Y D:espelha I17m (valor) | **ACCEPT como `[DEFAULT]`** (I17p, `planned`, bloqueada na medição HML) |
| C12 | Flag própria `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS`, default `off` (P1-5) | B:config | **REJECT-CONFIG** quanto ao nome/valores; o **conceito** (modo independente, `shadow` registra Δ) entra em I17k `[DEFAULT]` |
| C13 | **Fase 2**: ajustar a data do título (`fin026/alteraDataVencimento` ou `fin070`) | A:? C:? | **REJECT-PREMATURE** → watchlist; vira pré-requisito só se a medição P1-6 mostrar J ≠ barra |
| C14 | Δ>0 (6..10): debitar na data do título ou da barra | A:? | **NEEDS-FRANCINEI/HML**: depende do que o J carrega (P1-6). Não decidido nem em regra nem em ADR |
| C15 | Estado novo `CONFIRMADA_COM_RESSALVA` / `AGUARDANDO_ACK` na decisão ou novo valor em `SituacaoSugestaoTitulo` | E:estado vs propriedade | **REJECT-DUPLICATE** (§6, R2): é propriedade + derivado `exigeReconhecimento` |
| C16 | Novo motivo `BOLETO_VENCE_HOJE` em I19b, ou mexer em `VENCIDO` (I19e) | E, D | **REJECT-DUPLICATE** (R3): `VENCIDO` segue sendo o do **título** (dia civil, ADR-0070); prazo do boleto é propriedade, não motivo |
| C17 | Persistir `prazoBoleto` | I-DDA1/I19n | **REJECT-WORKAROUND** (R4): derivado na hora, como I15m |
| C18 | Tolerância de valor no caminho novo | I15d/I18 | **REJECT-DUPLICATE** (R5): diferença de centavos resolve-se na I18, nunca aqui |
| C19 | Envelope maior que ±10 d | C:? | **REJECT-VOLATILE** (R6): P0-2 manteve ±10 |

---

## 2. Changed files (ACCEPT only)

| # | Arquivo | Mudança |
|---|---|---|
| 1 | `ontology/business-rules/vinculo-codbar-item-sispag.md` | Emendas **I17a, I17c, I17d(+7), I17k, I17l**; novas **I17o** (caminho `DATA_DIVERGENTE`) e **I17p** (guarda de data `.REM`); decisões P0-1..4; medições HML a fazer; watchlist |
| 2 | `ontology/business-rules/sugestao-boleto-dda-sispag.md` | Emendas **I15c (nota), I15d (nota), I15h, I15m, I15o**; nova **I15q** (reconhecimento tipado); trilha/erros |
| 3 | `ontology/entities/decisao-sugestao-boleto.md` | Propriedade `reconhecimento` (+ derivados `reconhecimentoValido`, `exigeReconhecimento`); sinais |
| 4 | `ontology/business-rules/data-debito-remessa-sispag.md` | Nova **I8c** (data candidata do item de data divergente); I8a/I8b inalteradas |
| 5 | `ontology/business-rules/situacao-pagamento-titulo.md` | Nova **I19t** (`prazoBoleto`); emendas **I19i, I19j, I19r (nota)**; teste canônico +casos |
| 6 | `ontology/entities/titulo-a-pagar.md` | Seção "Situação de pagamento": `prazoBoleto` derivado |
| 7 | `ontology/entities/lote-pagamento.md` | `ItemLote.vinculoCodigoBarras` += `caminho`, `deltaDias`, `reconhecimentoId` |
| 8 | `ontology/actions/sispag/confirmar-sugestao-boleto.md` | Pré/pós: ack exigido, gravado na mesma transação |
| 9 | `ontology/actions/sispag/vincular-codigo-barras-ao-item.md` | Preconditions: janela por caminho + ack válido + check 7 |
| 10 | `ontology/decisions/0078-sispag-vinculo-com-data-divergente.md` | NOVO, `status: proposed` (rascunho em §7) |
| 11 | `ontology/_index.json`, `ontology/_coverage.json`, `ontology/CHANGELOG.md` | `_meta.version` 0.47.0→0.49.0, `last_feature`, `note`; nenhuma contagem muda |
| 12 | `ontology/glossary.md` | Verbetes "data divergente", "reconhecimento de divergência", "prazo do boleto" |
| 13 | `ontology/_inbox/_watchlist.md` | Itens de §6 (R7–R9) |
| 14 | `ontology/ui-flows/` (sispag) | Só se o ui-flow de sugestão/situação já lista as telas: 1 linha por tela afetada (TaskScoper confirma) |

Documentação (Parte 9): `docs/ontologia.md` e `README.md` **não** citam I15/I17/I19 (grep de `I17|vinculo-codbar` limpo
fora de `ontology/` e `docs/regis-review/`); **nenhum diff de docs/ proposto**. Os relatórios de `docs/regis-review/` são
registros históricos, não se editam.

---

## 3. Diff

### 3.1 `business-rules/vinculo-codbar-item-sispag.md`

**I17a — elegibilidade** (acrescenta a condição do reconhecimento)

- BEFORE (fim da I17a, após "`ATENCAO` nunca vincula (I15d)."): *(nada sobre reconhecimento)*
+ AFTER: insere, depois dessa frase: "**Exceção controlada (ADR-0078, `planned`):** `ATENCAO` **só por data** (valor igual em centavos, âncora presente, Δdias fora de 0..5 e dentro de ±10) vincula **apenas** pelo caminho `DATA_DIVERGENTE` (I17o), com **reconhecimento válido** (I15q) relido do banco no mesmo instante da decisão. `ATENCAO` por valor, sem âncora, ambíguo, disputado ou vencido continua nunca vinculando."

**I17c — data** (reescrita; o texto vigente vira a "janela padrão")

- BEFORE: "**Data.** … **elegível se `0 ≤ Δdias ≤ 5`** **e** `vencimentoBoleto ≥ dataDebito` do lote. … Barra vencida (antes da data de débito) ou anterior ao título: inelegível. `Δdias > 5` é `ATENCAO` (I15c) e fica fora. … **O passo 2 não lê situação, âncora nem reconhecimento (ack); nunca vincula Δdias < 0.**"
+ AFTER: "**Data (emendada, ADR-0078, `planned`).** Com `Δdias = vencimentoBoleto − vencimentoTitulo` (data civil, UTC 00:00, I15h). **(1) Janela padrão, sem reconhecimento:** `0 ≤ Δdias ≤ 5` **e** barra vigente na data de débito (abaixo): comportamento **inalterado**. **(2) Caminho `DATA_DIVERGENTE` (I17o):** `Δdias ∈ [-10,-1] ∪ [6,10]`, valor igual em centavos (I17b **intacta**, sem tolerância) e **reconhecimento válido** (I15q). **(3) Vigência da barra na data de débito (P0-3, vale para (1) e (2)):** a barra precisa estar vigente em `dataDebito`, onde o vencimento efetivo da barra é **rolado para o próximo dia útil bancário** (`BankingCalendar`: fim de semana e feriado nacional); vencimento efetivo `< dataDebito` ⇒ `VENCIDO_INFORMATIVO` (I15h), **inelegível e fora de escopo** (nada de juros/multa). **(4)** `|Δdias| > 10` ⇒ fora do envelope (`SEM_CANDIDATO`, I15m). **O passo 2 passa a ler o reconhecimento (I15q) e nada além dele**; continua sem ler situação nem reconhecimento de outro tipo. Δdias < 0 deixa de ser 'nunca vincula' e passa a ser 'só com reconhecimento válido'. `[DEFAULT P1-6]` quando a data da barra vai ao `itsDtaPgto`, a guarda I17p se aplica."

**I17d — verificações nossas** (+ 7º check)

- BEFORE: "(6) `itsMnyVlrPgtoResult == valorBoleto` … Divergência ⇒ item **não vinculado** (I17g)."
+ AFTER: insere **(7)**: "**(7) Fator de vencimento × DDA (ADR-0078, `planned`).** Decodificamos o **fator de vencimento** (posições 6–9 do código de 44 dígitos) para uma data civil e exigimos igualdade com `vencimentoBoleto` do pool DDA (`BoletoDda`). Regras: `0000` = barra **sem vencimento**; o fator é módulo 9000 e **reinicia em 22/02/2025** (1000 = 22/02/2025), então a data é a do ciclo **mais próxima** do `vencimentoBoleto` do DDA (ambiguidade resolvida **sem** consultar o relógio); resultado fora do ciclo plausível ⇒ divergente. Fator `0000`: **não aplicável** na janela padrão (comportamento atual preservado) e **inelegível no caminho `DATA_DIVERGENTE`** (sem data de barra não há o que reconhecer). Divergência decodificada × DDA ⇒ item **não vinculado** e, no pré-import/`shadow`, `INELEGIVEL(FATOR_VENCIMENTO_DIVERGE)`; pós-import é determinística (I17g(3)). O check (5) (data do `confirmaCodigoBarras`) **continua** e é independente: (5) confere o ERP, (7) confere o DDA com a norma." Atualiza o preâmbulo: "(1)…(7)".

**I17k — modos** (modo próprio do caminho novo)

- BEFORE: "**Modos e rollout (global ou por filial).** … Os valores de modo por filial são configuração (`EnvironmentProvider`), não ontologia."
+ AFTER: acrescenta: "`[DEFAULT P1-5]` O caminho `DATA_DIVERGENTE` tem **modo independente** do modo do vínculo (I17c(1)), com a mesma sintaxe (`on`/`shadow`/`off`, global ou por filial), **default `off`**. `shadow` roda só verificações locais, **zero chamada ao ERP**, e grava `VINCULO_SIMULADO` com `deltaDias`, `caminho = DATA_DIVERGENTE`, reconhecimento presente/válido e o motivo de `INELEGIVEL`. Modo do vínculo `off` ⇒ o caminho novo também fica `off`. **Portões HML antes de `on` `[DEFAULT P1-5/P1-6]`:** (a) `confirm` com barra antes e depois do título; (b) `finalizar` com `itsDtaPgto` menor e maior que o título; (c) segmento J do `.REM` (a data que o J carrega: título ou barra). Se (c) mostrar J ≠ barra, o caminho fica `off` e a fase 2 vira pré-requisito. O nome da variável de ambiente é configuração, não ontologia."

**I17l — vigência** (+ invalidação do reconhecimento)

- BEFORE: "… cuja decisão deixou de ser `CONFIRMADA` … é **retirado** … detalhe `DECISAO_NAO_CONFIRMADA`."
+ AFTER: acrescenta: "Idem quando o **reconhecimento deixa de ser válido** (I15q: Δdias ou valor atuais ≠ os gravados no ack): item retirado, motivo `VINCULO_CODIGO_BARRAS_FALHOU`, detalhe `RECONHECIMENTO_INVALIDADO`, relido imediatamente antes do `PUT`. A decisão **continua `CONFIRMADA`** (não é anulada pelo sistema, I15g), mas passa a `orfa` com `motivoOrfa` (I15l(3)/I19i) até a analista anular e reconfirmar com novo ack."

**I17o — NOVA — caminho `DATA_DIVERGENTE`** *(planned)*

> "**Caminho `DATA_DIVERGENTE` (ADR-0078).** Cumpridas I17a, I17b (valor igual, líquido, sem tolerância), I17d(1)–(7) e I17h, o item cujo `Δdias ∈ [-10,-1] ∪ [6,10]` é vinculado **se e somente se** (a) existe reconhecimento `DATA_DIVERGENTE` **válido** na decisão (I15q), (b) a barra está vigente na data de débito (I17c(3)), (c) o item tem **data candidata** possível (I8c) e está no lote dessa data, (d) o modo do caminho é `on` (I17k). A sequência de escrita é a **mesma** de I17e (sem passo novo). O `itsDtaPgto` do item acompanha a barra (HML: o `confirm` devolve a data da barra; a barra antes do título **reduz** o limite superior do lote, por isso I8c). `VINCULO_APLICADO` registra `caminho`, `deltaDias` e o `reconhecimentoId`. Falhas seguem I17g (determinística retira; transitória aborta e retoma). Nunca se altera o título nem a decisão (fase 2 é outra regra)."

**I17p — NOVA — guarda de data do `.REM` (espelho da I17m)** *(planned, `[DEFAULT P1-6]`)*

> "Em todo segmento J gerado com código de barras de vencimento ≠ `0000`, a **data do pagamento do J deve ser igual ao `itsDtaPgto` do item**; divergência ⇒ erro nomeado (409), código **mascarado**, tratamento do gate pós-geração da I16b(2). **Fail-closed. Pré-requisito do modo `on` do caminho `DATA_DIVERGENTE`.** Medir em HML **antes de qualquer código** (P1-6) se o J leva o vencimento do título ou da barra; se for o do título quando o `itsDtaPgto` é o da barra (ou o contrário), o caminho fica `off`."

**Medições HML** — acrescentar linhas V10–V12 **a medir** (não preencher): V10 `confirm` com barra antes do título; V11 `finalizar` com `itsDtaPgto` < título e > título; V12 J do `.REM` (data = título ou barra?).
**Fora do escopo (watchlist)** — acrescentar: "Fase 2: ajustar a data do título; boleto vencido na data de débito (juros/multa); |Δdias| > 10."

### 3.2 `business-rules/sugestao-boleto-dda-sispag.md`

**I15c (nota)** — acrescentar no fim: "**Nota (ADR-0078, `planned`):** `ATENCAO` por data (valor igual, âncora) agora tem um destino pelo passo 2 (I17o) **somente com reconhecimento (I15q)**; os limites e o tier **não mudam** e o reconhecimento não alarga nada (I15d)."

**I15d** — acrescentar uma frase: "O **reconhecimento (I15q) não é aprendizado de tolerância**: vale para **aquele** (título, boleto, Δ, valor); outro Δ ou outro valor invalida."

**I15h**

- BEFORE: "…Vencer antes da data de débito segue sendo `VENCIDO_INFORMATIVO`, **não confirmável, inalterado**."
+ AFTER: "…Vencer antes da data de débito segue sendo `VENCIDO_INFORMATIVO`, **não confirmável, inalterado** (ADR-0078, P0-3: **fora de escopo** da data divergente). **A comparação usa o vencimento efetivo da barra rolado ao próximo dia útil bancário** (`BankingCalendar`); barra de sábado, domingo ou feriado vence, para este fim, no próximo dia útil. O vencimento do **título** continua sendo dia civil sem rolagem (ADR-0070)."

**I15m**

- BEFORE: "…Candidato exibido **sem âncora** …, ambíguo, disputado ou vencido tem `confirmavel = false`… Confirmação (I15c/I15d) e passo 2 (I17) **não leem nenhum campo novo**."
+ AFTER: troca a última frase por "**Confirmação lê o reconhecimento (I15q) quando a divergência de data o exige; o passo 2 lê só o reconhecimento (I17c).** Nenhum valor novo em `SituacaoSugestaoTitulo`: o par de data divergente (valor igual, âncora, Δ no envelope) continua `SO_ATENCAO`/`UNICA_SEGURA` e ganha o derivado **`exigeReconhecimento ∈ {NENHUM, DATA_DIVERGENTE}`** por candidato, que a tela usa para pedir o ack; sem ele, `confirmavel` segue verdadeiro **só se** o reconhecimento acompanhar a chamada. O envelope (R$ 10 ou 2 %, ±10 d) é **inalterado**."

**I15o**

- BEFORE: "…B (boleto ≥ débito …) é `ATENCAO`, confirmável só com âncora **e** com `reconheceAvisos` contendo `VENCE_ANTES_DO_TITULO`…"
+ AFTER: acrescenta: "**Com ADR-0078:** quando, além de `Δdias < 0`, o valor é **igual em centavos** (par elegível ao passo 2), o `reconheceAvisos` simples **não basta**: exige-se o reconhecimento **tipado** `DATA_DIVERGENTE` (I15q), que, uma vez válido, **implica** `RECONHECEU_VENCE_ANTES` (o sinal é gravado junto, consumidores atuais não mudam). Com valor diferente (sem passo 2) vale o `reconheceAvisos` de hoje. Caso A (barra vence antes da data de débito) segue `VENCIDO_INFORMATIVO`."

**I15q — NOVA — reconhecimento tipado da divergência de data** *(planned)*

> "**Reconhecimento tipado (ADR-0078, P0-1).** Confirmar (`confirmarSugestaoBoleto`) um candidato cujo `exigeReconhecimento = DATA_DIVERGENTE` (valor igual em centavos, âncora presente, `Δdias ∈ [-10,-1] ∪ [6,10]`) exige, **no mesmo corpo e na mesma transação**, um reconhecimento **separado** da confirmação: `{ tipo: 'DATA_DIVERGENTE', aceito: true (checkbox), motivo (10–500), deltaDiasVisto, valorBoletoVisto (centavos) }`. O **servidor confere** `deltaDiasVisto` e `valorBoletoVisto` contra a avaliação **recalculada ao vivo** (nunca o cache, anti-TOCTOU, I15a); divergência ⇒ **422** `DivergenceAcknowledgementRequiredError` (sem ack) ou `DivergenceAcknowledgementStaleError` (ack não bate com o que existe agora). **Quem dá:** a mesma pessoa com `sispag:executar` que confirma (I15g); `reconhecidoPor/Em` vêm do JWT, nunca do corpo, nunca `sistema`. **Validade (derivado, não persistido):** o reconhecimento é **válido** enquanto `Δdias` e `valorBoleto` atuais forem **iguais** aos gravados; qualquer mudança ⇒ **inválido**, o vínculo (I17a) deixa de ser elegível e a decisão aparece como `orfa` (`motivoOrfa` pt-BR) até anular e reconfirmar (I15l); a transferência da I18j **herda** o reconhecimento **só se** os valores recomputados ainda baterem, senão a decisão nova nasce com o ack inválido. **Não é estado**: `decisao` segue `CONFIRMADA | REJEITADA | ANULADA`. Gravado em `DecisaoSugestaoBoleto.reconhecimento` e no payload de `DECISAO_CONFIRMADA` (sem evento novo)."

Erros nomeados (+): `DivergenceAcknowledgementRequiredError` (422), `DivergenceAcknowledgementStaleError` (422), ambos pt-BR com Δ com sinal, valores e código **mascarado**.

### 3.3 `entities/decisao-sugestao-boleto.md`

- BEFORE (frontmatter `properties`): `[… transferidaPor, versao]`
+ AFTER: `[… transferidaPor, reconhecimento, versao]`
- BEFORE (tabela de propriedades): *(sem `reconhecimento`)*
+ AFTER: nova linha: "`reconhecimento` | objeto? | `{ tipo: DATA_DIVERGENTE, motivo (10–500), deltaDiasVisto, valorBoletoVisto, reconhecidoPor, reconhecidoEm }` (colunas nuláveis, **1 migration**, ADR-0078, `planned`). Preenchido só em `CONFIRMADA` com `exigeReconhecimento`; imutável depois (reconfirmar cria linha nova, I15l). Autor = JWT. **Validade é derivada** (`reconhecimentoValido`), nunca coluna."
- BEFORE (`sinais`): `… VENCE_ANTES_DO_TITULO e RECONHECEU_VENCE_ANTES`
+ AFTER: `… e `DATA_DIVERGENTE_RECONHECIDA` (implica `RECONHECEU_VENCE_ANTES` quando Δ < 0)`.
- Derivados: acrescenta `reconhecimentoValido` e `exigeReconhecimento` à seção "Derivados" (junto de `aplicacao` e `ajuste`); `orfa` ganha o motivo "reconhecimento de data divergente invalidado".
- `last_review`: 2026-10-26; `ontology_version`: "0.49.0".

### 3.4 `business-rules/data-debito-remessa-sispag.md`

**I8c — NOVA — data candidata do item de data divergente** *(planned)*

> "**I8c (ADR-0078, P0-4).** Para item do caminho `DATA_DIVERGENTE` (I17o), a **data candidata** é `min(vencimentoTitulo, vencimentoEfetivoBarra)` (barra rolada, I15h), e só é possível se `≥ hoje_BRT` e dia útil bancário (I8a). O item entra no lote cuja `dataDebito` é a **data efetiva** dele: `Δ < 0` **não puxa os demais itens do lote para trás** (o limite superior I8a, `min(itsDtaPgto)`, passa a considerar `min(vencimentoTitulo, vencimentoEfetivoBarra)` **apenas dos itens daquele lote**; a formação separa por data efetiva). Sem data candidata possível (barra antes de hoje ou sem dia útil entre hoje e ela) ⇒ o par segue **informativo** (`VENCIDO_INFORMATIVO`), não vincula e não bloqueia os demais. I8a e I8b **inalteradas**: continua um lote ⇒ uma `dataDebito`, congelada depois do `criarLote`. `[DEFAULT]` (a confirmar na medição HML V11): o ERP (R2) compara a `dataDebito` com o `itsDtaPgto` **depois do `PUT`**; se ele passar a ser o da barra, a janela do lote é a da barra. Δ > 0: o limite continua sendo o do título; se o débito vai na data do título ou da barra depende do J (I17p)."

I8a (texto da janela): acrescentar uma linha de remissão "(item de data divergente: ver I8c)". Sem outra mudança.

### 3.5 `business-rules/situacao-pagamento-titulo.md` (e ADR-0075)

**I19t — NOVA — prazo efetivo do título bloqueado (`prazoBoleto`)** *(planned)*

> "**I19t (ADR-0078, decisão do maintainer 2026-10-26).** (1) **Derivado, nunca persistido** (I19n; cálculo na hora, como I15m). Cada título da lista ganha `prazoBoleto = { prazoEfetivo: Date, origem: TITULO | BOLETO_SUGERIDO, vencimentoTitulo, vencimentoBoleto?, totalCandidatos?, perdido: boolean }`. (2) **Prazo efetivo = `min(vencimento do título, prazo final do candidato acionável)`**, em dia civil BRT (ADR-0070). **Prazo final do boleto** = vencimento efetivo da barra rolado ao próximo dia útil (I15h). (3) **Acionável** = candidato `CONHECIDO`/`FORTE`, `ATENCAO` **com âncora** ou decisão `CONFIRMADA` não órfã. Fraco, `VENCIDO_INFORMATIVO` e disputado perdedor **não** puxam o prazo. (4) **Ambíguos** (≥ 2 seguros): prazo do candidato **mais cedo** entre os seguros, `totalCandidatos = N` (preferir um alerta a mais a perder o prazo). (5) **Perdido:** candidato acionável com vencimento efetivo `< hoje` ⇒ `perdido = true`, sai do pagamento do dia e é mostrado em linha **separada** ("perdido, resolver no portal do banco"). (6) **Efeito:** `prazoEfetivo` alimenta (a) a faixa `FaixaBloqueadosHoje` (títulos `BLOQUEADO` com `prazoEfetivo = hoje`) e seu contador, (b) o filtro "Vencidos", (c) o filtro de/até de vencimento da aba de títulos, no lugar de `diaDoErp(t.vencimento)` isolado. (7) **NÃO altera** `VENCIDO` (I19e) nem a ordem/prioridade de motivos (I19b) nem `PRONTO`/`BLOQUEADO`: a situação de pagamento continua decidida pelo **título**; o prazo do boleto só muda **quando o analista é avisado**. Falha da fonte `BOLETO` (I19l) ⇒ `prazoEfetivo = vencimento do título`, `origem = TITULO`, fonte em `fontesIndisponiveis` (fail-open com aviso, mesma postura da tela)."

**I19i (emenda):** "… `ORFA` (I15l) **ou reconhecimento de data divergente inválido (I15q)**; `detalhe` = `motivoOrfa`."
**I19j (emenda):** "… confirmado com decisão de **data divergente** e modo do caminho `DATA_DIVERGENTE` (I17k) fora de `on` continua `BOLETO_SEM_DDA` 'aguardando vínculo' (mesma regra do modo do vínculo, com o modo do caminho)."
**I19r (nota):** o botão "Confirmar boleto sugerido" **é o mesmo** para `PARA_CONFIRMAR`; quando o candidato tem `exigeReconhecimento`, a confirmação **abre o ack** (I15q) antes de gravar. Sem sub-estado novo em `sugestaoBoleto`.
**Teste canônico (+):** 15) `Δ = -2`, valor igual, âncora ⇒ `prazoEfetivo = vencimentoBoleto`, `origem = BOLETO_SUGERIDO`, entra na faixa "vencem hoje" no dia da barra mesmo com título a vencer. 16) Barra de sábado ⇒ prazo = segunda útil. 17) 2 seguros ⇒ prazo do mais cedo, `totalCandidatos = 2`. 18) `SO_FRACA` ⇒ prazo = título. 19) Barra `< hoje` ⇒ `perdido = true`, fora da faixa e do pagamento do dia. 20) `VENCIDO` não muda: título que vence hoje continua não-vencido (ADR-0070).

`entities/titulo-a-pagar.md` (seção "Situação de pagamento"): acrescenta "e do **`prazoBoleto`** derivado (I19t, ADR-0078, `planned`): prazo efetivo = `min(vencimento, prazo final do boleto acionável)`; **não é coluna**".

### 3.6 `entities/lote-pagamento.md`

- BEFORE: `vinculoCodigoBarras` = `{ origem: ERP_DDA | DECISAO_HUMANA, decisaoId?, codigoMascarado, aplicadoEm, flpCod }`
+ AFTER: `{ origem, decisaoId?, codigoMascarado, aplicadoEm, flpCod, caminho?: JANELA_PADRAO | DATA_DIVERGENTE, deltaDias?, reconhecimentoId? }` (colunas nuláveis na **mesma** migration; `planned`).

### 3.7 Ações

- `actions/sispag/confirmar-sugestao-boleto.md`: preconditions += "se `exigeReconhecimento = DATA_DIVERGENTE`, reconhecimento presente e conferido ao vivo (I15q)"; postconditions += "`reconhecimento` gravado na decisão, mesma transação"; side_effects inalterados (**zero** escrita no ERP, I15b).
- `actions/sispag/vincular-codigo-barras-ao-item.md`: preconditions "Valor igual …; `0 ≤ Δ ≤ 5` **ou** (`Δ` no envelope ±10 e reconhecimento válido, I17o); vencimento efetivo da barra ≥ dataDebito (rolado); check (7) do fator"; side_effects inalterados.

### 3.8 Metadados

- `_index.json` `_meta`: `version` 0.47.0→**0.49.0**, `generated` 2026-10-26, `last_feature` `sispag-vinculo-data-divergente`, nota "v0.49.0 (2026-10-26, ADR-0078 …)". Mapeamento entidade→arquivo: **sem entrada nova** (nenhuma entidade/ação nova); `impl_files` só quando houver código.
- `_coverage.json`: **nenhuma contagem muda** (regras 32, entidades e ações inalteradas). `open_gap` em `vinculo-codbar-item-sispag`: "I17o/p e emendas de I17a/c/d/k/l a frente do código (ADR-0078)"; idem `sugestao-boleto-dda-sispag` (I15q), `data-debito-remessa-sispag` (I8c), `situacao-pagamento-titulo` (I19t).
- `CHANGELOG.md`: bloco v0.49.0.
- `last_review` 2026-10-26 nos arquivos tocados; `ontology_version` "0.49.0" nas entidades editadas.

---

## 4. Ack tipado: propriedade, não entidade (justificativa contra REJECT-DUPLICATE)

Opções:

- **(A) Nova entidade `ReconhecimentoDivergencia`** — rejeitada **REJECT-DUPLICATE**. Já existe o que ela seria: o reconhecimento de **I15o** (`reconheceAvisos` → `RECONHECEU_VENCE_ANTES` gravado no snapshot da `DecisaoSugestaoBoleto`) e a trilha só-inclusão (`DECISAO_CONFIRMADA` com quem/quando). Um ack não tem identidade própria nem ciclo de vida: nasce **com** a decisão, morre **com** ela e **só tem sentido** para o par (título, boleto) daquela decisão (Filtro D/E). Uma entidade exigiria FK, índices únicos e uma máquina de estado que duplicam as da decisão.
- **(B) Propriedade `reconhecimento` em `DecisaoSugestaoBoleto`** + derivados — **proposta**. Segue "propriedade antes de entidade" e "existente antes de nova"; a imutabilidade da decisão é preservada (o ack é gravado na criação; "invalidar" é **derivado** da comparação com o que existe agora, não mutação). A invalidação reaproveita a saída que já existe: `orfa` + anular + reconfirmar (I15l), sem estado novo.
- **(C) Estender só o sinal `RECONHECEU_VENCE_ANTES`** — insuficiente: o P0-1 exige motivo obrigatório e Δ/valor **vistos** (um sinal-string não carrega isso) e o ack vale também para Δ > 5, onde "vence antes" não se aplica.

**Trade-off para o Yuri (item 4 da lista de aprovação):** (B) generaliza o ack de I15o em vez de o manter separado. Para Δ < 0 com valor igual, o `reconheceAvisos` simples **deixa de bastar** (exige o tipado). Alternativa conservadora: manter I15o intocada e exigir os **dois** (aviso + tipado). Recomendo (B) por unificar numa única caixa de confirmação; ela afeta só o caminho valor-igual.

---

## 5. Invariantes que mudam (resumo)

| Invariante | Hoje | Passa a ser |
|---|---|---|
| **I17c** | "nunca vincula Δ < 0; Δ > 5 é ATENCAO e fica fora; passo 2 não lê ack" | Δ ∈ [-10,-1] ∪ [6,10] vincula **com reconhecimento válido** (I17o); passo 2 lê o reconhecimento; barra vigente na data de débito **rolada** |
| **I17d** | 6 checks | **7 checks** (fator de vencimento × DDA) |
| **I17a** | decisão + tier CONHECIDO/FORTE | + exceção controlada `ATENCAO` só por data com ack |
| **I17k** | 1 modo | + modo próprio do caminho (`off` default) `[DEFAULT]` |
| **I17l** | decisão deixa de ser `CONFIRMADA` ⇒ retira | + reconhecimento inválido ⇒ retira |
| **I15h** | barra < débito ⇒ informativo | + comparação pelo vencimento **efetivo rolado**; fora de escopo ratificado |
| **I15m** | "confirmação/passo 2 não leem campo novo" | confirmação lê o ack; derivado `exigeReconhecimento`; **sem valor novo** em `SituacaoSugestaoTitulo` |
| **I15o** | ack simples para Δ<0 caso B | ack **tipado** quando valor igual |
| **I15d** | confirmação nunca alarga limite | **mantida**; nota: o ack não aprende tolerância |
| **I8a** | `dataDebito ∈ [hoje, min(itsDtaPgto)]` | inalterada; **I8c** define a data candidata do item de data divergente |
| **I19e/I19b** | `VENCIDO` por vencimento do título | **inalteradas** (decisão consciente, C16) |
| **I19i/I19j** | órfã; modo do vínculo | + ack inválido; + modo do caminho |
| **I15b/I15g** | zero escrita no ERP no passo 1; quem confirma é pessoa | **mantidas** (o ack é local e humano) |
| **I17b** | valor igual ao líquido | **intacta** (P0-2) |

---

## 6. Rejeitado (será documentado na ADR e na watchlist)

| # | Item | Categoria | Onde registrar |
|---|---|---|---|
| R1 | Entidade `ReconhecimentoDivergencia` / `AckDivergencia` | **REJECT-DUPLICATE** (§4) | ADR-0078 §Rejeitado |
| R2 | Estado `CONFIRMADA_COM_RESSALVA`/`AGUARDANDO_ACK` ou novo valor de `SituacaoSugestaoTitulo` | **REJECT-DUPLICATE** (Filtro E: é propriedade + derivado) | ADR-0078 |
| R3 | Motivo `BOLETO_VENCE_HOJE` em I19b / alterar `VENCIDO` | **REJECT-DUPLICATE** (`VENCIDO` é do título, ADR-0070; "vence hoje" não é vencido) | ADR-0078 |
| R4 | Persistir `prazoBoleto` | **REJECT-WORKAROUND** (cache de derivado; I19n/I-DDA1) | ADR-0078 |
| R5 | Tolerância de valor no caminho novo | **REJECT-DUPLICATE** (I18/I15d) | ADR-0078 |
| R6 | Envelope > ±10 dias | **REJECT-VOLATILE** (P0-2) | watchlist |
| R7 | **Fase 2: ajustar a data do título** (`fin026/alteraDataVencimento` ou `fin070`) | **REJECT-PREMATURE** | `_watchlist.md`; pré-requisito só se P1-6 medir J ≠ barra |
| R8 | Boleto vencido na data de débito (juros/multa) | **REJECT-PREMATURE** (fora de escopo, P0-3) | `_watchlist.md` |
| R9 | Segunda pessoa para o ack (quatro olhos) | **REJECT-PREMATURE** (decisão P0-1; reservado ao passo 3, I15g) | ADR-0078 |
| R10 | Texto/layout da linha ("Boleto sugerido vence hoje…", "N candidatos", linha "perdido") | **REJECT-NOT-DOMAIN** | tasks.md do TaskScoper |
| R11 | Nome e valores da flag `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS` | **REJECT-CONFIG** | `EnvironmentProvider` |
| R12 | Calendário municipal/estadual na rolagem | **REJECT-PREMATURE** (já na watchlist de I8) | sem mudança |

ADRs separadas só para o que for significativo: R1/R2/R3 ficam **dentro** da ADR-0078 (uma só, "Rejeitado"); nenhum ADR de rejeição avulso.

---

## 7. Rascunho do ADR (`ontology/decisions/0078-sispag-vinculo-com-data-divergente.md`, `status: proposed`)

```markdown
---
adr_number: 0078
title: SISPAG — vínculo de código de barras com data divergente (ack tipado, 7º check do fator de vencimento e prazo efetivo visível)
date: 2026-10-26
status: proposed
type: change
related_entities: [DecisaoSugestaoBoleto, ItemLote, LotePagamento, TituloAPagar, BoletoDda]
related_business_rules: [vinculo-codbar-item-sispag, sugestao-boleto-dda-sispag, data-debito-remessa-sispag, situacao-pagamento-titulo]
continues: [0068, 0071, 0072, 0075]
amends: [0071, 0072, 0075]
evidence:
  - ontology/_inbox/sispag-vinculo-data-divergente-interview.md (P0-1..P0-4 e "Visibilidade do prazo efetivo", maintainer 2026-10-26)
  - ontology/_inbox/sispag-vinculo-data-divergente-ontology-diff.md
  - "ADR-0071 (I17c: 'nunca vincula Δ<0', 'passo 2 não lê ack'); ADR-0072 (I15o, reconheceAvisos); ADR-0070 (vencido por dia civil); ADR-0075 (I19)"
---

# ADR 0078: vínculo com data divergente

**Ontologia à frente do código:** tudo `planned`. **P1-5 e P1-6 são defaults do entrevistador, não
confirmados.** Medição HML da data do J é pré-requisito do modo `on`.

## Contexto
O passo 2 (ADR-0071) só vincula boleto com valor igual e Δdias ∈ [0,5]. Boleto com valor igual mas data
fora disso (antes do título, ou 6–10 dias depois) fica sem código de barras e a remessa aborta, apesar de
a analista já ter reconhecido o par. Além disso o vencimento da barra pode puxar o prazo real de pagamento
para antes do vencimento do título, e a tela não mostra isso.

## Decisão
1. Novo caminho `DATA_DIVERGENTE` (I17o): valor igual em centavos (I17b intacta), Δ ∈ [-10,-1] ∪ [6,10],
   exige **reconhecimento tipado** válido (I15q).
2. Reconhecimento = **propriedade** de `DecisaoSugestaoBoleto` (checkbox + motivo 10–500 + Δ e valor
   vistos); inválido se Δ ou valor mudarem; mesma analista; sem segunda pessoa; sem estado novo.
3. 7º check de I17d: fator de vencimento (módulo 9000, reinício em 22/02/2025, `0000` = sem vencimento)
   cruzado com a data do DDA.
4. Boleto vencido na data de débito segue `VENCIDO_INFORMATIVO`; vigência da barra com rolagem ao próximo
   dia útil bancário (P0-3).
5. Data efetiva do lote: min(título, prazo final do boleto) ≥ hoje (I8c, P0-4).
6. `prazoBoleto` derivado (I19t): prazo efetivo = min(título, prazo final do candidato acionável); alimenta
   a faixa "bloqueados vencem hoje", contador, filtro "Vencidos" e filtro de/até; `VENCIDO` não muda.
7. `[DEFAULT P1-5]` modo próprio `off` por default; `[DEFAULT P1-6]` guarda de data do `.REM` (I17p),
   fail-closed, e medição do J antes de qualquer código.

## Rejeitado
Entidade de reconhecimento (duplica a decisão e I15o); estado novo na decisão ou em `SituacaoSugestaoTitulo`;
novo motivo em I19b / mudança em `VENCIDO`; persistir `prazoBoleto`; tolerância de valor (é I18);
envelope > ±10; segunda pessoa; **fase 2 (ajustar a data do título): REJECT-PREMATURE**; boleto vencido
(juros/multa).

## Consequências
(+) Fecha o buraco "par reconhecido mas sem código"; o prazo real do boleto fica visível.
(−) Confirmação de Δ > 5 com valor igual passa a pedir ack (hoje confirmava sem; sem vínculo era inútil).
(−) Δ > 0: data de débito (título ou barra) depende do J, ainda não medido.
(−) O 7º check pode retirar boletos cujo DDA e fator divergem (esperado: é o ganho).
(−) Conflito de numeração com a branch `sispag-boleto-agrupado` (0077/0.48.0): reconferir.
```

---

## 8. O que fica `planned` / `implemented`

| Item | Estado |
|---|---|
| I17c/I17d(7)/I17a/I17k/I17l emendados, **I17o**, **I17p** | `planned` (resto de I17a–n permanece `implemented`) |
| I15c/d/h/m/o (notas e emendas), **I15q** | `planned` (I15a–p vigentes permanecem como estão) |
| **I8c** | `planned` (I8a/I8b `implemented`) |
| **I19t**, emendas I19i/j/r | `planned` (I19a–s como estão; I19 já era `planned` na regra-mãe) |
| `DecisaoSugestaoBoleto.reconhecimento`, `ItemLote.vinculoCodigoBarras.caminho/deltaDias/reconhecimentoId`, `TituloAPagar.prazoBoleto` | `planned` (1 migration) |
| Contagens de `_coverage.json` | **inalteradas** |
| ADR-0078 | `proposed` (passa a `accepted` na aprovação; pode virar `partial` do lado do código só no ship) |

---

## 9. Perguntas para o Yuri (antes do `approve`)

1. **Numeração:** aceita ADR-**0078** / ontologia **0.49.0** (deixando 0077/0.48.0 para `boleto-agrupado`)?
2. **Ack unificado (§4):** (B) o ack tipado **substitui** o `reconheceAvisos` simples quando valor é igual (recomendado), ou (alt.) exigir os dois?
3. **Ack para Δ>5 com valor igual** passa a ser exigido **na confirmação** (muda o passo 1). Aceito?
4. **Fator `0000`:** "não aplicável" na janela padrão e inelegível no caminho novo. Confirma?
5. **`prazoBoleto` e o filtro "Vencidos":** o maintainer disse que alimenta o filtro e, no item 5, que o boleto perdido vai a linha separada. Assumi: perdido aparece no filtro "Vencidos" **sem** virar motivo `VENCIDO` nem entrar em "vencem hoje". Confirma?
6. **Candidato acionável** (item 4 do maintainer: "ambíguo sem âncora não puxa") vs **ambíguos** (item 6, decidido: puxa o mais cedo): assumi acionável = `CONHECIDO/FORTE` (inclui ambíguos seguros), `ATENCAO` ancorada ou `CONFIRMADA`. Confirma?
7. **`[DEFAULT]` P1-5 e P1-6** seguem como defaults (não decididos): modo próprio `off`, guarda I17p e medição do J antes do código.
8. **Rolagem** da barra ao próximo dia útil: o ERP (R2) compara `dataDebito` com `itsDtaPgto` não rolado; risco de a regra aceitar um débito que o ERP recusa. Assumi fail-closed (vale o mais restritivo) até a medição V11.
9. **Universalidade:** 1 cliente; revisão com o Francinei não bloqueante (precedente Q-I).

---

Responda: **approve** · **edit [arquivo] [instrução]** · **reject [motivo]** · **partial [aceitar 1, 3] [rejeitar 2]**.
Nenhum arquivo da ontologia (regra, entidade, ação, índice, cobertura, ADR, watchlist, glossário) foi alterado.
