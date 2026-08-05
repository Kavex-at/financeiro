# ADR-0029 — O "Processar" da Permuta volta a ser a baixa fin010

- **Status:** aceito
- **Data:** 2026-08-05
- **Reverte:** a decisão de 2026-07-31 registrada em `actions/permuta/gerar-solicitacao-numerario.md` (v0.11)
- **Frentes afetadas:** I (Permutas). A Frente IV (Recebimentos) **não muda**.
- **Contexto de produção:** `Processar` em Permutas devolveu "3 Solicitação(ões) de Numerário falharam".

## Contexto

Em 2026-07-31 decidiu-se que o botão **"Processar"** da aba Automáticas passaria a **gerar uma
Solicitação de Numerário** (com299/`gerDocProcesso`) em vez de executar a **baixa fin010**. A decisão
foi implementada em `fdf077c`, dentro do commit da Frente IV.

A premissa por trás dela estava errada. A **SN da Frente I** (numerário a partir de um *adiantamento de
permuta*) e a **SN da Frente IV** (numerário a partir de um *pagamento de cliente alocado a um
processo*) são **processos de negócio diferentes**, com origem, rateio, títulos e cauda fiscal
próprios. Como os dois serviços nasceram parecidos — `GerarSolicitacaoNumerarioService` (permutas) e
`RecebimentoNumerarioService` (recebimentos) —, as duas trilhas passaram a ser tratadas como uma só, e
o "Processar" da Permuta foi religado à trilha errada.

O custo apareceu na prática: **todas** as correções medidas contra o Conexos real (HAR doc 18339, runs
de HML/produção de 2026-08-02/03) foram para o lado dos Recebimentos e **nenhuma** para o lado das
Permutas. A trilha permutas nunca rodou live — o próprio código diz "Fluxo permutas DRY-RUN-only (não
dispara live)".

## Por que falhou em produção

`GerarSolicitacaoNumerarioService.buildSnPayload` ainda emite o payload **pré-correção**:

1. **Envia `items[]`.** O HAR doc 18339 mostrou que o rateio **não** alimenta a geração
   (`comDocProdutos/list` pós-geração devolveu `count: 0`) e que mandá-lo causa **SELECTION_ERROR** na
   SN real. `SnPayloadBuilder.buildSnRealPayload` é HEADER-ONLY por causa disso; a trilha permutas não.
   → `gerDocProcesso` recusado, sem `docCod`, resultado `error` — exatamente o toast observado.
2. **`endCodFis` hardcoded (`END_COD_FIS_DEFAULT = 1`) e `pdcDocFederal` ausente.** O servidor exige os
   dois (`endCodFis REQUIRED`); a fonte real é `validaProcessoPessoa`, que a trilha permutas não chama.
3. **`tpcCod`/`cfoEspCod` herdados da config** — no HAR são `null` para a SN Encomenda.
4. **Sem `completarSnAdiantamento`.** O documento nasce SHELL (`docMnyValor: 0`); a trilha recebimentos
   insere a linha de item (`comDocProdutos`) antes de finalizar. Sem isso a finalização fica
   `docVldFinalizado: 0` e o `assertDocumentoFinalizado` (ADR-0025, adicionado ao client **compartilhado**
   em `fb693fc`) falha fechado — onde antes passava em silêncio.

Ou seja: dois portões independentes, ambos fatais. O item 1 é o que corresponde ao erro observado.

## Decisão

1. O **"Processar"** (aba Automáticas) volta a executar a **baixa fin010** via
   `reconciliarAdiantamento` → `ReconciliacaoPermutaService`. É o caminho comprovado em produção.
   Vigora de novo a regra de 2026-06-24 ("Automáticas baixam"), sem nenhuma outra alteração.
2. `GerarSolicitacaoNumerarioService` e a rota `POST /permutas/adiantamentos/:docCod/gerar-numerario`
   **NÃO são removidos** — ficam **desligados da UI**, marcados como **não validados em produção** e
   disponíveis só para experimentação em dry-run. Apagar perderia a engenharia reversa dos bundles
   com068/fin014/com297, que continua correta como ponto de partida.
3. A SN da **Frente IV permanece intacta e ativa** na página de Recebimentos. Esta reversão não toca
   `RecebimentoNumerarioService`, `SnPayloadBuilder`, nem a cauda fiscal da NDe.
4. **Invariante nova (I-Permuta-6):** trilha de Permuta e trilha de Recebimento são **independentes**.
   Uma correção medida contra o ERP numa delas **não** se presume válida na outra; promover a trilha
   permutas exige sua própria validação contra o Conexos real.

## Consequências

- O "Processar" volta ao comportamento conhecido: borderô em CADASTRO, revisado e aprovado na aba
  Borderôs. Sem migração de dados — a baixa fin010 nunca deixou de existir no backend.
- A tabela `solicitacao_numerario` fica com as linhas `error` das tentativas de produção. Elas são
  registro histórico e devem ser conferidas contra o ERP: se alguma tiver `doc_cod` preenchido, existe
  uma SN de pé no Conexos que precisa de tratamento manual (ver bug de reporte abaixo).
- **Bug de reporte corrigido junto:** `registrarFalha` passa a reler a trilha
  (`findByIdempotencyKey`) em vez de confiar nas variáveis locais do `rodarTelas`, que só recebem valor
  no retorno de cada etapa. Uma falha *depois* do `setSnDocCod` (p.ex. na finalização) respondia sem
  `docCod` e a UI classificava como "falhou antes de gerar a SN" — escondendo do analista um documento
  realmente criado no ERP.
- Reabilitar a SN em Permutas volta a ser trabalho de feature, com HAR próprio, e depende de resolver
  os quatro pontos acima.

## Alternativa considerada e recusada

**Portar a correção dos Recebimentos para a trilha permutas** (dropar `items[]`, chamar
`validaProcessoPessoa`, adicionar a linha de item). Recusada **por ora**: é exatamente o raciocínio
"as duas trilhas são a mesma coisa" que causou este incidente. O caminho fica aberto como follow-up,
mas precisa de validação própria contra o ERP real antes de tocar o botão que os analistas usam todo
dia — e não com a área parada.
