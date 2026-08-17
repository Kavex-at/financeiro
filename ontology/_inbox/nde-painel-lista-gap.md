# GAP — listar no painel as NDes emitidas FORA da nossa ferramenta

**Prioridade:** P1 (desejável — não bloqueia a aba NDe, que já lista o que nós emitimos)
**Aberto em:** 2026-08-17 · **Origem:** `/feature-tweak nota-debito-eletronica` (ADR-0037)
**Dono da resposta:** Yuri (captura de HAR em produção)

## O que falta

A aba NDe lista as notas cuja **execução passou por nós** (`solicitacao_numerario_execucao` LEFT JOIN
`nota_debito_eletronica`). Uma NDe emitida direto no Conexos por um analista — sem passar pelo
"Processar" — **não aparece**, porque não existe execução nossa para ela.

## Por que não dá para resolver hoje

Não há endpoint de **listagem/grid/pesquisa** do `com297` mapeado. O único read conhecido é
`GET /api/com297/{docCod}` (um documento por vez, usado no poll do SEFAZ). Sem o grid, não há como
enumerar documentos por filial/período.

## O que destrava

Captura de **HAR real de produção** da tela de **Fiscais de Saída (com297)** fazendo uma pesquisa por
filial + período — mesma abordagem que mapeou o `fin095` do extrato. Do HAR precisamos de:

1. rota + verbo do grid (provável `POST com297/documento/list` ou similar);
2. shape do filtro (filial, faixa de datas, `docVldTipo` da nota de débito);
3. shape da linha devolvida (`docCod`, `docEspNumero`, `vldAutorizado`, valor, cliente);
4. paginação (offset/limit, total).

## Como responder

Anexe o HAR (ou o resumo dos requests) abaixo e mova este arquivo para `_inbox/answered/`.

---

**Resposta:**
