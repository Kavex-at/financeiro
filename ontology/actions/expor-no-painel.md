---
name: exporNoPainel
type: action
entity: PermutaCandidata
ontology_version: "0.2"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-09-15
preconditions:
  - "Candidatas avaliadas (gates + casamento + variação quando disponível)."
postconditions:
  - "Endpoint de leitura retorna o backlog elegível + bloqueadas, com aging e estado."
  - "Nenhuma escrita no ERP (I4)."
side_effects:
  - "Persistência de snapshot/auditoria do backlog (Postgres — migration-debt O5, I5)."
resolved-by:
  - "P0-8 — aging conta da DATA-BASE (CI da D.I / desembaraço da DUIMP) (Yuri, 2026-06-17)"
  - "P0-4 — leitura do campo wire da data-base RESOLVIDA (cdiDtaCi / dioDtaDesembaraco); probe de rede 2026-06-18; a coluna aging agora popula"
---

# exporNoPainel

> **Etapa 5.** Agrega as `PermutaCandidata` (elegíveis e bloqueadas) com **aging** e expõe
> no endpoint de leitura do painel READ-ONLY.

> **2026-09-08 (ADR-0043):** o endpoint legado `GET /permutas/painel` (`PainelService`, projeção
> binária do snapshot, **zero call sites** no frontend) foi **removido**. A ação passa a ter um
> único implementador — `GestaoPermutasService` + `src/frontend/app/permutas/page.tsx` —, que expõe
> os estados sem achatamento. `PainelService` nunca constou de `_index.json`: a remoção não deixa
> ação órfã.

## Comportamento

- Elegíveis (4 gates + INVOICE casada) e bloqueadas (com motivo) são ambas expostas — as
  bloqueadas como visibilidade, **não** como falha (glossary "Pendência bloqueada"). Motivos de
  bloqueio reportados conforme a taxonomia (`composto-nm`, `sem-invoice`, `multiplas-invoices`,
  `falha-gate`, `data-base-indisponivel` — ver state-machine).
- READ-ONLY: nenhuma ação de execução é oferecida aqui (a execução é a Fatia 2, I1/I4).
- **Aba Histórico (ADR-0046, 2026-09-14).** Lista o que saiu das abas de trabalho porque foi lançado
  pelo painel (casamentos sugeridos, múltiplas manuais, cross-over, cross-process) **e também** os
  adtos em `JA_PERMUTADO` que têm borderô gerado pelo painel. Sem duplicar entrada (chave adto +
  borderô). Motivo: a prioridade de motivos e a tolerância de R$1,00 (ADR-0046) levam a `JA_PERMUTADO`
  adtos que o painel baixou (43 com execução real `settled`, R$ 18,0 mi, antes exibidos como "Sem
  D.I"). Sem esta regra eles sumiriam do Histórico ao migrar de estado.
- Saldo restante exibido (`permuta-manual` / `casamento-manual`) segue I-Permuta-1: desconta só as
  alocações ainda não consumidas pelo ERP (ADR-0046).

## Exceção manual "permutado fora do painel" (ADR-0047, 2026-09-15)

- **Card/filtro.** O adto com `ExcecaoPermuta` aplicada (T7) conta e aparece em **"Já permutado"**, não
  em "Bloqueadas". Não há estado, card nem aba novos.
- **Badge + tag.** Badge "Já permutado" + tag **"Exceção manual"**. A tag deriva do motivo
  `permutado-fora-do-painel`, não de existir uma linha de exceção.
- **Detalhe.** Justificativa, autor (`criadoPor`), data (`criadoEm`) e a ação **"Desfazer exceção"**
  (admin). Para adto em `BLOQUEADA / sem-saldo-permutar`, a ação **"Marcar como permutado fora do
  painel"** (admin, justificativa obrigatória). Nenhum outro estado ou motivo oferece a ação.
- **Exceção ativa não aplicada** (I-Exc-2: o ERP mudou e a guarda falhou). O adto aparece no estado
  calculado; o detalhe sinaliza a exceção como **inativa**, com a mesma trilha e a ação de desfazer.
- **Histórico.** A exceção **não** entra na aba Histórico: não é permuta do painel e não tem borderô
  (I-Exc-6). A regra de D4 da ADR-0046 continua valendo só para `ja-permutado` com borderô do painel.
- **Exportação.** A coluna `Motivo bloqueio` do Excel de adiantamentos mantém o código cru
  (`permutado-fora-do-painel`), como os demais motivos. Quatro colunas trazem a exceção: `Exceção manual`
  (**"Permutado fora do painel (exceção manual)"** aplicada, **"Registrada, não aplicada"** quando o
  cálculo venceu, vazia sem exceção ativa), `Justificativa exceção`, `Autor exceção` e `Data exceção`.
- READ-ONLY em relação ao ERP: marcar e desfazer escrevem só no nosso banco (I4).

## Aging (P0-8 + P0-4 — RESOLVIDOS; coluna aging popula)

- A idade da pendência conta a partir da **DATA-BASE** = data CI da D.I (`imp019.cdiDtaCi`) **OU**
  data de desembaraço da DUIMP (`imp223.dioDtaDesembaraco`). `aging = hoje − dataBase`. Define a
  coluna "aging" e o ordenamento do backlog (mais antigo primeiro). Ver
  `business-rules/aging-anchor.md`.
- **P0-4 RESOLVIDO (probe 2026-06-18):** os campos wire da data-base foram capturados — a **coluna
  aging agora popula**. Não mais gated.

## Auditoria (I5)

- Toda execução do job e leitura sensível é registrada/persistida (quem/quando/o quê).
  Persistência via Postgres (migration-debt O5; modelagem da tabela → TaskScoper/infra).
