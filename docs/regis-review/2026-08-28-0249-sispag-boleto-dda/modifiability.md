---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-08-28-0249-sispag-boleto-dda
agent: qa-modifiability
generated_at: 2026-08-28T03:20:00-03:00
scope: backend+frontend (delta 5978ac5)
score: 7
findings_count: 6
cards_count: 6
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista / Yuri | Nova modalidade SISPAG (ex: PIX-QR, DDA-com-desconto) precisa entrar no fluxo com regra própria de destino/barcode | `RemessaService.montarItensImport`, `SispagPainelService.modalidadesDisponiveisDoLote`, `IngestaoPagamentosService`, `ConexosSispagWriteClient`, `LoteCard.tsx`, `BoletoSemCodigoBarrasError` (regra correlata), `ontology/business-rules/*` | Desenvolvimento; código em produção mas ERP muda de contrato periodicamente | Adicionar a modalidade tocando o mínimo de arquivos, sem quebrar a doutrina de fail-closed no envio e sem regredir o caminho DDA já provado | ≤ 5 arquivos de produção tocados; 1 ADR novo; 0 duplicação de regra; testes existentes verdes sem reescrita |

Cenário real e recorrente neste projeto: a Frente SISPAG já mudou 4 vezes de contrato ERP em 2 meses (ver `git log --oneline -- src/backend/domain/service/sispag/`). A pergunta é: qual é o custo médio de mais uma mudança semelhante à que este delta acabou de fazer?

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC `RemessaService.ts` (pós-delta) | **971** (era 851; +120, +14%) | ≤ 600 idealmente; ≤ 1000 tolerável | ⚠️ | `wc -l src/backend/domain/service/sispag/RemessaService.ts` + `git show 5978ac5^:… \| wc -l` |
| Control-flow keywords `RemessaService.ts` (pós-delta) | **74** (era 70; +4) | densidade estável | ✅ | `grep -cE '\\bif\\b\|\\belse\\b\|\\bfor\\b\|\\bwhile\\b\|\\?\\?\|&&\|\\|\\|' RemessaService.ts` |
| Control-flow keywords `montarItensImport` isolado | **17** (era 15; +2) | ≤ 20 | ✅ | `sed -n '822,943p' \| grep -cE …` |
| LOC `montarItensImport` (corpo) | **~120** (era ~74; +46, +62%) | ≤ 80 idealmente | ⚠️ | contagem manual do diff |
| Arquivos de produção que carregam a regra "boleto exige barcode" | **6** (RemessaService, IngestaoPagamentosService, SispagPainelService, ConexosSispagWriteClient, BoletoSemCodigoBarrasError, LoteCard.tsx) | ≤ 3 (regra + serviço orquestrador + UI) | ⚠️ | `grep -rn 'BOLETO\\\|temBoleto\\\|associarDda' src/backend/domain src/frontend/app/sispag` |
| Fan-in de `RemessaService` | **3** (routes/sispag.ts, 2 jobs) | ≤ 5 | ✅ | `grep -rln RemessaService src/backend` |
| Fan-in de `ConexosSispagWriteClient` | **16** referências (produção + testes + jobs) | ≤ 8 em produção | ⚠️ | idem |
| Total de probes em `src/backend/jobs/` | **30 arquivos, 5.181 LOC** (7 novos neste delta) | política clara de retenção/aposentadoria | ⚠️ | `ls src/backend/jobs/probe-*.ts \| wc -l` + `wc -l` |
| Probes que escrevem em HML sem opt-in explícito | **3** (probe-dda-answer-shape-hml, probe-dda-assoc-write-hml, probe-dda-associado-hml) | 0 (guard `base != -hml` é única defesa) | ⚠️ | `grep -l 'base.*hml\\\|POST' src/backend/jobs/probe-*hml*.ts` |
| Magic constants em business rule (allowlist do POST) | **1** string exata (`FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO`) hardcoded em `ConexosSispagWriteClient` | ≤ 1 documentada (ok se estiver na regra de domínio) | ✅ | `grep -n 'EXISTE_CODIGO_BARRAS_ASSOCIADO' src/backend/domain/client/ConexosSispagWriteClient.ts` |
| Magic constants em `MODALIDADE_NATIVA` | **4 entradas**, 1 delas (`BOLETO=7`) documentada como "errada em 89% dos casos, sobrescrita pelo ERP" | 0 valores sabidamente-errados sem barreira runtime | ⚠️ | `sed -n '30,42p' RemessaService.ts` |
| Testes novos citando "boleto/DDA" | 23 asserts entre 4 arquivos de teste | ≥ 1 por caminho novo | ✅ | `grep -c 'boleto\\\|BOLETO\\\|DDA' src/backend/domain/**/sispag/*.test.ts` |
| Warnings de lint (Biome) contra arquivos deste delta | **0** — o conjunto é idêntico ao de `origin/main` | 0 novos | ✅ | `_shared-metrics.md` (aviso já verificado) |

> ⚠️ **Não medível localmente**: custo temporal de uma rodada de ingestão pós-delta (+1 leitura paginada por filial). O `_shared-metrics` cita ~5 páginas de 500 na filial 2 — precisa de traço em produção para virar número (`ObservabilityAdvisor` não roda neste QA).

### Apêndice A — Top-5 maiores arquivos tocados pelo delta

| # | Arquivo | LOC | Fan-in | Observação |
|---|---|---|---|---|
| 1 | `src/backend/domain/service/sispag/RemessaService.ts` | 971 | 3 | +120 LOC neste delta; 2º maior service do repo |
| 2 | `src/backend/domain/client/ConexosSispagWriteClient.ts` | 755 | 16 | +132 LOC; concentra o protocolo `associarDda` + auto-answer |
| 3 | `src/frontend/app/sispag/components/LoteCard.tsx` | 503 | (UI folha) | +6 LOC; aviso de "sem boleto DDA" acoplado à label em `TableCell` |
| 4 | `src/backend/domain/client/ConexosSispagClient.ts` | 426 | (multi-service) | +15 LOC; apenas passagem |
| 5 | `src/backend/domain/service/sispag/SispagPainelService.ts` | 390 | 1 | +38 LOC; ganhou terceira fonte de modalidade (BOLETO) |

### Apêndice B — Top-3 focos de fan-in relevantes ao delta

| Símbolo | Fan-in | Se mudar assinatura, quantos arquivos tocam? |
|---|---|---|
| `ConexosSispagWriteClient` | 16 (3 services, 3 clients irmãos, 10 jobs) | 16 (mas 10 são probes/validate — descartáveis) |
| `MODALIDADE.BOLETO` (enum) | 6 físicos (services + client + UI + error) | 6 |
| `RemessaService` | 3 (routes, 2 jobs) | 3 |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** | `RemessaService` já é o 2º maior service (971 LOC); o delta empurrou +120 LOC sem separação. `montarItensImport` cresceu 62% no corpo. Ainda cabe uma extração de "montarPayloadDeItem" isolada. | ⚠️ parcial | `src/backend/domain/service/sispag/RemessaService.ts:822-943` |
| **Increase Semantic Coherence** | `RemessaService` mistura orquestração de etapas, montagem de payload, resolução de destino, gate de barcode. `SispagPainelService.modalidadesDisponiveisDoLote` triplicou de fonte (título, conta, grid DDA) e ficou ~90 LOC num método só. Coerência preservada por comentários, não por estrutura. | ⚠️ parcial | `SispagPainelService.ts:225-320` |
| **Encapsulate** | Excelente: `associarDda` entra pela assinatura de `ConexosSispagWriteClient.importarTitulos`, protocolo de `answers` (Map keyed by id) e allowlist ficam DENTRO do client, `RemessaService` só decide bool. O erro de domínio `BoletoSemCodigoBarrasError` encapsula mensagem + statusCode + retryable. | ✅ presente | `ConexosSispagWriteClient.ts:508-543`, `BoletoSemCodigoBarrasError.ts:14-33` |
| **Use an Intermediary** | O flag `titVldReflexoDdaAssoc` é intermediário do ERP entre título e boleto — decisão explícita de NÃO manter tabela local de vínculo (ver ADR-0040). Alinhado com a doutrina "ERP é source of truth". | ✅ presente | `ontology/decisions/0040-*.md`; `IngestaoPagamentosService.ts:73-95` |
| **Restrict Dependencies** | `IngestaoPagamentosService` agora depende de `ConexosSispagWriteClient` (antes só do Client). Ambos são clients Conexos, o acoplamento é lateral (mesma família). PatternGuardian passou — DDD respeitado. | ✅ presente | `IngestaoPagamentosService.ts:37` (`@inject(ConexosSispagWriteClient)`) |
| **Refactor** | Loop `for (const associarDda of [false, true])` no bloco de import é pragmático — separa duas seleções sem reescrever `montarItensImport`. Funciona; não é elegante. Um `Map<boolean, Item[]>` explícito comunicaria melhor. | ⚠️ parcial | `RemessaService.ts:463-476` |
| **Abstract Common Services** | `MODALIDADE_NATIVA` continua sendo `Record<string, number>` local ao arquivo. `FEBRABAN_POR_BNCCOD` idem. Nenhum serviço compartilhado — cada mapa é um comentário em cima de um objeto literal. Aceitável enquanto for 1 lugar; começa a doer quando/se outro contexto SISPAG precisar. | ⚠️ parcial | `RemessaService.ts:36-42, 25` |
| **Defer Binding** | Constantes-chave (`MODALIDADE_NATIVA.BOLETO=7`, allowlist do auto-answer, FEBRABAN) são compile-time. Isso é intencional — a decisão real está no ERP em tempo de execução (via associação DDA). O `_index.json` da ontologia liga entidade → arquivo, o que ajuda a achar quem mudar. Sem plugin/tokens tsyringe extras neste delta. | ⚠️ parcial | `RemessaService.ts:36`, `ConexosSispagWriteClient.ts:42` |
| **Redistribute Responsibilities** | O delta reencaixou "quem sabe de boleto" da camada Serviço (`titEspCodbar`) para a camada Cliente/ERP (`titVldReflexoDdaAssoc`). Redistribuição correta, mas a UI (`LoteCard.tsx`) ganhou uma string condicional em cima da modalidade — mesma regra escrita de novo. | ⚠️ parcial | `LoteCard.tsx:421-423` |

## 4. Findings

### F-modifiability-1: `RemessaService.ts` passa de 851→971 LOC no delta; monta payload, orquestra etapas E aplica gate de negócio num só módulo

- **Severidade**: P2
- **Tactic violada**: Split Module + Increase Semantic Coherence
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:1-971`
- **Evidência (objetiva)**:
  ```
  Antes:  wc -l = 851  ;  montarItensImport = ~74 LOC  ;  74 CF-keywords no arquivo
  Depois: wc -l = 971  ;  montarItensImport = ~120 LOC ;  74 CF-keywords no arquivo (idem)
  Delta:  +120 LOC (+14%), +46 LOC no método (+62%)
  ```
- **Impacto técnico**: cada mudança futura no fluxo SISPAG (ex: PIX-QR, agendamento com "data para D+N") pega o mesmo módulo, aumentando risco de merge conflict com trabalho paralelo (a máquina de retomada e o gate de boleto já convivem aqui). O próximo salto (+120 LOC) passa dos 1000 — patamar em que o Bass sugere Split Module.
- **Impacto de negócio**: SISPAG é caminho de dinheiro saindo. Regressão custa dia útil da analista + retrabalho na tesouraria da Columbia. Modificações demoradas atrasam adaptação a mudanças de contrato do banco/ERP.
- **Métrica de baseline**: LOC 971 (target ≤ 600 forte, ≤ 1000 tolerável). Complexidade agregada estável (74 CF-keywords), então o problema é **tamanho**, não densidade.

### F-modifiability-2: regra "boleto exige código de barras" está gravada em 6 arquivos físicos, não em uma tactic Abstract Common Services

- **Severidade**: P2
- **Tactic violada**: Increase Semantic Coherence + Abstract Common Services
- **Localização**: 
  - `src/backend/domain/service/sispag/RemessaService.ts:875-882` (gate + throw)
  - `src/backend/domain/service/sispag/SispagPainelService.ts:236-317` (só oferece BOLETO se `comBoleto.has(...)`)
  - `src/backend/domain/service/sispag/IngestaoPagamentosService.ts:73-95, 122-148` (`titulosComBoletoDda` best-effort)
  - `src/backend/domain/client/ConexosSispagWriteClient.ts:428-483, 513-521` (leitura do flag + escrita `associarDda`)
  - `src/backend/domain/errors/BoletoSemCodigoBarrasError.ts` (regra em prosa)
  - `src/frontend/app/sispag/components/LoteCard.tsx:421-423` (mensagem "sem boleto DDA")
- **Evidência (objetiva)**:
  ```
  grep -rn 'BOLETO\|temBoleto\|associarDda' → 6 arquivos de produção
  Cada um repete parte da regra em texto/comentário; o ADR-0040 é a única cola.
  ```
- **Impacto técnico**: adicionar uma modalidade análoga (ex: PIX-QR-Code, que também teria "precisa do QR-string" fail-closed) exigirá tocar os mesmos 6 arquivos. Não há função "modalidadeExigeArtefatoExterno(modalidade, pendente): Result" que abstraia a regra. A UI reimplementa o teste em string literal.
- **Impacto de negócio**: aumenta o custo (em horas) de adaptar SISPAG a novas modalidades exigidas por Columbia/banco. A doutrina fica cara para o próximo dev.
- **Métrica de baseline**: 6 arquivos físicos; target ≤ 3 (regra + serviço + UI, sem duplicação lateral entre 3 services).

### F-modifiability-3: `MODALIDADE_NATIVA.BOLETO = 7` é valor sabidamente-errado, mantido protegido apenas pelo gate upstream

- **Severidade**: P2
- **Tactic violada**: Defer Binding + Encapsulate (armadilha oculta)
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:36-42, 917`
- **Evidência (objetiva)**:
  ```typescript
  // ⚠️ Para boleto COM associação DDA este mapa não decide nada: o ERP deriva a modalidade do
  // banco emissor do código de barras e sobrescreve o que mandamos (provado em HML — mandamos 6,
  // o ERP gravou 7 num boleto 745). Só sobra o caso boleto SEM DDA, que hoje é barrado por
  // `BoletoSemCodigoBarrasError` antes de chegar aqui.
  const MODALIDADE_NATIVA: Record<string, number> = {
      CREDITO_CONTA: 1, TED: 1, PIX: 1,
      BOLETO: 7,   // ← errado em 89% dos casos reais (medido: 32 itens com 6, 4 com 7)
  };
  // …usado em L917:
  itsVldModalidade: MODALIDADE_NATIVA[item.modalidade ?? 'CREDITO_CONTA'] ?? 1,
  ```
- **Impacto técnico**: se algum dia o gate `BoletoSemCodigoBarrasError` for removido, relaxado ou bypassado (ex: nova feature "boleto sem DDA para casos-limite"), o valor 7 volta a ser mandado. O comentário depende da atenção do próximo leitor. A regra "só chegue aqui se `associarDda=true`" não é enforcada pelo tipo.
- **Impacto de negócio**: potencial de gerar remessa com modalidade errada — banco pode aceitar mas cobrar tarifa diferente, ou (pior) rejeitar silenciosamente.
- **Métrica de baseline**: 1 constante sabidamente-errada, com 1 caminho protetor upstream a ~830 linhas de distância no mesmo arquivo.

### F-modifiability-4: 30 arquivos de sonda em `src/backend/jobs/` (5.181 LOC, 3 escrevem em HML) sem convenção de aposentadoria

- **Severidade**: P2
- **Tactic violada**: Reduce Size of Module (dimensão do diretório) + Restrict Dependencies (probes acoplam a clients internos)
- **Localização**: `src/backend/jobs/probe-*.ts` (30 arquivos)
- **Evidência (objetiva)**:
  ```
  find src/backend/jobs -name 'probe-*.ts' | wc -l          → 30
  find src/backend/jobs -name 'probe-*.ts' | xargs wc -l    → 5181 total
  ls src/backend/jobs/probe-*hml*.ts (3): probe-dda-answer-shape-hml.ts, probe-dda-assoc-write-hml.ts,
                                          probe-dda-associado-hml.ts   (escrevem em HML)
  Nenhum README/CONVENTION.md em src/backend/jobs/
  Este delta adiciona 7 probes; git log mostra que várias são de julho e nunca foram apagadas.
  ```
- **Impacto técnico**: cada probe importa clients reais (`ConexosSispagWriteClient` aparece em 5 probes = fan-in inflado); qualquer mudança de assinatura de client obriga a atualizar sondas mortas. `_index.json` da ontologia não referencia probes, então o retro-ontology não sinaliza. O guard `base != -hml` das 3 escritoras é uma linha em cada arquivo — sem teste garantindo que ninguém aponte para PRD.
- **Impacto de negócio**: baixo por enquanto (sondas são internas), mas cresce linearmente. Um probe HML apontando por engano para PRD dispararia escrita real no ERP.
- **Métrica de baseline**: 30 probes, 5.181 LOC, 0 aposentadas nos últimos 60 dias (`git log --diff-filter=D --since=60d src/backend/jobs/probe-*.ts` = vazio).

### F-modifiability-5: `SispagPainelService.modalidadesDisponiveisDoLote` cresceu para 3 fontes distintas em um método só

- **Severidade**: P3
- **Tactic violada**: Split Module (função) + Increase Semantic Coherence
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:243-322`
- **Evidência (objetiva)**:
  ```
  Antes do delta: 2 fontes (título fin064 + conta cmn025).
  Depois: 3 fontes (título + conta + grid DDA fin015).
  Método com ~80 LOC + 3 blocos `bounded.run(...)`.
  ```
- **Impacto técnico**: cada nova modalidade com "fonte específica" (ex: DDA, PIX-QR) adiciona um bloco irmão. Está no limite antes de virar "extrair um `ModalidadeResolver`".
- **Impacto de negócio**: painel é caminho quente; falha em uma das 3 fontes precisa ser isolada — hoje três `bounded.run` em sequência com trata-erro em cada. Correto mas frágil.
- **Métrica de baseline**: 80 LOC em 1 método público, 3 chamadas paralelizadas independentes.

### F-modifiability-6: fan-in de `ConexosSispagWriteClient` = 16 (inflado por 10 jobs/probes)

- **Severidade**: P3
- **Tactic violada**: Restrict Dependencies (contaminação por scripts descartáveis)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts` (interface pública) + 10 arquivos em `src/backend/jobs/`
- **Evidência (objetiva)**:
  ```
  grep -rln ConexosSispagWriteClient src/backend --include='*.ts' | grep -v .test.ts | grep -v WriteClient.ts$
  → 16 arquivos: 3 services (Ingestao, Painel, Remessa) + 3 clients irmãos + 10 jobs
  ```
- **Impacto técnico**: mudar assinatura de método público (ex: `listarTitulosPendentes`) força atualizar probes. Isso é uma tacit tax — desincentiva refatorar o client.
- **Impacto de negócio**: aumenta atrito para manutenção do client de escrita SISPAG, que é o coração do fluxo de dinheiro.
- **Métrica de baseline**: fan-in produtivo = 6 (3 services + 3 clients); fan-in total = 16 (com 10 jobs de sonda/validação).

## 5. Cards Kanban

### [modifiability-1] Extrair `SispagRemessaPayloadBuilder` de `RemessaService.montarItensImport`

- **Problema**
  > `RemessaService.ts` passou de 851 para 971 LOC neste delta (+14%). `montarItensImport` cresceu 62% no corpo (~74→~120 LOC) e agora concentra: resolução de pendentes, chave verbatim cross-filial, gate `BOLETO && !temBoletoDda`, resolução condicional de destino (`pesCod != null && !associarDda`), montagem de payload com spread condicional, tuple `{payload, associarDda}`. Cada nova modalidade que exigir "fonte alternativa de destino" empurra o serviço para além dos 1000 LOC.
- **Melhoria Proposta**
  > Extrair um `SispagRemessaPayloadBuilder` (mesmo diretório) responsável por: (a) resolver `TituloPendente` → `ItemImportPayload`, (b) devolver `{payload, associarDda}`. `RemessaService` fica com orquestração (etapas, ledger, retomada, invocação do `write.importarTitulos`). Tactic Bass: **Split Module** + **Increase Semantic Coherence**.
- **Resultado Esperado**
  > `RemessaService.ts` volta para faixa 750-800 LOC; `montarItensImport` deixa de existir como método privado gigante; adicionar uma nova modalidade toca 1 arquivo (o builder), não o orquestrador de etapas.
- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: M (2–3d, inclui remontar testes do RemessaService)
- **Findings relacionados**: F-modifiability-1, F-modifiability-5
- **Métricas de sucesso**:
  - LOC `RemessaService.ts`: 971 → ≤ 800
  - LOC do método mais longo em RemessaService: 120 → ≤ 60
  - Nº de arquivos tocados para adicionar próxima modalidade (medido em simulação de PR): estimado 6 → estimado 2
- **Risco de não fazer**: em 2 features do tamanho desta, o arquivo passa de 1.100 LOC — patamar em que o custo cognitivo de leitura vira gargalo.
- **Dependências**: nenhuma

### [modifiability-2] Consolidar a regra "modalidade exige artefato externo" em um único módulo de domínio

- **Problema**
  > A regra "BOLETO só sai se `temBoletoDda`" aparece em 6 arquivos físicos (`RemessaService`, `SispagPainelService`, `IngestaoPagamentosService`, `ConexosSispagWriteClient`, `BoletoSemCodigoBarrasError`, `LoteCard.tsx`). Cada um repete parte da regra em comentário/string literal (`i.modalidade === 'BOLETO' ? 'sem boleto DDA — ...' : ...`). Sem função canônica; a cola é o ADR-0040.
- **Melhoria Proposta**
  > Criar `domain/service/sispag/ModalidadeElegibilidade.ts` (`@injectable`) com contrato `avaliar(item, pendente): { elegivel, motivo?, flagsErp }`. `RemessaService` chama-o no gate. `SispagPainelService` usa-o para popular `modalidadesDisponiveis`. UI consome o `motivo` textual devolvido pela API (não recria a mensagem). Tactic Bass: **Abstract Common Services** + **Increase Semantic Coherence**.
- **Resultado Esperado**
  > Nova modalidade fail-closed (ex: PIX-QR) implementada tocando 2 arquivos: `ModalidadeElegibilidade.ts` + o Error class correspondente. UI e serviços consumem o mesmo veredito.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: M (3–4d, inclui migrar UI de string literal para consumir `motivo` do backend)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Arquivos que carregam a regra: 6 → 2
  - Ocorrências físicas de `MODALIDADE.BOLETO` fora do serviço centralizador: 5 → 1
- **Risco de não fazer**: cada nova modalidade repete a fadiga de tocar 6 arquivos; UI e backend divergem em mensagem/critério silenciosamente.
- **Dependências**: idealmente após [modifiability-1] (o builder já existe onde plugar o resolver).

### [modifiability-3] Trocar `MODALIDADE_NATIVA.BOLETO = 7` por barreira de tipo/runtime

- **Problema**
  > `MODALIDADE_NATIVA.BOLETO = 7` é sabidamente errado (medido: 89% dos boletos reais são 6). O comentário explica que o ERP sobrescreve quando há DDA e que o gate barra o caminho sem-DDA. A proteção é implícita: se o gate for removido, o valor errado volta ao ERP silenciosamente.
- **Melhoria Proposta**
  > Duas opções, ordenadas por preferência: (a) remover a chave `BOLETO` do mapa e mudar `MODALIDADE_NATIVA` para `Record<Exclude<Modalidade,'BOLETO'>, number>` — o compilador força quem tentar usar `MODALIDADE_NATIVA[BOLETO]` a lidar com o caso, tornando a barreira explícita em tempo de tipo; (b) `throw new UnreachableError('boleto sem DDA deveria ter sido barrado antes')` na linha 917 se `item.modalidade === BOLETO`. Tactic Bass: **Encapsulate** + **Defer Binding** (mover decisão para o ERP explicitamente).
- **Resultado Esperado**
  > A constante deixa de ser armadilha: `BOLETO` só é aceito pelo caminho com `associarDda=true`, garantido pelo tipo ou por throw.
- **Tactic alvo**: Encapsulate
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Constantes sabidamente-erradas sem barreira runtime/tipo: 1 → 0
  - Nº de testes que garantem "BOLETO sem DDA nunca chega ao ERP": (medir) → ≥ 1 explícito
- **Risco de não fazer**: se um dev futuro relaxar o gate para casos-limite (ou uma retomada bypassar), o SISPAG volta a mandar modalidade errada — falha silenciosa que só aparece na tesouraria da Columbia.
- **Dependências**: pode ser feito no mesmo PR de [modifiability-1].

### [modifiability-4] Criar convenção de aposentadoria para `jobs/probe-*.ts`

- **Problema**
  > 30 arquivos probe, 5.181 LOC, 3 deles escrevendo em HML sem opt-in central. Nenhum foi apagado nos últimos 60 dias. Cada probe importa clients de produção (`ConexosSispagWriteClient` aparece em 5 probes) e infla fan-in artificial. O guard `base != -hml` é uma linha em cada arquivo — sem teste que assegure o invariante.
- **Melhoria Proposta**
  > (1) Adicionar `src/backend/jobs/README.md` com política: cada probe declara `expiresAt` no header e `retiredOn` no dia em que a decisão que o motivou foi documentada em ADR/business-rule. (2) Task no `/retro-ontology` para apagar probes cuja ADR referenciada esteja `accepted` há > 30 dias. (3) Extrair helper `assertNotProd()` compartilhado (Abstract Common Services) para os 3 probes que escrevem. Tactic Bass: **Restrict Dependencies** + **Reduce Size of Module** (do diretório).
- **Resultado Esperado**
  > `src/backend/jobs/probe-*.ts` estabiliza em ≤ 15 arquivos ativos; fan-in de `ConexosSispagWriteClient` cai para ≤ 10; guard de HML fica em 1 função testada, não em 3 cópias.
- **Tactic alvo**: Restrict Dependencies
- **Severidade**: P2
- **Esforço estimado**: S (política + helper: ≤1d) + M (auditoria + apagar as ~15 obsoletas: 2d)
- **Findings relacionados**: F-modifiability-4, F-modifiability-6
- **Métricas de sucesso**:
  - Probes ativos: 30 → ≤ 15
  - LOC em `probe-*.ts`: 5.181 → ≤ 2.500
  - Fan-in de `ConexosSispagWriteClient`: 16 → ≤ 10
  - Guards `base != -hml` reescritos em helper compartilhado: 3 cópias → 1 função + 1 teste
- **Risco de não fazer**: o diretório dobra em 6 meses; algum probe HML aponta por engano para PRD e escreve. O guard de 1 linha é a única barreira hoje.
- **Dependências**: alinhar com `/retro-ontology` (que já roda semanal segundo `CLAUDE.md`).

### [modifiability-5] Extrair `montarItensImport` em três funções (chaveamento, gate, montagem)

- **Problema**
  > Mesmo após [modifiability-1] (que separa RemessaService do builder), o próprio builder precisa ser decomposto. Hoje o corpo tem 3 responsabilidades claras: (a) montar chave verbatim e mapear pendentes, (b) aplicar gates (item cross-filial, `BOLETO && !temBoletoDda`), (c) resolver destino + montar payload.
- **Melhoria Proposta**
  > Dentro do futuro `SispagRemessaPayloadBuilder`: 3 métodos privados (`indexarPendentes`, `validarElegibilidade`, `montarPayload`). Cada um testável isoladamente. Tactic Bass: **Split Module** (função).
- **Resultado Esperado**
  > Cada função ≤ 40 LOC; testes de gate independentes dos testes de payload.
- **Tactic alvo**: Split Module
- **Severidade**: P3
- **Esforço estimado**: S (≤1d, após [modifiability-1])
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - LOC do método público mais longo do builder: 120 → ≤ 40
  - Nº de testes unitários sobre "gate de boleto" isolados: 0 → ≥ 3
- **Risco de não fazer**: builder continua difícil de testar sem stub pesado do client.
- **Dependências**: [modifiability-1].

### [modifiability-6] Testar o guard "probe HML nunca escreve em PRD" com um teste automatizado

- **Problema**
  > `probe-dda-answer-shape-hml.ts`, `probe-dda-assoc-write-hml.ts` e `probe-dda-associado-hml.ts` escrevem no ERP. A única defesa é uma linha do tipo `if (!base.includes('-hml')) throw ...` dentro de cada arquivo. Não há teste que reproduza "probe apontou para base PRD → morre antes de chamar o client".
- **Melhoria Proposta**
  > Um teste único em `src/backend/jobs/__tests__/probes-hml.test.ts` que carrega cada probe HML com `ConexosBaseClient` mockado apontando para base PRD e afirma que o processo falha antes do primeiro `POST`. Tactic Bass: **Abstract Common Services** (helper `assertNotProd()` já centralizado por [modifiability-4]).
- **Resultado Esperado**
  > Regressão do guard vira falha de CI, não incidente em produção.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Probes HML sem teste de guard: 3 → 0
  - Cobertura do helper `assertNotProd()`: 0% → 100%
- **Risco de não fazer**: probe apontando para PRD escreveria no ERP sem que ninguém percebesse até o retorno.
- **Dependências**: [modifiability-4] (o helper compartilhado).

## 6. Notas do agente

- **Escopo real**: `--quick`, delta somente. Não abri finding contra o baseline pré-existente do repo (`RecebimentoNumerarioService.ts` = 2415 LOC é um problema conhecido, mas fora do escopo desta run — o QA modifiability full deveria pegar).
- **Warnings de Biome**: respeitei o aviso do `_shared-metrics.md` — o conjunto de arquivos com warning é idêntico ao de `origin/main`. Nenhum finding de complexidade contra este delta; o crescimento de `RemessaService.ts` é reportado por LOC, não por Biome (o método `montarItensImport` já era warning pré-delta, mas continuou abaixo do limiar do noExcessiveCognitiveComplexity=15).
- **Binding time do vínculo boleto↔título**: a decisão de NÃO persistir localmente o código de barras (ADR-0040) é boa modifiability — o ERP é a autoridade e evita drift. Isso aparece como Use an Intermediary ✅ na tactic table, não como finding.
- **Cross-QA**:
  - F-modifiability-4 (probes escritoras HML) e [modifiability-4/6] ↔ **Testability** (guard sem teste = regressão silenciosa) e **Security** (probe → PRD por engano = incidente).
  - F-modifiability-3 (MODALIDADE_NATIVA.BOLETO=7 armadilha) ↔ **Fault-tolerance** (falha silenciosa se o gate for bypassado) e **Deployability** (constante em código = redeploy para corrigir).
  - F-modifiability-2 (regra em 6 arquivos) ↔ **Integrability** (UI e backend divergem em critério).
  - F-modifiability-1 (RemessaService 971 LOC) ↔ **Testability** (arquivo grande = teste grande = merge conflict provável em trabalho paralelo).
