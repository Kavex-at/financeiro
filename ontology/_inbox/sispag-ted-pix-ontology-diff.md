## Ontology Diff Proposal — sispag-ted-pix (2026-09-28)

> Escrito no worktree, **não commitado**. Aguarda aprovação do Yuri. ADR: **0054**
> (0053 está em uso na branch `feat/auth-permissoes-modulo`; na `main` a última é a 0052).

### Candidate analysis

| Candidato | Filtros | Decisão |
|---|---|---|
| `ItemLote.modalidade` (coluna da 0031, faltava na doc) | A:Y (CNAB 240 seg. A), B:onto, C:Y, D:existe no código, E:propriedade | ACCEPT (correção de doc) |
| `ItemLote.destinoManual` (conta ou chave, titular, autor) | A:Y (destino de TED/PIX é universal), B:estrutura onto, C:Y, D:novo, E:propriedade (value object, não entidade) | ACCEPT |
| Precedência do digitado sobre o cadastro (Q2) | A:N (motivo é o cadastro da Columbia), B:config em tese | ACCEPT na regra, com ressalva: candidata a config se um 2º cliente divergir (watchlist) |
| Invariantes D1–D9 → **I10a–i** | A:Y, C:Y (antifraude, fail-closed) | ACCEPT (business rule nova) |
| D8 mascaramento | NOT-DOMAIN em parte | ACCEPT na regra, marcado como requisito de proteção, não estado |
| Quatro olhos | decisão do usuário | REJECT-VOLATILE → watchlist (permissão específica depois, ADR-0053) |
| Escrita no `cmn025` (opção A) | substituída | REJECT agora; fallback só com conversa se H3/H5 falharem |
| Finalidade do TED como constante (H7) | não verificada | REJECT-PREMATURE → hipótese H7 + watchlist |
| TED→1, filtro de banco, PIX lido do `fin064` | bugs | sem diff de ontologia (só a regra resultante I10b/c/d) |
| Entidade `DestinoPagamento` | D:é propriedade do item | REJECT-DUPLICATE/propriedade antes de entidade |

### Antes → depois

**`entities/lote-pagamento.md`**
- ANTES: `ItemLote` = loteId, filCod, docCod, titCod, credor, valor, vencimento, incluidoPor. Invariantes I1–I8.
- DEPOIS: + `modalidade` (enum, null = a definir, CREDITO_CONTA fora da oferta, TED = 5), + `destinoOrigem`
  (derivado MANUAL|CADASTRO), + `destinoManual` (value object: `tipo`, `bancoCod`, `agencia(Dv)`, `conta(Dv)`,
  `chavePixTipo`, `chavePix`, `titularDocumento` obrigatório, `titularNomeDict?`, `informadoPor/Em`; colunas a criar).
  + invariante **I10** (resumo). Relação `ItemLote 0..1—1 DestinoManual`. `last_review` 2026-09-28.

**`business-rules/destino-pagamento-sispag.md`** (NOVO) — resolução única (manual > cadastro, qualquer banco,
default primeiro) e I10a–i; formato por tipo; H1/H3–H7; validação do segmento A.

**`decisions/0054-destino-de-pagamento-sispag-digitado-no-item.md`** (NOVO) — D1 só no item (substitui a opção A);
D2 digitado prevalece (risco de desvio alargado; mitigação titularidade + trilha + selo); D3 sem quatro olhos;
D4 tipo da chave escolhido; D5 congelamento (emenda 0039/0049); D6 H3 bloqueia, falha = **parar e falar com o
usuário**, HML com o usuário do `.env`; D7 H7 é hipótese; D8 crédito em conta segue oculto.

**`state-machines/lote-pagamento.md`** — L2 + `informarDestinoItem`; L3 exige destino TED/PIX resolvível.

**`actions/sispag/finalizar-lote.md`** — pré-condições: modalidade definida; destino TED/PIX resolvível (I10a).

**`_inbox/sispag-ted-pix-plan.md`** — §3 opção A riscada → opção B (ADR-0054), quatro olhos riscado; §4 Fases 2/3
reescritas; §6 H2 fora do caminho crítico, H3 volta a bloquear, + H5, H6, H7.

**`_index.json` / `_coverage.json`** — versão 0.29.0/0.28.0 → **0.30.0**; + business rule `destino-pagamento-sispag`
(planned); LotePagamento + impl_files (0031, LoteCard) e open_gap; `business_rules_total` 23→24, `planned` 9→10.

**`_inbox/_watchlist.md`**, **`CHANGELOG.md`** (ontologia) — entradas novas.

**Docs:** `docs/ontologia.md` não existe; `README.md` e `docs-contexto/03_ontologia_financeiro.md` não citam
TED/PIX. Sem diff de docs.
