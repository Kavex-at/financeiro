---
name: gerarSolicitacaoNumerario
type: action
entity: Recebimento
ontology_version: "0.11"
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts
  - src/backend/domain/interface/recebimentos/GerDocProcesso.ts
  - src/backend/domain/service/recebimentos/stubs/ProcessoProviderStub.ts
  - src/backend/routes/recebimentos.ts
  - src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx
last_review: 2026-07-28
preconditions:
  - "TransacaoBancaria (crédito) presente no painel de Recebimentos (aba Transações)."
  - "Operador aciona 'Alocar' na transação e ESCOLHE um processo candidato (human-in-the-loop)."
  - "Processo candidato fornecido por um provedor (STUB in-memory nesta iteração; matching/Conexos no futuro)."
postconditions:
  - "DRY-RUN: o payload GerDocProcessoSelectionDTOCab da Solicitação de Numerário (encomenda) é CONSTRUÍDO e devolvido (dryRun:true)."
  - "NENHUMA escrita no Conexos — não há caminho de POST alcançável (o seam de envio lança NotImplementedError)."
  - "Valor da SN = valor CRU da transação (a regra de % da encomenda é NÃO-RESOLVIDA)."
side_effects:
  - "NENHUM efeito colateral externo — apenas construção de payload + log de auditoria (dry-run)."
---

# gerarSolicitacaoNumerario — "Processar" processo → SN encomenda (com299/gerDocProcesso) — DRY-RUN

> **DRY-RUN-ONLY (iteração atual).** No painel `/recebimentos`, o botão **"Alocar"** de uma
> `TransacaoBancaria` abre um modal com os **processos** candidatos. Cada processo tem **"Processar"**,
> que **gera uma Solicitação de Numerário (encomenda)** via com299 `gerDocProcesso` — mas **apenas
> CONSTRÓI e devolve o payload** `GerDocProcessoSelectionDTOCab` (`{ dryRun: true, docConfig,
> payload }`). **Não há nenhuma chamada de escrita ao Conexos**: o seam de envio real
> (`SolicitacaoNumerarioService.enviarAoErp`) lança `NotImplementedError` para garantir que **nenhum
> caminho de escrita no ERP é alcançável** até HML/HAR confirmarem o `gcdCod` e o shape exatos. Ver
> `integrations/conexos-com299-gerdoc.md`.

## Fluxo (iteração atual)

1. **Alocar** (transação) → `GET /recebimentos/transacoes/:txnId/processos?filCod=…` lista os
   processos candidatos (filtro por `filCod` da transação + casamento FROUXO por contraparte). Fonte:
   **STUB in-memory** (fixtures) atrás de um port + DI token (`ProcessoProviderInterface` /
   `PROCESSO_PROVIDER_TOKEN`) — sem matching-engine, sem DB/SQL.
2. **Processar** (processo) → `POST /recebimentos/transacoes/:txnId/solicitacao-numerario` →
   `SolicitacaoNumerarioService.gerar()` monta o payload com a configuração de documento
   **"Solicitação de Numerário - Encomenda"** (`gcd`) e o devolve com `dryRun: true`.

## Configuração de documento (gcd)

- `gcdDesNome = "Solicitação de Numerário - Encomenda"` (Configuração de Documento no com299).
- `gcdCod = 0` — **PLACEHOLDER**. O código real precisa de confirmação **HML/HAR** antes de qualquer
  envio ao ERP (ver `integrations/conexos-com299-gerdoc.md`).

## Valor da SN — regra de encomenda NÃO-RESOLVIDA

- O montante da SN usa hoje o **valor CRU da transação bancária**.
- A regra de **percentuais da encomenda (0,1% / 0,9%)** — base de cálculo, significado de cada
  percentual, contas de destino, arredondamento — é **NÃO-RESOLVIDA**. Não foi inventada.
  Ver `ontology/_inbox/frente-iv-recebimentos-nde-plan.md §7 Q4` e
  `business-rules/encomenda-percentuais.md`. TODO no código: `TODO(encomenda-percentuais)`.

## Invariantes

- **DRY-RUN-only:** nenhum efeito colateral no ERP; nenhum caminho de escrita alcançável (o envio
  real lança `NotImplementedError`).
- **Human-in-the-loop:** o operador escolhe o processo a processar; nada é automático.
- **Multi-filial (I):** o `filCod` da transação/processo é validado contra a filial-permitida do
  usuário (authz por-filial → 403). A rota de "Processar" é write-ish → `requireRole('admin')` +
  rate-limit, ainda que seja apenas simulação.

## Por que está na ontologia (universalidade)

Universal: transformar um crédito conciliável em uma **solicitação de numerário** (documento
financeiro no ERP) é um passo recorrente de contas-a-receber com encomenda. A estrutura (escolher o
processo → montar o documento parametrizado → gate humano → dry-run antes do write real) é do
domínio; os códigos (`gcdCod`, contas de rateio) e os percentuais são config/contrato do tenant.

## Fora de escopo (iteração atual)

- Envio real ao Conexos (`enviarAoErp`) — **desabilitado** (lança `NotImplementedError`), habilitar só
  com HML creds + HAR confirmando `gcdCod` + campos do payload.
- Regra de percentuais da encomenda (§7 Q4) — **NÃO-RESOLVIDA**, aguarda stakeholder.
- Fonte real dos processos candidatos (Conexos / matching-engine) — troca-se o token do provedor sem
  tocar rota/serviço.
