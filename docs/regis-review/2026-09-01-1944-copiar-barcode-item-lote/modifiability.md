---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-01-1944
agent: qa-modifiability
generated_at: 2026-09-01T16:47:51-03:00
scope: backend+frontend (delta)
score: 7
findings_count: 5
cards_count: 5
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista financeira (produto) | "quero ver a linha digitável de cada boleto do item no card do lote" | `ConexosSispagWriteClient` + `SispagPainelService` + `routes/sispag.ts` + `LoteCard.tsx` + `frontend/lib/sispag.ts` | Feature branch em dev, código verde, gate PatternGuardian já rodado | Adicionar caminho vertical read-only (client → service → route → hook → botão) sem tocar máquina de estado do lote nem ripple de tipos além do necessário | Delta ≤ 400 inserções, 0 novas violações de camada, 0 novos warnings Biome, ≤ 1 nova dependência injetada em serviço existente, tipo de boundary DTO único |

Delta real: 396 inserções em 9 arquivos, 0 violações de camada, 0 warnings Biome, +1 dependência injetada em `SispagPainelService`, DTO `{ docCod; titCod; linhaDigitavel }` **duplicado inline em 5 pontos de 3 arquivos** — passa em 4/5 medidas, falha em 1.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC delta (inserções) | 396 | ≤ 400 (feature de UI) | ✅ | `git diff main --stat` |
| Arquivos tocados | 9 (4 test + 5 prod) | ≤ 10 | ✅ | idem |
| Biome warnings nos arquivos do delta | 0 | 0 | ✅ | `npx biome check src/backend/domain/client/ConexosSispagWriteClient.ts src/backend/domain/service/sispag/SispagPainelService.ts src/backend/routes/sispag.ts src/frontend/app/sispag/components/LoteCard.tsx src/frontend/lib/sispag.ts` |
| Novos warnings `noExcessiveCognitiveComplexity` | 0 | 0 | ✅ | idem |
| Ciclomática aprox. do método novo (`listarLinhasDigitaveisDoLote`) | 5 (try/catch + `for-of` + `if !parsed` + `??`) | ≤ 10 | ✅ | leitura manual `ConexosSispagWriteClient.ts:402-439` |
| Ciclomática aprox. do método novo (`linhasDigitaveisDoLote`) | 6 (2 early returns + try/catch + `??` + fallback vazio) | ≤ 10 | ✅ | leitura manual `SispagPainelService.ts:239-263` |
| Tamanho pós-delta `ConexosSispagWriteClient.ts` | 905 (era 834, +71) | p95 ≤ 400; P0 split > 1000 | ⚠️ | `wc -l` + `git show main:…` |
| Tamanho pós-delta `SispagPainelService.ts` | 429 (era 388, +41) | p95 ≤ 400 | ⚠️ | idem |
| Tamanho pós-delta `LoteCard.tsx` | 557 (era 503, +54) | p95 ≤ 400 (frontend tolera até 600) | ⚠️ | idem |
| Tamanho pós-delta `routes/sispag.ts` | 566 (era 547, +19) | p95 ≤ 400 | ⚠️ | idem |
| Dependências injetadas em `SispagPainelService` | 12 (era 11, +1: `ConexosSispagWriteClient`) | ≤ 10 (regra de bolso — 12+ = split candidate) | ⚠️ | `grep -c '@inject' SispagPainelService.ts` |
| Clientes Conexos no construtor do `SispagPainelService` | 4 (`Sispag`, `SispagRetorno`, `SispagWrite`, `Base`) | ≤ 3 | ⚠️ | leitura `SispagPainelService.ts:60-77` |
| Duplicação inline do DTO `{ docCod; titCod; linhaDigitavel }` | 5 ocorrências em 3 arquivos | 1 tipo nomeado compartilhado | ❌ | `grep -rn 'docCod.*titCod.*linhaDigitavel'` |
| Magic number no método novo (`pageSize: 500`) | 1 | 0 (extrair p/ constante ou EnvironmentProvider) | ⚠️ | `ConexosSispagWriteClient.ts:419` |
| Cross-layer violations introduzidas | 0 | 0 | ✅ | leitura dos 5 arquivos prod |
| Cyclic deps introduzidas | 0 | 0 | ✅ | inspeção manual do grafo (client → base; service → client; route → service) |
| Fan-in `SispagPainelService` (pós-delta) | 4 (`RecebimentosPainelService`, `routes/sispag.ts`, `jobs/probe-sispag-painel.ts`, ele mesmo) | — (informativo) | ℹ️ | `grep -rln SispagPainelService src/backend --include='*.ts' \| grep -v .test.` |
| Fan-in `ConexosSispagWriteClient` (pós-delta) | 11 (3 services + 8 jobs) | — (informativo) | ℹ️ | idem |
| Cobertura ontológica do delta | ⚠️ **Não medível localmente**: `linhas-digitaveis` é caminho de leitura sem entidade nova; `_index.json`/`_coverage.json` não referenciam. Recomendação: registrar como *view* auxiliar do `LoteSispag` no próximo `/retro-ontology`. | — | ⚠️ | `ontology/_index.json` |

### Apêndice A — Top-10 maiores arquivos fonte (pós-delta, sem `*.test.ts`)

| LOC | Arquivo |
|---|---|
| 2415 | `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` |
| 1291 | `src/backend/domain/client/ConexosGerDocProcessoClient.ts` |
| 1068 | `src/frontend/app/sispag/page.tsx` |
| 1065 | `src/frontend/lib/recebimentos.ts` |
| 1041 | `src/frontend/app/permutas/page.tsx` |
| 1028 | `src/backend/domain/service/sispag/RemessaService.ts` |
| **905** | **`src/backend/domain/client/ConexosSispagWriteClient.ts`** *(tocado pelo delta: +71)* |
| 984 | `src/backend/routes/recebimentos.ts` |
| 974 | `src/backend/domain/service/permutas/EleicaoPermutasService.ts` |
| 928 | `src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx` |

O delta empurra `ConexosSispagWriteClient` mais fundo na cauda longa (7º maior arquivo), sem atravessar 1000 LOC (limiar P0 de split). Fora do escopo `--quick`.

### Apêndice B — Fan-in dos serviços tocados/vizinhos no delta

| Fan-in | Serviço |
|---|---|
| 11 | `ConexosSispagWriteClient` *(delta agora inclui `SispagPainelService`)* |
| 4  | `SispagPainelService` *(delta não muda; consumidores: route + probe + `RecebimentosPainelService`)* |

Cross-QA (informativo para o consolidator): as duas maiores superfícies do SISPAG (`RemessaService` 1028 LOC; `RecebimentoNumerarioService` 2415 LOC) permanecem candidatas P1 a **Split Module**, mas fora do escopo `--quick`.

## 3. Tactics — Cobertura no nf-projects

Escopo `--quick`: só as tactics que o delta exercita ou deveria exercitar. As demais não são avaliadas.

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | O delta preserva as camadas DDD sem inchar demais nenhum arquivo isolado, mas concentra 5 pontos de mudança para um único DTO na `Frente II — SISPAG`. `LoteCard.tsx` já tem 4 pares `useState`/`useEffect` para blocos de "expansão fetch" — sinal de que o componente é dois: header do lote + tabela expandida. | ⚠️ parcial | `wc -l` (ver métricas); `grep -c 'useEffect\|useState' LoteCard.tsx` = 7 |
| Increase Semantic Coherence | `ConexosSispagWriteClient` foi nomeado "Write" mas expõe 7 métodos `listar*/get*` (leitura) e 6 métodos `criar*/importar*/gerar*/finalizar*` (escrita). O delta **adiciona mais uma leitura** ao mesmo arquivo. É débito **preexistente**, mas o delta reforça a "mentira do nome" — `SispagPainelService`, que é read-only, agora depende de um client cujo nome afirma o contrário. | ❌ ausente | `grep -n '^\s*public ' src/backend/domain/client/ConexosSispagWriteClient.ts` (14 assinaturas; 7 read, 6 write, 1 protected `constructor`) |
| Encapsulate | O DTO `{ docCod: string; titCod: string; linhaDigitavel: string }` está inline em **5 lugares de 3 arquivos** (2× no client, 1× no service, 2× na `frontend/lib/sispag.ts`). Já flagado pelo PatternGuardian como **P2 aceito como dívida** — confirmado. Mudar o formato exige tocar 3 arquivos, e o TS não força o alinhamento (structural typing). | ❌ ausente | `grep -rn 'docCod.*titCod.*linhaDigitavel' src/{backend,frontend} --include='*.ts' --include='*.tsx' \| grep -v .test.` |
| Use an Intermediary | Cadeia certa: `LoteCard` → `frontend/lib/sispag.ts::fetchLinhasDigitaveis` → `routes/sispag.ts` → `SispagPainelService.linhasDigitaveisDoLote` → `ConexosSispagWriteClient.listarLinhasDigitaveisDoLote` → `ConexosBaseClient.listGenericPaginated`. Cinco camadas, cada uma com responsabilidade nítida. | ✅ presente | `git diff main` do path completo |
| Restrict Dependencies | Sem violações novas de camada. Route resolve o service via `container.resolve`, e o service resolve o client via `@inject` — canônico. | ✅ presente | `git diff main -- src/backend/routes/sispag.ts` |
| Refactor | O padrão "expand → fetch → set Map keyed by `docCod:titCod`" agora aparece **duas vezes** em `LoteCard.tsx` (contas pagadoras + linhas digitáveis) com a mesma forma: `useEffect` guardando `!aberto || isRascunho`, `let vivo = true`, `fetch → setState`, `catch → setState vazio`. Candidato a `useSispagAsyncMap(loteId, aberto, fetcher)` — hook customizado. | ⚠️ parcial | `LoteCard.tsx:150-172` vs `LoteCard.tsx:113-149` (ver `git diff main` completo) |
| Abstract Common Services | O `runWithRetry` + `ensureSid` + `listGenericPaginated` no `ConexosBaseClient` é reutilizado corretamente. A chave `${docCod}:${titCod}` já aparece **hardcoded em 3 lugares** (client, service, LoteCard). Vale uma helper `chaveTitulo({ docCod, titCod })` colocada com o DTO extraído. | ⚠️ parcial | `LoteCard.tsx:164`, `LoteCard.tsx:462,476` |
| Defer Binding — polymorphism / DI | tsyringe usado como sempre. O novo `linhasDigitaveisDoLote` é resolvido pelo `appContainer`. Sem mudança de binding time. | ✅ presente | `SispagPainelService.ts:60-77` |
| Defer Binding — configuration | `pageSize: 500` está hardcoded na nova chamada (`ConexosSispagWriteClient.ts:419`). O método vizinho `listarTitulosPendentes` documenta **exatamente esse anti-padrão** como defeito corrigido ("a versão anterior pedia `pageSize: 500` e fixava `pageNumber: 1`"). O delta reintroduz o mesmo antipadrão num método novo — mesmo que o volume esperado seja <100 itens/lote, é uma decisão de binding em tempo de escrita que deveria ser configuração. | ❌ ausente | `ConexosSispagWriteClient.ts:419` |

## 4. Findings (achados)

### F-modifiability-1: DTO da linha digitável duplicado inline em 5 pontos de 3 arquivos

- **Severidade**: P2
- **Tactic violada**: Encapsulate
- **Localização**:
  - `src/backend/domain/client/ConexosSispagWriteClient.ts:406` (assinatura de `listarLinhasDigitaveisDoLote`)
  - `src/backend/domain/client/ConexosSispagWriteClient.ts:424` (array local `itens`)
  - `src/backend/domain/service/sispag/SispagPainelService.ts:241` (assinatura de `linhasDigitaveisDoLote`)
  - `src/frontend/lib/sispag.ts:571` (retorno de `fetchLinhasDigitaveis`)
  - `src/frontend/lib/sispag.ts:577` (shape da resposta JSON)
- **Evidência**:
  ```
  $ grep -n 'docCod.*titCod.*linhaDigitavel\|linhaDigitavel.*docCod' src/{backend,frontend} -r \
      --include='*.ts' --include='*.tsx' | grep -v .test.
  src/backend/domain/client/ConexosSispagWriteClient.ts:406: …Promise<Array<{ docCod: string; titCod: string; linhaDigitavel: string }>>
  src/backend/domain/client/ConexosSispagWriteClient.ts:424: const itens: Array<{ docCod: string; titCod: string; linhaDigitavel: string }> = [];
  src/backend/domain/service/sispag/SispagPainelService.ts:241: ): Promise<Array<{ docCod: string; titCod: string; linhaDigitavel: string }>>
  src/frontend/lib/sispag.ts:571: ): Promise<Array<{ docCod: string; titCod: string; linhaDigitavel: string }>>
  src/frontend/lib/sispag.ts:577: itens: Array<{ docCod: string; titCod: string; linhaDigitavel: string }>
  ```
- **Impacto técnico**: renomear/estender o DTO (ex.: adicionar `bncCod` porque o boleto pode ser de outro banco, cenário `itsVldModalidade=7`) exige mudança coordenada em 5 pontos. TypeScript é *structural* — o compilador não obriga o alinhamento. Um dos 5 pontos ficar para trás resulta em silent bug (campo perdido no boundary HTTP).
- **Impacto de negócio**: baixo, mas cumulativo — cada campo novo em boleto que a analista precisar (código de barras de 44 dígitos, `bncCod` do emissor, valor confirmado) multiplicará o custo do próximo delta.
- **Métrica de baseline**: 5 ocorrências / 3 arquivos hoje; 1 tipo nomeado / 1 arquivo é o alvo. Já explicitamente aceito como dívida P2 pelo PatternGuardian — confirmado quantitativamente aqui.

### F-modifiability-2: `SispagPainelService` (read-only) depende de client chamado "Write"

- **Severidade**: P2
- **Tactic violada**: Increase Semantic Coherence
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:62` (novo `@inject(ConexosSispagWriteClient)`); `src/backend/domain/client/ConexosSispagWriteClient.ts` (nome do arquivo/classe).
- **Evidência**:
  ```
  # client "Write" — inventário dos 13 métodos public (a assinatura constructor sobra):
  public listarLotesNativos                # READ
  public getLoteNativo                     # READ
  public listarChavesDoLote                # READ
  public listarLinhasDigitaveisDoLote      # READ  (NOVO — delta)
  public listarTitulosPendentes            # READ
  public listarTitulosComBoletoDda         # READ
  public listarArquivosRemessa             # READ
  public criarLote                         # WRITE
  public importarTitulos                   # WRITE
  public sugerirRemessa                    # WRITE
  public finalizarLote                     # WRITE
  public gerarRemessa                      # WRITE
  public baixarRemessa                     # READ (baixa artefato produzido por escrita)
  # Soma: 8 read / 5 write. O nome "Write" não descreve o módulo.
  ```
- **Impacto técnico**: o débito é **preexistente** (não introduzido pelo delta); o delta é o quarto sintoma. Um `SispagPainelService` que é a superfície de LEITURA do painel agora carrega dependência estática para um símbolo chamado `Write` — leitor precisa parar e verificar se há efeito colateral. Aumenta o custo cognitivo de toda `/feature-tweak` futura sobre o painel.
- **Impacto de negócio**: nenhum imediato; é higiene para os próximos 6 meses (frente SISPAG concentra o maior volume de tweaks do repo — 8 dos últimos 10 commits são `fix(sispag)` ou `feat(sispag)`).
- **Métrica de baseline**: 4 clientes Conexos no construtor de `SispagPainelService`; regra de bolso pessoal ≤ 3.

### F-modifiability-3: `pageSize: 500` hardcoded no método novo — mesmo anti-padrão que o comentário vizinho documenta como corrigido

- **Severidade**: P3
- **Tactic violada**: Defer Binding (configuration)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:419`
- **Evidência**:
  ```typescript
  return this.base.listGenericPaginated<Record<string, unknown>>(
      path,
      {
          fieldList: [],
          filterList: {},
          serviceName: 'fin015',
          pageNumber: 1,   // fixo
          pageSize: 500,   // magic number
      },
      { filCod },
  );
  ```
  Contraste, 20 linhas depois no mesmo arquivo (método `listarTitulosPendentes`):
  > "PAGINA DE VERDADE. A versão anterior pedia `pageSize: 500` e fixava `pageNumber: 1`, [...]"
- **Impacto técnico**: lote com > 500 itens (raro mas possível — nenhuma invariante de domínio impede) devolve resposta truncada em silêncio. O comentário do próprio arquivo prescreve o padrão inverso.
- **Impacto de negócio**: baixo (lotes reais medidos em HML/PRD têm dezenas de itens; 500 é folga confortável), mas fica registrado como magic number em código que a analista usa para pagamento.
- **Métrica de baseline**: 1 magic number introduzido; padrão do arquivo é `paginação real via `listGenericPaginated`` sem pageSize hardcoded (ver `listarTitulosPendentes` no mesmo arquivo).

### F-modifiability-4: `LoteCard.tsx` — padrão "expand → fetch → set map por `docCod:titCod`" repetido 2x sem hook customizado

- **Severidade**: P3
- **Tactic violada**: Refactor + Abstract Common Services
- **Localização**: `src/frontend/app/sispag/components/LoteCard.tsx:113-149` (contas pagadoras) e `src/frontend/app/sispag/components/LoteCard.tsx:150-172` (linhas digitáveis).
- **Evidência**: o delta reproduz literalmente o padrão do bloco imediatamente acima (mesmas guardas `!aberto || isRascunho`, mesma flag `vivo`, mesmo `setState(new Map())` no catch, mesma chave `${docCod}:${titCod}`).
- **Impacto técnico**: LoteCard passou de 503 → 557 LOC (+10.7%). A cada nova coluna que exige fetch condicional à expansão (é o padrão do painel), o componente vai crescer no mesmo passo. Um `useSispagAsyncMap({ loteId, enabled, fetcher, key })` remove ~25 LOC por caso.
- **Impacto de negócio**: nenhum operacional. Impede o próximo `/feature-tweak` sobre o card de ser 20 LOC em vez de 45.
- **Métrica de baseline**: 2 blocos com a mesma forma hoje; 1 hook + 2 chamadas é o alvo. LoteCard 557 LOC (target frontend p95 ≤ 600).

### F-modifiability-5: `SispagPainelService` com 12 dependências injetadas — sinal de erosão da coesão

- **Severidade**: P3 (informativo — não bloqueia o delta)
- **Tactic violada**: Split Module / Increase Semantic Coherence
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:60-77`
- **Evidência**: 4 clientes Conexos + 5 repositórios + 3 libs = 12 `@inject`. 5 métodos públicos, dos quais 3 são "montar view do painel" (`montarPainel`, `linhasDigitaveisDoLote`, `modalidadesDisponiveisDoLote`) e 2 são utilitários (`listRetornos`). Cada método toca subconjunto disjunto de dependências.
- **Impacto técnico**: teste em isolamento fica caro (12 mocks); um `SispagPainelService.test.ts` já subiu 76 linhas no delta só para exercitar 1 método. Cada `feat` no painel expande a superfície do mesmo arquivo em vez de aparecer como classe nova.
- **Impacto de negócio**: nenhum agora. Sinal amarelo para revisitar em `/retro-ontology`: `SispagPainelService` provavelmente é 2 services (`SispagPainelReadService` + `SispagLoteDetalheService`).
- **Métrica de baseline**: 12 `@inject` (target de bolso ≤ 10); 4 clientes Conexos (target ≤ 3).

## 5. Cards Kanban

### [modifiability-1] Extrair `LinhaDigitavelItem` como DTO nomeado compartilhado

- **Problema**
  > O tipo `{ docCod: string; titCod: string; linhaDigitavel: string }` está inline em 5 pontos de 3 arquivos (client, service, frontend/lib). Qualquer campo novo (ex.: `bncCod` do banco emissor do boleto, cenário `itsVldModalidade=7`) exige 5 edições coordenadas sem que o TypeScript force o alinhamento. É débito P2 já reconhecido pelo PatternGuardian — este card só torna acionável.

- **Melhoria Proposta**
  > Criar `src/backend/domain/interface/sispag/LinhaDigitavelItem.ts` com `interface LinhaDigitavelItem { docCod: string; titCod: string; linhaDigitavel: string }`. Reutilizar em `ConexosSispagWriteClient.listarLinhasDigitaveisDoLote` (retorno + array local), em `SispagPainelService.linhasDigitaveisDoLote` (retorno) e em `frontend/lib/sispag.ts::fetchLinhasDigitaveis` (retorno + shape do JSON). Front pode duplicar o `interface` (fronteira HTTP não compartilha módulos com o backend) — mas em UM ponto, não dois. Aproveitar para adicionar helper `chaveTitulo({ docCod, titCod })` que substitui a template string `${docCod}:${titCod}` (hoje em 3 lugares do `LoteCard.tsx` e do backend). Tactic: **Encapsulate + Abstract Common Services**.

- **Resultado Esperado**
  > 1 tipo nomeado por lado (backend + frontend), 0 formas inline. Renomear/estender custa 2 edições em vez de 5. Métrica de duplicação inline: 5 → 0.

- **Tactic alvo**: Encapsulate
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Ocorrências inline do shape: 5 → 0
  - Arquivos que precisam mudar para adicionar `bncCod` ao DTO: 5 → 2
- **Risco de não fazer**: em 6 meses, quando a analista pedir "quero ver o banco emissor do boleto ao lado da linha digitável" (previsível — a Nexxera devolve isso no retorno), o custo do delta será 5 edições coordenadas, um dos 5 pontos ficará para trás, e o front vai renderizar `undefined`.
- **Dependências**: nenhuma.

### [modifiability-2] Renomear `ConexosSispagWriteClient` para `ConexosFin015Client` (ou dividir por CQRS)

- **Problema**
  > `ConexosSispagWriteClient` já era um nome errado (8 métodos de leitura / 5 de escrita). O delta adiciona a 8ª leitura e acopla `SispagPainelService` (read-only por definição) a um símbolo chamado "Write". A cada `/feature-tweak` do painel, o leitor precisa validar se há efeito colateral onde não há.

- **Melhoria Proposta**
  > Opção A (barata): renomear a classe/arquivo para `ConexosFin015Client` — reflete o endpoint real, sem prometer nem esconder efeito colateral. Ajustar imports (`grep -l ConexosSispagWriteClient` = 11 arquivos, majoritariamente `jobs/`). Opção B (mais profunda, deixar para próximo tweak): dividir em `Fin015ReadClient` e `Fin015WriteClient` seguindo CQRS, e fazer `SispagPainelService` depender só do Read. Recomendo A agora para não inflar o delta atual; abrir card separado para B se a próxima feature de painel piorar o coupling. Tactic: **Increase Semantic Coherence**.

- **Resultado Esperado**
  > Nome do módulo reflete o que ele faz (proxy do endpoint fin015 do ERP), não uma metade das operações. `grep 'Write' src/backend/domain/service/sispag/*.ts` deixa de retornar chamadas de leitura como falso positivo em revisões futuras.

- **Tactic alvo**: Increase Semantic Coherence
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — rename + import mass edit)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Clientes Conexos no construtor do `SispagPainelService` cujo nome contradiz o uso: 1 → 0
  - Instâncias de "Write" no path de leitura do painel: 1 → 0
- **Risco de não fazer**: o débito escala com cada nova leitura adicionada ao mesmo arquivo. Em 3 features é o próximo caso de PatternGuardian a bloquear a review "espere, esse client é de escrita, por que o service de leitura chama?".
- **Dependências**: nenhuma. Não conflita com [modifiability-1].

### [modifiability-3] Extrair `pageSize` para constante nomeada (ou parâmetro) em `listarLinhasDigitaveisDoLote`

- **Problema**
  > `pageSize: 500` está hardcoded no método novo. O método vizinho no MESMO arquivo (`listarTitulosPendentes`) documenta esse valor específico como defeito corrigido pela paginação de verdade. O delta reintroduz o antipadrão em código novo.

- **Melhoria Proposta**
  > Extrair constante `FIN015_LINHAS_PAGE_SIZE = 500` no topo do arquivo (colocada com o cabeçalho, ao lado dos schemas Zod já nomeados), com comentário justificando: "cap defensivo — lote com >500 itens é anômalo; se ocorrer, log de aviso". Alternativa mais robusta: chamar `listGenericPaginated` em modo paginado real (como faz `listarTitulosPendentes`) — custo maior, benefício raro. Recomendo constante nomeada + log de aviso quando `page.rows.length === 500`. Tactic: **Defer Binding**.

- **Resultado Esperado**
  > 0 magic numbers no arquivo tocado. Log dispara se o cap for atingido (evento observável antes do bug de "faltou linha na tela").

- **Tactic alvo**: Defer Binding (configuration)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Magic numbers no arquivo tocado: 1 → 0
  - Observabilidade quando o cap saturar: 0 → 1 log de warn
- **Risco de não fazer**: baixo em produção hoje, mas a próxima leitura do arquivo vai ler "a versão anterior pedia pageSize: 500" 20 linhas antes de um `pageSize: 500` novo — a ergonomia de manutenção despenca.
- **Dependências**: nenhuma.

### [modifiability-4] Extrair `useSispagAsyncMap` para consolidar o padrão "expand → fetch → set map" em `LoteCard.tsx`

- **Problema**
  > O bloco novo `[linhas, setLinhas]` + `useEffect(fetch → setState(new Map(items.map(...))))` reproduz literalmente o padrão do bloco `[contas, setContas]` 30 linhas acima. LoteCard passou de 503 → 557 LOC. A próxima coluna que precisar de fetch condicional à expansão vai repetir a mesma forma.

- **Melhoria Proposta**
  > Criar `src/frontend/app/sispag/hooks/useSispagAsyncMap.ts` com assinatura `useSispagAsyncMap<V>({ loteId, enabled, fetcher, key }): Map<string, V>`. Refatorar os 2 blocos existentes (contas pagadoras + linhas digitáveis). O hook encapsula o `let vivo = true`, o `catch → setState vazio`, e a construção do Map. Tactic: **Abstract Common Services + Refactor**.

- **Resultado Esperado**
  > `LoteCard.tsx` cai ~40 LOC. Próximo fetch condicional na expansão custa 3 linhas em vez de 20.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - LOC de `LoteCard.tsx`: 557 → ~517
  - Blocos duplicados `useEffect + Map` na expansão: 2 → 0 (substituídos por 2 chamadas ao hook)
- **Risco de não fazer**: o card vai passar a barreira de 600 LOC na próxima adição de coluna (previsível: `bncCod` do boleto, ou "valor confirmado pelo banco no retorno" — ambos já no radar).
- **Dependências**: [modifiability-1] pode acontecer antes ou depois. Independentes.

### [modifiability-5] Registrar débito de coesão do `SispagPainelService` para o próximo `/retro-ontology`

- **Problema**
  > `SispagPainelService` tem 12 `@inject` (4 clientes Conexos + 5 repositórios + 3 libs) e 5 métodos públicos, cada um tocando subconjunto disjunto das dependências. É o padrão "God Service" começando. O delta adiciona 1 dep e 1 método — sozinho não justifica split, mas alimenta a curva.

- **Melhoria Proposta**
  > Não fazer nada no escopo desta feature. Registrar no `ontology/_inbox/copiar-barcode-item-lote-regis-followups.md` para que o próximo `/retro-ontology` decida se: (a) `SispagPainelService` vira `SispagPainelReadService` (`montarPainel`, `listRetornos`) + `SispagLoteDetalheService` (`linhasDigitaveisDoLote`, `modalidadesDisponiveisDoLote`), OU (b) as leituras de detalhe do lote migram para um `LoteSispagQueryService` novo. Tactic: **Split Module + Increase Semantic Coherence**.

- **Resultado Esperado**
  > Débito visível no inbox. Não vai apodrecer no dark side: o `/retro-ontology` semanal vai revisitar.

- **Tactic alvo**: Split Module
- **Severidade**: P3
- **Esforço estimado**: S (só o registro; o split em si é M-L, escopo do próximo retro)
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - Item no `_inbox/` referenciando o serviço: 0 → 1
  - Decisão registrada em `/retro-ontology` sobre split vs. status quo: 0 → 1
- **Risco de não fazer**: acumulação silenciosa. Os próximos 3 tweaks do painel vão empurrar `SispagPainelService` para 15+ deps sem gatilho de revisão.
- **Dependências**: nenhuma.

## 6. Notas do agente

Cross-QA para o `qa-consolidator`:
- **[modifiability-1] (Encapsulate DTO)** cruza com **Integrability**: o mesmo DTO é boundary HTTP; a duplicação inline aumenta a probabilidade de drift entre schema Zod (`LINHA_DIGITAVEL_SCHEMA`) e o shape do JSON entregue ao front.
- **[modifiability-3] (magic pageSize)** cruza com **Deployability**: `pageSize: 500` hoje = redeploy para mudar. Se for movido para `EnvironmentProvider`, vira ajuste em runtime.
- **[modifiability-4] (useSispagAsyncMap)** cruza com **Testability**: o hook customizado é testável isoladamente com `@testing-library/react-hooks`; o padrão inline no componente exige montar o LoteCard inteiro.
- **[modifiability-5]** é sinal amarelo para próximas 2-3 features de painel — se o consolidator vir a mesma flag chegando de outros QAs, escalar para P2.
- Escopo `--quick`: não foram medidos fan-in global do repo, cyclic deps globais, coverage de teste, nem drift da ontologia — todos fora do escopo do delta. Ontologia não foi tocada nesta feature (leitura auxiliar de view, sem entidade nova).
