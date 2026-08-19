---
name: status-etapa-fail-safe
type: business-rule
entity: EtapaAprovacao
ontology_version: "0.10"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/interface/aprovacoes/constants.ts
  - src/backend/domain/service/aprovacoes/EtapaStatusResolver.ts
  - src/backend/domain/service/aprovacoes/EtapaStatusResolver.test.ts
  - src/backend/domain/service/aprovacoes/StatusWorkflowResolver.ts
  - src/backend/domain/service/aprovacoes/StatusWorkflowResolver.test.ts
  - src/backend/migrations/0049_aprovacao_trilha.sql
  - src/frontend/app/aprovacoes/components/status-badges.tsx
last_review: 2026-08-19
---

# Regra — status desconhecido do ERP nunca vira "aprovado"

> **Esta regra existia só no código.** Ela é citada pela [máquina de estados da
> etapa](../state-machines/etapa-aprovacao.md), pelo [ciclo do
> título](../state-machines/aprovacao-titulo.md) e pelo ADR-0038 (D5), mas não tinha arquivo próprio
> — e é a regra que impede a Frente V de produzir o único erro que a inviabilizaria: um painel
> financeiro que afirma, com números redondos, coisas que ninguém consegue auditar.

## Enunciado

```
statusErp ∈ ETAPA_STATUS_ERP          →  o status mapeado
statusErp ∉ ETAPA_STATUS_ERP          →  INDETERMINADO   + lacuna STATUS_ETAPA_DESCONHECIDO
statusErp ausente                     →  INDETERMINADO   + lacuna STATUS_ETAPA_DESCONHECIDO
"respondido" sem ação registrada      →  INDETERMINADO   + lacuna ACAO_ETAPA_DESCONHECIDA
"respondido" com ação não reconhecida →  INDETERMINADO   + lacuna ACAO_ETAPA_DESCONHECIDA
```

E, propagando para o título:

```
alguma etapa INDETERMINADO  →  o TÍTULO inteiro é INDETERMINADO,
                               precedendo REJEITADO, AGUARDANDO e APROVADO
```

**Em nenhum caminho um valor desconhecido produz `CONCLUIDA` ou `APROVADO`.** O valor bruto é
sempre preservado em `aprovacao_etapa.status_erp`.

## Os 13 casos reais que motivaram a regra

Sondagem read-only em produção (filial 2, amostra de 300 títulos, 2026-08-18). `ftbVldStatus` assumiu
**três** valores:

| `ftbVldStatus` | Ocorrências | Leitura | Status derivado |
|---|---|---|---|
| `1` | 8 | pendente — nesses, `ftbTimCmd == ftbTimBloq` | `PENDENTE` |
| `2` | 156 | respondido — bate com o "Respondido" da tela `PSQ_027` | `CONCLUIDA` (conforme a ação) |
| `7` | **13** | **sem legenda em lugar nenhum** | **`INDETERMINADO`** |

O spec OpenAPI do Conexos **não traz legenda para este enum** — diferente de `docTip`,
`titVldStatus` e `titVldBloq`, que trazem. A legenda viria do `configList` da tela de log, que
depende do acesso ao `fin103` (**PV-07**). A pendência aberta é **PV-01**.

Treze etapas não são um caso de borda estatístico: são **7,7%** das etapas observadas na amostra.
Classificá-las como aprovadas por chute contaminaria a mediana, a média e o p90 — os três números
que a frente existe para entregar — e faria isso **de forma invisível**, que é o pior modo de errar.

## Por que fail-safe assim, e não "otimista"

Um painel de contas a pagar tem uma assimetria de custo brutal entre os dois erros possíveis:

| Erro | Como aparece | Custo |
|------|--------------|-------|
| Dizer "não sei" sobre algo que **estava aprovado** | badge `INDETERMINADO` + lacuna na tela | O analista pergunta, alguém responde, a pendência fecha. **Autocorretivo** |
| Dizer "aprovado" sobre algo que **não sabemos ler** | nada aparece | Ninguém procura o que não parece errado. **Permanente e silencioso** |

O primeiro erro se resolve sozinho porque é **visível**. O segundo nunca se resolve porque não existe
sintoma. Por isso a regra escolhe deliberadamente o erro barulhento.

`INDETERMINADO` **não é** um fallback envergonhado nem um estado de erro: é estado de primeira classe,
renderizado como badge próprio, com a lacuna ao lado, e o valor bruto `statusErp` chega até a UI. O
analista consegue apontar para o número e dizer "esse 7 é X" — que é exatamente como a pendência fecha.

## Por que o valor bruto é preservado

`aprovacao_etapa.status_erp` guarda o número do ERP **mesmo quando ilegível**.

Sem isso, fechar PV-01 exigiria **reingerir 23.632 títulos** a uma chamada de ERP por título — horas
de varredura para recuperar uma informação que já tínhamos em mãos e jogamos fora. Com o valor bruto
guardado, fechar a pendência é:

1. uma linha em `ETAPA_STATUS_ERP`;
2. uma migration `UPDATE ... WHERE status_erp = 7` reclassificando as etapas;
3. um recálculo do `status_workflow` dos títulos afetados.

Guardar o dado que não se sabe interpretar custa uma coluna. Não guardá-lo custa a reingestão inteira.

## Por que `INDETERMINADO` precede tudo no título

As demais regras de derivação (`REJEITADO`, `AGUARDANDO`, `APROVADO`) **afirmam algo** sobre o título.
Havendo uma etapa ilegível na trilha, qualquer uma dessas afirmações pode estar errada — e "aprovado"
é a mais cara de errar num painel de contas a pagar, porque é a que leva alguém a parar de perguntar.

O estado honesto é "não sei", e a UI mostra a lacuna que explica por quê.

## Ponto único de interpretação

`ETAPA_STATUS_ERP`, em `src/backend/domain/interface/aprovacoes/constants.ts`, é **o único lugar do
código que traduz o número cru**. Nenhum outro ponto compara `ftbVldStatus` com literal.

Isso é o que torna a regra barata de manter: fechar PV-01 é uma edição de uma linha, não uma caçada
por comparações espalhadas. Se o número vazasse para os serviços, cada novo valor observado viraria
uma varredura pelo repositório.

A mesma disciplina vale para as **ações**: `ACAO_CONCLUSIVA` (`LIBERAR`, `APROVAR`) e `ACAO_REJEICAO`
(`CANCELAR`, `RECUSAR`, `REJEITAR`) são listas nomeadas. ⚠️ A segunda é **aposta, não fato**: nenhuma
recusa foi observada em produção (169 etapas resolvidas, todas `LIBERAR` ou `APROVAR`). Se a recusa
real usar outro rótulo, ela **não casa** e a etapa cai em `INDETERMINADO` com lacuna visível — nunca
em `CONCLUIDA`. Esse é o comportamento desejado, e é a regra funcionando, não falhando.

## A contra-regra: o que aconteceria sem ela

A armadilha não é hipotética — **ela já enganou uma sondagem desta frente**.

O ERP tem uma "escada" de três liberações gravada no próprio título: `titVld1Libera`,
`titVld2Libera`, `titVld3Libera`. Pelo nome, parece ser o workflow de aprovação. A sondagem mostrou
que essas flags valem **`1` em 100% dos títulos**, sem timestamp e sem nome de pessoa: são
**vestigiais**.

Um painel construído sobre elas — sem nenhuma regra de fail-safe — diria que **tudo está aprovado,
sempre**, com uma taxa de aprovação de 100% e tempo médio zero. Passaria por plausível e estaria
completamente errado.

`titVld2Libera = 1` **não** significa "o nível 2 aprovou". A Frente V não usa essas flags em lugar
nenhum; o status vem das etapas de `FinTituloBloq`. Ver `glossary.md` § Frente V.

> **Follow-up para a Frente II:** `entities/titulo-a-pagar.md` ainda descreve `aprovado` como o AND
> de `titVld1/2/3libera`. O **código** do SISPAG usa `vldLib` do `fin064` e está correto — a
> **ontologia** é que descreve o campo errado. Corrigir em ciclo próprio (ADR-0038, § Follow-up).

## Contrato de teste

| Cenário | Resultado esperado | Onde |
|---------|--------------------|------|
| `ftbVldStatus = 7` | `INDETERMINADO`, nunca `CONCLUIDA` | `EtapaStatusResolver.test.ts` |
| `ftbVldStatus` ausente | `INDETERMINADO` | `EtapaStatusResolver.test.ts` |
| `ftbVldStatus = 2` sem `fbaDesNome` | `INDETERMINADO` + `ACAO_ETAPA_DESCONHECIDA` | `EtapaStatusResolver.test.ts` |
| `ftbVldStatus = 2` com ação desconhecida | `INDETERMINADO` + `ACAO_ETAPA_DESCONHECIDA` | `EtapaStatusResolver.test.ts` |
| `ftbVldStatus = 2` + `LIBERAR` (doc 4156) | `CONCLUIDA`, sem lacunas | `EtapaStatusResolver.test.ts` |
| `ftbVldStatus = 2` + `APROVAR` | `CONCLUIDA` (premissa PV-02) | `EtapaStatusResolver.test.ts` |
| rótulo com caixa/espaços diferentes | normalizado antes de comparar | `EtapaStatusResolver.test.ts` |
| uma etapa `INDETERMINADO` na trilha | título inteiro `INDETERMINADO` | `StatusWorkflowResolver.test.ts` |
| ingestão de título com status desconhecido | não vira aprovação ponta a ponta | `IngestaoAprovacoesService.test.ts` |

## Pendências que esta regra mantém sob controle

| ID | O que está em aberto | O que a regra garante enquanto isso |
|----|----------------------|--------------------------------------|
| **PV-01** | O que significa `ftbVldStatus = 7` | As 13 etapas aparecem como indeterminadas e visíveis, não como aprovadas |
| **PV-02** | `LIBERAR` × `APROVAR`; rótulos reais de recusa | Rótulo não reconhecido cai em `INDETERMINADO`, não em conclusão |
| **PV-07** | Acesso ao `fin103` (traria as legendas dos enums via `configList`) | O valor bruto está guardado; quando as legendas chegarem, a reclassificação é uma migration |
