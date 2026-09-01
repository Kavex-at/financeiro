---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-01-1944
agent: qa-integrability
generated_at: 2026-09-01T19:44:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 4
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Fornecedor do ERP (Conexos) | Renomeia, remove ou muda o tipo do campo `itsNumCodbar` no grid `fin015/finItemSispag/list/{fil}/{bnc}/{flp}` | `ConexosSispagWriteClient.listarLinhasDigitaveisDoLote` + boundary `LINHA_DIGITAVEL_SCHEMA` + consumidor `SispagPainelService.linhasDigitaveisDoLote` | Produção, lote com remessa já gerada | Boundary Zod rejeita cada linha em silêncio; serviço captura e devolve `[]`; UI simplesmente não mostra o botão de copiar. Nenhum pagamento é executado errado (segue o princípio do ADR-0040). O risco NÃO é dinheiro no lugar errado — é ficar cego para a regressão. | Tempo até detecção de "campo silenciosamente vazio" **≤ 1 dia** (contract test `contrato.test.ts` deve falhar no CI antes de a analista notar que o botão sumiu). Hoje: **∞** — nada guarda o campo. |

Nota de escopo (`--quick`): o cenário só cobre a nova leitura `listarLinhasDigitaveisDoLote`. Regressões em outras integrações (Nexxera, GED, escrita de `fin010`) não estão no delta.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clientes novos criados neste delta | 0 (método adicionado a `ConexosSispagWriteClient`) | — | ✅ | `git diff main --stat` (`_shared-metrics.md`) |
| Métodos públicos novos com nome de domínio (não `get`/`request`) | 1/1 (`listarLinhasDigitaveisDoLote`) | 100% | ✅ | `src/backend/domain/client/ConexosSispagWriteClient.ts:402` |
| Fetch/axios diretos em service/route neste delta | 0 (tudo passa por `this.fin015.*`) | 0 | ✅ | `git diff main -- src/backend/domain/service src/backend/routes` |
| Boundary Zod na nova leitura | Presente, sem coerção, regex `/^\d{47}$/` | Presente | ✅ | `ConexosSispagWriteClient.ts:80-88` |
| Campo novo (`itsNumCodbar`) registrado em `contrato.test.ts` | **Não** (só `filCod`, `docCod`, `titCod`, `itsCodSeq`, `flpCod` estão listados para `fin015-item-lote`) | Sim | ❌ | `src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts:97-103` |
| Fixture com exemplo positivo de `itsNumCodbar` (47 dígitos) | Presente na chave, mas valor é `null` (redigido) — não exercita o regex | 1 exemplo válido | ⚠️ | `__fixtures__/2026-08-25-fin015-item-lote.json:21` |
| Testes do cliente exercitando o novo método (unit + fixture) | 5 casos unit (happy, filtro <47 dígitos, vazio, erro), 0 casos ancorados no fixture real | 1 caso ancorado em fixture | ⚠️ | `ConexosSispagWriteClient.test.ts:499-566` |
| Chamadas ao mesmo endpoint `fin015/finItemSispag/list/{fil}/{bnc}/{flp}` em pontos distintos do código | 2 (`listarChavesDoLote:363` e `listarLinhasDigitaveisDoLote:408`) | ≤1 (via serviço abstrato) OU 2 justificado por ciclo de vida distinto | ⚠️ | `grep -n "fin015/finItemSispag/list" src/backend/domain/client/ConexosSispagWriteClient.ts` |
| Endpoint com versão explícita na URL | 0 (Conexos não oferece versão) | N/A no delta | ⚠️ | `src/backend/domain/client/ConexosSispagWriteClient.ts:363,408` |
| Frontend: wrapper único (`apiFetch` + `withAuthHeaders`) usado pela nova chamada | Sim | Sim | ✅ | `src/frontend/lib/sispag.ts:572` |
| Guard de RBAC na rota nova (`requireRole('admin')`) | Presente | Presente | ✅ | `src/backend/routes/sispag.ts:66` |

> ⚠️ **Não medível localmente**: taxa de erro por dependência (`per-dependency error rate`) — não há painel de observabilidade neste repo (deploy Render, sem CloudWatch/Datadog). A observabilidade das falhas do `fin015` hoje se resume a `logService.warn(BUSINESS_WARN)` — sem série temporal, sem alarme. Instrumentar via logs estruturados + agregador (ex.: Logtail/Grafana Loki no Render) fora do escopo desta feature.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Método com nome de domínio (`listarLinhasDigitaveisDoLote`), nunca `get(path)`; serviço só sabe do método. | ✅ presente | `src/backend/domain/client/ConexosSispagWriteClient.ts:402`; `src/backend/domain/service/sispag/SispagPainelService.ts:247` |
| Use an Intermediary | `SispagPainelService.linhasDigitaveisDoLote` é a única porta entre a rota e o cliente; encapsula a decisão "em rascunho não chama ERP" e o downgrade para `[]` em erro. | ✅ presente | `SispagPainelService.ts:238-263` |
| Restrict Communication Paths | Nenhum `axios`/`fetch` novo em `routes/`, `service/`, nem cross-cliente. Frontend usa o wrapper `apiFetch`. | ✅ presente | `git diff main` + `src/frontend/lib/sispag.ts:572` |
| Adhere to Standards | Zod sem coerção, exatamente o padrão do `PENDENTE_DDA_SCHEMA` (ADR-0040). Comentário no boundary cita o ADR explicitamente. | ✅ presente | `ConexosSispagWriteClient.ts:70-88` |
| Abstract Common Services | Duas leituras do MESMO endpoint (`fin015/finItemSispag/list/{fil}/{bnc}/{flp}`) com o MESMO paginado (page 1, size 500) coexistem sem uma leitura compartilhada de itens do lote. Cada uma projeta um shape diferente (Set de chaves vs. Array de linhas digitáveis). | ⚠️ parcial | `ConexosSispagWriteClient.ts:363` vs `:408` |
| Discover Service | SSM/`EnvironmentProvider` já cabeado no `ConexosBaseClient` — nada muda no delta. | ✅ presente (pré-existente) | Não tocado |
| Tailor Interface | Cliente devolve `{docCod, titCod, linhaDigitavel}` — projeção enxuta que oculta os ~60 campos do grid do fin015. | ✅ presente | `ConexosSispagWriteClient.ts:409-433` |
| Configure Behavior | Nada configurável (por design — não há knob que faça sentido). | N/A | Regex e paginação são invariantes do protocolo do ERP. |
| Manage Resources | `runWithRetry` + `ensureSid` reaproveitados do `ConexosBaseClient`; sem duplicação. | ✅ presente | `ConexosSispagWriteClient.ts:412-424` |
| Orchestrate | Serviço faz orquestração linear e curta (2 passos: `loteRepo.getLoteComItens` → `fin015.listarLinhasDigitaveisDoLote`); sem cascata. | ✅ presente | `SispagPainelService.ts:238-263` |
| Manage Resource Coupling | Frontend chama a rota só na expansão do card (`useEffect` com `aberto && !isRascunho`) e nunca no clique — evita `clipboard.writeText` pós-`await` (regra do navegador). | ✅ presente | `src/frontend/app/sispag/components/LoteCard.tsx:150-172` |
| Contract testing (facet moderna) | `contrato.test.ts` existe e cobre 9 grids do fin015/052/064/etc. **O novo campo `itsNumCodbar` NÃO foi adicionado à entrada `fin015-item-lote`.** O consumidor listado é apenas `listarChavesDoLote`. | ❌ ausente para este delta | `__fixtures__/contrato.test.ts:97-103` |
| Versioning strategy (facet moderna) | Conexos não oferece versão de API; nenhum client versiona URL. Pré-existente — não é regressão. | ⚠️ parcial | `grep -rn "/v[0-9]" src/backend/domain/client` = 0 hits |
| Backward-compat shims (facet moderna) | Não aplicável — leitura nova, sem contrato anterior a preservar. | N/A | — |
| Observability of integration failures (facet moderna) | Falha do `fin015` produz `BUSINESS_WARN` com `motivo`; sem métrica por dependência, sem alarme. Um `[]` proveniente de "campo renomeado" (via `safeParse` fail em cada row) **não gera nem warn** — passa como "lote sem boleto", que é indistinguível do estado legítimo. | ⚠️ parcial | `SispagPainelService.ts:252-262` |

## 4. Findings (achados)

### F-integrability-1: `itsNumCodbar` não é guardado pelo contract test

- **Severidade**: P1
- **Tactic violada**: Contract testing (facet moderna); Adhere to Standards (o padrão local é `contrato.test.ts`)
- **Localização**: `src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts:97-103`
- **Evidência (objetiva)**:
  ```
  {
      fixture: 'fin015-item-lote',
      consumidor: 'ConexosSispagWriteClient.listarChavesDoLote (retomada de import parcial)',
      campos: ['filCod', 'docCod', 'titCod', 'itsCodSeq', 'flpCod'],
  },
  ```
  O grid ganhou um NOVO consumidor (`listarLinhasDigitaveisDoLote`) que depende de `itsNumCodbar`, mas a entrada `fin015-item-lote` continua listando só a chave composta. O comentário do próprio arquivo diz: *"Cada entrada aqui é uma dependência real, não documentação"* (`contrato.test.ts:44`).
- **Impacto técnico**: Se o Conexos renomear `itsNumCodbar` (ou trocar por, digamos, `itsEspCodbar`, ou mudar o tipo), o `LINHA_DIGITAVEL_SCHEMA` faz `safeParse` retornar `success: false` em toda linha, o método devolve `[]`, o serviço devolve `[]` sem passar pelo `catch` (não há erro, só schema-fail), a UI não mostra botão — e o `contrato.test.ts` continua verde. É o cenário-alvo do teste, exatamente o que o comentário diz para evitar. Silêncio prolongado até uma analista reclamar que o botão sumiu.
- **Impacto de negócio**: A feature em si (copiar linha digitável) é uma conveniência, não um pagamento — logo NÃO é dinheiro no lugar errado. Mas a regressão silenciosa esconde uma mudança de contrato do ERP que pode afetar OUTRAS leituras do mesmo grid (`listarChavesDoLote` já lê o mesmo endpoint e pode estar sob o mesmo evento). Cada dia de silêncio é um dia sem gatilho para investigar o que mais mudou.
- **Métrica de baseline**: 0/1 novos consumidores registrados em `CONTRATOS`. Cobertura do fixture `fin015-item-lote` sobre campos lidos pelo código: **5/6** após este delta (`filCod`, `docCod`, `titCod`, `itsCodSeq`, `flpCod` cobertos; `itsNumCodbar` não).

### F-integrability-2: Fixture não exercita o formato positivo de `itsNumCodbar`

- **Severidade**: P2
- **Tactic violada**: Contract testing (facet moderna) — o teste "os campos conhecidamente ausentes continuam ausentes" pega ausência, mas não pega mudança de tipo.
- **Localização**: `src/backend/domain/interface/sispag/__fixtures__/2026-08-25-fin015-item-lote.json:21`
- **Evidência (objetiva)**:
  ```
  "itsNumCodbar": null,
  ```
  A chave está no fixture, com valor `null` (redação padrão). O `contrato.test.ts` afirma apenas presença de chave (`(c in linha)`) e ausência de string crua não-redigida — não afirma "o formato quando populado é 47 dígitos". O honesto-limit do próprio contract test admite: *"a redação preserva chaves e tipos, não valores. Um campo que passe a vir sempre nulo com o mesmo tipo NÃO é detectado aqui"* (`contrato.test.ts:20-21`). O caso oposto — o ERP passar a mandar 44 dígitos (código de barras) em vez de 47 (linha digitável) — também não é detectado.
- **Impacto técnico**: Se o ERP começar a devolver o mesmo campo em outro formato (44 dígitos, com traço, com dot-notation), o `regex(/^\d{47}$/)` rejeita silenciosamente e a fixture não avisa. É um subcaso do F-integrability-1, mas de tipo mais fino.
- **Impacto de negócio**: Idem F-integrability-1. Adiciona pouco além da recomendação de melhorar a redação para tipos-com-shape (ex.: guardar `"<barcode47>"` como marcador redigido e afirmar `/^\d{47}$/.test(fixture.linha.itsNumCodbar || '')` quando o marcador está presente).
- **Métrica de baseline**: 0 fixtures com marcador de tipo compatível com o regex de barcode. 4 dos 6 fixtures do `fin015` têm valores redigidos como zero/string genérica, sem tipagem forte.

### F-integrability-3: Leitura duplicada do mesmo grid `fin015/finItemSispag/list/{fil}/{bnc}/{flp}`

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services (Bass — "Limit Dependencies")
- **Localização**:
  - `src/backend/domain/client/ConexosSispagWriteClient.ts:363` (`listarChavesDoLote` — chamado por `RemessaService.gerarRemessa`)
  - `src/backend/domain/client/ConexosSispagWriteClient.ts:408` (`listarLinhasDigitaveisDoLote` — chamado por `SispagPainelService.linhasDigitaveisDoLote`)
- **Evidência (objetiva)**:
  ```
  # ConexosSispagWriteClient.ts:363 e :408
  const path = `fin015/finItemSispag/list/${filCod}/${bncCod}/${flpCod}`;
  # mesmo body: { fieldList: [], filterList: {}, serviceName: 'fin015', pageNumber: 1, pageSize: 500 }
  ```
  Duas subrotinas quase idênticas — leem a mesma página do mesmo grid com o mesmo paginado — e projetam shapes diferentes (`Set<'filCod:docCod:titCod'>` vs. `Array<{docCod, titCod, linhaDigitavel}>`). O corpo delas é ~95% igual (linhas 363-388 vs. 408-434), difere só na projeção final.
- **Impacto técnico**: Baixo — os dois usos vivem em ciclos de vida diferentes (`listarChavesDoLote` roda na geração da remessa; `listarLinhasDigitaveisDoLote` roda na expansão do card do painel). Mas: (i) mudanças de paginação ou de retry precisam ser feitas em duas casas; (ii) se amanhã aparecer um terceiro consumidor projetando mais um shape, a duplicação escala; (iii) um `listarItensDoLote(): Row[]` privado ao cliente, com projeções expostas como métodos, elimina os dois `try/catch` idênticos e faz a Zod-boundary do row inteiro (aí `itsNumCodbar` cabe naturalmente no shape do row, não só num método).
- **Impacto de negócio**: Nenhum imediato. É débito de manutenção; a próxima feature que tocar o grid vai pagar.
- **Métrica de baseline**: 2 sites com o mesmo `path` template. Corpo duplicado: ~25 linhas cada, ~95% overlap.

### F-integrability-4: Falha de leitura por schema-fail é indistinguível do estado "lote sem boleto"

- **Severidade**: P2
- **Tactic violada**: Observability of integration failures (facet moderna)
- **Localização**:
  - `src/backend/domain/client/ConexosSispagWriteClient.ts:426-429` (loop com `safeParse`, `continue` silencioso quando falha)
  - `src/backend/domain/service/sispag/SispagPainelService.ts:247-262` (só loga warn no `catch`, não no schema-fail)
- **Evidência (objetiva)**:
  ```
  for (const row of page.rows ?? []) {
      const parsed = LINHA_DIGITAVEL_SCHEMA.safeParse(row);
      if (!parsed.success) continue;                     // ← silencioso
      itens.push({...});
  }
  ```
  Se o ERP renomeia `itsNumCodbar`, TODAS as linhas caem no `continue`. O método devolve `[]` **sem lançar** — logo o `catch` do serviço não roda, o `BUSINESS_WARN` não é emitido. Do ponto de vista de logs, um lote com todos os boletos escondidos pela mudança de contrato é literalmente igual a um lote sem boletos.
- **Impacto técnico**: Sem observabilidade, o gate para descobrir a regressão é humano (analista percebe que o botão sumiu). A boa notícia: o fixture-based contract test (F-integrability-1) fecha esse gap por outro caminho — se ele existisse com `itsNumCodbar`, o CI acharia a mudança na captura seguinte. A má notícia: entre uma captura e outra, o silêncio persiste.
- **Impacto de negócio**: Baixo (a feature é conveniência). Mas o mesmo padrão de "omitir linha malformada em silêncio" está no código de leitura — se um dia for aplicado a algo com efeito monetário direto, o custo do padrão aumenta. Registrar já aqui é barato.
- **Métrica de baseline**: 0 log/métrica emitido quando `safeParse` falha em ≥1 linha. Alvo mínimo: um `logService.warn({type: BUSINESS_WARN, message: 'itsNumCodbar: N linhas descartadas pelo schema', data: {loteId, descartadas: N, total: page.rows.length}})` quando `descartadas > 0 && descartadas === total`.

## 5. Cards Kanban

### [integrability-1] Registrar `itsNumCodbar` no `contrato.test.ts` como campo consumido

- **Problema**
  > O novo `ConexosSispagWriteClient.listarLinhasDigitaveisDoLote` (`ConexosSispagWriteClient.ts:402`) depende do campo `itsNumCodbar` do grid `fin015/finItemSispag/list`, mas a entrada `fin015-item-lote` em `contrato.test.ts:97-103` continua listando só a chave composta. Um rename do campo no ERP não faz nenhum teste ficar vermelho — o método devolve `[]` em silêncio e a UI simplesmente esconde o botão. O próprio comentário do arquivo diz: *"Cada entrada aqui é uma dependência real, não documentação"*.

- **Melhoria Proposta**
  > Editar `src/backend/domain/interface/sispag/__fixtures__/contrato.test.ts:97-103`: adicionar `'itsNumCodbar'` ao array `campos` e atualizar `consumidor` para citar os dois métodos (`listarChavesDoLote + listarLinhasDigitaveisDoLote`). Tactic Bass: Contract testing. Um único diff de linha; sem código de produção tocado.

- **Resultado Esperado**
  > O CI fica vermelho quando o próximo `jobs/capture-fixtures-sispag.ts` mostrar que o Conexos removeu ou renomeou o campo, dando o gatilho para investigar antes de a analista reclamar do botão sumido.

- **Tactic alvo**: Contract testing (facet moderna); Adhere to Standards
- **Severidade**: P1
- **Esforço estimado**: S (≤1d) — na prática, ≤15 min
- **Findings relacionados**: F-integrability-1, F-integrability-2
- **Métricas de sucesso**:
  - Cobertura do fixture `fin015-item-lote` sobre campos lidos: **5/6 → 6/6**
  - Nº de consumidores documentados na entrada `fin015-item-lote`: **1 → 2**
- **Risco de não fazer**: Se o Conexos renomear `itsNumCodbar` em uma release intermediária, o silêncio pode durar semanas — descoberto só por reclamação humana. E como o mesmo grid é lido por `listarChavesDoLote` (que faz retomada de import parcial), qualquer mudança nesse contrato indica que OUTRAS leituras podem ter degradado juntas.
- **Dependências**: nenhuma

### [integrability-2] Marcar tipo do valor redigido para campos com shape (barcode, linha digitável)

- **Problema**
  > O fixture `2026-08-25-fin015-item-lote.json:21` tem `"itsNumCodbar": null` — a chave está, mas o valor não exercita o formato (47 dígitos numéricos). O `contrato.test.ts` só confirma "chave presente" e "string não vazada", não confirma "shape". O honesto-limit do próprio arquivo já reconhece isso (`contrato.test.ts:20-21`).

- **Melhoria Proposta**
  > Estender a redação em `jobs/capture-fixtures-sispag.ts` para gerar marcadores tipados (ex.: `"<barcode47>"`, `"<pesCod>"`) em vez de `null`/`"<string>"`; no `contrato.test.ts`, adicionar um `casosDeShape` opcional por entrada de `CONTRATOS` que afirma `regex.test(fixture[campo])` quando o marcador equivalente estiver presente. Tactic Bass: Contract testing (facet moderna). Manter a política de zero valor real vazado — os marcadores são sentinelas.

- **Resultado Esperado**
  > CI detecta mudança de shape (44 dígitos, com máscara, com sufixo dígito verificador) do lado do ERP antes que o `LINHA_DIGITAVEL_SCHEMA.regex(/^\d{47}$/)` comece a rejeitar tudo em silêncio.

- **Tactic alvo**: Contract testing (facet moderna)
- **Severidade**: P2
- **Esforço estimado**: M (2–5d) — mudanças em capture job + convenção nos fixtures + assertions extras.
- **Findings relacionados**: F-integrability-2, F-integrability-4
- **Métricas de sucesso**:
  - Fixtures com marcador de tipo aplicável a `itsNumCodbar` / `pctEspNumContaBanc` / `titEspNumero`: **0 → ≥3**
  - Assertions de shape (regex) em `contrato.test.ts`: **0 → 1 por campo com formato fixo**
- **Risco de não fazer**: Regressões de tipo escapam pelo `safeParse` sem ninguém saber — vira dependência puramente humana. Para pagamento (não é o caso desta feature), o mesmo padrão é apostado com efeito monetário direto no ADR-0040.
- **Dependências**: [integrability-1] (o campo precisa estar em `campos` antes de ganhar shape check).

### [integrability-3] Emitir warn quando `safeParse` derruba TODAS as linhas do fin015

- **Problema**
  > Em `ConexosSispagWriteClient.ts:426-429`, cada linha reprovada pelo `LINHA_DIGITAVEL_SCHEMA` é descartada em silêncio (`continue`). Se o Conexos renomear o campo, o loop descarta tudo, o método devolve `[]`, o serviço não entra no `catch` (porque não houve erro), e o `BUSINESS_WARN` não é emitido. Um lote com todos os boletos escondidos por schema-fail é indistinguível de um lote legitimamente sem boletos.

- **Melhoria Proposta**
  > Contar `descartadas` no loop e, quando `descartadas > 0`, emitir `logService.warn({type: BUSINESS_WARN, message: 'fin015-linhasDigitaveis: linhas descartadas pelo schema', data: {loteId, path, descartadas, total: page.rows.length}})`. Não passar a linha real — só a contagem. Tactic Bass: Observability of integration failures. Alternativa mais defensiva: quando `descartadas === total && total > 0`, subir `ConexosError` — mas isso mudaria o contrato do serviço e vale casar com [integrability-1] antes.

- **Resultado Esperado**
  > Um rename do ERP produz warn no log agregado no primeiro request, em vez de silêncio indefinido. Combinado com [integrability-1], o gatilho fica em CI (fixture) OU em runtime (warn) — o que vier primeiro.

- **Tactic alvo**: Observability of integration failures (facet moderna)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - Nº de eventos de log emitidos quando `safeParse` falha em ≥1 linha: **0 → 1**
  - Distinção observável entre "lote sem boleto" e "linhas descartadas pelo schema": **impossível → clara nos logs**
- **Risco de não fazer**: Regressão silenciosa fica invisível até uma pessoa reportar. Baixa criticidade nesta feature (conveniência), mas o padrão de "descartar linha em silêncio" está no código — melhor documentar/instrumentar antes que apareça em contexto crítico.
- **Dependências**: nenhuma (roda em paralelo com [integrability-1]).

### [integrability-4] Consolidar as duas leituras do grid `fin015/finItemSispag/list`

- **Problema**
  > Dois métodos do `ConexosSispagWriteClient` (`:363` e `:408`) leem o mesmo endpoint com o mesmo paginado e projetam shapes distintos. ~25 linhas quase idênticas de `try/catch`+`runWithRetry`+`ensureSid` em cada um. Bass "Abstract Common Services" não realizado — a próxima leitura desse grid duplica ainda mais.

- **Melhoria Proposta**
  > Extrair um `private listarItensDoLote(params): Promise<Row[]>` (ou tornar público se o serviço precisar) que faz a chamada + `runWithRetry`. Reescrever `listarChavesDoLote` e `listarLinhasDigitaveisDoLote` como projeções sobre esse método — cada uma vira meia-dúzia de linhas. Tactic Bass: Abstract Common Services. Bônus: o Zod schema fica no shape de `Row`, e cada projeção vira uma leitura tipada dele (não uma re-validação do payload cru).

- **Resultado Esperado**
  > 1 função com `retry`/`ensureSid`/`try/catch` em vez de 2. Um terceiro consumidor do grid (ex.: futura conciliação com o retorno) adiciona só uma projeção. Reduz risco de as duas leituras divergirem em paginação ou tratamento de erro.

- **Tactic alvo**: Abstract Common Services (Bass — Limit Dependencies)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d) — refactor com testes já existentes cobrindo as duas superfícies.
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Linhas duplicadas entre `listarChavesDoLote` e `listarLinhasDigitaveisDoLote`: **~25 → 0**
  - Sites tocando `runWithRetry`+`ensureSid` do fin015 no cliente: **2 → 1**
- **Risco de não fazer**: Baixo enquanto forem só 2 consumidores. Sobe se aparecerem 3+; começa a ser real quando alguém precisar mudar paginação ou política de retry só de um lado e esquecer o outro.
- **Dependências**: nenhuma; pode ficar para próximo `/feature-tweak` que tocar `RemessaService` ou `SispagPainelService`.

## 6. Notas do agente

- Escopo do `--quick` respeitado: só o delta da feature `copiar-barcode-item-lote` foi avaliado; auditoria da malha inteira de integrações (Nexxera, GED, escrita de `fin010`) segue no `_inbox/migration-debt.md`.
- Cross-QA: F-integrability-4 (silêncio no schema-fail) toca **Fault Tolerance** e **Testability** — mesma raiz do padrão "omitir em vez de sinalizar". F-integrability-1 e F-integrability-2 tocam **Testability** diretamente (contract test). O guard `requireRole('admin')` em `routes/sispag.ts:66` toca **Security** — bem-implementado no delta, sem finding aqui, mas o qa-security deve confirmar que o wrapper `fetchLinhasDigitaveis` no frontend não vaza a linha em logs de browser.
- Métrica não coletada: taxa histórica de rename de campo no fin015 do Conexos. Se essa taxa fosse >1/ano, [integrability-1] subiria para P0.
