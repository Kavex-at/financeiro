# Backlog de melhorias — varredura do repositório (2026-09-02)

> **O que é isto.** Uma varredura transversal do `financeiro` procurando o que melhorar em
> **robustez**, **UX/UI** e **dívida de plataforma**. Não é um Regis-Review (não roda os 8 QA
> agents) e não substitui os `*-regis-followups.md` já existentes — pelo contrário: a §5 faz o
> roll-up deles, porque hoje há **mais de 200 follow-ups P1/P2/P3** espalhados por **35 arquivos** do
> `_inbox` sem uma ordem única.
>
> **Todo item foi verificado no código em 2026-09-02**, não copiado de nota antiga. Onde a
> evidência é um `arquivo:linha`, ela foi lida.
>
> Base: `main` @ `47c48f8` (v0.34.0). Backend 422 arquivos `.ts` (285 fora de teste), frontend 89 `.tsx`,
> 163 arquivos de teste (137 backend / 26 frontend), 54 migrations, 44 ADRs.

---

## Sumário — o que eu levaria primeiro

| # | Item | Categoria | Esforço |
|---|------|-----------|---------|
| 1 | Fixture de permutas serve dado falso quando o backend cai **ou responde vazio** | P0 · confiança | S |
| 2 | `numOpt` coage `null → 0` e faz `prontoParaRemessa` ser sempre `true` | P0 · correção | S |
| 3 | Crons de produção rodam Node 22; CI testa em Node 24 | P1 · robustez | S |
| 4 | `apiFetch` sem timeout e sem `AbortSignal` — 0 `AbortController` no frontend | P1 · robustez | M |
| 10 | `TableHead` não emite `scope="col"` — 0 ocorrências no app inteiro | UX · a11y | XS |

Os três primeiros são baratos e desproporcionalmente valiosos. O #1 é o único que eu trataria
como incidente.

---

## 1. P0 — corrigir antes de tudo

### 1.1 O fixture de Gestão de Permutas serve dado falso, sem sinalizar

**Evidência:** `src/frontend/lib/api.ts:65-94`.

```ts
if (!json?.pendentes?.length && !json?.invoicesEmAberto?.length) {
  return gestaoPermutasFixture      // ← backend OK, resposta legitimamente vazia
}
…
} catch {
  return gestaoPermutasFixture      // ← backend caiu, 500, timeout, rede
}
```

`gestaoPermutasFixture` (`lib/permutas-fixture.ts`, 227 linhas) são **dados reais sondados**,
com valores em USD e nomes de clientes. Ele foi introduzido como rede de segurança de demo — o
comentário no código diz isso com todas as letras — mas continua ligado em produção.

Duas consequências, e a segunda é pior que a primeira:

1. **Backend fora → a analista vê uma carteira de permutas plausível e obsoleta.** Nada na tela
   diz que aquilo não é o banco.
2. **Backend no ar e a carteira genuinamente vazia → o fixture também entra.** "Zero pendentes"
   é um estado *correto e desejável* do domínio; hoje ele é indistinguível de falha, e é
   substituído por linhas fantasma. Este é o caminho que dispara no dia a dia, não o outro.

O tipo já carrega o discriminador — `fonte: 'banco' | 'fixture'` (`lib/types.ts:236`) — e o
fixture se identifica corretamente (`permutas-fixture.ts:17`). **Mas nenhuma tela lê esse
campo**: `grep -rn "fonte" src/frontend/app/**/*.tsx` não retorna um único uso na página de
permutas. O sinal existe e é jogado fora.

**Correção sugerida:**
- Remover o fallback do caminho de produção; deixá-lo atrás de `NEXT_PUBLIC_DEMO_MODE` ou de um
  fixture de Storybook/teste.
- Enquanto existir, **renderizar `fonte === 'fixture'`** como banner destrutivo persistente
  ("dados de demonstração — o backend não respondeu"), não como toast dispensável.
- Separar os dois ramos: resposta vazia legítima → `EmptyState` (o componente já existe,
  `components/ui/empty-state.tsx`); erro/timeout → estado de erro com retry.

**Por que P0:** é um sistema financeiro onde a analista decide baixa de adiantamento. A regra
implícita de um painel é "o que está na tela é o que está no banco". Este é o único ponto do
repositório que quebra essa regra em silêncio.

---

### 1.2 `numOpt` coage `null → 0` e `prontoParaRemessa` é sempre `true`

**Evidência:** `src/backend/domain/client/ConexosSispagClient.ts:32` e `:173`.

```ts
const numOpt = z.coerce.number().optional().catch(undefined);   // :32
…
const temModalidade = r.itsVldModalidade !== undefined;
prontoParaRemessa: temBoleto || temPix || temContaBanco || temModalidade,   // :173
```

O ERP manda `itsVldModalidade: null`. `z.coerce.number()` faz `Number(null) → 0`, que é número
válido, então o `.optional()` nunca dispara: o campo chega como `0`, **nunca** como `undefined`.
Logo `temModalidade` é sempre verdadeiro e `prontoParaRemessa` é sempre `true`.

No mesmo mapper, `temBoleto` está fixado em `false` de propósito (`:148`, o `fin064` não sabe de
boleto) e `temContaBanco` idem. Ou seja: **o único termo que decide o booleano é o quebrado.**

**Impacto na tela:** o aviso "Pode faltar cadastro de pagamento" (`src/frontend/app/sispag/page.tsx:749`,
dispara em `prontoParaRemessa === false`) **nunca aparece**. A analista monta o lote, define
modalidade, finaliza — e o problema só aparece na geração da remessa, que é exatamente o ponto
em que o lote nativo no `fin015` já foi criado.

**A correção já existe no repositório, em outro client.** `ConexosExtratoClient.ts:32` define o
mesmo `numOpt` via `z.preprocess`, que trata `null` corretamente. É copiar o padrão provado.

Alternativa mínima: `const temModalidade = r.itsVldModalidade != null` (`!=` solto, pega `null` e
`undefined`).

**Item irmão (§2.4):** auditar os outros campos. Há **121 ocorrências de `z.coerce.number()`** no
backend fora de testes. Nem todas recebem `null` do ERP, mas nenhuma está protegida.

*(Este achado está registrado em `sispag-remessa-ground-truth-followups.md:226` como "BUG P1
achado no caminho". Confirmei em 2026-09-02 que continua aberto no código. Estou promovendo a P0
porque ele desliga uma trava de segurança da tela, e não apenas exibe algo errado.)*

---

## 2. P1 — robustez

### 2.1 Os crons de produção rodam Node 22; o CI valida em Node 24

**Evidência:** `.tool-versions` → `nodejs 24.0.1`. `.github/workflows/ci.yml` → `node-version: '24'`
(backend e frontend). Os **seis** workflows de cron — `detect-staleness`, `ingest-extratos`,
`ingest-permutas`, `ingest-sispag`, `reaper-sispag`, `reconciliar-nde` — todos com
`node-version: 22`.

Nenhum dos jobs que efetivamente escrevem no ERP e no Postgres roda no runtime que o CI testa.
A diferença 22→24 muda comportamento observável (undici/fetch, `structuredClone`, resolução de
ESM, timers). É a classe de drift que não produz erro nenhum até produzir um só, em produção, às
3h da manhã, num job que ninguém está olhando.

**Correção:** alinhar os seis para `24`, ou extrair `node-version` para um único lugar. Barato
e mecânico. Combina com o item §4.2.

### 2.2 `apiFetch` não tem timeout nem cancelamento

**Evidência:** `src/frontend/lib/http.ts:28-35` — o wrapper inteiro é `fetch` + tratamento de 401.
Sem `signal`, sem `AbortController`, sem timeout, sem retry.

`grep -rn 'AbortController' src/frontend` → **0 ocorrências**.

Consequências concretas neste app:
- Uma leitura lenta do Conexos (que acontece: o ERP limita sessões, `LOGIN_ERROR_MAX_SESSIONS ~3`)
  deixa a aba pendurada indefinidamente, sem caminho de saída além do F5.
- A analista trocando de filial dispara N requisições concorrentes cujas respostas chegam fora de
  ordem — a última a chegar vence, não a última pedida. Com 24 `useState` em
  `app/permutas/page.tsx` e nenhum guard de sequência, o estado exibido pode ser de um filtro que
  já não está selecionado.
- Navegar para fora da página não cancela nada; o servidor continua trabalhando pela resposta que
  ninguém vai ler. (Já registrado como F2 em `recebimentos-ux-loading-modal-regis-followups.md`.)

**Correção:** `AbortSignal.timeout(n)` no `apiFetch` + um `AbortController` por efeito nas
páginas. Isto é o passo 1; o passo 2 é o §3.3 (TanStack Query), que resolve a mesma classe de
problema estruturalmente.

### 2.3 O App Router não tem nenhum error boundary

**Evidência:** `find src/frontend/app -name 'error.tsx' -o -name 'global-error.tsx' -o -name 'loading.tsx'`
→ **0 arquivos**.

Uma exceção de render em qualquer lugar — um `.toFixed()` num `null` vindo do ERP, um `.map()`
num campo que o Conexos deixou de mandar — derruba a árvore inteira para tela branca. Sem
`error.tsx`, o Next não tem onde se segurar, e o usuário não recebe nem mensagem nem botão de
recarregar.

Isso é especialmente relevante aqui porque os dados vêm de um ERP cujo contrato **muda sem aviso**
— o repositório está cheio de comentários documentando exatamente isso.

**Correção:** um `app/error.tsx` (reset + telemetria) e um `app/global-error.tsx`. Opcionalmente
`error.tsx` por rota, para que uma falha em `/sispag` não leve `/permutas` junto. Baixo esforço,
alto retorno.

### 2.4 Auditar os 121 `z.coerce.number()` do backend

Consequência direta de §1.2. `z.coerce.number()` transforma `null → 0`, `'' → 0`, `false → 0`,
`[] → 0`. Em cliente de ERP que devolve `null` para "não preenchido", isso converte silenciosamente
ausência-de-dado em zero-válido. Num domínio financeiro, zero não é um valor neutro.

**Correção:** um helper único (`numOpt`/`numReq`) baseado no `z.preprocess` que o
`ConexosExtratoClient` já usa, e substituição mecânica. Um teste de mesa (`null`, `''`, `'0'`,
`0`, `undefined`) fixa o contrato para sempre.

### 2.5 16 rotas resolvem `Repository` diretamente, sem `Service`

**Evidência:** `grep 'container.resolve(.*Repository' src/backend/routes/` → 16 sítios em
`operacao.ts` (2), `permutas.ts` (6), `sispag.ts` (3), `recebimentos.ts` (3).

A camada declarada no `CLAUDE.md` é `handler → Service → Repository → Client`. Onde a rota pula o
Service, a regra de negócio (ou a ausência dela) fica no handler HTTP, que é a camada mais difícil
de testar e a única que o `PatternGuardian` não protege. Já é follow-up P2 em
`painel-operacao-regis-followups.md:113`; a contagem mostra que não é um caso isolado, é um padrão.

**Correção:** não é um mutirão. É uma regra do `PatternGuardian` que barra *novos* casos, mais
migração proporcional em cada `/feature-tweak` que tocar a rota — exatamente a doutrina de
`migration-debt.md`.

### 2.6 `GET /operacao` é `Promise.all` — uma leitura lenta derruba o painel inteiro

**Evidência:** `src/backend/routes/operacao.ts:39-42`.

`Promise.all` é all-or-nothing: se `AlertaRepository.listarAbertos` falhar, o painel de saúde
inteiro responde erro — inclusive a parte de pipelines que estava perfeitamente disponível. É o
painel que a operação abre justamente **quando algo já está errado**, então é o pior momento para
ele ser tudo-ou-nada.

**Correção:** `Promise.allSettled` + renderizar por seção, com a seção que falhou mostrando seu
próprio estado de erro. O mesmo vale para `RecebimentosPainelService.ts:207` e `:281`.
(Registrado como P3 em `painel-operacao-regis-followups.md:141`; a meu ver é P1 — degradação
parcial é a propriedade central de um painel de incidente.)

### 2.7 `hidratarNdes` percorre as NDes sequencialmente

**Evidência:** `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:466`.

Latência linear no número de NDes, contra um ERP que já é o recurso escasso. Mais amplamente:
`grep 'for (const' -A3 src/backend/domain/service` mostra **17 laços com `await` dentro**.

**Correção:** não é "trocar tudo por `Promise.all`" — contra o Conexos isso queima os ~3 slots de
sessão. É um `Promise.all` **com limite de concorrência** (pool de 2–3), que é o teto real imposto
pelo ERP. Vale extrair um helper e usar nos 17 sítios.

---

## 3. UX / UI

### 3.1 `TableHead` não emite `scope="col"` — em nenhuma tabela do app

**Evidência:** `src/frontend/components/ui/table.tsx:31-33`. O componente renderiza `<th>` cru.
`grep -rn 'scope="col"' src/frontend` → **0 ocorrências** em todo o frontend.

Sem `scope`, um leitor de tela não associa célula a cabeçalho: numa tabela de títulos a pagar, a
analista ouve "1.250,00" sem ouvir "Valor". Como *todas* as tabelas passam por este componente
(`PermutaPendenteTable`, `VisaoGeralTable`, `NdeTable`, `FalhasTable`, os grids de `/sispag` e
`/recebimentos`), **uma linha de código conserta o app inteiro**:

```tsx
<th data-slot="table-head" scope="col" className={…} {...props} />
```

(`{...props}` depois de `scope` permite override pontual para `scope="row"`.)

O menor esforço com o maior alcance da lista. Já é follow-up P2 em
`painel-operacao-regis-followups.md:85`; segue aberto.

### 3.2 A tela não diz de quando é o dado

Cada painel é alimentado por crons de cadência diferente — extratos de hora em hora, permutas 3×/dia,
SISPAG 1×/dia. O `/operacao` sabe disso e calcula staleness na leitura (invariante I6, ADR-0042).
As telas de trabalho, não: a analista de `/permutas` não tem como saber, olhando, se está vendo a
ingestão das 06h ou uma carteira parada desde ontem.

**Proposta:** um chip discreto de frescor por painel — "atualizado há 40 min", vindo do
`geradoEm`/`ultimaIngestao` que o backend **já devolve** (`RecebimentosPainelService.ts:207`
retorna `ultimaIngestao`; `GestaoPermutasResponse` tem `geradoEm`). Amarelo passado o limite
daquele pipeline (a regra `staleness-por-pipeline` já existe e já tem os limites por cron).
Backend pronto; é trabalho de front.

Casa com §1.1: o mesmo chip é o lugar natural para "fonte: fixture".

### 3.3 Sem TanStack Query — busca de dados é manual em todas as páginas

**Evidência:** debt `F2` em `migration-debt.md`; confirmado — `grep tanstack src/frontend/package.json`
não retorna nada. Medida do custo: `app/permutas/page.tsx` tem **24 `useState`** e **0 `useEffect`**;
`app/sispag/page.tsx` tem 16 `useState`, e as quatro páginas principais somam ~56 estados manuais,
com "loading" aparecendo 15–20 vezes por arquivo.

Isso é o que produz, de graça, os problemas de §2.2 (sem cancelamento, sem dedup, sem guard de
sequência) e o que torna cada tela um lugar diferente para esquecer um estado de erro.

**Ganho:** cancelamento e dedup automáticos, `staleTime` (que dá o §3.2 quase de brinde),
revalidação em foco, retry com backoff, e invalidação declarativa depois de mutação — hoje feita
à mão, tela a tela.

**Esforço:** M/L, e não precisa ser big-bang: adotar por página, começando por `/operacao` (376
linhas, a menor) para provar o padrão, depois `/recebimentos` e `/permutas`.

### 3.4 Sem validação Zod no boundary do frontend

O backend valida rigorosamente o que vem do ERP; o frontend confia cegamente no que vem do
backend. `zod` **já está no `package.json` do frontend** (`^4.4.3`) — só não é usado no boundary.
Os tipos em `lib/types.ts` são espelhados à mão, e um `casamento-manual` renomeado no backend não
quebra o build do front: quebra a tela, em runtime, no cliente.

(Registrado como P3 em `painel-operacao-regis-followups.md:135` e como "contrato espelhado à mão"
em `permutas-casamento-manual-regis-followups.md:55`.)

**Correção:** schemas Zod em `lib/` para as ~8 respostas principais, parseando dentro do
`apiFetch`. Combina naturalmente com §3.3 (o `queryFn` é o ponto de parse).

### 3.5 Abas não são linkáveis

`/operacao`, `/permutas` e `/recebimentos` guardam a aba ativa em `useState`. A analista não
consegue mandar "olha a aba de Falhas" para um colega, o botão Voltar não volta, e o F5 devolve
para a primeira aba — o que é irritante justamente durante um incidente, que é quando se recarrega
mais.

**Correção:** aba no query param (`?tab=falhas`) via `useSearchParams`/`router.replace`. Pequeno,
por página. (P3 em `painel-operacao-regis-followups.md:130`.)

### 3.6 Paginação é toda client-side

Existe `tabela-filtro.tsx` com `pagina`/`paginaAtual`, mas o recorte é feito **depois** de o
payload inteiro chegar. Com carteiras da ordem de 2.000 títulos (a sondagem do `fin064` mediu 2.000,
o grid de pendentes do `fin015` 2.173), a tela baixa e renderiza tudo para mostrar 20 linhas.

**Correção:** `limit`/`offset` nas rotas de listagem, com contagem total. Nota: o repositório já
tem 64 `CREATE INDEX` nas migrations, então o suporte de banco provavelmente já está lá —
verificar antes de assumir trabalho de schema.

### 3.7 Estado vazio × estado de erro não se distinguem

Fora do `EmptyState` (que existe e é bom), o padrão dominante é uma tabela vazia servir para os
dois casos. "Nenhum título pronto para remessa" e "não consegui falar com o ERP" são a mesma tela
— e levam a decisões opostas.

**Correção:** convenção de três estados (`carregando` / `vazio` / `erro-com-retry`) aplicada às
tabelas principais. É o irmão de UI do §2.6.

---

## 4. Plataforma e dívida

### 4.1 Dois ADRs com o número 0036

`ontology/decisions/0036-descricao-item-nde-no-documento.md` e
`ontology/decisions/0036-homologacao-da-nde-medida-pelo-estado-gravado.md`.

44 ADRs, uma colisão. Referências cruzadas do tipo "ver ADR-0036" ficam ambíguas para sempre.
Renumerar o mais recente para `0045` (e corrigir as referências) enquanto ainda são poucas. XS.

### 4.2 Os 6 workflows de cron repetem o mesmo preâmbulo

`checkout` → `setup-node` → `npm ci --include=dev` → `npm run migrate` → job → passo de alerta,
copiado seis vezes, com o mesmo bloco de `env` de segredos do Conexos. Foi assim que o drift de
Node do §2.1 conseguiu existir em seis lugares ao mesmo tempo.

**Correção:** uma composite action (`.github/actions/setup-financeiro/`) com o preâmbulo. Cada
workflow fica com o que é dele: o cron, o timeout e o `npm run job:*`. Resolve §2.1 na raiz.

### 4.3 O frontend está em 20% de cobertura; o backend em 72%

**Evidência:** `src/frontend/jest.config.js:35` → `lines: 20, branches: 9, functions: 14`.
`src/backend/jest.config.cjs:34` → `lines: 72, branches: 54, functions: 78`. Contagem: 137
arquivos de teste no backend, 26 no frontend para 89 `.tsx`.

Os pisos estão calibrados logo abaixo do real, o que é a decisão certa (CI verde, regressão
travada) e está documentado honestamente no próprio config. Mas o efeito líquido é que **a camada
que a analista toca para movimentar dinheiro é a menos testada**, e vários follow-ups P2/P3 do
inbox são literalmente "sem teste de UI para X".

**Correção:** não é uma força-tarefa de cobertura. É escolher os ~6 componentes que decidem
dinheiro — `LoteCard`, `AlocarProcessosDialog`, `ReconciliarDialog`, `status-badges`,
`VisaoGeralTable`, `ImportarExtratoDialog` — e cobrir os caminhos de decisão deles, subindo o piso
a cada leva.

### 4.4 30 `console.log` fora de jobs e testes

O `LogService` existe, é `@singleton()` e propaga metadata. Trinta chamadas em `src/backend` fora
de `jobs/` e de testes escapam dele — não têm correlation id e não aparecem em nenhuma agregação.
(Em `jobs/` o `console.log` é legítimo e não entra nesta conta.)

### 4.5 Arquivos que passaram do ponto

`RecebimentoNumerarioService.ts` com **2.415 linhas**; `ConexosGerDocProcessoClient.ts` 1.291;
`RemessaService.ts` 1.028; `routes/recebimentos.ts` 984; `app/sispag/page.tsx` 1.068;
`app/permutas/page.tsx` 1.041.

Não é para quebrar por quebrar — o `RecebimentoNumerarioService` é a orquestração mais densa do
domínio e partir por linha não ajudaria ninguém. Vale como gatilho: a próxima feature que tocar
qualquer um deles extrai a fatia que ela usa, em vez de acrescentar mais 200 linhas. É a doutrina
de migração proporcional aplicada a tamanho.

---

## 5. Roll-up do `_inbox` — o backlog que já existe e não tem ordem

35 arquivos `*-followups.md` acumulam **mais de 200 cards P1/P2/P3** (300 menções de prioridade ao todo: 103 P1, 96 P2, 101 P3). Alguns já foram implementados e
continuam marcados como abertos (o `painel-operacao` tem dois P1 riscados com "IMPLEMENTADO
2026-09-01"); outros estão abertos e são mais graves que o rótulo sugere (o `prontoParaRemessa`
acima estava enterrado como "BUG P1 achado no caminho" no meio de um documento de ground truth).

**Os quatro maiores acúmulos:**

| Arquivo | Cards abertos | Nota |
|---|---|---|
| `recebimentos-alocar-sn-regis-followups.md` | 14 P1 + 24 P2 + 9 P3 | Tem um bloco **"Must-fix-before-wire-real"** que bloqueia qualquer PR que remova o `NotImplementedError` de `enviarAoErp`. É o mais consequente do inbox. |
| `sispag-retomada-regis-followups.md` | 21 P1 + 21 P2 + 4 P3 | |
| `permutas-painel-elegiveis-regis-followups.md` | 18 P1 + 14 P2 + 6 P3 | Espalhado por 3 runs diferentes no mesmo arquivo. |
| `sispag-boleto-dda-regis-followups.md` | 17 P2 + 7 P3 | Os P1 foram todos implementados na própria branch. |

**Tarefa proposta (S, alto retorno):** um `/retro-ontology` focado em varrer os 35 arquivos e
produzir **um** `_inbox/BACKLOG.md` único — card, arquivo de origem, prioridade e **estado
verificado no código**. Sem isso, o custo de descobrir o que está aberto já é maior que o custo de
consertar vários dos itens.

Dois itens do inbox que merecem promoção imediata por serem **decisões travadas em pessoa**, não
trabalho de código:

- `recebimentos-status-writers-followups.md:10` — "**P0 — pendente de ação do Yuri**: medir o
  backfill antes de aplicar". Está parado aguardando decisão.
- `sn-titulo-condicao-fail-closed-regis-followups.md:16` — "Decisões pendentes do Yuri".

---

## 6. O que está bom (para não mexer)

Registrado porque uma lista só de problemas distorce a leitura, e porque várias dessas coisas são
o motivo de a lista acima ser curta:

- **A camada de operação (ADR-0042) é sólida.** Dead-man's switch externo implementado, staleness
  computado na leitura, passo de alerta em todo cron, reaper com trilha própria. Os dois pontos
  cegos restantes estão **nomeados e aceitos** por escrito — o que é a forma madura de ter um
  ponto cego.
- **A disciplina de comentário-com-evidência é excepcional.** Comentários que dizem *o que foi
  medido, quando, em qual ambiente e com quantas linhas* ("mediu 0% de preenchimento em PRD, no
  `fin064` com 2000 títulos"). Metade desta varredura foi possível por causa disso.
- **CI com `npm audit --audit-level=high`**, typecheck, lint, testes com piso de cobertura e build.
- **Migrations idempotentes rodando no boot e em cada cron** — ambiente novo sobe sozinho.
- **Guard-rails de escrita** (`CONEXOS_WRITE_ENABLED` + `CONEXOS_DRY_RUN`, default dry-run) e
  freios de incidente por feature. Para um sistema que baixa título em ERP alheio, é a decisão
  certa.
- **ADR-0042 corrigindo o `CLAUDE.md` para admitir logs em português** em vez de normalizar 39
  sítios: reconhecer que uma regra violada por 40% do código não é regra é raro e correto.

---

## Ordem sugerida

1. **§1.1** fixture (incidente) · **§1.2** `numOpt` · **§3.1** `scope="col"` — os três somam
   pouquíssimo código e cada um fecha um buraco de classe diferente.
2. **§2.1** Node 22→24 + **§4.2** composite action — mesma mexida, resolve na raiz.
3. **§2.3** error boundary · **§2.2** timeout/abort — a rede de segurança do frontend.
4. **§5** consolidar o `BACKLOG.md` único — depois disto, priorizar fica barato.
5. **§3.3** TanStack Query por página, começando por `/operacao` — destrava §2.2, §3.2 e §3.4.
6. **§2.4** auditoria dos `z.coerce.number()` — sistematiza o conserto do §1.2.
