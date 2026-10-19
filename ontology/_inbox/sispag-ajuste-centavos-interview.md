## Interview Transcript — sispag-ajuste-centavos — 2026-10-19

**Mode:** tweak
**Entity affected:** `TituloAPagar` (renegociação de centavos), `DecisaoSugestaoBoleto` (segue o novo `titCod`), `LotePagamento`/`ItemLote` (vínculo I17b, valor do import, guarda CNAB)
**Regras tocadas:** I15c/I15d (sugestão), I17a–l (vínculo, ADR-0071), I16 (guarda de código), retomada da remessa
**Evidência primária:** `_inbox/sispag-centavos-hml-achados.md` (HML 2026-10-19, renegociações frnCod 3 e 4 ponta a ponta)

> Entrevista feita sem acesso direto ao Yuri. As decisões já tomadas pelo maintainer em 2026-10-19
> estão registradas como respondidas; o resto foi respondido pelo código (com arquivo:linha) ou fica
> como pergunta aberta P0/P1, cada uma com default recomendado.

### Summary

Hoje o vínculo do código de barras (I17b) exige barra == `fin064.totalAberto` ao centavo, enquanto a
sugestão (I15c) deixa a analista confirmar pares com |Δ| ≤ R$ 0,05 no mesmo dia. O resultado é um par
confirmado que nunca é pago: são 109 títulos NELSON HEUSI em PRD, todos com +R$ 0,01. Nenhum campo do
item resolve, porque o J do `.REM` paga o valor do título. A mudança decidida torna o valor do boleto
a verdade: dentro do limite (|Δ| ≤ R$ 0,05, número do documento igual, emissor confirmado, mesma
janela de data da I15c), a plataforma renegocia o título no `fin070` (juros quando o boleto está
acima, desconto quando está abaixo). Em seguida libera no `fin103` só o bloqueio que a própria
renegociação criou, e só se o título original já estava aprovado. Por fim, faz decisão, carteira e
item seguirem o novo `titCod`. O vínculo passa a comparar com o **líquido**, e o `.REM` ganha a
guarda barra == pagamento do J. Tudo fica atrás de flag por filial (`off`/`shadow`/`on`, default
`off`), e escrita em PRD só acontece com go explícito do maintainer.

### Decisões já tomadas (maintainer, 2026-10-19), respondidas

| # | Decisão |
|---|---|
| D1 | **Valor do boleto é a verdade.** Boleto acima ⇒ diferença é juros/tarifa (`titMnyJuros`, mora/multa no J). Abaixo ⇒ desconto (`titMnyDesconto`, desconto/abatimento no J). |
| D2 | **Mecanismo = Renegociação de Pagamentos `fin070`** (provado em HML): `POST fin070` (pesCod = `fin064.pesCodFor`, `frnVldTipo 2`, `frnDtaReneg`, obs MAIÚSCULA) → `POST fin070/titulos` → `POST fin070/titulos/composicao` (mesmo valor, vencimento, `frgEspNumero`, `pgtCod`, `dupEspOrdem`) → `PUT fin070` com `frnMnyValor = |Δ|` e `frnVldTpop` 1 (acréscimo) ou 2 (desconto) → `PUT fin070/finalizar/{frnCod}`. O título antigo é consumido. Nasce um título com o mesmo `docCod` e um `titCod` novo, com `totalLiquido` = valor do boleto (`totalAberto` continua = base). Liberação: `POST fin103/validaSelecionado` + `POST fin103/aplicarComando {items:[<linha fin103/list> + fbaCod]}`, com `fbaCod` = comando ativo "APROVAR" de `fin106/finBloqCmd/list/{fblCod}`. |
| D3 | **Limite:** auto-ajuste só quando |Δ| ≤ `LIMITE_VALOR_MESMO_DIA` (R$ 0,05, `RegraSugestaoBoleto.ts:20`, reaproveitada, sem constante nova), **e** número do documento igual (título × boleto), **e** emissor confirmado (par `ConfirmacaoEmissorBoleto` `VIGENTE`), **e** janela de data da I15c. Medição em PRD: 109 títulos ≤ R$ 0,05 (todos NELSON +0,01); 0 entre R$ 0,06 e R$ 10; 25 acima de R$ 10 são outro problema (fora do escopo). O falso par da MSC (nº 12294) prova que o número sozinho colide entre emissores. |
| D4 | **Aprovação:** dentro do limite a plataforma reaprova, **só** o bloqueio criado pela própria renegociação e **só** se o título original já estava aprovado. Acima do limite não há nada automático: vale o fluxo normal do Conexos, executado por outra pessoa. |
| D5 | **Escopo = base + escrita.** (a) Base: o vínculo compara com o líquido; guarda CNAB barra == pagamento do J; a UI mostra com clareza os pares ≤ R$ 0,05 confirmados. (b) Escrita: renegociar + reaprovar + seguir o novo `titCod` (carteira, `DecisaoSugestaoBoleto`, item) para o vínculo achar o título. |
| D6 | **Rollout:** igual ao vínculo (`SISPAG_BIND_CODBAR_FILIAIS`): flag `off`/`shadow`/`on` por filial, default `off`. Escritas em PRD só com go explícito do maintainer. |
| D7 | **Premissas pendentes com a Columbia (não bloqueiam):** renegociação em vez de correção do documento; conta contábil de juros/desconto; usuário de aprovação (premissa: a sessão do servidor); acesso em PRD a `fin070`/`fin103` (o robô CLONEX não tem `fin070`/`fin026`/`fin103` no menu). |

### Respostas dadas pelo código

**1. Que identidade Conexos executaria `fin070`/`fin103`?**
- `ConexosSessionResolver.resolve` (`domain/client/ConexosSessionResolver.ts:56-68`): fora de request
  (job/cron) → `registry.robot()` (linha 60). Dentro de request: usuário com vínculo válido → sessão dele
  (111-115). Usuário **sem vínculo** → robô **em silêncio, sem log** (linha 96). Decrypt ou login falho →
  robô com `warn` (101-108, 116-118). O robô é `env.conexosLogin` (`degradarParaRobo`, 123-127;
  `EnvironmentProvider.ts:268/366`, `CONEXOS_USERNAME`).
- Em PRD o robô da plataforma é **CLONEX** (usnCod 138; a UI avisa "suas execuções saem no ERP como robô
  CLONEX", `_inbox/perfil-usuario-*.md`). **Consequência:** se o ajuste rodar num job, ou numa request de
  usuário sem vínculo, ele cai em CLONEX, que não tem `fin070`/`fin103`, e recebe 403. Se rodar como
  analista vinculada (SIMONE/MARILYN, grupo 1), a permissão para `fin070`/`fin103` **não foi medida**, e a
  "reaprovação pela plataforma" sairia no nome da analista, o que contraria a D4.
- **Contradição na evidência:** os achados de HML dizem que MPS_FRANCINEI é "o mesmo do backend em PRD",
  mas o resolver/UI dizem CLONEX. O HML foi rodado com MPS_FRANCINEI porque o CLONEX não existe em HML
  (memória `conexos-robo-clonex-sem-permissao-fin010`). Ver P0-1.

**2. Quando renegociar?** Três candidatos, avaliados contra o código:
- **Dentro da remessa (`vincular_codbar`, `RemessaService.ts:113-127`): não.** Na etapa o título antigo já
  está importado no rascunho nativo. Renegociar consome o título que está no item, o novo nasce bloqueado
  (precisa `fin103`) e precisaria ser re-importado. O total do lote muda depois do `finalizarLote` local
  (L3), e o ledger da remessa não tem etapa para nada disso. A retomada (`sincronizarComErp`) não saberia
  reconhecer o estado.
- **Dentro da transação do `confirmar` (`BoletoSuggestionService.ts:224`; rota `routes/sispag.ts:915`):
  não.** Isso acopla a transação local a 5 escritas no ERP + 2 de liberação, e herda a identidade da
  request (P0-1).
- **Recomendado: ação própria, separada e idempotente** — `AjusteCentavosTituloService` com ledger
  write-ahead próprio, chave `(filCod, docCod, titCodOrigem, decisaoId)`. Etapas observáveis:
  `renegociacao_criada(frnCod)` → `titulo_incluido` → `composicao` → `ajuste_aplicado` →
  `finalizada(titCodNovo)` → `liberada` → `rechaveada`. Disparo: logo depois do `confirmar` comitar (ou
  por botão, P1-2) e por uma varredura de retomada.
  - **Compensação:** falha **antes** de `finalizar` ⇒ `PUT fin070/cancelar/{frnCod}` (ou `DELETE`), e o
    título original fica intacto. Falha **depois** de `finalizar` ⇒ só para a frente (liberar + rechavear),
    nunca desfaz.
  - **Pré-condição:** o título não está em nenhum lote local `FINALIZADO`/`REMESSA_GERADA` nem em rascunho
    nativo do `fin015`. Se estiver num `RASCUNHO` local, o item troca de `titCod` na mesma transação local
    do rechaveamento.
- Reingestão: o cron `ingest-sispag.yml` roda só 3×/dia (07/12/16 BRT). O rechaveamento deve fazer
  **upsert direto** da linha nova em `titulo_a_pagar` com os dados lidos ao vivo do `fin064`, sem esperar o
  cron. Na próxima run, a linha antiga cai em `marcarInativosForaDaRun`
  (`IngestaoPagamentosService.ts:360`).

**3. Mapear decisão, par e carteira para o novo `titCod`:**
- `ConfirmacaoEmissorBoleto` é chaveada por (`pesCod`, `emissorChave`) (`0084_sispag_sugestao_boleto.sql:36,74`).
  Ela **não muda**.
- `sispag_decisao_sugestao_boleto` é chaveada por título (`fil_cod, doc_cod, tit_cod`; índice único
  parcial `CONFIRMADA` por título, `0084:148-149`, e por boleto, `0084:152`). A trilha é só-inclusão (o
  trigger recusa UPDATE). Por isso **não dá para fazer UPDATE do `tit_cod`**.
  Proposta: na mesma transação, a decisão antiga vai a `ANULADA` com motivo sistêmico ("título renegociado
  em X/Y → X/Z, frnCod N"; ator `sistema`), e nasce uma `CONFIRMADA` nova para o título novo, com
  `origem_decisao_id` + `frn_cod`. Novos eventos: `TITULO_RENEGOCIADO` e `DECISAO_TRANSFERIDA`. Isso
  preserva I15l (anular libera o índice do boleto antes da nova reservar). Sem o rechaveamento, a I15l(3)
  tornaria a decisão órfã quando o título antigo sumisse (título inativo) e o vínculo (I17a) recusaria.
- `titulo_a_pagar` tem PK (`fil_cod, doc_cod, tit_cod`) (`0024_pagamento_ingestao.sql:35-57`): upsert da
  linha nova e `ativo=false` imediato na antiga.
- `ItemLote` em `RASCUNHO` local: troca do título. Em `FINALIZADO`, o ajuste fica recusado (pré-condição).

**4. `totalLiquido` e a régua da I17b:**
- Hoje **ninguém lê `totalLiquido`**. `lerTotalAberto` lê só `totalAberto` (`ConexosSispagClient.ts:529-570`,
  schema 157-164). A I17b compara em `ElegibilidadeVinculoCodigoBarras.ts:134-140`, e o executor confere de
  novo em `VinculoCodigoBarrasService.ts:522` (`validacao.barraVlrPgto` vs `aberto`) e `:727-730`. Todos
  esses pontos mudam.
- **Achado novo (bug latente para o caminho de escrita):** o `importar` da remessa manda
  `itsMnyValor = itsMnyVlrPgto = titMnyLiquido = pendente.raw.titMnyValor` (`RemessaService.ts:1378,1400-1402`),
  ou seja, o valor **base**. No HML, o item veio a 53,54 porque o probe enviou `raw.titMnyLiquido`
  (`jobs/probe-hml-vinculo-centavos.ts:300-302`). Em produção mandaríamos 53,53 para um título de líquido
  53,54. Não está provado que o ERP recalcula. **O import precisa usar o líquido do grid de pendentes**
  (`titMnyLiquido`, reserva `titMnyValor`), o que também vale para títulos que já trazem juros/desconto.
- A carteira (`valor` = `titMnyValor`, `ConexosSispagClient.ts:383`) continua mostrando a base (53,53).
  Por isso a sugestão segue calculando Δ = +0,01 no título novo, o que é correto (continua dentro da I15c),
  mas a UI deve exibir o líquido.
- **Semântica:** em 536/2 (sem pagamento), `totalLiquido` 53,54 e `totalAberto` 53,53. Para título com
  pagamento parcial (V8: `totalAberto ≠ titMnyValor` em vários), não sabemos se `totalLiquido` já desconta
  o pago. Recomendação fail-closed: `abertoLiquido = totalLiquido − totalPago`, e exigir que bata com
  `totalAberto + titMnyJuros − titMnyDesconto`. Se divergir, `VALOR_ABERTO_INDISPONIVEL`. Para título
  sem juros/desconto e sem pagamento, as duas fórmulas dão `totalAberto`, ou seja, **nenhuma mudança de
  comportamento**. Medir em PRD (só leitura) antes do merge: quantos títulos BOLETO ativos têm as duas
  fórmulas divergentes (P1-4).

**5. Guarda CNAB:** `RemessaCnabValidator` (`domain/libs/cnab/RemessaCnabValidator.ts:146,184-222`) só lê as
barras (pos 18-61) e o valor delas (`valorDasBarras`). Não lê o valor do pagamento do J. Barra com valor
zerado é legítima (boleto aberto, linha 219) e deve ficar fora da guarda nova.

### Extracted rules (propostas para o OntologyCurator)

- **I17b (emenda):** `round(valorBoleto×100) == round(abertoLiquido×100)`, com
  `abertoLiquido = fin064.totalLiquido − totalPago`, conferido contra `totalAberto + juros − desconto`.
  Divergência ou ausência ⇒ fail-closed. A conferência do executor (`barraVlrPgto`) usa a mesma régua.
- **I17d(6) (inalterada):** juros/desconto **declarados no item** = 0. Os juros/desconto ficam no **título**
  (vindos da renegociação), nunca no item.
- **I17m (nova), guarda CNAB:** em todo segmento J com barras de valor > 0, valor da barra (pos 10-19) ==
  valor do pagamento do J. Divergência bloqueia o `.REM` (erro nomeado, código mascarado).
- **I17n (nova), import pelo líquido:** o item importado carrega o líquido do título, não `titMnyValor`.
- **I18 (nova), ajuste de centavos por renegociação:**
  - **(a) Elegibilidade:** decisão `CONFIRMADA` não órfã; par `VIGENTE`; número do documento igual (dígitos
    estritos); 0 < |Δ| ≤ R$ 0,05; janela de data da I15c; título original aprovado (`vldLib = 1`), não pago,
    sem juros/desconto prévios; fora de lote local `FINALIZADO`/`REMESSA_GERADA` e de rascunho nativo; Δ
    recalculado **ao vivo** (barra decodificada × `fin064`).
  - **(b) Sentido:** Δ > 0 ⇒ `frnVldTpop 1`; Δ < 0 ⇒ `frnVldTpop 2`; `frnMnyValor = |Δ|`.
  - **(c) Pós-condição:** novo título com `abertoLiquido` = valor do boleto, mesmo `docCod`, **mesmo
    vencimento do original** (senão a janela da I15c/I17c quebra; P1-3).
  - **(d) Reaprovação:** só bloqueios do título novo criados no `finalizar` da nossa renegociação, com
    `titMnyTotal` = valor do boleto, e só com o comando "APROVAR" ativo. Bloqueio de outra natureza ou
    outro valor ⇒ não libera e devolve à analista.
  - **(e) Idempotência:** uma renegociação por `(título origem, decisaoId)`; retomada pelo ledger,
    reconhecida ao vivo (`frnCod` existente/finalizado, título novo presente).
  - **(f) Compensação:** antes de finalizar ⇒ cancela; depois ⇒ só para a frente.
  - **(g) Rechaveamento:** a decisão antiga vai a `ANULADA` (sistema) e nasce uma `CONFIRMADA` no título
    novo, na mesma transação, com eventos na trilha.
  - **(h) Acima do limite:** nunca escreve; continua `VALOR_DIFERENTE` e vai para o fluxo manual.
  - **(i) Modos:** `off`/`shadow` (só simula e lista os candidatos) /`on`, por filial; o kill-switch
    `sispagLiveWriteEnabled` derruba também este ajuste.
  - **(j) Identidade:** credencial explícita e configurada; **nunca** cai no robô do resolver em silêncio
    (P0-1).
- **I15c/I15d:** sem mudança de limite. O ajuste não alarga a tolerância de nenhum par.

### Casos canônicos de teste

1. NELSON 462,49 × boleto 462,50, mesmo vencimento, nº igual, par vigente ⇒ `frnVldTpop 1`, 0,01;
   título novo com líquido 462,50; o vínculo passa; J = barra 462,50 / título 462,49 / mora 0,01 /
   pagamento 462,50.
2. Desconto 178,78 × 178,77 ⇒ `frnVldTpop 2`, 0,01; líquido 178,77; J com abatimento 0,01, pagamento 178,77.
3. Δ = R$ 0,06 ⇒ não ajusta, continua `VALOR_DIFERENTE`, zero chamada ao `fin070`.
4. MSC nº 12294 × boleto de outro emissor (R$ 462,50) ⇒ rejeitado (sem par `VIGENTE` para o emissor).
5. Título sem juros/desconto e Δ = 0 ⇒ I17b idêntica ao comportamento atual (regressão).
6. Falha depois de `POST fin070/titulos` ⇒ cancela o `frnCod`; o título original segue intacto.
7. Título novo com bloqueio de regra diferente ou valor ≠ boleto ⇒ não libera.
8. `.REM` com J de barra 53,54 e pagamento 53,53 ⇒ guarda I17m bloqueia.
9. Retomada depois de `finalizar` e antes de liberar ⇒ não cria segunda renegociação.

### entity_changed: true
### Ontology diff needed: yes
Emenda da I17b; novas I17m, I17n e I18 (business rule nova `ajuste-centavos-titulo-sispag` + ADR-0073);
`TituloAPagar` ganha a noção de líquido/juros/desconto e a origem da renegociação (`frnCod`,
`titCodOrigem`); `DecisaoSugestaoBoleto` ganha `origem_decisao_id` e a anulação sistêmica; novos eventos
na trilha; action `ajustar-centavos-titulo`; o watchlist "boleto acima/abaixo" sai para o escopo
≤ R$ 0,05 (acima de R$ 0,05 continua no watchlist).
### Reason: rule change (+ implementation bug: import pelo valor base; guarda CNAB ausente)

### Open questions

**P0 (bloqueantes)**
- **P0-1, identidade da escrita.** Em PRD o robô da plataforma é CLONEX, que não tem `fin070`/`fin103`.
  O resolver cai nele em silêncio para usuário sem vínculo (`ConexosSessionResolver.ts:96`) e em todo job
  (`:60`). Quem assina a renegociação e a reaprovação?
  *Default recomendado:* credencial dedicada e explícita para o ajuste (ex. `conexosAjusteLogin`, via
  `EnvironmentProvider`), resolvida fora do resolver. Sem ela configurada, o modo `on` degrada para
  `shadow`. Antes do `on`: sonda **só leitura** de permissão (`ger014`) para `fin070`/`fin103`
  (espelho do V-PRD1). *Por quê:* a D4 diz "a plataforma reaprova"; sair no nome da analista ou cair
  num 403 do CLONEX contradiz isso. Também é preciso confirmar se "MPS_FRANCINEI = backend PRD" (achados)
  ou CLONEX (resolver/UI).
- **P0-2, momento do disparo.** Logo depois do `confirmar`, de forma assíncrona (automático dentro do
  limite), ou por botão explícito da analista?
  *Default:* automático depois do commit do `confirmar` (D4 diz "auto"), com a mesma ação disponível como
  botão de "tentar de novo", mais uma varredura de retomada. Nunca dentro da remessa.
- **P0-3, título já em lote.** Ajustar título que está em `RASCUNHO` local (trocando o item) ou exigir que
  esteja fora de qualquer lote?
  *Default:* permitir em `RASCUNHO` (troca do item na mesma transação), recusar em
  `FINALIZADO`/`REMESSA_GERADA` e em rascunho nativo.

**P1 (desejáveis)**
- **P1-1, regra de bloqueio diferente da 19.** O título novo pode nascer com outra regra (a renegociação 2
  do suporte nasceu liberada).
  *Default:* liberar só bloqueios cuja diferença de valor seja ≤ |Δ| e que tenham nascido no nosso
  `finalizar`. Qualquer outro bloqueio fica para a analista.
- **P1-2, janela de data.** A I15c aceita ≤ R$ 0,05 só no **mesmo dia**; os achados citam "≤ 5 dias".
  *Default:* mesmo dia (os 118/118 NELSON têm o mesmo vencimento, e reaproveita a constante sem alargar
  nada).
- **P1-3, vencimento do título novo.** A composição exige data. O `fin070` aceita vencimento passado ou de
  hoje? (o HML só testou data futura).
  *Default:* o vencimento original. Se o ERP recusar, o item sai com motivo e fica no fluxo manual. Provar
  em HML.
- **P1-4, líquido em pagamento parcial.** `totalLiquido` já desconta `totalPago`?
  *Default:* a régua dupla fail-closed descrita acima, mais uma medição em PRD só de leitura antes do
  merge.
- **P1-5, limpeza em HML.** Cancelar as renegociações 3 e 4 (536/2 e 540/2 já estão em lotes
  finalizados)?
  *Default:* deixar como estão e documentar.
- **P1-6, contabilidade.** A conta de juros/desconto da renegociação (D7) segue o default do `fin070`.
  Registrar como premissa até a Columbia responder.

---

## Respostas do maintainer (2026-10-19)

**P0**
1. **Identidade:** sempre a **sessão do servidor** (credencial configurada no ambiente: `CONEXOS_USERNAME`, hoje
   MPS_FRANCINEI no `.env`; a nota de passagem diz o mesmo para o Render). **Nunca** a sessão da analista vinculada
   nem cron (crons do GitHub rodam como CLONEX, que não tem `fin070`/`fin026`/`fin103`). Correção à entrevista: o
   "robô" do `ConexosSessionResolver` é a credencial do ambiente, não necessariamente o CLONEX. Antes de `on`: sonda
   somente leitura das permissões em `fin070`/`fin103` em PRD.
2. **Momento:** **logo após a confirmação** do par (fora da transação do `confirmar`), com "tentar de novo" e
   varredura de retomada.
3. **Título em lote:** lote local em `RASCUNHO` ⇒ o item passa para o título novo na mesma transação; lote
   finalizado, com remessa gerada ou já no rascunho nativo do ERP ⇒ não renegocia e avisa.

**P1 (defaults da entrevista aceitos como premissas)**
- Liberar **só** o bloqueio nascido da nossa renegociação (outro bloqueio ⇒ segue o fluxo normal, aviso).
- Diferença de centavos só com **mesmo vencimento** (I15c).
- Vencimento passado/de hoje no `fin070`: provar em HML antes de `on`.
- Líquido de título com pagamento parcial: medir em PRD (somente leitura) antes do merge.
- Renegociações 3 e 4 do HML: ficam como estão.
- Conta contábil de juros/desconto: premissa até a Columbia responder.
