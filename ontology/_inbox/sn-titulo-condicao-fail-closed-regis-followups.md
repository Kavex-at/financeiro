# Follow-ups do Regis-Review — `fix/sn-titulo-condicao-fail-closed`

> Run: `docs/regis-review/2026-08-03-0904/` (`REPORT.md` + `KANBAN.md`).
> O P0 e três achados foram remediados na própria rodada; o que está aqui **não** foi implementado,
> conforme a regra do pipe (só P0 re-entra no loop).

## P1 — entram na próxima janela

| Card | O quê | Por que não foi feito agora |
|---|---|---|
| 5 | Distinguir a falha do fail-closed das demais (tag/contador dedicado) para que a divergência HML×produção apareça em métrica | Fora do escopo do fix; precisa de decisão sobre onde a métrica vive (log estruturado × coluna no ledger) |
| 6 | Fixture HAR versionada da com194 (o gate hoje casa `/CONDICAO DE PAGAMENTO/` contra texto do ERP) | Depende de captura humana de um documento com a validação bloqueante real |
| 7 | Checkpoint intra-etapa no ledger entre item, condição e finalização | Muda a máquina de estados do ledger e exige migração — escopo próprio |
| 8 | Runbook da Frente IV (`docs/runbooks/`) | Documentação operacional, não código; melhor escrever depois da primeira execução real completa |

## Decisões pendentes do Yuri

1. **Idioma das mensagens de erro** (card 26). O CLAUDE.md exige inglês; 5 dos 7 `throw` deste serviço
   estão em pt-BR **porque o analista os lê na modal**. Duas saídas: formalizar a exceção no CLAUDE.md
   (mensagem de usuário em pt-BR, log técnico em inglês) ou criar um mapper que separe os dois canais.
   Traduzir só as mensagens novas deixaria a interface bilíngue — foi por isso que não fiz.
2. **`ontology/CHANGELOG.md`** parou em v0.3.0 enquanto a ontologia está em 0.12.1. Abrir uma entrada
   nova no topo de um changelog sem v0.4–v0.12 cria inconsistência pior; decidir se reconstrói ou
   aposenta o arquivo.
3. **Prova do ramo condicional.** Ele não é exercitável no HML com o cliente de teste atual. Ou se
   cadastra uma condição sugerida para o SKYJACK em homologação (torna o ramo testável de verdade), ou
   se aceita que a primeira prova venha de produção com a flag e o log como rede.

## Observação de método

Três lentes independentes (Availability, Fault Tolerance, Testability) convergiram no mesmo P1 do
checkpoint intra-etapa. Convergência entre lentes que não se falam é o sinal mais forte deste run —
mais do que qualquer nota isolada.

Um finding foi **rejeitado com evidência** (`F-fault-tolerance-3`, que afirmava que o discriminador
`docVldFinalizado === 1` nunca fora implementado — está em `ConexosGerDocProcessoClient.ts:748`) e uma
afirmação herdada do handoff anterior foi **corrigida** (o lint funciona no CI; quebra só no Windows
local). Vale como lembrete de que o parecer dos agentes é insumo, não veredito.
