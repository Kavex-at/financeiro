# Follow-ups — `ACCESS_DENIED` do Conexos (ADR-0032)

Origem: `/feature-tweak integrations/conexos` (2026-08-06), incidente do "Processar" da aba Automáticas.
O tweak entregue **explica** a falha de permissão; não a elimina.

---

## P0 — operacional, fora do código: grants no ERP

O `imp223/list` (DUIMP) está negado para `SIMONE_PEREIRA` (`SELECT: false`, `CONSULTAR.granted: false`,
`cpoCod 37681`). Quem concede: `CATIA_OLIVEIRA`, `MPS_FRANCINEI`, `RICARDO_PRADO`, `CONEXOS`.

**O grant do `IMP_223` desbloqueia apenas o passo 3 de 7.** A cadeia do "Processar", em ordem, e o que
o log de 2026-08-06 já provou:

| # | Endpoint | Permissão | Status sob a credencial do analista |
|---|---|---|---|
| 1 | `com298/list` | SELECT | ✅ 200 |
| 2 | `imp019/list` | SELECT | ✅ 200 |
| 3 | `imp223/list` | SELECT | ❌ **403** |
| 4 | `com298/{docCod}` | SELECT | ❓ nunca exercido |
| 5 | `com308/financeiroAPagar/list/{docCod}` | SELECT | ❓ nunca exercido |
| 6 | `fin010` (POST — cria borderô) | **INSERT** | ❓ nunca exercido |
| 7 | `fin010/baixas` ×4 (handshake) | **INSERT/ALTERAR** | ❓ nunca exercido |

Dois riscos que nenhum teste de leitura revela:

- **6–7 são classe de permissão diferente** (escrita, não `SELECT`). Um 403 no passo 7 acontece **depois**
  do `criarBordero` — deixa borderô órfão no ERP + linha `reconciling`, e cai no guard fail-closed
  (`ReconciliacaoPermutaService`), que bloqueia retry até conciliação manual.
- **Logo depois vem a aba Borderôs** (`fin010/finalizar|cancelar|estornar`, `DELETE fin010/baixas/...`),
  que exige `FINALIZAR`, `CANCELAR` e `DELETE` — segunda parede de permissão.

Sonda segura para os passos 1–5 (a auto-alocação roda **antes** do gate de dry-run, então não escreve
no ERP): `POST /permutas/adiantamentos/19017/reconciliar` com `{"dryRun": true}` e o JWT do analista.
Persiste rascunhos de alocação no Postgres (sem efeito no ERP, removíveis via `DELETE /alocacoes`).

---

## P1 — leituras pelo robô, escritas na sessão do analista

Hoje `ConexosSessionResolver` resolve **uma** sessão por request e ela vale para toda chamada ao ERP
daquela request. A intenção do ADR de sessão-por-usuário (2026-07-10) é que a **baixa saia no nome do
analista** — isso vale para a escrita `fin010`, não para uma consulta de elegibilidade.

Proposta: leituras (passos 1–5) pelo robô; escritas (6–7) na sessão do analista. Reduz a auditoria de
permissões por analista de sete endpoints para dois, e elimina a classe "analista sem `SELECT` numa tela
acessória derruba o fluxo inteiro".

A decidir antes de implementar: é aceitável, para auditoria/compliance, que a leitura que **fundamenta**
a baixa corra sob outra identidade que a baixa em si?

---

## P2 — `catch {}` que engolem 403 sem deixar rastro

`AlocacaoPermutasService.buscarInvoices` engole falhas de `getDetalheTitulos` e `listTitulosAPagar`; o
`executarBaixa` faz o mesmo com `listTitulosAPagar` (fallback para `titCod: 1` com o valor cheio). Um
403 nesses pontos **não** vira erro: degrada silenciosamente para "alocação sem taxa da invoice" ou para
um fallback de título — sintoma que não aponta para permissão.

Com o `ErpAccessDenied` disponível, esses `catch` podem ao menos **logar** que a causa foi permissão,
sem mudar a política de tolerância.
