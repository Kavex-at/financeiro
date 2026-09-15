# Interview (tweak) — `permutas-excecao-manual`

**Data:** 2026-09-15 · **Branch:** `fix/permutas-excecao-manual` · **Worktree:** `~/kavex-worktrees/permutas-excecao-manual`
**Base:** `origin/main` @ `2f03116` (v0.36.5, inclui ADR-0046) · **Entidade:** `PermutaCandidata` (+ nova config `ExcecaoPermuta`)
**Numeração reservada:** migration **0059** (0058 está em `origin/feat/metricas-ciclo`), ADR **0047** (0045 idem).
**Decisões do usuário (tech@kavex.at, 2026-09-15):** abordagem = exceção manual no painel; exibição = "Já permutado" + tag de exceção.

---

## Contexto (caso real)

Adiantamento **8721** (proforma, filial 2, processo 124, COPPER / CODELCO, ref. `0013COO/25`,
USD 3.787.086,38 × 5,3796 = R$ 20.373.009,89). Após a ingestão de 2026-09-15 11:24 (código v0.36.5):
`BLOQUEADA / sem-saldo-permutar`.

Conexos ao vivo (read-only, 2026-09-15):
- Detalhe `com298`: `mnyTitPermutar = 0`, `mnyTitPermuta` (Valor permutado) **= 0**, `mnyTitAberto = 0,02`.
- Baixas do título 1 da proforma: 15/01 R$ 17.000.000,00 (`gerNum` 38) · 16/01 R$ 3.373.009,87 (38) ·
  **30/04 R$ 20.373.009,87 (`gerNum` 21 — Fornecedores exterior por encomenda)**.
- Invoice **7329** (mesmo processo, USD 3.787.086,38): única baixa **30/04 R$ 20.373.009,87, principal
  R$ 20.025.734,07, `gerNum` 198 (Adto fornecedor internacionais)**.

⇒ A permuta **aconteceu** (baixas cruzadas manuais 21 ↔ 198 em 30/04, antes do painel existir), mas fora do
fluxo de permuta do Conexos, que por isso não preencheu "Valor permutado". Pela regra (ADR-0043/0046), sem
`valorPermutado > 0` o motivo é `sem-saldo-permutar` ("nunca teve saldo") — enganoso.

**Por que exceção e não regra:** hoje é **1 documento** (os outros 188 pagos sem saldo são `ja-permutado`
marcados pelo Conexos). A conta da baixa **não** é marcador confiável: 8721 tem baixa em 21 e o ERP diz
permutado = 0; permutas oficiais também usam a conta 18 (ADR-0073 do `fechamento-processos`). Uma regra
automática seria chute. A calibração com as 188 ficou bloqueada (Conexos passou a negar `PSQ_018` ao usuário
CLONEX em 2026-09-15). Ajuste no ERP (estornar e refazer R$ 20 mi) foi descartado pelo usuário.

**Por que não UPDATE no banco:** a ingestão (3×/dia + botão) recalcula todos os adtos e sobrescreveria.

---

## Comportamento desejado

1. **Marcar.** Um analista (admin, como as demais ações de Permutas) marca um adiantamento como
   **"permutado fora do painel"** com **justificativa obrigatória**. Registra autor (identidade do JWT, não
   input do cliente — padrão ADR-0006) e data.
2. **Guarda (só onde não esconde problema real).** Só pode marcar adiantamento cujo estado calculado é
   `BLOQUEADA` com motivo **`sem-saldo-permutar`** (pago dentro da tolerância, `valorPermutar ≤ R$1,00`,
   `valorPermutado` 0/ausente). Qualquer outro estado/motivo → recusa (HTTP 422, mensagem pt-BR).
3. **Efeito.** Com exceção ativa **e** guarda satisfeita, a candidata vira **`JA_PERMUTADO`** (estado já
   existente, terminal) com motivo informativo novo **`permutado-fora-do-painel`**. Sai de "Bloqueadas",
   entra no card/filtro "Já permutado".
4. **Exibição.** Badge "Já permutado" + **tag "Exceção manual"**; no detalhe: justificativa, autor, data e
   ação **"Desfazer exceção"**.
5. **Desfazer.** Reversível, com trilha: soft-delete (quem removeu, quando). O adto volta ao estado calculado.
6. **Persistência na ingestão.** Toda ingestão (cron e botão) respeita a exceção ativa.
7. **Dado muda no ERP.** Se o estado calculado deixar de ser `sem-saldo-permutar` (ex.: saldo reaparece,
   título reaberto, `valorPermutado` passa a > 0), **o cálculo vence**: a exceção não se aplica (fica
   registrada, sinalizada como inativa) e loga `BUSINESS_WARN`. Nunca mascarar mudança real.

## Defaults escolhidos pelo orquestrador (não perguntados — revisar no PR)
- **Efeito imediato:** marcar/desfazer atualiza a linha do adto em `permuta_adiantamento` na mesma transação
  (se a guarda vale para o estado gravado), para a tela mudar no "Atualizar" sem esperar ingestão. A
  ingestão mantém. (Alternativa: disparar ingestão como no cadastro de cliente-filtro — mais lenta.)
- **Justificativa:** texto livre, mínimo 10 caracteres, máx. 500.
- **Uma exceção ativa por adiantamento** (chave natural `adiantamento_doc_cod`); histórico via soft-delete.
- **Histórico (aba):** não incluir — não há borderô do painel.
- **Exportação Excel:** o motivo/tag aparece como "Permutado fora do painel (exceção manual)".
- **Snapshot `permuta_candidata_snapshot`:** seguir o mapeamento já existente de `ja-permutado` (ADR-0043).
- **Sem mudança em Conexos** (nenhuma escrita no ERP; I4 intocado).

## Invariantes
- I3 inalterado para o fluxo automático. Nova transição documentada: `BLOQUEADA(sem-saldo-permutar)` →
  `JA_PERMUTADO` **somente** por exceção manual ativa + guarda.
- I5 (auditoria): autor, data, justificativa, remoção.

## Casos canônicos (testes)
- 8721 com exceção ativa, guarda ok → `JA_PERMUTADO` / `permutado-fora-do-painel`.
- Marcar adto `nao-pago`, `data-base-indisponivel`, `elegivel`, `permuta-manual`, `ja-permutado` → 422.
- Exceção ativa, mas `valorPermutar` passa a R$ 5.000 → estado calculado (ex. `permuta-manual`/`bloqueada`), warn.
- Exceção ativa, `valorPermutado` passa a > 0 → `JA_PERMUTADO` / `ja-permutado` (motivo do ERP vence).
- Desfazer → volta a `BLOQUEADA / sem-saldo-permutar`; trilha de remoção gravada.
- Justificativa vazia / < 10 → 400. Não-admin → 403. Autor vem do JWT.

## Ground truth
Não é lógica monetária (só classificação de estado sobre dados já lidos) → gate Ground-Truth **N/A**,
documentar no PR. Verificação pós-deploy: marcar 8721 e rodar ingestão → `Já permutado`.
