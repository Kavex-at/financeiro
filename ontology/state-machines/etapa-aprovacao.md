---
name: etapa-aprovacao
type: state-machine
entity: EtapaAprovacao
ontology_version: "0.10"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/interface/aprovacoes/constants.ts
  - src/backend/domain/service/aprovacoes/EtapaStatusResolver.ts
  - src/frontend/app/aprovacoes/components/TrilhaDrawer.tsx
last_review: 2026-08-19
states: [PENDENTE, CONCLUIDA, REJEITADA, INDETERMINADO]
out_of_scope_states: []
---

# Ciclo de vida — status de uma `EtapaAprovacao`

> **Vigência:** 2026-08-19 (ADR-0038). Derivado do `ftbVldStatus` bruto do ERP mais a presença de
> `ftbTimCmd`. Read-only: nós observamos, não comandamos.

## Estados

| Constante (TS) | Valor | Significado |
|----------------|-------|-------------|
| `PENDENTE` | `PENDENTE` | A etapa existe e ninguém agiu. `agidoEm` nulo ou igual a `recebidoEm`. **Sem duração** |
| `CONCLUIDA` | `CONCLUIDA` | Alguém aplicou uma ação (`LIBERAR` ou `APROVAR`). Tem `agidoEm` e duração |
| `REJEITADA` | `REJEITADA` | Recusa/cancelamento explícito. **Não observado em produção** ainda |
| `INDETERMINADO` | `INDETERMINADO` | `statusErp` fora do conjunto conhecido — hoje, `7` (**PV-01**) |

## Regra de derivação (princípio P3)

```
statusErp = 1  →  PENDENTE
statusErp = 2  →  CONCLUIDA   (exige agidoEm > recebidoEm; senão PENDENTE)
statusErp ∉ {1,2}  →  INDETERMINADO   +   lacuna registrada no título
```

Mapeamento em `ETAPA_STATUS_ERP` (`src/backend/domain/interface/aprovacoes/constants.ts`).
**Nunca use o número cru fora desse mapa** — é a única porta de entrada, para que fechar PV-01 seja
uma edição de uma linha.

### Por que `CONCLUIDA` exige `agidoEm > recebidoEm`

Nas 8 etapas pendentes observadas, `ftbTimCmd == ftbTimBloq` — o ERP carimba o mesmo instante nos
dois campos enquanto ninguém agiu. Tratar isso como conclusão criaria **169 etapas com duração
zero** e afundaria a mediana. A checagem de ordem estrita é o que separa "resolvida" de "recém-criada".

## Transições

| ID | De → Para | Gatilho |
|----|-----------|---------|
| E1 | _(inexistente)_ → `PENDENTE` | O ERP criou o bloqueio; observamos na ingestão |
| E2 | `PENDENTE` → `CONCLUIDA` | Aprovador aplicou `LIBERAR`/`APROVAR`; `agidoEm` passa a ser maior que `recebidoEm` |
| E3 | `PENDENTE` → `REJEITADA` | Recusa/cancelamento (não observado ainda) |
| E4 | qualquer → `INDETERMINADO` | `statusErp` desconhecido |
| E5 | `INDETERMINADO` → real | PV-01 fechada; reclassificação por migration sobre `status_erp` preservado |
| E6 | qualquer → **inativa** | A etapa sumiu do ERP (`regerarBloqueios`, PV-06). `ativo = false`, **nunca deletada** (I6) |

> **E6 não é um estado, é uma flag ortogonal.** Uma etapa inativa preserva o status que tinha na
> última vez em que foi vista. A trilha exibida mostra só as ativas; a auditoria mantém todas.

## Duração

Calculada **somente** em `CONCLUIDA` (e `REJEITADA`, quando houver). Em `PENDENTE` e
`INDETERMINADO`, `duracaoSegundos` é `null` — **nunca estimado** (I3). O painel mostra, para
pendentes, "parada há X" calculado contra o **agora**, o que é outra coisa e está rotulado como tal.
