---
run_id: 2026-10-05-2134-permuta-centavos-adto
scope: backend (delta de c099a55, --quick)
total_cards: 17
p0: 0
p1: 0
p2: 6
p3: 11
overall_score: 7.9
audience: arquitetos, devs sênior, tech lead
basis: 8 seções QA + _shared-metrics.md
---

# Regis-Review — teto do líquido no disponível do adto (I-Write-10 / ADR-0062)

> Consolidado a partir do relatório do `qa-consolidator`. Ele escreveu o `KANBAN.md`, mas a escrita
> deste arquivo foi recusada pelo harness, então o conteúdo foi transcrito pelo orquestrador.

**Veredito:** o delta está limpo. São 0 P0 e 0 P1, score geral 7,9/10 e 0 DIVERGENTE em 196 execuções
reais de produção. O foco dos próximos 30 dias é tornar observáveis e testadas as falhas silenciosas
do teto e depois extrair, numa única vez, a aritmética de ajuste.

## 1. Scorecard

Média ponderada: 70,9 / 9,0 = **7,9**.

| QA | Score | Findings | Cards |
|---|---|---|---|
| Availability | 8 | 2 | 2 |
| Deployability | 7 | 2 | 2 |
| Integrability | 8 | 2 | 2 |
| Modifiability | 7 | 3 | 3 |
| Performance | 9 | 2 | 1 |
| Fault Tolerance | 8 | 2 | 2 |
| Security | 8 | 2 | 2 |
| Testability | 8 | 3 | 3 |

## 2. Top 10 riscos

Todos são P2/P3. Nenhum é defeito do delta: são riscos de regressão silenciosa futura.

1. **R-1 — o teto pode se desligar sem aviso.** Se `bxaMnyValorPermuta` vier ausente ou malformado,
   `limitarAoDisponivelDoAdto` vira no-op (NaN cai no no-op). Não há fixture nem log nesse ramo. O
   defeito original atingiu 3 de 196 execuções (1,5%). Cards: integrability-1, fault-tolerance-2.
2. **R-2 — a fronteira de R$1,00 não tem teste.** Há teste em 4 de 6 ramos e nenhum para 1,00 contra
   1,01. Trocar `>` por `>=` passaria na suíte. Cards: testability-1, availability-2.
3. **R-3 — o FORA_TETO só aparece no Finalizar.** O ramo emite só BUSINESS_WARN. Aconteceu 1 vez em
   196 (borderô 2646, excesso de R$921 mil). Cards: availability-1, fault-tolerance-1.
4. **R-4 — não há rollback documentado nem kill-switch** no caminho de escrita financeira. Card:
   deployability-1.
5. **R-5 — o serviço hospedeiro tem 1231 LOC** (alvo ≤ 600) e 20 imports; o delta somou +71. Cards:
   modifiability-3, testability-3.
6. **R-6 — âncora e teto duplicam estrutura** (cerca de 60%), e a ordem entre os dois é um invariante
   implícito coberto por um único teste. Cards: modifiability-1, integrability-2.
7. **R-7 — o ajuste só fica rastreável no log**, e nenhum teste confere o log `LIMITADA`. Cards:
   security-2 (exige migration), testability-2.
8. **R-8 — o job de validação é código de segunda classe:** usa `rejectUnauthorized: false`, não tem
   script npm e acessa o método privado por cast. Cards: security-1, deployability-2, modifiability-2.
9. **R-9 — a latência por baixa não é medida.** Card: performance-1.
10. **R-10 — o SELECT do job não tem LIMIT.** São 196 linhas, irrelevante hoje. Sem card.

## 3. Achados transversais

- **CC-1 — falhas do teto não deixam rastro** (Availability, Fault Tolerance, Integrability,
  Testability). Resolver com integrability-1, fault-tolerance-2 e testability-1, e depois
  availability-1.
- **CC-2 — a aritmética monetária está presa num serviço de 1231 LOC** (Modifiability, Testability,
  Integrability). modifiability-1 e testability-3 propõem a mesma extração com nomes diferentes:
  alinhar o nome antes e fazer um módulo só.
- **CC-3 — o job de validação não tem o rigor de código de produção.** Resolver com deployability-2 e
  security-1.
- **CC-4 — a trilha de auditoria do ajuste vive só no log.** Resolver com security-2, availability-1
  e testability-2. fault-tolerance-1 depende de decisão de produto.

## 4. Quick wins (esforço S, P2+)

integrability-1, testability-1, deployability-1, availability-1, modifiability-1. modifiability-1
deve entrar junto com o próximo tweak de I-Write-6/10, e testability-1 antes dele.

## 5. Movimentos estratégicos (esforço M)

- **modifiability-3:** levar o serviço de 1231 para ≤ 800 LOC e de 20 para ≤ 15 imports. Depende de
  modifiability-1.
- **testability-3:** tirar a dependência de 6 stubs de ERP por caso. Depende de testability-1.

Planejar os dois como uma única extração em duas fatias.

## 6. O que está funcionando

1. O job de replay contra produção (0 DIVERGENTE em 196).
2. O disponível é relido do ERP a cada baixa, nunca vem de cache.
3. O teto é fail-closed: só reduz o líquido, com teto absoluto de R$1,00.
4. A tolerância tem fonte única (`LIMITE_BRL`).
5. O delta não adiciona nenhuma chamada de rede ou banco.
6. O cálculo de resíduo e de status `settled`/`parcial` fica preservado.
7. Os gates estão verdes: typecheck com 0 erros, lint com 0 erros (78 warnings pré-existentes),
   3773 testes em 203 suítes.
8. O delta tem ADR-0062, nenhuma migration, nenhuma flag e um método de 43 LOC.

## 7. Limitações

- Revisão `--quick`, com escopo restrito ao delta.
- Não foi possível medir localmente a taxa LIMITADA/fora-da-tolerância em produção, MTTR, p95,
  `npm audit` nem authn/authz. Não há `infra/`.
- A taxa de recusa em produção depois do fix não foi reconfirmada: o ground truth é replay de
  execuções passadas.

## 8. Ações para 30 dias

1. Fechar o CC-1 primeiro: integrability-1, fault-tolerance-2 e testability-1.
2. Documentar o rollback (deployability-1), registrar o script npm do validador (deployability-2) e
   começar a contar LIMITADA contra fora-da-tolerância (availability-1).
3. No próximo `/feature-tweak` de I-Write-6/10, fazer a extração única do CC-2: modifiability-1, depois
   modifiability-3 e testability-3.
4. Levar a decisão de fault-tolerance-1 a produto (abortar e mandar para a fila de exceção, ou seguir
   até o ERP). security-2 vem depois, se o ajuste tiver de ser persistido.
5. Encaixar security-1 na próxima migração de jobs. performance-1 e availability-2 ficam no backlog
   oportunístico.
