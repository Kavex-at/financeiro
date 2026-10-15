# Proposta — SISPAG: um desfecho de sugestão para todo título "boleto sem DDA" e o aviso "boleto vence antes do título"

> **Status:** PROPOSTA para aprovação do maintainer. Nada foi escrito em `ontology/` (fora deste arquivo),
> código, versões ou CHANGELOG. Branch `feat/sispag-sugestao-para-todo-titulo`. Base: app v0.68.1,
> ontologia 0.42.0, último ADR 0071. Número sugerido: **ADR-0072** (reconferir `origin/main` antes do
> ship: versões colidem entre sessões paralelas). Ontologia resultante sugerida: **0.43.0**.
>
> **Entradas lidas:** ADR-0068 (+4 emendas), ADR-0069, ADR-0071; regras `sugestao-boleto-dda-sispag`
> (I15a–l) e `vinculo-codbar-item-sispag` (I17a–l); código: `RegraSugestaoBoleto`, `MotorSugestaoBoleto`,
> `BoletoSuggestionService` (listar/confirmar), `SugestaoBoletoCache`, `interface/sispag/SugestaoBoleto.ts`;
> frontend: `sugestaoBoleto.ts`, `FormaPagamentoBadge.tsx`, `SugestaoBoletoPainel.tsx`, uso em `page.tsx`.
>
> **Requisito do maintainer (intenção literal):** "preciso ter uma sugestão para todo título e ter um
> aviso quando houver um boleto com vencimento antes do título, o que pode significar atraso no
> pagamento."

---

## 0. Resumo executivo

1. **Hoje** só 7 de 14 títulos mostraram selo (5 "sugestão disponível" = FORTE, 2 "ver boleto
   sugerido"), embora o pool tivesse candidato dentro do envelope para os 14. Duas causas, ambas
   **decisões de implementação documentadas no código**, não regras do maintainer:
   - `MotorSugestaoBoleto.aceita` descarta `ATENCAO` **sem âncora** (par confirmado ou número igual);
   - `camadaSegura` deixa **sem sugestão** o título com 2+ candidatos seguros de mesma força (I15e,
     "ambiguidade por título").
2. **Proposta central:** todo título elegível (BOLETO, ativo, não pago, `tem_boleto = false`) passa a
   ter **sempre um desfecho visível** (`SituacaoSugestaoTitulo`), derivado e **não persistido**
   (I-DDA1): ou candidato(s) ranqueado(s) com o motivo de não ser "sugestão única segura", ou o status
   explícito **"nenhum boleto no pool dentro do envelope"**. **Nunca** um boleto inventado.
3. **Candidato novo exibido ≠ candidato confirmável.** Candidato sem âncora e candidatos ambíguos
   entram na tela como **informativos**. O que é confirmável (I15c/I15d) e o que o passo 2 vincula
   (I17a–d: centavos iguais, Δ 0..+5 d, `CONFIRMADA` humana, tier `CONHECIDO/FORTE` recalculado) ficam
   **intocados**.
4. **Novo sinal `VENCE_ANTES_DO_TITULO`** (Δdias < 0) com aviso explícito em três lugares (selo na
   grade, painel, confirmação). **Avisa e exige reconhecimento** (ack aplicado no servidor); não
   bloqueia o que já era confirmável; o vencido na data de débito segue **não confirmável** (I15h). O
   passo 2 nunca vincula Δ < 0 (já fora de `0..+5`).
5. **ADR-0072** (tipo `change`, `continues: [0068, 0071]`) com 3 invariantes novos (I15m–o) e emendas
   curtas em I15c, I15e, I15h. Sem entidade nova; 1 propriedade derivada; 1 sinal; 1 campo de
   reconhecimento no snapshot da decisão.

---

## 1. Análise de candidatos (Filtros A–E)

Legenda: A = universalidade; B = ontologia × configuração; C = permanência; D = já modelado; E = ação ×
estado. Universalidade aqui é **1 cliente** (Columbia), como em toda a família I15/I17 (precedente Q-I do
ADR-0068, revisão do Francinei **não bloqueante**).

| # | Candidato | Filtros | Decisão |
|---|---|---|---|
| C1 | "Desfecho por título" (`SituacaoSugestaoTitulo`) como **visão derivada** da sugestão | A:parcial (1 cliente, mas é extensão de I15 já aceito), B:onto (estrutura), C:Y, D:estende I15c/I15e, E:estado derivado | **ACCEPT** (propriedade derivada; sem entidade) |
| C2 | Persistir a sugestão / o desfecho | D:duplica I-DDA1 (candidato muda com o pool) | **REJECT-DUPLICATE** |
| C3 | Exibir `ATENCAO` **sem âncora** (informativo, com Δ com sinal) | A:Y (a analista precisa ver o boleto para corrigir o título no ERP), C:Y, D:estende I15c | **ACCEPT** (exibição) |
| C4 | Tornar `ATENCAO` **sem âncora confirmável** | criaria par (credor, emissor) a partir de caso com Δ alto (+R$ 526), e o par vira âncora de futuras sugestões; não há evidência de necessidade | **REJECT-PREMATURE** → watchlist / P0-1 |
| C5 | Exibir candidatos **ambíguos** (2+ seguros de mesma força) como lista ranqueada, motivo "mais de um candidato" | A:Y, D:substitui a decisão "sem sugestão" do I15e | **ACCEPT** (exibição) |
| C6 | Tornar ambíguo confirmável por escolha direta | muda a semântica do que o I17 pode vincular (decisão tomada entre idênticos) | **REJECT-PREMATURE**: a saída é **rejeitar** o(s) outro(s) (rota existente) e o restante vira único/FORTE |
| C7 | Status `SEM_CANDIDATO` ("nenhum boleto no pool dentro do envelope") | A:Y, E:estado do desfecho (não entidade) | **ACCEPT** |
| C8 | Boleto de candidato **disputado** (reservado a outro título) aparece no perdedor como `DISPUTADA`, com referência ao título vencedor | A:Y, D:complementa Q-D/I15e (hoje o perdedor "perde" em silêncio) | **ACCEPT** |
| C9 | Sinal `VENCE_ANTES_DO_TITULO` (Δdias < 0), aviso de atraso/juros/multa | A:Y (risco de pagar boleto vencido é do domínio de contas a pagar BR), B:onto (sinal) / texto na UI, C:Y (regulatório/contratual), D:complementa I15h (que só cobre "antes da data de débito"), E:sinal da avaliação | **ACCEPT** |
| C10 | Reconhecimento (ack) do aviso gravado com a decisão | D:estende `DecisaoSugestaoBoleto` (snapshot), A:Y (auditoria) | **ACCEPT** (propriedade/sinal do snapshot) |
| C11 | Ack só na UI | o backend recusa de qualquer forma é postura do projeto (I15k, R11) | **REJECT-WORKAROUND**: ack **no servidor** |
| C12 | Top-N por título (N = 3), teto de linhas | não é domínio, é produto/perf | **REJECT-NOT-DOMAIN** (constante de código, citada na regra como limite de exibição) |
| C13 | Alargar a janela do passo 2 (valor igual +6..+10 d; os 4 MULTILOG +8 d) | 1 credor; V9 mostra que o `finalizar` aceita até +10 d do débito, mas I17c fixou `[0,+5]` | **REJECT-PREMATURE** → watchlist |
| C14 | Vincular boleto acima/abaixo do título | ADR-0071 (inviável/não medido) | **REJECT-PREMATURE** (já na watchlist) |
| C15 | "Sugerir" um boleto sintético / placeholder quando não há candidato | inventa dado financeiro | **REJECT-WORKAROUND** (nunca) |
| C16 | Aviso de atraso por dia útil bancário (sábado/feriado) | ADR-0070 decidiu vencido por **dia civil** | **REJECT-DUPLICATE** do ADR-0070 (ver P1-4) |
| C17 | Retirar/travar automaticamente do lote o título com boleto vencido | passo 3 / decisão de produto | **REJECT-PREMATURE** |
| C18 | Alerta ativo (e-mail/notificação) de boleto vencendo antes | operacional, não domínio | **REJECT-NOT-DOMAIN** |
| C19 | Constantes do envelope (R$ 10 / 2 % / 10 d) e limites Q-B | já globais, sem mudança | **sem mudança** |

**Observação de honestidade (A):** "todo título tem sugestão" vira "todo título tem **desfecho**".
Para 14 de 14 houve candidato dentro do envelope **na leitura somente leitura**, mas candidato dentro do
envelope **não é** boleto correto: é evidência fraca. A proposta mede e mostra isso; não promete que o
boleto certo exista.

---

## 2. Definição precisa de "uma sugestão para todo título"

### 2.1 Universo

Título **elegível** = o já definido pelo motor (`elegiveis`): `forma = BOLETO`, ativo, não pago,
`tem_boleto != true`, com vencimento. Títulos com `CONFIRMADA` viva ou órfã seguem como hoje (I15l).

### 2.2 Desfecho por título (`SituacaoSugestaoTitulo`, derivado, não persistido)

Avaliado na ordem, parando no primeiro que casar. "Pool livre" = o do I15e. "Envelope" =
`ENVELOPE_*` atuais (valor ≤ max(R$ 10, 2 %), |Δdias| ≤ 10), **inalterado**.

| Situação | Condição | O que a tela mostra | Confirmável? | Elegível ao passo 2? |
|---|---|---|---|---|
| `CONFIRMADA` / `ORFA` | existe decisão `CONFIRMADA` (I15l) | como hoje | — | só se I17a–d (como hoje) |
| `UNICA_SEGURA` | exatamente 1 candidato `CONHECIDO/FORTE`, não disputado | "sugestão disponível" (como hoje) | sim (I15c) | **sim, se** I17a–d |
| `AMBIGUA` | 2+ candidatos seguros de mesma força | lista ranqueada (máx. N), motivo **"mais de um candidato"**, cada um com Δ e emissor mascarado | **não** nesta versão (C6); a analista **rejeita** o que não é e sobra o único | não |
| `SO_ATENCAO` | melhor candidato é `ATENCAO` **com âncora** (par vigente **ou** número igual) | candidato(s) ranqueado(s) com Δ com sinal destacado | sim (I15c, como hoje) | **não** (`ATENCAO` nunca vincula, I17a) |
| `SO_FRACA` | melhor candidato é `ATENCAO` **sem âncora** | candidato(s) ranqueado(s), rótulo **"sem confirmação do emissor ou do número"**, Δ com sinal | **não** (C4, P0-1) | não |
| `SO_VENCIDA` | só há candidato(s) `VENCIDO_INFORMATIVO` (I15h) ou com Δdias < 0 | candidato(s) + **aviso de atraso** (§3) | não (I15h) / ver §3 para Δ<0 ≥ data de débito | não |
| `DISPUTADA` | o melhor candidato está reservado a **outro** título (Q-D) | o candidato + "reservado ao título `<doc>` (menor vencimento)" | não | não |
| `SEM_CANDIDATO` | nenhum boleto livre dentro do envelope | **"Nenhum boleto no pool DDA dentro do envelope (±R$ 10,00 ou 2 %, ±10 dias)"**, mais a hora da última sincronização e o atalho para a aba "Boletos DDA" | — | — |

Notas:
- `UNICA_SEGURA`, `SO_ATENCAO` e `CONFIRMADA` **são exatamente** o comportamento atual
  (sem regressão); as demais são o **acréscimo**.
- Com vários tipos presentes, o título leva o **melhor** (ordem da tabela, de cima para baixo), e a
  lista do painel mostra todos até N com a força de cada um.
- Todo desfecho carrega `totalCandidatos` (para "mostrando 3 de 11").

### 2.3 O que é e o que não é confirmável (inalterado)

- **Confirmável** continua sendo: `CONHECIDO`, `FORTE`, `ATENCAO` **com âncora**, e único para o título
  (I15c/I15e). A confirmação segue sendo evidência (I15a) e só o passo 2 pode agir sobre ela.
- **Novos exibidos** (`AMBIGUA`, `SO_FRACA`, `DISPUTADA`, `SO_VENCIDA`, `SEM_CANDIDATO`) têm
  `confirmavel = false` no motor **e** o `confirmar` do serviço recusa (409 `BoletoSuggestionNotAvailableError`
  com o motivo da situação). Rejeitar continua possível nos que têm boleto (exceto vencido, como hoje).

### 2.4 O passo 2 (I17) fica intocado

Elegibilidade do vínculo = **I17a–d, sem alteração**: item BOLETO no rascunho, ERP não associou,
decisão `CONFIRMADA` não órfã com par vigente, tier **recalculado** `CONHECIDO/FORTE`, centavos iguais
(I17b), `0 ≤ Δdias ≤ 5` e barra ≥ data de débito (I17c). Nada do que esta proposta cria (situação,
sinal `VENCE_ANTES_DO_TITULO`, ack) é lido pelo `VinculoCodigoBarras`. **Critério de aceite:** teste
que prova que, para o mesmo conjunto de decisões `CONFIRMADA`, o conjunto de itens "vinculáveis" no
`shadow` é idêntico antes e depois (ver §9).

---

## 3. O aviso "boleto vence antes do título"

### 3.1 Definição

`Δdias = vencimentoBoleto − vencimentoTitulo` (data civil, UTC meia-noite; já calculado, com sinal).
**`VENCE_ANTES_DO_TITULO` ⇔ Δdias < 0.** Um sinal novo em `SINAL_SUGESTAO`, **ortogonal** ao tier:
acompanha qualquer candidato (`ATENCAO` ou `VENCIDO_INFORMATIVO`) e é gravado no snapshot da decisão
quando houver confirmação.

Além do sinal, a avaliação passa a expor `diasVencidoNoDebito = max(0, dataDebito − vencimentoBoleto)`
(campo derivado), para a mensagem dizer **quantos dias de atraso** haveria no débito previsto.

### 3.2 Relação com I15h e com a data de débito

Dois níveis, claramente distintos:

| Caso | Δdias | vs. `dataDebito` | Resultado | Confirmável | Aviso |
|---|---|---|---|---|---|
| **A** — vence antes do título **e** antes do débito (sempre o caso de título **sem lote**, pois Q-C iguala débito = vencimento do título) | < 0 | boleto < débito | `VENCIDO_INFORMATIVO` (I15h, **inalterado**) | **não** | **crítico**: "já estará vencido no débito" |
| **B** — vence antes do título mas **no/depois** do débito (lote com débito antecipado) | < 0 | boleto ≥ débito | `ATENCAO` (hoje, sem sinal próprio) | só se âncora (como hoje) | **atenção**: "se o débito atrasar, vencerá" |

Consequência prática (vale o P1-4/P1-5): para títulos **sem lote** o caso A cobre tudo, então o aviso
é **informativo** e a confirmação segue bloqueada pela I15h — comportamento mais seguro e já decidido.
O caso B é o único em que o reconhecimento (ack) altera o fluxo.

### 3.3 Aviso bloqueia ou só avisa?

Recomendação (**P0-2**): **avisa e exige reconhecimento**, nunca bloqueia além do que a I15h já bloqueia:

- Caso A: continua **não confirmável** (I15h). Aparece o aviso crítico; sem botão Confirmar.
- Caso B: confirmável **somente** se já era confirmável hoje (âncora) **e** com **ack explícito**. O ack
  é conferido **no servidor** (`reconheceAvisos: ['VENCE_ANTES_DO_TITULO']`); ausente ⇒ 422
  `WarningAcknowledgementRequiredError` com o texto do aviso. O reconhecimento é gravado no snapshot
  (sinal `RECONHECEU_VENCE_ANTES` + quem/quando já presentes na trilha).
- **Nunca vincula no passo 2:** Δ < 0 está fora de `0..+5` (I17c: "anterior ao título: inelegível"). O
  `shadow` o registra `INELEGIVEL` com motivo. Isso é dito na mensagem do painel ("confirmar não faz o
  boleto sair na remessa").

### 3.4 Onde aparece e texto (pt-BR)

**Grade (coluna Forma de pagamento).** Acima/ao lado do selo de situação, um chip de atenção
(ícone `AlertTriangle`, tom `warning`), com `sr-only` explicando:

- Caso A: **"boleto já vencido no débito"** (tooltip/`sr-only`: "O boleto candidato vence antes da data de débito prevista").
- Caso B: **"boleto vence antes do título"**.

O chip aparece **sempre que o melhor candidato do título (ou qualquer um da lista) tem Δdias < 0**,
independentemente de a situação ser `SO_VENCIDA`, `SO_FRACA` ou `AMBIGUA`.

**Painel (`SugestaoBoletoPainel`).** Por candidato, bloco de aviso acima das evidências
(`TEXTO_SINAL.VENCE_ANTES_DO_TITULO = { texto: 'vence antes do título', atencao: true }`) e mensagem
completa:

- Caso A: **"Este boleto vence em 13/10, 3 dias antes do título (16/10). Na data de débito (16/10) ele já
  estará vencido há 3 dias: pagar pode gerar juros e multa. Confirme o vencimento no portal do banco
  antes de decidir. Serve só como informação."**
- Caso B: **"Este boleto vence em 15/10, 1 dia antes do título (16/10). O débito está previsto para
  14/10, dentro do prazo do boleto, mas se o pagamento atrasar ele vencerá antes do título: pode haver
  juros e multa. Confirmar não faz o boleto sair na remessa."**

**Diálogo de confirmação.** Hoje "Confirmar" é botão direto. Para candidato com o sinal (caso B), o
botão abre diálogo curto com: o texto acima, o Δ com sinal, e um **checkbox obrigatório** "Entendo que
este boleto vence antes do título e que o pagamento na data do título pode gerar atraso, juros e
multa". O botão "Confirmar" do diálogo só habilita marcado. Sem sinal, o fluxo atual (sem diálogo)
não muda.

**Aba "Boletos DDA".** Mesma linha de aviso na coluna de diferença de vencimento (o `formatDeltaDias`
já traz o sinal; acrescenta-se o rótulo quando negativo).

### 3.5 Interação com `dataDebito`

`dataDebito` = a do lote (I8) ou, sem lote, o vencimento do título (Q-C). A mensagem sempre mostra
**as duas** datas (débito e vencimento do boleto). Mover o título de lote (ADR-0064) muda a data de
débito e portanto o caso A/B: o aviso é **recalculado** (derivado), nunca persistido. O ack gravado
refere-se ao snapshot da confirmação e **não** vale para um novo cenário de data: se a decisão for
anulada e refeita, novo ack.

---

## 4. Emendas por arquivo (antes → depois)

### 4.1 `ontology/business-rules/sugestao-boleto-dda-sispag.md`

**I15c** — acrescentar ao final:
- ANTES: "...Qualquer coisa maior é `ATENCAO`. São constantes de código globais (não por tenant)..."
- DEPOIS: "...Qualquer coisa maior é `ATENCAO`. **`ATENCAO` é exibida em duas formas: com âncora
  (par vigente ou número igual; confirmável) e sem âncora (informativa, nunca confirmável; I15m).**
  São constantes de código globais (não por tenant)..."

**I15e** — a frase de ambiguidade:
- ANTES: "**Ambiguidade por título (default implementado, revisável):** quando um título tem dois ou mais
  candidatos seguros ... de mesma força, o título fica **sem sugestão** — a analista os vê na aba
  "Boletos DDA"; nenhum `ATENCAO` é inventado para desempatar."
- DEPOIS: "**Ambiguidade por título:** quando um título tem dois ou mais candidatos seguros de mesma
  força, o título fica com a situação `AMBIGUA`: os candidatos são **listados e ranqueados** com o
  motivo "mais de um candidato", **nenhum é confirmável**, e a analista resolve **rejeitando** os que
  não são (I15j); o último restante volta a ser único. Nenhum `ATENCAO` é inventado para desempatar.
  **Disputa (Q-D):** o perdedor passa a mostrar o boleto como `DISPUTADA`, com a referência ao título
  que o reservou (I15n)."

**I15h** — acrescentar:
- ANTES: "Boleto que vence antes da data de débito nunca é seguro e não é confirmável no passo 1..."
- DEPOIS: mantém integral **e** acrescenta: "**Boleto que vence antes do vencimento do título (Δdias
  < 0), ainda que no ou depois do débito, carrega o sinal `VENCE_ANTES_DO_TITULO` e o aviso de atraso
  (I15o); só é confirmável se já o era (âncora) e com reconhecimento explícito.** O vencimento antes da
  data de débito segue sendo `VENCIDO_INFORMATIVO` (inalterado)."

**Novas invariantes (I15m, I15n, I15o):**

| # | Regra proposta |
|---|---|
| **I15m** | **Todo título elegível tem um desfecho visível.** `SituacaoSugestaoTitulo` ∈ {`UNICA_SEGURA`, `AMBIGUA`, `SO_ATENCAO`, `SO_FRACA`, `SO_VENCIDA`, `DISPUTADA`, `SEM_CANDIDATO`} (+ `CONFIRMADA`/`ORFA`, I15l), derivado do cenário e **não persistido** (I-DDA1). Candidato exibido sem âncora ou ambíguo tem `confirmavel = false`; a confirmação (I15c/I15d) e o passo 2 (I17) **não dependem** de nenhum campo novo. **`SEM_CANDIDATO` nunca é preenchido com boleto inventado** nem com candidato fora do envelope. Cada desfecho informa quantos candidatos existem (`totalCandidatos`) e o motivo de não ser sugestão única. |
| **I15n** | **Candidato fraco não reserva boleto.** Só `CONHECIDO/FORTE`, `ATENCAO` **com âncora** e `CONFIRMADA` reservam (Q-D, I15e). `SO_FRACA` e `VENCIDO_INFORMATIVO` não reservam; o mesmo boleto pode aparecer na lista de dois títulos, marcado `compartilhado`. O título que **perdeu** a disputa de um boleto seguro/ancorado mostra-o como `DISPUTADA` com `reservadoParaTitulo`. Um título nunca fica em `SEM_CANDIDATO` por ter perdido uma disputa. |
| **I15o** | **Boleto vencendo antes do título é avisado.** Δdias < 0 ⇒ sinal `VENCE_ANTES_DO_TITULO` e `diasVencidoNoDebito = max(0, débito − vencimento do boleto)`. Confirmar candidato com o sinal exige `reconheceAvisos` contendo o sinal (servidor, 422 sem ele); gravado no snapshot. O sinal **nunca** altera tier, limite (I15d) ou elegibilidade do passo 2 (I17c já exclui Δ < 0). O aviso é recalculado a cada cenário (mudança de lote/data de débito). |

### 4.2 `ontology/business-rules/vinculo-codbar-item-sispag.md`

**I17c** — nota, sem mudança de regra:
- ANTES: "...Barra vencida (antes da data de débito) ou anterior ao título: inelegível..."
- DEPOIS: acrescenta "(`VENCE_ANTES_DO_TITULO`, I15o, é exatamente esse caso; o motivo de `INELEGIVEL` no
  `shadow` e em `vinculos-previstos` passa a citá-lo). **O passo 2 não lê situação, âncora nem ack.**"

**I17a** — acrescentar: "Candidato exibido sem âncora, ambíguo ou disputado nunca é elegível
(`confirmavel = false` impede a decisão)."

### 4.3 `ontology/entities/decisao-sugestao-boleto.md`

- ANTES: snapshot com `sinais`, `tier`, deltas.
- DEPOIS: `sinais` pode incluir `VENCE_ANTES_DO_TITULO` e `RECONHECEU_VENCE_ANTES`; **sem estado novo**.
  (Se `sinais` é coluna de lista/JSON, **sem migration**; se for enum fechado no banco, 1 migration
  mínima — TaskScoper confirma na leitura da 0084.)

### 4.4 `ontology/entities/boleto-dda.md`

- Nota em I-DDA4: o pool é a base do desfecho `SEM_CANDIDATO` e traz `sincronizadoEm`; defasagem > 8 h
  (ADR-0067) torna o `SEM_CANDIDATO` **"sem candidato no pool de há N h"**, nunca afirmação absoluta.

### 4.5 `ontology/decisions/0068-*.md`

Uma linha na seção final: "Emenda (ADR-0072): a decisão de I15e 'ambiguidade ⇒ sem sugestão' e o corte
de `ATENCAO` sem âncora foram substituídos por exibição informativa; ver 0072." (Sem reescrever o corpo.)

### 4.6 Docs (Parte 9)

`docs-contexto/03_ontologia_financeiro.md` e o `CLAUDE.md` do repositório (conferir menções à sugestão
de boleto e à contagem de invariantes); `ontology/_index.json`, `ontology/_coverage.json`
(`ontology_version` 0.43.0; I15m–o `planned`); `ontology/_inbox/_watchlist.md` (C4, C6, C13, C17).

---

## 5. ADR-0072 — emenda ou ADR novo?

**Recomendação: ADR novo (0072), `type: change`, `continues: [0068, 0071]`,** porque:
(a) o 0068 já tem 4 emendas e esta muda a **decisão de produto** (ambiguidade, âncora) em vez de
corrigir; (b) toca duas regras (I15 e a nota em I17) e a fronteira de universalidade; (c) deixa um
rastro "o que mudou e por quê" para o revisor. Uma emenda curta de **uma linha** no 0068 aponta para
ele (§4.5).

Conteúdo-chave do ADR: o requisito do maintainer; a medição 14/14 × 7/14; as duas causas; a decisão
"exibir ≠ confirmar"; I15m–o; o aviso e o ack; o que **não** muda (I15a/b, I15d, I15k, I17a–d,
cache, escrita no ERP); riscos e rejeitados (§8).

---

## 6. Limites contra ruído e volume

**O risco real** ("sem âncora o pool inteiro viraria sugestão") é a razão original do corte. A
proposta o trata por **contenção de exibição**, não por segurança de decisão:

1. **Envelope inalterado** (R$ 10 ou 2 %, ±10 d): fora dele é `SEM_CANDIDATO`, não "o menos pior".
2. **Top-N = 3 por título** (constante `SUGESTAO_TOP_CANDIDATOS`, P1-1), mais `totalCandidatos`
   ("mostrando 3 de 11"). Ordem: força (`CONHECIDO`, `FORTE`, `ATENCAO` ancorada, `ATENCAO` fraca,
   vencida) → |Δvalor| → |Δdias| → `ddcCod/ditCod` (a `melhor` atual, determinística).
3. **Rótulo honesto**: candidato fraco **nunca** usa "sugestão disponível" nem verde; texto e tom
   `muted`/`warning` ("candidato sem confirmação").
4. **Contadores por situação** na listagem (`contagem` já existe por resultado; ganha
   `contagemSituacao`), e **log** `sugestao_boleto.cenario_calculado` com a contagem por situação para
   medir o ruído em PRD.
5. **Mensagem de ordem de grandeza** no painel quando o Δ é grande ("+R$ 526,00 = +2,0 %") — já há
   `formatDeltaPercentual`.

**Desempenho.** O motor já indexa os livres por centavos e faz busca binária na `faixaDeCandidatos`
(O((T+B) log B + T·k)). Hoje `aceita` descarta **depois** de avaliar; passar a reter os N melhores
mantém a mesma varredura. Mantém-se a faixa (o envelope não muda). Com ~1,1 mil títulos e ~8,8 mil
boletos livres, k é de dezenas a poucas centenas em valores redondos ⇒ 10⁴–10⁵ avaliações O(1), ordem
de milissegundos; reter top-3 por inserção ordenada é O(k·N). Sem varredura nova do pool.

**Cache.** Mesma chave: o **cenário global** (`SugestaoBoletoCache`, single-flight, TTL 30 s,
invalidado por confirmar/rejeitar/anular/revogar e fim de sincronização do DDA). O cenário passa a
guardar, por título, `{situacao, candidatos[≤N], totalCandidatos}`; **filtros** de filial/credor/situação
são aplicados depois (como hoje). Confirmar/rejeitar/anular **continuam relendo o banco ao vivo**
(anti-TOCTOU, I15a). O ack é conferido contra a avaliação recalculada no servidor, nunca contra o
cache.

**Tamanho de resposta.** `SUGESTAO_TAMANHO_MAXIMO = 2000` linhas e a tela busca tudo numa chamada;
com N=3 por título a lista poderia passar disso (1,1 mil × 3). Recomendação (P1-2): a listagem devolve
**uma linha por título** (`titulos[]`, a melhor + `situacao` + `totalCandidatos` + flags de aviso);
a lista completa de candidatos vem **sob demanda** ao abrir o painel (rota
`GET /sispag/sugestoes-boleto/titulo?filCod&docCod&titCod`, mesmo cache). Mantém o contrato atual
(`sugestoes[]` com os confirmáveis) para compatibilidade.

**Disputa (um boleto, dois títulos).** Pela I15n: fracos não reservam ⇒ o boleto pode aparecer nos dois
(marcado `compartilhado`, "também candidato do título X"); seguros/ancorados seguem Q-D (menor
vencimento → menor `docCod`) e o perdedor vê `DISPUTADA` com a referência, em vez de silêncio. A
confirmação, o índice único parcial e a guarda I16 continuam impedindo dois títulos com o mesmo boleto.

---

## 7. Mudanças de UI

| Onde | Mudança |
|---|---|
| `FormaPagamentoBadge` | prop `sugestao` deixa de ser string e vira `{ situacao, avisoVenceAntes: 'NENHUM'\|'ATENCAO'\|'CRITICO', total }`. Rótulos do link: `UNICA_SEGURA` "sugestão disponível", `SO_ATENCAO` "ver boleto sugerido", `AMBIGUA` "mais de um boleto possível", `SO_FRACA` "ver candidato (sem confirmação)", `DISPUTADA` "boleto reservado a outro título", `SO_VENCIDA` "ver boleto vencido", `SEM_CANDIDATO` "sem boleto no pool" (não-botão se o painel não tiver o que mostrar além do texto). Chip de aviso conforme §3.4. |
| `sugestaoBoleto.ts` | `TEXTO_SINAL` + `VENCE_ANTES_DO_TITULO`; `ROTULO_SITUACAO`; `resumoDoTitulo` passa a ler `situacao` e o aviso; helper `mensagemVenceAntes(candidato)` com as datas formatadas. |
| `SugestaoBoletoPainel` | lista até N candidatos; cabeçalho com a situação e o motivo ("mais de um candidato", "sem confirmação do emissor ou do número", "reservado ao título 1234"); estado **vazio** para `SEM_CANDIDATO` (texto do §2.2 + hora do sync + link para "Boletos DDA"); bloco de aviso de atraso (§3.4); botão Confirmar abre diálogo com ack só no caso B; "Confirmar indisponível: `<motivo da situação>`" (já existe para `!podeConfirmar`). |
| `page.tsx` | passa `situacao`/aviso ao badge; filtro por situação (chips com contagem); mantém aviso de truncamento. |
| Aba "Boletos DDA" | rótulo de aviso quando Δdias < 0. |
| Copy do ack | em `MotivoDecisaoDialog` ou novo `ReconhecerAvisoDialog` (checkbox + botão). |

Acessibilidade: chip e mensagens com `role="status"`/`sr-only` como os existentes; ack é checkbox
rotulado, foco no diálogo; cor nunca é o único canal (ícone + texto).

---

## 8. Alternativas rejeitadas

1. **Confirmar `ATENCAO` sem âncora** (C4): cria par (credor, emissor) a partir de caso fraco e
   contamina futuras sugestões (o par vira âncora). Se o maintainer quiser, é P0-1(b) e exige regra
   para **não** criar par nessa confirmação — mudança estrutural, não de exibição.
2. **Escolher um dos ambíguos** (C6): decisão entre idênticos; a rejeição já existe e é auditada.
3. **Alargar a janela do passo 2** para os 4 MULTILOG +8 d (C13): 1 credor, V9 só mede o `finalizar`;
   watchlist com evidência necessária (barra +8 d, retorno bancário).
4. **Aviso só na UI** (C11): o backend precisa recusar sem ack, ou o aviso é decorativo.
5. **Bloquear tudo com Δ < 0** (inclusive caso B anterior à data de débito): perde o caso legítimo de
   débito antecipado já confirmável hoje, sem ganho (o passo 2 já exclui).
6. **Persistir desfecho/ruído** (C2): desatualiza com o pool/carteira e duplica I-DDA1.
7. **Boleto sintético / "melhor chute" quando não há candidato** (C15): dado financeiro inventado.
8. **Aviso por dia útil bancário** (C16): reabriria o ADR-0070; ver P1-4.
9. **Notificação ativa** (C18): operacional.
10. **Tolerâncias por credor** (`RegraNegocioCliente`): REJECT-CONFIG, e I15d proíbe o alargamento.

---

## 9. Perguntas ao maintainer

### P0 (bloqueiam a aprovação)

**P0-1 — Candidatos fracos e ambíguos são só informativos nesta versão?**
Opções: (a) **sim: exibidos e rankeados, não confirmáveis** (a analista rejeita para desambiguar; para
`SO_FRACA` usa o dado para corrigir o título no ERP); (b) confirmáveis. **Recomendado: (a).** Mantém
I15c/I15d/I17 intactos e não cria par a partir de caso fraco. É o que a proposta assume em todo o texto.

**P0-2 — O aviso "vence antes do título" só avisa ou também bloqueia?**
Opções: (a) **avisa e exige ack no servidor**; o vencido-no-débito segue bloqueado pela I15h e o passo 2
nunca vincula Δ < 0; (b) só avisa, sem ack; (c) bloqueia confirmar qualquer Δ < 0. **Recomendado: (a).**
Observação para a decisão: para títulos **sem lote** (maioria da grade) o caso A cobre todo Δ < 0, logo
o ack só muda o fluxo em lote com débito antecipado — (a) e (c) diferem pouco na prática.

### P1 (padrão adotado se não houver resposta)

- **P1-1** Top-N por título: **3**.
- **P1-2** Formato da listagem: **uma linha por título + candidatos sob demanda**; alternativa: elevar
  `SUGESTAO_TAMANHO_MAXIMO` para ~5000 e manter tudo numa chamada (mais simples, payload maior).
- **P1-3** Candidato fraco com `valor ≈ igual` e Δdias dentro de 0..+5 não existe (seria `FORTE`); o
  fraco típico é Δvalor > R$ 0,05 ou Δdias > 5. Manter o rótulo único "sem confirmação" (não
  subdividir). Padrão: **não subdividir**.
- **P1-4** Atraso por dia civil (ADR-0070), sem calendário bancário: boleto vencendo em sábado/feriado
  exibe aviso mesmo podendo ser pago no próximo dia útil. Padrão: **civil**, com a frase "confirme no
  portal do banco".
- **P1-5** Aviso também para título **com** DDA associado pelo ERP? O ERP associa só valor + dia
  exatos, então Δ ≠ 0 não ocorre. Padrão: **não**.
- **P1-6** Revisão de universalidade com o Francinei (não bloqueante), idem Q-I.
- **P1-7** Medir antes de ligar: rodar o motor novo em modo somente leitura sobre PRD e registrar a
  distribuição por situação (alvo: nenhum título sem desfecho; `SO_FRACA` não pode ser maioria
  silenciosa). Padrão: **sim, critério de aceite**.

---

## 10. Arquivos que mudariam e esboço de tarefas

### Ontologia/docs (após aprovação)
- `ontology/decisions/0072-sispag-desfecho-por-titulo-e-aviso-vence-antes.md` (novo)
- `ontology/business-rules/sugestao-boleto-dda-sispag.md` (I15c, I15e, I15h; novas I15m–o; erros nomeados:
  `WarningAcknowledgementRequiredError` 422)
- `ontology/business-rules/vinculo-codbar-item-sispag.md` (notas I17a/I17c)
- `ontology/entities/decisao-sugestao-boleto.md`, `ontology/entities/boleto-dda.md`
- `ontology/decisions/0068-*.md` (uma linha de emenda), `ontology/_index.json`, `ontology/_coverage.json`,
  `ontology/_inbox/_watchlist.md`, `docs-contexto/03_ontologia_financeiro.md`, `CLAUDE.md` (se citar)

### Backend
- `src/backend/domain/interface/sispag/SugestaoBoleto.ts` — `SITUACAO_SUGESTAO_TITULO`, sinais
  `VENCE_ANTES_DO_TITULO`/`RECONHECEU_VENCE_ANTES`, `diasVencidoNoDebito`, `totalCandidatos`,
  `reservadoParaTitulo`, `compartilhado`, `contagemSituacao`, `SUGESTAO_TOP_CANDIDATOS`.
- `src/backend/domain/service/sispag/RegraSugestaoBoleto.ts` — emite o sinal e `diasVencidoNoDebito`
  (puro; nenhum tier muda).
- `src/backend/domain/service/sispag/MotorSugestaoBoleto.ts` — separar `exibivel` de `confirmavel`
  (`aceita` hoje mistura); reter top-N; `camadaSegura` devolve `AMBIGUA` em vez de descartar; camada
  fraca sem reserva; `DISPUTADA`; linha `SEM_CANDIDATO` para todo elegível sem candidato.
- `src/backend/domain/service/sispag/BoletoSuggestionService.ts` — listagem (`titulos[]`,
  `contagemSituacao`), rota de detalhe por título, `confirmar` valida `reconheceAvisos` (recalcula a
  avaliação no servidor), log por situação.
- `src/backend/routes/sispag.ts` (+ Zod do body `reconheceAvisos`) e erro nomeado.
- Repositório/migration **só se** `sinais` não aceitar os dois valores novos (TaskScoper confirma).
- `src/backend/domain/service/sispag/` do vínculo: **nenhuma mudança**; só o texto do motivo do `shadow`.

### Frontend
- `src/frontend/lib/sispag` (tipos), `app/sispag/components/{sugestaoBoleto.ts, FormaPagamentoBadge.tsx,
  SugestaoBoletoPainel.tsx, BoletosDdaTab.tsx}`, `app/sispag/page.tsx`, diálogo de ack, testes
  correspondentes.

### Tarefas (para o TaskScoper)
1. Regra pura: sinal `VENCE_ANTES_DO_TITULO` + `diasVencidoNoDebito` (TDD, casos A/B, Δ = −1, −8, 0).
2. Motor: retenção top-N; `exibivel` ≠ `confirmavel`; `AMBIGUA`; `DISPUTADA`; `SEM_CANDIDATO`; ordem
   determinística (teste de permutação da entrada, como hoje).
3. Teste de **não-regressão do passo 2**: mesmo conjunto vinculável (shadow) antes/depois; decisões com
   Δ < 0 `INELEGIVEL`.
4. Serviço: listagem + detalhe + ack no servidor (422 sem ack; 409 para não confirmável novo).
5. Medição somente leitura sobre PRD/HML (P1-7) e registro em `_inbox`.
6. UI (badge, painel, diálogo, filtro por situação), com os 14 casos reais como fixtures (equal +8 d,
   acima +R$ 3…+R$ 526, abaixo −R$ 9,49).
7. Ontologia/ADR/índices/coverage e versão (conferir versão e ADR na `main` antes do bump).

### Gates relevantes
`entity_changed = true` (regra e propriedade derivada; sem entidade nova). Código toca `src/frontend/` ⇒
DesignSystemReviewer. Regis-Review reduzido (delta + QAs de risco: performance, security/auditoria do
ack, testability).

---

**Aprovação solicitada:** responder P0-1 e P0-2 (ou aceitar as recomendações) e `approve` /
`edit [arquivo] [instrução]` / `reject [motivo]` / `partial [...]`.
