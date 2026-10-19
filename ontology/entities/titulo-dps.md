---
name: TituloDps
type: entity
ontology_version: "0.44.0"
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0087_sispag_titulo_dps.sql
  - src/backend/domain/interface/sispag/TituloDps.ts
  - src/backend/domain/repository/sispag/TituloDpsRepository.ts
  - src/backend/domain/service/sispag/AncoraOrdemDps.ts
  - src/backend/domain/service/sispag/MotorSugestaoBoleto.ts
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

`partial`: tabela, repositório e consumo pelo motor entregues; o leitor do GED (job que preenche a
tabela) está pendente — até ele existir a âncora DPS fica dormente.
