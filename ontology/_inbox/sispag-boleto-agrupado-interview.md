## Interview Transcript — sispag-boleto-agrupado — 2026-10-20 (DRAFT, pré-preenchido)

**Mode:** tweak
**Entity affected:** `LotePagamento`/`ItemLote` (item que não é título), regras `boleto-exige-codigo-de-barras` (I16), `vinculo-codbar-item-sispag` (I17, ADR-0071), `sugestao-boleto-dda-sispag` (I15, ADR-0068/0072), `elegibilidade-titulo-lote` (I2), `nao-duplicacao-titulo-lote` (I3), `lote-uma-filial` (I4), I1, `sincronizacao-status-lote-sispag` (I11), `retomada-remessa-sispag`; integração Conexos `fin010` (borderô/baixa) + `fin015` (`borderosPendentes`).
**Status:** rascunho sem o Yuri; respostas marcadas com fonte. Só as perguntas da seção final estão abertas.
**Escopo:** caso 1 apenas — **1 boleto → N títulos do mesmo fornecedor**. Caso 2 (N boletos → 1 título, só VIBE LOG, 11 casos históricos) **fora** deste tweak.

Fontes: [evidence] = `_inbox/sispag-boleto-agrupado-hml-achados.md` (HML 19/10) e medição PRD 19/10; [repo] = ontologia/código nesta branch (base origin/main 5983531, ontologia v0.45.0, última ADR 0074, app 0.71.0); [maintainer] = decidido em 19/10; [inferido] = proposta minha.

---

### Q1. Comportamento atual (o que a ontologia e o código permitem hoje)

- **O item do lote é sempre um título.** `ItemLote` (`lote_pagamento_item`) tem `docCod`/`titCod` obrigatórios e a identidade `filCod:docCod:titCod` é a chave de I3; `valor`/`vencimento`/`credor` são snapshot **do título**. Não existe item sem título nem item que represente N títulos. [repo: `entities/lote-pagamento.md` §ItemLote; `nao-duplicacao-titulo-lote.md`]
- **A remessa só importa títulos** (`importarTitulos` no `fin015`); `borderosPendentes` nunca é lido nem importado pela nossa camada. [repo: `RemessaService`, `ConexosSispagWriteClient`]
- **O código de barras chega ao item por dois caminhos, ambos 1 título = 1 boleto de valor igual:**
  - associação DDA do ERP (`titVldReflexoDdaAssoc = 1` = boleto com **mesmo valor e vencimento** do título) — ADR-0040; sem ela e sem vínculo, `BoletoSemCodigoBarrasError` (409). [repo: `boleto-exige-codigo-de-barras.md`]
  - vínculo nosso (ADR-0071, I17): exige `DecisaoSugestaoBoleto CONFIRMADA` **por título** (I17a) e **valor do boleto == líquido aberto do título** em centavos (I17b). Modo `off` em produção. [repo: `vinculo-codbar-item-sispag.md`]
- **O que bloqueia o 1:N, por invariante:**
  | Invariante | Por que bloqueia o boleto agrupado |
  |---|---|
  | **I17a** | elegibilidade exige decisão confirmada **por título**; não há decisão "boleto ↔ grupo". |
  | **I17b** | valor do boleto (R$ 1.575,00) ≠ líquido de cada título (R$ 525,00) ⇒ `VALOR_DIFERENTE`, nunca vincula. |
  | **I17c** | Δdias medido título a título; não há regra para N títulos com vencimentos diferentes. |
  | **I15c/I15e/I15m** | a sugestão casa um boleto **livre** com **um** título; o boleto de R$ 1.575 não é candidato de nenhum dos 3 títulos (valor fora do limite) ⇒ desfecho `SEM_CANDIDATO`/`SO_FRACA`. |
  | **ADR-0040 (regra de ausência)** | os 3 títulos, importados individualmente como BOLETO, saem sem código ⇒ `BoletoSemCodigoBarrasError`. Hoje a analista tem que tirá-los do SISPAG e pagar à mão. |
  | **I16a** | se alguém pusesse a mesma barra nos 3 itens, a guarda acusa repetição e retira 2 (I16d) — correto: o boleto paga **uma** vez. |
  | **I18** | o ajuste de centavos é por título com decisão confirmada; não se aplica a grupo. |
  | **I3 / I2 / I4 / I11** | todos raciocinam **por título**; nenhum sabe que um item nativo carrega N títulos. |
- **No ERP o caminho já existe e foi provado em HML** (borderô 252, lote 48, `PG191081.REM`, retorno gar 7): borderô `fin010` em cadastro com uma baixa por título → `borderosPendentes/importar` cria **um** item sem `docCod/titCod`, com `borCod` → barra no item → `finalizarLote` → um J com pagamento = total do borderô → o retorno finaliza o borderô e baixa os N títulos. [evidence]
- **Peças já existentes na nossa camada:** `ConexosBaixaClient` (Permutas) já tem `criarBordero`, `getBordero`, `listBaixas`, `validarTituloBaixa`, `excluirBaixa`, `excluirBordero`, `cancelarBordero`, `finalizarBordero`; `ConexosSispagClient.listContasCorrentes` (`fin005`) já devolve o `gerNum` de cada conta pagadora; `ContaPagadoraResolver` escolhe a conta por filial. [repo]

### Q2. Comportamento desejado (delta)

Os 5 passos decididos [maintainer, 19/10], mapeados para a ontologia:

| # | Passo decidido | Conceito na ontologia | Novo / estendido |
|---|---|---|---|
| 1 | Agrupar títulos: mesmo fornecedor; soma == valor do boleto **ao centavo**; todos liberados | **Nova entidade `GrupoBoleto`** (boleto DDA + N títulos + estado + quem confirmou). Nova regra **`boleto-agrupado-sispag` (I19)**: mesmo `pesCod` (e mesmo par emissor, I15g), `Σ abertoLiquido == valorBoleto` em centavos (régua de I17b, somada), cada título elegível por **I2**. | novo |
| 2 | Borderô `fin010` com uma baixa por título, **em cadastro** (`borVldFinalizado 0`), nunca finalizado por nós | Nova ação `prepararBorderoDoGrupo` (escrita no ERP, ledger write-ahead como a remessa). Propriedades `borCod`, `gerNum`, marcador de correlação. Regra: **nunca** `finalizarBordero` sobre borderô de grupo. | novo |
| 3 | Importar o borderô como **um** item do lote (sem `docCod/titCod`, com `borCod`) e vincular a barra a esse item | `ItemLote` ganha **tipo** `TITULO \| BORDERO` (ou equivalente, ver P1-1). Import por `borderosPendentes/importar` com `itemy: 1`. Vínculo = mesma sequência I17e (`validacao → confirma → PUT → releitura`). | estendido |
| 4 | Finalizar o lote e gerar a remessa | L8 inalterada; guardas I16 e I17m rodam sobre o item de borderô. | estendido |
| 5 | O retorno finaliza o borderô e baixa cada título (nativo) | I11 deriva a situação do item a partir dos N títulos (`fin064`) + `borVldFinalizado` do borderô. Nada escrito por nós. | estendido |

**Emendas de invariantes existentes (propostas):**
- **I16a — mantém.** "Um código, um item" continua; o item pode ser de borderô. A mensagem (I16e) passa a citar `borCod` + os títulos do grupo. **I16d (retirada):** retirar um item de borderô retira o **grupo inteiro** (nunca parte) e dispara a limpeza do borderô (P0-4).
- **I17a — estende.** Para item `BORDERO`, a condição de elegibilidade é um `GrupoBoleto CONFIRMADO` (não uma `DecisaoSugestaoBoleto` por título); tier/par emissor `VIGENTE` como hoje.
- **I17b — estende.** Para item `BORDERO`: `valorBoleto == Σ abertoLiquido(títulos)` **==** `vlrTotalLiquido` do borderô relido, os três em centavos. Diferença de 1 centavo continua inelegível (relação com I18: P1-2).
- **I17c — estende.** Regra de janela do grupo (P0-2) e `vencimentoBoleto ≥ dataDebito` (I15h).
- **I17n — não se aplica** ao item de borderô: o valor do item vem do borderô (achado 6 do HML: o J paga o total do borderô).
- **I17m — mantém**, e é a rede natural: barra == pagamento do J.
- **ADR-0040 (ausência)** — o item `BORDERO` nunca segue sem código: sem vínculo executado, aborta como hoje.
- **I2** — revalidação na finalização vale **para cada título** do grupo (`liberado ∧ ¬pago`); um título que envelheceu derruba o grupo inteiro (nunca paga parte).
- **I3** — "um título não em dois lotes vivos" passa a valer também para títulos **dentro** de um grupo: título em grupo confirmado não entra avulso em lote nem em outro grupo.
- **I4** — todos os títulos do grupo e o borderô são da filial do lote (§4 de `sispag-fin052-retorno-provado-hml.md`: o parser do retorno exige item e lote na mesma filial). Grupo que cruza filial: P0-3.
- **I1** — continua: nenhuma escrita no ERP até `FINALIZADO`; o borderô nasce na etapa de remessa (P0-4).
- **I11** — item `BORDERO` é `PAGO` quando **os N** títulos estão pagos no `fin064` (e o borderô finalizado como corroboração, não como prova). Alguns pagos e outros não ⇒ `divergencia` + `Alerta`. Rejeição do J ⇒ `REJEITADO` do grupo inteiro.
- **I15** — título em `GrupoBoleto CONFIRMADO` sai da sugestão por título (novo desfecho, ex. `EM_GRUPO`) e o boleto do grupo fica **reservado** (I15e, disputa).
- **Retomada (ADR-0039)** — nova etapa `preparar_bordero` antes de `importar`, reconhecida ao vivo no ERP (borderô achado pelo marcador de correlação; baixas presentes; borderô já importado no rascunho).

### Q3. Bug de implementação ou mudança de regra?

- **Mudança de regra (additiva + emendas).** Nada está quebrado: o desenho vigente proíbe, de propósito, pagar boleto com valor diferente do título (I17b, I16a). O que muda é o **modelo**: passa a existir um item de pagamento que **não é um título** e um agregado (`GrupoBoleto`) que liga 1 boleto a N títulos. [inferido]
- **entity_changed: true** — nova entidade, nova regra (I19), novo tipo de item, novas ações, emendas em I2/I3/I4/I11/I15/I16/I17, ADR novo (0075, conferir na main antes: memória "versão colide entre sessões"). [inferido]

### Q4. Decisões já tomadas (registrar como DECIDIDO, não perguntar de novo)

| # | Decisão | Fonte |
|---|---|---|
| D1 | Boleto agrupado **dentro** do SISPAG; deixar fora não é aceitável. | maintainer 19/10 |
| D2 | Escopo = caso 1 (1 boleto → N títulos). Caso 2 (VIBE LOG) fora. | maintainer |
| D3 | Grupo: mesmo fornecedor; Σ títulos == valor do boleto **exato ao centavo**; todos liberados. | maintainer (enviado à Columbia 19/10) |
| D4 | Borderô `fin010` com uma baixa por título, **em cadastro**; **nós nunca finalizamos** o borderô. | maintainer |
| D5 | O borderô entra como **um** item do lote (sem título, com `borCod`); a barra do boleto vai nesse item. | maintainer |
| D6 | Finalizar o lote e gerar a remessa como hoje. | maintainer |
| D7 | O processamento do retorno (nativo do ERP) finaliza o borderô e baixa cada título. Sem livro paralelo nosso para a baixa. | maintainer + HML |
| H1 | `fin146` (Baixa Agrupada) **não serve**: baixa os títulos ao finalizar. | HML |
| H2 | O borderô só aparece pendente no lote se `gerNum` = conta financeira **da conta pagadora do lote** (HML fil 2: 38, não 37). O filtro não é a filial. | HML |
| H3 | Um borderô = um favorecido (derivado das baixas). | HML |
| H4 | `importar` exige `itemy: 1`; com `0` responde SUCESSO e não importa nada. | HML |
| H5 | Item do borderô nasce modalidade 4; barra de **outro** banco aceita 7; barra do **mesmo** banco da conta (341) exige "título próprio". | HML |
| H6 | O valor de pagamento do J sai do **borderô** (barra = pagamento). | HML |
| H7 | O parser do retorno trata `BOR_COD` (`PRC_BAIXA_RETORNO_PAGFOR`). | HML |
| H8 | J-52 no `.RET` sintético quebra o `processar`; limite do sintético, não do fluxo. | HML |
| H9 | `vldHasRemessaPgto` do borderô vira 1 quando a remessa é gerada (sinal de "foi ao banco"). | HML |
| H10 | `gerNum` de cada conta pagadora já é lido do `fin005` (`listContasCorrentes`); não precisa ser configuração fixa. | repo |
| M1 | Regra de grupo com ~0 ruído: **grupo FECHADO** = todos os títulos em aberto do fornecedor no mesmo vencimento (ou janela curta terminando no vencimento do boleto) somando exato. Subset-sum livre é ruído (922/2369 falsos). | medição PRD 19/10 |

### Q5. Restrições de produção conhecidas (não são perguntas; são portões)

- Robô CLONEX: **403 ACCESS_DENIED** lendo itens do `fin015` em PRD (15/10). A guarda I16 e o vínculo ADR-0071 dependem dessa leitura ⇒ o grupo também. [memória]
- CLONEX tem `fin010` borderô/baixa (Frente I), mas **`borderosPendentes/list` + `importar` no `fin015` não foram verificados** em PRD. [evidence]
- Vínculo ADR-0071 está `off` em PRD por desenvolvimento (não por decisão do cliente). [memória]
- Nexxera só planejada: o `.REM` sobe à mão no portal Itaú; o `.RET` real com item de borderô **nunca foi visto**. [memória/evidence]

### Verificações técnicas (para a TaskScoper/HML, não para o maintainer)

- **V1** Permissões CLONEX em PRD (sonda só-leitura `ger014`, sem derrubar sessão): `fin010` POST borderô/baixa, `fin015 borderosPendentes/list|importar`, leitura de itens `fin015`.
- **V2** Título com baixa em borderô **em cadastro** continua aparecendo como aberto na carteira e nos pendentes do `fin015`? O ERP recusa importar/baixar esse título por outro caminho? (risco de pagar duas vezes: avulso + grupo, ou baixa manual da analista).
- **V3** `excluirBaixa` + `excluirBordero` de borderô em cadastro **depois** de importado e retirado do rascunho nativo (`DELETE finItemSispag`) — ordem e efeito.
- **V4** Borderô com baixas de títulos de **duas filiais** (caso INTERNACIONAL): o `fin010` aceita? Que `filCod` o item herda? O retorno casa (§4)?
- **V5** Código de modalidade "título próprio" para barra Itaú (341) num item de borderô.
- **V6** Primeiro `.RET` **real** do Itaú com item de borderô (o J-52 real tem a chave?).
- **V7** Borderô de outra conta financeira ou com `vldHasRemessaPgto 1` reaparece em `borderosPendentes` depois de rejeição/cancelamento do lote?

---

### Perguntas abertas

**P0-1. Quem forma o grupo (e como resolver a ambiguidade PEDRONI)?**
- (a) *Recomendado:* o sistema **sugere** grupos FECHADOS (M1) a partir do boleto DDA livre e a analista **confirma** cada grupo (mesma postura de I15: confirmação humana com `sispag:executar`, trilha, anulável); na mesma tela a analista pode **compor à mão** (escolher boleto + títulos), e o sistema só valida D3. Para PEDRONI (vários boletos de mesmo valor, títulos de mesmo valor e vencimento): quando os títulos candidatos são **intercambiáveis** (mesmo valor, mesmo vencimento, mesmo fornecedor), o sistema propõe uma partição determinística (vencimento, `docCod`, `titCod`) e marca "intercambiável"; a analista confirma. A partição entre títulos iguais não muda nada financeiramente.
- (b) Só composição manual: a analista escolhe boleto e títulos; sem sugestão.
- (c) Automático sem confirmação para grupos sem ambiguidade (viola human-in-the-loop neste estágio; não recomendado).

**P0-2. Regra de janela de vencimento do grupo.**
- (a) Só mesmo vencimento (todos os títulos e o boleto no mesmo dia). Perde PEDRONI 333111 (títulos 25/10, boleto 26/10) e AT TRANSPORTES (+5 dias).
- (b) *Recomendado:* cada título com `0 ≤ vencimentoBoleto − vencimentoTitulo ≤ 5` dias (a mesma régua de I17c), mais `vencimentoBoleto ≥ dataDebito` (I15h), e **grupo fechado**: todos os títulos em aberto do fornecedor nessa janela entram na soma. Na composição manual, a analista pode ir até 10 dias com aviso explícito.
- (c) Janela de ≤ 10 dias terminando no vencimento do boleto, para sugestão e manual (a da medição; mais recall, mais candidatos para a analista conferir).

**P0-3. Grupo que cruza filial (INTERNACIONAL SERV. ADUANEIROS, fil 1 + fil 2).**
- (a) *Recomendado:* **bloquear** nesta entrega: grupo só com títulos da filial do lote (I4 + §4 do retorno). O grupo cruzado aparece como "não suportado, pagar à mão" com o motivo. Abrir a sonda V4 como follow-up.
- (b) Um borderô por filial: **impossível** com um boleto (um código = um item, I16a; um J por boleto). Listado só para descartar.
- (c) Um borderô na filial do lote contendo baixas de títulos da outra filial, se a V4 provar que o ERP aceita e o retorno casa. Depende de HML antes de decidir.

**P0-4. Quando o borderô nasce e quem o desfaz.**
- (a) *Recomendado:* nasce **na geração da remessa**, como etapa nova `preparar_bordero` antes do `importar`, com ledger write-ahead e marcador de correlação na observação (preserva I1: nada no ERP antes de `FINALIZADO`; o borderô em cadastro fica no ERP o menor tempo possível). Desfazer: **antes de `finalizarLote` nativo** (falha, retirada I16d, item recusado na importação, lote reaberto/cancelado), o **sistema** exclui baixas e borderô que ele mesmo criou (identificado pelo marcador, nunca outro). **Depois da remessa gerada** (`vldHasRemessaPgto 1`) o sistema **nunca** exclui nem cancela: rejeição do banco ou cancelamento do lote ⇒ `Alerta` + decisão da analista (reaproveitar o borderô num lote novo ou cancelar no ERP).
- (b) Nasce na **confirmação do grupo** (antes do lote): reserva os títulos no ERP cedo, mas deixa borderô em cadastro parado por dias, viola I1 e expõe a baixa manual paralela (V2).
- (c) Igual a (a), mas a limpeza é sempre manual (a analista exclui o borderô no ERP). Mais simples, deixa resíduo no `fin010`.

**P0-5. Rollout em produção diante das permissões do robô.**
- (a) *Recomendado:* entregar com modo por filial `off/shadow/on` (como I17k); `shadow` sugere e valida o grupo sem escrever; `on` em PRD só depois de V1 (permissões CLONEX), da leitura de itens `fin015` destravada (o mesmo bloqueio do ADR-0071) e de o primeiro `.RET` real (V6) ser acompanhado à mão.
- (b) Entregar só até a sugestão/confirmação (local) e manter a execução manual no ERP até destravar as permissões.
- (c) Esperar as permissões antes de qualquer código.

**P1-1. Como o lote local modela o item sem título.**
- (a) `ItemLote` ganha `tipo = TITULO | BORDERO`; `docCod/titCod` nulos para `BORDERO`; tabela filha com os N títulos (I3 estendido para ela).
- (b) *Recomendado:* os N títulos continuam como N `ItemLote` (I2, I3, I4, I11 seguem por título, sem mexer na UNIQUE), todos apontando para um `GrupoBoleto`; o mapeamento para o ERP é "um grupo = um item nativo". A tela mostra **uma linha** (boleto mascarado, total, credor, vencimento) expansível nos N títulos; mover/retirar age sobre o grupo inteiro.
- (c) Um `ItemLote` com o primeiro título como "âncora" e os demais só no grupo (não recomendado: esconde títulos de I2/I3).

**P1-2. Relação com o ajuste de centavos (ADR-0074) quando a soma difere em centavos.**
- (a) *Recomendado:* fora deste tweak. D3 vale literalmente: soma exata ou nada; diferença de centavos fica no fluxo manual. Registrar contagem de quase-grupos (±R$ 0,05) em `shadow` para decidir depois.
- (b) Absorver a diferença como juros/desconto **numa baixa do borderô** (o `fin010/baixas` tem esses campos; não exige `fin070` nem reaprovação). Exige HML e ADR própria.
- (c) Rodar a I18 num dos títulos (renegociação `fin070` + reaprovação `fin103`): mais pesado e mais lento que (b).

**P1-3. De onde vem o boleto.**
- (a) *Recomendado:* só do **DDA** (`fin124`/pool local), com par emissor `(pesCod, emissorChave)` `VIGENTE` (I15g) ou confirmado no mesmo ato; o código trafega só em memória (I17j). O `fin124` não tem beneficiário: o fornecedor só se prova pelo emissor.
- (b) Também código **digitado/colado** pela analista para boleto fora do DDA (abre validação de emissor e privacidade nova).

**P1-4. Lote manual × automático.**
- (a) *Recomendado:* o grupo confirmado é **uma unidade**: a formação automática (ADR-0018/0064) põe o grupo no lote do vencimento do boleto, nunca o divide; títulos de grupo confirmado não entram avulsos. Sem grupo confirmado, os títulos seguem como hoje (e caem na regra de ausência).
- (b) Grupo só entra por inclusão manual; a formação automática ignora títulos de grupo confirmado.

**P1-5. Situação do item agrupado depois do retorno.**
- (a) *Recomendado:* `PAGO` só com os N títulos pagos no `fin064`; parte paga ⇒ `divergencia` + `Alerta` (I11f), nunca "parcialmente pago"; rejeição do J ⇒ grupo `REJEITADO` inteiro e o grupo volta a "confirmado, sem lote" para a analista repor.
- (b) Situação por título dentro do grupo, com o lote podendo fechar `BAIXADO` se a maioria pagou (não recomendado: esconde parcial).

### Caso canônico de teste

1. **PEDRONI, fil 2 (PRD, vivo, só leitura/sintético em teste):** títulos **38883, 38884, 38885** (3 × R$ 525,00, venc. 21/10) → boleto nº **332841** R$ **1.575,00**, venc. 21/10. Grupo fechado, Σ == boleto ⇒ sugerido, confirmado, borderô com 3 baixas, **um** item, **um** J de R$ 1.575,00. Barra sintética em teste (I17j).
2. **PEDRONI janela:** **39196** (R$ 1.412,00) + **39211** (R$ 629,00), venc. 25/10 → boleto **333111** R$ **2.041,00**, venc. **26/10** ⇒ entra com P0-2(b)/(c), fica fora com P0-2(a).
3. **HML AR SOLUÇÕES (`pesCod 121`, fil 2, banco 4):** títulos **552/1 + 558/1** (2 × R$ 1.173,47 = **R$ 2.346,94**) → borderô **252** (`gerNum 38`) → lote **flp 48** → item seq 1 com `borCod 252` → `PG191081.REM` com um J (título = pagamento = 2.346,94) → retorno gar 7 `00` ⇒ ambos `vldPago 1`, borderô `borVldFinalizado 1`.
4. **Negativos:** Σ ± R$ 0,01 ⇒ sem grupo (P1-2); dois fornecedores ⇒ recusado (H3); título de outra filial ⇒ recusado (P0-3); um título não liberado ou já pago na finalização ⇒ grupo inteiro fora (I2); título já em outro lote vivo ⇒ recusado (I3); `gerNum` diferente da conta do lote ⇒ borderô não aparece pendente ⇒ erro nomeado antes do `finalizarLote` (H2); `importar` com `itemy 0` ⇒ tratado como falha, não sucesso (H4).

### Resumo

Permitir que um boleto DDA pague N títulos do mesmo fornecedor dentro do SISPAG, usando o caminho nativo provado em HML: um borderô `fin010` em cadastro com uma baixa por título vira **um** item do lote, recebe a barra do boleto, e o retorno do banco finaliza o borderô e baixa os títulos. Do nosso lado entram uma entidade `GrupoBoleto` (1 boleto ↔ N títulos, confirmado por pessoa), uma regra nova (I19) e emendas em I2/I3/I4/I11/I15/I16/I17 para que um item de lote possa representar um borderô. O sistema nunca finaliza o borderô e nunca paga parte de um grupo.

### entity_changed: true
### Ontology diff needed: yes
Nova entidade `GrupoBoleto`; nova regra `boleto-agrupado-sispag` (I19); tipo/ligação de `ItemLote` ao grupo; ações `confirmarGrupoBoleto`, `anularGrupoBoleto`, `prepararBorderoDoGrupo`, `limparBorderoDoGrupo`; emendas I2, I3, I4, I11, I15 (novo desfecho e reserva), I16d/I16e, I17a/b/c (I17n não se aplica); etapa nova na retomada; seção `fin010` borderô-para-SISPAG e `fin015 borderosPendentes` em `integrations/conexos.md`; ADR nova (0075, conferir na main); bump da ontologia (conferir versão na main).
### Reason: rule change (novo agregado + emendas; não é implementation bug)
### Hand off: OntologyCurator (depois das respostas P0)

---

## Respostas do maintainer (2026-10-20)

| # | Decisão |
|---|---|
| **P0-1** | **(a)** O sistema **sugere** grupos fechados e a analista **confirma** cada um; ela também pode **compor à mão** (o sistema só valida as regras). Valores iguais (PEDRONI) ⇒ partição fixa marcada "intercambiável", confirmada. |
| **P0-2** | **(a) com exceção manual:** a **sugestão** só usa **mesmo vencimento** (todos os títulos do fornecedor com vencimento = vencimento do boleto). A **composição manual** aceita títulos até **10 dias** antes do vencimento do boleto (com aviso). |
| **P0-3** | **(a)** Grupo que cruza filial **bloqueado** nesta entrega ("não suportado, pagar à mão"); sonda V4 vira follow-up. |
| **P0-4** | **(a)** Borderô criado na **geração da remessa** (write-ahead, antes do `importar`); antes do lote finalizado no ERP o sistema apaga só o que criou (tag de correlação); com remessa gerada (`vldHasRemessaPgto = 1`) nunca apaga/cancela sozinho — `Alerta` e decisão da analista. |
| **P0-5** | **Sem flag / sem modos off/shadow/on.** A permissão do robô CLONEX (fin010 borderô + `borderosPendentes/importar`, leitura de itens do fin015) será **conferida pelo maintainer**, mas **não é bloqueio** da entrega. O primeiro `.RET` real fica em watchlist, não em gate. |
| **P1-1** | **(b)** N `ItemLote`, um por título, cada um ligado ao `GrupoBoleto`; um grupo = um item nativo; UI mostra uma linha expansível; mover/retirar agem no grupo inteiro. |
| **P1-2** | **(a)** Fora de escopo: soma exata ou não há grupo. (Sem modo shadow: a contagem dos quase-grupos ±R$ 0,05 vira medição pontual, se desejada.) |
| **P1-3** | **(a)** Só boleto do **DDA**, com par emissor `VIGENTE` ou confirmado no mesmo ato. |
| **P1-4** | **(a)** Grupo confirmado é **uma unidade** na formação automática; nunca dividido; títulos dele não entram avulsos. |
| **P1-5** | **(a)** `PAGO` só com os N títulos pagos; parcial ⇒ divergência + `Alerta`; J rejeitado ⇒ grupo inteiro `REJEITADO`, volta a "confirmado, sem lote". |

**Numeração conferida na `origin/main` (5983531, 2026-10-20):** ADR **0075**, migration **0089**, ontologia **0.46.0**, app **0.72.0** (feat). Reconferir antes do ship.
