# GAP FECHADO — listar no painel as NDes emitidas FORA da ferramenta

**Status:** ✅ **RESOLVIDO em 2026-08-17**, no mesmo ciclo em que foi aberto.
**Origem:** `/feature-tweak nota-debito-eletronica` (ADR-0037) · **Resolvido por:** HAR do Yuri +
probe read-only (`src/backend/jobs/probe-com297-list.ts`).

## O que faltava

A aba NDe listava só as notas cuja execução passou por nós. Uma NDe emitida direto no Conexos não
aparecia, porque não existe execução nossa para ela. Faltava o endpoint de **listagem** do com297 —
só conhecíamos `GET /api/com297/{docCod}`, um documento por vez.

## Como foi resolvido

O Yuri capturou o HAR de **`POST /api/com297/list`** (grid da tela de Fiscais de Saída) e um probe
read-only confirmou o contrato em produção. Achados:

| Descoberta | Valor | Consequência |
|---|---|---|
| `tpdCod` da família NDe | **167** | filtro por CÓDIGO (`tpdCod#EQ`), não por `tpdDesNome#LIKE` |
| equivalência código ⟷ nome | mesmo `count`, nenhum outro tipo | a troca do filtro é segura |
| `docVldTipo` / `docVldTipoAdto` | 7 / 0 | ⚠️ **não** confundir com `NDE_GLOBAL_DOC_VLD_TIPO = 0` |
| `vldAutorizado` no `fieldList` | sim | hidratação vira **1 POST por filial** (era até 20 GETs) |
| `docEspNumero` no grid | 0 de 10 vazios | fonte confiável do número (o GET por docCod devolve `"0"`) |
| `vldStatus` observado | só `3` | mapa de status segue não confirmado — **não filtramos por ele** |
| universo em PRD | 10 NDes (filial 2), 1 (filial 4) | cabe em uma página; paginação existe para crescer |

Implementado em `ConexosNdeFiscalClient.listNdes`, consumido por
`RecebimentosPainelService.hidratarNdes`. Linhas sem execução nossa entram na aba com
`origem: 'erp'` e o chip "fora da ferramenta". Ver a **Emenda** do ADR-0037.

## Armadilha descoberta no caminho (vale para qualquer leitura do com297)

O helper `listGenericPaginated(serviceName, …)` monta **`POST /{serviceName}`** — e no com297 essa
rota é a **CRIAÇÃO de documento**, não a listagem. A primeira versão do probe usou o helper e bateu
9× no endpoint de criação (todas rejeitadas com `400 VALIDATION`; nada foi criado, e o maior `docCod`
seguiu 18790). **No com297, o que separa ler de escrever é o sufixo `/list`** — o path tem de ser
literal. Registrado no docstring do `listNdes` e do probe.

## O que continua aberto (menor)

- **Semântica de `vldStatus`.** A tela do ERP filtra `IN [1,2,3,7]`; em PRD só existe `3`
  (mapeado como "Finalizada" no `SOLICITACAO_NUMERARIO_STATUS_LABEL`, também marcado como aposta).
  Não filtramos por status justamente por isso — filtrar por um valor não entendido esconderia NDe
  real. Se algum dia precisarmos distinguir cancelada de ativa, esta é a pergunta a responder.
- **Bulk-read do número na cauda fiscal.** A leg de escrita (`etapaPoll`) continua usando
  `GET com297/{docCod}` por documento, o que é correto lá (é um poll de UM documento recém-criado).
