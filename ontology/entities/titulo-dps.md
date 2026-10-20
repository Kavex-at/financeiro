---
name: TituloDps
type: entity
ontology_version: "0.44.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0087_sispag_titulo_dps.sql
  - src/backend/domain/interface/sispag/TituloDps.ts
  - src/backend/domain/repository/sispag/TituloDpsRepository.ts
  - src/backend/domain/service/sispag/AncoraOrdemDps.ts
  - src/backend/domain/service/sispag/MotorSugestaoBoleto.ts
  - src/backend/domain/client/ConexosGedClient.ts
  - src/backend/domain/interface/sispag/GedArquivo.ts
  - src/backend/domain/libs/pdf/ExtratorTextoPdf.ts
  - src/backend/domain/service/sispag/LeituraDanfse.ts
  - src/backend/domain/service/sispag/SelecaoLeituraDps.ts
  - src/backend/domain/service/sispag/LeitorDpsService.ts
  - src/backend/jobs/ler-dps-nfse.ts
properties:
  - filCod
  - docCod
  - titCod
  - pesCod
  - nfse
  - dps
  - status
  - fonte
  - arquivo
  - motivo
  - tentativas
  - lidoEm
---

# TituloDps

Número da **DPS** (Declaração de Prestação de Serviço) de um título a pagar, lido do PDF da NFS-e no GED
do Conexos. Insumo da sugestão de boleto DDA (I15p, ADR-0073): o emissor de NFS-e numera o boleto como
`<DPS>000`. O Conexos não guarda o DPS em lugar nenhum consultável.

## Propriedades

| Propriedade | Tipo | Regra |
|-------------|------|-------|
| `filCod`, `docCod`, `titCod` | chave | um registro por título |
| `pesCod` | texto | credor; prova o escopo (credor, emissor) mesmo fora da carteira |
| `nfse` | texto | nº da NFS-e lido do PDF (ou `doc_esp_numero`) |
| `dps` | texto | só dígitos; presente só quando `status = LIDO` |
| `status` | `LIDO` · `SEM_PDF` · `SEM_DPS_NO_PDF` · `ERRO` | tentativa registrada com motivo |
| `fonte` | `PDF_GED` | única fonte hoje |
| `arquivo` | texto | nome do arquivo lido (ex.: `NF_86666.PDF`); nunca o conteúdo |
| `tentativas` | inteiro ≥ 1 | reler soma 1; limita nova tentativa de quem falhou |

## Invariantes

- Não é evidência de confirmação: só alimenta o motor (I15g segue: quem confirma é a analista).
- Somente leitura no Conexos (I15b).
- `LIDO` ⇔ `dps` numérico (CHECK da 0087).

## Estado

`implemented` (app v0.70.0). Quem preenche: o job `ler-dps-nfse` (último passo do cron do SISPAG),
só para os títulos que a ordem não desempatou. Caminho no Conexos, todo leitura:
`psq014/{fil}/{docTip=2}/{doc}` (processo) → `arq020/TelaDocumento/list` (pastas) →
`arq020/arqDocFiles/list/{dcmCod}` (arquivos; escolhe o PDF com o nº da NFS-e no nome) →
`arq020/arqDocFiles/download/{dcmCod}/{seq}` (string JSON com o PDF em base64).

Medido ao vivo (2026-10-19/20): DANFSe v2.0 nacional ("NÚMERO DA DPS") e DANFSE do portal
municipal ("Número DPS") lidos; 4 de 4 DPS iguais ao previsto (776132, 776138, 775530, 25459).
CT-e (DACTE, conta 0092740 da MULTILOG) não tem DPS: fica `SEM_DPS_NO_PDF`, por desenho.
`GET com298/{docCod}` não acha documento só financeiro (`vldFisFin: 1`) — não serve para o processo.
