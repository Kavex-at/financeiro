---
type: regis-review-kanban
run_id: 2026-10-30-sispag-dda-paridade
scope: reduced (4/8 QAs)
total: 20
counts: { p0: 0, p1: 1, p2: 9, p3: 10 }
---

# Kanban — `sispag-dda-paridade` — 2026-10-30 (reduzido)

> Importável para o Kanban do time. Cada card abaixo mantém Problema / Melhoria Proposta / Resultado Esperado
> do arquivo QA de origem (verbatim). Cards marcados `Status: Resolvido nesta PR` já foram tratados no
> próprio PR da feature e devem ser fechados após merge.
> Ordem: P0 (nenhum) → P1 (S → XL) → P2 (S → XL) → P3 (S → XL).

---

## P0 — Crítico

_Nenhum P0 identificado nesta revisão reduzida._

---

## P1 — Alto

### [performance-1] incluir versão dos lotes abertos na chave da cache consolidada DDA

**QA**: Performance
**Tactic alvo**: Maintain Multiple Copies of Computations
**Esforço**: S
**Findings**: F-performance-1
**Status**: ✅ Resolvido nesta PR (invalidar `ConsolidacaoBoletoDdaCache` nas rotas de mutação de lote)

**Problema**
> `BoletoDdaService.listar` compõe a chave da cache com escopo/hoje/`sincronizadoEm`/`carteiraEm`/`sugestoesCache.versao()`, mas o resultado consolidado depende de `loteRepo.listTitulosEmLotesAbertos()` — e nenhuma rota de lote (incluir, remover, retirar, finalizar, cancelar, criarLote) toca a cache. Resultado: a aba Boletos DDA mostra estado pré-mutação por até 30 s após qualquer ação no lote.

**Melhoria Proposta**
> Adicionar um `LotesAbertosVersao` (singleton, contador monotônico) bumpado pelo `LotePagamentoService` nas transições que mudam o conjunto de títulos em lote aberto, e incluí-lo na chave; alternativa mais barata: chamar `consolidadoCache.invalidar()` nos mesmos pontos onde `sugestoesCache.invalidar()` já é chamado hoje nas mutações de lote (se aplicável). Tactic Bass: *Maintain Multiple Copies of Computations* (chave completa de consistência).

**Resultado Esperado**
> Staleness da aba Boletos DDA após mutação de lote: 30 s → ≤ 500 ms (tempo da próxima consolidação).

**Métricas de sucesso**
- Janela de staleness pós-mutação: 30 s → ≤ 500 ms
- Chave da cache cobre todos os insumos de `consolidarEscopo`: 4/5 → 5/5

**Risco de não fazer**
> Analista reporta "a aba DDA e a aba de lotes se contradizem" — ticket recorrente de inconsistência percebida.

**Dependências**: nenhuma

---

## P2 — Médio

### [fault-tolerance-1] Separar `DDA_FILE_EMPTY` em WARN agregado com identidade do arquivo

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring
**Esforço**: S
**Findings**: F-fault-tolerance-1
**Status**: ✅ Resolvido nesta PR (BUSINESS_WARN distinto com `ddcCod` + propagação do `code`)

**Problema**
> O guard do repositório lança `EmptyDdaFileError` com `code = 'DDA_FILE_EMPTY'` para proteger o snapshot, mas o serviço de sync empacota essa classe junto com qualquer outra falha de leitura num único `BUSINESS_INFO`. Não dá para distinguir "ERP devolveu vazio" de "504 transitório" nem para contar quantas vezes o mesmo arquivo caiu nessa classe.

**Melhoria Proposta**
> No `catch` do `BoundedConcurrency` em `BoletoDdaService.executarSincronizacao`, detectar `error.code === 'DDA_FILE_EMPTY'` e emitir `BUSINESS_WARN` separado, com `ddcCod` e `itensNoSnapshot`. Propagar o `code` em `arquivosFalhasPorCodigo` dentro de `SincronizacaoDdaResultado` para que o `IngestaoPagamentosService.avisoDaRun` registre `pool DDA parcial (DDA_FILE_EMPTY: N arquivos)`. Tactic alvo: Condition Monitoring.

**Resultado Esperado**
> Log auditável por classe: 100 % das ocorrências de `DDA_FILE_EMPTY` identificadas como WARN com `ddcCod`; a run da ingestão deixa de confundir falha transitória com divergência estrutural.

**Métricas de sucesso**
- % de ocorrências `EmptyDdaFileError` com `code` no log: 0 % → 100 %
- Mensagem distinta em `avisoDaRun`: ausente → presente

**Risco de não fazer**
> O pool parece saudável enquanto um subconjunto de arquivos nunca é relido com sucesso; nenhum alerta dispara até a remessa do banco cair.

**Dependências**: nenhuma

---

### [performance-2] limitar a cache consolidada por bytes, não por entradas

**QA**: Performance
**Tactic alvo**: Maintain Multiple Copies of Computations
**Esforço**: S
**Findings**: F-performance-2
**Status**: ✅ Resolvido nesta PR (via redução de `MAX_ENTRADAS` para 2 — alternativa barata do card)

**Problema**
> `MAX_ENTRADAS = 4` sem bound de bytes; cada entrada carrega ~24k consolidados (~15–25 MB). Com dois escopos e bumps de versão por decisão, o residente da cache pode encostar em 100 MB num dyno de 512 MB.

**Melhoria Proposta**
> Trocar o cap por `MAX_BYTES` (estimar via `JSON.stringify(valor).length` ou contador acumulado), evictar quando acumular > teto (p.ex. 40 MB). Alternativa: reduzir `MAX_ENTRADAS` para 2 (um por escopo) e aceitar que bumps de versão evictam. Tactic Bass: *Maintain Multiple Copies of Computations* com bound explícito.

**Resultado Esperado**
> Pior caso residente da cache: ~75–100 MB → ≤ 40 MB.

**Métricas de sucesso**
- Residente da cache (medido em smoke): ≤ 40 MB
- OOMs do processo nos últimos 30 dias atribuíveis a esta cache: 0

**Risco de não fazer**
> OOM silencioso em pico quando outras caches (sugestões, carteira) também crescem.

**Dependências**: nenhuma

---

### [testability-1] Suíte própria para `ConsolidacaoBoletoDdaCache`

**QA**: Testability
**Tactic alvo**: Specialized Interfaces
**Esforço**: S
**Findings**: F-testability-1
**Status**: ✅ Resolvido nesta PR (suíte dedicada `ConsolidacaoBoletoDdaCache.test.ts`)

**Problema**
> `ConsolidacaoBoletoDdaCache` é novo em `src/backend/domain/service/sispag/ConsolidacaoBoletoDdaCache.ts:1-83` e carrega 4 invariantes (TTL, single-flight, geração durante inflight, LRU com `MAX_ENTRADAS=4`). Hoje só é exercitado via `BoletoDdaService.test.ts`, que cobre TTL, keying e invalidation — a LRU e a proteção `geracao === geracao` em `:58` ficam sem rede.

**Melhoria Proposta**
> Criar `ConsolidacaoBoletoDdaCache.test.ts` ao lado, usando `withClock` já exposto. Cenários mínimos: (a) 5 chaves distintas em TTL → a mais antiga é descartada; (b) `invalidar()` chamado durante um `calcular()` em voo → o valor que a Promise resolver NÃO entra no cache; (c) falha de `calcular` apaga a entrada em voo e não guarda; (d) `obter` concorrente na mesma chave resolve uma única vez. Tactic Bass: *Specialized Interfaces* + *Limit Non-Determinism*.

**Resultado Esperado**
> Branches do cache 2 → 4 testadas; testes dedicados ao cache 0 → 4; execução adicional < 1 s.

**Métricas de sucesso**
- Arquivos de teste cobrindo o cache: 0 → 1
- Cenários de cache testados: 5 (via serviço) → 9 (5 + 4 dedicados)

**Risco de não fazer**
> Uma regressão silenciosa na geração ou na LRU reintroduz o sintoma da ADR-0067 (grupo "sugerido" mostrado após confirmação) sem alarme no CI.

**Dependências**: nenhuma

---

### [modifiability-1] Mover pedaços shared para `app/sispag/shared/` (ou `components/filtros/`)

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S
**Findings**: F-modifiability-1
**Status**: ✅ Resolvido nesta PR (cinco componentes movidos para pasta neutra; imports atualizados)

**Problema**
> Os componentes extraídos (`ChipFiltro`, `SegmentosComTotal`, `PilulasFiltroAtivo`, `PaginacaoTabela`, `botoesDeCard`) são usados pelas duas abas (Títulos a pagar e Boletos DDA), mas moram em `app/sispag/situacao/`, que é a pasta da aba Títulos. A aba nova importa de `../situacao/*` — a nomenclatura esconde o papel compartilhado e cria acoplamento assimétrico.

**Melhoria Proposta**
> Mover os cinco arquivos para `app/sispag/shared/` (ou `app/sispag/components/filtros/`) e atualizar imports nos sete pontos conhecidos (`boletos-dda/FiltroSituacaoDdaBarra.tsx:6-7`, `boletos-dda/TabelaBoletosDda.tsx:26-27`, `components/CardsBoletosDda.tsx:10`, `situacao/FiltroSituacaoBarra.tsx:7-9`, `situacao/CardsSituacao.tsx:8`, `situacao/TabelaTitulos.tsx:39-40`). Tactic: **Abstract Common Services** + **Restrict Dependencies**.

**Resultado Esperado**
> Nenhuma aba importa de pasta de aba irmã. Grep por consumidores da aba Boletos DDA cobre 100% do que a aba usa.

**Métricas de sucesso**
- Imports cruzando `situacao/` ↔ `boletos-dda/`: 7 → 0
- Pedaços shared sob pasta de aba: 5 → 0

**Risco de não fazer**
> Terceira aba (p.ex. Autorizações) herda o acoplamento ou força um segundo fork.

**Dependências**: nenhuma

---

### [fault-tolerance-3] Alarme de staleness sobre `max(sincronizado_em)`

**QA**: Fault Tolerance
**Tactic alvo**: Self-Test
**Esforço**: S
**Findings**: F-fault-tolerance-3, F-fault-tolerance-1

**Problema**
> Nenhum componente observa a idade da última sync DDA bem-sucedida. Se a ingestão de pagamentos pular/falhar e a analista não clicar "Atualizar DDA", o pool envelhece sem alerta — e as decisões da aba (incluindo o flag `temBoleto` da carteira) passam a mentir.

**Melhoria Proposta**
> Introduzir um probe (job periódico ou healthcheck invocado pelo painel-operacao) que compara `now() - repo.ultimaSincronizacao()` com um limite (p.ex. 3 h em horário comercial BRT) e emite `BUSINESS_WARN` quando ultrapassa. Expor o número na mesma tela que já mostra `sincronizadoEm`. Tactic alvo: Self-Test.

**Resultado Esperado**
> Staleness do pool é observável antes do incidente; cobertura passa de 0 % para 100 % dos cenários "sem sync há > N horas".

**Métricas de sucesso**
- Cobertura de alarme de staleness: 0 % → 100 %
- Tempo de detecção de "sem sync" após N horas: indefinido → ≤ 1 ciclo do probe

**Risco de não fazer**
> Pool envelhecido continua sendo descoberto só quando o banco recusa a remessa.

**Dependências**: nenhuma; alinhar o limiar com o cron da ingestão

---

### [performance-4] evitar as duas `SELECT max(...)` em cache hit

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: S
**Findings**: F-performance-4

**Problema**
> `listar()` dispara `ultimaSincronizacao()` e `findLatestSuccessFinishedAt()` em paralelo antes de olhar a cache. Em hit, são 2 RTTs ao Postgres desperdiçados.

**Melhoria Proposta**
> Expor um `CarteiraVersao` e um `DdaSyncVersao` (singletons monotônicos) bumpados pelos próprios serviços de ingestão/sincronização ao fim; `listar()` lê os contadores em memória e cai no SQL só quando precisa recomputar. Tactic Bass: *Reduce Overhead*.

**Resultado Esperado**
> Queries SQL por hit: 2 → 0. Latência de hit cai mais ~10–20 ms.

**Métricas de sucesso**
- Queries SQL por `/sispag/boletos-dda` em hit: 2 → 0
- p50 warm: queda adicional ≥ 10 ms

**Risco de não fazer**
> Pool de conexões recebe ruído previsível em cada troca de página; nada quebra.

**Dependências**: nenhuma

---

### [fault-tolerance-2] Priorizar `arquivosAdiados` na próxima passada

**QA**: Fault Tolerance
**Tactic alvo**: Reconcile
**Esforço**: M
**Findings**: F-fault-tolerance-2

**Problema**
> `alvo = [...novos, ...relidos]` segue a ordem do `fin124`; sob budget apertado (10 s na ingestão), arquivos repetidamente adiados ficam no final de todas as passadas, enquanto novos são sempre atendidos primeiro.

**Melhoria Proposta**
> Persistir, em `boleto_dda_arquivo`, uma marca `ultima_tentativa_em` (não confundir com `sincronizado_em`); quando um arquivo é adiado, atualizar a marca sem alterar `sincronizado_em`. No próximo start de sync, ordenar `alvo` por `(ultima_tentativa_em IS NULL DESC, ultima_tentativa_em ASC)` para dar preferência a quem está esperando há mais tempo. Tactic alvo: Reconcile.

**Resultado Esperado**
> Idade mediana do arquivo mais atrasado por sync fica limitada a uma passada; nenhum arquivo é adiado em sequência indefinida.

**Métricas de sucesso**
- Idade mediana do pior arquivo adiado por passada: desconhecida → medida e ≤ 1 passada
- Teste cobrindo "adiado por N passadas sobe de posição": ausente → presente

**Risco de não fazer**
> Um subconjunto de arquivos pode envelhecer silenciosamente até sair da janela de 60 dias, sem jamais ter sido relido com sucesso.

**Dependências**: nenhuma; migration pequena no `boleto_dda_arquivo`

---

### [performance-3] memoizar facetas e contagens por entrada da cache consolidada

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: M
**Findings**: F-performance-3

**Problema**
> `paginar()` recomputa `facetas()` + `totalizar()` em O(N) sobre 24k linhas a cada hit, mesmo que facetas sejam invariantes do escopo cacheado.

**Melhoria Proposta**
> Guardar `{ linhas, facetas, contagemBase, totaisBase }` como valor da cache (não só `linhas`); `paginar()` recebe esses pré-computados e só aplica o filtro variável. Tactic Bass: *Reduce Overhead*.

**Resultado Esperado**
> p50 warm 60 ms → p50 warm ≤ 25 ms; p95 warm 100 ms → ≤ 50 ms.

**Métricas de sucesso**
- p50 warm `/sispag/boletos-dda`: 60 ms → 25 ms
- Passagens O(24k) por request em hit: 3 → 1

**Risco de não fazer**
> Aba continua sentida como "pesada" na troca de página mesmo com cache quente.

**Dependências**: performance-2 (bytes contados devem incluir os novos campos)

---

### [modifiability-2] Fatiar `src/backend/routes/sispag.ts` por sub-rota

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: M
**Findings**: F-modifiability-2

**Problema**
> O arquivo chegou a 1 976 LOC após este delta (+52). Já é o maior arquivo do backend; cada feature nova paga o custo marginal de leitura e navegação. Dentro do delta, o helper `listaQuery` ficou embutido no arquivo em vez de ir para `http/schemas.ts`.

**Melhoria Proposta**
> Extrair módulos de rota por área: `routes/sispag/boletos-dda.ts`, `routes/sispag/lotes.ts`, `routes/sispag/autorizacoes.ts`, etc., mantendo um `routes/sispag.ts` que só compõe `Router`. Mover `listaQuery` e os schemas Zod comuns para `http/schemas.ts`. Tactic: **Split Module**.

**Resultado Esperado**
> Cada módulo de rota ≤ 400 LOC; `routes/sispag.ts` vira composição ≤ 100 LOC.

**Métricas de sucesso**
- LOC do maior arquivo de rota SISPAG: 1 976 → ≤ 400
- Nº de arquivos de rota SISPAG: 1 → N (um por área)

**Risco de não fazer**
> Curva de LOC continua linear por feature; onboarding fica mais caro a cada ciclo.

**Dependências**: nenhuma técnica; preferir fazer **fora** desta feature para não ampliar o blast radius da revisão

---

## P3 — Baixo

### [fault-tolerance-4] Documentar o limite "cache por processo" como pré-condição de escala

**QA**: Fault Tolerance
**Tactic alvo**: State Resync (Reintroduction)
**Esforço**: S
**Findings**: F-fault-tolerance-4

**Problema**
> O `ConsolidacaoBoletoDdaCache` é `@singleton` por processo. Documentação explícita no arquivo. A janela de 30 s de divergência cross-réplica não vira risco enquanto houver 1 réplica, mas vira dívida quando escalarmos.

**Melhoria Proposta**
> Adicionar o item na checklist de escala (próxima ADR de deploy / Terraform-alvo) para que ninguém escale para N réplicas sem antes mover o cache para um backend compartilhado (Redis) ou aceitar explicitamente a janela de 30 s. Tactic alvo: State Resync.

**Resultado Esperado**
> Nenhum deploy multi-réplica abre a janela sem decisão consciente.

**Métricas de sucesso**
- Item na checklist de escala: ausente → presente

**Risco de não fazer**
> Nenhum enquanto houver 1 réplica; latente após o pivot para Lambda-alvo.

**Dependências**: aguardar ADR de escalabilidade / Lambda-alvo

---

### [testability-2] Suíte unitária para os cinco componentes compartilhados extraídos

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: S
**Findings**: F-testability-2

**Problema**
> Componentes `ChipFiltro`, `SegmentosComTotal`, `PilulasFiltroAtivo`, `PaginacaoTabela` e `botoesDeCard` passaram a ser contrato entre as abas Títulos a pagar e Boletos DDA, mas nenhum tem suíte própria. Regressão em um componente aparece como "quebrou cinco testes de aba" em vez de "quebrou um teste de componente".

**Melhoria Proposta**
> Adicionar `src/frontend/app/sispag/situacao/{ChipFiltro,SegmentosComTotal,PilulasFiltroAtivo,PaginacaoTabela}.test.tsx`. Pelo menos: `aria-pressed`, `onSelecionar` com `valor` certo, exibição de `qtd` e `R$`, foco visível, botão "Remover filtro: X" dispara `onRemover`. Tactic Bass: *Limit Structural Complexity*.

**Resultado Esperado**
> Diagnóstico direto quando o contrato quebra: 1 teste vermelho no componente em vez de 5 em abas.

**Métricas de sucesso**
- Testes dedicados aos componentes extraídos: 0 → 4 arquivos
- Testes de aba falhando numa quebra de componente: ≥ 5 → ≤ 2

**Risco de não fazer**
> Tempo de triagem aumenta; a próxima extração (quando a Frente IV reutilizar) herda a opacidade.

**Dependências**: executar depois de `modifiability-1` (os paths serão outros após o move)

---

### [testability-3] Fixture versionada da resposta `BoletosDdaResposta`

**QA**: Testability
**Tactic alvo**: Recordable Test Cases
**Esforço**: S
**Findings**: F-testability-3

**Problema**
> `src/frontend/app/sispag/components/BoletosDdaTab.test.tsx:67-115` monta a resposta do servidor com um builder manual. `totais`, `facetas` e `amostraHoje` são opcionais no tipo "porque backend anterior à v0.80 não manda" — o teste pode divergir do que o servidor realmente emite e manter-se verde.

**Melhoria Proposta**
> Gravar 1-2 fixtures JSON (ex.: `__fixtures__/boletos-dda-pagina-25.json`), geradas a partir de uma chamada real contra `routes/sispag.ts` em um test harness do backend. O builder `pagina()` passa a `JSON.parse` o fixture e sobrescrever campos. Tactic Bass: *Recordable Test Cases*.

**Resultado Esperado**
> Divergência server↔client fica detectável; os campos opcionais podem virar obrigatórios quando o rollout permitir.

**Métricas de sucesso**
- Fixtures JSON de resposta DDA: 0 → 2
- Campos opcionais hoje por compatibilidade (`totais?`, `facetas?`, `amostraHoje?`): 3 → 0 depois do rollout

**Risco de não fazer**
> Cresce a dívida de contrato toda vez que o servidor adicionar campo.

**Dependências**: nenhuma

---

### [testability-4] Fixar `coverageThreshold` para o escopo da feature

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-5

**Problema**
> Jest não tem `coverageThreshold` em nenhum dos dois projetos. O delta é grande (`PaginacaoBoletoDda.ts` +342, cache novo, rotas, UI), mas o único portão é "suíte verde".

**Melhoria Proposta**
> Em `src/backend/jest.config.*` fixar `coverageThreshold` por *path pattern* para `src/backend/domain/service/sispag/{BoletoDdaService,PaginacaoBoletoDda,ConsolidacaoBoletoDdaCache}.ts` (80/70/80 lines/branches/functions). Em `src/frontend/jest.config.*` idem para `src/frontend/app/sispag/boletos-dda/*`. Ligar no CI do PR. Tactic Bass: *Executable Assertions*.

**Resultado Esperado**
> Regressão de cobertura no caminho crítico quebra o PR; o número vira defendível.

**Métricas de sucesso**
- `coverageThreshold` nos arquivos tocados: 0% declarado → 80% lines
- Cobertura real do delta: ⚠️ não medida nesta sessão → ≥ 80% em `domain/service/sispag/{BoletoDdaService,PaginacaoBoletoDda,ConsolidacaoBoletoDdaCache}.ts`

**Risco de não fazer**
> A próxima feature que raspar o service passa com 40% e ninguém vê.

**Dependências**: nenhuma

---

### [testability-5] Teste de UI com relógio controlado para "Vencem em até 2 dias" / "Ver só estes" na faixa de hoje

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism
**Esforço**: S
**Findings**: F-testability-4

**Problema**
> Hoje o teste UI que exercita "Ver só os urgentes" e "Ver só estes" injeta `totais.urgentes`/`totais.hoje` prontos no mock, sem controlar relógio. A UI atual delega a semântica ao servidor (`faixas: ['HOJE','1-2']`), que **está** testado em `PaginacaoBoletoDda.test.ts:238-262`. Mas o teste UI deixa de amarrar o rótulo exibido ("vencem hoje" / "em até 2 dias") a um dia civil específico.

**Melhoria Proposta**
> Adicionar 1 teste em `BoletosDdaTab.test.tsx` que configura `jest.setSystemTime` para `2026-10-30T15:00Z` e checa que a faixa "Boletos não casados que vencem hoje" mostra a data certa, e que o botão "Ver só estes" ainda monta `faixas: ['HOJE']` nessa data. Tactic Bass: *Limit Non-Determinism*.

**Resultado Esperado**
> Relação rótulo-exibido ↔ dia civil amarrada por teste. Resistente à troca de fuso.

**Métricas de sucesso**
- Testes UI com relógio controlado para a faixa: 0 → 1

**Risco de não fazer**
> Baixo — o server-test já cobre a classificação; só a renderização de rótulo em dia-virada fica a descoberto.

**Dependências**: nenhuma

---

### [modifiability-3] Dividir `PaginacaoBoletoDda` em `FiltragemBoletoDda` + `FacetasBoletoDda` + `TotaisBoletoDda`

**QA**: Modifiability
**Tactic alvo**: Increase Semantic Coherence
**Esforço**: S
**Findings**: F-modifiability-3

**Problema**
> Uma única classe reúne filtrar/ordenar/paginar/totalizar/facetar. São 4 eixos de mudança; cada nova faceta toca pelo menos dois (`criterios` + `totalizar`). A classe hoje tem 401 LOC e cresce proporcional ao nº de colunas.

**Melhoria Proposta**
> Extrair `FacetasBoletoDda` (puro: entra `linhas`, sai `facetas`) e `TotaisBoletoDda` (puro: entra `linhas + hoje`, sai `contagem/totais/amostraHoje`). `PaginacaoBoletoDda` passa a orquestrar: `criterios → filtra → facetas → totais → ordena → pagina`. Tactic: **Increase Semantic Coherence**.

**Resultado Esperado**
> Cada classe ≤ 150 LOC; mudar a definição de "urgente" toca só `TotaisBoletoDda`; adicionar nova coluna de facet toca só `FacetasBoletoDda`.

**Métricas de sucesso**
- LOC máximo entre as três classes: 401 → ≤ 150
- Nº de classes "puras" cobertas por teste unitário: 1 → 3

**Risco de não fazer**
> Cresce a cada novo chip; teste único vira caso-a-caso de 500+ linhas.

**Dependências**: nenhuma

---

### [modifiability-4] Externalizar `BOLETO_DDA_PRAZO_MS` via `EnvironmentProvider`

**QA**: Modifiability
**Tactic alvo**: Defer Binding
**Esforço**: S
**Findings**: F-modifiability-5

**Problema**
> O prazo da passada da sincronização (60 s) é constante compilada; mudar prazo = deploy. Vai ser batido pelo operador cedo ou tarde (SLA do botão "Atualizar DDA").

**Melhoria Proposta**
> Mover para `EnvironmentProvider` como `SISPAG_DDA_PRAZO_MS` (default 60 000), com Zod `coerce.number().int().positive()`. A rota e o job passam a resolver via DI. Tactic: **Defer Binding (configuration)**.

**Resultado Esperado**
> Trocar prazo = variável de ambiente; nenhum build.

**Métricas de sucesso**
- Constantes de regra na rota DDA sem binding deferido: 1 → 0

**Risco de não fazer**
> Baixo; sintoma seria pedido de ajuste fino em HML sem janela de deploy.

**Dependências**: nenhuma

---

### [performance-5] endpoint dedicado "boletos do título" em vez de 2 GETs à listagem

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: M
**Findings**: F-performance-5

**Problema**
> `fetchBoletosDdaDoTitulo` dispara duas `GET /sispag/boletos-dda` concorrentes com `busca=doc/tit` e `busca=valor`, cada uma passando pela listagem consolidada completa.

**Melhoria Proposta**
> Criar `GET /sispag/boletos-dda/titulo?filCod&docCod&titCod` que consulta a cache uma única vez e aplica, no servidor, o filtro combinado (`vinculo/candidato por doc+tit OU mesmo valor`). Deprecar o fan-out no cliente. Tactic Bass: *Reduce Overhead*.

**Resultado Esperado**
> Requests por abertura de gaveta: 2 → 1. Em cache fria pior-caso: ~12 s somados → ~6 s.

**Métricas de sucesso**
- Requests por abertura de gaveta do título: 2 → 1
- Payload total da gaveta (p50): queda ≥ 40%

**Risco de não fazer**
> Cache fria + muitas gavetas abertas em sequência amplifica picos.

**Dependências**: nenhuma

---

### [performance-6] abortar a consolidação em voo quando `invalidar()` é chamado

**QA**: Performance
**Tactic alvo**: Limit Event Response
**Esforço**: M
**Findings**: F-performance-6

**Problema**
> `ConsolidacaoBoletoDdaCache.invalidar()` só limpa o `Map` de `emVoo`; a promessa que estava em voo continua executando ~6 s de CPU sem beneficiar nenhum chamador.

**Melhoria Proposta**
> Propagar um `AbortSignal` por entrada em voo; `invalidar()` chama `controller.abort()`; `consolidarEscopo` passa o sinal para o repositório (ou pelo menos checa `signal.aborted` entre passagens O(N) de `consolidar`). Tactic Bass: *Limit Event Response*.

**Resultado Esperado**
> CPU gasto em consolidações órfãs durante uma invalidação concorrente: ~6 s → ≤ 500 ms.

**Métricas de sucesso**
- Tempo máximo de CPU em promessa órfã após `invalidar`: ≤ 500 ms

**Risco de não fazer**
> Picos duplos de CPU no fim da ingestão quando um usuário já está folheando a aba.

**Dependências**: performance-3 (as passagens O(N) são o lugar natural de checar o sinal)

---

### [modifiability-5] Consolidar paginadores (`PaginacaoTabela` × `Paginacao` legado)

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: M (incremental, aba a aba)
**Findings**: F-modifiability-6

**Problema**
> A pasta `app/sispag/` passa a ter dois paradigmas de paginação ao mesmo tempo: `PaginacaoTabela` (server-side, `onPagina(p)`) e `Paginacao` legado de `app/permutas/components/tabela-filtro.tsx` (client-side, `setPagina(fn)`), consumido ainda por `page.tsx` (5 pontos: linhas 1253, 1648, 1698, 1757, 1873), `recebimentos/*` e `permutas/*`. É transitório esperado mas não registrado.

**Melhoria Proposta**
> Mapear as abas que ainda usam o legado e, aba a aba, migrar para `PaginacaoTabela` quando a lista virar server-paginated. Registrar em `ontology/_inbox/migration-debt.md` com a lista das abas pendentes. Tactic: **Abstract Common Services**.

**Resultado Esperado**
> Um único contrato de paginação em `app/sispag/`. Mudanças de UX no rodapé = um arquivo.

**Métricas de sucesso**
- Paginadores ativos em `app/sispag/`: 2 → 1
- Pontos de uso do `Paginacao` legado em SISPAG: 5 → 0

**Risco de não fazer**
> Débito acumulável; cada mudança visual precisa ser feita duas vezes.

**Dependências**: cada aba migra quando seu backend aceitar paginação por servidor
