# Regis-Review — `fix/sn-titulo-condicao-fail-closed` (2026-08-03, `--quick`)

> **Escopo:** delta de `fix/sn-titulo-condicao-fail-closed` contra `fix/sn-cond-pgto-finalizacao`
> (+117/−11 num único serviço, mais testes e ontologia). É a revisão de **um tweak**, não uma
> auditoria do sistema.
> **Nota de procedência:** as 8 seções foram produzidas pelos agentes de QA; esta consolidação foi
> escrita à mão porque o `qa-consolidator` caiu duas vezes (erro de API e, depois, limite de cota).
> As notas e os cards vêm dos arquivos de seção deste diretório; dois ajustes de fato foram
> aplicados sobre o que os agentes escreveram e estão registrados em "Findings rejeitados".

## Scorecard

| QA | Nota | Findings | Cards |
|---|---|---|---|
| Performance | **8** | 4 | 3 |
| Availability | **7** | 4 | 3 |
| Fault Tolerance | **7** | 5 | 5 |
| Security | **7** | 5 | 4 |
| Testability | **7** | 6 | 6 |
| Integrability | **6** | 7 | 7 |
| Modifiability | **5** | 6 | 5 |
| Deployability | **4** | 6 | 5 |

Média 6,4. As duas notas baixas (Deployability 4, Modifiability 5) medem **o vaso**, não o PR — ver a
separação abaixo, que é a leitura mais importante deste relatório.

## O que este PR INTRODUZIU

O tweak corrige um bug medido no ERP real: o `PUT com299` que troca o `pgtCod` **destruía o título a
receber** da Solicitação de Numerário, e sem título a finalização é recusada e o `fin014` não acha o
que baixar (`docs/e2e/gap-titulos-diagnostico.md`, docs 732–737 no HML).

Ganhos verificados pelos agentes:

- **Performance (8/10):** o caminho comum passou de **7 para 5 chamadas** ao ERP na completação da SN
  — a listagem paginada de condições, uma releitura e o PUT saíram do fluxo; entrou a leitura da
  com194. Uma escrita irreversível a menos por alocação.
- **Availability / Fault Tolerance:** três tactics novas — *Sanity Checking* (releitura exigindo
  `mnyTitValor === docMnyValor`), *Condition Monitoring* (com194 antes de decidir) e *Exception
  Prevention* (o PUT deixou de ser incondicional).
- **Testability:** a verificação pós-PUT é uma *Executable Assertion* que viaja com o serviço em
  produção, não fica confinada ao teste.

Riscos que o PR introduziu e que **já foram remediados nesta mesma rodada** (ver §Remediação).

## O que este PR REVELOU (dívida pré-existente, não causada aqui)

Separar isto importa: quatro dos achados mais graves existem desde antes do delta e apenas ficaram
visíveis porque alguém finalmente mexeu nesse código.

| Achado | Por que é pré-existente |
|---|---|
| `RecebimentoNumerarioService` com 1400 LOC, 30 métodos, 11 dependências | O serviço já orquestrava 7 etapas; o delta é +117/−11 e **não** aumentou o nº de dependências |
| `classificarAlocacao` com complexidade cognitiva 20 (máx. 15) | Confirmado com `biome check` **na branch base** |
| Idioma misto: 19 métodos pt-BR / 11 EN; 5 de 7 `throw` em pt-BR | Padrão do arquivo desde a origem; o delta acrescentou 4 métodos EN e 1 `throw` pt-BR |
| Sem runbook da Frente IV (`docs/runbooks/` só cobre Permutas) | A frente inteira nunca teve |
| Sem checkpoint intra-etapa no ledger | A completação sempre rodou dentro de um único `if` |

## Risco de fundo (atravessa 4 lentes)

**O comportamento medido em homologação diverge do observado em produção, e a causa é desconhecida.**
No HML o PUT da condição destrói as parcelas; em produção a SN 18345 manteve o título com a ordem
antiga. A implementação foi desenhada para não assumir nenhum dos dois — ela **verifica** o efeito e
falha fechada. Mas isso significa que:

1. o ramo condicional (`applyPaymentConditionIfRequired`) **não é exercitável em homologação** — o
   cliente de teste do HML não tem condição sugerida no cadastro, então a com194 nunca acusa lá;
2. a primeira execução real desse ramo acontece **em produção**;
3. nenhum teste, unitário ou de integração, exercita o caminho positivo completo (com194 exige → PUT
   aplica → título sobrevive).

Foi este o **P0** da revisão, e a remediação abaixo o endereça no plano operacional (visibilidade +
freio), não no plano da prova — a prova depende de uma execução real ou de um cliente de teste com
cadastro exigente no HML.

## Remediação aplicada nesta rodada

| Item | Origem | O que foi feito |
|---|---|---|
| **P0** | `F-deployability-4` | Flag `SN_COND_PGTO_AUTOAJUSTE` (default ON, opt-out) + log de tipo estável `sn-cond-pgto-exigida-pelo-erp` com `docCod`/`pesCod`/`idempotencyKey`, emitido **antes** da escrita. Com a flag OFF a etapa para com o documento **íntegro** |
| P2 ×2 | `F-fault-tolerance-2`, `integrability-5` | Gate 0 (transporte × domínio) na leitura da com194: 401/403/404/405 **param** a etapa; 5xx/timeout seguem best-effort. `STATUS_TRANSPORTE` compartilhada com `classifyValidatorError` |
| P1 | `F-testability-1` | O teste E2E voltou a exigir **exatamente uma** chamada com194 antes da homologação e uma depois (era `lastIndexOf`, que aceitava "alguma") |

Suíte após a remediação: **97 suites / 1024 testes verdes**, typecheck limpo.

## Findings rejeitados (com evidência)

- **`F-fault-tolerance-3` — "o discriminador `docVldFinalizado === 1` nunca foi implementado": FALSO.**
  Está em `src/backend/domain/client/ConexosGerDocProcessoClient.ts:734,748`
  (`assertDocumentoFinalizado`), que relê o documento, exige `docVldFinalizado === 1` e lança com o
  `docCod` na mensagem. O agente inspecionou apenas a camada de serviço e concluiu ausência a partir
  de escopo incompleto.
- **"Lint quebrado no CI": impreciso.** O `_shared-metrics.md` deste run herdou a afirmação do handoff
  anterior. A seção de Deployability mediu: `.github/workflows/ci.yml` roda em `ubuntu-latest` após
  `actions/checkout@v4`, que normaliza EOL para LF — **o lint no CI funciona**. A quebra é local, no
  Windows, por falta de `.gitattributes`. Prevalece a medição.

## Top 5 riscos remanescentes

1. **O ramo condicional só é provado em produção** (P0 mitigado, não eliminado) — visibilidade e
   freio existem; a prova não. Depende de execução real ou de cadastro exigente no HML.
2. **Decisão de escrita financeira depende de casar texto em português do ERP**
   (`/CONDICAO DE PAGAMENTO/`) — falha silenciosa nos dois sentidos se a Conexos reescrever a frase.
   Sem fixture HAR versionada.
3. **Sem checkpoint intra-etapa no ledger** — apontado independentemente por Availability, Fault
   Tolerance e Testability. Crash entre item e finalização deixa documento órfão e a retomada não
   sabe onde parou.
4. **Falha do fail-closed é indistinguível de qualquer outro erro** — a divergência HML×produção não
   tem contador dedicado; ninguém saberia que o caso apareceu até virar chamado.
5. **Sem runbook da Frente IV** somado a `autoDeploy: true` — escrita irreversível em ERP financeiro
   sem procedimento escrito de recuperação.

## Cards

Total: **38 cards** — 1 P0 (remediado), 7 P1 (3 remediados), 20 P2, 10 P3. Lista completa e ordenada
em `KANBAN.md`. Os não remediados viram follow-ups em
`ontology/_inbox/sn-titulo-condicao-fail-closed-regis-followups.md`.

## Próxima ação recomendada

Validar a cadeia no HML (Fase B) **antes** do PR — decisão do Yuri em 2026-08-03. O tweak destrava a
SN; o objetivo é ver o fluxo seguir para `fin014` → NDe → fiscal → SEFAZ. Só depois: bump de versão,
rebase e PR.
