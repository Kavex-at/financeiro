# Follow-ups — `feat/recebimentos-modalidade-processada` (ADR-0033)

Achados dos gates de padrão (PatternGuardian + DesignSystemReviewer) que **não** foram implementados
neste ciclo. P0 foi zero; o único bloqueante do DesignSystemReviewer (anel de foco) foi corrigido
dentro do próprio ciclo.

| # | Prioridade | Achado | Onde | Por que ficou de fora |
|---|-----------|--------|------|------------------------|
| 1 | P1 | `@inject(TransacaoRepository)` usa a CLASSE concreta, enquanto `TRANSACAO_REPOSITORY_TOKEN` existe (`ports.ts:540`) e está registrado (`recebimentosContainer.ts:73`). | `RecebimentoNumerarioService.ts:258`, `IngestaoTransacoesService.ts:66`, `ImportacaoExtratoArquivoService.ts:98`, `RecebimentosPainelService.ts:102` | **3 dos 4 são anteriores a este ciclo** — a injeção nova só seguiu a convenção unânime dos vizinhos. Migrar exige tocar os 4 E os fakes dos e2e, que fazem `container.registerInstance(TransacaoRepository, ...)` e deixariam de ser resolvidos pelo token. É refactor próprio, não delta desta feature. |
| 2 | P2 | Menu de 3 pontinhos não navega com ↑/↓ (padrão WAI-ARIA para `role="menu"`); só Tab. | `AcoesLinhaMenu.tsx` | Consequência aceita de construir sobre `Popover` em vez de `DropdownMenu` (ADR-0033). Com **um** item de menu, a navegação por setas não muda nada na prática. Reavaliar quando o menu ganhar o terceiro item. |
| 3 | P2 | O `~` que marca previsão é visual; o significado só chega ao leitor de tela pelo tooltip. | `status-badges.tsx` (`ModalidadeBadge`) | O tooltip do `DomainChip` já é lido por `aria-describedby` do primitivo. Um `aria-label` explícito no chip melhoraria, mas o padrão vale para TODOS os chips do painel — mudar só neste criaria inconsistência. |
| 4 | P3 | O filtro default `A processar` esconde as `processada` sem um aviso textual acima da tabela. | `page.tsx` | O chip `A processar` fica visivelmente ativo e os KPIs continuam mostrando o total. Um alerta fixo em cima de uma fila de trabalho vira ruído permanente. |
| 5 | P3 | O botão "Alocar" **some** em linha processada/arquivada, em vez de ficar `disabled` com tooltip. | `page.tsx` | Escolha deliberada: crédito processado não é caso de "não pode agora", é caso de "não se aplica mais". Um botão desabilitado permanente sugere que existe um caminho para habilitá-lo. |

## Contexto para retomar

- ADR: `ontology/decisions/0033-nde-so-por-encomenda-status-processada-arquivamento.md`
- Migration: `src/backend/migrations/0045_modalidade_processada_arquivamento.sql`
- Módulo puro da previsão: `src/backend/domain/service/recebimentos/preverModalidade.ts` (+ teste)
