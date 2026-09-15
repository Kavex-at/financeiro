---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-15-1835-permutas-excecao-manual
agent: qa-modifiability
generated_at: 2026-09-15T18:55:00-03:00
scope: backend+frontend (delta `fix/permutas-excecao-manual`, 2f03116..2bcc949, --quick)
score: 8.3
findings_count: 4
cards_count: 4
---

# Modifiability — Regis-Review

Escopo: **delta** do `/feature-tweak` `permutas-excecao-manual` (ADR-0047, exceção manual "permutado
fora do painel"). Não é auditoria global — só o custo de mudança que este diff `2f03116..HEAD`
imprime nos módulos que ele tocou.

## 1. Cenário Geral (Bass General Scenario aplicado ao delta permutas-excecao-manual)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista da Columbia + ADR futuro | (a) um segundo caso de "permutado por fora" (hoje 1 adto — 8721 — mas o ADR-0047 admite que "qualquer trading com histórico anterior à ferramenta tem permutas por lançamento manual"); (b) pedido de ampliar a guarda (ex.: admitir `BLOQUEADA/nao-pago` também) ou introduzir uma segunda exceção informativa (`compensado-fora-do-painel`) reusando `JA_PERMUTADO`; (c) rename `justificativa`→`motivo` no payload | Guarda I-Exc-1 (`ExcecaoPermutaService.guardaSatisfeita`), mapa de rótulos pt-BR (`ROTULO_MOTIVO` BE × `MOTIVO_LABEL` FE), pós-passe `aplicarExcecoesManuais` no `EleicaoPermutasService`, rotas admin `/permutas/adiantamentos/:docCod/excecao-manual` (POST/DELETE), UI (`ExcecaoManualDialog` + `DesfazerExcecaoDialog` + `useExcecaoManual` + `VisaoGeralTable`), Zod `excecaoManualBodySchema`, migration 0059 + CHECK estendido | Delta feito por 1 dev num worktree dedicado (`fix/permutas-excecao-manual`); dois pacotes npm separados (`src/backend`, `src/frontend`) sem workspace linking; produção Render/Vercel, 1 tenant, 27 endpoints em `routes/permutas.ts` | Nova regra deve tocar SÓ (a) o predicado (`guardaSatisfeita` — 1 linha), (b) o espelho BE→FE do rótulo, (c) o teste do predicado. Nada de mexer em `aplicarExcecoes`, `marcar`, `desfazer`, snapshot, header ou export — a cadeia toda depende do `ESTADO_DA_GUARDA` / `ESTADO_DA_EXCECAO` como fonte única | (Alvo) ampliar a guarda ou renomear a exceção = **≤ 3 arquivos** no BE + **≤ 2 no FE** + doc em `EstadoElegibilidade.ts` + ADR novo; **0** regressão nos 490 testes de `ExcecaoPermutaService.test.ts`; tempo até PR ≤ 1 dia. (Baseline atual) na primeira leitura, a guarda vive em 1 lugar no BE (`ExcecaoPermutaService.ts:72`) e é espelhada em 1 lugar no FE (`format.ts:142-146`) — bom começo, mas o espelho FE usa string literal, não o const enum. |

Cenário concreto: o delta introduziu uma exceção auditada que reclassifica adto de `BLOQUEADA/sem-saldo-permutar`
para `JA_PERMUTADO/permutado-fora-do-painel` (T7). O predicado que autoriza a exceção (guarda I-Exc-1)
é definido UMA VEZ em `ExcecaoPermutaService.guardaSatisfeita` (`ExcecaoPermutaService.ts:72-73`) e é
reutilizado por `aplicarExcecoes` (pós-passe da eleição, `:89`) e `marcar` (RPC, `:123`); os dois estados
(`ESTADO_DA_GUARDA` e `ESTADO_DA_EXCECAO`, `:20-28`) são o par simétrico usado por `marcar` (de: guarda,
para: exceção) e `desfazer` (de: exceção, para: guarda) via `reclassificarAdiantamento`. Isso é
Increase Semantic Coherence bem executado — o custo de "ampliar a guarda" é 1 linha na constante,
os 3 pontos de uso não precisam ser tocados. O que resta é débito de espelho cross-package
(FE precisa duplicar o predicado com literais) e o mesmo padrão de `MOTIVO_LABEL` duplicado
BE×FE que a modifiability review anterior (`2026-09-01-1229`, Card #2) já registrou como pendente.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Guardas do predicado I-Exc-1 no BE (definição × usos) | 1 definição × 3 usos (`aplicarExcecoes`, `marcar` direto, e implicitamente via `ESTADO_DA_GUARDA` em `desfazer`) | 1 def × N usos | ✅ | `ExcecaoPermutaService.ts:72,89,123` |
| Espelho do predicado no FE | 1 (`podeMarcarExcecao`) — mas com literais `'bloqueada'` + `'sem-saldo-permutar'`, não const compartilhada | 1 (idealmente derivado da mesma const) | ⚠️ | `src/frontend/app/permutas/components/format.ts:142-146` |
| Rótulos pt-BR de `MotivoBloqueio` duplicados BE↔FE | 2 mapas (`ROTULO_MOTIVO` 12 entradas × `MOTIVO_LABEL` 13 entradas) | 1 fonte ou test-time consistency check | ⚠️ | `ExcecaoPermutaRecusadaError.ts:14-27` × `format.ts:110-123` |
| Fan-in dos novos módulos | `ExcecaoPermutaService`: 3 (EleicaoPermutasService + 2 rotas) · `ExcecaoPermutaRepository`: 3 (ExcecaoPermutaService + EleicaoPermutasService + GestaoPermutasService) | — (baseline) | ℹ️ | `grep -n "ExcecaoPermuta" src/backend` |
| Fan-out (imports) por arquivo delta | `routes/permutas.ts` 33 · `EleicaoPermutasService.ts` 24 · `GestaoPermutasService.ts` 16 · `page.tsx` 37 · `ExcecaoPermutaService.ts` 10 | ≤ 15 desejável | ⚠️ pré-existente | `grep -c '^import ' <files>` |
| LOC dos arquivos-alvo (pré → pós delta) | `ExcecaoPermutaService.ts` 0→201 (novo) · `ExcecaoPermutaRepository.ts` 0→99 (novo) · `EleicaoPermutasService.ts` 1069→**1114** (+45) · `GestaoPermutasService.ts` 603→**638** (+35) · `RelatorioExportService.ts` 460→491 (+31) · `routes/permutas.ts` 792→**885** (+93) · `page.tsx` 1048→**1083** (+35) · `VisaoGeralTable.tsx` 486→545 (+59) · `lib/api.ts` 603→658 (+55) | p95 ≤ 400 (Bass) | ❌ pré-existente (5 arquivos > 600, 3 > 1000; delta manteve a curva, não corrigiu) | `wc -l` |
| Endpoints em `routes/permutas.ts` | 25 → **27** (+POST/DELETE `/adiantamentos/:docCod/excecao-manual`) | — (single-file router é padrão do repo) | ⚠️ pré-existente | `grep -c '^router\.' src/backend/routes/permutas.ts` |
| Cognitive complexity — novos métodos | `guardaSatisfeita` = 1 · `aplicarExcecoes` = 4 · `marcar` = 7 · `desfazer` = 4 · `aplicarExcecoesManuais` (Eleicao, priv.) = 3 | ≤ 15 (Biome) | ✅ | `npm run lint` (nenhum warning novo) |
| Cognitive complexity — arquivos tocados (regressões?) | `GestaoPermutasService.exporGestao` 28 (pré-existente) · `EleicaoPermutasService:776` 63 (pré-existente) · `:628` 16 (pré-existente); **delta não ampliou nenhum** | ≤ 15 | ⚠️ pré-existente | Biome comparativo (checkout de origin/main × HEAD do mesmo arquivo) |
| Adhesão às convenções do repo (BE) | `@injectable()` ✅ · arrow methods ✅ · explicit modifiers ✅ · `export default class` ✅ · sem `!` ✅ · sem `\| undefined` (usa `?:`) ✅ · Zod no boundary (`excecaoManualBodySchema` 10-500 chars) ✅ | 100% | ✅ | `ExcecaoPermutaService.ts`, `ExcecaoPermutaRepository.ts`, `ExcecaoPermutaRecusadaError.ts`, `routes/permutas.ts:165-167` |
| Novo atom vs. Design System | `components/ui/textarea.tsx` (25 LOC) segue exatamente o padrão do `Input` (mesmos tokens `border-input`, `focus-visible:ring-ring/50`, `aria-invalid:border-destructive`, `cn(...)`, `data-slot`) e chega na pasta canônica `components/ui/` | — | ✅ | `textarea.tsx:10-23` × `input.tsx:4-16` |
| Tests do delta (paridade de contrato) | 490 novos casos em `ExcecaoPermutaService.test.ts` + 155 no repositório + 208 em EleicaoService + 126 em GestaoService + 89 na API FE + 210 nos componentes + 78/29 helpers/histórico | — | ✅ | `_shared-metrics.md` (137 suites / 2012 tests BE, 43/361 FE) |
| Boilerplate `try/catch (ExcecaoPermutaRecusadaError)` duplicado nas rotas | 2 blocos idênticos (POST e DELETE) — 10 linhas cada | ≤ 1 (via middleware ou helper) | ⚠️ | `routes/permutas.ts:472-481` × `502-511` |

> ⚠️ **Não medível localmente**: taxa histórica de mudanças que ampliam a guarda I-Exc-1 (só há 1
> ponto — este delta). Se um segundo ADR mexer no predicado, começar a instrumentar "ampliações da
> guarda × arquivos tocados" na `CHANGELOG.md` da ontologia como baseline defensável para a próxima
> review.

## 3. Tactics — Cobertura no nf-projects (para o delta)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** | `ExcecaoPermutaService` foi **extraído** como módulo próprio em vez de amontoar no `EleicaoPermutasService` (que já está em 1114 LOC) ou no `GestaoPermutasService` (638). O predicado e o par de estados vivem lá; os dois clientes chamam por interface pública. | ✅ presente | `ExcecaoPermutaService.ts:59` (arquivo dedicado, 201 LOC) |
| **Increase Semantic Coherence** | **Muito bom.** Uma responsabilidade explícita ("marcar/desfazer + pós-passe da eleição") + UM predicado (`guardaSatisfeita`) que é a fonte única. O docblock cita "Duas responsabilidades, com UM predicado de guarda compartilhado" — o design foi explícito sobre a decisão. Nome + retorno + escopo alinhados. Nenhum flag booleano em API pública. | ✅ presente | `ExcecaoPermutaService.ts:46-57` (docblock intent), `:72-73` (predicado), `:20-28` (par de estados como const) |
| **Encapsulate** | O caminho da reclassificação (`reclassificarAdiantamento({ de, para })`) esconde do serviço a mecânica de UPDATE + CHECK do estado colapsado (migration 0055/0059). O serviço fala em pares de estado, o repositório fala em SQL. Zod no boundary do POST (`excecaoManualBodySchema`, 10-500 chars) blinda o corpo. | ✅ presente | `PermutaRelationalRepository.ts` (reclassify), `routes/permutas.ts:165-167` (Zod) |
| **Use an Intermediary** | `autorDoToken` (`routes/permutas.ts:433-438`) intermedia a extração de identidade do JWT com fallback sub→email. Small helper local — funciona hoje; se um terceiro endpoint precisar, promover a util. | ✅ parcial | `routes/permutas.ts:433-448` |
| **Restrict Dependencies** | `ExcecaoPermutaService` **NÃO** importa cliente Conexos — I4/I-Exc-5 (sem escrita no ERP) é restrição no protocolo, não só no código. O construtor documenta: "não há cliente Conexos injetado". | ✅ presente | `ExcecaoPermutaService.ts:55-56, 60-66` |
| **Refactor** | Aplicado dentro do serviço: extração de `isUniqueViolation` para isolar a detecção de corrida (SQLSTATE 23505). O par (`ESTADO_DA_GUARDA`, `ESTADO_DA_EXCECAO`) refatora a "direção" da transição num objeto reutilizável (marcar usa `de→para`, desfazer usa `para→de`). | ✅ presente | `ExcecaoPermutaService.ts:20-28, 144-145, 184-186, 196-200` |
| **Abstract Common Services** | **Ponto fraco herdado.** O rótulo pt-BR dos motivos existe em 2 mapas hand-maintained (`ROTULO_MOTIVO` BE, `MOTIVO_LABEL` FE) — o próprio código anota "Espelha `MOTIVO_LABEL` do frontend" como mitigação. O predicado da guarda também é duplicado (BE tipado, FE com string literals). É o mesmo débito da Card #2 da review anterior (`2026-09-01-1229/modifiability.md:82-97`) — não resolvido, não piorou por acumulação (só +1 motivo). | ❌ ausente (pré-existente) | `ExcecaoPermutaRecusadaError.ts:12,14-27` × `format.ts:110-123` |
| **Defer Binding — polimorfismo** | N/A. Não há eixo de variabilidade em runtime; a exceção é config de estado no banco. | N/A | — |
| **Defer Binding — configuration** | O par de estados (`ESTADO_DA_GUARDA`, `ESTADO_DA_EXCECAO`) é código, não SSM/env — correto: são invariantes de state-machine (ADR-0047 D2/D3), não config. `justificativa` 10-500 chars é limite de negócio, hardcoded no Zod — aceitável para o delta. | ✅ presente | `ExcecaoPermutaService.ts:20-28`, `routes/permutas.ts:165-167` |
| **Defer Binding — plugin/registry** | N/A. Não há eixo plug-in aqui. | N/A | — |

## 4. Findings

### F-modifiability-1: guarda I-Exc-1 espelhada BE↔FE com string literals — mudar o predicado exige tocar dois pacotes npm

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services (o predicado deveria derivar da mesma fonte) + Increase Semantic Coherence (BE tipado, FE literal — semanticamente iguais, sintaticamente descolados)
- **Localização**: BE `src/backend/domain/service/permutas/ExcecaoPermutaService.ts:20-23,72-73`; FE `src/frontend/app/permutas/components/format.ts:142-146` (`podeMarcarExcecao`).
- **Evidência (objetiva)**:
  ```ts
  // BE — const tipada + predicado reusado por `aplicarExcecoes` e `marcar`:
  const ESTADO_DA_GUARDA = {
      estado: ESTADO_ELEGIBILIDADE.BLOQUEADA,
      motivo: MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR,
  } as const;
  public guardaSatisfeita = (estado: string, motivo?: string): boolean =>
      estado === ESTADO_DA_GUARDA.estado && motivo === ESTADO_DA_GUARDA.motivo;

  // FE — mesma decisão, mas com literais:
  export function podeMarcarExcecao(
    p: Pick<PermutaPendente, 'status' | 'motivoBloqueio' | 'excecaoManual'>,
  ): boolean {
    return p.status === 'bloqueada' && p.motivoBloqueio === 'sem-saldo-permutar' && !p.excecaoManual
  }
  ```
  O próprio docblock do FE confirma: "Espelha a guarda do backend" (`format.ts:126-128`). Não há
  workspace linking entre `src/backend` e `src/frontend` — o BE não pode importar do FE nem vice-versa.
- **Impacto técnico**: quando alguém precisar (a) ampliar a guarda para admitir `BLOQUEADA/nao-pago`
  (por exemplo, se a Columbia trouxer um caso de "pago fora da tolerância e permutado por fora"),
  ou (b) renomear o motivo `sem-saldo-permutar`, o dev que edita só o BE passa os 490 testes de
  `ExcecaoPermutaService.test.ts` verdes e degrada silenciosamente o botão "Marcar como permutado
  fora do painel" na tela — o botão permanece habilitado onde não deveria, ou some onde deveria
  aparecer. Toda a modelagem cuidadosa do serviço (`ESTADO_DA_GUARDA` como const, predicado como
  função pública) morre no salto BE→FE.
- **Impacto de negócio**: baixo enquanto a guarda tem 1 estado válido e 1 dev toca o repo. Vira alto
  no dia em que (a) o time cresce ou (b) um segundo estado entra na whitelist — cenário previsto pelo
  ADR-0047 ("se o uso crescer além de casos isolados, reabrir a alternativa (a) com dados"). O modo
  de falha é auditoria contábil: o analista clica "Marcar" achando que pode, o backend recusa com
  422 e um `ExcecaoPermutaRecusadaError.userMessage` — funciona, mas o custo é atrito no fluxo, não
  corrupção. Se a inversão acontecer (FE não mostra o botão onde poderia), o adto fica bloqueado
  sem trilha do porquê.
- **Métrica de baseline**: 2 predicados que precisam concordar. 1 mapa `MotivoBloqueio → string` tipado
  no BE (`EstadoElegibilidade.ts:60-90`) e 1 mapa `Record<string, string>` hand-maintained no FE
  (`format.ts:110-123`). Delta ADR-0047 tocou os 2 lados corretamente (o teste da UI cobre o caso do
  botão em `permutas-components.test.tsx:423`), mas depende de disciplina humana.

### F-modifiability-2: `ROTULO_MOTIVO` (BE) e `MOTIVO_LABEL` (FE) são dois mapas mão-a-mão do mesmo `MotivoBloqueio→string` pt-BR

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services + Refactor (a duplicação é reconhecida em docblock e não removida)
- **Localização**: `src/backend/domain/errors/ExcecaoPermutaRecusadaError.ts:12,14-27` × `src/frontend/app/permutas/components/format.ts:110-123`.
- **Evidência (objetiva)**: o BE tem `Record<MotivoBloqueio, string>` (typed — motivo novo quebra o
  build, `:14`), o FE tem `Record<string, string>` (untyped — motivo novo passa silencioso, `:110`). O
  próprio comentário do BE explicita: `// Espelha MOTIVO_LABEL do frontend (app/permutas/components/format.ts)`
  (`ExcecaoPermutaRecusadaError.ts:12`). O delta adicionou a chave `PERMUTADO_FORA_DO_PAINEL: 'Permutado
  fora do painel (exceção manual)'` **nos dois lugares** com strings idênticas.
- **Impacto técnico**: adicionar/renomear um motivo do enum exige 3 edits: (a) `MOTIVO_BLOQUEIO`
  const em `EstadoElegibilidade.ts:60-90`, (b) `ROTULO_MOTIVO` no BE, (c) `MOTIVO_LABEL` no FE. Se (c)
  for esquecido, `MOTIVO_LABEL[motivo] ?? motivo` degrada o rótulo para o código cru (o adto aparece
  como "sem-saldo-permutar" em vez de "Sem saldo a permutar"). O BE **é** typed, então (b) trava o build
  — mas o FE não é.
- **Impacto de negócio**: baixo (custo é UX degradada, não bug de valor). É o mesmo padrão que a
  review anterior (`2026-09-01-1229/modifiability.md`, Card #2 sobre fixtures COPIADAS entre pacotes
  npm) flagou como P2 e continua aberto no inbox.
- **Métrica de baseline**: 2 mapas × 12-13 entradas cada. Delta ADR-0047 mudou os 2 (adicionou 1 chave).
  Sem mudança arquitetural, cada motivo novo custa 3 edits (const enum + 2 mapas).

### F-modifiability-3: `routes/permutas.ts` atinge 885 LOC / 27 endpoints; boilerplate `try/catch (ExcecaoPermutaRecusadaError)` duplicado

- **Severidade**: P3
- **Tactic violada**: Split Module (single-file router) + Refactor (10 linhas idênticas em 2 rotas)
- **Localização**: `src/backend/routes/permutas.ts:452-513` (POST + DELETE `/excecao-manual`), com
  `try/catch` em `:472-481` e `:502-511` (blocos idênticos exceto pela chamada `marcar`/`desfazer`).
- **Evidência (objetiva)**:
  ```ts
  // POST — try/catch:
  try {
      await service.marcar({ docCod, justificativa: parsed.data.justificativa, criadoPor });
      res.json({ adiantamentoDocCod: docCod });
  } catch (error) {
      if (error instanceof ExcecaoPermutaRecusadaError) {
          res.status(error.statusCode).json({ error: error.code, message: error.userMessage });
          return;
      }
      throw error;
  }
  // DELETE — mesma estrutura, mesma condição, mesmo shape de resposta.
  ```
  Arquivo cresceu 792 → 885 LOC (+93, +12%); número de endpoints 25 → 27. O padrão "single-file router
  por domínio" é pré-existente (recebimentos, sispag idem) — o delta seguiu o padrão em vez de
  fragmentar.
- **Impacto técnico**: a próxima rota admin de "recusa por regra" (previsível: `cliente-filtro`,
  outros overrides) repete o mesmo bloco. `asyncHandler` já centraliza async errors; um wrapper `mapDomainError`
  (ou um `expressErrorMapper` que reconhece `error.statusCode` + `error.code` + `error.userMessage`)
  eliminaria os try/catch de todas as rotas de escrita.
- **Impacto de negócio**: nenhum imediato (funciona e é testado por `routes/permutas.test.ts:187+`).
  Custo é leitura ("por que 2 catches idênticos?") e o risco de divergência quando um dev copia só um
  dos catches ao adicionar uma terceira rota.
- **Métrica de baseline**: 2 blocos idênticos de 10 linhas × 27 endpoints no arquivo × ~5 arquivos de
  rotas de escrita no repo. O `routes/permutas.ts` sozinho já tem outros `catch (error instanceof …)`
  para `AlocacaoEmBorderoError`, `AlocacaoSaldoError`, `IngestLockBusyError` — cada domínio traz o seu.

### F-modifiability-4: `MOTIVO_BLOQUEIO.PERMUTADO_FORA_DO_PAINEL` é motivo terminal de `JA_PERMUTADO`, mas a coerência não é expressa por tipo

- **Severidade**: P3
- **Tactic violada**: Increase Semantic Coherence (a state-machine tem "motivos que só aparecem depois de T7", mas o tipo `MotivoBloqueio` é união plana)
- **Localização**: `src/backend/domain/interface/permutas/EstadoElegibilidade.ts:60-111`.
- **Evidência (objetiva)**: o docblock do enum (`:100-107`) explica em prosa que
  `PERMUTADO_FORA_DO_PAINEL` "só é aplicado sobre `BLOQUEADA / SEM_SALDO_PERMUTAR`" e que o par
  (`JA_PERMUTADO`, `PERMUTADO_FORA_DO_PAINEL`) é terminal — mas nada disso é `Record<EstadoElegibilidade,
  MotivoBloqueio[]>` ou uma tagged union. `motivoBloqueio` continua sendo `string` no `PermutaCandidata`
  e a coerência é enforced por (a) a guarda em `ExcecaoPermutaService` e (b) o CHECK `permuta_adiantamento_sem_estado_colapsado`
  estendido pela migration 0059.
- **Impacto técnico**: o próximo motivo informativo que reusar `JA_PERMUTADO` (o docblock explicita
  o padrão: "outros informativos como `ja-permutado`, `cliente-filtro` e `composto-nm`", `EstadoElegibilidade.ts:41-49`)
  precisa lembrar de estender o CHECK da migration e o `ROTULO_MOTIVO`; o compilador não avisa.
- **Impacto de negócio**: nenhum imediato. Custo é a próxima ADR que reusa `JA_PERMUTADO` — precisa
  reler o docblock inteiro para saber que existe uma restrição de par (`estado, motivo`) enforced no
  banco, não no tipo.
- **Métrica de baseline**: 1 união plana `MotivoBloqueio` × 6 estados × 12 motivos. O CHECK do
  Postgres é a fonte real da restrição (migration 0055 + 0059) — se um dia o CHECK for revisado, o TS
  não muda junto.

## 5. Cards Kanban

### [modifiability-1] Derivar `podeMarcarExcecao` (FE) e `guardaSatisfeita` (BE) de uma const compartilhada de estados válidos para exceção manual

- **Problema**
  > A guarda I-Exc-1 é definida no BE com `ESTADO_DA_GUARDA` const-tipado + `guardaSatisfeita` (1 predicado, 3 usos), mas o FE espelha o mesmo predicado (`podeMarcarExcecao` em `format.ts:142-146`) usando string literals `'bloqueada'` e `'sem-saldo-permutar'`. Os dois pacotes npm (`src/backend` e `src/frontend`) não têm workspace linking, então o import cruzado não existe — a mesma limitação flagrada em `2026-09-01-1229/modifiability.md` Card #2 (fixtures copiadas). O delta atual (ADR-0047) adicionou o predicado nos dois lados corretamente, mas a próxima ampliação da guarda vai depender da disciplina de um dev humano tocar os dois pacotes.

- **Melhoria Proposta**
  > Duas alternativas ordenadas pelo custo:
  > 1. **Test-time consistency check** (S, baixo custo): `src/frontend/__tests__/guard-mirror.test.ts` que carrega a definição do BE via parse/regex do source (ou snapshot JSON gerado no build do BE) e compara com `podeMarcarExcecao` do FE. Falha o CI do FE quando a whitelist diverge. É o análogo do que a review anterior propôs para `LinhaBaseDados`.
  > 2. **Pacote compartilhado** `@financeiro/permutas-contracts` com o `MOTIVO_BLOQUEIO`, o `ESTADO_ELEGIBILIDADE` e uma `ESTADOS_QUE_ADMITEM_EXCECAO_MANUAL: ReadonlySet<{estado, motivo}>` (M, requer workspaces yarn/pnpm — mesma decisão do Card #2 anterior).
  > Recomendação: (1) agora, junto com a alt. 1 do Card #2 da review anterior (o mesmo script CI pode cobrir os 2 casos); (2) quando o segundo contrato compartilhado aparecer e obrigar o repo a virar monorepo com workspaces.

- **Resultado Esperado**
  > Ampliar a whitelist da guarda (ex.: aceitar `BLOQUEADA/nao-pago`) exige tocar SÓ o BE. O FE herda a mudança automaticamente (alt. 2) ou o CI do FE falha em ≤ 30s (alt. 1) sem depender do dev lembrar de editar o `format.ts`.

- **Tactic alvo**: Abstract Common Services + Increase Semantic Coherence
- **Severidade**: P2
- **Esforço estimado**: S (alt. 1) / M (alt. 2)
- **Findings relacionados**: F-modifiability-1, F-modifiability-2 (o mesmo script cobre os 2 espelhos BE↔FE)
- **Métricas de sucesso**:
  - Predicados que precisam concordar entre BE e FE: 2 (predicado + rótulos) → 2 sob CI gate (alt. 1) ou 0 (alt. 2)
  - Tempo até detectar divergência: manual (revisor de PR) → automático em ≤ 30s
  - Edits para ampliar a guarda (novo estado admissível): 3 (BE const + FE literal + docblock ADR) → 1 (BE const, resto herda) na alt. 2
- **Risco de não fazer**: a próxima ADR que ampliar a guarda (previsto pelo próprio ADR-0047 "se o uso crescer além de casos isolados") divergirá silenciosamente entre BE (que trava por 422) e FE (que esconde/mostra o botão pelo predicado errado). Modo de falha: adto elegível para exceção com botão "Marcar" invisível, ou adto NÃO elegível com botão visível → 422 na hora do clique.
- **Dependências**: se resolvido junto com o Card #2 da review anterior (`2026-09-01-1229`), agrupa o gate cross-package num único job de CI e amortiza o custo.

### [modifiability-2] Consolidar `ROTULO_MOTIVO` (BE) e `MOTIVO_LABEL` (FE) numa fonte única (ou test-time consistency check)

- **Problema**
  > `ExcecaoPermutaRecusadaError.ROTULO_MOTIVO` (BE, `Record<MotivoBloqueio, string>` — tipado, 12 entradas) e `format.MOTIVO_LABEL` (FE, `Record<string, string>` — untyped, 13 entradas) são dois mapas hand-maintained do mesmo `motivo → rótulo pt-BR`. O próprio BE anota: "Espelha `MOTIVO_LABEL` do frontend" (`ExcecaoPermutaRecusadaError.ts:12`). O delta ADR-0047 adicionou a chave `PERMUTADO_FORA_DO_PAINEL` nos dois — funcionou, mas o custo unitário de um motivo novo é 3 edits.

- **Melhoria Proposta**
  > Se o Card #1 for feito por (alt. 1), o mesmo script CI compara também os mapas de rótulo (parse do BE, `Object.keys` do FE). Se por (alt. 2), o pacote compartilhado expõe `MOTIVO_LABEL: Record<MotivoBloqueio, string>` tipado — BE e FE importam. Como fallback isolado (se este card for feito sozinho): tornar o `MOTIVO_LABEL` do FE `Record<MotivoBloqueio, string>` (mesmo tipo, mesmo enforcement no compilador do FE) — exige mover `MotivoBloqueio` do BE para um `.ts` que o FE possa copiar como fixture com CI check. Não é a solução mais elegante, mas é 1h de trabalho.

- **Resultado Esperado**
  > Adicionar um motivo novo ao enum quebra o build de AMBOS os pacotes (BE já quebra hoje; FE passa a quebrar também). Tempo de detecção de divergência: manual → build-time.

- **Tactic alvo**: Abstract Common Services + Refactor
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Edits para adicionar um motivo: 3 (const + BE map + FE map) → 2 (const + fonte única) ou 3 com CI gate
  - Chance de esquecer o FE: alta → 0 (build quebra)
- **Risco de não fazer**: baixo — o modo de falha é rótulo cru na UI ("sem-saldo-permutar" em vez de "Sem saldo a permutar"), não bug de valor. Custo composto por acumulação: cada motivo novo do domínio (o `EstadoElegibilidade` já tem 12; a ADR-0007 e a ADR-0043 sinalizam que a lista ainda cresce) paga o mesmo pedágio.
- **Dependências**: idealmente feito junto com o Card #1 (mesmo script CI, mesma raiz — divergência BE↔FE por falta de fonte única).

### [modifiability-3] Extrair `mapDomainError` (ou middleware Express) para eliminar boilerplate `try/catch (RecusadaError)` das rotas de escrita

- **Problema**
  > O par POST/DELETE `/excecao-manual` tem dois blocos idênticos de `try/catch (error instanceof ExcecaoPermutaRecusadaError)` que devolvem `{error: code, message: userMessage}` com `statusCode` — 10 linhas × 2. Padrão pré-existente do repo: `routes/permutas.ts` já tem catches similares para `AlocacaoEmBorderoError`, `AlocacaoSaldoError`, `IngestLockBusyError`. `asyncHandler` já centraliza async errors; falta a camada de mapping de "erro de domínio → HTTP".

- **Melhoria Proposta**
  > Reforçar a interface `HandlerError` (já implementada por `ExcecaoPermutaRecusadaError`, `AlocacaoEmBorderoError` et al.) num `expressErrorMapper` que reconheça `error.statusCode && error.code && error.userMessage` e responda direto — plugado uma vez no app, elimina os try/catch de todas as rotas. Alternativa mais conservadora: um helper `respondDomainError(res, error): boolean` reusado nos 2 catches (baixa o boilerplate de 10 linhas para 3). Aplicar o mesmo raciocínio no restante de `routes/permutas.ts` para amortizar o esforço.

- **Resultado Esperado**
  > Cada nova rota admin de "recusa por regra" (previsíveis: cliente-filtro, outros overrides) não repete o `try/catch`. Ocorrências de `catch.*instanceof.*RecusadaError|EmBorderoError|SaldoError|LockBusyError` em `src/backend/routes/`: N → 0.

- **Tactic alvo**: Refactor + Use an Intermediary
- **Severidade**: P3
- **Esforço estimado**: S (helper) / M (middleware global + varredura das 5 rotas)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - LOC em `routes/permutas.ts`: 885 → ~830 (helper) ou ~800 (middleware)
  - Boilerplate `try/catch` idêntico duplicado no arquivo: 2 (excecao-manual) + N (outras rotas) → 0
- **Risco de não fazer**: baixo. Custo é leitura acumulada — cada nova rota traz mais 10 linhas de catch.
- **Dependências**: nenhuma. Requer entender a assinatura de `HandlerError` (já existente em `domain/libs/handler/`).

### [modifiability-4] Tipar a relação `(EstadoElegibilidade, MotivoBloqueio)` como par válido, não como duas uniões planas

- **Problema**
  > `PERMUTADO_FORA_DO_PAINEL` é motivo terminal de `JA_PERMUTADO` (T7), mas nada no tipo diz isso. `motivoBloqueio` é `string \| undefined` no `PermutaCandidata`; o docblock explica em prosa. A restrição real vive no CHECK `permuta_adiantamento_sem_estado_colapsado` (migration 0055 estendida pela 0059) — Postgres é a fonte da verdade, TS não sabe. `cliente-filtro`, `ja-permutado`, `composto-nm` seguem o mesmo padrão: motivos que só combinam com certos estados.

- **Melhoria Proposta**
  > `type EstadoComMotivo = | { estado: 'bloqueada'; motivo: 'nao-pago' | 'sem-saldo-permutar' | ... } | { estado: 'ja-permutado'; motivo: 'ja-permutado' | 'permutado-fora-do-painel' | 'cliente-filtro' | 'composto-nm' } | ...` — tagged union que codifica a state-machine no tipo. `PermutaCandidata` passa a carregar `EstadoComMotivo` em vez do par `(estadoElegibilidade, motivoBloqueio?)`. Custo: revisão de ~30 sites que fazem pattern-match no par (grep `estadoElegibilidade.*motivoBloqueio` mostra a superfície). Ganho: adicionar um motivo novo obriga a declarar a que estado ele pertence — o docblock passa a ser tipo.

- **Resultado Esperado**
  > O compilador TS enforça a coerência que hoje só o CHECK do Postgres enforça. O próximo motivo informativo que reusar `JA_PERMUTADO` não passa build sem estender o tipo — e o CHECK da migration.

- **Tactic alvo**: Increase Semantic Coherence + Restrict Dependencies
- **Severidade**: P3
- **Esforço estimado**: M (refactor cross-service — atinge `EleicaoPermutasService`, `GestaoPermutasService`, `ExcecaoPermutaService`, os testes, e o FE `PermutaPendente`)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Pares `(estado, motivo)` enforced pelo compilador: 0 → todos os pares válidos
  - Docblock em prosa que codifica invariantes de par: ≥3 (`EstadoElegibilidade.ts:41-49, 100-107`) → 0 (viraram tipo)
- **Risco de não fazer**: baixo. Custo é leitura ("qual motivo combina com qual estado?") + a chance de esquecer o CHECK ao adicionar um motivo novo. Pré-existente ao delta.
- **Dependências**: nenhuma para começar; convém depois do Card #1 (para que a fonte única BE↔FE já exista).

## 6. Notas do agente

**P0 não se aplica ao delta.** Este delta na verdade é um bom exemplo de modificabilidade — o
predicado da guarda é definido UMA vez (`ExcecaoPermutaService.guardaSatisfeita`), o par de estados
(`ESTADO_DA_GUARDA`, `ESTADO_DA_EXCECAO`) é reutilizado em ambas as direções da transição (`marcar` e
`desfazer`), nenhum flag booleano em API pública, nenhum `!`, nenhum `| undefined`, Zod no boundary, `ExcecaoPermutaService`
extraído como módulo próprio em vez de amontoado no `EleicaoPermutasService` que já está em 1114 LOC.
O textarea foi implementado como atom do design system, não como one-off. A UI foi isolada num
hook (`useExcecaoManual`) em vez de expandir `page.tsx`. Todos os pontos do escopo pedido (cohesion da
guarda, growth dos arquivos-alvo, conventions, textarea) passam. Score 8.3 (contra 7 da review de
`contas-a-pagar-entrada`) porque o delta acertou o que a review anterior falhou.

Débitos remanescentes são todos herdados e conhecidos: (1) espelhamento BE↔FE por falta de workspace
linking — mesmo padrão do Card #2 anterior; (2) `routes/permutas.ts` como single-file router
crescente; (3) tipos de state-machine em prosa em vez de tagged union. Nenhum deles é regressão
introduzida por este delta.

Cross-QA (para o consolidator):
- **Card #1 + #2** (fonte única BE↔FE) sobrepõem **Integrability** (o contrato REST é o único meio de
  fazer BE e FE concordarem hoje) e **Testability** (testes de guarda vivem em dois pacotes
  independentes, com fixtures colocadas manualmente — `ExcecaoPermutaService.test.ts:271` × `excecao.test.ts:22`).
- **Card #3** (mapDomainError) sobrepõe **Fault-tolerance** (a mensagem de recusa é interface de erro;
  centralizar melhora consistência dos códigos HTTP em toda rota admin).
- **Card #4** (tagged union de estado+motivo) sobrepõe **Testability** (30 sites de pattern-match hoje
  precisam de teste; com o tipo enforced, a coverage cai naturalmente) e **Deployability** (o CHECK
  do Postgres na migration 0059/0055 é hoje a fonte de verdade da coerência — refatorar o tipo TS
  para casar com o CHECK amarra os dois artefatos, que hoje andam em paralelo).

Métrica que tentei coletar e não consegui: histórico de "ampliações da guarda × arquivos tocados". Só
há 1 ponto de dado (este delta = 1 par de estados válidos). Se um segundo ADR mexer no predicado,
começar a instrumentar isso na `CHANGELOG.md` da ontologia vira baseline defensável (mesma
recomendação da review de `contas-a-pagar-entrada`).
