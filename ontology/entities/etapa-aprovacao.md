---
name: EtapaAprovacao
type: entity
ontology_version: "0.10"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0049_aprovacao_trilha.sql
  - src/backend/domain/interface/aprovacoes/EtapaAprovacao.ts
  - src/backend/domain/interface/aprovacoes/constants.ts
  - src/backend/domain/repository/aprovacoes/EtapaAprovacaoRepository.ts
  - src/backend/domain/service/aprovacoes/TrilhaAprovacaoService.ts
  - src/backend/domain/client/ConexosAprovacoesClient.ts
  - src/frontend/app/aprovacoes/components/TrilhaDrawer.tsx
properties:
  - filCod
  - docCod
  - titCod
  - fblCod
  - ftbCod
  - nome
  - alcada
  - acao
  - responsavelNome
  - responsavelCod
  - statusErp
  - status
  - recebidoEm
  - agidoEm
  - duracaoSegundos
  - observacao
  - ativo
  - ingestaoRunId
  - observadoEm
relationships:
  - "EtapaAprovacao N—1 TituloAprovacao (via filCod:docCod:titCod)"
  - "EtapaAprovacao N—1 AprovacaoIngestaoRun (via ingestaoRunId)"
last_review: 2026-08-19
universality_evidence:
  - "Sondagem read-only em produção (2026-08-18), doc 4156/1 filial 1: CONTROLLER · COMPRAS · LIBERAR · DANILO_LARA, recebido 2026-05-14 07:12:46 e liberado 2026-05-15 06:41:40"
  - "ontology/_inbox/frente-v-probe-resultado.md §2 — 11 etapas distintas na filial 2 (CONTROLLER 105, TI 22, WALTER 14, DIRETORIA II 7, …) e 14 pessoas identificadas"
  - "Conceito universal: uma etapa de alçada tem um responsável, um instante em que passa a existir e um instante em que é resolvida; a diferença é o tempo de espera"
---

# EtapaAprovacao (um passo da trilha de aprovação)

> Uma **etapa** é um bloqueio de título no Conexos: a exigência de que alguém de uma determinada
> alçada libere aquele título. É a unidade que carrega **quem**, **quando recebeu**, **quando agiu** e
> — derivado desses dois — **quanto tempo levou**. É o dado que a Frente V existe para expor.

## Definição de domínio

No Conexos, o workflow de aprovação **não é um módulo próprio**: é implementado como bloqueio por
alçada (`FinTituloBloq`). Cada linha é uma etapa que o título precisa vencer.

Exemplo real (produção, doc 4156/1, filial 1):

```
fblDesNome    = CONTROLLER     → nome da etapa
aprovador     = COMPRAS        → rótulo da alçada
fbaDesNome    = LIBERAR        → ação tomada
usnDesNomeCmd = DANILO_LARA    → quem agiu
ftbTimBloq    = 2026-05-14 07:12:46 BRT  → recebeu
ftbTimCmd     = 2026-05-15 06:41:40 BRT  → agiu
ftbVldStatus  = 2              → respondido
                                 duração: 23h29m
```

## Propriedades

| Propriedade | Tipo | Origem (wire → coluna) | Notas |
|-------------|------|------------------------|-------|
| `filCod` `docCod` `titCod` | number | `FinTituloBloq` → `fil_cod` `doc_cod` `tit_cod` | Título dono da etapa (I5) |
| `fblCod` | number | `fblCod` → `fbl_cod` | Tipo de bloqueio. Parte da chave natural |
| `ftbCod` | number | `ftbCod` → `ftb_cod` | Instância do bloqueio no título. Parte da chave natural |
| `nome` | string? | `fblDesNome` → `nome` | Ex.: `CONTROLLER`, `TI`, `FISCAL`, `DIRETORIA II` |
| `alcada` | string? | `aprovador` → `alcada` | **Rótulo de alçada, não identidade.** Mistura setor (`COMPRAS`) e pessoa (`RICARDO DO PRADO`) — ver PV-10 |
| `acao` | string? | `fbaDesNome` → `acao` | `LIBERAR` (122×) ou `APROVAR` (34×). Diferença de negócio em aberto — **PV-02** |
| `responsavelNome` | string? | `usnDesNomeCmd` → `responsavel_nome` | **A pessoa que agiu.** Chave do analítico da Fase 2 |
| `responsavelCod` | number? | `usnCodCmd` → `responsavel_cod` | **Hoje sempre `null`** — não vem na projeção acessível. Coluna já existe para receber o dado quando **PV-07** for resolvida |
| `statusErp` | number? | `ftbVldStatus` → `status_erp` | **Valor bruto preservado**, mesmo desconhecido. Permite reclassificar sem reingerir |
| `status` | enum | derivado → `status` | `PENDENTE` \| `CONCLUIDA` \| `INDETERMINADO`. Ver [máquina de estados](../state-machines/etapa-aprovacao.md) |
| `recebidoEm` | Date? | `ftbTimBloq` (epoch ms) → `recebido_em` | Campo `Tim*` — **preserva hora, minuto e segundo**. Semântica em **PV-03** |
| `agidoEm` | Date? | `ftbTimCmd` → `agido_em` | `null` enquanto pendente |
| `duracaoSegundos` | number? | derivado → `duracao_segundos` | `agidoEm − recebidoEm`. **`null` quando pendente** (I3) — nunca estimado |
| `observacao` | string? | `ftbEspObsCmd` / `ftbEspInfo` → `observacao` | |
| `ativo` | boolean | anti-fantasma → `ativo` | Etapa que some do ERP vira inativa, **nunca é apagada** (I6, PV-06) |
| `ingestaoRunId` | string? (UUID) | FK | Auditoria |
| `observadoEm` | Date | → `observado_em` | Idade do snapshot |

## `statusErp` bruto + `status` derivado — por que os dois

O ERP devolve `ftbVldStatus` numérico **sem legenda no spec**. Observado em produção:

| `ftbVldStatus` | Ocorrências | `status` derivado |
|---|---|---|
| `1` | 8 | `PENDENTE` (nesses, `ftbTimCmd == ftbTimBloq`) |
| `2` | 156 | `CONCLUIDA` |
| `7` | **13** | **`INDETERMINADO`** — significado desconhecido (**PV-01**) |

Guardar o valor bruto em `statusErp` permite **reclassificar por migration** assim que PV-01 fechar,
sem precisar reingerir 23 mil títulos.

**Invariante I4:** status desconhecido **nunca** vira `CONCLUIDA`. Classificar 13 etapas reais como
aprovadas por chute contaminaria o tempo médio de um painel financeiro auditável.

## Duração

`duracaoSegundos = agidoEm − recebidoEm`, em **segundos corridos**, fuso `America/Sao_Paulo`.
Ver [regra de negócio](../business-rules/duracao-etapa-aprovacao.md).

Distribuição observada (169 etapas resolvidas, filial 2): mediana **2,5 h**, média 20,4 h,
p90 **70 h**, máximo **234 h**. A assimetria é o achado — a média sozinha esconde a cauda.

## Chave natural e idempotência

`(fil_cod, doc_cod, tit_cod, fbl_cod, ftb_cod)`. UPSERT a cada ingestão (I2). Reprocessar o mesmo
título não duplica etapa.

## Fora de escopo

- Aplicar comando/liberar pelo painel (I1 — read-only).
- Configuração de alçadas (`fin102`/`fin106`) — não modelada; depende de PV-07.
- Etapas de aprovação de outros domínios (pedidos, contábil, importação).
