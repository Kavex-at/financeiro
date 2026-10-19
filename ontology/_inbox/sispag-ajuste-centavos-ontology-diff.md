# Ontology Diff Proposal — sispag-ajuste-centavos (2026-10-19)

> **Status: PROPOSTA — nada foi escrito fora deste arquivo.** Aguarda `approve` / `edit` / `partial` /
> `reject` do maintainer. `/feature-tweak`, `entity_changed = true` (rule change + bug de implementação).
>
> **Insumos:** `_inbox/sispag-ajuste-centavos-interview.md` (incl. "Respostas do maintainer (2026-10-19)",
> autoritativas) e `_inbox/sispag-centavos-hml-achados.md`.
>
> **Numeração (conferida contra `origin/main` em 2026-10-19):** ADR **0073** · ontologia 0.43.0 → **0.44.0** ·
> app v0.69.0 (não muda aqui) · última migration `0086_sispag_vinculo_codigo_barras.sql` ⇒ **próxima livre: 0087**.
> IDs novos: **I17m**, **I17n** (emendas à regra I17) e **I18a–I18n** (regra nova). Nenhum `I18*`, `I17m` ou
> `I17n` existe hoje na ontologia (grep limpo). Reconferir tudo antes do ship (memória
> "versão colide entre sessões paralelas").

---

## 0. Pontos que o maintainer precisa decidir ANTES do approve

| # | Decisão | Recomendação do curador | Por quê importa |
|---|---|---|---|
| **M1** | **Como a decisão "segue" o título novo sem violar I15g ("o sistema nunca confirma") e os CHECKs da 0084** (`decidido_por <> 'sistema'`; `anulada_por NOT IN ('sistema','unknown')`). | **(A) Transferência auditada:** a decisão antiga vai a `ANULADA` com `tipoAnulacao = TITULO_RENEGOCIADO` e `anuladaPor = 'sistema'` (CHECK relaxado **só** para esse tipo); nasce uma `CONFIRMADA` no título novo com `decididoPor`/`decididoEm` **copiados da original** (a pessoa que confirmou continua sendo a autora), `origemDecisaoId` obrigatório e `transferidaPor = 'sistema'`. I15g ganha a frase "transferir não é confirmar". | Alternativa **(C)**: não tocar a decisão e resolver "título atual" pela linhagem do ledger em todo consumidor (sugestão, órfã, I16d.1, I17a). Evita mexer no CHECK, mas espalha a linhagem por 4+ leitores e a I15l(3) marcaria a decisão como órfã. Rejeito (C), mas é escolha legítima. |
| **M2** | **Onde roda a varredura de retomada**, dado que a identidade tem de ser a sessão do servidor e **nunca** cron (crons rodam como CLONEX). | No **processo do servidor**: (i) logo após o commit do `confirmar`; (ii) no botão "tentar de novo"; (iii) ao abrir a tela do SISPAG (precedente ADR-0060/0066). **Nunca** em job/cron e **nunca** no `bootstrapAppContainer` (gotcha do CLAUDE.md: ~58 jobs). | Se a varredura virar cron, cai em CLONEX ⇒ 403 em `fin070`/`fin103`. |
| **M3** | **Fixar a identidade esperada?** | Sim, por configuração: o modo `on` exige que a sonda só-leitura de permissão (`fin070`/`fin103`) tenha passado **para o login configurado** (`CONEXOS_USERNAME`); se o login do ambiente mudar, o ajuste degrada para `shadow` até nova sonda. O valor do login é **config**, não ontologia. | Evita que uma troca de `.env` no Render (ex.: para CLONEX) transforme o `on` em uma rajada de 403 ou em escrita sob identidade não sondada. |
| **M4** | **Título com pagamento parcial** entra no ajuste? | **Não** (adição conservadora do curador, I18a(6)): `totalPago = 0` é pré-condição. A régua de I17b continua cobrindo o vínculo de títulos parcialmente pagos. | A semântica de `totalLiquido` com pagamento parcial não foi medida (P1-4); renegociar sobre aberto incerto é pior que não renegociar. |
| **M5** | **Lote local em `FINALIZADO` enquanto o ajuste está em curso.** | Nova pré-condição em `finalizarLote` (L3): lote com item cujo título tem ajuste não terminal ⇒ `TitleAdjustmentInProgressError` (409). Sem isso, a analista pode finalizar o lote entre o `POST fin070` e o rechaveamento, e o lote congela um `titCod` que deixa de existir. | Fecha a janela de corrida que a D3 ("lote finalizado ⇒ não renegocia") não cobre sozinha. |
| **M6** | **`ItemLote.valor` na troca de título (lote `RASCUNHO`).** | Atualizar o snapshot para o **líquido do título novo** (= valor do boleto), com evento na trilha do lote e `versao + 1`. | O total do lote passa a mostrar o que o banco vai pagar. Manter o valor antigo deixaria o lote 1 centavo abaixo do `.REM`. |
| **M7** | **`shadow` do ajuste faz leituras ao vivo no ERP.** | Sim: `shadow` = toda a I18a recalculada **ao vivo** (`fin064`, pendentes do `fin015`), **zero escrita**. Diverge do `shadow` da I17k ("zero chamada nova ao ERP") de propósito: Δ e aprovação só são confiáveis ao vivo (V8). | Se o maintainer preferir "zero chamada" também aqui, o `shadow` vira só local e fica indicativo, como o da I17k. |
| **M8** | **Guarda I17m bloqueia de imediato ou mede antes?** | Bloqueia (fail-closed), **mas** com medição prévia só-leitura sobre os `.REM` de PRD dos últimos 30 dias (quantos J com barra > 0 têm barra ≠ pagamento). Se a medição achar casos legítimos, a guarda nasce como `warn` e vira bloqueio por ADR curta. | A guarda vale para **todo** J, inclusive DDA do ERP; um falso positivo travaria a remessa diária. |
| **M9** | **Cancelamento de renegociação NÃO finalizada nunca foi provado em HML** (só se criou e finalizou). | Portão de rollout obrigatório (G3): provar `PUT fin070/cancelar/{frnCod}` (ou o `DELETE`) em HML e o reconhecimento por `obs` (marcador) antes de `on`. Sem isso, a compensação (I18h) é hipótese. | Toda a matriz de falhas antes do `finalizar` depende disso. |

> **Inconsistência pré-existente (não desta feature):** `_coverage.json.by_business_rule.vinculo-codbar-item-sispag.status`
> está `planned`, mas a regra, o `_index.json` e o código dizem `implemented` (ADR-0071 shipou com modo `off`).
> Proponho corrigir para `implemented` no mesmo commit (ver §7). Diga `edit` se preferir deixar para o `/retro-ontology`.

---

## 1. Candidate analysis

| # | Candidato | Filtros (A universal · B onto/config · C permanente · D já modelado? · E ação/estado) | Decisão |
|---|---|---|---|
| 1 | Regra "boleto com Δ ≤ limite, emissor confirmado e número igual ⇒ o título a pagar é renegociado para o valor do boleto (juros/desconto) e reaprovado" | A: 1 cliente; o conceito (DDA traz o boleto com centavos de arredondamento/tarifa diferentes do título lançado) é universal em contas a pagar no Brasil; Francinei não consultado · B: estrutura = onto; limite, filiais, modo = config/constante · C: estável (limitação do ERP + mecânica DDA) · D: novo · E: regra + ação | **ACCEPT** (`ajuste-centavos-titulo-sispag`, I18a–n) — universalidade a revisar com o Francinei, **não bloqueante** (precedente Q-I/ADR-0068) |
| 2 | Ação `ajustarCentavosTitulo` (fin070 → fin103 → rechaveamento) | A:Y(estrutura) · B:onto · C:Y · D:nova · E:ação | **ACCEPT** (1 ação; retomada e "tentar de novo" são modos da mesma ação, não ação nova — "action before workflow") |
| 3 | Entidade nova `RenegociacaoTitulo` / `AjusteCentavos` | D: o registro é um **ledger de execução** write-ahead (padrão `remessa_execucao`, I-2), e a parte visível ao humano já vive na trilha da decisão | **REJECT-DUPLICATE** (ledger + trilha). Uma entidade genérica de renegociação de contas a pagar é **REJECT-PREMATURE** (só usamos 1 forma estreita; watchlist) |
| 4 | `titCodOrigem` / `frnCod` como propriedades de `TituloAPagar` | D/B: o UPSERT da ingestão apaga coluna que não vem do ERP (mesmo motivo de `BloqueioDuplicidade` não ser coluna) | **REJECT-WORKAROUND** → linhagem no ledger |
| 5 | `valorLiquido`/juros/desconto persistidos na carteira | A:Y · C:Y · mas não sabemos se o `fin064` **list** traz `totalLiquido` (hoje só o detalhe por título) | **REJECT-PREMATURE** (watchlist). A UI mostra o líquido dos títulos ajustados a partir do ledger |
| 6 | I17b passa a comparar com o **líquido aberto** (`totalLiquido − totalPago`, conferido com `totalAberto + juros − desconto`) | A:Y (é a semântica do ERP para "quanto o banco vai pagar") · C:Y · D: emenda | **ACCEPT** (emenda I17b) |
| 7 | I17n — import do item pelo líquido, não por `titMnyValor` | bug latente provado em código (`RemessaService.ts:1378,1400-1402`) × HML (importar traz 53,54) | **ACCEPT** (invariante, porque é a regra do valor que vai ao ERP; a correção do código é do TaskScoper) |
| 8 | I17m — guarda do `.REM`: barra (> 0) == pagamento do J | A:Y (CNAB 240 J) · C:Y · D: estende I16b(2) | **ACCEPT** |
| 9 | Nota em I15 ("aguardando ajuste" para pares ≤ R$ 0,05 confirmados) | E: é **estado derivado** de exibição, não estado novo da decisão | **ACCEPT como derivado** `ajuste` em `DecisaoSugestaoBoleto` (mesmo padrão do derivado `aplicacao` da ADR-0071) |
| 10 | Novo estado persistido `AJUSTADA` / `AGUARDANDO_AJUSTE` na decisão | E: confunde execução com decisão (precedente `APLICADO_NO_ERP`, rejeitado na ADR-0071) | **REJECT-WORKAROUND** |
| 11 | Constante nova para o limite R$ 0,05 | D: `LIMITE_VALOR_MESMO_DIA` (I15c) | **REJECT-DUPLICATE** (reaproveitar) |
| 12 | Janela "≤ 5 dias" para o ajuste (citada nos achados) | A: não; os 118/118 NELSON são mesmo dia; I15c já limita ≤ R$ 0,05 ao mesmo dia | **REJECT** (P1-2 aceito: mesmo vencimento) |
| 13 | Corrigir o documento no `com298` (estornar/editar/finalizar) | A:? · pendente com a Columbia (D7) · não testado | **REJECT-PREMATURE** (ADR-0073, watchlist) |
| 14 | Desconto nativo `fin062`/`fin063` | recusado em HML (`docCod NOT_VALID`), não cobre acréscimo (125 de 126 casos) | **REJECT-WORKAROUND** |
| 15 | Declarar juros/desconto/valor no item (`itsMnyRecbrac`, `titMnyJuros`, `titMnyDesconto`, `itsMnyValor`, `titMnyLiquido`) | HML A2/B0/B1/B2 + #7/#9/#10: o J paga o título | **REJECT-WORKAROUND** |
| 16 | `PUT fin026` para valor | aceito e ignorado (HML #9) | **REJECT-WORKAROUND** |
| 17 | Alargar a I17b para aceitar Δ ≤ R$ 0,05 sem mexer no título | o J sai com pagamento = título ≠ barra (B0/B1/B2) | **REJECT-WORKAROUND** |
| 18 | Renegociar dentro da remessa (`vincular_codbar`) ou dentro da transação do `confirmar` | acopla 5–7 escritas no ERP a outra transação; título já importado | **REJECT-WORKAROUND** |
| 19 | Escrever com a sessão da analista vinculada ou por cron (CLONEX) | contraria D4 / resposta P0-1; CLONEX sem `fin070`/`fin103` | **REJECT** (identidade = sessão do servidor) |
| 20 | Ajuste automático acima de R$ 0,05 (os 25 > R$ 10) | outro problema (valor previsto, retenção, falso par MSC) | **REJECT-PREMATURE** (segue no watchlist) |
| 21 | Valores operacionais: filiais/modo, `fbaCod 3`, regra 19 "ADIANTAMENTOS_OPERAÇÕES", login do servidor, conta contábil | instâncias | **REJECT-CONFIG** (config ou lido ao vivo; nunca na ontologia) |
| 22 | `UPDATE` de `tit_cod` na decisão | imutabilidade da decisão (só `CONFIRMADA → ANULADA` por `versao`) | **REJECT-WORKAROUND** (ver M1) |

**NEEDS-FRANCINEI (não bloqueante):** universalidade de I18 (renegociar o título para o valor do boleto em
diferenças de centavos é prática de outras tradings, ou é peculiaridade do NELSON/Columbia?). Entra no
watchlist como os demais itens de 1 cliente do SISPAG.

---

## 2. Arquivos alterados (ACCEPT)

**Novos**
1. `ontology/business-rules/ajuste-centavos-titulo-sispag.md` (I18a–n)
2. `ontology/actions/sispag/ajustar-centavos-titulo.md` (`ajustarCentavosTitulo`)
3. `ontology/decisions/0073-sispag-ajuste-centavos-por-renegociacao-fin070.md`

**Emendas**
4. `ontology/business-rules/vinculo-codbar-item-sispag.md` — I17b (régua líquida), nota em I17d(6), **+I17m**, **+I17n**, erros, "Fora do escopo"
5. `ontology/business-rules/sugestao-boleto-dda-sispag.md` — I15b (exceção), nota em I15c, I15g (transferir ≠ confirmar), trilha
6. `ontology/business-rules/boleto-exige-codigo-de-barras.md` — I16b(2) estendida pela I17m
7. `ontology/business-rules/identidade-execucao-conexos.md` — sete ledgers
8. `ontology/entities/decisao-sugestao-boleto.md` — `origemDecisaoId`, `tipoAnulacao`, `transferidaPor`; transição de transferência; derivado `ajuste`
9. `ontology/entities/titulo-a-pagar.md` — I1 deixa de ser absoluta; relação com o ajuste
10. `ontology/entities/lote-pagamento.md` — troca de título do item em `RASCUNHO`; I1
11. `ontology/actions/sispag/finalizar-lote.md` — pré-condição `TitleAdjustmentInProgressError`
12. `ontology/actions/sispag/confirmar-sugestao-boleto.md` — dispara I18 após o commit
13. `ontology/integrations/conexos.md` — superfície de escrita `fin070`/`fin103`/`fin106`
14. `ontology/_inbox/_watchlist.md` — resolve "acima/abaixo" ≤ R$ 0,05; novos itens
15. `ontology/_index.json` / `ontology/_coverage.json` — deltas (§7)

**Docs (Parte 9):** `docs/ontologia.md` não existe neste repo; `docs-contexto/03_ontologia_financeiro.md` e
`README.md` não citam I17/ADR-0071 (grep limpo) ⇒ sem diff. Proponho **uma linha** em `CLAUDE.md` › "Gotchas
conhecidos" (§8), opcional.

---

## 3. Arquivos NOVOS (conteúdo completo)

### 3.1 `ontology/business-rules/ajuste-centavos-titulo-sispag.md`

````markdown
---
name: ajuste-centavos-titulo-sispag
type: business-rule
entity: TituloAPagar
invariant: I18
ontology_version: "0.44.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/AjusteCentavosTituloService.ts
  - src/backend/domain/service/sispag/BoletoSuggestionService.ts
  - src/backend/domain/service/sispag/RegraSugestaoBoleto.ts
  - src/backend/domain/client/ConexosSispagWriteClient.ts
  - src/backend/domain/client/ConexosSessionResolver.ts
  - src/backend/domain/repository/sispag/SugestaoBoletoRepository.ts
  - src/backend/domain/repository/sispag/TituloAPagarRepository.ts
  - src/backend/domain/repository/sispag/LotePagamentoRepository.ts
  - src/backend/migrations/0087_sispag_ajuste_centavos.sql
last_review: 2026-10-19
has_canonical_test: false
universality_evidence:
  - "HML 2026-10-19 (_inbox/sispag-centavos-hml-achados.md): fin070 frnVldTpop 1/2 renegocia o título para o valor do boleto (536/1 -> 536/2 líquido 53,54; 540/1 -> 540/2 líquido 178,77); fin103 APROVAR libera; vínculo e .REM ponta a ponta (J paga o valor da barra)"
  - "PRD 2026-10-19 (só leitura): 109 títulos BOLETO com número igual e |Δ| <= R$ 0,05 (todos NELSON +0,01), 0 entre R$ 0,06 e R$ 10, 25 > R$ 10 (outro problema)"
  - "1 cliente apenas (Columbia): universalidade a revisar com o Francinei (não bloqueante, watchlist; precedente Q-I do ADR-0068). Mecânica DDA/CNAB 240 é nacional e estável"
---

# Business Rule: ajuste de centavos do título por renegociação (I18)

> **Origem:** ADR-0073 (2026-10-19). **O valor do boleto é a verdade** (D1). Quando uma pessoa já confirmou
> que o boleto é deste título (I15, `CONFIRMADA`) e a diferença é de centavos (|Δ| ≤ `LIMITE_VALOR_MESMO_DIA`,
> R$ 0,05), a plataforma **renegocia o título no `fin070`** para que o seu líquido fique igual ao valor do
> boleto (juros quando o boleto está acima, desconto quando está abaixo), **libera no `fin103` só o bloqueio
> que a própria renegociação criou** e faz decisão, carteira e item seguirem o **novo `titCod`**. A partir daí
> o vínculo do código (I17, régua líquida) acha o título com valor igual. **Status: planned** (modo `off` por
> default; escrita em PRD só com go explícito do maintainer, depois dos portões G1–G5).

## Por que existe

O J do `.REM` paga o **valor do título**, não o do item (HML A2/B0/B1/B2). Nenhum campo do item, nem o
`PUT fin026`, nem o `fin062`, muda o que o banco recebe. Sem ajustar o título, um par confirmado com +R$ 0,01
**nunca é pago** pela plataforma (109 NELSON em PRD). A renegociação é o único caminho nativo provado que muda
o valor do título.

## Invariantes

| # | Invariante |
|---|---|
| **I18a** | **Elegibilidade (todas, recalculadas AO VIVO no início e de novo antes do `finalizar`).** (1) Existe `DecisaoSugestaoBoleto` `CONFIRMADA`, não órfã, para o título, com par `ConfirmacaoEmissorBoleto` `VIGENTE` (emissor confirmado — número igual **sozinho não basta**, caso MSC nº 12294). (2) Número do documento do título == número do boleto (dígitos estritos, I15f). (3) `0 < \|Δ\| ≤ LIMITE_VALOR_MESMO_DIA` (R$ 0,05; **a mesma constante da I15c**, sem constante nova), com `Δ = valorBoleto − abertoLiquido` (I17b), `valorBoleto` **decodificado por nós** da barra. (4) **Mesmo vencimento** (Δdias = 0, data civil UTC meia-noite). (5) Título original **aprovado** no ERP (`fin064.vldLib = 1`) e `aprovado` na carteira. (6) Não pago, **sem pagamento parcial** (`totalPago = 0`) e **sem juros/desconto prévios** (`titMnyJuros = titMnyDesconto = 0`). (7) Título **não** renegociado antes por nós (sem ledger `concluido` em que ele seja `titCodNovo`): no máximo um ajuste por linhagem. (8) Título fora de lote local `FINALIZADO`/`REMESSA_GERADA`/`RETORNADO` e **fora de qualquer rascunho nativo** do `fin015` (lido ao vivo). (9) Modo da filial = `on` (I18l) e kill-switches ligados. Qualquer item falso ⇒ **nenhuma escrita**; ledger `recusado` com motivo; aviso visível (I18m). |
| **I18b** | **Sentido e valor.** `Δ > 0` (boleto acima) ⇒ `frnVldTpop = 1` (acréscimo; o ERP lança juros); `Δ < 0` (abaixo) ⇒ `frnVldTpop = 2` (desconto). `frnMnyValor = \|Δ\|`. `frnVldTpop = 0` nunca leva valor (o ERP recusa, `TIPO_OP_NAO_PERMITE_VALOR`). |
| **I18c** | **Sequência no ERP (uma renegociação por título).** `POST fin070` (`pesCod = fin064.pesCodFor`, `frnVldTipo 2`, `frnVldTpop 0`, `frnDtaReneg` = hoje BRT, obs MAIÚSCULA com o **marcador de correlação** do ledger) → `POST fin070/titulos` (o título original) → `POST fin070/titulos/composicao` com **o mesmo valor aberto** do original, **o vencimento original**, `frgEspNumero`, `pgtCod`, `dupEspOrdem` copiados do original → `PUT fin070` com `frnMnyValor = \|Δ\|` e `frnVldTpop` da I18b → **conferência**: `mnyValorTotal` do `fin070` == `valorBoleto` (senão não finaliza, I18h) → `PUT fin070/finalizar/{frnCod}`. O ERP consome o título original e cria um título novo no mesmo `docCod`. Juros/desconto **nunca** vão na composição nem no item (o ERP os ignora ali). |
| **I18d** | **Pós-condição do título novo (conferida ao vivo no `fin064`).** Mesmo `docCod`, `titCod` novo, **vencimento = o original**, `abertoLiquido` (I17b) == `valorBoleto`, `titMnyJuros` ou `titMnyDesconto` == \|Δ\|, título original ausente. O título novo é identificado por: mesmo `docCod`, `titCod` que não existia antes, vencimento e líquido acima. Zero ou mais de um candidato ⇒ `indeterminado` (alerta, ação humana), nunca palpite. |
| **I18e** | **Reaprovação estreita (D4).** Só se o título **original** estava aprovado (I18a(5)). Libera **apenas** bloqueio do `fin103` que: (1) é do título novo; (2) nasceu no instante do nosso `finalizar` (não existia antes dele); (3) tem `titMnyTotal == valorBoleto`; (4) tem **exatamente um** comando ativo "APROVAR" em `fin106/finBloqCmd/list/{fblCod}`. Chamada: `POST fin103/validaSelecionado` → `POST fin103/aplicarComando { items: [<linha lida do fin103/list> + fbaCod] }` → releitura (`ftbVldStatus` liberado e `fin064.vldLib = 1`). Título novo **sem** bloqueio ⇒ nada a liberar. Bloqueio de **outra** natureza, outro valor, comando ausente/ambíguo, ou bloqueio que permanece após o nosso ⇒ **não libera** e o ajuste termina `aguardando_aprovacao_manual` com aviso (fluxo normal do Conexos, por outra pessoa). A regra de bloqueio, o `fblCod` e o `fbaCod` são **lidos ao vivo**, nunca configurados nem fixados. |
| **I18f** | **Identidade Conexos = sessão do servidor (resposta P0-1).** Toda escrita da I18 usa **explicitamente** a sessão da credencial do ambiente do servidor (`CONEXOS_USERNAME` via `EnvironmentProvider`), resolvida **fora** do caminho por-request do `ConexosSessionResolver`. **Nunca** a sessão da analista vinculada; **nunca** em processo de job/cron (crons rodam como CLONEX, sem `fin070`/`fin103`). Execução fora do processo do servidor, credencial ausente ou login não sondado (I18n, G1) ⇒ o modo efetivo é `shadow`, com `warn`. O ledger grava `conexos_username`/`conexos_usn_cod` (I-2). |
| **I18g** | **Disparo e retomada.** (1) Logo **depois do commit** do `confirmarSugestaoBoleto`, **fora** da transação dele, de forma assíncrona no processo do servidor; a resposta do `confirmar` não espera o ERP. (2) Ação "tentar de novo" (mesma ação, `sispag:executar`). (3) Varredura de retomada no processo do servidor (ao abrir a tela do SISPAG e após cada `confirmar`), que retoma ledgers não terminais. **Nunca** dentro da remessa, **nunca** dentro da transação do `confirmar`, **nunca** em cron. |
| **I18h** | **Ledger write-ahead e matriz de falhas.** Um ledger por tentativa, chave de idempotência `(filCod, docCod, titCodOrigem, decisaoId)`; **no máximo um ledger não terminal por título de origem** (índice único parcial). Cada etapa grava a intenção **antes** da chamada e o resultado depois: `pendente → renegociacao_criada(frnCod) → titulo_incluido → composicao_gravada → ajuste_aplicado → finalizada(titCodNovo) → liberada \| sem_bloqueio \| aguardando_aprovacao_manual → rechaveada ⇒ concluido`. **Antes de `finalizar`:** qualquer falha (determinística ou transitória sem reconhecimento) ⇒ **cancela** o `frnCod` (`PUT fin070/cancelar/{frnCod}` ou `DELETE`, a provar em HML, G3), relê, e o ledger vai a `cancelado`; o título original fica **intacto**. Cancelamento que falha ⇒ `indeterminado` + alerta (nunca se cria segunda renegociação por cima). **Depois de `finalizar`:** só **para a frente** (liberar, rechavear), nunca desfaz; falha ⇒ fica não terminal e a retomada continua. Transitório = retry com `RetryExecutor` (nunca `setTimeout` manual). |
| **I18i** | **Idempotência e reconhecimento ao vivo.** A retomada reconhece o estado **no ERP**, não só no ledger: `frnCod` existente (achado pelo marcador de correlação na obs quando a resposta do `POST` se perdeu), finalizado ou não, título novo presente, bloqueio liberado. Etapa já observada não é refeita; nenhum evento duplicado. Reexecutar sobre um ajuste `concluido` é no-op. |
| **I18j** | **Rechaveamento (uma transação local).** Na mesma transação: (1) decisão antiga `CONFIRMADA → ANULADA` com `tipoAnulacao = TITULO_RENEGOCIADO`, `anuladaPor = 'sistema'`, motivo "título renegociado X/Y → X/Z, frnCod N"; (2) nova `DecisaoSugestaoBoleto` `CONFIRMADA` no título novo, mesmo boleto, mesmo par, `decididoPor`/`decididoEm` **herdados da original**, `origemDecisaoId`, `transferidaPor = 'sistema'` (transferir **não** é confirmar, I15g); a ordem anula-antes-de-inserir preserva os índices únicos (I15l); (3) eventos `TITULO_RENEGOCIADO` e `DECISAO_TRANSFERIDA` na trilha; (4) **upsert** do título novo em `titulo_a_pagar` com os dados lidos ao vivo do `fin064` e `ativo = false` imediato no antigo (sem esperar o cron); (5) todo `ItemLote` em lote local `RASCUNHO` que aponta para o título antigo passa para o título novo (`titCod`, `valor` = líquido novo), `versao + 1`, evento na trilha do lote. O par `ConfirmacaoEmissorBoleto` **não muda**. Se a decisão foi anulada pela analista depois do `finalizar` (janela entre I18a e o rechaveamento), (1)/(2) não acontecem: carteira e item seguem o título novo, o ledger fecha `concluido_sem_decisao`, com aviso. |
| **I18k** | **Título em lote (resposta P0-3).** Lote local `RASCUNHO` ⇒ permitido, troca do item na I18j(5). Lote local `FINALIZADO`/`REMESSA_GERADA`/`RETORNADO`, ou título no rascunho nativo do `fin015` ⇒ **não renegocia** (`recusado`, motivo `TITULO_EM_LOTE_FINALIZADO`) e avisa. Enquanto houver ajuste não terminal, `finalizarLote` de lote que contém o título é **recusado** (`TitleAdjustmentInProgressError`, 409). |
| **I18l** | **Modos e kill-switch.** `off` (default): nada acontece; a UI mostra "diferença de centavos — ajuste desligado". `shadow`: I18a inteira **ao vivo** (leituras no ERP permitidas), **zero escrita**; grava `AJUSTE_SIMULADO` e lista os candidatos por endpoint + log. `on`: executa. Valor único global ou lista por filial, mesmas regras de parse da I17k (inválido ⇒ `off`). `sispagLiveWriteEnabled`, `conexosWriteEnabled` e `conexosDryRun` também derrubam o ajuste. Os valores por filial são **configuração** (`EnvironmentProvider`), não ontologia. |
| **I18m** | **Acima do limite, nada é automático.** \|Δ\| > R$ 0,05, Δdias ≠ 0, número diferente, par não vigente ou título não aprovado ⇒ **nenhuma escrita**; o vínculo continua `VALOR_DIFERENTE` (I17b) e o caminho é o fluxo manual do Conexos, por outra pessoa. A I18 **não alarga** a tolerância de nenhum par (I15d) nem cria tier novo. |
| **I18n** | **Portões de rollout em PRD (D6).** `on` em PRD só depois de: **G1** sonda **só leitura** de permissão (`ger014`) do login do servidor para `fin070` e `fin103` (espelho do V-PRD1; respeitar a memória "probe local derruba sessão"); **G2** HML provando composição com vencimento **passado e de hoje** (P1-3); **G3** HML provando cancelamento de renegociação **não finalizada** e reconhecimento pelo marcador na obs; **G4** medição só leitura em PRD do líquido em títulos com pagamento parcial e da divergência das duas fórmulas da I17b (P1-4), antes do merge; **G5** `shadow` em PRD e então **um** título real controlado, com go explícito do maintainer. |

## Privacidade e trilha

Nenhuma linha digitável completa em ledger, log, evento ou obs do `fin070` (I17j/I15k): só o mascarado 5+4.
A obs do `fin070` leva o marcador de correlação e a referência do boleto mascarada, em MAIÚSCULA.

Eventos novos na trilha `sispag_sugestao_boleto_evento` (só-inclusão): `AJUSTE_SIMULADO`, `TITULO_RENEGOCIADO`,
`DECISAO_TRANSFERIDA`, `AJUSTE_RECUSADO`, `AJUSTE_CANCELADO`, `AJUSTE_FALHOU`. Na trilha do lote:
`ITEM_TITULO_RENEGOCIADO` (título antigo → novo, valor antigo → novo).

## Erros nomeados

| Erro | Onde | HTTP |
|---|---|---|
| `TitleAdjustmentInProgressError` | `finalizarLote` com item cujo título tem ajuste não terminal (I18k) | 409 |
| `CentsAdjustmentIncompleteError` | falha transitória/ambígua; retomável (I18h) | 409 |
| `CentsAdjustmentNotEligibleError` | "tentar de novo" sobre título que deixou de ser elegível (I18a), com o motivo | 409 |

## Premissas pendentes com a Columbia (não bloqueiam; ADR-0073)

Renegociação em vez de correção do documento; conta contábil de juros/desconto (premissa: o default do
`fin070`); usuário de aprovação no `fin103` (premissa: a sessão do servidor); acesso do login do servidor a
`fin070`/`fin103` em PRD (G1).

## Casos canônicos de teste

1. NELSON 462,49 × boleto 462,50, mesmo vencimento, nº igual, par vigente ⇒ `frnVldTpop 1`, 0,01; título novo
   com líquido 462,50; I17b passa; J = barra 462,50 / título 462,49 / mora 0,01 / pagamento 462,50.
2. 178,78 × 178,77 ⇒ `frnVldTpop 2`, 0,01; líquido 178,77; J com abatimento 0,01, pagamento 178,77.
3. Δ = R$ 0,06 ⇒ zero chamada ao `fin070`; segue `VALOR_DIFERENTE`.
4. MSC nº 12294 × boleto de outro emissor ⇒ recusado (sem par `VIGENTE`).
5. Título sem juros/desconto e Δ = 0 ⇒ I17b idêntica ao comportamento atual (regressão).
6. Falha depois de `POST fin070/titulos` ⇒ cancela o `frnCod`; título original intacto.
7. Título novo com bloqueio de outra regra ou valor ≠ boleto ⇒ não libera; `aguardando_aprovacao_manual`.
8. Retomada depois de `finalizar` e antes de liberar ⇒ nenhuma segunda renegociação.
9. Resposta do `POST fin070` perdida ⇒ retomada acha o `frnCod` pelo marcador e continua.
10. Título em lote local `RASCUNHO` ⇒ item trocado na transação do rechaveamento; em `FINALIZADO` ⇒ recusado.
11. `finalizarLote` durante ajuste em curso ⇒ `TitleAdjustmentInProgressError`.
12. Execução em processo de job ⇒ modo efetivo `shadow`, nenhuma escrita.
13. Título com pagamento parcial ⇒ recusado (I18a(6)).

## Ver também

`decisions/0073-*.md` · `actions/sispag/ajustar-centavos-titulo.md` · `business-rules/vinculo-codbar-item-sispag.md`
(I17b, I17m, I17n) · `business-rules/sugestao-boleto-dda-sispag.md` (I15c, I15g) ·
`entities/decisao-sugestao-boleto.md` · `entities/titulo-a-pagar.md` · `business-rules/identidade-execucao-conexos.md`
· `_inbox/sispag-centavos-hml-achados.md`
````

### 3.2 `ontology/actions/sispag/ajustar-centavos-titulo.md`

````markdown
---
name: ajustarCentavosTitulo
type: action
entity: TituloAPagar
ontology_version: "0.44.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/AjusteCentavosTituloService.ts
  - src/backend/domain/client/ConexosSispagWriteClient.ts
  - src/backend/domain/repository/sispag/SugestaoBoletoRepository.ts
  - src/backend/domain/repository/sispag/TituloAPagarRepository.ts
  - src/backend/domain/repository/sispag/LotePagamentoRepository.ts
  - src/backend/routes/sispag.ts
  - src/backend/migrations/0087_sispag_ajuste_centavos.sql
last_review: 2026-10-19
preconditions:
  - "Processo do servidor (nunca job/cron); sessão Conexos = credencial do ambiente, explícita, com sonda G1 aprovada (I18f)."
  - "Modo da filial = on; sispagLiveWriteEnabled/conexosWriteEnabled ligados, conexosDryRun desligado (I18l)."
  - "I18a inteira, recalculada ao vivo: decisão CONFIRMADA não órfã, par VIGENTE, número igual, 0 < |Δ| <= LIMITE_VALOR_MESMO_DIA, mesmo vencimento, título aprovado, não pago, sem pagamento parcial, sem juros/desconto prévios, sem ajuste anterior na linhagem, fora de lote finalizado e de rascunho nativo."
  - "Nenhum outro ledger não terminal para o mesmo título de origem (I18h)."
postconditions:
  - "Título novo no mesmo docCod, vencimento original, líquido aberto == valor do boleto; título original consumido (I18d)."
  - "Bloqueio criado pela renegociação liberado, ou ajuste em aguardando_aprovacao_manual com aviso (I18e)."
  - "Decisão antiga ANULADA (TITULO_RENEGOCIADO, sistema) e nova CONFIRMADA no título novo, autor humano herdado, origemDecisaoId (I18j)."
  - "titulo_a_pagar: título novo upsertado ativo, antigo inativo; ItemLote em RASCUNHO trocado para o título novo (I18j(5))."
  - "Ledger concluido (ou concluido_sem_decisao / aguardando_aprovacao_manual / cancelado / recusado / indeterminado), com conexos_username e conexos_usn_cod (I-2)."
side_effects:
  - "Escrita no ERP: fin070 (POST, POST titulos, POST titulos/composicao, PUT, PUT finalizar; PUT cancelar na compensação) e fin103 (validaSelecionado, aplicarComando). Leituras: fin064, fin015 pendentes/rascunho, fin103/list, fin106/finBloqCmd/list."
  - "Trilha só-inclusão: AJUSTE_SIMULADO, TITULO_RENEGOCIADO, DECISAO_TRANSFERIDA, AJUSTE_RECUSADO, AJUSTE_CANCELADO, AJUSTE_FALHOU; trilha do lote: ITEM_TITULO_RENEGOCIADO."
  - "LogService em pt-BR, código sempre mascarado."
---

# ajustarCentavosTitulo

ADR-0073. Renegocia no `fin070` o título a pagar cujo boleto confirmado difere em centavos (I18), libera só o
bloqueio que a renegociação criou e faz decisão, carteira e item seguirem o título novo. **Três gatilhos, uma
ação:** após o commit do `confirmarSugestaoBoleto` (assíncrono), "tentar de novo" (`sispag:executar`) e a
varredura de retomada no processo do servidor (I18g). Nunca pela remessa, nunca por cron. Idempotente por
I18h/I18i. **Planned** (modo `off` por default).
````

### 3.3 `ontology/decisions/0073-sispag-ajuste-centavos-por-renegociacao-fin070.md`

````markdown
---
adr_number: 0073
title: SISPAG — ajuste de centavos do título por renegociação no fin070 (o valor do boleto é a verdade)
date: 2026-10-19
status: accepted
type: addition
related_entities: [TituloAPagar, DecisaoSugestaoBoleto, ConfirmacaoEmissorBoleto, LotePagamento]
related_business_rules: [ajuste-centavos-titulo-sispag, vinculo-codbar-item-sispag, sugestao-boleto-dda-sispag, boleto-exige-codigo-de-barras, identidade-execucao-conexos]
continues: [0068, 0071, 0072]
evidence:
  - ontology/_inbox/sispag-ajuste-centavos-interview.md
  - ontology/_inbox/sispag-centavos-hml-achados.md
  - "HML 2026-10-19: fin070 frnCod 3 (536/1 -> 536/2, tpop 1) e 4 (540/1 -> 540/2, tpop 2), liberação fin103 fbaCod 3, vínculo e .REM PG191074/PG191075 com J pagando o valor da barra"
  - "PRD 2026-10-19 (só leitura): 109 títulos <= R$ 0,05 com número igual (todos NELSON +0,01); 0 entre R$ 0,06 e R$ 10; 25 > R$ 10"
---

# ADR 0073: ajuste de centavos do título por renegociação (fin070)

**Branch:** `feat/sispag-ajuste-centavos`. `/feature-tweak`. `entity_changed = true`. Ontologia **0.44.0**
(regra e ação `planned`, à frente do código). Migration prevista: **0087**.

> Reconferir antes do ship: `origin/main` em 2026-10-19 = app v0.69.0, ontologia 0.43.0, último ADR 0072,
> última migration 0086.

## Contexto

A sugestão (I15c) deixa a analista confirmar pares com |Δ| ≤ R$ 0,05 no mesmo dia, mas o vínculo (I17b)
exige barra == `fin064.totalAberto` ao centavo. Resultado: par confirmado que nunca é pago — 109 títulos
NELSON HEUSI em PRD, todos +R$ 0,01. Os experimentos de HML mostraram que o J do `.REM` paga o **valor do
título**, não o do item; nenhum campo do item, nem `PUT fin026`, nem `fin062` resolve. A Renegociação de
Pagamentos (`fin070`) com `frnVldTpop 1/2` muda o título (juros/desconto), o título novo volta a bloquear na
`fin103` e, liberado, vincula e gera o J com pagamento = barra. Também se achou um bug latente: o `importar`
manda `titMnyValor` (base) como valor do item, não o líquido.

## Decisão

1. **O valor do boleto é a verdade** (D1). Acima ⇒ juros (`frnVldTpop 1`); abaixo ⇒ desconto (`frnVldTpop 2`).
2. **Nova regra `ajuste-centavos-titulo-sispag` (I18a–n) e nova ação `ajustarCentavosTitulo`.** Elegível só
   com |Δ| ≤ `LIMITE_VALOR_MESMO_DIA` (R$ 0,05, constante reaproveitada), mesmo vencimento, número igual
   **e** par de emissor `VIGENTE` (o falso par MSC prova que o número sozinho colide), decisão `CONFIRMADA`,
   título original aprovado, não pago, sem pagamento parcial.
3. **Reaprovação estreita** (D4): só o bloqueio que a nossa renegociação criou, com valor = boleto, pelo único
   comando "APROVAR" ativo; qualquer outro bloqueio volta ao fluxo normal.
4. **Identidade = sessão do servidor** (`CONEXOS_USERNAME` do ambiente), explícita; nunca a analista, nunca
   cron (CLONEX). Correção da entrevista: o "robô" do resolver é a credencial do ambiente, não necessariamente
   o CLONEX.
5. **Disparo** logo após o commit do `confirmar`, fora da transação dele, com "tentar de novo" e varredura de
   retomada no processo do servidor. Ledger write-ahead com marcador de correlação; antes do `finalizar` a
   falha cancela a renegociação; depois, só para a frente.
6. **Rechaveamento numa transação local:** decisão antiga `ANULADA` (`TITULO_RENEGOCIADO`, sistema), nova
   `CONFIRMADA` no título novo com o autor humano herdado (transferir não é confirmar), upsert da carteira,
   troca do item em lote `RASCUNHO`. Lote finalizado/remessa/rascunho nativo ⇒ não renegocia e avisa;
   `finalizarLote` fica bloqueado enquanto o ajuste corre.
7. **Base (vale com o ajuste desligado):** I17b compara com o **líquido aberto** (fail-closed na divergência
   das duas fórmulas); **I17n** o import do item leva o líquido; **I17m** o `.REM` bloqueia J cuja barra (> 0)
   difere do pagamento.
8. **Rollout** (D6): flag `off/shadow/on` por filial, default `off`; `on` em PRD só depois de G1–G5 e go do
   maintainer.

## Rejeitado

- **Corrigir o documento no `com298` (estornar → editar → finalizar)** — REJECT-PREMATURE: não testado, mexe no
  documento inteiro (todas as parcelas, contabilização de origem) e depende de a Columbia preferir isso à
  renegociação (D7). Watchlist.
- **Desconto nativo `fin062`/`fin063`** — REJECT-WORKAROUND: recusado em HML (`docCod Generic.NOT_VALID`,
  mesmo com título a vencer) e não cobre acréscimo, que é 125 de 126 casos.
- **Declarar juros/desconto/valor no item** (`itsMnyRecbrac`, `titMnyJuros`, `titMnyDesconto`, `itsMnyValor`,
  `titMnyLiquido`) — REJECT-WORKAROUND: o J paga o título (A2 recusa; B0/B1/B2 pagam 1 centavo a mais que a barra).
- **`PUT fin026` para valor** — REJECT-WORKAROUND: aceito e ignorado.
- **Alargar a I17b para Δ ≤ R$ 0,05 sem mudar o título** — REJECT-WORKAROUND: o banco recebe J com pagamento ≠ barra.
- **Renegociar dentro da remessa ou na transação do `confirmar`** — REJECT-WORKAROUND: título já importado;
  total do lote muda depois do `finalizar`; 5–7 escritas no ERP acopladas a uma transação local.
- **Sessão da analista ou cron (CLONEX)** — rejeitado por D4/P0-1 (autoria errada ou 403).
- **Ajuste acima de R$ 0,05** — REJECT-PREMATURE: os 25 casos > R$ 10 são outro problema (valor previsto,
  retenção, falso par). Watchlist.
- **Entidade `RenegociacaoTitulo`/`AjusteCentavos`** — REJECT-DUPLICATE: ledger de execução (padrão I-2) +
  trilha da decisão.
- **`titCodOrigem`/`frnCod`/`valorLiquido` em `TituloAPagar`** — REJECT-WORKAROUND (UPSERT apaga) /
  REJECT-PREMATURE (o list do `fin064` traz o líquido?).
- **Estado persistido `AJUSTADA` na decisão** e **`UPDATE` do `tit_cod`** — REJECT-WORKAROUND (decisão
  imutável; execução é derivada, precedente `APLICADO_NO_ERP` da ADR-0071).
- **Constante nova para o limite** — REJECT-DUPLICATE (`LIMITE_VALOR_MESMO_DIA`).
- **Filiais, modo, regra 19, `fbaCod`, login, conta contábil na ontologia** — REJECT-CONFIG / lidos ao vivo.

## Consequências

- **I1 deixa de ser absoluta para `TituloAPagar`:** a plataforma passa a escrever no título do ERP, em um caso
  estreito (I18). Toda a escrita no título fica nesta regra.
- **I15g é emendada:** "o sistema nunca confirma" continua; a **transferência** de uma confirmação humana para o
  título renegociado é ação do sistema, auditada, que herda o autor. CHECK da 0084 relaxado só para
  `tipoAnulacao = TITULO_RENEGOCIADO` (migration 0087).
- Ledgers de escrita irreversível no ERP passam de seis para **sete** (I-2).
- O CNAB ganha uma guarda nova (I17m) que vale para todo J — medir antes (M8).
- O título renegociado volta a ter `titMnyValor` base na carteira e na sugestão (Δ continua +0,01, dentro da
  I15c); a UI mostra o líquido a partir do ledger.

## Premissas pendentes com a Columbia (não bloqueiam)

Renegociação × correção do documento; conta contábil de juros/desconto (default do `fin070`); usuário de
aprovação no `fin103` (sessão do servidor); permissão do login do servidor em `fin070`/`fin103` em PRD
(o CLONEX não tem `fin070`/`fin026`/`fin103` no menu). HML: renegociações 3 e 4 ficam como estão (P1-5).
Universalidade: 1 cliente, revisão com o Francinei não bloqueante.
````

---

## 4. Emendas — BEFORE / AFTER

### 4.1 `ontology/business-rules/vinculo-codbar-item-sispag.md`

**Frontmatter**
```diff
-ontology_version: "0.43.0"
+ontology_version: "0.44.0"
...
-last_review: 2026-10-14
+last_review: 2026-10-19
```
e acrescentar em `related_files`: `src/backend/domain/libs/boleto/ElegibilidadeVinculoCodigoBarras.ts`,
`src/backend/domain/libs/cnab/RemessaCnabValidator.ts`, `src/backend/domain/client/ConexosSispagClient.ts`.

**I17b**
- BEFORE:
```
| **I17b** | **Valor igual em centavos.** `round(valorBoleto × 100) == round(fin064.totalAberto × 100)`, com `valorBoleto` **decodificado por nós** do código de barras (campo de 10 dígitos / 100) e conferido com o devolvido pelo ERP (`validacao/codigoBarras`). Nunca se compara com `ItemLote.valor` (snapshot da inclusão): o aberto é lido ao vivo. Diferença de 1 centavo = **inelegível** (acima/abaixo do título está fora do escopo, watchlist). |
```
+ AFTER:
```
| **I17b** | **Valor igual em centavos, contra o LÍQUIDO aberto (emendada ADR-0073).** `round(valorBoleto × 100) == round(abertoLiquido × 100)`, com `abertoLiquido = fin064.totalLiquido − totalPago`, **conferido** contra `totalAberto + titMnyJuros − titMnyDesconto` (todos lidos ao vivo no `fin064`). As duas fórmulas divergirem, ou qualquer campo faltar ⇒ `VALOR_ABERTO_INDISPONIVEL`, item **inelegível** (fail-closed, I17g(1)). `valorBoleto` é **decodificado por nós** do código de barras (campo de 10 dígitos / 100) e conferido com o devolvido pelo ERP (`validacao/codigoBarras`). Nunca se compara com `ItemLote.valor` (snapshot) nem com a carteira (`titMnyValor`, base). A mesma régua vale nos três pontos: elegibilidade, conferência pré-`PUT` do executor e conferência pós-releitura. Para título sem juros/desconto e sem pagamento, `abertoLiquido = totalAberto`: **nenhuma mudança de comportamento**. Diferença de 1 centavo continua **inelegível**; ela se resolve **antes**, no título, pela I18 (`ajuste-centavos-titulo-sispag`, ADR-0073), nunca aqui. |
```

**I17d** — acrescentar ao fim da célula (sem mudar a regra):
- BEFORE (fim da célula): `... Nenhuma checagem é delegada ao ERP. |`
+ AFTER: `... Nenhuma checagem é delegada ao ERP. **Nota (ADR-0073):** em (6), "juros e desconto = 0" refere-se ao que **nós declaramos** no `confirmaCodigoBarras`/item; juros/desconto **do título** (nascidos da renegociação I18) são esperados e o critério continua `itsMnyVlrPgtoResult == valorBoleto` (HML 536/2: confirm 53,54). |`

**Novas linhas, depois de I17l:**
```
| **I17m** | **Guarda do `.REM`: barra == pagamento do J (ADR-0073).** Em todo segmento J cujo código de barras tem valor > 0, o valor da barra (campo de 10 dígitos / 100) **deve ser igual** ao valor do pagamento do próprio J. Divergência ⇒ `RemessaBarcodeAmountMismatchError` (409), código **mascarado** (5+4), tratamento do gate pós-geração da I16b(2) (lote nativo finalizado e arquivo no ERP para cancelamento manual). Barra com valor zerado (boleto de valor aberto) fica **fora** da guarda. Vale para **todo** J (DDA do ERP, vínculo I17 e ajuste I18) e é **pré-requisito** do modo `on` da I18. Antes de virar bloqueio, medir só-leitura os `.REM` de PRD dos últimos 30 dias (M8). |
| **I17n** | **O item é importado pelo líquido (ADR-0073; corrige bug de implementação).** O `importar` do `fin015` leva `itsMnyValor = itsMnyVlrPgto = titMnyLiquido` **do grid de pendentes** do título, nunca `titMnyValor` (base). `titMnyLiquido` ausente ⇒ usa `titMnyValor` **só** se `titMnyJuros` e `titMnyDesconto` forem 0/ausentes; caso contrário o item não é importado (erro nomeado, motivo `VALOR_LIQUIDO_INDISPONIVEL`). Vale para todo título, não só para os ajustados pela I18. |
```

**Erros nomeados — nova linha:**
```
| `RemessaBarcodeAmountMismatchError` | I17m: J com barra > 0 e pagamento ≠ barra no `.REM` gerado; mensagem pt-BR com `docCod/titCod`, os dois valores e o código **mascarado** | 409 |
```

**Fora do escopo (watchlist)**
- BEFORE:
```
Boleto **acima** do título (inviável via SISPAG: o `finalizar` recusa pagamento > `totalAberto`) e
**abaixo** (não medido; baixa parcial); vínculo de tier `ATENCAO`; vínculo automático sem decisão humana
(passo 3); guarda entre lotes vivos / contra boleto pago.
```
+ AFTER:
```
Boleto acima/abaixo do título **até R$ 0,05**, mesmo vencimento, número igual e emissor confirmado: resolvido
**antes do vínculo**, no título, pela I18 (ADR-0073); o vínculo continua exigindo valor igual ao líquido.
**Acima de R$ 0,05** segue fora (watchlist: 25 títulos > R$ 10 em PRD, outro problema). Vínculo de tier
`ATENCAO`; vínculo automático sem decisão humana (passo 3); guarda entre lotes vivos / contra boleto pago.
```

**Ver também** — acrescentar: `` `decisions/0073-*.md` · `business-rules/ajuste-centavos-titulo-sispag.md` (I18) ``.

### 4.2 `ontology/business-rules/sugestao-boleto-dda-sispag.md`

**Frontmatter:** `ontology_version: "0.43.0"` → `"0.44.0"`; `last_review: 2026-10-15` → `2026-10-19`.

**I15b**
- BEFORE (trecho final): `... **Vale para o passo 1:** o passo 2 (ADR-0071, I17) é a única exceção e vive em outra regra; a UI do passo 1 nunca dispara I17. |`
+ AFTER: `... **Vale para o passo 1:** há **duas** exceções, cada uma na sua regra: o passo 2 (ADR-0071, I17) e o ajuste de centavos do título (ADR-0073, I18), disparado **depois** do commit do `confirmar`, fora da transação dele. A UI do passo 1 nunca dispara I17; o `confirmar` em si continua só com escrita local. |`

**I15c** — acrescentar ao fim da célula:
- BEFORE (fim): `... São constantes de código globais (não por tenant), ajustáveis por ADR curta, sem mudança estrutural. |`
+ AFTER: `... São constantes de código globais (não por tenant), ajustáveis por ADR curta, sem mudança estrutural. **Nota (ADR-0073):** par confirmado com 0 < \|Δ\| ≤ R$ 0,05 no mesmo dia, número igual e par `VIGENTE` é exibido com o derivado `ajuste` da decisão (`AGUARDANDO`, `SIMULADO`, `EM_ANDAMENTO`, `AJUSTADO`, `AGUARDANDO_APROVACAO_MANUAL`, `RECUSADO(motivo)`, `DESLIGADO`), nunca como "pronto para pagar" antes de `AJUSTADO`. O limite **não muda** e o ajuste não alarga tolerância (I15d). O título ajustado continua com Δ = +0,01 contra a base da carteira (`titMnyValor`); a UI mostra também o líquido. |`

**I15g**
- BEFORE (trecho): `**Quem confirma é sempre uma pessoa** com `sispag:executar`; o sistema nunca confirma.`
+ AFTER: `**Quem confirma é sempre uma pessoa** com `sispag:executar`; o sistema nunca confirma. **Transferir não é confirmar (ADR-0073, I18j):** quando o título é renegociado pela I18, o sistema anula a decisão do título antigo e grava a mesma decisão no título novo, **herdando** `decididoPor`/`decididoEm` da pessoa e registrando `origemDecisaoId` e `transferidaPor = 'sistema'`; mesmo boleto, mesmo par.`

**Trilha só-inclusão**
- BEFORE:
```
Eventos: `PAR_CONFIRMADO`, `DECISAO_CONFIRMADA`, `DECISAO_REJEITADA`, `DECISAO_ANULADA`,
`PAR_REVOGADO`, `LINHA_COPIADA`. Cada um com quem, quando, chaves envolvidas e (rejeição/revogação) o motivo.
```
+ AFTER:
```
Eventos: `PAR_CONFIRMADO`, `DECISAO_CONFIRMADA`, `DECISAO_REJEITADA`, `DECISAO_ANULADA`,
`PAR_REVOGADO`, `LINHA_COPIADA`; (ADR-0071) `VINCULO_SIMULADO`, `VINCULO_APLICADO`, `VINCULO_FALHOU`;
(ADR-0073, `planned`) `AJUSTE_SIMULADO`, `TITULO_RENEGOCIADO`, `DECISAO_TRANSFERIDA`, `AJUSTE_RECUSADO`,
`AJUSTE_CANCELADO`, `AJUSTE_FALHOU`. Cada um com quem, quando, chaves envolvidas e (rejeição/revogação) o motivo.
```

**Ver também** — acrescentar: `` `decisions/0073-*.md` · `business-rules/ajuste-centavos-titulo-sispag.md` (I18) ``.

### 4.3 `ontology/business-rules/boleto-exige-codigo-de-barras.md`

**Frontmatter:** `ontology_version: "0.42.0"` → `"0.44.0"`; `last_review: 2026-10-14` → `2026-10-19`.

**I16b** — acrescentar ao fim da célula:
- BEFORE (fim): `... O mesmo caminho serve lote manual e automático. |`
+ AFTER: `... O mesmo caminho serve lote manual e automático. **Emenda ADR-0073:** a rede (2) passa a conferir também **barra (> 0) == pagamento do J** (I17m, `RemessaBarcodeAmountMismatchError`), com o mesmo tratamento tardio. |`

**Ver também** — acrescentar: `- ADR-0073 / business-rules/ajuste-centavos-titulo-sispag.md — I18 (ajuste de centavos no título) e I17m (barra == pagamento do J na rede do .REM)`.

### 4.4 `ontology/business-rules/identidade-execucao-conexos.md`

- BEFORE:
```
Ledgers cobertos (**seis**): `permuta_alocacao_execucao`, `solicitacao_numerario_execucao`,
`recebimento_execucao`, `remessa_execucao`, `conciliacao_execucao` e `solicitacao_numerario`.
```
+ AFTER:
```
Ledgers cobertos (**sete**): `permuta_alocacao_execucao`, `solicitacao_numerario_execucao`,
`recebimento_execucao`, `remessa_execucao`, `conciliacao_execucao`, `solicitacao_numerario` e
(ADR-0073, `planned`) `sispag_ajuste_centavos_execucao`.
```
e, em "O fallback para o robô é legítimo", acrescentar depois da lista de quatro situações:
```
> **Exceção (ADR-0073, I18f):** o ajuste de centavos do título **não** passa pelo resolver por-request. Ele
> usa explicitamente a sessão da credencial do ambiente do servidor e nunca roda em job/cron; sem essa
> sessão (ou fora do processo do servidor) degrada para `shadow`, em vez de cair noutra identidade.
```
(+ `last_review` → 2026-10-19; o arquivo não tem `ontology_version` no frontmatter — não acrescento.)

### 4.5 `ontology/entities/decisao-sugestao-boleto.md`

**Frontmatter**
```diff
-ontology_version: "0.43.0"
+ontology_version: "0.44.0"
-implementation_status: implemented
+implementation_status: partial
...
-properties: [id, filCod, docCod, titCod, ..., anuladaPor, anuladaEm, motivoAnulacao, versao]
+properties: [id, filCod, docCod, titCod, ..., anuladaPor, anuladaEm, motivoAnulacao, tipoAnulacao, origemDecisaoId, transferidaPor, versao]
...
-last_review: 2026-10-14
+last_review: 2026-10-19
```
relationships — acrescentar:
`- "DecisaoSugestaoBoleto 0..1—0..1 DecisaoSugestaoBoleto (origemDecisaoId: a decisão do título antigo que esta herdou na renegociação I18j; ADR-0073, planned)"`

**Tabela de propriedades — linhas novas/alteradas**
- BEFORE:
```
| `decididoPor` · `decididoEm` | string · Date | `sispag:executar`. Nunca `sistema`. |
```
+ AFTER:
```
| `decididoPor` · `decididoEm` | string · Date | `sispag:executar`. Nunca `sistema`. Na transferência (I18j) são **herdados** da decisão de origem: o autor continua sendo a pessoa. |
```
- BEFORE:
```
| `anuladaPor` · `anuladaEm` · `motivoAnulacao` | string? · Date? · string? | Todos preenchidos em `ANULADA` e só nela (CHECK). `anuladaPor` nunca `sistema`/`unknown`. Motivo de 10 a 500 caracteres; na cascata é `par revogado: <motivo da revogação>`. |
```
+ AFTER:
```
| `anuladaPor` · `anuladaEm` · `motivoAnulacao` | string? · Date? · string? | Todos preenchidos em `ANULADA` e só nela (CHECK). `anuladaPor` nunca `unknown`; nunca `sistema`, **exceto** com `tipoAnulacao = TITULO_RENEGOCIADO` (ADR-0073). Motivo de 10 a 500 caracteres; na cascata é `par revogado: <motivo da revogação>`; na renegociação, `título renegociado X/Y → X/Z, frnCod N`. |
| `tipoAnulacao` | enum? | `MANUAL \| PAR_REVOGADO \| TITULO_RENEGOCIADO` (ADR-0073, `planned`; legado sem backfill ⇒ derivado do motivo). Preenchido só em `ANULADA`. |
| `origemDecisaoId` · `transferidaPor` | string? · string? | Só na decisão nascida da transferência (I18j): a decisão do título antigo e o ator `sistema`. Nulos em decisão tomada por pessoa. (ADR-0073, `planned`) |
```

**Estados (I15l)**
- BEFORE:
```
CONFIRMADA ──anularDecisaoSugestaoBoleto──▶ ANULADA        (terminal)
CONFIRMADA ──revogarConfirmacaoEmissor (cascata)──▶ ANULADA
REJEITADA                                                  (terminal, intocada)
```
+ AFTER:
```
CONFIRMADA ──anularDecisaoSugestaoBoleto──▶ ANULADA        (terminal)
CONFIRMADA ──revogarConfirmacaoEmissor (cascata)──▶ ANULADA
CONFIRMADA ──ajustarCentavosTitulo (transferência, I18j)──▶ ANULADA  +  nova CONFIRMADA no título novo
REJEITADA                                                  (terminal, intocada)
```

**Derivados** — acrescentar ao fim da seção "Aplicação no ERP":
```
**Ajuste de centavos (ADR-0073, `planned`) — derivado, não persistido:** `ajuste` =
`NAO_APLICAVEL | DESLIGADO | AGUARDANDO | SIMULADO | EM_ANDAMENTO | AJUSTADO | AGUARDANDO_APROVACAO_MANUAL |
RECUSADO(motivo)`, lido do ledger `sispag_ajuste_centavos_execucao` e da trilha. Enquanto o ajuste está entre
`finalizada` e `rechaveada`, a decisão do título antigo **não** é mostrada como órfã com "Anular": a tela diz
"título renegociado, ajuste em andamento". **Não existe** estado `AJUSTADA` em `decisao`.
```

### 4.6 `ontology/entities/titulo-a-pagar.md`

**Frontmatter:** `ontology_version: "0.31.0"` → `"0.44.0"`; `last_review` → `2026-10-19`; relationships — acrescentar:
`- "TituloAPagar 1—0..1 TituloAPagar (renegociação I18: o título novo nasce no mesmo docCod e consome o antigo; linhagem no ledger sispag_ajuste_centavos_execucao, não em coluna; ADR-0073, planned)"`

**Definição de domínio**
- BEFORE:
```
Esta entidade **lê e persiste** os dados básicos da carteira; **não modifica** o título no ERP (I1 —
read-only no Conexos). A única escrita é no **banco próprio** (Postgres).
```
+ AFTER:
```
Esta entidade **lê e persiste** os dados básicos da carteira; a ingestão **não modifica** o título no ERP
(I1 — read-only no Conexos). **Exceção única (ADR-0073, `planned`):** a ação `ajustarCentavosTitulo` renegocia
no `fin070` o título cujo boleto confirmado difere em centavos e libera no `fin103` o bloqueio que essa
renegociação criou (regra `ajuste-centavos-titulo-sispag`, I18). Nenhuma outra escrita no título é permitida.
O título renegociado é um **título novo** (mesmo `docCod`, `titCod` novo); a linhagem antigo → novo vive no
ledger do ajuste, não em coluna desta tabela (o UPSERT da ingestão a apagaria).
```

**Fora de escopo**
- BEFORE: `- Nenhuma escrita no ERP a partir desta entidade. A baixa do título é **observada** (L11, ADR-0055),`
+ AFTER: `- Nenhuma escrita no ERP a partir desta entidade, salvo a renegociação de centavos da I18 (ADR-0073). A baixa do título é **observada** (L11, ADR-0055),`

**`valor`** — acrescentar à célula de Notas: `**Base** (`titMnyValor`), não o líquido; para o líquido, ver I17b/I18 (ADR-0073).`

### 4.7 `ontology/entities/lote-pagamento.md`

**Frontmatter:** `ontology_version: "0.42.0"` → `"0.44.0"`; `last_review` → `2026-10-19`.

**ItemLote › `titCod`**
- BEFORE: `| `titCod` | string | `lote_pagamento_item.tit_cod` | Título/parcela. Parte de `filCod:docCod:titCod` (I3). |`
+ AFTER: `| `titCod` | string | `lote_pagamento_item.tit_cod` | Título/parcela. Parte de `filCod:docCod:titCod` (I3). **Muda só por I18j(5)** (ADR-0073): em lote `RASCUNHO`, o item passa para o título renegociado, com `valor` = líquido novo, `versao + 1` e evento `ITEM_TITULO_RENEGOCIADO` na trilha. Em lote não `RASCUNHO` nunca muda (o ajuste é recusado, I18k). |`

**I1 (sem escrita no ERP até `FINALIZADO`)** — acrescentar:
- BEFORE (fim do bullet): `... **L11 é read-only no ERP** e nunca baixa, processa ou carrega nada (I11a).`
+ AFTER: `... **L11 é read-only no ERP** e nunca baixa, processa ou carrega nada (I11a). A renegociação de centavos (I18, ADR-0073) escreve no **título**, não no lote, e nunca toca lote não `RASCUNHO`; enquanto ela corre, `finalizarLote` é recusado (`TitleAdjustmentInProgressError`).`

### 4.8 `ontology/actions/sispag/finalizar-lote.md`

**Frontmatter:** `ontology_version` → `"0.44.0"`; `last_review` → `2026-10-19`; `preconditions` — acrescentar:
`- "Nenhum item cujo título tenha ajuste de centavos não terminal (TitleAdjustmentInProgressError, 409; I18k, ADR-0073, planned)."`

### 4.9 `ontology/actions/sispag/confirmar-sugestao-boleto.md`

**Frontmatter:** `ontology_version: "0.40.0"` → `"0.44.0"`; `last_review` → `2026-10-19`.
- BEFORE (side_effects): `- "Escrita local apenas."`
+ AFTER:
```
  - "Escrita local apenas, dentro da transação do confirmar."
  - "Depois do commit, fora da transação: dispara ajustarCentavosTitulo (assíncrono) quando o par tem 0 < |Δ| <= R$ 0,05 no mesmo dia e o modo da filial não é off (I18g, ADR-0073, planned). A resposta não espera o ERP; o derivado ajuste começa AGUARDANDO."
```

### 4.10 `ontology/integrations/conexos.md`

**Frontmatter:** `ontology_version` → `"0.44.0"`; `last_review` → `2026-10-19`.
**Nova subseção, depois de "### ESCRITA SISPAG (vigente desde 2026-08-25)":**
```
### ESCRITA SISPAG — renegociação de centavos no título (ADR-0073, `planned`)

Provado em HML (2026-10-19, frnCod 3 e 4). Só pela ação `ajustarCentavosTitulo` (I18), sessão do servidor.

| Passo | Endpoint | Notas |
|---|---|---|
| criar | `POST fin070` | `pesCod = fin064.pesCodFor`, `frnVldTipo 2`, `frnVldTpop 0`, `frnDtaReneg`, obs MAIÚSCULA (marcador de correlação) |
| título | `POST fin070/titulos` | o título original; juros enviados aqui são ignorados |
| composição | `POST fin070/titulos/composicao` | mesmo valor aberto, vencimento original, `frgEspNumero`, `pgtCod`, `dupEspOrdem`; valor > aberto ⇒ `FIN_070.O_TOTAL_DOS_TITULOS_A_SEREM_GERADOS…` |
| ajuste | `PUT fin070` | `frnMnyValor = \|Δ\|`; `frnVldTpop` 1 acréscimo / 2 desconto; `0` com valor ⇒ `FIN_070.TIPO_OP_NAO_PERMITE_VALOR` |
| finalizar | `PUT fin070/finalizar/{frnCod}` | consome o original; nasce título novo no mesmo `docCod` (`totalLiquido` = boleto; `totalAberto` = base) |
| cancelar | `PUT fin070/cancelar/{frnCod}` ou `DELETE` | **não provado** (G3) |
| liberar | `POST fin103/validaSelecionado` → `POST fin103/aplicarComando {items:[linha fin103/list + fbaCod]}` | comando ativo "APROVAR" lido em `fin106/finBloqCmd/list/{fblCod}` |

O título novo pode nascer **bloqueado** na `fin103` (HML: regra 19, `vldLib 0`) e só aparece nos pendentes
do `fin015` depois de liberado. Em PRD o CLONEX não tem `fin070`/`fin026`/`fin103` no menu; a permissão do
login do servidor é o portão G1.
```

### 4.11 `ontology/_inbox/_watchlist.md`

- BEFORE (última linha da seção ADR-0072):
```
- **Vincular boleto acima/abaixo do título** — segue em ADR-0071 (inviável/não medido).
```
+ AFTER:
```
- ~~**Vincular boleto acima/abaixo do título**~~ — **até R$ 0,05 resolvido pela ADR-0073** (I18, ajuste no
  título antes do vínculo). **Acima de R$ 0,05** continua aqui (ver seção ADR-0073).
```
**Nova seção ao fim:**
```
## 2026-10-19 — sispag-ajuste-centavos (ADR-0073)

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
```

---

## 5. Migration prevista (para o TaskScoper, não ontologia)

**0087_sispag_ajuste_centavos.sql** (uma): (1) tabela `sispag_ajuste_centavos_execucao` (ledger write-ahead:
chave de idempotência, etapa, `frn_cod`, `tit_cod_origem`, `tit_cod_novo`, `delta_centavos`, `tpop`, marcador,
`decisao_id`, `disparado_por`, `conexos_username`, `conexos_usn_cod`, `encerrado_em` (padrão ADR-0052),
índice único parcial "não terminal por título de origem"); (2) `sispag_decisao_sugestao_boleto` ganha
`tipo_anulacao`, `origem_decisao_id`, `transferida_por` e o CHECK de `anulada_por` é relaxado só para
`tipo_anulacao = 'TITULO_RENEGOCIADO'`; (3) novos tipos de evento na trilha e na trilha do lote.
Lembrar o gotcha do `npm run build` (copiar `.sql` para `dist/`; já tratado por `MigrationFiles.ts`).

---

## 6. ADR para os accepts?

**Sim:** ADR-0073 (§3.3). Rejeições são registradas dentro dela (seção "Rejeitado") e no watchlist; não
proponho ADRs de rejeição separadas.

---

## 7. `_index.json` e `_coverage.json` (deltas)

**`_index.json`**
```jsonc
"_meta": { "generated": "2026-10-19", "version": "0.44.0",
  "note": "v0.44.0 (2026-10-19, ADR-0073, feature sispag-ajuste-centavos): NEW business rule ajuste-centavos-titulo-sispag (I18a-n, planned) e NEW action ajustarCentavosTitulo (planned): renegociacao fin070 (tpop 1/2, |Δ| <= LIMITE_VALOR_MESMO_DIA, mesmo vencimento, numero igual + par VIGENTE), liberacao fin103 so do bloqueio criado, sessao do servidor, rechaveamento da decisao (transferencia, autor herdado). Emendas: I17b regua liquida (fail-closed), +I17m guarda .REM barra==pagamento J, +I17n import pelo liquido; I15b/I15c/I15g; I16b(2); identidade-execucao-conexos 7 ledgers; DecisaoSugestaoBoleto +tipoAnulacao/origemDecisaoId/transferidaPor (partial) + derivado ajuste; TituloAPagar I1 com excecao unica; finalizarLote +TitleAdjustmentInProgressError. Migration prevista 0087. | <nota anterior v0.43.0 preservada>" }

"business_rules": { ...,
  "ajuste-centavos-titulo-sispag": {
    "file": "business-rules/ajuste-centavos-titulo-sispag.md", "entity": "TituloAPagar", "status": "planned",
    "has_canonical_test": false, "impl_files": [], "resolved_by": ["ADR-0073"],
    "note": "ADR-0073 (planned, modo off por default): I18a-n. on em PRD so apos G1 (sonda leitura fin070/fin103 do login do servidor), G2 (vencimento passado/hoje em HML), G3 (cancelar renegociacao nao finalizada em HML), G4 (medicao liquido/pagamento parcial), G5 (shadow + 1 titulo controlado)."
  },
  "vinculo-codbar-item-sispag": { ..., "resolved_by": ["ADR-0071", "ADR-0073"],
    "note": "<nota atual> | ADR-0073 (planned): I17b passa ao liquido aberto (fail-closed na divergencia); +I17m guarda .REM barra==pagamento do J; +I17n import pelo liquido (bug: RemessaService manda titMnyValor)." } }

"actions": { ...,
  "ajustarCentavosTitulo": {
    "file": "actions/sispag/ajustar-centavos-titulo.md", "entity": "TituloAPagar", "status": "planned",
    "impl_files": [], "resolved_by": ["ADR-0073"],
    "note": "ADR-0073: fin070 -> fin103 -> rechaveamento; gatilhos pos-commit do confirmar, tentar de novo, varredura no processo do servidor; nunca cron." } }

"entities": {
  "DecisaoSugestaoBoleto": { ..., "status": "partial",
    "note": "<nota atual> | ADR-0073 (planned): tipoAnulacao, origemDecisaoId, transferidaPor; transicao de transferencia; derivado ajuste." },
  "TituloAPagar": { ..., "note": "<nota atual> | ADR-0073: excecao unica a I1 (renegociacao de centavos, I18); linhagem no ledger." } }
```

**`_coverage.json`**
```diff
 "summary": {
-  "entities_implemented": 19,  "entities_partial": 3,
+  "entities_implemented": 18,  "entities_partial": 4,          // DecisaoSugestaoBoleto -> partial
   "entities_coverage_pct": 74,                                   // (implemented+partial)/total inalterado
-  "actions_total": 44, "actions_planned": 7, "actions_coverage_pct": 82,
+  "actions_total": 45, "actions_planned": 8, "actions_coverage_pct": 80,   // 36/45
-  "business_rules_total": 29, "business_rules_planned": 11,
+  "business_rules_total": 30, "business_rules_planned": 12,
 }
 "by_business_rule": {
+  "ajuste-centavos-titulo-sispag": { "invariant": "I18", "status": "planned", "has_test": false,
+    "note": "ADR-0073 (v0.44.0): I18a-n planned; portoes G1-G5 antes de on em PRD." },
   "vinculo-codbar-item-sispag": {
-    "status": "planned",
+    "status": "implemented",          // correcao de inconsistencia pre-existente (ADR-0071 shipou)
+    "note": "<nota atual> | ADR-0073: I17b emendada (liquido), I17m e I17n planned."
   } }
 "by_entity": {
   "DecisaoSugestaoBoleto": { "status": "partial", "actions": [..., "ajustarCentavosTitulo"] },
   "TituloAPagar": { "actions": [..., "ajustarCentavosTitulo"] } }
 "_meta": { "version": "0.44.0", "generated": "2026-10-19", "note": "v0.44.0 ... (mesmo resumo do _index) | <anterior>" }
```
> Confirmar se `entities_coverage_pct` conta `partial` (o histórico v0.41.0 sugere que sim); se não, 18/27 = 67.

---

## 8. Docs (Parte 9) — opcional

`CLAUDE.md` › "Gotchas conhecidos", nova linha:
```
- **Renegociar no `fin070` troca o `titCod`.** O ajuste de centavos (ADR-0073) consome o título e cria outro no
  mesmo `docCod`; decisão, carteira e item seguem o novo pelo rechaveamento. Nunca rodar o ajuste em cron (CLONEX
  não tem `fin070`/`fin103`) nem na sessão da analista.
```

---

Please review and respond:
- **approve** — escrever como proposto (arquivos novos, emendas, watchlist, `_index`/`_coverage`, ADR-0073)
- **edit [arquivo] [instrução]** — ajustar antes de escrever (em especial M1–M9)
- **reject [motivo]** — bloquear o diff (crio ADR de "decisão de não mudar")
- **partial [aceitar itens …] [rejeitar itens …]** — numeração da §2
