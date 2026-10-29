# Diff de ontologia — título de grupo sugerido na carteira

> **Aprovado por Yuri em 2026-10-29**, com os 9 defaults da entrevista. Aplicado em ontologia 0.52.0.

Feature: `sispag-grupo-na-carteira` (`/feature-tweak boleto-agrupado-sispag`). Branch `fix/sispag-grupo-na-carteira`,
base `origin/main` 14765216 (app 0.77.2, ontologia 0.50.0). `entity_changed = true` (um valor novo de
`SituacaoSugestaoTitulo` e um campo de leitura no desfecho). **Sem migration** (tudo é calculado, I-DDA1).

> **Numeração.** ADR-0080, I15t e ontologia 0.51.0 estão **reservados** por outra branch. Esta proposta usa
> **emenda da ADR-0077** (sem ADR nova) e as próximas letras livres da família I21: **I21v** e **I21w**. Versão da
> ontologia proposta: **0.52.0**; reconferir os irmãos juntos antes do ship. Nada de ID de regra novo em I15 (a
> exclusão entra como emenda de I15q e I15e(4)).

## Diagnóstico (código, main 14765216)

- `BoletoSuggestionService.sugerirAgora` (`BoletoSuggestionService.ts:1064-1119`) alimenta o motor 1:1 só com grupos
  **confirmados** (`gruposConfirmados`); `MotorSugestaoBoleto.preparar` (`MotorSugestaoBoleto.ts:340-348`) tira o boleto
  do grupo confirmado de `livres` e dá `EM_GRUPO` aos títulos dele (`:290-293`).
- `MotorGrupoBoleto.sugerir` (`MotorGrupoBoleto.ts:133`) é um segundo motor, chamado só por
  `GrupoBoletoService.sugerir` (`GrupoBoletoService.ts:155`), com leitura própria (`carregarCenario`, `:805`), sem
  cache e sem ligação com o desfecho 1:1. O boleto 129818 ainda é "livre" para o motor 1:1, que o oferece a 5566.
- O cenário em cache (`SugestaoBoletoCache`, `SugestaoBoletoCache.ts`) é o único ponto de leitura da tela
  (`listarSugestoes`, `detalharTitulo`, `situacaoPorTitulo`, `contextoPorTitulo`); confirmar/anular já o invalidam.
- Dependências: `BoletoSuggestionService` já injeta `GrupoBoletoService`; `MotorGrupoBoleto` é puro
  (`CodigoBarrasBoleto`, `BankingCalendar`, `RegraGrupoBoleto`), sem dependência de volta: injetá-lo no
  `BoletoSuggestionService` não cria ciclo.

## Emenda da ADR-0077 (2026-10-29) — a sugestão de grupo é vista pelo 1:1

> **Emenda 2026-10-29 — sugestão de grupo na carteira.** O motor 1:1 e o de grupos eram cegos um ao outro: um boleto
> que fecha exatamente a soma de um conjunto de títulos (I21e) continuava sendo oferecido como candidato 1:1,
> confirmável, a um dos títulos (PRD 2026-10-29: RHENUS, boleto 129818 de R$ 26.369,85 oferecido a 5566, R$ 434,38
> acima do título). Confirmar o 1:1 consome o boleto (I15q) e desfaz o grupo. Decidido: a sugestão **única** de grupo
> (I21e, já sem ambiguidade G6) entra como insumo do desfecho 1:1; o boleto dela deixa de ser candidato confirmável e os
> títulos dela mostram o grupo sugerido. Continua sem escrita, sem Conexos e sem persistência (I-DDA1); a confirmação
> segue só na aba Boletos agrupados (I21i).

## Regras (`business-rules/boleto-agrupado-sispag.md`)

| ID | Texto proposto (próximas letras livres) |
|----|------------------------------------------|
| **I21v** | **Sugestão de grupo vista pela carteira (emenda 2026-10-29).** Para cada sugestão de grupo da I21e/f (confirmável ou não), o boleto dela **não é candidato confirmável** do motor 1:1 (I15e(4) passa a valer também para boleto de sugestão de grupo, além do de grupo confirmado) e cada título dela ganha o desfecho **`GRUPO_SUGERIDO`**, com o ponteiro `grupoSugerido {ddcCod, ditCod, numeroBoleto, nTitulos, valorBoletoCentavos, confirmavel, motivo?}`. Só vale para o que o 1:1 não resolve com força: `UNICA_SEGURA`, `CONFIRMADA`, `ORFA` e `EM_GRUPO` **mantêm** o desfecho (o título ganha só o ponteiro informativo); `AMBIGUA`, `SO_ATENCAO`, `SO_FRACA`, `SO_VENCIDA`, `DISPUTADA` e `SEM_CANDIDATO` passam a `GRUPO_SUGERIDO`. O boleto do grupo continua visível na gaveta do título como linha **não confirmável** "pertence ao grupo". Calculado sobre o MESMO cenário em cache da listagem (uma passada do motor de grupos, sem segunda leitura da carteira). |
| **I21w** | **A sugestão de grupo nunca confirma nada nem libera lote (emenda 2026-10-29).** `GRUPO_SUGERIDO` é evidência de tela, como todo desfecho 1:1 (I15a): não confirma, não reserva boleto, não altera `temBoleto`, não muda a situação de pagamento (continua "Boleto sem DDA" até o grupo ser confirmado e virar `EM_GRUPO`, I15q; o texto do motivo aponta para a aba Boletos agrupados). Decisão 1:1 já `CONFIRMADA` no boleto do grupo segue valendo (o sistema não a anula, I15g) e o grupo continua indisponível enquanto ela existir (boleto ocupado). Confirmar ou anular o grupo, confirmar/anular/revogar uma decisão e o fim do sync do DDA invalidam o cache e recalculam o selo. |

## Regras alteradas (texto, sem ID novo) — `sugestao-boleto-dda-sispag.md`

- **I15q** (acrescentar): "O boleto de uma **sugestão** de grupo (I21v) também não é candidato confirmável de nenhum título
  e o título dela mostra `GRUPO_SUGERIDO` quando o 1:1 não tem desfecho forte."
- **I15m / I15e(4)**: lista de desfechos ganha `GRUPO_SUGERIDO`; exclusão (4) cobre grupo sugerido.

## Entidade / ação / integração

- `DesfechoTitulo` (+ view da API): campo opcional `grupoSugerido`; `SituacaoSugestaoTitulo` + `GRUPO_SUGERIDO`;
  `MOTIVO_POR_SITUACAO` e `SUGESTAO_BOLETO_SEM_DDA` ganham o texto; `contagemSituacao` inclui a situação.
- Ações: nenhuma nova (`sugerirGruposBoleto` já existe; a leitura é o mesmo cenário). Integrações: nenhuma (zero Conexos).

## Seam proposto (resumo técnico)

1. `EntradaMotorSugestao.gruposSugeridos?: GrupoSugeridoChaveado[]` (ddc/dit, títulos, confirmavel, motivo, numero, valor).
   `MotorSugestaoBoleto.preparar` trata o boleto desses grupos como o de grupo confirmado (fora de `livres`) e um
   passo final troca/anota o desfecho dos títulos (regra I21v). Motor continua puro.
2. `BoletoSuggestionService.sugerirAgora` já carrega titulos, boletos, pares, decisões e grupos; acrescenta, no mesmo
   `Promise.all`, as duas leituras que faltam ao motor de grupos (`bloqueios.listAtivos`, `listTitulosEmLotesComprometidos`),
   monta a `EntradaMotorGrupo` pelo mesmo helper extraído de `GrupoBoletoService.carregarCenario` (evita duas
   montagens divergentes) e chama `MotorGrupoBoleto.sugerir` (puro) antes de `motor.analisar`. Tudo cai no mesmo
   valor do `SugestaoBoletoCache`: nenhum custo extra por request, só uma passada CPU do motor de grupos por TTL.
3. `GrupoBoletoService.sugerir` (aba) fica como está (leitura ao vivo, anti-TOCTOU); só passa a usar o helper.
4. Frontend: selo e ação "Ver grupo" na tabela e na gaveta (`sugestaoBoleto.ts`, `page.tsx`), filtro e contagem.

## Testes (RED primeiro)

`MotorSugestaoBoleto.test.ts` (boleto de grupo sugerido não é confirmável; 5566 `SO_ATENCAO` → `GRUPO_SUGERIDO`;
`UNICA_SEGURA` mantém), `BoletoSuggestionService.test.ts` (cenário traz o grupo, `confirmar` 1:1 do boleto do grupo
recusa), `GrupoBoletoService` (helper compartilhado), frontend `sugestaoBoleto.test.ts`. Caso PRD: RHENUS 5541/5566.

## Versões

Ontologia 0.52.0 (proposta; 0.51.0 reservado). App: `fix`/`feat` ⇒ bump pelo `scripts/bump-version.ps1` no ship.

---

## Delta 2026-10-29 (tarde) — a confirmação do grupo vai para a gaveta e a aba Boletos agrupados sai

> **Aprovado por Yuri em 2026-10-29** (delta e sub-perguntas S1 a S10 com os defaults). Aplicado nas regras, na ADR-0077 e no CHANGELOG da 0.52.0.

Decisão de Yuri (adendo da entrevista, mesma data). Dentro da emenda 2026-10-29 da ADR-0077 e da ontologia **0.52.0**;
**sem ADR nova, sem migration, sem ação nem estado novos**. Nada muda na regra de negócio da confirmação: o endpoint,
o ator do JWT, o reconhecimento dos avisos e a reavaliação no servidor (anti-TOCTOU) são os de hoje. Muda **onde** a
analista age.

### Textos que mudam

- **ADR-0077, emenda 2026-10-29.** A frase "a confirmação segue só na aba Boletos agrupados (I21i)" é substituída por:
  "a confirmação e a anulação do grupo passam a ser feitas na **gaveta do título** e na **linha do boleto da aba Boletos
  DDA (fin124)**, pelos mesmos endpoints e regras; a aba Boletos agrupados deixa de existir". Acrescentar que a
  composição manual passa a ser uma ação da linha do boleto na aba DDA.
- **I21i (Confirmação é humana e auditada).** Acrescentar o lugar: a confirmação é feita pela pessoa na gaveta do
  título ou na linha do boleto da aba DDA; **uma única ação** (`confirmarGrupoBoleto`), com o ator do JWT; os avisos
  que exigem reconhecimento são mostrados antes e enviados em `reconheceAvisos`. A sugestão passa a expor os `avisos`
  que a regra já calcula, só para a tela os apresentar; o servidor continua conferindo tudo contra a avaliação
  recalculada.
- **I21g (Composição manual).** O ponto de entrada passa a ser a ação **"Compor com títulos"** na linha do boleto da
  aba Boletos DDA (mesmas condições de hoje: não vinculado, não vencido, com código de barras). Regra inalterada.
- **I21t (Anulação).** Acrescentar o lugar: gaveta do título (qualquer título do grupo) e linha confirmada da aba DDA.
  Regra inalterada (motivo de 10 a 500 caracteres, lote em rascunho retira os N itens, lote comprometido só avisa).
- **I21v (sugestão de grupo vista pela carteira).** Trocar "a ação 'Ver grupo' abre a aba Boletos agrupados no grupo"
  por "a ação 'Ver grupo' abre a **gaveta do título**, que mostra o grupo (boleto, títulos com o atual destacado, soma
  contra o boleto, avisos ou motivo)". O resto (situações, exceção do título de fora, reserva só na camada dos
  seguros, filtro e contagem) não muda. Acrescentar o selo/ação também para `EM_GRUPO` (abre a gaveta com Anular).
- **I21w (a sugestão nunca confirma nada).** Reescrever o enunciado: "`GRUPO_SUGERIDO`, o ponteiro, o selo e a faixa da
  carteira são **evidência de tela** e nunca confirmam; a **confirmação existe apenas como ação explícita da pessoa**
  ('Confirmar grupo' na gaveta ou na linha do boleto), com reconhecimento dos avisos, pelo mesmo endpoint e com
  reavaliação no servidor. A **tabela de títulos e o selo não têm botão de confirmar.**" O resto da I21w (não reserva
  boleto, não altera `temBoleto` nem a situação de pagamento, decisão 1:1 `CONFIRMADA` prevalece, invalidação do
  cache) fica. A situação de pagamento só muda quando o grupo é confirmado (`EM_GRUPO`), como já era.
- **I15q / entidade `decisao-sugestao-boleto.md` / CHANGELOG.** Onde dizem "confirmar o grupo é na aba Boletos
  agrupados", passar a "na gaveta do título ou na linha do boleto da aba Boletos DDA".
- **Mensagens ao operador (código).** O detalhe da situação de pagamento, o motivo de `GRUPO_SUGERIDO` e a recusa do
  confirmar 1:1 deixam de citar a aba Boletos agrupados.

### Onde a confirmação e a anulação acontecem (resumo)

| Ação | Antes | Depois |
|---|---|---|
| Ver o grupo sugerido | Aba Boletos agrupados | Gaveta do título; linha expansível na aba Boletos DDA |
| Confirmar grupo | Aba Boletos agrupados | Gaveta do título; linha do boleto na aba Boletos DDA |
| Anular grupo | Aba Boletos agrupados | Gaveta do título; linha do boleto confirmado na aba Boletos DDA |
| Compor manualmente | Aba Boletos DDA (leva ao diálogo) | Aba Boletos DDA, ação "Compor com títulos" |
| Situação do grupo (rejeitado, órfão, divergente, retido) e orientação | Aba Boletos agrupados | Gaveta e linha do boleto na aba Boletos DDA |

### Entidade e contratos tocados (nenhuma persistência)

- `SugestaoGrupoBoleto` (leitura): campo `avisos`.
- Lista de boletos DDA: campo opcional `grupo {estado, id?, nTitulos, confirmavel}` por boleto, contagem `emGrupo` e
  filtro `emGrupo` (ortogonal à situação). Derivado do mesmo cenário de grupos; sem tabela nova.
- Frontend: nenhum endpoint de escrita novo.

### Esboço de implementação

- **Componentes novos.** `GrupoBoletoBloco` (boleto, títulos, soma, avisos ou motivo, Confirmar/Anular; usado na
  gaveta e na linha expandida), `ReconhecerAvisosGrupo` (extraído do `ComporGrupoBoletoDialog`), linha expansível e
  chip/cartão na aba DDA.
- **Reaproveitados e movidos.** `MotivoDecisaoDialog`, `SituacaoGrupoBadge`, `resumoMotivosGrupo`,
  `orientacaoSituacaoGrupo`, `EXPLICACAO_INTERCAMBIAVEL`, `formatCentavos` (de `grupoBoleto.ts`), `ComporGrupoBoletoDialog`
  (só muda o ponto de abertura) e as funções de `lib/sispag.ts` (`fetchSugestoesGrupoBoleto`, `fetchGruposBoleto`,
  `confirmarGrupoBoleto`, `anularGrupoBoleto`). `GrupoBoletoPainel.tsx` e `GrupoSugeridoAviso.tsx` saem (o aviso
  vira o bloco da gaveta); a aba e o `focoBoleto`/`grupoEmFoco` somem da `page.tsx`.
- **Backend.** `BoletoDdaService` (+ `CenarioGrupoBoleto`) para `grupo`/`emGrupo`; `avisos` na sugestão; textos.
- **Testes, RED primeiro.**
  - Gaveta: mostra o grupo com o título atual destacado e a soma; Confirmar grupo envia `origem: 'SUGERIDO'`, os
    títulos e os avisos reconhecidos; sem avisos confirma direto; aviso exige o reconhecimento antes de enviar; não
    confirmável mostra o motivo e não tem botão; `EM_GRUPO` mostra Anular com o diálogo de motivo; sem
    `sispag:executar` é só leitura; abre a partir de qualquer título do grupo; fica aberta e atualiza o estado depois
    de confirmar e de anular; erro do servidor aparece sem fechar.
  - Aba DDA: cartão "Pagam vários títulos", chip "Em grupo" (filtro e contagem), linha expansível com os títulos,
    Confirmar e Anular, "Compor com títulos" nas mesmas condições de hoje.
  - "Ver grupo" (faixa, selo, gaveta) abre a gaveta do título e não troca de aba; `page.tsx` sem a aba.
  - Backend: `grupo`/`emGrupo` no `BoletoDdaService`; `avisos` na sugestão; mensagens novas.
  - Paridade: um teste por linha do inventário acima, para nada se perder.
- **Revisão.** `DesignSystemReviewer` sobre os componentes novos e a `page.tsx`; `PatternGuardian` no backend.
