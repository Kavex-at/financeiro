# Frente V — Anatomia de um vertical slice

> Mapa do que copiar para criar a Frente V seguindo os padrões já estabelecidos.
> Referência primária: **Frente IV (recebimentos)** — a mais recente e a que melhor resolve
> exatamente o problema que a Frente V terá (paralelismo entre times/sessões).
> **Data:** 2026-08-18. Tudo abaixo foi lido no código; citações em `arquivo:linha`.

---

## 0. A descoberta mais importante para a Frente V

A Frente IV **já resolveu o problema do desenvolvimento paralelo** com um padrão de
**ports + tokens + container**, e a Frente V deve copiá-lo literalmente:

- `src/backend/domain/interface/recebimentos/ports.ts:11` — o comentário é explícito:
  *"These `*Interface` ports are the hand-off points between the 6 modules. No module imports
  another module's implementation — only its interface + the shared DTOs. Swap a stub for a real
  class via the DI token below and nothing else changes."*
- Como interfaces TypeScript não podem ser tokens do tsyringe, **cada port tem um `Symbol(...)`**.
- `src/backend/domain/recebimentosContainer.ts:47` — `registerRecebimentosPorts()` liga cada token à
  implementação real **ou a um stub**, de forma idempotente (`if (container.isRegistered(...)) return`).

**Consequência direta para o plano de 3 fatias:** F2 e F3 não precisam esperar a F1. Elas programam
contra o *port* e registram um stub nos testes; quando a F1 entra, troca-se o binding no container e
nada mais muda. Isso não é teoria — é o que a Frente IV faz hoje em `recebimentosContainer.ts:50+`.

---

## 1. Cadeia completa de um endpoint

```
index.ts  →  http/<frente>Gate  →  routes/<frente>.ts  →  Service  →  Repository/Client
```

### 1.1 Bootstrap — `src/backend/index.ts`

```ts
import 'reflect-metadata';          // :1  — SEMPRE a primeira linha (Inviolable Rule #6)
import 'dotenv/config';
import { container } from 'tsyringe';
import express from 'express';
```

Middlewares na ordem (`index.ts:31-50`): `trust proxy` → `cors(buildCorsOptions(...))` →
`express.json()` → `globalLimiter` → `requestIdMiddleware` → logger de REQ/RES com `redactBody`.

Montagem dos routers (`index.ts:81-125`):

```ts
app.use('/auth', authRouter);                              // :81
app.use('/conexos', conexosRouter);                        // :101
app.use('/permutas', permutasRouter);                      // :108
app.use('/sispag', sispagGate, sispagRouter);              // :113
app.use('/recebimentos', recebimentosGate, recebimentosRouter);  // :118
app.use('/usuarios', usuariosRouter);                      // :122
app.use('/me', meRouter);                                  // :125
```

> **Nota:** os routers são montados na raiz (`/recebimentos`), **não** sob `/api`. O contrato do §5
> do doc de orquestração escreve `GET /api/aprovacoes` — **corrigir para `GET /aprovacoes`** ao
> travar o contrato, ou confirmar se há um prefixo aplicado no proxy do frontend.

### 1.2 Feature gate por frente — `src/backend/http/recebimentosGate.ts:15`

Cada frente nova nasce atrás de um gate que devolve 403 quando desabilitada por ambiente:

```ts
export const recebimentosGate: RequestHandler = asyncHandler(async (_req, res, next) => {
    await bootstrapAppContainer();
    const env = await container.resolve(EnvironmentProvider).getEnvironmentVars();
    if (!env.recebimentosEnabled) {
        res.status(403).json({ error: 'Recebimentos indisponível.' });
        return;
    }
    next();
});
```

**A Frente V precisa de `http/aprovacoesGate.ts` + `EnvironmentProvider.resolveAprovacoesEnabled`.**
Isso permite subir o código em produção desligado enquanto o probe e a homologação correm.

### 1.3 Rota — `src/backend/routes/recebimentos.ts:1`

Começa com `import 'reflect-metadata'` (`:1`), monta um `Router()` (`:57`), e **não tem lógica de
negócio**: Zod valida no boundary, o service coordena (comentário em `:52-55`).

Imports característicos (`:41-50`): `asyncHandler`, `requireRole`, `filialAuthz`
(`assertUserCanActOnFilial`, `filiaisPermitidas`, `FilialForbiddenError`), `heavyRouteLimiter`,
`respondHandlerError`.

---

## 2. DI / tsyringe — `src/backend/domain/appContainer.ts`

`bootstrapAppContainer()` (`:53`) é **lazy e idempotente** (`if (bootstrapped) return`). Ele:

1. Resolve `EnvironmentProvider` e lê as env vars (`:54`).
2. Constrói o adapter do Conexos com resolução de sessão **por chamada** (`:59-60`) e o registra no
   token `LEGACY_CONEXOS_TOKEN` (`:63`).
3. Faz *eager warm* do `ConexosBaseClient` (`:64`).
4. Chama `registerRecebimentosPorts()` (`:67`) — **é aqui que a Frente V insere
   `registerAprovacoesPorts()`**.
5. Roda `initDatabaseAndMigrate(...)` (`:69`) — Postgres + migrations **antes** de servir tráfego
   (`:19-26`: *"NUNCA roda dentro de um handler de rota"*). Fail-loud em produção, warn em dev.

Convenções de classe (CLAUDE.md + código): `@injectable()` / `@singleton()`, métodos como arrow
functions (`public save = async (...) => {}`), modificadores de acesso explícitos, exportar classes.

---

## 3. Validação Zod no boundary — `src/backend/http/validate.ts:17`

```ts
export const validateInput = <T, D extends ZodTypeDef, I>(
    schema: ZodSchema<T, D, I>,
    input: unknown,
): ValidationResult<T> => {
    const parsed = schema.safeParse(input);
    if (parsed.success) return { success: true, data: parsed.data };
    return { success: false, status: 400, body: {
        error: 'Invalid request input',
        details: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    }};
};
```

Resultado é um **union discriminado** em `success` (`:8-10`), justamente para o chamador estreitar o
tipo sem `!` (Inviolable Rule: sem non-null assertion). Schemas compartilhados vivem em
`src/backend/http/schemas.ts`.

---

## 4. RBAC, auth e multi-filial

| Peça | Arquivo | Papel |
|------|---------|-------|
| JWT Supabase | `http/auth.ts` (+ `authEnv.ts`) | `buildAuthMiddleware`, `requireRole` |
| Identidade Conexos | `http/conexosIdentity.ts` | vincula o usuário logado ao usuário do ERP |
| Escopo de filial | `http/filialAuthz.ts` | `filiaisPermitidas(user)`, `assertUserCanActOnFilial`, `FilialForbiddenError` |
| Sessão Conexos por request | `domain/client/ConexosSessionResolver.ts` + `ConexosSessionRegistry.ts` | usuário logado com vínculo válido → sessão dele; senão → robô (ADR-0007) |
| Correlação | `middleware/requestId.ts` | `X-Request-Id` em todo request/response |
| Rate limit | `http/rateLimit.ts` | `globalLimiter`, `heavyRouteLimiter` (para rotas caras) |
| Redação de log | `http/redact.ts` | `redactBody` no logger |

Padrão de resolução de filiais acessíveis: `routes/recebimentos.ts:70` —
`resolverFilCodsAcessiveis(user)` usa a allow-list do token quando existe, senão todas as filiais do
ERP. **A varredura da Frente V deve respeitar exatamente essa allow-list.**

---

## 5. Acesso ao Conexos

### 5.1 Base — `domain/client/ConexosBaseClient.ts`

`@injectable() @singleton()`, injeta `RetryExecutor`. Constantes de paginação:

| Constante | Valor | Linha | Papel |
|-----------|-------|-------|-------|
| `PAGE_SIZE` | 500 | `:104` | linhas por página no fan-out |
| `MAX_PAGES` | 50 | `:113` | teto de segurança → 25k linhas por combinação de filtro; **não lança**, devolve o que tem e loga warning |
| `CHUNK_SIZE` | 50 | `:96` | tamanho do lote em filtros `#IN` |
| `BR_NOON_SHIFT_MS` | 15h | `:9` | **crítico para a Frente V** — ver §9 |

### 5.2 Adapter — `domain/client/legacyConexosAdapter.ts:21`

`buildLegacyConexosAdapter(resolveService)` transforma `serviceName` em `POST /{serviceName}`
(`:28`) e desembrulha `.rows` (`:29-30`). `listGenericPaginated` (`:37`) **preserva** o envelope
`{count, rows}` — é o que a Frente V usa para paginar `fin026/list` e `fin103/list`.

Há variantes deliberadamente **sem retry em 401** (`postGenericOnce`, `putGenericOnce`,
`postMultipartOnce`) para escritas irreversíveis. **A Frente V é read-only e não usa nenhuma delas.**

### 5.3 Sub-clients por família

Um client por família de telas: `ConexosTitulosClient`, `ConexosExtratoClient`,
`ConexosSispagClient`, `ConexosNdeClient`, `ConexosGerDocProcessoClient`, `ConexosCadastroClient`…

Exemplo de montagem de filtro — `ConexosTitulosClient.ts:236`:

```ts
filterList: { 'titVldStatus#EQ': '1' },
serviceName: 'com308.finTituloFin',   // :237  — note a forma pontuada
```

versus a forma simples em `ConexosCadastroClient.ts:169`: `serviceName: 'imp021'`.

**Frente V cria `ConexosAprovacoesClient`** com: `listTitulosComLiberacoes` (fin026/list),
`listBloqueios` (fin103/list), `getTrilhaTitulo` (fin026/infoTitulo + infoTitulo/list) e
`listCadastroBloqueios` (FinBloq/FinBloqAlca, cacheado).

Erros: `domain/errors/ConexosError.ts` + `ErpResponseReader.ts`.

---

## 6. Persistência

### 6.1 Migrations — `src/backend/migrations/`

- Convenção: `NNNN_nome_snake_case.sql`, sequencial.
- **49 migrations hoje; a última é `0048_idx_solicitacao_numerario_execucao_filial.sql`.
  A próxima livre é `0049`.**
- Executadas no boot por `MigrationRunner` (`migrations/runMigrations.js`) via `BootMigrator`,
  chamadas de `appContainer.ts:35`. Idempotente por `schema_migrations`.

### 6.2 Repository — exemplo `domain/repository/recebimentos/TransacaoRepository.ts:44`

```ts
@injectable()
export default class TransacaoRepository implements TransacaoRepositoryInterface {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}
    public save = async (transacao: TransacaoBancaria): Promise<TransacaoBancaria> => { ... }
}
```

> **⚠ Divergência com o CLAUDE.md, importante para quem for implementar.** O CLAUDE.md
> (Inviolable Rule #5) diz *"Always parameterized SQL (`$1`, `$2`)"*, mas o
> `PostgreeDatabaseClient` real usa **parâmetros nomeados com um objeto**:
> `selectMany(query, params?: Record<string, unknown>)` (`PostgreeDatabaseClient.ts:75`), e o SQL
> escreve `$id`, `$correlationId`, `$filCod` (`TransacaoRepository.ts:52-57`).
> O espírito da regra (nada de interpolação de string) vale integralmente; a **sintaxe** a seguir é
> a nomeada. Não tente usar `$1` posicional — não é o contrato desse client.

API do `PostgreeDatabaseClient`: `init` (`:51`), `selectMany` (`:75`), `selectFirst` (`:79`),
`update` (`:87`), `insert` (`:91`), `withTransaction` (`:102`), `withAdvisoryLock` (`:137`).

> **`withAdvisoryLock` é a peça certa para o job da Frente V** — impede duas execuções concorrentes
> da ingestão pisando no mesmo snapshot.

Outros padrões visíveis no `TransacaoRepository`: `UPSERT_CHUNK = 200` (`:17`) para upsert em lote;
comparação de dinheiro sempre com `ROUND(x * 100)` sobre `NUMERIC`, **nunca ponto flutuante**
(`:26-28`).

---

## 7. Jobs — `src/backend/jobs/`

Scripts standalone TypeScript, duas famílias:

- **`ingest-*.ts`** — ingestão real: `ingest-extratos.ts`, `ingest-pagamentos.ts`,
  `ingest-permutas.ts`. É o molde do `ingest-aprovacoes.ts` da Frente V.
- **`probe-*.ts`** — exploração somente-leitura contra o ERP: `probe-com297-list.ts`,
  `probe-fin015-hml.ts`, `probe-sispag*.ts`, `validate-*.ts`. **É o molde do
  `probe-aprovacoes-fin026.ts` da Onda 0.5.**

Fora de um request, o `ConexosSessionResolver` cai na sessão do robô — jobs funcionam sem usuário
logado. Agendamento: ADR-0028 (cron horário na Frente IV).

---

## 8. Testes

| Convenção | Onde |
|-----------|------|
| Unitário colocado | `*.test.ts` ao lado do arquivo |
| Integração / ERP real | `*.integration.test.ts` (ex.: `routes/recebimentos.e2e.hml.integration.test.ts`) |
| E2E por cenário | `routes/recebimentos.e2e.<cenario>.test.ts` — há ~15 arquivos |
| Stubs de port | `domain/service/recebimentos/stubs/` (`NexxeraGatewayStub`, `MatchingEngineStub`, …) |
| Harness de ERP fake | `docs/e2e/` |
| Config | `src/backend/jest.config.cjs` |

Comandos: `cd src/backend && npm run dev | test | build | lint | lint:fix | typecheck`
(idem em `src/frontend`).

---

## 9. Frontend

Stack: **Next.js App Router + Tailwind + Radix + CVA** (padrão shadcn/ui). Sem lib de tabela — a
tabela é própria.

- Componentes compartilhados: `src/frontend/components/ui/` — `table`, `badge`, `card`, `dialog`,
  `select`, `multi-select`, `combobox`, `date-picker`, `empty-state`, `skeleton`, `spinner`,
  `kpi-card`, `page-header`, `tabs`, `tooltip`, `money-input`.
- `components/AppShell.tsx` — casca da aplicação (é onde entra o item de menu da Frente V).
- Página: **client component** (`'use client'` em `app/recebimentos/page.tsx:1`), dados via
  `React.useEffect` (`:133`) chamando funções de `@/lib/<frente>.ts`.
- **Reuso direto e valioso:** `@/app/permutas/components/tabela-filtro` exporta `FiltroBarra`,
  `Paginacao` e `useTabelaFiltro` — já usado pela Frente IV
  (`app/recebimentos/page.tsx:38`). **A Frente V deve reusar, não reimplementar.**
- Formatação: `formatBRL` de `@/lib/utils`; datas com `date-fns`.
- Badges de status por frente: `app/recebimentos/components/status-badges.tsx` — molde direto do
  badge de `StatusWorkflow`.
- Toasts: `sonner`. Ícones: `lucide-react`. Formulários: `react-hook-form` + `zod`.
- Testes colocados: `*.test.tsx`.

Estrutura a criar: `app/aprovacoes/{page.tsx, layout.tsx, components/}` + `lib/aprovacoes.ts`.

---

## 10. Release

`scripts/bump-version.ps1 -Execute` — semver por conventional commit, **FE e BE em lockstep**
(hoje ambos em `0.26.0`), atualiza `CHANGELOG.md`, commit `chore(release): vX.Y.Z`.
No-op se o delta não tiver `feat`/`fix`/`perf`.

---

## 11. Checklist — criar a Frente V do zero

**Slug recomendado: `aprovacoes`.** Motivos: (a) as frentes existentes usam substantivo curto de uma
palavra (`permutas`, `sispag`, `recebimentos`) e `workflow-aprovacao` quebraria o padrão de URL e de
diretório; (b) "workflow" é jargão de ferramenta, não do domínio financeiro da Columbia; (c) o termo
já é inequívoco no repo — nenhuma outra frente usa "aprovações" como conceito central (a "aprovação
de borderô" da Frente IV é um passo interno, não uma frente).

### Backend

| # | Arquivo | Ação |
|---|---------|------|
| 1 | `domain/interface/aprovacoes/constants.ts` | status e enums tipados (nunca string crua) |
| 2 | `domain/interface/aprovacoes/*.ts` | DTOs: `TrilhaAprovacao`, `EtapaAprovacao`, `EventoAprovacao` |
| 3 | `domain/interface/aprovacoes/ports.ts` | **interfaces + `Symbol` tokens** — o contrato que destrava F2/F3 |
| 4 | `domain/aprovacoesContainer.ts` | `registerAprovacoesPorts()` idempotente |
| 5 | `domain/appContainer.ts` | **editar**: chamar `registerAprovacoesPorts()` |
| 6 | `domain/client/ConexosAprovacoesClient.ts` | fin026/list, fin103/list, fin026/infoTitulo |
| 7 | `migrations/0049_aprovacao_trilha.sql` (e seguintes) | schema do snapshot + eventos |
| 8 | `domain/repository/aprovacoes/*.ts` | SQL parametrizado **nomeado**; `withAdvisoryLock` no job |
| 9 | `domain/service/aprovacoes/*.ts` | reconciliação de snapshot, cálculo de durações, montagem da trilha |
| 10 | `domain/service/aprovacoes/stubs/*.ts` | stubs dos ports, para F2/F3 testarem sem a F1 |
| 11 | `http/aprovacoesGate.ts` | 403 quando desabilitada |
| 12 | `domain/libs/environment/EnvironmentProvider.ts` | **editar**: `resolveAprovacoesEnabled` |
| 13 | `routes/aprovacoes.ts` | `GET /aprovacoes`, `GET /aprovacoes/:id/trilha` |
| 14 | `index.ts` | **editar**: `app.use('/aprovacoes', aprovacoesGate, aprovacoesRouter)` |
| 15 | `jobs/probe-aprovacoes-fin026.ts` | Onda 0.5 |
| 16 | `jobs/ingest-aprovacoes.ts` | ingestão periódica |
| 17 | testes colocados | `*.test.ts` por camada |

### Frontend

| # | Arquivo | Ação |
|---|---------|------|
| 18 | `lib/aprovacoes.ts` | client de API + tipos espelhando o contrato |
| 19 | `app/aprovacoes/layout.tsx` + `page.tsx` | grid |
| 20 | `app/aprovacoes/components/status-badges.tsx` | badge de `StatusWorkflow` |
| 21 | `app/aprovacoes/components/TrilhaDrawer.tsx` | timeline |
| 22 | `components/AppShell.tsx` | **editar**: item de menu |
| 23 | testes `*.test.tsx` | |

### Ontologia e docs

| # | Arquivo |
|---|---------|
| 24 | `ontology/entities/*`, `actions/aprovacoes/*`, `state-machines/*`, `business-rules/*` |
| 25 | `ontology/integrations/conexos-fin026-fin103-aprovacao.md` |
| 26 | `ontology/decisions/00XX-bootstrap-frente-v-workflow-aprovacao.md` |
| 27 | `ontology/_index.json`, `_coverage.json`, `relationships.md`, `glossary.md` |
| 28 | `CLAUDE.md` — a tabela de frentes passa a ter cinco linhas |
| 29 | `docs/conexos-api/screens/fin026.md` e `fin103.md` (subproduto do probe) |

---

## 12. Armadilhas — o que NÃO repetir

1. **Timestamps do Conexos podem chegar sem hora.** `ConexosBaseClient.ts:9` documenta que datas do
   ERP vêm como *meia-noite UTC do dia BR* e que o código desloca +15h para preservar o dia ao
   formatar. Isso é ótimo para datas, e **fatal para a Frente V**, cujo produto é justamente a hora
   ("recebeu às 18:09"). **Não escreva o parser antes do probe.** Se a hora não sobreviver, o
   escopo muda e precisa ser renegociado — não invente precisão que o dado não tem.
2. **Não cresça o legado Express nem pule os ports.** A Frente IV pagou para descobrir que módulos
   acoplados travam o desenvolvimento paralelo — daí `ports.ts` e o container por frente
   (`frente-iv-arquitetura-modular.md`). Uma fatia que importe a implementação de outra em vez do
   port destrói o paralelismo das três sessões da Onda 2.
3. **Não use `$1` posicional no SQL.** O `PostgreeDatabaseClient` usa parâmetros **nomeados**
   (§6.2). Seguir a letra do CLAUDE.md aqui gera código que não roda.
4. **Não rode migrations dentro de handler de rota** (`appContainer.ts:19-26`).
5. **Não reimplemente filtro/paginação de tabela** — `@/app/permutas/components/tabela-filtro` já
   existe e é usado por duas frentes.
6. **Não confie no `MAX_PAGES` silenciosamente.** Ele corta em 25k linhas por filtro **sem lançar
   exceção** (`ConexosBaseClient.ts:113`). Se a varredura da Frente V bater no teto, o painel mostra
   dados incompletos parecendo completos. O job precisa detectar e logar isso explicitamente.
