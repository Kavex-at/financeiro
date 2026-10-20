---
adr_number: 0073
title: SISPAG — âncora DPS na sugestão de boleto DDA (número do boleto = DPS + 000)
date: 2026-10-19
status: accepted
type: change
related_entities: [TituloDps, BoletoDda, DecisaoSugestaoBoleto, TituloAPagar]
related_business_rules: [sugestao-boleto-dda-sispag]
continues: [0068, 0072]
amends: [0072]
evidence:
  - ontology/_inbox/sispag-sugestao-ordem-dps-proposta.md
  - "leitura somente leitura em PRD (2026-10-19): 174 títulos MULTILOG (pes_cod 386) × boleto_dda; hipótese do número da fatura casa 1/174; numero/1000 − NFS-e quase constante por (credor, conta emissora)"
  - "PDF da NFS-e 86666 (título 41155/1) no GED: NÚMERO DA DPS 776132 = boleto 776132000"
---

# ADR 0073: âncora DPS na sugestão de boleto DDA

**Branch:** `worktree-sispag-dda-ordem-dps`. `/feature-tweak sugestao-boleto-dda`. `entity_changed = true`.
Ontologia **0.44.0**. Aprovado pelo maintainer em 2026-10-19.

## Contexto

Nas tarifas de valor fixo da MULTILOG (R$ 97,06 / 122,52 / 147,99 / 286,37), até seis títulos disputam
boletos de mesmo valor e dia. Valor e vencimento não desempatam, e o número do documento (I15f, NFS-e)
casa 1 de 174 títulos. O analista mostrou o elo certo: o boleto é numerado pelo **número da DPS**
(Declaração de Prestação de Serviço) seguido de `000`. DPS e NFS-e são duas sequências crescentes do
mesmo estabelecimento emissor (`numero/1000 − NFS-e` = 689465–689466 em `237:2656:0022101`, fil 2).

O Conexos **não guarda o DPS**: `doc_esp_numero` é o nº da NFS-e e o `com243` não tem a NFS-e importada.
A única fonte é o PDF da NFS-e no GED (`arq020`, aberto pelo `psq014` com `filCod/docTip/docCod/priCod`;
arquivo `NF_<nfse>.PDF` na pasta do processo).

## Decisão

Nova invariante **I15p — âncora DPS** (ver `business-rules/sugestao-boleto-dda-sispag.md`):

1. **DPS conhecido:** título com DPS lido do PDF casa o boleto cujo número é `<DPS>000` (sinal
   `DPS_IGUAL`).
2. **Ordem:** num escopo (`pesCod`, `emissorChave`) **provado** por ≥ 1 DPS lido que casou um boleto do
   pool, um grupo conexo de candidatos com tantos títulos quanto boletos casa o k-ésimo título por NFS-e
   com o k-ésimo boleto por número (sinal `ORDEM_DPS`). Qualquer dúvida (contagens diferentes, título sem
   NFS-e, boleto fora de `N000`, boleto disputado por título de fora do grupo, par que cruza um DPS
   conhecido, par fora do envelope) = sem âncora; o título vai para a leitura do PDF.
3. Âncora DPS é **âncora** no sentido do ADR-0072 (ATENCAO ancorada é confirmável) e **reserva o boleto
   antes das demais camadas** (camada 0): é a prova de identidade mais forte do motor. Não sobe tier, não
   alarga limite (I15d), não toca I15h/I15o. Quem confirma segue sendo a analista (I15g).

Dados: tabela `titulo_dps` (0087), uma linha por título, com `pes_cod` e `nfse` para provar o escopo
mesmo depois que o título sai da carteira.

## Decisões do maintainer (2026-10-19)

| # | Pergunta | Decisão |
|---|----------|---------|
| D1 | Escopo da regra de ordem | Aprendida por (credor, emissor): só com prova; nunca chuta |
| D2 | Quando ler o PDF | Automático no job de sincronização, só para os títulos que a ordem não resolveu |
| D3 | O que a âncora autoriza | Confirmável pela analista (como as âncoras atuais) |

## Consequências

- Sem DPS lido, nada muda (a regra de ordem fica dormente até a primeira prova).
- **Entregue (app v0.70.0):** I15p no motor (`AncoraOrdemDps`, `RegraSugestaoBoleto`,
  `MotorSugestaoBoleto`), `titulo_dps` + `TituloDpsRepository`, sinais no front, e o leitor do GED
  (`ConexosGedClient`, `ExtratorTextoPdf` com `pdfjs-dist`, `LeituraDanfse`, `SelecaoLeituraDps`,
  `LeitorDpsService`, job `ler-dps-nfse` no cron do SISPAG).
- **Medido ao vivo (somente leitura):** o processo do título vem do `psq014` (o `com298/{docCod}` não
  acha documento só financeiro); o `download` do `arq020` devolve o PDF em base64 dentro de uma string
  JSON; dois layouts de DANFSe lidos ("NÚMERO DA DPS" e "Número DPS"); 4 de 4 DPS iguais ao previsto.
- **Limite conhecido:** emissor de CT-e (MULTILOG conta 0092740, DACTE da Qive) não imprime DPS — o
  escopo não se prova por PDF e a ordem fica dormente ali (os tiers de antes seguem valendo).
- **Permissão do robô:** o GED abriu na tela como CLONEX; a primeira execução do cron confirma pela API
  (falha geral → exit 1 → passo de alerta do workflow).

## Alternativas rejeitadas

- **XML da NFS-e no `com243`:** não há NFS-e importada (medido na fil 2).
- **Ler o PDF de todo título:** custo e carga no Conexos sem necessidade; a ordem resolve a maioria.
- **Ordem sem prova (qualquer emissor `N000`):** pareia errado onde o número do boleto não segue o DPS.
- **Auto-confirmar com DPS igual:** muda a política de humano no controle (passo 3, ADR própria).
