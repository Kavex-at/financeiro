---
name: aprovacao-titulo
type: state-machine
entity: TituloAprovacao
ontology_version: "0.10"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/interface/aprovacoes/constants.ts
  - src/backend/domain/service/aprovacoes/StatusWorkflowResolver.ts
  - src/backend/domain/service/aprovacoes/TrilhaAprovacaoService.ts
  - src/frontend/app/aprovacoes/components/status-badges.tsx
last_review: 2026-08-19
states: [SEM_WORKFLOW, AGUARDANDO, APROVADO, REJEITADO, INDETERMINADO]
out_of_scope_states: []
---

# Ciclo de vida — status de aprovação de um `TituloAprovacao`

> **Vigência:** 2026-08-19 (ADR-0038). Este status é **derivado**, não armazenado como verdade
> própria: ele é recalculado a partir das [`EtapaAprovacao`](../entities/etapa-aprovacao.md) do
> título a cada ingestão. Não há transição comandada por usuário — a Frente V é read-only no ERP
> (I1). O que "transiciona" é a leitura: o ERP muda, nós observamos, o status recalcula.

## Estados (constantes tipadas)

| Constante (TS) | Valor | Significado |
|----------------|-------|-------------|
| `SEM_WORKFLOW` | `SEM_WORKFLOW` | O título existe e **não tem nenhuma etapa** de aprovação. Não é erro nem ausência de dado — cerca de **metade** dos títulos da filial 2 está aqui. É informação de diagnóstico |
| `AGUARDANDO` | `AGUARDANDO` | Há **pelo menos uma etapa `PENDENTE`** e nenhuma indeterminada. O título está parado com alguém |
| `APROVADO` | `APROVADO` | **Todas** as etapas conhecidas estão `CONCLUIDA`. Terminal enquanto o ERP não criar etapa nova |
| `REJEITADO` | `REJEITADO` | Alguma etapa terminou em recusa/cancelamento explícito. **Ainda não observado em produção** — ver nota abaixo |
| `INDETERMINADO` | `INDETERMINADO` | Alguma etapa tem `statusErp` fora do conjunto conhecido. **Sempre acompanhado de `lacunas[]`** |

## Regra de derivação (princípio P3 — regra explícita)

Aplicada **na ordem**, a primeira que casar vence:

| # | Condição | Estado | Por quê a ordem |
|---|----------|--------|-----------------|
| 1 | nenhuma etapa ativa | `SEM_WORKFLOW` | — |
| 2 | alguma etapa `INDETERMINADO` | `INDETERMINADO` | **Precede tudo** (I4): se não sabemos ler uma etapa, não podemos afirmar que o título foi aprovado |
| 3 | alguma etapa `REJEITADA` | `REJEITADO` | Uma recusa domina aprovações parciais |
| 4 | alguma etapa `PENDENTE` | `AGUARDANDO` | — |
| 5 | todas `CONCLUIDA` | `APROVADO` | Só se sobreviveu a 2, 3 e 4 |

> **Por que `INDETERMINADO` precede `REJEITADO` e `AGUARDANDO`:** as três regras a seguir afirmam
> algo sobre o título. Havendo uma etapa ilegível (hoje, os 13 casos de `ftbVldStatus = 7` — PV-01),
> qualquer afirmação pode estar errada. O estado honesto é "não sei", e a UI mostra a lacuna.

## Transições

Não há ações de usuário. As transições são **consequência da observação**:

| ID | De → Para | Gatilho |
|----|-----------|---------|
| A1 | _(inexistente)_ → qualquer | `ingerirTrilhaAprovacao` observa o título pela primeira vez |
| A2 | `SEM_WORKFLOW` → `AGUARDANDO` | O ERP criou a primeira etapa desde a última observação |
| A3 | `AGUARDANDO` → `AGUARDANDO` | Etapa concluída, mas restam pendentes (aprovação parcial) |
| A4 | `AGUARDANDO` → `APROVADO` | Última etapa pendente foi concluída |
| A5 | `AGUARDANDO` → `REJEITADO` | Uma etapa foi recusada/cancelada |
| A6 | qualquer → `INDETERMINADO` | Surgiu etapa com `statusErp` desconhecido |
| A7 | `INDETERMINADO` → qualquer | PV-01 fechada e as etapas reclassificadas por migration |
| A8 | `APROVADO` → `AGUARDANDO` | **`regerarBloqueios`** recriou a trilha no ERP (PV-06) |

> **A8 é a transição desconfortável.** Um título aprovado pode voltar a aguardar se a operação regerar
> os bloqueios. Não é bug: é o ERP sendo a fonte da verdade. As etapas antigas ficam `ativo = false`
> (I6), preservando a auditoria do que já havia acontecido.

## Nota sobre `REJEITADO`

**Nenhuma ocorrência foi observada** na sondagem de produção (169 etapas resolvidas, todas `LIBERAR`
ou `APROVAR`). O estado existe porque o ERP tem `motCodCanc`/`motDesNomeCanc` e a ação de cancelar
bloqueio, mas **a regra que o produz ainda não pôde ser validada contra dado real**. Tratado como
estado alcançável e testado por unidade; se `fbaDesNome` trouxer uma ação de recusa em produção, o
mapeamento em `constants.ts` cobre.

## Vínculo com a UI

O badge do painel usa exatamente estes cinco estados. `INDETERMINADO` **não** é renderizado como
erro nem escondido: é um estado de primeira classe, com a lacuna visível ao lado (I3/I4/I7).
