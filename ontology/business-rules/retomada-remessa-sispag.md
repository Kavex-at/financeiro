---
name: retomada-remessa-sispag
type: business-rule
entity: LotePagamento
ontology_version: "0.42.0"
implementation_status: implemented
related_files:
  - src/backend/domain/service/sispag/RemessaService.ts
  - src/backend/domain/service/sispag/ConciliacaoRetornoService.ts
  - src/backend/domain/client/ConexosSispagWriteClient.ts
  - src/backend/domain/client/ConexosSispagRetornoClient.ts
  - src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts
  - src/backend/domain/repository/sispag/ConciliacaoExecucaoRepository.ts
  - src/backend/domain/errors/LoteAnteriorCanceladoError.ts
  - src/backend/domain/errors/RemessaEmDuvidaError.ts
  - src/backend/domain/errors/ConciliacaoEmDuvidaError.ts
  - src/backend/domain/service/sispag/SincronizacaoLoteService.ts
last_review: 2026-10-20
has_canonical_test: true
---

# Business Rule — retomada da remessa e da conciliação (SISPAG)

> Amplia `idempotencia-reconciliacao.md`, que fixou a doutrina do write-ahead para a permuta.
> Ali, uma execução órfã em `reconciling` significava **reconciliação manual**. Aqui não —
> ver ADR-0039 para o critério que separa os dois casos.

## O problema

As escritas do `fin015` (`criarLote` → `importarTitulos` → `finalizarLote` → `gerarRemessa`) e o
`processar` do `fin052` **não são idempotentes**. Um retry após timeout gera um SEGUNDO lote de
pagamento, ou baixa em cima de baixa. Por isso existe o ledger write-ahead.

Só que travar não é o fim do trabalho: o operador ficava com um 409 e uma ida ao fin015 na mão.
E o motivo do 409 era sempre o mesmo — **nós** não sabíamos se a escrita valeu.

## O princípio

> **Onde o ERP expõe estado verificável daquela escrita, a retomada consulta em vez de supor.
> Onde não expõe, continua fail-closed.**

A diferença entre isto e um retry: um retry **supõe** que a escrita não valeu; a retomada
**verifica** o que aconteceu. Nenhuma etapa é pulada sem evidência lida no ERP.

## Estado verificável (medido, não inferido)

`flpVldStatus` do `fin015`, medido em 22 lotes das filiais 1, 2, 4 e 6 (2026-08-25):

| valor | significado | `titulosCount` | `flpTimFinaliza` |
|---|---|---|---|
| 0 | aberto (rascunho) | 0 ou N | `null` |
| 1 | finalizado | ≥ 1 | preenchido |
| 2 | cancelado | 0 (itens removidos) | preenchido |
| 3 | outro terminal | 0 | preenchido |

No `fin052`, `processadoEm` (`garTimProcessamento`) responde "o `processar` já rodou?" direto.

## Máquina de retomada — remessa

| Estado observado no ERP | Ação |
|---|---|
| Lote não existe | recomeça do zero (nada a duplicar); **zera o `flpCod` do ledger** |
| Aberto, vazio | retoma no import |
| Aberto, com todas as chaves do lote | pula o import, retoma no finalizar |
| Aberto, com PARTE das chaves | importa **apenas as que faltam** |
| Finalizado, sem o arquivo pedido | pula import e finalizar, retoma na geração |
| Finalizado, com o arquivo pedido | fecha o ledger e devolve o `.REM` existente |
| Cancelado (status 2/3) | `LoteAnteriorCanceladoError` → exige confirmação humana |

> **Emenda ADR-0071 (`planned`) — etapa `vincular_codbar`.** Etapa **só de memória** (como
> `limpar_retirados`: o CHECK da 0049 não a conhece e nada vai ao ledger), entre `importar` e a guarda I16.
> A sincronização com o ERP a devolve quando: rascunho completo ∧ modo `on` ∧ existe item BOLETO sem código
> com decisão elegível (I17a). Lote nativo **finalizado** nunca a executa (I17i). Falha transitória aborta
> e a retomada refaz o item (I17f/g). Ver `vinculo-codbar-item-sispag.md`.
>
> **Emenda ADR-0076 (`planned`) — etapa `preparar_bordero` (boleto agrupado).** Entre `criarLote` e `importar`,
> **persistida** no write-ahead (escreve no ERP; diferente de `vincular_codbar`): marcador de correlação antes
> do `POST fin010`, `borCod` logo depois. Reconhecimento ao vivo, por grupo:
>
> | Estado observado | Ação |
> |---|---|
> | marcador gravado, `borCod` ausente, nenhum borderô com o marcador | cria |
> | exatamente um borderô com o marcador | adota |
> | dois ou mais borderôs com o marcador | `indeterminado` |
> | borderô com parte das baixas | completa só as faltantes |
> | baixa de título que não é do grupo | `indeterminado` (terceiro) |
> | borderô completo, não importado | `importar` |
> | item com o `borCod` no rascunho | pula |
> | borderô finalizado antes da remessa | `indeterminado` + `Alerta` (alguém baixou por fora) |
> | grupo com J rejeitado antes; borderô antigo **ausente ou cancelado** no `fin010` (a analista o resolveu) | cria um novo |
> | grupo com J rejeitado antes; borderô antigo aparece em `borderosPendentes` do lote novo (V7) | **reaproveita**: adota o `borCod` antigo no write-ahead novo, confere as N baixas (títulos e valores pela I19b ao vivo) e `vlrTotalLiquido == valorBoleto`, importa; nunca cria um segundo borderô |
> | grupo com J rejeitado antes; borderô antigo em cadastro mas **fora** de `borderosPendentes`, ou com baixas divergentes | grupo **retirado** (I19p(3), motivo `BORDERO_ANTERIOR_NAO_RESOLVIDO`), **sem** limpar o borderô antigo (I19q); `Alerta` `sispag-bordero-grupo-pendente`; a remessa segue com os demais |
>
> A tabela "Aberto, com PARTE das chaves" passa a contar `borCod`s como chaves. Lote nativo **finalizado**
> nunca limpa borderô (I19q). Ver `boleto-agrupado-sispag.md` (I19l, I19q, I19r, I19s).

### Write-ahead obrigatório (a ordem é a regra)

1. **Marca d'água** antes do `criarLote`: maior `flpCod` de `(filCod, bncCod)` + `ccoCod` +
   `dataDebito`. É o que torna reconhecível o lote criado numa queda que não gravou o número.
   A adoção já compara com a `dataDebito` **gravada no `requestPayload`** da tentativa anterior, não
   com a de agora. Desde a ADR-0049 essa data também passa a ser escolhida pela analista e persistida
   no lote (`LotePagamento.dataDebito`), e é **imutável** enquanto o lote nativo existir (I8b): a
   retomada nunca a recalcula. Ver `data-debito-remessa-sispag.md`.
2. `setNativeFlpCod` imediatamente após o `criarLote` responder.
3. **Nome do arquivo** antes do `gerarRemessa`. Sem ele a etapa final é indeterminável: o ERP
   recicla `flpCod`, então "o primeiro arquivo com conteúdo" pode ser de outro lote.

## Máquina de retomada — conciliação

| Estado do arquivo no `fin052` | Ação |
|---|---|
| `processadoEm` preenchido | pula o `processar`, segue da leitura |
| Arquivo existe, sem `processadoEm` | refaz (não há baixa no fin010 para duplicar) |
| Arquivo não pôde ser lido | fail-closed (`ConciliacaoEmDuvidaError`) |

> **A sincronização (L11, ADR-0055) não entra nesta máquina.** Ela é read-only no ERP: nunca
> `carregar`, nunca `processar`, não abre linha em `conciliacao_execucao`. Um arquivo sem
> `processadoEm` continua sendo decisão do caminho administrativo (`conciliarRetorno`,
> `processar=true`), que segue mantido. Consequência: um `.RET` carregado e nunca processado
> (gar 10, 25/09) não bloqueia `BAIXADO` se os títulos estão baixados por outra via.

## O que continua travando — e por quê

Três casos. Nenhum é limitação técnica; cada um é uma escolha.

1. **Órfão sem `flpCod` e sem marca d'água** (execução anterior ao mecanismo) — não há como
   reconhecer o lote.
2. **Dois ou mais candidatos com a mesma assinatura** acima da marca d'água — adotar o errado
   importaria títulos no lote de outra pessoa. A regra do **exatamente um** é a salvaguarda.
3. **Título intruso no lote nativo** (chave que não está no nosso lote) — alguém montou pelo ERP;
   completar o import misturaria a intenção de duas pessoas.

E um quarto que não trava, mas **pergunta**: lote cancelado. Cancelar o órfão é a limpeza que a
nossa própria mensagem prescreve, então o retry deveria seguir — mas o cancelamento também pode
ter sido a decisão de abortar o pagamento, e o ERP deixa o **mesmo** status nos dois casos. Como
o sistema não distingue a intenção, a tela pergunta e um segundo clique decide.

## Falha de leitura ≠ ausência

Invariante que aparece três vezes na implementação e vale registrar: **uma leitura que falha
nunca é tratada como "não existe"**. `listarChavesDoLote` devolve `undefined` (não `Set` vazio)
quando falha, porque vazio mandaria reimportar tudo; `getArquivoRetorno` devolve `undefined` em
vez de "não processado", porque isso mandaria reprocessar. Na sincronização (ADR-0055),
`getTituloAPagar` e `listBaixasTitulo` seguem a mesma regra: falha de leitura nunca vira "pago" nem
"não pago", e o lote fica onde está (I11c).

## Verificação

- Unitário: `RemessaService.test.ts`, `ConciliacaoRetornoService.test.ts`.
- **Ao vivo (o gate que vale):** `jobs/validate-retomada-remessa-v1.ts` interrompe a sequência em
  cada ponto em HML e afirma que a filial termina com **exatamente os lotes esperados**.
