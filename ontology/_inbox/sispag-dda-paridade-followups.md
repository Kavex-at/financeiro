# Follow-ups — `sispag-dda-paridade` (não implementados neste ciclo)

> Origem: entrevista `sispag-dda-paridade-interview.md` (Q11, aprovado por Yuri em 2026-10-30). Estes
> itens mudam regra de sincronização e ficaram de fora de propósito. A guarda "lista vazia não apaga"
> (F5.3) **entrou** nesta feature e não está aqui.

## F5.1 — aviso "DDA parado há N h" com o pipeline saudável

- Hoje: limiar de 8 h corridas em dia útil (`ddaDefasado.ts`), sobre `max(sincronizado_em)` de
  `boleto_dda_arquivo` (`BoletoDdaRepository.ultimaSincronizacao`).
- Defeito 1: entre o cron das 16h e o das 07h há 15 h; o aviso aparece toda noite útil e segunda cedo.
- Defeito 2: `sincronizado_em` só avança quando um arquivo é salvo; uma passada sem arquivo salvo
  (tudo adiado ou com falha) não avança a marca, e uma passada sem nada a reler também não.
- Proposta (decisão de negócio já aberta em `sispag-dda-na-ingestao-regis-followups.md`): trocar
  "horas corridas" por "rodada esperada perdida", com a marca da última **passada** (não do último
  arquivo) gravada na run (`dda_estado`, migration aditiva — card performance-1).

## F5.2 — arquivo importado há mais de 60 dias nunca é relido

- Hoje: a janela de releitura é pela data de **importação** do arquivo (`BoletoDdaService`,
  `RELEITURA_DIAS = 60`). Um boleto com vencimento distante num arquivo velho não ganha mais vínculo
  do Conexos na nossa cópia.
- Proposta: janela pelo maior vencimento dos boletos do arquivo (ou "arquivo com algum boleto a
  vencer"). Medir antes quantos arquivos e boletos isso acrescenta por passada.

## Do próprio ciclo

- `dda_estado` persistido na run, para a aba mostrar o estado da última ingestão sem depender da
  página que a disparou (hoje a aba só vê o `sincronizadoEm`).
- Sincronização assíncrona (202 + status) se o prazo de 60 s do botão se mostrar curto em produção.
- Estado da aba Títulos a pagar sobreviver à troca de aba (mesmo store usado aqui) e filtros na URL
  para as duas abas.
- Q12 sem resposta: qual sintoma o Yuri vê em produção ("o fetch do DDA não funciona como esperado").

## Regis-Review 2026-10-30 (reduzido)

Revisão de 4 QAs (Fault Tolerance, Performance, Testability, Modifiability). **Nenhum P0.** Cinco
cards foram remediados no próprio PR da feature e **não** aparecem aqui (`performance-1`,
`performance-2`, `testability-1`, `modifiability-1`, `fault-tolerance-1`). Os itens abaixo são o
backlog residual — ordem por severidade, depois por esforço.

Artefatos completos:
`docs/regis-review/2026-10-30-sispag-dda-paridade/{REPORT.md,KANBAN.md}`.

### P1

_Nenhum residual (performance-1 foi tratado no PR)._

### P2

- [ ] **fault-tolerance-2** — Priorizar `arquivosAdiados` na próxima passada (Reconcile; M). Persistir
      `ultima_tentativa_em` em `boleto_dda_arquivo` e ordenar o alvo por esse campo antes do laço de
      sync. Baseline: idade mediana do pior adiado hoje = desconhecida; alvo ≤ 1 passada.
- [ ] **fault-tolerance-3** — Alarme de staleness sobre `max(sincronizado_em)` (Self-Test; S). Probe
      periódico que emite `BUSINESS_WARN` quando `now() - ultimaSincronizacao() > 3 h` em horário
      comercial BRT. Cobertura 0 % → 100 %.
- [ ] **performance-3** — Memoizar facetas e contagens por entrada da cache consolidada (Reduce
      Overhead; M). p50 warm 60 ms → 25 ms. Depende de `performance-2` (já tratado).
- [ ] **performance-4** — Evitar as duas `SELECT max(...)` em cache hit (Reduce Overhead; S). Via
      `CarteiraVersao` + `DdaSyncVersao` singletons. Queries/hit 2 → 0.
- [ ] **modifiability-2** — Fatiar `src/backend/routes/sispag.ts` por sub-rota (Split Module; M).
      1 976 LOC → ≤ 400 LOC por módulo. **Fazer fora deste PR** para isolar blast radius.

### P3

- [ ] **fault-tolerance-4** — Documentar o limite "cache por processo" como pré-condição de escala
      (State Resync; S). ADR amendment; latente até o pivot para Lambda/N réplicas.
- [ ] **performance-5** — Endpoint dedicado `GET /sispag/boletos-dda/titulo` em vez de 2 GETs à
      listagem (Reduce Overhead; M). Requests por gaveta 2 → 1.
- [ ] **performance-6** — Abortar a consolidação em voo quando `invalidar()` é chamado (Limit Event
      Response; M). Via `AbortSignal` por entrada em voo. CPU órfã ≤ 500 ms. Depende de
      `performance-3`.
- [ ] **testability-2** — Suíte unitária para os cinco componentes compartilhados extraídos (Limit
      Structural Complexity; S). Executar depois de `modifiability-1` (já tratado) — os paths serão
      os novos.
- [ ] **testability-3** — Fixture versionada da resposta `BoletosDdaResposta` (Recordable Test Cases;
      S). 1–2 fixtures JSON em `__fixtures__/`; builder `pagina()` passa a parsear o fixture.
- [ ] **testability-4** — Fixar `coverageThreshold` para o escopo da feature (Executable Assertions;
      S). 80/70/80 em `domain/service/sispag/{BoletoDdaService,PaginacaoBoletoDda,ConsolidacaoBoletoDdaCache}.ts`
      e `app/sispag/boletos-dda/*`.
- [ ] **testability-5** — Teste UI com relógio controlado para "Vencem em até 2 dias" / "Ver só estes"
      (Limit Non-Determinism; S). `jest.setSystemTime('2026-10-30T15:00Z')` amarrando rótulo exibido
      a dia civil.
- [ ] **modifiability-3** — Dividir `PaginacaoBoletoDda` em `FiltragemBoletoDda` + `FacetasBoletoDda`
      + `TotaisBoletoDda` (Increase Semantic Coherence; S). 401 LOC → ≤ 150 LOC por classe.
- [ ] **modifiability-4** — Externalizar `BOLETO_DDA_PRAZO_MS` via `EnvironmentProvider` (Defer
      Binding; S). Trocar prazo = env var, não build.
- [ ] **modifiability-5** — Consolidar paginadores (`PaginacaoTabela` × `Paginacao` legado) (Abstract
      Common Services; M, incremental). Mapear em `migration-debt.md`; migrar aba a aba conforme o
      backend aceitar paginação por servidor.

## Rodada 2 — Regis-Review reduzido (2026-10-30, `docs/regis-review/2026-10-30-sispag-dda-paridade-r2/`)

Nenhum P0. Nada implementado daqui (regra 11).

- **availability-1 (P1):** a conferência rápida roda na requisição de abertura com o prazo de 60 s
  aprovado e sem timeout por chamada ao `fin124`; com o Conexos lento, a abertura pode segurar um
  worker até 60 s. Proposta: prazo próprio da conferência (~15–20 s) e timeout por chamada. Medir em
  produção a duração da conferência (log `conferência rápida do DDA concluída`) antes.
- **testability-r2-1 (P1) / fault-tolerance-2 (P2):** o `if:` do passo de formação compara as strings
  dos crons; mudar um horário e esquecer o `if:` desliga a formação calada. Proposta: `actionlint` no CI
  e/ou passar a formação em TODOS os slots (o serviço já decide: dia útil, ≥ 06:30, uma por dia).
- **PatternGuardian (P1, I3):** campos opcionais de `BoletoDda.ts` sem `| null`. Pré-existente e
  divergente da convenção do CLAUDE.md ("`property?: Type`"); decidir a regra antes de mexer.
- **availability-2 (P2):** `job:ingest-pagamentos` sem retry no workflow (próximo slot cobre, até ~5 h).
- **availability-3 (P3):** nenhuma sonda do `fin124` entre 16:13 e 05:07.
- **fault-tolerance-1 (P2):** `job_execucao` `running` órfão de `sispag-formacao-lotes` sem reaper (não
  trava a formação: só `success`/`partial` contam).
- **fault-tolerance-3 (P3):** conferência registrada mesmo quando a listagem deu certo e todas as leituras
  de item falharam (a marca do aviso anda).
- **fault-tolerance-4 (P3):** `--manual` não loga que ignorou a trava.
- **fault-tolerance-5 (P3), testability-r2-2/5/6/7:** testes de `OCUPADA` com sync em voo, `--manual`
  do job, `cabecalhoMudou` direto, `conferirSeVelho` sem `agora`, integração/EXPLAIN de
  `existeConcluidaDesde`.
- **testability-r2-3/4 (P2):** `BoletoDdaService` com 15 dependências e teste de ~580 linhas: separar
  conferência/sincronização em serviços e arquivos de teste.
- **DesignSystemReviewer (obs.):** `role="status"` do aviso sem `aria-live` explícito (pré-existente).
