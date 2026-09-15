---
name: ExcecaoPermuta
type: entity
ontology_version: "0.2"
# Implementada em v0.26.1 (ADR-0047): migration 0059, serviço/repositório, rotas admin e UI.
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0059_excecao_permuta.sql
  - src/backend/domain/interface/permutas/ExcecaoPermuta.ts
  - src/backend/domain/repository/permutas/ExcecaoPermutaRepository.ts
  - src/backend/domain/service/permutas/ExcecaoPermutaService.ts
  - src/backend/domain/errors/ExcecaoPermutaRecusadaError.ts
  - src/backend/domain/service/permutas/EleicaoPermutasService.ts
  - src/backend/domain/service/permutas/GestaoPermutasService.ts
  - src/backend/routes/permutas.ts
  - src/frontend/app/permutas/components/ExcecaoManualDialog.tsx
  - src/frontend/app/permutas/components/DesfazerExcecaoDialog.tsx
properties:
  - adiantamentoDocCod
  - justificativa
  - criadoPor
  - criadoEm
  - removidoPor
  - removidoEm
  - ativa
  - aplicada
relationships:
  - "ExcecaoPermuta N—1 Adiantamento (via adiantamentoDocCod; no máximo 1 ativa por adto, histórico por soft-delete)"
  - "ExcecaoPermuta influencia a transição da PermutaCandidata BLOQUEADA(sem-saldo-permutar) → JA_PERMUTADO (T7, ver state-machine)"
last_review: 2026-09-15
universality_evidence:
  - "ADR-0047 — exceção manual 'permutado fora do painel', decidida pelo usuário (tech@kavex.at) em 2026-09-15"
  - "Columbia, adto 8721 (proc 124, COPPER/CODELCO, R$ 20.373.009,89): permuta feita por baixas cruzadas manuais (conta 21 ↔ 198, 30/04) fora do fluxo de permuta do Conexos; ERP com Valor permutado = 0"
  - "Conceito de domínio: permutas feitas fora do fluxo oficial do ERP (antes da ferramenta, por lançamento manual) existem em qualquer trading com histórico; o ERP não as marca e nenhum dado lido distingue 'nunca permutado' de 'permutado por fora' com segurança. A FORMA (override auditado, restrito a um estado) é estrutura; os VALORES (quais adtos) são configuração do cliente. Evidência de 1 cliente só: revisitar a universalidade se não aparecer em outro"
---

# ExcecaoPermuta (configuração: "permutado fora do painel")

> Marca, mantida pelo **analista**, de que um adiantamento **já foi permutado fora do fluxo de
> permuta do Conexos**, embora o ERP informe `valorPermutado = 0`. Com a exceção ativa e a guarda
> satisfeita, a eleição classifica o adto como `JA_PERMUTADO` com motivo `permutado-fora-do-painel`
> em vez de `BLOQUEADA / sem-saldo-permutar`. É a entidade de **configuração** da ADR-0047.

## Natureza: estrutura na ontologia, valores na configuração

Mesmo padrão do `ClienteFiltro` (ADR-0007): a **forma** (um override auditado de classificação,
restrito a um estado calculado) é domínio; **quais** adiantamentos têm exceção é configuração do
cliente, persistida em tabela própria e mantida no frontend.

A diferença para o `ClienteFiltro`: o cliente-filtro roteia **uma classe** (todos os adtos de um
importador); a exceção vale para **um documento**. Ela não generaliza, de propósito: não há regra
automática confiável que reconheça "permutado por fora" (ADR-0047, alternativas rejeitadas).

## Propriedades

| Propriedade | Tipo | Origem | Notas |
|-------------|------|--------|-------|
| `adiantamentoDocCod` | number | chave natural | `docCod` da PROFORMA (adiantamento). No máximo **uma** exceção ativa por adto. |
| `justificativa` | string | input do analista | Obrigatória, texto livre, **10 a 500** caracteres (após trim). |
| `criadoPor` | string | JWT verificado | Identidade do analista (`req.user.sub`), **nunca** input do cliente (padrão ADR-0006). |
| `criadoEm` | Date | servidor | Auditoria. |
| `removidoPor` | string? | JWT verificado | Preenchido ao desfazer (soft-delete). |
| `removidoEm` | Date? | servidor | Preenchido ao desfazer. `removidoEm IS NULL` ⇔ ativa. |
| `ativa` | boolean | derivada | `removidoEm` ausente. |
| `aplicada` | boolean | derivada | `ativa` **e** o estado calculado do adto (sem a exceção) é `BLOQUEADA / sem-saldo-permutar`. Uma exceção ativa e não aplicada é sinalizada no painel como inativa. |

## Invariantes

- **I-Exc-1 (guarda).** A exceção só **se cria** e só **se aplica** quando o estado calculado do adto,
  sem a exceção, é `BLOQUEADA` com motivo `sem-saldo-permutar` (pago dentro da tolerância, `valorPermutar
  ≤ R$1,00`, `valorPermutado` 0 ou ausente; ADR-0046). Qualquer outro estado ou motivo recusa a criação
  (422). A exceção **nunca** tira um adto de `nao-pago`, `data-base-indisponivel`, `sem-invoice`,
  `permuta-manual`, `casamento-manual` ou `elegivel`.
- **I-Exc-2 (o ERP vence).** A cada eleição a guarda é reavaliada sobre o dado relido. Se o estado
  calculado deixar de ser `sem-saldo-permutar` (saldo reapareceu, título reaberto, `valorPermutado > 0`),
  vale o estado calculado; a exceção fica registrada, ativa e **não aplicada**, e a eleição emite
  `BUSINESS_WARN`. Com `valorPermutado > 0` o resultado é `JA_PERMUTADO / ja-permutado` (motivo do ERP).
- **I-Exc-3 (unicidade).** No máximo 1 exceção ativa por `adiantamentoDocCod`. O histórico é o conjunto
  das removidas.
- **I-Exc-4 (auditoria, I5).** Autor e data de criação e de remoção vêm do servidor e do JWT; a
  justificativa é imutável (para mudar, desfaz e cria outra).
- **I-Exc-5 (sem escrita no ERP, I4).** A exceção só muda a classificação no nosso banco. Nenhuma
  chamada de escrita ao Conexos.
- **I-Exc-6 (não é permuta).** A exceção não cria `Permuta`, alocação, execução nem borderô. Não entra
  na aba Histórico.

## Ações

- **Marcar** (`POST`, admin): valida I-Exc-1 sobre o estado gravado do adto e I-Exc-3; grava a exceção.
- **Desfazer** (`DELETE`/soft, admin): grava `removidoPor`/`removidoEm`; o adto volta ao estado calculado.
- A **eleição** (`elegerAdiantamentos`, cron e botão) aplica a exceção ativa depois da avaliação dos gates
  e do roteamento de cliente-filtro (os dois são mutuamente exclusivos: T4 exige saldo, I-Exc-1 exige sem
  saldo).

Rotas, status HTTP e o efeito imediato na linha de `permuta_adiantamento` são decisão de implementação
(ver `_inbox/permutas-excecao-manual-interview.md`, "Defaults"). Como ficou (v0.26.1):
`POST /permutas/adiantamentos/:docCod/excecao-manual` `{ justificativa }` e `DELETE` na mesma rota, ambas
admin; 400 corpo inválido, 401 sem identidade no token, 404 adto fora do backlog ou sem exceção ativa, 409
exceção já ativa, 422 guarda. Marcar e desfazer reclassificam a linha de `permuta_adiantamento` na mesma
transação da exceção (desfazer só reverte se o motivo gravado for `permutado-fora-do-painel`).

## Fora de escopo

- Reconhecer automaticamente "permutado por fora" (conta da baixa, baixas cruzadas): rejeitado (ADR-0047).
- Exceção para outros estados ou motivos.
- Qualquer ajuste no Conexos.
