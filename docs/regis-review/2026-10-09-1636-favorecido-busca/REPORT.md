---
type: regis-review-report
run_id: 2026-10-09-1636-favorecido-busca
generated_at: 2026-10-09T17:30:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
total_cards: 13
total_p0: 0
total_p1: 0
total_p2: 10
total_p3: 3
overall_score: 7.9
---

# Regis-Review — financeiro — 2026-10-09-1636-favorecido-busca

Escopo: delta da branch `feat/sispag-favorecido-busca` contra `origin/main` (busca de favorecido no
`cmn025/list` + prévia do destino mascarado; ADR-0065, I10h/I14j/I14l). Feature 100% read-only: 0
escritas no Conexos ou no banco, 0 migrations, 0 dependências novas.

**Contagem explícita de P0: 0.** P1: 0. Nenhum dos 27 findings dos 8 QAs passou de P2 (17 P2, 10
P3). Todos os gates (typecheck, lint, 225 suites/4.016 testes backend, 88 suites frontend,
PatternGuardian, DesignSystemReviewer) estão verdes. Os 19 cards originais foram deduplicados em 13
(ver KANBAN.md e seção 7).

> Redigido pelo `qa-consolidator`; gravado pelo orquestrador (o harness não deixa subagente gravar
> relatório). Uma correção do orquestrador na seção 7: o número de leituras por busca, conferido no
> código, é **no máximo 2** (texto 2; documento 1–2; código 1).

## 1. Executive scorecard

Pesos (financeiro): Security 1,5; Fault Tolerance 1,3; Availability 1,2; Modifiability 1,2;
Testability 1,0; Performance 1,0; Integrability 0,9; Deployability 0,9. Soma = 9,0. Cálculo:
(8,5×1,5 + 9×1,3 + 8×1,2 + 7×1,2 + 8×1,0 + 7×1,0 + 7,5×0,9 + 8×0,9) / 9,0 = 71,4 / 9,0 = **7,9**.

As colunas P0–P3 contam **findings** por QA (antes da deduplicação). Cards deduplicados: 0 / 0 / 10 / 3.

| QA | Score | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 8,0 | 0 | 0 | 2 | 1 | F-availability-1: busca consome sessões do Conexos sem rate limit no backend |
| Deployability | 8,0 | 0 | 0 | 2 | 1 | F-deployability-1: semântica do `#LIKE`/`pdcDocFederal` não validada ao vivo (0 de 4 modos) |
| Integrability | 7,5 | 0 | 0 | 3 | 1 | F-integrability-1: `#LIKE` e formato do documento assumidos, não medidos (0 de 2) |
| Modifiability | 7,0 | 0 | 0 | 2 | 2 | F-modifiability-2: hotspots de 935/1252/1721 LOC recebem mais delta |
| Performance | 7,0 | 0 | 0 | 3 | 1 | F-performance-3: sem teto de tempo total; retry empilhado em rota interativa |
| Fault Tolerance | 9,0 | 0 | 0 | 1 | 1 | F-fault-tolerance-1: timeout/orçamento de leituras não verificado no delta |
| Security | 8,5 | 0 | 0 | 2 | 1 | F-security-1: sem limite de taxa próprio (até ~200 leituras Conexos/min/IP) |
| Testability | 8,0 | 0 | 0 | 2 | 2 | F-testability-1: 0 fixtures de `cmn025/list`; 7 testes defendem uma suposição |
| **Overall** | **7,9** | **0** | **0** | **17** | **10** | — |

Interpretação: 7–8 = saudável com oportunidades pontuais. Nenhum QA abaixo de 7. As três notas
mais baixas têm causa conhecida: dívida pré-existente de tamanho de arquivo e duas premissas do ERP
nunca medidas.

## 2. Top 10 risks (cross-QA)

Como a feature é read-only, nenhum risco envolve dinheiro movido; o blast radius relevante é a
sessão compartilhada do Conexos e a confiança dos analistas.

### R-1: `#LIKE` e `pdcDocFederal` nunca medidos ao vivo
- **QA(s)**: Integrability, Testability, Deployability, Modifiability, Performance, Fault Tolerance
- **Evidência**: 0/2 premissas do ERP medidas; 0/4 modos validados; 0 fixtures. HML recusou o
  usuário do `.env` (Bad Credentials); sonda em PRD derrubaria sessão viva.
- **Impacto**: se `#LIKE` for "começa com", sensível a acento/caixa, ou o documento vier em outro
  formato, a busca volta vazia sem erro, indistinguível de "não cadastrado". O ganho da feature (não
  abrir o Conexos) pode não existir. Sem perda financeira direta.
- **Cards**: integrability-1 (absorve testability-1, deployability-1)

### R-2: Sem rate limit server-side sobre a sessão compartilhada do Conexos
- **QA(s)**: Security, Availability, Performance, Integrability, Fault Tolerance, Deployability
- **Evidência**: só `globalLimiter` (100/min/IP, `buildApp.ts:59`). Até 2 leituras `cmn025` por
  busca: até ~200 leituras/min por IP. Tactic: Detect Service Denial / Limit Event Response.
- **Impacto**: o abort do navegador não cancela a leitura enviada ao ERP; a rajada disputa o teto
  de sessões com os crons SISPAG (incidente de 23/09). Conta comprometida enumera fornecedores. A
  rota exige `sispag:executar`, o que limita a probabilidade.
- **Cards**: security-1, testability-2

### R-3: Sem orçamento de tempo total (retry × timeout × leituras seriais)
- **QA(s)**: Availability, Performance, Fault Tolerance
- **Evidência**: timeout 40 s por chamada (`services/conexos.ts:121`), retries, até 2 leituras
  seriais: ≈ 240 s teórico contra alvo < 10 s. Latência real não medida.
- **Cards**: performance-3, performance-1, availability-2

### R-4: Descarte silencioso de linhas fora do schema
- **Evidência**: `mapPessoa` faz `safeParse` e retorna `undefined` sem log; `cmnPessoasPix` loga a
  contagem. Renomear `dpeNomPessoa` zera a busca sem alerta.
- **Cards**: integrability-2

### R-5: Consulta de destino e busca sem trilha auditável
- **Evidência**: 0 eventos de auditoria nas 2 rotas novas. Em fraude de troca de conta, falta "quem
  olhou o cadastro antes do pedido".
- **Cards**: security-2

### R-6: Janela de 404 no deploy e ausência de kill switch
- **Evidência**: diálogo reescrito depende de 2 rotas novas, 0 flags; Vercel antes do Render = 404.
  Rollback é puro código (0 migrations).
- **Cards**: deployability-2, availability-2

### R-7: Hotspots de tamanho recebem mais delta
- **Evidência**: `ConexosSispagClient.ts` 935 LOC (828 em main), `routes/sispag.ts` 1252 e 40
  imports, `frontend/lib/sispag.ts` 1721; alvo ≤ 600. Dívida pré-existente.
- **Cards**: modifiability-2

### R-8: Regra de classificação do termo duplicada
- **Evidência**: 2 regex no backend (3 com o frontend); constantes 20/3/350 ms em 3 camadas. Primeiro
  CNPJ alfanumérico exige mudar sítios em sincronia.
- **Cards**: modifiability-1, modifiability-3

### R-9: Debounce sem teste de coalescência
- **Evidência**: 0 `useFakeTimers`; 0 casos "3 teclas → 1 chamada".
- **Cards**: testability-2

### R-10: Guarda da sonda HML sem teste; diálogo de 444 LOC
- **Evidência**: 0 testes na guarda da sonda; diálogo ~108 → 444 LOC; piso frontend 33% linhas.
- **Cards**: testability-3

## 3. Cross-cutting findings

- **CC-1 — premissa do ERP não medida atravessa 6 QAs.** Mitigada por design (duas leituras de
  documento, descarte por Zod, "acha menos, mas não erra"); falta a prova. Um único bloqueio
  (credencial HML) com sete sintomas → integrability-1.
- **CC-2 — sem contenção de carga no servidor sobre sessão compartilhada.** Só o debounce do cliente
  protege o teto de sessões → security-1 + testability-2.
- **CC-3 — latência sem teto e sem medição.** Retry/timeout de jobs aplicados a rota interativa →
  performance-3, depois performance-1 e availability-2.
- **CC-4 — falhas e abusos invisíveis.** I10h cumprida "não logando nada" em vez de logar o que não é
  sensível (contagens, `pesCod`, duração) → integrability-2, security-2, availability-2.
- **CC-5 — concentração em hotspots** → modifiability-2, testability-3.

## 4. Quick wins (≤5 dias úteis)

| Card | Esforço | Severidade | Resultado esperado |
|---|---|---|---|
| security-1 | S | P2 | Limitador por usuário nas 2 rotas; 429 testado |
| integrability-1 | S | P2 | Premissas 0/2 → 2/2; ≥ 2 fixtures. Bloqueado por credencial HML |
| integrability-2 | S | P2 | Log de descarte 1/2 → 2/2 |
| security-2 | S | P2 | Prévias auditadas 0% → 100%, sem termo/destino |
| deployability-2 | S | P2 | Ordem BE→FE documentada |
| performance-1 | S | P2 | Texto ~2x → ~1x latência (depois de security-1) |
| modifiability-1 | S | P2 | Classificação do termo em 1 sítio |
| testability-2 | S | P2 | Coalescência 0 → 2 casos |

## 5. Strategic moves

| Card | Esforço | Por que vale |
|---|---|---|
| performance-3 | M | ≈ 240 s teórico → ≤ 8 s; primeiro p50/p95 real |
| modifiability-2 | M | Hotspots param de crescer a cada feature SISPAG |
| testability-3 | M | Diálogo ≤ 300 LOC; guarda da sonda testada |

## 6. O que está bem

1. **Read-only comprovado**: 0 escritas locais ou no ERP.
2. **Exposição mínima**: 0 CPF/CNPJ/conta/PIX completos na resposta; termo em POST fora de URL e
   log; `no-store` em 2/2; sonda sem impressão de documento.
3. **Validação nos boundaries**: Zod em 2/2 rotas e nas linhas do ERP; curingas `%`/`_` neutralizados.
4. **Autorização**: `sispag:executar` em 2/2 rotas, coberto por `routePermissions.test.ts`; revelar
   continua exigindo `sispag:autorizar_favorecido`.
5. **Fronteira do cliente respeitada**: gramática do `cmn025` em `buscarPessoas`/`mapPessoa`;
   `PayeeSearchService` com 85 LOC, fan-in 1.
6. **Performance local**: 1 SELECT em lote com índice parcial; `pageSize` 20, `fieldList` de 5 campos.
7. **Deploy reversível**: 0 migrations, 0 envs, 0 dependências.
8. **Testabilidade**: 28+ casos novos, 0 rede, DI por construtor; `AbortController` na busca e na prévia.

## 7. Limitações da análise

- **Não medido ao vivo**: `#LIKE`, formato de `pdcDocFederal`, latência real, taxa de erro. Os números
  de latência são cálculo a partir do código.
- **Não medível por ausência de `infra/`**: Terraform, IAM, CloudTrail, alarmes, DLQ.
- **Divergências entre seções, resolvidas pelo orquestrador**:
  - Leituras por busca: algumas seções disseram "até 3"; o código (`buscarPessoas`) faz no máximo 2.
    Teto por IP recalculado para ~200/min.
  - Timeout: Availability verificou 40 s em `services/conexos.ts:121`; tratado como existente por
    chamada, sem teto total.
  - Versão: o bump `chore(release): v0.61.0` já está na branch; o finding F-deployability-3 está
    resolvido.
- **Deduplicação (19 → 13)**: ver KANBAN.md.
- **Snapshot** de 2026-10-09.

## 8. Ações recomendadas

1. Obter credencial HML e executar integrability-1; sem ela, validar os 4 modos em produção com
   sessão própria fora do pico (R-1).
2. Antes de liberar a mais usuários: security-1 + testability-2, depois performance-3.
3. No deploy: Render antes de Vercel (deployability-2).
4. Observabilidade sem violar I10h: integrability-2, security-2, availability-2.
5. Dívida estrutural no próximo `/feature-tweak` SISPAG: modifiability-1/2/3, testability-3.
   Sem P0, nada reentra no loop do gate; os 13 cards seguem como follow-ups.
