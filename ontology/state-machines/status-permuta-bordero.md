---
name: status-permuta-bordero
type: state-machine
entity: Permuta
ontology_version: "0.5"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/permutas/BorderoGestaoService.ts
  - src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts
  - src/backend/routes/permutas.ts
  - src/backend/migrations/0018_permuta_bordero_cache.sql
  - src/backend/migrations/0056_permuta_execucao_parcial.sql
  - src/frontend/app/permutas/components/ui.tsx
  - src/frontend/lib/types.ts
last_review: 2026-09-08
states: [PENDENTE, AGUARDANDO_FINALIZACAO, PARCIAL_AGUARDANDO_FINALIZACAO, FINALIZADO]
out_of_scope_states: []
---

# Status PERMUTA → BORDERÔ (ciclo de vida do borderô que baixou a permuta)

> **Vigência:** 2026-06-24 (v0.7.0, ADR-0014); **emendada em 2026-09-08 (ADR-0044)** com o estado
> `PARCIAL_AGUARDANDO_FINALIZACAO`. Modela o status de uma permuta **em relação ao borderô do
> `fin010`** que a baixou. É consulta **lazy** (`GET /permutas/status`), separada do `/gestao` (que
> segue rápido, sem ERP) — enriquece os badges da tela depois do load.
>
> **Esta máquina é um BADGE sobre o borderô — nunca um input de elegibilidade.** Nenhum valor dela
> remove um adiantamento da fila de permutas pendentes; a elegibilidade é derivada do **saldo** do
> adto (`elegibilidade-permuta-candidata.md`). A distinção deixou de ser detalhe em 2026-09-08: um
> status que subtraísse o adto da fila reintroduziria, noutro lugar, o silêncio que a ADR-0044
> existe para fechar.

## Estados (constantes tipadas)

| Constante (TS) | Valor | Significado |
|----------------|-------|-------------|
| (omitido) | `pendente` | Sem borderô **válido** vinculado — a permuta está aberta para (re)lançamento. **Não é um valor explícito**: resulta da ausência do adto no mapa retornado por `statusPorAdiantamento`. |
| `AGUARDANDO_FINALIZACAO` | `aguardando-finalizacao` | Existe baixa `settled` na trilha e o borderô vinculado está **EM CADASTRO** no ERP (baixado, falta finalizar). |
| `PARCIAL_AGUARDANDO_FINALIZACAO` | `parcial-aguardando-finalizacao` | Existe baixa **`parcial`** (ADR-0044) na trilha e o borderô vinculado está **EM CADASTRO** no ERP. Afirma **duas** pendências ao mesmo tempo: o borderô aguarda finalização **e** o resíduo aguarda re-alocação. **Não** substitui a elegibilidade — o adto segue na fila. |
| `FINALIZADO` | `finalizado` | O borderô vinculado está **FINALIZADO** no ERP (permuta concluída; continua aparecendo). |

Tipo: `PermutaStatus = 'aguardando-finalizacao' | 'parcial-aguardando-finalizacao' | 'finalizado'`
(`src/backend/domain/service/permutas/BorderoGestaoService.ts:21`); `pendente` é a ausência.

> **Por que um valor NOVO e não o reuso de `aguardando-finalizacao`** (alternativa recusada,
> ADR-0044): `PermutaStatus` é **um** valor por adiantamento, e o `pendente` que move a permuta é
> produzido pela **omissão** do adto no mapa. Devolver `aguardando-finalizacao` para uma execução
> `parcial` **substituiria** o `pendente` — tirando o adiantamento da leitura de "aberto" e deixando
> o resíduo sem cobrança. Seria o defeito do R-2 mudado de lugar, não corrigido. O valor distinto
> acrescenta informação sem subtrair nenhuma.

## Derivação (por adiantamento) — file:line

`BorderoGestaoService.statusPorAdiantamento`
(`src/backend/domain/service/permutas/BorderoGestaoService.ts:429-487`):

1. Coleta, por adiantamento, **todos** os `borCod` de baixas **terminais** na trilha
   (`permuta_alocacao_execucao`): `status === 'settled'` **ou** `status === 'parcial'` — `:435-443`.
   Um adto pode ter vários borderôs (re-baixa após cancelar/estornar). *(Antes da ADR-0044 o filtro
   era só `settled`; o borderô de uma execução `parcial` já era resgatado para o cache
   `permuta_bordero` por `listComBordero` — que filtra `bor_cod IS NOT NULL`, sem filtro de status —
   e portanto SEMPRE apareceu na aba Borderôs. O que faltava era o badge no painel de permutas.)*
2. Resolve a situação **viva** de cada borderô no ERP por filial, 1 chamada por filial filtrada por
   `borCod#IN` (`listBorderos({ filCod, borCods })`) — `:447-464`. Busca PRECISA (não perde por
   paginação do `fin010/list`).
3. Para cada adto, escolhe o borderô **VÁLIDO** mais recente (maior `borCod` em `FINALIZADO` ou
   `EM_CADASTRO`) — `:467-478`. **Cancelado/estornado/removido é ignorado.**
4. Mapeia situação → status — `:479-485`:
   - `FINALIZADO → finalizado`;
   - `EM_CADASTRO` → `aguardando-finalizacao` **se** as execuções terminais desse borderô para o adto
     são todas `settled`; `parcial-aguardando-finalizacao` **se ao menos uma** é `parcial`
     (o resíduo é a informação que não pode se perder na agregação).

   Se nenhum borderô válido sobra, o adto é **omitido** ⇒ a permuta volta a `pendente` (reabre para
   novo lançamento).

> **Borderô FINALIZADO com resíduo — seam nomeado.** Quando o borderô de uma execução `parcial` é
> finalizado, esta máquina devolve `finalizado`: ela responde sobre o **borderô**, e o borderô está
> mesmo concluído. O resíduo **não** fica sem dono — ele continua sendo rastreado pelo terminal
> `parcial` do ledger (I-Recon-6), pelo `BUSINESS_WARN` e pelo detector proativo (I-Recon-7), e
> mantém o saldo do adto em aberto, logo o adto segue elegível. A costura é deliberada e está
> registrada aqui para que ninguém a redescubra como bug: **badge do borderô ≠ rastreio do resíduo.**

A situação viva do borderô vem de `situacaoDoItem`
(`:496-504`): `borCodEstornado != null ⇒ ESTORNADO`; `borVldFinalizado === 1 ⇒ FINALIZADO`;
`=== 2 ⇒ CANCELADO`; `0/undefined ⇒ EM_CADASTRO`.

## Transições

| # | De → Para | Gatilho | Regra | Vigência |
|---|-----------|---------|-------|----------|
| B1 | `PENDENTE → AGUARDANDO_FINALIZACAO` | baixa `settled` cria/atualiza o borderô (`reconciliarPermuta`) | há `settled` na trilha e o borderô está **EM CADASTRO** no ERP | 2026-06-24 |
| B1' | `PENDENTE → PARCIAL_AGUARDANDO_FINALIZACAO` | baixa **`parcial`** cria/atualiza o borderô (`reconciliarPermuta`, I-Recon-6) | há `parcial` na trilha e o borderô está **EM CADASTRO** no ERP. **Propriedade obrigatória da transição:** o adiantamento **permanece na fila de elegibilidade** — o resíduo é trabalho pendente e o badge não pode escondê-lo | 2026-09-08 (ADR-0044) |
| B2 | `{AGUARDANDO_FINALIZACAO, PARCIAL_AGUARDANDO_FINALIZACAO} → FINALIZADO` | `finalizarBordero` (aprovar) | borderô passa a `borVldFinalizado === 1`. Saindo de `PARCIAL_*`, o resíduo segue rastreado pelo ledger (ver seam acima) | 2026-06-24 / emendada 2026-09-08 |
| B3 | `{AGUARDANDO_FINALIZACAO, PARCIAL_AGUARDANDO_FINALIZACAO, FINALIZADO} → PENDENTE` | borderô CANCELADO / ESTORNADO / REMOVIDO no ERP | nenhum borderô válido sobra para o adto → **reabre** a permuta (idempotência viva) | 2026-06-24 / emendada 2026-09-08 |

```
                        reconciliarPermuta, borderô EM CADASTRO
             B1 (baixa settled)  │   │  B1' (baixa parcial)
                                 ▼   ▼
   ┌──────────┐  B1   ┌──────────────────────────────┐  B2   ┌────────────┐
   │ PENDENTE │ ────► │   AGUARDANDO_FINALIZACAO     │ ────► │ FINALIZADO │
   │          │       └──────────────────────────────┘       └────────────┘
   │          │  B1'  ┌──────────────────────────────┐  B2         ▲
   │          │ ────► │ PARCIAL_AGUARDANDO_FINALIZ.  │ ────────────┘
   └──────────┘       └──────────────────────────────┘
        ▲   ▲                    │  B3       │  B3                 │  B3
        │   └────────────────────┘           │                     │
        └────────────────────────────────────┴─────────────────────┘
                cancelado / estornado / removido ⇒ reabre (PENDENTE)

   PARCIAL_* afirma DUAS pendências: borderô a finalizar (B2) E resíduo a re-alocar.
   Nenhum estado desta máquina remove o adto da fila de elegibilidade — o badge nunca
   é input de elegibilidade (ver nota no topo).
```

## Decisão (2026-06-24): estorno REMOVIDO da UI

`situacaoDoItem` ainda reconhece `ESTORNADO` (um borderô estornado é beco-sem-saída no ERP — não
cancela/exclui), mas a **ação** de estornar e a saída "Liberar" foram **removidas da UI** (decisão
Yuri, comentário em `BorderoGestaoService.ts:489-495`): sem estorno na UI não há borderô travado, e o
endpoint `removerDaTrilha`/"Liberar" (`DELETE /borderos/:borCod/trilha`) foi **removido** (era código
morto + risco de dupla-baixa — Regis-Review 2026-06-24-2011 R-1, P0). Um borderô estornado direto no
ERP é tratado por B3 (a permuta reabre).

> **Nota:** o método de serviço `estornarBordero`
> (`BorderoGestaoService.ts:238-250`) e a rota `POST /borderos/:borCod/estornar`
> (`routes/permutas.ts:498-517`) ainda **existem** no backend (Fase 3.1, v0.6.0). O que a v0.7.0
> removeu foi a **exposição na UI** + o endpoint/trilha `removerDaTrilha`. Distinção registrada para
> não confundir "removido da UI" com "removido do backend".

## Relação com a state-machine de elegibilidade

Esta máquina é **ortogonal** a `state-machines/elegibilidade-permuta-candidata.md`: aquela modela o
estado da **candidata** (descoberta→elegível/manual/bloqueada→executada); esta modela o status do
**borderô** que efetivou a baixa. `EXECUTADA` (T5) é o ponto em que B1 passa a valer.
