# Follow-ups — sispag-remocao-codbar-repetido (Regis-Review 2026-10-14-2030)

Nada abaixo foi implementado nesta entrega (só os dois itens marcados "corrigido").

## P1
- **FT F-3 — retenção encerra quando o título mantido é pago.** O título retirado volta a ser elegível
  com um boleto que já foi pago. Decisão de produto: manter retido até checagem de boleto pago (exige
  HMAC do código + migration, watchlist "entre lotes") ou aceitar a rejeição do banco.
- **Testability-1 — I16d.7 meio testado.** Ramo `aindaRuins` (`RetiradaCodigoBarrasService`, ~308–315)
  sem teste; só "lote esvazia" é coberto. A rede do `.REM` (gate 5.1) é a segunda defesa.
- ~~Testability-2~~ corrigido em `6e43977`. ~~FT F-1~~ corrigido em `6e43977`.

## P2
- **FT F-2:** sinal de "limpeza pendente" é substring de `erroMensagem` livre; trocar por campo estruturado.
- **Security F-1:** o resultado do `DELETE` nativo vive só em log/ledger, não na trilha persistente.
- **Testability-3:** `RetiradaCodigoBarrasService` (558 LOC) sem arquivo de teste próprio (~760 linhas
  de teste dentro de `RemessaService.test.ts`).
- **Modifiability:** `limpar_retirados` só em memória (`ORDEM_ETAPAS`); teste de contrato contra o CHECK
  da 0049 evita regressão futura. Serviço novo a 93% do teto de 600 LOC.

## P3
- Security: `:id` da rota de lote sem validação uuid; só `itsCodSeq` validado em runtime no path do DELETE.
- Testability-4: respostas medidas do DELETE em fake manual, sem fixture compartilhada com o client.
- Modifiability: dois `DELETE` locais com efeitos diferentes (documentar); reuso parcial da análise no
  passo 2 da ADR-0068 (precisa índice entre lotes).

## Observação de produção
Lote cujo boleto não devolve código lido do rascunho agora ABORTA (`BOLETO_CODIGO_BARRAS_RETIRADA_INCOMPLETA`)
em vez de WARN (P0-3(c)). Acompanhar as primeiras execuções.
`LoteCard` faz 1 GET por card finalizado/não cancelado; reavaliar se pesar na aba Finalizados.
