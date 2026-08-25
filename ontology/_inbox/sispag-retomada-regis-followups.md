# Follow-ups do Regis-Review — SISPAG retomada

> Run: `docs/regis-review/2026-08-25-1742-sispag-retomada/` · 2026-08-25
> Gate do `/feature-tweak`: **P0 re-entra no loop; P1/P2/P3 viram follow-up e NÃO são implementados
> nesta execução.** Este arquivo é o registro dos que ficaram.

## Situação do gate

O Regis-Review levantou **6 P0**. Nenhum deles bloqueia o merge — todos bloqueiam a **primeira
remessa real** ou a **primeira conciliação real**. Decisão pendente do Yuri: tratá-los como
sub-loop desta feature (mesmo worktree) ou como sprint imediatamente posterior ao merge.

| P0 | Card | Esforço | Bloqueia |
|---|---|---|---|
| 1 | `fault-tolerance-1` — advisory lock em `gerarRemessa` | S | 1ª remessa real |
| 2 | `availability-1` — agendar o reaper | S | 1ª remessa real |
| 3 | `integrability-1` — protocolo `QUESTION` nas 5 escritas | M | 1ª remessa real |
| 4 | `fault-tolerance-2` — gate ao vivo da conciliação | M | 1ª conciliação real |
| 5 | `testability-1` — fixtures + contrato das shapes da VOLTA | M | 1ª conciliação real |
| 6 | `testability-2` — *(mesmo trabalho do 4)* | M | 1ª conciliação real |

## P1 / P2 / P3 — follow-ups (21 + 21 + 4)

Lista completa e ordenada em `docs/regis-review/2026-08-25-1742-sispag-retomada/KANBAN.md`.
Detalhamento por card na seção `{qa-slug}.md` correspondente.

Os quatro de maior alavancagem, na minha leitura:

1. **`deployability-2` (S)** — a copy da tela cita `CONEXOS_DRY_RUN` quando a causa dominante após o
   deploy será `SISPAG_LIVE_WRITE_ENABLED`. É uma linha de texto, e manda o operador mexer num flag
   global que afeta Permutas e Recebimentos.
2. **`fault-tolerance-3` (S)** — `listarLotesNativos` lê só a 1ª página. É o mesmo defeito que esta
   feature corrigiu no `listarTitulosPendentes`, no mesmo arquivo. Latente hoje, P0 quando o
   histórico passar de 500 lotes por (filial, banco).
3. **`modifiability-2` (S)** — a chave `filCod:docCod:titCod` em 8 sites. Esta feature corrigiu um bug
   de chave sem filial que teria importado pagamento de outro fornecedor; a próxima mudança na chave
   esquecerá um dos 8.
4. **`performance-1/2/3` (3×S)** — os três juntos levam o `POST /remessa` de ~55s para ~20s, e os
   padrões (BoundedConcurrency, dedupe, keep-alive) já existem no repositório.

## Verificação do orquestrador — o que NÃO virou follow-up

3 findings foram **refutados** e 1 **rebaixado** por medição direta (detalhe em `REPORT.md` §2 e no
fim de `_shared-metrics.md`). Registrado aqui para que não voltem sem nova evidência:

- `fin005/list` **não** vaza contas de outra filial — medido ao vivo. O `fin015/list` é a exceção
  entre os endpoints, não a regra.
- `notify()` / `NotificationCenter` / "Patterns §21" **não existem** neste repositório.
- O CNAB **não** vai para o log da aplicação num sucesso — corpo de resposta só é logado em erro.
