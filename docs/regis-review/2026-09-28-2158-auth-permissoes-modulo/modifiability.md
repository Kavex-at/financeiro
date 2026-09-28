---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-28-2158-auth-permissoes-modulo
agent: qa-modifiability
generated_at: 2026-09-28T21:58:00-03:00
scope: backend, frontend (only directories touched by feat/auth-permissoes-modulo)
score: 6
findings_count: 5
cards_count: 5
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dono do ciclo / Kavex | Pede uma décima permissão de módulo (ex.: `conciliacao:ver` para a Frente IV) | Catálogo de permissões (`Permission.ts`, `permissoes.ts`, `0066_*.sql`, `routePermissions.test.ts`) | Desenvolvimento, pré-deploy, sob o gate Regis-Review | O desenvolvedor troca a constante, a migration do `CHECK` e a tabela do teste de rotas; testes tornam qualquer esquecimento visível | Nº de arquivos coordenados por permissão nova; hoje **6 listas literais** das 9 permissões (3 no backend, 1 na migration ×2, 1 no frontend) precisam mover juntas |
| Dono do ciclo | Pede um décimo papel (ex. "Analista SISPAG") ou uma nova rota mutável | Tabela `TABELA` de `routePermissions.test.ts` (85 entradas) + `AccessRepository.lockAndCheck` | Pipeline `/feature-tweak`, AutoLoopRunner | Rota nova sem linha na tabela falha o teste nomeando a rota; papel novo é só migration de dados (D2/D6) | 85 linhas hoje; custo marginal por rota = 1 linha na tabela + 1 guard no router, sem tocar lógica de autorização |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Duplicação literal do catálogo de 9 permissões | 6 listas: `PERMISSION` (const), `PERMISSION_CATALOG` (array) e `permissionSchema` (enum) em `Permission.ts`; `CHECK` em `app_role_permission` e em `user_permission` na 0066; `PERMISSAO`+`CATALOGO_PERMISSOES` em `src/frontend/lib/permissoes.ts` | ≤ 2 (1 fonte de verdade + 1 espelho de borda) | ⚠️ | `grep -rln "permutas:ver" src/backend src/frontend` (10 arquivos não-teste tocam a string; 6 são a lista completa) |
| Repository → Service (direção invertida) | 1 ocorrência: `AccessRepository.ts` importa `EffectivePermissionCalculator` de `domain/service/auth/` — único arquivo em todo `domain/repository/**` que importa de `domain/service/` | 0 | ❌ | `grep -rln "from '../../service/" src/backend/domain/repository` → só `AccessRepository.ts`; `git diff 4c6b34f..HEAD --stat` confirma os dois arquivos são novos nesta branch |
| Duplicação do hook `podeExecutar` no frontend | Padrão `!carregando && tem(PERMISSAO.X_EXECUTAR)` repetido literalmente em 4 pontos (`LoteCard.tsx:113`, `sispag/page.tsx:169`, `BoletosDdaTab.tsx:109`, `recebimentos/page.tsx:177`); só Permutas foi extraído para `usePodeExecutarPermutas.ts` | 1 hook genérico reaproveitado ≥4x | ⚠️ | `grep -rn "tem(PERMISSAO" src/frontend/app` |
| Tamanho dos arquivos novos/tocados no escopo | `AccessRepository.ts` 429 LOC, `UserRepository.ts` 434 LOC, `UserAdminService.ts` 429 LOC, `EditarAcessoDialog.tsx` 318 LOC (novo) | p95 ≤ 400 LOC | ⚠️ | `wc -l` (ver tabela no apêndice) |
| Teste de cobertura de rotas — redundância de asserção | `routePermissions.test.ts` codifica as contagens por mount duas vezes: uma vez como números fixos (`27/27/15/10/2/1/2/1`, linha 198-209) e outra implicitamente pelo tamanho de `TABELA` (85 linhas) | 1 fonte de verdade por invariante | ⚠️ | `src/backend/http/routePermissions.test.ts:198-209` |
| Cognitive complexity nova no escopo desta feature | 0 funções de `domain/{service,repository,interface}/auth`, `http/acesso.ts`, `routes/usuarios.ts` acima de 15 | 0 | ✅ | `cd src/backend && npm run lint 2>&1 \| grep -i "auth\|acesso\|usuarios"` → vazio; `_shared-metrics.md`: 74 warnings, igual à main |
| Magic numbers de regra de negócio no escopo | `CACHE_TTL_MS = 30_000` (nomeado, documentado no ADR D4) e `BCRYPT_ROUNDS = 12` (nomeado); nenhum via `EnvironmentProvider` | Constantes de regra configuráveis via env quando o valor é uma decisão operacional (TTL) | ⚠️ | `src/backend/domain/service/auth/AccessService.ts:42`; `src/backend/domain/service/auth/UserAdminService.ts:35` |
| Fan-in do catálogo `Permission.ts` | 14 arquivos não-teste importam `domain/interface/auth/Permission.js` (6 routers + `http/acesso.ts` + 2 repositórios + 2 serviços + 1 fixture) | Aceitável para uma constante pura (sem lógica) | ✅ | `grep -rl "interface/auth/Permission" src/backend --include='*.ts' \| grep -v test \| wc -l` → 14 |

### Apêndice — Top-10 maiores arquivos no escopo (LOC, não-teste)

| # | Arquivo | LOC | Novo/Tocado nesta branch |
|---|---|---|---|
| 1 | `src/backend/routes/permutas.ts` | 1002 | Tocado (+50/-? linhas; guard por rota) |
| 2 | `src/backend/routes/recebimentos.ts` | 1000 | Tocado (+44) |
| 3 | `src/backend/routes/sispag.ts` | 727 | Tocado (+44) |
| 4 | `src/backend/domain/repository/auth/UserRepository.ts` | 434 | Novo |
| 5 | `src/backend/domain/repository/auth/AccessRepository.ts` | 429 | Novo |
| 6 | `src/backend/domain/service/auth/UserAdminService.ts` | 429 | Novo |
| 7 | `src/backend/routes/usuarios.ts` | 324 | Tocado (+124/-?) |
| 8 | `src/frontend/app/usuarios/EditarAcessoDialog.tsx` | 318 | Novo |
| 9 | `src/backend/http/acesso.ts` | 207 | Novo |
| 10 | `src/frontend/app/usuarios/NovoUsuarioDialog.tsx` | 208 | Tocado (+39) |

> Os três maiores (`permutas.ts`, `recebimentos.ts`, `sispag.ts`) já eram grandes antes desta feature (não é regressão desta branch), mas cada um recebeu uma nova linha de import (`PERMISSION`) e um guard por rota (27, 24 e 15 usos de `PERMISSION.*` respectivamente) — a feature aumenta a superfície de manutenção desses arquivos já acima do alvo (p95 ≤ 400) sem os dividir.

### Apêndice — Top-10 fan-in no escopo (arquivos que importam o módulo)

| # | Módulo | Fan-in (arquivos não-teste) | Observação |
|---|---|---|---|
| 1 | `domain/interface/auth/Permission.ts` | 14 | Constante pura, sem lógica — fan-in alto é barato de mudar (aditivo) |
| 2 | `domain/repository/auth/AccessRepository.ts` | 2 (`AccessService`, `UserAdminService`) | Dentro do esperado para um repositório de domínio |
| 3 | `domain/service/auth/AccessService.ts` | 1 (`http/acesso.ts`) | Único consumidor — resolvido sob demanda, fora do `bootstrapAppContainer` (gotcha dos jobs) |
| 4 | `domain/service/auth/EffectivePermissionCalculator.ts` | 2 (`AccessService`, `AccessRepository`) | Ver F-modifiability-2: um dos dois fan-ins é a direção invertida Repository→Service |
| 5 | `domain/repository/auth/UserRepository.ts` | 1 (`UserAdminService`) | — |
| 6 | `src/frontend/lib/auth/PermissoesProvider.tsx` (`usePermissoes`) | 9 (`app-nav`, `AdminHomeCard`, `OperacaoHomeCard`, `usePodeExecutarPermutas`, `sispag/page`, `LoteCard`, `BoletosDdaTab`, `recebimentos/page`, `app/page`) | Ver F-modifiability-3: 4 desses 9 repetem a mesma lógica de "pode executar" sem hook compartilhado |
| 7 | `src/frontend/lib/permissoes.ts` (catálogo `PERMISSAO`) | 9 (mesmos consumidores acima) | Espelho manual do backend — ver F-modifiability-1 |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Nenhum split nesta feature; os três routers de frente (permutas/sispag/recebimentos) seguem >700 LOC e ganharam mais uma responsabilidade (guard por rota) sem quebra | ⚠️ parcial | Apêndice de LOC acima |
| Increase Semantic Coherence | `UserAdminService` (429 LOC) concentra CRUD de usuário, atribuição de papel, edição de exceções, reset de senha e vínculo Conexos — 3+ entidades (`AppUser`, `Role`, `PermissionException`) num único serviço; coerente como "administração de acesso" (é o bounded context do ADR-0053), mas é o maior serviço do escopo e cresce a cada nova operação de conta | ⚠️ parcial | `grep -n "public " src/backend/domain/service/auth/UserAdminService.ts` (10 métodos públicos) |
| Encapsulate | `EffectivePermissionCalculator` está corretamente encapsulado como único lugar que calcula efetivas (I7) — middleware, guarda do último gestor e listagem chamam a mesma classe, sem reimplementação | ✅ presente | `EffectivePermissionCalculator.ts`, referenciado por `AccessService.resolver` e `AccessRepository.isActiveManager` |
| Use an Intermediary | `guardDe`/`exigirPermissao` em `http/acesso.ts` intermediam toda rota; `routePermissions.test.ts` faz introspecção do `router.stack` do Express para provar 1 guard por rota — intermediário forte, mas acoplado à forma interna do Express 5 (risco assumido e documentado no próprio ADR) | ✅ presente, com risco anotado | `src/backend/http/routePermissions.test.ts:170-190`; ADR-0053 §Consequências |
| Restrict Dependencies | Violada uma vez nesta branch: `AccessRepository` (camada Repository) importa `EffectivePermissionCalculator` (camada Service) — único caso em todo `domain/repository/**` | ❌ ausente neste ponto | `src/backend/domain/repository/auth/AccessRepository.ts:1-15,389-394` |
| Refactor | Sem regressão: 0 warnings novos de `noExcessiveCognitiveComplexity` no escopo desta feature | ✅ presente | `npm run lint` filtrado por auth/acesso/usuarios: vazio |
| Abstract Common Services | `usePodeExecutarPermutas` é a abstração certa, mas não foi generalizada: Sispag e Recebimentos repetem a mesma linha 4x em vez de reusar/generalizar o hook | ⚠️ parcial | `grep -rn "tem(PERMISSAO" src/frontend/app` |
| Defer Binding (configuration, polymorphism, runtime registration) | Catálogo de permissões é fixo no código por decisão deliberada (ADR-0053, "Alternativas consideradas": tabela editável foi descartada por criar permissões sem efeito) — é uma decisão de binding correta para o domínio, não uma omissão; TTL de cache (30s) e `BCRYPT_ROUNDS` (12) são constantes nomeadas, não externalizadas via `EnvironmentProvider` | ⚠️ parcial (catálogo: decisão consciente; TTL/rounds: não configurável) | `Permission.ts` comentário linhas 3-12; `AccessService.ts:42`; `UserAdminService.ts:35` |

## 4. Findings (achados)

### F-modifiability-1: Catálogo de 9 permissões duplicado em 6 listas literais (backend×3, migration×2, frontend×2)

- **Severidade**: P1
- **Tactic violada**: Increase Semantic Coherence / Abstract Common Services
- **Localização**: `src/backend/domain/interface/auth/Permission.ts:13-51` (3 listas na mesma classe: `PERMISSION`, `PERMISSION_CATALOG`, `permissionSchema`), `src/backend/migrations/0066_auth_permissoes_modulo.sql:55-60,66-71` (`CHECK` repetido em duas tabelas), `src/frontend/lib/permissoes.ts:12-37` (`PERMISSAO` + `CATALOGO_PERMISSOES`, espelho manual documentado como tal)
- **Evidência (objetiva)**:
  ```
  $ grep -rln "permutas:ver" src/backend src/frontend --include='*.ts' --include='*.tsx' --include='*.sql' | grep -v test
  src/backend/domain/interface/auth/Permission.ts
  src/backend/migrations/0066_auth_permissoes_modulo.sql
  src/frontend/lib/permissoes.ts
  ```
  Dentro de só esses 3 arquivos a string aparece 6 vezes como lista completa das 9 permissões (2 em Permission.ts contando `PERMISSION`+`PERMISSION_CATALOG`+`permissionSchema` = 3; 2 no SQL; 2 no frontend).
- **Impacto técnico**: acrescentar/remover uma permissão exige tocar 6 pontos, não os "três" que o próprio ADR-0053 documenta em Consequências ("constante, migration que troca o CHECK, linha no teste de rotas") — o ADR não contabiliza a duplicação interna de `Permission.ts` (3 listas no mesmo arquivo) nem o espelho do frontend. Só o teste de paridade da 0066 (backend↔CHECK) tem rede; nada testa o espelho do frontend ficar sincronizado — um valor que sobrar ali é silenciosamente descartado por `isPermissao` (comportamento aceito, mas oculta o esquecimento em vez de o sinalizar como o backend faz com `ignoradas`/log).
- **Impacto de negócio**: toda extensão de escopo (ex.: uma permissão para a futura Frente IV) tem retrabalho garantido de 6 edições coordenadas; o risco não é quebra funcional (os testes de paridade backend↔DB cobrem isso) e sim o item aparecer no backend e nunca no menu do frontend, ou vice-versa, sem qualquer teste apontando a causa.
- **Métrica de baseline**: 6 listas literais do mesmo catálogo de 9 valores; 1 delas (frontend) sem teste de paridade contra o backend.

### F-modifiability-2: Repository depende de Service — direção de dependência invertida, único caso no backend

- **Severidade**: P1
- **Tactic violada**: Restrict Dependencies
- **Localização**: `src/backend/domain/repository/auth/AccessRepository.ts:1-16,152-159,389-394`
- **Evidência (objetiva)**:
  ```
  // AccessRepository.ts
  import EffectivePermissionCalculator from '../../service/auth/EffectivePermissionCalculator.js';
  ...
  constructor(
      @inject(PostgreeDatabaseClient) private databaseClient: PostgreeDatabaseClient,
      @inject(EffectivePermissionCalculator) private calculator: EffectivePermissionCalculator,
  ) {}
  ...
  private isActiveManager = (access: UserAccess): boolean =>
      access.ativo &&
      this.calculator.tem(this.calculator.calcular(access.pacote, access.excecoes).permissoes, PERMISSION.USUARIOS_GERENCIAR);

  $ grep -rln "from '../../service/" src/backend/domain/repository --include='*.ts' | grep -v test
  src/backend/domain/repository/auth/AccessRepository.ts
  ```
  É o único arquivo em todo `domain/repository/**` que importa de `domain/service/**`; ambos os arquivos (`AccessRepository.ts`, `EffectivePermissionCalculator.ts`) são novos nesta branch (`git diff 4c6b34f..HEAD --stat`: 429 e 85 linhas adicionadas, 0 no `main`).
- **Impacto técnico**: a cadeia documentada em `CLAUDE.md` é `Lambda → Service → Repository → Client`, unidirecional. `EffectivePermissionCalculator` hoje é puro (sem I/O, "sem banco, sem relógio, sem env" — comentário do próprio arquivo) então não fecha um ciclo real, mas estabelece o precedente de que um Repository pode alcançar a camada Service. O próximo serviço que ganhar uma dependência (ex.: um `LogService` com lógica) e for puxado por um repositório fecha um ciclo de verdade sem que o PatternGuardian tenha uma regra clara para recusar — porque o próprio ADR-0053 já normalizou o padrão uma vez.
- **Impacto de negócio**: nenhum incidente hoje (funcionalmente correto, coberto por 27/27 checagens reais + 10/10 corridas concorrentes segundo `_shared-metrics.md`); o custo é arquitetural — a próxima feature que tocar `AccessRepository` ou qualquer repositório de acesso herda a ambiguidade "pode ou não importar de service" sem gate automatizado que pegue o próximo caso.
- **Métrica de baseline**: 1 ocorrência / 0 linha-base em todo o resto de `domain/repository/**` (dezenas de arquivos, nenhum outro importa de `domain/service/`).

### F-modifiability-3: Lógica de "pode executar" duplicada 4x no frontend; só Permutas foi extraída para hook

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/frontend/app/sispag/components/LoteCard.tsx:113`, `src/frontend/app/sispag/page.tsx:169`, `src/frontend/app/sispag/components/BoletosDdaTab.tsx:109`, `src/frontend/app/recebimentos/page.tsx:177`, vs. `src/frontend/app/permutas/components/usePodeExecutarPermutas.ts` (hook dedicado, só para Permutas)
- **Evidência (objetiva)**:
  ```
  LoteCard.tsx:113:      const podeExecutar = !carregandoPermissoes && tem(PERMISSAO.SISPAG_EXECUTAR)
  sispag/page.tsx:169:    const podeExecutar = !carregandoPermissoes && tem(PERMISSAO.SISPAG_EXECUTAR)
  BoletosDdaTab.tsx:109:  const podeExecutar = !carregandoPermissoes && tem(PERMISSAO.SISPAG_EXECUTAR)
  recebimentos/page.tsx:177: const podeExecutar = !permissoes.carregando && permissoes.tem(PERMISSAO.RECEBIMENTOS_EXECUTAR)
  ```
- **Impacto técnico**: quatro cópias byte-a-byte da mesma expressão booleana (3 delas idênticas, para SISPAG); qualquer mudança na regra (ex.: também esconder o botão quando a frente está desligada, hoje já tratado à parte por `sispagGate`/`recebimentosGate`) precisa ser replicada manualmente nos 4 pontos, sem teste de paridade entre eles.
- **Impacto de negócio**: risco de UI inconsistente entre módulos (um botão escondido em uma tela e visível em outra para o mesmo usuário) se um dos 4 pontos for esquecido numa mudança futura — baixo custo de correção, mas recorrente a cada tweak de UI que tocar permissão.
- **Métrica de baseline**: 4 duplicações da mesma linha lógica; 1 hook existente (`usePodeExecutarPermutas`) não generalizado para os outros 2 módulos.

### F-modifiability-4: Teste de cobertura de rotas duplica a contagem por mount como asserção separada da tabela

- **Severidade**: P2
- **Tactic violada**: Increase Semantic Coherence
- **Localização**: `src/backend/http/routePermissions.test.ts:197-209`
- **Evidência (objetiva)**:
  ```
  it('a tabela tem as contagens da entrevista: 27/27/15/10/2/1/2/1', () => {
      const porMount = (m: string) => TABELA.filter(...).length;
      expect(porMount('permutas')).toBe(27);
      expect(porMount('sispag')).toBe(27);
      ...
  });
  ```
- **Impacto técnico**: a contagem por mount (27/27/15/10/2/1/2/1) é redundante com o próprio tamanho de `TABELA` — se uma rota for adicionada a `sispag` a lista `TABELA` cresce corretamente, mas esse teste específico falha com um número "mágico" desatualizado antes que o segundo teste (o de conjunto exato) sequer rode, exigindo que quem adiciona uma rota também atualize um número que não carrega informação adicional (é derivável de `TABELA.length` por mount).
- **Impacto de negócio**: fricção de manutenção pequena, mas will-happen-every-time: qualquer rota nova em qualquer uma das 3 frentes aciona uma falha de teste que exige uma segunda edição manual (o número), além da linha na tabela.
- **Métrica de baseline**: 8 números hardcoded (`27/27/15/10/2/1/2/1`) redundantes com `TABELA.length` filtrado por mount — 85 linhas na tabela, 0 fonte única para a contagem.

### F-modifiability-5: `CACHE_TTL_MS` e `BCRYPT_ROUNDS` são constantes de código, não configuráveis por ambiente

- **Severidade**: P3
- **Tactic violada**: Defer Binding
- **Localização**: `src/backend/domain/service/auth/AccessService.ts:42`, `src/backend/domain/service/auth/UserAdminService.ts:35`
- **Evidência (objetiva)**:
  ```
  public static readonly CACHE_TTL_MS = 30_000;   // AccessService.ts:42
  const BCRYPT_ROUNDS = 12;                        // UserAdminService.ts:35
  ```
- **Impacto técnico**: o próprio ADR-0053 (D4) já identifica o TTL como o "pior caso" de propagação de uma mudança de acesso feita fora da tela (SQL manual) — hoje esse pior caso só muda com um deploy, não com uma variável de ambiente. `BCRYPT_ROUNDS`, se precisar subir por política de segurança, também exige deploy.
- **Impacto de negócio**: baixo no estado atual (~15 usuários, TTL de 30s já é curto); vira relevante se o número de instâncias do Render subir (o próprio ADR avisa: "quem subir `numInstances` precisa revisitar esta decisão") — nesse momento, reduzir o TTL via env seria a mitigação mais rápida, e hoje exigiria código + redeploy em vez de uma variável.
- **Métrica de baseline**: 2 constantes de regra de acesso fora do `EnvironmentProvider`, ambas nomeadas e documentadas (não são "magic numbers" opacos, mas são binding em tempo de compilação).

## 5. Cards Kanban

### [modifiability-1] Unificar o catálogo de permissões numa única fonte gerada

- **Problema**
  > O catálogo de 9 permissões existe em 6 listas literais (3 no backend em `Permission.ts`, 2 no `CHECK` da migration 0066, 2 no `permissoes.ts` do frontend). O teste da 0066 garante paridade backend↔banco, mas nada garante paridade backend↔frontend — um valor esquecido no espelho do frontend só se manifesta como "o item não aparece no menu", sem log nem teste.

- **Melhoria Proposta**
  > Aplicar a tactic **Abstract Common Services**: gerar `src/frontend/lib/permissoes.ts` a partir de `src/backend/domain/interface/auth/Permission.ts` num passo de build (script simples que copia o array e falha o `npm run build` do frontend se divergir), ou adicionar um teste de paridade cruzada (`__tests__/permissoes-api.test.ts` já existe — estender para comparar contra uma cópia fixa do array do backend, com comentário apontando para `Permission.ts` como fonte). Dentro do backend, reduzir `PERMISSION_CATALOG` e `permissionSchema` a serem derivados de `PERMISSION` via `Object.values`, eliminando 2 das 3 listas internas.

- **Resultado Esperado**
  > Nº de listas literais do catálogo: 6 → 2 (backend fonte + frontend com teste de paridade automatizado). Esquecer uma permissão no frontend passa a falhar um teste, não a virar um item invisível no menu.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Listas literais do catálogo: 6 → 2
  - Teste de paridade backend↔frontend: 0 → 1 (novo)
- **Risco de não fazer**: a cada nova frente (ex.: Conciliação de Recebimentos ganhando permissão própria), o esquecimento do espelho do frontend se repete sem sinal — vira um "bug de UI" reportado pelo usuário em vez de pego no CI.
- **Dependências**: nenhuma.

### [modifiability-2] Remover a dependência de `AccessRepository` sobre `EffectivePermissionCalculator`

- **Problema**
  > `AccessRepository` (camada Repository) importa e injeta `EffectivePermissionCalculator` (camada Service) para decidir, dentro de `lockAndCheck`, se uma escrita deixaria zero gestores ativos. É o único arquivo em `domain/repository/**` que depende de `domain/service/**`, invertendo a direção documentada em `CLAUDE.md` (`Lambda → Service → Repository → Client`).

- **Melhoria Proposta**
  > Aplicar **Restrict Dependencies**: mover `EffectivePermissionCalculator` para `domain/core/` (ou `domain/libs/`), ao lado de outras utilidades de domínio puras e sem camada fixa, já que ela não tem I/O e é consumida tanto por Service (`AccessService`) quanto por Repository (`AccessRepository`). Alternativa mais barata: manter o arquivo onde está, mas documentar em `CLAUDE.md`/PatternGuardian uma exceção explícita e nomeada para calculadoras puras de domínio, para não normalizar Repository→Service em geral.

- **Resultado Esperado**
  > `domain/repository/**` volta a ter zero imports de `domain/service/**` (hoje 1), ou a exceção fica registrada e testável pelo PatternGuardian em vez de implícita.

- **Tactic alvo**: Restrict Dependencies
- **Severidade**: P1
- **Esforço estimado**: S (≤1d) — mover um arquivo de 85 linhas sem lógica de I/O e ajustar 2 imports (`AccessService.ts`, `AccessRepository.ts`)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Imports de `domain/repository/**` para `domain/service/**`: 1 → 0
- **Risco de não fazer**: o próximo repositório que precisar de uma regra de domínio replica o padrão (repository importando service), e sem um caso testado de ciclo real hoje, a primeira ocorrência de fato cíclica só aparece quando dois repositórios se importarem via dois serviços diferentes — mais caro de desfazer depois que normalizado.
- **Dependências**: nenhuma.

### [modifiability-3] Generalizar `usePodeExecutarPermutas` para os três módulos

- **Problema**
  > A mesma expressão (`!carregando && tem(PERMISSAO.X_EXECUTAR)`) está duplicada 4 vezes entre Sispag (3x) e Recebimentos (1x), enquanto Permutas tem um hook dedicado (`usePodeExecutarPermutas`).

- **Melhoria Proposta**
  > Generalizar para `usePodeExecutar(permissao: Permissao): boolean` em `src/frontend/lib/auth/` e substituir as 4 ocorrências duplicadas (`LoteCard.tsx`, `sispag/page.tsx`, `BoletosDdaTab.tsx`, `recebimentos/page.tsx`) e o próprio `usePodeExecutarPermutas` (que vira `() => usePodeExecutar(PERMISSAO.PERMUTAS_EXECUTAR)` ou é removido em favor do genérico).

- **Resultado Esperado**
  > Duplicações da lógica de "pode executar": 4 → 0; 1 hook compartilhado reutilizado em 3 módulos.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Ocorrências de `tem(PERMISSAO.*_EXECUTAR)` fora de um hook compartilhado: 4 → 0
- **Risco de não fazer**: cada novo módulo (Frente IV) repete a cópia manual; uma mudança futura na regra de "pode executar" (ex.: considerar também a frente desligada) precisa de 4-5 edições em vez de 1.
- **Dependências**: nenhuma.

### [modifiability-4] Derivar a contagem por mount do teste de rotas a partir da própria tabela

- **Problema**
  > `routePermissions.test.ts` fixa `27/27/15/10/2/1/2/1` como números literais além de manter `TABELA` com 85 linhas — os dois precisam ser atualizados juntos a cada rota nova, e o número redundante não adiciona proteção que `TABELA.length` filtrado por mount não já dê.

- **Melhoria Proposta**
  > Substituir a asserção por uma comparação contra um `Record<string, number>` único e comentado (ou remover o teste, já que o segundo teste — "o conjunto de rotas montadas é EXATAMENTE o da tabela" — já cobre a integridade real). Se o objetivo é documentar a contagem da entrevista para rastreabilidade, mover para um comentário fixo em vez de uma asserção que quebra a cada rota nova.

- **Resultado Esperado**
  > Rota nova exige 1 edição (linha na `TABELA`) em vez de 2 (linha + número da contagem).

- **Tactic alvo**: Increase Semantic Coherence
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Pontos de edição por rota nova no teste de cobertura: 2 → 1
- **Risco de não fazer**: fricção recorrente e falso-negativo pedagógico (o teste falha por um número desatualizado antes de o desenvolvedor ver o teste que realmente importa).
- **Dependências**: nenhuma.

### [modifiability-5] Externalizar `CACHE_TTL_MS` via `EnvironmentProvider`

- **Problema**
  > O TTL de 30s do cache de acesso (`AccessService.CACHE_TTL_MS`) é uma constante de código. O próprio ADR-0053 identifica que ele é o "pior caso" de propagação de uma revogação feita fora da tela, e que a decisão precisa ser revisitada se `numInstances` subir no Render — hoje essa revisão exige código + deploy, não uma variável.

- **Melhoria Proposta**
  > Mover `CACHE_TTL_MS` para `EnvironmentProvider` (Inviolable Rule #8: nunca `process.env` cru em services) com o valor atual (30000) como default, permitindo reduzir o TTL em produção sem deploy se `numInstances` subir antes de a invalidação distribuída ser implementada.

- **Resultado Esperado**
  > TTL de cache configurável por ambiente; mitigação de emergência (reduzir TTL) deixa de exigir deploy.

- **Tactic alvo**: Defer Binding
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - TTL configurável sem deploy: não → sim
- **Risco de não fazer**: baixo enquanto há 1 instância; se `numInstances` subir sem essa mudança, a mitigação de emergência (baixar o TTL) exige o mesmo ciclo de deploy que o incidente que ela mitigaria.
- **Dependências**: nenhuma — mas some de relevância se/quando a invalidação distribuída (mencionada no ADR como trabalho futuro) for implementada primeiro.

## 6. Notas do agente

- Escopo restrito aos diretórios do `_shared-metrics.md` (`--quick`); não medi LOC/complexidade fora de `http`, `domain/{interface,repository,service}/auth`, `routes`, `migrations`, `jobs`, e os diretórios de frontend listados — os warnings de complexidade citados no §2/§3 vêm do `npm run lint` completo, filtrados para confirmar ausência no escopo, não avaliados fora dele.
- Cross-QA: F-modifiability-2 (Repository→Service) e F-modifiability-4 (teste acoplado a `router.stack` do Express, já registrado como risco pelo próprio ADR) se sobrepõem com Testability — "difícil de testar sem introspecção de internals" é sintoma do mesmo acoplamento que torna a mudança cara.
- Cross-QA: F-modifiability-1 (catálogo duplicado) se sobrepõe com Integrability (contrato FE/BE não gerado de uma fonte única) e com Deployability via F-modifiability-5 (TTL/rounds não externalizados = mudança de política de segurança exige redeploy).
- Não medi: cobertura de teste específica do "espelho" `permissoes.ts` do frontend contra o backend — `__tests__/permissoes-api.test.ts` existe mas não abri seu conteúdo linha a linha; a lacuna apontada em F-modifiability-1 é inferida da ausência de qualquer import cruzado entre `src/frontend/lib/permissoes.ts` e o backend (arquivos são fisicamente desconectados por design de monorepo com dois `package.json`).
