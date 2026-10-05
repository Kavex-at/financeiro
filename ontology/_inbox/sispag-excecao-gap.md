# Gap — sispag-excecao-destino (ADR-0061)

> Perguntas **ainda abertas** após a aprovação do diff (2026-10-05). As "propostas" abaixo são
> defaults razoáveis para destravar o TaskScoper; **não estão decididas**. Responder editando este
> arquivo. **P0** = bloqueia parte da implementação; **P1** = desejável antes do merge.

## Já decididas (não reabrir)

Permissão única `sispag:excecao` (cadastrar, aprovar, rejeitar, revogar; a migration converte
concessões de `sispag:aprovar_destino`); PIX só chave CPF/CNPJ = `pdcDocFederal` (I10i); revogação
por qualquer pessoa com `sispag:excecao`; sem expiração (vive até revogada ou substituída pelo
cadastro); cadastro primeiro; exceção por favorecido e reutilizável; auto-`SUBSTITUIDA` com log de
divergência; planilha cria só `PENDENTE`; `destinoManual` por item retirado.

## Abertas

| # | Pri | Pergunta | Proposta (não decidida) |
|---|---|---|---|
| Q1 | **P0 (só a carga em lote)** | Layout da planilha da Columbia: colunas, aba, chave do favorecido (CNPJ? `pesCod`? nome?), como distingue TED × PIX. **Não vista.** | Pedir amostra mascarada. Cadastro manual (E1) e o resto seguem sem ela; só `carregarExcecoesDestinoPlanilha` fica bloqueada. |
| Q3 | **P0** | "Cadastro tem destino válido": definição exata e cadência da varredura `aposentarExcecoesSubstituidas`. | Válido = conta/chave ATIVA ao vivo no `cmn025` para o tipo (mesma função de I10). Rodar ao resolver o destino (envio/finalizar) e num job diário à mão/GH Actions; sem scheduler próprio. |
| Q4 | **P0 (tarefa de implementação)** | Contagem de `destino_manual` e da trilha `lote_pagamento_item_destino_audit` em produção; lotes RASCUNHO abertos na virada. | Contar read-only via `.env` local do financeiro (o MCP Supabase não é este banco). Se 0: migration só cria; coluna inerte. Se >0: converter em `PENDENTE` (nunca `APROVADA`), deduplicando por favorecido+tipo. |
| Q6 | P1 | Nome da flag `SISPAG_DESTINO_MANUAL_ENABLED`. | Renomear para `SISPAG_EXCECAO_DESTINO_ENABLED` aceitando o nome antigo como alias por um ciclo de deploy. |
| Q8 | P1 | Quem vê `DIVERGENCIA_CADASTRO` e quem a resolve? | Evento na trilha + `Alerta` visível a quem tem `sispag:excecao`; "resolver" = marcar como visto, sem efeito no destino. |
| Q9 | P1 | Exceção por favorecido+tipo, ou também por filial (`filCod`)? | Só favorecido+tipo (como decidido: "por favorecido"); `filCod` fica de fora da chave. |
| Q10 | P1 | Recarga da planilha vs `APROVADA` existente. | Linha idêntica ignorada; diferente = nova `PENDENTE`, a aprovada segue valendo até a aprovação da nova. |
| Q11 | P1 (Francinei) | A dupla validação do destino de pagamento é prática em outras tradings? Hoje a universalidade é só Columbia + decisão do usuário. | Manter `ExcecaoDestino` como `draft`; revisar com o 2º cliente. |

## Notas para o TaskScoper

- Migration 0075 (reconfirmar contra `origin/main`): tabela `excecao_destino`, trilha só-inclusão
  com trigger, `CHECK` de permissão, conversão `sispag:aprovar_destino` → `sispag:excecao`.
- Com um único titular de `sispag:excecao`, nada se aprova (aprovador ≠ cadastrante): conceder a
  permissão a uma 2ª pessoa é ação operacional da Columbia.
- Tasks 2–6 de `sispag-ted-pix-tasks.md` (destinoManual/aprovação por item) ficam superadas.


## Registro do loop de implementação (AutoLoopRunner, 2026-10-05)

- **Q3 CONFIRMADA** pelo Yuri: "cadastro válido" = conta/chave ATIVA lida ao vivo do `cmn025` (a mesma
  função do resolver/I10), conferida ao resolver (finalizar e envio) e no job
  `aposentar-excecoes-substituidas`. Implementado: `DestinoPagamentoResolver.cadastroVence` +
  `ExcecaoSubstituicaoService` (uma implementação para as duas vias).
- **Q4 — PENDENTE (não medida).** O probe somente leitura `src/backend/jobs/probe-destino-manual-uso.ts`
  existe e foi executado, mas o `.env` local do financeiro **não traz `databaseConnectionString`** (e o
  MCP do Supabase não é este banco), então não há como alcançar o banco de produção a partir desta
  máquina. Saída real: `databaseConnectionString ausente: Q4 NÃO medida` (exit 2). Ramo adotado
  (determinístico, sem inventar o número): a migration **0075 é só de criação** e deixa
  `destino_manual` **inerte** (o código não lê nem grava). Guarda: um bloco `DO $$` da 0075 emite
  `RAISE WARNING` com a contagem de itens com `destino_manual` não nulo (não bloqueia o boot).
  **Ação do Yuri/operação:** rodar o probe com o `.env` que aponta para o banco e, se a contagem > 0,
  converter em `excecao_destino` `PENDENTE` (nunca `APROVADA`, deduplicando por favorecido+tipo)
  **antes de ligar `SISPAG_EXCECAO_DESTINO_ENABLED`**. Rodar com `databaseConnectionString` do
  financeiro mas SEM credenciais do Conexos: o probe não faz login no ERP, então não toca a sessão
  do robô em `columbia-default`.
- **Q6 DECIDIDA:** flag renomeada para `SISPAG_EXCECAO_DESTINO_ENABLED`; `SISPAG_DESTINO_MANUAL_ENABLED`
  segue como alias por um ciclo de deploy (o nome novo manda quando definido).
- **Q9 DECIDIDA (proposta mantida):** a exceção é por favorecido+tipo. A coluna `fil_cod` existe só
  para LER o cadastro do favorecido (reconferir titularidade ao aprovar e na varredura); não entra na
  unicidade.
- **Q8 (parcial):** a divergência com o cadastro vira evento `DIVERGENCIA_CADASTRO` na trilha (mascarado),
  `Alerta` `sispag-excecao-divergencia` (Painel de Operação, onde "reconhecer" = marcar como visto) e o
  marcador `divergiu` na lista de exceções, visível a quem tem `sispag:excecao`. Alerta restrito por
  permissão (só `sispag:excecao`) NÃO foi feito: o Painel de Operação filtra por `operacao:ver`.
- **T10 (carga em planilha) — NÃO implementada, bloqueada por Q1.** Layout da planilha (colunas, aba,
  chave do favorecido, TED × PIX) nunca visto; nenhuma coluna foi inventada. Follow-up documentado:
  `ExcecaoDestinoCargaService`, `POST /sispag/excecoes/carga`, `CarregarPlanilhaDialog` — cria só
  `PENDENTE` com `origem = PLANILHA` (I12d). A coluna `origem` e o valor `PLANILHA` já existem na
  tabela e no tipo. Q10 (recarga) segue aberta e depende desta task.
- **Q11:** sem mudança (revisar universalidade com o 2º cliente).
