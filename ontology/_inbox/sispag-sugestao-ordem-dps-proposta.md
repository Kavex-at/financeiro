# Proposta — âncora DPS na sugestão de boleto DDA (SISPAG)

`/feature-tweak sugestao-boleto-dda "desempatar pelo número da DPS"`. `entity_changed = true`.
Base: `origin/main` v0.69.0, ontologia 0.43.0, último ADR 0072 → proposta **ADR-0073**, invariante **I15p**.
Status: **rascunho para aprovação** — nenhum código antes do OK.

## Evidência (medida em 2026-10-19, somente leitura)

- Para a MULTILOG (`pes_cod 386`), `boleto_dda.numero` = **nº da DPS + `000`**, não o nº da NFS-e.
  Provado no PDF do título 41155/1 (NFS-e 86666, DPS 776132, boleto `776132000`). A hipótese do
  número da fatura (I15f, `doc_esp_numero` × `numero`) casa **1 de 174** títulos.
- DPS e NFS-e são duas sequências crescentes por estabelecimento emissor. `numero/1000 − NFS-e` é quase
  constante por (credor, conta emissora): 689465–689466 (237:2656:0022101, fil 2), 6458–6462 (fil 4),
  deriva lenta em 0092740 (−21804..−21291 em 69 títulos, correlação 0,9998).
- Nas tarifas de valor fixo (R$ 97,06 / 122,52 / 286,37 / 147,99) até 6 títulos disputam o mesmo
  valor e dia: valor/vencimento não desempatam; **a ordem** desempata 1:1.
- O Conexos **não** guarda o DPS: `doc_esp_numero` = nº da NFS-e; `com243` não tem nenhuma NFS-e
  importada (fil 2). A única fonte é o **PDF da NFS-e no GED**.

## Decisões do maintainer (2026-10-19)

| # | Pergunta | Decisão |
|---|----------|---------|
| D1 | A regra de ordem vale para quem? | **Aprendida por (credor, emissor)**: só onde há prova; nunca chuta em escopo sem prova. |
| D2 | Quando buscar o PDF? | **Automático no job de sincronização**, só para os títulos que a ordem não resolveu. |
| D3 | O que a âncora DPS autoriza? | **Confirmável pela analista** (como as âncoras atuais); o sistema nunca confirma. |

## Regra proposta — I15p "Âncora DPS"

Um par (título, boleto) do envelope é **ancorado por DPS** quando, no escopo (`pesCod`, `emissorChave`) (I15g):

1. **DPS conhecido** — o título tem DPS lido do PDF e `numero` do boleto = `DPS` seguido de `000`
   (dígitos estritos). Prova direta; vale em qualquer escopo.
2. **Ordem** — o escopo está **provado** (tem ≥ 1 DPS lido de PDF que casou exatamente um boleto do
   escopo) e, dentro de um **grupo** (mesmo valor; mesmos candidatos), os títulos ordenados por
   `doc_esp_numero` e os boletos `N000` ordenados por `numero` têm a **mesma quantidade**; o k-ésimo
   título casa com o k-ésimo boleto, **e** o pareamento é monotônico com os pontos de prova do escopo
   (nenhum par cruza um DPS conhecido). Qualquer violação = grupo não resolvido pela ordem.

Âncora DPS é **âncora** no sentido do ADR-0072: promove `ATENCAO` sem âncora → ancorada (confirmável)
e desempata `AMBIGUA` (o candidato ancorado vira o único confirmável). **Não** alarga limites (I15d):
um boleto vencido no débito segue `VENCIDO_INFORMATIVO` (I15h); `VENCE_ANTES_DO_TITULO` segue exigindo
reconhecimento (I15o). A confirmação continua sendo da analista (I15g).

**Busca do PDF (D2):** o job de sincronização lista os títulos elegíveis que, depois da regra 2, seguem
`AMBIGUA` ou só com `ATENCAO` sem âncora **em escopo cujos boletos são `N000`**; para cada um, baixa o
PDF da NFS-e do GED, extrai "NÚMERO DA DPS" e grava. Um título é lido **uma vez** (DPS gravado, ou falha
gravada com motivo e nova tentativa limitada). Somente leitura no Conexos (I15b).

## Mudança de dados

Tabela nova `titulo_dps` (`fil_cod`, `doc_cod`, `tit_cod`) → `dps` (nullable), `nfse_lida`, `fonte`
(`PDF_GED`), `status` (`LIDO` / `SEM_PDF` / `SEM_DPS_NO_PDF` / `ERRO`), `tentativas`, `lido_em`.
Aditiva, sem backfill. Não é evidência de confirmação, é insumo da sugestão.

## Em aberto (bloqueia só a busca do PDF)

- ~~**P0 — onde está o PDF no GED?**~~ **Respondido (2026-10-19):** `psq014` → botão GED → `arq020`
  (Arquivamento de Documentos - GED) com `telaOrigin=TelaDocumento&codeView=psq014&filCod=2&docTip=2&
  docCod=41155&priCod=4100`; pasta 46415 (processo 4100, ref. `0038BTC/26`), arquivo `NF_86666.PDF`
  (o nome traz o nº da NFS-e). Falta mapear os endpoints do `arq020` (listar pasta, baixar arquivo).
- **Aprovado pelo maintainer em 2026-10-19** → ADR-0073, I15p. Etapa 1 (motor + `titulo_dps`) entregue.
- **P1 — o robô CLONEX lê o GED?** Conferir permissão antes do job (ver memória de permissões).
- **P1 — biblioteca de PDF:** dependência nova (`pdfjs-dist` ou `pdf-parse`) só no backend.

## Fora do escopo

Confirmação automática (passo 3); outros credores além da prova; tocar a regra de número igual (I15f) —
segue como está, só deixa de ser a única âncora numérica.
