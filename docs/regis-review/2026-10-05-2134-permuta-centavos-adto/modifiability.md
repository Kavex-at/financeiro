---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-05-2134-permuta-centavos-adto
agent: qa-modifiability
generated_at: 2026-10-05T21:45:00-03:00
scope: backend
score: 7
findings_count: 3
cards_count: 3
---

# Modifiability — Regis-Review

> Escopo: delta do commit c099a55 (--quick, delta-scoped). Não é auditoria do repositório.

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / analista de negócio | Mudar o teto de tolerância de arredondamento (R$1,00) ou a conta de variação cambial usada ao absorver centavos | `ReconciliacaoPermutaService.baixarTitulo` (âncora I-Write-6 + teto I-Write-10) e `ToleranciaResiduo` | Design time, sem mudança de contrato com o ERP | Alterar a regra em um ponto único, sem tocar nas duas guardas separadamente | Arquivos tocados ≤ 2; testes a ajustar ≤ 1 describe |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC `ReconciliacaoPermutaService.ts` (pós-delta) | 1231 (+71 no delta; antes 1160) | max ≤ 600 | ❌ (já acima antes do delta; delta agrava 6%) | `wc -l` |
| LOC do método novo `limitarAoDisponivelDoAdto` | 43 (L1010-1052) | ≤ 60 | ✅ | leitura do arquivo |
| Cognitive complexity (Biome) no arquivo | 0 warnings | 0 | ✅ | `npx biome lint` filtrado por `noExcessiveCognitiveComplexity` |
| Fan-out de imports do arquivo | 20 | ≤ 15 | ⚠️ (delta não adicionou imports) | `grep -c '^import '` |
| Tolerância R$1,00 | 1 constante `ToleranciaResiduo.LIMITE_BRL`, reutilizada pelas duas guardas | 1 fonte | ✅ | `grep -rn LIMITE_BRL` |
| Duplicação âncora x teto | 2 métodos privados com a mesma assinatura de 8 campos, mesmo ctx de log, mesma estrutura warn/info | 1 abstração | ⚠️ | L946-999 vs L1010-1052 |
| Quebra de encapsulamento no job de validação | 1 acesso a método privado via `as unknown as` | 0 | ⚠️ | `jobs/validate-permuta-centavos-adto-v1.ts:54-55` |
| Violações de camada no delta | 0 (service usa apenas client/repository injetados; job só importa o service) | 0 | ✅ | leitura do diff |
| Números mágicos novos | 0 (usa `LIMITE_BRL`) | 0 | ✅ | leitura do diff |

### Apêndice A — Top-10 maiores arquivos (backend, não-teste)

| # | Arquivo | LOC |
|---|---|---|
| 1 | domain/service/recebimentos/RecebimentoNumerarioService.ts | 2415 |
| 2 | domain/service/sispag/RemessaService.ts | 1628 |
| 3 | domain/client/ConexosGerDocProcessoClient.ts | 1300 |
| 4 | domain/service/permutas/ReconciliacaoPermutaService.ts | 1231 (toca o delta) |
| 5 | domain/service/permutas/EleicaoPermutasService.ts | 1143 |
| 6 | domain/client/ConexosSispagWriteClient.ts | 1090 |
| 7 | routes/sispag.ts | 1011 |
| 8 | routes/permutas.ts | 1002 |
| 9 | routes/recebimentos.ts | 1000 |
| 10 | domain/repository/sispag/LotePagamentoRepository.ts | 855 |

### Apêndice B — Top-10 fan-in de serviços

⚠️ **Não medido (--quick, delta-scoped)**: o ranking de fan-in de todo `domain/service/` está fora do escopo do delta. Para o artefato afetado, `ReconciliacaoPermutaService` é consumido pelo job novo (via cast ao método privado) e pelas rotas/jobs de permutas já existentes. Recomendação: rodar o plano completo de fan-in em um ciclo `/regis-review` sem `--quick`.

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Método novo é pequeno e focado, mas o arquivo-host segue com 1231 LOC (>600) e ganhou +71 | ⚠️ parcial | `ReconciliacaoPermutaService.ts` |
| Increase Semantic Coherence | O teto é responsabilidade única (I-Write-10) e fica separado da âncora (I-Write-6); ambas ainda vivem no serviço que orquestra a baixa | ✅ presente | L1010-1052 |
| Encapsulate | Método `private`; porém o job o acessa por cast `as unknown as` | ⚠️ parcial | `validate-permuta-centavos-adto-v1.ts:54-55` |
| Use an Intermediary | Escrita ao ERP continua via `conexosBaixaClient`; delta não adiciona acesso direto | ✅ presente | L891, L923 |
| Restrict Dependencies | Sem novas dependências; DDD respeitado | ✅ presente | diff |
| Refactor | Âncora e teto duplicam estrutura (guarda, ctx, warn/info, retorno `{juros, desconto}`) | ⚠️ parcial | L946-999, L1010-1052 |
| Abstract Common Services | `ToleranciaResiduo.LIMITE_BRL` compartilhado; não há helper para "ajustar variação em delta" | ⚠️ parcial | `ToleranciaResiduo.ts` |
| Defer Binding | Tolerância é constante em código (não configurável); aceitável por ser regra fiscal/contábil fixada por ADR-0020/0062 | ⚠️ parcial (N/A para tenant, regra é global) | `ToleranciaResiduo.ts` |

## 4. Findings (achados)

### F-modifiability-1: Âncora (I-Write-6) e teto (I-Write-10) duplicam a mecânica de ajuste da variação

- **Severidade**: P2
- **Tactic violada**: Refactor / Abstract Common Services
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:946-999` e `:1010-1052`; call-sites L856-888
- **Evidência (objetiva)**:
  ```
  jurosAncora   = isDesconto ? juros : round2(juros + residuo)      // L988
  jurosTeto     = isDesconto ? juros : round2(juros - excesso)      // L1034
  descontoAncora= isDesconto ? round2(desconto - residuo) : desconto
  descontoTeto  = isDesconto ? round2(desconto + excesso) : desconto
  ```
  Ambas: mesma assinatura (8 campos), mesmo ctx, mesmo teto `LIMITE_BRL`, mesma divisão warn/info.
- **Impacto técnico**: uma mudança futura (nova conta de variação, regra de sinal, novo teto) precisa ser aplicada em 2 métodos + 2 call-sites; risco de divergência entre as guardas. A segunda guarda foi corretamente feita como `limitar` (só reduz), então hoje não há conflito (se a âncora fecha o líquido, `excesso = 0`).
- **Impacto de negócio**: custo de mudança de regra de baixa de permuta cresce linearmente a cada guarda nova; baixa feita errada trava Finalizar do borderô (caso 23184).
- **Métrica de baseline**: 2 métodos x ~45 LOC com ~60% de estrutura em comum; 3 de 196 baixas reais (1,5%) exigiriam a guarda.

### F-modifiability-2: Job de validação acessa método privado por cast

- **Severidade**: P3
- **Tactic violada**: Encapsulate
- **Localização**: `src/backend/jobs/validate-permuta-centavos-adto-v1.ts:54-55`
- **Evidência (objetiva)**:
  ```
  (service as unknown as { limitarAoDisponivelDoAdto: Limitar }).limitarAoDisponivelDoAdto
  ```
- **Impacto técnico**: renomear ou mudar a assinatura do método privado quebra o job sem aviso do compilador (o cast silencia o typecheck); o job é read-only e one-off, então o raio é pequeno.
- **Impacto de negócio**: baixo; o script é de validação pontual e não está em produção contínua.
- **Métrica de baseline**: 1 acesso por cast; 0 cobertura de typecheck sobre a assinatura.

### F-modifiability-3: Arquivo-host acima do teto de tamanho e ganhando LOC por feature

- **Severidade**: P2
- **Tactic violada**: Split Module
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts` (1231 LOC, 20 imports)
- **Evidência (objetiva)**:
  ```
  wc -l → 1231 (alvo ≤ 600; delta +71, o arquivo cresceu 6% em um fix de centavos)
  ```
- **Impacto técnico**: cada fix de regra de baixa continua cabendo no mesmo arquivo, aumentando a superfície de revisão e de conflito de merge entre sessões paralelas.
- **Impacto de negócio**: aumenta o custo e o risco de cada ajuste futuro nas regras de permuta (I-Write-N); não é defeito do delta, é débito pré-existente que o delta aprofunda.
- **Métrica de baseline**: 1231 LOC (2,05x o alvo de 600); 4º maior arquivo do backend.

## 5. Cards Kanban

### [modifiability-1] Extrair ajuste de variação cambial compartilhado entre âncora e teto

- **Problema**
  > `ancorarVariacaoNoAdto` e `limitarAoDisponivelDoAdto` repetem a lógica de deslocar juros/desconto por um delta com guardas de sinal e teto. Mudar a regra obriga mexer em dois métodos e dois call-sites.

- **Melhoria Proposta**
  > Criar um colaborador (ex.: `AjusteVariacaoAdto` com `aplicarDelta({juros, desconto, isDesconto, delta})` retornando `undefined` se ficar negativo) em `domain/service/permutas/`, e fazer os dois métodos usá-lo. Tactic: Abstract Common Services / Refactor. Fazer junto da próxima mudança em I-Write-6 ou I-Write-10, não isolado.

- **Resultado Esperado**
  > Regra de sinal e arredondamento em um único lugar; ~30 LOC removidos do serviço.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Pontos de edição por mudança de regra de variação: 2 → 1
  - LOC duplicadas na lógica de ajuste: ~25 → 0
- **Risco de não fazer**: uma terceira guarda no mesmo ponto triplica a duplicação; divergência de sinal entre guardas gera baixa recusada no Finalizar.
- **Dependências**: nenhuma

### [modifiability-2] Expor o teto como função pura testável e remover o cast do job

- **Problema**
  > O job de validação acessa o método privado via `as unknown as`, escapando do typecheck.

- **Melhoria Proposta**
  > Mover a parte pura (cálculo de excesso e novo juros/desconto, sem log) para uma função/classe exportada junto de `ToleranciaResiduo`; o serviço mantém só o logging. O job importa a parte pura. Tactic: Encapsulate. Pode ser feito junto com modifiability-1.

- **Resultado Esperado**
  > Job tipado; 0 casts para métodos privados; cálculo testável sem mock de `LogService`.

- **Tactic alvo**: Encapsulate
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Casts a membros privados: 1 → 0
- **Risco de não fazer**: renomear o método quebra o job em runtime, não em compilação; impacto baixo por ser one-off.
- **Dependências**: modifiability-1 (opcional, mesmo refactor)

### [modifiability-3] Planejar split de ReconciliacaoPermutaService por responsabilidade

- **Problema**
  > O serviço tem 1231 LOC e 20 imports, e cresceu +71 neste fix. Regras de baixa (passos 3-5, âncora, teto) coexistem com orquestração e elegibilidade.

- **Melhoria Proposta**
  > Extrair o conjunto "cálculo do líquido da baixa" (âncora, teto, buildComentario, buildFinalPayload) para um serviço dedicado, mantendo `ReconciliacaoPermutaService` como orquestrador. Tactic: Split Module. Fazer proporcionalmente no próximo `/feature-tweak` que tocar essas regras (política do CLAUDE.md), nunca como refactor isolado.

- **Resultado Esperado**
  > Arquivo-host de 1231 → ≤ 800 LOC no primeiro corte; imports 20 → ≤ 15.

- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - LOC do arquivo: 1231 → ≤ 800
  - Imports: 20 → ≤ 15
- **Risco de não fazer**: em 6 meses, com mais I-Write-N, o arquivo passa de 1400 LOC e as sessões paralelas conflitam com frequência.
- **Dependências**: modifiability-1

## 6. Notas do agente

- Escopo: só o delta de c099a55; sem P0 (nenhum defeito encontrado). O método novo é pequeno, sem warnings de complexidade, reutiliza `LIMITE_BRL` e respeita DDD.
- Não medido: fan-in de serviços (Apêndice B) e demais métricas globais, por causa do `--quick`/delta.
- Cross-QA: modifiability-2 (cálculo puro testável) toca Testability; os números mágicos não aumentaram (Deployability sem impacto). A tolerância de R$1,00 fixa em código é decisão de ADR, não item de Defer Binding por tenant.
