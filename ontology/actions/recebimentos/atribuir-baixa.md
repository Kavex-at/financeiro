---
name: atribuirBaixa
type: action
entity: Recebimento
ontology_version: "0.11"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-07-24
preconditions:
  - "TransacaoBancaria (crédito) importada e normalizada (importarTransacoesExtrato)."
  - "Read-model de DocumentoAReceber (recebíveis em aberto) disponível (fonte ERP a confirmar, Fase 2)."
postconditions:
  - "Recebimento rascunho criado com classificacaoMatch (unica | multiplas | parcial | nenhuma)."
  - "Match confiável → segue para rateio; incerto/nenhuma → fila de análise manual (NUNCA auto-baixa)."
  - "TransacaoBancaria transiciona (conciliada/parcial/manual) — ver state-machines/transacao-bancaria.md."
  - "Nenhuma escrita no ERP (I1) — só rascunho local."
side_effects:
  - "Leitura dos recebíveis em aberto do Conexos (READ)."
  - "Escrita LOCAL do rascunho de Recebimento + auditoria."
---

# atribuirBaixa — matching crédito ↔ recebíveis (Módulo 2) — SKELETON

> ⚠️ **Conflito a resolver antes de implementar (ADR-0034).** Duas postconditions acima colidem com o
> que já existe em produção:
>
> 1. **`parcial` já tem outro writer.** Desde a ADR-0034, `TransacaoBancaria.parcial` é escrito pelo
>    settle da alocação e significa **dinheiro já baixado no ERP** (Σ das alocações executadas < valor
>    do crédito). Aqui ele significaria um palpite do matching, sem nenhuma escrita no ERP. O tooltip
>    da tela hoje promete explicitamente a primeira leitura ao analista — trocar o significado em
>    silêncio quebraria essa promessa. Reconciliar, ou renomear um dos dois.
> 2. **`conciliada` está definida de duas formas.** `state-machines/transacao-bancaria.md` diz "match
>    resolvido **e executado/pronto**"; a postcondition abaixo diz "**nenhuma escrita no ERP** — só
>    rascunho local". Um estado cujo gatilho não toca o ERP não pode significar "executado".
>
> Ver `ontology/_inbox/recebimentos-status-writers-followups.md` (P2).

> **SKELETON (Fase 0). Implementação = Fase 2 (Módulo 2).** Casa um crédito (`TransacaoBancaria`)
> contra `DocumentoAReceber` em aberto e **classifica** o match: `unica` / `multiplas` (candidatas) /
> `parcial` / `nenhuma`. Match incerto vai para a **fila de análise manual** — **nunca** vira baixa
> automática (invariante "sem baixa incorreta"). Cria um `Recebimento` rascunho. É análogo à eleição
> de Permutas (candidatas + gates) e ao matching por múltiplos sinais. Ver `entities/recebimento.md`.

## Sinais de matching (SKELETON — score na Fase 2)

Cliente/CNPJ · valor · nº documento · referência bancária · nº processo (`priCod`) · vencimento ·
descrição · id Pix. O motor pontua e classifica; a fórmula de score é **Fase 2**.

## Classificação (SKELETON)

| Classe | Significado | Roteamento |
|--------|-------------|------------|
| `unica` | 1 recebível casa com confiança | rascunho → rateio (Módulo 3) |
| `multiplas` | várias candidatas plausíveis | fila manual (analista escolhe) |
| `parcial` | casa parte do valor | rascunho parcial + diferença registrada |
| `nenhuma` | nenhum recebível casa | fila manual → possível `CreditoCliente` (adiantamento) |

## Invariantes (SKELETON)

- **Sem baixa incorreta:** match incerto **nunca** é auto-baixado — vai à fila manual (ADR-0002,
  human-in-the-loop). Ver `business-rules/invariante-rateio.md`.

## Por que está na ontologia (universalidade)

Universal: atribuir um crédito recebido ao(s) recebível(is) certo(s) é o coração da conciliação de
qualquer contas-a-receber. A estrutura (matching multi-sinal + classificação + fila manual para o
incerto) é do domínio; os pesos/limiares do score são config/calibração do tenant.

## Fora de escopo (Fase 0 — SKELETON)

- Fórmula de score, limiares de confiança, fonte exata dos recebíveis no ERP: **Fase 2**.
