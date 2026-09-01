# Follow-ups — `copiar-barcode-item-lote`

> **Regis-Review:** `docs/regis-review/2026-09-01-1944-copiar-barcode-item-lote/`
> (`REPORT.md` / `KANBAN.md`). **Score 7,0 · 0 P0 · gate VERDE.**
> 31 cards: P0=0 · **P1=7** · P2=15 · P3=9.
>
> | QA | Score | | QA | Score |
> |---|---|---|---|---|
> | Deployability | 8 | | Availability | 7 |
> | Integrability | 8 | | Modifiability | 7 |
> | Fault Tolerance | 7 | | Performance | 6 |
> | Security | 7 | | Testability | 6 |

## Corrigidos NESTA branch (não são follow-up)

- ✅ **P1 · PatternGuardian — rota sem `requireRole('admin')`.** `GET /lotes/:id/linhas-digitaveis`
  devolvia linha digitável a qualquer usuário autenticado. Mesma classe de dado do download do
  `.REM`, que já tinha o guard com justificativa LGPD Art. 6º / LC 105. Guard adicionado **e
  coberto por teste de 403**.
- ✅ **P1 · DesignSystemReviewer — tooltip de 187 chars** contra o limite de 80 do `feedback.md`.
  Reduzido para 68.
- ✅ **P1 · integrability-1 + testability-2 — `itsNumCodbar` fora do `contrato.test.ts`.**
  Dois agentes convergiram independentemente. Corrigido aqui porque **não é finding novo, é
  trabalho meu incompleto**: o contract test é o mecanismo do repo para declarar campo lido do
  ERP, e esta feature criou uma leitura sem declará-la. A fixture já continha a chave.

## P1 — priorizar antes de considerar a frente fechada

| Card | QA | Finding | Ação |
|---|---|---|---|
| `security-1` | Security | **Interceptor axios vaza a linha digitável.** `services/conexos.ts:145-152` loga o body de resposta **sem redação** no ramo de erro; `itsNumCodbar` não está em `SENSITIVE_KEYS`. O teste de anti-vazamento do serviço é derrotado uma camada abaixo | Adicionar o campo à lista **e** aplicar `redactSensitive` também no ramo de resposta. **Toca código legado compartilhado por todas as frentes — merece revisão própria, por isso não foi feito aqui** |
| `fault-tolerance-3` | Fault Tolerance | **DV da linha digitável não validado.** O regex `/^\d{47}$/` valida formato, não os 4 DVs (3 módulo-10 + 1 módulo-11). O repo valida DV de 100% dos 44 díg. na ESCRITA (`RemessaCnabValidator.dvBarrasValido`) e 0/47 na LEITURA — e essa validação já pegou DV inválido em arquivo real enviado ao banco (`PG121101.REM`, R$ 37.567,14). Consequência: a analista copia e paga errado | `.refine(linhaDigitavelDvValida)` no schema, espelhando o algoritmo existente |
| `fault-tolerance-2` | Fault Tolerance | **Descarte silencioso do Zod.** Linha reprovada some sem contador — indistinguível de "não há boleto". É a classe de defeito do ADR-0040 com roupa nova (`continue` em vez de `?? ''`) | Emitir `{ total, dropped }` em log, sem logar as rows |
| `performance-1` | Performance | **`pageSize: 500` sem paginar.** Mesmo antipadrão que o método vizinho documenta ter causado bug real. **Medido em PRD 2026-09-01: 31 lotes nativos nas 5 filiais, maior = 41 itens** → risco é de crescimento, não atual | Paginar de verdade, ou ao menos usar o `count` para avisar quando truncar |
| `testability-1` | Testability | `LoteCard.tsx` +62 LOC (estado, efeito, handler de clipboard) **sem teste**. Ratio de `app/sispag/` = 0/4 | Teste de componente com `navigator.clipboard` mockado; incluir a regra "toast não repete os 47 dígitos", que existe no backend e não no front |
| `availability-1..3` | Availability | Único canal de detecção da degradação é grep manual. O `BUSINESS_WARN` carrega só `err.message` — perde `code`, `statusCode`, `endpoint`, `retryable` do `ConexosError`. HTTP responde sempre `200 {itens:[]}`, então alarme de `5xx` nunca dispara | Enriquecer o log e derivar métrica |

## P2/P3 — dívida

Lista completa em `KANBAN.md`. Destaques:

| Card | QA | Finding |
|---|---|---|
| `security-2` | Security | Rota só no `globalLimiter` (100/min); deveria estar no `heavyRouteLimiter` (10/min), como as outras de fan-out. **O `.REM` tem o mesmo problema** |
| `security-3` | Security | Sem audit trail persistido — nem para a rota nova, nem para o precedente `.REM` |
| `deployability-2` | Deployability | Sem kill-switch por env. O repo já tem o padrão (`SISPAG_DDA_ASSOC_ENABLED`, `RECEBIMENTOS_ENABLED`); sem ele, conter incidente exige revert+redeploy (~5min) em vez de flag (~30s) |
| `performance-2` | Performance | `LoteCard` refaz a chamada a cada expansão do card. A linha digitável é **imutável** após a remessa — cabe cache por `l.id` |
| `modifiability-1` | Modifiability | DTO `{docCod;titCod;linhaDigitavel}` inline em 5 pontos de 3 arquivos |
| `modifiability-2` | Modifiability | `ConexosSispagWriteClient` tem 8 métodos de leitura e 5 de escrita — o nome mente desde antes deste delta. Rename para `ConexosFin015Client` |
| `integrability-3` | Integrability | `listarChavesDoLote` e `listarLinhasDigitaveisDoLote` leem o mesmo grid com ~25 linhas 95% idênticas |
| `testability-3` | Testability | Os 5 casos do client são mocks sintéticos de 3 campos; o grid real tem 50+ colunas |

## As duas causas-raiz (o consolidador as isolou)

**CC-1 — Silêncio no lugar de sinal.** A cadeia protege bem contra dado **errado** (Zod estrito,
sem coerção, honrando o ADR-0040) e mal contra dado **ausente**. Rename do campo → Zod reprova
tudo → `[]` → o serviço nem entra no `catch` → nenhum log → o botão some. Alimenta
`fault-tolerance-2`, `availability-1..3`, `integrability-4`.

**CC-2 — Assimetria escrita/leitura.** O repo é rigoroso validando o que **escreve** no arquivo
bancário e frouxo validando o que **lê** dele. Alimenta `fault-tolerance-3` e `security-1`.

## Fora de escopo, herdado do tasks.md

**Bug separado, vivo na `main`:** `prontoParaRemessa` é sempre `true`
(`ConexosSispagClient.ts:158`). `numOpt` = `z.coerce.number()` coage `null` → `0`, então
`r.itsVldModalidade !== undefined` nunca é falso. Com `temBoleto` e `temContaBanco` fixos em
`false` desde o ADR-0040, esse virou o **único** termo da expressão — o aviso "Pode faltar
cadastro de pagamento" (`page.tsx:753`) nunca dispara. Merece card próprio. É, aliás, mais um
caso de CC-1.
