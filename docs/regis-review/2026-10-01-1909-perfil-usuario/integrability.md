---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-01-1909
agent: qa-integrability
generated_at: 2026-10-01T19:30:00-03:00
scope: backend+frontend (quick, delta feat/perfil-usuario vs origin/main)
score: 7
findings_count: 4
cards_count: 3
---

# Integrability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor Kavex | Backend muda o shape de `GET /me/*` ou o `POST /me/senha` sai do papel (flag ligada) | Contrato FE↔BE (`lib/api/perfil.ts`, `routes/me.ts`, `PerfilQuerySchemas.ts`) | Express/Render + Next/Vercel, deploys independentes | Divergência detectada em CI, não em produção | Drift detectado antes do merge; 1 arquivo tocado por mudança de contrato |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Rotas novas com validação Zod `.strict()` na entrada | 3/3 (`/me`, `/me/atividade`, `/me/historico`) | 100% | ✅ | `PerfilQuerySchemas.ts:18,20-30,32-41` |
| Validação de resposta no consumidor (FE) | 0/3 (cast `as T`) | ≥80% | ❌ | `perfil.ts:152` |
| Tipos de contrato com fonte única | 0 (redeclarados no FE, ~15 interfaces) | 1 fonte | ⚠️ | `perfil.ts:13-118` vs `AtividadeUsuarioInterface.ts`/`PerfilInterface.ts` |
| Contract test FE↔BE | 0 | 1 por rota | ⚠️ | `routes/me.test.ts`, `page.test.tsx` mockam cada lado |
| Parâmetros do BE não expostos pelo FE | 1 (`tipo`) | 0 | ⚠️ | `PerfilQuerySchemas.ts:36` vs `perfil.ts:112-118` |
| Arquivos do delta declarando a base da API | 2 (`perfil.ts:5`, `senha.ts:4`); 11 no FE todo | 1 | ⚠️ | `grep NEXT_PUBLIC_API_URL src/frontend` |
| Chamadas HTTP fora de wrapper | 0 (tudo via `apiFetch` + `withAuthHeaders`) | 0 | ✅ | `perfil.ts:141`, `senha.ts:65` |
| Rotas versionadas na URL | 0/3 (API interna, sem versionamento) | N/A (consumidor único) | ✅ | `routes/me.ts` |
| Migration 0072 com rollback | sim (índice, aditiva) | sim | ✅ | `migrations/rollbacks/0072_idx_atividade_usuario.rollback.sql` |
| Integrações externas novas | 0 | — | ✅ | delta |

> ⚠️ **Não medível localmente**: infra/Terraform/SSM (não existe `infra/`); taxa de erro por dependência em produção. Recomendação: instrumentar quando o alvo Lambda existir.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Cliente FE único `lib/api/perfil.ts`; BE em Service/Repository; nenhuma função aceita id de usuário | ✅ presente | `perfil.ts:10,155-161` |
| Use an Intermediary | `apiFetch` (401/503) + `withAuthHeaders` | ✅ presente | `perfil.ts:1-2,141` |
| Restrict Communication Paths | Alvo = sessão; query `.strict()` recusa `userId`/`username` | ✅ presente | `PerfilQuerySchemas.ts:14-18` |
| Adhere to Standards | JSON/REST, HTTP status (400/422/429/503), cursor keyset | ✅ presente | `senha.ts:41-58` |
| Abstract Common Services | `apiFetch`/`withAuthHeaders` reutilizados; base URL e `lerJson` duplicados | ⚠️ parcial | `perfil.ts:5`, `senha.ts:4` |
| Discover Service | Base via `NEXT_PUBLIC_API_URL` com fallback localhost | ⚠️ parcial | `perfil.ts:5` |
| Tailor Interface | `PerfilApiError` com status; `mapearRespostaSenha` traduz status em união discriminada | ✅ presente | `perfil.ts:121`, `senha.ts:46` |
| Configure Behavior | Flag `SENHA_PROPRIA_HABILITADA` (constante de build, não runtime) | ⚠️ parcial | `senha.ts:12` |
| Manage Resources | N/A: sem pool/limite novo na fronteira (cursor 25/página e 429 no contrato) | N/A | `routes/me.ts:152` |
| Orchestrate | N/A: rotas de leitura simples, sem orquestração multi-sistema | N/A | — |
| Manage Resource Coupling | FE e BE acoplados só por shape JSON, sem artefato compartilhado | ⚠️ parcial | `perfil.ts:13-118` |
| Contract testing | ausente (testes mockam cada lado) | ❌ ausente | `routes/me.test.ts`, `page.test.tsx` |
| Versioning strategy | ausente (consumidor único, deploy independente) | ⚠️ parcial | `routes/me.ts` |
| Backward-compat shims | nenhum; `detalhe` com campos opcionais tolera adição | ✅ presente | `perfil.ts:75-86` |
| Observability of integration failures | `PerfilApiError.status` vira erro de seção; sem métrica por rota | ⚠️ parcial | `perfil.ts:150` |

## 4. Findings

### F-integrability-1: Contrato FE↔BE sem fonte única nem teste de contrato

- **Severidade**: P2
- **Tactic violada**: Manage Resource Coupling / Contract testing
- **Localização**: `src/frontend/lib/api/perfil.ts:13-118,152`; `src/backend/domain/interface/perfil/PerfilInterface.ts`
- **Evidência (objetiva)**:
  ```
  return (await res.json()) as T
  ```
- **Impacto técnico**: renomear um campo no BE passa em ambos os testes (cada um mocka o outro) e quebra a tela em produção; `undefined` chega aos componentes.
- **Impacto de negócio**: tela de perfil (auditoria pessoal) quebrada após deploy independente; retrabalho em hotfix.
- **Métrica de baseline**: 0 testes de contrato; ~15 interfaces redeclaradas; 0/3 respostas validadas.

### F-integrability-2: Filtro `tipo` aceito pelo BE e não exposto pelo FE

- **Severidade**: P2
- **Tactic violada**: Tailor Interface
- **Localização**: `PerfilQuerySchemas.ts:36`; `perfil.ts:112-118`
- **Evidência (objetiva)**: `tipo: z.enum(ACOES_ATIVIDADE).optional()` vs `FiltrosHistorico` sem `tipo`.
- **Impacto técnico**: superfície de contrato morta; a divergência indica ausência de fonte única.
- **Impacto de negócio**: baixo; filtro por ação existe no backend mas não para o analista.
- **Métrica de baseline**: 1 de 6 parâmetros do histórico sem consumidor.

### F-integrability-3: Contrato de `POST /me/senha` assumido sem backend

- **Severidade**: P2
- **Tactic violada**: Contract testing
- **Localização**: `src/frontend/lib/perfil/senha.ts:46-59`
- **Evidência (objetiva)**: códigos `POLITICA`/`SENHA_ATUAL_INVALIDA`, 422/429/204 mapeados sem rota correspondente; flag `false` (`senha.ts:12`).
- **Impacto técnico**: ao ligar a flag, divergência de status/códigos cai silenciosamente em `indisponivel` (default `senha.ts:58`), mascarando o erro. Risco contido pela flag.
- **Impacto de negócio**: troca de senha falha com mensagem genérica no go-live.
- **Métrica de baseline**: 0 de 5 desfechos do contrato verificados contra um backend.

### F-integrability-4: Base da API declarada em múltiplos arquivos

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `perfil.ts:5`, `senha.ts:4` (+9 outros no FE)
- **Evidência (objetiva)**: `const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')`
- **Impacto técnico**: trocar a origem ou adicionar versão exige tocar 11 arquivos.
- **Impacto de negócio**: baixo; custo em migração futura para API Gateway.
- **Métrica de baseline**: 11 declarações, 2 no delta.

## 5. Cards Kanban

### [integrability-1] Ancorar o contrato do perfil em schema único e teste de contrato

- **Problema**
  > O FE redeclara ~15 tipos e faz `res.json() as T` (`perfil.ts:152`); BE e FE são testados com mocks mútuos.
- **Melhoria Proposta**
  > Exportar schemas Zod de resposta (BE) e importá-los no FE para `parse` em `lerJson`, ou teste de contrato que valide a resposta real das 3 rotas contra os tipos do FE. Incluir o filtro `tipo` (ou removê-lo do BE).
- **Resultado Esperado**
  > Drift quebra o CI. Respostas validadas: 0/3 → 3/3.
- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-1, F-integrability-2
- **Métricas de sucesso**:
  - Rotas com contract test: 0 → 3
  - Parâmetros sem consumidor: 1 → 0
- **Risco de não fazer**: renomeação de campo quebra a tela só em produção.
- **Dependências**: nenhuma

### [integrability-2] Fixar o contrato de POST /me/senha antes de ligar a flag

- **Problema**
  > O mapeamento de respostas em `senha.ts:46-59` assume um backend que não existe; desvio cai em `indisponivel`.
- **Melhoria Proposta**
  > No tweak `feat/auth-senha-propria`, definir o schema Zod compartilhado da resposta e um teste de contrato por desfecho (204, 400 POLITICA, 422, 429, 5xx); só então trocar `SENHA_PROPRIA_HABILITADA`.
- **Resultado Esperado**
  > Desfechos verificados: 0/5 → 5/5 antes do go-live.
- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Desfechos cobertos por contrato: 0/5 → 5/5
- **Risco de não fazer**: erro de integração mascarado como "indisponível".
- **Dependências**: backend `feat/auth-senha-propria`

### [integrability-3] Centralizar a base URL da API no frontend

- **Problema**
  > `API` é declarada em 11 arquivos do FE (2 no delta).
- **Melhoria Proposta**
  > Extrair para `lib/http` (junto de `apiFetch`) e migrar `perfil.ts` e `senha.ts` no ato; o restante proporcionalmente em tweaks.
- **Resultado Esperado**
  > Declarações: 11 → 1.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - Arquivos declarando a base: 11 → 1
- **Risco de não fazer**: trocar origem/versão da API custa 11 edições.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta do perfil; sem integrações externas novas (Conexos/Nexxera/GED fora do escopo). Migration 0072 aditiva (índice) com rollback, sem impacto de integração.
- Nenhum P0/P1: não há baseline numérico que os sustente.
- Cross-QA: validação de entrada Zod `.strict()` (Security), contrato e teste (Testability).
