---
name: idempotencia-ingestao-aprovacao
type: business-rule
entity: TituloAprovacao
ontology_version: "0.10"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0049_aprovacao_trilha.sql
  - src/backend/domain/repository/aprovacoes/TituloAprovacaoRepository.ts
  - src/backend/domain/repository/aprovacoes/EtapaAprovacaoRepository.ts
  - src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts
  - src/backend/jobs/ingest-aprovacoes.ts
last_review: 2026-08-19
---

# Regra — idempotência e retomada da ingestão de trilhas

> A ingestão da Frente V é **cara e longa**: hoje custa **uma chamada ao ERP por título**, sobre
> 23.632 títulos só na filial 2 em 12 meses (PV-07). Uma ingestão que não seja retomável obriga a
> recomeçar do zero a cada falha de rede — e uma que não seja idempotente corrompe o histórico.

## Enunciado

1. **UPSERT por chave natural.** Título: `(fil_cod, doc_cod, tit_cod)`.
   Etapa: `(fil_cod, doc_cod, tit_cod, fbl_cod, ftb_cod)`.
   Reprocessar o mesmo título **nunca** duplica linha.
2. **Anti-fantasma por título, não global.** Ao reprocessar um título, as etapas dele que **não**
   vieram na leitura atual viram `ativo = false`. Etapas de títulos **não visitados** nesta run
   permanecem intocadas.
3. **Nada é apagado** (I6). Uma etapa que some do ERP (`regerarBloqueios`, PV-06) fica inativa com o
   último estado conhecido.
4. **Progresso persistido.** Cada run grava, em `aprovacao_ingestao_run`, a página do universo e o
   último título concluído. Uma execução interrompida retoma daí.
5. **Exclusão mútua.** `withAdvisoryLock` impede duas runs concorrentes; a segunda falha rápido em
   vez de duplicar trabalho.

## Por que o anti-fantasma é por título, e não global

A doutrina da Frente II marca inativo tudo que ficou fora da run mais recente
(`marcarInativosForaDaRun`). **Aqui isso seria destrutivo.**

O backfill da Frente V é **parcial por natureza** — processa uma janela, pode ser interrompido, pode
cobrir uma filial de cada vez. Aplicar "fora da run atual = inativo" globalmente marcaria como
fantasma todo o histórico já ingerido que simplesmente não foi revisitado nesta passada.

Por isso o escopo do anti-fantasma é **o título que acabamos de reler**: dele sabemos a verdade
completa naquele instante. Sobre os demais, não afirmamos nada.

## Por que a retomada é por título, não por lote

O ERP é consultado título a título. Se a run cair no título 12.000 de 23.632, retomar do início
custaria ~12 mil chamadas desnecessárias e horas de relógio. Gravar o cursor (`ultimo_doc_cod`,
`ultimo_tit_cod`, `pagina_universo`) transforma o custo da falha em quase zero.

O cursor é gravado **depois** de o título ser persistido com sucesso — se a run cair no meio de um
título, ele é reprocessado, e o UPSERT torna isso inofensivo.

## Ordenação estável do universo

A retomada só funciona se a listagem do universo for **determinística entre execuções**. A varredura
do `psq014/list` usa ordenação explícita por `docCod` e paginação por `pageNumber`; sem `orderList`
o Conexos não garante ordem estável entre páginas, e a retomada pularia ou repetiria títulos.

## Contrato de teste

| Cenário | Resultado esperado |
|---------|--------------------|
| Ingerir o mesmo título duas vezes | 1 linha de título, N linhas de etapa; `observado_em` atualizado |
| Etapa some do ERP entre duas runs | Linha preservada com `ativo = false` |
| Run interrompida no título K | Nova run retoma em K, não em 0 |
| Duas runs simultâneas | A segunda falha com erro de lock, sem escrever |
| Título sem etapas | `status_workflow = SEM_WORKFLOW`, zero linhas em `etapa_aprovacao` |
