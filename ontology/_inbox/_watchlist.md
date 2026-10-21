# Ontology Watchlist — conceitos premature / a revisitar

> Conceitos capturados durante curadorias que **não entraram** na ontologia agora (premature ou
> aguardando contrato/decisão), mas que devem ser revisitados quando houver mais profundidade ou um 2º
> cliente. Cada item aponta a curadoria/ADR que o registrou.

## Frente IV — Conciliação de Recebimentos + NDe (ADR-0022, curadoria 2026-07-24)

- **Regras de negócio DEFERIDAS à Fase 4** (stubs criados, semântica não fixada — não modelar antes da
  hora): `encomenda-percentuais` (0,1%/0,9% — base, significado, contas, arredondamento);
  `adiantamento-cliente` (critério de identificação + ciclo do `CreditoCliente`); `separacao-multa-juros`
  (informado × calculado, destino por parcela, divergência esperado×pago). Cada uma tem OfficeHours
  própria na Fase 4.
- **Nexxera — canal/formato (O7):** API vs SFTP/CNAB240 vs OFX, auth, sandbox **não confirmados**.
  Modelado com port channel-agnostic; **spike na Fase 0**. Revisitar quando o contrato do vendor fechar
  (define o adaptador concreto).
- **Write de recebível (O3):** aposta = `fin010` parametrizado. **Confirmar o shape do payload/endpoint
  no build (Fase 5)** — capturar uma baixa real de recebível se a parametrização não fechar.
- **Emissão da NDe:** endpoint/trigger de emissão no Conexos **a confirmar na Fase 5** (junto do O3).
  Idempotência ("já emitida") já modelada; o contrato wire não.
- ~~**Módulo 6 (observabilidade):** transversal, não é entidade/ação única — **semeado** em cada fase
  (correlation id, run de auditoria, logs) e **consolidado na Fase 6** (dashboards/métricas/alertas).
  Não modelar como entidade agora.~~ **FECHADO em 2026-09-01 pela ADR-0042.** A consolidação
  aconteceu: `JobRun` (read-model sobre as três tabelas de run) e `Alerta` (persistido) entraram
  como entidades, com quatro ações em `actions/operacao/`. A previsão de que observabilidade "não é
  entidade única" estava certa quanto à origem — ela nasceu semeada em cada frente — e errada quanto
  ao destino: o que faltava era exatamente um agregado de leitura por cima do que já estava semeado.
  Ficam abertos, como follow-up e fora do slice, os dois pontos cegos nomeados na ADR-0042 (detector
  hospedado no próprio GH Actions; `DbAlertSink` incapaz de alertar que o backend caiu), cuja solução
  comum é um dead-man's switch externo.
- **Enum de componentes do rateio** (`PRINCIPAL | MULTA | JUROS | ENCOMENDA | …`) e a **estratégia de
  distribuição** (greedy por saldo / vencimento / componente): forma esboçada em `RateioRecebimento`;
  enum e motor concretos na **Fase 3/4**.
- **Sub-estados de execução** (ex.: `executando`/`pending` no write-ahead ledger do `Recebimento`):
  detalhe de implementação da **Fase 5** (espelha `permuta_alocacao_execucao`) — não fixados na
  state-machine skeleton de propósito.
- **Scheduler (O4, herdado do SISPAG):** sem runtime de job/cron nativo (Express). Cadência do Módulo 1
  começa manual-trigger + cron probe (como a ingestão SISPAG); EventBridge é o alvo.

## SN — condição de pagamento / título (curadoria 2026-08-03, ADR-0025)

- **"Documento financeiro finalizável ⟺ título == valor do documento" como business-rule própria:** NÃO
  criada agora. É um **discriminador de etapa** do contrato Conexos (mesma doutrina de
  `conexos-nde-fiscal.md`: 200 ≠ sucesso), medido em **um** ERP. Promover a regra de negócio só se
  aparecer num 2º ERP/cliente — aí o invariante deixa de ser contrato de integração e vira domínio.
- **Divergência HML × produção no efeito do `PUT` que troca `pgtCod`:** em produção (SN 18345) as parcelas
  sobreviveram; no HML são destruídas. Hipótese (não confirmada): a condição de produção tem regra de
  parcelamento, a `101` do HML não. Revisitar se um cliente real cair no caso **bloqueante** — é o único
  cenário em que o `PUT` volta a rodar de verdade.
- **Regeneração das parcelas via tela `com032` ("Financeiro"):** HAR não capturado, caminho deliberadamente
  não implementado (ADR-0025). Só vale o esforço se o caso acima ocorrer em produção.
- **Máquina de estados do documento com299 no ERP** (gerado → com item → com condição → finalizado → com
  título): NÃO modelada — é ciclo de vida **do ERP**, não do nosso agregado (o nosso é `etapa` na trilha de
  execução). Revisitar só se um 2º ERP exibir o mesmo ciclo.

## Permutas — snapshot de estados (curadoria 2026-09-08, ADR-0043)

- **Aposentar o motivo `multiplas-invoices`:** **0 ocorrências** em 250 runs / 152.516 linhas de
  snapshot (2026-06-20 → 2026-09-08). Convive com `composto-nm`, que cobre o caso geral de N:M.
  **Não removido agora** — 0 ocorrências não é impossibilidade, e mudar a taxonomia de motivos ficou
  fora do escopo do ciclo. Revisitar no próximo `/retro-ontology`; promover a rejeição formal se um
  2º cliente também não o produzir.
- **Generalizar `fidelidade-snapshot-eleicao` para os demais pipelines com snapshot**
  (`recebimento_ingestao_run`, `pagamento_ingestao_run`): ambos persistem contagens de header ao
  lado de linhas de detalhe, portanto podem ter a **mesma classe de bug** (header × detalhe
  divergindo). **Não medido** — por isso a regra nasceu escopada a `PermutaCandidata`, com a
  generalização como nota, não como invariante transversal. Promover só com evidência medida nos
  outros dois.
- **ADRs 0034 e 0036 estão DUPLICADOS** em `ontology/decisions/` (dois arquivos com cada número:
  `0034-gcd-da-sn-resolvido-por-historico-do-processo.md` +
  `0034-maquina-de-estados-da-transacao-ganha-writers.md`; `0036-descricao-item-nde-no-documento.md`
  + `0036-homologacao-da-nde-medida-pelo-estado-gravado.md`). **Não corrigido neste ciclo** (renumerar quebra referências
  cruzadas já escritas). Registrado para uma limpeza deliberada: decidir se renumera com
  `superseded_by` ou se mantém e documenta a colisão.

## Permutas — integridade da baixa (curadoria 2026-09-08, ADR-0044)

- **`ExecucaoPermuta` como entidade própria: NÃO criada.** O ledger `permuta_alocacao_execucao` já
  tem chave versionada, 5 estados (`pending`/`reconciling`/`settled`/`parcial`/`error`), valor
  residual, identidade Conexos (ADR-0041) e trilha de auditoria — é o candidato natural. Segue
  modelado *dentro* de `business-rules/idempotencia-reconciliacao.md` + ação `reconciliarPermuta`,
  pela regra "entidade existente antes de entidade nova". **Promover se** ganhar um 6º estado, ou
  uma **ação própria** de resolução de resíduo (hoje a resolução é re-alocar, que é ação da
  `Permuta`, não do ledger).
- **`state-machines/execucao-permuta.md`: NÃO criado.** A máquina está desenhada em ASCII dentro da
  business-rule e um arquivo separado duplicaria a fonte — dois lugares para o mesmo diagrama é como
  o drift da chave de idempotência nasceu. Promover **junto** com o item acima, nunca antes.
- **Paridade `ExecucaoStatus` backend × frontend.** `PermutaExecucaoRepository.ts:5` e
  `src/frontend/lib/types.ts:255` são espelhos manuais. Cada estado novo custa duas edições e nada
  detecta a divergência. Não é questão de ontologia hoje; vira, se a divergência produzir um bug de
  domínio (badge errado sobre dinheiro já movido).
- **Borderô FINALIZADO com resíduo — seam aceito, não resolvido.** `status-permuta-bordero.md`
  devolve `finalizado` (ela responde sobre o *borderô*); o resíduo fica com o ledger + o reaper +
  o saldo do adto. Revisitar se aparecer um caso real em que o resíduo se perdeu na prática — aí a
  costura vira um 4º estado, não antes.

## SISPAG — data de débito (curadoria 2026-09-22, ADR-0049)

- **Feriados municipais/estaduais no calendário de dias úteis: NÃO modelados** (REJECT-PREMATURE). O
  conjunto nacional é regulatório e fica na regra I8 (`business-rules/data-debito-remessa-sispag.md`);
  o local depende da praça (filial/agência) e é **valor de configuração**, não ontologia. **Promover se**
  a Flavia confirmar pagamento recusado ou atrasado por feriado local (`_inbox/sispag-data-pagamento-gap.md`
  P1-1), ou se um 2º cliente trouxer o mesmo. Forma provável: lista por filial em configuração do tenant.
- **Entidade `CalendarioBancario`: NÃO criada.** É função pura sobre datas, sem identidade nem ciclo
  de vida. Revisitar só se o calendário ganhar dado mantido por pessoa (o item acima) **e** for consumido
  por uma 2ª frente (ex.: Frente IV, data de baixa).

## SISPAG — retenção da formação automática (ADR-0050, retirada em 2026-09-23)

- **Reter um título retirado de lote** para o cron não lotá-lo de novo: modelada, implementada e
  **retirada pelo usuário antes do merge** — o cron é espaçado e o título voltar a um lote
  automático depois não é problema. Revisitar só se a analista relatar título que ela tirou voltando
  a lote automático antes de ela decidir o que fazer com ele. O desenho completo (tabela própria com
  soft-delete, invariante na formação, badge e "Liberar") está no histórico da branch
  `fix/sispag-reter-titulo-lote` (commits até `6d1603d`).

## SISPAG — destino de TED e PIX (curadoria 2026-09-28, ADR-0054)

- **Quatro olhos no destino manual** ("quem digitou não finaliza"): **retirado** pelo usuário
  (REJECT-VOLATILE para a operação de hoje: duas analistas). **Revisitar** quando existir
  permissão por módulo (branch `feat/auth-permissoes-modulo`, ADR-0053): a forma provável é uma
  permissão específica para informar ou substituir destino, não uma regra de pessoa diferente.
- **(2026-10-05, ADR-0061) "Quatro olhos" no destino:** agora **implementado em outra forma** —
  dupla validação rígida (aprovador ≠ cadastrante) na `ExcecaoDestino`, permissão única
  `sispag:excecao`. A entrada acima é histórica.
- **Limite de valor por exceção** e **observação do retorno do banco sobre o destino:** adiados;
  REJECT-PREMATURE (sem decisão do usuário). Revisitar se a Columbia pedir.
- **Chaves PIX e-mail/telefone/aleatória em exceção:** fora de escopo (decisão 2026-10-05; só
  CPF/CNPJ = documento do favorecido). Voltam só com prova de titular via DICT (H1).
- **Campos, nome e regras da planilha de exceções da Columbia:** aguardam amostra (gap Q1). Não
  inventar colunas.
- **Atualizar o cadastro `cmn025` com o destino digitado** (opção A do plano): fora agora. Volta
  se o H3/H5 falhar (e o usuário escolher) ou se a analista pedir para não redigitar a cada lote.
- **Finalidade do TED como constante (H7):** não entra na ontologia até a sonda
  `jobs/probe-fin055-tpcontrib.ts` / HML provar o que `fbtCod`/`fbtDesDescr`/`fbtEspCodbanco`
  significam. REJECT-PREMATURE.
- **Precedência do digitado sobre o cadastro:** decisão da Columbia (cadastro desatualizado).
  Candidata a **configuração do cliente** se um 2º cliente quiser "manual só com cadastro vazio".

## SISPAG — sincronização do status do lote (curadoria 2026-09-29, ADR-0055)

- **Baixa manual × processamento nativo do `fin052`:** hoje não distinguíveis com segurança
  (`origemBaixa = FORA_DO_RETORNO` cobre os dois). Revisitar se o PSQ_018 voltar a ser legível para
  o robô e trouxer o canal da baixa. REJECT-PREMATURE.

## SISPAG — verificações TED/PIX e conferência (curadoria 2026-10-05, ADR-0063)

- **E-mail ao responsável pelo cadastro:** o usuário escolheu fila in-app (`sispag:cadastro`).
  REJECT-PREMATURE. Revisitar se a fila envelhecer sem que ninguém a abra.
- **Alerta de canal para perfil MEDIA:** só ALTA alerta hoje. Revisitar com a taxa de falso
  positivo medida em produção.
- **Sinal S3 da probe de duplicidade (NF × fatura, tipos diferentes, ≤45 dias):** coberto em parte
  pela FRACA (±15 dias). Não entra; revisitar se aparecer duplicata real fora da janela.
- **Cancelamento do documento duplicado escrito no Conexos:** fora (escrita de documento). Revisitar
  só com pedido explícito e prova de API segura.
- **Envio/retorno automático via Nexxera** (BPMN proposto): `/feature-new` próprio, não ontologia
  deste ciclo.
- **Universalidade de `PerfilCanalFornecedor`:** 1 cliente medido. Estrutura aceita, limiares em
  config; revisar com o 2º cliente (Francinei).


- **Titularidade da conta TED no `cmn025`/`ctcorr` (ADR-0065, B4, 2026-10-08) — REJECT-PREMATURE.**
  Se o cadastro expuser o documento do titular da conta, conta de terceiro (doc ≠ favorecido)
  poderia virar aviso forte na aprovação do `FavorecidoAutorizado`. Precisa de probe read-only no
  `ctcorr` antes de modelar. Revisitar no ciclo de implementação da ADR-0065.

## 2026-10-14 — sispag-sugestao-boleto-dda (ADR-0068)

- **Passo 2: bind do código de barras ao item do lote** — REJECT-PREMATURE. Precisa de credencial HML
  própria (HML recusa o usuário de produção) e prova de `finItemSispag/validacao/codigoBarras` ou
  `titulosPendentes/importar` + `FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO`. Estado
  `APLICADO_NO_ERP` por instância só entra com a ADR do passo 2.
- **Passo 3: automático para pares confirmados** — REJECT-PREMATURE. Exige segunda pessoa na primeira
  vez que o par vira automático, tolerância por par (Q2c), exclusão de chave genérica (I15i).
- **Layout de emissor para 104, 329, 422, 033** — REJECT-PREMATURE: 41 de 290 casos medidos
  (104=17, 329=14, 422=7, 033=3); revisitar se algum passar de ~10 % ou aparecer em outro cliente.
  Até lá, chave genérica, nunca elegível a automático.
- **Universalidade de `ConfirmacaoEmissorBoleto`/`DecisaoSugestaoBoleto` com o Francinei** — 1 cliente
  apenas (não bloqueante, como ADR-0065).
- **Defaults revisáveis (orquestrador)**: data de débito sem lote = vencimento; disputa por menor
  vencimento/menor docCod; vencido não confirmável no passo 1. Revisitar com uso real.

- **Guarda de código de barras entre lotes/contra boleto pago** (2026-10-14, ADR-0069): o mesmo boleto pode
  cair em dois lotes por vencimento (ADR-0064) ou ser reenviado após RETORNADO. Pré-requisito: persistir
  hash salgado (HMAC, segredo do EnvironmentProvider) do código por item enviado + migration + ADR próprio;
  alternativa sem persistência = ler `itsNumCodbar` dos demais lotes nativos (mais chamadas ao ERP).
  Revisitar se o caso aparecer em produção após I16.

- **Remoção automática de código repetido (ADR-0069 Emenda 1, 2026-10-14), follow-ups abertos:**
  (1) **P1-1(b)** preferir, no desempate de quem fica com o boleto, o título com decisão humana
  confirmada da ADR-0068 quando houver exatamente um no grupo (hoje: vencimento, `docCod`, `filCod`,
  `titCod`); (2) **P1-4** divergência herdada de I13j: itens retirados pelo sistema por
  `SEM_DADO_PAGAMENTO`/`FAVORECIDO_NAO_AUTORIZADO`/`DESTINO_ALTERADO` não têm marca de retenção e, se
  caírem no rascunho nativo, viram `indeterminado`; revisitar estendendo o reconhecimento de resíduo;
  (3) **P1-5** medir em HML o `DELETE` de `itsCodSeq` inexistente (404/200/500) antes do ship;
  (4) **P1-6** confirmar se o sinal "boleto do título retido mudou" é detectável na ingestão sem custo
  novo; (5) leitura incompleta (página única de 500) hoje avisa e segue: decidir se vira abort.
  A guarda **entre lotes vivos / contra boleto pago** (HMAC + migration) segue sem mudança de status.

## 2026-10-14 — sispag-passo2-vinculo-codbar (ADR-0071)

- **Passo 2 saiu da watchlist** (era REJECT-PREMATURE, ADR-0068): decidido e modelado como I17 (`planned`). O
  estado `APLICADO_NO_ERP` previsto aqui foi **rejeitado** (REJECT-WORKAROUND): fica derivado `aplicacao`.
- **Boleto ACIMA do título** (ex.: NELSON +R$ 0,01; 93 de 94) — REJECT-PREMATURE. O `finalizar` recusa pagamento
  > `fin064.totalAberto`; sem endpoint viável via SISPAG. Pergunta Columbia/Conexos: como registrar acréscimo
  no título.
- **Boleto ABAIXO do título** — REJECT-PREMATURE: não medido; muda a semântica (baixa parcial, saldo em aberto).
- **Vínculo de tier `ATENCAO`** — fora do passo 2 (I15d; escopo valor igual). Revisitar só com ADR próprio.
- **Universalidade de I17 com o Francinei** — 1 cliente apenas (não bloqueante, precedente Q-I do ADR-0068):
  o vínculo de código confirmado ao item vale para qualquer trading que pague boleto via Conexos sem DDA
  associado?
- **Desempate com decisão humana (P1-1(b) do ADR-0069)** — saiu do follow-up e entrou como I17h (`planned`).
- **Boleto vinculado reaparece "livre" no `fin124` depois de pago** (V6) — medir em HML; cobre-se por
  decisão `CONFIRMADA` + guarda I16 dentro do lote; entre lotes vivos segue a lacuna do ADR-0069.
- **Modalidade/forma de lançamento do item após o `PUT`** (V4: mesmo banco × outro banco; J para emissor ≠
  pagador) — provar em HML antes de `on` em PRD.

## 2026-10-14 — sispag-passo2-vinculo-codbar (implementação + medições HML)

- **V6 (boleto reaparece "livre" no `fin124` depois de pago)** — **não observável em HML** (sem retorno
  bancário, sem pool com o boleto sintético). Seguir em PRD com o 1 título controlado (V-PRD2).
- **V-PRD1 — permissão do robô para o `PUT fin015/finItemSispag`** — sonda somente leitura
  implementada, **não executada** (derruba a sessão do robô; só com o go do maintainer). Preferir a matriz de
  permissões do robô para o `fin015` pedida à Conexos/Columbia.
- **Janela residual de TOCTOU (V3)** — o ERP não tem lock otimista no item; a releitura imediatamente antes
  do `PUT` reduz mas não elimina. Revisitar se aparecer edição concorrente em PRD.
- **`shadow` usa a carteira local como "aberto"** — em HML o `fin064.totalAberto` difere do valor do grid em
  vários títulos (V8): o `shadow` é indicativo; só o `on` compara com o aberto ao vivo.

## SISPAG — desfecho por título e aviso "vence antes do título" (ADR-0072, 2026-10-15)

- **Confirmar `ATENCAO` sem âncora** — criaria par (credor, emissor) a partir de caso com Δ alto (ex.: +R$ 526),
  e o par vira âncora. Revisitar só com evidência de necessidade **e** regra para não criar par nessa confirmação.
- **Escolha direta entre candidatos ambíguos** — hoje se resolve rejeitando os outros. Revisitar se a rejeição
  se mostrar fricção medida.
- **Alargar a janela do passo 2** (valor igual, +6..+10 d; os 4 MULTILOG +8 d) — 1 credor; exige evidência
  de barra +8 d e retorno bancário.
- **Retirada/trava automática do lote do título com boleto vencido** — decisão de produto, passo 3.
- ~~**Vincular boleto acima/abaixo do título**~~ — **até R$ 0,05 resolvido pela ADR-0074** (I18, ajuste no
  título antes do vínculo). **Acima de R$ 0,05** continua aqui (ver seção ADR-0074).

## 2026-10-19 — sispag-ajuste-centavos (ADR-0074)

- **Boleto > R$ 0,05 do título (25 em PRD, todos > R$ 10, ~7 %)** — NELSON fil 4 (título fixo 930,48 × boleto
  993–1.348, valor previsto?), SAVINO DEL BENE fil 2 (+R$ 386–391 fixo), UPS (+13,7–15,1 %), RHENUS
  (+1,6–1,7 %, retenção?), JUSTLOG (+R$ 544), MSC (falso par). Outro problema; nada automático (I18m).
- **Correção do documento via `com298` (estornar/editar/finalizar)** — REJECT-PREMATURE até a Columbia dizer se
  prefere isso à renegociação (D7).
- **`fin062`/`fin063` em título a pagar** — recusado em HML (`docCod NOT_VALID`); hipóteses (a) só a receber,
  (c) só título não liberado. Pergunta aberta para a Columbia.
- **Conta contábil de juros/desconto da renegociação** — premissa: default do `fin070`. Confirmar com a Columbia.
- **Líquido de título com pagamento parcial** — `totalLiquido` desconta `totalPago`? Medir em PRD (G4); até lá a
  I18 exclui pagamento parcial e a I17b é fail-closed.
- **`valorLiquido` persistido na carteira** — depende de o list do `fin064` trazer `totalLiquido`.
- **Entidade genérica de renegociação de contas a pagar** — só se aparecer um segundo uso da `fin070`.
- **Universalidade da I18** — 1 cliente; revisar com o Francinei.
- **HML: renegociações 3 e 4** ficam como estão (536/2 e 540/2 em lotes finalizados).

## 2026-10-20 — sispag-boleto-agrupado (ADR-0077)

- **Primeiro `.RET` real do Itaú com item de borderô (V6)** — acompanhar, não é portão (P0-5).
- **Permissões do CLONEX em PRD** (`fin010` borderô/baixa, `borderosPendentes/list|importar`, leitura de itens
  `fin015`; V1) — conferência do maintainer, não portão.
- ~~**V2:** título com baixa em borderô em cadastro segue "em aberto" no `fin015`/carteira?~~ **Medido em
  2026-10-20:** em aberto no `fin064`, fora do grid do `fin015`; `importarTitulos` com a linha velha é aceito
  (I21k reforçada). Risco residual: baixa manual paralela por terceiro.
- ~~**V3:** ordem `DELETE` item → `excluirBaixa` → `excluirBordero` depois de importado.~~ **Medido em
  2026-10-20:** confirmada e imposta pelo ERP (`FIN_014.FIN_HAS_REMESSA_PGTO`).
- **V4:** grupo que cruza filial (INTERNACIONAL SERV. ADUANEIROS) — REJECT-PREMATURE até a sonda.
- ~~**V5:** código de "título próprio" (modalidade 6) para barra do banco da conta (341).~~ **Medido em
  2026-10-20:** `6` confirmado.
- **V7 (medição, decisão PI-9 já tomada):** depois de um J rejeitado, o borderô antigo reaparece em
  `borderosPendentes` do lote novo? A regra já diz: se reaparecer, reaproveita; se não, o grupo é retirado até a
  analista resolver. A medição diz qual dos dois caminhos é o comum, **e também** se o borderô segue ligado ao
  lote rejeitado e qual o valor de `vldHasRemessaPgto` nesse estado (emenda 2026-10-21: a flag reflete o import,
  não "foi ao banco"; não é premissa).
- **G6 / GT1 (Task 22):** frequência de sugestão ambígua (boleto que bate com dois conjuntos fechados; boletos
  idênticos não intercambiáveis). Hoje: nenhuma sugestão, composição manual (I21e/I21f).
- **Quase-grupos ±R$ 0,05 (P1-2)** — medição pontual, se desejada; absorver centavos numa baixa ou aplicar I18 a
  título de grupo é REJECT-PREMATURE.
- **Caso 2 (VIBE LOG, N boletos → 1 título)** — baixa parcial em dois borderôs? Fora do escopo (D2).
- **Boleto digitado fora do DDA (P1-3 b)** — REJECT-PREMATURE.
- **Subconjunto livre (subset-sum) na sugestão** — 922/2369 falsos (M1); só com outra evidência.
- **Universalidade do `GrupoBoleto`/I21** — 1 cliente; revisar com o Francinei (não bloqueante).
