# Handoff: SISPAG boleto work (Columbia Financeiro)

> Valores medidos em 2026-10-16. Reconferir flags, estado do PRD e `origin/main` antes de confiar nisto.

## Onde estamos
Tudo abaixo está em `main` (app v0.69.0, ontologia v0.43.0, último ADR 0072). Pipeline usado:
`/feature-tweak` em worktree dedicado, Regis-Review reduzido, bump semver manual (sem `pwsh` nesta
máquina), PR. O usuário faz "Rebase and merge".

| PR | Versão | O que fez |
|---|---|---|
| #117 | v0.65.0 | Sync do pool DDA dentro da ingestão de pagamentos, aviso de DDA velho (ADR-0067) |
| #118 | v0.66.0 | Sugestão de boleto, passo 1: a analista confirma ou rejeita um candidato (ADR-0068) |
| #119 | v0.66.1 | Guarda: o mesmo código de barras não sai duas vezes na remessa (ADR-0069) |
| #121 | v0.67.0 | Itens repetidos são retirados sozinhos e a remessa segue (ADR-0069 Emenda 1) |
| #122 | v0.68.0 | Passo 2: vincular o código de barras confirmado ao item do SISPAG, só valor igual, **desligado por padrão** (ADR-0071, I17) |
| #123 | v0.68.1 | `SISPAG_BIND_CODBAR_FILIAIS` aceita um modo global (`on`, `shadow`, `off`) |
| #124 | v0.69.0 | Todo título BOLETO sem DDA mostra um desfecho; aviso "boleto vence antes do título" com reconhecimento (ADR-0072, I15m–o) |

A correção "vence hoje aparecia como vencido" (v0.66.2, ADR-0070) foi feita por outra sessão.

## O que a plataforma faz hoje com boleto
- **Paga hoje:** boleto que o ERP já vinculou (`titVldReflexoDdaAssoc=1`). A guarda de código repetido vale para ele.
- **Pronto mas desligado em PRD:** o vínculo da sugestão confirmada. Precisa de `SISPAG_BIND_CODBAR_FILIAIS` no Render:
  `"on"` = todas as filiais, ou lista por filial (`"2:on,4:shadow"`). Valor inválido cai em `off`;
  `SISPAG_LIVE_WRITE_ENABLED=false` derruba.
- **Não paga:** título sem vínculo e sem confirmação; boleto acima do título (o `finalizar` do ERP recusa pagamento maior que o saldo em aberto).
- **Não construído:** envio do .REM ao banco (fora da plataforma; ninguém documenta quem faz) e guarda de código de barras entre lotes ou contra boleto já pago.

**Medido em 2026-10-16 (somente leitura, banco do PRD, 894 títulos BOLETO sem vínculo):**

| Desfecho | Títulos |
|---|---|
| UNICA_SEGURA | 196 |
| SO_ATENCAO (com âncora) | 3 |
| AMBIGUA | 281 |
| SO_FRACA | 233 |
| SO_VENCIDA | 78 |
| DISPUTADA | 61 |
| SEM_CANDIDATO | 42 |

Só cerca de 22% são confirmáveis. Rodar de novo antes de citar:
`src/backend/jobs/medir-desfecho-sugestao-boleto.ts` (somente leitura, `--alvo=prd`).

## Pendente antes de ligar o vínculo em PRD
1. **Permissão do PUT não provada** (V-PRD1). Em PRD o backend autentica como **MPS_FRANCINEI**: a leitura
   de `fin015/finItemSispag/list` foi confirmada. O robô CLONEX recebe 403 ACCESS_DENIED (cpoCod 1072),
   o que só afeta os crons do GitHub.
2. **V-PRD2:** um título real controlado.
3. **V6** (retorno/pool de boleto pago) não é observável em HML.
4. Ordem combinada: `shadow` em PRD, depois um título controlado, depois `on`. Se algo falhar, o item é
   retirado ou a remessa aborta, nunca um pagamento com código errado. Reverter: `off` ou remover a variável e reiniciar.

## Avaliação de usabilidade (lida do código, não vista rodando), por impacto
1. **Confirmar não leva a lugar nenhum** enquanto o vínculo está desligado: o painel diz que nada foi gravado no Conexos e a remessa segue bloqueada.
2. **Sem confirmar/rejeitar em lote:** cerca de 196 seguros e 281 ambíguos, um diálogo por título.
3. **Sem fila "o que fazer hoje":** nada separa o confirmável que vence amanhã do que vence no mês que vem.
4. **Resolver ambíguo é pesado:** um motivo digitado por rejeição, sem comparação lado a lado.
5. **"Sem boleto no pool" é beco sem saída** (texto simples, sem próximo passo).
6. **Erros críticos em toast**, por exemplo "Remessa em dúvida — NÃO repita".
7. **Jargão** ("envelope", "pool", "emissor", "órfã") e sete verbos de desfazer parecidos.
8. **Itens pequenos:** "Ver boletos DDA" dentro do lote abre o diálogo sem o painel de sugestão; filtros sem "limpar tudo"; tokens de cor inconsistentes (três achados de design ficaram como follow-up).

Funciona bem e não deve ser refeito: deltas com sinal, o reconhecimento de vencimento antes do título, o aviso persistente de retirada automática, as mensagens específicas de erro da remessa e o filtro por situação com contagem.

## Próximos passos sugeridos
1. **Rollout:** `SISPAG_BIND_CODBAR_FILIAIS="shadow"` em PRD, ler o `vinculos-previstos`, depois um título controlado.
2. **Ajustes baratos de UI:** chip "vence amanhã · confirmáveis" com ordenação padrão, "sem boleto" clicável com próximos passos, linguagem simples, e o "Ver boletos DDA" do lote passando o painel de sugestão.
3. **Confirmação em lote** e a ação "este é o certo" para ambíguos, depois que analistas reais disserem que confiariam nelas.
4. **Perguntas à Columbia/Conexos:** como registrar boleto acima do título (caso NELSON, +R$0,01); matriz de permissões do robô para `fin015`; quem envia o .REM ao banco e quem carrega o .RET.

## Restrições e armadilhas
- **Segredos:** nunca imprimir nem commitar credenciais. As de HML ficam só em `/home/inteli/.claude-tech/hml-conexos.env`, via `HML_ENV_FILE`. O `.env` local aponta para o PRD. Escrita em PRD só com o go explícito do mantenedor.
- **Guarda local:** `CONEXOS_WRITE_ENABLED` é ignorado contra o PRD em máquina local. Login em PRD derruba a sessão viva daquele usuário (inclusive robô e MPS_FRANCINEI).
- **Códigos de barras:** só o mascarado (5 primeiros e 4 últimos dígitos) pode ser persistido, logado ou exibido. Em testes e HML, só códigos sintéticos com dígito verificador válido.
- **Datas:** datas do Conexos são meia-noite UTC. Nunca comparar com `now()`; usar `BankingCalendar.todayBrt`.
- **Worktrees:** o shell recusa comandos compostos que misturam git com `cd`, variáveis ou heredocs. Usar comandos simples.
- **Git:** nunca push na `main`, nunca merge da base na branch, nunca force-push sem OK.
- **Repo dos PRs:** em alguns worktrees o `gh` resolve o repo errado; usar `-R Quartano-Level/financeiro`.
- **Versões colidem entre sessões paralelas:** reconferir versão do app, número de ADR, versão da ontologia e número de migration contra `origin/main` antes do bump. Última migration: 0086.
- **Regis-Review:** rodar a versão reduzida (3–4 QAs escolhidos pelo risco, `model=sonnet`, agentes escrevem com Write e conferem com `ls`, o orquestrador escreve o REPORT.md).

## Pontas soltas
- **Para apagar quando nada mais precisar:**
  - Lotes de teste do HML flp 37–41 e a branch `chore/sispag-hml-bind-experimentos`, que não tem PR.
  - Worktrees antigos das branches já mescladas.
- **Ontologia desatualizada:** alguns arquivos ainda dizem `planned` para o que já foi entregue (`actions/sispag/finalizar-lote.md`, o banner de I16 em `boleto-exige-codigo-de-barras.md`, `status: draft` em `vinculo-codbar-item-sispag.md`).
- **Listas de follow-up:** cada PR deixou uma em `ontology/_inbox/*-regis-followups.md`, mais `ontology/_inbox/_watchlist.md` para as decisões adiadas.
- **Memória:** `/home/inteli/.claude-tech/projects/-home-inteli--rea-de-trabalho-projects-kavex-financeiro/memory/`, em especial as notas sobre permissões do robô, datas do Conexos e Regis-Review reduzido.
